"""Independent, test-only numerical expectations for the browser calculation suite.

No production analysis helpers are imported here. Fractions retain exact binary
input values through interpolation/subtraction, with a single rounding to float
for the JSON handoff. This deliberately differs from the application's arithmetic.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from bisect import bisect_right
from fractions import Fraction
from itertools import combinations
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
PREVIEW_PATH = REPO_ROOT / "web" / "public" / "data" / "preview.json"
GOLDEN_PATH = REPO_ROOT / "contracts" / "testing" / "calculation-golden.json"


def reference_summary(values: list[float | None]) -> dict[str, float | int] | None:
    """Type 7 quantiles using exact rational, barycentric interpolation."""
    sample = sorted(
        Fraction(value) for value in values if value is not None and math.isfinite(value)
    )
    if not sample:
        return None
    result: dict[str, float | int] = {"validCount": len(sample)}
    for key, probability in (
        ("q25Db", Fraction(1, 4)),
        ("medianDb", Fraction(1, 2)),
        ("q75Db", Fraction(3, 4)),
    ):
        position = (len(sample) - 1) * probability
        lower, remainder = divmod(position.numerator, position.denominator)
        weight = Fraction(remainder, position.denominator)
        upper = min(lower + 1, len(sample) - 1)
        result[key] = float((1 - weight) * sample[lower] + weight * sample[upper])
    return result


def reference_pair(
    before: list[float | None], after: list[float | None], roi: list[bool]
) -> list[float | None]:
    """Intersect the fixed ROI and valid masks before after-minus-before."""
    return [
        None
        if not in_roi or first is None or second is None
        else float(Fraction(second) - Fraction(first))
        for first, second, in_roi in zip(before, after, roi, strict=True)
    ]


def reference_bins(values: list[float | None], edges: list[float]) -> list[int]:
    """Classify by insertion rank; the final upper edge belongs to the last bin."""
    counts = [0] * (len(edges) - 1)
    for value in values:
        if value is None:
            continue
        if not math.isfinite(value) or value < edges[0] or value > edges[-1]:
            raise ValueError(f"Reference difference outside fixed histogram edges: {value}")
        index = min(bisect_right(edges, value) - 1, len(counts) - 1)
        counts[index] += 1
    return counts


def build_oracle(dataset: dict[str, Any], fixture_sha256: str) -> dict[str, Any]:
    """Derive expected chart inputs directly from a prepared package."""
    roi = dataset["grid"]["roiMask"]
    roi_count = sum(roi)
    if not roi_count:
        raise ValueError("Reference package must have at least one ROI cell")
    available = []
    summaries: dict[str, Any] = {}
    domain_values = []
    for slot in dataset["acquisitions"]:
        if slot["availability"] == "missing":
            summaries[slot["id"]] = None
            continue
        values = slot["valuesDb"]
        if len(values) != len(roi) or any(
            value is not None and not in_roi for value, in_roi in zip(values, roi, strict=True)
        ):
            raise ValueError("Reference values violate the fixed ROI mask")
        expected = reference_summary(values)
        actual = slot["summary"]
        if (expected is None) != (actual is None) or (
            expected is not None
            and any(
                not math.isclose(actual[key], value, rel_tol=0, abs_tol=1e-10)
                for key, value in expected.items()
            )
        ):
            raise ValueError(f"Prepared summary disagrees with reference: {slot['id']}")
        summaries[slot["id"]] = (
            None
            if expected is None
            else {**expected, "coverageFraction": expected["validCount"] / roi_count}
        )
        available.append(slot)
        domain_values.extend(value for value in values if value is not None)
    edges = dataset["histogramEdgesDb"]
    pairs = []
    for before, after in combinations(available, 2):
        differences = reference_pair(before["valuesDb"], after["valuesDb"], roi)
        pairs.append(
            {
                "beforeId": before["id"],
                "afterId": after["id"],
                "beforeDay": before["day"],
                "afterDay": after["day"],
                "valuesDb": differences,
                "validCount": sum(value is not None for value in differences),
                "binCounts": reference_bins(differences, edges),
            }
        )
    return {
        "schemaVersion": 1,
        "fixtureSha256": fixture_sha256,
        "acquisitions": summaries,
        "spatialDomainDb": (
            [math.floor(min(domain_values)), math.ceil(max(domain_values))]
            if domain_values
            else [-18, -6]
        ),
        "histogramEdgesDb": edges,
        "pairs": pairs,
    }


def verify_golden() -> dict[str, Any]:
    """Anchor the reference implementation in the independently hand-solved example."""
    source = GOLDEN_PATH.read_bytes()
    golden = json.loads(source)
    oracle = build_oracle(golden["dataset"], hashlib.sha256(source).hexdigest())
    pair = oracle["pairs"][0]
    expected = golden["expected"]
    observed = {
        "differencesDb": pair["valuesDb"],
        "pairedValidCount": pair["validCount"],
        "histogramCounts": pair["binCounts"],
        "beforeCoverageFraction": oracle["acquisitions"][pair["beforeId"]]["coverageFraction"],
        "afterCoverageFraction": oracle["acquisitions"][pair["afterId"]]["coverageFraction"],
        "spatialDomainDb": oracle["spatialDomainDb"],
    }
    if observed != expected:
        raise ValueError("Independent numerical reference does not reproduce the golden fixture")
    return oracle


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    verify_golden()
    source = PREVIEW_PATH.read_bytes()
    oracle = build_oracle(json.loads(source), hashlib.sha256(source).hexdigest())
    if len(oracle["pairs"]) != 28:
        raise ValueError("The committed preview must provide all 28 chronological date pairs")
    output = args.output.resolve()
    if output in {PREVIEW_PATH.resolve(), GOLDEN_PATH.resolve()}:
        parser.error("The oracle must not overwrite a source fixture")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(oracle, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote independent expectations for {len(oracle['pairs'])} date pairs: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
