(() => {
  const POINTS_PER_DAY = 96;
  const PROXY_ENDPOINT = "/api/nrel-proxy";
  const DEFAULT_DATE_KEY = "2014-02-09";

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
  const assetsDatePickerButton = document.getElementById("assets-date-picker-button");
  const assetsDatePickerInput = document.getElementById("assets-date-picker");
  const generationDebugOutput = document.getElementById("generation-debug-output");

  const facility = JSON.parse(localStorage.getItem("energyapp.facility") || "{}");
  let selectedDateKey = localStorage.getItem("energyapp.selectedDate") || DEFAULT_DATE_KEY;

  if (facilityNameEl) {
    facilityNameEl.textContent = facility.name || "Untitled Facility";
  }
  if (facilityLocationEl && facility.lat != null && facility.lng != null) {
    facilityLocationEl.textContent = `${facility.lat.toFixed(4)}, ${facility.lng.toFixed(4)}`;
  }

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

  const weatherDay = {
    loading: false,
    loaded: false,
    error: "",
    solar: [],
    wind: [],
  };

  const pad2 = (value) => String(value).padStart(2, "0");
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
  const normalizeHeader = (header) =>
    cleanText(header)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const buildUrl = (base, params) => {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
  };

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
      return record;
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
      byMinute.set(hour * 60 + minute, record);
    });

    const points = [];
    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const hour = Math.floor((i * 15) / 60);
      const minute = (i * 15) % 60;
      const key = hour * 60 + minute;
      points.push(mapFn(byMinute.get(key), `${dateKey}T${pad2(hour)}:${pad2(minute)}:00`));
    }

    return points;
  };

  const setNoWeatherLoaded = () => {
    weatherDay.loaded = false;
    weatherDay.loading = false;
    weatherDay.error = "";
    weatherDay.solar = [];
    weatherDay.wind = [];
  };

  const fetchWeatherForDay = async () => {
    if (facility.lat == null || facility.lng == null) {
      setNoWeatherLoaded();
      scheduleRecompute();
      return;
    }

    weatherDay.loading = true;
    weatherDay.error = "";
    renderChart();

    try {
      const wkt = `POINT(${facility.lng} ${facility.lat})`;
      const [solarResponse, windResponse] = await Promise.all([
        fetch(buildUrl(PROXY_ENDPOINT, { dataset: "solar", wkt, interval: "15" })),
        fetch(buildUrl(PROXY_ENDPOINT, { dataset: "wind", wkt, interval: "15" })),
      ]);

      if (!solarResponse.ok || !windResponse.ok) {
        throw new Error("Unable to load weather data for selected location.");
      }

      const [solarCsv, windCsv] = await Promise.all([solarResponse.text(), windResponse.text()]);
      const solarRecords = parseCsv(solarCsv);
      const windRecords = parseCsv(windCsv);

      const windSpeedKey = pickWindSpeedKey(windRecords);
      const windTemperatureKey = pickWindTemperatureKey(windRecords);
      const windPressureKey = pickWindPressureKey(windRecords);

      weatherDay.solar = sliceDay(solarRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        ghi: toNumber(record?.ghi, 0),
        dni: toNumber(record?.dni, 0),
        dhi: toNumber(record?.dhi, 0),
        air_temperature: toNumber(record?.air_temperature, 20),
      }));

      weatherDay.wind = sliceDay(windRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        [windSpeedKey]: toNumber(record?.[windSpeedKey], 0),
        ...(windTemperatureKey ? { [windTemperatureKey]: toNumber(record?.[windTemperatureKey], NaN) } : {}),
        ...(windPressureKey ? { [windPressureKey]: toNumber(record?.[windPressureKey], NaN) } : {}),
      }));

      weatherDay.loaded = weatherDay.solar.length === POINTS_PER_DAY && weatherDay.wind.length === POINTS_PER_DAY;
    } catch (error) {
      weatherDay.loaded = false;
      weatherDay.error = error.message || "Unable to fetch weather data.";
      weatherDay.solar = [];
      weatherDay.wind = [];
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
        solarPoints: weatherDay.solar.length,
        windPoints: weatherDay.wind.length,
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
      generationChart.innerHTML = '<text x="20" y="26" fill="#c7d7f4" font-size="14">Loading weather data…</text>';
      return;
    }

    if (!weatherDay.loaded) {
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

    generationChart.innerHTML = `
      <path d="${areaPath(windKw, zero, yScale, width, height)}" fill="rgba(92, 211, 232, 0.50)" stroke="rgba(92, 211, 232, 0.95)" stroke-width="1" />
      <path d="${areaPath(solarKw, windKw, yScale, width, height)}" fill="rgba(242, 201, 76, 0.60)" stroke="rgba(247, 215, 125, 0.95)" stroke-width="1" />
      <path d="${linePath(totalKw, yScale, width, height)}" fill="none" stroke="#ffffff" stroke-width="2" />
    `;

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

  const wireFieldChanges = (card, model, prefix) => {
    card.querySelectorAll("input, select").forEach((field) => {
      const handler = () => {
        updateModelFromField(model, field, prefix);
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

  const removeAsset = (type, id) => {
    const list = type === "solar" ? solarAssets : windAssets;
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    list[index].card.remove();
    list.splice(index, 1);
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
        removeAsset(pendingDeleteType, pendingDeleteId);
      }
      deleteModal?.close();
      scheduleRecompute();
    });
  }

  const addAsset = (type) => {
    const isSolar = type === "solar";
    const template = isSolar ? solarTemplate : windTemplate;
    const listEl = isSolar ? solarList : windList;
    if (!template || !listEl) {
      return;
    }

    const nextIndex = isSolar ? ++solarCount : ++windCount;
    const assetId = `${type}-${nextIndex}-${Date.now()}`;
    const defaultModel = isSolar
      ? createSolarAsset({ name: `Solar ${nextIndex}` })
      : createWindAsset({ name: `Wind ${nextIndex}` });

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
    wireFieldChanges(card, defaultModel, isSolar ? "solar" : "wind");

    listEl.appendChild(card);

    const entry = {
      id: assetId,
      model: defaultModel,
      card,
      series: new Float64Array(POINTS_PER_DAY),
    };
    (isSolar ? solarAssets : windAssets).push(entry);

    scheduleRecompute();
  };

  if (addSolarButton) {
    addSolarButton.addEventListener("click", () => addAsset("solar"));
  }
  if (addWindButton) {
    addWindButton.addEventListener("click", () => addAsset("wind"));
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
      if (!value) {
        return;
      }
      selectedDateKey = value;
      localStorage.setItem("energyapp.selectedDate", value);
      fetchWeatherForDay();
    });
  }

  if (mapContainer && window.L) {
    const map = L.map(mapContainer, { zoomControl: false, attributionControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

    const mapState = JSON.parse(localStorage.getItem("energyapp.mapState") || "null");
    if (mapState?.bounds) {
      const bounds = [
        [mapState.bounds.south, mapState.bounds.west],
        [mapState.bounds.north, mapState.bounds.east],
      ];
      map.fitBounds(bounds, { padding: [10, 10] });
    } else if (mapState?.center && typeof mapState.zoom === "number") {
      map.setView([mapState.center.lat, mapState.center.lng], mapState.zoom);
    } else {
      map.setView([39.742, -105.1786], 10);
    }

    if (mapState?.center) {
      L.marker([mapState.center.lat, mapState.center.lng]).addTo(map);
    }
  }

  scheduleRecompute();
  fetchWeatherForDay();
})();
