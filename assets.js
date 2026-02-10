(() => {
  const facilityNameEl = document.querySelector("[data-facility-name]");
  const facilityLocationEl = document.querySelector("[data-facility-location]");
  const solarFields = document.querySelectorAll("[data-solar-field]");
  const windFields = document.querySelectorAll("[data-wind-field]");
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

  if (solarDefaults) {
    solarFields.forEach((field) => {
      const key = field.dataset.solarField;
      const value = solarDefaults[key];
      if (value == null) {
        return;
      }
      if (field.tagName === "SELECT") {
        field.value = String(value);
      } else {
        field.value = value;
      }
    });
  }

  if (windDefaults) {
    windFields.forEach((field) => {
      const key = field.dataset.windField;
      const value = windDefaults[key];
      if (value == null) {
        return;
      }
      if (field.tagName === "SELECT") {
        field.value = String(value);
      } else {
        field.value = value;
      }
    });
  }

  if (mapContainer && window.L) {
    const map = L.map(mapContainer, { zoomControl: false, attributionControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

    const mapState = JSON.parse(localStorage.getItem("energyapp.mapState") || "null");
    if (mapState?.center && typeof mapState.zoom === "number") {
      map.setView([mapState.center.lat, mapState.center.lng], mapState.zoom);
      L.marker([mapState.center.lat, mapState.center.lng]).addTo(map);
    } else {
      map.setView([39.742, -105.1786], 10);
    }
  }
})();
