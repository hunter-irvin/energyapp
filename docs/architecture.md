# Architecture Overview

## Runtime

- Static pages and assets are served by `server.js` from `public/`.
- Weather API requests route through `api/weather-proxy.js` (with `api/nrel-proxy.js` compatibility wrapper).
- Rates API requests route through `api/rates-proxy.js` and `api/v2/rates/timeseries.js`.
- Runtime config and diagnostics are exposed by `api/runtime-config.js` and `api/diagnostics.js`.

## Route Map

- `/` -> project landing/list page
- `/projects/location.html` -> location + weather chart
- `/projects/generation.html` -> generation asset modeling + chart
- `/projects/storage.html` -> storage asset modeling + chart
- `/projects/rates.html` -> rates chart + source health

## Frontend Module Boundaries

- `public/assets/js/core/`
  - Supabase client/config, shared cache, data/model utilities, legacy chart helpers
- `public/assets/js/features/`
  - Domain compute helpers (`generation.js`)
- `public/assets/js/components/`
  - React bridge components
  - `project-shell.js`: shared project header + sidebar shell
  - `chart-ui.js`: time window controls, legend toggles, asset editor cards
  - `time-series-chart.js`: reusable Chart.js React wrapper
- `public/assets/js/pages/`
  - Page orchestration, data fetching, persistence wiring

## React Migration Status

Current UI architecture is "React islands" within static pages:

- Shared shell (`ProjectHeader`, sidebar nav) mounts from `project-shell.js`.
- Chart control strip + legend toggles mount from `chart-ui.js` on all project pages.
- Chart canvas rendering is standardized through `time-series-chart.js` on all project pages.
- Generation and Storage asset editors are React-rendered via `createAssetEditorsBridge`.

Legacy HTML templates for generation/storage asset cards are removed; those cards are now fully component-driven.

## Chart/Interval Behavior

- Period and interval controls are separated on all chart pages.
- Interval controls are right-aligned in the strip.
- Allowed intervals are period-aware:
  - `day`: sub-daily only (`half_hour`/`hourly`, and rates may include `five_min` when available)
  - `week`: `half_hour`/`hourly`/`daily`
  - `month`: `hourly`/`daily`
  - `year`: `daily`
- Rates intervals are cadence-aware and only expose resolutions supported by the source payload.

## Caching and Recompute Invalidation

- Shared client cache: `public/assets/js/core/shared-cache.js`
- Revision keys are used to invalidate derived chart series:
  - `weatherRevision`
  - `assetsRevision`
  - `storageRevision`
  - generation schema version key for derived-series migrations
- Asset edits trigger debounced recompute (200ms) on generation/storage.

## Rates Backend Boundaries

- `lib/rates/provider-resolver.js`: utility/ISO/timezone inference
- `lib/rates/lmp-adapters.js`: live LMP retrieval + modeled fallback
- `lib/rates/tariff-adapters.js`: tariff-series adapters
- `lib/rates/series-utils.js`: range normalization, interval fill, aggregation
- `lib/rates/health-utils.js`: coverage and status summaries

Supabase tables used by rates flow:

- `rate_series_cache`
- `rate_region_health`
- `rate_ingest_runs`

## API Endpoints

- `/api/weather-proxy`
- `/api/nrel-proxy`
- `/api/rates/provider`
- `/api/rates/timeseries`
- `/api/v2/rates/timeseries`
- `/api/rates/health`
- `/api/rates/refresh`
- `/api/runtime-config`
- `/api/diagnostics`
