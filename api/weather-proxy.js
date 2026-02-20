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
const OPEN_METEO_HISTORY_ENDPOINT = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const ALLOW_INSECURE_OPEN_METEO_TLS = process.env.ENERGYAPP_ALLOW_INSECURE_OPEN_METEO_TLS === "1";
const ALLOW_INSECURE_NREL_TLS = process.env.ENERGYAPP_ALLOW_INSECURE_NREL_TLS !== "0";

const nrelCsvCache = new Map();
const weatherJsonCache = new Map();

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
  hostname === "api.open-meteo.com" || hostname === "historical-forecast-api.open-meteo.com";

const isNrelHost = (hostname) => hostname === "developer.nrel.gov";

const isTlsIssuerError = (error) =>
  [
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ].includes(error?.code);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    https
      .get(requestOptions, (upstream) => {
        const { statusCode = 0, headers } = upstream;
        const location = headers.location;
        const isRedirect = statusCode >= 300 && statusCode < 400 && Boolean(location);

        if (isRedirect) {
          upstream.resume();
          if (redirectsRemaining <= 0) {
            reject(new Error("Too many redirects from upstream API."));
            return;
          }
          const nextUrl = new URL(location, targetUrl).toString();
          fetchBuffer(nextUrl, redirectsRemaining - 1, {
            rejectUnauthorized,
            tlsRetryAttempted,
          })
            .then(resolve)
            .catch(reject);
          return;
        }

        const chunks = [];
        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          resolve({
            statusCode,
            headers,
            body: Buffer.concat(chunks),
          });
        });
      })
      .on("error", (error) => {
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
            .then(resolve)
            .catch(reject);
          return;
        }

        reject(error);
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
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    throw new Error(upstream.body.toString() || "Unable to fetch Open-Meteo payload.");
  }
  const parsed = JSON.parse(upstream.body.toString("utf8"));
  if (!parsed?.minutely_15?.time || !Array.isArray(parsed.minutely_15.time)) {
    throw new Error("Open-Meteo response missing minutely_15 time series.");
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

const buildOpenMeteoUrl = (baseUrl, { lat, lng, startDate, endDate, forecastDays = null }) => {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set(
    "minutely_15",
    [
      "shortwave_radiation",
      "direct_normal_irradiance",
      "diffuse_radiation",
      "temperature_2m",
      "wind_speed_80m",
      "wind_direction_80m",
      "temperature_80m",
      "surface_pressure",
    ].join(",")
  );
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
  const { minutely_15: series } = payload;
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

const fetchAndNormalizeOpenMeteo = async ({ lat, lng, startDate = null, endDate = null }) => {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const windowStart = startDate ? parseDateInput(startDate) : null;
  const windowEnd = endDate ? parseDateInput(endDate) : null;
  const useWindow = Boolean(windowStart && windowEnd && windowStart <= windowEnd);

  const requestPlan = [];
  if (useWindow) {
    if (windowStart <= todayUtc) {
      const historyEnd = windowEnd <= todayUtc ? windowEnd : todayUtc;
      requestPlan.push({
        endpoint: OPEN_METEO_HISTORY_ENDPOINT,
        startDate: formatDate(windowStart),
        endDate: formatDate(historyEnd),
      });
    }
    if (windowEnd >= todayUtc) {
      const forecastStart = windowStart >= todayUtc ? windowStart : todayUtc;
      requestPlan.push({
        endpoint: OPEN_METEO_FORECAST_ENDPOINT,
        startDate: formatDate(forecastStart),
        endDate: formatDate(windowEnd),
      });
    }
  } else {
    const historyStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    historyStart.setUTCDate(historyStart.getUTCDate() - OPEN_METEO_HISTORY_DAYS);
    requestPlan.push({
      endpoint: OPEN_METEO_HISTORY_ENDPOINT,
      startDate: formatDate(historyStart),
      endDate: formatDate(todayUtc),
    });
    requestPlan.push({
      endpoint: OPEN_METEO_FORECAST_ENDPOINT,
      forecastDays: OPEN_METEO_FORECAST_DAYS,
    });
  }

  const payloads = await Promise.all(
    requestPlan.map((request) =>
      fetchOpenMeteoJsonWithRetry(
        buildOpenMeteoUrl(request.endpoint, {
          lat,
          lng,
          startDate: request.startDate || null,
          endDate: request.endDate || null,
          forecastDays: request.forecastDays ?? null,
        })
      )
    )
  );

  const merged = mergeUniqueByTimestamp(payloads.flatMap((payload) => normalizeOpenMeteoPayload(payload)));

  const downsampled = downsampleTo30Minutes(merged);
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
    meta: {
      provider: "open_meteo",
      sourceYear: null,
      intervalMinutes: NREL_INTERVAL_MINUTES,
      timezone: "UTC",
      fetchMode: useWindow ? "window_minutely_15" : "historical+forecast_minutely_15",
      historyDays: OPEN_METEO_HISTORY_DAYS,
      forecastDays: OPEN_METEO_FORECAST_DAYS,
      upstreamIntervalMinutes: OPEN_METEO_INTERVAL_MINUTES,
      requestStartDate: useWindow ? formatDate(windowStart) : null,
      requestEndDate: useWindow ? formatDate(windowEnd) : null,
    },
  };
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
  const requestStartDate = cleanText(url.searchParams.get("startDate") || "");
  const requestEndDate = cleanText(url.searchParams.get("endDate") || "");
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
    provider === "open_meteo" && mode === "load_window" && requestStartDate && requestEndDate
      ? `-${mode}-${requestStartDate}-${requestEndDate}`
      : "";
  const cacheKey = `${provider}-${lat.toFixed(4)}-${lng.toFixed(4)}${cacheSuffix}`;
  if (weatherJsonCache.has(cacheKey)) {
    sendJson(res, 200, weatherJsonCache.get(cacheKey), { "X-Cache": "HIT" });
    return;
  }

  try {
    const payload =
      provider === "open_meteo"
        ? await fetchAndNormalizeOpenMeteo({
            lat,
            lng,
            startDate: mode === "load_window" ? requestStartDate : null,
            endDate: mode === "load_window" ? requestEndDate : null,
          })
        : await fetchAndNormalizeNrel({ lat, lng });

    weatherJsonCache.set(cacheKey, payload);
    sendJson(res, 200, payload, { "X-Cache": "MISS" });
  } catch (error) {
    sendJsonError(res, 502, error.message || "Weather proxy error.");
  }
};

module.exports = handleWeatherProxy;
module.exports.handleWeatherProxy = handleWeatherProxy;
module.exports.handleNrelCsvProxy = handleNrelCsvProxy;
