const https = require("https");
const { URL } = require("url");

const REGION_LABELS = {
  CAISO: "California ISO",
  ERCOT: "ERCOT",
  PJM: "PJM",
  MISO: "MISO",
  NYISO: "NYISO",
  "ISO-NE": "ISO New England",
  SPP: "Southwest Power Pool",
  "NON-ISO": "Non-ISO Region",
};

const REGION_UTILITY_DEFAULTS = {
  CAISO: {
    utilityCode: "pge",
    utilityName: "Pacific Gas and Electric (inferred)",
    tariffProgramId: "pge_nbt_gen",
    confidence: "medium",
  },
  ERCOT: {
    utilityCode: "oncor",
    utilityName: "Oncor TDU Territory (inferred)",
    tariffProgramId: "ercot_retail_export_proxy",
    confidence: "low",
  },
  PJM: {
    utilityCode: "ppl",
    utilityName: "PPL Utility Territory (inferred)",
    tariffProgramId: "pjm_retail_export_proxy",
    confidence: "low",
  },
  MISO: {
    utilityCode: "we_energies",
    utilityName: "We Energies Territory (inferred)",
    tariffProgramId: "miso_retail_export_proxy",
    confidence: "low",
  },
  NYISO: {
    utilityCode: "coned",
    utilityName: "Con Edison Territory (inferred)",
    tariffProgramId: "nyiso_retail_export_proxy",
    confidence: "low",
  },
  "ISO-NE": {
    utilityCode: "eversource",
    utilityName: "Eversource Territory (inferred)",
    tariffProgramId: "isone_retail_export_proxy",
    confidence: "low",
  },
  SPP: {
    utilityCode: "oge",
    utilityName: "OG&E Territory (inferred)",
    tariffProgramId: "spp_retail_export_proxy",
    confidence: "low",
  },
  "NON-ISO": {
    utilityCode: "local",
    utilityName: "Local Utility (inferred)",
    tariffProgramId: "non_iso_export_proxy",
    confidence: "low",
  },
};

const inferRegion = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "NON-ISO";
  if (lng <= -114 && lng >= -125 && lat >= 32 && lat <= 43) return "CAISO";
  if (lng <= -93.5 && lng >= -106.8 && lat >= 25 && lat <= 37.5) return "ERCOT";
  if (lng <= -73.5 && lng >= -85.5 && lat >= 37 && lat <= 42.8) return "PJM";
  if (lng <= -84 && lng >= -101.5 && lat >= 35 && lat <= 49.5) return "MISO";
  if (lng <= -71 && lng >= -80.8 && lat >= 40 && lat <= 45.2) return "NYISO";
  if (lng <= -66.5 && lng >= -73.8 && lat >= 40.8 && lat <= 47.6) return "ISO-NE";
  if (lng <= -90 && lng >= -107 && lat >= 31 && lat <= 49) return "SPP";
  return "NON-ISO";
};

const inferTimezoneFromLongitude = (lng) => {
  if (!Number.isFinite(lng)) return "UTC";
  if (lng >= -82) return "America/New_York";
  if (lng >= -97) return "America/Chicago";
  if (lng >= -112) return "America/Denver";
  return "America/Los_Angeles";
};

const fetchJson = (targetUrl) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      headers: { "User-Agent": "energyapp/1.0" },
    };
    https
      .get(requestOptions, (upstream) => {
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
            reject(error);
          }
        });
      })
      .on("error", reject);
  });

const resolveTimeZone = async ({ lat, lng }) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "UTC";
  try {
    const url = new URL("https://timeapi.io/api/TimeZone/coordinate");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    const payload = await fetchJson(url.toString());
    return payload?.timeZone || inferTimezoneFromLongitude(lng);
  } catch (error) {
    return inferTimezoneFromLongitude(lng);
  }
};

const inferUtilityProfile = (regionId) => {
  const profile = REGION_UTILITY_DEFAULTS[regionId] || REGION_UTILITY_DEFAULTS["NON-ISO"];
  const label = REGION_LABELS[regionId] || regionId;
  return {
    utilityCode: profile.utilityCode,
    utilityName: profile.utilityName || `${label} Utility Territory (inferred)`,
    tariffProgramId: profile.tariffProgramId || "non_iso_export_proxy",
    confidence: profile.confidence || "low",
  };
};

const resolveProviderMetadata = async ({ lat, lng }) => {
  const isoRegion = inferRegion(lat, lng);
  const timezone = await resolveTimeZone({ lat, lng });
  const utilityProfile = inferUtilityProfile(isoRegion);
  return {
    utilityName: utilityProfile.utilityName,
    utilityCode: utilityProfile.utilityCode,
    tariffProgramId: utilityProfile.tariffProgramId,
    isoRegion,
    timezone,
    regionLabel: REGION_LABELS[isoRegion] || isoRegion,
    confidence: utilityProfile.confidence,
  };
};

module.exports = {
  REGION_LABELS,
  resolveProviderMetadata,
};
