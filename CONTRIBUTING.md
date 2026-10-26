# Contributing

Use Node.js 22, Python 3.14, npm, and uv. The README contains setup and validation commands. Work on a feature branch and open a PR against `main`.

## Frontend changes

Separate app composition from loading, URL state, analysis selectors, and chart rendering. Chart libraries render prepared values; they must not independently recompute scientific summaries or histograms. Use the shared pair result for linked views.

Verify date selection, reset, browser history, null-data behavior, keyboard access, and synthetic labeling. Inspect desktop and 390-pixel layouts for clipped axes, illegible labels, and overflow. Never describe the schematic grid as georeferenced Louisiana measurements.

## Scientific changes

The versioned handoff is `contracts/study-dataset.schema.json`; `contracts/dataset.ts` describes the same shape. Update both with validation and tests when changing the format.

Python computes prepared values and per-acquisition summaries. TypeScript computes paired valid-pixel differences and bins them using fixed package edges. Test numerical edge cases rather than only chart configuration.

After a deliberate generator change, regenerate the committed fixture and inspect provenance, masks, gaps, summaries, and pairwise range. `generate --check` must pass before opening a PR.

## Automated review

Actions runs frontend validation, Chromium smoke tests, and Python checks. Baz Reviewer and CodeRabbit review ready PRs; push fixes to the same branch.

If a review does not start, use `@coderabbitai review` or `Baz review`. CodeRabbit currently requires a manual trigger for public repositories with fewer than 10 stars; availability also depends on app access and plan. Verify actual bot output on the current head commit. See [CodeRabbit limits](https://docs.coderabbit.ai/management/plans) and [Baz configuration](https://baz.ai/docs/account/configurations).

Evaluate feedback before applying it, rerun affected checks, and leave the foundation PR open and unmerged.
