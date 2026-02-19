const PROGRAMS = {
  pge_nbt_gen: {
    id: "pge_nbt_gen",
    label: "PG&E Net Billing Tariff (proxy schedule)",
    source: "tariff_schedule_proxy_pge_nbt",
    sourceUnit: "USD/kWh",
    confidence: "medium",
    seasonMonths: {
      summer: [6, 7, 8, 9],
      winter: [1, 2, 3, 4, 5, 10, 11, 12],
    },
    prices: {
      summer: {
        peak: 0.185,
        shoulder: 0.132,
        offpeak: 0.108,
      },
      winter: {
        peak: 0.152,
        shoulder: 0.121,
        offpeak: 0.098,
      },
    },
    peakHours: [17, 18, 19, 20],
    shoulderHours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 21],
    weekendMultiplier: 0.92,
  },
  ercot_retail_export_proxy: {
    id: "ercot_retail_export_proxy",
    label: "ERCOT Retail Export (proxy schedule)",
    source: "tariff_schedule_proxy_ercot",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.148, shoulder: 0.109, offpeak: 0.089 },
      winter: { peak: 0.126, shoulder: 0.101, offpeak: 0.084 },
    },
    peakHours: [16, 17, 18, 19, 20],
    shoulderHours: [8, 9, 10, 11, 12, 13, 14, 15, 21],
    weekendMultiplier: 0.9,
  },
  pjm_retail_export_proxy: {
    id: "pjm_retail_export_proxy",
    label: "PJM Utility Export (proxy schedule)",
    source: "tariff_schedule_proxy_pjm",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.122, shoulder: 0.098, offpeak: 0.078 },
      winter: { peak: 0.115, shoulder: 0.094, offpeak: 0.074 },
    },
    peakHours: [17, 18, 19, 20],
    shoulderHours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    weekendMultiplier: 0.91,
  },
  miso_retail_export_proxy: {
    id: "miso_retail_export_proxy",
    label: "MISO Utility Export (proxy schedule)",
    source: "tariff_schedule_proxy_miso",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.114, shoulder: 0.091, offpeak: 0.072 },
      winter: { peak: 0.108, shoulder: 0.087, offpeak: 0.068 },
    },
    peakHours: [16, 17, 18, 19],
    shoulderHours: [8, 9, 10, 11, 12, 13, 14, 15, 20],
    weekendMultiplier: 0.9,
  },
  nyiso_retail_export_proxy: {
    id: "nyiso_retail_export_proxy",
    label: "NYISO Utility Export (proxy schedule)",
    source: "tariff_schedule_proxy_nyiso",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.171, shoulder: 0.126, offpeak: 0.098 },
      winter: { peak: 0.152, shoulder: 0.118, offpeak: 0.092 },
    },
    peakHours: [16, 17, 18, 19, 20],
    shoulderHours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 21],
    weekendMultiplier: 0.93,
  },
  isone_retail_export_proxy: {
    id: "isone_retail_export_proxy",
    label: "ISO-NE Utility Export (proxy schedule)",
    source: "tariff_schedule_proxy_isone",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.162, shoulder: 0.118, offpeak: 0.094 },
      winter: { peak: 0.149, shoulder: 0.112, offpeak: 0.089 },
    },
    peakHours: [16, 17, 18, 19, 20],
    shoulderHours: [7, 8, 9, 10, 11, 12, 13, 14, 15],
    weekendMultiplier: 0.93,
  },
  spp_retail_export_proxy: {
    id: "spp_retail_export_proxy",
    label: "SPP Utility Export (proxy schedule)",
    source: "tariff_schedule_proxy_spp",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.109, shoulder: 0.087, offpeak: 0.069 },
      winter: { peak: 0.102, shoulder: 0.083, offpeak: 0.064 },
    },
    peakHours: [16, 17, 18, 19],
    shoulderHours: [8, 9, 10, 11, 12, 13, 14, 15, 20],
    weekendMultiplier: 0.89,
  },
  non_iso_export_proxy: {
    id: "non_iso_export_proxy",
    label: "Non-ISO Utility Export (proxy schedule)",
    source: "tariff_schedule_proxy_non_iso",
    sourceUnit: "USD/kWh",
    confidence: "low",
    seasonMonths: { summer: [6, 7, 8, 9], winter: [1, 2, 3, 4, 5, 10, 11, 12] },
    prices: {
      summer: { peak: 0.12, shoulder: 0.095, offpeak: 0.076 },
      winter: { peak: 0.112, shoulder: 0.089, offpeak: 0.072 },
    },
    peakHours: [16, 17, 18, 19, 20],
    shoulderHours: [8, 9, 10, 11, 12, 13, 14, 15],
    weekendMultiplier: 0.9,
  },
};

const resolveTariffProgram = ({ tariffProgramId, regionId }) => {
  if (tariffProgramId && PROGRAMS[tariffProgramId]) return PROGRAMS[tariffProgramId];
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
  return PROGRAMS[byRegion[regionId] || "non_iso_export_proxy"];
};

module.exports = {
  PROGRAMS,
  resolveTariffProgram,
};
