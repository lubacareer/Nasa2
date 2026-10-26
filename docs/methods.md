# Preview methods and provenance

## What the package represents

This is deterministic synthetic data for UI and calculation testing. Louisiana wetlands is the future target; none of these pixels, days, or values are measurements from Louisiana or NISAR. No NISAR product IDs are attached.

The 20-column by 20-row grid uses row-major indexing: `row * width + column`. Coordinates are synthetic. The ROI mask stays fixed. Available synthetic days are 1, 13, 25, 49, 61, 73, 85, and 97; day 37 is explicitly missing. These are scenario days, not satellite timestamps.

## Calculation ownership

Python generates deterministic positive power, applies ROI and acquisition validity masks, and converts valid `P` to `10 * log10(P)` decibels. Missing, nonpositive, and nonfinite inputs become null. Genuine zero decibels remains valid.

Python supplies median, 25th percentile, 75th percentile, and valid-pixel count. Percentiles use linear interpolation between ordered samples (type 7). The shaded **spatial interquartile range** describes spatial spread within the fixed ROI. It is not accuracy, confidence, or a flood estimate.

TypeScript intersects the ROI and both acquisition masks, then computes `afterDb - beforeDb`. For positive powers this equals `10 * log10(P_after / P_before)`. A difference is null when either input is unavailable; genuine zero differences are included.

TypeScript bins differences once using fixed symmetric package edges. Each bin includes its lower edge and excludes its upper edge; the final bin also includes the final edge. Counts must sum to the paired valid-cell count. All views consume the same pair result.

## Visual encodings

| View | Encoding and limits |
| --- | --- |
| Time series | Median dB with spatial quartiles; gaps are not interpolated |
| Coverage | Valid count divided by fixed ROI size; availability, not accuracy |
| Histogram | Paired valid-cell counts by signed dB change; visible zero reference |
| Spatial view | Schematic grid; common before/after scale, symmetric change scale, visibly invalid cells |

Blue and orange mean decreased and increased backscatter, not more/less water, damage, or recovery. Calm water can reduce radar return while inundated vegetation and other conditions can increase it. Interpretation requires a documented method and independent evidence. Sources: [ASF GCOV](https://nisar-docs.asf.alaska.edu/gcov/), [ASF amplitude](https://nisar-docs.asf.alaska.edu/amplitude/), [NASA SAR overview](https://nisar.jpl.nasa.gov/mission/get-to-know-sar/overview/).

## Validation

Python and the frontend validate version 1 with structural and semantic checks, including dimensions, chronology, masks, finite values, and missing-observation state. Unsupported or malformed packages produce a visible error. No paired valid cells produces an empty state, not zero change.

An available acquisition can contain no valid cells: its grid is all `null`, its summary is `null`, and its coverage is 0%. This is distinct from a missing acquisition, which has no grid and uses a hollow coverage marker. Empty datasets retain finite spatial scales and explicit empty plots.

Python remains the producer of all acquisition summaries. The browser independently verifies their type 7 quartiles against the received valid cells within 1e-9 dB at the loading boundary, rejecting stale or edited summaries without replacing them. Histogram edges must include zero so one bin cannot mix backscatter decreases and increases under a single color.
