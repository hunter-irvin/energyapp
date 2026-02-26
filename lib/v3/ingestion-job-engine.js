const VALID_DOMAINS = new Set(["weather", "generation", "rates", "storage"]);
const VALID_MODES = new Set(["rolling", "full", "visible_window"]);
const VALID_REQUESTED_BY = new Set([
  "user_login",
  "manual_refresh",
  "nightly_cron",
  "location_change",
  "asset_change",
]);

const toIso = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
};

const assertValidInput = ({ projectId, domain, mode, requestedBy }) => {
  if (!projectId) throw new Error("Missing required projectId.");
  if (!VALID_DOMAINS.has(domain)) throw new Error("Invalid domain.");
  if (!VALID_MODES.has(mode)) throw new Error("Invalid sync mode.");
  if (!VALID_REQUESTED_BY.has(requestedBy)) throw new Error("Invalid requestedBy.");
};

const createIngestionJobEngine = ({
  store,
  handlers = {},
  maxAttempts = 3,
  retryDelayMs = 30000,
  now = () => new Date().toISOString(),
} = {}) => {
  if (!store) {
    throw new Error("Ingestion job engine requires a store implementation.");
  }

  const resolveHandler = (domain) => handlers[domain] || (async () => ({}));

  const enqueue = async ({
    projectId,
    domain,
    mode = "rolling",
    requestedBy = "manual_refresh",
    priority = 100,
    windowStart = null,
    windowEnd = null,
    payload = {},
  }) => {
    const normalizedDomain = String(domain || "").trim().toLowerCase();
    const normalizedMode = String(mode || "").trim().toLowerCase();
    const normalizedRequestedBy = String(requestedBy || "").trim().toLowerCase();
    assertValidInput({
      projectId: String(projectId || "").trim(),
      domain: normalizedDomain,
      mode: normalizedMode,
      requestedBy: normalizedRequestedBy,
    });

    const normalizedWindowStart = toIso(windowStart);
    const normalizedWindowEnd = toIso(windowEnd);
    const dedupeKey = {
      projectId: String(projectId).trim(),
      domain: normalizedDomain,
      mode: normalizedMode,
      windowStart: normalizedWindowStart,
      windowEnd: normalizedWindowEnd,
    };
    const duplicate = await store.findActiveDuplicate(dedupeKey);
    if (duplicate) {
      return { job: duplicate, deduped: true };
    }

    const createdAt = now();
    const row = {
      project_id: dedupeKey.projectId,
      domain: dedupeKey.domain,
      mode: dedupeKey.mode,
      status: "queued",
      priority: Number(priority) || 100,
      requested_by: normalizedRequestedBy,
      window_start: normalizedWindowStart,
      window_end: normalizedWindowEnd,
      payload: payload || {},
      attempts: 0,
      max_attempts: Math.max(1, Number(payload?.maxAttempts || maxAttempts) || maxAttempts),
      next_retry_at: null,
      started_at: null,
      completed_at: null,
      error: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const inserted = await store.insert(row);
    return { job: inserted, deduped: false };
  };

  const runJob = async (job) => {
    if (!job || !job.id) throw new Error("Cannot run empty job.");
    const claimed = await store.claim(job.id, now());
    if (!claimed) {
      return { job: null, skipped: true, reason: "not_claimed" };
    }

    const handler = resolveHandler(claimed.domain);
    try {
      const result = await handler(claimed, { enqueue });
      const completedAt = now();
      const completed = await store.update(claimed.id, {
        status: "completed",
        completed_at: completedAt,
        error: null,
        updated_at: completedAt,
      });
      await store.upsertDomainSyncState({
        project_id: claimed.project_id,
        domain: claimed.domain,
        rolling_start: result?.windowStart || claimed.window_start,
        rolling_end: result?.windowEnd || claimed.window_end,
        last_success_at: completedAt,
        last_attempt_at: completedAt,
        last_error: null,
        fingerprint: result?.fingerprint || claimed.payload?.fingerprint || null,
        updated_at: completedAt,
      });
      return { job: completed, skipped: false, result };
    } catch (error) {
      const attempts = Number(claimed.attempts || 0) + 1;
      const max = Math.max(1, Number(claimed.max_attempts || maxAttempts) || maxAttempts);
      const failedAt = now();
      const nextRetry =
        attempts < max ? new Date(new Date(failedAt).getTime() + Number(retryDelayMs || 0)).toISOString() : null;
      const terminal = attempts >= max;
      const updated = await store.update(claimed.id, {
        status: terminal ? "failed" : "queued",
        attempts,
        next_retry_at: nextRetry,
        error: String(error?.message || "job_failed"),
        completed_at: terminal ? failedAt : null,
        updated_at: failedAt,
      });
      await store.upsertDomainSyncState({
        project_id: claimed.project_id,
        domain: claimed.domain,
        rolling_start: claimed.window_start,
        rolling_end: claimed.window_end,
        last_attempt_at: failedAt,
        last_error: String(error?.message || "job_failed"),
        updated_at: failedAt,
      });
      return { job: updated, skipped: false, error };
    }
  };

  const runNext = async () => {
    const next = await store.claimNextRunnable(now());
    if (!next) return { job: null, ran: false };
    const outcome = await runJob(next);
    return { ...outcome, ran: true };
  };

  const runBatch = async ({ limit = 10 } = {}) => {
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    const results = [];
    for (let i = 0; i < normalizedLimit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runNext();
      if (!outcome?.ran) break;
      results.push(outcome);
    }
    return { processed: results.length, results };
  };

  return {
    enqueue,
    runJob,
    runNext,
    runBatch,
  };
};

module.exports = {
  createIngestionJobEngine,
};
