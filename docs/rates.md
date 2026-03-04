# Rates Module (V3 DB-First Progressive Sync)

## Scope

Current rates flow is v3-first and Supabase-backed:

- page: `/projects/rates.html`
- inferred utility/ISO/timezone from project location
- service toggle: `LMP` / `Tariff`
- market mode toggle for LMP: `Real-Time` / `Day-Ahead`
- display unit toggle: `kWh` / `MWh` (client-side conversion)
- period-aware interval controls (including true 5-minute cadence where available)
- missing/unsupported windows rendered as gaps/empty state (no modeled fallback)
- sync status line + debug table with per-class data availability bars

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

Returns normalized series points from `rate_project_series` plus metadata, including:

- `expectedPoints`
- `availablePoints`
- `missingPoints`
- `coveragePct`
- `qualityStatus`

### `POST /api/v3/sync/rates`

Body:

- `projectId` (required)
- `mode` (`rolling|full|visible_window`, optional)
- `reason` (`manual_refresh|user_login|nightly_cron|location_change|asset_change`, optional)

Queues rates sync jobs.

### `GET /api/v3/sync/rates/status`

Query params:

- `projectId` (required)

Returns latest `ingestion_jobs` row, `domain_sync_state`, and rates progress payload with per-class coverage/chunk progress (`tariff`, `lmpRt`, `lmpDa`).

### `POST /api/v3/refresh`

Body:

- `projectId` (required)
- `reason` (`manual_refresh|user_login|nightly_cron|location_change|asset_change`)
- `domains` (optional; defaults to rolling weather/generation/rates)

Queues rolling sync jobs and applies invalidation logic for location/asset changes.

## Sync and UI Behavior

- DB-first: visible window is read from `rate_project_series` before upstream fetch.
- Missing ranges only: fetch plans include only uncovered periods.
- Visible-window-first chunk execution before backlog windows.
- Incremental upsert after each chunk commit.
- Rates page polling cadence:
  - active/running job: fast polling (`2s`)
  - idle/completed/no active chunks: normal polling (`120s`)
- Incremental chart refresh triggers when active feed/window progress changes.

## Data Availability Debug Table

The debug table columns are:

- `Tariff` -> `Data Availability`
- `LMP-RT` -> `Data Availability`
- `LMP-DA` -> `Data Availability`

Each bar segment shows:

- green: persisted DB coverage
- yellow: active in-flight chunk window
- gray: pending/unavailable coverage

Source text is shown in expandable diagnostics rows only.

## Cadence Rules

- No synthesized 5-minute series.
- `five_min` is exposed only when upstream cadence supports it.
- Unsupported/non-live regions return explicit unsupported/unavailable responses with empty points.
- Day-ahead cadence remains source-driven (typically hourly).

## Persistence Model (Supabase)

Primary tables:

- `rate_project_series`
- `domain_sync_state`
- `ingestion_jobs`
- `rate_sync_chunks`

Supporting metadata tables used by the debug view:

- `rate_region_health`
- `rate_ingest_runs`

## Serverless Routing

- Serverless route dispatch is consolidated in `api/[...path].js`.
- Shared rates/v3 logic remains in `api/rates-proxy.js` and `api/v3-proxy.js`.

## Deprecated Routes

- `GET /api/rates/timeseries`
- `GET /api/v2/rates/timeseries`
- `GET /api/rates/refresh`

These legacy routes are not part of active UI flows.
