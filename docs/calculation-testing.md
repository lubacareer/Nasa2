# Calculation verification

The suite checks scientific calculation pipelines and the results displayed in the workbench. GitHub Actions is an execution environment for these checks.

## Independent references

`contracts/testing/calculation-golden.json` is a hand-verified seven-cell package. Its paired changes are `[-6, -2, 0, 2, 6, null, null]`, its valid-pair count is 5, and its histogram counts are `[1, 1, 1, 2]`. It includes one-sided missing values, an excluded ROI cell, an unavailable acquisition, and zero change.

`decimal_db` in `processing/tests/test_calculation_workflows.py` checks power-to-dB conversion using 50-digit Decimal logarithms. The test-only browser oracle works from the prepared dB arrays, uses exact Fraction interpolation and subtraction over the decoded floating-point inputs, and rounds the results to floats for JSON output. Histogram expectations use an independent fixed-edge `bisect_right` calculation on the rounded differences. The oracle imports no production calculation helpers. The generated oracle contains expected acquisition summaries and all 28 chronological pairs from the committed preview; browser expectations never call the application's analysis functions.

| Calculation pipeline | Checks | Test location |
| --- | --- | --- |
| Positive power to gamma-zero dB | Decimal reference, units, nonpositive/nonfinite masking, wide dynamic range, raw generated powers | `processing/tests/test_calculation_workflows.py` |
| Spatial median and type 7 quartiles | Exact rational results, empty/single/even/odd/tied samples, permutation/translation/scaling properties, finite-extreme interpolation | Python numerical tests and `web/src/calculation-workflows.test.ts` |
| Prepared-data contract | Independent summaries, masks, valid counts, units, chronology, provenance, range and zero-edge validation | Python numerical tests and frontend contract tests |
| Paired changes and histogram | After minus before, intersected masks, signed and exact-zero changes, boundary inclusion, count conservation | Frontend numerical tests and hand-verified reference |
| Plot calculations | Median/IQR series, reconstructed upper quartile, missing gaps, markers, bin centers/counts/colors, shared ranges, finite empty fallbacks | `web/src/components/Charts.test.tsx` using a mocked EChart adapter |
| Browser numerical integration | All 28 pairs, three spatial modes, exact cell masks/values, selected summaries/tables, coverage and scale limits | `web/e2e/calculations.spec.ts` across three engines and two widths |
| Sustained calculation integrity | Repeated reference comparisons through selection, modes, reload/history, reset and resize | `web/e2e/calculations.stability.spec.ts` |
| Preparation CLI | Subprocess exit codes, temporary output, invalid input, non-writing stale/missing checks | `processing/tests/test_cli_workflows.py` |

## Run

Install dependencies once, with the development server stopped before reinstalling npm packages:

```powershell
npm ci
uv sync --project processing --frozen
npm exec --workspace web -- playwright install chromium firefox webkit
```

Then choose a check:

```powershell
npm test
npm run test:e2e
npm run test:stability
npm run test:all
```

`npm test` runs frontend unit/chart checks. `test:e2e` builds the app, creates an independent numerical oracle, and runs the functional browser checks. `test:stability` builds and runs three concurrent 10-minute sessions. `test:all` additionally runs frontend lint/types, Python lint/calculation/CLI tests, fixture validation and reproducibility, then both browser phases.

The production preview uses strict port **5181**, is owned by Playwright, and is cleaned up after the run. It never reuses the development server on 5180. A busy test port or missing browser is a failure, not a skipped test.

The full command enforces a 50-minute execution deadline; its CI job allows 55 minutes for completion and artifact upload. Dependency installation and GitHub queue time are outside the measured test-command duration. Timing out, unexecuted phases, and retry-only browser passes do not count as successful verification.

Each sustained session requires 600,000 milliseconds of real elapsed time and at least one complete 28-pair cycle. `STABILITY_DURATION_MS` can shorten a standalone diagnostic, which is explicitly marked as nonacceptance in its report; `test:all` always forces the full duration.

## Results and PR usage

Artifacts go to a unique OS temporary directory, printed by the runner, or the directory named by `TEST_ARTIFACT_DIR`. `summary.json` records elapsed time, each phase's result, failures, unexecuted phases, and whether the preview stayed unchanged. Unit/Python/browser JSON or JUnit results provide exact counts. Functional failures retain traces and screenshots; sustained failures retain a screenshot and a bounded comparison history. Reports, screenshots and traces are not committed to Git.

Normal PR updates run numerical unit/CLI checks and the three-browser functional suite. Add the **full-suite** label to a PR to run the entire suite including stability; remove and reapply the label to repeat it after a new commit. Once the workflow is on `main`, its **Run workflow** action is also available. CI uses the official Playwright 1.64.1 Noble image, matched to the exact package version; update both together. Artifacts are retained for seven days.

For a valid final report, all required projects must pass with no silent skips, unexpected browser exceptions, or modified preview fixture. Narrow-view projects verify layout at 390 pixels; they do not replace testing on physical devices.
