const assert = require("assert");
const { resolveInvalidationPlan } = require("../../lib/v3/invalidation-rules");

const runAssetChangeInvalidationTests = async () => {
  const plan = resolveInvalidationPlan({
    reason: "asset_change",
    project: {
      id: "p-asset-change",
      location_lat: 36.2,
      location_lng: -119.4,
      weather_provider: "open_meteo",
      rates_source_fingerprint: "stable",
    },
    assets: [
      { asset_type: "solar", model: { capacity_ac_kw: 100 } },
      { asset_type: "wind", model: { rated_power_kw: 1500 } },
    ],
  });

  assert.deepStrictEqual(
    plan.domains.sort(),
    ["generation", "storage"],
    "Expected asset change to recompute generation/storage domains."
  );
  assert.ok(plan.patch.asset_fingerprint, "Expected asset fingerprint patch.");
  assert.strictEqual(plan.domains.includes("rates"), false, "Expected no rates invalidation for asset-only changes.");
};

module.exports = { runAssetChangeInvalidationTests };
