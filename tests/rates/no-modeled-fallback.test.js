const assert = require("assert");
const { __internal } = require("../../lib/rates/lmp-adapters");

const runNoModeledFallbackTests = async () => {
  const start = new Date("2026-02-01T00:00:00.000Z");
  const end = new Date("2026-02-01T02:00:00.000Z");
  const sparseRows = [{ ts: "2026-02-01T00:00:00.000Z", value: 32.5 }];
  const series = __internal.buildSeriesFromRows({
    rows: sparseRows,
    start,
    end,
    marketMode: "real_time",
    source: "rates_proxy_phase3_live_caiso_oasis",
    reason: "source coverage gap",
    resolutionMinutes: 5,
  });

  const missingPoints = series.points.filter((point) => point.value == null);
  assert.ok(missingPoints.length > 0, "Expected sparse input to produce missing points.");
  assert.strictEqual(
    series.points.some((point) => point.missingReason === "modeled_backfill"),
    false,
    "Expected no modeled fallback markers."
  );
};

module.exports = { runNoModeledFallbackTests };
