"""Small numerical examples check the scientific handoff independently of its plots."""

import copy
import math

import pytest
from jsonschema import ValidationError

from nisar_preview.data import (
    DAYS,
    FIXTURE_PATH,
    generate_dataset,
    power_to_db,
    serialize_dataset,
    summarize,
    validate_dataset,
)


@pytest.mark.parametrize("power, expected", [(1, 0), (0.1, -10), (10, 10), (100, 20)])
def test_known_power_conversion(power, expected):
    assert power_to_db(power) == pytest.approx(expected)


@pytest.mark.parametrize("power", [None, 0, -1, math.nan, math.inf, -math.inf, True])
def test_invalid_power_is_masked(power):
    assert power_to_db(power) is None


def test_spatial_quantiles_use_linear_interpolation():
    assert summarize([None, 30, 0, 20, 10]) == {
        "medianDb": 15,
        "q25Db": 7.5,
        "q75Db": 22.5,
        "validCount": 4,
    }
    assert summarize([None, -12]) == {
        "medianDb": -12,
        "q25Db": -12,
        "q75Db": -12,
        "validCount": 1,
    }
    assert summarize([None, math.nan]) is None


def test_fixture_is_deterministic_and_matches_checked_in_package():
    generated = serialize_dataset(generate_dataset())
    assert generated == serialize_dataset(generate_dataset())
    assert generated == FIXTURE_PATH.read_text(encoding="utf-8")


def test_fixture_has_fixed_footprint_real_gaps_and_bounded_pair_differences():
    dataset = generate_dataset()
    assert dataset["provenance"]["productIds"] == []
    assert dataset["grid"]["coordinateSystem"] == "synthetic"
    assert dataset["grid"]["width"] == dataset["grid"]["height"] == 20
    assert [slot["day"] for slot in dataset["acquisitions"]] == list(DAYS)
    missing = [slot for slot in dataset["acquisitions"] if slot["availability"] == "missing"]
    assert len(missing) == 1
    assert missing[0]["day"] == 37
    assert missing[0]["valuesDb"] is missing[0]["summary"] is None
    available = [slot for slot in dataset["acquisitions"] if slot["availability"] == "available"]
    assert len(available) == 8
    for before in available:
        for after in available:
            for first, second in zip(before["valuesDb"], after["valuesDb"], strict=True):
                if first is not None and second is not None:
                    assert -6 <= second - first <= 6


@pytest.mark.parametrize(
    "mutation",
    ["version", "missing", "length", "summary", "roi", "order", "edges", "nan", "available"],
)
def test_malformed_packages_are_rejected(mutation):
    dataset = copy.deepcopy(generate_dataset())
    acquisition = dataset["acquisitions"][0]
    if mutation == "version":
        dataset["schemaVersion"] = 2
    elif mutation == "missing":
        dataset["acquisitions"][3]["valuesDb"] = [1]
    elif mutation == "length":
        acquisition["valuesDb"].pop()
    elif mutation == "summary":
        acquisition["summary"]["validCount"] += 1
    elif mutation == "roi":
        dataset["grid"]["roiMask"] = []
    elif mutation == "order":
        dataset["acquisitions"][1]["day"] = acquisition["day"]
    elif mutation == "edges":
        dataset["histogramEdgesDb"][2] = -7
    elif mutation == "nan":
        acquisition["valuesDb"][100] = math.nan
    elif mutation == "available":
        for slot in dataset["acquisitions"]:
            slot["availability"] = "missing"
            slot["valuesDb"] = slot["summary"] = None
    with pytest.raises((ValueError, ValidationError)):
        validate_dataset(dataset)
