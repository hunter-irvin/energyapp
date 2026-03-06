const assert = require("assert");
const path = require("path");

const createLocalStorageMock = () => {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
  };
};

const runWeatherSyncBusTests = () => {
  const listeners = { storage: [] };
  global.localStorage = createLocalStorageMock();
  global.BroadcastChannel = undefined;
  global.window = global.window || {};
  global.window.addEventListener = (name, handler) => {
    listeners[name] = listeners[name] || [];
    listeners[name].push(handler);
  };
  global.window.removeEventListener = (name, handler) => {
    const list = listeners[name] || [];
    listeners[name] = list.filter((entry) => entry !== handler);
  };

  require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "weather-sync-bus.js"));

  const bus = global.window.EnergyWeatherSyncBus;
  assert.ok(bus, "Expected EnergyWeatherSyncBus module.");

  const emitted = bus.broadcast("weather_sync_started", { projectId: "proj-1" });
  assert.strictEqual(emitted.type, "weather_sync_started");
  const stored = JSON.parse(global.localStorage.getItem(bus.STORAGE_EVENT_KEY));
  assert.strictEqual(stored.type, "weather_sync_started");

  let received = null;
  const unsubscribe = bus.subscribe((event) => {
    received = event;
  });

  const storageHandlers = listeners.storage || [];
  storageHandlers.forEach((handler) => {
    handler({ key: bus.STORAGE_EVENT_KEY, newValue: JSON.stringify({ type: "weather_sync_complete", projectId: "proj-1" }) });
  });

  assert.strictEqual(received?.type, "weather_sync_complete");
  assert.strictEqual(received?.projectId, "proj-1");

  unsubscribe();
};

module.exports = { runWeatherSyncBusTests };
