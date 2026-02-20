const HOUR_MS = 60 * 60 * 1000;

const toIsoHour = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
};

const parseIso = (value) => {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildRangeHours = (start, end) => {
  const list = [];
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  const endHour = new Date(end);
  endHour.setUTCMinutes(0, 0, 0);
  while (cursor <= endHour) {
    list.push(new Date(cursor));
    cursor.setTime(cursor.getTime() + HOUR_MS);
  }
  return list;
};

const stableRandom = (seed) => {
  let hash = 2166136261;
  const text = String(seed || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

const buildMissingIntervals = (points) => {
  const intervals = [];
  let current = null;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point?.value == null) {
      if (!current) {
        current = {
          start: point.ts,
          end: point.ts,
          reason: point.missingReason || "No rate data",
        };
      } else {
        current.end = point.ts;
      }
    } else if (current) {
      intervals.push(current);
      current = null;
    }
  }
  if (current) intervals.push(current);
  return intervals;
};

const mapByIsoHour = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = toIsoHour(row.ts);
    if (!key) return;
    if (!Number.isFinite(Number(row.value))) return;
    map.set(key, Number(row.value));
  });
  return map;
};

module.exports = {
  HOUR_MS,
  toIsoHour,
  parseIso,
  buildRangeHours,
  stableRandom,
  buildMissingIntervals,
  mapByIsoHour,
};
