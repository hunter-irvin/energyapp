const mapButton = document.getElementById("select-map");
const locationValue = document.getElementById("location-value");

const map = L.map("map", {
  zoomControl: false,
}).setView([39.742, -105.1786], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let selectionMode = false;
let marker = null;
let hoverMarker = null;

const updateLocation = (latlng) => {
  const { lat, lng } = latlng;
  locationValue.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
};

mapButton.addEventListener("click", () => {
  selectionMode = !selectionMode;
  mapButton.classList.toggle("is-active", selectionMode);
  mapButton.textContent = selectionMode ? "Click on map" : "Select on Map";

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
  selectionMode = false;
  mapButton.classList.remove("is-active");
  mapButton.textContent = "Select on Map";

  if (hoverMarker) {
    map.removeLayer(hoverMarker);
    hoverMarker = null;
  }
});
