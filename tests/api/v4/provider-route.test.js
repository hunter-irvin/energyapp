const assert = require("assert");
const path = require("path");
const handler = require(path.join(__dirname, "..", "..", "..", "api", "v4", "rates", "provider.js"));

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

const runV4ProviderRouteTests = async () => {
  const valid = await invoke("/api/v4/rates/provider?lat=37.7&lng=-122.4");
  assert.strictEqual(valid.status, 200, "Expected provider route to resolve v4 provider metadata.");
  const validPayload = parseBody(valid);
  assert.ok(validPayload?.provider, "Expected provider route payload to include provider metadata.");

  const invalidCoords = await invoke("/api/v4/rates/provider?lat=abc&lng=-122.4");
  assert.strictEqual(invalidCoords.status, 400, "Expected provider route to reject invalid coordinates.");
};

module.exports = { runV4ProviderRouteTests };
