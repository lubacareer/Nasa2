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

Before running `npm ci` again, stop this project's development server with **Ctrl+C** in its terminal. On Windows, a running Vite process can lock the native Rolldown binding and interrupt dependency installation with `EPERM`. After stopping it, rerun `npm ci`, then `npm run dev`.

## Desktop app

The same workbench can run in a standalone Electron window. In development, run:

```powershell
npm run desktop:dev
```

Build the native package for the current operating system with:

```powershell
npm run desktop:make
```

Installers are written under `out/desktop/make`. PR builds are unsigned, so Windows and macOS may show their standard unverified-app warnings. The packaged window serves its bundled files from loopback only; it does not need a network connection to load the preview. Source links open in the system browser.

## Docker remote desktop

GitHub Actions can publish the Linux image to the public [`lubani27/nisar-surface-change`](https://hub.docker.com/r/lubani27/nisar-surface-change) repository. A `pr-<number>` tag is available after the manual publish workflow below completes successfully; commit tags use `sha-<commit>`. The container runs the Linux Electron desktop under a virtual display and provides a noVNC page for viewing it.

After the publish workflow succeeds for PR 3, run these commands from the repository root with a private, exactly eight-character VNC password (the VNC protocol ignores characters after the eighth), and keep the published port bound to the local machine:

```powershell
$env:VNC_PASSWORD = Read-Host 'Enter a private 8-character VNC password'
try {
    $seccompProfile = (Resolve-Path -LiteralPath .\docker\seccomp-profile.json -ErrorAction Stop).Path
    docker run --rm --security-opt "seccomp=$seccompProfile" -e VNC_PASSWORD -p 127.0.0.1:6080:6080 lubani27/nisar-surface-change:pr-3
} finally {
    Remove-Item Env:VNC_PASSWORD -ErrorAction SilentlyContinue
}
```

Replace `3` with the PR number for a different published image. Then open <http://127.0.0.1:6080/vnc.html>, select **Connect**, and enter the VNC password. The VNC server itself only listens inside the container; port 6080 carries the browser display connection.

The container runs as a non-root user. Its custom seccomp profile is based on the current [Moby seccomp profile](https://github.com/moby/profiles/tree/seccomp/v0.2.4/seccomp) and omits the legacy 32-bit `socketcall` syscall from the base allowlist. It permits only Chromium's `CLONE_NEWUSER` probe, `CLONE_NEWPID` renderer-child isolation, and `CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNET` renderer sandbox combination; other namespace flags remain blocked. Docker documents how a custom profile is applied with [`--security-opt seccomp=<path>`](https://docs.docker.com/engine/security/seccomp/).

The Dockerfile pins the multi-platform Node and Debian image digests and the Debian package snapshot. The runtime image bootstraps certificates over HTTP using Debian's signed snapshot metadata, then uses HTTPS for the remaining packages. To pick up security updates, inspect the current multi-platform base-image digests, choose a newer signed [Debian snapshot](https://snapshot.debian.org/), update both digests and all snapshot timestamps in the Dockerfile, and build and smoke-test both `linux/amd64` and `linux/arm64` before publishing. Snapshot metadata expiry is deliberately disabled for this fixed historical snapshot; package signature verification remains enabled.

To enable publishing from GitHub Actions:

1. In Docker Hub, create an access token with **Read & Write** permission.
2. In this GitHub repository, open **Settings → Environments → dockerhub-publish → Environment secrets**. Add the token as `DOCKERHUB_TOKEN` there; do not add it as a repository secret.
3. Before running the workflow, verify that the environment requires `lubacareer` to review deployments, permits self-review, disallows administrator bypass, and allows only the `feat/electron-desktop-docker` branch. Referencing a missing environment in a workflow does not create these protections.
4. Open **Actions → Full calculation verification → Run workflow**. Select `feat/electron-desktop-docker`, set `publish_image` to `true`, and enter the PR number. After the calculation suite and native amd64 and arm64 image smoke tests pass, review the commit, workflow, Dockerfile, and image IDs in the job summaries, then approve the `dockerhub-publish` deployment.

The approved job publishes the tested images under `pr-<number>` and `sha-<commit>` tags to [`lubani27/nisar-surface-change`](https://hub.docker.com/r/lubani27/nisar-surface-change). It also creates public `staging-<run>-<attempt>-*` tags during promotion; these may remain after the run. The PR is rechecked before staging and immediately before its tag is updated. A PR update and a registry tag update cannot be atomic across GitHub and Docker Hub, so use the reported image digest when an exact image reference is needed.

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

The time-series band is a **spatial interquartile range**, not a confidence interval. Missing acquisition day 37 remains a gap. Blue shows backscatter decreases; orange shows increases or zero change. These colors do not classify water.

## Project structure

| Area | Responsibility |
| --- | --- |
| `web/` | React, TypeScript, Vite, and modular ECharts SVG views; paired-date analysis and URL state |
| `processing/` | Python fixture generation, masking, power-to-decibel conversion, summaries, and validation |
| `contracts/` | Versioned JSON data-package schema and corresponding TypeScript interfaces |
| `docs/` | Scientific methods and the real-data milestone |
| `electron/` and `docker/` | Isolated Electron desktop shell and password-protected Linux remote-display container |

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm run test:validator
npm run build
uv run --project processing ruff check processing
uv run --project processing pytest processing/tests
uv run --project processing python -m nisar_preview generate --check
npm exec --workspace web -- playwright install chromium firefox webkit
npm run test:dev
npm run test:e2e
```

Browser tests verify numerical results across Chromium, Firefox, and WebKit, including linked selections, tables, masks, URL state, recovery, empty coverage, and desktop/narrow layouts. GitHub Actions runs these checks and the Python suite on PR updates and pushes to `main`.

Run `npm run desktop:dev:smoke` to verify the Electron development window. It starts its own server on port 5180, so stop any existing server on that port first.

See [CONTRIBUTING.md](CONTRIBUTING.md), [methods](docs/methods.md), and the [real-data milestone](docs/real-data-milestone.md).

## Calculation workflow tests

Run `npm run test:all` for independent numerical checks of the Python preparation pipeline, browser calculations, plot data, all 28 date pairs across Chromium/Firefox/WebKit, and three concurrent 10-minute stability sessions. The runner has a 50-minute deadline and prints its temporary results directory. Install all three browser binaries first; see the [calculation testing guide](docs/calculation-testing.md) for commands, coverage, and reference methods.

## NISAR context

GCOV contains geocoded, terrain-normalized radar backscatter, which responds to moisture, roughness, vegetation, geometry, and other factors. A backscatter difference alone does not establish flooding. Real ingestion, geospatial rasters, classification, downloads, hosting, and figure exports are deferred. Consult the [ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/) and [ASF access guide](https://nisar-docs.asf.alaska.edu/access-overview/).

This independent project is not an official NASA or ISRO application.
