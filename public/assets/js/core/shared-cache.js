(() => {
  const CACHE_VERSION = 1;
  const CACHE_PREFIX = "energyapp.shared.project.";
  const MAX_SERIES_PER_BUCKET = 16;

  const pad2 = (value) => String(value).padStart(2, "0");

  const stableSerialize = (value) => {
    if (value == null) return "null";
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const hashString = (input) => {
    let hash = 2166136261;
    const text = String(input || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const getRecordStamp = (record) => {
    if (!record || typeof record !== "object") return "";
    if (typeof record.timestamp === "string") return record.timestamp;
    const year = Number(record.year);
    const month = Number(record.month);
    const day = Number(record.day);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
    const hour = Number(record.hour ?? 0);
    const minute = Number(record.minute ?? 0);
    return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
  };

  const summarizeRecords = (records) => {
    const list = Array.isArray(records) ? records : [];
    const length = list.length;
    if (!length) {
      return { length: 0, first: "", mid: "", last: "" };
    }
    const first = getRecordStamp(list[0]);
    const mid = getRecordStamp(list[Math.floor(length / 2)]);
    const last = getRecordStamp(list[length - 1]);
    return { length, first, mid, last };
  };

  const getKey = (projectId) => `${CACHE_PREFIX}${projectId}.v${CACHE_VERSION}`;

  const readState = (projectId) => {
    if (!projectId) return null;
    try {
      const raw = localStorage.getItem(getKey(projectId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (error) {
      return null;
    }
  };

  const writeState = (projectId, state) => {
    if (!projectId || !state) return false;
    try {
      localStorage.setItem(getKey(projectId), JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  };

  const getEmptyState = () => ({
    v: CACHE_VERSION,
    revisions: { weather: "", assets: "", storage: "" },
    weather: null,
    derived: {
      generation: {},
      storage: {},
    },
  });

  const getState = (projectId) => readState(projectId) || getEmptyState();

  const saveState = (projectId, state) => writeState(projectId, state);

  const cloneValue = (value) => {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  };

  const buildWeatherRevision = ({ provider = "", timeZone = "UTC", solar = [], wind = [] } = {}) => {
    const stamp = {
      provider,
      timeZone,
      solar: summarizeRecords(solar),
      wind: summarizeRecords(wind),
    };
    return hashString(stableSerialize(stamp));
  };

  const normalizeAssetRows = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    return list
      .map((row) => ({
        id: row?.id || "",
        model: row?.model || row || {},
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  const buildAssetsRevision = ({ solar = [], wind = [] } = {}) =>
    hashString(stableSerialize({ solar: normalizeAssetRows(solar), wind: normalizeAssetRows(wind) }));

  const buildStorageRevision = ({ storage = [] } = {}) =>
    hashString(stableSerialize({ storage: normalizeAssetRows(storage) }));

  const buildDerivedKey = (parts = {}) => hashString(stableSerialize(parts));

  const trimDerivedBucket = (bucket) => {
    const entries = Object.entries(bucket || {});
    if (entries.length <= MAX_SERIES_PER_BUCKET) return bucket;
    entries
      .sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0))
      .slice(MAX_SERIES_PER_BUCKET)
      .forEach(([key]) => {
        delete bucket[key];
      });
    return bucket;
  };

  const setRevision = (projectId, key, value) => {
    const state = getState(projectId);
    state.revisions = state.revisions || { weather: "", assets: "", storage: "" };
    state.revisions[key] = value || "";
    saveState(projectId, state);
    return state.revisions[key];
  };

  const getRevisions = (projectId) => {
    const state = getState(projectId);
    return state.revisions || { weather: "", assets: "", storage: "" };
  };

  const setParsedWeather = (
    projectId,
    { provider = "nrel", timeZone = "UTC", raw15 = {}, hourly = {}, daily = {}, windMetric = {}, weatherRevision = "" } = {}
  ) => {
    const state = getState(projectId);
    const nextRevision =
      weatherRevision ||
      buildWeatherRevision({
        provider,
        timeZone,
        solar: raw15?.solar || [],
        wind: raw15?.wind || [],
      });
    const prevRevision = state.revisions?.weather || "";
    state.weather = {
      provider,
      timeZone,
      raw15: cloneValue(raw15),
      hourly: cloneValue(hourly),
      daily: cloneValue(daily),
      windMetric: cloneValue(windMetric),
      weatherRevision: nextRevision,
      savedAt: Date.now(),
    };
    state.revisions = state.revisions || { weather: "", assets: "", storage: "" };
    state.revisions.weather = nextRevision;
    if (prevRevision && prevRevision !== nextRevision) {
      state.derived = state.derived || { generation: {}, storage: {} };
      state.derived.generation = {};
      state.derived.storage = {};
    }
    saveState(projectId, state);
    return nextRevision;
  };

  const getParsedWeather = (projectId, { provider = "" } = {}) => {
    const state = getState(projectId);
    const weather = state.weather;
    if (!weather) return null;
    if (provider && weather.provider !== provider) return null;
    return cloneValue(weather);
  };

  const setDerivedSeries = (projectId, bucketName, key, series) => {
    if (!projectId || !bucketName || !key || !series) return;
    const state = getState(projectId);
    state.derived = state.derived || {};
    state.derived[bucketName] = state.derived[bucketName] || {};
    state.derived[bucketName][key] = {
      savedAt: Date.now(),
      value: cloneValue(series),
    };
    trimDerivedBucket(state.derived[bucketName]);
    saveState(projectId, state);
  };

  const getDerivedSeries = (projectId, bucketName, key) => {
    if (!projectId || !bucketName || !key) return null;
    const state = getState(projectId);
    const hit = state?.derived?.[bucketName]?.[key];
    return hit?.value ? cloneValue(hit.value) : null;
  };

  const clearWeather = (projectId) => {
    const state = getState(projectId);
    state.weather = null;
    state.revisions = state.revisions || { weather: "", assets: "", storage: "" };
    state.revisions.weather = "";
    state.derived = state.derived || { generation: {}, storage: {} };
    state.derived.generation = {};
    state.derived.storage = {};
    saveState(projectId, state);
  };

  const clearProject = (projectId) => {
    if (!projectId) return;
    try {
      localStorage.removeItem(getKey(projectId));
    } catch (error) {}
  };

  window.EnergySharedCache = {
    buildWeatherRevision,
    buildAssetsRevision,
    buildStorageRevision,
    buildDerivedKey,
    setRevision,
    getRevisions,
    setParsedWeather,
    getParsedWeather,
    setDerivedSeries,
    getDerivedSeries,
    clearWeather,
    clearProject,
  };
})();
