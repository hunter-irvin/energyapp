(() => {
  const ENGINE_SCHEMA = "rates_v4_rt_engine_v2";
  const STORAGE_PREFIX = "energyapp|rates-v4|rt-cache-engine|v1";
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const DEFAULT_HISTORICAL_IMMUTABLE_LAG_MS = FIVE_MIN_MS;

  function toIso(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function floorToFiveMinIso(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const ms = Math.floor(d.getTime() / FIVE_MIN_MS) * FIVE_MIN_MS;
    return new Date(ms).toISOString();
  }

  function toFiniteOrNull(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function buildLocationFingerprint({ lat, lng }) {
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return "unknown";
    return `${nLat.toFixed(5)},${nLng.toFixed(5)}`;
  }

  function buildPartition({ projectId, rateType, timezone, locationFingerprint }) {
    return {
      projectId: String(projectId || "none"),
      rateType: String(rateType || "commercial_realtime"),
      timezone: String(timezone || "UTC"),
      locationFingerprint: String(locationFingerprint || "unknown"),
    };
  }

  function buildPartitionPrefix(partition) {
    return [STORAGE_PREFIX, partition.projectId, partition.rateType, partition.timezone].join("|");
  }

  function buildStorageKey(partition) {
    return `${buildPartitionPrefix(partition)}|${partition.locationFingerprint}`;
  }

  function createEmptyStore(partition) {
    return {
      schema: ENGINE_SCHEMA,
      partition,
      pointsByTs: {},
      coverage: [],
      spanErrors: [],
      meta: {
        updatedAt: new Date().toISOString(),
      },
    };
  }

  function normalizeCoverage(coverage) {
    const spans = (Array.isArray(coverage) ? coverage : [])
      .map((item) => {
        const startIso = toIso(item?.startIso || item?.start || item?.startTs);
        const endIso = toIso(item?.endIso || item?.end || item?.endTs);
        if (!startIso || !endIso) return null;
        const startMs = Date.parse(startIso);
        const endMs = Date.parse(endIso);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
        return { startIso, endIso, startMs, endMs };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    const merged = [];
    spans.forEach((span) => {
      if (!merged.length) {
        merged.push({ ...span });
        return;
      }
      const prev = merged[merged.length - 1];
      if (span.startMs <= prev.endMs + 1000) {
        if (span.endMs > prev.endMs) {
          prev.endMs = span.endMs;
          prev.endIso = span.endIso;
        }
        return;
      }
      merged.push({ ...span });
    });

    return merged.map((item) => ({ startIso: item.startIso, endIso: item.endIso }));
  }

  function addCoverageSpan(coverage, startIso, endIso) {
    return normalizeCoverage([...(Array.isArray(coverage) ? coverage : []), { startIso, endIso }]);
  }

  function computeMissingSpans(coverage, startIso, endIso) {
    const startMs = Date.parse(String(startIso || ""));
    const endMs = Date.parse(String(endIso || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

    const normalized = normalizeCoverage(coverage)
      .map((item) => ({
        startMs: Date.parse(item.startIso),
        endMs: Date.parse(item.endIso),
      }))
      .filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs))
      .filter((item) => item.endMs >= startMs && item.startMs <= endMs)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    const missing = [];
    let cursor = startMs;

    normalized.forEach((span) => {
      const clampedStart = Math.max(span.startMs, startMs);
      const clampedEnd = Math.min(span.endMs, endMs);
      if (clampedStart > cursor) {
        missing.push({ startIso: new Date(cursor).toISOString(), endIso: new Date(clampedStart).toISOString() });
      }
      if (clampedEnd > cursor) {
        cursor = clampedEnd;
      }
    });

    if (cursor < endMs) {
      missing.push({ startIso: new Date(cursor).toISOString(), endIso: new Date(endMs).toISOString() });
    }

    return missing.filter((item) => Date.parse(item.endIso) > Date.parse(item.startIso));
  }

  function aggregatePoints(points, bucketMinutes) {
    const bucketMs = Math.max(1, Number(bucketMinutes) || 1) * 60 * 1000;
    const map = new Map();

    (Array.isArray(points) ? points : []).forEach((point) => {
      const tsMs = Date.parse(String(point?.ts || ""));
      if (!Number.isFinite(tsMs)) return;
      const bucketTs = new Date(Math.floor(tsMs / bucketMs) * bucketMs).toISOString();
      if (!map.has(bucketTs)) {
        map.set(bucketTs, { ts: bucketTs, sum: 0, count: 0, isForecast: false });
      }
      const bucket = map.get(bucketTs);
      bucket.isForecast = bucket.isForecast || Boolean(point?.isForecast);
      const value = toFiniteOrNull(point?.value);
      if (value == null) return;
      bucket.sum += value;
      bucket.count += 1;
    });

    return Array.from(map.values())
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      .map((bucket) => ({
        ts: bucket.ts,
        value: bucket.count > 0 ? Number((bucket.sum / bucket.count).toFixed(6)) : null,
        isForecast: bucket.isForecast,
        missingReason: bucket.count === 0 ? "No source points in bucket." : null,
      }));
  }

  function getWindowFiveMinPoints(store, startIso, endIso) {
    const startMs = Date.parse(String(startIso || ""));
    const endMs = Date.parse(String(endIso || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

    const pointsByTs = store?.pointsByTs && typeof store.pointsByTs === "object" ? store.pointsByTs : {};

    return Object.keys(pointsByTs)
      .map((ts) => {
        const tsMs = Date.parse(ts);
        if (!Number.isFinite(tsMs) || tsMs < startMs || tsMs > endMs) return null;
        const point = pointsByTs[ts] || {};
        return {
          ts,
          value: toFiniteOrNull(point.value),
          isForecast: Boolean(point.isForecast),
          missingReason: point.missingReason || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }

  function buildWindowPayload(store, startIso, endIso) {
    const fiveMin = getWindowFiveMinPoints(store, startIso, endIso);
    return {
      windowStart: startIso,
      windowEnd: endIso,
      fetchedAt: new Date().toISOString(),
      series: {
        five_min: fiveMin,
        half_hour: aggregatePoints(fiveMin, 30),
        hourly: aggregatePoints(fiveMin, 60),
      },
    };
  }

  function mergeSeriesIntoStore(store, seriesPayload, options = {}) {
    const next = store && typeof store === "object" ? store : createEmptyStore(buildPartition({}));
    if (!next.pointsByTs || typeof next.pointsByTs !== "object") next.pointsByTs = {};
    if (!Array.isArray(next.coverage)) next.coverage = [];
    if (!Array.isArray(next.spanErrors)) next.spanErrors = [];

    const spanStartIso = toIso(options.spanStartIso || seriesPayload?.windowStart);
    const spanEndIso = toIso(options.spanEndIso || seriesPayload?.windowEnd);

    const hasCoverageOverride =
      Object.prototype.hasOwnProperty.call(options, "coverageStartIso") ||
      Object.prototype.hasOwnProperty.call(options, "coverageEndIso");
    const coverageStartIso = hasCoverageOverride ? toIso(options.coverageStartIso) : spanStartIso;
    const coverageEndIso = hasCoverageOverride ? toIso(options.coverageEndIso) : spanEndIso;

    const immutableLagMs = Number(options.immutableLagMs || DEFAULT_HISTORICAL_IMMUTABLE_LAG_MS);
    const nowMs = Number(options.nowMs || Date.now());
    const immutableCutoffMs = nowMs - Math.max(0, immutableLagMs);

    const points = Array.isArray(seriesPayload?.series?.five_min) ? seriesPayload.series.five_min : [];
    points.forEach((point) => {
      const ts = floorToFiveMinIso(point?.ts);
      if (!ts) return;
      const tsMs = Date.parse(ts);
      if (!Number.isFinite(tsMs)) return;

      const nextValue = toFiniteOrNull(point?.value);
      const existing = next.pointsByTs[ts];
      const existingValue = toFiniteOrNull(existing?.value);
      const shouldLock = tsMs <= immutableCutoffMs;

      if (shouldLock && existing) {
        // Historical values remain immutable once populated, but historical null gaps can be healed by later backfills.
        if (existingValue != null) return;
        if (nextValue == null) return;
      }

      next.pointsByTs[ts] = {
        value: nextValue,
        isForecast: Boolean(point?.isForecast),
        missingReason: nextValue == null ? point?.missingReason || null : null,
      };
    });

    if (coverageStartIso && coverageEndIso) {
      next.coverage = addCoverageSpan(next.coverage, coverageStartIso, coverageEndIso);
    }

    next.meta = {
      ...(next.meta || {}),
      updatedAt: new Date().toISOString(),
      lastSeriesWindowStart: seriesPayload?.windowStart || null,
      lastSeriesWindowEnd: seriesPayload?.windowEnd || null,
      lastDetails: seriesPayload?.details || null,
    };

    return next;
  }

  function recordSpanError(store, span, errorDetails) {
    const next = store && typeof store === "object" ? store : createEmptyStore(buildPartition({}));
    if (!Array.isArray(next.spanErrors)) next.spanErrors = [];
    next.spanErrors.push({
      startIso: toIso(span?.startIso) || null,
      endIso: toIso(span?.endIso) || null,
      at: new Date().toISOString(),
      code: String(errorDetails?.code || errorDetails?.upstreamErrorCode || "UNKNOWN_ERROR"),
      httpStatus: Number(errorDetails?.httpStatus || errorDetails?.upstreamHttpStatus) || null,
      message: String(errorDetails?.message || errorDetails?.upstreamError || "Request failed"),
    });
    if (next.spanErrors.length > 250) {
      next.spanErrors = next.spanErrors.slice(next.spanErrors.length - 250);
    }
    return next;
  }

  function invalidateByLocationFingerprint(storage, partition) {
    const targetPartition = buildPartition(partition || {});
    const prefix = `${buildPartitionPrefix(targetPartition)}|`;
    const keepKey = buildStorageKey(targetPartition);

    const removals = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      if (key === keepKey) continue;
      removals.push(key);
    }
    removals.forEach((key) => storage.removeItem(key));
    return removals.length;
  }

  function loadStore(storage, partition) {
    const normalizedPartition = buildPartition(partition || {});
    invalidateByLocationFingerprint(storage, normalizedPartition);

    const key = buildStorageKey(normalizedPartition);
    const raw = storage.getItem(key);
    if (!raw) return createEmptyStore(normalizedPartition);
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.schema !== ENGINE_SCHEMA) return createEmptyStore(normalizedPartition);
      return {
        ...createEmptyStore(normalizedPartition),
        ...parsed,
        partition: normalizedPartition,
        coverage: normalizeCoverage(parsed?.coverage || []),
        pointsByTs: parsed?.pointsByTs && typeof parsed.pointsByTs === "object" ? parsed.pointsByTs : {},
        spanErrors: Array.isArray(parsed?.spanErrors) ? parsed.spanErrors : [],
      };
    } catch (_error) {
      return createEmptyStore(normalizedPartition);
    }
  }

  function saveStore(storage, store) {
    const normalizedPartition = buildPartition(store?.partition || {});
    const key = buildStorageKey(normalizedPartition);
    const payload = {
      ...createEmptyStore(normalizedPartition),
      ...store,
      partition: normalizedPartition,
      schema: ENGINE_SCHEMA,
      coverage: normalizeCoverage(store?.coverage || []),
    };
    storage.setItem(key, JSON.stringify(payload));
    return payload;
  }

  const api = {
    ENGINE_SCHEMA,
    buildLocationFingerprint,
    buildPartition,
    buildStorageKey,
    loadStore,
    saveStore,
    computeMissingSpans,
    buildWindowPayload,
    mergeSeriesIntoStore,
    recordSpanError,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.EnergyRatesV4CacheEngine = api;
  }
})();



