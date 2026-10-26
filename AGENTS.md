# Repository guidance

## Purpose

Build a researcher-oriented NISAR wetlands workbench with truthful scientific plots. The current milestone is a local synthetic preview targeting a later Louisiana study; it is not a flood classification or a real-data analysis.

## Working conventions

- Preserve `Synthetic preview — no satellite measurements` and synthetic provenance in every preview view.
- Keep the UI light, plot-focused, responsive, keyboard accessible, and readable without hover. Use the existing design tokens and modular ECharts SVG rendering.
- Python owns power generation, nonpositive/nonfinite masking, `10 * log10(power)`, quartiles, median, and per-acquisition valid counts. TypeScript consumes prepared decibel arrays and owns paired-cell differences and histogram binning. Do not duplicate calculation ownership in charts.
- Update the JSON schema, TypeScript contract, Python validation, and contract tests together when changing the handoff. Reject unsupported versions visibly.
- Missing values are distinct from zero. Intersect both acquisitions' valid masks for differences; preserve genuine zero changes. Show missing acquisitions as gaps.
- Call the band a spatial interquartile range. Label signed changes as backscatter increase/decrease; never imply flood extent, damage, or confidence without a documented and validated method.
- Keep credentials, large source rasters, environments, screenshots, traces, and build outputs out of Git. No Earthdata credentials are needed for this milestone.
- Use npm with the root lockfile and uv with the processing lockfile. Keep commands usable in PowerShell and Linux CI.

## Validation

Run checks relevant to the change. Rendered UI changes require desktop and approximately 390-pixel browser checks plus lint, types, tests, and build. Scientific changes require known-value tests and fixture reproducibility. See CONTRIBUTING.md for commands.

Do not merge the foundation PR automatically. Treat bot suggestions as proposals: verify the issue, apply warranted changes, and rerun affected checks.
