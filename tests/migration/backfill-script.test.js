const assert = require("assert");
const { backfillV3FromLegacy } = require("../../lib/v3/backfill-migration");

const runBackfillScriptTests = async () => {
  const calls = [];
  const weatherCacheRows = [
    {
      project_id: "p-backfill",
      provider: "open_meteo",
      dataset: "solar",
      fetched_at: "2026-02-20T00:00:00.000Z",
      payload: [
        { normalized_timestamp: "2026-02-20T00:00:00Z", ghi: 100 },
        { normalized_timestamp: "2026-02-20T00:30:00Z", ghi: 110 },
      ],
    },
    {
      project_id: "p-backfill",
      provider: "open_meteo",
      dataset: "wind",
      fetched_at: "2026-02-20T00:00:00.000Z",
      payload: [
        { normalized_timestamp: "2026-02-20T00:00:00Z", windspeed_100m: 8 },
        { normalized_timestamp: "2026-02-20T00:30:00Z", windspeed_100m: 9 },
      ],
    },
  ];
  const rateCacheRows = [
    {
      project_id: "p-backfill",
      region_id: "CAISO",
      service_type: "lmp",
      market_mode: "real_time",
      payload: {
        points: [
          { ts: "2026-02-20T00:00:00Z", value: 31.5, isForecast: false },
          { ts: "2026-02-20T00:05:00Z", value: 32.0, isForecast: false },
        ],
      },
      fetched_at: "2026-02-20T01:00:00.000Z",
    },
  ];

  const rest = async (args) => {
    calls.push(args);
    if (args.method === "GET" && args.table === "weather_cache") return weatherCacheRows;
    if (args.method === "GET" && args.table === "rate_series_cache") return rateCacheRows;
    if (args.method === "POST" && (args.table === "weather_project_series" || args.table === "rate_project_series")) {
      return [];
    }
    return [];
  };

  const summary = await backfillV3FromLegacy({ rest });
  assert.ok(summary.weatherRowsUpserted >= 4, "Expected weather backfill rows to be upserted.");
  assert.ok(summary.rateRowsUpserted >= 2, "Expected rate backfill rows to be upserted.");
  assert.ok(
    calls.some((call) => call.method === "POST" && call.table === "weather_project_series"),
    "Expected weather_project_series upsert calls."
  );
  assert.ok(
    calls.some((call) => call.method === "POST" && call.table === "rate_project_series"),
    "Expected rate_project_series upsert calls."
  );
};

module.exports = { runBackfillScriptTests };
