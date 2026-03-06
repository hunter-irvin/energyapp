(() => {
  const CHANNEL_NAME = "energyapp-weather-sync";
  const STORAGE_EVENT_KEY = "energyapp.weather.sync.event";

  let channel = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function createMessage(type, payload = {}) {
    return {
      type: String(type || "event"),
      at: nowIso(),
      ...payload,
    };
  }

  function broadcast(type, payload = {}) {
    const message = createMessage(type, payload);

    try {
      if (typeof BroadcastChannel !== "undefined") {
        if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage(message);
      }
    } catch (_error) {}

    try {
      localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(message));
    } catch (_error) {}

    return message;
  }

  function subscribe(handler) {
    const callback = typeof handler === "function" ? handler : () => {};

    const onChannelMessage = (event) => {
      callback(event?.data || null);
    };

    const onStorage = (event) => {
      if (!event || event.key !== STORAGE_EVENT_KEY || !event.newValue) return;
      try {
        callback(JSON.parse(event.newValue));
      } catch (_error) {}
    };

    if (typeof BroadcastChannel !== "undefined") {
      if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", onChannelMessage);
    }
    window.addEventListener("storage", onStorage);

    return () => {
      if (channel) {
        channel.removeEventListener("message", onChannelMessage);
      }
      window.removeEventListener("storage", onStorage);
    };
  }

  window.EnergyWeatherSyncBus = {
    CHANNEL_NAME,
    STORAGE_EVENT_KEY,
    broadcast,
    subscribe,
  };
})();
