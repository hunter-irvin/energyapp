const assert = require("assert");
const path = require("path");
const handler = require(path.join(__dirname, "..", "..", "..", "api", "v4", "rates", "series.js"));

const buildRes = () => {
  const out = { status: 0, body: "", headers: {} };
  return {
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers || {};
    },
    end(payload) {
      out.body = String(payload || "");
    },
    get result() {
      return out;
    },
  };
};

const parseBody = (result) => {
  try {
    return JSON.parse(String(result?.body || "{}"));
  } catch (_error) {
    return {};
  }
};

const invoke = async (url, method = "GET") => {
  const req = { method, url, headers: { host: "localhost" } };
  const res = buildRes();
  await handler(req, res);
  return res.result;
};

const runV4SeriesRouteTests = async () => {
  const methodInvalid = await invoke("/api/v4/rates/series", "POST");
  assert.strictEqual(methodInvalid.status, 405, "Expected series route to reject non-GET requests.");

  const valid = await invoke(
    "/api/v4/rates/series?rateType=residential&start=2026-03-01T00:00:00.000Z&end=2026-03-01T23:59:59.000Z&lat=37.7&lng=-122.4&utilityCode=pge"
  );
  assert.strictEqual(valid.status, 200, "Expected series route to return a chart-safe payload.");
  const payload = parseBody(valid);
  assert.ok(payload?.ok, "Expected series route payload to use app response shape.");
  assert.ok(Array.isArray(payload?.series?.hourly), "Expected hourly series from series route.");
};

module.exports = { runV4SeriesRouteTests };
