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
const loadingStepBar = document.getElementById("loading-step-bar");
const loadingOverallBar = document.getElementById("loading-overall-bar");
const tablePanel = document.getElementById("table-panel");
const tableBody = document.getElementById("table-body");
const tableLoadMore = document.getElementById("table-load-more");
const debugPanel = document.getElementById("debug-panel");
const debugOutput = document.getElementById("debug-output");
const datePickerButton = document.getElementById("date-picker-button");
const datePickerInput = document.getElementById("date-picker");

const dataStore = {
  raw15: { solar: [], wind: [] },
  hourly: { solar: [], wind: [] },
  daily: { solar: [], wind: [] },
};

const projectSelect = document.getElementById("project-select");
const createProjectButton = document.getElementById("create-project");
const facilityNameInput = document.getElementById("facility-name");
const supabaseService = window.EnergySupabaseService;

const SOLAR_YEAR = "2014";
const WIND_YEAR = "2014";
const PROXY_ENDPOINT = "/api/nrel-proxy";
const DEFAULT_DATE = new Date(2014, 1, 9);
let selectedDate = new Date(DEFAULT_DATE);
let currentProject = null;
const DEFAULT_WIND_SPEED_METRIC = "windspeed_20m";
const DEFAULT_WIND_DIR_METRIC = "winddirection_20m";
const FALLBACK_WIND_SPEED_METRIC = "windspeed_100m";
const FALLBACK_WIND_DIR_METRIC = "winddirection_100m";
let windMetricState = {
  speed: DEFAULT_WIND_SPEED_METRIC,
  direction: DEFAULT_WIND_DIR_METRIC,
};
let locationTimeZone = "UTC";
const viewState = {
  period: "day",
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

let selectionMode = false;
let marker = null;
let hoverMarker = null;


const map = L.map("map", {
  zoomControl: false,
}).setView([39.742, -105.1786], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);


const getSelectedDateStorageKey = (projectId) => supabaseService.buildScopedUiStorageKey(projectId, "selectedDate");
const getMapStorageKey = (projectId) => supabaseService.buildScopedUiStorageKey(projectId, "mapState");

const loadProjectMapState = (projectId) =>
  JSON.parse(localStorage.getItem(getMapStorageKey(projectId)) || "null");

const persistMapState = () => {
  if (!currentProject) {
    return;
  }
  const center = map.getCenter();
  const bounds = map.getBounds();
  const state = {
    center: { lat: center.lat, lng: center.lng },
    zoom: map.getZoom(),
    bounds: {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    },
  };
  localStorage.setItem(getMapStorageKey(currentProject.id), JSON.stringify(state));
};

const setProjectDate = (projectId) => {
  const storedSelectedDate = localStorage.getItem(getSelectedDateStorageKey(projectId));
  const parsedStoredDate = storedSelectedDate ? new Date(`${storedSelectedDate}T00:00:00`) : null;
  selectedDate = parsedStoredDate && !Number.isNaN(parsedStoredDate.getTime()) ? parsedStoredDate : new Date(DEFAULT_DATE);
  if (datePickerInput) {
    datePickerInput.value = formatDateKey(selectedDate);
  }
};

const applyProjectToUi = (project) => {
  currentProject = project;
  supabaseService.setLastOpenedProjectId(project.id);
  if (facilityNameInput) {
    facilityNameInput.value = project.name || "Untitled Facility";
  }
  if (project.lat != null && project.lng != null) {
    locationValue.textContent = `${project.lat.toFixed(4)}, ${project.lng.toFixed(4)}`;
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

  const mapState = loadProjectMapState(project.id);
  if (mapState?.center && typeof mapState.zoom === "number") {
    map.setView([mapState.center.lat, mapState.center.lng], mapState.zoom);
  } else if (project.lat != null && project.lng != null) {
    map.setView([project.lat, project.lng], 10);
  }

  setProjectDate(project.id);
};

const updateLocation = async (latlng) => {
  if (!currentProject) {
    return;
  }
  const { lat, lng } = latlng;
  locationValue.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  persistMapState();
  currentProject = await supabaseService.updateProject(currentProject.id, { lat, lng });
};

const setStatus = ({ loading = false, loadingMessage = "", success = "", error = "" }) => {
  loadingStatus.hidden = !loading;
  successStatus.hidden = !success;
  errorStatus.hidden = !error;
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
    return buildMockSeries(period);
  }

  const windSpeedMetric = windMetricState.speed;
  const windDirMetric = windMetricState.direction;

  if (period === "day") {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 45, 0, 0);
    const solarMap = new Map(solarRecords.map((record) => [buildRecordKey(record), record]));
    const windMap = new Map(windRecords.map((record) => [buildRecordKey(record), record]));
    const labels = [];
    const solar = [];
    const wind = [];
    const windDirection = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setMinutes(cursor.getMinutes() + 15)) {
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

const buildMockSeries = (period) => {
  const points = period === "day" ? 24 : period === "week" ? 7 : 30;
  const labels = Array.from({ length: points }, (_, index) =>
    period === "day" ? `${index + 1}` : `${index + 1}`
  );
  const solar = labels.map((_, index) => Math.max(0, Math.sin((index / points) * Math.PI) * 100));
  const wind = labels.map(
    (_, index) => 30 + Math.cos((index / points) * Math.PI * 2) * 12
  );
  return { labels, solar, wind, windDirection: wind.map((value) => value * 5) };
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

const renderChart = (series, maxValues = {}) => {
  const width = 600;
  const height = 220;
  const solarMax = Math.max(maxValues.solar || 0, ...series.solar, 1);
  const windMax = Math.max(maxValues.wind || 0, ...series.wind, 1);
  const solarPath = seriesVisibility.solar
    ? buildAreaPath(series.solar, height, width, solarMax)
    : "";
  const windPath = seriesVisibility.wind
    ? buildAreaPath(series.wind, height, width, windMax)
    : "";
  chartSvg.innerHTML = `
    <defs>
      <linearGradient id="solar-gradient" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stop-color="#f7d97d" stop-opacity="0.1"></stop>
        <stop offset="50%" stop-color="#f7d97d" stop-opacity="0.9"></stop>
        <stop offset="100%" stop-color="#f7d97d" stop-opacity="0.1"></stop>
      </linearGradient>
      <linearGradient id="wind-gradient" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stop-color="#53d1e8" stop-opacity="0.4"></stop>
        <stop offset="50%" stop-color="#53d1e8" stop-opacity="0.9"></stop>
        <stop offset="100%" stop-color="#53d1e8" stop-opacity="0.4"></stop>
      </linearGradient>
    </defs>
    ${seriesVisibility.solar ? `<path d="${solarPath}" fill="url(#solar-gradient)"></path>` : ""}
    ${seriesVisibility.wind ? `<path d="${windPath}" fill="url(#wind-gradient)"></path>` : ""}
  `;
  renderAxis(series.labels);
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
  const label = labels[index];
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
    <div class="chart-tooltip__label">${label}</div>
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

const parseError = async (responses) => {
  const failed = responses.find((response) => !response.ok);
  if (!failed) {
    return "";
  }
  try {
    const errorPayload = await failed.clone().json();
    if (Array.isArray(errorPayload?.errors) && errorPayload.errors.length > 0) {
      return errorPayload.errors.join(" ");
    }
  } catch (error) {
    // ignore parsing errors and fall back to text
  }
  const text = await failed.text();
  if (text) {
    return text;
  }
  return "Unable to fetch datasets.";
};

const fetchDataset = async ({ lat, lng }) => {
  const cacheKey = "all";
  const wkt = `POINT(${lng} ${lat})`;
  locationTimeZone = await fetchTimeZone({ lat, lng });
  const cachedSolar = currentProject ? await supabaseService.getNrelCache(currentProject.id, "solar", cacheKey) : null;
  const cachedWind = currentProject ? await supabaseService.getNrelCache(currentProject.id, "wind", cacheKey) : null;

  const solarUrl = buildUrl(PROXY_ENDPOINT, {
    dataset: "solar",
    wkt,
    interval: "15",
  });
  const windUrl = buildUrl(PROXY_ENDPOINT, {
    dataset: "wind",
    wkt,
    interval: "15",
  });

  if (cachedSolar?.payload && cachedWind?.payload) {
    const normalizedSolarRecords = normalizeRecordYears(cachedSolar.payload, SOLAR_YEAR);
    const nextSolarRecords = shiftRecordsToTimeZone(normalizedSolarRecords, locationTimeZone);
    const nextWindRecords = shiftRecordsToTimeZone(cachedWind.payload, locationTimeZone);
    windMetricState = resolveWindMetrics(nextWindRecords);
    dataStore.raw15.solar = nextSolarRecords;
    dataStore.raw15.wind = nextWindRecords;
    dataStore.hourly.solar = buildHourlyAggregation(nextSolarRecords, ["ghi", "dni", "dhi", "air_temperature", "wind_speed"]);
    dataStore.hourly.wind = buildHourlyAggregation(nextWindRecords, [windMetricState.speed, windMetricState.direction, "temperature_20m", "pressure_20m"]);
    dataStore.daily.solar = toDailyAggregation(nextSolarRecords, ["ghi", "dni", "dhi", "air_temperature", "wind_speed"]);
    dataStore.daily.wind = toDailyAggregation(nextWindRecords, [windMetricState.speed, windMetricState.direction, "temperature_20m", "pressure_20m"]);
    return { solarCount: nextSolarRecords.length, windCount: nextWindRecords.length };
  }

  const totalSteps = 4;
  const { solarResponsePromise, windResponsePromise } = await runLoadingStep(
    1,
    totalSteps,
    "Fetching solar and Wind data from NREL",
    async () => ({
      solarResponsePromise: fetch(solarUrl),
      windResponsePromise: fetch(windUrl),
    })
  );

  const [solarResponse, windResponse] = await runLoadingStep(
    2,
    totalSteps,
    "Waiting for NREL server response",
    () => Promise.all([solarResponsePromise, windResponsePromise])
  );

  const responseError = await parseError([solarResponse, windResponse]);
  if (responseError) {
    throw new Error(responseError);
  }

  const [solarCsv, windCsv] = await runLoadingStep(
    3,
    totalSteps,
    "Downloading results",
    () => Promise.all([solarResponse.text(), windResponse.text()])
  );

  const { solarRecords, windRecords } = await runLoadingStep(
    4,
    totalSteps,
    "Performing aggregations",
    () => {
      const parsedSolarRecords = parseCsv(solarCsv);
      const parsedWindRecords = parseCsv(windCsv);
      if (currentProject) {
        void supabaseService.upsertNrelCache({ projectId: currentProject.id, dataset: "solar", dateKey: cacheKey, payload: parsedSolarRecords });
        void supabaseService.upsertNrelCache({ projectId: currentProject.id, dataset: "wind", dateKey: cacheKey, payload: parsedWindRecords });
      }
      const normalizedSolarRecords = normalizeRecordYears(parsedSolarRecords, SOLAR_YEAR);
      const nextSolarRecords = shiftRecordsToTimeZone(normalizedSolarRecords, locationTimeZone);
      const nextWindRecords = shiftRecordsToTimeZone(parsedWindRecords, locationTimeZone);
      windMetricState = resolveWindMetrics(nextWindRecords);

      dataStore.raw15.solar = nextSolarRecords;
      dataStore.raw15.wind = nextWindRecords;
      dataStore.hourly.solar = buildHourlyAggregation(nextSolarRecords, [
        "ghi",
        "dni",
        "dhi",
        "air_temperature",
        "wind_speed",
      ]);
      dataStore.hourly.wind = buildHourlyAggregation(nextWindRecords, [
        windMetricState.speed,
        windMetricState.direction,
        "temperature_20m",
        "pressure_20m",
      ]);
      dataStore.daily.solar = toDailyAggregation(nextSolarRecords, [
        "ghi",
        "dni",
        "dhi",
        "air_temperature",
        "wind_speed",
      ]);
      dataStore.daily.wind = toDailyAggregation(nextWindRecords, [
        windMetricState.speed,
        windMetricState.direction,
        "temperature_20m",
        "pressure_20m",
      ]);

      return { solarRecords: nextSolarRecords, windRecords: nextWindRecords };
    }
  );

  renderDebugOutput({
    solar: {
      sampleRecord: findSolarSample(solarRecords),
      metricSummary: summarizeMetrics(solarRecords, ["ghi", "dni", "dhi"]),
    },
    wind: {
      sampleRecord:
        windRecords.find((record) => record[windMetricState.speed]) || windRecords[0] || null,
      metricSummary: summarizeMetrics(windRecords, [
        windMetricState.speed,
        windMetricState.direction,
      ]),
    },
    windMetricState,
    timeZone: locationTimeZone,
    rawSample: {
      solar: solarCsv.split(/\r?\n/).slice(0, 6),
      wind: windCsv.split(/\r?\n/).slice(0, 6),
    },
  });

  return {
    solarCount: solarRecords.length,
    windCount: windRecords.length,
  };
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
  datePickerInput.addEventListener("change", (event) => {
    const nextDate = new Date(event.target.value);
    if (Number.isNaN(nextDate.getTime())) {
      return;
    }
    selectedDate = nextDate;
    if (currentProject) {
      localStorage.setItem(getSelectedDateStorageKey(currentProject.id), formatDateKey(selectedDate));
    }
    updateView();
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

if (facilityNameInput) {
  facilityNameInput.addEventListener("input", async (event) => {
    if (!currentProject) {
      return;
    }
    currentProject = await supabaseService.updateProject(currentProject.id, {
      name: event.target.value || "Untitled Facility",
    });
  });
}

mapButton.addEventListener("click", () => {
  selectionMode = !selectionMode;
  mapButton.classList.toggle("is-active", selectionMode);
  mapButton.textContent = selectionMode ? "Click on map" : "Select on Map";
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

map.on("click", (event) => {
  if (!selectionMode) {
    return;
  }

  if (!marker) {
    marker = L.marker(event.latlng, { draggable: true }).addTo(map);
    marker.on("dragend", (dragEvent) => {
      updateLocation(dragEvent.target.getLatLng());
    });
  } else {
    marker.setLatLng(event.latlng);
  }

  updateLocation(event.latlng);
  persistMapState();
  selectionMode = false;
  mapButton.classList.remove("is-active");
  mapButton.textContent = "Select on Map";

  if (hoverMarker) {
    map.removeLayer(hoverMarker);
    hoverMarker = null;
  }

  setStatus({ loading: true, loadingMessage: "Fetching 2014 solar and wind data…" });
  setLoadingProgress(0, 0);
  mapButton.disabled = true;
  fetchDataset(event.latlng)
    .then(({ solarCount, windCount }) => {
      setStatus({
        loading: false,
        success: `Loaded ${solarCount} solar points (2014) and ${windCount} wind points (2014).`,
      });
      updateView();
    })
    .catch((error) => {
      setStatus({ loading: false, error: error.message });
    })
    .finally(() => {
      mapButton.disabled = false;
    });
});

map.on("moveend", () => {
  persistMapState();
});

const refreshProjectSelect = async (selectedProjectId = null) => {
  if (!projectSelect) {
    return;
  }
  const projects = await supabaseService.listProjects();
  projectSelect.innerHTML = projects
    .map((project) => `<option value="${project.id}">${project.name || "Untitled Facility"}</option>`)
    .join("");

  const preferredId = selectedProjectId || supabaseService.getLastOpenedProjectId() || projects[0]?.id || null;
  if (!preferredId) {
    return;
  }
  projectSelect.value = preferredId;
  const selected = projects.find((project) => project.id === preferredId);
  if (selected) {
    applyProjectToUi(selected);
  }
};

const loadProjectWeather = async () => {
  if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
    updateView();
    return;
  }
  setStatus({ loading: true, loadingMessage: "Restoring weather data for saved location…" });
  setLoadingProgress(0, 0);
  mapButton.disabled = true;
  try {
    const { solarCount, windCount } = await fetchDataset({ lat: currentProject.lat, lng: currentProject.lng });
    setStatus({ loading: false, success: `Loaded ${solarCount} solar points (2014) and ${windCount} wind points (2014).` });
    updateView();
  } catch (error) {
    setStatus({ loading: false, error: error.message });
  } finally {
    mapButton.disabled = false;
  }
};

const init = async () => {
  await supabaseService.migrateLegacyLocalData();
  let projects = await supabaseService.listProjects();
  if (projects.length === 0) {
    const created = await supabaseService.createProject({ name: "Project 1" });
    projects = [created];
  }

  await refreshProjectSelect(projects[0].id);
  updateView();
  await loadProjectWeather();
};

if (projectSelect) {
  projectSelect.addEventListener("change", async (event) => {
    const project = await supabaseService.getProject(event.target.value);
    if (!project) {
      return;
    }
    applyProjectToUi(project);
    dataStore.raw15.solar = [];
    dataStore.raw15.wind = [];
    await loadProjectWeather();
  });
}

if (createProjectButton) {
  createProjectButton.addEventListener("click", async () => {
    const name = window.prompt("Project name", `Project ${Date.now()}`) || "Untitled Project";
    const project = await supabaseService.createProject({ name });
    await refreshProjectSelect(project.id);
    dataStore.raw15.solar = [];
    dataStore.raw15.wind = [];
    updateView();
  });
}

void init();
