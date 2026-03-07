const { handleV4RatesSeries } = require("../../../lib/rates/v4-rates-handlers");

module.exports = (req, res) => handleV4RatesSeries(req, res);
