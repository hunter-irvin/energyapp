const assert = require("assert");
const { __internal } = require("../../lib/rates/lmp-adapters");

const chunkHours = (chunk) => (new Date(chunk.end).getTime() - new Date(chunk.start).getTime()) / (60 * 60 * 1000);

const runCaisoChunkPlanPerformanceHeuristicsTests = async () => {
  const start = new Date("2026-02-01T00:00:00.000Z");
  const end = new Date("2026-02-03T00:00:00.000Z");

  const rtChunks = __internal.buildCaisoChunks({
    start,
    end,
    marketMode: "real_time",
    chunkProfile: "visible_window",
  });
  assert.ok(rtChunks.length > 0, "Expected RT chunks.");
  rtChunks.forEach((chunk) => {
    const hours = chunkHours(chunk);
    assert.ok(hours <= 6, `Expected RT chunk <= 6 hours, got ${hours}.`);
  });

  const daVisibleChunks = __internal.buildCaisoChunks({
    start,
    end,
    marketMode: "day_ahead",
    chunkProfile: "visible_window",
  });
  assert.ok(daVisibleChunks.length > 0, "Expected DA visible chunks.");
  daVisibleChunks.forEach((chunk) => {
    const hours = chunkHours(chunk);
    assert.ok(hours <= 24, `Expected DA visible chunk <= 24 hours, got ${hours}.`);
  });

  const daBackfillChunks = __internal.buildCaisoChunks({
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2026-02-15T00:00:00.000Z"),
    marketMode: "day_ahead",
    chunkProfile: "backfill",
  });
  assert.ok(daBackfillChunks.length > 0, "Expected DA backfill chunks.");
  const maxBackfillHours = daBackfillChunks.reduce((max, chunk) => Math.max(max, chunkHours(chunk)), 0);
  assert.ok(maxBackfillHours >= 24, "Expected DA backfill chunking to allow larger chunks than visible-window profile.");

  const concurrencyRt = __internal.resolveCaisoConcurrency({ marketMode: "real_time" });
  const concurrencyDa = __internal.resolveCaisoConcurrency({ marketMode: "day_ahead" });
  assert.ok(concurrencyRt >= 1 && concurrencyRt <= 4);
  assert.ok(concurrencyDa >= 1 && concurrencyDa <= 4);
};

module.exports = { runCaisoChunkPlanPerformanceHeuristicsTests };
