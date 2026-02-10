(() => {
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
    list.appendChild(card);
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
})();
