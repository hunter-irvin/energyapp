const crypto = require("crypto");

const toIso = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const hash = (value) => crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");

const inferResolutionFromPoints = (points = [], fallback = 60) => {
  const unique = Array.from(
    new Set(
      (Array.isArray(points) ? points : [])
        .map((point) => new Date(point?.ts).getTime())
        .filter((value) => Number.isFinite(value))
    )
  ).sort((a, b) => a - b);
  if (unique.length < 2) return fallback;
  let minDiff = null;
  for (let i = 1; i < unique.length; i += 1) {
    const diffMin = Math.round((unique[i] - unique[i - 1]) / 60000);
    if (!Number.isFinite(diffMin) || diffMin <= 0) continue;
    minDiff = minDiff == null ? diffMin : Math.min(minDiff, diffMin);
  }
  return Number.isFinite(minDiff) ? minDiff : fallback;
};

const rowToIsoFromLegacyWeather = (row) => {
  if (!row || typeof row !== "object") return null;
  if (row.normalized_timestamp) return toIso(row.normalized_timestamp);
  if (row.ts || row.timestamp) return toIso(row.ts || row.timestamp);
  if (row.year == null || row.month == null || row.day == null) return null;
  const date = new Date(
    Date.UTC(
      Number(row.year),
      Number(row.month) - 1,
      Number(row.day),
      Number(row.hour || 0),
      Number(row.minute || 0),
      0,
      0
    )
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeLegacyWeatherPoints = ({
  rows = [],
  start,
  end,
  resolutionMinutes = null,
} = {}) => {
  const startIso = toIso(start);
  const endIso = toIso(end);
  const output = [];
  (Array.isArray(rows) ? rows : []).forEach((cacheRow) => {
    const payload = Array.isArray(cacheRow?.payload) ? cacheRow.payload : [];
    const provider = cacheRow?.provider || "nrel";
    const dataset = cacheRow?.dataset || null;
    const fp = hash({
      projectId: cacheRow?.project_id || null,
      provider,
      dataset,
      fetchedAt: cacheRow?.fetched_at || null,
      count: payload.length,
    });
    payload.forEach((entry) => {
      const ts = rowToIsoFromLegacyWeather(entry);
      if (!ts) return;
      if (startIso && ts < startIso) return;
      if (endIso && ts > endIso) return;
      output.push({
        ts,
        dataset,
        provider,
        isForecast: new Date(ts).getTime() > Date.now(),
        status: new Date(ts).getTime() > Date.now() ? "provisional" : "final",
        metrics: { ...entry },
        weatherFingerprint: fp,
      });
    });
  });
  if (resolutionMinutes == null) return output.sort((a, b) => a.ts.localeCompare(b.ts));
  const filterMin = Number(resolutionMinutes);
  if (!Number.isFinite(filterMin) || filterMin <= 0) return output.sort((a, b) => a.ts.localeCompare(b.ts));
  return output
    .filter((point) => new Date(point.ts).getUTCMinutes() % filterMin === 0)
    .sort((a, b) => a.ts.localeCompare(b.ts));
};

const normalizeLegacyRatePoints = ({
  rows = [],
  start,
  end,
  resolutionMinutes = null,
} = {}) => {
  const startIso = toIso(start);
  const endIso = toIso(end);
  const points = [];
  (Array.isArray(rows) ? rows : []).forEach((cacheRow) => {
    const payloadPoints = Array.isArray(cacheRow?.payload?.points) ? cacheRow.payload.points : [];
    payloadPoints.forEach((point) => {
      const ts = toIso(point?.ts);
      if (!ts) return;
      if (startIso && ts < startIso) return;
      if (endIso && ts > endIso) return;
      points.push({
        ts,
        value: point?.value == null ? null : Number(point.value),
        isForecast: Boolean(point?.isForecast),
        status: point?.value == null ? "provisional" : "final",
        errorCode: point?.value == null ? "legacy_gap" : null,
      });
    });
  });
  points.sort((a, b) => a.ts.localeCompare(b.ts));
  if (resolutionMinutes == null) return points;
  const target = Number(resolutionMinutes);
  if (!Number.isFinite(target) || target <= 0) return points;
  return points.filter((point) => new Date(point.ts).getUTCMinutes() % target === 0);
};

const preferPrimarySeries = (primary = [], fallback = []) => {
  const primaryRows = Array.isArray(primary) ? primary : [];
  if (primaryRows.length) return { rows: primaryRows, source: "primary" };
  const fallbackRows = Array.isArray(fallback) ? fallback : [];
  return { rows: fallbackRows, source: fallbackRows.length ? "fallback" : "empty" };
};

module.exports = {
  inferResolutionFromPoints,
  normalizeLegacyWeatherPoints,
  normalizeLegacyRatePoints,
  preferPrimarySeries,
};
