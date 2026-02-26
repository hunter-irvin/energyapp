const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runCadenceControlsTests = () => {
  const filePath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates.js");
  const source = fs.readFileSync(filePath, "utf8");
  assert.ok(/cadenceMinutes\s*<=\s*5/.test(source) && /available\.unshift\("five_min"\)/.test(source), "Expected five_min interval enablement to be cadence-driven.");
  assert.ok(/viewState\.period\s*===\s*"month"/.test(source) && /intervalKey\)\s*=>\s*intervalKey\s*===\s*"hourly"\s*\|\|\s*intervalKey\s*===\s*"daily"/.test(source), "Expected month period interval restriction.");
  assert.ok(/viewState\.period\s*===\s*"day"/.test(source) && /intervalKey\)\s*=>\s*intervalKey\s*!==\s*"daily"/.test(source), "Expected day period interval restriction.");
};

module.exports = { runCadenceControlsTests };
