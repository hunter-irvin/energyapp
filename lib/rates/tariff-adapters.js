const { buildRangeHours, stableRandom, toIsoHour, buildMissingIntervals } = require("./series-utils");
const { resolveTariffProgram } = require("./tariff-programs");

const getTariffValue = ({ date, program, regionId }) => {
  const month = date.getUTCMonth() + 1;
  const hour = date.getUTCHours();
  const day = date.getUTCDay();
  const isSummer = program.seasonMonths?.summer?.includes(month);
  const seasonKey = isSummer ? "summer" : "winter";
  const seasonRates = program.prices?.[seasonKey] || program.prices?.summer || {};
  const isPeak = (program.peakHours || []).includes(hour);
  const isShoulder = !isPeak && (program.shoulderHours || []).includes(hour);
  let base = seasonRates.offpeak ?? 0.09;
  if (isPeak) base = seasonRates.peak ?? base;
  else if (isShoulder) base = seasonRates.shoulder ?? base;
  if (day === 0 || day === 6) base *= Number(program.weekendMultiplier || 1);
  const jitter = (stableRandom(`${program.id}-${regionId}-${date.toISOString().slice(0, 10)}-${hour}`) - 0.5) * 0.003;
  return Number(Math.max(0.01, base + jitter).toFixed(4));
};

const getTariffSeries = async ({ regionId, start, end, tariffProgramId = "" }) => {
  const program = resolveTariffProgram({ tariffProgramId, regionId });
  const points = buildRangeHours(start, end).map((date) => ({
    ts: toIsoHour(date),
    value: getTariffValue({ date, regionId, program }),
    isForecast: date.getTime() > Date.now(),
    missingReason: null,
  }));
  return {
    points,
    missingIntervals: buildMissingIntervals(points),
    source: program.source || "rates_proxy_phase2_tariff_schedule",
    unit: program.sourceUnit || "USD/kWh",
    details: {
      reason: "schedule_based",
      tariffProgramId: program.id,
      tariffProgramLabel: program.label,
      note: "Phase 3 tariff adapter uses utility-program proxy schedules pending direct utility feed connectors.",
      confidence: program.confidence || "low",
    },
  };
};

module.exports = {
  getTariffSeries,
};
