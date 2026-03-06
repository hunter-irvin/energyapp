(() => {
  const WEATHER_ENGINE_SCHEMA = "weather_open_meteo_coverage_v1";
  const WEATHER_RECORD_INTERVAL_MINUTES = 30;

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function toIso(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function toRecordIso(record) {
    if (!record || typeof record !== "object") return null;
    const stamped = toIso(record.normalized_timestamp || record.timestamp || null);
    if (stamped) return stamped;

    const year = Number(record.year);
    const month = Number(record.month);
    const day = Number(record.day);
    const hour = Number(record.hour || 0);
    const minute = Number(record.minute || 0);
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
    return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00.000Z`;
  }

  function toSortableRecord(record) {
    const ts = toRecordIso(record);
    if (!ts) return null;
    return {
      ...record,
      normalized_timestamp: ts,
      year: String(new Date(ts).getUTCFullYear()),
      month: String(new Date(ts).getUTCMonth() + 1),
      day: String(new Date(ts).getUTCDate()),
      hour: String(new Date(ts).getUTCHours()),
      minute: String(new Date(ts).getUTCMinutes()),
    };
  }

  function mergeRecordsByTimestamp(baseRecords = [], incomingRecords = []) {
    const map = new Map();
    (Array.isArray(baseRecords) ? baseRecords : []).forEach((record) => {
      const next = toSortableRecord(record);
      if (!next) return;
      map.set(next.normalized_timestamp, next);
    });
    (Array.isArray(incomingRecords) ? incomingRecords : []).forEach((record) => {
      const next = toSortableRecord(record);
      if (!next) return;
      map.set(next.normalized_timestamp, next);
    });

    return Array.from(map.values()).sort((a, b) =>
      String(a.normalized_timestamp).localeCompare(String(b.normalized_timestamp))
    );
  }

  function getCoverageWindow(records = []) {
    const items = (Array.isArray(records) ? records : [])
      .map((row) => toRecordIso(row))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!items.length) return { start: null, end: null };
    return {
      start: items[0],
      end: items[items.length - 1],
    };
  }

  function buildExpectedIsoRange(startIso, endIso, intervalMinutes = WEATHER_RECORD_INTERVAL_MINUTES) {
    const start = Date.parse(String(startIso || ""));
    const end = Date.parse(String(endIso || ""));
    const step = Math.max(1, Number(intervalMinutes) || WEATHER_RECORD_INTERVAL_MINUTES) * 60 * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

    const points = [];
    for (let cursor = start; cursor <= end; cursor += step) {
      points.push(new Date(cursor).toISOString());
    }
    return points;
  }

  function isWindowCovered(records = [], startIso, endIso, intervalMinutes = WEATHER_RECORD_INTERVAL_MINUTES) {
    const expected = buildExpectedIsoRange(startIso, endIso, intervalMinutes);
    if (!expected.length) return false;
    const set = new Set((Array.isArray(records) ? records : []).map((item) => toRecordIso(item)).filter(Boolean));
    return expected.every((point) => set.has(point));
  }

  function extractWindowRecords(records = [], startIso, endIso) {
    const start = Date.parse(String(startIso || ""));
    const end = Date.parse(String(endIso || ""));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

    return (Array.isArray(records) ? records : [])
      .map((record) => toSortableRecord(record))
      .filter(Boolean)
      .filter((record) => {
        const ts = Date.parse(record.normalized_timestamp);
        return Number.isFinite(ts) && ts >= start && ts <= end;
      })
      .sort((a, b) => String(a.normalized_timestamp).localeCompare(String(b.normalized_timestamp)));
  }

  function computeCoverageGaps(records = [], startIso, endIso, intervalMinutes = WEATHER_RECORD_INTERVAL_MINUTES) {
    const expected = buildExpectedIsoRange(startIso, endIso, intervalMinutes);
    if (!expected.length) return [];
    const set = new Set((Array.isArray(records) ? records : []).map((item) => toRecordIso(item)).filter(Boolean));
    const gaps = [];
    let gapStart = null;
    let prev = null;

    expected.forEach((iso) => {
      const has = set.has(iso);
      if (!has && !gapStart) {
        gapStart = iso;
      }
      if (has && gapStart) {
        gaps.push({ start: gapStart, end: prev || gapStart });
        gapStart = null;
      }
      prev = iso;
    });

    if (gapStart) {
      gaps.push({ start: gapStart, end: prev || gapStart });
    }

    return gaps;
  }

  function buildCoverageEnvelope(records = [], requestedStartIso = null, requestedEndIso = null) {
    const served = getCoverageWindow(records);
    const requested = {
      start: toIso(requestedStartIso),
      end: toIso(requestedEndIso),
    };
    const gaps =
      requested.start && requested.end
        ? computeCoverageGaps(records, requested.start, requested.end, WEATHER_RECORD_INTERVAL_MINUTES)
        : [];

    return {
      schema: WEATHER_ENGINE_SCHEMA,
      intervalMinutes: WEATHER_RECORD_INTERVAL_MINUTES,
      requestedWindow: requested,
      servedWindow: served,
      coverageWindow: served,
      coverageGaps: gaps,
    };
  }

  window.EnergyWeatherCoverage = {
    WEATHER_ENGINE_SCHEMA,
    WEATHER_RECORD_INTERVAL_MINUTES,
    toRecordIso,
    mergeRecordsByTimestamp,
    getCoverageWindow,
    isWindowCovered,
    extractWindowRecords,
    computeCoverageGaps,
    buildCoverageEnvelope,
  };
})();
