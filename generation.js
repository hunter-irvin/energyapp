(() => {
  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

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

      // Spec v1: POA = GHI and NaN irradiance treated as 0.
      const poaWm2 = toNumber(record.ghi, 0);
      const ta = toNumber(record.air_temperature, 0);

      // Tcell = Ta + ((NOCT - 20)/800)*POA
      const tCell = ta + ((noct - 20) / 800) * poaWm2;

      // Pdc_kw = Pdc_stc_kw*(POA/1000)*(1 + gamma*(Tcell-25))*(1-L)
      let pdcKw = pdcStcKw * (poaWm2 / 1000) * (1 + gamma * (tCell - 25)) * (1 - losses);

      // clamp Pdc_kw >= 0
      if (!Number.isFinite(pdcKw) || pdcKw < 0) {
        pdcKw = 0;
      }

      // AC clipping by capacity_ac_kw if enabled
      const pacKw = clipAtAc ? Math.min(pdcKw, capacityAc) : pdcKw;

      // multiply by availability
      const pSolarKw = pacKw * availability;
      output[i] = Number.isFinite(pSolarKw) && pSolarKw > 0 ? pSolarKw : 0;
    }

    return output;
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

  const api = {
    computeSolarPower,
    sumSolarAssets,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.EnergyGeneration = api;
  }
})();
