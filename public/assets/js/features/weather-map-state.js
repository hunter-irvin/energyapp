(function attachWeatherMapState(global) {
  const MAP_MODES = Object.freeze({
    STREET: "street",
    SATELLITE: "satellite",
    THREE_D: "3d",
  });
  const DEFAULT_MAP_MODE = MAP_MODES.THREE_D;
  const DEFAULT_3D_PITCH = 55;

  const isSupportedMapMode = (mode) => Object.values(MAP_MODES).includes(mode);

  const normalizeMapMode = (mode) => (isSupportedMapMode(mode) ? mode : DEFAULT_MAP_MODE);

  const toFiniteNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const normalizeCameraState = (state = {}) => ({
    mode: normalizeMapMode(state.mode),
    pitch: toFiniteNumber(state.pitch, DEFAULT_3D_PITCH),
    bearing: toFiniteNumber(state.bearing, 0),
  });

  global.EnergyWeatherMapState = {
    MAP_MODES,
    DEFAULT_MAP_MODE,
    DEFAULT_3D_PITCH,
    isSupportedMapMode,
    normalizeMapMode,
    normalizeCameraState,
  };
})(typeof window !== "undefined" ? window : globalThis);
