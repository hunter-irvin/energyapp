# Vercel Nightly Cron Delta-Sync Plan (Outstanding Work)

## Goal

Set up Vercel-scheduled nightly sync so weather, generation, and rates are updated automatically using delta windows (gap-only where possible), with identical behavior in local and production runtimes.

## Current State (As Implemented)

1. Endpoints already exist:
   - `POST /api/v3/cron/nightly-sync`
   - `POST /api/v3/worker/run-once`
   - `POST /api/v3/refresh`
2. Ingestion engine and job tables exist (`ingestion_jobs`, `domain_sync_state`).
3. Weather + generation domain handlers are implemented.
4. Rates domain handler is still a stub in `api/v3-proxy.js` (`rates: async () => ({ fingerprint: null })`), so queued rates jobs do not ingest upstream data yet.
5. No `vercel.json` cron schedule is currently in repo.

## Outstanding Steps

## S13 - Add Vercel Cron Scheduling

1. Add `vercel.json` with nightly cron for enqueue route:
   - `path: "/api/v3/cron/nightly-sync"`
   - schedule: UTC time aligned to desired US nighttime window.
2. Add a worker cron schedule to drain queue after nightly enqueue:
   - `path: "/api/v3/worker/run-once"`
   - run every 5-10 minutes for a bounded UTC window after nightly enqueue.
3. Configure Vercel env vars:
   - `ENERGYAPP_CRON_SECRET`
   - `ENERGYAPP_WORKER_SECRET`
   - `ENERGYAPP_NIGHTLY_BATCH_LIMIT`
4. Ensure Vercel cron requests include secret headers and are validated in handlers.

Acceptance checks:
1. Vercel dashboard shows active cron jobs.
2. Unauthorized calls to cron/worker endpoints return `401`.
3. Authorized calls return `200` and enqueue/process counts.

## S14 - Implement Delta Window Resolution

1. Add shared helper (for example `lib/v3/delta-window.js`) that computes domain-specific sync windows from:
   - `domain_sync_state.last_success_at`
   - rolling constraints by domain
   - overlap safety buffer (to capture revisions)
2. Proposed delta defaults:
   - Weather: `max(last_success_at - 48h, now - 30d)` through `now + 7d`
   - Generation: same window as weather delta (recompute overwrite semantics)
   - Rates RT: `max(last_success_at - 24h, now - 7d)` through `now`
   - Rates DA: `max(last_success_at - 24h, now - 7d)` through DA published horizon
3. If no prior success, fallback to full rolling window for that domain.
4. Persist resolved `rolling_start` / `rolling_end` and attempt timestamps in `domain_sync_state`.

Acceptance checks:
1. Delta window never exceeds domain rolling bounds.
2. First run uses rolling fallback; subsequent runs use narrowed ranges.
3. Window overlap behavior is deterministic and tested.

## S15 - Implement Rates Ingestion Handler (Non-Stub)

1. Add `lib/v3/rates-sync.js` with real ingestion logic:
   - resolve provider/region
   - fetch LMP/Tariff series via existing adapters
   - normalize cadence and quality/error flags
   - upsert into `rate_project_series`
2. Extend Supabase ingestion store with rates write methods:
   - `upsertRateSeriesRows(...)`
   - optional `deleteRateSeriesOutsideWindow(...)` policy for retained range
3. Update `createEngine()` in `api/v3-proxy.js` to call `runRatesSync(...)` instead of stub.
4. Keep no-modeled-fallback behavior:
   - unsupported/unavailable => empty points with explicit status/error.

Acceptance checks:
1. Enqueued rates jobs create/update `rate_project_series` rows.
2. True 5-minute upstream cadence is preserved where available.
3. Unsupported regions do not synthesize modeled values.

## S16 - Make Nightly Route Delta-Aware

1. Update `POST /api/v3/cron/nightly-sync` to compute per-domain delta windows before enqueue.
2. Enqueue domain jobs with `mode: "rolling"` and explicit `windowStart/windowEnd` from delta resolver.
3. Prioritize job ordering:
   - weather first
   - generation second
   - rates third
4. Keep dedupe semantics for already queued/running jobs.
5. Option: split route into enqueue-only and use worker cron to process queue to avoid timeout risk.

Acceptance checks:
1. Nightly invocation enqueues all active project domains with computed windows.
2. Queue processing completes within Vercel execution constraints.
3. Retries/backoff behave correctly under transient upstream failures.

## S17 - Observability + Alerting Basics

1. Add structured logs for:
   - cron start/end
   - per-project/domain enqueue outcomes
   - per-job processing result and latency
2. Persist summary metrics to `rate_ingest_runs` and/or domain sync state fields.
3. Add simple health query/view for last nightly run status by project/domain.

Acceptance checks:
1. Can answer: "Did nightly sync run?", "How many jobs failed?", "Which domain failed?"
2. Failures include actionable error code/source details.

## S18 - Test Plan For Cron Delta Sync

1. Unit tests:
   - `tests/cron/delta-window.test.js`
   - `tests/rates/sync-handler.test.js`
2. API tests:
   - `tests/api/v3/cron-nightly-delta.test.js`
   - `tests/api/v3/worker-drain.test.js`
3. Parity tests:
   - ensure same cron/worker behavior in local `server.js` and `api/v3/*` wrappers.
4. Regression tests:
   - no modeled fallback
   - cadence correctness
   - location/asset invalidation still works.

Acceptance checks:
1. `npm run -s test` passes with new cron/delta coverage.
2. Existing parity and migration tests remain green.

## Proposed `vercel.json` (Draft)

```json
{
  "crons": [
    {
      "path": "/api/v3/cron/nightly-sync",
      "schedule": "0 09 * * *"
    },
    {
      "path": "/api/v3/worker/run-once",
      "schedule": "5-55/10 9-12 * * *"
    }
  ]
}
```

Notes:
1. Schedules are UTC. `09:00 UTC` is a placeholder and should be adjusted to desired US local night window.
2. Worker cadence/window should be tuned to project count and Vercel execution limits.

## Rollout Sequence

1. Deploy S13 + S14 (scheduler + delta resolver scaffolding, rates still stubbed).
2. Deploy S15 (real rates ingestion).
3. Deploy S16 (delta-aware nightly enqueue).
4. Enable cron schedules in production.
5. Observe 2-3 nightly cycles before tightening batch limits/cadence.

## Open Decisions Needed

1. Target local-night timezone for cron (single UTC schedule vs timezone-aware project grouping).
2. Worker cadence vs Vercel free-tier limits.
3. Whether to prune historical rows outside rolling windows for rates in nightly runs.
