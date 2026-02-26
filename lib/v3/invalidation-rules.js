const crypto = require("crypto");

const sha1 = (value) => crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const inferRegion = ({ lat, lng }) => {
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

const resolveCaisoNode = ({ lat, utilityCode = "" } = {}) => {
  const utility = String(utilityCode || "").toLowerCase();
  if (utility.includes("sdge") || utility.includes("sce")) return "TH_SP15_GEN-APND";
  if (utility.includes("pge")) return "TH_NP15_GEN-APND";
  if (!Number.isFinite(lat)) return "TH_ZP26_GEN-APND";
  if (lat >= 38) return "TH_NP15_GEN-APND";
  if (lat < 35.5) return "TH_SP15_GEN-APND";
  return "TH_ZP26_GEN-APND";
};

const resolveErcotSettlement = ({ lat, lng, utilityCode = "" } = {}) => {
  const normalizedUtility = String(utilityCode || "").toLowerCase();
  if (normalizedUtility.includes("oncor") || normalizedUtility.includes("lubbock")) return "LZ_NORTH";
  if (normalizedUtility.includes("aep")) return "LZ_SOUTH";
  if (normalizedUtility.includes("tnmp")) return "LZ_HOUSTON";
  if (Number.isFinite(lng) && lng <= -101) return "LZ_WEST";
  if (Number.isFinite(lat) && lat >= 32.2) return "LZ_NORTH";
  return "LZ_SOUTH";
};

const computeLocationFingerprint = ({ lat, lng, weatherProvider }) =>
  sha1({
    lat: toNumber(lat),
    lng: toNumber(lng),
    weatherProvider: String(weatherProvider || "").trim().toLowerCase() || null,
  });

const computeAssetFingerprint = (assets = []) =>
  sha1(
    (Array.isArray(assets) ? assets : [])
      .map((asset) => ({
        type: String(asset.asset_type || asset.type || "").trim().toLowerCase(),
        model: asset.model || {},
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );

const computeRatesSourceFingerprint = ({ lat, lng, utilityCode }) => {
  const region = inferRegion({ lat, lng });
  if (region === "CAISO") {
    return sha1({ region, node: resolveCaisoNode({ lat, utilityCode }) });
  }
  if (region === "ERCOT") {
    return sha1({ region, settlement: resolveErcotSettlement({ lat, lng, utilityCode }) });
  }
  return sha1({ region, source: "unsupported" });
};

const resolveInvalidationPlan = ({ reason = "manual_refresh", project = {}, assets = [] } = {}) => {
  const normalizedReason = String(reason || "manual_refresh").trim().toLowerCase();
  const lat = toNumber(project.location_lat ?? project.lat);
  const lng = toNumber(project.location_lng ?? project.lng);
  const weatherProvider = project.weather_provider || project.weatherProvider || null;
  const utilityCode = project.utility_code || project.utilityCode || project.utility_name || "";
  const locationFingerprint = computeLocationFingerprint({ lat, lng, weatherProvider });
  const assetFingerprint = computeAssetFingerprint(assets);
  const ratesSourceFingerprint = computeRatesSourceFingerprint({ lat, lng, utilityCode });
  const patch = {
    location_fingerprint: locationFingerprint,
    asset_fingerprint: assetFingerprint,
    rates_source_fingerprint: ratesSourceFingerprint,
    updated_at: new Date().toISOString(),
  };

  if (normalizedReason === "location_change") {
    const domains = ["weather", "generation", "storage"];
    if (String(project.rates_source_fingerprint || "") !== String(ratesSourceFingerprint)) {
      domains.push("rates");
    }
    return { domains, patch, reason: normalizedReason };
  }
  if (normalizedReason === "asset_change") {
    return { domains: ["generation", "storage"], patch, reason: normalizedReason };
  }
  return { domains: null, patch, reason: normalizedReason };
};

module.exports = {
  computeLocationFingerprint,
  computeAssetFingerprint,
  computeRatesSourceFingerprint,
  resolveInvalidationPlan,
};
