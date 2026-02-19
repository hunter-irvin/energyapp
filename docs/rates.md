# Rates Module (Phase 3)

## Scope

Phase 3 includes all prior behavior plus contract hardening, cache provenance, ingest observability, and richer debug metadata:

- project page: `/projects/rates.html`
- inferred utility/ISO/timezone from project location
- hourly rate chart with day/week/month controls + date picker
- service toggle: `LMP` / `Tariff`
- display unit toggle: `kWh` / `MWh` (client-side display conversion)
- market mode toggle for LMP: `Real-Time` / `Day-Ahead`
- missing data visualization (line gaps + shaded empty periods)
- empty-window notice when selected mode has no published values
- debug table summarizing per-region data availability

### Adapter architecture

- `api/rates/provider-resolver.js`
- `api/rates/lmp-adapters.js`
- `api/rates/tariff-adapters.js`
- `api/rates/health.js`
- `api/rates/series-utils.js`

`api/rates-proxy.js` is now an orchestrator that keeps route contracts stable while adapters evolve.

## API contracts

### `GET /api/rates/provider`

Query params:

- `lat` (number, required)
- `lng` (number, required)

Response:

```json
{
  "provider": {
    "utilityName": "California ISO Utility Territory (inferred)",
    "isoRegion": "CAISO",
    "timezone": "America/Los_Angeles",
    "confidence": "medium"
  },
  "fetchedAt": "2026-02-18T22:00:00.000Z"
}
```

### `GET /api/v2/rates/timeseries`

Query params:

- `lat` (number, required)
- `lng` (number, required)
- `serviceType` (`lmp|tariff`, required)
- `marketMode` (`real_time|day_ahead|tariff`, required)
- `start` (ISO timestamp, required)
- `end` (ISO timestamp, required)

Response:

```json
{
  "metadata": {
    "apiVersion": "v2",
    "serviceType": "lmp",
    "marketMode": "day_ahead",
    "regionId": "CAISO",
    "regionLabel": "California ISO",
    "utilityName": "California ISO Utility Territory (inferred)",
    "timezone": "America/Los_Angeles",
    "unit": "USD/MWh",
    "sourceUnit": "USD/MWh",
    "source": "rates_proxy_phase2_live",
    "confidence": "high",
    "qualityStatus": "good",
    "details": {
      "reason": "live_data"
    },
    "fetchedAt": "2026-02-18T22:00:00.000Z",
    "windowStart": "2026-01-19T22:00:00.000Z",
    "windowEnd": "2026-02-25T22:00:00.000Z"
  },
  "points": [
    {
      "ts": "2026-02-18T13:00:00.000Z",
      "value": 37.14,
      "isForecast": false,
      "missingReason": null
    },
    {
      "ts": "2026-02-22T17:00:00.000Z",
      "value": null,
      "isForecast": true,
      "missingReason": "Day-ahead window not yet posted."
    }
  ],
  "missingIntervals": [
    {
      "start": "2026-02-22T17:00:00.000Z",
      "reason": "Day-ahead window not yet posted.",
      "end": "2026-02-25T22:00:00.000Z"
    }
  ]
}
```

Notes:

- `metadata.unit` / `metadata.sourceUnit` reflect adapter/provider source units.
- UI conversion to display units (`USD/kWh` or `USD/MWh`) is client-side to avoid double-scaling through cache layers.

### `GET /api/rates/health`

Query params:

- `lat` (number, required)
- `lng` (number, required)
- `serviceType` (`lmp|tariff`, required)
- `start` (ISO timestamp, required)
- `end` (ISO timestamp, required)

Response rows:

- `regionId`, `regionLabel`, `serviceType`
- `marketMode`, `source`, `sourceUnit`, `confidence`
- `status` (`good|partial|missing`)
- `lastUpdatedAt`
- `expectedHours`, `missingHours`

### `GET /api/rates/refresh`

Manual refresh acknowledgment endpoint:

- `{ ok: true, refreshedAt: ISO, source: "rates_proxy_phase2" }`

## Persistence model

## Supabase

- `projects` additions:
  - `utility_name`
  - `iso_region`
  - `timezone`
  - `rates_service_type`
  - `rates_market_mode`
- `rate_series_cache`
- `rate_region_health`
- `rate_ingest_runs`

`rate_series_cache` phase-3 provenance columns:

- `api_version`
- `source_unit`
- `confidence`
- `quality_status`
- `ingest_notes`

`rate_region_health` phase-3 columns:

- `market_mode` (part of uniqueness key)
- `source`
- `source_unit`
- `confidence`
- `api_version`

## local fallback

- `energyapp.db.rateSeriesCache`
- `energyapp.db.rateRegionHealth`

## TTL behavior

- `real_time`: 5 minutes
- `day_ahead`: 1 hour
- `tariff`: 24 hours

These TTL rules are applied in `public/assets/js/pages/rates.js` before deciding whether to call `/api/v2/rates/timeseries`.

## Phase 3 source behavior

- LMP:
  - CAISO adapter attempts live retrieval from OASIS.
  - ERCOT adapter attempts live retrieval via ERCOT Public API.
  - ERCOT live path requires configured credentials/endpoints:
    - `ENERGYAPP_ERCOT_SUBSCRIPTION_KEY`
    - `ENERGYAPP_ERCOT_RT_LMP_ENDPOINT`
    - `ENERGYAPP_ERCOT_DA_LMP_ENDPOINT`
    - plus either `ENERGYAPP_ERCOT_ID_TOKEN` or username/password token flow vars.
  - PJM/MISO/NYISO/ISO-NE/SPP are currently marked not live-capable for LMP and use modeled fallback.
  - When live retrieval fails, API preserves missing intervals and reports fallback reason (`source_unavailable`).
- Tariff:
  - Tariff adapter serves utility-program proxy schedules by inferred utility/region (phase-3 expansion).
  - Response details include `tariffProgramId` and `tariffProgramLabel`.
  - Direct utility feed connectors remain a follow-on enhancement.

## Reason codes

Phase 2 response/debug details may include:

- `live_data`
- `live_or_fallback`
- `region_not_supported`
- `source_unavailable`
- `schedule_based`

## Debug table status rules

Status is based on expected hourly coverage in the requested window:

- `good`: >= 95% coverage
- `partial`: >= 20% and < 95%
- `missing`: < 20%
