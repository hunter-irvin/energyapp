const { REGION_LABELS } = require("./provider-resolver");

const REGION_LIST = Object.keys(REGION_LABELS);

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

const getSourceMetadata = ({ regionId, serviceType }) => {
  if (serviceType === "tariff") {
    return {
      source: "rates_proxy_phase2_tariff_schedule",
      sourceUnit: "USD/kWh",
      confidence: "medium",
    };
  }
  if (regionId === "CAISO") {
    return {
      source: "rates_proxy_phase3_live_caiso_oasis",
      sourceUnit: "USD/MWh",
      confidence: "high",
    };
  }
  if (regionId === "ERCOT") {
    return {
      source: "rates_proxy_phase3_live_ercot_public_api",
      sourceUnit: "USD/MWh",
      confidence: "medium",
    };
  }
  return {
    source: "rates_proxy_phase2_modeled_fallback",
    sourceUnit: "USD/MWh",
    confidence: "low",
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
      const sourceMeta = getSourceMetadata({ regionId, serviceType: config.serviceType });
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
        },
      };
    })
  );
};

module.exports = {
  buildHealthRows,
};
