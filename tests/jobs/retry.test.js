const assert = require("assert");
const { createIngestionJobEngine } = require("../../lib/v3/ingestion-job-engine");
const { createMemoryIngestionJobStore } = require("../../lib/v3/ingestion-job-store-memory");

const runJobRetryTests = async () => {
  const store = createMemoryIngestionJobStore();
  let attempts = 0;
  const engine = createIngestionJobEngine({
    store,
    retryDelayMs: 1000,
    maxAttempts: 2,
    handlers: {
      generation: async () => {
        attempts += 1;
        throw new Error(`fail-${attempts}`);
      },
    },
  });

  await engine.enqueue({
    projectId: "p-retry",
    domain: "generation",
    mode: "rolling",
    requestedBy: "manual_refresh",
  });

  const firstRun = await engine.runNext();
  assert.strictEqual(firstRun.ran, true);
  assert.strictEqual(firstRun.job.status, "queued", "First failure should requeue.");
  assert.strictEqual(firstRun.job.attempts, 1);
  assert.ok(firstRun.job.next_retry_at, "Expected next_retry_at after first failure.");

  const stateAfterFirst = store._debugState();
  const jobAfterFirst = stateAfterFirst.jobs.find((entry) => entry.project_id === "p-retry");
  assert.ok(jobAfterFirst);
  jobAfterFirst.next_retry_at = new Date(Date.now() - 5000).toISOString();

  const mutableState = store._debugState();
  const patchTarget = mutableState.jobs.find((entry) => entry.project_id === "p-retry");
  await store.update(patchTarget.id, { next_retry_at: new Date(Date.now() - 5000).toISOString() });

  const secondRun = await engine.runNext();
  assert.strictEqual(secondRun.ran, true);
  assert.strictEqual(secondRun.job.status, "failed", "Second failure should become terminal.");
  assert.strictEqual(secondRun.job.attempts, 2);
  assert.strictEqual(attempts, 2);
};

module.exports = { runJobRetryTests };

