const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      return;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!key || process.env[key] != null) {
      return;
    }
    process.env[key] = value;
  });
};

loadEnvFile(path.resolve(__dirname, ".env"));
loadEnvFile(path.resolve(__dirname, ".env.local"));

const { handleWeatherProxy, handleNrelCsvProxy } = require("./api/weather-proxy");
const { handleLocationReverse } = require("./api/location-proxy");
const {
  handleRatesProvider,
  handleRatesHealth,
} = require("./api/rates-proxy");
const {
  handleV3SyncDomain,
  handleV3SyncStatus,
  handleV3SeriesWeather,
  handleV3SeriesGeneration,
  handleV3SeriesRates,
  handleV3Refresh,
  handleV3CronNightlySync,
  handleV3WorkerRunOnce,
} = require("./api/v3-proxy");
const { handleV4RatesSeries } = require("./api/v4-rates-proxy");

const SUPABASE_URL = process.env.ENERGYAPP_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.ENERGYAPP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

const sendDeprecated = (res, message) => {
  res.writeHead(410, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ errors: [message] }));
};

const serveStatic = (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = requestPath.endsWith("/") ? `${requestPath}index.html` : requestPath;
  const relativePath = normalizedPath.replace(/^\/+/, "");
  const rootDir = path.resolve(__dirname, "public");
  const filePath = path.resolve(rootDir, relativePath);

  if (!filePath.startsWith(rootDir + path.sep) && filePath !== rootDir) {
    sendJsonError(res, 403, "Forbidden.");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJsonError(res, 404, "Not found.");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") {
      let html = data.toString();
      const credentialsScript = `<script>\nwindow.ENERGYAPP_SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};\nwindow.ENERGYAPP_SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};\n</script>`;
      if (html.includes("<head>")) {
        html = html.replace("<head>", "<head>\n    " + credentialsScript);
      } else if (html.includes("<HEAD>")) {
        html = html.replace("<HEAD>", "<HEAD>\n    " + credentialsScript);
      } else {
        html = html.replace(/<script/i, credentialsScript + "\n    <script");
      }
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
      res.end(html);
    } else {
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
      res.end(data);
    }
  });
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/weather-proxy")) {
    handleWeatherProxy(req, res);
    return;
  }
  if (req.url.startsWith("/api/nrel-proxy")) {
    handleNrelCsvProxy(req, res);
    return;
  }
  if (req.url.startsWith("/api/location/reverse")) {
    handleLocationReverse(req, res);
    return;
  }
  if (req.url.startsWith("/api/rates/provider")) {
    handleRatesProvider(req, res);
    return;
  }
  if (req.url.startsWith("/api/rates/timeseries")) {
    sendDeprecated(res, "Deprecated endpoint. Use /api/v3/series/rates and /api/v3/refresh.");
    return;
  }
  if (req.url.startsWith("/api/v2/rates/timeseries")) {
    sendDeprecated(res, "Deprecated endpoint. Use /api/v3/series/rates and /api/v3/refresh.");
    return;
  }
  if (req.url.startsWith("/api/rates/health")) {
    handleRatesHealth(req, res);
    return;
  }
  if (req.url.startsWith("/api/rates/refresh")) {
    sendDeprecated(res, "Deprecated endpoint. Use POST /api/v3/refresh.");
    return;
  }
  if (req.url.startsWith("/api/v3/sync/") && req.url.includes("/status")) {
    handleV3SyncStatus(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/sync/")) {
    handleV3SyncDomain(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/series/weather")) {
    handleV3SeriesWeather(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/series/generation")) {
    handleV3SeriesGeneration(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/series/rates")) {
    handleV3SeriesRates(req, res);
    return;
  }
  if (req.url.startsWith("/api/v4/rates/series")) {
    handleV4RatesSeries(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/refresh")) {
    handleV3Refresh(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/cron/nightly-sync")) {
    handleV3CronNightlySync(req, res);
    return;
  }
  if (req.url.startsWith("/api/v3/worker/run-once")) {
    handleV3WorkerRunOnce(req, res);
    return;
  }

  if (req.url === "/api/runtime-config") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
      })
    );
    return;
  }

  if (req.url === "/api/diagnostics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          supabase: {
            url: SUPABASE_URL,
            anonKeyPresent: !!SUPABASE_ANON_KEY,
            anonKeyLength: SUPABASE_ANON_KEY?.length || 0,
          },
          server: {
            nodeVersion: process.version,
            env: process.env.NODE_ENV || "development",
          },
          message:
            'If supabase.url and anonKeyPresent are true, credentials should be injected into HTML. Check browser console for "[Supabase Client Init]" message.',
        },
        null,
        2
      )
    );
    return;
  }

  serveStatic(req, res);
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
