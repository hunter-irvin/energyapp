
(() => {
  const PROXY_ENDPOINT = "/api/nrel-proxy";
  const WEATHER_PROXY_ENDPOINT = "/api/weather-proxy";
  const DEFAULT_DATE_KEY = "2014-02-09";
  const NREL_CACHE_DATE_KEY = "all";
  const NREL_SOURCE_YEAR = 2014;
  const NREL_INTERVAL_MINUTES = 30;
  const NREL_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
  const ASSET_EDIT_DEBOUNCE_MS = 200;
  const POINTS_PER_DAY = (24 * 60) / NREL_INTERVAL_MINUTES;
  const STORAGE_DRAFT_SUFFIX = "storageAssetsDraft";
  const PERIOD_STORAGE_SUFFIX = "selectedPeriod";
  const PERIOD_OPTIONS = ["day", "week", "month", "year"];
  const WEATHER_CACHE_KEYS = ["energyapp.db.weatherCache", "energyapp.db.nrelCache"];
  const supabaseService = window.EnergySupabaseService;
  const sharedCache = window.EnergySharedCache || null;

  const headerProjectNameInput = document.getElementById("storage-header-project-name");
  const storageSettingsLink = document.getElementById("storage-settings-link");
  const storageAssetsLink = document.getElementById("storage-assets-link");
  const storageAssetsHeaderLink = document.getElementById("storage-assets-header-link");
  const storageBackToFacility = document.getElementById("storage-back-to-facility");
  const storageProjectName = document.getElementById("storage-project-name");
  const storageFacilityName = document.getElementById("storage-facility-name");
  const storageFacilityLocation = document.getElementById("storage-facility-location");
  const storageMap = document.getElementById("storage-map");

  const addStorageButton = document.getElementById("add-storage");
  const storageAssetsList = document.getElementById("storage-assets");
  const storageAssetTemplate = document.getElementById("storage-asset-template");
  const deleteStorageModal = document.getElementById("delete-storage-modal");
  const confirmDeleteStorage = document.getElementById("confirm-delete-storage");

  const chartFrame = document.getElementById("storage-chart-frame");
  const chartSvg = document.getElementById("storage-chart");
  const storageChartLoading = document.getElementById("storage-chart-loading");
  const chartAxis = document.getElementById("storage-axis");
  const chartTooltip = document.getElementById("storage-tooltip");
  const debugOutput = document.getElementById("storage-debug-output");

  const periodButtons = Array.from(document.querySelectorAll("[data-storage-period]"));
  const seriesToggleButtons = Array.from(document.querySelectorAll("[data-storage-series]"));
  const datePickerButton = document.getElementById("storage-date-picker-button");
  const datePickerInput = document.getElementById("storage-date-picker");
  const storageDateRangeReadout = document.getElementById("storage-date-range-readout");
  const storageShiftBackButton = document.getElementById("storage-shift-back");
  const storageShiftForwardButton = document.getElementById("storage-shift-forward");
  const fieldTooltip = document.getElementById("storage-field-tooltip");

  const queryParams = new URLSearchParams(window.location.search);
  const projectId = queryParams.get("projectId");
  const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

  const createStorageAsset =
    window.EnergyModels?.createStorageAsset ||
    ((overrides = {}) => ({ ...(window.EnergyModels?.DEFAULT_STORAGE_ASSET || {}), ...overrides }));
  const createSolarAsset = window.EnergyModels?.createSolarAsset || ((overrides = {}) => ({ ...overrides }));
  const createWindAsset = window.EnergyModels?.createWindAsset || ((overrides = {}) => ({ ...overrides }));
  const storageTypeDefaults = window.EnergyModels?.STORAGE_TYPE_DEFAULTS || {};

  let currentProject = null;
  let selectedDateKey = DEFAULT_DATE_KEY;
  let pendingDeleteId = null;
  let recomputeRaf = 0;
  let recomputeDebounceTimer = null;
  let currentSeries = null;
  let storageChart = null;

  const viewState = { period: "day" };
  const seriesVisibility = {
    solar: true,
    wind: true,
    total: true,
    soc: true,
  };
  const storageAssets = [];
  const generationModels = { solar: [], wind: [] };

  const weatherState = {
    loading: false,
    loaded: false,
    error: "",
    timeZone: "UTC",
    source: { solar: [], wind: [] },
    raw15: { solar: [], wind: [] },
    hourly: { solar: [], wind: [] },
    daily: { solar: [], wind: [] },
    windMetric: {
      speed: "windspeed_100m",
      temperature: null,
    },
    weatherRevision: "",
  };

  const pad2 = (value) => String(value).padStart(2, "0");
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const clamp01 = (value) => clamp(value, 0, 1);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isQuotaExceededError = (error) =>
    error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
  const isTlsIssuerErrorMessage = (message) =>
    /unable to get local issuer certificate|unable to verify the first certificate|self.?signed/i.test(String(message || ""));

  const getScopedStorageKey = (suffix) => {
    if (!currentProject?.id) return "";
    if (typeof supabaseService?.buildScopedUiStorageKey === "function") {
      return supabaseService.buildScopedUiStorageKey(currentProject.id, suffix);
    }
    return `energyapp.project.${currentProject.id}.${suffix}`;
  };

  const snapshotStorageDraft = () =>
    storageAssets.map((entry) => ({
      id: entry.id,
      model: createStorageAsset(entry.model),
    }));

  const persistStorageDraft = () => {
    const key = getScopedStorageKey(STORAGE_DRAFT_SUFFIX);
    if (!key) return;
    const payload = JSON.stringify(snapshotStorageDraft());
    try {
      localStorage.setItem(key, payload);
    } catch (error) {
      if (!isQuotaExceededError(error)) return;
      WEATHER_CACHE_KEYS.forEach((cacheKey) => {
        try {
          localStorage.removeItem(cacheKey);
        } catch (removeError) {}
      });
      try {
        localStorage.setItem(key, payload);
      } catch (retryError) {}
    }
  };

  const loadStorageDraft = () => {
    const key = getScopedStorageKey(STORAGE_DRAFT_SUFFIX);
    if (!key) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  };

  const loadPersistedPeriod = (fallback = "day") => {
    const key = getScopedStorageKey(PERIOD_STORAGE_SUFFIX);
    if (!key) return fallback;
    const stored = localStorage.getItem(key);
    return PERIOD_OPTIONS.includes(stored) ? stored : fallback;
  };

  const persistPeriod = (period) => {
    if (!PERIOD_OPTIONS.includes(period)) return;
    const key = getScopedStorageKey(PERIOD_STORAGE_SUFFIX);
    if (!key) return;
    localStorage.setItem(key, period);
  };

  const buildAssetsRevision = () => {
    if (!sharedCache) return "";
    return sharedCache.buildAssetsRevision({
      solar: generationModels.solar.map((model, index) => ({ id: `solar-${index}`, model })),
      wind: generationModels.wind.map((model, index) => ({ id: `wind-${index}`, model })),
    });
  };

  const buildStorageRevision = () => {
    if (!sharedCache) return "";
    return sharedCache.buildStorageRevision({
      storage: storageAssets.map((entry) => ({ id: entry.id, model: entry.model })),
    });
  };

  const restoreWeatherFromSharedCache = () => {
    if (!currentProject?.id || !sharedCache) return false;
    const provider = currentProject.weatherProvider || "nrel";
    const cached = sharedCache.getParsedWeather(currentProject.id, { provider });
    if (!cached?.raw15?.solar || !cached?.raw15?.wind) return false;
    weatherState.source.solar = cached.raw15.solar || [];
    weatherState.source.wind = cached.raw15.wind || [];
    weatherState.weatherRevision = cached.weatherRevision || "";
    hydrateWeatherStore(weatherState.source.solar, weatherState.source.wind, cached.timeZone || "UTC");
    weatherState.loaded = true;
    weatherState.error = "";
    return true;
  };

  const withRetry = async (operation, { retries = 2, delayMs = 400 } = {}) => {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === retries) {
          break;
        }
        await sleep(delayMs * (attempt + 1));
      }
    }
    throw lastError;
  };

  const formatDateKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const formatShortDate = (date) => {
    const yy = String(date.getFullYear()).slice(-2);
    return `${date.getMonth() + 1}/${date.getDate()}/${yy}`;
  };
  const parseDateKey = (dateKey) => {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, month - 1, day);
  };
  const getWeekStart = (date) => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  };
  const getWeekEnd = (weekStart) => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 0, 0, 0);
    return end;
  };
  const formatIndicatorDate = (date) => `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
  const formatIndicatorTime = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const formatTooltipLabelHtml = (text) => String(text || "").replace(/\n/g, "<br />");
  const formatChartIndicator = (period, dateKey, index) => {
    const selectedDate = parseDateKey(dateKey);
    if (!(selectedDate instanceof Date) || Number.isNaN(selectedDate.getTime())) {
      return "";
    }

    if (period === "day") {
      const cursor = new Date(selectedDate);
      cursor.setHours(0, 0, 0, 0);
      cursor.setMinutes(index * NREL_INTERVAL_MINUTES);
      return formatIndicatorTime(cursor);
    }

    if (period === "week") {
      const weekStart = getWeekStart(selectedDate);
      const cursor = new Date(weekStart);
      cursor.setHours(cursor.getHours() + index);
      const dayOfWeek = cursor.toLocaleDateString("en-US", { weekday: "short" });
      return `${dayOfWeek} ${formatIndicatorDate(cursor)}\n${formatIndicatorTime(cursor)}`;
    }

    if (period === "month") {
      const cursor = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1 + index);
      return formatIndicatorDate(cursor);
    }

    if (period === "year") {
      const cursor = new Date(selectedDate.getFullYear(), 0, 1 + index);
      return formatIndicatorDate(cursor);
    }

    return "";
  };

  const getDateRangeForPeriod = (period, selectedDate) => {
    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (period === "week") {
      const weekStart = getWeekStart(start);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return { start: weekStart, end: weekEnd };
    }
    if (period === "month") {
      return {
        start: new Date(start.getFullYear(), start.getMonth(), 1),
        end: new Date(start.getFullYear(), start.getMonth() + 1, 0),
      };
    }
    if (period === "year") {
      return {
        start: new Date(start.getFullYear(), 0, 1),
        end: new Date(start.getFullYear(), 11, 31),
      };
    }
    return { start, end };
  };

  const updateDateRangeReadout = () => {
    if (!storageDateRangeReadout) return;
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startText = formatShortDate(start);
    const endText = formatShortDate(end);
    storageDateRangeReadout.textContent = startText === endText ? startText : `${startText}-${endText}`;
  };

  const normalizeHeader = (header) => {
    const cleaned = cleanText(header)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!cleaned) return cleaned;
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("100")) return "windspeed_100m";
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("20")) return "windspeed_20m";
    if (cleaned.includes("temperature") && cleaned.includes("100")) return "temperature_100m";
    if (cleaned.includes("temperature") && cleaned.includes("20")) return "temperature_20m";
    if (cleaned.includes("pressure") && cleaned.includes("100")) return "pressure_100m";
    if (cleaned.includes("pressure") && cleaned.includes("20")) return "pressure_20m";
    if (cleaned.includes("air") && cleaned.includes("temperature")) return "air_temperature";
    return cleaned;
  };

  const parseCsv = (csvText) => {
    const lines = csvText.split(/\r?\n/).map((line) => cleanText(line)).filter(Boolean);
    const headerIndex = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      return lower.startsWith("year,") || lower.startsWith("timestamp,");
    });
    if (headerIndex < 0) return [];
    const headers = lines[headerIndex].split(",").map((header) => normalizeHeader(header));
    return lines.slice(headerIndex + 1).map((line) => {
      const values = line.split(",");
      const row = {};
      headers.forEach((header, index) => {
        const value = cleanText(values[index]);
        if (!header) return;
        if (value === "") {
          row[header] = null;
          return;
        }
        const numeric = Number(value);
        row[header] = Number.isFinite(numeric) ? numeric : value;
      });
      return row;
    });
  };

  const buildUrl = (base, params) => {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  };

  const parseError = async (responses) => {
    const failed = responses.find((response) => !response.ok);
    if (!failed) return "";
    try {
      const errorPayload = await failed.clone().json();
      if (Array.isArray(errorPayload?.errors) && errorPayload.errors.length > 0) {
        return errorPayload.errors.join(" ");
      }
    } catch (error) {}
    const text = await failed.text();
    return text || "Unable to fetch datasets.";
  };

  const fetchTimeZone = async ({ lat, lng }) => {
    const url = new URL("https://timeapi.io/api/TimeZone/coordinate");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    try {
      const response = await fetch(url.toString());
      if (!response.ok) return "UTC";
      const payload = await response.json();
      return payload?.timeZone || "UTC";
    } catch (error) {
      return "UTC";
    }
  };

  const getTimeZoneFormatter = (timeZone) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

  const shiftRecordsToTimeZone = (records, timeZone) => {
    if (!timeZone || timeZone === "UTC") return records;
    const formatter = getTimeZoneFormatter(timeZone);
    return records.map((record) => {
      const year = Number(record.year);
      const month = Number(record.month);
      const day = Number(record.day);
      const hour = Number(record.hour ?? 0);
      const minute = Number(record.minute ?? 0);
      if (![year, month, day, hour, minute].every(Number.isFinite)) return record;
      const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
      const parts = formatter.formatToParts(utcDate).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
      return {
        ...record,
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
      };
    });
  };

  const normalizeRecordYears = (records, targetYear) =>
    records.map((record) =>
      record.year && Number(record.year) !== Number(targetYear) ? { ...record, year: Number(targetYear) } : record
    );

  const buildHourlyAggregation = (records, metrics) => {
    const buckets = new Map();
    records.forEach((record) => {
      const key = `${record.year}-${pad2(record.month)}-${pad2(record.day)}T${pad2(record.hour)}:00`;
      if (!buckets.has(key)) buckets.set(key, { timestamp: key, sums: {}, counts: {} });
      const bucket = buckets.get(key);
      metrics.forEach((metric) => {
        const value = Number(record[metric]);
        if (!Number.isFinite(value)) return;
        bucket.sums[metric] = (bucket.sums[metric] || 0) + value;
        bucket.counts[metric] = (bucket.counts[metric] || 0) + 1;
      });
    });
    return Array.from(buckets.values()).map((bucket) => {
      const row = { timestamp: bucket.timestamp };
      metrics.forEach((metric) => {
        const count = bucket.counts[metric] || 0;
        row[metric] = count ? bucket.sums[metric] / count : 0;
      });
      return row;
    });
  };

  const toDailyAggregation = (records, metrics) => {
    const buckets = new Map();
    records.forEach((record) => {
      const key = `${record.year}-${pad2(record.month)}-${pad2(record.day)}`;
      if (!buckets.has(key)) buckets.set(key, { date: key, sums: {}, counts: {} });
      const bucket = buckets.get(key);
      metrics.forEach((metric) => {
        const value = Number(record[metric]);
        if (!Number.isFinite(value)) return;
        bucket.sums[metric] = (bucket.sums[metric] || 0) + value;
        bucket.counts[metric] = (bucket.counts[metric] || 0) + 1;
      });
    });
    return Array.from(buckets.values()).map((bucket) => {
      const row = { date: bucket.date };
      metrics.forEach((metric) => {
        const count = bucket.counts[metric] || 0;
        row[metric] = count ? bucket.sums[metric] / count : 0;
      });
      return row;
    });
  };

  const hydrateWeatherStore = (solarPayload, windPayload, timeZone) => {
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const year = selectedDate.getFullYear();
    const normalizedSolar = normalizeRecordYears(solarPayload, year);
    const normalizedWind = normalizeRecordYears(windPayload, year);
    const shiftedSolar = shiftRecordsToTimeZone(normalizedSolar, timeZone);
    const shiftedWind = shiftRecordsToTimeZone(normalizedWind, timeZone);

    const windSample = shiftedWind.find(Boolean) || {};
    const speedKeys = Object.keys(windSample).filter((key) => /^windspeed_\d+m$/.test(key));
    const speedMetric = speedKeys.includes("windspeed_100m") ? "windspeed_100m" : speedKeys[0] || "windspeed_100m";
    const tempMetric = speedMetric.replace("windspeed", "temperature");

    weatherState.timeZone = timeZone;
    weatherState.windMetric = {
      speed: speedMetric,
      temperature: windSample[tempMetric] != null ? tempMetric : null,
    };

    weatherState.raw15.solar = shiftedSolar;
    weatherState.raw15.wind = shiftedWind;

    const solarMetrics = ["ghi", "dni", "dhi", "air_temperature", "wind_speed"];
    const windMetrics = Object.keys(windSample).filter((key) => /^(windspeed|temperature|pressure)_\d+m$/.test(key));
    weatherState.hourly.solar = buildHourlyAggregation(shiftedSolar, solarMetrics);
    weatherState.hourly.wind = buildHourlyAggregation(shiftedWind, windMetrics);
    weatherState.daily.solar = toDailyAggregation(shiftedSolar, solarMetrics);
    weatherState.daily.wind = toDailyAggregation(shiftedWind, windMetrics);
  };

  const isFreshCache = (cacheRow) => {
    if (!cacheRow?.fetched_at) return false;
    const fetchedAt = new Date(cacheRow.fetched_at).getTime();
    return Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= NREL_CACHE_TTL_MS;
  };

  const fetchWeather = async ({ forceRefresh = false } = {}) => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
      weatherState.error = "Set a facility location before modeling storage.";
      weatherState.loaded = false;
      scheduleRecompute();
      return;
    }
    weatherState.loading = true;
    weatherState.error = "";
    scheduleRecompute();

    try {
      const nrelCacheLookup = { sourceYear: NREL_SOURCE_YEAR, intervalMinutes: NREL_INTERVAL_MINUTES };
      const openMeteoCacheLookup = { sourceYear: null, intervalMinutes: NREL_INTERVAL_MINUTES };
      const [cachedSolar, cachedWind, cachedSolarOpenMeteo, cachedWindOpenMeteo] = await Promise.all([
        supabaseService.getNrelCache(currentProject.id, "solar", NREL_CACHE_DATE_KEY, nrelCacheLookup),
        supabaseService.getNrelCache(currentProject.id, "wind", NREL_CACHE_DATE_KEY, nrelCacheLookup),
        supabaseService.getWeatherCache(currentProject.id, "open_meteo", "solar", NREL_CACHE_DATE_KEY, openMeteoCacheLookup),
        supabaseService.getWeatherCache(currentProject.id, "open_meteo", "wind", NREL_CACHE_DATE_KEY, openMeteoCacheLookup),
      ]);

      let solarPayload;
      let windPayload;
      let timeZone = cachedSolar?.timezone || cachedWind?.timezone || "UTC";
      let fetchedProvider = "nrel";

      if (!forceRefresh && isFreshCache(cachedSolar) && isFreshCache(cachedWind) && cachedSolar?.payload && cachedWind?.payload) {
        solarPayload = cachedSolar.payload;
        windPayload = cachedWind.payload;
      } else if (
        !forceRefresh &&
        isFreshCache(cachedSolarOpenMeteo) &&
        isFreshCache(cachedWindOpenMeteo) &&
        cachedSolarOpenMeteo?.payload &&
        cachedWindOpenMeteo?.payload
      ) {
        solarPayload = cachedSolarOpenMeteo.payload;
        windPayload = cachedWindOpenMeteo.payload;
        timeZone = cachedSolarOpenMeteo?.timezone || cachedWindOpenMeteo?.timezone || "UTC";
        fetchedProvider = "open_meteo";
      } else {
        const wkt = `POINT(${currentProject.lng} ${currentProject.lat})`;
        try {
          const [solarResponse, windResponse] = await Promise.all([
            fetch(buildUrl(PROXY_ENDPOINT, { dataset: "solar", wkt, interval: String(NREL_INTERVAL_MINUTES) })),
            fetch(buildUrl(PROXY_ENDPOINT, { dataset: "wind", wkt, interval: String(NREL_INTERVAL_MINUTES) })),
          ]);
          const responseError = await parseError([solarResponse, windResponse]);
          if (responseError) throw new Error(responseError);

          const [solarCsv, windCsv] = await Promise.all([solarResponse.text(), windResponse.text()]);
          solarPayload = parseCsv(solarCsv);
          windPayload = parseCsv(windCsv);
          timeZone = await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng });
          fetchedProvider = "nrel";
        } catch (nrelError) {
          if (!isTlsIssuerErrorMessage(nrelError?.message)) throw nrelError;

          const openMeteoResponse = await fetch(
            buildUrl(WEATHER_PROXY_ENDPOINT, {
              provider: "open_meteo",
              lat: String(currentProject.lat),
              lng: String(currentProject.lng),
              mode: "load_default",
            })
          );
          const openMeteoError = await parseError([openMeteoResponse]);
          if (openMeteoError) throw new Error(openMeteoError);
          const openMeteoPayload = await openMeteoResponse.json();
          solarPayload = Array.isArray(openMeteoPayload?.solar) ? openMeteoPayload.solar : [];
          windPayload = Array.isArray(openMeteoPayload?.wind) ? openMeteoPayload.wind : [];
          timeZone = openMeteoPayload?.meta?.timezone || "UTC";
          fetchedProvider = "open_meteo";
        }

        const fetchedAt = new Date().toISOString();
        if (fetchedProvider === "nrel") {
          void supabaseService.upsertNrelCache({ projectId: currentProject.id, dataset: "solar", dateKey: NREL_CACHE_DATE_KEY, sourceYear: NREL_SOURCE_YEAR, intervalMinutes: NREL_INTERVAL_MINUTES, wkt, timezone: timeZone, source: "nrel_proxy", fetchedAt, payload: solarPayload });
          void supabaseService.upsertNrelCache({ projectId: currentProject.id, dataset: "wind", dateKey: NREL_CACHE_DATE_KEY, sourceYear: NREL_SOURCE_YEAR, intervalMinutes: NREL_INTERVAL_MINUTES, wkt, timezone: timeZone, source: "nrel_proxy", fetchedAt, payload: windPayload });
        } else {
          void supabaseService.upsertWeatherCache({ projectId: currentProject.id, provider: "open_meteo", dataset: "solar", dateKey: NREL_CACHE_DATE_KEY, sourceYear: null, intervalMinutes: NREL_INTERVAL_MINUTES, wkt, timezone: timeZone, source: "weather_proxy", fetchedAt, payload: solarPayload });
          void supabaseService.upsertWeatherCache({ projectId: currentProject.id, provider: "open_meteo", dataset: "wind", dateKey: NREL_CACHE_DATE_KEY, sourceYear: null, intervalMinutes: NREL_INTERVAL_MINUTES, wkt, timezone: timeZone, source: "weather_proxy", fetchedAt, payload: windPayload });
        }
      }

      weatherState.source.solar = solarPayload;
      weatherState.source.wind = windPayload;
      hydrateWeatherStore(solarPayload, windPayload, timeZone);
      if (currentProject?.id && sharedCache) {
        const weatherRevision = sharedCache.setParsedWeather(currentProject.id, {
          provider: fetchedProvider,
          timeZone: timeZone || "UTC",
          raw15: weatherState.raw15,
          hourly: weatherState.hourly,
          daily: weatherState.daily,
          windMetric: weatherState.windMetric,
        });
        weatherState.weatherRevision = weatherRevision;
        sharedCache.setRevision(currentProject.id, "weather", weatherRevision);
      }
      weatherState.loaded = true;
      weatherState.error = "";
    } catch (error) {
      weatherState.loaded = false;
      weatherState.error = error.message || "Unable to fetch weather data.";
      weatherState.weatherRevision = "";
    } finally {
      weatherState.loading = false;
      scheduleRecompute();
    }
  };

  const buildGenerationForPeriod = () => {
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const period = viewState.period;
    const windSpeedMetric = weatherState.windMetric.speed;
    const emptySolar = { ghi: 0, dni: 0, dhi: 0, air_temperature: 25 };
    const emptyWind = { [windSpeedMetric]: 0 };
    const pickTemp = (solarPoint, windPoint) => {
      const solarTemp = Number(solarPoint?.air_temperature);
      if (Number.isFinite(solarTemp)) return solarTemp;
      const tempKey = weatherState.windMetric.temperature;
      const windTemp = tempKey ? Number(windPoint?.[tempKey]) : NaN;
      return Number.isFinite(windTemp) ? windTemp : 25;
    };

    let labels = [];
    let solarSeries = [];
    let windSeries = [];
    let temps = [];
    let dtHours = 0.25;

    if (period === "day") {
      const keyFor = (year, month, day, hour, minute) => `${year}-${pad2(month)}-${pad2(day)}-${pad2(hour)}-${pad2(minute)}`;
      const solarMap = new Map(weatherState.raw15.solar.map((record) => [keyFor(record.year, record.month, record.day, record.hour || 0, record.minute || 0), record]));
      const windMap = new Map(weatherState.raw15.wind.map((record) => [keyFor(record.year, record.month, record.day, record.hour || 0, record.minute || 0), record]));
      for (let i = 0; i < POINTS_PER_DAY; i += 1) {
        const hour = Math.floor((i * NREL_INTERVAL_MINUTES) / 60);
        const minute = (i * NREL_INTERVAL_MINUTES) % 60;
        const key = keyFor(selectedDate.getFullYear(), selectedDate.getMonth() + 1, selectedDate.getDate(), hour, minute);
        const solarPoint = solarMap.get(key) || emptySolar;
        const windPoint = windMap.get(key) || emptyWind;
        labels.push(`${formatDateKey(selectedDate)} ${pad2(hour)}:${pad2(minute)}`);
        solarSeries.push(solarPoint);
        windSeries.push(windPoint);
        temps.push(pickTemp(solarPoint, windPoint));
      }
      dtHours = NREL_INTERVAL_MINUTES / 60;
    } else if (period === "week") {
      const solarMap = new Map(weatherState.hourly.solar.map((record) => [record.timestamp, record]));
      const windMap = new Map(weatherState.hourly.wind.map((record) => [record.timestamp, record]));
      const start = getWeekStart(selectedDate);
      const end = getWeekEnd(start);
      for (let cursor = new Date(start); cursor <= end; cursor.setHours(cursor.getHours() + 1)) {
        const key = `${formatDateKey(cursor)}T${pad2(cursor.getHours())}:00`;
        const solarPoint = solarMap.get(key) || emptySolar;
        const windPoint = windMap.get(key) || emptyWind;
        labels.push(cursor.toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" }));
        solarSeries.push(solarPoint);
        windSeries.push(windPoint);
        temps.push(pickTemp(solarPoint, windPoint));
      }
      dtHours = 1;
    } else {
      const solarMap = new Map(weatherState.daily.solar.map((record) => [record.date, record]));
      const windMap = new Map(weatherState.daily.wind.map((record) => [record.date, record]));
      const start = period === "month" ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1) : new Date(selectedDate.getFullYear(), 0, 1);
      const end = period === "month" ? new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0) : new Date(selectedDate.getFullYear(), 11, 31);
      for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const key = formatDateKey(cursor);
        const solarPoint = solarMap.get(key) || emptySolar;
        const windPoint = windMap.get(key) || emptyWind;
        labels.push(cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        solarSeries.push(solarPoint);
        windSeries.push(windPoint);
        temps.push(pickTemp(solarPoint, windPoint));
      }
      dtHours = 24;
    }

    const solarKw = window.EnergyGeneration?.sumSolarAssets ? window.EnergyGeneration.sumSolarAssets(generationModels.solar, solarSeries) : new Float64Array(labels.length);
    const windKw = window.EnergyGeneration?.sumWindAssets ? window.EnergyGeneration.sumWindAssets(generationModels.wind, windSeries) : new Float64Array(labels.length);

    const generationKw = new Float64Array(labels.length);
    const solarKwh = new Float64Array(labels.length);
    const windKwh = new Float64Array(labels.length);
    const generationKwh = new Float64Array(labels.length);
    for (let i = 0; i < labels.length; i += 1) {
      generationKw[i] = (solarKw[i] || 0) + (windKw[i] || 0);
      solarKwh[i] = Math.max(0, (solarKw[i] || 0) * dtHours);
      windKwh[i] = Math.max(0, (windKw[i] || 0) * dtHours);
      generationKwh[i] = solarKwh[i] + windKwh[i];
    }
    return { labels, solarKwh, windKwh, generationKwh, generationKw, temps, dtHours };
  };

  const simulateAggregateSoc = (generationKw, temperatures, dtHours) => {
    const states = storageAssets
      .map((entry) => createStorageAsset(entry.model))
      .map((model) => {
        const capacityKwh = Math.max(0, toNumber(model.capacity_kwh, 0));
        if (capacityKwh <= 0) return null;
        return {
          capacityKwh,
          socMin: clamp01(toNumber(model.soc_min, 0.1)),
          soc: Math.max(clamp01(toNumber(model.soc_init, 0.2)), clamp01(toNumber(model.soc_min, 0.1))),
          chargeRateC: Math.max(0, toNumber(model.charge_rate_c, 0.5)),
          rte: clamp01(toNumber(model.round_trip_efficiency, 0.92)),
          tempRef: toNumber(model.temp_ref_c, 25),
          tempDerate: Math.max(0, toNumber(model.temp_charge_derate_per_c, 0.01)),
        };
      })
      .filter(Boolean);

    const socPct = new Float64Array(generationKw.length);
    if (!states.length) return socPct;

    for (let i = 0; i < generationKw.length; i += 1) {
      const temp = Number.isFinite(temperatures[i]) ? temperatures[i] : 25;
      const available = Math.max(0, toNumber(generationKw[i], 0));
      const allowances = states.map((state) => {
        const tempFactor = clamp(1 - state.tempDerate * Math.abs(temp - state.tempRef), 0, 1);
        const pCap = state.capacityKwh * state.chargeRateC * tempFactor;
        const etaCharge = Math.sqrt(state.rte);
        const roomKwh = Math.max(0, (1 - state.soc) * state.capacityKwh);
        const roomKw = etaCharge > 0 && dtHours > 0 ? roomKwh / (etaCharge * dtHours) : 0;
        return { state, etaCharge, allowKw: Math.max(0, Math.min(pCap, roomKw)) };
      });

      const totalAllowKw = allowances.reduce((sum, allowance) => sum + allowance.allowKw, 0);
      const chargeKw = Math.min(available, totalAllowKw);
      if (chargeKw > 0 && totalAllowKw > 0) {
        allowances.forEach(({ state, etaCharge, allowKw }) => {
          if (allowKw <= 0 || etaCharge <= 0) return;
          const allocatedKw = chargeKw * (allowKw / totalAllowKw);
          const deltaE = allocatedKw * etaCharge * dtHours;
          state.soc = clamp(state.soc + deltaE / state.capacityKwh, state.socMin, 1);
        });
      }

      const totalCapacity = states.reduce((sum, state) => sum + state.capacityKwh, 0);
      const totalEnergy = states.reduce((sum, state) => sum + state.soc * state.capacityKwh, 0);
      socPct[i] = totalCapacity > 0 ? (totalEnergy / totalCapacity) * 100 : 0;
    }
    return socPct;
  };

  const buildGridLines = (maxValue, width, height, tickCount = 4) => {
    const safeMax = Math.max(1, maxValue);
    const ticks = [];
    for (let i = 0; i <= tickCount; i += 1) {
      const value = (safeMax * i) / tickCount;
      const y = height - (value / safeMax) * height;
      ticks.push({ value, y });
    }
    const lines = ticks
      .map(
        ({ y }) =>
          `<line x1="0" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" stroke="rgba(110, 110, 110, 0.55)" stroke-width="1.2" />`
      )
      .join("");
    const labels = ticks
      .map(({ value, y }) => {
        const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1));
        return `<text x="${width - 8}" y="${Math.max(12, y - 4).toFixed(2)}" text-anchor="end" fill="#2d2d2d" font-size="12" font-weight="600">${rounded}</text>`;
      })
      .join("");
    return { lines, labels };
  };

  const areaPath = (values, baseline, yScale, width, height) => {
    const points = values.length;
    if (!points) return "";
    const stepX = points > 1 ? width / (points - 1) : width;
    let path = "";
    for (let i = 0; i < points; i += 1) {
      const x = i * stepX;
      const y = height - (Math.max(0, values[i]) + Math.max(0, baseline[i])) * yScale;
      path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    for (let i = points - 1; i >= 0; i -= 1) {
      const x = i * stepX;
      const y = height - Math.max(0, baseline[i]) * yScale;
      path += ` L ${x} ${y}`;
    }
    return `${path} Z`;
  };

  const linePath = (values, yScale, width, height, maxValue = null) => {
    const points = values.length;
    if (!points) return "";
    const stepX = points > 1 ? width / (points - 1) : width;
    let path = "";
    for (let i = 0; i < points; i += 1) {
      const x = i * stepX;
      const source = Math.max(0, values[i]);
      const clamped = maxValue == null ? source : Math.min(maxValue, source);
      const y = height - clamped * yScale;
      path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return path;
  };

  const renderAxis = (labels) => {
    if (!chartAxis) return;
    chartAxis.innerHTML = "";
    chartAxis.style.gridTemplateColumns = `repeat(${Math.max(labels.length, 1)}, minmax(0, 1fr))`;
    const skip = labels.length > 120 ? 24 : labels.length > 72 ? 12 : labels.length > 36 ? 6 : labels.length > 12 ? 3 : 1;
    labels.forEach((label, index) => {
      const span = document.createElement("span");
      span.textContent = index % skip === 0 ? label : "";
      chartAxis.appendChild(span);
    });
  };

  const renderDebug = () => {
    if (!debugOutput) return;
    const payload = {
      selectedDate: selectedDateKey,
      period: viewState.period,
      weatherStatus: {
        loading: weatherState.loading,
        loaded: weatherState.loaded,
        error: weatherState.error || null,
        timeZone: weatherState.timeZone,
      },
      assets: {
        solar: generationModels.solar.length,
        wind: generationModels.wind.length,
        storage: storageAssets.length,
      },
      sample: currentSeries
        ? {
            solarKwh: Array.from(currentSeries.solarKwh.slice(0, 8)).map((v) => Number(v.toFixed(3))),
            windKwh: Array.from(currentSeries.windKwh.slice(0, 8)).map((v) => Number(v.toFixed(3))),
            generationKwh: Array.from(currentSeries.generationKwh.slice(0, 8)).map((v) => Number(v.toFixed(3))),
            socPct: Array.from(currentSeries.socPct.slice(0, 8)).map((v) => Number(v.toFixed(3))),
          }
        : null,
    };
    debugOutput.textContent = JSON.stringify(payload, null, 2);
  };

  const getSeriesUnitLabel = (period) => (period === "month" || period === "year" ? "kWh/day" : "kWh");

  const renderChart = () => {
    if (!chartSvg) return;
    if (!storageChart && window.EnergyCharts) {
      storageChart = window.EnergyCharts.createStorageChart(chartSvg);
    }
    if (!storageChart) return;
    if (storageChartLoading) {
      storageChartLoading.hidden = !weatherState.loading;
    }

    if (weatherState.loading) {
      storageChart.update({ labels: [], solar: [], wind: [], total: [], soc: [] });
      renderAxis([]);
      renderDebug();
      return;
    }
    if (!weatherState.loaded) {
      storageChart.update({ labels: [], solar: [], wind: [], total: [], soc: [] });
      renderAxis([]);
      renderDebug();
      return;
    }

    const assetsRevision = buildAssetsRevision();
    const storageRevision = buildStorageRevision();
    if (currentProject?.id && sharedCache) {
      if (assetsRevision) {
        sharedCache.setRevision(currentProject.id, "assets", assetsRevision);
      }
      if (storageRevision) {
        sharedCache.setRevision(currentProject.id, "storage", storageRevision);
      }
    }
    const weatherRevision =
      weatherState.weatherRevision ||
      (sharedCache
        ? sharedCache.buildWeatherRevision({
            provider: currentProject?.weatherProvider || "nrel",
            timeZone: weatherState.timeZone,
            solar: weatherState.raw15.solar,
            wind: weatherState.raw15.wind,
          })
        : "");
    const storageSeriesCacheKey =
      currentProject?.id && sharedCache
        ? sharedCache.buildDerivedKey({
            kind: "storage",
            period: viewState.period,
            selectedDateKey,
            weatherRevision,
            assetsRevision,
            storageRevision,
          })
        : "";
    const cachedSeries =
      currentProject?.id && sharedCache && storageSeriesCacheKey
        ? sharedCache.getDerivedSeries(currentProject.id, "storage", storageSeriesCacheKey)
        : null;
    if (cachedSeries) {
      currentSeries = {
        labels: cachedSeries.labels || [],
        solarKwh: Float64Array.from(cachedSeries.solarKwh || []),
        windKwh: Float64Array.from(cachedSeries.windKwh || []),
        generationKwh: Float64Array.from(cachedSeries.generationKwh || []),
        generationKw: Float64Array.from(cachedSeries.generationKw || []),
        socPct: Float64Array.from(cachedSeries.socPct || []),
        temps: Float64Array.from(cachedSeries.temps || []),
      };
    } else {
      const generation = buildGenerationForPeriod();
      const socPct = simulateAggregateSoc(generation.generationKw, generation.temps, generation.dtHours);
      currentSeries = {
        labels: generation.labels,
        solarKwh: generation.solarKwh,
        windKwh: generation.windKwh,
        generationKwh: generation.generationKwh,
        generationKw: generation.generationKw,
        socPct,
        temps: generation.temps,
      };
      if (currentProject?.id && sharedCache && storageSeriesCacheKey) {
        sharedCache.setDerivedSeries(currentProject.id, "storage", storageSeriesCacheKey, {
          labels: currentSeries.labels,
          solarKwh: Array.from(currentSeries.solarKwh),
          windKwh: Array.from(currentSeries.windKwh),
          generationKwh: Array.from(currentSeries.generationKwh),
          generationKw: Array.from(currentSeries.generationKw),
          socPct: Array.from(currentSeries.socPct),
          temps: Array.from(currentSeries.temps),
        });
      }
    }
    if (currentProject?.id && sharedCache) {
      const generationCacheKey = sharedCache.buildDerivedKey({
        kind: "generation",
        period: viewState.period,
        selectedDateKey,
        weatherRevision,
        assetsRevision,
      });
      sharedCache.setDerivedSeries(currentProject.id, "generation", generationCacheKey, {
        labels: currentSeries.labels,
        solar: Array.from(currentSeries.solarKwh),
        wind: Array.from(currentSeries.windKwh),
        total: Array.from(currentSeries.generationKwh),
        unit: getSeriesUnitLabel(viewState.period),
        period: viewState.period,
      });
    }

    storageChart.update({
      labels: currentSeries.labels,
      solar: Array.from(currentSeries.solarKwh),
      wind: Array.from(currentSeries.windKwh),
      total: Array.from(currentSeries.generationKwh),
      soc: Array.from(currentSeries.socPct),
      visible: seriesVisibility,
    });

    renderAxis([]);
    renderDebug();
  };

  const scheduleRecompute = () => {
    if (recomputeRaf) cancelAnimationFrame(recomputeRaf);
    recomputeRaf = requestAnimationFrame(() => {
      recomputeRaf = 0;
      renderChart();
    });
  };

  const scheduleRecomputeDebounced = () => {
    if (recomputeDebounceTimer) {
      clearTimeout(recomputeDebounceTimer);
    }
    recomputeDebounceTimer = setTimeout(() => {
      recomputeDebounceTimer = null;
      scheduleRecompute();
    }, ASSET_EDIT_DEBOUNCE_MS);
  };

  const hideChartTooltip = () => {
    if (chartTooltip) chartTooltip.hidden = true;
  };

  const updateChartTooltip = (event) => {
    if (!chartFrame || !chartTooltip || !currentSeries || !currentSeries.labels.length) return;
    const rect = chartFrame.getBoundingClientRect();
    const relativeX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const index = Math.round((relativeX / Math.max(1, rect.width)) * (currentSeries.labels.length - 1));
    const label = formatChartIndicator(viewState.period, selectedDateKey, index) || currentSeries.labels[index] || "-";
    const solar = Number(currentSeries.solarKwh[index] || 0).toFixed(2);
    const wind = Number(currentSeries.windKwh[index] || 0).toFixed(2);
    const generation = Number(currentSeries.generationKwh[index] || 0).toFixed(2);
    const soc = Number(currentSeries.socPct[index] || 0).toFixed(2);
    const temp = Number(currentSeries.temps[index] || 0).toFixed(1);
    const rows = [];
    if (seriesVisibility.solar) rows.push(`<div>Solar: ${solar} kWh</div>`);
    if (seriesVisibility.wind) rows.push(`<div>Wind: ${wind} kWh</div>`);
    if (seriesVisibility.total) rows.push(`<div>Total: ${generation} kWh</div>`);
    if (seriesVisibility.soc) rows.push(`<div>SOC: ${soc}%</div>`);
    chartTooltip.innerHTML = `
      <div class="generation-tooltip__time">${formatTooltipLabelHtml(label)}</div>
      ${rows.join("") || `<div>Enable at least one layer.</div>`}
      <div>Temperature: ${temp} C</div>
    `;
    const maxLeft = rect.width - chartTooltip.offsetWidth - 8;
    const left = Math.max(8, Math.min(maxLeft, relativeX + 10));
    const maxTop = rect.height - chartTooltip.offsetHeight - 8;
    const top = Math.max(8, Math.min(maxTop, event.clientY - rect.top - chartTooltip.offsetHeight - 10));
    chartTooltip.style.left = `${left}px`;
    chartTooltip.style.top = `${top}px`;
    chartTooltip.hidden = false;
  };

  const showFieldTooltip = (anchor) => {
    if (!fieldTooltip) return;
    const text = anchor.dataset.tip || "";
    if (!text) return;
    fieldTooltip.textContent = text;
    const rect = anchor.getBoundingClientRect();
    fieldTooltip.style.left = `${Math.min(window.innerWidth - 280, rect.left + 12)}px`;
    fieldTooltip.style.top = `${Math.max(10, rect.bottom + 8)}px`;
    fieldTooltip.hidden = false;
  };

  const hideFieldTooltip = () => {
    if (fieldTooltip) fieldTooltip.hidden = true;
  };

  const wireFieldHelp = (card) => {
    card.querySelectorAll(".field-help").forEach((button) => {
      button.addEventListener("mouseenter", () => showFieldTooltip(button));
      button.addEventListener("mouseleave", hideFieldTooltip);
      button.addEventListener("focus", () => showFieldTooltip(button));
      button.addEventListener("blur", hideFieldTooltip);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (fieldTooltip?.hidden) showFieldTooltip(button);
        else hideFieldTooltip();
      });
    });
  };

  const populateStorageFields = (card, model) => {
    card.querySelectorAll("[data-storage-field]").forEach((field) => {
      const key = field.dataset.storageField;
      if (!key || model[key] == null) return;
      field.value = String(model[key]);
    });
  };

  const persistStorageAsset = async (entry) => {
    if (!currentProject) return;
    try {
      const saved = await withRetry(() =>
        supabaseService.upsertAsset({ id: entry.id, projectId: currentProject.id, type: "storage", model: entry.model })
      );
      entry.id = saved.id;
      entry.model = saved.model;
      persistStorageDraft();
    } catch (error) {
      persistStorageDraft();
    }
  };

  const applyStorageTypeDefaults = (entry, card) => {
    const type = entry.model.battery_type === "nmc" ? "nmc" : "lfp";
    const defaults = storageTypeDefaults[type] || {};
    ["charge_rate_c", "round_trip_efficiency", "temp_ref_c", "temp_charge_derate_per_c"].forEach((fieldName) => {
      if (defaults[fieldName] == null) return;
      entry.model[fieldName] = defaults[fieldName];
      const input = card.querySelector(`[data-storage-field="${fieldName}"]`);
      if (input) input.value = String(defaults[fieldName]);
    });
  };

  const addStorageCard = (restoredModel = null, restoredId = null, options = {}) => {
    if (!storageAssetTemplate || !storageAssetsList) return;
    const index = storageAssets.length + 1;
    const assetId = restoredId || `storage-${index}-${Date.now()}`;
    const model = createStorageAsset(restoredModel || { name: `Storage ${index}` });

    const fragment = storageAssetTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".asset-card");
    if (!card) return;
    card.dataset.assetId = assetId;
    populateStorageFields(card, model);
    const nameInput = card.querySelector(".asset-title-input");
    if (nameInput) nameInput.value = model.name;

    storageAssetsList.appendChild(card);
    const entry = { id: assetId, model, card };
    storageAssets.push(entry);
    persistStorageDraft();

    wireFieldHelp(card);
    card.querySelectorAll(".asset-section").forEach((section) => {
      const toggle = section.querySelector(".asset-section-toggle");
      if (!toggle) return;
      toggle.addEventListener("click", () => {
        const collapsed = section.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.textContent = collapsed ? "▸" : "▾";
      });
    });

    const deleteButton = card.querySelector(".asset-delete");
    if (deleteButton) {
      deleteButton.addEventListener("click", () => {
        pendingDeleteId = assetId;
        deleteStorageModal?.showModal();
      });
    }

    card.querySelectorAll("input, select").forEach((field) => {
      const handler = () => {
        const key = field.dataset.storageField;
        if (!key) return;
        if (field.type === "number") entry.model[key] = toNumber(field.value, entry.model[key]);
        else entry.model[key] = field.value;
        if (key === "battery_type") applyStorageTypeDefaults(entry, card);
        entry.model = createStorageAsset(entry.model);
        if (nameInput) nameInput.value = entry.model.name;
        persistStorageDraft();
        scheduleRecomputeDebounced();
        void persistStorageAsset(entry);
      };
      field.addEventListener("input", handler);
      field.addEventListener("change", handler);
    });

    scheduleRecompute();
    if (currentProject && options.persist !== false) void persistStorageAsset(entry);
  };

  const loadAssetsForProject = async () => {
    if (!currentProject) return;
    const savedAssets = await supabaseService.listAssets(currentProject.id);
    generationModels.solar = savedAssets
      .filter((asset) => asset.type === "solar")
      .map((asset) => createSolarAsset(asset.model || {}));
    generationModels.wind = savedAssets
      .filter((asset) => asset.type === "wind")
      .map((asset) => createWindAsset(asset.model || {}));
    const storedAssets = savedAssets.filter((asset) => asset.type === "storage");
    if (storedAssets.length > 0) {
      storedAssets.forEach((asset) => addStorageCard(asset.model, asset.id, { persist: false }));
      persistStorageDraft();
      return;
    }

    const draftAssets = loadStorageDraft();
    draftAssets.forEach((asset) => addStorageCard(asset.model, asset.id, { persist: false }));
    storageAssets.forEach((entry) => {
      void persistStorageAsset(entry);
    });
  };

  const initMiniMap = () => {
    if (!storageMap || !window.L) return;
    const map = L.map(storageMap, { zoomControl: false, attributionControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    const mapState = currentProject?.mapState || null;
    if (mapState?.bounds) {
      const bounds = [
        [mapState.bounds.south, mapState.bounds.west],
        [mapState.bounds.north, mapState.bounds.east],
      ];
      map.fitBounds(bounds, { padding: [10, 10] });
    } else if (mapState?.center && typeof mapState.zoom === "number") {
      map.setView([mapState.center.lat, mapState.center.lng], mapState.zoom);
    } else if (currentProject?.lat != null && currentProject?.lng != null) {
      map.setView([currentProject.lat, currentProject.lng], 10);
    } else {
      map.setView([39.742, -105.1786], 10);
    }
    if (mapState?.center) L.marker([mapState.center.lat, mapState.center.lng]).addTo(map);
    else if (currentProject?.lat != null && currentProject?.lng != null) L.marker([currentProject.lat, currentProject.lng]).addTo(map);
  };

  if (addStorageButton) addStorageButton.addEventListener("click", () => addStorageCard());

  if (deleteStorageModal) {
    deleteStorageModal.addEventListener("close", () => {
      pendingDeleteId = null;
    });
  }
  if (confirmDeleteStorage) {
    confirmDeleteStorage.addEventListener("click", (event) => {
      event.preventDefault();
      if (!pendingDeleteId) {
        deleteStorageModal?.close();
        return;
      }
      const index = storageAssets.findIndex((entry) => entry.id === pendingDeleteId);
      if (index >= 0) {
        const [entry] = storageAssets.splice(index, 1);
        entry.card.remove();
        persistStorageDraft();
        scheduleRecompute();
        void withRetry(() => supabaseService.deleteAsset(pendingDeleteId)).catch(() => {
          storageAssets.splice(index, 0, entry);
          storageAssetsList?.insertBefore(entry.card, storageAssetsList.children[index] || null);
          persistStorageDraft();
          scheduleRecompute();
        });
      }
      deleteStorageModal?.close();
    });
  }

  periodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      viewState.period = button.dataset.storagePeriod || "day";
      persistPeriod(viewState.period);
      periodButtons.forEach((node) => node.classList.toggle("is-active", node.dataset.storagePeriod === viewState.period));
      updateDateRangeReadout();
      scheduleRecompute();
    });
  });

  seriesToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const series = button.dataset.storageSeries;
      if (!series || !Object.prototype.hasOwnProperty.call(seriesVisibility, series)) return;
      seriesVisibility[series] = !seriesVisibility[series];
      button.classList.toggle("is-active", seriesVisibility[series]);
      hideChartTooltip();
      scheduleRecompute();
    });
  });

  if (datePickerButton && datePickerInput) {
    datePickerButton.addEventListener("click", () => {
      if (typeof datePickerInput.showPicker === "function") datePickerInput.showPicker();
      else datePickerInput.click();
    });
  }

  if (datePickerInput) {
    datePickerInput.addEventListener("change", async (event) => {
      const nextDateKey = event.target.value;
      if (!nextDateKey || !currentProject) return;
      selectedDateKey = nextDateKey;
      updateDateRangeReadout();
      try {
        currentProject = await withRetry(() => supabaseService.updateProject(currentProject.id, { selectedDate: selectedDateKey }));
      } catch (error) {}
      if (weatherState.loaded) {
        hydrateWeatherStore(weatherState.source.solar, weatherState.source.wind, weatherState.timeZone);
      }
      scheduleRecompute();
    });
  }

  const shiftSelectedDate = (direction) => {
    const baseDate = parseDateKey(selectedDateKey) || new Date();
    const shifted = new Date(baseDate);
    if (viewState.period === "day") shifted.setDate(shifted.getDate() + direction);
    else if (viewState.period === "week") shifted.setDate(shifted.getDate() + direction * 7);
    else if (viewState.period === "month") shifted.setMonth(shifted.getMonth() + direction);
    else shifted.setFullYear(shifted.getFullYear() + direction);

    selectedDateKey = formatDateKey(shifted);
    if (datePickerInput) datePickerInput.value = selectedDateKey;
    updateDateRangeReadout();

    if (currentProject) {
      void withRetry(() => supabaseService.updateProject(currentProject.id, { selectedDate: selectedDateKey }))
        .then((project) => {
          currentProject = project;
        })
        .catch(() => {});
    }

    if (weatherState.loaded) {
      hydrateWeatherStore(weatherState.source.solar, weatherState.source.wind, weatherState.timeZone);
    }
    scheduleRecompute();
  };

  if (storageShiftBackButton) {
    storageShiftBackButton.addEventListener("click", () => shiftSelectedDate(-1));
  }

  if (storageShiftForwardButton) {
    storageShiftForwardButton.addEventListener("click", () => shiftSelectedDate(1));
  }

  if (chartFrame) {
    chartFrame.addEventListener("mousemove", updateChartTooltip);
    chartFrame.addEventListener("mouseleave", hideChartTooltip);
  }

  const initProject = async () => {
    await supabaseService.migrateLegacyLocalData();
    if (!projectId || !isValidProjectId(projectId)) {
      window.location.href = "/";
      return;
    }

    currentProject = await withRetry(() => supabaseService.getProject(projectId));
    if (!currentProject) {
      window.location.href = "/";
      return;
    }

    selectedDateKey = currentProject.selectedDate || DEFAULT_DATE_KEY;
    viewState.period = loadPersistedPeriod(viewState.period);
    if (datePickerInput) datePickerInput.value = selectedDateKey;
    periodButtons.forEach((node) => node.classList.toggle("is-active", node.dataset.storagePeriod === viewState.period));
    updateDateRangeReadout();

    if (storageSettingsLink) storageSettingsLink.href = `/projects/location.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageAssetsLink) storageAssetsLink.href = `/projects/generation.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageAssetsHeaderLink) storageAssetsHeaderLink.href = `/projects/generation.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageBackToFacility) storageBackToFacility.href = `/projects/location.html?projectId=${encodeURIComponent(currentProject.id)}`;

    if (headerProjectNameInput) {
      headerProjectNameInput.value = currentProject.name || "Untitled Facility";
      headerProjectNameInput.addEventListener("input", (event) => {
        if (!currentProject) return;
        const nextName = event.target.value || "Untitled Facility";
        void withRetry(() => supabaseService.updateProject(currentProject.id, { name: nextName }))
          .then((project) => {
            currentProject = project;
            if (storageProjectName) storageProjectName.textContent = project.name || "Untitled Facility";
            if (storageFacilityName) storageFacilityName.textContent = project.name || "Untitled Facility";
          })
          .catch(() => {});
      });
    }

    if (storageProjectName) storageProjectName.textContent = currentProject.name || "Untitled Facility";
    if (storageFacilityName) storageFacilityName.textContent = currentProject.name || "Untitled Facility";
    if (storageFacilityLocation && currentProject.lat != null && currentProject.lng != null) {
      storageFacilityLocation.textContent = `${currentProject.lat.toFixed(4)}, ${currentProject.lng.toFixed(4)}`;
    }

    initMiniMap();
    await loadAssetsForProject();
    if (!restoreWeatherFromSharedCache()) {
      await fetchWeather();
    }
    scheduleRecompute();
  };

  void initProject();
})();
