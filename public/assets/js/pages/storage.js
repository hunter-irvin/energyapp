
(() => {
  const WEATHER_PROXY_ENDPOINT = "/api/weather-proxy";
  const DEFAULT_DATE_KEY = "2014-02-09";
  const NREL_CACHE_DATE_KEY = "all";
  const NREL_SOURCE_YEAR = 2014;
  const NREL_INTERVAL_MINUTES = 30;
  const NREL_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
  const OPEN_METEO_FULL_SYNC_SUFFIX = "openMeteoFullSync";
  const OPEN_METEO_FULL_SYNC_STALE_MS = 1000 * 60 * 5;
  const OPEN_METEO_FULL_SYNC_WAIT_MS = 6000;
  const OPEN_METEO_FULL_SYNC_WAIT_STEP_MS = 500;
  const ASSET_EDIT_DEBOUNCE_MS = 200;
  const POINTS_PER_DAY = (24 * 60) / NREL_INTERVAL_MINUTES;
  const STORAGE_DRAFT_SUFFIX = "storageAssetsDraft";
  const PERIOD_STORAGE_SUFFIX = "selectedPeriod";
  const PERIOD_OPTIONS = ["day", "week", "month", "year"];
  const INTERVAL_STORAGE_SUFFIX = "selectedInterval";
  const INTERVAL_OPTIONS = ["half_hour", "hourly", "daily"];
  const WEATHER_PROVIDERS = {
    nrel: "NREL",
    open_meteo: "Open-Meteo",
  };
  const WEATHER_CACHE_KEYS = ["energyapp.db.weatherCache", "energyapp.db.nrelCache"];
  const supabaseService = window.EnergySupabaseService;
  const sharedCache = window.EnergySharedCache || null;

  const headerProjectNameInput = document.getElementById("storage-header-project-name");
  const headerProjectNameDisplay = document.getElementById("storage-header-project-name-display");
  const headerProjectNameEditButton = document.getElementById("storage-header-project-name-edit");
  const headerProjectNameSaveButton = document.getElementById("storage-header-project-name-save");
  const headerProjectNameCancelButton = document.getElementById("storage-header-project-name-cancel");
  const storageSettingsLink = document.getElementById("storage-settings-link");
  const storageAssetsLink = document.getElementById("storage-assets-link");
  const storageRatesLink = document.getElementById("storage-rates-link");
  const storageAssetsHeaderLink = document.getElementById("storage-assets-header-link");
  const storageBackToFacility = document.getElementById("storage-back-to-facility");
  const storageProjectName = document.getElementById("storage-project-name");
  const storageFacilityName = document.getElementById("storage-facility-name");
  const storageFacilityLocation = document.getElementById("storage-facility-location");
  const storageMap = document.getElementById("storage-map");

  const addStorageButton = document.getElementById("add-storage");
  const storageAssetsList = document.getElementById("storage-assets");
  const deleteStorageModal = document.getElementById("delete-storage-modal");
  const confirmDeleteStorage = document.getElementById("confirm-delete-storage");

  const chartFrame = document.getElementById("storage-chart-frame");
  const storageChartRoot = document.getElementById("storage-chart-root");
  const storageChartLoading = document.getElementById("storage-chart-loading");
  const chartAxis = document.getElementById("storage-axis");
  const debugOutput = document.getElementById("storage-debug-output");

  const storageControlStripRoot = document.getElementById("storage-control-strip-root");
  const storageChartLegendRoot = document.getElementById("storage-chart-legend-root");
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
  let storageChartBridge = null;
  let storageControlStripBridge = null;
  let storageLegendBridge = null;
  let storageEditorsBridge = null;

  const viewState = { period: "day", interval: "hourly" };
  const seriesVisibility = {
    solar: true,
    wind: true,
    total: false,
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

  const STORAGE_FIELD_HELP = {
    capacity_kwh: {
      definition: "Total usable battery energy capacity used to convert SOC into stored energy.",
      tokens: ["E_CAP", "SOC", "P_CAP"],
    },
    battery_type: {
      definition:
        "Chemistry preset that selects default advanced parameters for charge-rate, efficiency, and temperature derate.",
      tokens: ["P_CAP", "ETA", "K_DERATE"],
    },
    soc_init: {
      definition: "Initial state-of-charge used at simulation start before interval updates.",
      tokens: ["SOC_INIT", "SOC_0"],
    },
    charge_rate_c: {
      definition: "Charge C-rate limit used to cap charging power as a function of capacity.",
      tokens: ["C_RATE", "P_CAP"],
    },
    round_trip_efficiency: {
      definition: "Round-trip efficiency that sets charge efficiency via eta = sqrt(round_trip_efficiency).",
      tokens: ["RTE", "ETA", "DELTA_E"],
    },
    temp_ref_c: {
      definition: "Reference temperature used by temperature derating in charge power calculations.",
      tokens: ["T_REF", "TEMP_FACTOR"],
    },
    temp_charge_derate_per_c: {
      definition: "Derate coefficient applied per degree away from reference temperature.",
      tokens: ["K_DERATE", "TEMP_FACTOR"],
    },
  };

  const setProjectNameDisplay = (name) => {
    const resolvedName = String(name || "Untitled Facility").trim() || "Untitled Facility";
    if (headerProjectNameDisplay) {
      headerProjectNameDisplay.textContent = resolvedName;
    }
    if (headerProjectNameInput) {
      headerProjectNameInput.value = resolvedName;
      headerProjectNameInput.size = Math.min(Math.max(resolvedName.length + 1, 8), 40);
    }
  };

  const setProjectNameEditorMode = (isEditing) => {
    if (headerProjectNameDisplay) {
      headerProjectNameDisplay.hidden = isEditing;
    }
    if (headerProjectNameEditButton) {
      headerProjectNameEditButton.hidden = isEditing;
    }
    if (headerProjectNameInput) {
      headerProjectNameInput.hidden = !isEditing;
    }
    if (headerProjectNameSaveButton) {
      headerProjectNameSaveButton.hidden = !isEditing;
    }
    if (headerProjectNameCancelButton) {
      headerProjectNameCancelButton.hidden = !isEditing;
    }
  };

  const saveProjectName = async () => {
    if (!currentProject || !headerProjectNameInput) {
      return;
    }
    const nextName = String(headerProjectNameInput.value || "").trim() || "Untitled Facility";
    try {
      currentProject = await withRetry(() => supabaseService.updateProject(currentProject.id, { name: nextName }));
      setProjectNameDisplay(currentProject.name);
      setProjectNameEditorMode(false);
      if (storageProjectName) storageProjectName.textContent = currentProject.name || "Untitled Facility";
      if (storageFacilityName) storageFacilityName.textContent = currentProject.name || "Untitled Facility";
    } catch (error) {}
  };

  const pad2 = (value) => String(value).padStart(2, "0");
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const clamp01 = (value) => clamp(value, 0, 1);
  const SOC_PERCENT_FIELDS = new Set(["soc_init"]);
  const STORAGE_EDITOR_SECTIONS = [
    {
      key: "basic",
      title: "Basic",
      collapsed: false,
      fields: [
        { key: "capacity_kwh", label: "Capacity (kWh)", type: "number", min: 0, step: 1 },
        {
          key: "battery_type",
          label: "Battery Type",
          type: "select",
          options: [
            { value: "lfp", label: "LFP" },
            { value: "nmc", label: "NMC" },
          ],
        },
        {
          key: "soc_init",
          label: "State of Charge Initial (%)",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          formatValue: (rawValue) => {
            const pct = clamp(toNumber(rawValue, 0) * 100, 0, 100);
            return String(Math.round(pct * 100) / 100);
          },
        },
      ],
    },
    {
      key: "advanced",
      title: "Advanced",
      muted: true,
      collapsed: true,
      fields: [
        { key: "charge_rate_c", label: "Charge Rate C", type: "number", min: 0, step: 0.01 },
        { key: "round_trip_efficiency", label: "Round Trip Eff (0-1)", type: "number", min: 0, max: 1, step: 0.01 },
        { key: "temp_ref_c", label: "Temp Ref (°C)", type: "number", step: 1 },
        { key: "temp_charge_derate_per_c", label: "Temp Derate (/°C)", type: "number", min: 0, step: 0.001 },
      ],
    },
  ];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isQuotaExceededError = (error) =>
    error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

  const getScopedStorageKey = (suffix) => {
    if (!currentProject?.id) return "";
    if (typeof supabaseService?.buildScopedUiStorageKey === "function") {
      return supabaseService.buildScopedUiStorageKey(currentProject.id, suffix);
    }
    return `energyapp.project.${currentProject.id}.${suffix}`;
  };

  const readOpenMeteoFullSyncMarker = () => {
    const key = getScopedStorageKey(OPEN_METEO_FULL_SYNC_SUFFIX);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const startedAt = Number(parsed?.startedAt || 0);
      if (!Number.isFinite(startedAt) || Date.now() - startedAt > OPEN_METEO_FULL_SYNC_STALE_MS) {
        localStorage.removeItem(key);
        return null;
      }
      return {
        provider: String(parsed?.provider || ""),
        startedAt,
      };
    } catch (error) {
      return null;
    }
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

  const loadPersistedInterval = (fallback = "hourly") => {
    const key = getScopedStorageKey(INTERVAL_STORAGE_SUFFIX);
    if (!key) return fallback;
    const stored = localStorage.getItem(key);
    return INTERVAL_OPTIONS.includes(stored) ? stored : fallback;
  };

  const persistInterval = (interval) => {
    if (!INTERVAL_OPTIONS.includes(interval)) return;
    const key = getScopedStorageKey(INTERVAL_STORAGE_SUFFIX);
    if (!key) return;
    localStorage.setItem(key, interval);
  };

  const getAllowedIntervalsForPeriod = (period) => {
    if (period === "day") return ["half_hour", "hourly"];
    if (period === "year") return ["daily"];
    if (period === "month") return ["hourly", "daily"];
    return ["half_hour", "hourly", "daily"];
  };

  const getIntervalButtonsForPeriod = () => getAllowedIntervalsForPeriod(viewState.period);

  const normalizeIntervalForPeriod = ({ persist = false } = {}) => {
    const allowed = getIntervalButtonsForPeriod();
    if (allowed.includes(viewState.interval)) return;
    viewState.interval = allowed.includes("hourly") ? "hourly" : allowed[0];
    if (persist) {
      persistInterval(viewState.interval);
    }
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
    const fetchMode = cleanText(cached?.metadata?.fetchMode || "");
    if (provider === "open_meteo") {
      const solarRows = Array.isArray(cached.raw15.solar) ? cached.raw15.solar.length : 0;
      const windRows = Array.isArray(cached.raw15.wind) ? cached.raw15.wind.length : 0;
      const looksWindowOnly = fetchMode === "window_minutely_15" || solarRows < POINTS_PER_DAY * 60 || windRows < POINTS_PER_DAY * 60;
      if (looksWindowOnly) return false;
    }
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
  const formatIndicatorDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;
  const formatIndicatorTime = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const readChartTheme = () => {
    const styles = window.getComputedStyle(document.documentElement);
    return {
      tick: styles.getPropertyValue("--color-text-muted").trim() || "#6d7982",
      title: styles.getPropertyValue("--color-text-secondary").trim() || "#d0d7dc",
      gridPrimary: styles.getPropertyValue("--chart-grid-primary").trim() || "rgba(120,120,120,0.2)",
      gridSecondary: styles.getPropertyValue("--chart-grid-secondary").trim() || "rgba(120,120,120,0.15)",
    };
  };
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
      return `${formatIndicatorTime(cursor)}\n${dayOfWeek} ${formatIndicatorDate(cursor)}`;
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

  const buildDisplayLabels = (labels, period, dateKey) => {
    if (period !== "week") {
      return labels;
    }
    return labels.map((label, index) => {
      if (Array.isArray(label)) {
        return label;
      }
      const formatted = formatChartIndicator("week", dateKey, index);
      return formatted ? formatted.split("\n") : label;
    });
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

  const resolveNowIndicator = (pointCount) => {
    if (!Number.isFinite(pointCount) || pointCount < 2) {
      return null;
    }
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startMs = new Date(start).getTime();
    let endMs = new Date(end).getTime();
    if (viewState.period === "day") {
      endMs = startMs + 24 * 60 * 60 * 1000;
    } else {
      endMs += 24 * 60 * 60 * 1000;
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return null;
    }
    const nowMs = Date.now();
    if (nowMs < startMs || nowMs > endMs) {
      return null;
    }
    return { ratio: (nowMs - startMs) / (endMs - startMs), width: 1 };
  };

  const getDateRangeReadout = () => {
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startText = formatShortDate(start);
    const endText = formatShortDate(end);
    return startText === endText ? startText : `${startText}-${endText}`;
  };

  const syncControlStrip = () => {
    if (!storageControlStripBridge) return;
    storageControlStripBridge.update(buildControlStripProps());
  };

  const syncLegend = () => {
    if (!storageLegendBridge) return;
    storageLegendBridge.update(buildLegendProps());
  };

  const buildControlStripProps = () => ({
    className: "toggle-group assets-toggle-group",
    groups: [
      {
        key: "period",
        buttons: [
          {
            key: "day",
            label: "Day",
            active: viewState.period === "day",
            onClick: () => {
              viewState.period = "day";
              persistPeriod(viewState.period);
              normalizeIntervalForPeriod({ persist: true });
              syncControlStrip();
              scheduleRecompute();
            },
          },
          {
            key: "week",
            label: "Week",
            active: viewState.period === "week",
            onClick: () => {
              viewState.period = "week";
              persistPeriod(viewState.period);
              normalizeIntervalForPeriod({ persist: true });
              syncControlStrip();
              scheduleRecompute();
            },
          },
          {
            key: "month",
            label: "Month",
            active: viewState.period === "month",
            onClick: () => {
              viewState.period = "month";
              persistPeriod(viewState.period);
              normalizeIntervalForPeriod({ persist: true });
              syncControlStrip();
              scheduleRecompute();
            },
          },
          {
            key: "year",
            label: "Year",
            active: viewState.period === "year",
            onClick: () => {
              viewState.period = "year";
              persistPeriod(viewState.period);
              normalizeIntervalForPeriod({ persist: true });
              syncControlStrip();
              scheduleRecompute();
            },
          },
        ],
      },
      {
        key: "interval",
        label: "Interval",
        labelClassName: "assets-label rates-control-label rates-control-label--inline",
        buttons: getIntervalButtonsForPeriod().map((intervalKey) => ({
          key: intervalKey,
          label: intervalKey === "half_hour" ? "30 Min" : intervalKey === "hourly" ? "Hourly" : "Daily",
          active: viewState.interval === intervalKey,
          onClick: () => {
            viewState.interval = intervalKey;
            persistInterval(viewState.interval);
            syncControlStrip();
            scheduleRecompute();
          },
        })),
      },
    ],
    rightGroupKeys: ["interval"],
    selectedDateKey,
    dateRangeText: getDateRangeReadout(),
    onDateChange: async (nextDateKey) => {
      if (!nextDateKey || !currentProject) return;
      selectedDateKey = nextDateKey;
      syncControlStrip();
      try {
        currentProject = await withRetry(() => supabaseService.updateProject(currentProject.id, { selectedDate: selectedDateKey }));
      } catch (error) {}
      if (weatherState.loaded) {
        hydrateWeatherStore(weatherState.source.solar, weatherState.source.wind, weatherState.timeZone);
      }
      scheduleRecompute();
    },
    onShift: (direction) => shiftSelectedDate(Number(direction) >= 0 ? 1 : -1),
  });

  const buildLegendProps = () => ({
    className: "chart-panel__legend",
    tagName: "p",
    items: [
      {
        key: "solar",
        label: "Solar",
        className: "legend--solar",
        active: Boolean(seriesVisibility.solar),
        onToggle: () => {
          seriesVisibility.solar = !seriesVisibility.solar;
          syncLegend();
          scheduleRecompute();
        },
      },
      {
        key: "wind",
        label: "Wind",
        className: "legend--wind",
        active: Boolean(seriesVisibility.wind),
        onToggle: () => {
          seriesVisibility.wind = !seriesVisibility.wind;
          syncLegend();
          scheduleRecompute();
        },
      },
      {
        key: "total",
        label: "Total",
        className: "legend--total",
        active: Boolean(seriesVisibility.total),
        onToggle: () => {
          seriesVisibility.total = !seriesVisibility.total;
          syncLegend();
          scheduleRecompute();
        },
      },
      {
        key: "soc",
        label: "SOC",
        className: "legend--soc",
        active: Boolean(seriesVisibility.soc),
        onToggle: () => {
          seriesVisibility.soc = !seriesVisibility.soc;
          syncLegend();
          scheduleRecompute();
        },
      },
    ],
  });

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

  const buildUrl = (base, params) => {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
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

  const TIMESTAMP_WITH_ZONE_RE = /(?:z|[+-]\d{2}:?\d{2})$/i;

  const getTimestampLike = (record) =>
    cleanText(
      record?.timestamp || record?.time || record?.datetime || record?.date_time || record?.local_time || record?.utc_time
    );

  const hasDiscreteDateParts = (record) =>
    [record?.year, record?.month, record?.day, record?.hour, record?.minute].every((value) =>
      Number.isFinite(Number(value))
    );

  const buildNormalizedTimestamp = (record) => {
    if (hasDiscreteDateParts(record)) {
      return `${record.year}-${pad2(record.month)}-${pad2(record.day)}T${pad2(record.hour)}:${pad2(record.minute)}:00`;
    }
    return getTimestampLike(record) || null;
  };

  const detectRecordTimeBasis = (records) => {
    if (!records.length) {
      return "unknown";
    }

    const sample = records.slice(0, 48);
    const hasTimestampValues = sample.some((record) => Boolean(getTimestampLike(record)));
    const hasZonedTimestamp = sample.some((record) => {
      const timestampLike = getTimestampLike(record);
      return timestampLike && TIMESTAMP_WITH_ZONE_RE.test(timestampLike);
    });

    if (hasZonedTimestamp) {
      return "absolute";
    }

    const hasDateParts = sample.some((record) => hasDiscreteDateParts(record));
    if (hasDateParts && !hasTimestampValues) {
      return "absolute";
    }

    if (hasDateParts) {
      return "local_wall_clock";
    }

    return "local_wall_clock";
  };

  const normalizeRecordsToTimeZone = (records, timeZone) => {
    if (!timeZone || timeZone === "UTC") {
      return records.map((record) => ({
        ...record,
        normalized_timestamp: record.normalized_timestamp || buildNormalizedTimestamp(record),
      }));
    }

    const formatter = getTimeZoneFormatter(timeZone);
    return records.map((record) => {
      let utcDate = null;
      const timestampLike = getTimestampLike(record);
      if (timestampLike) {
        const parsed = new Date(timestampLike);
        if (!Number.isNaN(parsed.getTime())) {
          utcDate = parsed;
        }
      }

      if (!utcDate && hasDiscreteDateParts(record)) {
        const year = Number(record.year);
        const month = Number(record.month);
        const day = Number(record.day);
        const hour = Number(record.hour ?? 0);
        const minute = Number(record.minute ?? 0);
        if ([year, month, day, hour, minute].every(Number.isFinite)) {
          utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
        }
      }

      if (!utcDate) {
        return {
          ...record,
          normalized_timestamp: record.normalized_timestamp || buildNormalizedTimestamp(record),
        };
      }

      const parts = formatter.formatToParts(utcDate).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
      const year = Number(parts.year);
      const month = Number(parts.month);
      const day = Number(parts.day);
      const hour = Number(parts.hour);
      const minute = Number(parts.minute);

      return {
        ...record,
        year,
        month,
        day,
        hour,
        minute,
        normalized_timestamp: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00`,
      };
    });
  };

  const alignRecordsForFacilityTimeZone = (records, timeZone) => {
    const timeBasis = detectRecordTimeBasis(records);
    if (timeBasis === "absolute") {
      return normalizeRecordsToTimeZone(records, timeZone);
    }
    return records.map((record) => ({
      ...record,
      normalized_timestamp: record.normalized_timestamp || buildNormalizedTimestamp(record),
    }));
  };

  const normalizeRecordYears = (records, targetYear) =>
    records.map((record) =>
      record.year && Number(record.year) !== Number(targetYear) ? { ...record, year: Number(targetYear) } : record
    );

  const hydrateWeatherStore = (solarPayload, windPayload, timeZone) => {
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const year = selectedDate.getFullYear();
    const normalizedSolar = normalizeRecordYears(solarPayload, year);
    const normalizedWind = normalizeRecordYears(windPayload, year);
    const shiftedSolar = alignRecordsForFacilityTimeZone(normalizedSolar, timeZone);
    const shiftedWind = alignRecordsForFacilityTimeZone(normalizedWind, timeZone);

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
    weatherState.hourly.solar = [];
    weatherState.hourly.wind = [];
    weatherState.daily.solar = [];
    weatherState.daily.wind = [];
  };

  const isFreshCache = (cacheRow) => {
    if (!cacheRow?.fetched_at) return false;
    const fetchedAt = new Date(cacheRow.fetched_at).getTime();
    return Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= NREL_CACHE_TTL_MS;
  };

  const getProviderLabel = (provider) => WEATHER_PROVIDERS[provider] || provider;

  const loadPersistedOrRemoteWeather = async ({ forceRefresh = false } = {}) => {
    const provider = currentProject?.weatherProvider || "nrel";
    const sourceYear = provider === "nrel" ? NREL_SOURCE_YEAR : null;
    const wkt = `POINT(${currentProject.lng} ${currentProject.lat})`;
    const cacheLookup = { sourceYear, intervalMinutes: NREL_INTERVAL_MINUTES };
    const [cachedSolar, cachedWind] = await Promise.all([
      supabaseService.getWeatherCache(currentProject.id, provider, "solar", NREL_CACHE_DATE_KEY, cacheLookup),
      supabaseService.getWeatherCache(currentProject.id, provider, "wind", NREL_CACHE_DATE_KEY, cacheLookup),
    ]);
    const openMeteoCacheLooksFull =
      provider !== "open_meteo" ||
      ((Array.isArray(cachedSolar?.payload) ? cachedSolar.payload.length : 0) >= POINTS_PER_DAY * 60 &&
        (Array.isArray(cachedWind?.payload) ? cachedWind.payload.length : 0) >= POINTS_PER_DAY * 60);

    if (
      !forceRefresh &&
      isFreshCache(cachedSolar) &&
      isFreshCache(cachedWind) &&
      cachedSolar?.payload &&
      cachedWind?.payload &&
      openMeteoCacheLooksFull
    ) {
      return {
        provider,
        rawSolarRecords: cachedSolar.payload,
        rawWindRecords: cachedWind.payload,
        timeZone:
          cachedSolar.timezone ||
          cachedWind.timezone ||
          (await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng })),
        metadata: {
          fetchMode: "cache",
          requestStartDate: null,
          requestEndDate: null,
        },
      };
    }

    const marker = !forceRefresh && provider === "open_meteo" ? readOpenMeteoFullSyncMarker() : null;
    if (marker?.provider === "open_meteo") {
      const waitUntil = Date.now() + OPEN_METEO_FULL_SYNC_WAIT_MS;
      while (Date.now() < waitUntil) {
        await sleep(OPEN_METEO_FULL_SYNC_WAIT_STEP_MS);
        const [queuedSolar, queuedWind] = await Promise.all([
          supabaseService.getWeatherCache(currentProject.id, provider, "solar", NREL_CACHE_DATE_KEY, cacheLookup),
          supabaseService.getWeatherCache(currentProject.id, provider, "wind", NREL_CACHE_DATE_KEY, cacheLookup),
        ]);
        const queuedOpenMeteoCacheLooksFull =
          provider !== "open_meteo" ||
          ((Array.isArray(queuedSolar?.payload) ? queuedSolar.payload.length : 0) >= POINTS_PER_DAY * 60 &&
            (Array.isArray(queuedWind?.payload) ? queuedWind.payload.length : 0) >= POINTS_PER_DAY * 60);
        if (
          isFreshCache(queuedSolar) &&
          isFreshCache(queuedWind) &&
          queuedSolar?.payload &&
          queuedWind?.payload &&
          queuedOpenMeteoCacheLooksFull
        ) {
          return {
            provider,
            rawSolarRecords: queuedSolar.payload,
            rawWindRecords: queuedWind.payload,
            timeZone:
              queuedSolar.timezone ||
              queuedWind.timezone ||
              (await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng })),
            metadata: {
              fetchMode: "cache_after_background_sync",
              requestStartDate: null,
              requestEndDate: null,
            },
          };
        }
      }
    }

    const weatherResponse = await fetch(
      buildUrl(WEATHER_PROXY_ENDPOINT, {
        provider,
        lat: String(currentProject.lat),
        lng: String(currentProject.lng),
        mode: "load_default",
      })
    );

    if (!weatherResponse.ok) {
      throw new Error(`Unable to load ${getProviderLabel(provider)} weather data for selected location.`);
    }

    const weatherPayload = await weatherResponse.json();
    const rawSolarRecords = weatherPayload?.solar || [];
    const rawWindRecords = weatherPayload?.wind || [];
    const timeZone = await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng });
    const fetchedAt = new Date().toISOString();

    try {
      await Promise.all([
        supabaseService.upsertWeatherCache({
          projectId: currentProject.id,
          provider,
          dataset: "solar",
          dateKey: NREL_CACHE_DATE_KEY,
          sourceYear,
          intervalMinutes: NREL_INTERVAL_MINUTES,
          wkt,
          timezone: timeZone,
          source: weatherPayload?.meta?.provider || provider,
          fetchedAt,
          payload: rawSolarRecords,
        }),
        supabaseService.upsertWeatherCache({
          projectId: currentProject.id,
          provider,
          dataset: "wind",
          dateKey: NREL_CACHE_DATE_KEY,
          sourceYear,
          intervalMinutes: NREL_INTERVAL_MINUTES,
          wkt,
          timezone: timeZone,
          source: weatherPayload?.meta?.provider || provider,
          fetchedAt,
          payload: rawWindRecords,
        }),
      ]);
    } catch (cacheError) {
      console.warn("[Storage] Weather cache write failed; continuing with fetched payload.", cacheError);
    }

    return {
      provider,
      rawSolarRecords,
      rawWindRecords,
      timeZone,
      metadata: weatherPayload?.meta || {
        fetchMode: "load_default",
        requestStartDate: null,
        requestEndDate: null,
      },
    };
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
      const { provider, rawSolarRecords, rawWindRecords, timeZone, metadata } = await withRetry(() =>
        loadPersistedOrRemoteWeather({ forceRefresh })
      );
      const [targetYear] = selectedDateKey.split("-");
      const normalizedSolarRecords =
        provider === "nrel" ? normalizeRecordYears(rawSolarRecords, targetYear) : rawSolarRecords;
      const normalizedWindRecords =
        provider === "nrel" ? normalizeRecordYears(rawWindRecords, targetYear) : rawWindRecords;
      weatherState.source.solar = rawSolarRecords;
      weatherState.source.wind = rawWindRecords;
      hydrateWeatherStore(normalizedSolarRecords, normalizedWindRecords, timeZone);
      if (currentProject?.id && sharedCache) {
        const weatherRevision = sharedCache.setParsedWeather(currentProject.id, {
          provider,
          timeZone: timeZone || "UTC",
          raw15: weatherState.raw15,
          windMetric: weatherState.windMetric,
          metadata: metadata || {},
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
    const useDailyAggregation = viewState.interval === "daily" || period === "year";
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

    const buildWeatherMaps = () => {
      const solarMap = new Map();
      weatherState.raw15.solar.forEach((record) => {
        if (record.year == null || record.month == null || record.day == null) {
          return;
        }
        const key = `${record.year}-${pad2(record.month)}-${pad2(record.day)}T${pad2(record.hour || 0)}:${pad2(
          record.minute || 0
        )}`;
        solarMap.set(key, {
          ghi: toNumber(record?.ghi, 0),
          dni: toNumber(record?.dni, 0),
          dhi: toNumber(record?.dhi, 0),
          air_temperature: toNumber(record?.air_temperature, 20),
        });
      });

      const windMap = new Map();
      weatherState.raw15.wind.forEach((record) => {
        if (record.year == null || record.month == null || record.day == null) {
          return;
        }
        const key = `${record.year}-${pad2(record.month)}-${pad2(record.day)}T${pad2(record.hour || 0)}:${pad2(
          record.minute || 0
        )}`;
        windMap.set(key, {
          [windSpeedMetric]: toNumber(record?.[windSpeedMetric], 0),
          ...(weatherState.windMetric.temperature
            ? { [weatherState.windMetric.temperature]: toNumber(record?.[weatherState.windMetric.temperature], NaN) }
            : {}),
        });
      });

      return { solarMap, windMap };
    };

    let labels = [];
    let solarSeries = [];
    let windSeries = [];
    let temps = [];
    let dtHours = NREL_INTERVAL_MINUTES / 60;
    const { solarMap, windMap } = buildWeatherMaps();

    if (!useDailyAggregation && period === "day") {
      for (let i = 0; i < POINTS_PER_DAY; i += 1) {
        const hour = Math.floor((i * NREL_INTERVAL_MINUTES) / 60);
        const minute = (i * NREL_INTERVAL_MINUTES) % 60;
        const key = `${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth() + 1)}-${pad2(
          selectedDate.getDate()
        )}T${pad2(hour)}:${pad2(minute)}`;
        const solarPoint = solarMap.get(key) || emptySolar;
        const windPoint = windMap.get(key) || emptyWind;
        labels.push(`${pad2(hour)}:${pad2(minute)}`);
        solarSeries.push(solarPoint);
        windSeries.push(windPoint);
        temps.push(pickTemp(solarPoint, windPoint));
      }
    } else if (!useDailyAggregation && period === "week") {
      const start = getWeekStart(selectedDate);
      const end = getWeekEnd(start);
      end.setHours(23, 60 - NREL_INTERVAL_MINUTES, 0, 0);
      for (let cursor = new Date(start); cursor <= end; cursor.setMinutes(cursor.getMinutes() + NREL_INTERVAL_MINUTES)) {
        const key = `${formatDateKey(cursor)}T${pad2(cursor.getHours())}:${pad2(cursor.getMinutes())}`;
        const solarPoint = solarMap.get(key) || emptySolar;
        const windPoint = windMap.get(key) || emptyWind;
        const dayOfWeek = cursor.toLocaleDateString("en-US", { weekday: "short" });
        labels.push([formatIndicatorTime(cursor), `${dayOfWeek} ${formatIndicatorDate(cursor)}`]);
        solarSeries.push(solarPoint);
        windSeries.push(windPoint);
        temps.push(pickTemp(solarPoint, windPoint));
      }
    } else if (!useDailyAggregation && period === "month") {
      const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
      const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
      end.setHours(23, 60 - NREL_INTERVAL_MINUTES, 0, 0);
      for (let cursor = new Date(start); cursor <= end; cursor.setMinutes(cursor.getMinutes() + NREL_INTERVAL_MINUTES)) {
        const key = `${formatDateKey(cursor)}T${pad2(cursor.getHours())}:${pad2(cursor.getMinutes())}`;
        const solarPoint = solarMap.get(key) || emptySolar;
        const windPoint = windMap.get(key) || emptyWind;
        labels.push([formatIndicatorTime(cursor), `${cursor.getMonth() + 1}/${cursor.getDate()}`]);
        solarSeries.push(solarPoint);
        windSeries.push(windPoint);
        temps.push(pickTemp(solarPoint, windPoint));
      }
    } else {
      const start =
        period === "day"
          ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
          : period === "week"
            ? getWeekStart(selectedDate)
            : period === "month"
              ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
              : new Date(selectedDate.getFullYear(), 0, 1);
      const end =
        period === "day"
          ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
          : period === "week"
            ? getWeekEnd(getWeekStart(selectedDate))
            : period === "month"
              ? new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)
              : new Date(selectedDate.getFullYear(), 11, 31);
      const daySolarKwh = [];
      const dayWindKwh = [];
      const dayTemps = [];
      for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const dateKey = formatDateKey(cursor);
        const daySolarSeries = [];
        const dayWindSeries = [];
        const dayTempSeries = [];
        for (let i = 0; i < POINTS_PER_DAY; i += 1) {
          const hour = Math.floor((i * NREL_INTERVAL_MINUTES) / 60);
          const minute = (i * NREL_INTERVAL_MINUTES) % 60;
          const key = `${dateKey}T${pad2(hour)}:${pad2(minute)}`;
          const solarPoint = solarMap.get(key) || emptySolar;
          const windPoint = windMap.get(key) || emptyWind;
          daySolarSeries.push(solarPoint);
          dayWindSeries.push(windPoint);
          dayTempSeries.push(pickTemp(solarPoint, windPoint));
        }
        const daySolarKw = window.EnergyGeneration?.sumSolarAssets
          ? window.EnergyGeneration.sumSolarAssets(generationModels.solar, daySolarSeries)
          : new Float64Array(POINTS_PER_DAY);
        const dayWindKw = window.EnergyGeneration?.sumWindAssets
          ? window.EnergyGeneration.sumWindAssets(generationModels.wind, dayWindSeries)
          : new Float64Array(POINTS_PER_DAY);
        const intervalHours = NREL_INTERVAL_MINUTES / 60;
        let solarKwh = 0;
        let windKwh = 0;
        for (let i = 0; i < POINTS_PER_DAY; i += 1) {
          solarKwh += Math.max(0, (daySolarKw[i] || 0) * intervalHours);
          windKwh += Math.max(0, (dayWindKw[i] || 0) * intervalHours);
        }
        labels.push(cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        daySolarKwh.push(solarKwh);
        dayWindKwh.push(windKwh);
        dayTemps.push(dayTempSeries.reduce((sum, value) => sum + value, 0) / Math.max(1, dayTempSeries.length));
      }
      dtHours = 24;
      const generationKwh = new Float64Array(labels.length);
      const generationKw = new Float64Array(labels.length);
      const solarKwh = new Float64Array(labels.length);
      const windKwh = new Float64Array(labels.length);
      const dailyTemps = new Float64Array(labels.length);
      for (let i = 0; i < labels.length; i += 1) {
        solarKwh[i] = daySolarKwh[i] || 0;
        windKwh[i] = dayWindKwh[i] || 0;
        generationKwh[i] = solarKwh[i] + windKwh[i];
        generationKw[i] = generationKwh[i] / dtHours;
        dailyTemps[i] = dayTemps[i] || 25;
      }
      return { labels, solarKwh, windKwh, generationKwh, generationKw, temps: dailyTemps, dtHours };
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
    const intervalSeries = { labels, solarKwh, windKwh, generationKwh, generationKw, temps, dtHours };
    return viewState.interval === "hourly"
      ? aggregateGenerationToHourly(intervalSeries)
      : intervalSeries;
  };

  const aggregateGenerationToHourly = (series) => {
    const labels = [];
    const solarKwh = [];
    const windKwh = [];
    const generationKwh = [];
    const generationKw = [];
    const temps = [];

    for (let index = 0; index < series.labels.length; index += 2) {
      const label = series.labels[index];
      const solarValue = (series.solarKwh[index] || 0) + (series.solarKwh[index + 1] || 0);
      const windValue = (series.windKwh[index] || 0) + (series.windKwh[index + 1] || 0);
      const totalValue = solarValue + windValue;
      const tempA = Number(series.temps[index]);
      const tempB = Number(series.temps[index + 1]);
      const tempCount = Number.isFinite(tempA) && Number.isFinite(tempB) ? 2 : Number.isFinite(tempA) || Number.isFinite(tempB) ? 1 : 0;
      const tempValue = tempCount === 2 ? (tempA + tempB) / 2 : Number.isFinite(tempA) ? tempA : Number.isFinite(tempB) ? tempB : 25;
      labels.push(label);
      solarKwh.push(solarValue);
      windKwh.push(windValue);
      generationKwh.push(totalValue);
      generationKw.push(totalValue);
      temps.push(tempValue);
    }

    return {
      labels,
      solarKwh: Float64Array.from(solarKwh),
      windKwh: Float64Array.from(windKwh),
      generationKwh: Float64Array.from(generationKwh),
      generationKw: Float64Array.from(generationKw),
      temps: Float64Array.from(temps),
      dtHours: 1,
    };
  };

  const simulateAggregateSoc = (generationKw, temperatures, dtHours) => {
    const states = storageAssets
      .map((entry) => createStorageAsset(entry.model))
      .map((model) => {
        const capacityKwh = Math.max(0, toNumber(model.capacity_kwh, 0));
        if (capacityKwh <= 0) return null;
        return {
          capacityKwh,
          soc: clamp01(toNumber(model.soc_init, 0.2)),
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
      const totalCapacityBefore = states.reduce((sum, state) => sum + state.capacityKwh, 0);
      const totalEnergyBefore = states.reduce((sum, state) => sum + state.soc * state.capacityKwh, 0);
      socPct[i] = totalCapacityBefore > 0 ? (totalEnergyBefore / totalCapacityBefore) * 100 : 0;

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
          state.soc = clamp(state.soc + deltaE / state.capacityKwh, 0, 1);
        });
      }
    }
    return socPct;
  };

  const buildGridLines = (maxValue, width, height, tickCount = 4) => {
    const palette = readChartTheme();
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
          `<line x1="0" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" stroke="${palette.gridPrimary}" stroke-width="1.2" />`
      )
      .join("");
    const labels = ticks
      .map(({ value, y }) => {
        const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1));
        return `<text x="${width - 8}" y="${Math.max(12, y - 4).toFixed(2)}" text-anchor="end" fill="${palette.title}" font-size="12" font-weight="600">${rounded}</text>`;
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
    const shouldShowTick =
      window.EnergyCharts?.shouldShowAxisTick ||
      ((nextLabels, index) => index % Math.max(1, Math.ceil((nextLabels?.length || 0) / 12)) === 0);
    const toLabelText = window.EnergyCharts?.toLabelText || ((label) => String(label ?? ""));
    labels.forEach((label, index) => {
      const span = document.createElement("span");
      span.textContent = shouldShowTick(labels, index) ? toLabelText(label) : "";
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

  const getSeriesUnitLabel = (period, interval) =>
    period === "year" || interval === "daily" ? "kWh/day" : "kWh";

  const ensureStorageChartBridge = () => {
    if (storageChartBridge || !storageChartRoot || !window.EnergyTimeSeriesChart?.createBridge) return;
    storageChartBridge = window.EnergyTimeSeriesChart.createBridge();
    storageChartBridge.mount(storageChartRoot, {
      type: "line",
      className: "generation-chart",
      ariaLabel: "State of charge chart",
      labels: [],
      datasets: [],
      minY: 0,
    });
  };

  const buildStorageChartProps = ({ labels = [], solar = [], wind = [], total = [], soc = [] } = {}) => {
    const palette = readChartTheme();
    return {
      type: "line",
      className: "generation-chart",
      ariaLabel: "State of charge chart",
      labels,
      nowIndicator: resolveNowIndicator(labels.length),
      scales: {
        x: {
          grid: { color: palette.gridSecondary },
          ticks: {
            color: palette.tick,
            autoSkip: false,
            maxRotation: 0,
            callback(value, index) {
              const nextLabels = this?.chart?.data?.labels || [];
              const shouldShow =
                window.EnergyCharts?.shouldShowAxisTick?.(nextLabels, index) ??
                (index % Math.max(1, Math.ceil((nextLabels?.length || 0) / 12)) === 0);
              if (!shouldShow) return "";
              return typeof this?.getLabelForValue === "function" ? this.getLabelForValue(value) : nextLabels[index] || "";
            },
          },
        },
        ySoc: {
          type: "linear",
          position: "left",
          min: 0,
          max: 110,
          title: { display: true, text: "State of Charge (%)", color: palette.title, font: { weight: "700" } },
          ticks: { color: palette.tick },
          grid: { drawOnChartArea: false },
        },
        yGen: {
          type: "linear",
          position: "right",
          stacked: true,
          min: 0,
          title: { display: true, text: "Generation (kWh)", color: palette.title, font: { weight: "700" } },
          ticks: { color: palette.tick },
          grid: { color: palette.gridPrimary },
        },
      },
      datasets: [
        {
          label: "Wind",
          data: wind,
          yAxisID: "yGen",
          borderColor: "rgba(31, 119, 180, 0.8)",
          backgroundColor: "rgba(31, 119, 180, 0.35)",
          fill: "origin",
          hidden: !seriesVisibility.wind,
        },
        {
          label: "Solar",
          data: solar,
          yAxisID: "yGen",
          borderColor: "rgba(249, 168, 37, 0.85)",
          backgroundColor: "rgba(249, 168, 37, 0.5)",
          fill: "-1",
          hidden: !seriesVisibility.solar,
        },
        {
          label: "Total",
          data: total,
          yAxisID: "yGen",
          borderColor: palette.title,
          backgroundColor: "transparent",
          fill: false,
          hidden: !seriesVisibility.total,
        },
        {
          label: "SOC",
          data: soc,
          yAxisID: "ySoc",
          borderColor: palette.title,
          backgroundColor: "transparent",
          borderDash: [6, 4],
          fill: false,
          order: 99,
          hidden: !seriesVisibility.soc,
        },
      ],
      minY: 0,
    };
  };

  const renderChart = () => {
    ensureStorageChartBridge();
    if (!storageChartBridge) return;
    if (chartFrame) {
      const nextState = weatherState.loading ? "loading" : weatherState.error ? "error" : weatherState.loaded ? "ready" : "idle";
      chartFrame.setAttribute("data-state", nextState);
      chartFrame.setAttribute("aria-busy", String(Boolean(weatherState.loading)));
    }
    if (storageChartLoading) {
      storageChartLoading.hidden = !weatherState.loading;
    }

    if (weatherState.loading) {
      storageChartBridge.update(buildStorageChartProps({ labels: [], solar: [], wind: [], total: [], soc: [] }));
      renderAxis([]);
      renderDebug();
      return;
    }
    if (!weatherState.loaded) {
      storageChartBridge.update(buildStorageChartProps({ labels: [], solar: [], wind: [], total: [], soc: [] }));
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
            interval: viewState.interval,
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
        interval: viewState.interval,
        selectedDateKey,
        weatherRevision,
        assetsRevision,
      });
      sharedCache.setDerivedSeries(currentProject.id, "generation", generationCacheKey, {
        labels: currentSeries.labels,
        solar: Array.from(currentSeries.solarKwh),
        wind: Array.from(currentSeries.windKwh),
        total: Array.from(currentSeries.generationKwh),
        unit: getSeriesUnitLabel(viewState.period, viewState.interval),
        period: viewState.period,
      });
    }

    const displayLabels = buildDisplayLabels(currentSeries.labels || [], viewState.period, selectedDateKey);
    currentSeries.labels = displayLabels;

    storageChartBridge.update(
      buildStorageChartProps({
        labels: displayLabels,
        solar: Array.from(currentSeries.solarKwh),
        wind: Array.from(currentSeries.windKwh),
        total: Array.from(currentSeries.generationKwh),
        soc: Array.from(currentSeries.socPct),
      })
    );

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

  const buildFormulaVariable = (token, highlightSet, label = token) => {
    const highlighted = highlightSet.has(token) ? " is-highlighted" : "";
    return `<span class="asset-help__var${highlighted}">${label}</span>`;
  };

  const buildStorageBasicFormula = (highlightSet) => {
    const v = (token, label = token) => buildFormulaVariable(token, highlightSet, label);
    return [
      `<span class="asset-field-tooltip__line">${v("P_CAP", "P")}<sub>cap</sub> = ${v("E_CAP", "E")}<sub>cap</sub> * ${v("C_RATE", "C")}<sub>rate</sub> * ${v("TEMP_FACTOR", "tempFactor")}</span>`,
      `<span class="asset-field-tooltip__line">${v("SOC_NEXT", "SOC")}<sub>next</sub> = clamp(${v("SOC")} + ${v("DELTA_E", "&Delta;E")} / ${v("E_CAP", "E")}<sub>cap</sub>, 0, 1)</span>`,
    ].join("");
  };

  const buildStorageAdvancedFormula = (highlightSet) => {
    const v = (token, label = token) => buildFormulaVariable(token, highlightSet, label);
    return [
      `<span class="asset-field-tooltip__line">${v("TEMP_FACTOR", "tempFactor")} = clamp(1 - ${v("K_DERATE", "k")}<sub>derate</sub> * |${v("T", "T")} - ${v("T_REF", "T")}<sub>ref</sub>|, 0, 1)</span>`,
      `<span class="asset-field-tooltip__line">${v("P_CAP", "P")}<sub>cap</sub> = ${v("E_CAP", "E")}<sub>cap</sub> * ${v("C_RATE", "C")}<sub>rate</sub> * ${v("TEMP_FACTOR", "tempFactor")}</span>`,
      `<span class="asset-field-tooltip__line">${v("ETA", "&eta;")} = sqrt(${v("RTE")}); ${v("DELTA_E", "&Delta;E")} = ${v("P_CHARGE", "P")}<sub>charge</sub> * ${v("ETA", "&eta;")} * ${v("DELTA_T", "&Delta;t")}</span>`,
      `<span class="asset-field-tooltip__line">${v("SOC_NEXT", "SOC")}<sub>next</sub> = clamp(${v("SOC")} + ${v("DELTA_E", "&Delta;E")} / ${v("E_CAP", "E")}<sub>cap</sub>, 0, 1)</span>`,
    ].join("");
  };

  const positionFieldTooltipAt = (clientX, clientY) => {
    if (!fieldTooltip) return;
    const tooltipRect = fieldTooltip.getBoundingClientRect();
    const offset = 16;
    let left = clientX + offset;
    let top = clientY + offset;

    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = clientX - tooltipRect.width - offset;
    }
    if (left < 8) {
      left = 8;
    }
    if (top < 8) {
      top = 8;
    }
    if (top + tooltipRect.height > window.innerHeight - 8) {
      top = window.innerHeight - tooltipRect.height - 8;
    }

    fieldTooltip.style.left = `${Math.round(left)}px`;
    fieldTooltip.style.top = `${Math.round(top)}px`;
  };

  const positionFieldTooltip = (anchor) => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    positionFieldTooltipAt(rect.right, rect.top + rect.height / 2);
  };

  const showFieldTooltip = (anchor, labelText, fieldKey, mouseEvent = null) => {
    if (!fieldTooltip) return;
    const help = STORAGE_FIELD_HELP[fieldKey];
    if (!help) {
      fieldTooltip.hidden = true;
      return;
    }
    const card = anchor?.closest?.(".asset-card");
    const advancedSection = card?.querySelector?.(".asset-section--advanced");
    const isAdvancedOpen = Boolean(advancedSection && !advancedSection.classList.contains("is-collapsed"));
    const highlightSet = new Set(help.tokens || []);
    const formulaHtml = isAdvancedOpen
      ? buildStorageAdvancedFormula(highlightSet)
      : buildStorageBasicFormula(highlightSet);

    fieldTooltip.innerHTML = `
      <p class="asset-field-tooltip__title">${labelText}</p>
      <p class="asset-field-tooltip__definition">${help.definition}</p>
      <p class="asset-field-tooltip__formula">${formulaHtml}</p>
    `;
    fieldTooltip.hidden = false;
    if (mouseEvent) {
      positionFieldTooltipAt(mouseEvent.clientX, mouseEvent.clientY);
    } else {
      positionFieldTooltip(anchor);
    }
  };

  const hideFieldTooltip = () => {
    if (fieldTooltip) {
      fieldTooltip.hidden = true;
    }
  };

  const persistStorageAsset = async (entry) => {
    if (!currentProject) return;
    try {
      const saved = await withRetry(() =>
        supabaseService.upsertAsset({ id: entry.id, projectId: currentProject.id, type: "storage", model: entry.model })
      );
      entry.id = saved.id;
      entry.model = saved.model;
      syncStorageAssetEditors();
      persistStorageDraft();
    } catch (error) {
      persistStorageDraft();
    }
  };

  const applyStorageTypeDefaults = (entry) => {
    const type = entry.model.battery_type === "nmc" ? "nmc" : "lfp";
    const defaults = storageTypeDefaults[type] || {};
    ["charge_rate_c", "round_trip_efficiency", "temp_ref_c", "temp_charge_derate_per_c"].forEach((fieldName) => {
      if (defaults[fieldName] == null) return;
      entry.model[fieldName] = defaults[fieldName];
    });
  };

  const syncStorageAssetEditors = () => {
    if (!storageEditorsBridge) return;
    storageEditorsBridge.update({
      entries: storageAssets.map((entry) => ({ id: entry.id, model: entry.model })),
    });
  };

  const showStorageEditorFieldHelp = (payload = {}) => {
    if (!payload.fieldKey || !payload.anchor) return;
    const syntheticMouseEvent =
      Number.isFinite(payload.clientX) && Number.isFinite(payload.clientY)
        ? { clientX: payload.clientX, clientY: payload.clientY }
        : null;
    showFieldTooltip(payload.anchor, payload.labelText || "Variable", payload.fieldKey, syntheticMouseEvent);
  };

  const moveStorageEditorFieldHelp = (payload = {}) => {
    if (!fieldTooltip || fieldTooltip.hidden) return;
    if (Number.isFinite(payload.clientX) && Number.isFinite(payload.clientY)) {
      positionFieldTooltipAt(payload.clientX, payload.clientY);
    }
  };

  const handleStorageFieldChange = (payload = {}) => {
    const entry = storageAssets.find((candidate) => candidate.id === payload.assetId);
    if (!entry || !payload.fieldKey) return;
    const key = payload.fieldKey;
    if (payload.inputType === "number") {
      if (SOC_PERCENT_FIELDS.has(key)) {
        const pct = clamp(toNumber(payload.value, toNumber(entry.model[key], 0) * 100), 0, 100);
        entry.model[key] = pct / 100;
      } else {
        entry.model[key] = toNumber(payload.value, entry.model[key]);
      }
    } else {
      entry.model[key] = payload.value;
    }
    if (key === "battery_type") applyStorageTypeDefaults(entry);
    entry.model = createStorageAsset(entry.model);
    syncStorageAssetEditors();
    persistStorageDraft();
    scheduleRecomputeDebounced();
    void persistStorageAsset(entry);
  };

  const bindStorageAssetEditors = () => {
    if (!storageAssetsList || storageEditorsBridge || !window.EnergyChartUI?.createAssetEditorsBridge) return;
    storageEditorsBridge = window.EnergyChartUI.createAssetEditorsBridge();
    storageEditorsBridge.mount(storageAssetsList, {
      assetType: "storage",
      dataPrefix: "storage",
      nameAriaLabel: "Storage asset name",
      deleteLabel: "Delete storage asset",
      sections: STORAGE_EDITOR_SECTIONS,
      entries: [],
      onDelete: (assetId) => {
        pendingDeleteId = assetId;
        deleteStorageModal?.showModal();
      },
      onFieldChange: handleStorageFieldChange,
      onFieldHelpShow: showStorageEditorFieldHelp,
      onFieldHelpHide: hideFieldTooltip,
      onFieldHelpMove: moveStorageEditorFieldHelp,
    });
    syncStorageAssetEditors();
  };

  const addStorageCard = (restoredModel = null, restoredId = null, options = {}) => {
    const index = storageAssets.length + 1;
    const assetId = restoredId || `storage-${index}-${Date.now()}`;
    const model = createStorageAsset(restoredModel || { name: `Storage ${index}` });

    const entry = { id: assetId, model };
    storageAssets.push(entry);
    syncStorageAssetEditors();
    persistStorageDraft();

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
  window.addEventListener("scroll", hideFieldTooltip, true);
  window.addEventListener("resize", hideFieldTooltip);

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
        syncStorageAssetEditors();
        persistStorageDraft();
        scheduleRecompute();
        void withRetry(() => supabaseService.deleteAsset(pendingDeleteId)).catch(() => {
          storageAssets.splice(index, 0, entry);
          syncStorageAssetEditors();
          persistStorageDraft();
          scheduleRecompute();
        });
      }
      deleteStorageModal?.close();
    });
  }

  const bindChartUi = () => {
    bindStorageAssetEditors();
    if (storageControlStripRoot && window.EnergyChartUI?.createTimeWindowControlsBridge) {
      storageControlStripBridge = window.EnergyChartUI.createTimeWindowControlsBridge();
      storageControlStripBridge.mount(storageControlStripRoot, buildControlStripProps());
    }
    if (storageChartLegendRoot && window.EnergyChartUI?.createLegendTogglesBridge) {
      storageLegendBridge = window.EnergyChartUI.createLegendTogglesBridge();
      storageLegendBridge.mount(storageChartLegendRoot, buildLegendProps());
    }
  };

  const shiftSelectedDate = (direction) => {
    const baseDate = parseDateKey(selectedDateKey) || new Date();
    const shifted = new Date(baseDate);
    if (viewState.period === "day") shifted.setDate(shifted.getDate() + direction);
    else if (viewState.period === "week") shifted.setDate(shifted.getDate() + direction * 7);
    else if (viewState.period === "month") shifted.setMonth(shifted.getMonth() + direction);
    else shifted.setFullYear(shifted.getFullYear() + direction);

    selectedDateKey = formatDateKey(shifted);
    syncControlStrip();

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
    viewState.interval = loadPersistedInterval(viewState.interval);
    normalizeIntervalForPeriod({ persist: true });

    if (storageSettingsLink) storageSettingsLink.href = `/projects/weather.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageAssetsLink) storageAssetsLink.href = `/projects/generation.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageRatesLink) storageRatesLink.href = `/projects/rates-v4.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageAssetsHeaderLink) storageAssetsHeaderLink.href = `/projects/generation.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (storageBackToFacility) storageBackToFacility.href = `/projects/weather.html?projectId=${encodeURIComponent(currentProject.id)}`;

    setProjectNameDisplay(currentProject.name);
    setProjectNameEditorMode(false);

    if (storageProjectName) storageProjectName.textContent = currentProject.name || "Untitled Facility";
    if (storageFacilityName) storageFacilityName.textContent = currentProject.name || "Untitled Facility";
    if (storageFacilityLocation && currentProject.lat != null && currentProject.lng != null) {
      storageFacilityLocation.textContent = `${currentProject.lat.toFixed(4)}, ${currentProject.lng.toFixed(4)}`;
    }

    bindChartUi();
    syncControlStrip();
    syncLegend();

    initMiniMap();
    await loadAssetsForProject();
    if (!restoreWeatherFromSharedCache()) {
      await fetchWeather();
    }
    scheduleRecompute();
  };

  if (headerProjectNameEditButton && headerProjectNameInput) {
    headerProjectNameEditButton.addEventListener("click", () => {
      setProjectNameEditorMode(true);
      headerProjectNameInput.focus();
      headerProjectNameInput.select();
    });
  }

  if (headerProjectNameSaveButton) {
    headerProjectNameSaveButton.addEventListener("click", () => {
      void saveProjectName();
    });
  }

  if (headerProjectNameCancelButton && headerProjectNameInput) {
    headerProjectNameCancelButton.addEventListener("click", () => {
      setProjectNameDisplay(currentProject?.name);
      setProjectNameEditorMode(false);
    });
  }

  if (headerProjectNameInput) {
    headerProjectNameInput.addEventListener("input", () => {
      const text = String(headerProjectNameInput.value || "");
      headerProjectNameInput.size = Math.min(Math.max(text.length + 1, 8), 40);
    });

    headerProjectNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveProjectName();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setProjectNameDisplay(currentProject?.name);
        setProjectNameEditorMode(false);
      }
    });
  }

  void initProject();
})();





