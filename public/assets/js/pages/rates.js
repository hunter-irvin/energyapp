(() => {
  const RATES_PROXY_ENDPOINT = "/api/rates";
  const V3_RATES_SERIES_ENDPOINT = "/api/v3/series/rates";
  const V3_RATES_SYNC_ENDPOINT = "/api/v3/sync/rates";
  const V3_RATES_SYNC_STATUS_ENDPOINT = "/api/v3/sync/rates/status";
  const V3_REFRESH_ENDPOINT = "/api/v3/refresh";
  const WINDOW_BACK_DAYS = 30;
  const WINDOW_FORWARD_DAYS = 7;
  const RATES_CACHE_SCHEMA_VERSION = "rates_v3_ercot_live_fix";
  const RATES_SYNC_POLL_MS = 2 * 60 * 1000;
  const INTERVAL_STORAGE_SUFFIX = "ratesInterval";
  const INTERVAL_OPTIONS = Object.freeze(["five_min", "half_hour", "hourly", "daily"]);
  const DEFAULT_AVAILABLE_INTERVALS = Object.freeze(["hourly", "daily"]);

  const HELP_TEXT = {
    lmp: {
      title: "LMP",
      description:
        "Wholesale locational marginal price. Use this for market-facing projects compensated at ISO/RTO market prices.",
    },
    tariff: {
      title: "Tariff",
      description:
        "Utility export credit schedule. Use this for customer-sited projects compensated under utility tariff rules.",
    },
    real_time: {
      title: "Real-Time",
      description:
        "Balancing-market pricing during operations. Typically more volatile and closer to actual system conditions.",
    },
    day_ahead: {
      title: "Day-Ahead",
      description:
        "Next-day hourly market prices cleared ahead of operations. Typically smoother than real-time prices.",
    },
    kwh: {
      title: "kWh",
      description: "Display rates in dollars per kilowatt-hour (USD/kWh).",
    },
    mwh: {
      title: "MWh",
      description: "Display rates in dollars per megawatt-hour (USD/MWh).",
    },
  };

  const HEALTH_FEEDS = Object.freeze([
    { key: "tariff", serviceType: "tariff", marketMode: "tariff", label: "Tariff" },
    { key: "lmp_rt", serviceType: "lmp", marketMode: "real_time", label: "LMP-RT" },
    { key: "lmp_da", serviceType: "lmp", marketMode: "day_ahead", label: "LMP-DA" },
  ]);
  const RATE_FEED_PLAN = [
    { serviceType: "lmp", marketMode: "real_time" },
    { serviceType: "lmp", marketMode: "day_ahead" },
    { serviceType: "tariff", marketMode: "tariff" },
  ];
  const MODE_LABEL = {
    real_time: "Real-Time",
    day_ahead: "Day-Ahead",
    tariff: "Tariff",
  };
  const REGION_MAP_ASSETS = {
    CAISO: "/assets/img/iso/caiso.png",
    ERCOT: "/assets/img/iso/ercot.png",
    PJM: "/assets/img/iso/pjm.png",
    MISO: "/assets/img/iso/miso.png",
    NYISO: "/assets/img/iso/nyiso.png",
    "ISO-NE": "/assets/img/iso/iso-ne.png",
    SPP: "/assets/img/iso/spp.png",
    "NON-ISO": "/assets/img/iso/non-iso.png",
  };

  const supabaseService = window.EnergySupabaseService;
  const queryParams = new URLSearchParams(window.location.search);
  const requestedProjectId = queryParams.get("projectId");
  const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

  const headerProjectNameInput = document.getElementById("rates-header-project-name");
  const headerProjectNameDisplay = document.getElementById("rates-header-project-name-display");
  const headerProjectNameEditButton = document.getElementById("rates-header-project-name-edit");
  const headerProjectNameSaveButton = document.getElementById("rates-header-project-name-save");
  const headerProjectNameCancelButton = document.getElementById("rates-header-project-name-cancel");

  const ratesLocationLink = document.getElementById("rates-location-link");
  const ratesGenerationLink = document.getElementById("rates-generation-link");
  const ratesStorageLink = document.getElementById("rates-storage-link");

  const ratesProviderLabel = document.getElementById("rates-provider-label");
  const ratesRegionLabel = document.getElementById("rates-region-label");
  const ratesBackfillStatus = document.getElementById("rates-backfill-status");
  const ratesRegionMapImage = document.getElementById("rates-region-map-image");
  const ratesRefreshButton = document.getElementById("rates-refresh-button");
  const ratesMarketModeGroup = document.getElementById("rates-market-mode-group");
  const ratesMarketLabel = document.getElementById("rates-market-label");
  const ratesServiceButtons = Array.from(document.querySelectorAll("[data-rates-service]"));
  const ratesMarketButtons = Array.from(document.querySelectorAll("[data-rates-market]"));
  const ratesControlStripRoot = document.getElementById("rates-control-strip-root");
  const ratesChartLegendRoot = document.getElementById("rates-chart-legend-root");
  const ratesChartFrame = document.getElementById("rates-chart-frame");
  const ratesChartRoot = document.getElementById("rates-chart-root");
  const ratesAxis = document.getElementById("rates-axis");
  const ratesChartLoading = document.getElementById("rates-chart-loading");
  const ratesSourceWarning = document.getElementById("rates-source-warning");
  const ratesEmptyWindow = document.getElementById("rates-empty-window");
  const ratesHealthBody = document.getElementById("rates-health-body");
  const ratesMissingOverlay = document.getElementById("rates-missing-overlay");
  const ratesFieldTooltip = document.getElementById("rates-field-tooltip");
  const ratesCard = document.querySelector(".rates-card");

  const pad2 = (value) => String(value).padStart(2, "0");
  const formatDateKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const parseDateKey = (value) => {
    const [year, month, day] = String(value || "").split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, month - 1, day);
  };
  const formatShortDate = (date) => `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
  const formatTimestamp = (timestamp) => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return "--";
    return parsed.toLocaleString();
  };
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const readChartTheme = () => {
    const styles = window.getComputedStyle(document.documentElement);
    return {
      tick: styles.getPropertyValue("--color-text-muted").trim() || "#6d7982",
      title: styles.getPropertyValue("--color-text-secondary").trim() || "#d0d7dc",
      gridPrimary: styles.getPropertyValue("--chart-grid-primary").trim() || "rgba(120,120,120,0.2)",
      gridTransparent: "rgba(120,120,120,0)",
    };
  };

  const detectLikelyMwhScale = (points = []) => {
    const sample = points
      .map((point) => Number(point?.value))
      .filter((value) => Number.isFinite(value))
      .slice(0, 32);
    if (!sample.length) return false;
    const medianLike = sample.sort((a, b) => a - b)[Math.floor(sample.length / 2)];
    return medianLike > 5;
  };

  const medianAbsNonZero = (points = []) => {
    const values = points
      .map((point) => Math.abs(Number(point?.value)))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!values.length) return 0;
    return values[Math.floor(values.length / 2)];
  };

  const sanitizePoints = (points = []) =>
    (Array.isArray(points) ? points : []).map((point) => {
      if (point?.value == null || point?.value === "") return { ...point, value: null };
      const value = Number(point.value);
      return Number.isFinite(value) ? { ...point, value: Number(value.toFixed(6)) } : { ...point, value: null };
    });

  const resolveSourceUnit = ({ sourceUnit, unit, serviceType, points = [] }) => {
    const explicit = String(sourceUnit || unit || "").toLowerCase();
    if (explicit.includes("cents") && explicit.includes("/kwh")) return "cents/kWh";
    if (explicit.includes("/mwh")) return "USD/MWh";
    if (explicit.includes("/kwh")) return "USD/kWh";
    if (serviceType === "lmp") return detectLikelyMwhScale(points) ? "USD/MWh" : "USD/kWh";
    return "USD/kWh";
  };

  const shouldPersistRateCache = (metadata = {}) => {
    const source = String(metadata?.source || "").toLowerCase();
    const reason = String(metadata?.details?.reason || "").toLowerCase();
    if (reason === "source_unavailable") return false;
    if (reason === "region_not_supported") return false;
    if (source.includes("unavailable") || source.includes("unsupported")) return false;
    return true;
  };

  const repairLikelyLegacyLmpScale = ({ points = [], serviceType, sourceUnit }) => {
    if (serviceType !== "lmp") return { points, sourceUnit, repaired: false };
    const medianAbs = medianAbsNonZero(points);
    if (medianAbs <= 0) return { points, sourceUnit, repaired: false };
    const normalizedUnit = String(sourceUnit || "").toLowerCase();
    if (!normalizedUnit.includes("/kwh")) return { points, sourceUnit, repaired: false };
    // Legacy double-scaling bug produced ~1e-5 USD/kWh ranges for LMP.
    if (medianAbs >= 0.001) return { points, sourceUnit, repaired: false };
    const repairedPoints = points.map((point) => {
      if (point?.value == null || point?.value === "") return { ...point, value: null };
      const value = Number(point.value);
      return Number.isFinite(value) ? { ...point, value: Number((value * 1000).toFixed(6)) } : { ...point, value: null };
    });
    return { points: repairedPoints, sourceUnit: "USD/kWh", repaired: true };
  };

  const repairLikelyMislabeledLmpMwh = ({ points = [], serviceType, sourceUnit }) => {
    if (serviceType !== "lmp") return { points, sourceUnit, repaired: false };
    const normalizedUnit = String(sourceUnit || "").toLowerCase();
    if (!normalizedUnit.includes("/mwh")) return { points, sourceUnit, repaired: false };
    const medianAbs = medianAbsNonZero(points);
    if (medianAbs <= 0 || medianAbs >= 1) return { points, sourceUnit, repaired: false };
    return { points, sourceUnit: "USD/kWh", repaired: true };
  };

  const convertRateValue = (rawValue, sourceUnit, displayUnit) => {
    if (!Number.isFinite(rawValue)) return null;
    let usdPerKwh = rawValue;
    const normalizedSource = String(sourceUnit || "").toLowerCase();
    if (normalizedSource.includes("cents") && normalizedSource.includes("/kwh")) usdPerKwh = rawValue / 100;
    else if (normalizedSource.includes("/mwh")) usdPerKwh = rawValue / 1000;
    if (displayUnit === "mwh") return Number((usdPerKwh * 1000).toFixed(4));
    return Number(usdPerKwh.toFixed(6));
  };

  const getDisplayUnitLabel = () => (viewState.displayUnit === "mwh" ? "USD/MWh" : "USD/kWh");

  const withRetry = async (operation, { retries = 2, delayMs = 400 } = {}) => {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
    throw lastError;
  };

  const buildUrl = (base, params) => {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  };

  const getWeekStart = (date) => {
    const next = new Date(date);
    const diff = (next.getDay() + 6) % 7;
    next.setDate(next.getDate() - diff);
    next.setHours(0, 0, 0, 0);
    return next;
  };

  const getDateRangeForPeriod = (period, selectedDate) => {
    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (period === "week") {
      const weekStart = getWeekStart(start);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return { start: weekStart, end: weekEnd };
    }
    if (period === "month") {
      const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
      const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start: monthStart, end: monthEnd };
    }
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  const resolveNowIndicator = (pointCount) => {
    if (!Number.isFinite(pointCount) || pointCount < 2) {
      return null;
    }
    const selectedDate = parseDateKey(viewState.selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startMs = new Date(start).getTime();
    let endMs = new Date(end).getTime();
    if (viewState.period === "day") {
      endMs = startMs + 24 * 60 * 60 * 1000;
    } else {
      endMs += 1;
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

  const buildActiveWindow = () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - WINDOW_BACK_DAYS);
    start.setMinutes(0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + WINDOW_FORWARD_DAYS);
    end.setMinutes(0, 0, 0);
    return { start, end };
  };

  const viewState = {
    period: "week",
    interval: "hourly",
    serviceType: "lmp",
    marketMode: "day_ahead",
    displayUnit: "kwh",
    selectedDateKey: formatDateKey(new Date()),
    regionId: "",
    utilityName: "",
    timezone: "UTC",
    sourceUnit: "USD/kWh",
    apiVersion: "v2",
    qualityStatus: "unknown",
    lastSource: "",
    lastSourceUrl: "",
    lastSourceNode: "",
    lastReason: "",
    lastFetchedAt: null,
    rawPoints: [],
    availableIntervals: Array.from(DEFAULT_AVAILABLE_INTERVALS),
    healthRows: [],
    expandedRegions: new Set(),
    legend: {
      rate: true,
      missing: true,
    },
  };

  let currentProject = null;
  let ratesChartBridge = null;
  let ratesControlStripBridge = null;
  let ratesLegendBridge = null;
  let backfillStatusTimer = null;

  const getScopedUiKey = (projectIdValue, suffix) => {
    if (!projectIdValue) return "";
    if (typeof supabaseService?.buildScopedUiStorageKey === "function") {
      return supabaseService.buildScopedUiStorageKey(projectIdValue, suffix);
    }
    return `energyapp.project.${projectIdValue}.${suffix}`;
  };

  const loadPersistedInterval = (projectIdValue, fallback = "hourly") => {
    const key = getScopedUiKey(projectIdValue, INTERVAL_STORAGE_SUFFIX);
    if (!key) return fallback;
    const stored = localStorage.getItem(key);
    return INTERVAL_OPTIONS.includes(stored) ? stored : fallback;
  };

  const persistInterval = (projectIdValue, interval) => {
    if (!INTERVAL_OPTIONS.includes(interval)) return;
    const key = getScopedUiKey(projectIdValue, INTERVAL_STORAGE_SUFFIX);
    if (!key) return;
    localStorage.setItem(key, interval);
  };

  const setProjectNameDisplay = (name) => {
    const resolved = String(name || "Untitled Facility").trim() || "Untitled Facility";
    if (headerProjectNameDisplay) headerProjectNameDisplay.textContent = resolved;
    if (headerProjectNameInput) {
      headerProjectNameInput.value = resolved;
      headerProjectNameInput.size = Math.min(Math.max(resolved.length + 1, 8), 40);
    }
  };

  const setProjectNameEditorMode = (isEditing) => {
    if (headerProjectNameDisplay) headerProjectNameDisplay.hidden = isEditing;
    if (headerProjectNameEditButton) headerProjectNameEditButton.hidden = isEditing;
    if (headerProjectNameInput) headerProjectNameInput.hidden = !isEditing;
    if (headerProjectNameSaveButton) headerProjectNameSaveButton.hidden = !isEditing;
    if (headerProjectNameCancelButton) headerProjectNameCancelButton.hidden = !isEditing;
  };

  const saveProjectName = async () => {
    if (!currentProject || !headerProjectNameInput) return;
    const nextName = String(headerProjectNameInput.value || "").trim() || "Untitled Facility";
    currentProject = await withRetry(() => supabaseService.updateProject(currentProject.id, { name: nextName }));
    setProjectNameDisplay(currentProject.name);
    setProjectNameEditorMode(false);
  };

  const setLoading = (loading) => {
    if (ratesChartLoading) ratesChartLoading.hidden = !loading;
    if (ratesRefreshButton) ratesRefreshButton.disabled = loading;
    if (ratesChartFrame) {
      ratesChartFrame.setAttribute("data-state", loading ? "loading" : "idle");
      ratesChartFrame.setAttribute("aria-busy", String(Boolean(loading)));
    }
  };

  const applyChartFeedbackState = () => {
    if (!ratesChartFrame) return;
    if (ratesChartLoading && !ratesChartLoading.hidden) {
      ratesChartFrame.setAttribute("data-state", "loading");
      return;
    }
    if ((ratesSourceWarning && !ratesSourceWarning.hidden) || (ratesEmptyWindow && !ratesEmptyWindow.hidden)) {
      ratesChartFrame.setAttribute("data-state", "warning");
      return;
    }
    ratesChartFrame.setAttribute("data-state", viewState.displaySeries.length ? "ready" : "idle");
  };

  const applyToggleState = (buttons, activeValue, attribute) => {
    buttons.forEach((button) => button.classList.toggle("is-active", button.dataset[attribute] === activeValue));
  };

  const getIntervalLabel = (intervalKey) => {
    if (intervalKey === "five_min") return "5 Min";
    if (intervalKey === "half_hour") return "30 Min";
    if (intervalKey === "hourly") return "Hourly";
    return "Daily";
  };

  const inferCadenceMinutes = (points = []) => {
    const timestamps = Array.from(
      new Set(
        (Array.isArray(points) ? points : [])
          .map((point) => new Date(point?.ts).getTime())
          .filter((value) => Number.isFinite(value))
      )
    ).sort((a, b) => a - b);
    if (timestamps.length < 2) return null;
    let minDiff = null;
    for (let index = 1; index < timestamps.length; index += 1) {
      const diffMinutes = Math.round((timestamps[index] - timestamps[index - 1]) / 60000);
      if (!Number.isFinite(diffMinutes) || diffMinutes <= 0) continue;
      minDiff = minDiff == null ? diffMinutes : Math.min(minDiff, diffMinutes);
    }
    return Number.isFinite(minDiff) ? minDiff : null;
  };

  const resolveAvailableIntervals = () => {
    const cadenceMinutes = inferCadenceMinutes(viewState.rawPoints);
    const available = Array.from(DEFAULT_AVAILABLE_INTERVALS);
    if (Number.isFinite(cadenceMinutes) && cadenceMinutes <= 30) {
      available.unshift("half_hour");
    }
    if (Number.isFinite(cadenceMinutes) && cadenceMinutes <= 5) {
      available.unshift("five_min");
    }
    if (viewState.period === "month") {
      return available.filter((intervalKey) => intervalKey === "hourly" || intervalKey === "daily");
    }
    if (viewState.period === "day") {
      return available.filter((intervalKey) => intervalKey !== "daily");
    }
    return available;
  };

  const ensureIntervalAvailable = () => {
    const available = Array.isArray(viewState.availableIntervals)
      ? viewState.availableIntervals
      : Array.from(DEFAULT_AVAILABLE_INTERVALS);
    if (available.includes(viewState.interval)) return;
    viewState.interval = available.includes("hourly") ? "hourly" : "daily";
    persistInterval(currentProject?.id, viewState.interval);
  };

  const refreshAvailableIntervals = () => {
    viewState.availableIntervals = resolveAvailableIntervals();
    ensureIntervalAvailable();
  };

  const buildIntervalButtons = () =>
    (Array.isArray(viewState.availableIntervals) ? viewState.availableIntervals : Array.from(DEFAULT_AVAILABLE_INTERVALS)).map(
      (intervalKey) => ({
        key: intervalKey,
        label: getIntervalLabel(intervalKey),
        active: viewState.interval === intervalKey,
        onClick: () => {
          viewState.interval = intervalKey;
          persistInterval(currentProject?.id, viewState.interval);
          syncControlStrip();
          renderChart();
        },
      })
    );

  const getDateRangeReadout = () => {
    const selectedDate = parseDateKey(viewState.selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startText = formatShortDate(start);
    const endText = formatShortDate(end);
    return startText === endText ? startText : `${startText}-${endText}`;
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
              refreshAvailableIntervals();
              syncControlStrip();
              renderChart();
            },
          },
          {
            key: "week",
            label: "Week",
            active: viewState.period === "week",
            onClick: () => {
              viewState.period = "week";
              refreshAvailableIntervals();
              syncControlStrip();
              renderChart();
            },
          },
          {
            key: "month",
            label: "Month",
            active: viewState.period === "month",
            onClick: () => {
              viewState.period = "month";
              refreshAvailableIntervals();
              syncControlStrip();
              renderChart();
            },
          },
        ],
      },
      {
        key: "interval",
        label: "Interval",
        labelClassName: "assets-label rates-control-label rates-control-label--inline",
        buttons: buildIntervalButtons(),
      },
      {
        key: "unit",
        label: "Units",
        labelClassName: "assets-label rates-control-label rates-control-label--inline",
        buttons: [
          {
            key: "kwh",
            label: "kWh",
            active: viewState.displayUnit === "kwh",
            dataAttr: { "data-rates-help": "kwh" },
            onClick: () => {
              viewState.displayUnit = "kwh";
              syncControlStrip();
              renderChart();
            },
          },
          {
            key: "mwh",
            label: "MWh",
            active: viewState.displayUnit === "mwh",
            dataAttr: { "data-rates-help": "mwh" },
            onClick: () => {
              viewState.displayUnit = "mwh";
              syncControlStrip();
              renderChart();
            },
          },
        ],
      },
    ],
    rightGroupKeys: ["interval"],
    selectedDateKey: viewState.selectedDateKey,
    dateRangeText: getDateRangeReadout(),
    onDateChange: (nextValue) => {
      if (!nextValue) return;
      viewState.selectedDateKey = nextValue;
      syncControlStrip();
      renderChart();
      if (currentProject) {
        void supabaseService
          .updateProject(currentProject.id, { selectedDate: viewState.selectedDateKey })
          .then((project) => {
            currentProject = project;
          })
          .catch(() => {});
      }
    },
    onShift: (direction) => shiftDate(Number(direction) >= 0 ? 1 : -1),
  });

  const buildLegendProps = () => ({
    className: "chart-panel__legend",
    tagName: "p",
    items: [
      {
        key: "rate",
        label: "Rate",
        className: "legend--total",
        active: Boolean(viewState.legend.rate),
        onToggle: () => {
          viewState.legend.rate = !viewState.legend.rate;
          syncLegend();
          renderChart();
        },
      },
      {
        key: "missing",
        label: "Missing data",
        className: "legend--missing",
        active: Boolean(viewState.legend.missing),
        onToggle: () => {
          viewState.legend.missing = !viewState.legend.missing;
          syncLegend();
          renderChart();
        },
      },
    ],
  });

  const syncControlStrip = () => {
    if (!ratesControlStripBridge) return;
    ratesControlStripBridge.update(buildControlStripProps());
  };

  const syncLegend = () => {
    if (!ratesLegendBridge) return;
    ratesLegendBridge.update(buildLegendProps());
  };

  const updateProviderLabels = () => {
    if (ratesProviderLabel) ratesProviderLabel.textContent = `Utility: ${viewState.utilityName || "--"}`;
    if (ratesRegionLabel) ratesRegionLabel.textContent = `Market Region: ${viewState.regionId || "--"}`;
    if (ratesRegionMapImage) {
      ratesRegionMapImage.src = REGION_MAP_ASSETS[viewState.regionId] || REGION_MAP_ASSETS["NON-ISO"];
    }
  };

  const renderBackfillStatus = (job) => {
    if (!ratesBackfillStatus) return;
    if (!job || job.status === "idle") {
      ratesBackfillStatus.textContent = "Rates Sync: Not started";
      return;
    }
    const pct = Number(job.progressPct || 0);
    const completed = Number(job.completedTasks || 0);
    const total = Number(job.totalTasks || 0);
    if (job.status === "completed") {
      ratesBackfillStatus.textContent = "Rates Sync: Completed";
      return;
    }
    if (job.status === "failed") {
      const err = String(job.error || "failed");
      ratesBackfillStatus.textContent = `Rates Sync: Failed (${err})`;
      return;
    }
    ratesBackfillStatus.textContent = `Rates Sync: ${job.status} (${pct}% - ${completed}/${total})`;
  };

  const fetchBackfillStatus = async () => {
    if (!currentProject?.id || !ratesBackfillStatus) return;
    try {
      const statusUrl = buildUrl(V3_RATES_SYNC_STATUS_ENDPOINT, { projectId: currentProject.id });
      const response = await fetch(statusUrl, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const syncState = payload?.syncState || null;
      const job = payload?.job || null;
      renderBackfillStatus({
        status: job?.status || "idle",
        progressPct: job?.status === "running" ? 50 : job?.status === "completed" ? 100 : 0,
        completedTasks: job?.status === "completed" ? 1 : 0,
        totalTasks: 1,
        error: syncState?.last_error || job?.error || null,
      });
      if (syncState?.last_error) {
        viewState.lastReason = String(syncState.last_error);
      } else if (job?.status === "completed") {
        viewState.lastReason = "";
      }
      if (syncState?.last_success_at) {
        viewState.lastFetchedAt = syncState.last_success_at;
      }
    } catch (error) {}
  };

  const startBackfillStatusPolling = () => {
    if (!ratesBackfillStatus) return;
    if (backfillStatusTimer) clearInterval(backfillStatusTimer);
    void fetchBackfillStatus();
    backfillStatusTimer = window.setInterval(() => {
      void fetchBackfillStatus();
    }, RATES_SYNC_POLL_MS);
  };

  const updateMarketModeVisibility = () => {
    const isLmp = viewState.serviceType === "lmp";
    if (ratesMarketModeGroup) {
      ratesMarketModeGroup.hidden = !isLmp;
      ratesMarketModeGroup.style.display = isLmp ? "" : "none";
      ratesMarketModeGroup.setAttribute("aria-hidden", String(!isLmp));
    }
    if (ratesMarketLabel) {
      ratesMarketLabel.hidden = !isLmp;
      ratesMarketLabel.style.display = isLmp ? "" : "none";
      ratesMarketLabel.setAttribute("aria-hidden", String(!isLmp));
    }
    if (ratesCard) {
      ratesCard.classList.toggle("is-tariff-service", !isLmp);
    }
  };

  const toBucketTimestamp = (date, bucketMinutes) => {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    const bucketMs = Math.max(1, Number(bucketMinutes)) * 60 * 1000;
    const flooredMs = Math.floor(parsed.getTime() / bucketMs) * bucketMs;
    return new Date(flooredMs).toISOString();
  };

  const aggregateSeriesByMinutes = (series = [], bucketMinutes) => {
    const buckets = new Map();
    series.forEach((point) => {
      const ts = new Date(point?.ts);
      if (Number.isNaN(ts.getTime())) return;
      const bucketTs = toBucketTimestamp(ts, bucketMinutes);
      const bucket = buckets.get(bucketTs) || { ts: bucketTs, sum: 0, count: 0 };
      if (Number.isFinite(point?.value)) {
        bucket.sum += Number(point.value);
        bucket.count += 1;
      }
      buckets.set(bucketTs, bucket);
    });
    return Array.from(buckets.values())
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .map((bucket) => ({
        ts: bucket.ts,
        value: bucket.count > 0 ? Number((bucket.sum / bucket.count).toFixed(6)) : null,
      }));
  };

  const getDisplaySeries = () => {
    const selectedDate = parseDateKey(viewState.selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const series = viewState.rawPoints
      .filter((point) => {
        const ts = new Date(point.ts).getTime();
        return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
      })
      .map((point) => ({
        ...point,
        value:
          point?.value == null
            ? null
            : convertRateValue(Number(point.value), viewState.sourceUnit, viewState.displayUnit),
      }));
    if (viewState.interval === "five_min") return aggregateSeriesByMinutes(series, 5);
    if (viewState.interval === "half_hour") return aggregateSeriesByMinutes(series, 30);
    if (viewState.interval === "hourly") return aggregateSeriesByMinutes(series, 60);
    return aggregateSeriesByMinutes(series, 24 * 60);
  };

  const renderAxis = (labels) => {
    if (!ratesAxis) return;
    ratesAxis.innerHTML = "";
    ratesAxis.style.gridTemplateColumns = `repeat(${Math.max(labels.length, 1)}, minmax(0, 1fr))`;
    const shouldShowTick =
      window.EnergyCharts?.shouldShowAxisTick ||
      ((nextLabels, index) => {
        const step = Math.max(1, Math.ceil((nextLabels?.length || 0) / 12));
        return index % step === 0;
      });
    const toLabelText = window.EnergyCharts?.toLabelText || ((label) => String(label ?? ""));
    labels.forEach((label, index) => {
      const span = document.createElement("span");
      span.textContent = shouldShowTick(labels, index) ? toLabelText(label) : "";
      ratesAxis.appendChild(span);
    });
  };

  const renderMissingBands = (series) => {
    if (!ratesMissingOverlay) return;
    ratesMissingOverlay.innerHTML = "";
    if (!viewState.legend.missing) return;
    const total = series.length;
    if (!total) return;
    let start = -1;
    for (let i = 0; i < total; i += 1) {
      const isMissing = series[i]?.value == null;
      if (isMissing && start < 0) start = i;
      const isEnd = !isMissing || i === total - 1;
      if (start >= 0 && isEnd) {
        const endIndex = isMissing && i === total - 1 ? i : i - 1;
        const leftPct = (start / total) * 100;
        const widthPct = ((endIndex - start + 1) / total) * 100;
        const band = document.createElement("span");
        band.className = "rates-missing-band";
        band.style.left = `${leftPct}%`;
        band.style.width = `${Math.max(widthPct, 0.5)}%`;
        band.title = "No rate data";
        ratesMissingOverlay.appendChild(band);
        start = -1;
      }
    }
  };

  const updateEmptyWindowBanner = (series) => {
    if (!ratesEmptyWindow) return;
    const hasRows = Array.isArray(series) && series.length > 0;
    const hasValues = hasRows && series.some((point) => point?.value != null);
    ratesEmptyWindow.hidden = !hasRows || hasValues;
    if (!ratesEmptyWindow.hidden) {
      const sourceValue = viewState.lastSourceUrl || viewState.lastSource;
      const sourceText = sourceValue ? ` Source: ${sourceValue}.` : "";
      ratesEmptyWindow.textContent = `No published rates in the selected window for this mode.${sourceText}`;
    }
    applyChartFeedbackState();
  };

  const sourceHasError = ({ source = "", reason = "", code = "" }) => {
    const sourceText = String(source || "").toLowerCase();
    const reasonText = String(reason || "").toLowerCase();
    const codeText = String(code || "").toLowerCase();
    return (
      sourceText.includes("unavailable") ||
      sourceText.includes("unsupported") ||
      reasonText.includes("source_unavailable") ||
      reasonText.includes("region_not_supported") ||
      reasonText.includes("request_failed") ||
      codeText.includes("error") ||
      codeText.startsWith("http_")
    );
  };

  const updateSourceWarning = () => {
    if (!ratesSourceWarning) return;
    const show = sourceHasError({ source: viewState.lastSource, reason: viewState.lastReason });
    ratesSourceWarning.hidden = !show;
    if (!show) return;
    const sourceText = viewState.lastSourceUrl || viewState.lastSource || "unavailable_source";
    ratesSourceWarning.textContent = `❌ Live market source unavailable. No rates available for this window. Source: ${sourceText}`;
    applyChartFeedbackState();
  };

  const ensureChartBridge = () => {
    if (ratesChartBridge || !ratesChartRoot || !window.EnergyTimeSeriesChart?.createBridge) return;
    ratesChartBridge = window.EnergyTimeSeriesChart.createBridge();
    ratesChartBridge.mount(ratesChartRoot, {
      type: "line",
      className: "generation-chart",
      ariaLabel: "Rates time series chart",
      labels: [],
      datasets: [],
      yTitle: `Rate (${getDisplayUnitLabel()})`,
      minY: 0,
    });
  };

  const buildChartProps = ({ labels = [], values = [] } = {}) => ({
    ...(() => {
      const palette = readChartTheme();
      return {
    type: "line",
    className: "generation-chart",
    ariaLabel: "Rates time series chart",
    labels,
    nowIndicator: resolveNowIndicator(labels.length),
    scales: {
      x: {
        grid: {
          color: (context) => {
            const labelsList = context?.chart?.data?.labels || [];
            const index = Number.isFinite(context?.index) ? context.index : Number(context?.tick?.value);
            const shouldShow =
              window.EnergyCharts?.shouldShowAxisTick?.(labelsList, index) ??
              (index % Math.max(1, Math.ceil((labelsList?.length || 0) / 12)) === 0);
            return shouldShow ? palette.gridPrimary : palette.gridTransparent;
          },
        },
        ticks: {
          color: palette.tick,
          autoSkip: false,
          maxRotation: 0,
          callback(value, index) {
            const labelsList = this?.chart?.data?.labels || [];
            const shouldShow =
              window.EnergyCharts?.shouldShowAxisTick?.(labelsList, index) ??
              (index % Math.max(1, Math.ceil((labelsList?.length || 0) / 12)) === 0);
            if (!shouldShow) return "";
            if (typeof this?.getLabelForValue === "function") return this.getLabelForValue(value);
            return labelsList[index] || "";
          },
        },
      },
      y: {
        min: 0,
        grid: { color: palette.gridPrimary },
        ticks: { color: palette.tick },
        title: {
          display: true,
          text: `Rate (${getDisplayUnitLabel()})`,
          color: palette.title,
          font: { weight: "700" },
        },
      },
    },
    datasets: [
      {
        label: "Rate",
        data: values,
        borderColor: palette.title,
        backgroundColor: "transparent",
        tension: 0.22,
        borderWidth: 2,
        pointRadius: 0,
        spanGaps: false,
        hidden: !viewState.legend.rate,
      },
    ],
    tooltipLabel: (context) => {
      const value = context?.parsed?.y;
      if (!Number.isFinite(value)) return "Rate: Missing";
      const decimals = viewState.displayUnit === "mwh" ? 2 : 4;
      return `Rate: ${Number(value).toFixed(decimals)} ${getDisplayUnitLabel()}`;
    },
      };
    })(),
  });

  const renderChart = () => {
    ensureChartBridge();
    if (!ratesChartBridge) return;
    const series = getDisplaySeries();
    const labels = series.map((point) => {
      const ts = new Date(point.ts);
      const month = ts.getMonth() + 1;
      const day = ts.getDate();
      if (viewState.interval === "daily") return `${month}/${day}`;
      const minute = pad2(ts.getMinutes());
      if (viewState.interval === "half_hour" || viewState.interval === "five_min") {
        return [`${month}/${day}`, `${pad2(ts.getHours())}:${minute}`];
      }
      const hour = pad2(ts.getHours());
      return [`${month}/${day}`, `${hour}:00`];
    });
    const values = series.map((point) => (Number.isFinite(point.value) ? Number(point.value) : null));
    ratesChartBridge.update(buildChartProps({ labels, values }));
    if (ratesAxis) {
      ratesAxis.innerHTML = "";
      ratesAxis.style.display = "none";
    }
    renderMissingBands(series);
    updateEmptyWindowBanner(series);
    updateSourceWarning();
    applyChartFeedbackState();
  };

  const getFeedKey = (serviceType, marketMode) => {
    if (serviceType === "tariff") return "tariff";
    if (marketMode === "real_time") return "lmp_rt";
    if (marketMode === "day_ahead") return "lmp_da";
    return "";
  };

  const getActiveFeedKey = () => getFeedKey(viewState.serviceType, viewState.serviceType === "tariff" ? "tariff" : viewState.marketMode);

  const resolveDisplaySource = (row) =>
    String(
      row?.details?.sourceUrl ||
      row?.details?.latestFailureSourceUrl ||
      row?.source ||
      ""
    ).trim();

  const formatSourceCell = (row) => {
    const source = resolveDisplaySource(row);
    const reason = row?.details?.reason || "";
    const code = row?.details?.latestFailureCode || row?.details?.upstreamErrorCode || "";
    if (!source) return '<span class="rates-source--fallback">❌ Not connected</span>';
    const isFallback = sourceHasError({ source: row?.source || "", reason, code });
    const escaped = escapeHtml(source);
    if (!isFallback) return `<span class="rates-source-value" title="${escaped}">${escaped}</span>`;
    const codeBadge = code ? `${escapeHtml(code)} ` : "";
    return `<span class="rates-source--fallback" title="${escaped}">❌ ${codeBadge}${escaped}</span>`;
  };

  const buildFeedDebugContent = (feed, row) => {
    const details = row?.details || {};
    const lastSuccessAt = row?.lastUpdatedAt || "";
    const latestFailedAt = details.latestFailureAt || "";
    const latestFailedSourceUrl = details.latestFailureSourceUrl || "--";
    const latestFailedSource = details.latestFailureSource || "--";
    const latestFailedCode = details.latestFailureCode || "--";
    const sourceNode = details.sourceNode || "--";
    const latestFailedMessage = details.latestFailureMessage || details.latestFailureReason || "No failure recorded.";
    const latestFailedReason = details.latestFailureReason || "--";
    return `
      <div class="rates-health-detail__column">
        <span class="rates-health-detail__label">${escapeHtml(feed.label)}</span>
        <span><strong>Source:</strong> ${formatSourceCell(row)}</span>
        <span><strong>Last success:</strong> ${escapeHtml(formatTimestamp(lastSuccessAt))}</span>
        <span><strong>Last failure:</strong> ${escapeHtml(formatTimestamp(latestFailedAt))}</span>
        <span><strong>Failure URL:</strong> ${escapeHtml(latestFailedSourceUrl)}</span>
        <span><strong>Failure source:</strong> ${escapeHtml(latestFailedSource)}</span>
        <span><strong>Failure code:</strong> ${escapeHtml(latestFailedCode)}</span>
        <span><strong>Failure reason:</strong> ${escapeHtml(latestFailedReason)}</span>
        <span><strong>Failure message:</strong> ${escapeHtml(latestFailedMessage)}</span>
        <span><strong>Source node / settlement point:</strong> ${escapeHtml(sourceNode)}</span>
      </div>
    `;
  };

  const renderHealthTable = () => {
    if (!ratesHealthBody) return;
    const rows = Array.isArray(viewState.healthRows) ? viewState.healthRows : [];
    if (!rows.length) {
      ratesHealthBody.innerHTML = '<tr><td colspan="7">No status data yet.</td></tr>';
      return;
    }

    const grouped = rows
      .filter((row) => row.regionId && row.regionId !== "NON-ISO")
      .reduce((acc, row) => {
        const regionId = row.regionId;
        if (!acc[regionId]) {
          acc[regionId] = {
            regionId,
            regionLabel: row.regionLabel || regionId,
            feeds: {},
          };
        }
        const feedKey = getFeedKey(row.serviceType, row.marketMode);
        if (!feedKey) return acc;
        acc[regionId].feeds[feedKey] = row;
        return acc;
      }, {});

    const sortedRegions = Object.values(grouped).sort((a, b) => String(a.regionId).localeCompare(String(b.regionId)));
    if (!sortedRegions.length) {
      ratesHealthBody.innerHTML = '<tr><td colspan="7">No ISO status data yet.</td></tr>';
      return;
    }

    const activeFeedKey = getActiveFeedKey();
    ratesHealthBody.innerHTML = sortedRegions
      .map((region) => {
        const regionId = region.regionId;
        const regionLabel = region.regionLabel;
        const isExpanded = viewState.expandedRegions.has(regionId);
        const rowCells = HEALTH_FEEDS.map((feed) => {
          const row = region.feeds[feed.key] || {};
          const isActive = regionId === viewState.regionId && activeFeedKey === feed.key;
          const activeClass = isActive ? " rates-health-cell--active" : "";
          return `
            <td class="rates-health-cell${activeClass}">${escapeHtml(formatTimestamp(row.lastUpdatedAt))}</td>
            <td class="rates-health-cell${activeClass}">${formatSourceCell(row)}</td>
          `;
        }).join("");

        const parent = `
          <tr class="rates-health-parent" data-region-id="${escapeHtml(regionId)}">
            <td>
              <span class="rates-health-parent__region">
                <span class="rates-health-parent__caret">${isExpanded ? "v" : ">"}</span>
                ${escapeHtml(regionLabel)}
              </span>
            </td>
            ${rowCells}
          </tr>
        `;
        if (!isExpanded) return parent;

        const detailCells = HEALTH_FEEDS.map((feed) => `
          <td colspan="2" class="rates-health-detail-cell">
            ${buildFeedDebugContent(feed, region.feeds[feed.key] || {})}
          </td>
        `).join("");
        const detailsRow = `
          <tr class="rates-health-subrow" data-region-id="${escapeHtml(regionId)}">
            <td class="rates-health-detail-title">Diagnostics</td>
            ${detailCells}
          </tr>
        `;
        const detailsMetaRow = `
          <tr class="rates-health-subrow rates-health-subrow--meta" data-region-id="${escapeHtml(regionId)}">
            <td colspan="7">
              <div class="rates-health-detail">
                <p class="rates-health-detail__title">Failure diagnostics for ${escapeHtml(regionLabel)}</p>
              </div>
            </td>
          </tr>
        `;
        return parent + detailsMetaRow + detailsRow;
      })
      .join("");
  };

  const hideRatesFieldTooltip = () => {
    if (ratesFieldTooltip) ratesFieldTooltip.hidden = true;
  };

  const positionRatesFieldTooltip = (event) => {
    if (!ratesFieldTooltip || ratesFieldTooltip.hidden) return;
    const offset = 14;
    const rect = ratesFieldTooltip.getBoundingClientRect();
    let left = event.clientX + offset;
    let top = event.clientY + offset;
    if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - offset;
    if (left < 8) left = 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    if (top < 8) top = 8;
    ratesFieldTooltip.style.left = `${Math.round(left)}px`;
    ratesFieldTooltip.style.top = `${Math.round(top)}px`;
  };

  const showRatesFieldTooltip = (helpKey, event) => {
    if (!ratesFieldTooltip) return;
    const help = HELP_TEXT[helpKey];
    if (!help) return;
    ratesFieldTooltip.innerHTML = `
      <p class="asset-field-tooltip__title">${help.title}</p>
      <p class="asset-field-tooltip__definition">${help.description}</p>
    `;
    ratesFieldTooltip.hidden = false;
    if (event) positionRatesFieldTooltip(event);
  };

  const resolveProvider = async () => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) return;
    const providerUrl = buildUrl(`${RATES_PROXY_ENDPOINT}/provider`, {
      lat: currentProject.lat,
      lng: currentProject.lng,
    });
    const response = await fetch(providerUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to resolve utility/market provider.");
    const payload = await response.json();
    const provider = payload?.provider || {};
    viewState.regionId = provider.isoRegion || "";
    viewState.utilityName = provider.utilityName || "";
    viewState.timezone = provider.timezone || "UTC";
    updateProviderLabels();
    try {
      currentProject = await withRetry(() =>
        supabaseService.updateProject(currentProject.id, {
          utilityName: viewState.utilityName,
          isoRegion: viewState.regionId,
          timezone: viewState.timezone,
        })
      );
    } catch (error) {
      console.warn("Rates provider metadata could not be persisted to project; continuing with in-memory values.", error);
    }
  };

  const fetchRatesSeries = async ({ forceRefresh = false, suppressRender = false } = {}) => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) return;
    const { start, end } = buildActiveWindow();
    const windowStart = start.toISOString();
    const windowEnd = end.toISOString();
    const marketMode = viewState.serviceType === "tariff" ? "tariff" : viewState.marketMode;
    const cacheKey = {
      regionId: viewState.regionId,
      serviceType: viewState.serviceType,
      marketMode,
      windowStart,
      windowEnd,
    };

    try {
      const ratesUrl = buildUrl(V3_RATES_SERIES_ENDPOINT, {
        projectId: currentProject.id,
        serviceType: viewState.serviceType,
        marketMode,
        start: windowStart,
        end: windowEnd,
      });
      const response = await fetch(ratesUrl, { cache: "no-store" });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(`Failed to retrieve rate timeseries. HTTP ${response.status}. ${responseText}`.trim());
      }
      const payload = await response.json();
      const metadata = payload?.metadata || {};
      viewState.apiVersion = metadata.apiVersion || "v2";
      const payloadPoints = sanitizePoints(payload?.points);
      const resolvedSourceUnit = resolveSourceUnit({
        sourceUnit: payload?.metadata?.sourceUnit || "",
        unit: payload?.metadata?.unit || "",
        serviceType: viewState.serviceType,
        points: payloadPoints,
      });
      const repairedPayload = repairLikelyLegacyLmpScale({
        points: payloadPoints,
        serviceType: viewState.serviceType,
        sourceUnit: resolvedSourceUnit,
      });
      const repairedMwhLabel = repairLikelyMislabeledLmpMwh({
        points: repairedPayload.points,
        serviceType: viewState.serviceType,
        sourceUnit: repairedPayload.sourceUnit,
      });
      viewState.sourceUnit = repairedMwhLabel.sourceUnit;
      viewState.qualityStatus = metadata.qualityStatus || "unknown";
      viewState.lastSource = "v3_rates_series";
      viewState.lastSourceUrl = "supabase://rate_project_series";
      viewState.lastSourceNode = "";
      viewState.lastReason = viewState.lastReason || "";
      viewState.lastFetchedAt = metadata.fetchedAt || new Date().toISOString();
      viewState.rawPoints = repairedMwhLabel.points;
      refreshAvailableIntervals();
      const missingHours = repairedMwhLabel.points.reduce((sum, point) => (point?.value == null ? sum + 1 : sum), 0);
      const ingestStatus =
        String(metadata?.details?.reason || "").toLowerCase() === "source_unavailable"
          ? "failed"
          : missingHours > 0
            ? "partial"
            : "success";
      void supabaseService
        .insertRateIngestRun({
          projectId: currentProject.id,
          regionId: payload?.metadata?.regionId || viewState.regionId || "NON-ISO",
          serviceType: viewState.serviceType,
          marketMode,
          source: "v3_rates_series",
          sourceUnit: repairedMwhLabel.sourceUnit,
          apiVersion: metadata.apiVersion || "v2",
          status: ingestStatus,
          rowCount: repairedMwhLabel.points.length,
          missingHours,
          message: metadata?.details?.reason || null,
          details: {
            qualityStatus: metadata?.qualityStatus || null,
            reason: metadata?.details?.reason || viewState.lastReason || null,
            sourceUrl: viewState.lastSourceUrl || null,
            sourceNode: viewState.lastSourceNode || null,
            upstreamErrorCode: metadata?.details?.upstreamErrorCode || null,
            upstreamHttpStatus: metadata?.details?.upstreamHttpStatus ?? null,
          },
          windowStart,
          windowEnd,
          runStartedAt: metadata?.fetchedAt || new Date().toISOString(),
          runFinishedAt: new Date().toISOString(),
        })
        .catch(() => {});
      if (!suppressRender) renderChart();
    } catch (error) {
      const errorMessage = String(error?.message || "Failed to retrieve rate timeseries.");
      const regionId = viewState.regionId || currentProject?.isoRegion || "NON-ISO";
      viewState.lastSourceUrl = String(error?.sourceUrl || viewState.lastSourceUrl || "");
      viewState.lastReason = errorMessage;
      void supabaseService
        .insertRateIngestRun({
          projectId: currentProject.id,
          regionId,
          serviceType: viewState.serviceType,
          marketMode,
          source: viewState.lastSourceUrl || viewState.lastSource || "rates_proxy_phase2_request_failed",
          sourceUnit: viewState.sourceUnit || null,
          apiVersion: viewState.apiVersion || "v2",
          status: "failed",
          rowCount: 0,
          missingHours: 0,
          message: errorMessage,
          details: {
            reason: "request_failed",
            errorMessage,
            sourceUrl: viewState.lastSourceUrl || null,
            errorCode: String(error?.code || "REQUEST_FAILED"),
          },
          windowStart,
          windowEnd,
          runStartedAt: new Date().toISOString(),
          runFinishedAt: new Date().toISOString(),
        })
        .catch(() => {});
      throw error;
    }
  };

  const fetchHealth = async () => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) return;
    const { start, end } = buildActiveWindow();
    const windowStart = start.toISOString();
    const windowEnd = end.toISOString();
    const fetchHealthRows = async (serviceType) => {
      const healthUrl = buildUrl(`${RATES_PROXY_ENDPOINT}/health`, {
        projectId: currentProject.id,
        lat: currentProject.lat,
        lng: currentProject.lng,
        serviceType,
        start: windowStart,
        end: windowEnd,
      });
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to retrieve ${serviceType} rate health.`);
      const payload = await response.json();
      return Array.isArray(payload?.rows) ? payload.rows : [];
    };
    const [lmpRowsRaw, tariffRowsRaw] = await Promise.all([fetchHealthRows("lmp"), fetchHealthRows("tariff")]);
    const lmpRowsExpanded = lmpRowsRaw.flatMap((row) => {
      if (row.marketMode) return [row];
      return [
        { ...row, marketMode: "real_time" },
        { ...row, marketMode: "day_ahead" },
      ];
    });
    const tariffRowsExpanded = tariffRowsRaw.map((row) => ({ ...row, marketMode: row.marketMode || "tariff" }));
    const mergedRows = [...lmpRowsExpanded, ...tariffRowsExpanded].map((row) => {
      const isActiveRow =
        row.regionId === viewState.regionId &&
        row.serviceType === viewState.serviceType &&
        row.marketMode === (viewState.serviceType === "tariff" ? "tariff" : viewState.marketMode);
      if (!isActiveRow) return row;
      const details = { ...(row.details || {}) };
      if (viewState.lastReason) details.reason = viewState.lastReason;
      if (viewState.lastSourceUrl) details.sourceUrl = viewState.lastSourceUrl;
      if (viewState.lastSourceNode) details.sourceNode = viewState.lastSourceNode;
      return {
        ...row,
        source: viewState.lastSourceUrl || viewState.lastSource || row.source,
        sourceUnit: viewState.sourceUnit || row.sourceUnit,
        lastUpdatedAt: viewState.lastFetchedAt || row.lastUpdatedAt,
        details,
      };
    });

    const ingestRuns = typeof supabaseService.listRateIngestRuns === "function"
      ? await supabaseService.listRateIngestRuns(currentProject.id, { limit: 1000 }).catch(() => [])
      : [];
    const runsByFeed = (Array.isArray(ingestRuns) ? ingestRuns : []).reduce((acc, run) => {
      const regionId = run?.region_id || "NON-ISO";
      const serviceType = run?.service_type || "lmp";
      const marketMode = run?.market_mode || (serviceType === "tariff" ? "tariff" : "day_ahead");
      const key = `${regionId}|${serviceType}|${marketMode}`;
      if (!acc[key]) {
        acc[key] = {
          latestAny: null,
          latestSuccess: null,
          latestFailed: null,
        };
      }
      const bucket = acc[key];
      if (!bucket.latestAny) bucket.latestAny = run;
      if (!bucket.latestSuccess && (run?.status === "success" || run?.status === "partial")) {
        bucket.latestSuccess = run;
      }
      if (!bucket.latestFailed && run?.status === "failed") {
        bucket.latestFailed = run;
      }
      return acc;
    }, {});

    viewState.healthRows = mergedRows.map((row) => {
      const key = `${row.regionId}|${row.serviceType}|${row.marketMode}`;
      const runInfo = runsByFeed[key] || {};
      const latestSuccess = runInfo.latestSuccess || null;
      const latestFailed = runInfo.latestFailed || null;
      const details = { ...(row.details || {}) };
      if (latestFailed) {
        details.latestFailureAt = latestFailed.run_finished_at || latestFailed.run_started_at || latestFailed.created_at || null;
        details.latestFailureSource = latestFailed.source || null;
        details.latestFailureSourceUrl = latestFailed?.details?.sourceUrl || latestFailed.source || null;
        details.sourceNode = latestFailed?.details?.sourceNode || details.sourceNode || null;
        details.latestFailureReason = latestFailed?.details?.reason || latestFailed.message || null;
        details.latestFailureMessage = latestFailed?.details?.errorMessage || latestFailed.message || null;
        details.latestFailureCode = latestFailed?.details?.errorCode || latestFailed?.details?.upstreamErrorCode || null;
        if (latestFailed?.details?.reason) details.reason = latestFailed.details.reason;
      }
      const isActiveRow =
        row.regionId === viewState.regionId &&
        row.serviceType === viewState.serviceType &&
        row.marketMode === (viewState.serviceType === "tariff" ? "tariff" : viewState.marketMode);
      const successTimestamp =
        latestSuccess?.run_finished_at || latestSuccess?.run_started_at || latestSuccess?.created_at || null;
      const successSource = latestSuccess?.details?.sourceUrl || latestSuccess?.source || "";
      if (latestSuccess?.details?.sourceNode) details.sourceNode = latestSuccess.details.sourceNode;
      const failedSource = latestFailed?.details?.sourceUrl || latestFailed?.source || "";
      const displaySource = successSource || failedSource || row.source || "";
      if (!details.sourceUrl && displaySource) details.sourceUrl = displaySource;
      return {
        ...row,
        source: isActiveRow
          ? viewState.lastSourceUrl || viewState.lastSource || displaySource
          : displaySource,
        sourceUnit: latestSuccess?.source_unit || row.sourceUnit || null,
        lastUpdatedAt: isActiveRow ? viewState.lastFetchedAt || successTimestamp : successTimestamp,
        details,
      };
    });

    void supabaseService
      .upsertRateRegionHealth({
        projectId: currentProject.id,
        windowStart,
        windowEnd,
        apiVersion: "v2",
        rows: viewState.healthRows,
      })
      .catch(() => {});
    renderHealthTable();
  };

  const reloadAll = async ({ forceRefresh = false } = {}) => {
    setLoading(true);
    try {
      await resolveProvider();
      try {
        await fetchRatesSeries({ forceRefresh });
      } catch (error) {
        console.error("Failed to load rates series.", error);
      }
      await fetchHealth();
      try {
        currentProject = await withRetry(() =>
          supabaseService.updateProject(currentProject.id, {
            ratesServiceType: viewState.serviceType,
            ratesMarketMode: viewState.serviceType === "tariff" ? "tariff" : viewState.marketMode,
          })
        );
      } catch (error) {
        console.warn("Rates settings could not be persisted to project; continuing.", error);
      }
    } catch (error) {
      console.error("Failed to load rates data.", error);
    } finally {
      setLoading(false);
    }
  };

  const shiftDate = (direction) => {
    const baseDate = parseDateKey(viewState.selectedDateKey) || new Date();
    const next = new Date(baseDate);
    if (viewState.period === "day") next.setDate(next.getDate() + direction);
    else if (viewState.period === "week") next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction);
    viewState.selectedDateKey = formatDateKey(next);
    syncControlStrip();
    renderChart();
    if (currentProject) {
      void supabaseService
        .updateProject(currentProject.id, { selectedDate: viewState.selectedDateKey })
        .then((project) => {
          currentProject = project;
        })
        .catch(() => {});
    }
  };

  const manualRefreshAllRateFeeds = async () => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) return;

    const originalServiceType = viewState.serviceType;
    const originalMarketMode = viewState.marketMode;

    setLoading(true);
    try {
      await resolveProvider();
      const { start, end } = buildActiveWindow();
      const windowStart = start.toISOString();
      const windowEnd = end.toISOString();

      await fetch(V3_REFRESH_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          projectId: currentProject.id,
          domains: ["rates"],
          reason: "manual_refresh",
        }),
      }).catch(() => {});

      viewState.serviceType = originalServiceType;
      viewState.marketMode = originalMarketMode;
      applyToggleState(ratesServiceButtons, viewState.serviceType, "ratesService");
      applyToggleState(ratesMarketButtons, viewState.marketMode, "ratesMarket");
      updateMarketModeVisibility();

      await fetchRatesSeries({ forceRefresh: true });
      await fetchBackfillStatus();
      await fetchHealth();

      try {
        currentProject = await withRetry(() =>
          supabaseService.updateProject(currentProject.id, {
            ratesServiceType: viewState.serviceType,
            ratesMarketMode: viewState.serviceType === "tariff" ? "tariff" : viewState.marketMode,
          })
        );
      } catch (error) {
        console.warn("Rates settings could not be persisted to project; continuing.", error);
      }
    } catch (error) {
      console.error("Failed to manually refresh all rate feeds.", error);
    } finally {
      setLoading(false);
    }
  };

  const bindControlStripTooltips = () => {
    if (!ratesControlStripRoot) return;
    const getHelpButton = (target) => target?.closest?.("[data-rates-help]");

    ratesControlStripRoot.addEventListener("mouseover", (event) => {
      const button = getHelpButton(event.target);
      if (!button) return;
      const key = button.dataset.ratesHelp;
      if (!key) return;
      showRatesFieldTooltip(key, event);
    });

    ratesControlStripRoot.addEventListener("mousemove", (event) => {
      if (ratesFieldTooltip?.hidden) return;
      const button = getHelpButton(event.target);
      if (!button) return;
      positionRatesFieldTooltip(event);
    });

    ratesControlStripRoot.addEventListener("mouseout", (event) => {
      const fromButton = getHelpButton(event.target);
      if (!fromButton) return;
      const toButton = getHelpButton(event.relatedTarget);
      if (toButton === fromButton) return;
      hideRatesFieldTooltip();
    });

    ratesControlStripRoot.addEventListener("focusin", (event) => {
      const button = getHelpButton(event.target);
      if (!button) return;
      const key = button.dataset.ratesHelp;
      if (!key) return;
      showRatesFieldTooltip(key);
    });

    ratesControlStripRoot.addEventListener("focusout", (event) => {
      const fromButton = getHelpButton(event.target);
      if (!fromButton) return;
      const toButton = getHelpButton(event.relatedTarget);
      if (toButton === fromButton) return;
      hideRatesFieldTooltip();
    });
  };

  const bindControls = () => {
    if (ratesControlStripRoot && window.EnergyChartUI?.createTimeWindowControlsBridge) {
      ratesControlStripBridge = window.EnergyChartUI.createTimeWindowControlsBridge();
      ratesControlStripBridge.mount(ratesControlStripRoot, buildControlStripProps());
      bindControlStripTooltips();
    }

    if (ratesChartLegendRoot && window.EnergyChartUI?.createLegendTogglesBridge) {
      ratesLegendBridge = window.EnergyChartUI.createLegendTogglesBridge();
      ratesLegendBridge.mount(ratesChartLegendRoot, buildLegendProps());
    }

    ratesServiceButtons.forEach((button) => {
      button.addEventListener("click", () => {
        viewState.serviceType = button.dataset.ratesService || "lmp";
        if (viewState.serviceType === "tariff") viewState.marketMode = "tariff";
        else if (viewState.marketMode === "tariff") viewState.marketMode = "day_ahead";
        applyToggleState(ratesServiceButtons, viewState.serviceType, "ratesService");
        applyToggleState(ratesMarketButtons, viewState.marketMode, "ratesMarket");
        updateMarketModeVisibility();
        void reloadAll();
      });
    });

    ratesMarketButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (viewState.serviceType !== "lmp") return;
        viewState.marketMode = button.dataset.ratesMarket || "day_ahead";
        applyToggleState(ratesMarketButtons, viewState.marketMode, "ratesMarket");
        void reloadAll();
      });
    });

    if (ratesRefreshButton) ratesRefreshButton.addEventListener("click", () => void manualRefreshAllRateFeeds());

    if (ratesHealthBody) {
      ratesHealthBody.addEventListener("click", (event) => {
        const row = event.target.closest(".rates-health-parent");
        if (!row) return;
        const regionId = row.dataset.regionId;
        if (!regionId) return;
        if (viewState.expandedRegions.has(regionId)) viewState.expandedRegions.delete(regionId);
        else viewState.expandedRegions.add(regionId);
        renderHealthTable();
      });
    }

    window.addEventListener("scroll", hideRatesFieldTooltip, true);
    window.addEventListener("resize", hideRatesFieldTooltip);
    window.addEventListener("focus", () => {
      void fetchBackfillStatus();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void fetchBackfillStatus();
      }
    });

    if (headerProjectNameEditButton && headerProjectNameInput) {
      headerProjectNameEditButton.addEventListener("click", () => {
        setProjectNameEditorMode(true);
        headerProjectNameInput.focus();
        headerProjectNameInput.select();
      });
    }
    if (headerProjectNameSaveButton) headerProjectNameSaveButton.addEventListener("click", () => void saveProjectName());
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
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setProjectNameDisplay(currentProject?.name);
          setProjectNameEditorMode(false);
        }
      });
    }
  };

  const init = async () => {
    await supabaseService.migrateLegacyLocalData();
    const candidateProjectIds = [];
    if (isValidProjectId(requestedProjectId)) {
      candidateProjectIds.push(requestedProjectId);
    }
    const lastOpenedProjectId = supabaseService.getLastOpenedProjectId?.();
    if (isValidProjectId(lastOpenedProjectId) && !candidateProjectIds.includes(lastOpenedProjectId)) {
      candidateProjectIds.push(lastOpenedProjectId);
    }

    for (let i = 0; i < candidateProjectIds.length; i += 1) {
      const candidateId = candidateProjectIds[i];
      // eslint-disable-next-line no-await-in-loop
      const project = await withRetry(() => supabaseService.getProject(candidateId));
      if (project) {
        currentProject = project;
        break;
      }
    }

    if (!currentProject) {
      const projects = await withRetry(() => supabaseService.listProjects());
      currentProject = Array.isArray(projects) && projects.length ? projects[0] : null;
    }

    if (!currentProject) {
      window.location.href = "/";
      return;
    }

    if (requestedProjectId !== currentProject.id) {
      const canonicalUrl = `/projects/rates.html?projectId=${encodeURIComponent(currentProject.id)}`;
      window.history.replaceState({}, "", canonicalUrl);
    }

    viewState.selectedDateKey = currentProject.selectedDate || formatDateKey(new Date());
    viewState.serviceType = currentProject.ratesServiceType || "lmp";
    viewState.marketMode = currentProject.ratesMarketMode || "day_ahead";
    viewState.interval = loadPersistedInterval(currentProject.id, "hourly");
    if (viewState.serviceType === "tariff") viewState.marketMode = "tariff";
    refreshAvailableIntervals();

    applyToggleState(ratesServiceButtons, viewState.serviceType, "ratesService");
    applyToggleState(ratesMarketButtons, viewState.marketMode, "ratesMarket");
    updateMarketModeVisibility();
    setProjectNameDisplay(currentProject.name);
    setProjectNameEditorMode(false);
    startBackfillStatusPolling();

    if (ratesLocationLink) ratesLocationLink.href = `/projects/location.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (ratesGenerationLink) ratesGenerationLink.href = `/projects/generation.html?projectId=${encodeURIComponent(currentProject.id)}`;
    if (ratesStorageLink) ratesStorageLink.href = `/projects/storage.html?projectId=${encodeURIComponent(currentProject.id)}`;

    bindControls();
    syncControlStrip();
    syncLegend();
    await reloadAll();
  };

  void init();
})();
