const { handleV4RatesProvider } = require("../../../lib/rates/v4-rates-handlers");

module.exports = (req, res) => handleV4RatesProvider(req, res);
