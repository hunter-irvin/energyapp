const toIso = (value) => {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizeMarketMode = (value) => {
  const mode = String(value || "day_ahead").trim().toLowerCase();
  if (!mode) return "day_ahead";
  if (!["day_ahead", "real_time"].includes(mode)) {
    throw new Error("marketMode must be 'day_ahead' or 'real_time'.");
  }
  return mode;
};

const buildCaisoFalseZeroRepairSql = ({
  projectId,
  windowStart,
  windowEnd,
  marketMode = "day_ahead",
  dryRun = false,
} = {}) => {
  const normalizedProjectId = String(projectId || "").trim();
  const startIso = toIso(windowStart);
  const endIso = toIso(windowEnd);
  const normalizedMarketMode = normalizeMarketMode(marketMode);

  if (!normalizedProjectId) throw new Error("projectId is required.");
  if (!startIso || !endIso || startIso > endIso) throw new Error("Valid windowStart/windowEnd are required.");

  const repairCode =
    normalizedMarketMode === "real_time" ? "R13_FALSE_ZERO_REPAIRED_RT" : "R12_FALSE_ZERO_REPAIRED_DA";

  const whereClause = [
    "project_id = $1",
    "region_id = 'CAISO'",
    "service_type = 'lmp'",
    `market_mode = '${normalizedMarketMode}'`,
    "source = 'rates_proxy_phase3_live_caiso_oasis'",
    "value = 0",
    "ts >= $2::timestamptz",
    "ts <= $3::timestamptz",
  ].join("\n  and ");

  const sql = dryRun
    ? `select id, ts, value, source, source_url\nfrom rate_project_series\nwhere ${whereClause}\norder by ts asc;`
    : `update rate_project_series\nset value = null,\n    quality_status = 'missing',\n    error_code = coalesce(error_code, '${repairCode}'),\n    updated_at = now()\nwhere ${whereClause};`;

  return {
    sql,
    params: [normalizedProjectId, startIso, endIso],
  };
};

const buildCaisoDaFalseZeroRepairSql = (options = {}) =>
  buildCaisoFalseZeroRepairSql({ ...options, marketMode: "day_ahead" });

const buildCaisoRtFalseZeroRepairSql = (options = {}) =>
  buildCaisoFalseZeroRepairSql({ ...options, marketMode: "real_time" });

module.exports = {
  buildCaisoFalseZeroRepairSql,
  buildCaisoDaFalseZeroRepairSql,
  buildCaisoRtFalseZeroRepairSql,
};
