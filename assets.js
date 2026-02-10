(() => {
  const POINTS_PER_DAY = 96;
  const PROXY_ENDPOINT = "/api/nrel-proxy";
  const DEFAULT_DATE_KEY = "2014-02-09";
  const supabaseService = window.EnergySupabaseService;

  const facilityNameEl = document.querySelector("[data-facility-name]");
  const facilityLocationEl = document.querySelector("[data-facility-location]");
  const solarList = document.getElementById("solar-assets");
  const windList = document.getElementById("wind-assets");
  const addSolarButton = document.getElementById("add-solar");
  const addWindButton = document.getElementById("add-wind");
  const solarTemplate = document.getElementById("solar-asset-template");
  const windTemplate = document.getElementById("wind-asset-template");
  const deleteModal = document.getElementById("delete-asset-modal");
  const confirmDeleteButton = document.getElementById("confirm-delete-asset");
  const mapContainer = document.getElementById("assets-map");
  const generationChart = document.getElementById("generation-chart");
  const generationAxis = document.getElementById("generation-axis");
  const generationChartFrame = document.getElementById("assets-chart-frame");
  const generationTooltip = document.getElementById("generation-tooltip");
  const assetsDatePickerButton = document.getElementById("assets-date-picker-button");
  const assetsDatePickerInput = document.getElementById("assets-date-picker");
  const generationDebugOutput = document.getElementById("generation-debug-output");
  const projectNameEl = document.getElementById("assets-project-name");

  let currentProject = null;
  let selectedDateKey = DEFAULT_DATE_KEY;

  const solarDefaults = window.EnergyModels?.DEFAULT_SOLAR_ASSET || {};
  const windDefaults = window.EnergyModels?.DEFAULT_WIND_ASSET || {};
  const createSolarAsset =
    window.EnergyModels?.createSolarAsset ||
    ((overrides = {}) => ({ ...solarDefaults, ...overrides }));
  const createWindAsset =
    window.EnergyModels?.createWindAsset ||
    ((overrides = {}) => ({ ...windDefaults, ...overrides }));

  let solarCount = 0;
  let windCount = 0;
  let pendingDeleteId = null;
  let pendingDeleteType = null;
  let recomputeRaf = 0;

  const solarAssets = [];
  const windAssets = [];

  const chartState = {
    solarKw: new Float64Array(POINTS_PER_DAY),
    windKw: new Float64Array(POINTS_PER_DAY),
    totalKw: new Float64Array(POINTS_PER_DAY),
  };

  const weatherDay = {
    loading: false,
    loaded: false,
    error: "",
    timeZone: "UTC",
    solar: [],
    wind: [],
    matchedSolarRows: 0,
    matchedWindRows: 0,
    firstMatchedTimestamp: null,
    lastMatchedTimestamp: null,
  };

  const pad2 = (value) => String(value).padStart(2, "0");
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
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
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("80")) {
      return "windspeed_80m";
    }
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("100")) {
      return "windspeed_100m";
    }
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("120")) {
      return "windspeed_120m";
    }
    if (cleaned.includes("temperature") && cleaned.includes("100")) {
      return "temperature_100m";
    }
    if (cleaned.includes("pressure") && cleaned.includes("100")) {
      return "pressure_100m";
    }
    if (cleaned.includes("air") && cleaned.includes("temperature")) {
      return "air_temperature";
    }

    return cleaned;
  };

  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };


  const safeParse = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  };

  const formatKw = (value) => `${Number(value || 0).toFixed(2)} kW`;

  const formatHourLabel = (index) => {
    const totalMinutes = index * 15;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${pad2(hour)}:${pad2(minute)}`;
  };

  const buildGridLines = (maxValue, width, height, tickCount = 4) => {
    const ticks = [];
    for (let i = 0; i <= tickCount; i += 1) {
      const value = (maxValue * i) / tickCount;
      const y = height - (value / maxValue) * height;
      ticks.push({ value, y });
    }
    const lines = ticks
      .map(
        ({ y }) =>
          `<line x1="0" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" stroke="rgba(141, 171, 230, 0.24)" stroke-width="1" />`
      )
      .join("");
    const labels = ticks
      .map(({ value, y }) => {
        const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1));
        return `<text x="8" y="${Math.max(12, y - 4).toFixed(2)}" fill="#9fc0ff" font-size="11">${rounded}</text>`;
      })
      .join("");
    return { lines, labels };
  };

  const hideTooltip = () => {
    if (generationTooltip) {
      generationTooltip.hidden = true;
    }
  };

  const updateTooltip = (event) => {
    if (!generationChartFrame || !generationTooltip || !chartState.totalKw) {
      return;
    }
    const rect = generationChartFrame.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const clampedX = Math.max(0, Math.min(rect.width, x));
    const ratio = rect.width > 0 ? clampedX / rect.width : 0;
    const index = Math.max(0, Math.min(POINTS_PER_DAY - 1, Math.round(ratio * (POINTS_PER_DAY - 1))));
    const solarValue = chartState.solarKw[index] || 0;
    const windValue = chartState.windKw[index] || 0;
    const totalValue = chartState.totalKw[index] || 0;

    generationTooltip.innerHTML = `
      <div class="generation-tooltip__time">${formatHourLabel(index)}</div>
      <div>Solar: ${formatKw(solarValue)}</div>
      <div>Wind: ${formatKw(windValue)}</div>
      <div>Total: ${formatKw(totalValue)}</div>
    `;

    const offset = 14;
    const maxLeft = rect.width - generationTooltip.offsetWidth - 8;
    const left = Math.max(8, Math.min(maxLeft, clampedX + offset));
    const maxTop = rect.height - generationTooltip.offsetHeight - 8;
    const top = Math.max(8, Math.min(maxTop, event.clientY - rect.top - generationTooltip.offsetHeight - 10));
    generationTooltip.style.left = `${left}px`;
    generationTooltip.style.top = `${top}px`;
    generationTooltip.hidden = false;
  };

  const hasZoneInTimestamp = (timestampLike) => /(?:z|[+-]\d{2}:?\d{2})$/i.test(cleanText(timestampLike));

  const parseTimestampParts = (timestampLike) => {
    const raw = cleanText(timestampLike);
    if (!raw) {
      return null;
    }

    const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
    const match = withT.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second = "0"] = match;
    return {
      year: String(Number(year)),
      month: String(Number(month)),
      day: String(Number(day)),
      hour: String(Number(hour)),
      minute: String(Number(minute)),
      second: String(Number(second)),
    };
  };

  const toUtcDate = (timestampLike) => {
    const raw = cleanText(timestampLike);
    if (!raw) {
      return null;
    }
    const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
    const hasZone = hasZoneInTimestamp(withT);
    const primary = new Date(hasZone ? withT : `${withT}Z`);
    if (!Number.isNaN(primary.getTime())) {
      return primary;
    }
    const fallback = new Date(raw);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
    return null;
  };

  const withDateParts = (record) => {
    const hasDateParts = [record.year, record.month, record.day].every((value) => Number.isFinite(Number(value)));
    if (hasDateParts) {
      return record;
    }
    const timestampLike =
      record.timestamp || record.time || record.datetime || record.date_time || record.local_time || record.utc_time;
    if (!timestampLike) {
      return record;
    }

    if (!hasZoneInTimestamp(timestampLike)) {
      const localParts = parseTimestampParts(timestampLike);
      if (localParts) {
        return {
          ...record,
          ...localParts,
        };
      }
    }

    const utcDate = toUtcDate(timestampLike);
    if (!utcDate) {
      return record;
    }
    return {
      ...record,
      year: String(utcDate.getUTCFullYear()),
      month: String(utcDate.getUTCMonth() + 1),
      day: String(utcDate.getUTCDate()),
      hour: String(utcDate.getUTCHours()),
      minute: String(utcDate.getUTCMinutes()),
      second: String(utcDate.getUTCSeconds()),
    };
  };

  const buildUrl = (base, params) => {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
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
      second: "2-digit",
      hour12: false,
    });

  const normalizeRecordsToTimeZone = (records, timeZone) => {
    if (!timeZone || timeZone === "UTC") {
      return records;
    }
    const formatter = getTimeZoneFormatter(timeZone);
    return records.map((record) => {
      const year = Number(record.year);
      const month = Number(record.month);
      const day = Number(record.day);
      const hour = Number(record.hour ?? 0);
      const minute = Number(record.minute ?? 0);
      if (![year, month, day, hour, minute].every(Number.isFinite)) {
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
        year: String(Number(byType.year)),
        month: String(Number(byType.month)),
        day: String(Number(byType.day)),
        hour: String(Number(byType.hour)),
        minute: String(Number(byType.minute)),
        second: String(Number(byType.second || 0)),
        normalized_timestamp: `${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}:00`,
      };
    });
  };


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
      return `${pad2(record.year)}-${pad2(record.month)}-${pad2(record.day)}T${pad2(record.hour)}:${pad2(record.minute)}:00`;
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
      // Match Facility Settings behavior for NREL-style year/month/day/hour/minute rows:
      // interpret these as UTC source records that must be shifted to facility local time.
      return "absolute";
    }

    if (hasDateParts) {
      return "local_wall_clock";
    }

    return "local_wall_clock";
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
      record.year && String(record.year) !== String(targetYear) ? { ...record, year: String(targetYear) } : record
    );

  const parseCsv = (csvText) => {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => cleanText(line))
      .filter(Boolean);

    if (!lines.length) {
      return [];
    }

    const headerIndex = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      return lower.startsWith("year,") || lower.startsWith("timestamp,") || lower.startsWith("time,");
    });

    if (headerIndex < 0) {
      return [];
    }

    const headers = lines[headerIndex].split(",").map((value) => normalizeHeader(value));
    return lines.slice(headerIndex + 1).map((line) => {
      const cols = line.split(",");
      const record = {};
      headers.forEach((header, index) => {
        const raw = cleanText(cols[index]);
        if (raw === "") {
          record[header] = null;
          return;
        }
        const numeric = Number(raw);
        record[header] = Number.isNaN(numeric) ? raw : numeric;
      });
      return withDateParts(record);
    });
  };

  const pickWindSpeedKey = (records) => {
    if (!records.length) {
      return "windspeed_100m";
    }
    const sample = records.find(Boolean) || {};
    const keys = Object.keys(sample).filter((key) => /^windspeed_\d+m$/.test(key));
    if (keys.includes("windspeed_100m")) {
      return "windspeed_100m";
    }
    return keys[0] || "windspeed_100m";
  };

  const pickWindTemperatureKey = (records) => {
    const sample = records.find(Boolean) || {};
    const keys = Object.keys(sample).filter((key) => /^temperature_\d+m$/.test(key));
    if (keys.includes("temperature_100m")) {
      return "temperature_100m";
    }
    return keys[0] || null;
  };

  const pickWindPressureKey = (records) => {
    const sample = records.find(Boolean) || {};
    const keys = Object.keys(sample).filter((key) => /^pressure_\d+m$/.test(key));
    if (keys.includes("pressure_100m")) {
      return "pressure_100m";
    }
    return keys[0] || null;
  };

  const sliceDay = (records, dateKey, mapFn) => {
    const [yy, mm, dd] = dateKey.split("-").map(Number);
    const dayRecords = records.filter((record) =>
      Number(record.year) === yy && Number(record.month) === mm && Number(record.day) === dd
    );

    const byMinute = new Map();
    dayRecords.forEach((record) => {
      const hour = Number(record.hour ?? 0);
      const minute = Number(record.minute ?? 0);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return;
      }
      byMinute.set(hour * 60 + minute, record);
    });

    const points = [];
    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const hour = Math.floor((i * 15) / 60);
      const minute = (i * 15) % 60;
      const key = hour * 60 + minute;
      points.push(mapFn(byMinute.get(key), `${dateKey}T${pad2(hour)}:${pad2(minute)}:00`));
    }

    return {
      points,
      matchedCount: dayRecords.length,
      firstMatchedTimestamp: dayRecords[0]?.normalized_timestamp || dayRecords[0]?.timestamp || null,
      lastMatchedTimestamp:
        dayRecords[dayRecords.length - 1]?.normalized_timestamp ||
        dayRecords[dayRecords.length - 1]?.timestamp ||
        null,
    };
  };

  const setNoWeatherLoaded = () => {
    weatherDay.loaded = false;
    weatherDay.loading = false;
    weatherDay.error = "";
    weatherDay.timeZone = "UTC";
    weatherDay.solar = [];
    weatherDay.wind = [];
    weatherDay.matchedSolarRows = 0;
    weatherDay.matchedWindRows = 0;
    weatherDay.firstMatchedTimestamp = null;
    weatherDay.lastMatchedTimestamp = null;
  };

  const fetchWeatherForDay = async () => {
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
      setNoWeatherLoaded();
      scheduleRecompute();
      return;
    }

    weatherDay.loading = true;
    weatherDay.error = "";
    renderChart();

    try {
      const wkt = `POINT(${currentProject.lng} ${currentProject.lat})`;
      const [cachedSolar, cachedWind] = await Promise.all([
        supabaseService.getNrelCache(currentProject.id, "solar", selectedDateKey),
        supabaseService.getNrelCache(currentProject.id, "wind", selectedDateKey),
      ]);

      let rawSolarRecords;
      let rawWindRecords;

      if (cachedSolar?.payload && cachedWind?.payload) {
        rawSolarRecords = cachedSolar.payload;
        rawWindRecords = cachedWind.payload;
      } else {
        const [solarResponse, windResponse] = await Promise.all([
          fetch(buildUrl(PROXY_ENDPOINT, { dataset: "solar", wkt, interval: "15" })),
          fetch(buildUrl(PROXY_ENDPOINT, { dataset: "wind", wkt, interval: "15" })),
        ]);

        if (!solarResponse.ok || !windResponse.ok) {
          throw new Error("Unable to load weather data for selected location.");
        }

        const [solarCsv, windCsv] = await Promise.all([solarResponse.text(), windResponse.text()]);
        rawSolarRecords = parseCsv(solarCsv);
        rawWindRecords = parseCsv(windCsv);
        void supabaseService.upsertNrelCache({ projectId: currentProject.id, dataset: "solar", dateKey: selectedDateKey, payload: rawSolarRecords });
        void supabaseService.upsertNrelCache({ projectId: currentProject.id, dataset: "wind", dateKey: selectedDateKey, payload: rawWindRecords });
      }

      const [targetYear] = selectedDateKey.split("-");
      const normalizedSolarRecords = normalizeRecordYears(rawSolarRecords, targetYear);
      const normalizedWindRecords = normalizeRecordYears(rawWindRecords, targetYear);

      const timeZone = await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng });
      weatherDay.timeZone = timeZone;

      const solarRecords = alignRecordsForFacilityTimeZone(normalizedSolarRecords, timeZone);
      const windRecords = alignRecordsForFacilityTimeZone(normalizedWindRecords, timeZone);

      const windSpeedKey = pickWindSpeedKey(windRecords);
      const windTemperatureKey = pickWindTemperatureKey(windRecords);
      const windPressureKey = pickWindPressureKey(windRecords);

      const solarSlice = sliceDay(solarRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        ghi: toNumber(record?.ghi, 0),
        dni: toNumber(record?.dni, 0),
        dhi: toNumber(record?.dhi, 0),
        air_temperature: toNumber(record?.air_temperature, 20),
      }));

      const windSlice = sliceDay(windRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        [windSpeedKey]: toNumber(record?.[windSpeedKey], 0),
        ...(windTemperatureKey ? { [windTemperatureKey]: toNumber(record?.[windTemperatureKey], NaN) } : {}),
        ...(windPressureKey ? { [windPressureKey]: toNumber(record?.[windPressureKey], NaN) } : {}),
      }));

      weatherDay.solar = solarSlice.points;
      weatherDay.wind = windSlice.points;
      weatherDay.matchedSolarRows = solarSlice.matchedCount;
      weatherDay.matchedWindRows = windSlice.matchedCount;
      weatherDay.firstMatchedTimestamp = solarSlice.firstMatchedTimestamp || windSlice.firstMatchedTimestamp;
      weatherDay.lastMatchedTimestamp = solarSlice.lastMatchedTimestamp || windSlice.lastMatchedTimestamp;

      const needsSolar = solarAssets.length > 0;
      const needsWind = windAssets.length > 0;
      const solarReady = weatherDay.solar.length === POINTS_PER_DAY && weatherDay.matchedSolarRows > 0;
      const windReady = weatherDay.wind.length === POINTS_PER_DAY && weatherDay.matchedWindRows > 0;

      weatherDay.loaded = (!needsSolar || solarReady) && (!needsWind || windReady);

      if (!weatherDay.loaded) {
        const missingStreams = [];
        if (needsSolar && !solarReady) {
          missingStreams.push("solar");
        }
        if (needsWind && !windReady) {
          missingStreams.push("wind");
        }
        weatherDay.error =
          missingStreams.length === 1
            ? `No ${missingStreams[0]} weather rows matched selected date after alignment. Check timezone/year normalization.`
            : "No solar/wind weather rows matched selected date after alignment. Check timezone/year normalization.";
      }
    } catch (error) {
      weatherDay.loaded = false;
      weatherDay.error = error.message || "Unable to fetch weather data.";
      weatherDay.solar = [];
      weatherDay.wind = [];
      weatherDay.matchedSolarRows = 0;
      weatherDay.matchedWindRows = 0;
      weatherDay.firstMatchedTimestamp = null;
      weatherDay.lastMatchedTimestamp = null;
    } finally {
      weatherDay.loading = false;
      scheduleRecompute();
    }
  };

  const areaPath = (values, baseline, yScale, width, height) => {
    const stepX = width / (POINTS_PER_DAY - 1);
    let path = "";
    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const x = i * stepX;
      const y = height - (values[i] + baseline[i]) * yScale;
      path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    for (let i = POINTS_PER_DAY - 1; i >= 0; i -= 1) {
      const x = i * stepX;
      const y = height - baseline[i] * yScale;
      path += ` L ${x} ${y}`;
    }
    return `${path} Z`;
  };

  const linePath = (values, yScale, width, height) => {
    const stepX = width / (POINTS_PER_DAY - 1);
    let path = "";
    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const x = i * stepX;
      const y = height - values[i] * yScale;
      path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return path;
  };

  const buildEmptySeries = () => new Float64Array(POINTS_PER_DAY);

  const renderDebugData = ({ solarDebug = [], windDebug = [], totalKw = null }) => {
    if (!generationDebugOutput) {
      return;
    }

    const payload = {
      selectedDate: selectedDateKey,
      weatherStatus: {
        loaded: weatherDay.loaded,
        loading: weatherDay.loading,
        error: weatherDay.error || null,
        timeZone: weatherDay.timeZone,
        solarPoints: weatherDay.solar.length,
        windPoints: weatherDay.wind.length,
        matchedSolarRows: weatherDay.matchedSolarRows,
        matchedWindRows: weatherDay.matchedWindRows,
        firstMatchedTimestamp: weatherDay.firstMatchedTimestamp,
        lastMatchedTimestamp: weatherDay.lastMatchedTimestamp,
      },
      solarAssets: solarDebug,
      windAssets: windDebug,
      totalSampleKw: totalKw ? Array.from(totalKw.slice(0, 8)).map((v) => Number(v.toFixed(3))) : [],
    };

    generationDebugOutput.textContent = JSON.stringify(payload, null, 2);
  };

  const renderChart = () => {
    if (!generationChart) {
      return;
    }

    if (weatherDay.loading) {
      hideTooltip();
      generationChart.innerHTML = '<text x="20" y="26" fill="#c7d7f4" font-size="14">Loading weather data…</text>';
      return;
    }

    if (!weatherDay.loaded) {
      hideTooltip();
      const message = weatherDay.error || "No weather data loaded.";
      generationChart.innerHTML = `<text x="20" y="26" fill="#ffb3b3" font-size="13">${message}</text>`;
      if (generationAxis) {
        generationAxis.innerHTML = "";
      }
      renderDebugData({});
      return;
    }

    const solarDebug = [];
    solarAssets.forEach((assetEntry) => {
      if (window.EnergyGeneration?.computeSolarPowerDebug) {
        const debug = window.EnergyGeneration.computeSolarPowerDebug(assetEntry.model, weatherDay.solar);
        assetEntry.series = debug.output;
        solarDebug.push({ id: assetEntry.id, name: assetEntry.model.name, sample: debug.sample, errors: debug.errors });
      } else {
        assetEntry.series = window.EnergyGeneration?.computeSolarPower
          ? window.EnergyGeneration.computeSolarPower(assetEntry.model, weatherDay.solar)
          : buildEmptySeries();
      }
    });

    const windDebug = [];
    windAssets.forEach((assetEntry) => {
      if (window.EnergyGeneration?.computeWindPowerDebug) {
        const debug = window.EnergyGeneration.computeWindPowerDebug(assetEntry.model, weatherDay.wind);
        assetEntry.series = debug.output;
        windDebug.push({ id: assetEntry.id, name: assetEntry.model.name, sample: debug.sample, errors: debug.errors });
      } else {
        assetEntry.series = window.EnergyGeneration?.computeWindPower
          ? window.EnergyGeneration.computeWindPower(assetEntry.model, weatherDay.wind)
          : buildEmptySeries();
      }
    });

    const solarKw = window.EnergyGeneration?.sumSolarAssets
      ? window.EnergyGeneration.sumSolarAssets(
          solarAssets.map((entry) => entry.model),
          weatherDay.solar
        )
      : buildEmptySeries();

    const windKw = window.EnergyGeneration?.sumWindAssets
      ? window.EnergyGeneration.sumWindAssets(
          windAssets.map((entry) => entry.model),
          weatherDay.wind
        )
      : buildEmptySeries();

    const totalKw = new Float64Array(POINTS_PER_DAY);
    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      totalKw[i] = solarKw[i] + windKw[i];
    }

    const maxValue = Math.max(1, ...totalKw);
    const width = 1000;
    const height = 240;
    const yScale = height / maxValue;
    const zero = new Float64Array(POINTS_PER_DAY);
    const { lines: gridLines, labels: gridLabels } = buildGridLines(maxValue, width, height);

    generationChart.innerHTML = `
      <g class="generation-grid">${gridLines}</g>
      <g class="generation-grid-labels">${gridLabels}</g>
      <text x="20" y="132" fill="#9fc0ff" font-size="11" transform="rotate(-90 20 132)">Generation (kW)</text>
      <path d="${areaPath(windKw, zero, yScale, width, height)}" fill="rgba(92, 211, 232, 0.50)" stroke="rgba(92, 211, 232, 0.95)" stroke-width="1" />
      <path d="${areaPath(solarKw, windKw, yScale, width, height)}" fill="rgba(242, 201, 76, 0.60)" stroke="rgba(247, 215, 125, 0.95)" stroke-width="1" />
      <path d="${linePath(totalKw, yScale, width, height)}" fill="none" stroke="#ffffff" stroke-width="2" />
    `;

    chartState.solarKw = solarKw;
    chartState.windKw = windKw;
    chartState.totalKw = totalKw;

    if (generationAxis) {
      generationAxis.innerHTML = ["00:00", "06:00", "12:00", "18:00", "24:00"]
        .map((label) => `<span>${label}</span>`)
        .join("");
    }

    renderDebugData({ solarDebug, windDebug, totalKw });
  };

  const scheduleRecompute = () => {
    if (recomputeRaf) {
      cancelAnimationFrame(recomputeRaf);
    }
    recomputeRaf = requestAnimationFrame(() => {
      recomputeRaf = 0;
      renderChart();
    });
  };

  const updateModelFromField = (model, field, prefix) => {
    const key = field.dataset[`${prefix}Field`];
    if (!key) {
      return;
    }

    if (field.type === "number") {
      model[key] = toNumber(field.value, model[key]);
    } else if (field.tagName === "SELECT") {
      if (field.value === "true" || field.value === "false") {
        model[key] = field.value === "true";
      } else {
        model[key] = field.value;
      }
    } else {
      model[key] = field.value;
    }
  };

  const wireFieldChanges = (card, entry, prefix, type) => {
    const model = entry.model;
    card.querySelectorAll("input, select").forEach((field) => {
      const handler = () => {
        updateModelFromField(model, field, prefix);
        void supabaseService.upsertAsset({ id: entry.id, projectId: currentProject.id, type, model });
        scheduleRecompute();
      };
      field.addEventListener("input", handler);
      field.addEventListener("change", handler);
    });
  };

  const populateFields = (container, defaults, prefix) => {
    const fields = container.querySelectorAll(`[data-${prefix}-field]`);
    fields.forEach((field) => {
      const key = field.dataset[`${prefix}Field`];
      const value = defaults[key];
      if (value == null) {
        return;
      }
      if (field.tagName === "SELECT") {
        field.value = String(value);
      } else {
        field.value = value;
      }
    });
  };

  const wireSectionToggles = (card) => {
    card.querySelectorAll(".asset-section").forEach((section) => {
      const toggle = section.querySelector(".asset-section-toggle");
      if (!toggle) {
        return;
      }
      toggle.addEventListener("click", () => {
        const collapsed = section.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.textContent = collapsed ? "▸" : "▾";
        scheduleRecompute();
      });
    });
  };

  const wireDelete = (card, type, id) => {
    const deleteButton = card.querySelector(".asset-delete");
    if (!deleteButton || !deleteModal || !confirmDeleteButton) {
      return;
    }
    deleteButton.addEventListener("click", () => {
      pendingDeleteId = id;
      pendingDeleteType = type;
      deleteModal.showModal();
    });
  };

  const removeAsset = async (type, id) => {
    const list = type === "solar" ? solarAssets : windAssets;
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    list[index].card.remove();
    list.splice(index, 1);
    await supabaseService.deleteAsset(id);
  };

  if (deleteModal) {
    deleteModal.addEventListener("close", () => {
      pendingDeleteId = null;
      pendingDeleteType = null;
    });
  }

  if (confirmDeleteButton) {
    confirmDeleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (pendingDeleteId && pendingDeleteType) {
        void removeAsset(pendingDeleteType, pendingDeleteId);
      }
      deleteModal?.close();
      scheduleRecompute();
    });
  }

  const addAsset = (type, restoredModel = null, restoredId = null) => {
    const isSolar = type === "solar";
    const template = isSolar ? solarTemplate : windTemplate;
    const listEl = isSolar ? solarList : windList;
    if (!template || !listEl) {
      return;
    }

    const nextIndex = isSolar ? ++solarCount : ++windCount;
    const assetId = restoredId || `${type}-${nextIndex}-${Date.now()}`;
    const defaultModel = isSolar
      ? createSolarAsset(restoredModel || { name: `Solar ${nextIndex}` })
      : createWindAsset(restoredModel || { name: `Wind ${nextIndex}` });

    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".asset-card");
    if (!card) {
      return;
    }

    card.dataset.assetId = assetId;
    populateFields(card, defaultModel, isSolar ? "solar" : "wind");
    const nameInput = card.querySelector(".asset-title-input");
    if (nameInput) {
      nameInput.value = defaultModel.name;
    }

    wireSectionToggles(card);
    wireDelete(card, type, assetId);

    listEl.appendChild(card);

    const entry = {
      id: assetId,
      model: defaultModel,
      card,
      series: new Float64Array(POINTS_PER_DAY),
    };
    (isSolar ? solarAssets : windAssets).push(entry);
    wireFieldChanges(card, entry, isSolar ? "solar" : "wind", type);

    if (currentProject) {
      void supabaseService.upsertAsset({ id: assetId, projectId: currentProject.id, type, model: defaultModel });
    }
    scheduleRecompute();
  };

  if (addSolarButton) {
    addSolarButton.addEventListener("click", () => addAsset("solar"));
  }
  if (addWindButton) {
    addWindButton.addEventListener("click", () => addAsset("wind"));
  }

  if (generationChartFrame) {
    generationChartFrame.addEventListener("mousemove", updateTooltip);
    generationChartFrame.addEventListener("mouseleave", hideTooltip);
  }

  if (assetsDatePickerInput) {
    assetsDatePickerInput.value = selectedDateKey;
  }

  if (assetsDatePickerButton && assetsDatePickerInput) {
    assetsDatePickerButton.addEventListener("click", () => {
      if (typeof assetsDatePickerInput.showPicker === "function") {
        assetsDatePickerInput.showPicker();
      } else {
        assetsDatePickerInput.click();
      }
    });
  }

  if (assetsDatePickerInput) {
    assetsDatePickerInput.addEventListener("change", (event) => {
      const value = event.target.value;
      if (!value || !currentProject) {
        return;
      }
      selectedDateKey = value;
      localStorage.setItem(supabaseService.buildScopedUiStorageKey(currentProject.id, "selectedDate"), value);
      void fetchWeatherForDay();
    });
  }

  const restoreProjectAssets = async () => {
    if (!currentProject) {
      return;
    }
    const savedAssets = await supabaseService.listAssets(currentProject.id);
    savedAssets.forEach((asset) => addAsset(asset.type, asset.model, asset.id));
  };

  const initProject = async () => {
    await supabaseService.migrateLegacyLocalData();
    const projectId = supabaseService.getLastOpenedProjectId();
    if (!projectId) {
      window.location.href = "index.html";
      return;
    }
    currentProject = await supabaseService.getProject(projectId);
    if (!currentProject) {
      window.location.href = "index.html";
      return;
    }

    selectedDateKey =
      localStorage.getItem(supabaseService.buildScopedUiStorageKey(currentProject.id, "selectedDate")) || DEFAULT_DATE_KEY;

    if (assetsDatePickerInput) {
      assetsDatePickerInput.value = selectedDateKey;
    }

    if (projectNameEl) {
      projectNameEl.textContent = currentProject.name || "Untitled Facility";
    }
    if (facilityNameEl) {
      facilityNameEl.textContent = currentProject.name || "Untitled Facility";
    }
    if (facilityLocationEl && currentProject.lat != null && currentProject.lng != null) {
      facilityLocationEl.textContent = `${currentProject.lat.toFixed(4)}, ${currentProject.lng.toFixed(4)}`;
    }

    if (mapContainer && window.L) {
      const map = L.map(mapContainer, { zoomControl: false, attributionControl: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

      const mapState = JSON.parse(
        localStorage.getItem(supabaseService.buildScopedUiStorageKey(currentProject.id, "mapState")) || "null"
      );
      if (mapState?.bounds) {
        const bounds = [
          [mapState.bounds.south, mapState.bounds.west],
          [mapState.bounds.north, mapState.bounds.east],
        ];
        map.fitBounds(bounds, { padding: [10, 10] });
      } else if (mapState?.center && typeof mapState.zoom === "number") {
        map.setView([mapState.center.lat, mapState.center.lng], mapState.zoom);
      } else if (currentProject.lat != null && currentProject.lng != null) {
        map.setView([currentProject.lat, currentProject.lng], 10);
      } else {
        map.setView([39.742, -105.1786], 10);
      }

      if (mapState?.center) {
        L.marker([mapState.center.lat, mapState.center.lng]).addTo(map);
      } else if (currentProject.lat != null && currentProject.lng != null) {
        L.marker([currentProject.lat, currentProject.lng]).addTo(map);
      }
    }

    await restoreProjectAssets();
    scheduleRecompute();
    await fetchWeatherForDay();
  };

  void initProject();
})();
