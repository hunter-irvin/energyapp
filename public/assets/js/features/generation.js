(() => {
  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const clamp01 = (value) => Math.min(1, Math.max(0, value));

  /**
   * computeSolarPower(asset, nsrdbDaySeries) -> Float64Array
   */
  const computeSolarPower = (asset, nsrdbDaySeries = []) => {
    const points = Array.isArray(nsrdbDaySeries) ? nsrdbDaySeries.length : 0;
    const output = new Float64Array(points);

    const capacityAc = toNumber(asset?.capacity_ac_kw, 0);
    const dcAcRatio = toNumber(asset?.dc_ac_ratio, 1.2);
    const losses = toNumber(asset?.system_losses_frac, 0.14);
    const availability = toNumber(asset?.availability_frac, 0.99);
    const clipAtAc = asset?.clip_at_ac_capacity !== false;
    const noct = toNumber(asset?.noct_c, 45);
    const gamma = toNumber(asset?.temp_coeff_per_c, -0.004);

    const pdcStcKw = capacityAc * dcAcRatio;

    for (let i = 0; i < points; i += 1) {
      const record = nsrdbDaySeries[i] || {};
      const poaWm2 = toNumber(record.ghi, 0); // POA = GHI
      const ta = toNumber(record.air_temperature, 0);
      const tCell = ta + ((noct - 20) / 800) * poaWm2;
      let pdcKw = pdcStcKw * (poaWm2 / 1000) * (1 + gamma * (tCell - 25)) * (1 - losses);
      if (!Number.isFinite(pdcKw) || pdcKw < 0) {
        pdcKw = 0;
      }
      const pacKw = clipAtAc ? Math.min(pdcKw, capacityAc) : pdcKw;
      const pSolarKw = pacKw * availability;
      output[i] = Number.isFinite(pSolarKw) && pSolarKw > 0 ? pSolarKw : 0;
    }

    return output;
  };

  const computeSolarPowerDebug = (asset, nsrdbDaySeries = []) => {
    const series = computeSolarPower(asset, nsrdbDaySeries);
    const sample = [];
    const errors = [];

    const capacityAc = toNumber(asset?.capacity_ac_kw, 0);
    const dcAcRatio = toNumber(asset?.dc_ac_ratio, 1.2);
    const losses = toNumber(asset?.system_losses_frac, 0.14);
    const availability = toNumber(asset?.availability_frac, 0.99);
    const clipAtAc = asset?.clip_at_ac_capacity !== false;
    const noct = toNumber(asset?.noct_c, 45);
    const gamma = toNumber(asset?.temp_coeff_per_c, -0.004);
    const pdcStcKw = capacityAc * dcAcRatio;

    for (let i = 0; i < Math.min(nsrdbDaySeries.length, 4); i += 1) {
      const record = nsrdbDaySeries[i] || {};
      if (record.ghi == null || record.air_temperature == null) {
        errors.push(`Solar point ${i}: missing ghi or air_temperature.`);
      }
      const poaWm2 = toNumber(record.ghi, 0);
      const ta = toNumber(record.air_temperature, 0);
      const tCell = ta + ((noct - 20) / 800) * poaWm2;
      const pdcRaw = pdcStcKw * (poaWm2 / 1000) * (1 + gamma * (tCell - 25)) * (1 - losses);
      const pdcClamped = Math.max(0, Number.isFinite(pdcRaw) ? pdcRaw : 0);
      const pacKw = clipAtAc ? Math.min(pdcClamped, capacityAc) : pdcClamped;
      sample.push({
        timestamp: record.timestamp ?? i,
        poa_wm2: poaWm2,
        t_cell_c: tCell,
        pdc_raw_kw: pdcRaw,
        pdc_clamped_kw: pdcClamped,
        pac_kw: pacKw,
        output_kw: series[i],
      });
    }

    return { output: series, sample, errors };
  };

  const sumSolarAssets = (assets = [], nsrdbDaySeries = []) => {
    const points = Array.isArray(nsrdbDaySeries) ? nsrdbDaySeries.length : 0;
    const total = new Float64Array(points);
    (assets || []).forEach((asset) => {
      const series = computeSolarPower(asset, nsrdbDaySeries);
      for (let i = 0; i < points; i += 1) {
        total[i] += series[i];
      }
    });
    return total;
  };

  const POWER_CURVES = {
    generic_2mw_v1: [
      [0, 0],
      [3, 0],
      [4, 0.04],
      [5, 0.1],
      [6, 0.2],
      [7, 0.33],
      [8, 0.48],
      [9, 0.65],
      [10, 0.8],
      [11, 0.92],
      [12, 1],
      [25, 1],
    ],
  };

  const powerCurve = (curveId, vEff) => {
    const curve = POWER_CURVES[curveId] || POWER_CURVES.generic_2mw_v1;
    const v = toNumber(vEff, 0);

    if (v <= curve[0][0]) {
      return clamp01(curve[0][1]);
    }

    for (let i = 1; i < curve.length; i += 1) {
      const [v1, f1] = curve[i];
      const [v0, f0] = curve[i - 1];
      if (v <= v1) {
        const ratio = (v - v0) / (v1 - v0 || 1);
        return clamp01(f0 + ratio * (f1 - f0));
      }
    }

    return clamp01(curve[curve.length - 1][1]);
  };

  const getHeightColumn = (record, prefix, height) => {
    const key = `${prefix}_${Math.round(height)}m`;
    if (record[key] != null) {
      return key;
    }
    return null;
  };

  const getFirstMatchingColumn = (record, prefix) =>
    Object.keys(record).find((key) => key.startsWith(`${prefix}_`) && key.endsWith("m")) || null;

  const computeWindPower = (asset, wtkDaySeries = []) => {
    const points = Array.isArray(wtkDaySeries) ? wtkDaySeries.length : 0;
    const output = new Float64Array(points);

    const ratedPowerKw = toNumber(asset?.rated_power_kw, 0);
    const numTurbines = Math.max(1, Math.round(toNumber(asset?.num_turbines, 1)));
    const hubHeight = toNumber(asset?.hub_height_m, 100);
    const powerCurveId = asset?.power_curve_id || "generic_2mw_v1";
    const cutIn = toNumber(asset?.cut_in_mps, 3);
    const cutOut = toNumber(asset?.cut_out_mps, 25);
    const availability = toNumber(asset?.availability_frac, 0.97);
    const wakeDefault = numTurbines > 1 ? 0.05 : 0;
    const wakeLoss = toNumber(asset?.wake_losses_frac, wakeDefault);
    const electricalLoss = toNumber(asset?.electrical_losses_frac, 0.02);
    const densityCorrectionEnabled = asset?.density_correction_enabled !== false;
    const rho0 = toNumber(asset?.air_density_std, 1.225);
    const alpha = toNumber(asset?.shear_exponent_alpha, 0.14);
    const referenceHeight = toNumber(asset?.reference_height_m, 10);

    for (let i = 0; i < points; i += 1) {
      const record = wtkDaySeries[i] || {};

      // Step A: choose wind speed at hub height, fallback to shear law.
      let v = 0;
      const exactHubKey = getHeightColumn(record, "windspeed", hubHeight);
      if (exactHubKey) {
        v = toNumber(record[exactHubKey], 0);
      } else {
        const refKey =
          getHeightColumn(record, "windspeed", referenceHeight) ||
          getFirstMatchingColumn(record, "windspeed");
        const vRef = toNumber(refKey ? record[refKey] : record.windspeed, 0);
        if (refKey) {
          const refMatch = refKey.match(/_(\d+)m$/);
          const refHeight = refMatch ? toNumber(refMatch[1], referenceHeight) : referenceHeight;
          v = vRef * (hubHeight / Math.max(1, refHeight)) ** alpha;
        } else {
          v = vRef;
        }
      }
      if (!Number.isFinite(v) || v < 0) {
        v = 0;
      }

      // Step B: density correction.
      let vEff = v;
      if (densityCorrectionEnabled) {
        const pressureKey = getHeightColumn(record, "pressure", hubHeight) || getFirstMatchingColumn(record, "pressure");
        const tempKey =
          getHeightColumn(record, "temperature", hubHeight) || getFirstMatchingColumn(record, "temperature");
        const pressurePa = toNumber(pressureKey ? record[pressureKey] : null, NaN);
        const tempC = toNumber(tempKey ? record[tempKey] : null, NaN);
        if (Number.isFinite(pressurePa) && Number.isFinite(tempC)) {
          const rho = pressurePa / (287.05 * (tempC + 273.15));
          if (Number.isFinite(rho) && rho > 0 && rho0 > 0) {
            vEff = v * (rho / rho0) ** (1 / 3);
          }
        }
      }

      // Step C/D: power curve + cut-outs + losses.
      let fraction = powerCurve(powerCurveId, vEff);
      if (vEff < cutIn || vEff >= cutOut) {
        fraction = 0;
      }

      const pTurbKw = ratedPowerKw * fraction;
      let pWindKw = pTurbKw * numTurbines * (1 - wakeLoss) * (1 - electricalLoss) * availability;
      if (!Number.isFinite(pWindKw) || pWindKw < 0) {
        pWindKw = 0;
      }
      output[i] = pWindKw;
    }

    return output;
  };

  const computeWindPowerDebug = (asset, wtkDaySeries = []) => {
    const series = computeWindPower(asset, wtkDaySeries);
    const sample = [];
    const errors = [];

    const hubHeight = toNumber(asset?.hub_height_m, 100);

    for (let i = 0; i < Math.min(wtkDaySeries.length, 4); i += 1) {
      const record = wtkDaySeries[i] || {};
      const windKeys = Object.keys(record).filter((k) => /^windspeed_\d+m$/.test(k));
      const hubKey = `${'windspeed'}_${Math.round(hubHeight)}m`;
      const sourceKey = record[hubKey] != null ? hubKey : windKeys[0] || "windspeed";
      const vRaw = toNumber(record[sourceKey], 0);
      if (!windKeys.length && record.windspeed == null) {
        errors.push(`Wind point ${i}: no windspeed column found.`);
      }
      sample.push({
        timestamp: record.timestamp ?? i,
        source_key: sourceKey,
        v_raw_mps: vRaw,
        output_kw: series[i],
      });
    }

    return { output: series, sample, errors };
  };

  const sumWindAssets = (assets = [], wtkDaySeries = []) => {
    const points = Array.isArray(wtkDaySeries) ? wtkDaySeries.length : 0;
    const total = new Float64Array(points);
    (assets || []).forEach((asset) => {
      const series = computeWindPower(asset, wtkDaySeries);
      for (let i = 0; i < points; i += 1) {
        total[i] += series[i];
      }
    });
    return total;
  };

  const api = {
    computeSolarPower,
    sumSolarAssets,
    computeSolarPowerDebug,
    powerCurve,
    computeWindPower,
    sumWindAssets,
    computeWindPowerDebug,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.EnergyGeneration = api;
  }
})();
