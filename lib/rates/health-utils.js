const { REGION_LABELS } = require("./provider-resolver");
const { URL } = require("url");

const REGION_LIST = Object.keys(REGION_LABELS);
const CAISO_DA_VERSION = process.env.ENERGYAPP_CAISO_DA_VERSION || "12";
const CAISO_RT_VERSION = process.env.ENERGYAPP_CAISO_RT_VERSION || "1";
const ERCOT_API_BASE = process.env.ENERGYAPP_ERCOT_API_BASE || "https://api.ercot.com";
const ERCOT_RT_ENDPOINT = process.env.ENERGYAPP_ERCOT_RT_LMP_ENDPOINT || "";
const ERCOT_DA_ENDPOINT = process.env.ENERGYAPP_ERCOT_DA_LMP_ENDPOINT || "";

const BASE_COVERAGE = {
  lmp: {
    real_time: {
      CAISO: 0.94,
      ERCOT: 0.7,
      PJM: 0.05,
      MISO: 0.05,
      NYISO: 0.05,
      "ISO-NE": 0.05,
      SPP: 0.05,
      "NON-ISO": 0,
    },
    day_ahead: {
      CAISO: 0.97,
      ERCOT: 0.76,
      PJM: 0.05,
      MISO: 0.05,
      NYISO: 0.05,
      "ISO-NE": 0.05,
      SPP: 0.05,
      "NON-ISO": 0,
    },
  },
  tariff: {
    tariff: {
      CAISO: 0.85,
      ERCOT: 0.85,
      PJM: 0.85,
      MISO: 0.85,
      NYISO: 0.85,
      "ISO-NE": 0.85,
      SPP: 0.85,
      "NON-ISO": 0.85,
    },
  },
};

const resolveStatus = ({ expectedHours, missingHours }) => {
  if (!expectedHours) return "missing";
  const coverage = 1 - missingHours / expectedHours;
  if (coverage >= 0.95) return "good";
  if (coverage >= 0.2) return "partial";
  return "missing";
};

const getConfigsForServiceType = (serviceType) => {
  if (serviceType === "lmp") return [{ serviceType: "lmp", marketMode: "real_time" }, { serviceType: "lmp", marketMode: "day_ahead" }];
  if (serviceType === "tariff") return [{ serviceType: "tariff", marketMode: "tariff" }];
  return [
    { serviceType: "lmp", marketMode: "real_time" },
    { serviceType: "lmp", marketMode: "day_ahead" },
    { serviceType: "tariff", marketMode: "tariff" },
  ];
};

const toIsoDate = (date) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const formatCaisoTime = (date) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hour = String(parsed.getUTCHours()).padStart(2, "0");
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}T${hour}:${minute}-0000`;
};

const normalizeErcotEndpoint = (endpoint) => {
  if (!endpoint) return "";
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${ERCOT_API_BASE.replace(/\/+$/, "")}/${String(endpoint).replace(/^\/+/, "")}`;
};

const resolveTariffProgramUrl = (regionId) => {
  const byRegion = {
    CAISO: "pge_nbt_gen",
    ERCOT: "ercot_retail_export_proxy",
    PJM: "pjm_retail_export_proxy",
    MISO: "miso_retail_export_proxy",
    NYISO: "nyiso_retail_export_proxy",
    "ISO-NE": "isone_retail_export_proxy",
    SPP: "spp_retail_export_proxy",
    "NON-ISO": "non_iso_export_proxy",
  };
  return `tariff-program://${byRegion[regionId] || "non_iso_export_proxy"}`;
};

const getSourceMetadata = ({ regionId, serviceType, marketMode, windowStart, windowEnd }) => {
  if (serviceType === "tariff") {
    return {
      source: "rates_proxy_phase2_tariff_schedule",
      sourceUnit: "USD/kWh",
      confidence: "medium",
      sourceUrl: resolveTariffProgramUrl(regionId),
    };
  }
  if (regionId === "CAISO") {
    const url = new URL("https://oasis.caiso.com/oasisapi/SingleZip");
    url.searchParams.set("queryname", marketMode === "real_time" ? "PRC_INTVL_LMP" : "PRC_LMP");
    url.searchParams.set("version", marketMode === "real_time" ? CAISO_RT_VERSION : CAISO_DA_VERSION);
    url.searchParams.set("resultformat", "6");
    url.searchParams.set("market_run_id", marketMode === "real_time" ? "RTM" : "DAM");
    url.searchParams.set("node", process.env.ENERGYAPP_CAISO_NODE || "TH_NP15_GEN-APND");
    const caisoMaxRangeMs = 31 * 24 * 60 * 60 * 1000;
    const caisoStart = new Date(windowStart);
    const caisoRequestedEnd = new Date(windowEnd);
    const caisoCappedEnd = new Date(Math.min(caisoRequestedEnd.getTime(), caisoStart.getTime() + caisoMaxRangeMs));
    url.searchParams.set("startdatetime", formatCaisoTime(caisoStart));
    url.searchParams.set("enddatetime", formatCaisoTime(caisoCappedEnd));
    return {
      source: "rates_proxy_phase3_live_caiso_oasis",
      sourceUnit: "USD/MWh",
      confidence: "high",
      sourceUrl: url.toString(),
    };
  }
  if (regionId === "ERCOT") {
    const endpoint = normalizeErcotEndpoint(marketMode === "real_time" ? ERCOT_RT_ENDPOINT : ERCOT_DA_ENDPOINT);
    const url = endpoint ? new URL(endpoint) : null;
    if (url) {
      if (!url.searchParams.has("deliveryDateFrom")) url.searchParams.set("deliveryDateFrom", toIsoDate(windowStart));
      if (!url.searchParams.has("deliveryDateTo")) url.searchParams.set("deliveryDateTo", toIsoDate(windowEnd));
      if (!url.searchParams.has("size")) url.searchParams.set("size", "5000");
      if (!url.searchParams.has("sort")) url.searchParams.set("sort", "deliveryDate");
      if (!url.searchParams.has("dir")) url.searchParams.set("dir", "ASC");
    }
    return {
      source: "rates_proxy_phase3_live_ercot_public_api",
      sourceUnit: "USD/MWh",
      confidence: "medium",
      sourceUrl: url ? url.toString() : "",
    };
  }
  return {
    source: "rates_proxy_phase2_modeled_fallback",
    sourceUnit: "USD/MWh",
    confidence: "low",
    sourceUrl: "",
  };
};

const buildHealthRows = ({ activeRegionId, serviceType, windowStart, windowEnd, details = {} }) => {
  const hours = Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / (1000 * 60 * 60)) + 1);
  const configs = getConfigsForServiceType(serviceType);
  return REGION_LIST.flatMap((regionId) =>
    configs.map((config) => {
      const base = BASE_COVERAGE[config.serviceType]?.[config.marketMode]?.[regionId] ?? 0;
      const adjusted = regionId === activeRegionId ? Math.max(base, 0.86) : base;
      const availableHours = Math.round(hours * adjusted);
      const missingHours = Math.max(0, hours - availableHours);
      const status = resolveStatus({ expectedHours: hours, missingHours });
      const staleHours = Math.round((1 - adjusted) * 12);
      const sourceMeta = getSourceMetadata({
        regionId,
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        windowStart,
        windowEnd,
      });
      return {
        regionId,
        regionLabel: REGION_LABELS[regionId] || regionId,
        serviceType: config.serviceType,
        marketMode: config.marketMode,
        status,
        lastUpdatedAt: new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString(),
        expectedHours: hours,
        missingHours,
        source: sourceMeta.source,
        sourceUnit: sourceMeta.sourceUnit,
        confidence: sourceMeta.confidence,
        details: {
          reason:
            details.reason ||
            (config.serviceType === "lmp" ? "live_or_fallback" : "schedule_based"),
          sourceUrl: sourceMeta.sourceUrl || "",
        },
      };
    })
  );
};

module.exports = {
  buildHealthRows,
};
