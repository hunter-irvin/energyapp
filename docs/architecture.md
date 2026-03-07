# Architecture Overview

## Runtime

- Static pages/assets are served by `server.js` from `public/`.
- Vercel routing uses explicit route files under `api/`.
- Shared active API handlers:
  - `api/weather-proxy.js` (`/api/weather-proxy`, `/api/nrel-proxy`)
  - `api/location-proxy.js` (`/api/location/reverse`)
  - `api/v4/rates/provider.js` (`/api/v4/rates/provider`)
  - `api/v4/rates/series.js` (`/api/v4/rates/series`)
  - `api/runtime-config.js`, `api/diagnostics.js`
- Shared rates logic lives in `lib/rates/v4-rates-handlers.js` and is used by both `server.js` and the explicit Vercel route files.

## Route Map

- `/` -> project landing/list page
- `/projects/weather.html` -> weather + map + weather chart
- `/projects/generation.html` -> generation asset modeling + chart
- `/projects/storage.html` -> storage asset modeling + chart
- `/projects/rates-v4.html` -> rates v4 (Residential, DA, RT)

## Frontend Modules

- `public/assets/js/core/`
  - Supabase client/config, shared cache, data/model utilities
- `public/assets/js/features/`
  - Domain helpers (`generation.js`, `rates-v4-cache-engine.js`, `weather-coverage-engine.js`, `weather-sync-bus.js`)
- `public/assets/js/components/`
  - `project-shell.js`, `chart-ui.js`, `time-series-chart.js`
- `public/assets/js/pages/`
  - Page orchestration (`weather`, `generation`, `storage`, `rates-v4`, `projects`)

## Rates V4 Backend Boundaries

- `lib/rates/provider-resolver.js`: utility/ISO/timezone inference
- `lib/rates/california-adapter.js`: CA unified adapter orchestration
- `lib/rates/v4-caiso-adapter.js`: CAISO OASIS RT/DA retrieval + parsing
- `docs/data/nem3-hourly-rates-2026.json`: residential NEM 3.0 hourly dataset

## Active API Endpoints

- `/api/weather-proxy`
- `/api/nrel-proxy`
- `/api/location/reverse`
- `/api/v4/rates/provider`
- `/api/v4/rates/series`
- `/api/runtime-config`
- `/api/diagnostics`

## Supabase (Current)

Canonical app tables now used by active pages:

- `projects`
- `assets`
- `weather_cache`

Prototype rates/v3 sync tables and routes were retired in the v4 cutover.

