const https = require("https");
const { URL } = require("url");

const API_KEY = "Courz8adc7n8ydX9QySvsL29qfViI8jafqzOwqju";
const CONTACT_EMAIL = "hunter.irvin@jacobs.com";
const SOLAR_YEAR = "2024";
const WIND_YEAR = "2014";
const SOLAR_ENDPOINT =
  "https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-conus-v4-0-0-download.csv";
const WIND_ENDPOINT =
  "https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv";

const cache = new Map();

const fetchFromNrel = (targetUrl) =>
  new Promise((resolve, reject) => {
    https
      .get(targetUrl, (upstream) => {
        const { statusCode } = upstream;
        const chunks = [];

        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            statusCode,
            headers: upstream.headers,
            body,
          });
        });
      })
      .on("error", reject);
  });

const sendJsonError = (res, status, message) => {
  res.status(status).json({ errors: [message] });
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { dataset, wkt, interval = "15" } = req.query;

  if (!wkt || !dataset) {
    sendJsonError(res, 400, "Missing required parameters.");
    return;
  }

  if (!["solar", "wind"].includes(dataset)) {
    sendJsonError(res, 400, "Invalid dataset.");
    return;
  }

  const baseUrl = dataset === "solar" ? SOLAR_ENDPOINT : WIND_ENDPOINT;
  const year = dataset === "solar" ? SOLAR_YEAR : WIND_YEAR;
  const attributes =
    dataset === "solar"
      ? "ghi,dni,dhi,air_temperature,wind_speed"
      : "windspeed_100m,winddirection_100m,temperature_100m,pressure_100m";

  const cacheKey = `${dataset}-${year}-${wkt}-${interval}-${attributes}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Content-Type", cached.contentType);
    res.status(200).send(cached.body);
    return;
  }

  const targetUrl = new URL(baseUrl);
  targetUrl.searchParams.set("api_key", API_KEY);
  targetUrl.searchParams.set("wkt", wkt);
  targetUrl.searchParams.set("names", year);
  targetUrl.searchParams.set("utc", "true");
  targetUrl.searchParams.set("leap_day", "false");
  targetUrl.searchParams.set("email", CONTACT_EMAIL);
  targetUrl.searchParams.set("interval", interval);
  targetUrl.searchParams.set("attributes", attributes);

  try {
    const upstream = await fetchFromNrel(targetUrl.toString());
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      sendJsonError(res, upstream.statusCode || 502, upstream.body.toString());
      return;
    }

    const contentType = upstream.headers["content-type"] || "text/csv";
    cache.set(cacheKey, { body: upstream.body, contentType });

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", contentType);
    res.status(200).send(upstream.body);
  } catch (error) {
    sendJsonError(res, 502, error.message || "Proxy error.");
  }
};
