const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");

const runJobLifecycleTests = async () => {
  const store = createMemoryIngestionJobStore();
  const engine = createIngestionJobEngine({
    store,
    handlers: {
      weather: async () => ({ fingerprint: "wf-ok" }),
    },
  });

  const queued = await engine.enqueue({
    projectId: "p-lifecycle",
    domain: "weather",
    mode: "rolling",
    requestedBy: "manual_refresh",
  });
  assert.strictEqual(queued.deduped, false);
  assert.strictEqual(queued.job.status, "queued");

  const outcome = await engine.runNext();
  assert.strictEqual(outcome.ran, true);
  assert.strictEqual(outcome.job.status, "completed");

  const state = store._debugState();
  const sync = state.syncState.find((entry) => entry.project_id === "p-lifecycle" && entry.domain === "weather");
  assert.ok(sync, "Expected domain sync state row.");
  assert.ok(sync.last_success_at, "Expected last_success_at on sync state.");
};

module.exports = { runJobLifecycleTests };

