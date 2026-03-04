const handleDeprecatedRatesRefresh = (req, res) => {
  res.writeHead(410, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify({
      errors: ["Deprecated endpoint. Use POST /api/v3/refresh."],
    })
  );
};

module.exports = handleDeprecatedRatesRefresh;
