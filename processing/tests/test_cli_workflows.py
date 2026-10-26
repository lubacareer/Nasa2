"""Exercise actual CLI processes, preserving the committed preview throughout."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from build_calculation_oracle import GOLDEN_PATH, REPO_ROOT, reference_summary

from nisar_preview.data import FIXTURE_PATH


def run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "nisar_preview", *arguments],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


@pytest.fixture(autouse=True)
def preserve_committed_preview():
    before = FIXTURE_PATH.read_bytes()
    modified = FIXTURE_PATH.stat().st_mtime_ns
    yield
    assert FIXTURE_PATH.read_bytes() == before, "CLI test changed the committed preview"
    assert FIXTURE_PATH.stat().st_mtime_ns == modified, "CLI test rewrote the committed preview"


def test_generate_validate_and_check_real_subprocesses(tmp_path):
    output = tmp_path / "directory with spaces" / "nested" / "prepared.json"
    generated = run_cli("generate", "--output", str(output))
    assert generated.returncode == 0, generated.stderr
    assert "no satellite measurements" in generated.stdout
    package = json.loads(output.read_text(encoding="utf-8"))
    assert package["provenance"]["kind"] == "synthetic"
    assert package["provenance"]["productIds"] == []
    for acquisition in package["acquisitions"]:
        if acquisition["valuesDb"] is not None:
            assert acquisition["summary"] == pytest.approx(
                reference_summary(acquisition["valuesDb"]), rel=0, abs=1e-12
            )
    assert b"\r\n" not in output.read_bytes()
    validated = run_cli("validate", str(output))
    assert validated.returncode == 0, validated.stderr
    assert "Valid synthetic dataset" in validated.stdout
    before = output.read_bytes(), output.stat().st_mtime_ns
    checked = run_cli("generate", "--check", "--output", str(output))
    assert checked.returncode == 0, checked.stderr
    assert "reproducible" in checked.stdout
    assert (output.read_bytes(), output.stat().st_mtime_ns) == before


@pytest.mark.parametrize("operation", ["validate", "check"])
def test_read_only_cli_defaults_succeed(operation):
    result = run_cli("validate") if operation == "validate" else run_cli("generate", "--check")
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""


@pytest.mark.parametrize("content", [None, "stale bytes\n", "{malformed", '{"schemaVersion":2}'])
def test_check_never_creates_or_changes_missing_stale_or_malformed_output(tmp_path, content):
    output = tmp_path / "must stay absent" / "preview.json"
    if content is not None:
        output.parent.mkdir()
        output.write_text(content, encoding="utf-8")
    before = (output.read_bytes(), output.stat().st_mtime_ns) if output.exists() else None
    result = run_cli("generate", "--check", "--output", str(output))
    assert result.returncode == 1
    assert "missing or out of date" in result.stderr
    assert result.stdout == ""
    if before is None:
        assert not output.parent.exists()
    else:
        assert (output.read_bytes(), output.stat().st_mtime_ns) == before


@pytest.mark.parametrize(
    "content",
    [None, "", "{invalid JSON", "null", "[]", '{"schemaVersion":999}', '{"schemaVersion":1}'],
)
def test_validate_reports_file_json_schema_and_version_errors_without_traceback(tmp_path, content):
    path = tmp_path / "invalid input.json"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    before = path.read_bytes() if path.exists() else None
    result = run_cli("validate", str(path))
    assert result.returncode == 1
    assert "Dataset error:" in result.stderr
    assert "Traceback" not in result.stderr
    assert result.stdout == ""
    assert (path.read_bytes() if path.exists() else None) == before


@pytest.mark.parametrize("mutation", ["summary", "outside_roi", "chronology", "bin_range"])
def test_validate_rejects_scientifically_inconsistent_packages(tmp_path, mutation):
    dataset = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["dataset"]
    if mutation == "summary":
        dataset["acquisitions"][0]["summary"]["q25Db"] += 1
    elif mutation == "outside_roi":
        dataset["acquisitions"][0]["valuesDb"][-1] = 0
    elif mutation == "chronology":
        dataset["acquisitions"][-1]["day"] = 1
    elif mutation == "bin_range":
        dataset["histogramEdgesDb"] = [-2, 0, 2]
    path = tmp_path / f"{mutation}.json"
    path.write_text(json.dumps(dataset), encoding="utf-8")
    result = run_cli("validate", str(path))
    assert result.returncode == 1
    assert "Dataset error:" in result.stderr
    assert "Traceback" not in result.stderr


def test_generate_reports_filesystem_failure_cleanly(tmp_path):
    blocker = tmp_path / "file instead of parent"
    blocker.write_text("must stay unchanged", encoding="utf-8")
    result = run_cli("generate", "--output", str(blocker / "preview.json"))
    assert result.returncode == 1
    assert "Dataset error:" in result.stderr
    assert "Traceback" not in result.stderr
    assert blocker.read_text(encoding="utf-8") == "must stay unchanged"


@pytest.mark.parametrize(
    "arguments", [[], ["unknown"], ["generate", "--unknown"], ["validate", "a", "b"]]
)
def test_argument_errors_use_argparse_exit_code(arguments):
    result = run_cli(*arguments)
    assert result.returncode == 2
    assert "usage:" in result.stderr
    assert "Traceback" not in result.stderr


def test_reference_oracle_subprocess_writes_all_pairs_and_source_fingerprint(tmp_path):
    output = tmp_path / "oracle output" / "calculation-oracle.json"
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("build_calculation_oracle.py")),
            "--output",
            str(output),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    oracle = json.loads(output.read_text(encoding="utf-8"))
    assert oracle["schemaVersion"] == 1
    assert oracle["fixtureSha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
    assert len(oracle["acquisitions"]) == 9
    assert len(oracle["pairs"]) == 28
    assert oracle["acquisitions"]["preview-day-37"] is None
    assert all(sum(pair["binCounts"]) == pair["validCount"] for pair in oracle["pairs"])


@pytest.mark.parametrize("source_path", [FIXTURE_PATH, GOLDEN_PATH])
def test_reference_oracle_refuses_to_overwrite_source_fixtures(source_path):
    before = source_path.read_bytes(), source_path.stat().st_mtime_ns
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("build_calculation_oracle.py")),
            "--output",
            str(source_path),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 2
    assert "must not overwrite a source fixture" in result.stderr
    assert (source_path.read_bytes(), source_path.stat().st_mtime_ns) == before
