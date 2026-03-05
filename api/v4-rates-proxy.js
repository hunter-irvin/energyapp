const { URL } = require("url");
const { resolveProviderMetadata } = require("../lib/rates/provider-resolver");
const {
  getCaliforniaRealtimeSeries,
  getCaliforniaDayAheadSeries,
  getCaliforniaResidentialSeries,
} = require("../lib/rates/california-adapter");

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
};

const sendJsonError = (res, status, message, extras = {}) =>
  sendJson(res, status, {
    errors: [String(message || "Request failed")],
    ...extras,
  });

const toIso = (value) => {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toFiniteOrNull = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const floorToBucketIso = (dateLike, bucketMinutes) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(1, Number(bucketMinutes) || 1);
  const bucketMs = minutes * 60 * 1000;
  const floored = Math.floor(date.getTime() / bucketMs) * bucketMs;
  return new Date(floored).toISOString();
};

const aggregatePoints = (points = [], bucketMinutes = 30) => {
  const byBucket = new Map();

  (Array.isArray(points) ? points : []).forEach((point) => {
    const ts = floorToBucketIso(point?.ts, bucketMinutes);
    if (!ts) return;
    if (!byBucket.has(ts)) {
      byBucket.set(ts, {
        ts,
        sum: 0,
        count: 0,
        isForecast: false,
      });
    }
    const bucket = byBucket.get(ts);
    bucket.isForecast = bucket.isForecast || Boolean(point?.isForecast);
    const value = toFiniteOrNull(point?.value);
    if (value == null) {
      return;
    }
    bucket.sum += value;
    bucket.count += 1;
  });

  return Array.from(byBucket.values())
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    .map((bucket) => ({
      ts: bucket.ts,
      value: bucket.count > 0 ? Number((bucket.sum / bucket.count).toFixed(6)) : null,
      isForecast: bucket.isForecast,
      missingReason: bucket.count === 0 ? "No source points in bucket." : null,
    }));
};

const parseRetryAfterSeconds = (seriesDetails = {}) => {
  const upstreamCode = String(seriesDetails?.upstreamErrorCode || "").toUpperCase();
  if (upstreamCode !== "HTTP_429") return null;
  const errorText = String(seriesDetails?.upstreamError || "");
  const match = errorText.match(/after\s+(\d+)\s+seconds/i);
  if (match) return Math.max(1, Number(match[1] || 0));
  return 5;
};

const mapRateTypeToConfig = (rateType) => {
  if (rateType === "commercial_realtime") {
    return {
      serviceType: "lmp",
      marketMode: "real_time",
      fetchSeries: getCaliforniaRealtimeSeries,
    };
  }
  if (rateType === "commercial_day_ahead") {
    return {
      serviceType: "lmp",
      marketMode: "day_ahead",
      fetchSeries: getCaliforniaDayAheadSeries,
    };
  }
  if (rateType === "residential") {
    return {
      serviceType: "tariff",
      marketMode: "tariff",
      fetchSeries: getCaliforniaResidentialSeries,
    };
  }
  return null;
};

const normalizeBasePoints = (points = []) =>
  (Array.isArray(points) ? points : [])
    .map((point) => ({
      ts: toIso(point?.ts),
      value: toFiniteOrNull(point?.value),
      isForecast: Boolean(point?.isForecast),
      missingReason: point?.missingReason || null,
    }))
    .filter((point) => Boolean(point.ts));

const handleV4RatesSeries = async (req, res) => {
  if (req.method !== "GET") {
    sendJsonError(res, 405, "Method not allowed.");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const rateType = String(url.searchParams.get("rateType") || "commercial_realtime").trim();
  const start = toIso(url.searchParams.get("start"));
  const end = toIso(url.searchParams.get("end"));
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const interval = String(url.searchParams.get("interval") || "hourly").trim();
  const projectId = String(url.searchParams.get("projectId") || "").trim() || null;
  const utilityCode = String(url.searchParams.get("utilityCode") || "").trim();

  if (!start || !end || start > end) {
    sendJsonError(res, 400, "Invalid start/end range.");
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJsonError(res, 400, "Missing required lat/lng.");
    return;
  }

  const config = mapRateTypeToConfig(rateType);
  if (!config) {
    sendJsonError(res, 400, "Unsupported rateType for current v4 phase.", {
      supportedRateTypes: ["commercial_realtime", "commercial_day_ahead", "residential"],
    });
    return;
  }

  try {
    const provider = await resolveProviderMetadata({ lat, lng });
    const regionId = String(provider?.isoRegion || "NON-ISO");
    const resolvedUtilityCode = utilityCode || String(provider?.utilityCode || "");

    const series = await config.fetchSeries({
      regionId,
      start: new Date(start),
      end: new Date(end),
      lat,
      utilityCode: resolvedUtilityCode,
    });

    const basePoints = normalizeBasePoints(series?.points || []);
    const halfHourPoints = aggregatePoints(basePoints, 30);
    const hourlyPoints = aggregatePoints(basePoints, 60);

    const details = series?.details || {};
    const retryAfterSeconds = parseRetryAfterSeconds(details);

    const payload = {
      ok: true,
      apiVersion: "v4",
      projectId,
      rateType,
      serviceType: config.serviceType,
      marketMode: config.marketMode,
      windowStart: start,
      windowEnd: end,
      intervalRequested: interval,
      source: String(series?.source || ""),
      sourceUnit: String(series?.unit || "USD/MWh"),
      timezone: String(provider?.timezone || "UTC"),
      isoRegion: regionId,
      utilityCode: resolvedUtilityCode,
      details: {
        reason: String(details?.reason || "live_data"),
        sourceUrl: String(details?.sourceUrl || ""),
        sourceNode: String(details?.sourceNode || ""),
        upstreamErrorCode: details?.upstreamErrorCode || null,
        upstreamHttpStatus: details?.upstreamHttpStatus ?? null,
        upstreamError: details?.upstreamError || null,
        userError: details?.userError || null,
        retryAfterSeconds,
        effectiveWindowEnd: details?.effectiveWindowEnd || null,
        adapterStats: details?.adapterStats || null,
        availableWindowStart: details?.availableWindowStart || null,
        availableWindowEnd: details?.availableWindowEnd || null,
      },
      series: {
        five_min: basePoints,
        half_hour: halfHourPoints,
        hourly: hourlyPoints,
      },
      fetchedAt: new Date().toISOString(),
    };

    const isUnavailable = String(details?.reason || "") === "source_unavailable";
    if (isUnavailable) {
      const httpStatus = Number(details?.upstreamHttpStatus) || 502;
      const status = httpStatus >= 400 && httpStatus < 500 ? httpStatus : 502;
      sendJson(res, status, payload);
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJsonError(res, 502, error?.message || "Failed to fetch v4 rates series.", {
      code: "V4_RATES_FETCH_FAILED",
    });
  }
};

module.exports = {
  handleV4RatesSeries,
  __internal: {
    aggregatePoints,
    floorToBucketIso,
    parseRetryAfterSeconds,
  },
};
