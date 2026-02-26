const assert = require("assert");
const {
  resolveInvalidationPlan,
  computeRatesSourceFingerprint,
} = require("../../lib/v3/invalidation-rules");

const runRatesFingerprintConditionalTests = async () => {
  const sameFingerprint = computeRatesSourceFingerprint({ lat: 36.2, lng: -119.4, utilityCode: "pge" });

  const unchanged = resolveInvalidationPlan({
    reason: "location_change",
    project: {
      id: "p-rates-same",
      location_lat: 36.2,
      location_lng: -119.4,
      utility_name: "pge",
      rates_source_fingerprint: sameFingerprint,
    },
    assets: [],
  });
  assert.strictEqual(
    unchanged.domains.includes("rates"),
    false,
    "Expected rates sync to be skipped when rates source fingerprint is unchanged."
  );

  const changed = resolveInvalidationPlan({
    reason: "location_change",
    project: {
      id: "p-rates-changed",
      location_lat: 32.8,
      location_lng: -96.8,
      utility_name: "oncor",
      rates_source_fingerprint: sameFingerprint,
    },
    assets: [],
  });
  assert.strictEqual(
    changed.domains.includes("rates"),
    true,
    "Expected rates sync to run when rates source fingerprint changes."
  );
};

module.exports = { runRatesFingerprintConditionalTests };
