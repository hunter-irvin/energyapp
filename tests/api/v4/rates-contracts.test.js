const assert = require("assert");
const path = require("path");
const { handleV4RatesSeries } = require(path.join(__dirname, "..", "..", "..", "lib", "rates", "v4-rates-handlers.js"));

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

const runV4RatesContractTests = async () => {
  const reqMethodInvalid = {
    method: "POST",
    url: "/api/v4/rates/series",
    headers: { host: "localhost" },
  };
  const resMethodInvalid = buildRes();
  await handleV4RatesSeries(reqMethodInvalid, resMethodInvalid);
  assert.strictEqual(resMethodInvalid.result.status, 405, "Expected 405 for non-GET v4 rates series request.");

  const reqResidentialUnsupportedUtility = {
    method: "GET",
    url: "/api/v4/rates/series?rateType=residential&start=2026-03-01T00:00:00.000Z&end=2026-03-01T23:59:59.000Z&lat=34.0522&lng=-118.2437",
    headers: { host: "localhost" },
  };
  const resResidentialUnsupportedUtility = buildRes();
  await handleV4RatesSeries(reqResidentialUnsupportedUtility, resResidentialUnsupportedUtility);
  assert.strictEqual(resResidentialUnsupportedUtility.result.status, 200, "Expected residential unsupported utility to return chart-safe payload.");
  const bodyUnsupported = parseBody(resResidentialUnsupportedUtility.result);
  assert.strictEqual(bodyUnsupported?.details?.userError, "data not available for this utility");

  const reqResidentialInRange = {
    method: "GET",
    url: "/api/v4/rates/series?rateType=residential&start=2026-03-01T00:00:00.000Z&end=2026-03-01T23:59:59.000Z&lat=37.7&lng=-122.4&utilityCode=pge",
    headers: { host: "localhost" },
  };
  const resResidentialInRange = buildRes();
  await handleV4RatesSeries(reqResidentialInRange, resResidentialInRange);
  assert.strictEqual(resResidentialInRange.result.status, 200, "Expected residential in-range utility payload.");
  const bodyResidentialInRange = parseBody(resResidentialInRange.result);
  assert.ok(Array.isArray(bodyResidentialInRange?.series?.hourly), "Expected hourly series for residential.");

  const reqResidentialOutOfRange = {
    method: "GET",
    url: "/api/v4/rates/series?rateType=residential&start=2025-12-30T00:00:00.000Z&end=2026-01-02T23:59:59.000Z&lat=37.7&lng=-122.4&utilityCode=pge",
    headers: { host: "localhost" },
  };
  const resResidentialOutOfRange = buildRes();
  await handleV4RatesSeries(reqResidentialOutOfRange, resResidentialOutOfRange);
  assert.strictEqual(resResidentialOutOfRange.result.status, 200, "Expected residential out-of-range payload to remain chart-safe.");
  const bodyOutOfRange = parseBody(resResidentialOutOfRange.result);
  assert.strictEqual(bodyOutOfRange?.details?.userError, "data only available for 2026");

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
