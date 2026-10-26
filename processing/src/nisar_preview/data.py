"""Own the power conversion and acquisition summaries in the shared data handoff.

This module does not classify water. Its spatial pattern and acquisition days are
synthetic, with no physical coordinates or NISAR product identifiers.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "contracts" / "study-dataset.schema.json"
FIXTURE_PATH = REPO_ROOT / "web" / "public" / "data" / "preview.json"
SEED = 20261026
DAYS = (1, 13, 25, 37, 49, 61, 73, 85, 97)


def power_to_db(power: float | None) -> float | None:
    """Return 10 log10(power), masking nonpositive, missing and nonfinite values."""
    if power is None or isinstance(power, bool) or not math.isfinite(power) or power <= 0:
        return None
    return 10 * math.log10(power)


def _quantile(ordered: list[float], probability: float) -> float:
    """Hyndman–Fan type 7 / linearly interpolated sample quantile."""
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarize(values: list[float | None]) -> dict[str, float | int] | None:
    """Summarize spatial spread of valid dB values, not measurement confidence."""
    ordered = sorted(value for value in values if value is not None and math.isfinite(value))
    if not ordered:
        return None
    return {
        "medianDb": _quantile(ordered, 0.5),
        "q25Db": _quantile(ordered, 0.25),
        "q75Db": _quantile(ordered, 0.75),
        "validCount": len(ordered),
    }


def generate_dataset() -> dict[str, Any]:
    """Generate a deterministic, bounded synthetic power field and prepare its dB handoff."""
    rng = random.Random(SEED)
    size = 20
    roi_mask = [
        ((row - 9.5) / 12) ** 2 + ((column - 9.5) / 12) ** 2 < 1.12
        for row in range(size)
        for column in range(size)
    ]
    # The static channel-like field is schematic, without longitude/latitude.
    bases: list[float] = []
    responses: list[float] = []
    for row in range(size):
        for column in range(size):
            center = 9 + 4 * math.sin(row / 3.6)
            channel = math.exp(-((column - center) ** 2) / 9)
            bases.append(-11.2 - 3.2 * channel + rng.uniform(-1.1, 1.1))
            responses.append(0.25 + 0.75 * math.sin(column / 3 + row / 5))

    acquisitions = []
    for day in DAYS:
        acquisition: dict[str, Any] = {
            "id": f"preview-day-{day}",
            "day": day,
            "availability": "missing" if day == 37 else "available",
            "valuesDb": None,
            "summary": None,
        }
        if day != 37:
            values: list[float | None] = []
            seasonal = 1.6 * math.cos((day - 13) / 84 * 2 * math.pi)
            invalid_fraction = 0.04 + 0.15 * (0.5 + 0.5 * math.sin(day / 19))
            for index, in_roi in enumerate(roi_mask):
                if not in_roi or rng.random() < invalid_fraction:
                    # Includes different invalid inputs so conversion owns their masking.
                    power = rng.choice([None, 0.0, -1.0])
                else:
                    db = bases[index] + seasonal * responses[index] + rng.uniform(-0.2, 0.2)
                    power = 10 ** (db / 10)
                converted = power_to_db(power)
                values.append(None if converted is None else round(converted, 6))
            acquisition["valuesDb"] = values
            acquisition["summary"] = summarize(values)
        acquisitions.append(acquisition)

    dataset = {
        "schemaVersion": 1,
        "id": "louisiana-synthetic-preview",
        "title": "Louisiana wetlands · synthetic preview",
        "provenance": {
            "kind": "synthetic",
            "description": (
                "Deterministic schematic 20 × 20 power field. Synthetic days and cells do not "
                "represent Louisiana measurements or NISAR acquisitions. Spatial quartiles "
                "describe pixel spread, not confidence."
            ),
            "generatorVersion": "0.1.0",
            "seed": SEED,
            "productIds": [],
        },
        "units": "gamma0_db",
        "polarization": "HH",
        "grid": {
            "width": size,
            "height": size,
            "order": "row-major",
            "coordinateSystem": "synthetic",
            "roiMask": roi_mask,
        },
        "histogramEdgesDb": [-6 + index * 0.75 for index in range(17)],
        "acquisitions": acquisitions,
    }
    validate_dataset(dataset)
    return dataset


def validate_dataset(dataset: Any) -> None:
    """Validate the shared JSON schema and relationships it cannot express."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(dataset)
    grid = dataset["grid"]
    count = grid["width"] * grid["height"]
    if len(grid["roiMask"]) != count or not any(grid["roiMask"]):
        raise ValueError("ROI mask must match grid dimensions and contain valid ROI cells")
    edges = dataset["histogramEdgesDb"]
    if any(not math.isfinite(edge) for edge in edges):
        raise ValueError("Histogram edges must be finite")
    if any(right <= left for left, right in zip(edges, edges[1:], strict=False)):
        raise ValueError("Histogram edges must be strictly increasing")
    if edges[0] >= 0 or any(
        not math.isclose(left, -right, abs_tol=1e-9)
        for left, right in zip(edges, reversed(edges), strict=True)
    ):
        raise ValueError("Histogram edges must have a symmetric range around zero")

    if sum(slot["availability"] == "available" for slot in dataset["acquisitions"]) < 2:
        raise ValueError("The dataset must contain at least two available acquisitions")

    seen_ids: set[str] = set()
    last_day = -math.inf
    cell_ranges: list[list[float]] = [[] for _ in range(count)]
    for acquisition in dataset["acquisitions"]:
        if acquisition["id"] in seen_ids or acquisition["day"] <= last_day:
            raise ValueError("Acquisitions need unique IDs and strictly increasing days")
        seen_ids.add(acquisition["id"])
        last_day = acquisition["day"]
        if acquisition["availability"] == "missing":
            continue
        values = acquisition["valuesDb"]
        if len(values) != count:
            raise ValueError("Acquisition values must match grid dimensions")
        for index, value in enumerate(values):
            if value is not None:
                if not math.isfinite(value):
                    raise ValueError("Backscatter values must be finite or null")
                if not grid["roiMask"][index]:
                    raise ValueError("Cells outside the fixed ROI must be masked")
                cell_ranges[index].append(value)
        expected = summarize(values)
        actual = acquisition["summary"]
        if expected is None:
            if actual is not None:
                raise ValueError("An acquisition with no valid values must have a null summary")
        elif actual is None or any(
            not math.isfinite(actual[key]) or not math.isclose(actual[key], value, abs_tol=1e-9)
            for key, value in expected.items()
        ):
            raise ValueError("Acquisition summary must match its prepared dB values")
    if any(values and max(values) - min(values) > edges[-1] for values in cell_ranges):
        raise ValueError("Histogram edges must cover every possible paired cell difference")


def serialize_dataset(dataset: dict[str, Any]) -> str:
    """Stable JSON keeps regeneration reviewable and forbids NaN/Infinity output."""
    return json.dumps(dataset, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
