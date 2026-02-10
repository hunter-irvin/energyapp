(() => {
  const POINTS_PER_DAY = 96;
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

  const numberOrDefault = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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

  const buildSolarProfile = (asset) => {
    const profile = new Float64Array(POINTS_PER_DAY);
    const capacity = Math.max(0, numberOrDefault(asset.capacity_ac_kw, 0));
    const availability = Math.max(0, Math.min(1, numberOrDefault(asset.availability_frac, 0.99)));
    const losses = Math.max(0, Math.min(0.9, numberOrDefault(asset.system_losses_frac, 0.14)));

    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const hour = i / 4;
      const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      const kw = capacity * sun * (1 - losses) * availability;
      profile[i] = Math.max(0, kw);
    }
    return profile;
  };

  const buildWindProfile = (asset, seed = 0) => {
    const profile = new Float64Array(POINTS_PER_DAY);
    const ratedPower = Math.max(0, numberOrDefault(asset.rated_power_kw, 0));
    const turbines = Math.max(1, Math.round(numberOrDefault(asset.num_turbines, 1)));
    const availability = Math.max(0, Math.min(1, numberOrDefault(asset.availability_frac, 0.97)));
    const wakeLoss = Math.max(0, Math.min(0.5, numberOrDefault(asset.wake_losses_frac, 0)));
    const electricalLoss = Math.max(0, Math.min(0.5, numberOrDefault(asset.electrical_losses_frac, 0.02)));

    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const hour = i / 4;
      const gust = 0.58 + 0.22 * Math.sin((hour / 24) * Math.PI * 2 + seed) + 0.1 * Math.cos((hour / 12) * Math.PI);
      const base = Math.max(0.08, Math.min(1, gust));
      const kw = ratedPower * turbines * base * (1 - wakeLoss) * (1 - electricalLoss) * availability;
      profile[i] = Math.max(0, kw);
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

    const solarAssets = Array.from(solarList?.querySelectorAll(".asset-card") || []).map((card) =>
      collectAssetValues(card, "solar", solarDefaults || {})
    );
    const windAssets = Array.from(windList?.querySelectorAll(".asset-card") || []).map((card, index) =>
      ({ values: collectAssetValues(card, "wind", windDefaults || {}), seed: index * 0.35 })
    );

    const solarKw = sumProfiles(solarAssets.map((asset) => buildSolarProfile(asset)));
    const windKw = sumProfiles(windAssets.map(({ values, seed }) => buildWindProfile(values, seed)));
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
})();
