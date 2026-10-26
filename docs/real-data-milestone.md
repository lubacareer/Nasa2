# Next milestone: real Louisiana GCOV observations

Replace the synthetic preview with a small reproducible study package prepared offline from real NISAR GCOV. An on-demand backend is unnecessary for this milestone.

1. Choose a small Louisiana wetland ROI after inspecting raster coverage. ASF metadata hits identify candidates; they do not validate a usable scene or flood event.
2. Select compatible L-band GCOV observations: polarization, frequency, maturity, orbit direction, track/frame, grid, and processing provenance. Inspect calibrated PROVISIONAL data and documented known issues; do not casually mix BETA and PROVISIONAL products.
3. Use documented ASF/Earthdata access. Keep Earthdata Login credentials outside the browser and Git. Evaluate GDAL windowing or available Harmony extraction before full-scene downloads; do not depend on roadmap-only features.
4. Align ROI grids, interpret masks, and record the normalization convention. Prepare decibel arrays and per-acquisition summaries in Python.
5. Extend the contract for real provenance and georeferenced rasters: timestamps, source IDs/links, maturity/calibration, processing version, polarization/frequency, orbit, CRS, transform, masks, ROI, and method version. Never relabel synthetic data as real.
6. Load the package into linked plots and a geospatial raster viewer. Check values independently against source layers before publishing observations.

Present measured radar changes and valid coverage first. An inundation estimate needs a separately documented method and external validation. A short mission record cannot establish long-term wetland loss. Additional regions, classification, hosting, jobs, and exports follow after real-data validation.

Primary documentation: [availability](https://nisar-docs.asf.alaska.edu/availability-overview/), [access](https://nisar-docs.asf.alaska.edu/access-overview/), [GCOV](https://nisar-docs.asf.alaska.edu/gcov/), [ASF Search](https://nisar-docs.asf.alaska.edu/asf-search/), [Harmony](https://nisar-docs.asf.alaska.edu/harmony/), [roadmap](https://nisar-docs.asf.alaska.edu/roadmap/), [known issues](https://nisar-docs.asf.alaska.edu/provisional-known-issues/).
