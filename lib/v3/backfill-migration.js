const {
  inferResolutionFromPoints,
  normalizeLegacyWeatherPoints,
  normalizeLegacyRatePoints,
} = require("./legacy-series");

const chunk = (values, size = 500) => {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
};

const toWeatherUpsertRows = (projectId, points = [], fetchedAt = null) =>
  points.map((point) => ({
    project_id: projectId,
    provider: point.provider || "nrel",
    dataset: point.dataset,
    ts: point.ts,
    resolution_minutes: 30,
    is_forecast: Boolean(point.isForecast),
    metrics: point.metrics || {},
    source: "legacy_weather_cache_backfill",
    fetched_at: fetchedAt || new Date().toISOString(),
    status: point.status || "provisional",
    weather_fingerprint: point.weatherFingerprint || "legacy",
    updated_at: new Date().toISOString(),
  }));

const toRateUpsertRows = (row = {}, points = []) => {
  const inferredResolution = inferResolutionFromPoints(points, row?.market_mode === "real_time" ? 15 : 60);
  return points.map((point) => ({
    project_id: row.project_id,
    region_id: row.region_id,
    service_type: row.service_type,
    market_mode: row.market_mode,
    ts: point.ts,
    resolution_minutes: inferredResolution,
    value: point.value,
    is_forecast: Boolean(point.isForecast),
    is_modeled: false,
    source: "legacy_rate_cache_backfill",
    source_url: "supabase://rate_series_cache",
    status: point.status || "provisional",
    finalized_at: null,
    quality_status: point.value == null ? "missing" : "good",
    rates_source_fingerprint: row.rates_source_fingerprint || "legacy",
    updated_at: new Date().toISOString(),
  }));
};

const backfillV3FromLegacy = async ({ rest }) => {
  if (typeof rest !== "function") {
    throw new Error("backfillV3FromLegacy requires rest function.");
  }

  const result = {
    weatherRowsUpserted: 0,
    rateRowsUpserted: 0,
    weatherProjectsTouched: 0,
    rateProjectsTouched: 0,
  };

  let weatherCacheRows = [];
  try {
    weatherCacheRows = await rest({
      method: "GET",
      table: "weather_cache",
      searchParams: { select: "project_id,provider,dataset,payload,fetched_at", order: "fetched_at.desc" },
    });
  } catch (error) {
    weatherCacheRows = await rest({
      method: "GET",
      table: "nrel_cache",
      searchParams: { select: "project_id,provider,dataset,payload,fetched_at", order: "fetched_at.desc" },
    });
  }
  const weatherByProject = new Map();
  (Array.isArray(weatherCacheRows) ? weatherCacheRows : []).forEach((row) => {
    const key = String(row.project_id || "");
    if (!key) return;
    const list = weatherByProject.get(key) || [];
    list.push(row);
    weatherByProject.set(key, list);
  });
  result.weatherProjectsTouched = weatherByProject.size;
  for (const [projectId, rows] of weatherByProject.entries()) {
    const normalizedPoints = normalizeLegacyWeatherPoints({ rows });
    const upserts = toWeatherUpsertRows(projectId, normalizedPoints, rows[0]?.fetched_at || null);
    const batches = chunk(upserts, 500);
    for (const batch of batches) {
      // eslint-disable-next-line no-await-in-loop
      await rest({
        method: "POST",
        table: "weather_project_series",
        searchParams: {
          on_conflict: "project_id,provider,dataset,resolution_minutes,ts",
        },
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: batch,
      });
      result.weatherRowsUpserted += batch.length;
    }
  }

  const rateCacheRows = await rest({
    method: "GET",
    table: "rate_series_cache",
    searchParams: {
      select: "project_id,region_id,service_type,market_mode,payload,fetched_at",
      order: "fetched_at.desc",
    },
  }).catch(() => []);
  const rateByProject = new Map();
  (Array.isArray(rateCacheRows) ? rateCacheRows : []).forEach((row) => {
    const key = String(row.project_id || "");
    if (!key) return;
    const list = rateByProject.get(key) || [];
    list.push(row);
    rateByProject.set(key, list);
  });
  result.rateProjectsTouched = rateByProject.size;
  for (const [, rows] of rateByProject.entries()) {
    for (const row of rows) {
      const normalizedPoints = normalizeLegacyRatePoints({ rows: [row] });
      const upserts = toRateUpsertRows(row, normalizedPoints);
      const batches = chunk(upserts, 500);
      for (const batch of batches) {
        // eslint-disable-next-line no-await-in-loop
        await rest({
          method: "POST",
          table: "rate_project_series",
          searchParams: {
            on_conflict: "project_id,region_id,service_type,market_mode,resolution_minutes,ts",
          },
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: batch,
        });
        result.rateRowsUpserted += batch.length;
      }
    }
  }

  return result;
};

module.exports = {
  backfillV3FromLegacy,
  __internal: {
    toWeatherUpsertRows,
    toRateUpsertRows,
  },
};
