(() => {
  const RATE_TYPES = Object.freeze([
    { key: "residential", title: "Residential", seriesLabel: "Residential Rate", color: "#6ea8ff", enabled: false },
    {
      key: "commercial_day_ahead",
      title: "Commercial - Day Ahead",
      seriesLabel: "Commercial DA Rate",
      color: "#f1b24a",
      enabled: true,
    },
    {
      key: "commercial_realtime",
      title: "Commercial - Realtime",
      seriesLabel: "Commercial RT Rate",
      color: "#69d07f",
      enabled: true,
    },
  ]);

  const RATE_TYPE_LOOKUP = RATE_TYPES.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});

  const PERIODS = Object.freeze(["day", "week", "month"]);
  const PERIOD_LABELS = Object.freeze({ day: "Day", week: "Week", month: "Month" });
  const INTERVALS_RT = Object.freeze(["five_min", "half_hour", "hourly"]);
  const INTERVALS_BY_PERIOD_RT = Object.freeze({
    day: INTERVALS_RT,
    week: INTERVALS_RT,
    month: Object.freeze(["hourly"]),
  });
  const INTERVALS_BY_PERIOD_DA = Object.freeze({
    day: Object.freeze(["hourly"]),
    week: Object.freeze(["hourly"]),
    month: Object.freeze(["hourly"]),
  });
  const INTERVAL_LABELS = Object.freeze({
    five_min: "5 min",
    half_hour: "30 min",
    hourly: "Hourly",
  });

  const V4_RATES_ENDPOINT = "/api/v4/rates/series";
  const cacheEngine = window.EnergyRatesV4CacheEngine;
  const CACHE_SCHEMA = "rates_v4_rt_cache_v1";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const LOADING_MAX_MS = 5000;
  const RT_TAIL_REFRESH_MS = 5 * 60 * 1000;
  const DA_TAIL_REFRESH_MS = 30 * 60 * 1000;
  const RT_TAIL_LOOKBACK_MS = 6 * 60 * 60 * 1000;
  const DA_TAIL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
  const STATUS_LABELS = Object.freeze(["Fetching OASIS data..."]);

  const supabaseService = window.EnergySupabaseService;
  const queryParams = new URLSearchParams(window.location.search);
  const requestedProjectId = queryParams.get("projectId");
  const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

  const headerProjectNameInput = document.getElementById("rates-v4-header-project-name");
  const headerProjectNameDisplay = document.getElementById("rates-v4-header-project-name-display");
  const headerProjectNameEditButton = document.getElementById("rates-v4-header-project-name-edit");
  const headerProjectNameSaveButton = document.getElementById("rates-v4-header-project-name-save");
  const headerProjectNameCancelButton = document.getElementById("rates-v4-header-project-name-cancel");

  const locationLink = document.getElementById("rates-v4-location-link");
  const generationLink = document.getElementById("rates-v4-generation-link");
  const storageLink = document.getElementById("rates-v4-storage-link");
  const prototypeRatesLink = document.getElementById("rates-v4-rates-prototype-link");

  const rateCards = Array.from(document.querySelectorAll("[data-rate-type]"));
  const fetchButtons = Array.from(document.querySelectorAll("[data-rate-fetch]"));
  const chartTitle = document.getElementById("rates-v4-chart-title");
  const controlStripRoot = document.getElementById("rates-v4-control-strip-root");
  const legendRoot = document.getElementById("rates-v4-chart-legend-root");
  const chartRoot = document.getElementById("rates-v4-chart-root");
  const ratesMissingOverlay = document.getElementById("rates-v4-missing-overlay");
  const axis = document.getElementById("rates-v4-axis");

  let chartBridge = null;
  let controlBridge = null;
  let legendBridge = null;
  let currentProject = null;

  const rateLimitState = {
    pauseUntilMs: 0,
    message: "Rate limited.",
  };

  const schedulerState = {
    tailTimer: null,
  };

  const loadingState = {
    activeRateType: null,
    progressTimer: null,
    labelTimer: null,
    startedAtMs: 0,
    labelIndex: 0,
    isStalled: false,
    countdownTimer: null,
  };

  const requestState = {
    byRateType: {
      commercial_realtime: { requestId: 0, controller: null },
      commercial_day_ahead: { requestId: 0, controller: null },
    },
  };

  const dataState = {
    timezone: "UTC",
    byRateType: {
      commercial_realtime: {
        cachePartition: null,
        windowStartIso: null,
        windowEndIso: null,
        series: {
          five_min: [],
          half_hour: [],
          hourly: [],
        },
        fetchedAt: null,
      },
      commercial_day_ahead: {
        cachePartition: null,
        windowStartIso: null,
        windowEndIso: null,
        series: {
          five_min: [],
          half_hour: [],
          hourly: [],
        },
        fetchedAt: null,
      },
    },
  };

  const viewState = {
    rateType: "commercial_realtime",
    period: "week",
    interval: "hourly",
    selectedDateKey: null,
    legend: {
      rate: true,
      missing: true,
    },
  };

  function getRateState(rateType = viewState.rateType) {
    if (!dataState.byRateType[rateType]) {
      dataState.byRateType[rateType] = {
        cachePartition: null,
        windowStartIso: null,
        windowEndIso: null,
        series: {
          five_min: [],
          half_hour: [],
          hourly: [],
        },
        fetchedAt: null,
      };
    }
    return dataState.byRateType[rateType];
  }

  function toDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseDateKey(value) {
    const [y, m, d] = String(value || "").split("-").map(Number);
    if (![y, m, d].every(Number.isFinite)) return null;
    return { y, m, d };
  }

  function addDaysYmd({ y, m, d }, delta) {
    const temp = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    temp.setUTCDate(temp.getUTCDate() + delta);
    return {
      y: temp.getUTCFullYear(),
      m: temp.getUTCMonth() + 1,
      d: temp.getUTCDate(),
    };
  }

  function formatShortDate(dateLike) {
    const d = new Date(dateLike);
    return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  }

  function getTzParts(dateLike, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(dateLike));
    const map = {};
    parts.forEach((part) => {
      map[part.type] = part.value;
    });
    return {
      y: Number(map.year),
      m: Number(map.month),
      d: Number(map.day),
      hh: Number(map.hour),
      mm: Number(map.minute),
      ss: Number(map.second),
    };
  }

  function tzOffsetMsAt(utcMs, timeZone) {
    const p = getTzParts(new Date(utcMs), timeZone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    return asUtc - utcMs;
  }

  function zonedDateTimeToUtcIso({ y, m, d, hh = 0, mm = 0, ss = 0 }, timeZone) {
    let guess = Date.UTC(y, m - 1, d, hh, mm, ss);
    for (let i = 0; i < 2; i += 1) {
      const offset = tzOffsetMsAt(guess, timeZone);
      guess = Date.UTC(y, m - 1, d, hh, mm, ss) - offset;
    }
    return new Date(guess).toISOString();
  }

  function todayDateKeyForTimezone(timeZone) {
    const p = getTzParts(new Date(), timeZone);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }

  function resolveRollingWindow(period, selectedDateKey, timeZone) {
    const ymd = parseDateKey(selectedDateKey);
    if (!ymd) return null;

    if (period === "day") {
      const startIso = zonedDateTimeToUtcIso({ ...ymd, hh: 0, mm: 0, ss: 0 }, timeZone);
      const endIso = zonedDateTimeToUtcIso({ ...ymd, hh: 23, mm: 59, ss: 59 }, timeZone);
      return { startIso, endIso };
    }

    if (period === "week") {
      const startYmd = addDaysYmd(ymd, -6);
      const endYmd = addDaysYmd(ymd, 1);
      return {
        startIso: zonedDateTimeToUtcIso({ ...startYmd, hh: 0, mm: 0, ss: 0 }, timeZone),
        endIso: zonedDateTimeToUtcIso({ ...endYmd, hh: 23, mm: 59, ss: 59 }, timeZone),
      };
    }

    const startYmd = addDaysYmd(ymd, -29);
    const endYmd = addDaysYmd(ymd, 1);
    return {
      startIso: zonedDateTimeToUtcIso({ ...startYmd, hh: 0, mm: 0, ss: 0 }, timeZone),
      endIso: zonedDateTimeToUtcIso({ ...endYmd, hh: 23, mm: 59, ss: 59 }, timeZone),
    };
  }

  function resolveWindowReadout(period, selectedDateKey, timeZone) {
    const range = resolveRollingWindow(period, selectedDateKey, timeZone);
    if (!range) return "--";
    const start = new Date(range.startIso);
    const end = new Date(range.endIso);
    return `${formatShortDate(start)} - ${formatShortDate(end)}`;
  }

  function getLocationCoordinates(project) {
    return {
      lat: Number(project?.location_lat ?? project?.lat),
      lng: Number(project?.location_lng ?? project?.lng),
    };
  }

  function buildCachePartition(rateType = viewState.rateType) {
    if (!cacheEngine || !currentProject?.id) return null;
    const coords = getLocationCoordinates(currentProject);
    const locationFingerprint = cacheEngine.buildLocationFingerprint(coords);
    return cacheEngine.buildPartition({
      projectId: currentProject.id,
      rateType,
      timezone: dataState.timezone,
      locationFingerprint,
    });
  }

  function loadCacheStore(rateType = viewState.rateType) {
    const partition = buildCachePartition(rateType);
    if (!partition || !cacheEngine) return null;
    const rateState = getRateState(rateType);
    rateState.cachePartition = partition;
    return cacheEngine.loadStore(window.localStorage, partition);
  }

  function saveCacheStore(store) {
    if (!cacheEngine || !store) return null;
    return cacheEngine.saveStore(window.localStorage, store);
  }

  function applySeriesPayload(rateType, payload) {
    if (!payload?.series) return;
    const rateState = getRateState(rateType);
    rateState.windowStartIso = payload.windowStart || null;
    rateState.windowEndIso = payload.windowEnd || null;
    rateState.fetchedAt = payload.fetchedAt || new Date().toISOString();
    rateState.series = {
      five_min: Array.isArray(payload.series.five_min) ? payload.series.five_min : [],
      half_hour: Array.isArray(payload.series.half_hour) ? payload.series.half_hour : [],
      hourly: Array.isArray(payload.series.hourly) ? payload.series.hourly : [],
    };
  }

  function getSeriesForActiveInterval() {
    const rateState = getRateState(viewState.rateType);
    const baseSeries =
      viewState.interval === "five_min"
        ? rateState.series.five_min
        : viewState.interval === "half_hour"
          ? rateState.series.half_hour
          : rateState.series.hourly;
    return densifySeriesToWindow(baseSeries, rateState.windowStartIso, rateState.windowEndIso, viewState.interval);
  }

  function resolveIntervalStepMs(intervalKey) {
    if (intervalKey === "five_min") return 5 * 60 * 1000;
    if (intervalKey === "half_hour") return 30 * 60 * 1000;
    return 60 * 60 * 1000;
  }

  function densifySeriesToWindow(series, windowStartIso, windowEndIso, intervalKey) {
    const rows = Array.isArray(series) ? series : [];
    const startMs = Date.parse(String(windowStartIso || ""));
    const endMs = Date.parse(String(windowEndIso || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return rows;

    const stepMs = resolveIntervalStepMs(intervalKey);
    const byTs = new Map();
    rows.forEach((point) => {
      const tsMs = Date.parse(String(point?.ts || ""));
      if (!Number.isFinite(tsMs)) return;
      byTs.set(tsMs, {
        ts: new Date(tsMs).toISOString(),
        value: point?.value == null ? null : Number(point.value),
        isForecast: Boolean(point?.isForecast),
        missingReason: point?.missingReason || null,
      });
    });

    const dense = [];
    const firstMs = Math.floor(startMs / stepMs) * stepMs;
    for (let cursor = firstMs; cursor <= endMs; cursor += stepMs) {
      if (cursor < startMs) continue;
      const existing = byTs.get(cursor);
      dense.push(
        existing || {
          ts: new Date(cursor).toISOString(),
          value: null,
          isForecast: false,
          missingReason: "No cached points in window bucket.",
        }
      );
    }
    return dense;
  }

  function supportsFetchForRateType(rateType) {
    return rateType === "commercial_realtime" || rateType === "commercial_day_ahead";
  }

  function setStatusForCard(rateType, { visible, text, progressPct }) {
    const container = document.querySelector(`[data-rate-status="${rateType}"]`);
    const textEl = document.querySelector(`[data-rate-status-text="${rateType}"]`);
    const barEl = document.querySelector(`[data-rate-status-bar="${rateType}"]`);
    if (!container || !textEl || !barEl) return;
    const isActiveCard = viewState.rateType === rateType;
    container.hidden = !(visible && isActiveCard);
    textEl.textContent = text || "";
    const pct = Math.max(0, Math.min(100, Number(progressPct) || 0));
    barEl.style.width = `${pct}%`;
  }

  function setFetchButtonState(rateType, disabled) {
    const button = document.querySelector(`[data-rate-fetch="${rateType}"]`);
    if (!button) return;
    button.disabled = Boolean(disabled);
  }

  function getRateLimitRemainingSeconds() {
    const remainingMs = rateLimitState.pauseUntilMs - Date.now();
    if (remainingMs <= 0) return 0;
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  function hasGlobalRateLimitPause() {
    return getRateLimitRemainingSeconds() > 0;
  }

  function setGlobalRateLimitPause(seconds, message) {
    const remainingSeconds = Math.max(1, Number(seconds) || 5);
    rateLimitState.pauseUntilMs = Date.now() + remainingSeconds * 1000;
    rateLimitState.message = String(message || "Rate limited.");
  }

  function resolveTailRefreshSpan(rateType, range) {
    const startMs = Date.parse(String(range?.startIso || ""));
    const endMs = Date.parse(String(range?.endIso || ""));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

    const lookbackMs = rateType === "commercial_day_ahead" ? DA_TAIL_LOOKBACK_MS : RT_TAIL_LOOKBACK_MS;
    const nowMs = Date.now();
    const tailStartMs = nowMs - lookbackMs;
    const spanStartMs = Math.max(startMs, tailStartMs);
    const spanEndMs = Math.min(endMs, nowMs);
    if (spanEndMs <= spanStartMs) return null;

    return {
      startIso: new Date(spanStartMs).toISOString(),
      endIso: new Date(spanEndMs).toISOString(),
    };
  }

  function resolveTailRefreshCadenceMs(rateType) {
    return rateType === "commercial_day_ahead" ? DA_TAIL_REFRESH_MS : RT_TAIL_REFRESH_MS;
  }

  function clearTailRefreshScheduler() {
    if (schedulerState.tailTimer) {
      window.clearInterval(schedulerState.tailTimer);
      schedulerState.tailTimer = null;
    }
  }

  function startTailRefreshScheduler() {
    clearTailRefreshScheduler();
    const cadenceMs = resolveTailRefreshCadenceMs(viewState.rateType);
    schedulerState.tailTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (!supportsFetchForRateType(viewState.rateType)) return;
      void refreshActiveRateWindow({ forceRemote: false, tailRefresh: true });
    }, cadenceMs);
  }

  function bindLifecycleEvents() {
    window.addEventListener("beforeunload", () => {
      clearTailRefreshScheduler();
      clearLoadingTimers();
      abortInFlightForRateType("commercial_realtime");
      abortInFlightForRateType("commercial_day_ahead");
    });
  }

  function clearLoadingTimers() {
    if (loadingState.progressTimer) {
      window.clearInterval(loadingState.progressTimer);
      loadingState.progressTimer = null;
    }
    if (loadingState.labelTimer) {
      window.clearInterval(loadingState.labelTimer);
      loadingState.labelTimer = null;
    }
    if (loadingState.countdownTimer) {
      window.clearInterval(loadingState.countdownTimer);
      loadingState.countdownTimer = null;
    }
  }

  function abortInFlightForRateType(rateType) {
    const state = requestState.byRateType[rateType];
    if (!state?.controller) return;
    try {
      state.controller.abort();
    } catch (_error) {
      // no-op
    }
    state.controller = null;
  }

  function beginRateRequest(rateType) {
    const state = requestState.byRateType[rateType] || { requestId: 0, controller: null };
    requestState.byRateType[rateType] = state;
    abortInFlightForRateType(rateType);
    state.requestId += 1;
    state.controller = new AbortController();
    return {
      requestId: state.requestId,
      signal: state.controller.signal,
    };
  }

  function isRequestStale(rateType, requestId) {
    const state = requestState.byRateType[rateType];
    if (!state) return true;
    return state.requestId !== requestId;
  }

  function finalizeRateRequest(rateType, requestId) {
    const state = requestState.byRateType[rateType];
    if (!state || state.requestId !== requestId) return;
    state.controller = null;
  }

  function resolveRateLimitMessage(payload, fallback = "Rate limited.") {
    return String(payload?.details?.upstreamError || payload?.errors?.[0] || fallback);
  }

  function startLoadingAnimation(rateType) {
    clearLoadingTimers();
    loadingState.activeRateType = rateType;
    loadingState.startedAtMs = Date.now();
    loadingState.labelIndex = 0;
    loadingState.isStalled = false;

    setFetchButtonState(rateType, true);
    setStatusForCard(rateType, {
      visible: true,
      text: STATUS_LABELS[0],
      progressPct: 3,
    });

    loadingState.labelTimer = window.setInterval(() => {
      if (!loadingState.activeRateType) return;
      loadingState.labelIndex = (loadingState.labelIndex + 1) % STATUS_LABELS.length;
      const elapsed = Date.now() - loadingState.startedAtMs;
      const progress = elapsed >= LOADING_MAX_MS ? 95 : Math.min(95, 95 * Math.pow(elapsed / LOADING_MAX_MS, 0.9));
      setStatusForCard(rateType, {
        visible: true,
        text: STATUS_LABELS[loadingState.labelIndex],
        progressPct: progress,
      });
    }, 2000);

    loadingState.progressTimer = window.setInterval(() => {
      if (!loadingState.activeRateType) return;
      const elapsed = Date.now() - loadingState.startedAtMs;
      const progress = elapsed >= LOADING_MAX_MS ? 95 : Math.min(95, 95 * Math.pow(elapsed / LOADING_MAX_MS, 0.9));
      setStatusForCard(rateType, {
        visible: true,
        text: STATUS_LABELS[loadingState.labelIndex],
        progressPct: progress,
      });
    }, 120);
  }

  function stopLoadingAnimation(rateType, { hide = true, text = "Data ready.", progressPct = 100 } = {}) {
    clearLoadingTimers();
    loadingState.activeRateType = null;
    if (hide) {
      setStatusForCard(rateType, { visible: false, text: "", progressPct: 0 });
    } else {
      setStatusForCard(rateType, { visible: true, text, progressPct });
    }
    setFetchButtonState(rateType, false);
  }

  function start429Countdown(rateType, seconds, message) {
    clearLoadingTimers();
    loadingState.activeRateType = rateType;
    setFetchButtonState(rateType, true);
    let remaining = Math.max(1, Number(seconds) || 5);
    setStatusForCard(rateType, {
      visible: true,
      text: `${message} Try again in ${remaining}s`,
      progressPct: 95,
    });

    loadingState.countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(loadingState.countdownTimer);
        loadingState.countdownTimer = null;
        setStatusForCard(rateType, {
          visible: true,
          text: "Rate limit wait complete. You can fetch again.",
          progressPct: 95,
        });
        setFetchButtonState(rateType, false);
        return;
      }
      setStatusForCard(rateType, {
        visible: true,
        text: `${message} Try again in ${remaining}s`,
        progressPct: 95,
      });
    }, 1000);
  }

  function updateCards() {
    rateCards.forEach((card) => {
      const rateType = card.dataset.rateType;
      const active = rateType === viewState.rateType;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));

      const fetchButton = card.querySelector(".rates-v4-fetch-button");
      if (fetchButton) {
        fetchButton.hidden = !(active && supportsFetchForRateType(rateType));
      }

      const statusEl = card.querySelector(".rates-v4-card-status");
      if (statusEl && (!active || loadingState.activeRateType !== rateType)) {
        statusEl.hidden = true;
      }
    });
  }

  function getIntervalsForPeriod(period) {
    if (viewState.rateType === "commercial_day_ahead") {
      return INTERVALS_BY_PERIOD_DA[period] || INTERVALS_BY_PERIOD_DA.week;
    }
    return INTERVALS_BY_PERIOD_RT[period] || INTERVALS_RT;
  }

  function normalizeIntervalForPeriod() {
    const allowed = getIntervalsForPeriod(viewState.period);
    if (!allowed.includes(viewState.interval)) {
      viewState.interval = allowed[allowed.length - 1] || "hourly";
    }
  }

  function buildControlStripProps() {
    normalizeIntervalForPeriod();
    const intervalOptions = getIntervalsForPeriod(viewState.period);

    const groups = [
      {
        key: "period",
        label: "Period",
        buttons: PERIODS.map((periodKey) => ({
          key: periodKey,
          label: PERIOD_LABELS[periodKey],
          active: viewState.period === periodKey,
          dataAttr: { "data-rates-v4-period": periodKey },
          onClick: () => {
            if (viewState.period === periodKey) return;
            viewState.period = periodKey;
            normalizeIntervalForPeriod();
            void refreshActiveRateWindow({ forceRemote: false });
            render();
          },
        })),
      },
      {
        key: "interval",
        label: "Interval",
        buttons: intervalOptions.map((intervalKey) => ({
          key: intervalKey,
          label: INTERVAL_LABELS[intervalKey],
          active: viewState.interval === intervalKey,
          dataAttr: { "data-rates-v4-interval": intervalKey },
          onClick: () => {
            if (viewState.interval === intervalKey) return;
            viewState.interval = intervalKey;
            renderChart();
            if (controlBridge) controlBridge.update(buildControlStripProps());
          },
        })),
      },
    ];

    return {
      groups,
      rightGroupKeys: ["interval"],
      selectedDateKey: viewState.selectedDateKey || toDateKey(new Date()),
      onDateChange: (nextDateKey) => {
        if (!parseDateKey(nextDateKey)) return;
        viewState.selectedDateKey = nextDateKey;
        void refreshActiveRateWindow({ forceRemote: false });
        if (controlBridge) controlBridge.update(buildControlStripProps());
      },
      onShift: (direction) => {
        const ymd = parseDateKey(viewState.selectedDateKey || toDateKey(new Date()));
        if (!ymd) return;
        const delta = viewState.period === "day" ? direction : viewState.period === "week" ? direction * 7 : direction * 30;
        const shifted = addDaysYmd(ymd, delta);
        viewState.selectedDateKey = `${shifted.y}-${String(shifted.m).padStart(2, "0")}-${String(shifted.d).padStart(2, "0")}`;
        void refreshActiveRateWindow({ forceRemote: false });
        if (controlBridge) controlBridge.update(buildControlStripProps());
      },
      dateRangeText: resolveWindowReadout(viewState.period, viewState.selectedDateKey || toDateKey(new Date()), dataState.timezone),
    };
  }

  function buildLegendProps() {
    const cfg = RATE_TYPE_LOOKUP[viewState.rateType] || RATE_TYPES[0];
    return {
      items: [
        {
          key: "rate",
          label: cfg.title,
          className: "legend--total",
          active: Boolean(viewState.legend.rate),
          onToggle: () => {
            viewState.legend.rate = !viewState.legend.rate;
            renderChart();
            if (legendBridge) legendBridge.update(buildLegendProps());
          },
        },
        {
          key: "missing",
          label: "Missing data",
          className: "legend--missing",
          active: Boolean(viewState.legend.missing),
          onToggle: () => {
            viewState.legend.missing = !viewState.legend.missing;
            renderChart();
            if (legendBridge) legendBridge.update(buildLegendProps());
          },
        },
      ],
    };
  }

  function resolveChartMinY(rows) {
    const values = (Array.isArray(rows) ? rows : [])
      .map((point) => Number(point?.value))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return 0;
    const min = Math.min(...values);
    if (min >= 0) return 0;
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    return Number((min - padding).toFixed(3));
  }
  function buildChartData() {
    const rows = getSeriesForActiveInterval();
    const cfg = RATE_TYPE_LOOKUP[viewState.rateType];
    const rateState = getRateState(viewState.rateType);

    const labels = rows.map((point) => {
      const ts = new Date(point.ts);
      if (viewState.interval === "hourly") return ts.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric" });
      return ts.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    });

    const data = rows.map((point) => (point?.value == null ? null : Number(point.value)));
    const minY = resolveChartMinY(rows);

    return {
      rows,
      labels,
      datasets: [
        {
          label: cfg.seriesLabel,
          data,
          borderColor: cfg.color,
          pointRadius: 0,
          tension: 0.2,
          spanGaps: false,
          hidden: !viewState.legend.rate,
        },
      ],
      minY,
      axisText:
        rateState.windowStartIso && rateState.windowEndIso
          ? `${INTERVAL_LABELS[viewState.interval]} • ${formatShortDate(rateState.windowStartIso)} - ${formatShortDate(
              rateState.windowEndIso
            )}`
          : `${INTERVAL_LABELS[viewState.interval]} interval`,
    };
  }

  function renderMissingBands(rows) {
    if (!ratesMissingOverlay) return;
    ratesMissingOverlay.innerHTML = "";
    if (!viewState.legend.missing) return;

    const series = Array.isArray(rows) ? rows : [];
    const total = series.length;
    if (!total) return;

    const canvas = chartRoot?.querySelector?.("canvas");
    const chart = canvas && window.Chart?.getChart ? window.Chart.getChart(canvas) : null;
    const chartArea = chart?.chartArea || null;
    const xScale = chart?.scales?.x || null;

    const useChartGeometry =
      Boolean(chartArea) &&
      Boolean(xScale) &&
      Number.isFinite(chartArea.left) &&
      Number.isFinite(chartArea.right) &&
      chartArea.right > chartArea.left;

    const pixelForIndex = (index) => {
      if (!useChartGeometry) return 0;
      const pixel = Number(xScale.getPixelForValue(index));
      return Number.isFinite(pixel) ? pixel : 0;
    };

    let start = -1;
    for (let i = 0; i < total; i += 1) {
      const isMissing = series[i]?.value == null;
      if (isMissing && start < 0) start = i;
      const isEnd = !isMissing || i === total - 1;
      if (start >= 0 && isEnd) {
        const endIndex = isMissing && i === total - 1 ? i : i - 1;
        const band = document.createElement("span");
        band.className = "rates-missing-band";
        band.title = "Missing data";

        if (useChartGeometry) {
          const startPx = pixelForIndex(start);
          const endPx = pixelForIndex(endIndex);
          const prevPx = start > 0 ? pixelForIndex(start - 1) : startPx - (pixelForIndex(Math.min(start + 1, total - 1)) - startPx || 0);
          const nextPx =
            endIndex < total - 1
              ? pixelForIndex(endIndex + 1)
              : endPx + (endPx - pixelForIndex(Math.max(endIndex - 1, 0)) || 0);

          const left = Math.max(chartArea.left, Math.min(chartArea.right, (startPx + prevPx) / 2));
          const right = Math.max(chartArea.left, Math.min(chartArea.right, (endPx + nextPx) / 2));
          const width = Math.max(1, right - left);

          band.style.left = `${left}px`;
          band.style.width = `${width}px`;
          band.style.top = `${chartArea.top}px`;
          band.style.height = `${Math.max(1, chartArea.bottom - chartArea.top)}px`;
        } else {
          const leftPct = (start / total) * 100;
          const widthPct = ((endIndex - start + 1) / total) * 100;
          band.style.left = `${leftPct}%`;
          band.style.width = `${Math.max(widthPct, 0.5)}%`;
        }

        ratesMissingOverlay.appendChild(band);
        start = -1;
      }
    }
  }
  function renderChart() {
    if (!chartRoot || !window.EnergyTimeSeriesChart?.createBridge) return;
    const cfg = RATE_TYPE_LOOKUP[viewState.rateType] || RATE_TYPES[0];
    const chartData = buildChartData();

    if (chartTitle) chartTitle.textContent = cfg.title;
    if (axis) axis.textContent = chartData.axisText;

    if (!chartBridge) {
      chartBridge = window.EnergyTimeSeriesChart.createBridge();
      chartBridge.mount(chartRoot, {
        labels: chartData.labels,
        datasets: chartData.datasets,
        yTitle: "Rate (USD/MWh)",
        minY: chartData.minY,
      });
      renderMissingBands(chartData.rows || []);
      return;
    }

    chartBridge.update({ labels: chartData.labels, datasets: chartData.datasets, yTitle: "Rate (USD/MWh)", minY: chartData.minY });
    renderMissingBands(chartData.rows || []);
  }

  function resolveCadenceMsForRateType(rateType) {
    return rateType === "commercial_day_ahead" ? 60 * 60 * 1000 : 5 * 60 * 1000;
  }

  function resolveCoverageWindowForPayload(rateType, span, payload) {
    const spanStartMs = Date.parse(String(span?.startIso || ""));
    const spanEndMs = Date.parse(String(span?.endIso || ""));
    if (!Number.isFinite(spanStartMs) || !Number.isFinite(spanEndMs) || spanEndMs <= spanStartMs) return null;

    const details = payload?.details || {};
    const reason = String(details?.reason || "live_data");
    if (reason !== "partial_data") {
      return { startIso: new Date(spanStartMs).toISOString(), endIso: new Date(spanEndMs).toISOString() };
    }

    const points = Array.isArray(payload?.series?.five_min) ? payload.series.five_min : [];
    const nonNullMs = points
      .map((point) => ({ tsMs: Date.parse(String(point?.ts || "")), value: point?.value }))
      .filter((point) => Number.isFinite(point.tsMs) && point.value != null)
      .map((point) => point.tsMs)
      .sort((a, b) => a - b);

    if (!nonNullMs.length) return null;

    const cadenceMs = resolveCadenceMsForRateType(rateType);
    const coverageStartMs = Math.max(spanStartMs, nonNullMs[0]);
    const coverageEndMs = Math.min(spanEndMs, nonNullMs[nonNullMs.length - 1] + cadenceMs);
    if (!Number.isFinite(coverageStartMs) || !Number.isFinite(coverageEndMs) || coverageEndMs <= coverageStartMs) {
      return null;
    }

    return {
      startIso: new Date(coverageStartMs).toISOString(),
      endIso: new Date(coverageEndMs).toISOString(),
    };
  }
  async function fetchRateSeries(rateType, { forceRemote = false, tailRefresh = false } = {}) {
    if (!currentProject) return;
    if (!supportsFetchForRateType(rateType)) return;

    const range = resolveRollingWindow(viewState.period, viewState.selectedDateKey, dataState.timezone);
    if (!range) return;

    if (!cacheEngine) {
      stopLoadingAnimation(rateType, {
        hide: false,
        text: "Cache engine unavailable.",
        progressPct: 95,
      });
      return;
    }

    const { requestId, signal } = beginRateRequest(rateType);

    let store = loadCacheStore(rateType);
    if (!store) {
      finalizeRateRequest(rateType, requestId);
      stopLoadingAnimation(rateType, {
        hide: false,
        text: "Failed to initialize cache store.",
        progressPct: 95,
      });
      return;
    }

    if (!forceRemote) {
      const cachedPayload = cacheEngine.buildWindowPayload(store, range.startIso, range.endIso);
      if (cachedPayload?.series) {
        applySeriesPayload(rateType, cachedPayload);
        if (viewState.rateType === rateType) renderChart();
      }
    }

    let missingSpans = [];
    if (tailRefresh) {
      const tailSpan = resolveTailRefreshSpan(rateType, range);
      missingSpans = tailSpan ? [tailSpan] : [];
    } else if (forceRemote) {
      missingSpans = [{ startIso: range.startIso, endIso: range.endIso }];
    } else {
      missingSpans = cacheEngine.computeMissingSpans(store.coverage, range.startIso, range.endIso);
    }

    if (hasGlobalRateLimitPause()) {
      finalizeRateRequest(rateType, requestId);
      start429Countdown(rateType, getRateLimitRemainingSeconds(), rateLimitState.message || "Rate limited.");
      return;
    }

    if (!missingSpans.length) {
      finalizeRateRequest(rateType, requestId);
      stopLoadingAnimation(rateType, { hide: true });
      return;
    }

    startLoadingAnimation(rateType);

    const coords = getLocationCoordinates(currentProject);
    const utilityCode = String(currentProject.utility_code || currentProject.utility_name || "");

    const fetchSpan = async (span) => {
      const params = new URLSearchParams({
        projectId: String(currentProject.id || ""),
        rateType,
        start: span.startIso,
        end: span.endIso,
        interval: viewState.interval,
        lat: String(coords.lat),
        lng: String(coords.lng),
        utilityCode,
        timezone: dataState.timezone,
      });

      let response = null;
      try {
        response = await fetch(`${V4_RATES_ENDPOINT}?${params.toString()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          return { aborted: true };
        }
        throw error;
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }

      return { finalResponse: response, finalPayload: payload, aborted: false };
    };

    let hadSuccess = false;
    let finalResponse = null;
    let finalPayload = null;

    try {
      for (let i = 0; i < missingSpans.length; i += 1) {
        if (isRequestStale(rateType, requestId)) return;

        if (hasGlobalRateLimitPause()) {
          start429Countdown(rateType, getRateLimitRemainingSeconds(), rateLimitState.message || "Rate limited.");
          break;
        }

        const span = missingSpans[i];
        // eslint-disable-next-line no-await-in-loop
        const result = await fetchSpan(span);
        if (result?.aborted || signal.aborted || isRequestStale(rateType, requestId)) {
          return;
        }

        finalResponse = result.finalResponse;
        finalPayload = result.finalPayload;

        if (result.finalResponse?.ok && result.finalPayload?.series) {
          hadSuccess = true;
          const coverageWindow = resolveCoverageWindowForPayload(rateType, span, result.finalPayload);
          store = cacheEngine.mergeSeriesIntoStore(store, result.finalPayload, {
            spanStartIso: span.startIso,
            spanEndIso: span.endIso,
            coverageStartIso: coverageWindow?.startIso || null,
            coverageEndIso: coverageWindow?.endIso || null,
          });
          saveCacheStore(store);
          continue;
        }

        store = cacheEngine.recordSpanError(store, span, {
          code: result.finalPayload?.details?.upstreamErrorCode || result.finalPayload?.code || "REQUEST_FAILED",
          httpStatus: result.finalResponse?.status || result.finalPayload?.details?.upstreamHttpStatus || null,
          message:
            result.finalPayload?.errors?.[0] ||
            result.finalPayload?.details?.upstreamError ||
            result.finalPayload?.details?.upstreamErrorCode ||
            "Request failed",
        });
        saveCacheStore(store);

        if (result.finalResponse?.status === 429) {
          const retrySeconds = Number(result.finalPayload?.details?.retryAfterSeconds || 0) || 5;
          const rateLimitMessage = resolveRateLimitMessage(result.finalPayload, "Rate limited.");
          setGlobalRateLimitPause(retrySeconds, rateLimitMessage);
          start429Countdown(rateType, retrySeconds, rateLimitMessage);
          break;
        }

        // Fail fast on first non-429 upstream error to avoid immediate follow-up spans causing extra throttling.
        break;
      }

      if (isRequestStale(rateType, requestId)) return;

      if (hadSuccess) {
        const mergedPayload = cacheEngine.buildWindowPayload(store, range.startIso, range.endIso);
        applySeriesPayload(rateType, mergedPayload);
        if (viewState.rateType === rateType) renderChart();
        stopLoadingAnimation(rateType, { hide: true });
        return;
      }

      const retrySeconds = Number(finalPayload?.details?.retryAfterSeconds || 0);
      if (finalResponse?.status === 429 || retrySeconds > 0) {
        const seconds = retrySeconds > 0 ? retrySeconds : 5;
        const rateLimitMessage = resolveRateLimitMessage(finalPayload, "Rate limited.");
        setGlobalRateLimitPause(seconds, rateLimitMessage);
        start429Countdown(rateType, seconds, rateLimitMessage);
        return;
      }

      const errorText =
        String(finalPayload?.errors?.[0] || finalPayload?.details?.upstreamError || finalPayload?.details?.upstreamErrorCode || "Request failed") ||
        "Request failed";
      stopLoadingAnimation(rateType, {
        hide: false,
        text: errorText,
        progressPct: 95,
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal.aborted || isRequestStale(rateType, requestId)) {
        return;
      }
      stopLoadingAnimation(rateType, {
        hide: false,
        text: String(error?.message || "Request failed"),
        progressPct: 95,
      });
    } finally {
      finalizeRateRequest(rateType, requestId);
    }
  }
  async function refreshActiveRateWindow({ forceRemote = false, tailRefresh = false } = {}) {
    const rateType = viewState.rateType;
    if (!supportsFetchForRateType(rateType)) {
      renderChart();
      return;
    }
    await fetchRateSeries(rateType, { forceRemote, tailRefresh });
    if (controlBridge) controlBridge.update(buildControlStripProps());
  }
  function render() {
    updateCards();
    if (controlBridge) controlBridge.update(buildControlStripProps());
    if (legendBridge) legendBridge.update(buildLegendProps());
    renderChart();
  }

  function setProjectNameDisplay(name) {
    if (!headerProjectNameDisplay || !headerProjectNameInput) return;
    const text = String(name || "Untitled Project").trim() || "Untitled Project";
    headerProjectNameDisplay.textContent = text;
    headerProjectNameInput.value = text;
  }

  function setProjectLinks(projectId) {
    if (!projectId) return;
    const params = new URLSearchParams({ projectId: String(projectId) }).toString();
    const withId = (path) => `${path}?${params}`;

    if (locationLink) locationLink.href = withId("/projects/location.html");
    if (generationLink) generationLink.href = withId("/projects/generation.html");
    if (storageLink) storageLink.href = withId("/projects/storage.html");
    if (prototypeRatesLink) prototypeRatesLink.href = withId("/projects/rates.html");
  }

  async function resolveProject() {
    if (!supabaseService) return null;
    await supabaseService.migrateLegacyLocalData?.();

    const candidateIds = [];
    if (isValidProjectId(requestedProjectId)) candidateIds.push(requestedProjectId);
    const lastOpened = supabaseService.getLastOpenedProjectId?.();
    if (isValidProjectId(lastOpened) && !candidateIds.includes(lastOpened)) candidateIds.push(lastOpened);

    for (let i = 0; i < candidateIds.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const project = await supabaseService.getProject(candidateIds[i]);
      if (project) return project;
    }

    const projects = await supabaseService.listProjects?.();
    return Array.isArray(projects) && projects.length ? projects[0] : null;
  }

  async function resolveProjectTimezone(project) {
    const lat = Number(project?.location_lat ?? project?.lat);
    const lng = Number(project?.location_lng ?? project?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "UTC";

    try {
      const url = new URL("/api/rates/provider", window.location.origin);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lng", String(lng));
      const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
      if (!response.ok) return "UTC";
      const payload = await response.json();
      return String(payload?.provider?.timezone || "UTC");
    } catch (_error) {
      return "UTC";
    }
  }

  function selectRateType(next) {
    if (!next || next === viewState.rateType) return;
    abortInFlightForRateType("commercial_realtime");
    abortInFlightForRateType("commercial_day_ahead");
    viewState.rateType = next;
    normalizeIntervalForPeriod();
    startTailRefreshScheduler();
    render();
    if (supportsFetchForRateType(viewState.rateType)) {
      void refreshActiveRateWindow({ forceRemote: false });
    }
  }

  function bindCardEvents() {
    rateCards.forEach((card) => {
      card.addEventListener("click", () => {
        selectRateType(card.dataset.rateType);
      });

      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectRateType(card.dataset.rateType);
      });
    });

    fetchButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const rateType = button.dataset.rateFetch;
        if (!supportsFetchForRateType(rateType)) return;
        abortInFlightForRateType("commercial_realtime");
        abortInFlightForRateType("commercial_day_ahead");
        viewState.rateType = rateType;
        normalizeIntervalForPeriod();
        startTailRefreshScheduler();
        render();
        void refreshActiveRateWindow({ forceRemote: true });
      });
    });
  }

  function setProjectNameEditorMode(editing) {
    const showDisplay = !editing;
    if (headerProjectNameDisplay) headerProjectNameDisplay.hidden = !showDisplay;
    if (headerProjectNameEditButton) headerProjectNameEditButton.hidden = !showDisplay;
    if (headerProjectNameInput) headerProjectNameInput.hidden = showDisplay;
    if (headerProjectNameSaveButton) headerProjectNameSaveButton.hidden = showDisplay;
    if (headerProjectNameCancelButton) headerProjectNameCancelButton.hidden = showDisplay;
  }

  async function saveProjectName() {
    if (!currentProject?.id || !headerProjectNameInput || !supabaseService?.upsertProject) {
      setProjectNameEditorMode(false);
      return;
    }

    const name = String(headerProjectNameInput.value || "").trim() || "Untitled Project";
    const saved = await supabaseService.upsertProject({ ...currentProject, name });
    currentProject = saved || { ...currentProject, name };
    setProjectNameDisplay(currentProject.name);
    setProjectNameEditorMode(false);
  }

  function bindProjectNameEditor() {
    if (headerProjectNameEditButton && headerProjectNameInput) {
      headerProjectNameEditButton.addEventListener("click", () => {
        setProjectNameEditorMode(true);
        headerProjectNameInput.focus();
        headerProjectNameInput.select();
      });
    }

    if (headerProjectNameSaveButton) {
      headerProjectNameSaveButton.addEventListener("click", () => void saveProjectName());
    }

    if (headerProjectNameCancelButton) {
      headerProjectNameCancelButton.addEventListener("click", () => {
        setProjectNameDisplay(currentProject?.name);
        setProjectNameEditorMode(false);
      });
    }

    if (headerProjectNameInput) {
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
  }

  function mountSharedBridges() {
    if (controlStripRoot && window.EnergyChartUI?.createTimeWindowControlsBridge) {
      controlBridge = window.EnergyChartUI.createTimeWindowControlsBridge();
      controlBridge.mount(controlStripRoot, buildControlStripProps());
    }

    if (legendRoot && window.EnergyChartUI?.createLegendTogglesBridge) {
      legendBridge = window.EnergyChartUI.createLegendTogglesBridge();
      legendBridge.mount(legendRoot, buildLegendProps());
    }
  }

  async function init() {
    currentProject = await resolveProject();
    setProjectNameDisplay(currentProject?.name || "Rates V4 Prototype");
    setProjectLinks(currentProject?.id);
    setProjectNameEditorMode(false);

    dataState.timezone = await resolveProjectTimezone(currentProject);
    viewState.selectedDateKey = todayDateKeyForTimezone(dataState.timezone);

    bindProjectNameEditor();
    bindCardEvents();
    bindLifecycleEvents();
    mountSharedBridges();
    startTailRefreshScheduler();
    render();
    await refreshActiveRateWindow({ forceRemote: false });
  }

  void init();
})();






































