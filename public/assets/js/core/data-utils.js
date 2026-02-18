(() => {
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();

  const normalizeHeader = (header) =>
    cleanText(header)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const SOLAR_ALIASES = {
    timestamp: ["timestamp", "time", "date_time", "datetime"],
    ghi: ["ghi"],
    dni: ["dni"],
    dhi: ["dhi"],
    air_temperature: ["air_temperature", "air_temp", "temp", "temperature"],
    wind_speed: ["wind_speed", "windspeed"],
  };

  /**
   * @param {string[]} headers
   * @param {"solar"|"wind"} type
   */
  const mapHeaders = (headers, type) => {
    const normalized = headers.map((header) => normalizeHeader(header));
    if (type === "solar") {
      const indexByField = {};
      Object.entries(SOLAR_ALIASES).forEach(([field, aliases]) => {
        const index = normalized.findIndex((value) => aliases.includes(value));
        if (index !== -1) {
          indexByField[field] = index;
        }
      });
      return { indexByField, normalized };
    }

    const windFields = { timestamp: normalized.indexOf("timestamp") };
    normalized.forEach((value, index) => {
      const match = value.match(/^(windspeed|temperature|pressure)_(\d+)m$/);
      if (match) {
        const [, metric, height] = match;
        windFields[`${metric}_${height}m`] = index;
      }
    });
    return { indexByField: windFields, normalized };
  };

  const toTimestampKey = (timestamp) => {
    const date = new Date(timestamp);
    const time = date.getTime();
    if (Number.isNaN(time)) {
      return null;
    }
    return time;
  };

  const sanitizeSolarPoint = (point) => {
    const sanitize = (value) => (Number.isNaN(value) ? 0 : value);
    return {
      ...point,
      ghi: sanitize(point.ghi),
      dni: sanitize(point.dni),
      dhi: sanitize(point.dhi),
    };
  };

  const sanitizeWindPoint = (point) => {
    const sanitized = { ...point };
    Object.keys(point).forEach((key) => {
      if (key.startsWith("windspeed_")) {
        sanitized[key] = Number.isNaN(point[key]) ? 0 : point[key];
      }
    });
    return sanitized;
  };

  /**
   * @param {Array<{timestamp: string}>} solarSeries
   * @param {Array<{timestamp: string}>} windSeries
   */
  const mergeSeriesOnTimestamps = (solarSeries, windSeries) => {
    const solarIndex = new Map();
    solarSeries.forEach((point) => {
      const key = toTimestampKey(point.timestamp);
      if (key !== null) {
        solarIndex.set(key, sanitizeSolarPoint(point));
      }
    });

    const windIndex = new Map();
    windSeries.forEach((point) => {
      const key = toTimestampKey(point.timestamp);
      if (key !== null) {
        windIndex.set(key, sanitizeWindPoint(point));
      }
    });

    const timestamps = Array.from(solarIndex.keys()).filter((key) => windIndex.has(key));
    timestamps.sort((a, b) => a - b);

    return {
      timestamps: timestamps.map((key) => new Date(key).toISOString()),
      solar: timestamps.map((key) => solarIndex.get(key)),
      wind: timestamps.map((key) => windIndex.get(key)),
    };
  };

  window.EnergyDataUtils = {
    normalizeHeader,
    mapHeaders,
    mergeSeriesOnTimestamps,
  };
})();
