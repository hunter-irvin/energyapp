const fs = require("fs");
const https = require("https");
const path = require("path");
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
  ERCOT: {
    utilityCode: "oncor",
    utilityName: "Oncor TDU Territory (inferred)",
    tariffProgramId: "ercot_retail_export_proxy",
  },
  PJM: {
    utilityCode: "ppl",
    utilityName: "PPL Utility Territory (inferred)",
    tariffProgramId: "pjm_retail_export_proxy",
  },
  MISO: {
    utilityCode: "we_energies",
    utilityName: "We Energies Territory (inferred)",
    tariffProgramId: "miso_retail_export_proxy",
  },
  NYISO: {
    utilityCode: "coned",
    utilityName: "Con Edison Territory (inferred)",
    tariffProgramId: "nyiso_retail_export_proxy",
  },
  "ISO-NE": {
    utilityCode: "eversource",
    utilityName: "Eversource Territory (inferred)",
    tariffProgramId: "isone_retail_export_proxy",
  },
  SPP: {
    utilityCode: "oge",
    utilityName: "OG&E Territory (inferred)",
    tariffProgramId: "spp_retail_export_proxy",
  },
  "NON-ISO": {
    utilityCode: "local",
    utilityName: "Local Utility (inferred)",
    tariffProgramId: "non_iso_export_proxy",
  },
};

const CALIFORNIA_UTILITY_TERRITORIES_PATH = path.join(
  __dirname,
  "data",
  "california-utility-territories.geojson"
);

const readCaliforniaTerritories = () => {
  try {
    const raw = fs.readFileSync(CALIFORNIA_UTILITY_TERRITORIES_PATH, "utf8");
    const payload = JSON.parse(raw);
    return Array.isArray(payload?.features) ? payload.features : [];
  } catch (_error) {
    return [];
  }
};

const CALIFORNIA_UTILITY_FEATURES = readCaliforniaTerritories();

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
  } catch (_error) {
    return inferTimezoneFromLongitude(lng);
  }
};

const pointInRing = (lng, lat, ring = []) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (lng, lat, polygonCoords = []) => {
  if (!Array.isArray(polygonCoords) || !polygonCoords.length) return false;
  const outer = polygonCoords[0] || [];
  if (!pointInRing(lng, lat, outer)) return false;
  for (let i = 1; i < polygonCoords.length; i += 1) {
    if (pointInRing(lng, lat, polygonCoords[i])) return false;
  }
  return true;
};

const geometryContainsPoint = (geometry, lng, lat) => {
  const type = String(geometry?.type || "");
  const coords = geometry?.coordinates;
  if (type === "Polygon") {
    return pointInPolygon(lng, lat, coords);
  }
  if (type === "MultiPolygon" && Array.isArray(coords)) {
    return coords.some((polygon) => pointInPolygon(lng, lat, polygon));
  }
  return false;
};

const resolveCaliforniaUtility = ({ lat, lng }) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (let i = 0; i < CALIFORNIA_UTILITY_FEATURES.length; i += 1) {
    const feature = CALIFORNIA_UTILITY_FEATURES[i];
    if (!geometryContainsPoint(feature?.geometry, lng, lat)) continue;
    const utilityCode = String(feature?.properties?.utilityCode || "").trim().toLowerCase();
    const utilityName = String(feature?.properties?.utilityName || "").trim() || null;
    const tariffProgramId = String(feature?.properties?.tariffProgramId || "").trim() || null;
    if (!utilityCode) continue;
    return {
      utilityCode,
      utilityName,
      tariffProgramId,
    };
  }
  return null;
};

const inferUtilityProfile = (regionId, { lat, lng } = {}) => {
  if (regionId === "CAISO") {
    const californiaUtility = resolveCaliforniaUtility({ lat, lng });
    if (californiaUtility) {
      return californiaUtility;
    }
    return {
      utilityCode: null,
      utilityName: null,
      tariffProgramId: null,
    };
  }

  const profile = REGION_UTILITY_DEFAULTS[regionId] || REGION_UTILITY_DEFAULTS["NON-ISO"];
  const label = REGION_LABELS[regionId] || regionId;
  return {
    utilityCode: profile.utilityCode,
    utilityName: profile.utilityName || `${label} Utility Territory (inferred)`,
    tariffProgramId: profile.tariffProgramId || "non_iso_export_proxy",
  };
};

const resolveProviderMetadata = async ({ lat, lng }) => {
  const isoRegion = inferRegion(lat, lng);
  const timezone = await resolveTimeZone({ lat, lng });
  const utilityProfile = inferUtilityProfile(isoRegion, { lat, lng });
  return {
    utilityName: utilityProfile.utilityName,
    utilityCode: utilityProfile.utilityCode,
    tariffProgramId: utilityProfile.tariffProgramId,
    isoRegion,
    timezone,
    regionLabel: REGION_LABELS[isoRegion] || isoRegion,
  };
};

module.exports = {
  REGION_LABELS,
  resolveProviderMetadata,
};

