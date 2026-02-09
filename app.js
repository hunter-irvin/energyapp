const mapButton = document.getElementById("select-map");
const locationValue = document.getElementById("location-value");
const loadingStatus = document.getElementById("loading-status");
const successStatus = document.getElementById("success-status");
const errorStatus = document.getElementById("error-status");

const dataStore = {
  raw15: { solar: [], wind: [] },
  daily: { solar: [], wind: [] },
};

const API_KEY = "Courz8adc7n8ydX9QySvsL29qfViI8jafqzOwqju";
const CONTACT_EMAIL = "hunter.irvin@jacobs.com";
const SOLAR_YEAR = "2024";
const WIND_YEAR = "2014";
const SOLAR_ENDPOINT =
  "https://developer.nrel.gov/api/nsrdb/v2/solar/nsrdb-GOES-conus-v4-0-0-download.csv";
const WIND_ENDPOINT =
  "https://developer.nrel.gov/api/wind-toolkit/v2/wind/wtk-download.csv";

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

const setStatus = ({ loading = false, success = "", error = "" }) => {
  loadingStatus.hidden = !loading;
  successStatus.hidden = !success;
  errorStatus.hidden = !error;
  if (success) {
    successStatus.textContent = success;
  }
  if (error) {
    errorStatus.textContent = error;
  }
};

const parseCsv = (csvText) => {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.startsWith("Year,Month"));
  if (headerIndex === -1) {
    return [];
  }
  const headers = lines[headerIndex].split(",");
  return lines.slice(headerIndex + 1).map((line) => {
    const values = line.split(",");
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index];
      return acc;
    }, {});
  });
};

const toDailyAggregation = (records, metrics) => {
  const buckets = new Map();
  records.forEach((record) => {
    const dateKey = `${record.Year}-${record.Month.padStart(2, "0")}-${record.Day.padStart(
      2,
      "0"
    )}`;
    if (!buckets.has(dateKey)) {
      buckets.set(dateKey, { date: dateKey, count: 0 });
    }
    const bucket = buckets.get(dateKey);
    bucket.count += 1;
    metrics.forEach((metric) => {
      const value = Number(record[metric]);
      if (!Number.isFinite(value)) {
        return;
      }
      bucket[metric] = (bucket[metric] || 0) + value;
    });
  });
  return Array.from(buckets.values()).map((bucket) => {
    const daily = { date: bucket.date };
    metrics.forEach((metric) => {
      daily[metric] = bucket[metric] ? bucket[metric] / bucket.count : 0;
    });
    return daily;
  });
};

const buildUrl = (base, params) => {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};

const parseError = async (responses) => {
  const failed = responses.find((response) => !response.ok);
  if (!failed) {
    return "";
  }
  try {
    const errorPayload = await failed.clone().json();
    if (Array.isArray(errorPayload?.errors) && errorPayload.errors.length > 0) {
      return errorPayload.errors.join(" ");
    }
  } catch (error) {
    // ignore parsing errors and fall back to text
  }
  const text = await failed.text();
  if (text) {
    return text;
  }
  return "Unable to fetch datasets.";
};

const fetchDataset = async ({ lat, lng }) => {
  const wkt = `POINT(${lng} ${lat})`;
  const sharedParams = {
    api_key: API_KEY,
    wkt,
    names: SOLAR_YEAR,
    utc: "true",
    leap_day: "false",
    email: CONTACT_EMAIL,
    interval: "15",
  };

  const solarUrl = buildUrl(SOLAR_ENDPOINT, {
    ...sharedParams,
    attributes: "ghi,dni,dhi,air_temperature,wind_speed",
  });
  const windUrl = buildUrl(WIND_ENDPOINT, {
    ...sharedParams,
    names: WIND_YEAR,
    attributes: "windspeed_100m,winddirection_100m,temperature_100m,pressure_100m",
  });

  const [solarResponse, windResponse] = await Promise.all([fetch(solarUrl), fetch(windUrl)]);
  const responseError = await parseError([solarResponse, windResponse]);
  if (responseError) {
    throw new Error(responseError);
  }

  const [solarCsv, windCsv] = await Promise.all([
    solarResponse.text(),
    windResponse.text(),
  ]);

  const solarRecords = parseCsv(solarCsv);
  const windRecords = parseCsv(windCsv);

  dataStore.raw15.solar = solarRecords;
  dataStore.raw15.wind = windRecords;
  dataStore.daily.solar = toDailyAggregation(solarRecords, [
    "ghi",
    "dni",
    "dhi",
    "air_temperature",
    "wind_speed",
  ]);
  dataStore.daily.wind = toDailyAggregation(windRecords, [
    "windspeed_100m",
    "winddirection_100m",
    "temperature_100m",
    "pressure_100m",
  ]);

  return {
    solarCount: solarRecords.length,
    windCount: windRecords.length,
  };
};

mapButton.addEventListener("click", () => {
  selectionMode = !selectionMode;
  mapButton.classList.toggle("is-active", selectionMode);
  mapButton.textContent = selectionMode ? "Click on map" : "Select on Map";
  if (selectionMode) {
    setStatus({ loading: false, success: "", error: "" });
  }

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

  setStatus({ loading: true });
  mapButton.disabled = true;
  fetchDataset(event.latlng)
    .then(({ solarCount, windCount }) => {
      setStatus({
        loading: false,
        success: `Loaded ${solarCount} solar points (2024) and ${windCount} wind points (2014).`,
      });
    })
    .catch((error) => {
      setStatus({ loading: false, error: error.message });
    })
    .finally(() => {
      mapButton.disabled = false;
    });
});
