const assert = require("assert");
const path = require("path");
const { handleV4RatesSeries } = require(path.join(__dirname, "..", "..", "..", "api", "v4-rates-proxy.js"));

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

const runV4RatesContractTests = async () => {
  const reqMethodInvalid = {
    method: "POST",
    url: "/api/v4/rates/series",
    headers: { host: "localhost" },
  };
  const resMethodInvalid = buildRes();
  await handleV4RatesSeries(reqMethodInvalid, resMethodInvalid);
  assert.strictEqual(resMethodInvalid.result.status, 405, "Expected 405 for non-GET v4 rates series request.");

  const reqUnsupportedType = {
    method: "GET",
    url: "/api/v4/rates/series?rateType=residential&start=2026-03-01T00:00:00.000Z&end=2026-03-01T23:59:59.000Z&lat=37.7&lng=-122.4",
    headers: { host: "localhost" },
  };
  const resUnsupportedType = buildRes();
  await handleV4RatesSeries(reqUnsupportedType, resUnsupportedType);
  assert.strictEqual(resUnsupportedType.result.status, 400, "Expected 400 for unsupported v4 rate type.");

  const reqDayAhead = {
    method: "GET",
    url: "/api/v4/rates/series?rateType=commercial_day_ahead&start=2026-03-01T00:00:00.000Z&end=2026-03-01T23:59:59.000Z&lat=35.0&lng=-120.0",
    headers: { host: "localhost" },
  };
  const resDayAhead = buildRes();
  await handleV4RatesSeries(reqDayAhead, resDayAhead);
  assert.notStrictEqual(resDayAhead.result.status, 400, "Expected DA rate type to be accepted by v4 contract.");
};

module.exports = { runV4RatesContractTests };
