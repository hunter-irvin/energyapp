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

  const facility = JSON.parse(localStorage.getItem("energyapp.facility") || "{}");
  if (facilityNameEl) {
    facilityNameEl.textContent = facility.name || "Untitled Facility";
  }
  if (facilityLocationEl && facility.lat != null && facility.lng != null) {
    facilityLocationEl.textContent = `${facility.lat.toFixed(4)}, ${facility.lng.toFixed(4)}`;
  }

  const solarDefaults = window.EnergyModels?.DEFAULT_SOLAR_ASSET;
  const windDefaults = window.EnergyModels?.DEFAULT_WIND_ASSET;
  let solarCount = 0;
  let windCount = 0;
  let pendingDeleteCard = null;

  const selectedDateKey = localStorage.getItem("energyapp.selectedDate") || DEFAULT_DATE_KEY;
  const weatherDay = {
    loading: false,
    error: "",
    solar: Array.from({ length: POINTS_PER_DAY }, (_, i) => ({ timestamp: i, ghi: 0, air_temperature: 20 })),
    wind: Array.from({ length: POINTS_PER_DAY }, (_, i) => ({ timestamp: i, windspeed: 0 })),
  };

  const pad2 = (value) => String(value).padStart(2, "0");
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
  const normalizeHeader = (header) =>
    cleanText(header)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const numberOrDefault = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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
    const keys = Object.keys(records[0]).filter((key) => /^windspeed_\d+m$/.test(key));
    if (keys.includes("windspeed_100m")) {
      return "windspeed_100m";
    }
    return keys[0] || "windspeed_100m";
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
      points.push(
        mapFn(byMinute.get(key), `${dateKey}T${pad2(hour)}:${pad2(minute)}:00`)
      );
    }
    return points;
  };

  const fetchWeatherForDay = async () => {
    if (facility.lat == null || facility.lng == null) {
      return;
    }

    weatherDay.loading = true;
    weatherDay.error = "";
    renderChart();

    try {
      const wkt = `POINT(${facility.lng} ${facility.lat})`;
      const [solarCsv, windCsv] = await Promise.all([
        fetch(buildUrl(PROXY_ENDPOINT, { dataset: "solar", wkt, interval: "15" })).then((r) => r.text()),
        fetch(buildUrl(PROXY_ENDPOINT, { dataset: "wind", wkt, interval: "15" })).then((r) => r.text()),
      ]);

      const solarRecords = parseCsv(solarCsv);
      const windRecords = parseCsv(windCsv);
      const windSpeedKey = pickWindSpeedKey(windRecords);

      weatherDay.solar = sliceDay(solarRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        ghi: numberOrDefault(record?.ghi, 0),
        dni: numberOrDefault(record?.dni, 0),
        dhi: numberOrDefault(record?.dhi, 0),
        air_temperature: numberOrDefault(record?.air_temperature, 20),
      }));

      weatherDay.wind = sliceDay(windRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        windspeed: numberOrDefault(record?.[windSpeedKey], 0),
      }));
    } catch (error) {
      weatherDay.error = error.message || "Unable to fetch weather data.";
    } finally {
      weatherDay.loading = false;
      renderChart();
    }
  };

  const collectAssetValues = (card, prefix, defaults) => {
    const fields = card.querySelectorAll(`[data-${prefix}-field]`);
    const values = { ...defaults };
    fields.forEach((field) => {
      const key = field.dataset[`${prefix}Field`];
      if (!key) {
        return;
      }
      if (field.type === "number") {
        values[key] = numberOrDefault(field.value, defaults[key]);
      } else if (field.tagName === "SELECT") {
        if (field.value === "true" || field.value === "false") {
          values[key] = field.value === "true";
        } else {
          values[key] = field.value;
        }
      } else {
        values[key] = field.value;
      }
    });
    return values;
  };

  const buildSolarProfile = (asset, solarSlice) => {
    if (window.EnergyGeneration?.computeSolarPower) {
      return window.EnergyGeneration.computeSolarPower(asset, solarSlice);
    }

    const profile = new Float64Array(POINTS_PER_DAY);
    const capacity = Math.max(0, numberOrDefault(asset.capacity_ac_kw, 0));
    const availability = Math.max(0, Math.min(1, numberOrDefault(asset.availability_frac, 0.99)));
    const losses = Math.max(0, Math.min(0.9, numberOrDefault(asset.system_losses_frac, 0.14)));

    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const ghi = Math.max(0, numberOrDefault(solarSlice[i]?.ghi, 0));
      const irradianceFactor = Math.min(1.2, ghi / 1000);
      profile[i] = Math.max(0, capacity * irradianceFactor * (1 - losses) * availability);
    }
    return profile;
  };

  const buildWindProfile = (asset, windSlice) => {
    const profile = new Float64Array(POINTS_PER_DAY);
    const ratedPower = Math.max(0, numberOrDefault(asset.rated_power_kw, 0));
    const turbines = Math.max(1, Math.round(numberOrDefault(asset.num_turbines, 1)));
    const availability = Math.max(0, Math.min(1, numberOrDefault(asset.availability_frac, 0.97)));
    const wakeLoss = Math.max(0, Math.min(0.5, numberOrDefault(asset.wake_losses_frac, 0)));
    const electricalLoss = Math.max(0, Math.min(0.5, numberOrDefault(asset.electrical_losses_frac, 0.02)));

    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const speed = Math.max(0, numberOrDefault(windSlice[i]?.windspeed, 0));
      const fraction = Math.min(1, speed / 12);
      profile[i] = Math.max(0, ratedPower * turbines * fraction * (1 - wakeLoss) * (1 - electricalLoss) * availability);
    }
    return profile;
  };

  const sumProfiles = (profiles) => {
    const total = new Float64Array(POINTS_PER_DAY);
    profiles.forEach((profile) => {
      for (let i = 0; i < POINTS_PER_DAY; i += 1) {
        total[i] += profile[i];
      }
    });
    return total;
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

  const renderChart = () => {
    if (!generationChart) {
      return;
    }

    if (weatherDay.loading) {
      generationChart.innerHTML = '<text x="20" y="26" fill="#c7d7f4" font-size="14">Loading weather data…</text>';
      return;
    }

    if (weatherDay.error) {
      generationChart.innerHTML = `<text x="20" y="26" fill="#ffb3b3" font-size="13">${weatherDay.error}</text>`;
      return;
    }

    const solarAssets = Array.from(solarList?.querySelectorAll(".asset-card") || []).map((card) =>
      collectAssetValues(card, "solar", solarDefaults || {})
    );
    const windAssets = Array.from(windList?.querySelectorAll(".asset-card") || []).map((card) =>
      collectAssetValues(card, "wind", windDefaults || {})
    );

    const solarKw = window.EnergyGeneration?.sumSolarAssets
      ? window.EnergyGeneration.sumSolarAssets(solarAssets, weatherDay.solar)
      : sumProfiles(solarAssets.map((asset) => buildSolarProfile(asset, weatherDay.solar)));
    const windKw = sumProfiles(windAssets.map((asset) => buildWindProfile(asset, weatherDay.wind)));
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
  };

  const wireFieldChanges = (card) => {
    card.querySelectorAll("input, select").forEach((field) => {
      field.addEventListener("input", renderChart);
      field.addEventListener("change", renderChart);
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
        renderChart();
      });
    });
  };

  const wireDelete = (card) => {
    const deleteButton = card.querySelector(".asset-delete");
    if (!deleteButton || !deleteModal || !confirmDeleteButton) {
      return;
    }
    deleteButton.addEventListener("click", () => {
      pendingDeleteCard = card;
      deleteModal.showModal();
    });
  };

  if (deleteModal) {
    deleteModal.addEventListener("close", () => {
      pendingDeleteCard = null;
    });
  }

  if (confirmDeleteButton) {
    confirmDeleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (pendingDeleteCard) {
        pendingDeleteCard.remove();
        pendingDeleteCard = null;
      }
      deleteModal?.close();
      renderChart();
    });
  }

  const addAsset = (type) => {
    const isSolar = type === "solar";
    const template = isSolar ? solarTemplate : windTemplate;
    const list = isSolar ? solarList : windList;
    const defaults = isSolar ? solarDefaults : windDefaults;
    if (!template || !list || !defaults) {
      return;
    }
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".asset-card");
    if (!card) {
      return;
    }
    const nextIndex = isSolar ? ++solarCount : ++windCount;
    const assetName = isSolar ? `Solar ${nextIndex}` : `Wind ${nextIndex}`;
    populateFields(card, defaults, isSolar ? "solar" : "wind");
    const nameInput = card.querySelector(".asset-title-input");
    if (nameInput) {
      nameInput.value = assetName;
    }
    wireSectionToggles(card);
    wireDelete(card);
    wireFieldChanges(card);
    list.appendChild(card);
    renderChart();
  };

  if (addSolarButton) {
    addSolarButton.addEventListener("click", () => addAsset("solar"));
  }
  if (addWindButton) {
    addWindButton.addEventListener("click", () => addAsset("wind"));
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

  renderChart();
  fetchWeatherForDay();
})();
