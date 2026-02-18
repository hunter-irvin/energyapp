const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const { handleWeatherProxy, handleNrelCsvProxy } = require("./api/weather-proxy");

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
