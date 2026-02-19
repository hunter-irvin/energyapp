(() => {
  const fallbackConfig = {
    url: "",
    anonKey: "",
  };

  const existingConfig = window.ENERGYAPP_SUPABASE_CONFIG || {};
  const config = {
    url: typeof existingConfig.url === "string" && existingConfig.url.trim() ? existingConfig.url.trim() : fallbackConfig.url,
    anonKey:
      typeof existingConfig.anonKey === "string" && existingConfig.anonKey.trim()
        ? existingConfig.anonKey.trim()
        : fallbackConfig.anonKey,
  };

  window.ENERGYAPP_SUPABASE_CONFIG = config;
  if (!window.ENERGYAPP_SUPABASE_URL) {
    window.ENERGYAPP_SUPABASE_URL = config.url;
  }
  if (!window.ENERGYAPP_SUPABASE_ANON_KEY) {
    window.ENERGYAPP_SUPABASE_ANON_KEY = config.anonKey;
  }
})();

