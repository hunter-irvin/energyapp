const crypto = require("crypto");
const { sumSolarAssets, sumWindAssets } = require("../../public/assets/js/features/generation.js");
const { resolveRollingWindow } = require("./weather-sync");

const GENERATION_RESOLUTION_MINUTES = 30;

const toIso = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const resolveWindow = ({ mode = "rolling", nowIso, windowStart, windowEnd }) => {
  if (mode === "rolling" || mode === "full") {
    return resolveRollingWindow(nowIso);
  }
  const explicitStart = toIso(windowStart);
  const explicitEnd = toIso(windowEnd);
  if (!explicitStart || !explicitEnd || explicitStart > explicitEnd) {
    return resolveRollingWindow(nowIso);
  }
  return {
    startIso: explicitStart,
    endIso: explicitEnd,
  };
};

const hashJson = (value) => crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");

const buildAssetFingerprint = (assets = []) =>
  hashJson(
    assets
      .map((asset) => ({
        type: String(asset.asset_type || asset.type || "").toLowerCase(),
        model: asset.model || {},
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );

const buildLocationFingerprint = (project) =>
  hashJson({
    lat: Number(project.location_lat ?? project.lat ?? 0),
    lng: Number(project.location_lng ?? project.lng ?? 0),
    provider: String(project.weather_provider || project.weatherProvider || ""),
  });

const groupWeatherByDataset = (rows = [], startIso, endIso) => {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const solarByTs = new Map();
  const windByTs = new Map();
  const timestamps = new Set();
  const weatherFingerprints = new Set();
  rows.forEach((row) => {
    const ts = toIso(row.ts);
    if (!ts) return;
    const tsMs = new Date(ts).getTime();
    if (tsMs < startMs || tsMs > endMs) return;
    if (row.weather_fingerprint) weatherFingerprints.add(String(row.weather_fingerprint));
    const dataset = String(row.dataset || "").toLowerCase();
    if (dataset === "solar") solarByTs.set(ts, row);
    if (dataset === "wind") windByTs.set(ts, row);
    timestamps.add(ts);
  });
  const sortedTs = Array.from(timestamps).sort((a, b) => a.localeCompare(b));
  return {
    sortedTs,
    solarByTs,
    windByTs,
    weatherFingerprint:
      weatherFingerprints.size === 1 ? Array.from(weatherFingerprints)[0] : hashJson(Array.from(weatherFingerprints).sort()),
  };
};

const normalizeRows = ({
  projectId,
  sortedTs,
  solarSeries,
  windSeries,
  weatherByTs,
  nowIso,
  weatherFingerprint,
  assetFingerprint,
  locationFingerprint,
}) => {
  const rows = [];
  const nowMs = new Date(nowIso).getTime();
  for (let i = 0; i < sortedTs.length; i += 1) {
    const ts = sortedTs[i];
    const solar = Number(solarSeries[i] || 0);
    const wind = Number(windSeries[i] || 0);
    const total = solar + wind;
    const weatherRow = weatherByTs.solarByTs.get(ts) || weatherByTs.windByTs.get(ts) || null;
    const forecastByWeather =
      Boolean(weatherByTs.solarByTs.get(ts)?.is_forecast) || Boolean(weatherByTs.windByTs.get(ts)?.is_forecast);
    const isForecast = forecastByWeather || new Date(ts).getTime() > nowMs;
    rows.push({
      project_id: projectId,
      ts,
      resolution_minutes: GENERATION_RESOLUTION_MINUTES,
      solar_value: Number.isFinite(solar) ? solar : 0,
      wind_value: Number.isFinite(wind) ? wind : 0,
      total_value: Number.isFinite(total) ? total : 0,
      unit: "kW",
      is_forecast: isForecast,
      status: isForecast ? "provisional" : "final",
      weather_fingerprint: weatherRow?.weather_fingerprint || weatherFingerprint || "unknown",
      asset_fingerprint: assetFingerprint,
      location_fingerprint: locationFingerprint,
      computed_at: nowIso,
      updated_at: nowIso,
    });
  }
  return rows;
};

const runGenerationSync = async ({
  project,
  mode = "rolling",
  windowStart = null,
  windowEnd = null,
  requestedBy = "manual_refresh",
  now = () => new Date().toISOString(),
  readAssets,
  readWeatherSeries,
  store,
  enqueueJob,
} = {}) => {
  if (!project?.id) throw new Error("Generation sync requires project.");
  if (typeof readAssets !== "function" || typeof readWeatherSeries !== "function") {
    throw new Error("Generation sync requires readAssets/readWeatherSeries callbacks.");
  }
  if (!store?.upsertGenerationSeriesRows) {
    throw new Error("Generation sync requires generation store methods.");
  }
  const nowIso = now();
  const { startIso, endIso } = resolveWindow({
    mode,
    nowIso,
    windowStart,
    windowEnd,
  });

  const assets = await readAssets(project.id);
  const weatherRows = await readWeatherSeries({
    projectId: project.id,
    startIso,
    endIso,
    resolutionMinutes: GENERATION_RESOLUTION_MINUTES,
    provider: String(project.weather_provider || project.weatherProvider || "").trim().toLowerCase() || null,
  });
  const weatherByTs = groupWeatherByDataset(weatherRows, startIso, endIso);
  const solarAssets = assets.filter((asset) => String(asset.asset_type || "").toLowerCase() === "solar").map((a) => a.model || {});
  const windAssets = assets.filter((asset) => String(asset.asset_type || "").toLowerCase() === "wind").map((a) => a.model || {});
  const solarWeatherSeries = weatherByTs.sortedTs.map((ts) => (weatherByTs.solarByTs.get(ts)?.metrics ? weatherByTs.solarByTs.get(ts).metrics : {}));
  const windWeatherSeries = weatherByTs.sortedTs.map((ts) => (weatherByTs.windByTs.get(ts)?.metrics ? weatherByTs.windByTs.get(ts).metrics : {}));

  const solarSeries = Array.from(sumSolarAssets(solarAssets, solarWeatherSeries));
  const windSeries = Array.from(sumWindAssets(windAssets, windWeatherSeries));
  const assetFingerprint = buildAssetFingerprint(assets);
  const locationFingerprint = buildLocationFingerprint(project);
  const rows = normalizeRows({
    projectId: project.id,
    sortedTs: weatherByTs.sortedTs,
    solarSeries,
    windSeries,
    weatherByTs,
    nowIso,
    weatherFingerprint: weatherByTs.weatherFingerprint,
    assetFingerprint,
    locationFingerprint,
  });

  await store.upsertGenerationSeriesRows(rows);
  if (mode !== "visible_window") {
    await store.deleteGenerationSeriesOutsideWindow({
      projectId: project.id,
      windowStart: startIso,
      windowEnd: endIso,
      resolutionMinutes: GENERATION_RESOLUTION_MINUTES,
    });
  }
  if (store.updateProjectGenerationFingerprints) {
    await store.updateProjectGenerationFingerprints(project.id, {
      assetFingerprint,
      weatherFingerprint: weatherByTs.weatherFingerprint,
    });
  }

  let backgroundEnqueued = false;
  if (mode === "visible_window" && typeof enqueueJob === "function") {
    const enqueueResult = await enqueueJob({
      projectId: project.id,
      domain: "generation",
      mode: "rolling",
      requestedBy,
      priority: 180,
      payload: { source: "visible_window_backfill" },
    });
    backgroundEnqueued = Boolean(enqueueResult && !enqueueResult.deduped);
  }

  return {
    fingerprint: hashJson({
      assetFingerprint,
      weatherFingerprint: weatherByTs.weatherFingerprint,
      startIso,
      endIso,
      count: rows.length,
    }),
    windowStart: startIso,
    windowEnd: endIso,
    rowCount: rows.length,
    backgroundEnqueued,
  };
};

module.exports = {
  GENERATION_RESOLUTION_MINUTES,
  runGenerationSync,
};
