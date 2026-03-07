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

## Routing Invariants

- Local and production API routes must mirror each other. Public endpoints exposed through `server.js` for local development must match the public endpoints exposed through Vercel `api/` files in production.
- Local and production routes should delegate to the same shared handler modules under `lib/` whenever possible so local verification exercises the same behavior that will run after deployment.
- Keep the total number of public serverless API routes under 10. The current target inventory is 7 route files under `api/`.
- When replacing an API route, remove obsolete serverless entry files so they do not continue counting toward the Vercel function budget.

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

