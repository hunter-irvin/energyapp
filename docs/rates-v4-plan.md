# Rates V4 Rebuild Plan

## Objective

Create a fresh `v4` rates system across UI and API, keep prototype (`v3` + legacy) intact during buildout, and retire prototype rates paths only after v4 parity is complete.

Current implementation strategy:

- Server-side source calls (browser never calls CAISO/OASIS directly)
- Browser-side persistence in `localStorage` (TTL: 5 minutes for RT cache)
- No Supabase storage in initial v4 phases
- Incremental delivery order:
  1. `commercial_realtime`
  2. `commercial_day_ahead` (later)
  3. `residential` (later)

## Locked Behavior Decisions

### Time and window semantics

- Window calculations use the **project local timezone**.
- `week` and `month` are **rolling windows** (not calendar week/month blocks).
- Keep date picker in v4.
- Default period on load: `week`.
- Default initial RT window: `last 6 days through tomorrow`.

### Rate type rollout

- On initial page load, selected rate type is `commercial_realtime`.
- Only RT behavior is fully implemented now.
- No DA/residential UI behavior implementation yet (planned later).

### Loading UX

- Loading feedback is shown **only in the selected card**.
- Keep previous chart data visible while loading new data.
- Fixed-duration style is approximate (not chart-gating):
  - Progress bar animates toward completion over ~5s.
  - Bar slows/stalls near completion while waiting for actual data.
- Chart updates immediately when response is prepared.
- Loading status labels cycle every 2 seconds during normal loading:
  - `Fetching OASIS data...`
- On API error, loading label switches to explicit error text (do not hide error details).
- On HTTP 429 with retry guidance (for example, wait 5 seconds), label must show countdown text to user (for example, `Rate limited. Try again in 5s ... 4s ...`).
- During 429 countdown, `Fetch data` button is disabled/inactive.
- When countdown reaches 0, `Fetch data` button becomes active again for manual retry.

### RT data and aggregation

- RT source cadence: 5-minute points.
- Aggregation:
  - 30-minute and hourly values are averages from available non-null 5-minute points.
  - Partial buckets are allowed (average of non-null points).
  - Buckets with no non-null points remain null.
- Null handling:
  - Nulls are never coerced to zero.
  - Missing spans render as red crosshatch overlays.
  - Legend includes `Missing data` (match prototype model).

### Fetch behavior

- Period/range changes trigger a new RT API call.
- Include tomorrow in RT windows (future-proofing for DA UI consistency).
- Retry policy: retry once on failure.
- Add `Refresh data` button on selected card to force manual refresh.
- No gap metadata in API response for now.

### RT Incremental Cache Engine (RT-first, reusable later)

- Keep persistence in browser `localStorage` for now.
- Canonical point identity is UTC ISO timestamp.
- Missing state remains a single `missing` concept for now.
- Historical RT points are immutable once fetched.
- Auto-refresh near-real-time tail every 5 minutes.
- Chart may show partial cached coverage immediately while background fetch fills missing spans.
- Loading bar remains the user-facing progress signal (no separate partial-data badge).
- Missing spans are fetched as-is (no extra gap-merge optimization for now).
- Retry policy remains retry-once per fetch attempt.
- On 429, pause all pending span fetches during wait window.
- No hard retention horizon cap yet (beyond existing cache TTL behavior).
- CAISO LMP node selection must use canonical `utilityCode` (no utility-name fallback for node mapping).
- Cache partition/fingerprint includes `{projectId, rateType, timezone}` and invalidates on project location change.
- Keep API single-range for now; multi-range batching deferred.
- Persist per-span error metadata in cache for debugging.
- Implement as unified cache engine primitives now so DA/residential can reuse the same architecture later.
### Navigation and coexistence

- Keep prototype Rates page link visible during rollout.
- V4 API and future storage remain separate from prototype contracts.

## V4 Product Requirements

### Page and layout

- Page: `/projects/rates-v4.html`
- Two major sections only:
  - Summary section (rate cards)
  - Chart section
- No debug table on v4 page

### Summary cards

- 3 cards in one row on desktop
- Width `200px` each; height content-driven
- Single-select behavior with clear visual selected state
- Rate types:
  - `Residential`
  - `Commercial - Day Ahead`
  - `Commercial - Realtime`

### Chart controls

- Period controls only: `day`, `week`, `month`
- Date picker retained

## Architecture and Coexistence Rules

- Treat all existing rates codepaths as `prototype`.
- Build v4 contracts under explicit `v4` names.
- Do not reuse prototype API contracts for v4 routes.
- Supabase storage for v4 is deferred (no DB persistence in current phases).
- Future v4 DB schema (when added) must be separate from prototype tables.
- Prototype cleanup/removal happens only after v4 completeness sign-off.

## Proposed V4 Scope (Current)

### Frontend

- `public/projects/rates-v4.html`
- `public/assets/js/pages/rates-v4.js`
- Use shared primitives:
  - `EnergyProjectShell`
  - `EnergyChartUI`
  - `EnergyTimeSeriesChart`

### API

- New v4 endpoint family:
  - `GET /api/v4/rates/series`
  - optional later: `GET /api/v4/rates/summary`
- Keep payloads rate-type centered and cadence explicit.

### Storage (initial phases)

- Browser `localStorage` only for v4 rates caching.
- No Supabase persistence yet.

### Storage (future phase)

- If/when DB persistence is added, create v4-only tables separate from prototype tables.

## Implementation Plan

## Phase 0 - RT Contract Lock (Current)

1. Finalize v4 request/response contract for `commercial_realtime`.
2. Lock rolling window semantics in project local timezone.
3. Finalize null and missing-span rendering behavior.
4. Define browser cache key/version strategy for RT.
5. Define retry-once semantics and manual refresh behavior.

Exit criteria:

- RT API contract documented and testable.
- No Supabase dependency introduced.

## Phase 1 - RT Fetch + Loading UX + Chart

1. Default selected card to `commercial_realtime`.
2. Trigger initial RT fetch for default week window (`last 6 days through tomorrow`).
3. Implement selected-card-only loading bar with label cycling every 2 seconds.
4. Keep prior chart data visible during fetch.
5. Update chart when data is prepared (independent of loading animation timer).
6. Implement missing-data crosshatch spans + legend item.
7. Add `Fetch data` button on selected card.
8. Apply retry-once policy for server fetch failures.
9. On API error, show error label text in the loading/status area.
10. On HTTP 429, show visible countdown label and disable `Fetch data` until countdown ends.

Exit criteria:

- RT flow works end-to-end with required UX/aggregation/null behavior.

## Phase 2 - RT Unified Incremental Cache Engine

1. Introduce unified v4 cache engine primitives (window indexing, point merges, fingerprint invalidation) for RT now, reusable later for DA/residential.
2. Normalize RT cache storage to canonical 5-minute points keyed by UTC ISO timestamp.
3. Partition cache by `{projectId, rateType, timezone}` and location fingerprint.
4. On read, hydrate chart immediately from cache when requested window is fully or partially covered.
5. Compute missing spans for requested window and fetch only uncovered spans via existing single-range API calls.
6. Merge fetched spans into canonical store and rebuild aggregates (30-minute/hourly) from cached 5-minute points.
7. Keep historical points immutable; only near-real-time tail can refresh.
8. Implement 5-minute tail refresh cadence.
9. Preserve retry-once behavior and pause all pending span fetches on 429 countdown.
10. Persist per-span error metadata for debugging and future diagnostics.

Exit criteria:

- Window changes reuse existing cache coverage without full-window re-fetch.
- Missing-only fetch and merge produces a complete requested window when source data is available.
- Cache engine design is reusable for DA/residential phases.

## Phase 3 - Day Ahead Support (Deferred)

1. Card selection: clicking `commercial_day_ahead` switches active rate type and triggers DA workflow.
2. Window behavior: preserve the current period/date window on RT <-> DA switching; do not reset user-selected window.
3. DA cadence: DA values are hourly only.
4. Card-scoped loading controls: selected card owns active `Fetch data` + loading indicator; previous card loader is hidden.
5. Loading label text for both RT and DA: `Fetching OASIS data...`.
6. DA fetch/caching follows the same incremental single-range missing-span process used by RT.
7. DA tail refresh cadence is 30 minutes (RT remains 5 minutes).
8. Cache-first switching in both directions: RT->DA and DA->RT first hydrate from cache, then fetch only missing spans.
9. Keep RT cache retained while DA is active (and vice versa) to support instant switch-back hydration.
10. Generalize shared orchestration so rate-type-specific strategy config controls cadence/refresh/API behavior.

Exit criteria:

- DA card end-to-end fetch/caching uses shared incremental pipeline architecture.
- RT <-> DA switching preserves window and hydrates from each type cache before missing-span fetch.

## Phase 4 - Residential Support (Deferred)

1. Add `residential` source/model wiring after RT + DA stabilization.

## Phase 5 - Prototype Retirement Plan

1. Produce prototype endpoint/file/table retirement inventory.
2. Confirm all active clients use v4 paths.
3. Remove prototype rates flows in controlled cutover.

## Test Plan

## Automated tests

### Frontend behavior tests

1. Initial selected card is `commercial_realtime`.
2. Initial load triggers RT fetch and selected-card loading bar.
3. Status labels cycle every 2 seconds between the two required labels.
4. Loading bar slows/stalls near completion while awaiting data.
5. Chart updates when data is ready, not when 5-second timer elapses.
6. Previous chart data remains visible during refetch.
7. Period controls are exactly `day/week/month`; date picker exists.
8. `week` and `month` use rolling window behavior in project local timezone.
9. Range/period change triggers new fetch and selected-card loading feedback.
10. Legend includes `Missing data`.
11. Missing time spans render as red crosshatch overlays.

### API contract tests

1. `/api/v4/rates/series` validates required params.
2. RT series returns 5-minute base points.
3. 30-minute/hourly aggregations use non-null-only averages.
4. Buckets with all-null members return null.
5. Retry-once behavior is applied on transient source failure.
6. Response does not include gap metadata (current phase).
7. v4 endpoints do not alter v3/prototype endpoint behavior.

### LocalStorage/cache tests

1. Cache partition/fingerprint includes `{projectId, rateType, timezone}` and invalidates on project location change.
2. Canonical cache store uses UTC ISO timestamp keys for 5-minute RT points.
3. Contains-window lookup hydrates chart from existing coverage before remote fetch.
4. Missing-span detection requests only uncovered spans (single-range API calls).
5. Span merge updates canonical store and recomputes 30-minute/hourly aggregates correctly.
6. Historical points remain immutable once stored.
7. Tail refresh runs every 5 minutes and updates only eligible near-real-time points.
8. Retry-once behavior applies for span fetch failures.
9. On 429, all pending span fetches pause and resume eligibility after countdown.
10. Per-span error metadata is stored and queryable for debugging.
11. Manual `Fetch data` bypasses cache and writes fresh payload.

## MCP UI verification requirements

For each v4 UI milestone, Chrome DevTools MCP verification is required:

1. Sidebar nav visibility and route behavior.
2. Card selection and active visuals.
3. Loading bar + label cycling behavior.
4. API error label visibility and content (including 429 messaging).
5. 429 countdown behavior and button disabled/enabled transitions.
6. Chart update timing vs loading animation timing.
7. Missing span crosshatch rendering and legend item.

## Manual verification checklist

1. `node --check` every edited frontend JS file.
2. `npm run -s test`.
3. Chrome DevTools MCP walkthrough on `/projects/rates-v4.html`.
4. Validate project navigation and `projectId` continuity.

## Open Items

1. Exact DA source/cadence rules (later phase).
2. Exact residential source definition (later phase).

## Task Tracker

Status legend:

- `pending`
- `in_progress`
- `blocked`
- `completed`

MCP access legend:

- `Yes` = requires MCP tool access to execute
- `No` = does not require MCP tool access

| ID | Task | Status | Requires MCP | Notes |
|---|---|---|---|---|
| V4-T01 | Add v4 task tracker with MCP flags to this plan document | completed | No | Done. |
| V4-T02 | Scaffold `rates-v4` UI page (`rates-v4.html` + `rates-v4.js`) with summary + chart sections | completed | No | Done. |
| V4-T03 | Add v4 summary card UI (3 cards, 200px width, single-select with visual active state) | completed | No | Done. |
| V4-T04 | Wire shared chart primitives (`EnergyChartUI`, `EnergyTimeSeriesChart`) into v4 page | completed | No | Done. |
| V4-T05 | Add v4 styling in `styles.css` for cards + layout + responsive behavior | completed | No | Done. |
| V4-T06 | Add automated frontend tests for v4 card selection and chart state transitions | completed | No | Added `rates-v4-ui-state`, `v4-aggregation`, and v4 API contract tests. |
| V4-T07 | Implement `/api/v4/rates/series` RT server-side fetch contract | completed | No | New endpoint added in local + serverless routers. |
| V4-T08 | Implement v4 `localStorage` cache contract/versioning (TTL 5 minutes) | completed | No | Versioned window cache with TTL and force-refresh bypass. |
| V4-T09 | Implement RT initial-load defaults (`commercial_realtime`, `week`, `last 6 days -> tomorrow`) | completed | No | Default selection + rolling window behavior implemented. |
| V4-T10 | Implement selected-card loading bar UX (approx 5s, slow/stall near complete, 2s label cycle) | completed | No | Card-only loading with 2s label cycle and 429 countdown state. |
| V4-T11 | Implement RT interval aggregation (5-min -> 30-min/hourly non-null averages) and cache pre-aggregated series | completed | No | Non-null partial averages, null-preserving buckets, cached aggregates. |
| V4-T11A | Define v4 unified cache-engine interfaces (coverage index, point store, span error store) for RT-first reuse | completed | No | Architecture scaffold added via `rates-v4-cache-engine` interfaces. |
| V4-T11B | Implement canonical 5-minute RT point store in localStorage using UTC ISO timestamp keys | completed | No | Canonical 5-minute UTC point store persisted by cache engine. |
| V4-T11C | Add cache fingerprint invalidation on project location change (`projectId + rateType + timezone + location fingerprint`) | completed | No | Location-fingerprint invalidation wired in engine load path. |
| V4-T11D | Implement contains-window cache hydration and partial-window immediate chart rendering | completed | No | Window payload hydrates from cached coverage before remote fetch. |
| V4-T11E | Implement missing-span detection and missing-only span fetch (single-range API calls) | completed | No | Missing spans computed and fetched individually (single-range calls). |
| V4-T11F | Implement span merge pipeline: merge points + rebuild 30-min/hourly aggregates from cached 5-minute base | completed | No | Span merge + aggregate rebuild implemented with historical immutability. |
| V4-T11G | Implement 5-minute RT tail refresh scheduler and retry-once per span fetch | completed | No | 5-minute tail refresh scheduler wired to incremental span fetch path. |
| V4-T11H | Implement global 429 span-fetch pause/resume + per-span error metadata persistence for debugging | completed | No | Global 429 pause state blocks pending span fetches; per-span errors persisted. |
| V4-T11I | Add automated tests for unified cache engine (contains lookup, missing spans, merge, immutability, 429 pause, span errors) | completed | No | Added cache-engine + UI-state tests for scheduler/pause/missing-span flows. |
| V4-T12 | Implement missing span visualization with red crosshatches + `Missing data` legend | completed | No | Missing overlay + `Missing data` legend implemented on v4 chart. |
| V4-T13 | Implement period/range refetch behavior with previous chart retained | completed | No | Period/range changes now hydrate from cache and fetch missing spans. |
| V4-T14 | Implement retry-once + manual `Fetch data` button behavior | completed | No | Retry-once + manual Fetch data behavior implemented. |
| V4-T19 | Implement API error status labels in selected-card loading area | completed | No | Upstream/API error text is surfaced in selected-card status area. |
| V4-T20 | Implement HTTP 429 countdown label + disable/enable `Fetch data` button during wait window | completed | No | Countdown + disable/enable behavior implemented with global 429 pause. |
| V4-T16 | Add `commercial_day_ahead` support after RT completion | completed | No | Hourly DA with 30-minute tail refresh is now wired end-to-end. |
| V4-T16A | DA card selection and active-state wiring (click card selects DA) | completed | No | DA card selection now preserves current user-selected window on RT <-> DA switch. |
| V4-T16B | DA card-scoped fetch/loading controls (selected card only) | completed | No | Switching cards now moves active fetch/loading controls to selected card. |
| V4-T16C | DA API adapter + `/api/v4/rates/series` DA mode contract | completed | No | Added DA mode contract with single-range request style retained. |
| V4-T16D | DA incremental cache integration using unified engine (missing spans, merge, per-span errors) | completed | No | DA now uses unified cache engine with missing-span fetch + merge + per-span errors. |
| V4-T16E | Bidirectional cache-first switch behavior (RT <-> DA) with cache retention | completed | No | RT <-> DA switching now hydrates selected-type cache first, then fetches missing spans. |
| V4-T16F | DA automated tests (window preservation, card-scoped loading, missing-span fetch, bidirectional cache-first switching) | completed | No | Added/updated automated tests for DA hourly-only controls, cadence, and DA contract acceptance. |
| V4-T16G | Implement v4 adapter 7-day-first chunk strategy for RT + DA with 30-day windows split into ~7-day chunks | completed | No | Primary chunk strategy moved to 7-day-first for both RT and DA. |
| V4-T16H | Add adaptive chunk fallback (retry-after aware retry-once, then split failing chunks to smaller spans) | completed | No | Failing chunks now split adaptively with cooldown-aware retry behavior. |
| V4-T16I | Add rate-type execution tuning in adapter (RT modest parallelism, DA serialized pacing) | completed | No | RT concurrency default tuned to 2; DA remains single-worker with inter-chunk pacing. |
| V4-T16J | Add adapter diagnostics for chunk execution stats to v4 response details | completed | No | details.adapterStats now reports chunk attempts/splits/retry waits for debugging. |
| V4-T17 | Add `residential` support after RT + DA completion | in_progress | No | Activated. |
| V4-T17A | Create unified `California adapter` for CAISO-backed v4 rates (RT + DA + Residential) and migrate v4 CAISO adapter logic under it | completed | No | Added `lib/rates/california-adapter.js`; RT/DA proxied through CAISO adapter and Residential served from local NEM dataset. |
| V4-T17B | Define/lock utility normalization map from project utility fields to supported CA utility keys (`pge`, `sce`, `sdge`) | completed | No | Canonical utility-code-first normalization is implemented across provider, API, and California adapter. |
| V4-T17C | Rewrite residential JSON utility keys/metadata to match app utility naming contract | completed | No | Residential dataset keys resolved via canonical utility codes (`pge`,`sce`,`sdge`) in adapter path. |
| V4-T17D | Implement Residential card selection + card-scoped fetch button/loading UX parity with RT/DA | completed | No | Residential card now has fetch button and selected-card loading UI with `Fetching NEM 3.0 data` label. |
| V4-T17E | Implement Residential data retrieval from repo JSON via California adapter (no external API call) | completed | No | API now serves Residential hourly series from `docs/data/nem3-hourly-rates-2026.json` via California adapter. |
| V4-T17F | Implement Residential window policy: show 2026 data only and null/missing outside 2026 (no hard failure for partial overlap) | completed | No | Out-of-range windows remain chart-safe with null/missing points and user-facing `data only available for 2026` status text. |
| V4-T17G | Implement Residential unsupported-utility error: `data not available for this utility`; keep blank/missing chart visible | completed | No | Unsupported utility now returns chart-safe null series plus user-facing status text `data not available for this utility`. |
| V4-T17H | Restrict Residential intervals to hourly only across day/week/month controls | completed | No | Residential interval controls are hourly-only for day/week/month. |
| V4-T17I | Integrate Residential into unified cache engine using same store/coverage/error metadata style as RT/DA | completed | No | Residential now uses same localStorage cache partitioning, missing-span, merge, and span-error model as RT/DA. |
| V4-T17J | Residential automated tests (utility mapping, 2026 boundary behavior, unsupported utility, hourly-only controls, cache hydration/missing rendering) | completed | No | Added/updated v4 API and UI-state tests; `npm run -s test` passing. |
| V4-T17K | Chrome DevTools MCP validation for Residential flow (supported utility, unsupported utility, partial-out-of-range window, RT/DA switch-back cache retention) | pending | Yes | Required before prototype retirement. |
| V4-T17L | Add polygon-based California utility territory resolver (3 utility polygons) to provider metadata flow | completed | No | Implemented via GeoJSON + point-in-polygon; CAISO utility inference has no fallback to default utility. |
| V4-T17M | Persist `utility_code` on projects and wire provider/location updates to store and reuse it | completed | No | Added project schema/migration + frontend persistence wiring. |
| V4-T17N | Wire CAISO RT/DA node selection to canonical `utilityCode` mapping (`pge` -> NP15, `sce/sdge` -> SP15) | completed | No | Node resolver now prioritizes canonical utility codes before latitude fallback. |
| V4-T18 | Prepare prototype retirement inventory once v4 is complete | pending | Yes | Removal phase only. |



