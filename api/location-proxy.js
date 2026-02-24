const https = require("https");
const { URL } = require("url");

const NOMINATIM_REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = process.env.ENERGYAPP_NOMINATIM_USER_AGENT || "energyapp/1.0 (location reverse geocode)";

const sendJsonError = (res, status, message) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ errors: [message] }));
};

const sendJson = (res, status, payload, extraHeaders = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchBuffer = (targetUrl) =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
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

const normalizeLabel = (payload) => {
  const address = payload?.address || {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    "";
  const state = address.state || address.region || "";
  const country = address.country_code ? String(address.country_code).toUpperCase() : "";
  return [city, state || country].filter(Boolean).join(", ").trim();
};

const handleLocationReverse = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lon") || url.searchParams.get("lng"));
    const zoom = String(url.searchParams.get("zoom") || "10");
    const addressDetails = String(url.searchParams.get("addressdetails") || "1");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      sendJsonError(res, 400, "Missing required latitude/longitude.");
      return;
    }

    const targetUrl = new URL(NOMINATIM_REVERSE_ENDPOINT);
    targetUrl.searchParams.set("format", "jsonv2");
    targetUrl.searchParams.set("lat", String(lat));
    targetUrl.searchParams.set("lon", String(lng));
    targetUrl.searchParams.set("zoom", zoom);
    targetUrl.searchParams.set("addressdetails", addressDetails);

    let upstream = await fetchBuffer(targetUrl.toString());
    if (upstream.statusCode === 425 || upstream.statusCode === 429) {
      await sleep(500);
      upstream = await fetchBuffer(targetUrl.toString());
    }
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      sendJsonError(res, 502, "City lookup failed.");
      return;
    }

    const payload = JSON.parse(upstream.body.toString("utf8"));
    sendJson(res, 200, {
      ...payload,
      label: normalizeLabel(payload),
      source: "nominatim_reverse_proxy",
    });
  } catch (error) {
    sendJsonError(res, 502, "City lookup failed.");
  }
};

module.exports = handleLocationReverse;
module.exports.handleLocationReverse = handleLocationReverse;
