# Architecture Overview

## Runtime

- Static pages and assets are served by `server.js` from `public/`.
- `server.js` routes weather API requests to `api/weather-proxy.js`.
- `api/nrel-proxy.js` is kept as a thin compatibility wrapper for the NREL CSV proxy handler.
- `server.js` routes rates API requests to `api/rates-proxy.js`, which orchestrates provider resolution, LMP/tariff adapters, health summaries, and v2 contract validation metadata.
- API endpoints exposed by `server.js`:
  - `/api/weather-proxy`
  - `/api/nrel-proxy`
  - `/api/rates/provider`
  - `/api/rates/timeseries`
  - `/api/v2/rates/timeseries`
  - `/api/rates/health`
  - `/api/rates/refresh`
  - `/api/runtime-config`
  - `/api/diagnostics`

## Route Map

- `/` -> project landing/list page
- `/projects/location.html` -> location + weather chart page
- `/projects/generation.html` -> generation asset modeling page
- `/projects/storage.html` -> storage modeling page
- `/projects/rates.html` -> electricity rates page

## Frontend Module Boundaries

- `public/assets/js/core/`
  - Shared modules used across pages
  - Includes charting, Supabase client/config, shared cache, models, utility logic
- `public/assets/js/features/`
  - Domain-specific computation helpers
  - Includes generation computations used by multiple pages
- `public/assets/js/pages/`
  - Page entry points and UI orchestration

## Rates Module Boundaries (Phase 3)

- `api/rates/provider-resolver.js`
  - Infers utility/ISO region/timezone from project coordinates
- `api/rates/lmp-adapters.js`
  - Attempts live LMP retrieval by ISO adapter (CAISO OASIS + ERCOT Public API)
  - Non-implemented ISOs (PJM/MISO/NYISO/ISO-NE/SPP) are marked not live-capable and use modeled fallback
- `api/rates/tariff-adapters.js`
  - Tariff schedule adapter for hourly export-rate series
- `api/rates/health.js`
  - Produces per-region + per-market-mode availability summaries used in debug table
- `api/rates/series-utils.js`
  - Shared timestamp/range/missing-interval helpers
- Supabase tables:
  - `rate_series_cache` (v2 provenance columns)
  - `rate_region_health` (market-mode keyed status rows)
  - `rate_ingest_runs` (ingest observability events)

## Data/Recompute Invalidation

- Shared cache module: `public/assets/js/core/shared-cache.js`
- Revision keys track invalidation domains:
  - `weatherRevision`
  - `assetsRevision`
  - `storageRevision`
- Derived chart series are reused when revisions match.
- Asset edits use debounced recompute (200ms) on generation/storage pages.

