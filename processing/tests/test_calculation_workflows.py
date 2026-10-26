"""Verify preparation calculations against independent high-precision references."""

from __future__ import annotations

import hashlib
import json
import math
import random
import sys
from decimal import Decimal, localcontext
from fractions import Fraction

import pytest
from build_calculation_oracle import (
    GOLDEN_PATH,
    REPO_ROOT,
    build_oracle,
    reference_bins,
    reference_pair,
    reference_summary,
    verify_golden,
)

from nisar_preview.data import (
    FIXTURE_PATH,
    generate_dataset,
    power_to_db,
    summarize,
    validate_dataset,
)


def decimal_db(power: float) -> float:
    with localcontext() as context:
        context.prec = 50
        return float(10 * Decimal.from_float(power).log10())


@pytest.mark.parametrize(
    "power",
    [
        math.ulp(0.0),
        sys.float_info.min,
        1e-250,
        1e-100,
        1e-12,
        0.0037,
        0.1,
        0.5,
        math.nextafter(1.0, 0.0),
        1.0,
        math.nextafter(1.0, math.inf),
        2.0,
        3.7,
        10.0,
        1e12,
        1e100,
        1e250,
        sys.float_info.max,
    ],
)
def test_conversion_agrees_with_fifty_digit_decimal_reference(power):
    expected = decimal_db(power)
    assert power_to_db(power) == pytest.approx(expected, rel=0, abs=2 * math.ulp(expected))


@pytest.mark.parametrize(
    "power",
    [
        None,
        False,
        True,
        0,
        -0.0,
        -math.ulp(0.0),
        -1e-250,
        -1,
        -1e250,
        math.nan,
        math.inf,
        -math.inf,
    ],
)
def test_invalid_power_never_leaks_into_prepared_decibels(power):
    assert power_to_db(power) is None


@pytest.mark.parametrize("seed", [7, 35, 20261026])
def test_seeded_conversion_is_monotonic_and_obeys_power_ratio_identity(seed):
    rng = random.Random(seed)
    powers = sorted(10 ** rng.uniform(-150, 150) for _ in range(80))
    decibels = [power_to_db(power) for power in powers]
    assert all(first <= second for first, second in zip(decibels, decibels[1:], strict=False))
    for power in powers:
        assert power_to_db(power) == pytest.approx(decimal_db(power), rel=0, abs=1e-12)
        assert power_to_db(power * 100) - power_to_db(power) == pytest.approx(20, abs=1e-12)


@pytest.mark.parametrize(
    "values",
    [
        [],
        [None, math.nan, math.inf, -math.inf],
        [0],
        [None, -14.25, None],
        [-20, -10],
        [-9, -3, 0],
        [-12, -8, -5, -1],
        [6, 0, -6, 12, -12],
        [2, 2, 2, 2, 2, 2],
        [-10, -10, 0, 0, 0, 4],
        [0.1, None, 0.2, math.nan, 0.3, math.inf, -0.4],
    ],
)
def test_spatial_summary_agrees_with_exact_fraction_reference(values):
    assert summarize(values) == pytest.approx(reference_summary(values), rel=0, abs=1e-12)


@pytest.mark.parametrize(
    "values",
    [
        [-1e308, 1e308],
        [-sys.float_info.max, sys.float_info.max],
        [-sys.float_info.max, 0, sys.float_info.max],
        [-sys.float_info.max, sys.float_info.max, sys.float_info.max],
        [-sys.float_info.max, -sys.float_info.max, sys.float_info.max],
    ],
)
def test_finite_extreme_quantiles_do_not_overflow_interpolation(values):
    expected = reference_summary(values)
    actual = summarize(values)
    assert actual["validCount"] == len(values)
    for key in ["medianDb", "q25Db", "q75Db"]:
        assert math.isfinite(actual[key])
        assert actual[key] == pytest.approx(expected[key], rel=0, abs=2 * math.ulp(expected[key]))


def test_contract_accepts_finite_extreme_values_with_exact_reference_summaries():
    dataset = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["dataset"]
    values = [-1e308, 1e308]
    dataset["grid"].update({"width": 2, "roiMask": [True, True]})
    for acquisition in dataset["acquisitions"]:
        if acquisition["availability"] == "available":
            acquisition["valuesDb"] = values.copy()
            acquisition["summary"] = reference_summary(values)
    validate_dataset(dataset)


@pytest.mark.parametrize("seed", [11, 41, 97, 20261026])
def test_summary_permutation_translation_and_scaling_properties(seed):
    rng = random.Random(seed)
    # Binary fractions make these transformations exact, avoiding tolerance-driven successes.
    values = [rng.randrange(-800, 1) / 16 for _ in range(41)]
    baseline = reference_summary(values)
    shuffled = values + [None, math.nan, math.inf, -math.inf]
    rng.shuffle(shuffled)
    assert summarize(shuffled) == baseline
    for scale, offset in [(1, 17.25), (4, 0), (2, -5.5)]:
        transformed = summarize([scale * value + offset for value in values])
        assert transformed["validCount"] == len(values)
        for key in ["q25Db", "medianDb", "q75Db"]:
            assert transformed[key] == scale * baseline[key] + offset


def test_hand_authored_reference_independently_anchors_every_calculation():
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    validate_dataset(golden["dataset"])
    oracle = verify_golden()
    before, _, after = golden["dataset"]["acquisitions"]
    assert summarize(before["valuesDb"]) == {
        "medianDb": -10,
        "q25Db": -12,
        "q75Db": -8,
        "validCount": 5,
    }
    assert summarize(after["valuesDb"]) == {
        "medianDb": -7,
        "q25Db": -11,
        "q75Db": -4.5,
        "validCount": 6,
    }
    assert oracle["pairs"][0]["valuesDb"] == [-6, -2, 0, 2, 6, None, None]
    assert oracle["pairs"][0]["binCounts"] == [1, 1, 1, 2]


@pytest.mark.parametrize("field", ["medianDb", "q25Db", "q75Db"])
@pytest.mark.parametrize("offset", [-5e-10, 5e-10])
def test_contract_accepts_db_summaries_within_absolute_tolerance(field, offset):
    dataset = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["dataset"]
    summary = dataset["acquisitions"][2]["summary"]
    summary[field] += offset
    prepared = summary[field]
    validate_dataset(dataset)
    assert summary[field] == prepared


@pytest.mark.parametrize("field", ["medianDb", "q25Db", "q75Db"])
@pytest.mark.parametrize("offset", [-2e-9, 2e-9])
def test_contract_rejects_db_summaries_outside_absolute_tolerance(field, offset):
    dataset = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["dataset"]
    dataset["acquisitions"][2]["summary"][field] += offset
    with pytest.raises(ValueError, match="summary must match"):
        validate_dataset(dataset)


def test_contract_valid_pixel_count_requires_exact_integer_equality():
    dataset = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["dataset"]
    dataset["acquisitions"][2]["summary"]["validCount"] += 1
    with pytest.raises(ValueError, match="summary must match"):
        validate_dataset(dataset)


def test_checked_in_pair_bin_ledger_matches_fresh_independent_oracle_and_source_bytes():
    source = FIXTURE_PATH.read_bytes()
    sha256 = hashlib.sha256(source).hexdigest()
    ledger_path = REPO_ROOT / "contracts" / "testing" / "preview-pair-bins.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    fresh = build_oracle(json.loads(source), sha256)
    expected_pairs = [
        {key: pair[key] for key in ("beforeId", "afterId", "validCount", "binCounts")}
        for pair in fresh["pairs"]
    ]
    assert len(expected_pairs) == 28
    assert ledger == {"fixtureSha256": sha256, "pairs": expected_pairs}


def test_generated_package_has_independently_verified_summary_mask_and_provenance():
    fixture_bytes = FIXTURE_PATH.read_bytes()
    source = json.loads(fixture_bytes)
    generated = generate_dataset()
    assert generated == source
    assert generated["units"] == "gamma0_db"
    assert generated["polarization"] == "HH"
    assert generated["provenance"]["kind"] == "synthetic"
    assert generated["provenance"]["seed"] == 20261026
    assert generated["provenance"]["productIds"] == []
    assert "not represent Louisiana measurements" in generated["provenance"]["description"]
    grid = generated["grid"]
    assert (grid["width"], grid["height"], grid["order"], grid["coordinateSystem"]) == (
        20,
        20,
        "row-major",
        "synthetic",
    )
    assert len(grid["roiMask"]) == 400
    assert 0 < sum(grid["roiMask"]) < 400
    assert [slot["day"] for slot in generated["acquisitions"]] == [
        1,
        13,
        25,
        37,
        49,
        61,
        73,
        85,
        97,
    ]
    for slot in generated["acquisitions"]:
        if slot["availability"] == "missing":
            assert slot["day"] == 37
            assert slot["valuesDb"] is slot["summary"] is None
            continue
        values = slot["valuesDb"]
        assert len(values) == 400
        assert any(value is None for value, roi in zip(values, grid["roiMask"], strict=True) if roi)
        for value, in_roi in zip(values, grid["roiMask"], strict=True):
            if value is not None:
                assert in_roi
                assert math.isfinite(value)
                assert round(value, 6) == value
        assert slot["summary"] == pytest.approx(reference_summary(values), rel=0, abs=1e-12)
    oracle = build_oracle(source, hashlib.sha256(fixture_bytes).hexdigest())
    assert len(oracle["pairs"]) == 28
    assert oracle["acquisitions"]["preview-day-37"] is None
    for pair in oracle["pairs"]:
        assert pair["beforeDay"] < pair["afterDay"]
        assert sum(pair["binCounts"]) == pair["validCount"]
        assert pair["validCount"] == sum(value is not None for value in pair["valuesDb"])
    assert FIXTURE_PATH.read_bytes() == fixture_bytes


def test_generated_field_runs_raw_power_through_conversion_before_summary(monkeypatch):
    raw_powers = []

    def capture_power(power):
        raw_powers.append(power)
        return power_to_db(power)

    monkeypatch.setattr("nisar_preview.data.power_to_db", capture_power)
    generated = generate_dataset()
    emitted = [
        value
        for acquisition in generated["acquisitions"]
        if acquisition["availability"] == "available"
        for value in acquisition["valuesDb"]
    ]
    assert len(raw_powers) == len(emitted) == 8 * 400
    assert any(power is None for power in raw_powers)
    assert any(power == 0 for power in raw_powers)
    assert any(power is not None and power < 0 for power in raw_powers)
    for power, prepared in zip(raw_powers, emitted, strict=True):
        expected = None if power is None or power <= 0 else round(decimal_db(power), 6)
        assert prepared == expected
    for acquisition in generated["acquisitions"]:
        if acquisition["availability"] == "available":
            assert acquisition["summary"] == pytest.approx(
                reference_summary(acquisition["valuesDb"]), rel=0, abs=1e-12
            )


def test_exact_reference_keeps_zero_masks_and_final_histogram_edge_distinct():
    differences = reference_pair([-3, -4, None, 20], [-3, 2, 5, -20], [True, True, True, False])
    assert differences == [0, 6, None, None]
    assert reference_bins(differences, [-6, -2, 0, 2, 6]) == [0, 0, 1, 1]
    # Use exact rational values to anchor interpolation independently of binary rounding.
    assert Fraction(reference_summary([-12, -10, -8, -6, -12])["q25Db"]) == -12
