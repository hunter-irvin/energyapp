(() => {
  /**
   * @typedef {Object} SolarAsset
   * @property {string} name
   * @property {number} capacity_ac_kw
   * @property {number} dc_ac_ratio
   * @property {number} capacity_dc_kw
   * @property {number} system_losses_frac
   * @property {number} availability_frac
   * @property {boolean} clip_at_ac_capacity
   * @property {number} noct_c
   * @property {number} temp_coeff_per_c
   */

  /**
   * @typedef {Object} WindAsset
   * @property {string} name
   * @property {number} rated_power_kw
   * @property {number} num_turbines
   * @property {number} hub_height_m
   * @property {string} power_curve_id
   * @property {number} cut_in_mps
   * @property {number} rated_mps
   * @property {number} cut_out_mps
   * @property {number} availability_frac
   * @property {number} wake_losses_frac
   * @property {number} electrical_losses_frac
   * @property {boolean} density_correction_enabled
   * @property {number} air_density_std
   * @property {number} shear_exponent_alpha
   * @property {number} reference_height_m
   */

  /**
   * @typedef {Object} Facility
   * @property {string} id
   * @property {string} name
   * @property {number} lat
   * @property {number} lon
   * @property {string} timezone
   * @property {(SolarAsset|WindAsset)[]} assets
   */

  /**
   * @typedef {Object} SolarTimeseriesPoint
   * @property {string} timestamp
   * @property {number} ghi
   * @property {number} dni
   * @property {number} dhi
   * @property {number} air_temperature
   * @property {number} [wind_speed]
   */

  /**
   * @typedef {Object<string, number|string|null>} WindTimeseriesPoint
   * @property {string} timestamp
   * @property {number} [windspeed_80m]
   * @property {number} [windspeed_100m]
   * @property {number} [windspeed_120m]
   * @property {number} [temperature_80m]
   * @property {number} [temperature_100m]
   * @property {number} [temperature_120m]
   * @property {number} [pressure_80m]
   * @property {number} [pressure_100m]
   * @property {number} [pressure_120m]
   */

  const DEFAULT_SOLAR_ASSET = {
    name: "Solar 1",
    capacity_ac_kw: 500,
    dc_ac_ratio: 1.2,
    system_losses_frac: 0.14,
    availability_frac: 0.99,
    clip_at_ac_capacity: true,
    noct_c: 45,
    temp_coeff_per_c: -0.004,
  };

  const DEFAULT_WIND_ASSET = {
    name: "Wind 1",
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

  /**
   * @param {Partial<SolarAsset>} [overrides]
   * @returns {SolarAsset}
   */
  const createSolarAsset = (overrides = {}) => {
    const capacityAc = Number(overrides.capacity_ac_kw ?? DEFAULT_SOLAR_ASSET.capacity_ac_kw);
    const dcAcRatio = Number(overrides.dc_ac_ratio ?? DEFAULT_SOLAR_ASSET.dc_ac_ratio);
    return {
      ...DEFAULT_SOLAR_ASSET,
      ...overrides,
      capacity_ac_kw: capacityAc,
      dc_ac_ratio: dcAcRatio,
      capacity_dc_kw: capacityAc * dcAcRatio,
    };
  };

  /**
   * @param {Partial<WindAsset>} [overrides]
   * @returns {WindAsset}
   */
  const createWindAsset = (overrides = {}) => {
    const numTurbines = Number(overrides.num_turbines ?? DEFAULT_WIND_ASSET.num_turbines);
    const wakeLosses =
      overrides.wake_losses_frac ??
      (numTurbines > 1 ? 0.05 : DEFAULT_WIND_ASSET.wake_losses_frac);
    return {
      ...DEFAULT_WIND_ASSET,
      ...overrides,
      num_turbines: numTurbines,
      wake_losses_frac: Number(wakeLosses),
    };
  };

  /**
   * @param {Partial<Facility>} [overrides]
   * @returns {Facility}
   */
  const createFacility = (overrides = {}) => ({
    id: overrides.id ?? "facility-1",
    name: overrides.name ?? "Untitled Facility",
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    timezone: overrides.timezone ?? "UTC",
    assets: overrides.assets ?? [],
  });

  window.EnergyModels = {
    DEFAULT_SOLAR_ASSET,
    DEFAULT_WIND_ASSET,
    createSolarAsset,
    createWindAsset,
    createFacility,
  };
})();
