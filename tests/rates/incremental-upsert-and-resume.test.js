const assert = require("assert");
const { runRatesSync } = require("../../lib/v3/rates-sync");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");

const runRatesIncrementalUpsertAndResumeTests = async () => {
  const store = createMemoryIngestionJobStore();
  const project = {
    id: "p-rates-resume",
    location_lat: 34.05,
    location_lng: -118.25,
    iso_region: "CAISO",
  };

  let dayAheadCalls = 0;
  let realTimeCalls = 0;
  let tariffCalls = 0;
  let shouldFailRt = true;

  const fetchLmpSeries = async ({ marketMode, start, end }) => {
    if (marketMode === "day_ahead") {
      dayAheadCalls += 1;
      return {
        resolutionMinutes: 60,
        points: [
          { ts: start.toISOString(), value: 20.1, isForecast: false },
          { ts: end.toISOString(), value: 20.2, isForecast: false },
        ],
      };
    }

    realTimeCalls += 1;
    if (shouldFailRt) {
      throw new Error("rt_fetch_failed_once");
    }
    return {
      resolutionMinutes: 5,
      points: [
        { ts: start.toISOString(), value: 30.1, isForecast: false },
        { ts: "2026-02-20T00:05:00.000Z", value: 30.2, isForecast: false },
        { ts: "2026-02-20T00:10:00.000Z", value: 30.3, isForecast: false },
        { ts: "2026-02-20T00:15:00.000Z", value: 30.4, isForecast: false },
        { ts: "2026-02-20T00:20:00.000Z", value: 30.5, isForecast: false },
        { ts: "2026-02-20T00:25:00.000Z", value: 30.6, isForecast: false },
        { ts: "2026-02-20T00:30:00.000Z", value: 30.7, isForecast: false },
        { ts: "2026-02-20T00:35:00.000Z", value: 30.8, isForecast: false },
        { ts: "2026-02-20T00:40:00.000Z", value: 30.9, isForecast: false },
        { ts: "2026-02-20T00:45:00.000Z", value: 31.0, isForecast: false },
        { ts: "2026-02-20T00:50:00.000Z", value: 31.1, isForecast: false },
        { ts: "2026-02-20T00:55:00.000Z", value: 31.2, isForecast: false },
        { ts: end.toISOString(), value: 31.3, isForecast: false },
      ],
    };
  };

  const fetchTariffSeries = async ({ start, end }) => {
    tariffCalls += 1;
    return {
      resolutionMinutes: 60,
      points: [
        { ts: start.toISOString(), value: 0.11, isForecast: false },
        { ts: end.toISOString(), value: 0.12, isForecast: false },
      ],
    };
  };

  let firstError = null;
  try {
    await runRatesSync({
      project,
      mode: "visible_window",
      windowStart: "2026-02-20T00:00:00.000Z",
      windowEnd: "2026-02-20T01:00:00.000Z",
      now: () => "2026-02-20T02:00:00.000Z",
      store,
      jobId: "job-r4-1",
      resolveProvider: async () => ({ isoRegion: "CAISO", utilityCode: "PGE", tariffProgramId: "pge_demo" }),
      fetchLmpSeries,
      fetchTariffSeries,
    });
  } catch (error) {
    firstError = error;
  }

  assert.ok(firstError, "Expected first sync attempt to fail.");
  assert.ok(String(firstError.message).includes("rt_fetch_failed_once"));

  const stateAfterFirst = store._debugState();
  const firstDayAheadRows = stateAfterFirst.rateSeries.filter(
    (row) => row.service_type === "lmp" && row.market_mode === "day_ahead"
  );
  assert.ok(firstDayAheadRows.length > 0, "Expected day-ahead rows to persist before failure.");

  shouldFailRt = false;
  const secondRun = await runRatesSync({
    project,
    mode: "visible_window",
    windowStart: "2026-02-20T00:00:00.000Z",
    windowEnd: "2026-02-20T01:00:00.000Z",
    now: () => "2026-02-20T03:00:00.000Z",
    store,
    jobId: "job-r4-2",
    resolveProvider: async () => ({ isoRegion: "CAISO", utilityCode: "PGE", tariffProgramId: "pge_demo" }),
    fetchLmpSeries,
    fetchTariffSeries,
  });

  assert.ok(secondRun.rowCount > 0);
  assert.strictEqual(dayAheadCalls, 1, "Expected resume run to skip already-covered day-ahead fetch.");
  assert.strictEqual(realTimeCalls, 2, "Expected real-time fetch retry on second run.");
  assert.strictEqual(tariffCalls, 1, "Expected tariff fetch only on successful second run.");

  const finalState = store._debugState();
  const finalRtRows = finalState.rateSeries.filter((row) => row.service_type === "lmp" && row.market_mode === "real_time");
  const finalTariffRows = finalState.rateSeries.filter((row) => row.service_type === "tariff");
  assert.ok(finalRtRows.length > 0, "Expected real-time rows after resume.");
  assert.ok(finalTariffRows.length > 0, "Expected tariff rows after resume.");
};

module.exports = { runRatesIncrementalUpsertAndResumeTests };

