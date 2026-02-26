const crypto = require("crypto");

const WEATHER_PAST_DAYS = 30;
const WEATHER_FUTURE_DAYS = 7;
const WEATHER_RESOLUTION_MINUTES = 30;

const pad2 = (value) => String(value).padStart(2, "0");

const toIso = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const toDateOnly = (value) => {
  const ts = new Date(value);
  return `${ts.getUTCFullYear()}-${pad2(ts.getUTCMonth() + 1)}-${pad2(ts.getUTCDate())}`;
};

const dayStartUtc = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));

const dayEndUtc = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const resolveRollingWindow = (nowIso) => {
  const now = new Date(nowIso || new Date().toISOString());
  const start = dayStartUtc(now);
  start.setUTCDate(start.getUTCDate() - WEATHER_PAST_DAYS);
  const end = dayEndUtc(now);
  end.setUTCDate(end.getUTCDate() + WEATHER_FUTURE_DAYS);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

const resolveWindow = ({ mode = "rolling", nowIso, windowStart, windowEnd }) => {
  const rolling = resolveRollingWindow(nowIso);
  if (mode === "rolling") return rolling;
  const explicitStart = toIso(windowStart);
  const explicitEnd = toIso(windowEnd);
  if (!explicitStart || !explicitEnd || explicitStart > explicitEnd) {
    return rolling;
  }
  return {
    startIso: explicitStart,
    endIso: explicitEnd,
  };
};

const rowToTimestampIso = (row) => {
  if (!row || typeof row !== "object") return null;
  if (row.normalized_timestamp) return toIso(row.normalized_timestamp);
  if (row.ts) return toIso(row.ts);
  if (row.year == null || row.month == null || row.day == null) return null;
  const hour = Number(row.hour || 0);
  const minute = Number(row.minute || 0);
  const value = new Date(
    Date.UTC(Number(row.year), Number(row.month) - 1, Number(row.day), hour, minute, 0, 0)
  );
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
};

const normalizeMetricValue = (value) => {
  if (value == null || value === "") return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  return value;
};

const buildMetrics = (row) => {
  const metrics = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (["year", "month", "day", "hour", "minute", "normalized_timestamp", "ts"].includes(key)) return;
    metrics[key] = normalizeMetricValue(value);
  });
  return metrics;
};

const buildFingerprint = ({ projectId, provider, windowStart, windowEnd, rowsByDataset }) => {
  const payload = {
    projectId,
    provider,
    windowStart,
    windowEnd,
    rowsByDataset: rowsByDataset.map((entry) => ({
      dataset: entry.dataset,
      count: entry.rows.length,
      firstTs: entry.rows[0]?.ts || null,
      lastTs: entry.rows[entry.rows.length - 1]?.ts || null,
    })),
  };
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
};

const normalizeSeriesRows = ({
  projectId,
  provider,
  nowIso,
  windowStart,
  windowEnd,
  raw,
  weatherFingerprint,
}) => {
  const nowMs = new Date(nowIso).getTime();
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const fetchedAt = nowIso;
  const source = `weather_proxy:${provider}`;

  const datasets = [
    { dataset: "solar", rows: Array.isArray(raw?.solar) ? raw.solar : [] },
    { dataset: "wind", rows: Array.isArray(raw?.wind) ? raw.wind : [] },
  ];

  const output = [];
  datasets.forEach(({ dataset, rows }) => {
    rows.forEach((row) => {
      const ts = rowToTimestampIso(row);
      if (!ts) return;
      const tsMs = new Date(ts).getTime();
      if (tsMs < startMs || tsMs > endMs) return;
      const isForecast = tsMs > nowMs;
      output.push({
        project_id: projectId,
        provider,
        dataset,
        ts,
        resolution_minutes: WEATHER_RESOLUTION_MINUTES,
        is_forecast: isForecast,
        metrics: buildMetrics(row),
        source,
        fetched_at: fetchedAt,
        status: isForecast ? "provisional" : "final",
        weather_fingerprint: weatherFingerprint,
        updated_at: fetchedAt,
      });
    });
  });
  return output;
};

const runWeatherSync = async ({
  project,
  mode = "rolling",
  windowStart = null,
  windowEnd = null,
  now = () => new Date().toISOString(),
  fetchWeather,
  store,
} = {}) => {
  if (!project?.id) throw new Error("Weather sync requires project.");
  if (!store?.upsertWeatherSeriesRows || !store?.deleteWeatherSeriesOutsideWindow) {
    throw new Error("Weather sync requires weather series store methods.");
  }
  if (typeof fetchWeather !== "function") {
    throw new Error("Weather sync requires fetchWeather implementation.");
  }
  const lat = Number(project.location_lat ?? project.lat);
  const lng = Number(project.location_lng ?? project.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Weather sync requires project latitude/longitude.");
  }

  const nowIso = now();
  const { startIso, endIso } = resolveWindow({
    mode,
    nowIso,
    windowStart,
    windowEnd,
  });
  const provider = String(project.weather_provider || project.weatherProvider || "open_meteo").trim().toLowerCase();

  const raw = await fetchWeather({
    provider,
    lat,
    lng,
    startDate: toDateOnly(startIso),
    endDate: toDateOnly(endIso),
  });

  const rowsByDataset = [
    { dataset: "solar", rows: Array.isArray(raw?.solar) ? raw.solar : [] },
    { dataset: "wind", rows: Array.isArray(raw?.wind) ? raw.wind : [] },
  ];
  const weatherFingerprint = buildFingerprint({
    projectId: project.id,
    provider,
    windowStart: startIso,
    windowEnd: endIso,
    rowsByDataset: rowsByDataset.map(({ dataset, rows }) => ({
      dataset,
      rows: rows
        .map((entry) => ({ ts: rowToTimestampIso(entry) }))
        .filter((entry) => Boolean(entry.ts))
        .sort((a, b) => String(a.ts).localeCompare(String(b.ts))),
    })),
  });

  const normalizedRows = normalizeSeriesRows({
    projectId: project.id,
    provider,
    nowIso,
    windowStart: startIso,
    windowEnd: endIso,
    raw,
    weatherFingerprint,
  });

  await store.upsertWeatherSeriesRows(normalizedRows);
  await store.deleteWeatherSeriesOutsideWindow({
    projectId: project.id,
    provider,
    windowStart: startIso,
    windowEnd: endIso,
  });
  if (store.updateProjectWeatherFingerprint) {
    await store.updateProjectWeatherFingerprint(project.id, weatherFingerprint);
  }

  return {
    fingerprint: weatherFingerprint,
    provider,
    windowStart: startIso,
    windowEnd: endIso,
    rowCount: normalizedRows.length,
  };
};

module.exports = {
  WEATHER_PAST_DAYS,
  WEATHER_FUTURE_DAYS,
  WEATHER_RESOLUTION_MINUTES,
  resolveRollingWindow,
  runWeatherSync,
};
