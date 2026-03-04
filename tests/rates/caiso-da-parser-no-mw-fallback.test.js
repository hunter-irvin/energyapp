const assert = require("assert");
const { __internal } = require("../../lib/rates/lmp-adapters");

const runCaisoDaParserNoMwFallbackTests = async () => {
  const rows = [
    {
      intervalstarttime_gmt: "2026-02-08T00:00:00Z",
      mw: "0",
      value: "0",
    },
    {
      intervalstarttime_gmt: "2026-02-08T01:00:00Z",
      lmp_prc: "17.35",
      mw: "0",
    },
  ];

  const parsedDa = __internal.parseCaisoRows(rows, { marketMode: "day_ahead" });
  assert.strictEqual(parsedDa.length, 1, "Expected DA parser to ignore rows without explicit LMP price fields.");
  assert.strictEqual(parsedDa[0].value, 17.35);

  const parsedRt = __internal.parseCaisoRows(rows, { marketMode: "real_time" });
  assert.strictEqual(parsedRt.length, 1, "Expected RT parser to ignore rows without explicit LMP price fields.");
  assert.strictEqual(parsedRt[0].value, 17.35);
};

module.exports = { runCaisoDaParserNoMwFallbackTests };
