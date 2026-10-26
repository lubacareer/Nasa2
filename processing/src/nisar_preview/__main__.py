"""Run with uv run --project processing python -m nisar_preview."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from jsonschema import ValidationError

from .data import FIXTURE_PATH, generate_dataset, serialize_dataset, validate_dataset


def main() -> int:
    """Run fixture generation or validation and return a process exit status.

    ``generate`` writes the prepared synthetic package; ``generate --check``
    compares it with the existing package without changing files. ``validate``
    checks the shared schema and scientific relationships for a supplied path,
    defaulting to the repository fixture. Dataset and file errors return 1;
    successful operations return 0. Argument errors follow argparse's exit rules.
    """
    parser = argparse.ArgumentParser(
        description="Prepare or validate the synthetic preview dataset"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate", help="Regenerate the deterministic preview fixture")
    generate.add_argument("--check", action="store_true", help="Check without writing any files")
    generate.add_argument("--output", type=Path, default=FIXTURE_PATH)
    validate = commands.add_parser("validate", help="Validate a prepared dataset")
    validate.add_argument("path", nargs="?", type=Path, default=FIXTURE_PATH)
    args = parser.parse_args()
    try:
        if args.command == "generate":
            text = serialize_dataset(generate_dataset())
            if args.check:
                if not args.output.exists() or args.output.read_text(encoding="utf-8") != text:
                    print(
                        f"Synthetic fixture is missing or out of date: {args.output}",
                        file=sys.stderr,
                    )
                    return 1
                print(f"Synthetic fixture is reproducible: {args.output}")
            else:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(text, encoding="utf-8", newline="\n")
                print(f"Wrote synthetic preview (no satellite measurements): {args.output}")
        else:
            validate_dataset(json.loads(args.path.read_text(encoding="utf-8")))
            print(f"Valid synthetic dataset: {args.path}")
    except (OSError, ValueError, ValidationError) as error:
        print(f"Dataset error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
