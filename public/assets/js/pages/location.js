const mapButton = document.getElementById("select-map");
const locationValue = document.getElementById("location-value");
const loadingStatus = document.getElementById("loading-status");
const loadingText = document.getElementById("loading-text");
const successStatus = document.getElementById("success-status");
const errorStatus = document.getElementById("error-status");
const chartDate = document.getElementById("chart-date");
const chartSvg = document.getElementById("chart-svg");
const chartAxis = document.getElementById("chart-axis");
const chartDisplay = document.getElementById("chart-display");
const chartTooltip = document.getElementById("chart-tooltip");
const chartHoverLine = document.getElementById("chart-hover-line");
const settingsChartLoading = document.getElementById("settings-chart-loading");
const loadingStepBar = document.getElementById("loading-step-bar");
const loadingOverallBar = document.getElementById("loading-overall-bar");
const tablePanel = document.getElementById("table-panel");
const tableBody = document.getElementById("table-body");
const tableLoadMore = document.getElementById("table-load-more");
const debugPanel = document.getElementById("debug-panel");
const debugOutput = document.getElementById("debug-output");
const datePickerButton = document.getElementById("date-picker-button");
const datePickerInput = document.getElementById("date-picker");
const weatherDateRangeReadout = document.getElementById("weather-date-range-readout");
const weatherShiftBackButton = document.getElementById("weather-shift-back");
const weatherShiftForwardButton = document.getElementById("weather-shift-forward");
const nrelProviderButton = document.getElementById("provider-nrel");
const openMeteoProviderButton = document.getElementById("provider-open-meteo");

const dataStore = {
  raw15: { solar: [], wind: [] },
  hourly: { solar: [], wind: [] },
  daily: { solar: [], wind: [] },
};

const headerProjectNameInput = document.getElementById("header-project-name");
const headerAssetsLink = document.getElementById("header-assets-link");
const headerStorageLink = document.getElementById("header-storage-link");
const supabaseService = window.EnergySupabaseService;
const sharedCache = window.EnergySharedCache || null;
const queryParams = new URLSearchParams(window.location.search);
const selectedProjectId = queryParams.get("projectId");
const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

const SOLAR_YEAR = "2014";
const WIND_YEAR = "2014";
const WEATHER_PROXY_ENDPOINT = "/api/weather-proxy";
const WEATHER_CACHE_DATE_KEY = "all";
const WEATHER_INTERVAL_MINUTES = 30;
const PERIOD_STORAGE_SUFFIX = "selectedPeriod";
const PERIOD_OPTIONS = ["day", "week", "month", "year"];
const WEATHER_PROVIDERS = {
  nrel: "NREL",
  open_meteo: "Open-Meteo",
};
const DEFAULT_DATE = new Date(2014, 1, 9);
let selectedDate = new Date(DEFAULT_DATE);
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
let activeProvider = "nrel";
const viewState = {
  period: "week",
  view: "chart",
};
const seriesVisibility = {
  solar: true,
  wind: true,
};
const tableState = {
  pageSize: 100,
  page: 1,
};
let currentSeries = null;
let weatherChart = null;

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

streetLayer.addTo(map);
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

const setProjectDate = (project) => {
  const parsedStoredDate = project?.selectedDate ? new Date(`${project.selectedDate}T00:00:00`) : null;
  selectedDate = parsedStoredDate && !Number.isNaN(parsedStoredDate.getTime()) ? parsedStoredDate : new Date(DEFAULT_DATE);
  if (datePickerInput) {
    datePickerInput.value = formatDateKey(selectedDate);
  }
};

const applyProjectToUi = (project) => {
  currentProject = project;
  activeProvider = project.weatherProvider || "nrel";
  setProviderButtons(activeProvider);
  supabaseService.setLastOpenedProjectId(project.id);
  if (headerProjectNameInput) {
    headerProjectNameInput.value = project.name || "Untitled Facility";
  }
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
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
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
      })
    );
    await refreshCityLabel({ lat, lng });
    const changed = prevLat == null || prevLng == null || prevLat !== lat || prevLng !== lng;
    if (changed) {
      clearLoadedWeatherData();
      setStatus({
        loading: false,
        success: "Location updated. Choose 2014 NREL Data or Last Year + 7 Day Forecast to load weather.",
      });
    }
    updateMapButtonLabel();
    return changed;
  } catch (error) {
    setStatus({ loading: false, error: "Unable to save location. Please retry." });
    return false;
  }
};

const setStatus = ({ loading = false, loadingMessage = "", success = "", error = "" }) => {
  loadingStatus.hidden = !loading;
  successStatus.hidden = !success;
  errorStatus.hidden = !error;
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

const formatIndicatorDate = (date) => `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
const formatIndicatorTime = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const formatTooltipLabelHtml = (text) => String(text || "").replace(/\n/g, "<br />");

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
    return `${dayOfWeek} ${formatIndicatorDate(cursor)}\n${formatIndicatorTime(cursor)}`;
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
  if (provider === "open_meteo") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }
  const existingYear = currentDate?.getFullYear?.();
  if (existingYear === 2014) {
    return currentDate;
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
  tableState.page = 1;
  if (currentProject?.id && sharedCache) {
    sharedCache.clearWeather(currentProject.id);
  }
  hideChartTooltip();
  setLoadingProgress(0, 0);
  updateView();
};

const recordDateKey = (record) =>
  `${record.year}-${pad2(record.month)}-${pad2(record.day)}`;

const buildRecordKey = (record) =>
  `${record.year}-${pad2(record.month)}-${pad2(record.day)}` +
  `-${pad2(record.hour ?? "00")}-${pad2(record.minute ?? "00")}`;

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

const updateWeatherDateRangeReadout = () => {
  if (!weatherDateRangeReadout) {
    return;
  }
  const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
  const startText = formatShortDate(start);
  const endText = formatShortDate(end);
  weatherDateRangeReadout.textContent = startText === endText ? startText : `${startText}-${endText}`;
};

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
      hourly[metric] = count ? bucket.sums[metric] / count : 0;
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
      daily[metric] = count ? bucket.sums[metric] / count : 0;
    });
    return daily;
  });
};

const buildSeries = (solarRecords, windRecords, period, date) => {
  if (!solarRecords.length && !windRecords.length) {
    return { labels: [], solar: [], wind: [], windDirection: [] };
  }

  const windSpeedMetric = windMetricState.speed;
  const windDirMetric = windMetricState.direction;

  if (period === "day") {
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
      solar.push(solarRecord ? Number(solarRecord.ghi) || 0 : 0);
      wind.push(windRecord ? Number(windRecord[windSpeedMetric]) || 0 : 0);
      windDirection.push(windRecord ? Number(windRecord[windDirMetric]) || 0 : 0);
    }
    return {
      labels,
      solar,
      wind,
      windDirection,
    };
  }

  if (period === "week") {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(weekStart);
    const solarMap = new Map(
      dataStore.hourly.solar.map((record) => [record.timestamp, record])
    );
    const windMap = new Map(
      dataStore.hourly.wind.map((record) => [record.timestamp, record])
    );
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
      solar.push(solarRecord ? Number(solarRecord.ghi) || 0 : 0);
      const windSpeed = windRecord ? Number(windRecord[windSpeedMetric]) || 0 : 0;
      const windDir = windRecord ? Number(windRecord[windDirMetric]) || 0 : 0;
      wind.push(Math.round(windSpeed));
      windDirection.push(Math.round(windDir));
    }
    return {
      labels,
      solar,
      wind,
      windDirection,
    };
  }

  const solarMap = new Map(dataStore.daily.solar.map((record) => [record.date, record]));
  const windMap = new Map(dataStore.daily.wind.map((record) => [record.date, record]));
  const start =
    period === "month"
      ? new Date(date.getFullYear(), date.getMonth(), 1)
      : new Date(date.getFullYear(), 0, 1);
  const end =
    period === "month"
      ? new Date(date.getFullYear(), date.getMonth() + 1, 0)
      : new Date(date.getFullYear(), 11, 31);
  const labels = [];
  const solar = [];
  const wind = [];
  const windDirection = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = formatDateKey(cursor);
    const solarRecord = solarMap.get(key);
    const windRecord = windMap.get(key);
    labels.push(key);
    solar.push(solarRecord ? Number(solarRecord.ghi) || 0 : 0);
    const windSpeed = windRecord ? Number(windRecord[windSpeedMetric]) || 0 : 0;
    const windDir = windRecord ? Number(windRecord[windDirMetric]) || 0 : 0;
    wind.push(Math.round(windSpeed));
    windDirection.push(Math.round(windDir));
  }
  return {
    labels,
    solar,
    wind,
    windDirection,
  };
};

const renderAxis = (labels) => {
  chartAxis.innerHTML = "";
  chartAxis.style.gridTemplateColumns = `repeat(${labels.length}, 1fr)`;
  const skip = labels.length > 48 ? 6 : labels.length > 24 ? 3 : 1;
  labels.forEach((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    chartAxis.appendChild(span);
  });
  Array.from(chartAxis.children).forEach((node, index) => {
    if (index % skip !== 0) {
      node.textContent = "";
    }
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

const ensureWeatherChart = () => {
  if (weatherChart || !chartSvg || !window.EnergyCharts) {
    return;
  }
  weatherChart = window.EnergyCharts.createSettingsChart(chartSvg);
};

const renderChart = (series, maxValues = {}) => {
  ensureWeatherChart();
  if (!weatherChart) return;
  weatherChart.update({
    labels: series.labels,
    solar: series.solar,
    wind: series.wind,
    showSolar: seriesVisibility.solar,
    showWind: seriesVisibility.wind,
  });
  renderAxis([]);
};

const renderTable = (series) => {
  tableBody.innerHTML = "";
  const maxRows = tableState.pageSize * tableState.page;
  series.labels.slice(0, maxRows).forEach((label, index) => {
    const windDigits = viewState.period === "day" ? 2 : 0;
    const row = document.createElement("tr");
    const direction = Number(series.windDirection[index]) || 0;
    const directionLabel = Number.isFinite(direction) ? `${Math.round(direction)}°` : "-";
    row.innerHTML = `
      <td>${label}</td>
      <td>${formatNumber(series.solar[index])}</td>
      <td>${formatNumber(series.wind[index], windDigits)}</td>
      <td>
        <span class="wind-direction" style="transform: rotate(${direction}deg)" title="${directionLabel}"
          aria-label="Wind direction ${directionLabel}">
          ➤
        </span>
      </td>
    `;
    tableBody.appendChild(row);
  });
  if (tableLoadMore) {
    tableLoadMore.hidden = series.labels.length <= maxRows;
  }
};

const updateChartTooltip = (event) => {
  if (!chartDisplay || !chartTooltip || !chartHoverLine || !currentSeries) {
    return;
  }
  const { labels, solar, wind } = currentSeries;
  if (!labels.length) {
    return;
  }
  const rect = chartDisplay.getBoundingClientRect();
  const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
  const pointCount = labels.length;
  const index = pointCount === 1 ? 0 : Math.round((relativeX / rect.width) * (pointCount - 1));
  const label = formatChartIndicator(viewState.period, selectedDate, index) || labels[index];
  const solarValue = formatNumber(solar[index]);
  const windValue = formatNumber(wind[index], viewState.period === "day" ? 2 : 0);

  chartHoverLine.hidden = false;
  chartHoverLine.style.left =
    pointCount === 1 ? "50%" : `${(index / (pointCount - 1)) * 100}%`;

  const tooltipRows = [];
  if (seriesVisibility.solar) {
    tooltipRows.push(`
      <div class="chart-tooltip__row">
        <span class="chart-tooltip__swatch chart-tooltip__swatch--solar"></span>
        Solar: ${solarValue}
      </div>
    `);
  }
  if (seriesVisibility.wind) {
    tooltipRows.push(`
      <div class="chart-tooltip__row">
        <span class="chart-tooltip__swatch chart-tooltip__swatch--wind"></span>
        Wind: ${windValue}
      </div>
    `);
  }
  chartTooltip.hidden = false;
  chartTooltip.innerHTML = `
    <div class="chart-tooltip__label">${formatTooltipLabelHtml(label)}</div>
    ${tooltipRows.join("") || `<div class="chart-tooltip__row">Enable a series.</div>`}
  `;

  const tooltipWidth = chartTooltip.offsetWidth || 0;
  const tooltipPadding = 16;
  const lineX = (index / Math.max(pointCount - 1, 1)) * rect.width;
  let left = lineX + tooltipPadding;
  if (left + tooltipWidth > rect.width) {
    left = lineX - tooltipWidth - tooltipPadding;
  }
  left = Math.max(left, 8);
  chartTooltip.style.left = `${left}px`;
  chartTooltip.style.top = "12px";
};

const hideChartTooltip = () => {
  if (!chartTooltip || !chartHoverLine) {
    return;
  }
  chartTooltip.hidden = true;
  chartHoverLine.hidden = true;
};

const updateView = () => {
  chartDate.textContent = formatDateLabel(selectedDate);
  updateWeatherDateRangeReadout();
  const series = buildSeries(
    dataStore.raw15.solar,
    dataStore.raw15.wind,
    viewState.period,
    selectedDate
  );
  currentSeries = series;
  tableState.page = 1;
  const solarMax = getAnnualMaxValue(dataStore.raw15.solar, "ghi");
  const windMax = getAnnualMaxValue(dataStore.raw15.wind, windMetricState.speed);
  renderChart(series, { solar: solarMax, wind: windMax });
  renderTable(series);
  chartDisplay.hidden = viewState.view !== "chart";
  tablePanel.hidden = viewState.view !== "table";
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

const hasUsableCache = (cacheRow, wkt) => Boolean(cacheRow?.payload && cacheRow?.wkt === wkt);

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

const hydrateDataStore = (solarPayload, windPayload, provider) => {
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
    });
    sharedCache.setRevision(currentProject.id, "weather", weatherRevision);
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

const fetchDataset = async ({ provider, lat, lng }) => {
  const providerName = getProviderLabel(provider);
  const wkt = `POINT(${lng} ${lat})`;
  locationTimeZone = await fetchTimeZone({ lat, lng });
  const sourceYear = provider === "nrel" ? Number(SOLAR_YEAR) : null;
  const cacheLookup = { sourceYear, intervalMinutes: WEATHER_INTERVAL_MINUTES };
  const [cachedSolar, cachedWind] = currentProject
    ? await Promise.all([
        supabaseService.getWeatherCache(currentProject.id, provider, "solar", WEATHER_CACHE_DATE_KEY, cacheLookup),
        supabaseService.getWeatherCache(currentProject.id, provider, "wind", WEATHER_CACHE_DATE_KEY, cacheLookup),
      ])
    : [null, null];

  if (hasUsableCache(cachedSolar, wkt) && hasUsableCache(cachedWind, wkt)) {
    return hydrateDataStore(cachedSolar.payload, cachedWind.payload, provider);
  }

  const weatherUrl = buildUrl(WEATHER_PROXY_ENDPOINT, {
    provider,
    lat: String(lat),
    lng: String(lng),
    mode: "load_default",
  });

  const totalSteps = 4;
  const weatherResponsePromise = await runLoadingStep(
    1,
    totalSteps,
    provider === "open_meteo"
      ? "Fetching Open-Meteo historical and forecast weather"
      : "Fetching NREL solar and wind weather",
    () => fetch(weatherUrl)
  );

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
    provider === "open_meteo" ? "Downloading normalized weather payload" : "Downloading NREL weather payload",
    () => weatherResponse.json()
  );

  const { solar: parsedSolarRecords, wind: parsedWindRecords } = await runLoadingStep(
    4,
    totalSteps,
    `Performing ${providerName} aggregations`,
    () => Promise.resolve({ solar: weatherPayload.solar || [], wind: weatherPayload.wind || [] })
  );

  if (currentProject) {
    const fetchedAt = new Date().toISOString();
    void supabaseService.upsertWeatherCache({
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
    });
    void supabaseService.upsertWeatherCache({
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
    });
  }

  const result = hydrateDataStore(parsedSolarRecords, parsedWindRecords, provider);

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




const applyToggleState = (buttons, value, attribute) => {
  buttons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset[attribute] === value);
  });
};

document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => {
    viewState.period = button.dataset.period;
    applyToggleState(document.querySelectorAll("[data-period]"), viewState.period, "period");
    persistPeriod(currentProject?.id, viewState.period);
    updateWeatherDateRangeReadout();
    updateView();
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    viewState.view = button.dataset.view;
    applyToggleState(document.querySelectorAll("[data-view]"), viewState.view, "view");
    updateView();
  });
});

document.querySelectorAll("[data-series]").forEach((button) => {
  button.addEventListener("click", () => {
    const series = button.dataset.series;
    if (!series) {
      return;
    }
    seriesVisibility[series] = !seriesVisibility[series];
    button.classList.toggle("is-active", seriesVisibility[series]);
    updateView();
  });
});

if (datePickerInput) {
  datePickerInput.value = formatDateKey(selectedDate);
}

if (datePickerButton && datePickerInput) {
  datePickerButton.addEventListener("click", () => {
    if (typeof datePickerInput.showPicker === "function") {
      datePickerInput.showPicker();
    } else {
      datePickerInput.click();
    }
  });
}

if (datePickerInput) {
  datePickerInput.addEventListener("change", async (event) => {
    const nextDate = new Date(event.target.value);
    if (Number.isNaN(nextDate.getTime())) {
      return;
    }
    selectedDate = nextDate;
    updateWeatherDateRangeReadout();
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
  });
}

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
  if (datePickerInput) {
    datePickerInput.value = formatDateKey(selectedDate);
  }
  updateWeatherDateRangeReadout();
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
};

if (weatherShiftBackButton) {
  weatherShiftBackButton.addEventListener("click", () => {
    shiftSelectedDate(-1);
  });
}

if (weatherShiftForwardButton) {
  weatherShiftForwardButton.addEventListener("click", () => {
    shiftSelectedDate(1);
  });
}

if (tableLoadMore) {
  tableLoadMore.addEventListener("click", () => {
    if (!currentSeries) {
      return;
    }
    tableState.page += 1;
    renderTable(currentSeries);
  });
}

if (chartDisplay) {
  chartDisplay.addEventListener("mousemove", updateChartTooltip);
  chartDisplay.addEventListener("mouseleave", hideChartTooltip);
}

if (headerProjectNameInput) {
  headerProjectNameInput.addEventListener("input", async (event) => {
    if (!currentProject) {
      return;
    }
    currentProject = await supabaseService.updateProject(currentProject.id, {
      name: event.target.value || "Untitled Facility",
    });
  });
}

const loadWithProvider = async (provider, { auto = false } = {}) => {
  if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
    setStatus({ loading: false, error: "Select a location before loading weather data." });
    return;
  }

  const providerName = getProviderLabel(provider);
  setStatus({
    loading: true,
    loadingMessage: auto
      ? `Restoring weather data from ${providerName}…`
      : `Loading weather data from ${providerName}…`,
  });
  setLoadingProgress(0, 0);
  setActionButtonsDisabled(true);

  try {
    const nextSelectedDate = chooseDateForProvider(provider, selectedDate);
    selectedDate = nextSelectedDate;
    if (datePickerInput) {
      datePickerInput.value = formatDateKey(selectedDate);
    }

    currentProject = await withRetry(() =>
      supabaseService.updateProject(currentProject.id, {
        weatherProvider: provider,
        selectedDate: formatDateKey(selectedDate),
      })
    );
    activeProvider = provider;
    setProviderButtons(activeProvider);

    const { solarCount, windCount } = await fetchDataset({ provider, lat: currentProject.lat, lng: currentProject.lng });
    setStatus({
      loading: false,
      success: auto
        ? `${providerName}: restored ${solarCount} solar points and ${windCount} wind points.`
        : `${providerName}: loaded ${solarCount} solar points and ${windCount} wind points.`,
    });
    updateView();
  } catch (error) {
    setStatus({ loading: false, error: error.message || `Unable to load ${providerName} weather data.` });
  } finally {
    setActionButtonsDisabled(false);
  }
};

if (nrelProviderButton) {
  nrelProviderButton.addEventListener("click", () => {
    void loadWithProvider("nrel");
  });
}

if (openMeteoProviderButton) {
  openMeteoProviderButton.addEventListener("click", () => {
    void loadWithProvider("open_meteo");
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
    success: "Location selected. Choose 2014 NREL Data or Last Year + 7 Day Forecast to load weather.",
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
    return;
  }
  await loadWithProvider(activeProvider, { auto: true });
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
  applyToggleState(document.querySelectorAll("[data-period]"), viewState.period, "period");

  if (headerAssetsLink) {
    headerAssetsLink.href = `/projects/generation.html?projectId=${encodeURIComponent(project.id)}`;
  }
  if (headerStorageLink) {
    headerStorageLink.href = `/projects/storage.html?projectId=${encodeURIComponent(project.id)}`;
  }

  updateView();
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
    
    if (status.type === 'localStorage' && status.lastError) {
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
