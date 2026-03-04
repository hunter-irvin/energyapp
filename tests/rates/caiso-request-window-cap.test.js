const assert = require("assert");
const { __internal } = require("../../lib/rates/lmp-adapters");

const spanHours = (chunk) => (new Date(chunk.end).getTime() - new Date(chunk.start).getTime()) / (60 * 60 * 1000);

const runCaisoRequestWindowCapTests = async () => {
  const start = new Date("2025-01-01T00:00:00.000Z");
  const end = new Date("2025-03-15T00:00:00.000Z");
  const chunks = __internal.buildCaisoChunks({
    start,
    end,
    marketMode: "day_ahead",
    chunkProfile: "backfill",
  });

  assert.ok(chunks.length > 0, "Expected chunk list.");

  const totalMs = new Date(chunks[chunks.length - 1].end).getTime() - new Date(chunks[0].start).getTime();
  const maxWindowMs = 31 * 24 * 60 * 60 * 1000;
  assert.ok(totalMs <= maxWindowMs + 60 * 1000, "Expected CAISO request plan to cap at 31 days.");

  chunks.forEach((chunk) => {
    const hours = spanHours(chunk);
    assert.ok(hours <= 31 * 24, `Expected each chunk <=31 days, got ${hours}h.`);
  });
};

module.exports = { runCaisoRequestWindowCapTests };
