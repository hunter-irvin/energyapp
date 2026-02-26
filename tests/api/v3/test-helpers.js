const { EventEmitter } = require("events");

const invokeHandler = async (handler, { method = "GET", url = "/", headers = {}, body = null } = {}) => {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;

  const responseState = {
    statusCode: 200,
    headers: {},
    bodyText: "",
  };
  const res = {
    writeHead(statusCode, nextHeaders = {}) {
      responseState.statusCode = statusCode;
      responseState.headers = { ...nextHeaders };
      return res;
    },
    end(chunk = "") {
      responseState.bodyText += String(chunk || "");
      responseState.done = true;
      if (typeof res._resolve === "function") res._resolve();
    },
  };

  const completed = new Promise((resolve) => {
    res._resolve = resolve;
  });

  handler(req, res);

  process.nextTick(() => {
    if (body != null) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      req.emit("data", Buffer.from(payload));
    }
    req.emit("end");
  });

  await completed;

  let json = null;
  try {
    json = responseState.bodyText ? JSON.parse(responseState.bodyText) : null;
  } catch (error) {
    json = null;
  }
  return {
    statusCode: responseState.statusCode,
    headers: responseState.headers,
    bodyText: responseState.bodyText,
    json,
  };
};

const loadV3Handlers = ({ url = "", key = "" } = {}) => {
  process.env.ENERGYAPP_SUPABASE_URL = url;
  process.env.ENERGYAPP_SUPABASE_ANON_KEY = key;
  delete require.cache[require.resolve("../../../lib/v3/ingestion-job-store-supabase")];
  delete require.cache[require.resolve("../../../api/v3-proxy")];
  return require("../../../api/v3-proxy");
};

module.exports = {
  invokeHandler,
  loadV3Handlers,
};
