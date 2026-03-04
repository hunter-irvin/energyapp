const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");
const { runRatesSync } = require("../../lib/v3/rates-sync");

const runRatesVisibleWindowPriorityTests = async () => {
  const store = createMemoryIngestionJobStore();
  const project = {
    id: "p-rates-priority",
    location_lat: 34.05,
    location_lng: -118.25,
    iso_region: "CAISO",
  };

  const engine = createIngestionJobEngine({
    store,
    handlers: {
      rates: async (job, helper) =>
        runRatesSync({
          project,
          mode: job.mode,
          windowStart: job.window_start,
          windowEnd: job.window_end,
          requestedBy: job.requested_by,
          now: () => "2026-02-20T02:00:00.000Z",
          store,
          jobId: job.id,
          enqueueJob: helper.enqueue,
          resolveProvider: async () => ({ isoRegion: "CAISO", utilityCode: "PGE", tariffProgramId: "pge_demo" }),
          fetchLmpSeries: async ({ marketMode, start, end }) => {
            if (marketMode === "real_time") {
              return {
                resolutionMinutes: 5,
                points: [
                  { ts: start.toISOString(), value: 31.1, isForecast: false },
                  { ts: end.toISOString(), value: 32.2, isForecast: false },
                ],
              };
            }
            return {
              resolutionMinutes: 60,
              points: [
                { ts: start.toISOString(), value: 40.1, isForecast: false },
                { ts: end.toISOString(), value: 41.0, isForecast: false },
              ],
            };
          },
          fetchTariffSeries: async ({ start, end }) => ({
            resolutionMinutes: 60,
            points: [
              { ts: start.toISOString(), value: 0.12, isForecast: false },
              { ts: end.toISOString(), value: 0.14, isForecast: false },
            ],
          }),
        }),
    },
  });

  await engine.enqueue({
    projectId: project.id,
    domain: "rates",
    mode: "visible_window",
    requestedBy: "manual_refresh",
    windowStart: "2026-02-20T00:00:00.000Z",
    windowEnd: "2026-02-20T01:00:00.000Z",
  });

  const outcome = await engine.runNext();
  assert.strictEqual(outcome.ran, true);
  assert.strictEqual(outcome.job.status, "completed");
  assert.strictEqual(outcome.result.backgroundEnqueued, true, "Expected visible-window rates run to enqueue rolling backfill.");
  assert.ok(outcome.result.rowCount > 0, "Expected visible-window rows to be persisted.");

  const state = store._debugState();
  assert.ok(state.rateSeries.length > 0, "Expected incremental rates upserts into memory store.");
  const queuedRolling = state.jobs.filter(
    (row) => row.domain === "rates" && row.mode === "rolling" && row.status === "queued"
  );
  assert.strictEqual(queuedRolling.length, 1, "Expected one queued rolling rates backfill job.");
};

module.exports = { runRatesVisibleWindowPriorityTests };
