const fs = require("fs");
const path = require("path");
const { getV4RealtimeSeries, getV4DayAheadSeries } = require("./v4-caiso-adapter");

const NEM_DATA_PATH = path.join(__dirname, "..", "..", "docs", "data", "nem3-hourly-rates-2026.json");
const NEM_TIMEZONE = "America/Los_Angeles";

const getTzParts = (dateLike, timeZone) => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(dateLike));
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour),
    mm: Number(map.minute),
    ss: Number(map.second),
  };
};

const tzOffsetMsAt = (utcMs, timeZone) => {
  const p = getTzParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - utcMs;
};

const zonedDateTimeToUtcIso = ({ y, m, d, hh = 0, mm = 0, ss = 0 }, timeZone) => {
  let guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  for (let i = 0; i < 2; i += 1) {
    const offset = tzOffsetMsAt(guess, timeZone);
    guess = Date.UTC(y, m - 1, d, hh, mm, ss) - offset;
  }
  return new Date(guess).toISOString();
};

const parseLocalHourToUtcIso = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  const ss = Number(match[6] || 0);
  if (![y, m, d, hh, mm, ss].every(Number.isFinite)) return null;
  return zonedDateTimeToUtcIso({ y, m, d, hh, mm, ss }, NEM_TIMEZONE);
};

const normalizeUtilityCode = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "pge" || raw === "sce" || raw === "sdge") return raw;
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (compact === "pacificgasandelectric" || compact === "pacificgasandelectriccompany") return "pge";
  if (compact === "southerncaliforniaedison") return "sce";
  if (compact === "sandiegogasandelectric") return "sdge";
  return raw;
};

const buildEmptySeriesPoints = (start, end, message = "Missing data") => {
  const startMs = Date.parse(String(start || ""));
  const endMs = Date.parse(String(end || ""));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

  const firstHourMs = Math.floor(startMs / (60 * 60 * 1000)) * 60 * 60 * 1000;
  const points = [];
  for (let cursor = firstHourMs; cursor <= endMs; cursor += 60 * 60 * 1000) {
    if (cursor < startMs) continue;
    points.push({
      ts: new Date(cursor).toISOString(),
      value: null,
      isForecast: false,
      missingReason: message,
    });
  }
  return points;
};

const loadNemDataset = () => {
  try {
    const payload = JSON.parse(fs.readFileSync(NEM_DATA_PATH, "utf8"));
    const utilities = payload?.utilities || {};
    const byUtility = {};

    Object.keys(utilities).forEach((key) => {
      const normalized = normalizeUtilityCode(key);
      if (!normalized) return;
      const map = new Map();
      const rows = Array.isArray(utilities[key]?.data) ? utilities[key].data : [];
      rows.forEach((row) => {
        const utcIso = parseLocalHourToUtcIso(row?.timestamp);
        const rawValue = Object.prototype.hasOwnProperty.call(row || {}, "total") ? row?.total : row?.value;
        const value = Number(rawValue);
        if (!utcIso || !Number.isFinite(value)) return;
        map.set(utcIso, Number(value));
      });
      byUtility[normalized] = {
        utilityCode: normalized,
        source: utilities[key]?.source || "NEM 3.0",
        map,
      };
    });

    return {
      byUtility,
      windowStartIso: zonedDateTimeToUtcIso({ y: 2026, m: 1, d: 1, hh: 0, mm: 0, ss: 0 }, NEM_TIMEZONE),
      windowEndIso: zonedDateTimeToUtcIso({ y: 2026, m: 12, d: 31, hh: 23, mm: 0, ss: 0 }, NEM_TIMEZONE),
    };
  } catch (_error) {
    return {
      byUtility: {},
      windowStartIso: null,
      windowEndIso: null,
    };
  }
};

const NEM_DATASET = loadNemDataset();

const getCaliforniaResidentialSeries = async ({ start, end, utilityCode }) => {
  const requestedStartIso = new Date(start).toISOString();
  const requestedEndIso = new Date(end).toISOString();
  const normalizedUtility = normalizeUtilityCode(utilityCode);

  const baseDetails = {
    sourceUrl: NEM_DATA_PATH,
    sourceNode: normalizedUtility || "",
  };

  const supportedUtility = NEM_DATASET.byUtility[normalizedUtility] || null;
  if (!supportedUtility) {
    return {
      points: buildEmptySeriesPoints(requestedStartIso, requestedEndIso, "data not available for this utility"),
      source: "california_adapter_residential_nem3",
      unit: "USD/kWh",
      details: {
        ...baseDetails,
        reason: "residential_unsupported_utility",
        upstreamErrorCode: "UNSUPPORTED_UTILITY",
        upstreamHttpStatus: 422,
        upstreamError: "data not available for this utility",
        userError: "data not available for this utility",
      },
    };
  }

  const minMs = Date.parse(String(NEM_DATASET.windowStartIso || ""));
  const maxMs = Date.parse(String(NEM_DATASET.windowEndIso || ""));
  const startMs = Date.parse(requestedStartIso);
  const endMs = Date.parse(requestedEndIso);

  const points = buildEmptySeriesPoints(requestedStartIso, requestedEndIso, "No NEM 3.0 value for requested hour.")
    .map((point) => {
      const value = supportedUtility.map.get(point.ts);
      return {
        ts: point.ts,
        value: Number.isFinite(value) ? value : null,
        isForecast: false,
        missingReason: Number.isFinite(value) ? null : point.missingReason,
      };
    });

  const outOfRange = Number.isFinite(startMs) && Number.isFinite(endMs) && Number.isFinite(minMs) && Number.isFinite(maxMs)
    ? startMs < minMs || endMs > maxMs
    : false;

  return {
    points,
    source: "california_adapter_residential_nem3",
    unit: "USD/kWh",
    details: {
      ...baseDetails,
      reason: outOfRange ? "residential_window_outside_2026" : "residential_data",
      upstreamErrorCode: outOfRange ? "DATA_RANGE_LIMIT" : null,
      upstreamHttpStatus: outOfRange ? 422 : null,
      upstreamError: outOfRange ? "data only available for 2026" : null,
      userError: outOfRange ? "data only available for 2026" : null,
      availableWindowStart: NEM_DATASET.windowStartIso,
      availableWindowEnd: NEM_DATASET.windowEndIso,
      utilityCode: normalizedUtility,
    },
  };
};

const getCaliforniaRealtimeSeries = async ({ regionId, start, end, lat, utilityCode }) =>
  getV4RealtimeSeries({ regionId, start, end, lat, utilityCode });

const getCaliforniaDayAheadSeries = async ({ regionId, start, end, lat, utilityCode }) =>
  getV4DayAheadSeries({ regionId, start, end, lat, utilityCode });

module.exports = {
  getCaliforniaRealtimeSeries,
  getCaliforniaDayAheadSeries,
  getCaliforniaResidentialSeries,
};


