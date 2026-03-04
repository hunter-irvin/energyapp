# Rates DB-First Progressive Sync Implementation Plan

## Purpose

This document is the canonical implementation plan for improving Rates sync UX and performance with:

1. DB-first data visibility (show what exists before fetching)
2. Progressive missing-window retrieval
3. Per-rate-class availability progress in the debug table
4. Serverless route consolidation to stay under Vercel limits
5. Full docs parity with implemented behavior

Update this file continuously as work lands.

## Scope (Locked)

1. DB-first always: query existing `rate_project_series` first for the active window.
2. Fetch only missing periods/chunks after DB coverage inspection.
3. Progress bars appear in debug table under `Data Availability` columns (replace `Source` columns).
4. Source details remain in expandable diagnostics row only.
5. Track progress independently for `LMP-RT`, `LMP-DA`, `Tariff`.
6. Build on existing fingerprints/cache (`rates_source_fingerprint`, `rate_project_series`) rather than introducing a parallel cache.
7. Consolidate production serverless routes to fewer than 10 functions.

## Status Legend

- `NOT_STARTED`
- `IN_PROGRESS`
- `BLOCKED`
- `DONE`

## Master Tracker

| Step ID | Title | Status | Tests Required | MCP Required | Notes |
|---|---|---|---|---|---|
| R1 | Define v3 contracts for DB-first coverage + progress payloads | DONE | T1, T2 | No | Implemented via `series/status` response extensions with folded coverage payload. |
| R2 | Implement DB-first coverage planner and missing-chunk selection | DONE | T3, T4 | Supabase MCP (verification) | Implemented planner skips upstream fetch for covered windows and computes missing ranges only. |
| R3 | Add chunk progress persistence and per-class progress aggregation | DONE | T5, T6 | Supabase MCP (verification) | Implemented with durable `rate_sync_chunks` lifecycle tracking and status aggregation. |
| R4 | Execute visible-window-first chunk retrieval + incremental upserts | DONE | T7, T8 | No | Implemented per-chunk upserts with visible-window completion before queued rolling backfill. |
| R5 | CAISO chunking tuning for speed + hard constraints | DONE | T9, T10 | Chrome MCP (network timing), Supabase MCP | Implemented <=31-day cap, RT/DA chunk heuristics, and bounded CAISO concurrency. |
| R6 | Rates debug-table UI: replace Source columns with Data Availability bars | DONE | T11, T12 | Chrome MCP | Table now shows Data Availability bars; source details remain in diagnostics rows. |
| R7 | Incremental chart refresh and high-frequency active-job polling | DONE | T13, T14 | Chrome MCP | Implemented fast active polling with automatic idle fallback and guarded incremental chart refresh. |
| R8 | Serverless route consolidation (<10 functions) | DONE | T15, T16 | No | Consolidated route surface through `api/[...path].js`; active `.js` serverless entries now <10 with parity coverage tests. |
| R9 | Documentation alignment (README + architecture + rates + migration playbook) | DONE | T17 | No | Updated docs to match DB-first progressive sync, consolidated serverless routing, and dynamic rates polling behavior. |
| R10 | Frontend and status hardening for loading/progress correctness | DONE | T18, T19, T20, T21, T22 | Chrome MCP, Supabase MCP | Implemented null-safety, progress reconciliation fallback, sync timeout/abort handling, stale queued messaging, and stable status-shape fallback. |
| R11 | Period-window DB-first reload + gap fetch + extent-labeled availability bars | DONE | T23, T24, T25, T26, T27 | Chrome MCP, Supabase MCP | Implemented window-scoped DB-first reloads, missing-gap sync enqueue on window changes, full-window RT reads (no 1000-row truncation), and start/end extent labels on availability bars. |
| R12 | Repair false DA zeros + enforce missing-as-null/backfill behavior | DONE | T28, T29, T30, T31, T32 | Chrome MCP, Supabase MCP | Implemented DA parser hardening (no MW fallback), value-aware DB-first/status coverage counts, repair SQL utility/script, and verified Feb DA false-zero repair in Supabase. |
| R13 | RT false-zero hardening + guaranteed window sync trigger + queued-progress clarity | IN_PROGRESS | T33, T34, T35, T36, T37 | Chrome MCP, Supabase MCP | Prevent RT false-zero persistence, trigger visible-window sync from both reload paths when coverage is incomplete, and improve queued-state messaging when worker is not draining jobs. |

## Step Details

### R1 - Contracts

#### Implementation

1. Extend `GET /api/v3/series/rates` metadata:
   - `expectedPoints`, `availablePoints`, `missingPoints`, `coveragePct`, `qualityStatus`
2. Extend `GET /api/v3/sync/rates/status`:
   - per-class progress and active chunk info
3. Add or fold coverage response:
   - `GET /api/v3/coverage/rates` (preferred) or include in status payload

#### Tests

- T1 `tests/api/v3/rates-contracts.test.js`
  - validates new metadata/progress fields
- T2 `tests/api/v3/rates-compatibility.test.js`
  - verifies current clients still parse response safely

---

### R2 - DB-first planner

#### Implementation

1. Compute existing coverage from `rate_project_series` for requested window per class.
2. Build chunk plan only for missing ranges.
3. Return DB coverage immediately to caller even before fetch completion.

#### Tests

- T3 `tests/rates/db-first-coverage-planner.test.js`
  - full-coverage window yields zero fetch chunks
- T4 `tests/rates/missing-range-chunking.test.js`
  - partial coverage yields chunks only for missing periods

#### Verification

- Supabase MCP query checks on `rate_project_series` vs returned coverage payload.

---

### R3 - Progress persistence

#### Implementation

1. Persist chunk lifecycle (`queued/running/completed/failed`) per class and time range.
2. Aggregate class-level and overall progress for status endpoint.
3. Include failure detail per chunk for diagnostics.

#### Tests

- T5 `tests/jobs/rates-chunk-lifecycle.test.js`
- T6 `tests/jobs/rates-progress-aggregation.test.js`

#### Verification

- Supabase MCP checks for durable progress rows/state during active and completed jobs.

---

### R4 - Visible-window-first retrieval

#### Implementation

1. Fetch visible window first in small chunks.
2. Upsert after each chunk and update progress state.
3. Backfill older periods only after visible window reaches target coverage.

#### Tests

- T7 `tests/rates/visible-window-priority.test.js`
- T8 `tests/rates/incremental-upsert-and-resume.test.js`

---

### R5 - CAISO speed + chunking

#### Implementation

1. Keep hard cap of CAISO request range <=31 days.
2. Use smaller default chunks:
   - RT: 2-6 hour chunks
   - DA: 24-hour chunks for visible window, larger for backfill
3. Bound concurrency to protect upstream and improve perceived latency.

#### Tests

- T9 `tests/rates/caiso-request-window-cap.test.js`
- T10 `tests/rates/caiso-chunk-plan-performance-heuristics.test.js`

#### Verification

- Chrome MCP network checks for request size and request cadence.
- Supabase MCP checks that visible-window chunks complete earlier than backlog.

---

### R6 - Debug table Data Availability bars

#### Implementation

1. Replace `Source` columns with `Data Availability` for Tariff/RT/DA in debug table.
2. Render per-class bar segments:
   - Green: persisted in DB
   - Yellow: currently fetching
   - Gray: outstanding/unavailable
3. Keep source text only in expandable diagnostics section.

#### Tests

- T11 `tests/frontend/rates-debug-table-columns.test.js`
- T12 `tests/frontend/rates-availability-bars.test.js`

#### Verification

- Chrome MCP snapshot checks for column names and per-class bar rendering.

---

### R7 - Incremental UI updates

#### Implementation

1. During active rates job, poll status/coverage quickly (e.g. 2s).
2. On idle/complete, revert to normal slow polling interval.
3. Update chart after each chunk commit if active class/window coverage changed.

#### Tests

- T13 `tests/frontend/rates-active-vs-idle-polling.test.js`
- T14 `tests/frontend/rates-incremental-chart-refresh.test.js`

#### Verification

- Chrome MCP network + snapshot checks while sync is running.

---

### R8 - Serverless consolidation

#### Implementation

1. Consolidate route files through a single serverless route multiplexer: `api/[...path].js`.
2. Retire nested endpoint wrappers (`api/v2/*`, `api/v3/*`, `api/rates/*`) to non-serverless `.legacy` files.
3. Ensure total active `.js` serverless functions in deployment stays <10.
4. Preserve behavior parity with local `server.js` contracts and handlers.

#### Tests

- T15 `tests/parity/route-count-and-mapping.test.js`
- T16 `tests/parity/local-vs-serverless-routes.test.js`

---

### R9 - Documentation

#### Implementation

Update all authoritative docs to reflect shipped behavior:

1. `README.md`
2. `docs/architecture.md`
3. `docs/rates.md`
4. `docs/v3-sync-migration-playbook.md`

#### Tests

- T17 `tests/docs/v3-rates-doc-parity.test.js`
  - verifies contract/mode/polling statements match current implementation.

---

### R10 - Frontend/status hardening

#### Implementation

1. Add null-safety guards in chart feedback/render paths (`applyChartFeedbackState` and related helpers) to prevent `.length`/undefined crashes.
2. Reconcile progress from both sources:
   - status payload (`/api/v3/sync/rates/status`) when available
   - fallback derived from loaded series coverage (`/api/v3/series/rates`) when status is stale/queued.
3. Improve loading-state lifecycle:
   - add timeout + abort for `POST /api/v3/sync/rates` manual refresh path
   - ensure spinner/disabled refresh always clears on timeout/error/failure
   - keep existing chart data visible when sync calls fail.
4. Normalize status payload mapping:
   - strict key handling for per-class progress (`tariff`, `lmpRt`, `lmpDa`)
   - deterministic defaults for missing fields.
5. Add explicit user-facing fallback messaging for stale queue/pending sync scenarios.

#### Tests

- T18 `tests/frontend/rates-null-safety-feedback.test.js`
  - missing/undefined payload fields do not crash render or interactions.
- T19 `tests/frontend/rates-progress-reconciliation.test.js`
  - non-empty series with stale/queued status still yields DB coverage >0 in availability bars.
- T20 `tests/frontend/rates-sync-timeout-unblocks-ui.test.js`
  - pending sync request timeout clears loading state and re-enables refresh.
- T21 `tests/api/v3/rates-status-shape-guarantee.test.js`
  - status payload includes stable per-class/overall progress shape or explicit null defaults.
- T22 `tests/frontend/rates-loading-indicators-state-machine.test.js`
  - loading indicators transition correctly across success, timeout, and failure.

#### Implementation Notes (Completed)

1. `public/assets/js/pages/rates.js`
   - Null-safe chart readiness checks now rely on `rawPoints` presence.
   - Added progress normalization and dual-source reconciliation (`status` + derived series/health fallback).
   - Added stale-queued fallback message and active/idle polling stabilization.
   - Added `AbortController` timeout guard for sync requests and ensured manual refresh clears loading state in `finally`.
2. `api/v3-proxy.js`
   - Added stable default status coverage shape (`tariff`, `lmpRt`, `lmpDa`, `overall`) and fallback handling in status route.
3. `tests/*`
   - Added T18-T22 source-level regression checks and wired them into `tests/run-tests.js`.
#### Verification

- Chrome MCP:
  - confirm no render exceptions during RT/DA/Tariff month switching.
  - confirm bars transition from pending to DB coverage when series data exists.
  - confirm refresh timeout behavior recovers UI without full reload.
- Supabase MCP:
  - confirm queued/running/completed job transitions are reflected in `ingestion_jobs`/`domain_sync_state` and surfaced in status payloads.

---

---

### R11 - Window-scoped reload + extent labels

#### Implementation

1. Window-scoped DB-first read on every chart window change:
   - Trigger on period/date/interval changes.
   - Build exact active chart window (`windowStart`, `windowEnd`) and fetch `GET /api/v3/series/rates` for selected class.
   - Ensure API returns all rows for the window (no silent 1000-row truncation; paginate or explicit ranged reads).
2. Missing-gap retrieval for that same window:
   - If coverage `< 100%`, enqueue/execute `POST /api/v3/sync/rates` for the same window.
   - Fetch only missing spans/chunks; preserve DB-first display of already available points.
3. Data Availability bar semantics pinned to chart window extents:
   - Compute `%` strictly against the active chart window for each class.
   - Keep segment colors: green=DB, yellow=active retrieval, gray=missing.
4. Add extent labels around each availability bar:
   - Left label = window start timestamp.
   - Right label = window end timestamp.
   - Use project timezone formatting; fall back to UTC when unavailable.
5. Keep UI responsive during progressive fill:
   - Repaint chart incrementally as chunks land.
   - Update availability percentages and extent labels without full page reload.

#### Tests

- T23 `tests/api/v3/rates-window-complete-read.test.js`
  - verifies full-window RT read is not capped/truncated.
- T24 `tests/frontend/rates-window-change-db-first-reload.test.js`
  - period/date/interval changes immediately render DB data for the new window.
- T25 `tests/frontend/rates-window-missing-gap-fetch.test.js`
  - missing segments trigger sync for the same window and progressively fill.
- T26 `tests/frontend/rates-availability-bar-extents.test.js`
  - availability bars render left/right extent labels matching active window.
- T27 `tests/frontend/rates-window-scoped-percentages.test.js`
  - percentage denominator equals active chart window expected points per class cadence.

#### Verification

- Chrome MCP:
  - switch Day/Week/Month and date ranges; confirm chart reloads from DB immediately.
  - confirm extent labels change with the selected window and match visible period controls.
  - confirm percentages increase as missing chunks are retrieved.
- Supabase MCP:
  - validate returned row counts for RT/DA/Tariff match expected points for tested windows.
  - validate missing-only chunk retrieval writes only absent spans.
### R13 - RT false-zero hardening + sync trigger reliability

#### Implementation

1. RT CAISO parser hardening:
   - Remove non-price fallback fields in RT parsing (mw, generic value) so missing intervals stay missing.
   - Accept only explicit LMP price fields for persisted RT prices.
2. RT false-zero repair tooling:
   - Extend repair SQL builder/script to support both DA and RT modes.
   - Add RT-specific repair code marker for audit (R13_FALSE_ZERO_REPAIRED_RT).
3. Guaranteed missing-window sync trigger on user navigation:
   - Ensure both reloadWindowScopedData and reloadAll trigger visible_window sync when active feed coverage <100% or status reports missing points.
   - Preserve DB-first immediate render before sync completion.
4. Queued/progress UX hardening:
   - Improve sync banner messaging when jobs are queued and missing points are still outstanding.
   - Distinguish stale queued-with-missing from benign queued states.

#### Tests

- T33 tests/rates/caiso-da-parser-no-mw-fallback.test.js
  - verifies RT and DA both ignore non-price-only rows.
- T34 tests/migration/rates-caiso-rt-zero-repair.test.js
  - verifies RT repair SQL targets CAISO/RT zero rows and stamps RT repair code.
- T35 tests/frontend/rates-gap-triggers-visible-window-sync.test.js
  - verifies window sync trigger uses consolidated predicate (shouldTriggerVisibleWindowSync) for coverage+status.
- T36 tests/frontend/rates-loading-indicators-state-machine.test.js
  - verifies queued-state fallback messaging remains present and user-visible.
- T37 Chrome+Supabase MCP verification
  - Chrome: monthly RT/DA navigation emits visible-window sync POST when active feed incomplete.
  - Supabase: queued/running/completed transitions and reduced RT false-zero counts after repair.

#### Verification

1. Chrome MCP:
   - load February month in RT/DA and confirm sync status calls plus visible-window sync POST on incomplete windows.
   - confirm status banner explicitly indicates queued-with-missing when worker is stale.
2. Supabase MCP:
   - validate RT zero-row audit query before/after repair execution.
   - validate queued jobs drain when worker runs and coverage percentages update.

---
## MCP Usage Matrix

### Supabase MCP required when:

1. Validating DB-first coverage against `rate_project_series`.
2. Validating chunk progress persistence and job transitions.
3. Verifying per-class coverage counts and timestamps after chunk sync.

### Chrome DevTools MCP required when:

1. Verifying live UI progress bars in debug table.
2. Validating active polling/refresh behavior in browser.
3. Inspecting request cadence and payload behavior during active chunking.

### MCP not required when:

1. Running unit/integration tests locally (`npm run -s test`).
2. Static code changes and route grouping refactors.
3. Documentation updates.

## Acceptance Criteria (Final)

1. On Rates load, existing DB coverage is visible immediately for each class.
2. Missing windows are fetched in chunks with visible progress updates.
3. Debug table shows `Data Availability` bars (source removed from table columns).
4. Visible window data appears before older backlog fill completes.
5. Production serverless route count remains below 10.
6. All tests for R1-R12 pass and docs match behavior.

## Change Log

- 2026-03-03: Added R12 plan for CAISO DA false-zero repair, value-aware missing coverage, migration cleanup, and missing-triggered visible-window refetch with UI verification.
- 2026-03-03: R11 completed (window-scoped DB-first reload on chart window changes, missing-gap visible-window sync, full-window RT series reads without truncation, and left/right extent labels on Data Availability bars with window-scoped percentages).
- 2026-03-02: R9 completed (updated README/architecture/rates/v3 migration playbook to reflect DB-first progressive sync + consolidated serverless routing + dynamic rates polling; added T17 docs parity test).
- 2026-03-02: R8 completed (serverless route consolidation via api/[...path].js, retired nested wrapper endpoints to .legacy, and added T15/T16 parity coverage for mapping + response parity).
- 2026-03-02: R7 completed (active 2s polling during running jobs + idle fallback polling + per-feed progress signature incremental refresh guard + T13/T14 tests).
- 2026-03-02: R6 completed (debug table Data Availability columns + per-feed green/yellow/gray bars + T11/T12 tests).
- 2026-03-02: R5 completed (CAISO <=31-day cap + RT/DA chunk heuristics + bounded concurrency + T9/T10 tests).
- 2026-03-02: R4 completed (incremental per-chunk upserts + visible-window background rolling enqueue + T7/T8 tests).
- 2026-03-02: R3 completed (rate_sync_chunks migration + queued/running/completed/failed lifecycle writes + status aggregation + T5/T6 tests; Supabase MCP verified table).
- 2026-03-02: R2 completed (DB-first rates planner + missing-range selection + T3/T4 tests + store read method).
- 2026-03-02: R1 completed (rates series metadata coverage fields + rates sync status progress/coverage payloads + T1/T2 tests).
- 2026-03-02: Initial plan created from implementation discussion (DB-first, progress-in-table, serverless consolidation).










### R12 - False DA zeros repair + missing-triggered retrieval

#### Implementation

1. CAISO DA parse hardening:
   - Remove non-price fallback fields that can coerce missing prices into '0' (notably 'mw') in DA price parsing.
   - Accept only valid DA price fields ('lmp', 'lmp_prc') as numeric values.
2. Missing classification hardening (DB-first + status):
   - Treat a timestamp as available only when 'value' is finite numeric and not null.
   - Ensure coverage/plan calculations are value-aware (not row-presence-only).
3. One-time data repair migration for existing erroneous zeros:
   - Target CAISO DA rows where source='rates_proxy_phase3_live_caiso_oasis' and known false-zero pattern windows.
   - Convert affected rows to missing representation (preferred: delete affected rows so DB-first planner detects gaps).
4. Retrieval behavior:
   - On chart-window load/update, any missing window caused by repaired rows must enqueue visible-window sync and refill incrementally.
5. Rendering behavior:
   - Missing periods must render as missing overlay (red hatch), never as flat zero values unless upstream actually returns numeric zero with valid price field.

#### Tests

- T28 tests/rates/caiso-da-parser-no-mw-fallback.test.js
  - verifies DA parser does not use mw as fallback price and emits missing for records without LMP fields.
- T29 tests/rates/db-first-coverage-value-aware.test.js
  - verifies coverage planner counts only finite value rows as available coverage.
- T30 tests/migration/rates-caiso-da-zero-repair.test.js
  - verifies migration removes/repairs only targeted erroneous CAISO DA zero rows and leaves legitimate rows untouched.
- T31 tests/frontend/rates-missing-overlay-vs-zero.test.js
  - verifies repaired DA gaps render as missing overlay (not flat zero line).
- T32 tests/frontend/rates-gap-triggers-visible-window-sync.test.js
  - verifies missing DA periods immediately trigger visible-window sync and chart refresh as rows are refilled.

#### Verification

1. Supabase MCP:
   - pre/post migration row audit for February DA window:
     - zero_values decreases to expected/legitimate level.
     - missing timestamps become absent (or null) and are detected as missing coverage.
   - confirm refilled rows arrive after sync job completes.
2. Chrome MCP:
   - DA chart for February shows missing overlay bands (not zero line) immediately after repair.
   - visible-window sync starts automatically and progressively replaces missing overlays with fetched DA values.
   - Data Availability bar percent updates with each refill chunk.
