# EnergyApp

## Current App Surface

EnergyApp is a static multi-page web app served from `public/`.

Active project pages:

- `/projects/weather.html`
- `/projects/generation.html`
- `/projects/load-builder.html`
- `/projects/storage.html`
- `/projects/rates-v4.html`

The legacy Rates prototype page has been retired.

## Frontend Structure

- `public/assets/css/` shared styles
- `public/assets/js/core/` shared runtime modules (`charting`, cache, models, Supabase client/config)
- `public/assets/js/features/` feature helpers (`generation`, `load-builder`, `rates-v4-cache-engine`, `weather-coverage-engine`, `weather-sync-bus`)
- `public/assets/js/components/` React bridge components (`project-shell`, `chart-ui`, `time-series-chart`)
- `public/assets/js/pages/` page entry scripts (`projects`, `weather`, `generation`, `storage`, `rates-v4`)

## Backend Structure

- `server.js` local static host + API routing
- `api/weather-proxy.js` weather/NREL proxy handlers
- `api/location-proxy.js` location reverse geocoding handler
- `api/v4/rates/provider.js` explicit Vercel provider route
- `api/v4/rates/series.js` explicit Vercel series route
- `lib/rates/v4-rates-handlers.js` shared rates handlers used by local and Vercel entrypoints

## Rates V4 Data Sources

- Commercial RT/DA: CAISO OASIS via `lib/rates/v4-caiso-adapter.js`
- Residential: repo dataset `docs/data/nem3-hourly-rates-2026.json`
- Utility/region/timezone inference: `lib/rates/provider-resolver.js`

## Persistence

Supabase-backed canonical tables used by active pages:

- `projects`
- `assets`
- `load_profiles`
- `weather_cache`

Rates v4 browser caching is local (`localStorage`) via `rates-v4-cache-engine`.

## Running Locally

1. Install deps: `npm install`
2. Start dev server: `npm start`
3. Open `http://localhost:8000`

## Tests

Run test suite:

- `npm run -s test`

Current automated suite covers core compute, rates v4 shared handlers, and explicit v4 route entrypoints.

