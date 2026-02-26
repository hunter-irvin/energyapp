# Architecture Overview

## Runtime

- Static pages and assets are served by `server.js` from `public/`.
- Weather proxy routes are handled by `api/weather-proxy.js` (`/api/weather-proxy`, `/api/nrel-proxy`).
- Rates provider/health metadata routes are handled by `api/rates-proxy.js` (`/api/rates/provider`, `/api/rates/health`).
- Canonical domain sync and series routes are handled by `api/v3-proxy.js` (`/api/v3/*`).
- Runtime config and diagnostics are exposed by `/api/runtime-config` and `/api/diagnostics`.

## Route Map

- `/` -> project landing/list page
- `/projects/location.html` -> location + weather chart
- `/projects/generation.html` -> generation asset modeling + chart
- `/projects/storage.html` -> storage asset modeling + chart
- `/projects/rates.html` -> rates chart + sync status + availability debug

## Frontend Module Boundaries

- `public/assets/js/core/`
  - Supabase client/config, shared cache, data/model utilities
- `public/assets/js/features/`
  - Domain compute helpers (`generation.js`)
- `public/assets/js/components/`
  - React bridge components
  - `project-shell.js`: shared project header + sidebar shell
  - `chart-ui.js`: time window controls + legend toggles
  - `time-series-chart.js`: reusable Chart.js React wrapper
- `public/assets/js/pages/`
  - Page orchestration and v3 API wiring

## UI Architecture

- Shared shell mounts from `project-shell.js`.
- Shared control strip and legend mounts from `chart-ui.js`.
- Shared chart rendering mounts from `time-series-chart.js`.
- Generation and Storage asset editors are React-rendered via `createAssetEditorsBridge`.
- Legacy HTML template asset card rendering is removed.

## Chart/Interval Behavior

- Period and interval controls are separate.
- Interval controls are right-aligned in the control strip.
- Allowed intervals by period:
  - `day`: sub-daily only (`half_hour`/`hourly`; rates can include `five_min` if source cadence supports it)
  - `week`: `half_hour`/`hourly`/`daily`
  - `month`: `hourly`/`daily`
  - `year`: `daily`
- Rates interval options are source-cadence aware.

## Rates Backend Boundaries

- `lib/rates/provider-resolver.js`: utility/ISO/timezone inference
- `lib/rates/lmp-adapters.js`: live LMP retrieval, unsupported/unavailable signaling (no modeled fallback)
- `lib/rates/tariff-adapters.js`: tariff series adapters
- `lib/rates/health-utils.js`: availability/status summaries
- `lib/rates/series-utils.js`: range/cadence normalization helpers

## Supabase Canonical Tables (v3)

- `weather_project_series`
- `generation_project_series`
- `rate_project_series`
- `domain_sync_state`
- `ingestion_jobs`
- `projects` fingerprint columns used for invalidation (`location_fingerprint`, `asset_fingerprint`, `rates_source_fingerprint`)

## API Endpoints (Current)

- `/api/weather-proxy`
- `/api/nrel-proxy`
- `/api/rates/provider`
- `/api/rates/health`
- `/api/v3/sync/:domain`
- `/api/v3/sync/:domain/status`
- `/api/v3/series/weather`
- `/api/v3/series/generation`
- `/api/v3/series/rates`
- `/api/v3/refresh`
- `/api/v3/cron/nightly-sync`
- `/api/v3/worker/run-once`
- `/api/runtime-config`
- `/api/diagnostics`

## Deprecated Endpoints

- `/api/rates/timeseries`
- `/api/v2/rates/timeseries`
- `/api/rates/refresh`

These are deprecated and not part of the active page flows.
