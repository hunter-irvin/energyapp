const assert = require("assert");
const path = require("path");

const { powerCurve, computeWindPower, sumWindAssets } = require(
  path.join(__dirname, "..", "public", "assets", "js", "features", "generation.js")
);

const runWindComputeTests = () => {
  const baseAsset = {
    rated_power_kw: 2000,
    num_turbines: 1,
    hub_height_m: 100,
    power_curve_id: "generic_2mw_v1",
    cut_in_mps: 3,
    rated_mps: 12,
    cut_out_mps: 25,
    availability_frac: 0.97,
    wake_losses_frac: 0,
    electrical_losses_frac: 0.02,
    density_correction_enabled: true,
    air_density_std: 1.225,
    shear_exponent_alpha: 0.14,
    reference_height_m: 10,
  };

  // below cut-in => 0
  const belowCutIn = computeWindPower(baseAsset, [{ windspeed_100m: 2.5 }]);
  assert.strictEqual(belowCutIn[0], 0);

  // between breakpoints => interpolated fraction
  const f6 = powerCurve("generic_2mw_v1", 6);
  const f7 = powerCurve("generic_2mw_v1", 7);
  const f65 = powerCurve("generic_2mw_v1", 6.5);
  assert.ok(f65 > f6 && f65 < f7);

  // at/above cut-out => 0
  const atCutOut = computeWindPower(baseAsset, [{ windspeed_100m: 25 }]);
  const aboveCutOut = computeWindPower(baseAsset, [{ windspeed_100m: 26 }]);
  assert.strictEqual(atCutOut[0], 0);
  assert.strictEqual(aboveCutOut[0], 0);

  // density correction modifies output in expected direction
  const normalDensity = computeWindPower(baseAsset, [
    { windspeed_100m: 8, pressure_100m: 101325, temperature_100m: 15 },
  ]);
  const highDensity = computeWindPower(baseAsset, [
    { windspeed_100m: 8, pressure_100m: 111325, temperature_100m: 5 },
  ]);
  assert.ok(highDensity[0] > normalDensity[0]);

  // shear fallback used when hub-height column missing
  const shearOnly = computeWindPower(
    { ...baseAsset, hub_height_m: 120, reference_height_m: 10, shear_exponent_alpha: 0.2 },
    [{ windspeed_10m: 6 }]
  );
  assert.ok(shearOnly[0] > 0);

  // wake-loss defaults for multi-turbine assets (if unset) should reduce power vs explicit zero
  const multiUnsetWake = computeWindPower(
    { ...baseAsset, num_turbines: 3, wake_losses_frac: undefined },
    [{ windspeed_100m: 10 }]
  );
  const multiZeroWake = computeWindPower(
    { ...baseAsset, num_turbines: 3, wake_losses_frac: 0 },
    [{ windspeed_100m: 10 }]
  );
  assert.ok(multiUnsetWake[0] < multiZeroWake[0]);

  // NaN windspeed => 0
  const nanWind = computeWindPower(baseAsset, [{ windspeed_100m: Number.NaN }]);
  assert.strictEqual(nanWind[0], 0);

  // aggregate helper sums arrays
  const a1 = { ...baseAsset, rated_power_kw: 1000 };
  const a2 = { ...baseAsset, rated_power_kw: 500 };
  const series = [{ windspeed_100m: 8 }, { windspeed_100m: 12 }];
  const s1 = computeWindPower(a1, series);
  const s2 = computeWindPower(a2, series);
  const summed = sumWindAssets([a1, a2], series);
  assert.strictEqual(summed.length, 2);
  assert.ok(Math.abs(summed[0] - (s1[0] + s2[0])) < 1e-9);
  assert.ok(Math.abs(summed[1] - (s1[1] + s2[1])) < 1e-9);
};

module.exports = { runWindComputeTests };
