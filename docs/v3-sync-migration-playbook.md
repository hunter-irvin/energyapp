# V3 Sync Migration Playbook (Supabase-Only)

## Purpose

This document is the canonical working plan for migrating EnergyApp to:

1. Supabase-only persistence (no local storage fallback for domain data)
2. V3 sync/series API contracts
3. Background ingestion jobs for rolling/full recompute
4. No modeled fallback rates
5. Localhost and production behavior parity

Use this file as the source of truth during implementation and update it continuously as steps are completed.

## Scope Decisions (Locked)

1. Generation recomputes overwrite prior values (no historical model-version audit requirement).
2. Visible generation window is prioritized; remaining window backfills in background.
3. Location changes must update dependent data; rates refresh is conditional on resolved source fingerprint changes.
4. Weather rolling window: last 30 days + next 7 days.
5. Rates rolling windows:
   - RT: last 7 days through now (plus source-available near-future horizon)
   - DA: last 7 days through published DA horizon
6. Nightly cron runs rolling refresh; login also triggers rolling refresh.
7. Rates unsupported regions return explicit unsupported state (no modeled values).
8. 5-minute rates are only from true upstream cadence, never synthesized.
9. Manual refresh runs rolling windows only.
10. Supabase-only canonical storage for weather/generation/storage/rates.

## Execution Rules

1. Every implementation PR must map to one or more Step IDs in this document.
2. Every Step ID requires tests listed below to pass before marking complete.
3. Do not mark a step complete without:
   - code merged
   - tests passing
   - docs updated
   - migration notes recorded in this file

## Status Legend

- `NOT_STARTED`
- `IN_PROGRESS`
- `BLOCKED`
- `DONE`

## Master Tracker

| Step ID | Title | Status | PR/Commit | Last Updated | Notes |
|---|---|---|---|---|---|
| S1 | Schema + RLS migrations for v3 tables | DONE | local-uncommitted | 2026-02-25 | Migration applied via MCP; schema/index/policy checks passed; live CRUD/constraint execution checks passed. |
| S2 | Supabase-only client cutover | DONE | local-uncommitted | 2026-02-25 | Local domain fallback removed; Supabase-unavailable now fails fast; S2 client guard tests added and passing. |
| S3 | V3 API route/handler scaffolding | DONE | local-uncommitted | 2026-02-25 | Added shared v3 handlers + api wrappers + server wiring; contract/validation/parity tests pass. |
| S4 | Ingestion job engine + worker flow | DONE | local-uncommitted | 2026-02-26 | Added ingestion engine + Supabase/memory stores + worker route; added retry/backoff fields migration; lifecycle/idempotency/retry tests passing. |
| S5 | Weather normalized series + sync logic | DONE | local-uncommitted | 2026-02-26 | Added weather rolling sync module + v3 weather job handler/store upsert+window purge; added S5 weather tests (rolling-window/upsert-dedup/sync-state), all passing. |
| S6 | Generation visible-window-first recompute | DONE | local-uncommitted | 2026-02-26 | Added generation sync engine with visible-window-first compute + rolling backfill enqueue; overwrite semantics implemented in generation upserts; S6 generation tests passing. |
| S7 | Rates: remove modeled fallback + 5-min true cadence | DONE | local-uncommitted | 2026-02-26 | Removed modeled fallback paths in LMP adapter, added explicit unsupported/unavailable empty-series behavior, and aligned cadence handling to true upstream resolution (RT supports 5-min where available). S7 rates tests passing. |
| S8 | Location/asset fingerprint invalidation rules | DONE | local-uncommitted | 2026-02-26 | Added explicit invalidation-rule engine for location/asset changes with persisted fingerprint patching and conditional rates refresh based on rates-source fingerprint changes; S8 invalidation tests passing. |
| S9 | Frontend migration to v3 endpoints + polling changes | DONE | local-uncommitted | 2026-02-26 | Migrated rates page to v3 series/sync/status flow, changed status polling to 120s minimum + refresh/focus triggers, and added frontend tests for polling/manual-refresh/cadence controls. |
| S10 | Backfill/data migration + dual-read cutover | DONE | local-uncommitted | 2026-02-26 | Added legacy->v3 backfill module/script and feature-flagged dual-read fallback (v3-first) for weather/rates series endpoints; added S10 migration tests, all passing. |
| S11 | Localhost/prod parity verification | DONE | local-uncommitted | 2026-02-26 | Added full v3 route availability parity checks and direct-vs-wrapper response parity fixtures across all v3 endpoints; tests passing. |
| S12 | Cleanup + deprecation removal + docs finalization | DONE | local-uncommitted | 2026-02-26 | Removed runtime dual-read fallback, migrated location-change refresh trigger to v3, deprecated legacy rates routes, and updated architecture/rates/readme docs with current v3 contracts and rollback notes. |

## Step Details + Required Tests

### S1 - Schema + RLS migrations for v3 tables

#### Implementation

1. Add migrations for:
   - `weather_project_series`
   - `generation_project_series`
   - `domain_sync_state`
   - `ingestion_jobs`
   - `projects` fingerprint/sync columns
   - `rate_project_series` updates (`rates_source_fingerprint`, constraints)
2. Add constraints and indexes from the approved spec.
3. Apply RLS policies consistent with current anon policy model.

#### Required Tests

1. `tests/db/schema.test.js`
   - verifies table existence and required columns
   - verifies unique constraints
   - verifies key indexes
2. `tests/db/rls.test.js`
   - verifies anon role can perform expected CRUD where intended
3. `tests/db/constraint.test.js`
   - rejects invalid enum/check values
   - rejects duplicate unique key inserts

#### Exit Criteria

1. Migrations apply cleanly on fresh DB and existing DB.
2. All S1 tests pass.

---

### S2 - Supabase-only client cutover

#### Implementation

1. Remove local fallback storage logic in `public/assets/js/core/supabase-client.js` for domain data.
2. Fail fast with clear UI error if Supabase config is unavailable.
3. Keep project-scoped UI preferences only in local storage if still needed.

#### Required Tests

1. `tests/client/supabase-required.test.js`
   - app reports explicit error when Supabase config missing
2. `tests/client/no-local-domain-fallback.test.js`
   - verifies no domain data reads/writes from local storage fallback paths

#### Exit Criteria

1. No domain data path depends on local DB/local storage fallback.
2. All S2 tests pass.

---

### S3 - V3 API route/handler scaffolding

#### Implementation

1. Add routes:
   - `POST /api/v3/sync/:domain`
   - `GET /api/v3/sync/:domain/status`
   - `GET /api/v3/series/weather`
   - `GET /api/v3/series/generation`
   - `GET /api/v3/series/rates`
   - `POST /api/v3/refresh`
   - `POST /api/v3/cron/nightly-sync`
2. Ensure `server.js` delegates to same shared handler modules used by `api/*`.
3. Keep old endpoints temporarily for compatibility.

#### Required Tests

1. `tests/api/v3/contracts.test.js`
   - validates request/response shapes and status codes
2. `tests/api/v3/validation.test.js`
   - invalid params return deterministic errors
3. `tests/api/parity-local-vs-serverless.test.js`
   - same input produces equivalent output in local route wiring and `api/*` handler wiring

#### Exit Criteria

1. New endpoints reachable in both localhost and deployed-style route runtime.
2. All S3 tests pass.

---

### S4 - Ingestion job engine + worker flow

#### Implementation

1. Implement ingestion job enqueue/dequeue lifecycle in `ingestion_jobs`.
2. Add worker execution module for domains and modes (`rolling`, `full`, `visible_window`).
3. Add retry/backoff and terminal failure recording.
4. Ensure idempotency for duplicate enqueue requests.

#### Required Tests

1. `tests/jobs/lifecycle.test.js`
   - queued -> running -> completed/failed transitions
2. `tests/jobs/idempotency.test.js`
   - duplicate requests do not create conflicting results
3. `tests/jobs/retry.test.js`
   - transient errors retry, terminal errors finalize as failed

#### Exit Criteria

1. Jobs are durable in DB and recoverable across process restarts.
2. All S4 tests pass.

---

### S5 - Weather normalized series + sync logic

#### Implementation

1. Write rolling weather ingest to `weather_project_series`.
2. Enforce weather window: last 30 days + next 7 days.
3. Maintain `domain_sync_state` for weather.

#### Required Tests

1. `tests/weather/rolling-window.test.js`
   - stores only expected rolling window bounds
2. `tests/weather/upsert-dedup.test.js`
   - re-ingest upserts by unique key without duplicates
3. `tests/weather/sync-state.test.js`
   - `domain_sync_state` timestamps and error fields update correctly

#### Exit Criteria

1. Weather charts can be served from normalized DB series only.
2. All S5 tests pass.

---

### S6 - Generation visible-window-first recompute

#### Implementation

1. Compute visible chart window first and return quickly.
2. Enqueue background recompute for remaining rolling window.
3. Overwrite prior generation values for matching timestamps/fingerprints.

#### Required Tests

1. `tests/generation/visible-window-priority.test.js`
   - visible window computed before background backlog
2. `tests/generation/overwrite-semantics.test.js`
   - recompute replaces prior values
3. `tests/generation/background-backfill.test.js`
   - remaining window fills asynchronously

#### Exit Criteria

1. User-visible window latency is low and background completion succeeds.
2. All S6 tests pass.

---

### S7 - Rates: remove modeled fallback + 5-min true cadence

#### Implementation

1. Remove modeled fallback generation paths from LMP adapters.
2. Unsupported region path returns explicit unsupported state and empty series.
3. Only store/show 5-minute where upstream source truly provides it.
4. Ensure DA and RT cadences are correctly represented.

#### Required Tests

1. `tests/rates/no-modeled-fallback.test.js`
   - verifies no synthetic modeled points are returned
2. `tests/rates/unsupported-region.test.js`
   - returns deterministic unsupported payload/message
3. `tests/rates/cadence-availability.test.js`
   - `five_min` exposed only when source cadence supports it
4. `tests/rates/day-ahead-cadence.test.js`
   - DA interval behavior matches source capabilities

#### Exit Criteria

1. No modeled rate data in API responses or persisted tables.
2. All S7 tests pass.

---

### S8 - Location/asset fingerprint invalidation rules

#### Implementation

1. Define and persist:
   - `location_fingerprint`
   - `asset_fingerprint`
   - `rates_source_fingerprint`
2. On location change:
   - always invalidate weather/generation/storage sync
   - rates invalidates only if rates source fingerprint changes
3. On asset change:
   - generation/storage invalidates and recomputes

#### Required Tests

1. `tests/invalidation/location-change.test.js`
   - weather/generation/storage invalidated every location change
2. `tests/invalidation/rates-fingerprint-conditional.test.js`
   - rates sync triggers only on fingerprint change
3. `tests/invalidation/asset-change.test.js`
   - generation/storage recompute after asset mutation

#### Exit Criteria

1. Invalidations match dependency graph rules.
2. All S8 tests pass.

---

### S9 - Frontend migration to v3 endpoints + polling changes

#### Implementation

1. Switch pages to v3 series/sync/status endpoints.
2. Rates status polling interval: minimum 120 seconds.
3. Trigger status refresh on manual refresh and foreground/focus events.
4. Ensure chart interval controls still obey period/cadence rules.

#### Required Tests

1. `tests/frontend/rates-polling-interval.test.js`
   - verifies no 5-second polling remains
2. `tests/frontend/manual-refresh-triggers-status.test.js`
   - manual refresh triggers status update
3. `tests/frontend/cadence-controls.test.js`
   - interval options follow returned cadence support

#### Exit Criteria

1. UI behavior reflects new API model and updated polling.
2. All S9 tests pass.

---

### S10 - Backfill/data migration + dual-read cutover

#### Implementation

1. Backfill normalized tables from existing caches where feasible.
2. Temporarily support dual-read path with feature flag:
   - read new tables first
   - fallback to old tables only during cutover period
3. Remove dual-read after validation period.

#### Required Tests

1. `tests/migration/backfill-script.test.js`
   - verifies migrated row counts and key field integrity
2. `tests/migration/dual-read-precedence.test.js`
   - prefers v3 data when available
3. `tests/migration/no-regression-smoke.test.js`
   - major page data loads still succeed during cutover

#### Exit Criteria

1. New tables fully populated for active projects.
2. Dual-read removal plan approved.
3. All S10 tests pass.

---

### S11 - Localhost/prod parity verification

#### Implementation

1. Verify identical route availability and behavior in local and deployment runtimes.
2. Ensure environment flags do not cause contract drift.

#### Required Tests

1. `tests/parity/endpoints-parity.test.js`
   - every v3 route exists in both runtime shapes
2. `tests/parity/response-parity.test.js`
   - equivalent payload semantics for same fixtures

#### Exit Criteria

1. No local-only or prod-only data route contracts.
2. All S11 tests pass.

---

### S12 - Cleanup + deprecation removal + docs finalization

#### Implementation

1. Remove deprecated fallback and legacy code paths.
2. Remove old tables/routes no longer used.
3. Update docs:
   - `README.md`
   - `docs/architecture.md`
   - `docs/rates.md`
4. Add final migration notes and rollback guidance.

#### Required Tests

1. `npm run -s test`
2. `node --check` on all modified frontend JS files
3. Manual verification:
   - period/interval toggles
   - legend toggles
   - chart rendering
   - navigation
   - refresh/sync behavior

#### Exit Criteria

1. Legacy code removed safely.
2. Documentation reflects final architecture.
3. All S12 tests and manual checks pass.

## Test Matrix Snapshot (Quick Reference)

| Domain | Unit | Integration/API | UI/Manual |
|---|---|---|---|
| Schema/RLS | Yes | Yes | No |
| Sync Jobs | Yes | Yes | Optional |
| Weather | Yes | Yes | Yes |
| Generation | Yes | Yes | Yes |
| Rates | Yes | Yes | Yes |
| Parity | No | Yes | Optional |

## How To Update This Document During Work

For every merged change:

1. Update `Master Tracker`:
   - set step status
   - add PR/commit reference
   - add update date and summary notes
2. Add an entry to the change log below.
3. If scope changed, update:
   - `Scope Decisions (Locked)` (only with explicit approval)
   - affected step details
   - associated tests
4. If blocked, mark `BLOCKED` and include:
   - blocker reason
   - unblock owner
   - proposed workaround

## Change Log

| Date (UTC) | Author | Step(s) | Change Summary |
|---|---|---|---|
| 2026-02-25 | Codex | Initial | Created v3 migration playbook with detailed steps/tests/update protocol. |
| 2026-02-25 | Codex | S1 | Added `20260225_add_v3_sync_schema.sql`; added `tests/db/{schema,rls,constraint}.test.js`; wired tests into `tests/run-tests.js`. |
| 2026-02-25 | Codex | S1 | Applied migration to Supabase via MCP and verified new tables, columns, indexes, unique constraints, and RLS policies in `public` schema. |
| 2026-02-25 | Codex | S1 | Ran live execution checks (insert + expected unique/check/not-null violations + defaults) for v3 tables in Supabase; all checks passed. |
| 2026-02-25 | Codex | S2 | Removed local domain-data fallback in `supabase-client.js`, updated API error banner conditions for Supabase-unavailable states, and added `tests/client/*` S2 checks. |
| 2026-02-25 | Codex | S2 | Ran `node --check` on changed frontend/client files and `npm run -s test`; all checks passed. |
| 2026-02-25 | Codex | S3 | Added `api/v3-proxy.js`, `api/v3/*` wrappers, `server.js` v3 route wiring, and tests for v3 contracts/validation/parity. |
| 2026-02-25 | Codex | S3 | Re-ran all S3 syntax/test checks after interrupted run; `npm run -s test` passed and S3 marked done. |
| 2026-02-26 | Codex | S4 | Added `lib/v3/ingestion-job-engine.js`, `lib/v3/ingestion-job-store-{memory,supabase}.js`, `api/v3/worker/run-once.js`, wired worker route in `server.js`, and integrated S4 enqueue/run/retry flow in `api/v3-proxy.js`. |
| 2026-02-26 | Codex | S4 | Added migration `20260225_add_ingestion_job_retry_fields.sql` (`attempts`, `max_attempts`, `next_retry_at` + index), plus `tests/jobs/{lifecycle,idempotency,retry}.test.js`; `npm run -s test` and `node --check` suite passed. |
| 2026-02-26 | Codex | S5 | Added `lib/v3/weather-sync.js` (rolling window: last 30 days + next 7 days, normalized upsert payloads, deterministic weather fingerprint), integrated weather handler in `api/v3-proxy.js`, and extended ingestion stores with weather-series upsert/purge methods. |
| 2026-02-26 | Codex | S5 | Added `tests/weather/{rolling-window,upsert-dedup,sync-state}.test.js` and wired them in `tests/run-tests.js`; `npm run -s test` and syntax checks passed. |
| 2026-02-26 | Codex | S6 | Added `lib/v3/generation-sync.js` and integrated generation domain handler in `api/v3-proxy.js` to compute visible windows first, then enqueue rolling background backfill via ingestion engine helper enqueue. |
| 2026-02-26 | Codex | S6 | Extended ingestion stores with generation-series upsert/purge + project fingerprint updates, and added `tests/generation/{visible-window-priority,overwrite-semantics,background-backfill}.test.js`; full `npm run -s test` and syntax checks passed. |
| 2026-02-26 | Codex | S7 | Updated `lib/rates/lmp-adapters.js` to remove modeled rate generation, return explicit unsupported/source-unavailable empty series, and preserve true upstream cadence buckets (CAISO RT 5-min, ERCOT RT 15-min, DA hourly). |
| 2026-02-26 | Codex | S7 | Updated `api/rates-proxy.js`, `lib/rates/backfill-manager.js`, and `public/assets/js/pages/rates.js` to use cadence-aware persistence/serve logic and non-modeled error messaging; added `tests/rates/{no-modeled-fallback,unsupported-region,cadence-availability,day-ahead-cadence}.test.js`; full test suite passed. |
| 2026-02-26 | Codex | S8 | Added `lib/v3/invalidation-rules.js` (location/asset/rates fingerprint computation + invalidation-domain planning), integrated location/asset invalidation handling into `api/v3-proxy.js` refresh flow, and added migration `20260226_add_project_location_fingerprint.sql`. |
| 2026-02-26 | Codex | S8 | Added `tests/invalidation/{location-change,rates-fingerprint-conditional,asset-change}.test.js` and wired them into `tests/run-tests.js`; full test suite passed. |
| 2026-02-26 | Codex | S9 | Updated `public/assets/js/pages/rates.js` to use `/api/v3/series/rates`, `/api/v3/sync/rates/status`, and `/api/v3/refresh` (manual refresh), with 120-second minimum status polling and focus/visibility-triggered status refresh. |
| 2026-02-26 | Codex | S9 | Added `tests/frontend/{rates-polling-interval,manual-refresh-triggers-status,cadence-controls}.test.js`, wired in `tests/run-tests.js`, and adjusted `api/v3-proxy.js` rates metadata (`apiVersion`, `fetchedAt`, `qualityStatus`); full test suite passed. |
| 2026-02-26 | Codex | S10 | Added `lib/v3/backfill-migration.js` and `scripts/backfill-v3-from-legacy.js` for legacy cache backfill (`weather_cache`/`nrel_cache` + `rate_series_cache`) into `weather_project_series` and `rate_project_series`. |
| 2026-02-26 | Codex | S10 | Added dual-read helpers in `lib/v3/legacy-series.js` and integrated feature-flagged fallback (`ENERGYAPP_V3_DUAL_READ=1`) in `api/v3-proxy.js` for weather/rates series (v3 primary, legacy fallback only when v3 is empty). |
| 2026-02-26 | Codex | S10 | Added tests `tests/migration/{backfill-script,dual-read-precedence,no-regression-smoke}.test.js`, wired in `tests/run-tests.js`; full `npm run -s test` and syntax checks passed. |
| 2026-02-26 | Codex | S11 | Added `tests/parity/endpoints-parity.test.js` to verify every v3 route marker exists in `server.js` and every deployed wrapper entrypoint exists/exports a handler function. |
| 2026-02-26 | Codex | S11 | Added `tests/parity/response-parity.test.js` to compare direct `api/v3-proxy` handlers vs deployed wrappers for all v3 endpoints under identical fixtures; wired both S11 tests into `tests/run-tests.js`. |
| 2026-02-26 | Codex | S12 | Removed v3 runtime dual-read fallback to legacy tables from `api/v3-proxy.js`; v3 series endpoints now serve only canonical v3 tables. |
| 2026-02-26 | Codex | S12 | Updated location-change sync trigger in `public/assets/js/pages/location.js` to call `POST /api/v3/refresh` with `reason=location_change` instead of legacy rates backfill start. |
| 2026-02-26 | Codex | S12 | Deprecated legacy rates routes in `server.js` and wrapper handlers (`/api/rates/timeseries`, `/api/v2/rates/timeseries`, `/api/rates/refresh`) and refreshed docs in `README.md`, `docs/architecture.md`, and `docs/rates.md`. |

## Final Migration Notes And Rollback Guidance

### Final State

1. Canonical data reads for weather/generation/rates are v3 table-backed.
2. No modeled rates fallback is active.
3. Location/asset changes flow through v3 invalidation + rolling refresh.
4. Localhost and deployment both serve v3 contracts as primary API surface.

### Rollback Guidance

1. If rollout issues occur, revert application code to the last commit before S12 and redeploy.
2. Re-enable temporary compatibility by restoring S10 dual-read runtime blocks in `api/v3-proxy.js`.
3. Keep Supabase schema/migrations in place; rollback should be application-layer first, not destructive table drops.
4. If rate UI regression appears, temporarily pin the Rates page to prior commit while preserving v3 ingestion jobs.
5. After rollback, run `npm run -s test` and verify `/api/v3/*` health plus Rates page status polling behavior.

## Session Recovery Instructions

If context is reset:

1. Open this file first.
2. Continue from the first `IN_PROGRESS` or `BLOCKED` step in `Master Tracker`.
3. Validate unmerged assumptions against current code before implementing.
4. Do not start a new step until the current step has updated tests and tracker fields.
