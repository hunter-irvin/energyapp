const https = require("https");
const zlib = require("zlib");
const { URL } = require("url");
const { HOUR_MS, buildRangeHours, stableRandom, toIsoHour, buildMissingIntervals } = require("./series-utils");

const ADAPTER_CAPABILITIES = {
  CAISO: { real_time: true, day_ahead: true },
  ERCOT: { real_time: true, day_ahead: true },
  PJM: { real_time: false, day_ahead: false },
  MISO: { real_time: false, day_ahead: false },
  NYISO: { real_time: false, day_ahead: false },
  "ISO-NE": { real_time: false, day_ahead: false },
  SPP: { real_time: false, day_ahead: false },
  "NON-ISO": { real_time: false, day_ahead: false },
};

const DEFAULT_CAISO_NODE = process.env.ENERGYAPP_CAISO_NODE || "TH_NP15_GEN-APND";
const ERCOT_API_BASE = process.env.ENERGYAPP_ERCOT_API_BASE || "https://api.ercot.com";
const ERCOT_SUBSCRIPTION_KEY =
  process.env.ENERGYAPP_ERCOT_SUBSCRIPTION_KEY || process.env.ERCOT_SUBSCRIPTION_KEY || "";
const ERCOT_ID_TOKEN = process.env.ENERGYAPP_ERCOT_ID_TOKEN || process.env.ERCOT_ID_TOKEN || "";
const ERCOT_AUTH_URL =
  process.env.ENERGYAPP_ERCOT_AUTH_URL ||
  "https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token";
const ERCOT_CLIENT_ID =
  process.env.ENERGYAPP_ERCOT_CLIENT_ID || "fec253ea-0d06-4272-a5e6-b478baeecd70";
const ERCOT_SCOPE =
  process.env.ENERGYAPP_ERCOT_SCOPE || "openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access";
const ERCOT_USERNAME = process.env.ENERGYAPP_ERCOT_USERNAME || "";
const ERCOT_PASSWORD = process.env.ENERGYAPP_ERCOT_PASSWORD || "";
const ERCOT_RT_ENDPOINT = process.env.ENERGYAPP_ERCOT_RT_LMP_ENDPOINT || "";
const ERCOT_DA_ENDPOINT = process.env.ENERGYAPP_ERCOT_DA_LMP_ENDPOINT || "";
const ERCOT_DEFAULT_SETTLEMENT_POINT = process.env.ENERGYAPP_ERCOT_SETTLEMENT_POINT || "";
const ERCOT_DEFAULT_SETTLEMENT_POINT_TYPE = process.env.ENERGYAPP_ERCOT_SETTLEMENT_POINT_TYPE || "LZ";
let ercotTokenCache = {
  idToken: ERCOT_ID_TOKEN || null,
  expiresAtMs: ERCOT_ID_TOKEN ? Date.now() + 55 * 60 * 1000 : 0,
};

const fetchBuffer = (targetUrl, options = {}) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const headers = options.headers || {};
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      headers: { "User-Agent": "energyapp/1.0", ...headers },
    };
    https
      .get(requestOptions, (upstream) => {
        const chunks = [];
        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          resolve({
            statusCode: upstream.statusCode || 0,
            body: Buffer.concat(chunks),
          });
        });
      })
      .on("error", reject);
  });

const fetchJson = async (targetUrl, options = {}) => {
  const upstream = await fetchBuffer(targetUrl, options);
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    const bodyText = upstream.body.toString("utf8").slice(0, 400);
    throw new Error(`Upstream status ${upstream.statusCode}${bodyText ? `: ${bodyText}` : ""}`);
  }
  try {
    return JSON.parse(upstream.body.toString("utf8"));
  } catch (error) {
    throw new Error("Upstream returned invalid JSON");
  }
};

const postFormJson = (targetUrl, form = {}) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const body = Object.entries(form)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "POST",
      headers: {
        "User-Agent": "energyapp/1.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(requestOptions, (upstream) => {
      const chunks = [];
      upstream.on("data", (chunk) => chunks.push(chunk));
      upstream.on("end", () => {
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          reject(new Error(`Upstream status ${upstream.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(new Error("Upstream returned invalid JSON"));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

const formatCaisoTime = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}T${hour}:${minute}-0000`;
};

const parseCsvRows = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((cell) => cell.trim());
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i];
    }
    return row;
  });
};

const extractCsvFromZip = (buffer) => {
  try {
    return zlib.unzipSync(buffer).toString("utf8");
  } catch (error) {
    return "";
  }
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseCaisoRows = (rows = []) =>
  rows
    .map((row) => {
      const ts =
        row.intervalstarttime_gmt ||
        row.interval_start_gmt ||
        row.interval_start ||
        row.intervalstarttime ||
        row.datetime ||
        "";
      const value =
        toNumber(row.lmp) ??
        toNumber(row.lmp_prc) ??
        toNumber(row.mw) ??
        toNumber(row.value);
      const parsed = new Date(ts);
      if (!Number.isFinite(value) || Number.isNaN(parsed.getTime())) return null;
      return { ts: toIsoHour(parsed), value };
    })
    .filter(Boolean);

const fetchCaisoLive = async ({ start, end, marketMode }) => {
  const queryname = marketMode === "real_time" ? "PRC_INTVL_LMP" : "PRC_LMP";
  const marketRun = marketMode === "real_time" ? "RTM" : "DAM";
  const url = new URL("https://oasis.caiso.com/oasisapi/SingleZip");
  url.searchParams.set("queryname", queryname);
  url.searchParams.set("version", "12");
  url.searchParams.set("resultformat", "6");
  url.searchParams.set("market_run_id", marketRun);
  url.searchParams.set("node", DEFAULT_CAISO_NODE);
  url.searchParams.set("startdatetime", formatCaisoTime(start));
  url.searchParams.set("enddatetime", formatCaisoTime(end));
  const upstream = await fetchBuffer(url.toString());
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    throw new Error(`CAISO upstream status ${upstream.statusCode}`);
  }
  const csv = extractCsvFromZip(upstream.body);
  if (!csv) {
    throw new Error("CAISO returned no CSV payload");
  }
  return parseCaisoRows(parseCsvRows(csv));
};

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const resolveErcotSettlementPoint = ({ lat, lng, utilityCode } = {}) => {
  if (ERCOT_DEFAULT_SETTLEMENT_POINT) {
    return {
      settlementPoint: ERCOT_DEFAULT_SETTLEMENT_POINT,
      settlementPointType: ERCOT_DEFAULT_SETTLEMENT_POINT_TYPE || "LZ",
    };
  }
  const normalizedUtility = String(utilityCode || "").toLowerCase();
  if (normalizedUtility.includes("oncor") || normalizedUtility.includes("lubbock")) {
    return { settlementPoint: "LZ_NORTH", settlementPointType: "LZ" };
  }
  if (normalizedUtility.includes("aep")) {
    return { settlementPoint: "LZ_SOUTH", settlementPointType: "LZ" };
  }
  if (normalizedUtility.includes("tnmp")) {
    return { settlementPoint: "LZ_HOUSTON", settlementPointType: "LZ" };
  }
  if (Number.isFinite(Number(lng)) && Number(lng) <= -101) {
    return { settlementPoint: "LZ_WEST", settlementPointType: "LZ" };
  }
  if (Number.isFinite(Number(lat)) && Number(lat) >= 32.2) {
    return { settlementPoint: "LZ_NORTH", settlementPointType: "LZ" };
  }
  return { settlementPoint: "LZ_SOUTH", settlementPointType: "LZ" };
};

const normalizeErcotEndpoint = (endpoint) => {
  if (!endpoint) return "";
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${ERCOT_API_BASE.replace(/\/+$/, "")}/${String(endpoint).replace(/^\/+/, "")}`;
};

const getErcotToken = async () => {
  if (ercotTokenCache.idToken && ercotTokenCache.expiresAtMs > Date.now()) {
    return ercotTokenCache.idToken;
  }
  if (!ERCOT_USERNAME || !ERCOT_PASSWORD) {
    throw new Error("Missing ERCOT credentials for token generation");
  }
  const payload = await postFormJson(ERCOT_AUTH_URL, {
    username: ERCOT_USERNAME,
    password: ERCOT_PASSWORD,
    grant_type: "password",
    scope: ERCOT_SCOPE,
    client_id: ERCOT_CLIENT_ID,
    response_type: "id_token",
  });
  const idToken = payload?.id_token;
  if (!idToken) {
    throw new Error("ERCOT auth did not return id_token");
  }
  const expiresIn = Number(payload?.expires_in || 3600);
  ercotTokenCache = {
    idToken,
    expiresAtMs: Date.now() + Math.max(60, expiresIn - 120) * 1000,
  };
  return idToken;
};

const getErcotHeaders = async () => {
  if (!ERCOT_SUBSCRIPTION_KEY) {
    throw new Error("Missing ERCOT subscription key");
  }
  const token = ERCOT_ID_TOKEN || (await getErcotToken());
  return {
    Authorization: `Bearer ${token}`,
    "Ocp-Apim-Subscription-Key": ERCOT_SUBSCRIPTION_KEY,
  };
};

const parseErcotRows = (rows = []) =>
  rows
    .map((row) => {
      const deliveryDate = row?.deliveryDate || row?.DeliveryDate;
      const hourEnding = row?.hourEnding || row?.HourEnding;
      const deliveryHour = row?.deliveryHour || row?.DeliveryHour;
      const hourToken = hourEnding || deliveryHour;
      const parsedHour = Number.parseInt(String(hourToken || "").slice(0, 2), 10);
      const deliveryInterval = Number.parseInt(
        String(row?.deliveryInterval ?? row?.DeliveryInterval ?? ""),
        10
      );
      const tsRaw =
        row?.period ||
        row?.intervalEnding ||
        row?.deliveryDate ||
        row?.SCEDTimestamp ||
        row?.scedTimestamp ||
        row?.datetime ||
        row?.timestamp;
      const tsText = String(tsRaw || "");
      const parsed = (() => {
        if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(tsText)) return new Date(`${tsText}:00:00Z`);
        if (tsText && !Number.isNaN(new Date(tsText).getTime())) return new Date(tsText);
        if (deliveryDate && Number.isFinite(parsedHour)) {
          // ERCOT hour fields are typically hour-ending (1-24); convert to hour-start UTC.
          const hourStart = Math.max(0, Math.min(23, parsedHour - 1));
          const minute =
            Number.isFinite(deliveryInterval) && deliveryInterval > 0
              ? Math.max(0, Math.min(59, (deliveryInterval - 1) * 15))
              : 0;
          return new Date(
            `${deliveryDate}T${String(hourStart).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`
          );
        }
        return new Date("invalid");
      })();
      const value =
        toNumber(row?.lmp) ??
        toNumber(row?.LMP) ??
        toNumber(row?.price) ??
        toNumber(row?.settlementPointPrice) ??
        toNumber(row?.SettlementPointPrice) ??
        toNumber(row?.value);
      if (Number.isNaN(parsed.getTime()) || !Number.isFinite(value)) return null;
      return { ts: toIsoHour(parsed), value };
    })
    .filter(Boolean);

const mapRowsFromFields = ({ payload = {} } = {}) => {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (!fields.length) return rows;
  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    const mapped = {};
    fields.forEach((field, index) => {
      const key = typeof field === "string" ? field : String(field?.name || "");
      if (!key) return;
      const normalized = key.charAt(0).toLowerCase() + key.slice(1);
      mapped[key] = row[index];
      mapped[normalized] = row[index];
    });
    return mapped;
  });
};

const fetchErcotLive = async ({ marketMode, start, end, lat, lng, utilityCode }) => {
  const endpoint = normalizeErcotEndpoint(marketMode === "real_time" ? ERCOT_RT_ENDPOINT : ERCOT_DA_ENDPOINT);
  if (!endpoint) {
    throw new Error(
      `Missing ERCOT ${marketMode} endpoint. Set ${
        marketMode === "real_time" ? "ENERGYAPP_ERCOT_RT_LMP_ENDPOINT" : "ENERGYAPP_ERCOT_DA_LMP_ENDPOINT"
      }`
    );
  }
  const headers = await getErcotHeaders();
  const url = new URL(endpoint);
  if (!url.searchParams.has("deliveryDateFrom")) url.searchParams.set("deliveryDateFrom", toIsoDate(start));
  if (!url.searchParams.has("deliveryDateTo")) url.searchParams.set("deliveryDateTo", toIsoDate(end));
  const point = resolveErcotSettlementPoint({ lat, lng, utilityCode });
  if (point?.settlementPoint && !url.searchParams.has("settlementPoint")) {
    url.searchParams.set("settlementPoint", point.settlementPoint);
  }
  if (marketMode === "real_time" && point?.settlementPointType && !url.searchParams.has("settlementPointType")) {
    url.searchParams.set("settlementPointType", point.settlementPointType);
  }
  if (!url.searchParams.has("size")) url.searchParams.set("size", "5000");

  if (!url.searchParams.has("sort")) url.searchParams.set("sort", "deliveryDate");
  if (!url.searchParams.has("dir")) url.searchParams.set("dir", "ASC");

  const firstPayload = await fetchJson(url.toString(), { headers });
  const totalPages = Number(firstPayload?._meta?.totalPages || 1);
  const boundedPages = Number.isFinite(totalPages) ? Math.max(1, Math.min(totalPages, 40)) : 1;
  const payloads = [firstPayload];
  for (let page = 2; page <= boundedPages; page += 1) {
    const nextUrl = new URL(url.toString());
    nextUrl.searchParams.set("page", String(page));
    // eslint-disable-next-line no-await-in-loop
    const payload = await fetchJson(nextUrl.toString(), { headers });
    payloads.push(payload);
  }

  const rows = payloads.flatMap((payload) => mapRowsFromFields({ payload }));
  if (!rows.length) {
    throw new Error("ERCOT returned no rows");
  }
  const parsedRows = parseErcotRows(rows);
  if (!parsedRows.length) {
    throw new Error("ERCOT rows did not contain parsable LMP values");
  }
  return parsedRows;
};

const mapAverageByIsoHour = (rows = []) => {
  const buckets = new Map();
  rows.forEach((row) => {
    const ts = toIsoHour(new Date(row.ts));
    const value = Number(row.value);
    if (!Number.isFinite(value)) return;
    const current = buckets.get(ts) || { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    buckets.set(ts, current);
  });
  const averaged = new Map();
  buckets.forEach((bucket, ts) => {
    averaged.set(ts, Number((bucket.sum / bucket.count).toFixed(4)));
  });
  return averaged;
};

const modeledLmpValue = ({ date, regionId, marketMode }) => {
  const hour = date.getUTCHours();
  const day = date.getUTCDay();
  const seed = `${regionId}-${marketMode}-${date.toISOString().slice(0, 13)}`;
  const noise = (stableRandom(seed) - 0.5) * 8;
  const baseMap = {
    CAISO: 34,
    ERCOT: 31,
    PJM: 29,
    MISO: 27,
    NYISO: 36,
    "ISO-NE": 38,
    SPP: 25,
    "NON-ISO": 22,
  };
  const modeAdder = marketMode === "real_time" ? 3 : 1;
  const diurnal = Math.sin(((hour - 7) / 24) * Math.PI * 2) * 9;
  const weekend = day === 0 || day === 6 ? -4 : 0;
  const value = baseMap[regionId] + modeAdder + diurnal + weekend + noise;
  return Math.max(-20, Number(value.toFixed(2)));
};

const buildSeriesFromRows = ({
  rows = [],
  start,
  end,
  regionId,
  marketMode,
  source,
  reason = null,
  allowHistoricalBackfill = true,
}) => {
  const now = Date.now();
  const byHour = mapAverageByIsoHour(rows);
  const publishHorizonMs = marketMode === "real_time" ? 6 * HOUR_MS : 72 * HOUR_MS;
  let backfillHours = 0;
  const points = buildRangeHours(start, end).map((date) => {
    const ts = toIsoHour(date);
    const isForecast = date.getTime() > now;
    if (isForecast && date.getTime() > now + publishHorizonMs) {
      return {
        ts,
        value: null,
        isForecast,
        missingReason:
          marketMode === "real_time"
            ? "Real-time market not published yet."
            : "Day-ahead window not yet posted.",
      };
    }
    const value = byHour.get(ts);
    if (Number.isFinite(value)) return { ts, value, isForecast, missingReason: null };
    if (!isForecast && allowHistoricalBackfill) {
      backfillHours += 1;
      return {
        ts,
        value: modeledLmpValue({ date, regionId, marketMode }),
        isForecast,
        missingReason: "modeled_backfill",
      };
    }
    return {
      ts,
      value: null,
      isForecast,
      missingReason: reason || "No rate data from source.",
    };
  });
  return {
    points,
    missingIntervals: buildMissingIntervals(points),
    source,
    backfillHours,
  };
};

const buildFallbackModeledSeries = ({ start, end, regionId, marketMode }) => {
  const now = Date.now();
  const points = buildRangeHours(start, end).map((date) => {
    const ts = toIsoHour(date);
    const isForecast = date.getTime() > now;
    if (marketMode === "real_time" && isForecast && date.getTime() > now + 6 * HOUR_MS) {
      return { ts, value: null, isForecast, missingReason: "Real-time market not published yet." };
    }
    if (marketMode === "day_ahead" && isForecast && date.getTime() > now + 72 * HOUR_MS) {
      return { ts, value: null, isForecast, missingReason: "Day-ahead window not yet posted." };
    }
    return {
      ts,
      value: modeledLmpValue({ date, regionId, marketMode }),
      isForecast,
      missingReason: null,
    };
  });
  return {
    points,
    missingIntervals: buildMissingIntervals(points),
    source: "rates_proxy_phase2_modeled_fallback",
    unit: "USD/MWh",
    details: { reason: "source_unavailable" },
  };
};

const fetchLiveRowsByRegion = async ({ regionId, marketMode, start, end, lat, lng, utilityCode }) => {
  if (regionId === "CAISO") {
    return {
      rows: await fetchCaisoLive({ start, end, marketMode }),
      source: "rates_proxy_phase3_live_caiso_oasis",
    };
  }
  if (regionId === "ERCOT") {
    return {
      rows: await fetchErcotLive({ marketMode, start, end, lat, lng, utilityCode }),
      source: "rates_proxy_phase3_live_ercot_public_api",
    };
  }
  throw new Error(`No live LMP adapter configured for ${regionId}`);
};

const getLmpSeries = async ({ regionId, marketMode, start, end, lat, lng, utilityCode }) => {
  const capabilities = ADAPTER_CAPABILITIES[regionId] || { real_time: false, day_ahead: false };
  if (!capabilities[marketMode]) {
    return {
      ...buildFallbackModeledSeries({ start, end, regionId, marketMode }),
      details: { reason: "region_not_supported" },
    };
  }
  try {
    const { rows, source } = await fetchLiveRowsByRegion({ regionId, marketMode, start, end, lat, lng, utilityCode });
    const series = buildSeriesFromRows({
      rows,
      start,
      end,
      regionId,
      marketMode,
      source: source || "rates_proxy_phase3_live",
      reason: "source coverage gap",
      allowHistoricalBackfill: true,
    });
    return {
      ...series,
      unit: "USD/MWh",
      details: {
        reason: series.backfillHours > 0 ? "live_data_with_modeled_backfill" : "live_data",
        backfillHours: series.backfillHours || 0,
      },
    };
  } catch (error) {
    const fallback = buildFallbackModeledSeries({ start, end, regionId, marketMode });
    return {
      ...fallback,
      details: {
        ...(fallback.details || {}),
        reason: "source_unavailable",
        upstreamError: String(error?.message || "unknown_error"),
      },
    };
  }
};

module.exports = {
  getLmpSeries,
};
