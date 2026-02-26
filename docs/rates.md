# Rates Module (V3)

## Scope

Current rates flow is v3-first and Supabase-backed:

- page: `/projects/rates.html`
- inferred utility/ISO/timezone from project location
- service toggle: `LMP` / `Tariff`
- market mode toggle for LMP: `Real-Time` / `Day-Ahead`
- display unit toggle: `kWh` / `MWh` (client-side conversion)
- period-aware interval controls (including true 5-minute cadence where available)
- missing/unsupported windows rendered as gaps/empty state (no modeled fallback)
- sync status line + debug table

## API Contracts (Current)

### `GET /api/rates/provider`

Query params:

- `lat` (required)
- `lng` (required)

Returns inferred `utilityName`, `isoRegion`, `timezone`, and `confidence`.

### `GET /api/rates/health`

Query params:

- `lat` (required)
- `lng` (required)
- `serviceType` (`lmp|tariff|all`, required)
- `start` (ISO, required)
- `end` (ISO, required)

Returns debug/availability rows used by the Rates table.

### `GET /api/v3/series/rates`

Query params:

- `projectId` (required)
- `serviceType` (`lmp|tariff`, required)
- `marketMode` (`real_time|day_ahead|tariff`, required)
- `start` (ISO, required)
- `end` (ISO, required)
- `interval` or `resolutionMinutes` (optional)

Returns normalized series points from `rate_project_series` plus metadata.

### `GET /api/v3/sync/rates/status`

Query params:

- `projectId` (required)

Returns latest `ingestion_jobs` row and `domain_sync_state` row for `rates`.

### `POST /api/v3/refresh`

Body:

- `projectId` (required)
- `reason` (`manual_refresh|user_login|nightly_cron|location_change|asset_change`)
- `domains` (optional; defaults to rolling weather/generation/rates)

Queues rolling sync jobs and applies invalidation logic for location/asset changes.

## Sync Behavior

- Rates page polls sync status every 2 minutes.
- Manual refresh triggers `POST /api/v3/refresh`.
- Focus/visibility restores trigger status refresh.
- Nightly rolling refresh is handled by cron route + worker.

## Cadence Rules

- No synthesized 5-minute series.
- `five_min` is exposed only when upstream cadence supports it.
- Unsupported/non-live regions return explicit unsupported/unavailable responses with empty points.
- Day-ahead cadence remains source-driven (typically hourly).

## Persistence Model (Supabase Only)

Primary tables:

- `rate_project_series`
- `domain_sync_state`
- `ingestion_jobs`

Supporting metadata tables used by the debug view:

- `rate_region_health`
- `rate_ingest_runs`

## Deprecated Routes

- `GET /api/rates/timeseries`
- `GET /api/v2/rates/timeseries`
- `GET /api/rates/refresh`
- `GET /api/rates/backfill/start`
- `GET /api/rates/backfill/status`

These legacy routes are not part of active UI flows.
