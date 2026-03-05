const assert = require("assert");
const fs = require("fs");
const path = require("path");

const runRatesV4UiStateTests = () => {
  const jsPath = path.join(__dirname, "..", "..", "public", "assets", "js", "pages", "rates-v4.js");
  const htmlPath = path.join(__dirname, "..", "..", "public", "projects", "rates-v4.html");
  const js = fs.readFileSync(jsPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.ok(/const\s+PERIODS\s*=\s*Object\.freeze\(\["day",\s*"week",\s*"month"\]\)/.test(js), "Expected day/week/month period controls only.");
  assert.ok(/INTERVALS_BY_PERIOD_RT\s*=\s*Object\.freeze\(\{[\s\S]*month:\s*Object\.freeze\(\["hourly"\]\)/.test(js), "Expected RT month period to allow hourly interval only.");
  assert.ok(/INTERVALS_BY_PERIOD_DA\s*=\s*Object\.freeze\(\{[\s\S]*day:\s*Object\.freeze\(\["hourly"\]\)[\s\S]*week:\s*Object\.freeze\(\["hourly"\]\)[\s\S]*month:\s*Object\.freeze\(\["hourly"\]\)/.test(js), "Expected DA to be hourly-only across day/week/month.");
  assert.ok(/rateType:\s*"commercial_realtime"/.test(js), "Expected default selected rate type to be commercial_realtime.");
  assert.ok(/period:\s*"week"/.test(js), "Expected default period to be week.");

  assert.ok(/const\s+RT_TAIL_REFRESH_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(js), "Expected 5-minute RT tail refresh cadence.");
  assert.ok(/const\s+DA_TAIL_REFRESH_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/.test(js), "Expected 30-minute DA tail refresh cadence.");
  assert.ok(/function\s+startTailRefreshScheduler\s*\(/.test(js), "Expected tail refresh scheduler function.");
  assert.ok(/refreshActiveRateWindow\(\{\s*forceRemote:\s*false,\s*tailRefresh:\s*true\s*\}\)/.test(js), "Expected scheduled tail refresh window requests.");

  assert.ok(/function\s+setGlobalRateLimitPause\s*\(/.test(js), "Expected global 429 pause state setter.");
  assert.ok(/function\s+hasGlobalRateLimitPause\s*\(/.test(js), "Expected global 429 pause state check.");
  assert.ok(/start429Countdown\(rateType,\s*getRateLimitRemainingSeconds\(\),\s*rateLimitState\.message/.test(js), "Expected all pending span fetches to respect active 429 pause.");

  assert.ok(/cacheEngine\.buildPartition\(/.test(js), "Expected unified cache engine partition usage.");
  assert.ok(/cacheEngine\.computeMissingSpans\(/.test(js), "Expected missing-span detection usage.");
  assert.ok(/cacheEngine\.mergeSeriesIntoStore\(/.test(js), "Expected span merge into canonical point store.");
  assert.ok(/cacheEngine\.recordSpanError\(/.test(js), "Expected per-span error metadata persistence.");
  assert.ok(/cacheEngine\.buildWindowPayload\(/.test(js), "Expected window payload rebuild from cached five-minute points.");

  assert.ok(/label:\s*"Missing data"/.test(js) && /className:\s*"legend--missing"/.test(js), "Expected Missing data legend item.");
  assert.ok(/function\s+renderMissingBands\s*\(/.test(js) && /rates-missing-band/.test(js), "Expected missing span crosshatch overlay rendering.");

  assert.ok(/(?:response\.status|finalResponse\?\.status)\s*===\s*429/.test(js) && /start429Countdown\(/.test(js), "Expected 429 countdown handling.");
  assert.ok(/setFetchButtonState\(rateType,\s*true\)/.test(js) && /setFetchButtonState\(rateType,\s*false\)/.test(js), "Expected fetch button disable/enable logic.");
  assert.ok(/data-rate-fetch="commercial_realtime"/.test(html), "Expected Fetch data button on commercial_realtime card.");
  assert.ok(/data-rate-fetch="commercial_day_ahead"/.test(html), "Expected Fetch data button on commercial_day_ahead card.");
  assert.ok(/id="rates-v4-missing-overlay"/.test(html), "Expected missing overlay container on Rates V4 chart frame.");
};

module.exports = { runRatesV4UiStateTests };



