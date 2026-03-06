const mapButton = document.getElementById("select-map");
const locationValue = document.getElementById("location-value");
const utilityValue = document.getElementById("utility-value");
const loadingStatus = document.getElementById("loading-status");
const loadingText = document.getElementById("loading-text");
const successStatus = document.getElementById("success-status");
const errorStatus = document.getElementById("error-status");
const chartDate = document.getElementById("chart-date");
const weatherChartRoot = document.getElementById("weather-chart-root");
const chartAxis = document.getElementById("chart-axis");
const chartDisplay = document.getElementById("chart-display");
const settingsChartLoading = document.getElementById("settings-chart-loading");
const loadingStepBar = document.getElementById("loading-step-bar");
const loadingOverallBar = document.getElementById("loading-overall-bar");
const debugPanel = document.getElementById("debug-panel");
const debugOutput = document.getElementById("debug-output");
const weatherControlStripRoot = document.getElementById("weather-control-strip-root");
const weatherChartLegendRoot = document.getElementById("weather-chart-legend-root");
const nrelProviderButton = document.getElementById("provider-nrel");
const openMeteoProviderButton = document.getElementById("provider-open-meteo");

const dataStore = {
  raw15: { solar: [], wind: [] },
  hourly: { solar: [], wind: [] },
  daily: { solar: [], wind: [] },
};

const headerProjectNameInput = document.getElementById("header-project-name");
const headerProjectNameDisplay = document.getElementById("header-project-name-display");
const headerProjectNameEditButton = document.getElementById("header-project-name-edit");
const headerProjectNameSaveButton = document.getElementById("header-project-name-save");
const headerProjectNameCancelButton = document.getElementById("header-project-name-cancel");
const headerAssetsLink = document.getElementById("header-assets-link");
const headerStorageLink = document.getElementById("header-storage-link");
const headerRatesLink = document.getElementById("header-rates-link");
const supabaseService = window.EnergySupabaseService;
const sharedCache = window.EnergySharedCache || null;
const weatherCoverage = window.EnergyWeatherCoverage || null;
const weatherSyncBus = window.EnergyWeatherSyncBus || null;
const queryParams = new URLSearchParams(window.location.search);
const selectedProjectId = queryParams.get("projectId");
const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

const SOLAR_YEAR = "2014";
const WIND_YEAR = "2014";
const WEATHER_PROXY_ENDPOINT = "/api/weather-proxy";
const GEOCODE_REVERSE_ENDPOINT = "/api/location/reverse";
const V4_RATES_PROVIDER_ENDPOINT = "/api/v4/rates/provider";
const WEATHER_CACHE_DATE_KEY = "all";
const WEATHER_INTERVAL_MINUTES = 30;
const PERIOD_STORAGE_SUFFIX = "selectedPeriod";
const PERIOD_OPTIONS = ["day", "week", "month", "year"];
const INTERVAL_STORAGE_SUFFIX = "selectedInterval";
const INTERVAL_OPTIONS = ["half_hour", "hourly", "daily"];
const OPEN_METEO_FULL_SYNC_SUFFIX = "openMeteoFullSync";
const OPEN_METEO_COVERAGE_RUN_SUFFIX = "openMeteoCoverageRun";
const OPEN_METEO_EVENT_SOURCE = "weather_page";
const WEATHER_CACHE_SCHEMA = "weather_open_meteo_cache_v1";
const OPEN_METEO_EXPANSION_PLAN = [
  { tier: "tier_1m", monthsBack: 1 },
  { tier: "tier_3m", monthsBack: 3 },
];
const WEATHER_TELEMETRY_SUFFIX = "weatherTelemetry";
const OPEN_METEO_RUN_STALE_MS = 1000 * 60 * 30;
const WEATHER_PROVIDERS = {
  nrel: "NREL",
  open_meteo: "Open-Meteo",
};
const DEFAULT_DATE = new Date(2014, 1, 9);
const OPEN_METEO_SUPABASE_CACHE_ENABLED = false;
const getSessionToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};
let selectedDate = getSessionToday();
let currentProject = null;
const DEFAULT_WIND_SPEED_METRIC = "windspeed_100m";
const DEFAULT_WIND_DIR_METRIC = "winddirection_100m";
const FALLBACK_WIND_SPEED_METRIC = "windspeed_80m";
const FALLBACK_WIND_DIR_METRIC = "winddirection_80m";
let windMetricState = {
  speed: DEFAULT_WIND_SPEED_METRIC,
  direction: DEFAULT_WIND_DIR_METRIC,
};
let locationTimeZone = "UTC";
let activeProvider = "open_meteo";
const viewState = {
  period: "week",
  interval: "hourly",
};
const seriesVisibility = {
  solar: true,
  wind: true,
};
let currentSeries = null;
let weatherChartBridge = null;
let isProjectNameEditing = false;
let weatherControlStripBridge = null;
let weatherLegendBridge = null;
let activeOpenMeteoController = null;
let activeOpenMeteoRunId = "";
let activeOpenMeteoForegroundToken = 0;
let openMeteoTelemetry = {
  pageLoadStartedAt: Date.now(),
  firstChartRenderMs: null,
  cacheHits: 0,
  fallbackCount: 0,
  liveUpdateCount: 0,
  tierLatenciesMs: {},
};

let selectionMode = false;
let marker = null;
let hoverMarker = null;


const map = L.map("map", {
  zoomControl: false,
}).setView([39.742, -105.1786], 10);

const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
});

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles &copy; Esri",
  }
);

satelliteLayer.addTo(map);
L.control
  .layers(
    {
      Street: streetLayer,
      Satellite: satelliteLayer,
    },
    {},
    { position: "topright", collapsed: false }
  )
  .addTo(map);


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const getMapState = () => {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    center: { lat: center.lat, lng: center.lng },
    zoom: map.getZoom(),
    bounds: {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    },
  };
};

const persistMapState = async () => {
  if (!currentProject) {
    return;
  }
  const state = getMapState();
  currentProject = { ...currentProject, mapState: state };
  try {
    currentProject = await withRetry(() => supabaseService.updateProject(currentProject.id, { mapState: state }));
  } catch (error) {
    setStatus({ loading: false, error: "Could not save map position. Retrying may help." });
  }
};

const setProjectDate = (_project) => {
  selectedDate = getSessionToday();
  syncControlStrip();
};

const setProjectNameDisplay = (name) => {
  const resolvedName = String(name || "Untitled Facility").trim() || "Untitled Facility";
  if (headerProjectNameDisplay) {
    headerProjectNameDisplay.textContent = resolvedName;
  }
  if (headerProjectNameInput) {
    headerProjectNameInput.value = resolvedName;
    const nextSize = Math.min(Math.max(resolvedName.length + 1, 8), 40);
    headerProjectNameInput.size = nextSize;
  }
};

const setProjectNameEditorMode = (isEditing) => {
  isProjectNameEditing = isEditing;
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

const applyProjectToUi = (project) => {
  currentProject = project;
  activeProvider = project.weatherProvider || "open_meteo";
  setProviderButtons(activeProvider);
  supabaseService.setLastOpenedProjectId(project.id);
  setProjectNameDisplay(project.name);
  setProjectNameEditorMode(false);
  if (project.lat != null && project.lng != null) {
    locationValue.textContent = formatLocationText(project);
    if (!marker) {
      marker = L.marker([project.lat, project.lng], { draggable: true }).addTo(map);
      marker.on("dragend", (dragEvent) => {
        void updateLocation(dragEvent.target.getLatLng());
      });
    } else {
      marker.setLatLng([project.lat, project.lng]);
    }
  } else {
    locationValue.textContent = "No location selected";
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
  }
  if (utilityValue) {
    utilityValue.textContent = `Utility: ${project?.utilityName || "--"}`;
  }

  const mapState = project.mapState || null;
  if (mapState?.center && typeof mapState.zoom === "number") {
    map.setView([mapState.center.lat, mapState.center.lng], mapState.zoom);
  } else if (project.lat != null && project.lng != null) {
    map.setView([project.lat, project.lng], 10);
  }

  setProjectDate(project);
  updateMapButtonLabel();
  if (project.lat != null && project.lng != null && !project?.mapState?.city) {
    void refreshCityLabel({ lat: project.lat, lng: project.lng });
  }
};

const formatLocationText = (project) => {
  const city = project?.mapState?.city;
  if (city && String(city).trim()) {
    return city;
  }
  if (project?.lat != null && project?.lng != null) {
    return `${project.lat.toFixed(4)}, ${project.lng.toFixed(4)}`;
  }
  return "No location selected";
};

const fetchCityLabel = async ({ lat, lng }) => {
  const url = new URL(GEOCODE_REVERSE_ENDPOINT, window.location.origin);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("City lookup failed.");
  }
  const payload = await response.json();
  if (payload?.label) {
    return String(payload.label);
  }
  const address = payload?.address || {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    "";
  const state = address.state || address.region || "";
  const country = address.country_code ? String(address.country_code).toUpperCase() : "";
  return [city, state || country].filter(Boolean).join(", ").trim();
};

const refreshCityLabel = async ({ lat, lng }, { persist = true } = {}) => {
  if (!currentProject || lat == null || lng == null) {
    return;
  }
  locationValue.textContent = "Looking up city...";
  try {
    const cityLabel = await fetchCityLabel({ lat, lng });
    if (!cityLabel) {
      locationValue.textContent = formatLocationText(currentProject);
      return;
    }
    currentProject = {
      ...currentProject,
      mapState: {
        ...(currentProject.mapState || {}),
        city: cityLabel,
      },
    };
    locationValue.textContent = cityLabel;
    if (persist) {
      currentProject = await withRetry(() =>
        supabaseService.updateProject(currentProject.id, { mapState: currentProject.mapState })
      );
    }
  } catch (error) {
    locationValue.textContent = formatLocationText(currentProject);
  }
};

const updateLocation = async (latlng) => {
  if (!currentProject) {
    return false;
  }
  const prevLat = currentProject.lat;
  const prevLng = currentProject.lng;
  const { lat, lng } = latlng;
  locationValue.textContent = "Looking up city...";
  currentProject = { ...currentProject, lat, lng };
  try {
    currentProject = await withRetry(() =>
      supabaseService.updateProject(currentProject.id, {
        lat,
        lng,
        mapState: { ...getMapState(), city: null },
        utilityName: null,
        utilityCode: null,
        isoRegion: null,
        timezone: null,
      })
    );
    await refreshCityLabel({ lat, lng });
    await refreshUtilityMetadata({ lat, lng });
    const changed = prevLat == null || prevLng == null || prevLat !== lat || prevLng !== lng;
    if (changed) {
      clearLoadedWeatherData();
      setStatus({
        loading: false,
        success: "Weather location updated. Choose 2014 NREL Data or Last Year + 7 Day Forecast to load weather.",
      });
    }
    updateMapButtonLabel();
    return changed;
  } catch (error) {
    setStatus({ loading: false, error: "Unable to save location. Please retry." });
    return false;
  }
};

const refreshUtilityMetadata = async ({ lat, lng }) => {
  if (!currentProject || lat == null || lng == null) return;
  try {
    const url = buildUrl(V4_RATES_PROVIDER_ENDPOINT, { lat, lng });
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const payload = await response.json();
    const provider = payload?.provider || {};
    const utilityName = Object.prototype.hasOwnProperty.call(provider, "utilityName")
      ? provider.utilityName
      : currentProject.utilityName || null;
    const utilityCode = Object.prototype.hasOwnProperty.call(provider, "utilityCode")
      ? provider.utilityCode
      : currentProject.utilityCode || null;
    const isoRegion = provider.isoRegion || currentProject.isoRegion || null;
    const timezone = provider.timezone || currentProject.timezone || null;
    currentProject = await withRetry(() =>
      supabaseService.updateProject(currentProject.id, {
        utilityName,
        utilityCode,
        isoRegion,
        timezone,
      })
    );
    if (utilityValue) {
      utilityValue.textContent = `Utility: ${currentProject.utilityName || "--"}`;
    }
  } catch (error) {}
};

const setStatus = ({ loading = false, loadingMessage = "", success = "", error = "" }) => {
  loadingStatus.hidden = !loading;
  successStatus.hidden = !success;
  errorStatus.hidden = !error;
  if (chartDisplay) {
    const nextState = loading ? "loading" : error ? "error" : success ? "ready" : "idle";
    chartDisplay.setAttribute("data-state", nextState);
    chartDisplay.setAttribute("aria-busy", String(Boolean(loading)));
  }
  if (settingsChartLoading) {
    settingsChartLoading.hidden = !loading;
  }
  if (loading && loadingMessage) {
    loadingText.textContent = loadingMessage;
  }
  if (success) {
    successStatus.textContent = success;
  }
  if (error) {
    errorStatus.textContent = error;
  }
};

const setLoadingProgress = (stepPercent, overallPercent) => {
  if (loadingStepBar) {
    loadingStepBar.style.width = `${Math.min(Math.max(stepPercent, 0), 100)}%`;
  }
  if (loadingOverallBar) {
    loadingOverallBar.style.width = `${Math.min(Math.max(overallPercent, 0), 100)}%`;
  }
};

const runLoadingStep = async (stepIndex, totalSteps, label, action) => {
  const baseOverall = ((stepIndex - 1) / totalSteps) * 100;
  let stepProgress = 0;
  let magicTimer = null;
  let magicInterval = null;
  let showingMagic = false;

  const updateText = (message) => {
    if (loadingText) {
      loadingText.textContent = message;
    }
  };

  updateText(label);
  setLoadingProgress(0, baseOverall);

  magicTimer = setTimeout(() => {
    magicInterval = setInterval(() => {
      showingMagic = !showingMagic;
      updateText(showingMagic ? "Performing magic" : label);
    }, 2000);
  }, 2000);

  const progressTimer = setInterval(() => {
    stepProgress = Math.min(stepProgress + 6, 90);
    const overall = baseOverall + (stepProgress / 100) * (100 / totalSteps);
    setLoadingProgress(stepProgress, overall);
  }, 120);

  try {
    const result = await action();
    stepProgress = 100;
    setLoadingProgress(stepProgress, (stepIndex / totalSteps) * 100);
    updateText(label);
    return result;
  } finally {
    clearInterval(progressTimer);
    if (magicTimer) {
      clearTimeout(magicTimer);
    }
    if (magicInterval) {
      clearInterval(magicInterval);
    }
  }
};

const formatNumber = (value, fractionDigits = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(fractionDigits);
};

const formatDateLabel = (date) =>
  date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const pad2 = (value) => String(value).padStart(2, "0");
const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();

const formatDateKey = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const formatShortDate = (date) => {
  const yy = String(date.getFullYear()).slice(-2);
  return `${date.getMonth() + 1}/${date.getDate()}/${yy}`;
};

const formatIndicatorDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;
const formatIndicatorTime = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const formatTooltipLabelHtml = (text) => String(text || "").replace(/\n/g, "<br />");
const readChartTheme = () => {
  const styles = window.getComputedStyle(document.documentElement);
  return {
    tick: styles.getPropertyValue("--color-text-muted").trim() || "#6d7982",
    title: styles.getPropertyValue("--color-text-secondary").trim() || "#d0d7dc",
    gridPrimary: styles.getPropertyValue("--chart-grid-primary").trim() || "rgba(120,120,120,0.2)",
    gridSecondary: styles.getPropertyValue("--chart-grid-secondary").trim() || "rgba(120,120,120,0.15)",
  };
};

const formatChartIndicator = (period, date, index) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  if (period === "day") {
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    cursor.setMinutes(index * WEATHER_INTERVAL_MINUTES);
    return formatIndicatorTime(cursor);
  }

  if (period === "week") {
    const weekStart = getWeekStart(date);
    weekStart.setHours(0, 0, 0, 0);
    const cursor = new Date(weekStart);
    cursor.setHours(cursor.getHours() + index);
    const dayOfWeek = cursor.toLocaleDateString("en-US", { weekday: "short" });
    return `${formatIndicatorTime(cursor)}\n${dayOfWeek} ${formatIndicatorDate(cursor)}`;
  }

  if (period === "month") {
    const cursor = new Date(date.getFullYear(), date.getMonth(), 1 + index);
    return formatIndicatorDate(cursor);
  }

  if (period === "year") {
    const cursor = new Date(date.getFullYear(), 0, 1 + index);
    return formatIndicatorDate(cursor);
  }

  return "";
};

const chooseDateForProvider = (provider, currentDate) => {
  const current =
    currentDate instanceof Date && !Number.isNaN(currentDate.getTime())
      ? new Date(currentDate)
      : null;
  if (provider === "open_meteo") {
    if (current && current.getFullYear() !== 2014) {
      return current;
    }
    return getSessionToday();
  }
  const existingYear = current?.getFullYear?.();
  if (existingYear === 2014) {
    return current;
  }
  return new Date(DEFAULT_DATE);
};

const updateMapButtonLabel = () => {
  if (!mapButton) {
    return;
  }
  if (selectionMode) {
    mapButton.textContent = "Click on map";
    return;
  }
  mapButton.textContent =
    currentProject?.lat != null && currentProject?.lng != null ? "Change Location" : "Select on Map";
};

const clearLoadedWeatherData = () => {
  dataStore.raw15.solar = [];
  dataStore.raw15.wind = [];
  dataStore.hourly.solar = [];
  dataStore.hourly.wind = [];
  dataStore.daily.solar = [];
  dataStore.daily.wind = [];
  currentSeries = null;
  if (currentProject?.id && sharedCache) {
    sharedCache.clearWeather(currentProject.id);
  }
  setLoadingProgress(0, 0);
  updateView();
};

const recordDateKey = (record) =>
  `${record.year}-${pad2(record.month)}-${pad2(record.day)}`;

const buildRecordKey = (record) =>
  `${record.year}-${pad2(record.month)}-${pad2(record.day)}` +
  `-${pad2(record.hour ?? "00")}-${pad2(record.minute ?? "00")}`;

const mergeRecordsByTimestamp = (baseRecords = [], deltaRecords = []) => {
  const merged = new Map();
  baseRecords.forEach((record) => {
    merged.set(buildRecordKey(record), record);
  });
  deltaRecords.forEach((record) => {
    merged.set(buildRecordKey(record), record);
  });
  return Array.from(merged.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, record]) => record);
};

const resolveLatestRecordDate = (records = []) => {
  const latest = records.reduce((max, record) => {
    const year = Number(record?.year);
    const month = Number(record?.month);
    const day = Number(record?.day);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return max;
    }
    const next = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(next.getTime())) {
      return max;
    }
    return !max || next > max ? next : max;
  }, null);
  return latest;
};

const resolveDeltaSinceDate = (solarRecords = [], windRecords = []) => {
  const solarLatest = resolveLatestRecordDate(solarRecords);
  const windLatest = resolveLatestRecordDate(windRecords);
  const latest = !solarLatest
    ? windLatest
    : !windLatest
      ? solarLatest
      : solarLatest > windLatest
        ? solarLatest
        : windLatest;
  if (!latest) return null;
  const since = new Date(latest);
  // Keep a small overlap window to handle upstream revisions without gaps.
  since.setUTCDate(since.getUTCDate() - 2);
  return formatDateKey(new Date(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
};

const buildRecordKeyFromDate = (date) =>
  `${formatDateKey(date)}-${pad2(date.getHours())}-${pad2(date.getMinutes())}`;

const buildHourlyKeyFromDate = (date) =>
  `${formatDateKey(date)}T${pad2(date.getHours())}:00`;

const toTimestampDate = (timestamp) => new Date(timestamp);

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
  end.setHours(23, 59, 59, 999);
  return end;
};

const getScopedUiKey = (projectId, suffix) => {
  if (!projectId) {
    return "";
  }
  if (typeof supabaseService?.buildScopedUiStorageKey === "function") {
    return supabaseService.buildScopedUiStorageKey(projectId, suffix);
  }
  return `energyapp.project.${projectId}.${suffix}`;
};

const getOpenMeteoCoverageRunKey = (projectId) => getScopedUiKey(projectId, OPEN_METEO_COVERAGE_RUN_SUFFIX);

const readOpenMeteoCoverageRunState = (projectId) => {
  const key = getOpenMeteoCoverageRunKey(projectId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const updatedAtMs = Date.parse(String(parsed?.updatedAt || parsed?.startedAt || ""));
    if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > OPEN_METEO_RUN_STALE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
};

const writeOpenMeteoCoverageRunState = (projectId, nextState) => {
  const key = getOpenMeteoCoverageRunKey(projectId);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...(nextState || {}),
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {}
};

const clearOpenMeteoCoverageRunState = (projectId) => {
  const key = getOpenMeteoCoverageRunKey(projectId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (error) {}
};

const broadcastOpenMeteoSyncEvent = (type, payload = {}) => {
  try {
    weatherSyncBus?.broadcast?.(type, {
      source: OPEN_METEO_EVENT_SOURCE,
      ...payload,
    });
  } catch (error) {}
};

const buildOpenMeteoRunId = () => `open_meteo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const beginOpenMeteoRun = ({ projectId }) => {
  if (activeOpenMeteoController) {
    try {
      activeOpenMeteoController.abort();
    } catch (error) {}
  }
  const controller = new AbortController();
  const runId = buildOpenMeteoRunId();
  activeOpenMeteoController = controller;
  activeOpenMeteoRunId = runId;
  writeOpenMeteoCoverageRunState(projectId, {
    runId,
    status: "active",
    pendingTiers: ["tier_1m", "tier_3m"],
    completedTiers: [],
  });
  return { runId, controller };
};

const isOpenMeteoRunCurrent = (runId) => String(runId || "") === String(activeOpenMeteoRunId || "");
const setOpenMeteoFullSyncMarker = (projectId, provider) => {
  const key = getScopedUiKey(projectId, OPEN_METEO_FULL_SYNC_SUFFIX);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        provider: String(provider || ""),
        startedAt: Date.now(),
      })
    );
  } catch (error) {}
};

const clearOpenMeteoFullSyncMarker = (projectId) => {
  const key = getScopedUiKey(projectId, OPEN_METEO_FULL_SYNC_SUFFIX);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (error) {}
};

const loadPersistedPeriod = (projectId, fallback = "week") => {
  const key = getScopedUiKey(projectId, PERIOD_STORAGE_SUFFIX);
  if (!key) {
    return fallback;
  }
  const stored = localStorage.getItem(key);
  return PERIOD_OPTIONS.includes(stored) ? stored : fallback;
};

const persistPeriod = (projectId, period) => {
  if (!PERIOD_OPTIONS.includes(period)) {
    return;
  }
  const key = getScopedUiKey(projectId, PERIOD_STORAGE_SUFFIX);
  if (!key) {
    return;
  }
  localStorage.setItem(key, period);
};

const loadPersistedInterval = (projectId, fallback = "hourly") => {
  const key = getScopedUiKey(projectId, INTERVAL_STORAGE_SUFFIX);
  if (!key) {
    return fallback;
  }
  const stored = localStorage.getItem(key);
  return INTERVAL_OPTIONS.includes(stored) ? stored : fallback;
};

const persistInterval = (projectId, interval) => {
  if (!INTERVAL_OPTIONS.includes(interval)) {
    return;
  }
  const key = getScopedUiKey(projectId, INTERVAL_STORAGE_SUFFIX);
  if (!key) {
    return;
  }
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
    persistInterval(currentProject?.id, viewState.interval);
  }
};

const getDateRangeForPeriod = (period, date) => {
  const start = new Date(date);
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
  const range = getDateRangeForPeriod(viewState.period, selectedDate);
  if (!range?.start || !range?.end) {
    return null;
  }
  const startMs = new Date(range.start).getTime();
  let endMs = new Date(range.end).getTime();
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

const getWeatherDateRangeReadout = () => {
  const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
  const startText = formatShortDate(start);
  const endText = formatShortDate(end);
  return startText === endText ? startText : `${startText}-${endText}`;
};

const syncControlStrip = () => {
  if (!weatherControlStripBridge) {
    return;
  }
  weatherControlStripBridge.update(buildControlStripProps());
};

const syncLegend = () => {
  if (!weatherLegendBridge) {
    return;
  }
  weatherLegendBridge.update(buildLegendProps());
};

const buildControlStripProps = () => ({
  className: "toggle-group",
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
            persistPeriod(currentProject?.id, viewState.period);
            normalizeIntervalForPeriod({ persist: true });
            syncControlStrip();
            updateView();
            syncOpenMeteoWindowForCurrentView();
          },
        },
        {
          key: "week",
          label: "Week",
          active: viewState.period === "week",
          onClick: () => {
            viewState.period = "week";
            persistPeriod(currentProject?.id, viewState.period);
            normalizeIntervalForPeriod({ persist: true });
            syncControlStrip();
            updateView();
            syncOpenMeteoWindowForCurrentView();
          },
        },
        {
          key: "month",
          label: "Month",
          active: viewState.period === "month",
          onClick: () => {
            viewState.period = "month";
            persistPeriod(currentProject?.id, viewState.period);
            normalizeIntervalForPeriod({ persist: true });
            syncControlStrip();
            updateView();
            syncOpenMeteoWindowForCurrentView();
          },
        },
        {
          key: "year",
          label: "Year",
          active: viewState.period === "year",
          onClick: () => {
            viewState.period = "year";
            persistPeriod(currentProject?.id, viewState.period);
            normalizeIntervalForPeriod({ persist: true });
            syncControlStrip();
            updateView();
            syncOpenMeteoWindowForCurrentView();
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
          persistInterval(currentProject?.id, viewState.interval);
          syncControlStrip();
          updateView();
        },
      })),
    },
  ],
  rightGroupKeys: ["interval"],
  selectedDateKey: formatDateKey(selectedDate),
  dateRangeText: getWeatherDateRangeReadout(),
  onDateChange: async (nextDateKey) => {
    const nextDate = new Date(nextDateKey);
    if (Number.isNaN(nextDate.getTime())) {
      return;
    }
    selectedDate = nextDate;
    syncControlStrip();
    if (currentProject) {
      try {
        currentProject = await withRetry(() =>
          supabaseService.updateProject(currentProject.id, { selectedDate: formatDateKey(selectedDate) })
        );
      } catch (error) {
        setStatus({ loading: false, error: "Unable to save date selection. Please retry." });
      }
    }
    updateView();
    syncOpenMeteoWindowForCurrentView();
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
        updateView();
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
        updateView();
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
  if (!cleaned) {
    return cleaned;
  }
  if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("20")) {
    return "windspeed_20m";
  }
  if (cleaned.includes("wind") && cleaned.includes("direction") && cleaned.includes("20")) {
    return "winddirection_20m";
  }
  if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("100")) {
    return "windspeed_100m";
  }
  if (cleaned.includes("wind") && cleaned.includes("direction") && cleaned.includes("100")) {
    return "winddirection_100m";
  }
  if (cleaned.includes("air") && cleaned.includes("temperature")) {
    return "air_temperature";
  }
  if (cleaned === "dni") {
    return "dni";
  }
  if (cleaned === "dhi") {
    return "dhi";
  }
  if (cleaned === "ghi") {
    return "ghi";
  }
  if (cleaned === "year" || cleaned === "month" || cleaned === "day") {
    return cleaned;
  }
  if (cleaned === "hour" || cleaned === "minute") {
    return cleaned;
  }
  return cleaned;
};

const parseCsv = (csvText) => {
  const lines = csvText.split(/\r?\n/).map((line) => cleanText(line)).filter(Boolean);
  const headerIndex = lines.findIndex((line) =>
    cleanText(line).toLowerCase().startsWith("year,month")
  );
  if (headerIndex === -1) {
    return [];
  }
  const headers = lines[headerIndex].split(",").map((header) => normalizeHeader(header));
  return lines.slice(headerIndex + 1).map((line) => {
    const values = line.split(",");
    return headers.reduce((acc, header, index) => {
      if (!header) {
        return acc;
      }
      acc[header] = cleanText(values[index]);
      return acc;
    }, {});
  });
};

const resolveWindMetrics = (records) => {
  const sample = records[0] || {};
  const keys = new Set(Object.keys(sample));
  const has20 = keys.has(DEFAULT_WIND_SPEED_METRIC) && keys.has(DEFAULT_WIND_DIR_METRIC);
  if (has20) {
    return { speed: DEFAULT_WIND_SPEED_METRIC, direction: DEFAULT_WIND_DIR_METRIC };
  }
  const has100 = keys.has(FALLBACK_WIND_SPEED_METRIC) && keys.has(FALLBACK_WIND_DIR_METRIC);
  if (has100) {
    return { speed: FALLBACK_WIND_SPEED_METRIC, direction: FALLBACK_WIND_DIR_METRIC };
  }
  return { speed: DEFAULT_WIND_SPEED_METRIC, direction: DEFAULT_WIND_DIR_METRIC };
};

const summarizeMetrics = (records, metrics) =>
  metrics.reduce((summary, metric) => {
    const numericCount = records.reduce((count, record) => {
      const value = Number(record[metric]);
      return Number.isFinite(value) ? count + 1 : count;
    }, 0);
    summary[metric] = { numeric: numericCount, total: records.length };
    return summary;
  }, {});

const renderDebugOutput = (payload) => {
  if (!debugOutput || !debugPanel) {
    return;
  }
  debugPanel.hidden = false;
  debugOutput.textContent = JSON.stringify(payload, null, 2);
};

const fetchTimeZone = async ({ lat, lng }) => {
  const url = new URL("https://timeapi.io/api/TimeZone/coordinate");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lng);
  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return "UTC";
    }
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
    hour12: false,
  });

const shiftRecordsToTimeZone = (records, timeZone) => {
  if (!timeZone || timeZone === "UTC") {
    return records;
  }
  const formatter = getTimeZoneFormatter(timeZone);
  return records.map((record) => {
    const year = Number(record.year);
    const month = Number(record.month);
    const day = Number(record.day);
    const hour = Number(record.hour || 0);
    const minute = Number(record.minute || 0);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      !Number.isFinite(hour) ||
      !Number.isFinite(minute)
    ) {
      return record;
    }
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const parts = formatter.formatToParts(utcDate);
    const byType = parts.reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return {
      ...record,
      year: byType.year,
      month: String(Number(byType.month)),
      day: String(Number(byType.day)),
      hour: String(Number(byType.hour)),
      minute: String(Number(byType.minute)),
    };
  });
};

const normalizeRecordYears = (records, targetYear) =>
  records.map((record) =>
    record.year && record.year !== targetYear ? { ...record, year: targetYear } : record
  );

const findSolarSample = (records) =>
  records.find(
    (record) =>
      Number(record.hour) === 12 &&
      Number(record.minute) === 0 &&
      Number(record.ghi) > 0
  ) ||
  records.find((record) => Number(record.hour) === 12 && Number(record.minute) === 0) ||
  records.find((record) => record.ghi) ||
  records[0] ||
  null;

const findWindSample = (records) =>
  records.find(
    (record) =>
      Number(record.hour) === 12 &&
      Number(record.minute) === 0 &&
      Number(record[DEFAULT_WIND_SPEED_METRIC] ?? record[FALLBACK_WIND_SPEED_METRIC]) > 0
  ) ||
  records.find((record) => Number(record.hour) === 12 && Number(record.minute) === 0) ||
  records.find((record) => Number(record[DEFAULT_WIND_SPEED_METRIC] ?? record[FALLBACK_WIND_SPEED_METRIC]) > 0) ||
  records[0] ||
  null;

const buildHourlyAggregation = (records, metrics) => {
  const buckets = new Map();
  records.forEach((record) => {
    const hourKey = `${record.year}-${pad2(record.month)}-${pad2(record.day)}T${pad2(
      record.hour
    )}:00`;
    if (!buckets.has(hourKey)) {
      buckets.set(hourKey, { timestamp: hourKey, sums: {}, counts: {} });
    }
    const bucket = buckets.get(hourKey);
    metrics.forEach((metric) => {
      const value = Number(record[metric]);
      if (!Number.isFinite(value)) {
        return;
      }
      bucket.sums[metric] = (bucket.sums[metric] || 0) + value;
      bucket.counts[metric] = (bucket.counts[metric] || 0) + 1;
    });
  });
  return Array.from(buckets.values()).map((bucket) => {
    const hourly = { timestamp: bucket.timestamp };
    metrics.forEach((metric) => {
      const count = bucket.counts[metric] || 0;
      hourly[metric] = count ? bucket.sums[metric] / count : null;
    });
    return hourly;
  });
};

const toDailyAggregation = (records, metrics) => {
  const buckets = new Map();
  records.forEach((record) => {
    const dateKey = `${record.year}-${pad2(record.month)}-${pad2(record.day)}`;
    if (!buckets.has(dateKey)) {
      buckets.set(dateKey, { date: dateKey, sums: {}, counts: {} });
    }
    const bucket = buckets.get(dateKey);
    metrics.forEach((metric) => {
      const value = Number(record[metric]);
      if (!Number.isFinite(value)) {
        return;
      }
      bucket.sums[metric] = (bucket.sums[metric] || 0) + value;
      bucket.counts[metric] = (bucket.counts[metric] || 0) + 1;
    });
  });
  return Array.from(buckets.values()).map((bucket) => {
    const daily = { date: bucket.date };
    metrics.forEach((metric) => {
      const count = bucket.counts[metric] || 0;
      daily[metric] = count ? bucket.sums[metric] / count : null;
    });
    return daily;
  });
};

const toSeriesValue = (value, { round = false } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return round ? Math.round(numeric) : numeric;
};

const buildSeries = (solarRecords, windRecords, period, date, interval = "hourly") => {
  const windSpeedMetric = windMetricState.speed;
  const windDirMetric = windMetricState.direction;
  const useDailyAggregation = interval === "daily" || period === "year";

  if (!useDailyAggregation && period === "day" && interval === "half_hour") {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 60 - WEATHER_INTERVAL_MINUTES, 0, 0);
    const solarMap = new Map(solarRecords.map((record) => [buildRecordKey(record), record]));
    const windMap = new Map(windRecords.map((record) => [buildRecordKey(record), record]));
    const labels = [];
    const solar = [];
    const wind = [];
    const windDirection = [];
    for (
      let cursor = new Date(start);
      cursor <= end;
      cursor.setMinutes(cursor.getMinutes() + WEATHER_INTERVAL_MINUTES)
    ) {
      const key = buildRecordKeyFromDate(cursor);
      const solarRecord = solarMap.get(key);
      const windRecord = windMap.get(key);
      labels.push(`${pad2(cursor.getHours())}:${pad2(cursor.getMinutes())}`);
      solar.push(toSeriesValue(solarRecord?.ghi));
      wind.push(toSeriesValue(windRecord?.[windSpeedMetric]));
      windDirection.push(toSeriesValue(windRecord?.[windDirMetric]));
    }
    return { labels, solar, wind, windDirection };
  }

  if (!useDailyAggregation && period === "day") {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 0, 0, 0);
    const solarMap = new Map(dataStore.hourly.solar.map((record) => [record.timestamp, record]));
    const windMap = new Map(dataStore.hourly.wind.map((record) => [record.timestamp, record]));
    const labels = [];
    const solar = [];
    const wind = [];
    const windDirection = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setHours(cursor.getHours() + 1)) {
      const key = buildHourlyKeyFromDate(cursor);
      const solarRecord = solarMap.get(key);
      const windRecord = windMap.get(key);
      labels.push(`${pad2(cursor.getHours())}:00`);
      solar.push(solarRecord ? toSeriesValue(solarRecord.ghi) : null);
      wind.push(windRecord ? toSeriesValue(windRecord[windSpeedMetric]) : null);
      windDirection.push(windRecord ? toSeriesValue(windRecord[windDirMetric]) : null);
    }
    return { labels, solar, wind, windDirection };
  }

  if (!useDailyAggregation && period === "week" && interval === "half_hour") {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(weekStart);
    weekEnd.setHours(23, 60 - WEATHER_INTERVAL_MINUTES, 0, 0);
    const solarMap = new Map(solarRecords.map((record) => [buildRecordKey(record), record]));
    const windMap = new Map(windRecords.map((record) => [buildRecordKey(record), record]));
    const labels = [];
    const solar = [];
    const wind = [];
    const windDirection = [];
    for (
      let cursor = new Date(weekStart);
      cursor <= weekEnd;
      cursor.setMinutes(cursor.getMinutes() + WEATHER_INTERVAL_MINUTES)
    ) {
      const key = buildRecordKeyFromDate(cursor);
      const solarRecord = solarMap.get(key);
      const windRecord = windMap.get(key);
      const dayOfWeek = cursor.toLocaleDateString("en-US", { weekday: "short" });
      labels.push([formatIndicatorTime(cursor), `${dayOfWeek} ${formatIndicatorDate(cursor)}`]);
      solar.push(solarRecord ? toSeriesValue(solarRecord.ghi) : null);
      wind.push(windRecord ? toSeriesValue(windRecord[windSpeedMetric]) : null);
      windDirection.push(windRecord ? toSeriesValue(windRecord[windDirMetric]) : null);
    }
    return { labels, solar, wind, windDirection };
  }

  if (!useDailyAggregation && period === "week") {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(weekStart);
    const solarMap = new Map(dataStore.hourly.solar.map((record) => [record.timestamp, record]));
    const windMap = new Map(dataStore.hourly.wind.map((record) => [record.timestamp, record]));
    const labels = [];
    const solar = [];
    const wind = [];
    const windDirection = [];
    for (let cursor = new Date(weekStart); cursor <= weekEnd; cursor.setHours(cursor.getHours() + 1)) {
      const key = buildHourlyKeyFromDate(cursor);
      const solarRecord = solarMap.get(key);
      const windRecord = windMap.get(key);
      labels.push(
        cursor.toLocaleString("en-US", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      solar.push(solarRecord ? toSeriesValue(solarRecord.ghi) : null);
      wind.push(windRecord ? toSeriesValue(windRecord[windSpeedMetric], { round: true }) : null);
      windDirection.push(windRecord ? toSeriesValue(windRecord[windDirMetric], { round: true }) : null);
    }
    return { labels, solar, wind, windDirection };
  }

  if (!useDailyAggregation && period === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    end.setHours(23, 0, 0, 0);
    const solarMap = new Map(dataStore.hourly.solar.map((record) => [record.timestamp, record]));
    const windMap = new Map(dataStore.hourly.wind.map((record) => [record.timestamp, record]));
    const labels = [];
    const solar = [];
    const wind = [];
    const windDirection = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setHours(cursor.getHours() + 1)) {
      const key = buildHourlyKeyFromDate(cursor);
      const solarRecord = solarMap.get(key);
      const windRecord = windMap.get(key);
      labels.push([`${pad2(cursor.getHours())}:00`, `${cursor.getMonth() + 1}/${cursor.getDate()}`]);
      solar.push(solarRecord ? toSeriesValue(solarRecord.ghi) : null);
      wind.push(windRecord ? toSeriesValue(windRecord[windSpeedMetric], { round: true }) : null);
      windDirection.push(windRecord ? toSeriesValue(windRecord[windDirMetric], { round: true }) : null);
    }
    return { labels, solar, wind, windDirection };
  }

  const dailySolarMap = new Map(dataStore.daily.solar.map((record) => [record.date, record]));
  const dailyWindMap = new Map(dataStore.daily.wind.map((record) => [record.date, record]));
  const start =
    period === "day"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : period === "week"
        ? getWeekStart(date)
        : period === "month"
          ? new Date(date.getFullYear(), date.getMonth(), 1)
          : new Date(date.getFullYear(), 0, 1);
  const end =
    period === "day"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : period === "week"
        ? getWeekEnd(getWeekStart(date))
        : period === "month"
          ? new Date(date.getFullYear(), date.getMonth() + 1, 0)
          : new Date(date.getFullYear(), 11, 31);
  const labels = [];
  const solar = [];
  const wind = [];
  const windDirection = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = formatDateKey(cursor);
    const solarRecord = dailySolarMap.get(key);
    const windRecord = dailyWindMap.get(key);
    labels.push(key);
    solar.push(solarRecord ? toSeriesValue(solarRecord.ghi) : null);
    wind.push(windRecord ? toSeriesValue(windRecord[windSpeedMetric], { round: true }) : null);
    windDirection.push(windRecord ? toSeriesValue(windRecord[windDirMetric], { round: true }) : null);
  }
  return { labels, solar, wind, windDirection };
};

const computeMissingRanges = (series = {}) => {
  const labels = Array.isArray(series.labels) ? series.labels : [];
  const solar = Array.isArray(series.solar) ? series.solar : [];
  const wind = Array.isArray(series.wind) ? series.wind : [];
  const ranges = [];
  let start = null;
  for (let i = 0; i < labels.length; i += 1) {
    const missing = (solar[i] == null || Number.isNaN(Number(solar[i]))) && (wind[i] == null || Number.isNaN(Number(wind[i])));
    if (missing && start == null) {
      start = i;
    }
    if (!missing && start != null) {
      ranges.push({ startIndex: start, endIndex: i - 1 });
      start = null;
    }
  }
  if (start != null) {
    ranges.push({ startIndex: start, endIndex: labels.length - 1 });
  }
  return ranges;
};

const renderAxis = (labels) => {
  chartAxis.innerHTML = "";
  chartAxis.style.gridTemplateColumns = `repeat(${labels.length}, 1fr)`;
  const shouldShowTick =
    window.EnergyCharts?.shouldShowAxisTick ||
    ((nextLabels, index) => index % Math.max(1, Math.ceil((nextLabels?.length || 0) / 12)) === 0);
  const toLabelText = window.EnergyCharts?.toLabelText || ((label) => String(label ?? ""));
  const formatAxisLabel = (labelText) => {
    const text = String(labelText || "");
    const dayTimeMatch = text.match(/^([A-Za-z]{3})\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);
    if (dayTimeMatch) return `${dayTimeMatch[1]}\n${dayTimeMatch[2]}`;
    return text;
  };
  labels.forEach((label, index) => {
    const span = document.createElement("span");
    span.textContent = shouldShowTick(labels, index) ? formatAxisLabel(toLabelText(label)) : "";
    chartAxis.appendChild(span);
  });
};

const buildAreaPath = (values, height, width, maxValue) => {
  if (!values.length) {
    return `M 0 ${height} L ${width} ${height} Z`;
  }
  if (values.length === 1) {
    const value = values[0];
    const max = Math.max(maxValue || 0, value, 1);
    const y = height - (value / max) * (height * 0.85) - 10;
    return `M 0 ${height} L 0 ${y} L ${width} ${y} L ${width} ${height} Z`;
  }
  const max = Math.max(maxValue || 0, ...values, 1);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height * 0.85) - 10;
    return [x, y];
  });
  const path = [`M ${points[0][0]} ${height}`];
  points.forEach(([x, y]) => path.push(`L ${x} ${y}`));
  path.push(`L ${points[points.length - 1][0]} ${height} Z`);
  return path.join(" ");
};

const getAnnualMaxValue = (records, metric) =>
  records.reduce((max, record) => {
    const value = Number(record[metric]);
    if (!Number.isFinite(value)) {
      return max;
    }
    return Math.max(max, value);
  }, 0);

const ensureWeatherChartBridge = () => {
  if (weatherChartBridge || !weatherChartRoot || !window.EnergyTimeSeriesChart?.createBridge) {
    return;
  }
  weatherChartBridge = window.EnergyTimeSeriesChart.createBridge();
  weatherChartBridge.mount(weatherChartRoot, {
    type: "line",
    className: "chart-svg",
    ariaLabel: "Weather chart",
    labels: [],
    datasets: [],
    minY: 0,
    missingRanges: [],
  });
};

const buildWeatherChartProps = ({ labels = [], solar = [], wind = [] } = {}) => {
  const missingRanges = computeMissingRanges({ labels, solar, wind });
  const palette = readChartTheme();
  return {
    type: "line",
    className: "chart-svg",
    ariaLabel: "Weather chart",
    labels,
    nowIndicator: resolveNowIndicator(labels.length),
    missingRanges,
    scales: {
      x: {
        grid: { color: palette.gridSecondary },
        ticks: { display: false },
      },
      yWind: {
        type: "linear",
        position: "left",
        min: 0,
        title: { display: true, text: "Wind (m/s)", color: palette.title, font: { weight: "700" } },
        ticks: { color: palette.tick },
        grid: { color: palette.gridSecondary },
      },
      ySolar: {
        type: "linear",
        position: "right",
        min: 0,
        title: { display: true, text: "Solar (W/m²)", color: palette.title, font: { weight: "700" } },
        ticks: { color: palette.tick },
        grid: { drawOnChartArea: false },
      },
    },
    datasets: [
      {
        label: "Solar",
        data: solar,
        yAxisID: "ySolar",
        borderColor: "rgba(249, 168, 37, 0.95)",
        backgroundColor: "rgba(249, 168, 37, 0.35)",
        fill: true,
        hidden: !seriesVisibility.solar,
        spanGaps: false,
      },
      {
        label: "Wind",
        data: wind,
        yAxisID: "yWind",
        borderColor: "rgba(31, 119, 180, 0.95)",
        backgroundColor: "rgba(31, 119, 180, 0.28)",
        fill: true,
        hidden: !seriesVisibility.wind,
        spanGaps: false,
      },
    ],
  };
};

const renderChart = (series, maxValues = {}) => {
  ensureWeatherChartBridge();
  if (!weatherChartBridge) return;
  weatherChartBridge.update(buildWeatherChartProps({
    labels: series.labels,
    solar: series.solar,
    wind: series.wind,
  }));
  renderAxis(series.labels);
};

const updateView = () => {
  chartDate.textContent = formatDateLabel(selectedDate);
  syncControlStrip();
  const series = buildSeries(
    dataStore.raw15.solar,
    dataStore.raw15.wind,
    viewState.period,
    selectedDate,
    viewState.interval
  );
  currentSeries = series;
  const solarMax = getAnnualMaxValue(dataStore.raw15.solar, "ghi");
  const windMax = getAnnualMaxValue(dataStore.raw15.wind, windMetricState.speed);
  renderChart(series, { solar: solarMax, wind: windMax });
};

const buildUrl = (base, params) => {
  const url = new URL(base, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};

const parseResponseError = async (response) => {
  if (response.ok) {
    return "";
  }
  try {
    const errorPayload = await response.clone().json();
    if (Array.isArray(errorPayload?.errors) && errorPayload.errors.length > 0) {
      return errorPayload.errors.join(" ");
    }
  } catch (error) {
    // ignore parsing errors and fall back to text
  }
  const text = await response.text();
  return text || "Unable to fetch datasets.";
};

const parseJsonResponse = async (response, label = "response") => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = cleanText(text).slice(0, 180) || "(empty body)";
    throw new Error(`${label} did not return JSON. ${preview}`);
  }
};

const unpackWeatherCachePayload = (cacheRow) => {
  const payload = cacheRow?.payload;
  if (Array.isArray(payload)) {
    return { records: payload, metadata: {} };
  }
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.records)) {
      return { records: payload.records, metadata: payload.metadata || payload.meta || {} };
    }
    if (Array.isArray(payload.rows)) {
      return { records: payload.rows, metadata: payload.metadata || payload.meta || {} };
    }
  }
  return { records: [], metadata: {} };
};

const buildWeatherCachePayload = (provider, records, metadata) => {
  if (provider !== "open_meteo") {
    return records;
  }
  return {
    schema: WEATHER_CACHE_SCHEMA,
    records,
    metadata: {
      ...(metadata || {}),
      updatedAt: new Date().toISOString(),
    },
  };
};

const hasUsableCache = (cacheRow, wkt) => {
  if (!cacheRow || cacheRow?.wkt !== wkt) {
    return false;
  }
  const { records } = unpackWeatherCachePayload(cacheRow);
  return Array.isArray(records) && records.length > 0;
};

const mergeCoverageRecords = (baseRecords = [], incomingRecords = []) => {
  if (weatherCoverage?.mergeRecordsByTimestamp) {
    return weatherCoverage.mergeRecordsByTimestamp(baseRecords, incomingRecords);
  }
  return mergeRecordsByTimestamp(baseRecords, incomingRecords);
};

const isCoverageWindowSatisfied = (records = [], startIso = "", endIso = "") => {
  if (weatherCoverage?.isWindowCovered) {
    return weatherCoverage.isWindowCovered(records, startIso, endIso, WEATHER_INTERVAL_MINUTES);
  }
  return false;
};

const resolveWindowCoverageGaps = (records = [], startIso = "", endIso = "") => {
  if (weatherCoverage?.computeCoverageGaps) {
    return weatherCoverage.computeCoverageGaps(records, startIso, endIso, WEATHER_INTERVAL_MINUTES);
  }
  return [];
};

const buildOpenMeteoCoverageEnvelope = (records = [], requestedStartIso = "", requestedEndIso = "") => {
  if (weatherCoverage?.buildCoverageEnvelope) {
    return weatherCoverage.buildCoverageEnvelope(records, requestedStartIso, requestedEndIso);
  }
  return {
    schema: WEATHER_CACHE_SCHEMA,
    requestedWindow: {
      start: requestedStartIso || null,
      end: requestedEndIso || null,
    },
    servedWindow: {
      start: null,
      end: null,
    },
    coverageWindow: {
      start: null,
      end: null,
    },
    coverageGaps: [],
  };
};

const getOpenMeteoWindowRequest = () => {
  const range = getDateRangeForPeriod(viewState.period, selectedDate);
  const requestStartDate = formatDateKey(range.start);
  const requestEndDate = formatDateKey(range.end);
  const apiStart = new Date(range.start);
  const apiEnd = new Date(range.end);
  apiStart.setDate(apiStart.getDate() - 1);
  apiEnd.setDate(apiEnd.getDate() + 1);
  const startDate = formatDateKey(apiStart);
  const endDate = formatDateKey(apiEnd);
  return {
    requestStartDate,
    requestEndDate,
    startDate,
    endDate,
    startIso: `${requestStartDate}T00:00:00.000Z`,
    endIso: `${requestEndDate}T23:30:00.000Z`,
  };
};

const dateKeyMonthsBack = (dateKey, monthsBack) => {
  const base = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(base.getTime())) {
    return dateKey;
  }
  base.setMonth(base.getMonth() - Number(monthsBack || 0));
  return formatDateKey(base);
};

const readWeatherTelemetry = (projectId) => {
  const key = getScopedUiKey(projectId, WEATHER_TELEMETRY_SUFFIX);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const writeWeatherTelemetry = (projectId, patch = {}) => {
  const key = getScopedUiKey(projectId, WEATHER_TELEMETRY_SUFFIX);
  if (!key) return;
  const current = readWeatherTelemetry(projectId) || {};
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {}
};

const getProviderLabel = (provider) => WEATHER_PROVIDERS[provider] || provider;

const setProviderButtons = (provider) => {
  if (nrelProviderButton) {
    nrelProviderButton.classList.toggle("is-active", provider === "nrel");
  }
  if (openMeteoProviderButton) {
    openMeteoProviderButton.classList.toggle("is-active", provider === "open_meteo");
  }
};

const setActionButtonsDisabled = (disabled) => {
  mapButton.disabled = disabled;
  if (nrelProviderButton) {
    nrelProviderButton.disabled = disabled;
  }
  if (openMeteoProviderButton) {
    openMeteoProviderButton.disabled = disabled;
  }
};

const hydrateDataStore = (solarPayload, windPayload, provider, metadata = {}) => {
  const normalizedSolarRecords =
    provider === "nrel" ? normalizeRecordYears(solarPayload, SOLAR_YEAR) : solarPayload;
  const nextSolarRecords = shiftRecordsToTimeZone(normalizedSolarRecords, locationTimeZone);
  const normalizedWindRecords =
    provider === "nrel" ? normalizeRecordYears(windPayload, WIND_YEAR) : windPayload;
  const nextWindRecords = shiftRecordsToTimeZone(normalizedWindRecords, locationTimeZone);
  windMetricState = resolveWindMetrics(nextWindRecords);
  dataStore.raw15.solar = nextSolarRecords;
  dataStore.raw15.wind = nextWindRecords;
  dataStore.hourly.solar = buildHourlyAggregation(nextSolarRecords, ["ghi", "dni", "dhi", "air_temperature", "wind_speed"]);
  dataStore.hourly.wind = buildHourlyAggregation(nextWindRecords, [windMetricState.speed, windMetricState.direction, "temperature_100m", "pressure_100m"]);
  dataStore.daily.solar = toDailyAggregation(nextSolarRecords, ["ghi", "dni", "dhi", "air_temperature", "wind_speed"]);
  dataStore.daily.wind = toDailyAggregation(nextWindRecords, [windMetricState.speed, windMetricState.direction, "temperature_100m", "pressure_100m"]);
  if (currentProject?.id && sharedCache) {
    const weatherRevision = sharedCache.setParsedWeather(currentProject.id, {
      provider,
      timeZone: locationTimeZone,
      raw15: dataStore.raw15,
      hourly: dataStore.hourly,
      daily: dataStore.daily,
      windMetric: windMetricState,
      metadata,
    });
    sharedCache.setRevision(currentProject.id, "weather", weatherRevision);
  }
  if (openMeteoTelemetry.firstChartRenderMs == null) {
    openMeteoTelemetry.firstChartRenderMs = Date.now() - Number(openMeteoTelemetry.pageLoadStartedAt || Date.now());
    writeWeatherTelemetry(currentProject?.id, {
      pageLoadToRenderMs: openMeteoTelemetry.firstChartRenderMs,
    });
  }
  return { solarCount: nextSolarRecords.length, windCount: nextWindRecords.length };
};

const restoreWeatherFromSharedCache = (provider) => {
  if (!currentProject?.id || !sharedCache) {
    return false;
  }
  const cached = sharedCache.getParsedWeather(currentProject.id, { provider });
  if (!cached?.raw15?.solar || !cached?.raw15?.wind) {
    return false;
  }
  locationTimeZone = cached.timeZone || "UTC";
  windMetricState = cached.windMetric || resolveWindMetrics(cached.raw15.wind);
  dataStore.raw15.solar = cached.raw15.solar || [];
  dataStore.raw15.wind = cached.raw15.wind || [];
  dataStore.hourly.solar = cached.hourly?.solar || buildHourlyAggregation(dataStore.raw15.solar, ["ghi", "dni", "dhi", "air_temperature", "wind_speed"]);
  dataStore.hourly.wind =
    cached.hourly?.wind ||
    buildHourlyAggregation(dataStore.raw15.wind, [windMetricState.speed, windMetricState.direction, "temperature_100m", "pressure_100m"]);
  dataStore.daily.solar = cached.daily?.solar || toDailyAggregation(dataStore.raw15.solar, ["ghi", "dni", "dhi", "air_temperature", "wind_speed"]);
  dataStore.daily.wind =
    cached.daily?.wind ||
    toDailyAggregation(dataStore.raw15.wind, [windMetricState.speed, windMetricState.direction, "temperature_100m", "pressure_100m"]);
  return true;
};

const fetchDataset = async ({ provider, lat, lng, forceRefresh = false, silent = false }) => {
  const providerName = getProviderLabel(provider);
  const wkt = `POINT(${lng} ${lat})`;
  locationTimeZone = await fetchTimeZone({ lat, lng });
  const sourceYear = provider === "nrel" ? Number(SOLAR_YEAR) : null;
  const cacheLookup = { sourceYear, intervalMinutes: WEATHER_INTERVAL_MINUTES };
  const shouldUseSupabaseWeatherCache = provider !== "open_meteo" || OPEN_METEO_SUPABASE_CACHE_ENABLED;
  const safeGetWeatherCache = async (dataset) => {
    if (!currentProject || !shouldUseSupabaseWeatherCache) return null;
    try {
      return await supabaseService.getWeatherCache(
        currentProject.id,
        provider,
        dataset,
        WEATHER_CACHE_DATE_KEY,
        cacheLookup
      );
    } catch (error) {
      console.warn("[Weather] Weather cache read failed; proceeding without cache.", error);
      return null;
    }
  };
  const [cachedSolar, cachedWind] = await Promise.all([
    safeGetWeatherCache("solar"),
    safeGetWeatherCache("wind"),
  ]);

  const cachedSolarEnvelope = unpackWeatherCachePayload(cachedSolar);
  const cachedWindEnvelope = unpackWeatherCachePayload(cachedWind);

  if (!forceRefresh && hasUsableCache(cachedSolar, wkt) && hasUsableCache(cachedWind, wkt) && provider !== "open_meteo") {
    openMeteoTelemetry.cacheHits += 1;
    return hydrateDataStore(cachedSolarEnvelope.records, cachedWindEnvelope.records, provider, {
      fetchMode: "cache",
      requestStartDate: null,
      requestEndDate: null,
    });
  }

  const persistMergedDataset = async ({ weatherPayload = {}, solarRecords = [], windRecords = [] } = {}) => {
    if (!currentProject || !shouldUseSupabaseWeatherCache) return;
    const fetchedAt = new Date().toISOString();
    const coverageMeta = {
      ...(weatherPayload?.meta || {}),
      coverage: buildOpenMeteoCoverageEnvelope(
        solarRecords,
        weatherPayload?.meta?.requestedWindow?.start || null,
        weatherPayload?.meta?.requestedWindow?.end || null
      ),
      cacheVersion: WEATHER_CACHE_SCHEMA,
    };
    try {
      await Promise.all([
        supabaseService.upsertWeatherCache({
          projectId: currentProject.id,
          provider,
          dataset: "solar",
          dateKey: WEATHER_CACHE_DATE_KEY,
          sourceYear,
          intervalMinutes: WEATHER_INTERVAL_MINUTES,
          wkt,
          timezone: locationTimeZone,
          source: weatherPayload?.meta?.provider || provider,
          fetchedAt,
          payload: buildWeatherCachePayload(provider, solarRecords, coverageMeta),
        }),
        supabaseService.upsertWeatherCache({
          projectId: currentProject.id,
          provider,
          dataset: "wind",
          dateKey: WEATHER_CACHE_DATE_KEY,
          sourceYear,
          intervalMinutes: WEATHER_INTERVAL_MINUTES,
          wkt,
          timezone: locationTimeZone,
          source: weatherPayload?.meta?.provider || provider,
          fetchedAt,
          payload: buildWeatherCachePayload(provider, windRecords, coverageMeta),
        }),
      ]);
    } catch (cacheError) {
      console.warn("[Weather] Weather cache write failed; continuing with in-memory data.", cacheError);
    }
  };

  const fetchWeatherPayload = async (
    { mode = "load_default", sinceDate = "", startDate = "", endDate = "", expansionTier = "window", runId = "", signal = null } = {}
  ) => {
    const weatherUrl = buildUrl(WEATHER_PROXY_ENDPOINT, {
      provider,
      lat: String(lat),
      lng: String(lng),
      mode,
      expansionTier,
      runId,
      ...(sinceDate ? { sinceDate } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(forceRefresh ? { cacheBust: String(Date.now()) } : {}),
    });
    const response = await fetch(weatherUrl, {
      cache: forceRefresh ? "no-store" : "default",
      signal,
    });
    const responseError = await parseResponseError(response);
    if (responseError) {
      throw new Error(responseError);
    }
    return parseJsonResponse(response, `${providerName} weather API`);
  };

  if (provider === "open_meteo") {
    const { requestStartDate, requestEndDate, startDate, endDate, startIso, endIso } = getOpenMeteoWindowRequest();
    const foregroundToken = ++activeOpenMeteoForegroundToken;
    const { runId, controller } = beginOpenMeteoRun({ projectId: currentProject?.id });
    broadcastOpenMeteoSyncEvent("weather_sync_started", {
      projectId: currentProject?.id,
      provider,
      runId,
      expansionTier: "window",
    });

    let mergedSolar = Array.isArray(cachedSolarEnvelope.records) ? cachedSolarEnvelope.records.slice() : [];
    let mergedWind = Array.isArray(cachedWindEnvelope.records) ? cachedWindEnvelope.records.slice() : [];
    let lastMeta = {
      ...(cachedSolarEnvelope.metadata || {}),
      ...(cachedWindEnvelope.metadata || {}),
      fetchMode: "cache",
    };

    const hydrateMerged = (meta = {}) => {
      const combinedMeta = {
        ...(lastMeta || {}),
        ...(meta || {}),
      };
      lastMeta = combinedMeta;
      const result = hydrateDataStore(mergedSolar, mergedWind, provider, combinedMeta);
      updateView();
      return result;
    };

    const runStillCurrent = () => isOpenMeteoRunCurrent(runId) && foregroundToken === activeOpenMeteoForegroundToken;

    const currentCoverageComplete = isCoverageWindowSatisfied(mergedSolar, startIso, endIso);
    if (!forceRefresh && mergedSolar.length && mergedWind.length) {
      openMeteoTelemetry.cacheHits += 1;
      hydrateMerged({
        ...(lastMeta || {}),
        fetchMode: currentCoverageComplete ? "cache_covered_window" : "cache_partial_window",
        coverageGaps: resolveWindowCoverageGaps(mergedSolar, startIso, endIso),
      });
      if (!silent) {
        setStatus({
          loading: false,
          success: currentCoverageComplete
            ? "Loaded from cache. Refreshing in background."
            : "Loaded partial cache. Fetching missing weather coverage...",
        });
      }
    }

    const fetchWindowIfNeeded = async () => {
      if (!forceRefresh && currentCoverageComplete) {
        return null;
      }
      return runLoadingStep(1, 1, "Fetching Open-Meteo data for selected chart window", () =>
        fetchWeatherPayload({
          mode: "load_window",
          startDate,
          endDate,
          expansionTier: "window",
          runId,
          signal: controller.signal,
        })
      );
    };

    try {
      const windowPayload = await fetchWindowIfNeeded();
      if (!runStillCurrent()) {
        writeOpenMeteoCoverageRunState(currentProject?.id, {
          runId,
          status: "superseded",
        });
        broadcastOpenMeteoSyncEvent("weather_sync_superseded", {
          projectId: currentProject?.id,
          provider,
          runId,
        });
        return { solarCount: dataStore.raw15.solar.length, windCount: dataStore.raw15.wind.length };
      }

      if (windowPayload) {
        const windowSolar = Array.isArray(windowPayload?.solar) ? windowPayload.solar : [];
        const windowWind = Array.isArray(windowPayload?.wind) ? windowPayload.wind : [];
        mergedSolar = mergeCoverageRecords(mergedSolar, windowSolar);
        mergedWind = mergeCoverageRecords(mergedWind, windowWind);
        lastMeta = {
          ...(lastMeta || {}),
          ...(windowPayload?.meta || {}),
          fetchMode: "window_minutely_15",
          coverageGaps: resolveWindowCoverageGaps(mergedSolar, startIso, endIso),
        };

        void persistMergedDataset({ weatherPayload: windowPayload, solarRecords: mergedSolar, windRecords: mergedWind });
        hydrateMerged(lastMeta);

        broadcastOpenMeteoSyncEvent("weather_coverage_upsert", {
          projectId: currentProject?.id,
          provider,
          runId,
          expansionTier: "window",
          coverageWindow: lastMeta?.coverageWindow || null,
        });
      }

      if (!silent) {
        setStatus({
          loading: false,
          success: "Showing selected weather window. Fetching additional history in background...",
        });
      }

      const backgroundStart = Date.now();
      writeOpenMeteoCoverageRunState(currentProject?.id, {
        runId,
        status: "active",
        activeTier: "window",
        pendingTiers: OPEN_METEO_EXPANSION_PLAN.map((entry) => entry.tier),
        completedTiers: [],
        provider,
        projectId: currentProject?.id,
      });

      const runBackgroundExpansion = async () => {
        const completedTiers = [];
        for (const tierConfig of OPEN_METEO_EXPANSION_PLAN) {
          if (!runStillCurrent()) {
            writeOpenMeteoCoverageRunState(currentProject?.id, {
              runId,
              status: "superseded",
              completedTiers,
            });
            return;
          }

          const tierStart = Date.now();
          const tierStartDate = dateKeyMonthsBack(startDate, tierConfig.monthsBack);
          writeOpenMeteoCoverageRunState(currentProject?.id, {
            runId,
            status: "active",
            activeTier: tierConfig.tier,
            pendingTiers: OPEN_METEO_EXPANSION_PLAN.map((entry) => entry.tier).filter((tier) => !completedTiers.includes(tier)),
            completedTiers,
            provider,
            projectId: currentProject?.id,
          });
          broadcastOpenMeteoSyncEvent("weather_sync_tier_started", {
            projectId: currentProject?.id,
            provider,
            runId,
            expansionTier: tierConfig.tier,
            startDate: tierStartDate,
            endDate,
          });

          try {
            const tierPayload = await fetchWeatherPayload({
              mode: "load_window",
              startDate: tierStartDate,
              endDate,
              expansionTier: tierConfig.tier,
              runId,
              signal: controller.signal,
            });
            if (!runStillCurrent()) {
              return;
            }
            const tierSolar = Array.isArray(tierPayload?.solar) ? tierPayload.solar : [];
            const tierWind = Array.isArray(tierPayload?.wind) ? tierPayload.wind : [];
            mergedSolar = mergeCoverageRecords(mergedSolar, tierSolar);
            mergedWind = mergeCoverageRecords(mergedWind, tierWind);
            lastMeta = {
              ...(lastMeta || {}),
              ...(tierPayload?.meta || {}),
              fetchMode: `background_${tierConfig.tier}`,
            };
            void persistMergedDataset({ weatherPayload: tierPayload, solarRecords: mergedSolar, windRecords: mergedWind });
            hydrateMerged(lastMeta);
            const tierLatency = Date.now() - tierStart;
            openMeteoTelemetry.tierLatenciesMs[tierConfig.tier] = tierLatency;
            completedTiers.push(tierConfig.tier);
            writeOpenMeteoCoverageRunState(currentProject?.id, {
              runId,
              status: "active",
              activeTier: tierConfig.tier,
              pendingTiers: OPEN_METEO_EXPANSION_PLAN.map((entry) => entry.tier).filter((tier) => !completedTiers.includes(tier)),
              completedTiers,
              provider,
              projectId: currentProject?.id,
              tierLatencyMs: tierLatency,
            });
            writeWeatherTelemetry(currentProject?.id, {
              tierLatenciesMs: {
                ...(openMeteoTelemetry.tierLatenciesMs || {}),
              },
            });
            broadcastOpenMeteoSyncEvent("weather_coverage_upsert", {
              projectId: currentProject?.id,
              provider,
              runId,
              expansionTier: tierConfig.tier,
              coverageWindow: lastMeta?.coverageWindow || null,
              tierLatencyMs: tierLatency,
            });
          } catch (error) {
            if (error?.name === "AbortError") {
              return;
            }
            openMeteoTelemetry.fallbackCount += 1;
            writeOpenMeteoCoverageRunState(currentProject?.id, {
              runId,
              status: "active",
              activeTier: tierConfig.tier,
              pendingTiers: OPEN_METEO_EXPANSION_PLAN.map((entry) => entry.tier).filter((tier) => !completedTiers.includes(tier)),
              completedTiers,
              provider,
              projectId: currentProject?.id,
              lastError: String(error?.message || error),
            });
            renderDebugOutput({
              provider,
              runId,
              warning: `Open-Meteo ${tierConfig.tier} expansion failed`,
              error: String(error?.message || error),
              lastMeta,
            });
            broadcastOpenMeteoSyncEvent("weather_sync_error", {
              projectId: currentProject?.id,
              provider,
              runId,
              expansionTier: tierConfig.tier,
              error: String(error?.message || error),
            });
          }
        }

        if (runStillCurrent()) {
          writeOpenMeteoCoverageRunState(currentProject?.id, {
            runId,
            status: "complete",
            activeTier: null,
            pendingTiers: [],
            completedTiers,
            provider,
            projectId: currentProject?.id,
            finishedAt: new Date().toISOString(),
          });
          setOpenMeteoFullSyncMarker(currentProject?.id, provider);
          clearOpenMeteoFullSyncMarker(currentProject?.id);
          broadcastOpenMeteoSyncEvent("weather_sync_complete", {
            projectId: currentProject?.id,
            provider,
            runId,
            totalLatencyMs: Date.now() - backgroundStart,
          });
        }
      };

      void runBackgroundExpansion();

      renderDebugOutput({
        provider,
        runId,
        phase: "window-first-with-backward-expansion",
        window: { startDate: requestStartDate, endDate: requestEndDate },
        coverageGaps: resolveWindowCoverageGaps(mergedSolar, startIso, endIso),
        solarRows: mergedSolar.length,
        windRows: mergedWind.length,
        telemetry: openMeteoTelemetry,
      });

      return {
        solarCount: mergedSolar.length,
        windCount: mergedWind.length,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { solarCount: dataStore.raw15.solar.length, windCount: dataStore.raw15.wind.length };
      }
      writeOpenMeteoCoverageRunState(currentProject?.id, {
        runId,
        status: "error",
        lastError: String(error?.message || error),
        provider,
        projectId: currentProject?.id,
      });
      broadcastOpenMeteoSyncEvent("weather_sync_error", {
        projectId: currentProject?.id,
        provider,
        runId,
        expansionTier: "window",
        error: String(error?.message || error),
      });
      throw error;
    }
  }

  const persistNrelDataset = async (weatherPayload, parsedSolarRecords, parsedWindRecords) => {
    if (!currentProject || !shouldUseSupabaseWeatherCache) return;
    const fetchedAt = new Date().toISOString();
    try {
      await Promise.all([
        supabaseService.upsertWeatherCache({
          projectId: currentProject.id,
          provider,
          dataset: "solar",
          dateKey: WEATHER_CACHE_DATE_KEY,
          sourceYear,
          intervalMinutes: WEATHER_INTERVAL_MINUTES,
          wkt,
          timezone: locationTimeZone,
          source: weatherPayload?.meta?.provider || provider,
          fetchedAt,
          payload: parsedSolarRecords,
        }),
        supabaseService.upsertWeatherCache({
          projectId: currentProject.id,
          provider,
          dataset: "wind",
          dateKey: WEATHER_CACHE_DATE_KEY,
          sourceYear,
          intervalMinutes: WEATHER_INTERVAL_MINUTES,
          wkt,
          timezone: locationTimeZone,
          source: weatherPayload?.meta?.provider || provider,
          fetchedAt,
          payload: parsedWindRecords,
        }),
      ]);
    } catch (cacheError) {
      console.warn("[Weather] Weather cache write failed; continuing with in-memory data.", cacheError);
    }
  };

  const totalSteps = 4;
  const weatherResponsePromise = await runLoadingStep(
    1,
    totalSteps,
    "Fetching NREL solar and wind weather",
    () => fetch(buildUrl(WEATHER_PROXY_ENDPOINT, { provider, lat: String(lat), lng: String(lng), mode: "load_default" }))
  );

  const { solar: parsedSolarRecords, wind: parsedWindRecords } = await runLoadingStep(
    4,
    totalSteps,
    `Performing ${providerName} aggregations`,
    async () => {
      const weatherResponse = await runLoadingStep(
        2,
        totalSteps,
        `Waiting for ${providerName} server response`,
        () => weatherResponsePromise
      );
      const responseError = await parseResponseError(weatherResponse);
      if (responseError) {
        throw new Error(responseError);
      }
      const weatherPayload = await runLoadingStep(
        3,
        totalSteps,
        "Downloading NREL weather payload",
        () => parseJsonResponse(weatherResponse, `${providerName} weather API`)
      );
      await persistNrelDataset(weatherPayload, weatherPayload.solar || [], weatherPayload.wind || []);
      return { solar: weatherPayload.solar || [], wind: weatherPayload.wind || [] };
    }
  );

  const result = hydrateDataStore(parsedSolarRecords, parsedWindRecords, provider, {
    fetchMode: "load_default",
    requestStartDate: null,
    requestEndDate: null,
  });

  renderDebugOutput({
    provider,
    solar: {
      sampleRecord: findSolarSample(dataStore.raw15.solar),
      metricSummary: summarizeMetrics(dataStore.raw15.solar, ["ghi", "dni", "dhi"]),
      totalRows: dataStore.raw15.solar.length,
    },
    wind: {
      sampleRecord: findWindSample(dataStore.raw15.wind),
      metricSummary: summarizeMetrics(dataStore.raw15.wind, [windMetricState.speed, windMetricState.direction]),
      totalRows: dataStore.raw15.wind.length,
      speedMetric: windMetricState.speed,
      directionMetric: windMetricState.direction,
    },
  });

  return result;
};
const syncOpenMeteoWindowForCurrentView = ({ forceRefresh = false } = {}) => {
  if (!currentProject || activeProvider !== "open_meteo") {
    return;
  }
  if (currentProject.lat == null || currentProject.lng == null) {
    return;
  }
  void fetchDataset({
    provider: "open_meteo",
    lat: currentProject.lat,
    lng: currentProject.lng,
    forceRefresh,
    silent: true,
  }).catch((error) => {
    renderDebugOutput({
      provider: "open_meteo",
      warning: "Window sync failed",
      error: String(error?.message || error),
    });
  });
};
const bindChartUi = () => {
  if (weatherControlStripRoot && window.EnergyChartUI?.createTimeWindowControlsBridge) {
    weatherControlStripBridge = window.EnergyChartUI.createTimeWindowControlsBridge();
    weatherControlStripBridge.mount(weatherControlStripRoot, buildControlStripProps());
  }
  if (weatherChartLegendRoot && window.EnergyChartUI?.createLegendTogglesBridge) {
    weatherLegendBridge = window.EnergyChartUI.createLegendTogglesBridge();
    weatherLegendBridge.mount(weatherChartLegendRoot, buildLegendProps());
  }
};

const shiftSelectedDate = (direction) => {
  const shifted = new Date(selectedDate);
  if (viewState.period === "day") {
    shifted.setDate(shifted.getDate() + direction);
  } else if (viewState.period === "week") {
    shifted.setDate(shifted.getDate() + direction * 7);
  } else if (viewState.period === "month") {
    shifted.setMonth(shifted.getMonth() + direction);
  } else {
    shifted.setFullYear(shifted.getFullYear() + direction);
  }
  selectedDate = shifted;
  syncControlStrip();
  if (currentProject) {
    void withRetry(() =>
      supabaseService.updateProject(currentProject.id, { selectedDate: formatDateKey(selectedDate) })
    )
      .then((project) => {
        currentProject = project;
      })
      .catch(() => {
        setStatus({ loading: false, error: "Unable to save date selection. Please retry." });
      });
  }
  updateView();
  syncOpenMeteoWindowForCurrentView();
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
  } catch (error) {
    setStatus({ loading: false, error: "Unable to save project name. Please retry." });
  }
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

const loadWithProvider = async (provider, { auto = false, forceRefresh = false, silent = false } = {}) => {
  if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
    setStatus({ loading: false, error: "Select a weather location before loading weather data." });
    return;
  }

  const providerName = getProviderLabel(provider);
  if (!silent) {
    setStatus({
      loading: true,
      loadingMessage: auto
        ? `Restoring weather data from ${providerName}…`
        : `Loading weather data from ${providerName}…`,
    });
    setLoadingProgress(0, 0);
    setActionButtonsDisabled(true);
  }

  try {
    const nextSelectedDate = chooseDateForProvider(provider, selectedDate);
    selectedDate = nextSelectedDate;
    syncControlStrip();

    currentProject = await withRetry(() =>
      supabaseService.updateProject(currentProject.id, {
        weatherProvider: provider,
        selectedDate: formatDateKey(selectedDate),
      })
    );
    activeProvider = provider;
    setProviderButtons(activeProvider);

    const { solarCount, windCount } = await fetchDataset({
      provider,
      lat: currentProject.lat,
      lng: currentProject.lng,
      forceRefresh,
      silent,
    });
    if (!silent) {
      setStatus({
        loading: false,
        success: auto
          ? `${providerName}: restored ${solarCount} solar points and ${windCount} wind points.`
          : `${providerName}: loaded ${solarCount} solar points and ${windCount} wind points.`,
      });
    }
    updateView();
  } catch (error) {
    if (!silent) {
      setStatus({ loading: false, error: error.message || `Unable to load ${providerName} weather data.` });
    }
  } finally {
    if (!silent) {
      setActionButtonsDisabled(false);
    }
  }
};

if (nrelProviderButton) {
  nrelProviderButton.addEventListener("click", () => {
    void loadWithProvider("nrel", { forceRefresh: true });
  });
}

if (openMeteoProviderButton) {
  openMeteoProviderButton.addEventListener("click", () => {
    void loadWithProvider("open_meteo", { forceRefresh: true });
  });
}

mapButton.addEventListener("click", () => {
  selectionMode = !selectionMode;
  mapButton.classList.toggle("is-active", selectionMode);
  updateMapButtonLabel();
  if (selectionMode) {
    setStatus({ loading: false, success: "", error: "" });
  }

  if (selectionMode && !hoverMarker) {
    hoverMarker = L.marker(map.getCenter(), { opacity: 0.6 }).addTo(map);
  }

  if (!selectionMode && hoverMarker) {
    map.removeLayer(hoverMarker);
    hoverMarker = null;
  }
});

map.on("mousemove", (event) => {
  if (!selectionMode || !hoverMarker) {
    return;
  }

  hoverMarker.setLatLng(event.latlng);
});

map.on("click", async (event) => {
  if (!selectionMode) {
    return;
  }

  if (!marker) {
    marker = L.marker(event.latlng, { draggable: true }).addTo(map);
    marker.on("dragend", (dragEvent) => {
      void updateLocation(dragEvent.target.getLatLng());
    });
  } else {
    marker.setLatLng(event.latlng);
  }

  await updateLocation(event.latlng);
  await persistMapState();
  selectionMode = false;
  mapButton.classList.remove("is-active");
  updateMapButtonLabel();

  if (hoverMarker) {
    map.removeLayer(hoverMarker);
    hoverMarker = null;
  }

  setStatus({
    loading: false,
    success: "Weather location selected. Choose 2014 NREL Data or Last Year + 7 Day Forecast to load weather.",
  });
  setLoadingProgress(0, 0);
});

map.on("moveend", () => {
  persistMapState();
});

const loadProjectWeather = async () => {
  if (currentProject?.weatherProvider) {
    activeProvider = currentProject.weatherProvider;
    setProviderButtons(activeProvider);
  }
  if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
    updateView();
    return;
  }
  if (restoreWeatherFromSharedCache(activeProvider)) {
    updateView();
    void loadWithProvider(activeProvider, { auto: true, forceRefresh: true, silent: true });
    return;
  }
  await loadWithProvider(activeProvider, { auto: true, forceRefresh: true });
};

const init = async () => {
  await supabaseService.migrateLegacyLocalData();

  if (!selectedProjectId || !isValidProjectId(selectedProjectId)) {
    window.location.href = "/";
    return;
  }

  const project = await withRetry(() => supabaseService.getProject(selectedProjectId));
  if (!project) {
    window.location.href = "/";
    return;
  }

  applyProjectToUi(project);
  viewState.period = loadPersistedPeriod(project.id, viewState.period);
  viewState.interval = loadPersistedInterval(project.id, viewState.interval);
  normalizeIntervalForPeriod({ persist: true });
  bindChartUi();
  syncControlStrip();
  syncLegend();

  if (headerAssetsLink) {
    headerAssetsLink.href = `/projects/generation.html?projectId=${encodeURIComponent(project.id)}`;
  }
  if (headerStorageLink) {
    headerStorageLink.href = `/projects/storage.html?projectId=${encodeURIComponent(project.id)}`;
  }
  if (headerRatesLink) {
    headerRatesLink.href = `/projects/rates-v4.html?projectId=${encodeURIComponent(project.id)}`;
  }
  updateView();
  if (project.lat != null && project.lng != null) {
    void refreshUtilityMetadata({ lat: project.lat, lng: project.lng });
  }
  await loadProjectWeather();
};

// Monitor API error status and show/hide banner
const setupApiErrorBanner = () => {
  const banner = document.getElementById('api-error-banner');
  const message = document.getElementById('api-error-message');
  const code = document.getElementById('api-error-code');
  const closeBtn = document.getElementById('api-error-close');
  
  if (!banner) return; // Element might not exist on all pages

  const checkBackendStatus = () => {
    const status = supabaseService.getBackendStatus();
    
    if (status?.isWorking === false && status?.lastError) {
      // Show error banner
      message.textContent = status.lastError;
      code.textContent = `Error Code: ${status.errorCode}`;
      banner.style.display = 'block';
    } else {
      // Hide error banner
      banner.style.display = 'none';
    }
  };
  
  // Check status immediately
  checkBackendStatus();
  
  // Check status periodically (every 5 seconds)
  setInterval(checkBackendStatus, 5000);
  
  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.style.display = 'none';
    });
  }
};

// Initialize error banner monitoring when page loads
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupApiErrorBanner);
  } else {
    setupApiErrorBanner();
  }
}

void init();



































