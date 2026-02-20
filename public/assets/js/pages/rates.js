(() => {
  const RATES_PROXY_ENDPOINT = "/api/rates";
  const RATES_TIMESERIES_V2_ENDPOINT = "/api/v2/rates/timeseries";
  const WINDOW_BACK_DAYS = 30;
  const WINDOW_FORWARD_DAYS = 7;
  const RATES_CACHE_SCHEMA_VERSION = "rates_v3_ercot_live_fix";
  const RATE_CACHE_TTL_MS = {
    real_time: 5 * 60 * 1000,
    day_ahead: 60 * 60 * 1000,
    tariff: 24 * 60 * 60 * 1000,
  };
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

  const MODE_ORDER = ["real_time", "day_ahead", "tariff"];
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
  const STATUS_SCORE = { missing: 0, partial: 1, good: 2 };

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
  const ratesRefreshButton = document.getElementById("rates-refresh-button");
  const ratesMarketModeGroup = document.getElementById("rates-market-mode-group");
  const ratesMarketLabel = document.getElementById("rates-market-label");
  const ratesServiceButtons = Array.from(document.querySelectorAll("[data-rates-service]"));
  const ratesMarketButtons = Array.from(document.querySelectorAll("[data-rates-market]"));
  const ratesControlStripRoot = document.getElementById("rates-control-strip-root");
  const ratesChartLegendRoot = document.getElementById("rates-chart-legend-root");
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
    if (source.includes("modeled_fallback")) return false;
    if (reason === "source_unavailable") return false;
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
      const sourceText = viewState.lastSource ? ` Source: ${viewState.lastSource}.` : "";
      ratesEmptyWindow.textContent = `No published rates in the selected window for this mode.${sourceText}`;
    }
  };

  const sourceLooksFallback = ({ source = "", reason = "" }) => {
    const sourceText = String(source || "").toLowerCase();
    const reasonText = String(reason || "").toLowerCase();
    return (
      sourceText.includes("fallback") ||
      reasonText.includes("source_unavailable") ||
      reasonText.includes("region_not_supported")
    );
  };

  const updateSourceWarning = () => {
    if (!ratesSourceWarning) return;
    const show = sourceLooksFallback({ source: viewState.lastSource, reason: viewState.lastReason });
    ratesSourceWarning.hidden = !show;
    if (!show) return;
    const sourceText = viewState.lastSource || "fallback_modeled_source";
    ratesSourceWarning.textContent = `❌ Live market source unavailable. Showing fallback modeled rates. Source: ${sourceText}`;
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
    type: "line",
    className: "generation-chart",
    ariaLabel: "Rates time series chart",
    labels,
    scales: {
      x: {
        grid: {
          color: (context) => {
            const labelsList = context?.chart?.data?.labels || [];
            const index = Number.isFinite(context?.index) ? context.index : Number(context?.tick?.value);
            const shouldShow =
              window.EnergyCharts?.shouldShowAxisTick?.(labelsList, index) ??
              (index % Math.max(1, Math.ceil((labelsList?.length || 0) / 12)) === 0);
            return shouldShow ? "rgba(120,120,120,0.2)" : "rgba(120,120,120,0)";
          },
        },
        ticks: {
          color: "#353535",
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
        grid: { color: "rgba(120,120,120,0.2)" },
        ticks: { color: "#353535" },
        title: {
          display: true,
          text: `Rate (${getDisplayUnitLabel()})`,
          color: "#2d2d2d",
          font: { weight: "700" },
        },
      },
    },
    datasets: [
      {
        label: "Rate",
        data: values,
        borderColor: "#000000",
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
  };

  const summarizeRegionRows = (rows) => {
    const status = rows.reduce((acc, row) =>
      STATUS_SCORE[row.status] < STATUS_SCORE[acc] ? row.status : acc,
    "good");
    const expectedHours = rows.reduce((sum, row) => sum + Number(row.expectedHours || 0), 0);
    const missingHours = rows.reduce((sum, row) => sum + Number(row.missingHours || 0), 0);
    const latest = rows.reduce((max, row) => {
      const ts = new Date(row.lastUpdatedAt || 0).getTime();
      return ts > max ? ts : max;
    }, 0);
    return {
      status,
      expectedHours,
      missingHours,
      lastUpdatedAt: latest ? new Date(latest).toISOString() : null,
    };
  };

  const formatSourceCell = (row) => {
    const source = row?.source || "--";
    const reason = row?.details?.reason || "";
    const isFallback = sourceLooksFallback({ source, reason });
    if (!isFallback) return source;
    return `<span class="rates-source--fallback">❌ ${source}</span>`;
  };

  const renderHealthTable = () => {
    if (!ratesHealthBody) return;
    const rows = Array.isArray(viewState.healthRows) ? viewState.healthRows : [];
    if (!rows.length) {
      ratesHealthBody.innerHTML = '<tr><td colspan="7">No status data yet.</td></tr>';
      return;
    }

    const grouped = rows.reduce((acc, row) => {
      const key = row.regionId || "UNKNOWN";
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});

    ratesHealthBody.innerHTML = Object.entries(grouped)
      .map(([regionId, regionRows]) => {
        const regionLabel = regionRows[0]?.regionLabel || regionId;
        const summary = summarizeRegionRows(regionRows);
        const coverage = `${Math.max(0, summary.expectedHours - summary.missingHours)}/${summary.expectedHours}`;
        const isExpanded = viewState.expandedRegions.has(regionId);
        const summaryFallback = regionRows.find((row) =>
          sourceLooksFallback({ source: row?.source, reason: row?.details?.reason })
        );
        const summarySource = summaryFallback?.source || regionRows.find((row) => row.source)?.source || "--";
        const summaryReason = summaryFallback?.details?.reason || "";
        const summarySourceUnit = regionRows.find((row) => row.sourceUnit)?.sourceUnit || "--";
        const sortedRows = MODE_ORDER.map((mode) => regionRows.find((row) => row.marketMode === mode)).filter(Boolean);
        const parent = `
          <tr class="rates-health-parent" data-region-id="${regionId}">
            <td>
              <span class="rates-health-parent__region">
                <span class="rates-health-parent__caret">${isExpanded ? "v" : ">"}</span>
                ${regionLabel}
              </span>
            </td>
            <td>All</td>
            <td><span class="rates-status rates-status--${summary.status}">${summary.status}</span></td>
            <td>${formatTimestamp(summary.lastUpdatedAt)}</td>
            <td>${formatSourceCell({ source: summarySource, details: { reason: summaryReason } })}</td>
            <td>${summarySourceUnit}</td>
            <td>${coverage}</td>
          </tr>
        `;

        if (!isExpanded) return parent;

        const subRows = sortedRows
          .map((row) => {
            const subCoverage = `${Math.max(0, row.expectedHours - row.missingHours)}/${row.expectedHours}`;
            const reason = row?.details?.reason ? `Reason: ${row.details.reason}` : "";
            return `
              <tr class="rates-health-subrow" data-region-id="${regionId}">
                <td>${MODE_LABEL[row.marketMode] || row.marketMode}</td>
                <td>${row.serviceType.toUpperCase()}</td>
                <td><span class="rates-status rates-status--${row.status}" title="${reason}">${row.status}</span></td>
                <td>${formatTimestamp(row.lastUpdatedAt)}</td>
                <td>${formatSourceCell(row)}</td>
                <td>${row.sourceUnit || "--"}</td>
                <td>${subCoverage}</td>
              </tr>
            `;
          })
          .join("");

        return parent + subRows;
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

    if (!forceRefresh) {
      const cached = await supabaseService.getRateSeriesCache(currentProject.id, cacheKey);
      const cachedAt = new Date(cached?.fetched_at || 0).getTime();
      const ttl = RATE_CACHE_TTL_MS[marketMode] || RATE_CACHE_TTL_MS.day_ahead;
      const cacheSchema = cached?.payload?.metadata?.cacheSchemaVersion || "";
      if (
        cached?.payload?.points &&
        cacheSchema === RATES_CACHE_SCHEMA_VERSION &&
        Number.isFinite(cachedAt) &&
        Date.now() - cachedAt <= ttl
      ) {
        const cachedPoints = sanitizePoints(cached.payload.points);
        const cachedUnit = cached?.payload?.metadata?.unit || "";
        const cachedSourceUnit = cached?.payload?.metadata?.sourceUnit || "";
        viewState.apiVersion = cached?.payload?.metadata?.apiVersion || "v2";
        viewState.qualityStatus = cached?.payload?.metadata?.qualityStatus || "unknown";
        viewState.lastSource = cached?.payload?.metadata?.source || "";
        viewState.lastReason = cached?.payload?.metadata?.details?.reason || "";
        viewState.lastFetchedAt = cached?.payload?.metadata?.fetchedAt || cached?.fetched_at || null;
        const resolvedSourceUnit = resolveSourceUnit({
          sourceUnit: cachedSourceUnit,
          unit: cachedUnit,
          serviceType: viewState.serviceType,
          points: cachedPoints,
        });
        const repaired = repairLikelyLegacyLmpScale({
          points: cachedPoints,
          serviceType: viewState.serviceType,
          sourceUnit: resolvedSourceUnit,
        });
        const repairedMwhLabel = repairLikelyMislabeledLmpMwh({
          points: repaired.points,
          serviceType: viewState.serviceType,
          sourceUnit: repaired.sourceUnit,
        });
        viewState.sourceUnit = repairedMwhLabel.sourceUnit;
        viewState.rawPoints = repairedMwhLabel.points;
        refreshAvailableIntervals();
        if (repaired.repaired) {
          console.warn("Repaired legacy LMP cache scale by x1000 (USD/kWh).");
        }
        if (repairedMwhLabel.repaired) {
          console.warn("Repaired mislabeled legacy LMP cache source unit (USD/MWh -> USD/kWh).");
        }
        if (!suppressRender) renderChart();
        return;
      }
    }

    const ratesUrl = buildUrl(RATES_TIMESERIES_V2_ENDPOINT, {
      lat: currentProject.lat,
      lng: currentProject.lng,
      serviceType: viewState.serviceType,
      marketMode,
      start: windowStart,
      end: windowEnd,
    });
    let response = await fetch(ratesUrl, { cache: "no-store" });
    if (!response.ok && response.status === 404) {
      const legacyUrl = buildUrl(`${RATES_PROXY_ENDPOINT}/timeseries`, {
        lat: currentProject.lat,
        lng: currentProject.lng,
        serviceType: viewState.serviceType,
        marketMode,
        start: windowStart,
        end: windowEnd,
      });
      response = await fetch(legacyUrl, { cache: "no-store" });
    }
    if (!response.ok) throw new Error("Failed to retrieve rate timeseries.");
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
    viewState.lastSource = metadata.source || "";
    viewState.lastReason = metadata?.details?.reason || "";
    viewState.lastFetchedAt = metadata.fetchedAt || new Date().toISOString();
    viewState.rawPoints = repairedMwhLabel.points;
    refreshAvailableIntervals();
    if (shouldPersistRateCache(metadata)) {
      await supabaseService.upsertRateSeriesCache({
        projectId: currentProject.id,
        regionId: payload?.metadata?.regionId || viewState.regionId || "NON-ISO",
        serviceType: viewState.serviceType,
        marketMode,
        windowStart,
        windowEnd,
        timezone: payload?.metadata?.timezone || viewState.timezone || "UTC",
        source: payload?.metadata?.source || "rates_proxy_phase2",
        sourceUnit: repairedMwhLabel.sourceUnit,
        qualityStatus: metadata.qualityStatus || "unknown",
        apiVersion: metadata.apiVersion || "v2",
        ingestNotes: {
          reason: metadata?.details?.reason || null,
          fetchedFrom: "timeseries",
        },
        fetchedAt: payload?.metadata?.fetchedAt || new Date().toISOString(),
        payload: {
          points: repairedPayload.points,
          missingIntervals: payload?.missingIntervals || [],
          metadata: {
            ...(payload?.metadata || {}),
            cacheSchemaVersion: RATES_CACHE_SCHEMA_VERSION,
            apiVersion: metadata.apiVersion || "v2",
            qualityStatus: metadata.qualityStatus || "unknown",
            unit: payload?.metadata?.unit || repairedMwhLabel.sourceUnit,
            sourceUnit:
              payload?.metadata?.sourceUnit || payload?.metadata?.unit || repairedMwhLabel.sourceUnit,
          },
        },
      });
    } else {
      console.warn("Skipping rate cache write for fallback/unavailable source response.");
    }
    const missingHours = repairedMwhLabel.points.reduce((sum, point) => (point?.value == null ? sum + 1 : sum), 0);
    void supabaseService
      .insertRateIngestRun({
        projectId: currentProject.id,
        regionId: payload?.metadata?.regionId || viewState.regionId || "NON-ISO",
        serviceType: viewState.serviceType,
        marketMode,
        source: payload?.metadata?.source || "rates_proxy_phase2",
        sourceUnit: repairedMwhLabel.sourceUnit,
        apiVersion: metadata.apiVersion || "v2",
        status: missingHours > 0 ? "partial" : "success",
        rowCount: repairedMwhLabel.points.length,
        missingHours,
        message: metadata?.details?.reason || null,
        details: {
          qualityStatus: metadata?.qualityStatus || null,
        },
        windowStart,
        windowEnd,
        runStartedAt: metadata?.fetchedAt || new Date().toISOString(),
        runFinishedAt: new Date().toISOString(),
      })
      .catch(() => {});
    if (!suppressRender) renderChart();
  };

  const fetchHealth = async () => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) return;
    const { start, end } = buildActiveWindow();
    const windowStart = start.toISOString();
    const windowEnd = end.toISOString();
    const fetchHealthRows = async (serviceType) => {
      const healthUrl = buildUrl(`${RATES_PROXY_ENDPOINT}/health`, {
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
      return {
        ...row,
        source: viewState.lastSource || row.source,
        sourceUnit: viewState.sourceUnit || row.sourceUnit,
        lastUpdatedAt: viewState.lastFetchedAt || row.lastUpdatedAt,
        details,
      };
    });
    viewState.healthRows = mergedRows;
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
      await fetchRatesSeries({ forceRefresh });
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

      if (typeof supabaseService.clearRateSeriesCache === "function") {
        await Promise.all(
          RATE_FEED_PLAN.map((feed) =>
            supabaseService.clearRateSeriesCache(currentProject.id, {
              regionId: viewState.regionId || undefined,
              serviceType: feed.serviceType,
              marketMode: feed.marketMode,
              windowStart,
              windowEnd,
            })
          )
        );
      }

      await fetch(`${RATES_PROXY_ENDPOINT}/refresh`, { cache: "no-store" }).catch(() => {});

      for (const feed of RATE_FEED_PLAN) {
        viewState.serviceType = feed.serviceType;
        viewState.marketMode = feed.marketMode;
        // Force API fetch for every feed; skip intermediate re-renders.
        // eslint-disable-next-line no-await-in-loop
        await fetchRatesSeries({ forceRefresh: true, suppressRender: true });
      }

      viewState.serviceType = originalServiceType;
      viewState.marketMode = originalMarketMode;
      applyToggleState(ratesServiceButtons, viewState.serviceType, "ratesService");
      applyToggleState(ratesMarketButtons, viewState.marketMode, "ratesMarket");
      updateMarketModeVisibility();

      await fetchRatesSeries({ forceRefresh: false });
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
