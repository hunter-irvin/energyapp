const assert = require("assert");
const { resolveInvalidationPlan } = require("../../lib/v3/invalidation-rules");

const runLocationChangeInvalidationTests = async () => {
  const plan = resolveInvalidationPlan({
    reason: "location_change",
    project: {
      id: "p-location-change",
      location_lat: 36.2,
      location_lng: -119.4,
      weather_provider: "open_meteo",
      rates_source_fingerprint: "old",
    },
    assets: [],
  });
  assert.ok(plan.domains.includes("weather"), "Expected weather invalidation on location change.");
  assert.ok(plan.domains.includes("generation"), "Expected generation invalidation on location change.");
  assert.ok(plan.domains.includes("storage"), "Expected storage invalidation on location change.");
  assert.ok(plan.patch.location_fingerprint, "Expected location fingerprint patch.");
};

module.exports = { runLocationChangeInvalidationTests };
