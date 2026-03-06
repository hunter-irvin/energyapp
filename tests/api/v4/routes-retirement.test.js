const assert = require("assert");
const path = require("path");
const handler = require(path.join(__dirname, "..", "..", "..", "api", "[...path].js"));

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

const runV4RoutesRetirementTests = async () => {
  const oldProvider = await invoke("/api/rates/provider?lat=37.7&lng=-122.4");
  assert.strictEqual(oldProvider.status, 404, "Expected prototype provider route to be removed.");

  const oldV3Series = await invoke("/api/v3/series/rates?projectId=p1");
  assert.strictEqual(oldV3Series.status, 404, "Expected /api/v3/* routes to be removed.");

  const v4Provider = await invoke("/api/v4/rates/provider?lat=37.7&lng=-122.4");
  assert.strictEqual(v4Provider.status, 200, "Expected v4 provider route to be available.");
  const payload = parseBody(v4Provider);
  assert.ok(payload?.provider, "Expected provider metadata payload from v4 provider route.");
};

module.exports = { runV4RoutesRetirementTests };
