const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

const API_KEY = "Courz8adc7n8ydX9QySvsL29qfViI8jafqzOwqju";
const CONTACT_EMAIL = "hunter.irvin@jacobs.com";
const SOLAR_YEAR = "2014";
const WIND_YEAR = "2014";
const SOLAR_ENDPOINT =
  "https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-conus-v4-0-0-download.csv";
const WIND_ENDPOINT =
  "https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv";

const cache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const sendJsonError = (res, status, message) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ errors: [message] }));
};

const serveStatic = (req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, requestPath);

  if (!filePath.startsWith(__dirname)) {
    sendJsonError(res, 403, "Forbidden.");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJsonError(res, 404, "Not found.");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
    res.end(data);
  });
};

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

const handleProxy = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wkt = url.searchParams.get("wkt");
  const dataset = url.searchParams.get("dataset");
  const interval = url.searchParams.get("interval") || "15";

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
      : "windspeed_20m,winddirection_20m,temperature_20m,pressure_20m";

  const cacheKey = `${dataset}-${year}-${wkt}-${interval}-${attributes}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    res.writeHead(200, {
      "Content-Type": cached.contentType,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": "HIT",
    });
    res.end(cached.body);
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

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": "MISS",
    });
    res.end(upstream.body);
  } catch (error) {
    sendJsonError(res, 502, error.message || "Proxy error.");
  }
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/nrel-proxy")) {
    handleProxy(req, res);
    return;
  }

  serveStatic(req, res);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
