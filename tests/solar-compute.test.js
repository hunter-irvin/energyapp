const assert = require("assert");
const path = require("path");

const { computeSolarPower, sumSolarAssets } = require(path.join(__dirname, "..", "generation.js"));

const runSolarComputeTests = () => {
  const baseAsset = {
    capacity_ac_kw: 500,
    dc_ac_ratio: 1.2,
    system_losses_frac: 0.14,
    availability_frac: 0.99,
    clip_at_ac_capacity: true,
    noct_c: 45,
    temp_coeff_per_c: -0.004,
  };

  // negative post-temp/loss DC clamps to 0
  const negativeClamp = computeSolarPower(
    { ...baseAsset, temp_coeff_per_c: -0.2 },
    [{ ghi: 1000, air_temperature: 80 }]
  );
  assert.strictEqual(negativeClamp[0], 0);

  // higher system losses lowers output
  const lowLoss = computeSolarPower({ ...baseAsset, system_losses_frac: 0.05 }, [{ ghi: 800, air_temperature: 25 }]);
  const highLoss = computeSolarPower({ ...baseAsset, system_losses_frac: 0.30 }, [{ ghi: 800, air_temperature: 25 }]);
  assert.ok(highLoss[0] < lowLoss[0]);

  // higher air temperature lowers output with negative temp coeff
  const cool = computeSolarPower(baseAsset, [{ ghi: 900, air_temperature: 10 }]);
  const hot = computeSolarPower(baseAsset, [{ ghi: 900, air_temperature: 45 }]);
  assert.ok(hot[0] < cool[0]);

  // clipping enforces max AC when enabled
  const clipped = computeSolarPower(
    { ...baseAsset, clip_at_ac_capacity: true },
    [{ ghi: 1200, air_temperature: 25 }]
  );
  assert.ok(clipped[0] <= baseAsset.capacity_ac_kw * baseAsset.availability_frac + 1e-9);

  const unclipped = computeSolarPower(
    { ...baseAsset, clip_at_ac_capacity: false },
    [{ ghi: 1200, air_temperature: 25 }]
  );
  assert.ok(unclipped[0] >= clipped[0]);

  // availability scales final output
  const highAvailability = computeSolarPower({ ...baseAsset, availability_frac: 1.0 }, [{ ghi: 700, air_temperature: 20 }]);
  const lowAvailability = computeSolarPower({ ...baseAsset, availability_frac: 0.5 }, [{ ghi: 700, air_temperature: 20 }]);
  assert.ok(lowAvailability[0] < highAvailability[0]);

  // NaN GHI treated as 0
  const nanIrradiance = computeSolarPower(baseAsset, [{ ghi: Number.NaN, air_temperature: 20 }]);
  assert.strictEqual(nanIrradiance[0], 0);

  // missing required fields handled as 0 output
  const missingFields = computeSolarPower(baseAsset, [{}]);
  assert.strictEqual(missingFields[0], 0);

  // aggregate helper sums arrays
  const a1 = { ...baseAsset, capacity_ac_kw: 100 };
  const a2 = { ...baseAsset, capacity_ac_kw: 200 };
  const series = [{ ghi: 800, air_temperature: 25 }, { ghi: 600, air_temperature: 25 }];
  const s1 = computeSolarPower(a1, series);
  const s2 = computeSolarPower(a2, series);
  const summed = sumSolarAssets([a1, a2], series);
  assert.strictEqual(summed.length, 2);
  assert.ok(Math.abs(summed[0] - (s1[0] + s2[0])) < 1e-9);
  assert.ok(Math.abs(summed[1] - (s1[1] + s2[1])) < 1e-9);
};

module.exports = { runSolarComputeTests };
