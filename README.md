# EnergyApp

## App Structure (Current)

This repo is organized as a static multi-page web app served from `public/`.

- Landing page: `/` (`public/index.html`)
- Project pages:
  - `/projects/location.html`
  - `/projects/generation.html`
  - `/projects/storage.html`
  - `/projects/rates.html`

### Frontend layout

- `public/assets/css/` shared styles
- `public/assets/js/core/` shared runtime modules (`charting`, cache, models, data utilities, Supabase client/config)
- `public/assets/js/features/` domain feature modules (for example generation modeling logic)
- `public/assets/js/components/` React bridge components (`project-shell`, `chart-ui`, `time-series-chart`)
- `public/assets/js/pages/` page entry scripts (`projects`, `location`, `generation`, `storage`, `rates`)

### UI Architecture (Current)

The app now uses a hybrid static-page + React-islands model:

- Shared project header/sidebar are rendered via `public/assets/js/components/project-shell.js`.
- Shared chart controls and legends are rendered via `public/assets/js/components/chart-ui.js`.
- Shared chart rendering is standardized through `public/assets/js/components/time-series-chart.js` (Chart.js wrapper).
- Generation and Storage asset editors are React-rendered; legacy HTML template card rendering has been removed.

### Period/Interval Rules (Current)

Intervals are now period-aware across Location/Generation/Storage/Rates:

- `day`: no `daily` option (sub-daily only)
- `week`: `half_hour`/`hourly`/`daily`
- `month`: `hourly`/`daily`
- `year`: `daily`

Rates additionally exposes `five_min`/`half_hour` only when source cadence supports it.

### Backend layout

- `server.js` static hosting + API proxy routes
- `api/weather-proxy.js` shared weather proxy handlers (`/api/weather-proxy`, `/api/nrel-proxy`)
- `api/nrel-proxy.js` compatibility wrapper exporting the NREL CSV handler
- `api/rates-proxy.js` rates provider/health metadata handlers
- `api/v3-proxy.js` canonical sync + series + worker handlers (`/api/v3/*`)
- `supabase/` schema/bootstrap/migrations
- `tests/` automated tests

### V3 API Status (Authoritative)

Use these endpoints for current app behavior:

- `POST /api/v3/sync/:domain`
- `GET /api/v3/sync/:domain/status?projectId={id}`
- `GET /api/v3/series/weather?...`
- `GET /api/v3/series/generation?...`
- `GET /api/v3/series/rates?...`
- `POST /api/v3/refresh`
- `POST /api/v3/cron/nightly-sync`
- `POST /api/v3/worker/run-once`

Legacy endpoints `/api/rates/timeseries`, `/api/v2/rates/timeseries`, and `/api/rates/refresh` are deprecated and should not be used by new code.

Some lower sections in this README describe earlier phase behavior and are retained for migration history; when they conflict, this v3 section is authoritative.

## Asset Generation Formulas & Data Dictionary

This section documents how the **Add Assets** page computes expected generation from NREL weather inputs.

### Time & Data Flow

1. Facility location is loaded from the active project record (`projects.location_lat` / `projects.location_lng`) via `EnergySupabaseService`.
2. Solar and wind weather rows are fetched from `/api/weather-proxy` using the selected provider (`nrel` or `open_meteo`).
3. Weather rows are normalized to facility-local day alignment (including year normalization to selected day year).
4. A selected day is sliced into 48 half-hour points.
5. Per-asset power is computed and then aggregated to chart series:
   - **Wind area** (bottom stack)
   - **Solar area** (stacked above wind)
   - **Total line** (solar + wind)

### Weather API Configuration (Current)

The proxy supports two providers.

- `nrel` (2014 overlap configuration)
- `open_meteo` (free dev mode, no API key; historical + forecast minutely ingestion downsampled to 30-minute rows)

- Solar endpoint: `https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-aggregated-v4-0-0-download.csv`
- Wind endpoint: `https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv`
- Requested year: `2014` for NREL
- Requested interval: `30` minutes for both
- Solar attributes: `ghi,dni,dhi,air_temperature,wind_speed`
- Wind attributes: `windspeed_100m,winddirection_100m,temperature_100m,pressure_100m`

### Solar Formula

For each interval point:

- `pdc_stc_kw = capacity_ac_kw * dc_ac_ratio`
- `t_cell_c = air_temperature + ((noct_c - 20) / 800) * ghi`
- `pdc_kw = pdc_stc_kw * (ghi / 1000) * (1 + temp_coeff_per_c * (t_cell_c - 25)) * (1 - system_losses_frac)`
- `pdc_kw = max(0, pdc_kw)`
- `pac_kw = min(pdc_kw, capacity_ac_kw)` when clipping is enabled, else `pac_kw = pdc_kw`
- `output_kw = pac_kw * availability_frac`

### Wind Formula

For each interval point:

1. Resolve wind speed at hub height:
   - Use exact `windspeed_<hub_height>m` if present.
   - Else extrapolate from reference height using shear:
     - `v_hub = v_ref * (hub_height / ref_height) ^ shear_exponent_alpha`
2. Optional density correction:
   - `rho = pressure / (287.05 * (temperature + 273.15))`
   - `v_eff = v_hub * (rho / air_density_std)^(1/3)`
3. Apply turbine power curve fraction `f(v_eff)` (piecewise linear interpolation).
4. Apply cut-in / cut-out:
   - If `v_eff < cut_in_mps` or `v_eff >= cut_out_mps`, fraction = 0.
5. Compute output:
   - `p_turbine_kw = rated_power_kw * fraction`
   - `output_kw = p_turbine_kw * num_turbines * (1 - wake_losses_frac) * (1 - electrical_losses_frac) * availability_frac`

### Aggregation

- `solar_total_kw[t] = Σ output_kw of each solar asset at interval t`
- `wind_total_kw[t] = Σ output_kw of each wind asset at interval t`
- `total_kw[t] = solar_total_kw[t] + wind_total_kw[t]`

### Data Dictionary

#### Weather metrics returned by API

| Metric | Definition | Units | Used by |
|---|---|---|---|
| `timestamp` | Interval timestamp label created by app during day slicing | local datetime string | Both |
| `ghi` | Global horizontal irradiance, used as POA proxy in current solar model | W/m² | Solar generation model |
| `dni` | Direct normal irradiance, parsed and retained for diagnostics/future model work | W/m² | Neither (currently) |
| `dhi` | Diffuse horizontal irradiance, parsed and retained for diagnostics/future model work | W/m² | Neither (currently) |
| `air_temperature` | Near-surface air temperature for PV cell temperature estimate | °C | Solar generation model |
| `wind_speed` | Solar endpoint wind-speed companion metric (stored/diagnostic) | m/s | Neither (currently) |
| `windspeed_100m` | Wind speed at 100 m used for turbine hub-height selection/extrapolation | m/s | Wind generation model |
| `winddirection_100m` | Wind direction at 100 m used for chart/table directional context | degrees | Neither (currently) |
| `temperature_100m` | Air temperature at 100 m used for optional density correction | °C | Wind generation model |
| `pressure_100m` | Air pressure at 100 m used for optional density correction | Pa | Wind generation model |

#### Solar asset model fields

- `name` (string)
- `capacity_ac_kw` (kW AC)
- `system_losses_frac` (0-1; includes orientation and aggregate system derates)
- `dc_ac_ratio` (unitless)
- `availability_frac` (0-1)
- `clip_at_ac_capacity` (boolean)
- `noct_c` (°C)
- `temp_coeff_per_c` (1/°C)

#### Wind asset model fields

- `name` (string)
- `rated_power_kw` (kW per turbine)
- `num_turbines` (integer)
- `hub_height_m` (m)
- `power_curve_id` (string; default `generic_2mw_v1`)
- `cut_in_mps` (m/s)
- `rated_mps` (m/s; model/config informational)
- `cut_out_mps` (m/s)
- `availability_frac` (0-1)
- `wake_losses_frac` (0-1)
- `electrical_losses_frac` (0-1)
- `density_correction_enabled` (boolean)
- `air_density_std` (kg/m³)
- `shear_exponent_alpha` (unitless)
- `reference_height_m` (m)

### Persistence Architecture

EnergyApp now treats Supabase/Postgres as the canonical persistence layer when configured, with a local browser fallback only when Supabase is not configured.

#### Project lifecycle

1. User opens the app and `migrateLegacyLocalData()` runs once.
2. If database-backed projects already exist, migration is skipped.
3. If only legacy local keys exist (`energyapp.facility`, `energyapp.assetsState`), the app creates a single project and imports those assets.
4. Project-scoped UX state (selected date/map state) is copied to project-scoped local keys.
5. Subsequent CRUD uses `projects` + `assets` tables through Supabase when env vars are present; otherwise fallback storage keys `energyapp.db.*` are used locally.

#### Facility, assets, and weather cache storage model

- `projects` stores facility/project metadata (`id`, `name`, `location_lat`, `location_lng`, `selected_date`, `weather_provider`, `map_state`, timestamps).
- `assets` stores one row per solar/wind asset with a required `project_id` FK (`ON DELETE CASCADE`) and JSON `model` payload.
- `weather_cache` stores provider-agnostic weather payloads keyed by `project_id + provider + dataset + date_key + interval_minutes + source_year` plus metadata (`wkt`, `timezone`, `source`, `fetched_at`).
- `assets.project_id` and `weather_cache.project_id` are non-null and cascade-delete with their parent project.
- Row-shape constraints remain enforced even with open policies:
  - `assets.asset_type` must be `solar` or `wind`
  - `weather_cache.dataset` must be `solar` or `wind`

#### Public anon/no-auth behavior implications

- RLS is enabled on `projects`, `assets`, and `weather_cache`.
- Policies are intentionally permissive for role `anon` (`USING true`, `WITH CHECK true`) to support a no-login experience.
- **Important:** data is intentionally public-editable and not tenant-isolated in this mode. Any client with the anon key can read/write all rows.

### Required configuration (frontend/server)

#### Frontend Supabase variables

Define these globals before `public/assets/js/core/supabase-client.js` loads (for example in a script tag or templated HTML):

- `window.ENERGYAPP_SUPABASE_URL`
- `window.ENERGYAPP_SUPABASE_ANON_KEY`

Runtime resolution order:

1. `window.ENERGYAPP_SUPABASE_URL` + `window.ENERGYAPP_SUPABASE_ANON_KEY`
2. `window.ENERGYAPP_SUPABASE_CONFIG` (if populated by non-sensitive runtime config)
3. `GET /api/runtime-config` (when served by `server.js`)

If no source provides both values, the app falls back to local browser persistence.

#### Secrets policy (local + Vercel)

- Store private keys only in environment variables.
- Do not place private keys in client files such as `public/config.local.js`.
- `.env`, `.env.local`, and `.env.*.local` are git-ignored for local development.
- For Vercel, define env vars in Project Settings > Environment Variables.

Recommended server env vars:

- `ENERGYAPP_NREL_API_KEY` (private)
- `ENERGYAPP_NREL_CONTACT_EMAIL` (non-secret but environment-specific)
- `ENERGYAPP_SUPABASE_SERVICE_ROLE_KEY` (private; server-only)
- `ENERGYAPP_SUPABASE_URL` (public project URL)
- `ENERGYAPP_SUPABASE_ANON_KEY` (publishable/anon key; safe for client usage)
- `ENERGYAPP_ERCOT_SUBSCRIPTION_KEY` (private; ERCOT live LMP adapter)
- `ENERGYAPP_ERCOT_ID_TOKEN` (private; ERCOT live LMP adapter, optional if using username/password token flow)

#### Where keys are read in code

- Supabase client bootstrapping reads `window.ENERGYAPP_SUPABASE_URL` and `window.ENERGYAPP_SUPABASE_ANON_KEY` in `getClient()`.
- The resulting client powers `projects`, `assets`, and `weather_cache` CRUD in `supabaseDb(...)`.
- Server-side `/api/weather-proxy` does not read Supabase credentials; it proxies and normalizes provider weather responses.

### Database setup

1. Create a Supabase project.
2. Run the bootstrap SQL script in the SQL editor:

```sql
-- file: supabase/bootstrap.sql
```

3. (Optional but recommended) Also apply tracked migrations from `supabase/migrations/` in order for environment parity.

The bootstrap script creates:

- `projects`, `assets`, `weather_cache` tables
- non-null FKs + cascade deletes
- dataset/asset-type constraints
- RLS enabled on all three tables
- permissive `anon` policies for full CRUD

### Data migration from localStorage

The one-time migration lives in `migrateLegacyLocalData()` and is triggered on project/app boot.

Migrated legacy keys:

- `energyapp.facility` → `projects`
- `energyapp.assetsState` → `assets`
- `energyapp.selectedDate` and `energyapp.mapState` → project-scoped UI keys

Migration guard:

- `energyapp.legacyMigration.v1 = done`

Rollback notes:

- The migration does **not** delete legacy localStorage keys.
- To retry migration in a dev browser, clear `energyapp.legacyMigration.v1` and (if needed) clear DB rows created by the prior run.
- If Supabase is unreachable or not configured, runtime storage falls back to local `energyapp.db.projects`, `energyapp.db.assets`, and `energyapp.db.weatherCache` keys.

### Weather cache

- Weather payloads are persisted in `weather_cache` keyed by `project_id`, `provider`, `dataset`, `date_key`, `interval_minutes`, and `source_year`.
- Cache rows store raw/normalized-compatible JSON payloads plus `fetched_at`, `wkt`, `timezone`, and `source` metadata for traceability.
- UI loads cached payloads first and refreshes from `/api/weather-proxy` when cache is stale (24h TTL) or when the **Refresh Weather Data** action is used.

### Rates Page (Current v3 DB-First Progressive Sync)

`/projects/rates.html` provides electricity-rate visualization with project-inferred location context.

- Controls:
  - service type: `LMP` or `Tariff`
  - display unit: `kWh` or `MWh` (client-side conversion)
  - market mode: `Real-Time` or `Day-Ahead` (LMP only)
  - chart period: `Day`, `Week`, `Month`
  - date picker + range shift controls
- DB-first behavior:
  - query existing `rate_project_series` for the visible window first
  - render available points immediately
  - fetch only missing periods/chunks
- Progressive sync behavior:
  - visible-window chunks are prioritized before backlog chunks
  - chart refreshes incrementally as chunk coverage changes
  - sync polling is dynamic: fast while active (`2s`), slower when idle (`120s`)
- Debug table behavior:
  - `Data Availability` columns for `Tariff`, `LMP-RT`, `LMP-DA`
  - segmented bars show `DB` (green), `active fetch` (yellow), and `pending` (gray)
  - source details remain in expandable diagnostics rows

#### Rates API endpoints (current)

- `GET /api/rates/provider?lat={lat}&lng={lng}`
  - resolves inferred `utilityName`, `isoRegion`, and `timezone`
- `GET /api/rates/health?lat={lat}&lng={lng}&serviceType={lmp|tariff|all}&start={ISO}&end={ISO}`
  - returns availability/status rows for the debug table
- `GET /api/v3/series/rates?projectId={id}&serviceType={lmp|tariff}&marketMode={real_time|day_ahead|tariff}&start={ISO}&end={ISO}`
  - returns normalized points + coverage metadata (`expectedPoints`, `availablePoints`, `missingPoints`, `coveragePct`, `qualityStatus`)
- `POST /api/v3/sync/rates`
  - enqueues rolling/full/visible-window rates sync job
- `GET /api/v3/sync/rates/status?projectId={id}`
  - returns latest job + per-class progress/coverage (`tariff`, `lmpRt`, `lmpDa`)
- `POST /api/v3/refresh`
  - queues domain refresh with invalidation-aware behavior

Deprecated routes retained for compatibility only:

- `GET /api/rates/timeseries`
- `GET /api/v2/rates/timeseries`
- `GET /api/rates/refresh`

#### Rates storage model (v3)

- Canonical series table: `rate_project_series`
- Sync/job state tables: `domain_sync_state`, `ingestion_jobs`, `rate_sync_chunks`
- Debug/support tables: `rate_region_health`, `rate_ingest_runs`

#### Rates source behavior

- No modeled fallback rates are returned.
- Unsupported regions return explicit unsupported/unavailable responses with empty points.
- 5-minute cadence is exposed only when upstream source cadence truly supports it.
- CAISO fetches are chunked with a hard request window cap (<=31 days) and bounded concurrency.

### Backlog: future auth/ownership hardening

If requirements move away from no-auth/public editing, plan a follow-up migration to:

- introduce authenticated users and ownership columns (e.g., `owner_user_id`)
- replace permissive anon policies with ownership-aware RLS
- add tenant isolation and scoped reads/writes
- rotate/restrict existing anon usage patterns

