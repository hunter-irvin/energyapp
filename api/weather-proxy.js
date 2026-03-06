const https = require("https");
const { URL } = require("url");

const API_KEY = process.env.ENERGYAPP_NREL_API_KEY || process.env.NREL_API_KEY || "";
const CONTACT_EMAIL =
  process.env.ENERGYAPP_NREL_CONTACT_EMAIL || process.env.NREL_CONTACT_EMAIL || "energyapp@example.com";
const SOLAR_YEAR = "2014";
const WIND_YEAR = "2014";
const NREL_INTERVAL_MINUTES = 30;
const OPEN_METEO_INTERVAL_MINUTES = 15;
const OPEN_METEO_HISTORY_DAYS = 365;
const OPEN_METEO_FORECAST_DAYS = 7;
const SOLAR_ENDPOINT =
  "https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-aggregated-v4-0-0-download.csv";
const WIND_ENDPOINT =
  "https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv";
const OPEN_METEO_FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_HISTORY_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";
const ALLOW_INSECURE_OPEN_METEO_TLS = process.env.ENERGYAPP_ALLOW_INSECURE_OPEN_METEO_TLS === "1";
const ALLOW_INSECURE_NREL_TLS = process.env.ENERGYAPP_ALLOW_INSECURE_NREL_TLS !== "0";

const nrelCsvCache = new Map();
const weatherJsonCache = new Map();
const WEATHER_JSON_CACHE_TTL_MS = {
  nrel: 24 * 60 * 60 * 1000,
  open_meteo: 15 * 60 * 1000,
};

const sendJsonError = (res, status, message) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ errors: [message] }));
};

const sendJson = (res, status, payload, extraHeaders = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
};

const isOpenMeteoHost = (hostname) =>
  hostname === "api.open-meteo.com" || hostname === "historical-forecast-api.open-meteo.com" || hostname === "archive-api.open-meteo.com";

const isNrelHost = (hostname) => hostname === "developer.nrel.gov";

const isTlsIssuerError = (error) =>
  [
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ].includes(error?.code);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const UPSTREAM_REQUEST_TIMEOUT_MS = 12000;

const fetchBuffer = (targetUrl, redirectsRemaining = 5, options = {}) =>
  new Promise((resolve, reject) => {
    const { rejectUnauthorized = true, tlsRetryAttempted = false } = options;
    const parsedUrl = new URL(targetUrl);
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      rejectUnauthorized,
      headers: {
        "User-Agent": "energyapp/1.0",
      },
    };

    let settled = false;
    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimeout);
      resolve(value);
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimeout);
      reject(error);
    };

    const request = https.get(requestOptions, (upstream) => {
      const { statusCode = 0, headers } = upstream;
      const location = headers.location;
      const isRedirect = statusCode >= 300 && statusCode < 400 && Boolean(location);

      if (isRedirect) {
        upstream.resume();
        if (redirectsRemaining <= 0) {
          settleReject(new Error("Too many redirects from upstream API."));
          return;
        }
        const nextUrl = new URL(location, targetUrl).toString();
        fetchBuffer(nextUrl, redirectsRemaining - 1, {
          rejectUnauthorized,
          tlsRetryAttempted,
        })
          .then(settleResolve)
          .catch(settleReject);
        return;
      }

      const chunks = [];
      upstream.on("data", (chunk) => chunks.push(chunk));
      upstream.on("end", () => {
        settleResolve({
          statusCode,
          headers,
          body: Buffer.concat(chunks),
        });
      });
      upstream.on("error", settleReject);
    });

    const absoluteTimeout = setTimeout(() => {
      request.destroy(new Error(`Upstream request timed out after ${UPSTREAM_REQUEST_TIMEOUT_MS}ms.`));
    }, UPSTREAM_REQUEST_TIMEOUT_MS);
    request.setTimeout(UPSTREAM_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Upstream request timed out after ${UPSTREAM_REQUEST_TIMEOUT_MS}ms.`));
    });

    request.on("error", (error) => {
      const shouldRetryInsecure =
        !tlsRetryAttempted &&
        rejectUnauthorized &&
        ((ALLOW_INSECURE_OPEN_METEO_TLS && isOpenMeteoHost(parsedUrl.hostname)) ||
          (ALLOW_INSECURE_NREL_TLS && isNrelHost(parsedUrl.hostname))) &&
        isTlsIssuerError(error);

      if (shouldRetryInsecure) {
        fetchBuffer(targetUrl, redirectsRemaining, {
          rejectUnauthorized: false,
          tlsRetryAttempted: true,
        })
          .then(settleResolve)
          .catch(settleReject);
        return;
      }

      settleReject(error);
    });
  });

const pad2 = (value) => String(value).padStart(2, "0");
const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
const formatDate = (date) => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
const parseDateInput = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

const parseOpenMeteoRangeLimit = (text) => {
  const source = String(text || "");
  const match = source.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
  if (!match) return null;
  return {
    minDate: match[1],
    maxDate: match[2],
  };
};

class OpenMeteoRangeLimitError extends Error {
  constructor(message, rangeLimit, statusCode = 400) {
    super(message || "Open-Meteo date range limit reached.");
    this.name = "OpenMeteoRangeLimitError";
    this.code = "OPEN_METEO_RANGE_LIMIT";
    this.rangeLimit = rangeLimit || null;
    this.statusCode = statusCode;
  }
}

const toIsoOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildCoverageWindowFromRows = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { start: null, end: null };
  }
  const timestamps = rows
    .map((row) => toIsoOrNull(row?.normalized_timestamp))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  if (!timestamps.length) {
    return { start: null, end: null };
  }
  return {
    start: timestamps[0],
    end: timestamps[timestamps.length - 1],
  };
};

const buildCoverageGaps = ({ requestedWindow, servedWindow }) => {
  const requestedStart = toIsoOrNull(requestedWindow?.start);
  const requestedEnd = toIsoOrNull(requestedWindow?.end);
  const servedStart = toIsoOrNull(servedWindow?.start);
  const servedEnd = toIsoOrNull(servedWindow?.end);

  if (!requestedStart || !requestedEnd) {
    return [];
  }
  if (!servedStart || !servedEnd) {
    return [{ start: requestedStart, end: requestedEnd, reason: "no_served_data" }];
  }

  const gaps = [];
  if (servedStart > requestedStart) {
    gaps.push({ start: requestedStart, end: servedStart, reason: "before_served_window" });
  }
  if (servedEnd < requestedEnd) {
    gaps.push({ start: servedEnd, end: requestedEnd, reason: "after_served_window" });
  }
  return gaps;
};

const withOpenMeteoMeta = ({
  baseMeta = {},
  records = [],
  requestedStartDate = null,
  requestedEndDate = null,
  expansionTier = "window",
  runId = "",
  rangeLimit = null,
} = {}) => {
  const servedWindow = buildCoverageWindowFromRows(records);
  const requestedWindow = {
    start: requestedStartDate ? toIsoOrNull(`${requestedStartDate}T00:00:00Z`) : null,
    end: requestedEndDate ? toIsoOrNull(`${requestedEndDate}T23:59:59Z`) : null,
  };
  const coverageWindow = {
    start: servedWindow.start,
    end: servedWindow.end,
  };

  return {
    ...baseMeta,
    requestedWindow,
    servedWindow,
    coverageWindow,
    coverageGaps: buildCoverageGaps({ requestedWindow, servedWindow }),
    expansionTier,
    rangeLimit: rangeLimit || null,
    runId: String(runId || ""),
    updatedAt: new Date().toISOString(),
  };
};

const parseIsoUtcParts = (timestamp) => {
  const match = String(timestamp).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second || "00"}Z`;
  return {
    year: String(Number(year)),
    month: String(Number(month)),
    day: String(Number(day)),
    hour: String(Number(hour)),
    minute: String(Number(minute)),
    normalized_timestamp: normalized,
  };
};

const normalizeHeader = (header) => {
  const cleaned = cleanText(header)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!cleaned) return cleaned;
  if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("80")) return "windspeed_80m";
  if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("100")) return "windspeed_100m";
  if (cleaned.includes("wind") && cleaned.includes("direction") && cleaned.includes("80")) return "winddirection_80m";
  if (cleaned.includes("wind") && cleaned.includes("direction") && cleaned.includes("100")) return "winddirection_100m";
  if (cleaned.includes("temperature") && cleaned.includes("80")) return "temperature_80m";
  if (cleaned.includes("temperature") && cleaned.includes("100")) return "temperature_100m";
  if (cleaned.includes("pressure") && cleaned.includes("100")) return "pressure_100m";
  if (cleaned.includes("air") && cleaned.includes("temperature")) return "air_temperature";
  return cleaned;
};

const parseCsv = (csvText) => {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => cleanText(line).toLowerCase().startsWith("year,month"));
  if (headerIndex === -1) {
    return [];
  }
  const headers = lines[headerIndex].split(",").map((header) => normalizeHeader(header));
  return lines.slice(headerIndex + 1).map((line) => {
    const values = line.split(",");
    return headers.reduce((acc, header, index) => {
      if (!header) {
        return acc;
      }
      acc[header] = cleanText(values[index]);
      return acc;
    }, {});
  });
};

const downsampleTo30Minutes = (records) =>
  records.filter((record) => {
    const minute = Number(record.minute || 0);
    return Number.isFinite(minute) && minute % NREL_INTERVAL_MINUTES === 0;
  });

const buildNrelRequestUrl = ({ dataset, wkt, intervalMinutes }) => {
  const baseUrl = dataset === "solar" ? SOLAR_ENDPOINT : WIND_ENDPOINT;
  const year = dataset === "solar" ? SOLAR_YEAR : WIND_YEAR;
  const attributes =
    dataset === "solar"
      ? "ghi,dni,dhi,air_temperature,wind_speed"
      : "windspeed_100m,winddirection_100m,temperature_100m,pressure_100m";

  const targetUrl = new URL(baseUrl);
  targetUrl.searchParams.set("api_key", API_KEY);
  targetUrl.searchParams.set("wkt", wkt);
  targetUrl.searchParams.set("names", year);
  targetUrl.searchParams.set("utc", "true");
  targetUrl.searchParams.set("leap_day", "false");
  targetUrl.searchParams.set("email", CONTACT_EMAIL);
  targetUrl.searchParams.set("interval", String(intervalMinutes));
  targetUrl.searchParams.set("attributes", attributes);
  return targetUrl.toString();
};

const fetchNrelCsv = async ({ dataset, wkt, intervalMinutes }) => {
  if (!API_KEY) {
    throw new Error("NREL API key is missing. Set ENERGYAPP_NREL_API_KEY or NREL_API_KEY.");
  }
  const cacheKey = `${dataset}-${wkt}-${intervalMinutes}`;
  if (nrelCsvCache.has(cacheKey)) {
    return { ...nrelCsvCache.get(cacheKey), fromCache: true };
  }

  const targetUrl = buildNrelRequestUrl({ dataset, wkt, intervalMinutes });
  const upstream = await fetchBuffer(targetUrl);
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    throw new Error(upstream.body.toString() || "Unable to fetch NREL dataset.");
  }

  const contentType = upstream.headers["content-type"] || "text/csv";
  const cached = { body: upstream.body, contentType };
  nrelCsvCache.set(cacheKey, cached);
  return { ...cached, fromCache: false };
};

const fetchAndNormalizeNrel = async ({ lat, lng }) => {
  const wkt = `POINT(${lng} ${lat})`;
  const [solarCsvData, windCsvData] = await Promise.all([
    fetchNrelCsv({ dataset: "solar", wkt, intervalMinutes: NREL_INTERVAL_MINUTES }),
    fetchNrelCsv({ dataset: "wind", wkt, intervalMinutes: NREL_INTERVAL_MINUTES }),
  ]);

  const solar = parseCsv(solarCsvData.body.toString("utf8"));
  const wind = parseCsv(windCsvData.body.toString("utf8"));

  return {
    solar,
    wind,
    meta: {
      provider: "nrel",
      sourceYear: Number(SOLAR_YEAR),
      intervalMinutes: NREL_INTERVAL_MINUTES,
      timezone: "UTC",
      fetchMode: "solar+wind_csv",
      cache: solarCsvData.fromCache && windCsvData.fromCache ? "HIT" : "MISS",
    },
  };
};

const fetchOpenMeteoJson = async (targetUrl) => {
  const upstream = await fetchBuffer(targetUrl);
  const raw = upstream.body.toString("utf8");

  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    try {
      const parsed = JSON.parse(raw);
      const reason = String(parsed?.reason || parsed?.error || "");
      const rangeLimit = parseOpenMeteoRangeLimit(reason);
      if (rangeLimit) {
        throw new OpenMeteoRangeLimitError(reason, rangeLimit, upstream.statusCode);
      }
      throw new Error(reason || `Open-Meteo returned HTTP ${upstream.statusCode}.`);
    } catch (error) {
      if (error instanceof OpenMeteoRangeLimitError) {
        throw error;
      }
      const rangeLimit = parseOpenMeteoRangeLimit(raw);
      if (rangeLimit) {
        throw new OpenMeteoRangeLimitError(raw, rangeLimit, upstream.statusCode);
      }
      throw new Error(cleanText(raw) || `Open-Meteo returned HTTP ${upstream.statusCode}.`);
    }
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_parseError) {
    throw new Error(`Open-Meteo returned non-JSON payload: ${cleanText(raw).slice(0, 200)}`);
  }
  const hasMinutely = Array.isArray(parsed?.minutely_15?.time);
  const hasHourly = Array.isArray(parsed?.hourly?.time);
  if (!hasMinutely && !hasHourly) {
    const reason = String(parsed?.reason || parsed?.error || "");
    const rangeLimit = parseOpenMeteoRangeLimit(reason);
    if (rangeLimit) {
      throw new OpenMeteoRangeLimitError(reason || "Open-Meteo range limited.", rangeLimit, upstream.statusCode || 400);
    }
    return { minutely_15: { time: [] } };
  }
  return parsed;
};

const fetchOpenMeteoJsonWithRetry = async (targetUrl, { retries = 2, delayMs = 800 } = {}) => {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchOpenMeteoJson(targetUrl);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
};

const OPEN_METEO_MINUTELY_FIELDS = [
  "shortwave_radiation",
  "direct_normal_irradiance",
  "diffuse_radiation",
  "temperature_2m",
  "wind_speed_80m",
  "wind_direction_80m",
  "temperature_80m",
  "surface_pressure",
];

const OPEN_METEO_HOURLY_FIELDS = [
  "shortwave_radiation",
  "direct_normal_irradiance",
  "diffuse_radiation",
  "temperature_2m",
  "wind_speed_80m",
  "wind_direction_80m",
  "temperature_80m",
  "surface_pressure",
];

const buildOpenMeteoUrl = (baseUrl, { lat, lng, startDate, endDate, forecastDays = null, cadence = "minutely_15" }) => {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("wind_speed_unit", "ms");
  if (cadence === "hourly") {
    url.searchParams.set("hourly", OPEN_METEO_HOURLY_FIELDS.join(","));
  } else {
    url.searchParams.set("minutely_15", OPEN_METEO_MINUTELY_FIELDS.join(","));
  }
  if (forecastDays != null) {
    url.searchParams.set("forecast_days", String(forecastDays));
  }
  if (startDate) {
    url.searchParams.set("start_date", startDate);
  }
  if (endDate) {
    url.searchParams.set("end_date", endDate);
  }
  return url.toString();
};

const normalizeOpenMeteoPayload = (payload) => {
  const minutelySeries = payload?.minutely_15 || null;
  const hourlySeries = payload?.hourly || null;
  const series =
    minutelySeries && Array.isArray(minutelySeries.time) && minutelySeries.time.length
      ? minutelySeries
      : hourlySeries;
  if (!series || !Array.isArray(series.time) || !series.time.length) {
    return [];
  }
  const rows = [];
  for (let i = 0; i < series.time.length; i += 1) {
    const parts = parseIsoUtcParts(series.time[i]);
    if (!parts) {
      continue;
    }
    const wind80 = series.wind_speed_80m?.[i];
    const windDir80 = series.wind_direction_80m?.[i];
    const temp80 = series.temperature_80m?.[i];
    const pressureSurface = series.surface_pressure?.[i];

    rows.push({
      ...parts,
      ghi: String(series.shortwave_radiation?.[i] ?? ""),
      dni: String(series.direct_normal_irradiance?.[i] ?? ""),
      dhi: String(series.diffuse_radiation?.[i] ?? ""),
      air_temperature: String(series.temperature_2m?.[i] ?? ""),
      windspeed_80m: String(wind80 ?? ""),
      winddirection_80m: String(windDir80 ?? ""),
      temperature_80m: String(temp80 ?? ""),
      pressure_surface: String(pressureSurface ?? ""),
      windspeed_100m: String(wind80 ?? ""),
      winddirection_100m: String(windDir80 ?? ""),
      temperature_100m: String(temp80 ?? ""),
      pressure_100m:
        pressureSurface == null || pressureSurface === ""
          ? ""
          : String(Number(pressureSurface) * 100),
    });
  }
  return rows;
};

const mergeUniqueByTimestamp = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.year}-${pad2(row.month)}-${pad2(row.day)}-${pad2(row.hour || 0)}-${pad2(row.minute || 0)}`;
    map.set(key, row);
  });
  return Array.from(map.values()).sort((a, b) => {
    const aKey = `${a.year}-${pad2(a.month)}-${pad2(a.day)}-${pad2(a.hour || 0)}-${pad2(a.minute || 0)}`;
    const bKey = `${b.year}-${pad2(b.month)}-${pad2(b.day)}-${pad2(b.hour || 0)}-${pad2(b.minute || 0)}`;
    return aKey.localeCompare(bKey);
  });
};

const fetchAndNormalizeOpenMeteo = async ({
  lat,
  lng,
  startDate = null,
  endDate = null,
  expansionTier = "window",
  runId = "",
  allowRangeClamp = true,
} = {}) => {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const windowStart = startDate ? parseDateInput(startDate) : null;
  const windowEnd = endDate ? parseDateInput(endDate) : null;
  const useWindow = Boolean(windowStart && windowEnd && windowStart <= windowEnd);
  const requestedStartDate = useWindow ? formatDate(windowStart) : null;
  const requestedEndDate = useWindow ? formatDate(windowEnd) : null;

  const buildResponseFromRows = (rows, fetchMode, rangeLimit = null) => {
    const downsampled = downsampleTo30Minutes(rows);
    const solar = downsampled.map((row) => ({
      year: row.year,
      month: row.month,
      day: row.day,
      hour: row.hour,
      minute: row.minute,
      ghi: row.ghi,
      dni: row.dni,
      dhi: row.dhi,
      air_temperature: row.air_temperature,
      wind_speed: row.windspeed_80m,
      normalized_timestamp: row.normalized_timestamp,
    }));
    const wind = downsampled.map((row) => ({
      year: row.year,
      month: row.month,
      day: row.day,
      hour: row.hour,
      minute: row.minute,
      windspeed_80m: row.windspeed_80m,
      winddirection_80m: row.winddirection_80m,
      temperature_80m: row.temperature_80m,
      pressure_surface: row.pressure_surface,
      windspeed_100m: row.windspeed_100m,
      winddirection_100m: row.winddirection_100m,
      temperature_100m: row.temperature_100m,
      pressure_100m: row.pressure_100m,
      normalized_timestamp: row.normalized_timestamp,
    }));

    return {
      solar,
      wind,
      meta: withOpenMeteoMeta({
        baseMeta: {
          provider: "open_meteo",
          sourceYear: null,
          intervalMinutes: NREL_INTERVAL_MINUTES,
          timezone: "UTC",
          fetchMode,
          historyDays: OPEN_METEO_HISTORY_DAYS,
          forecastDays: OPEN_METEO_FORECAST_DAYS,
          upstreamIntervalMinutes: OPEN_METEO_INTERVAL_MINUTES,
          requestStartDate: requestedStartDate,
          requestEndDate: requestedEndDate,
        },
        records: downsampled,
        requestedStartDate,
        requestedEndDate,
        expansionTier,
        runId,
        rangeLimit,
      }),
    };
  };

  const buildRangeLimitedResponse = (rangeLimit, reason) => ({
    solar: [],
    wind: [],
    meta: withOpenMeteoMeta({
      baseMeta: {
        provider: "open_meteo",
        sourceYear: null,
        intervalMinutes: NREL_INTERVAL_MINUTES,
        timezone: "UTC",
        fetchMode: useWindow ? "window_minutely_15_range_limited" : "historical_range_limited",
        historyDays: OPEN_METEO_HISTORY_DAYS,
        forecastDays: OPEN_METEO_FORECAST_DAYS,
        upstreamIntervalMinutes: OPEN_METEO_INTERVAL_MINUTES,
        requestStartDate: requestedStartDate,
        requestEndDate: requestedEndDate,
        userError: reason || "Requested window is outside Open-Meteo allowed range.",
      },
      records: [],
      requestedStartDate,
      requestedEndDate,
      expansionTier,
      runId,
      rangeLimit,
    }),
  });

  const addUtcDays = (value, dayDelta) => {
    const date = parseDateInput(value);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + dayDelta);
    return formatDate(date);
  };

  const buildWindowRequestPlan = (windowStartDate, windowEndDate, rangeLimit = null) => {
    const plan = [];
    const start = parseDateInput(windowStartDate);
    const end = parseDateInput(windowEndDate);
    if (!start || !end || start > end) {
      return plan;
    }

    if (!rangeLimit?.minDate || !rangeLimit?.maxDate) {
      plan.push({
        endpoint: OPEN_METEO_FORECAST_ENDPOINT,
        startDate: windowStartDate,
        endDate: windowEndDate,
        cadence: "minutely_15",
      });
      return plan;
    }

    const allowedStart = parseDateInput(rangeLimit.minDate);
    const allowedEnd = parseDateInput(rangeLimit.maxDate);
    if (!allowedStart || !allowedEnd || allowedStart > allowedEnd) {
      plan.push({
        endpoint: OPEN_METEO_HISTORY_ENDPOINT,
        startDate: windowStartDate,
        endDate: windowEndDate,
        cadence: "hourly",
      });
      return plan;
    }

    const intersectionStartDate = start > allowedStart ? formatDate(start) : formatDate(allowedStart);
    const intersectionEndDate = end < allowedEnd ? formatDate(end) : formatDate(allowedEnd);
    const hasForecastIntersection = parseDateInput(intersectionStartDate) <= parseDateInput(intersectionEndDate);

    if (!hasForecastIntersection) {
      plan.push({
        endpoint: OPEN_METEO_HISTORY_ENDPOINT,
        startDate: windowStartDate,
        endDate: windowEndDate,
        cadence: "hourly",
      });
      return plan;
    }

    if (start < allowedStart) {
      const archiveEndDate = addUtcDays(intersectionStartDate, -1);
      if (archiveEndDate && parseDateInput(windowStartDate) <= parseDateInput(archiveEndDate)) {
        plan.push({
          endpoint: OPEN_METEO_HISTORY_ENDPOINT,
          startDate: windowStartDate,
          endDate: archiveEndDate,
          cadence: "hourly",
        });
      }
    }

    plan.push({
      endpoint: OPEN_METEO_FORECAST_ENDPOINT,
      startDate: intersectionStartDate,
      endDate: intersectionEndDate,
        cadence: "minutely_15",
    });

    if (end > allowedEnd) {
      const archiveStartDate = addUtcDays(intersectionEndDate, 1);
      if (archiveStartDate && parseDateInput(archiveStartDate) <= parseDateInput(windowEndDate)) {
        plan.push({
          endpoint: OPEN_METEO_HISTORY_ENDPOINT,
          startDate: archiveStartDate,
          endDate: windowEndDate,
          cadence: "hourly",
        });
      }
    }

    return plan;
  };

  const fetchFromRequestPlan = async (requestPlan, fetchMode, rangeLimit = null) => {
    const isTimeoutLikeError = (error) => /(timeoutReached|timed out|timeout)/i.test(String(error?.message || ""));

    const splitRequestWindow = (request) => {
      if (!request?.startDate || !request?.endDate) {
        return null;
      }
      const start = parseDateInput(request.startDate);
      const end = parseDateInput(request.endDate);
      if (!start || !end || start >= end) {
        return null;
      }

      const spanDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      if (spanDays <= 2) {
        return null;
      }

      const leftEnd = new Date(start);
      leftEnd.setUTCDate(leftEnd.getUTCDate() + Math.floor(spanDays / 2) - 1);
      const rightStart = new Date(leftEnd);
      rightStart.setUTCDate(rightStart.getUTCDate() + 1);

      return [
        {
          ...request,
          startDate: formatDate(start),
          endDate: formatDate(leftEnd),
        },
        {
          ...request,
          startDate: formatDate(rightStart),
          endDate: formatDate(end),
        },
      ];
    };

    const fetchRequestPayloads = async (request, splitDepth = 0) => {
      try {
        const payload = await fetchOpenMeteoJsonWithRetry(
          buildOpenMeteoUrl(request.endpoint, {
            lat,
            lng,
            startDate: request.startDate || null,
            endDate: request.endDate || null,
            forecastDays: request.forecastDays ?? null,
            cadence: request.cadence || "minutely_15",
          }),
          { retries: 0, delayMs: 250 }
        );
        return [payload];
      } catch (error) {
        if (error instanceof OpenMeteoRangeLimitError) {
          throw error;
        }
        if (!isTimeoutLikeError(error) || splitDepth >= 5) {
          throw error;
        }
        const split = splitRequestWindow(request);
        if (!split) {
          throw error;
        }
        const [leftPayloads, rightPayloads] = await Promise.all([
          fetchRequestPayloads(split[0], splitDepth + 1),
          fetchRequestPayloads(split[1], splitDepth + 1),
        ]);
        return [...leftPayloads, ...rightPayloads];
      }
    };

    const payloadGroups = await Promise.all(requestPlan.map((request) => fetchRequestPayloads(request)));
    const payloads = payloadGroups.flat();
    const merged = mergeUniqueByTimestamp(payloads.flatMap((payload) => normalizeOpenMeteoPayload(payload)));
    return buildResponseFromRows(merged, fetchMode, rangeLimit);
  };

  const fetchClampedWindow = async (rangeLimit, reason) => {
    if (!allowRangeClamp || !useWindow || !rangeLimit?.minDate || !rangeLimit?.maxDate) {
      return buildRangeLimitedResponse(rangeLimit, reason);
    }

    const clampedStartDate = requestedStartDate < rangeLimit.minDate ? rangeLimit.minDate : requestedStartDate;
    const clampedEndDate = requestedEndDate > rangeLimit.maxDate ? rangeLimit.maxDate : requestedEndDate;

    if (!clampedStartDate || !clampedEndDate || clampedStartDate > clampedEndDate) {
      return buildRangeLimitedResponse(rangeLimit, reason);
    }

    if (clampedStartDate === requestedStartDate && clampedEndDate === requestedEndDate) {
      return buildRangeLimitedResponse(rangeLimit, reason);
    }

    const clampedResult = await fetchAndNormalizeOpenMeteo({
      lat,
      lng,
      startDate: clampedStartDate,
      endDate: clampedEndDate,
      expansionTier,
      runId,
      allowRangeClamp: false,
    });

    return {
      ...clampedResult,
      meta: {
        ...(clampedResult?.meta || {}),
        fetchMode: "window_minutely_15_clamped",
        requestStartDate: requestedStartDate,
        requestEndDate: requestedEndDate,
        rangeLimit,
        userError: reason || null,
        requestedWindow: {
          start: `${requestedStartDate}T00:00:00.000Z`,
          end: `${requestedEndDate}T23:59:59.000Z`,
        },
      },
    };
  };

  try {
    if (useWindow) {
      const windowPlan = buildWindowRequestPlan(requestedStartDate, requestedEndDate);
      return await fetchFromRequestPlan(windowPlan, "window_minutely_15");
    }

    const historyStart = new Date(todayUtc);
    historyStart.setUTCDate(historyStart.getUTCDate() - OPEN_METEO_HISTORY_DAYS);
    const historyStartDate = formatDate(historyStart);
    const forecastEnd = new Date(todayUtc);
    forecastEnd.setUTCDate(forecastEnd.getUTCDate() + OPEN_METEO_FORECAST_DAYS);

    const requestPlan = [
      {
        endpoint: OPEN_METEO_HISTORY_ENDPOINT,
        startDate: historyStartDate,
        endDate: formatDate(todayUtc),
        cadence: "hourly",
      },
      {
        endpoint: OPEN_METEO_FORECAST_ENDPOINT,
        startDate: formatDate(todayUtc),
        endDate: formatDate(forecastEnd),
        cadence: "minutely_15",
      },
    ];

    return await fetchFromRequestPlan(requestPlan, "historical+forecast_minutely_15");
  } catch (error) {
    if (error instanceof OpenMeteoRangeLimitError) {
      if (useWindow) {
        const hybridPlan = buildWindowRequestPlan(requestedStartDate, requestedEndDate, error.rangeLimit);
        if (hybridPlan.length > 0) {
          try {
            return await fetchFromRequestPlan(hybridPlan, "window_hybrid_forecast_archive", error.rangeLimit);
          } catch (_hybridError) {
            // fall through to clamped fallback
          }
        }
        return fetchClampedWindow(error.rangeLimit, error.message);
      }
      return buildRangeLimitedResponse(error.rangeLimit, error.message);
    }
    throw error;
  }
};

const handleNrelCsvProxy = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wkt = url.searchParams.get("wkt");
  const dataset = url.searchParams.get("dataset");
  const interval = Number(url.searchParams.get("interval") || String(NREL_INTERVAL_MINUTES));

  if (!wkt || !dataset) {
    sendJsonError(res, 400, "Missing required parameters.");
    return;
  }

  if (!["solar", "wind"].includes(dataset)) {
    sendJsonError(res, 400, "Invalid dataset.");
    return;
  }

  try {
    const upstream = await fetchNrelCsv({ dataset, wkt, intervalMinutes: interval });
    res.writeHead(200, {
      "Content-Type": upstream.contentType,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": upstream.fromCache ? "HIT" : "MISS",
    });
    res.end(upstream.body);
  } catch (error) {
    sendJsonError(res, 502, error.message || "Proxy error.");
  }
};

const handleWeatherProxy = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const provider = url.searchParams.get("provider") || "nrel";
  const mode = url.searchParams.get("mode") || "load_default";
  const requestSinceDate = cleanText(url.searchParams.get("sinceDate") || "");
  const requestStartDate = cleanText(url.searchParams.get("startDate") || "");
  const requestEndDate = cleanText(url.searchParams.get("endDate") || "");
  const requestExpansionTier = cleanText(url.searchParams.get("expansionTier") || "window") || "window";
  const requestRunId = cleanText(url.searchParams.get("runId") || "") || `weather_${Date.now().toString(36)}`;
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));

  if (!["nrel", "open_meteo"].includes(provider)) {
    sendJsonError(res, 400, "Invalid provider.");
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJsonError(res, 400, "Missing required latitude/longitude.");
    return;
  }

  const cacheSuffix =
    provider === "open_meteo" &&
    ((mode === "load_window" && requestStartDate && requestEndDate) ||
      (mode === "load_delta" && (requestSinceDate || requestEndDate)))
      ? `-${mode}-${requestSinceDate || requestStartDate || ""}-${requestEndDate || ""}`
      : "";
  const bypassCache = Boolean(cleanText(url.searchParams.get("cacheBust") || ""));
  const cacheKey = `${provider}-${lat.toFixed(4)}-${lng.toFixed(4)}${cacheSuffix}`;
  const cachedEntry = bypassCache ? null : weatherJsonCache.get(cacheKey);
  if (cachedEntry) {
    const ttlMs = WEATHER_JSON_CACHE_TTL_MS[provider] || WEATHER_JSON_CACHE_TTL_MS.nrel;
    const ageMs = Date.now() - Number(cachedEntry.savedAt || 0);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs) {
      sendJson(res, 200, cachedEntry.payload, { "X-Cache": "HIT" });
      return;
    }
    weatherJsonCache.delete(cacheKey);
  }

  try {
    const payload =
      provider === "open_meteo"
        ? await (() => {
            if (mode === "load_window") {
              return fetchAndNormalizeOpenMeteo({
                lat,
                lng,
                startDate: requestStartDate || null,
                endDate: requestEndDate || null,
                expansionTier: requestExpansionTier,
                runId: requestRunId,
              });
            }
            if (mode === "load_delta") {
              const today = new Date();
              today.setUTCHours(0, 0, 0, 0);
              const fallbackSince = new Date(today);
              fallbackSince.setUTCDate(fallbackSince.getUTCDate() - 45);
              const deltaStart = requestSinceDate || formatDate(fallbackSince);
              const deltaEndDate = parseDateInput(requestEndDate);
              const defaultDeltaEnd = new Date(today);
              defaultDeltaEnd.setUTCDate(defaultDeltaEnd.getUTCDate() + OPEN_METEO_FORECAST_DAYS);
              const deltaEnd = deltaEndDate ? formatDate(deltaEndDate) : formatDate(defaultDeltaEnd);
              return fetchAndNormalizeOpenMeteo({
                lat,
                lng,
                startDate: deltaStart,
                endDate: deltaEnd,
                expansionTier: requestExpansionTier,
                runId: requestRunId,
              }).then((result) => ({
                ...result,
                meta: {
                  ...(result?.meta || {}),
                  fetchMode: "delta_minutely_15",
                  requestSinceDate: deltaStart,
                  requestStartDate: deltaStart,
                  requestEndDate: deltaEnd,
                },
              }));
            }
            return fetchAndNormalizeOpenMeteo({
              lat,
              lng,
              startDate: null,
              endDate: null,
              expansionTier: requestExpansionTier,
              runId: requestRunId,
            });
          })()
        : await fetchAndNormalizeNrel({ lat, lng });

    if (!bypassCache) {
      weatherJsonCache.set(cacheKey, { payload, savedAt: Date.now() });
    }
    sendJson(res, 200, payload, { "X-Cache": bypassCache ? "BYPASS" : "MISS" });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Weather proxy error.");
  }
};

module.exports = handleWeatherProxy;
module.exports.handleWeatherProxy = handleWeatherProxy;
module.exports.handleNrelCsvProxy = handleNrelCsvProxy;
module.exports.fetchAndNormalizeOpenMeteo = fetchAndNormalizeOpenMeteo;
module.exports.fetchAndNormalizeNrel = fetchAndNormalizeNrel;

module.exports.__internal = {
  parseOpenMeteoRangeLimit,
  buildCoverageWindowFromRows,
  buildCoverageGaps,
  withOpenMeteoMeta,
  OpenMeteoRangeLimitError,
};
