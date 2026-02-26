const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");

const runJobIdempotencyTests = async () => {
  const store = createMemoryIngestionJobStore();
  const engine = createIngestionJobEngine({ store });

  const first = await engine.enqueue({
    projectId: "p-idempotent",
    domain: "rates",
    mode: "rolling",
    requestedBy: "manual_refresh",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-02T00:00:00.000Z",
  });
  assert.strictEqual(first.deduped, false);

  const duplicate = await engine.enqueue({
    projectId: "p-idempotent",
    domain: "rates",
    mode: "rolling",
    requestedBy: "manual_refresh",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-02T00:00:00.000Z",
  });
  assert.strictEqual(duplicate.deduped, true);
  assert.strictEqual(duplicate.job.id, first.job.id);

  const state = store._debugState();
  const jobs = state.jobs.filter((job) => job.project_id === "p-idempotent");
  assert.strictEqual(jobs.length, 1, "Expected exactly one queued job for duplicate enqueue.");
};

module.exports = { runJobIdempotencyTests };

