const assert = require("assert");
const { __internal } = require("../../lib/rates/lmp-adapters");

const runRatesDayAheadCadenceTests = async () => {
  const start = new Date("2026-02-01T00:00:00.000Z");
  const end = new Date("2026-02-01T03:00:00.000Z");
  const rows = [
    { ts: "2026-02-01T00:00:00.000Z", value: 20 },
    { ts: "2026-02-01T01:00:00.000Z", value: 21 },
    { ts: "2026-02-01T02:00:00.000Z", value: 22 },
    { ts: "2026-02-01T03:00:00.000Z", value: 23 },
  ];

  const series = __internal.buildSeriesFromRows({
    rows,
    start,
    end,
    marketMode: "day_ahead",
    source: "rates_proxy_phase3_live_caiso_oasis",
    reason: "source coverage gap",
    resolutionMinutes: 60,
  });

  assert.strictEqual(series.resolutionMinutes, 60);
  assert.strictEqual(
    series.points.some((point) => String(point.ts).endsWith(":05:00.000Z")),
    false,
    "Expected day-ahead series to remain hourly."
  );
};

module.exports = { runRatesDayAheadCadenceTests };
