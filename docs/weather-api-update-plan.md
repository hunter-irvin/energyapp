# Weather API Update Plan

## Goal

Reduce weather-dependent load time for Generation by implementing an Open-Meteo-first weather pipeline that:

1. Fetches the currently visible chart window first.
2. Expands weather coverage backward in background tiers (`+1 month`, then `+3 months` total lookback from current window).
3. Merges returned weather points into a unified, fast cache model.
4. Avoids blocking user-facing errors for upstream range limits.
5. Keeps background sync running across page navigation and live-updates dependent pages.

Target: Generation first meaningful chart render in **<2 seconds from page load** on warm cache.

## Summary

The current weather flow does a window fetch and then broad full/delta sync. It is not span-aware like Rates v4 and does not use a coverage-first cache engine.

This plan introduces Open-Meteo-only incremental weather coverage (window-first + backward expansion tiers), with timestamp-merge caching shared across Weather and Generation. Errors/range limits are debug-only. Generation remains cache-first and live-updates when more weather coverage arrives.

## Locked Decisions

1. Range-limit and upstream errors are shown in debug area only.
2. No rates-style red crosshatch overlays for weather.
3. Background expansion runs backward in time only, relative to current window.
4. Expansion tiers stop at `+3 months` (no additional tiers for now).
5. Background sync continues if user navigates to Generation/Storage.
6. This update applies to Open-Meteo only; NREL remains legacy and may be retired later.
7. Generation target is `<2s` first render on warm cache, measured from page load.
8. Generation should live-update in background when new weather coverage becomes available.
9. Keep/extend Generation debug section.
10. Rename weather-facing code from `Location` naming to `Weather` naming.
11. Rename weather page file names/routes to `Weather` equivalents.
12. Live updates should be event-driven (no polling spam).

## Recommendation Notes (Speed-Focused)

### Cache shape

Recommendation: keep existing `weather_cache` table and store incremental coverage metadata inside payload first (no immediate schema expansion), because:

- faster rollout, fewer migration risks,
- no extra joins/queries,
- preserves compatibility with current readers.

Proposed payload metadata additions:

- `coverageWindow`: `{ start, end }`
- `requestedWindow`: `{ start, end }`
- `servedWindow`: `{ start, end }`
- `expansionTier`: `window|tier_1m|tier_3m`
- `rangeLimit`: `{ minDate, maxDate } | null`
- `runId` and `updatedAt`

If profiling later shows payload scanning is slow, phase 2 can add indexed columns for `coverage_start`, `coverage_end`, `provider_run_id`.

### Cache validity policy

Recommendation: move from strict TTL gating to **coverage-first validity** for Open-Meteo:

- Serve cached points immediately whenever requested window is covered.
- Fetch only missing spans or near-tail refresh.
- Keep short freshness rule only for the latest tail (for example recent 24-48h), not the full history.

This is the fastest path for Generation because it avoids refetching already-covered windows.

## Current Generation Data Flow (Today)

Generation weather production currently works like this:

1. Generation loads weather from Supabase `weather_cache` first (provider-specific, `date_key=all`).
2. If cache is stale/missing, Generation calls `/api/weather-proxy?mode=load_default` and upserts Supabase cache.
3. Generation computes chart-ready weather series client-side from weather rows.
4. Browser `localStorage` shared cache (`EnergySharedCache`) stores parsed weather/derived series for faster reuse.
5. Weather page sets an Open-Meteo sync marker; Generation can briefly wait for that sync before fallback.

Implication: generation math/rendering happens while user is on Generation. Background work mainly comes from Weather page sync writing shared cache.

## Scope

In scope:

- Open-Meteo orchestration for Weather page.
- Open-Meteo weather proxy contract/range handling.
- Shared weather coverage merge model for browser + Supabase cache rows.
- Generation cache-first hydration and live-update behavior.
- Naming cleanup from `Location` to `Weather` in symbols, file names, and routes.

Out of scope:

- Rates v4 changes.
- New weather providers.
- Weather visual redesign.
- NREL pipeline modernization.

## Task Tracker

Status legend: `pending`, `in_progress`, `blocked`, `completed`

| ID | Task | Status | Tests |
|---|---|---|---|
| WAPI-T01 | Define Open-Meteo incremental contract metadata: `requestedWindow`, `servedWindow`, `coverageWindow`, `expansionTier`, `rangeLimit`, `runId`. | completed | Unit: response contract snapshots for window and expansion calls. |
| WAPI-T02 | Normalize upstream range-limit responses in proxy into structured metadata (debug-visible, non-blocking UI). | completed | Unit: mocked upstream 400 payload maps to normalized metadata; no opaque parse exceptions. |
| WAPI-T03 | Implement canonical weather merge store (timestamp-indexed) + coverage span utilities (Open-Meteo only). | completed | Unit: merge dedupe, deterministic ordering, span coverage calculations for day/week/month windows. |
| WAPI-T04 | Implement window-first foreground fetch manager for Weather page with request supersession (latest window wins). | completed | Frontend unit: rapid period/date changes supersede prior foreground calls; only latest result mutates view. |
| WAPI-T05 | Implement backward expansion scheduler: after foreground success, fetch additional history to `+1 month`, then `+3 months` total. | completed | Unit + MCP: tier1 and tier2 execute in order; merged coverage grows backward only; no forward expansion calls. |
| WAPI-T06 | Keep background expansion alive across navigation (Weather -> Generation/Storage), tied to project/provider context. | completed | MCP/manual: start Weather sync, navigate to Generation, verify expansion continues and cache rows keep updating. |
| WAPI-T07 | Add shared run-state and lifecycle markers (`active`, `tier`, `superseded`, `complete`) in localStorage for cross-page coordination. | completed | Unit: lifecycle transitions valid; stale markers expire; cross-page read/write works. |
| WAPI-T08 | Update Weather page UX to non-blocking errors: range-limit details/debug only; chart stays usable from cached coverage. | completed | MCP/manual: out-of-range month shows available data; debug contains precise upstream reason. |
| WAPI-T09 | Persist merged Open-Meteo payloads to Supabase `weather_cache` + browser shared cache with coverage metadata. | completed | Integration: upsert/read succeeds, no duplicate amplification, reload hydrates from cache before network. |
| WAPI-T10 | Optimize Generation load path to prefer canonical merged coverage (`shared cache -> Supabase cache -> API fallback`) targeting `<2s` warm-cache render from page load. | completed | MCP/manual + timing capture: Generation first chart render `<2s` from page load on warm cache; minimal redundant API calls. |
| WAPI-T11 | Implement event-driven Generation live updates for Weather sync completion/coverage growth (`BroadcastChannel` + `storage` event fallback, no polling). | completed | MCP/manual: keep Generation open while Weather sync progresses; chart updates without manual refresh; no polling loops. |
| WAPI-T12 | Add telemetry/debug counters: page-load-to-render latency, tier latencies, cache-hit ratio, fallback count, live-update count. | completed | Unit: counters increment for expected paths; debug output includes per-tier timing + source indicators. |
| WAPI-T13 | Naming refactor: update JS symbols/comments/UI labels from `Location` weather terminology to `Weather`. | completed | `node --check` + grep checks: touched files avoid legacy naming drift; UI labels reflect Weather naming. |
| WAPI-T14 | File/route refactor: rename weather page file names/routes from `location` to `weather` and update nav/entrypoints/import paths. | completed | MCP/manual: Weather route reachable; nav links updated; no broken imports/scripts; legacy route handling validated. |
| WAPI-T15 | Regression pass + docs updates (`docs/architecture.md` weather section and migration notes for route rename). | completed | `node --check` edited files, `npm run -s test`, MCP walkthrough for window changes + cross-page navigation. |

## Test Plan

Automated:

1. Proxy contract/range-limit normalization tests.
2. Coverage merge/span tests.
3. Foreground supersession tests (latest-window-wins).
4. Cross-page marker/lifecycle tests.
5. Generation cache-first timing tests (warm cache).
6. Event-driven Generation live-update tests.

MCP/manual:

1. Weather week load: confirm immediate window fetch and chart render.
2. Change to month and move backward rapidly: confirm only latest foreground request commits.
3. Verify background expansion tiers (`+1m`, `+3m`) run backward only.
4. Navigate to Generation during expansion: confirm expansion continues and Generation hydrates cache-first.
5. Confirm Generation live-updates when new coverage arrives (event-driven).
6. Force out-of-range window: confirm non-blocking chart behavior; debug shows range-limit details.
7. Verify route/file rename (`/projects/weather.html`) and updated navigation links.

## Implementation Notes

- Keep `/api/weather-proxy` path; evolve payload additively.
- Apply new orchestration only when provider is `open_meteo`.
- Keep NREL behavior untouched for now.
- Prioritize speed: coverage-first reads, missing-span fetches, tail-only freshness.
- Include route/file rename migration notes and validate legacy route behavior.


## Implementation Completion Notes (2026-03-05)

Implemented in this pass:

- Open-Meteo proxy metadata contract now includes requested/served/coverage windows, expansion tier, run id, and range-limit metadata.
- Open-Meteo range-limit upstream failures are normalized and returned as structured metadata rather than opaque parsing failures.
- Added shared browser modules:
  - `public/assets/js/features/weather-coverage-engine.js`
  - `public/assets/js/features/weather-sync-bus.js`
- Weather page now uses window-first fetch, run-state supersession, and backward expansion tiers (`tier_1m`, `tier_3m`).
- Merged Open-Meteo payloads are persisted to `weather_cache` and browser shared cache with coverage metadata envelopes.
- Generation now hydrates from cache first, performs window-scoped Open-Meteo fetch when needed, and listens for weather sync events for live refresh without polling.
- Route/file naming refactor completed: Weather page is `/projects/weather.html`; legacy `/projects/location.html` and `public/assets/js/pages/location.js` are removed.
- README and architecture docs updated to Weather naming and route map.

Validation completed:

- `node --check` for edited Weather/Generation/API/test modules.
- `npm run -s test` passes (`All tests passed.`).
- Browser sanity checks via MCP:
  - `/projects/weather.html` loads with WEATHER nav/labels.
  - `/projects/generation.html` loads with no runtime JS errors.
  - `/projects/location.html` returns `{"errors":["Not found."]}`.
