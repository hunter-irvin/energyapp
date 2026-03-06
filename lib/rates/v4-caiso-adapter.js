const https = require("https");
const zlib = require("zlib");
const { URL } = require("url");
const { HOUR_MS, buildMissingIntervals } = require("./series-utils");

const DEFAULT_CAISO_NODE = process.env.ENERGYAPP_CAISO_NODE || "";
const ALLOW_INSECURE_CAISO_TLS = process.env.ENERGYAPP_ALLOW_INSECURE_CAISO_TLS !== "0";
const CAISO_RT_VERSION = process.env.ENERGYAPP_V4_CAISO_RT_VERSION || process.env.ENERGYAPP_CAISO_RT_VERSION || "1";
const CAISO_DA_VERSION = process.env.ENERGYAPP_V4_CAISO_DA_VERSION || process.env.ENERGYAPP_CAISO_DA_VERSION || "12";
const CAISO_TIMEOUT_MS = Number(process.env.ENERGYAPP_V4_CAISO_TIMEOUT_MS || 15000);
const CAISO_PUBLISH_LAG_MS = 5 * 60 * 1000;
const MAX_CAISO_WINDOW_MS = 30 * 24 * HOUR_MS;

const isTlsIssuerError = (error) =>
  [
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ].includes(error?.code);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createSourceError = (message, extras = {}) => {
  const error = new Error(message);
  Object.keys(extras || {}).forEach((key) => {
    error[key] = extras[key];
  });
  return error;
};

const resolveV4DaInterChunkDelayMs = () => {
  const raw = Number(process.env.ENERGYAPP_V4_CAISO_DA_INTERCHUNK_DELAY_MS || 500);
  if (!Number.isFinite(raw)) return 500;
  return Math.max(0, Math.min(5000, Math.floor(raw)));
};

const formatCaisoTime = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}T${hour}:${minute}-0000`;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const floorToResolutionIso = (dateLike, resolutionMinutes) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const size = Math.max(1, Number(resolutionMinutes) || 5);
  const minute = date.getUTCMinutes();
  const flooredMinute = Math.floor(minute / size) * size;
  date.setUTCMinutes(flooredMinute, 0, 0);
  return date.toISOString();
};

const parseCsvLine = (line = "") => {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
};

const parseCsvRows = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  if (header[0]) header[0] = header[0].replace(/^\uFEFF/, "");
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i];
    }
    return row;
  });
};

const parseCaisoRows = (rows = [], options = {}) => {
  const marketMode = String(options.marketMode || "real_time").toLowerCase();
  const resolutionMinutes = marketMode === "day_ahead" ? 60 : 5;

  return rows
    .map((row) => {
      const ts =
        row.intervalstarttime_gmt ||
        row.interval_start_gmt ||
        row.interval_start ||
        row.intervalstarttime ||
        row.datetime ||
        "";

      const lmpType = String(row.lmp_type || "").toUpperCase();
      const xmlDataItem = String(row.xml_data_item || row.data_item || "").toUpperCase();

      // CAISO OASIS often returns prices in MW with XML_DATA_ITEM=LMP_PRC.
      // Filter to total LMP rows so congestion/loss component rows do not pollute the series.
      const isTotalLmpRow =
        xmlDataItem === "LMP_PRC" ||
        (!xmlDataItem && lmpType === "LMP");
      if (!isTotalLmpRow) return null;

      const value =
        toNumber(row.lmp) ??
        toNumber(row.lmp_prc) ??
        toNumber(row.lmp_price) ??
        toNumber(row.value) ??
        toNumber(row.price) ??
        toNumber(row.price_lmp) ??
        toNumber(row.mw);

      const parsed = new Date(ts);
      if (!Number.isFinite(value) || Number.isNaN(parsed.getTime())) return null;
      return { ts: floorToResolutionIso(parsed, resolutionMinutes), value };
    })
    .filter(Boolean);
};

const parseRetryAfterMs = (value) => {
  if (value == null) return 0;
  const token = Array.isArray(value) ? value[0] : value;
  const asSeconds = Number(token);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
  const asDate = Date.parse(String(token));
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return 0;
};

const parseRetryAfterFromErrorMs = (error) => {
  const msg = String(error?.message || "");
  const match = msg.match(/after\s+(\d+)\s+seconds/i);
  if (!match) return 0;
  const seconds = Number(match[1] || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000;
};

const findEndOfCentralDirectory = (buffer) => {
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
    entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
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
  if (entry.compressionMethod === 0) return compressed.toString("utf8");
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed).toString("utf8");
  return "";
};

const extractCsvFromZip = (buffer) => {
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
    } catch (_error) {
      return "";
    }
  }
  try {
    return zlib.unzipSync(buffer).toString("utf8");
  } catch (_error) {
    return "";
  }
};

const extractCaisoErrorParts = (buffer) => {
  if (!(buffer?.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50)) return { code: "", description: "" };
  try {
    const entries = readZipEntriesFromCentralDirectory(buffer);
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!/\.xml$/i.test(entry.fileName || "")) continue;
      const xml = extractZipEntryText(buffer, entry);
      if (!xml) continue;
      const codeMatch = xml.match(/<m:ERR_CODE>([^<]+)<\/m:ERR_CODE>/i);
      const descMatch = xml.match(/<m:ERR_DESC>([^<]+)<\/m:ERR_DESC>/i);
      return {
        code: String(codeMatch?.[1] || "").trim(),
        description: String(descMatch?.[1] || "").trim(),
      };
    }
  } catch (_error) {
    return { code: "", description: "" };
  }
  return { code: "", description: "" };
};

const fetchBufferWithTimeout = (targetUrl, options = {}) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || CAISO_TIMEOUT_MS));
    const rejectUnauthorized = options.rejectUnauthorized !== false;
    const tlsRetryAttempted = options.tlsRetryAttempted === true;

    const req = https.get(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
        headers: { "User-Agent": "energyapp-v4/1.0" },
        rejectUnauthorized,
      },
      (upstream) => {
        const chunks = [];
        upstream.setTimeout(timeoutMs, () => {
          upstream.destroy(
            createSourceError(`CAISO upstream response timeout after ${Math.round(timeoutMs / 1000)} seconds.`, {
              code: "UPSTREAM_TIMEOUT",
              httpStatus: 504,
              sourceUrl: targetUrl,
            })
          );
        });
        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          resolve({
            statusCode: upstream.statusCode || 0,
            headers: upstream.headers || {},
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(
        createSourceError(`CAISO upstream request timeout after ${Math.round(timeoutMs / 1000)} seconds.`, {
          code: "UPSTREAM_TIMEOUT",
          httpStatus: 504,
          sourceUrl: targetUrl,
        })
      );
    });

    req.on("error", (error) => {
      const shouldRetryInsecure =
        !tlsRetryAttempted &&
        rejectUnauthorized &&
        ALLOW_INSECURE_CAISO_TLS &&
        parsedUrl.hostname === "oasis.caiso.com" &&
        isTlsIssuerError(error);
      if (shouldRetryInsecure) {
        fetchBufferWithTimeout(targetUrl, {
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

const normalizeCaisoUtilityCode = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "pge" || raw === "sce" || raw === "sdge") return raw;
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (compact === "pacificgasandelectric") return "pge";
  if (compact === "southerncaliforniaedison") return "sce";
  if (compact === "sandiegogasandelectric") return "sdge";
  return raw;
};

const resolveCaisoNode = ({ lat, utilityCode } = {}) => {
  if (DEFAULT_CAISO_NODE) return DEFAULT_CAISO_NODE;
  const normalizedUtility = normalizeCaisoUtilityCode(utilityCode);
  if (normalizedUtility === "sdge" || normalizedUtility === "sce") return "TH_SP15_GEN-APND";
  if (normalizedUtility === "pge") return "TH_NP15_GEN-APND";
  const nLat = Number(lat);
  if (!Number.isFinite(nLat)) return "TH_ZP26_GEN-APND";
  if (nLat >= 38) return "TH_NP15_GEN-APND";
  if (nLat < 35.5) return "TH_SP15_GEN-APND";
  return "TH_ZP26_GEN-APND";
};

const clampPublishedEnd = (endDate) => {
  const nowLagged = new Date(Date.now() - CAISO_PUBLISH_LAG_MS);
  return endDate > nowLagged ? nowLagged : endDate;
};

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

const buildCaisoChunks = ({ start, end, marketMode = "real_time" }) => {
  const chunks = [];
  const rawStart = new Date(start);
  const rawEnd = new Date(end);
  if (Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime()) || rawEnd <= rawStart) return chunks;

  const requestedRangeMs = rawEnd.getTime() - rawStart.getTime();
  const cappedEndMs = rawStart.getTime() + Math.min(requestedRangeMs, MAX_CAISO_WINDOW_MS);
  const cappedEnd = new Date(cappedEndMs);
  if (cappedEnd <= rawStart) return chunks;

  // V4 policy: request the full visible window in a single CAISO call (max 30 days).
  chunks.push({ start: new Date(rawStart), end: cappedEnd });
  return chunks;
};

const fetchCaisoChunk = async ({ start, end, node, marketMode = "real_time" }) => {
  const isDayAhead = String(marketMode || "").toLowerCase() === "day_ahead";
  const queryname = isDayAhead ? "PRC_LMP" : "PRC_INTVL_LMP";
  const marketRun = isDayAhead ? "DAM" : "RTM";
  const reportVersion = isDayAhead ? CAISO_DA_VERSION : CAISO_RT_VERSION;
  const attempts = buildCaisoAttemptPlan({
    start,
    end,
    marketMode: isDayAhead ? "day_ahead" : "real_time",
    reportVersion,
  });

  let lastError = null;
  let firstRequestUrl = "";

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const url = new URL("https://oasis.caiso.com/oasisapi/SingleZip");
    url.searchParams.set("queryname", queryname);
    url.searchParams.set("version", String(attempt.version));
    url.searchParams.set("resultformat", "6");
    url.searchParams.set("market_run_id", marketRun);
    url.searchParams.set("node", node);
    url.searchParams.set("startdatetime", formatCaisoTime(attempt.start));
    url.searchParams.set("enddatetime", formatCaisoTime(attempt.end));
    if (!firstRequestUrl) firstRequestUrl = url.toString();

    // eslint-disable-next-line no-await-in-loop
    const upstream = await fetchBufferWithTimeout(url.toString());
    if (upstream.statusCode === 429) {
      const retryAfterMs = parseRetryAfterMs(upstream.headers?.["retry-after"]) || 5000;
      throw createSourceError(`CAISO rate limited. Please retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`, {
        code: "HTTP_429",
        httpStatus: 429,
        sourceUrl: url.toString(),
      });
    }

    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      lastError = createSourceError(`CAISO upstream status ${upstream.statusCode}.`, {
        code: `HTTP_${upstream.statusCode}`,
        httpStatus: upstream.statusCode,
        sourceUrl: url.toString(),
      });
      continue;
    }

    const csv = extractCsvFromZip(upstream.body);
    if (csv) {
      const parsedRows = parseCaisoRows(parseCsvRows(csv), { marketMode });
      if (parsedRows.length) {
        return {
          rows: parsedRows,
          sourceUrl: url.toString(),
        };
      }
      lastError = createSourceError("CAISO CSV contained no parseable price rows.", {
        code: "CAISO_EMPTY_CSV",
        httpStatus: upstream.statusCode || null,
        sourceUrl: url.toString(),
      });
      continue;
    }

    const caisoError = extractCaisoErrorParts(upstream.body);
    const caisoCode = String(caisoError.code || "").toUpperCase();
    const caisoDesc = String(caisoError.description || "");
    const retryTextMatch = caisoDesc.match(/after\s+(\d+)\s+seconds/i);
    if (caisoCode.includes("429") || /too\s*many\s*requests/i.test(caisoDesc)) {
      const retryAfterSeconds = Number(retryTextMatch?.[1] || 5);
      throw createSourceError(`CAISO rate limited. Please retry after ${retryAfterSeconds} seconds.`, {
        code: "HTTP_429",
        httpStatus: 429,
        sourceUrl: url.toString(),
      });
    }

    lastError = createSourceError(
      caisoCode || caisoDesc
        ? `CAISO returned no CSV payload (${[caisoCode, caisoDesc].filter(Boolean).join(": ")}).`
        : "CAISO returned no CSV payload.",
      {
        code: caisoCode || "CAISO_NO_CSV",
        httpStatus: upstream.statusCode || null,
        sourceUrl: url.toString(),
      }
    );
  }

  if (lastError) {
    throw createSourceError(lastError.message, {
      code: lastError.code || "CAISO_SOURCE_UNAVAILABLE",
      httpStatus: lastError.httpStatus ?? null,
      sourceUrl: lastError.sourceUrl || firstRequestUrl,
    });
  }

  throw createSourceError("CAISO source unavailable.", {
    code: "CAISO_SOURCE_UNAVAILABLE",
    sourceUrl: firstRequestUrl,
  });
};
const buildUnavailableSeries = ({ start, end, sourceNode, error, effectiveEnd, resolutionMinutes = 5, adapterStats = null }) => {
  const points = [];
  const stepMs = resolutionMinutes * 60 * 1000;
  const first = new Date(floorToResolutionIso(start, resolutionMinutes));
  const last = new Date(floorToResolutionIso(end, resolutionMinutes));
  for (let cursor = new Date(first); cursor <= last; cursor = new Date(cursor.getTime() + stepMs)) {
    points.push({
      ts: cursor.toISOString(),
      value: null,
      isForecast: cursor.getTime() > Date.now(),
      missingReason: "No rate data from source.",
    });
  }
  return {
    points,
    missingIntervals: buildMissingIntervals(points),
    source: "rates_v4_caiso_unavailable",
    unit: "USD/MWh",
    resolutionMinutes,
    details: {
      reason: "source_unavailable",
      sourceNode,
      sourceUrl: String(error?.sourceUrl || ""),
      upstreamError: String(error?.message || "unknown_error"),
      upstreamErrorCode: String(error?.code || "UNKNOWN_ERROR"),
      upstreamHttpStatus: error?.httpStatus ?? null,
      effectiveWindowEnd: effectiveEnd ? new Date(effectiveEnd).toISOString() : null,
      adapterStats: adapterStats || null,
    },
  };
};

const buildSeriesFromRows = ({ rows, start, end, sourceNode, sourceUrl, partialError, effectiveEnd, resolutionMinutes = 5, adapterStats = null }) => {
  const pointMap = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const ts = floorToResolutionIso(row?.ts, resolutionMinutes);
    const value = toNumber(row?.value);
    if (!ts || value == null) return;
    const existing = pointMap.get(ts);
    if (!existing) {
      pointMap.set(ts, { sum: value, count: 1 });
      return;
    }
    existing.sum += value;
    existing.count += 1;
  });

  const points = [];
  const stepMs = resolutionMinutes * 60 * 1000;
  const first = new Date(floorToResolutionIso(start, resolutionMinutes));
  const last = new Date(floorToResolutionIso(end, resolutionMinutes));
  for (let cursor = new Date(first); cursor <= last; cursor = new Date(cursor.getTime() + stepMs)) {
    const ts = cursor.toISOString();
    const bucket = pointMap.get(ts);
    const value = bucket?.count ? Number((bucket.sum / bucket.count).toFixed(6)) : null;
    points.push({
      ts,
      value,
      isForecast: cursor.getTime() > Date.now(),
      missingReason: value == null ? "source coverage gap" : null,
    });
  }

  const reason = partialError ? "partial_data" : "live_data";

  return {
    points,
    missingIntervals: buildMissingIntervals(points),
    source: "rates_v4_caiso_oasis",
    unit: "USD/MWh",
    resolutionMinutes,
    details: {
      reason,
      sourceNode,
      sourceUrl,
      upstreamError: partialError ? String(partialError?.message || "") : null,
      upstreamErrorCode: partialError ? String(partialError?.code || "") : null,
      upstreamHttpStatus: partialError ? partialError?.httpStatus ?? null : null,
      effectiveWindowEnd: effectiveEnd ? new Date(effectiveEnd).toISOString() : null,
      adapterStats: adapterStats || null,
    },
  };
};

const fetchV4CaisoSeries = async ({ regionId, start, end, lat, utilityCode, marketMode = "real_time" }) => {
  const isDayAhead = String(marketMode || "").toLowerCase() === "day_ahead";
  const resolutionMinutes = isDayAhead ? 60 : 5;

  if (String(regionId || "") !== "CAISO") {
    return {
      points: [],
      missingIntervals: [],
      source: "rates_v4_region_unsupported",
      unit: "USD/MWh",
      resolutionMinutes,
      details: {
        reason: "source_unavailable",
        upstreamError: `Region ${regionId} is not enabled for Rates V4 ${isDayAhead ? "day-ahead" : "real-time"}.`,
        upstreamErrorCode: "REGION_NOT_SUPPORTED",
        upstreamHttpStatus: 422,
      },
    };
  }

  const requestedStart = new Date(start);
  const requestedEnd = new Date(end);
  const effectiveEnd = isDayAhead ? requestedEnd : clampPublishedEnd(requestedEnd);

  if (effectiveEnd <= requestedStart) {
    return buildUnavailableSeries({
      start: requestedStart,
      end: requestedEnd,
      sourceNode: resolveCaisoNode({ lat, utilityCode }),
      error: createSourceError(
        isDayAhead ? "Day-ahead market data is not yet published for this window." : "Real-time market data is not yet published for this window.",
        {
          code: "WINDOW_NOT_PUBLISHED",
          httpStatus: 422,
        }
      ),
      effectiveEnd,
      resolutionMinutes,
    });
  }

  const node = resolveCaisoNode({ lat, utilityCode });
  const chunks = buildCaisoChunks({ start: requestedStart, end: effectiveEnd, marketMode });
  const mergedRows = [];
  let firstSourceUrl = "";
  let lastError = null;
  let chunkErrorCount = 0;
  const daInterChunkDelayMs = isDayAhead ? resolveV4DaInterChunkDelayMs() : 0;

  const adapterStats = {
    primaryChunkCount: chunks.length,
    attemptedChunks: 0,
    succeededChunks: 0,
    failedChunks: 0,
    splitChunks: 0,
    retriesTriggered: 0,
    cooldownWaits: 0,
    maxSplitDepthReached: 0,
  };

  let lastDaRequestAtMs = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;

    if (isDayAhead && daInterChunkDelayMs > 0 && lastDaRequestAtMs > 0) {
      const sinceMs = Date.now() - lastDaRequestAtMs;
      if (sinceMs < daInterChunkDelayMs) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(daInterChunkDelayMs - sinceMs);
      }
    }

    try {
      adapterStats.attemptedChunks += 1;
      // eslint-disable-next-line no-await-in-loop
      const chunkResult = await fetchCaisoChunk({ start: chunk.start, end: chunk.end, node, marketMode });
      lastDaRequestAtMs = Date.now();
      if (!firstSourceUrl && chunkResult?.sourceUrl) firstSourceUrl = chunkResult.sourceUrl;
      mergedRows.push(...(chunkResult?.rows || []));
      adapterStats.succeededChunks += 1;
    } catch (error) {
      lastDaRequestAtMs = Date.now();
      adapterStats.failedChunks += 1;
      lastError = error;
      chunkErrorCount += 1;
      if (parseRetryAfterFromErrorMs(error) > 0 || String(error?.code || "").toUpperCase() === "HTTP_429") {
        adapterStats.retriesTriggered += 1;
      }
      break;
    }
  }
  if (mergedRows.length) {
    return buildSeriesFromRows({
      rows: mergedRows,
      start: requestedStart,
      end: requestedEnd,
      sourceNode: node,
      sourceUrl: firstSourceUrl || String(lastError?.sourceUrl || ""),
      partialError: chunkErrorCount > 0 ? lastError : null,
      effectiveEnd,
      resolutionMinutes,
      adapterStats,
    });
  }

  return buildUnavailableSeries({
    start: requestedStart,
    end: requestedEnd,
    sourceNode: node,
    error:
      lastError ||
      createSourceError("CAISO returned no parseable rows for requested window.", {
        code: "CAISO_NO_PARSEABLE_ROWS",
        httpStatus: 502,
        sourceUrl: firstSourceUrl,
      }),
    effectiveEnd,
    resolutionMinutes,
    adapterStats,
  });
};

const getV4RealtimeSeries = async ({ regionId, start, end, lat, utilityCode }) =>
  fetchV4CaisoSeries({ regionId, start, end, lat, utilityCode, marketMode: "real_time" });

const getV4DayAheadSeries = async ({ regionId, start, end, lat, utilityCode }) =>
  fetchV4CaisoSeries({ regionId, start, end, lat, utilityCode, marketMode: "day_ahead" });
module.exports = {
  getV4RealtimeSeries,
  getV4DayAheadSeries,
};

