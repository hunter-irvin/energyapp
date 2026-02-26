const assert = require("assert");
const { getLmpSeries } = require("../../lib/rates/lmp-adapters");

const runUnsupportedRegionTests = async () => {
  const start = new Date("2026-02-01T00:00:00.000Z");
  const end = new Date("2026-02-01T03:00:00.000Z");
  const series = await getLmpSeries({
    regionId: "PJM",
    marketMode: "real_time",
    start,
    end,
    lat: 40.1,
    lng: -75.1,
    utilityCode: "ppl",
  });

  assert.strictEqual(series.details?.reason, "region_not_supported");
  assert.strictEqual(series.source, "rates_proxy_phase3_region_unsupported");
  assert.ok(Array.isArray(series.points) && series.points.length > 0, "Expected deterministic empty-series points.");
  assert.strictEqual(
    series.points.some((point) => point.value != null),
    false,
    "Expected unsupported region to return empty rate values."
  );
};

module.exports = { runUnsupportedRegionTests };
