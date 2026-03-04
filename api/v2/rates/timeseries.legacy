const handleDeprecatedV2RatesTimeseries = (req, res) => {
  res.writeHead(410, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify({
      errors: ["Deprecated endpoint. Use /api/v3/series/rates and /api/v3/refresh."],
    })
  );
};

module.exports = handleDeprecatedV2RatesTimeseries;
