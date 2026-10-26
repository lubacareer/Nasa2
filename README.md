# NISAR Surface Change

A plot-focused foundation for exploring wetlands and surface change with NASA–ISRO NISAR radar observations. The first target study area is the Louisiana wetlands.

**Synthetic preview — no satellite measurements.** This milestone uses a deterministic schematic dataset. It does not show measured Louisiana conditions, identify a flood, or estimate flooded area.

## Run locally

Install Node.js 22, Python 3.14, and [uv](https://docs.astral.sh/uv/getting-started/installation/). Run these commands from the repository root in PowerShell or another shell:

```powershell
npm ci
npm run dev
```

Open <http://127.0.0.1:5180>. The frontend serves its committed preview fixture locally; no Earthdata account, API key, hosted backend, or paid service is required.

To install the Python environment and verify the fixture:

```powershell
uv sync --project processing --frozen
uv run --project processing python -m nisar_preview validate
uv run --project processing python -m nisar_preview generate --check
```

To regenerate the preview after an intentional generator change:

```powershell
uv run --project processing python -m nisar_preview generate
```

## Explore the preview

- Compare two available acquisitions with the Before and After selectors. The initial pair is synthetic day 25 and day 61.
- Inspect the linked time series, acquisition coverage, signed change histogram, and schematic spatial comparison.
- Switch the spatial view between Before, After, and Change. The URL preserves selections through refresh and browser navigation.
- Open Methods and Data table for calculation details, source labels, and values available without hovering.

The time-series band is a **spatial interquartile range**, not a confidence interval. Missing acquisition day 37 remains a gap. Blue and orange encode decreased and increased radar backscatter; they do not classify water.

## Project structure

| Area | Responsibility |
| --- | --- |
| `web/` | React, TypeScript, Vite, and modular ECharts SVG views; paired-date analysis and URL state |
| `processing/` | Python fixture generation, masking, power-to-decibel conversion, summaries, and validation |
| `contracts/` | Versioned JSON data-package schema and corresponding TypeScript interfaces |
| `docs/` | Scientific methods and the real-data milestone |

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
uv run --project processing ruff check processing
uv run --project processing pytest processing/tests
uv run --project processing python -m nisar_preview generate --check
npm exec --workspace web -- playwright install chromium
npm run test:e2e
```

Chromium smoke tests cover linked selections, URL history, reset, loading and error states, no overlapping data, keyboard controls, and desktop/mobile layouts. GitHub Actions runs frontend and Python checks independently on PR updates and pushes to `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md), [methods](docs/methods.md), and the [real-data milestone](docs/real-data-milestone.md).

## NISAR context

GCOV contains geocoded, terrain-normalized radar backscatter, which responds to moisture, roughness, vegetation, geometry, and other factors. A backscatter difference alone does not establish flooding. Real ingestion, geospatial rasters, classification, downloads, hosting, and figure exports are deferred. Consult the [ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/) and [ASF access guide](https://nisar-docs.asf.alaska.edu/access-overview/).

This independent project is not an official NASA or ISRO application.
