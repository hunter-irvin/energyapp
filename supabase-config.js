(() => {
  const fallbackConfig = {
    url: "https://wdsvqjbqftoxzlovyuzk.supabase.co",
    anonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkc3ZxamJxZnRveHpsb3Z5dXprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NjU4MjYsImV4cCI6MjA4NjE0MTgyNn0.fqx_Gh7kdSrpnh21Pd_EA1Mp4TnwfTn7dmrqP_ZCUl0",
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
