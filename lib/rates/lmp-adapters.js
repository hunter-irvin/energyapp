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

const DEFAULT_CAISO_NODE = process.env.ENERGYAPP_CAISO_NODE || "";
const ALLOW_INSECURE_CAISO_TLS = process.env.ENERGYAPP_ALLOW_INSECURE_CAISO_TLS !== "0";
const CAISO_DA_VERSION = process.env.ENERGYAPP_CAISO_DA_VERSION || "12";
const CAISO_RT_VERSION = process.env.ENERGYAPP_CAISO_RT_VERSION || "1";
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

const isTlsIssuerError = (error) =>
  [
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ].includes(error?.code);

const isCaisoHost = (hostname) => hostname === "oasis.caiso.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createSourceError = (message, extras = {}) => {
  const error = new Error(message);
  if (extras && typeof extras === "object") {
    Object.keys(extras).forEach((key) => {
      error[key] = extras[key];
    });
  }
  return error;
};

const fetchBuffer = (targetUrl, options = {}) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const rejectUnauthorized = options.rejectUnauthorized !== false;
    const tlsRetryAttempted = options.tlsRetryAttempted === true;
    const headers = options.headers || {};
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      headers: { "User-Agent": "energyapp/1.0", ...headers },
      rejectUnauthorized,
    };
    https
      .get(requestOptions, (upstream) => {
        const chunks = [];
        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          resolve({
            statusCode: upstream.statusCode || 0,
            headers: upstream.headers || {},
            body: Buffer.concat(chunks),
          });
        });
      })
      .on("error", (error) => {
        const shouldRetryInsecure =
          !tlsRetryAttempted &&
          rejectUnauthorized &&
          ALLOW_INSECURE_CAISO_TLS &&
          isCaisoHost(parsedUrl.hostname) &&
          isTlsIssuerError(error);
        if (shouldRetryInsecure) {
          fetchBuffer(targetUrl, {
            ...options,
            rejectUnauthorized: false,
            tlsRetryAttempted: true,
          })
            .then(resolve)
            .catch(reject);
          return;
        }
        reject(
          createSourceError(String(error?.message || "request_error"), {
            code: String(error?.code || "REQUEST_ERROR"),
            sourceUrl: targetUrl,
          })
        );
      });
  });

const fetchJson = async (targetUrl, options = {}) => {
  const upstream = await fetchBuffer(targetUrl, options);
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    const bodyText = upstream.body.toString("utf8").slice(0, 400);
    throw createSourceError(`Upstream status ${upstream.statusCode}${bodyText ? `: ${bodyText}` : ""}`, {
      code: `HTTP_${upstream.statusCode}`,
      httpStatus: upstream.statusCode,
      sourceUrl: targetUrl,
      responseBody: bodyText || "",
    });
  }
  try {
    return JSON.parse(upstream.body.toString("utf8"));
  } catch (error) {
    throw createSourceError("Upstream returned invalid JSON", {
      code: "INVALID_JSON",
      sourceUrl: targetUrl,
    });
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
            reject(
              createSourceError(`Upstream status ${upstream.statusCode}`, {
                code: `HTTP_${upstream.statusCode}`,
                httpStatus: upstream.statusCode,
                sourceUrl: targetUrl,
              })
            );
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(
              createSourceError("Upstream returned invalid JSON", {
                code: "INVALID_JSON",
                sourceUrl: targetUrl,
              })
            );
          }
        });
    });
    req.on("error", (error) => {
      reject(
        createSourceError(String(error?.message || "request_error"), {
          code: String(error?.code || "REQUEST_ERROR"),
          sourceUrl: targetUrl,
        })
      );
    });
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

const findEndOfCentralDirectory = (buffer) => {
  // EOCD signature PK\005\006 is near file end (max comment length: 65535).
  const min = Math.max(0, buffer.length - (65535 + 22));
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
};

const readZipEntriesFromCentralDirectory = (buffer) => {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return [];
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const end = centralDirOffset + centralDirSize;
  if (centralDirOffset < 0 || end > buffer.length) return [];

  const entries = [];
  let cursor = centralDirOffset;
  while (cursor + 46 <= end && cursor + 46 <= buffer.length) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > buffer.length) break;
    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString("utf8");

    entries.push({
      fileName,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    cursor = fileNameEnd + extraLength + commentLength;
  }
  return entries;
};

const extractZipEntryText = (buffer, entry) => {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return "";
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) return "";
  const compressed = buffer.slice(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return compressed.toString("utf8");
  }
  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressed).toString("utf8");
  }
  return "";
};

const extractCsvFromZip = (buffer) => {
  // Prefer an explicit zip parser for CAISO SingleZip responses.
  if (buffer?.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    try {
      const entries = readZipEntriesFromCentralDirectory(buffer);
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (/\.csv$/i.test(entry.fileName || "")) {
          const text = extractZipEntryText(buffer, entry);
          if (text) return text;
        }
      }
    } catch (error) {
      // Fall through to zlib fallback.
    }
  }

  // Fallback for gzip/zlib payloads, if returned by upstream/CDN.
  try {
    return zlib.unzipSync(buffer).toString("utf8");
  } catch (error) {
    return "";
  }
};

const extractZipTextByPattern = (buffer, pattern) => {
  if (buffer?.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    try {
      const entries = readZipEntriesFromCentralDirectory(buffer);
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (pattern.test(entry.fileName || "")) {
          const text = extractZipEntryText(buffer, entry);
          if (text) return text;
        }
      }
    } catch (error) {
      return "";
    }
  }
  return "";
};

const extractCaisoErrorParts = (buffer) => {
  const xml = extractZipTextByPattern(buffer, /\.xml$/i);
  if (!xml) return { code: "", description: "" };
  const codeMatch = xml.match(/<m:ERR_CODE>([^<]+)<\/m:ERR_CODE>/i);
  const descMatch = xml.match(/<m:ERR_DESC>([^<]+)<\/m:ERR_DESC>/i);
  const code = String(codeMatch?.[1] || "").trim();
  const description = String(descMatch?.[1] || "").trim();
  return { code, description };
};

const parseRetryAfterMs = (value) => {
  if (value == null) return 0;
  const token = Array.isArray(value) ? value[0] : value;
  const asSeconds = Number(token);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }
  const asDate = Date.parse(String(token));
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return 0;
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

const buildCaisoAttemptPlan = ({ start, end, marketMode, reportVersion }) => {
  const now = new Date(Date.now() - 5 * 60 * 1000);
  const clampedEnd = end > now ? now : end;
  const attempts = [{ version: reportVersion, start, end }];
  if (marketMode === "real_time") {
    if (String(reportVersion) !== "1") attempts.push({ version: "1", start, end });
    if (clampedEnd > start) attempts.push({ version: "1", start, end: clampedEnd });
  }
  const deduped = [];
  const seen = new Set();
  attempts.forEach((attempt) => {
    const key = `${attempt.version}|${attempt.start.toISOString()}|${attempt.end.toISOString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(attempt);
  });
  return deduped;
};

const buildCaisoChunks = ({ start, end }) => {
  const chunks = [];
  const maxChunkMs = 7 * 24 * HOUR_MS;
  let cursor = new Date(start);
  while (cursor < end) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(Math.min(end.getTime(), chunkStart.getTime() + maxChunkMs));
    chunks.push({ start: chunkStart, end: chunkEnd });
    if (chunkEnd.getTime() <= cursor.getTime()) break;
    cursor = new Date(chunkEnd.getTime() + 60 * 1000);
  }
  return chunks;
};

const fetchCaisoChunkLive = async ({ start, end, marketMode, node }) => {
  const queryname = marketMode === "real_time" ? "PRC_INTVL_LMP" : "PRC_LMP";
  const marketRun = marketMode === "real_time" ? "RTM" : "DAM";
  const reportVersion = marketMode === "real_time" ? CAISO_RT_VERSION : CAISO_DA_VERSION;
  const attempts = buildCaisoAttemptPlan({ start, end, marketMode, reportVersion });
  let lastError = {
    message: "CAISO returned no CSV payload",
    code: "CAISO_NO_CSV",
    httpStatus: null,
    sourceUrl: "",
  };
  let primaryRequestUrl = "";

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const url = new URL("https://oasis.caiso.com/oasisapi/SingleZip");
    url.searchParams.set("queryname", queryname);
    url.searchParams.set("version", String(attempt.version));
    url.searchParams.set("resultformat", "6");
    url.searchParams.set("market_run_id", marketRun);
    url.searchParams.set("node", node || "TH_ZP26_GEN-APND");
    url.searchParams.set("startdatetime", formatCaisoTime(attempt.start));
    url.searchParams.set("enddatetime", formatCaisoTime(attempt.end));
    if (!primaryRequestUrl) primaryRequestUrl = url.toString();

    let upstream = null;
    for (let retry = 0; retry < 3; retry += 1) {
      // eslint-disable-next-line no-await-in-loop
      upstream = await fetchBuffer(url.toString());
      if (upstream.statusCode !== 429) {
        break;
      }
      const retryAfterMs = parseRetryAfterMs(upstream.headers?.["retry-after"]);
      const backoffMs = retryAfterMs || 700 * Math.pow(2, retry);
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoffMs);
    }
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      lastError = {
        message: `CAISO upstream status ${upstream.statusCode}`,
        code: `HTTP_${upstream.statusCode}`,
        httpStatus: upstream.statusCode,
        sourceUrl: url.toString(),
      };
      continue;
    }

    const csv = extractCsvFromZip(upstream.body);
    if (csv) {
      return {
        rows: parseCaisoRows(parseCsvRows(csv)),
        sourceUrl: url.toString(),
      };
    }

    const caisoError = extractCaisoErrorParts(upstream.body);
    lastError = {
      message:
        caisoError.code || caisoError.description
          ? `CAISO returned no CSV payload (${[caisoError.code, caisoError.description].filter(Boolean).join(": ")})`
          : "CAISO returned no CSV payload",
      code: caisoError.code || "CAISO_NO_CSV",
      httpStatus: upstream.statusCode || null,
      sourceUrl: url.toString(),
    };
  }

  throw createSourceError(lastError.message, {
    code: lastError.code || "CAISO_SOURCE_ERROR",
    httpStatus: lastError.httpStatus || null,
    sourceUrl: lastError.sourceUrl || primaryRequestUrl || "",
    provider: "CAISO",
  });
};

const fetchCaisoLive = async ({ start, end, marketMode, lat, utilityCode }) => {
  const node = resolveCaisoNode({ lat, utilityCode });
  const chunks = buildCaisoChunks({ start, end });
  const mergedRows = [];
  let lastError = null;
  let firstSourceUrl = "";
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const chunkResult = await fetchCaisoChunkLive({
        start: chunk.start,
        end: chunk.end,
        marketMode,
        node,
      });
      if (!firstSourceUrl && chunkResult?.sourceUrl) firstSourceUrl = chunkResult.sourceUrl;
      mergedRows.push(...(chunkResult?.rows || []));
    } catch (error) {
      lastError = error;
    }
  }

  if (mergedRows.length) {
    return {
      rows: mergedRows,
      sourceUrl: firstSourceUrl || String(lastError?.sourceUrl || ""),
      node,
    };
  }

  throw createSourceError(String(lastError?.message || "CAISO source unavailable"), {
    code: String(lastError?.code || "CAISO_SOURCE_ERROR"),
    httpStatus: lastError?.httpStatus ?? null,
    sourceUrl: String(lastError?.sourceUrl || ""),
    provider: "CAISO",
  });
};

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const resolveCaisoNode = ({ lat, utilityCode } = {}) => {
  if (DEFAULT_CAISO_NODE) return DEFAULT_CAISO_NODE;
  const utility = String(utilityCode || "").toLowerCase();
  if (utility.includes("sdge") || utility.includes("sce")) return "TH_SP15_GEN-APND";
  if (utility.includes("pge")) return "TH_NP15_GEN-APND";
  const nLat = Number(lat);
  if (!Number.isFinite(nLat)) return "TH_ZP26_GEN-APND";
  if (nLat >= 38) return "TH_NP15_GEN-APND";
  if (nLat < 35.5) return "TH_SP15_GEN-APND";
  return "TH_ZP26_GEN-APND";
};

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
    throw createSourceError("Missing ERCOT credentials for token generation", {
      code: "CONFIG_MISSING_CREDENTIALS",
      sourceUrl: ERCOT_AUTH_URL,
    });
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
    throw createSourceError("ERCOT auth did not return id_token", {
      code: "ERCOT_AUTH_NO_TOKEN",
      sourceUrl: ERCOT_AUTH_URL,
    });
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
    throw createSourceError("Missing ERCOT subscription key", {
      code: "CONFIG_MISSING_SUBSCRIPTION_KEY",
      sourceUrl: ERCOT_API_BASE,
    });
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
    throw createSourceError(
      `Missing ERCOT ${marketMode} endpoint. Set ${
        marketMode === "real_time" ? "ENERGYAPP_ERCOT_RT_LMP_ENDPOINT" : "ENERGYAPP_ERCOT_DA_LMP_ENDPOINT"
      }`,
      {
        code: "CONFIG_MISSING_ENDPOINT",
        sourceUrl: "",
      }
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
    throw createSourceError("ERCOT returned no rows", {
      code: "ERCOT_EMPTY_ROWS",
      sourceUrl: url.toString(),
    });
  }
  const parsedRows = parseErcotRows(rows);
  if (!parsedRows.length) {
    throw createSourceError("ERCOT rows did not contain parsable LMP values", {
      code: "ERCOT_UNPARSABLE_ROWS",
      sourceUrl: url.toString(),
    });
  }
  return {
    rows: parsedRows,
    sourceUrl: url.toString(),
  };
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
    const result = await fetchCaisoLive({ start, end, marketMode, lat, utilityCode });
    return {
      rows: result.rows,
      source: "rates_proxy_phase3_live_caiso_oasis",
      sourceUrl: result.sourceUrl || "",
      sourceNode: result.node || "",
    };
  }
  if (regionId === "ERCOT") {
    const result = await fetchErcotLive({ marketMode, start, end, lat, lng, utilityCode });
    const settlement = resolveErcotSettlementPoint({ lat, lng, utilityCode });
    return {
      rows: result.rows,
      source: "rates_proxy_phase3_live_ercot_public_api",
      sourceUrl: result.sourceUrl || "",
      sourceNode: settlement?.settlementPoint || "",
    };
  }
  throw createSourceError(`No live LMP adapter configured for ${regionId}`, {
    code: "REGION_NOT_SUPPORTED",
    sourceUrl: "",
  });
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
    const { rows, source, sourceUrl, sourceNode } = await fetchLiveRowsByRegion({
      regionId,
      marketMode,
      start,
      end,
      lat,
      lng,
      utilityCode,
    });
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
        sourceUrl: sourceUrl || "",
        sourceNode: sourceNode || "",
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
        upstreamErrorCode: String(error?.code || "UNKNOWN_ERROR"),
        upstreamHttpStatus: error?.httpStatus ?? null,
        sourceUrl: String(error?.sourceUrl || ""),
      },
    };
  }
};

module.exports = {
  getLmpSeries,
};
