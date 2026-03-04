const assert = require("assert");
const { runRatesSync } = require("../../lib/v3/rates-sync");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");

const runRatesChunkLifecycleTests = async () => {
  const store = createMemoryIngestionJobStore();
  const project = {
    id: "p-r3-lifecycle",
    location_lat: 34.05,
    location_lng: -118.25,
    iso_region: "CAISO",
  };

  let rtCalls = 0;
  let daCalls = 0;
  let tariffCalls = 0;

  let thrown = null;
  try {
    await runRatesSync({
      project,
      jobId: "job-r3-1",
      mode: "visible_window",
      windowStart: "2026-02-20T00:00:00.000Z",
      windowEnd: "2026-02-20T01:00:00.000Z",
      now: () => "2026-02-20T02:00:00.000Z",
      store,
      resolveProvider: async () => ({ isoRegion: "CAISO", utilityCode: "PGE", tariffProgramId: "x" }),
      fetchLmpSeries: async ({ marketMode, start }) => {
        if (marketMode === "day_ahead") {
          daCalls += 1;
          return {
            resolutionMinutes: 60,
            points: [
              { ts: start.toISOString(), value: 22.5, isForecast: false },
              { ts: "2026-02-20T01:00:00.000Z", value: 23.1, isForecast: false },
            ],
          };
        }
        rtCalls += 1;
        throw new Error("caiso_rt_timeout");
      },
      fetchTariffSeries: async ({ start }) => {
        tariffCalls += 1;
        return {
          resolutionMinutes: 60,
          points: [{ ts: start.toISOString(), value: 0.12, isForecast: false }],
        };
      },
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected rates sync to throw on RT chunk failure.");
  assert.ok(String(thrown.message).includes("caiso_rt_timeout"));
  assert.strictEqual(daCalls, 1);
  assert.strictEqual(rtCalls, 1);
  assert.strictEqual(tariffCalls, 0, "Tariff fetch should not run after RT failure.");

  const state = store._debugState();
  const chunks = state.rateSyncChunks.filter((row) => row.project_id === project.id);
  assert.strictEqual(chunks.length, 3, "Expected one chunk per rate class in this window.");

  const daChunk = chunks.find((row) => row.service_type === "lmp" && row.market_mode === "day_ahead");
  const rtChunk = chunks.find((row) => row.service_type === "lmp" && row.market_mode === "real_time");
  const tariffChunk = chunks.find((row) => row.service_type === "tariff" && row.market_mode === "tariff");

  assert.ok(daChunk);
  assert.ok(rtChunk);
  assert.ok(tariffChunk);

  assert.strictEqual(daChunk.status, "completed");
  assert.ok(Number(daChunk.completed_points) >= 1);

  assert.strictEqual(rtChunk.status, "failed");
  assert.ok(String(rtChunk.error || "").includes("caiso_rt_timeout"));

  assert.strictEqual(tariffChunk.status, "queued");
};

module.exports = { runRatesChunkLifecycleTests };
