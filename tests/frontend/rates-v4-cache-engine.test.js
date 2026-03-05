const assert = require("assert");
const path = require("path");

const {
  buildLocationFingerprint,
  buildPartition,
  loadStore,
  saveStore,
  computeMissingSpans,
  buildWindowPayload,
  mergeSeriesIntoStore,
  recordSpanError,
} = require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "rates-v4-cache-engine.js"));

const createLocalStorageMock = () => {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] || null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
  };
};

const runRatesV4CacheEngineTests = () => {
  const storage = createLocalStorageMock();
  const locationFingerprint = buildLocationFingerprint({ lat: 37.722237, lng: -121.57211 });
  const partition = buildPartition({
    projectId: "proj-1",
    rateType: "commercial_realtime",
    timezone: "America/Los_Angeles",
    locationFingerprint,
  });

  let store = loadStore(storage, partition);
  assert.ok(store && store.partition, "Expected store load to initialize partition.");

  const weekStart = "2026-03-01T00:00:00.000Z";
  const weekEnd = "2026-03-08T00:00:00.000Z";

  const points = [];
  for (let i = 0; i < 12; i += 1) {
    points.push({
      ts: new Date(Date.parse(weekStart) + i * 5 * 60 * 1000).toISOString(),
      value: i,
      isForecast: false,
      missingReason: null,
    });
  }

  store = mergeSeriesIntoStore(
    store,
    {
      windowStart: weekStart,
      windowEnd: weekEnd,
      series: {
        five_min: points,
      },
    },
    { spanStartIso: weekStart, spanEndIso: weekEnd }
  );

  saveStore(storage, store);

  const dayStart = "2026-03-03T00:00:00.000Z";
  const dayEnd = "2026-03-03T23:59:59.000Z";
  const missing = computeMissingSpans(store.coverage, dayStart, dayEnd);
  assert.strictEqual(missing.length, 0, "Expected no missing spans when requested window is contained by cached coverage.");

  const payload = buildWindowPayload(store, dayStart, dayEnd);
  assert.ok(payload && payload.series, "Expected payload from window build.");
  assert.ok(Array.isArray(payload.series.five_min), "Expected five_min series from payload.");

  const immutableStore = mergeSeriesIntoStore(
    store,
    {
      windowStart: weekStart,
      windowEnd: weekEnd,
      series: {
        five_min: [
          {
            ts: points[0].ts,
            value: 999,
            isForecast: false,
            missingReason: null,
          },
        ],
      },
    },
    {
      spanStartIso: weekStart,
      spanEndIso: weekEnd,
      nowMs: Date.parse("2026-03-10T00:00:00.000Z"),
      immutableLagMs: 5 * 60 * 1000,
    }
  );

  const historicalPayload = buildWindowPayload(immutableStore, weekStart, weekEnd);
  assert.strictEqual(historicalPayload.series.five_min[0].value, points[0].value, "Expected historical point immutability to hold.");

  const partialPartition = buildPartition({
    projectId: "proj-partial",
    rateType: "commercial_day_ahead",
    timezone: "America/Los_Angeles",
    locationFingerprint,
  });
  let partialStore = loadStore(storage, partialPartition);
  const partialCoverageEnd = new Date(Date.parse(weekStart) + 60 * 60 * 1000).toISOString();
  partialStore = mergeSeriesIntoStore(
    partialStore,
    {
      windowStart: weekStart,
      windowEnd: weekEnd,
      series: {
        five_min: [{ ts: weekStart, value: 5, isForecast: false, missingReason: null }],
      },
    },
    {
      spanStartIso: weekStart,
      spanEndIso: weekEnd,
      coverageStartIso: weekStart,
      coverageEndIso: partialCoverageEnd,
    }
  );
  const partialMissing = computeMissingSpans(partialStore.coverage, weekStart, weekEnd);
  assert.ok(partialMissing.length > 0, "Expected missing spans when coverage override marks only partial window.");

  const healPartition = buildPartition({
    projectId: "proj-heal",
    rateType: "commercial_day_ahead",
    timezone: "America/Los_Angeles",
    locationFingerprint,
  });
  let healStore = loadStore(storage, healPartition);
  const gapTs = new Date(Date.parse(weekStart) + 2 * 60 * 60 * 1000).toISOString();

  healStore = mergeSeriesIntoStore(
    healStore,
    {
      windowStart: gapTs,
      windowEnd: gapTs,
      series: {
        five_min: [{ ts: gapTs, value: null, isForecast: false, missingReason: "gap" }],
      },
    },
    {
      spanStartIso: gapTs,
      spanEndIso: gapTs,
      nowMs: Date.parse("2026-03-10T00:00:00.000Z"),
      immutableLagMs: 5 * 60 * 1000,
    }
  );

  healStore = mergeSeriesIntoStore(
    healStore,
    {
      windowStart: gapTs,
      windowEnd: gapTs,
      series: {
        five_min: [{ ts: gapTs, value: 42, isForecast: false, missingReason: null }],
      },
    },
    {
      spanStartIso: gapTs,
      spanEndIso: gapTs,
      nowMs: Date.parse("2026-03-10T00:00:00.000Z"),
      immutableLagMs: 5 * 60 * 1000,
    }
  );

  const healedPayload = buildWindowPayload(healStore, gapTs, gapTs);
  assert.strictEqual(healedPayload.series.five_min[0].value, 42, "Expected historical null gap to be healable by later backfill.");
  const storeWithError = recordSpanError(immutableStore, { startIso: dayStart, endIso: dayEnd }, { code: "HTTP_429", message: "Rate limited" });
  assert.ok(Array.isArray(storeWithError.spanErrors) && storeWithError.spanErrors.length > 0, "Expected span error metadata persistence.");

  const movedPartition = buildPartition({
    projectId: "proj-1",
    rateType: "commercial_realtime",
    timezone: "America/Los_Angeles",
    locationFingerprint: buildLocationFingerprint({ lat: 35.12345, lng: -120.12345 }),
  });
  const movedStore = loadStore(storage, movedPartition);
  saveStore(storage, movedStore);
  assert.strictEqual(storage.length, 1, "Expected location-fingerprint invalidation to prune stale partition cache.");
};

module.exports = { runRatesV4CacheEngineTests };


