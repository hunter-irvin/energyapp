(() => {
  // Debug script availability
  console.log('[Supabase Client Init] Starting initialization', {
    hasSupabase: !!window.supabase,
    hasURL: !!window.ENERGYAPP_SUPABASE_URL,
    hasKey: !!window.ENERGYAPP_SUPABASE_ANON_KEY,
    hasConfigObject: !!window.ENERGYAPP_SUPABASE_CONFIG,
    supabaseVersion: window.supabase?.version || 'unknown',
  });

  // Track backend status for UI error reporting
  let backendStatus = {
    type: 'unknown', // 'supabase', 'supabase_unavailable', or 'unknown'
    isWorking: null, // true, false, or null (untested)
    lastError: null, // Last error message if backend is unavailable
    errorCode: null, // Supabase error code if available
    credentialSource: null,
  };

  const LAST_PROJECT_STORAGE_KEY = "energyapp.lastOpenedProjectId";
  const MIGRATION_STORAGE_KEY = "energyapp.legacyMigration.v1";
  const LEGACY_KEYS = {
    facility: "energyapp.facility",
    assetsState: "energyapp.assetsState",
    selectedDate: "energyapp.selectedDate",
    mapState: "energyapp.mapState",
  };

  const safeParse = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  };

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let clientCache = null;
  let clientInitPromise = null;

  const normalizeCredential = (value) => (typeof value === "string" ? value.trim() : "");

  const resolveSupabaseCredentials = async () => {
    const fromWindow = {
      url: normalizeCredential(window.ENERGYAPP_SUPABASE_URL),
      anonKey: normalizeCredential(window.ENERGYAPP_SUPABASE_ANON_KEY),
      source: "window globals",
    };
    if (fromWindow.url && fromWindow.anonKey) {
      return fromWindow;
    }

    const config = window.ENERGYAPP_SUPABASE_CONFIG || null;
    const fromConfigObject = {
      url: normalizeCredential(config?.url),
      anonKey: normalizeCredential(config?.anonKey),
      source: "window.ENERGYAPP_SUPABASE_CONFIG",
    };
    if (fromConfigObject.url && fromConfigObject.anonKey) {
      window.ENERGYAPP_SUPABASE_URL = fromConfigObject.url;
      window.ENERGYAPP_SUPABASE_ANON_KEY = fromConfigObject.anonKey;
      return fromConfigObject;
    }

    if (typeof fetch === "function") {
      try {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
        const response = await fetch("/api/runtime-config", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller?.signal,
        });
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (response.ok) {
          const payload = await response.json();
          const fromApi = {
            url: normalizeCredential(payload?.supabaseUrl),
            anonKey: normalizeCredential(payload?.supabaseAnonKey),
            source: "/api/runtime-config",
          };
          if (fromApi.url && fromApi.anonKey) {
            window.ENERGYAPP_SUPABASE_URL = fromApi.url;
            window.ENERGYAPP_SUPABASE_ANON_KEY = fromApi.anonKey;
            return fromApi;
          }
        }
      } catch (error) {
        // Ignore runtime-config lookup failures and continue with local fallback.
      }
    }

    return null;
  };

  const getClient = async () => {
    // Return cached client if available
    if (clientCache) {
      return clientCache;
    }

    // If already initializing, wait for that promise
    if (clientInitPromise) {
      return clientInitPromise;
    }

    // Initialize the client with retry logic
    clientInitPromise = (async () => {
      const credentials = await resolveSupabaseCredentials();
      const url = credentials?.url || "";
      const anonKey = credentials?.anonKey || "";

      // Verify credentials are injected (should be immediate)
      if (!url || !anonKey) {
        const missing = [];
        if (!url) missing.push('window.ENERGYAPP_SUPABASE_URL');
        if (!anonKey) missing.push('window.ENERGYAPP_SUPABASE_ANON_KEY');

        const reason = `Missing credentials: ${missing.join(', ')}`;
        backendStatus.type = 'supabase_unavailable';
        backendStatus.isWorking = false;
        backendStatus.lastError = reason;
        backendStatus.errorCode = 'MISSING_CREDENTIALS';
        backendStatus.credentialSource = null;

        console.error('[Supabase Client] Credentials not injected:', reason);
        return null;
      }

      // Wait for Supabase SDK to load (retry up to 50 times with 100ms intervals = 5 seconds)
      let retries = 0;
      const maxRetries = 50;
      while (!window.supabase && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }

      if (!window.supabase) {
        const reason = 'Supabase SDK failed to load from CDN after 5 seconds';
        backendStatus.type = 'supabase_unavailable';
        backendStatus.isWorking = false;
        backendStatus.lastError = reason;
        backendStatus.errorCode = 'SDK_LOAD_TIMEOUT';

        console.error('[Supabase Client]', reason);
        return null;
      }

      try {
        const sdk = window.supabase;
        const client = sdk.createClient(url, anonKey);
        backendStatus.type = 'supabase';
        backendStatus.isWorking = true;
        backendStatus.lastError = null;
        backendStatus.errorCode = null;
        backendStatus.credentialSource = credentials.source;

        clientCache = client;
        console.log('[Supabase Client] Successfully initialized Supabase client', {
          url,
          credentialSource: credentials.source,
        });
        return client;
      } catch (error) {
        backendStatus.type = 'supabase_unavailable';
        backendStatus.isWorking = false;
        backendStatus.lastError = error.message;
        backendStatus.errorCode = error.code || 'INIT_ERROR';
        backendStatus.credentialSource = credentials.source;

        console.error('[Supabase Client] Error creating Supabase client:', error);
        return null;
      }
    })();
    const client = await clientInitPromise;
    if (!client) {
      // Allow future calls to retry initialization if credentials/sdk become available.
      clientInitPromise = null;
    }
    return client;
  };

  const toProjectRow = (project) => ({
    id: project.id,
    name: project.name || "Untitled Facility",
    location_lat: project.lat ?? null,
    location_lng: project.lng ?? null,
    selected_date: project.selectedDate || null,
    weather_provider: project.weatherProvider || null,
    utility_name: project.utilityName || null,
    iso_region: project.isoRegion || null,
    timezone: project.timezone || null,
    rates_service_type: project.ratesServiceType || null,
    rates_market_mode: project.ratesMarketMode || null,
    map_state: project.mapState || null,
    created_at: project.created_at || project.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const fromProjectRow = (row) => ({
    id: row.id,
    name: row.name || "Untitled Facility",
    lat: row.location_lat == null ? null : Number(row.location_lat),
    lng: row.location_lng == null ? null : Number(row.location_lng),
    selectedDate: row.selected_date || null,
    weatherProvider: row.weather_provider || null,
    utilityName: row.utility_name || null,
    isoRegion: row.iso_region || null,
    timezone: row.timezone || null,
    ratesServiceType: row.rates_service_type || null,
    ratesMarketMode: row.rates_market_mode || null,
    mapState: row.map_state || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  });

  const toAssetRow = ({ id, projectId, type, model }) => ({
    id,
    project_id: projectId,
    asset_type: type,
    name: model?.name || "",
    model,
    updated_at: new Date().toISOString(),
  });

  const fromAssetRow = (row) => ({
    id: row.id,
    projectId: row.project_id,
    type: row.asset_type,
    model: row.model || {},
    name: row.name || row.model?.name || "",
    updatedAt: row.updated_at || null,
  });

  const supabaseDb = (client) => ({
    _isMissingColumnError(error) {
      const message = String(error?.message || "").toLowerCase();
      return error?.code === "PGRST204" || message.includes("column") && message.includes("projects");
    },
    _isMissingTableError(error) {
      const message = String(error?.message || "").toLowerCase();
      return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("does not exist");
    },
    async listProjects() {
      const { data, error } = await client.from("projects").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(fromProjectRow);
    },
    async createProject(payload = {}) {
      const fullRow = toProjectRow({ id: payload.id || uid(), ...payload });
      let { data, error } = await client.from("projects").insert(fullRow).select().single();
      if (error && this._isMissingColumnError(error)) {
        const fallbackRow = {
          id: fullRow.id,
          name: fullRow.name,
          location_lat: fullRow.location_lat,
          location_lng: fullRow.location_lng,
          selected_date: fullRow.selected_date,
          weather_provider: fullRow.weather_provider,
          map_state: fullRow.map_state,
          created_at: fullRow.created_at,
          updated_at: fullRow.updated_at,
        };
        ({ data, error } = await client.from("projects").insert(fallbackRow).select().single());
      }
      if (error) throw error;
      return fromProjectRow(data);
    },
    async getProject(projectId) {
      const { data, error } = await client.from("projects").select("*").eq("id", projectId).maybeSingle();
      if (error) throw error;
      return data ? fromProjectRow(data) : null;
    },
    async updateProject(projectId, patch = {}) {
      const updatePayload = {};
      if (Object.prototype.hasOwnProperty.call(patch, "name")) updatePayload.name = patch.name;
      if (Object.prototype.hasOwnProperty.call(patch, "lat")) updatePayload.location_lat = patch.lat;
      if (Object.prototype.hasOwnProperty.call(patch, "lng")) updatePayload.location_lng = patch.lng;
      if (Object.prototype.hasOwnProperty.call(patch, "selectedDate")) updatePayload.selected_date = patch.selectedDate;
      if (Object.prototype.hasOwnProperty.call(patch, "weatherProvider")) updatePayload.weather_provider = patch.weatherProvider;
      if (Object.prototype.hasOwnProperty.call(patch, "utilityName")) updatePayload.utility_name = patch.utilityName;
      if (Object.prototype.hasOwnProperty.call(patch, "isoRegion")) updatePayload.iso_region = patch.isoRegion;
      if (Object.prototype.hasOwnProperty.call(patch, "timezone")) updatePayload.timezone = patch.timezone;
      if (Object.prototype.hasOwnProperty.call(patch, "ratesServiceType"))
        updatePayload.rates_service_type = patch.ratesServiceType;
      if (Object.prototype.hasOwnProperty.call(patch, "ratesMarketMode"))
        updatePayload.rates_market_mode = patch.ratesMarketMode;
      if (Object.prototype.hasOwnProperty.call(patch, "mapState")) updatePayload.map_state = patch.mapState;
      updatePayload.updated_at = new Date().toISOString();
      let { data, error } = await client.from("projects").update(updatePayload).eq("id", projectId).select().single();
      if (error && this._isMissingColumnError(error)) {
        const fallbackPayload = { ...updatePayload };
        delete fallbackPayload.utility_name;
        delete fallbackPayload.iso_region;
        delete fallbackPayload.timezone;
        delete fallbackPayload.rates_service_type;
        delete fallbackPayload.rates_market_mode;
        ({ data, error } = await client.from("projects").update(fallbackPayload).eq("id", projectId).select().single());
      }
      if (error) throw error;
      return fromProjectRow(data);
    },
    async deleteProject(projectId) {
      const { error: assetsError } = await client.from("assets").delete().eq("project_id", projectId);
      if (assetsError) throw assetsError;

      const { error: weatherCacheError } = await client.from("weather_cache").delete().eq("project_id", projectId);
      if (weatherCacheError && !this._isMissingTableError(weatherCacheError)) throw weatherCacheError;
      if (weatherCacheError && this._isMissingTableError(weatherCacheError)) {
        const { error: legacyCacheError } = await client.from("nrel_cache").delete().eq("project_id", projectId);
        if (legacyCacheError) throw legacyCacheError;
      } else {
        const { error: legacyCacheCleanupError } = await client.from("nrel_cache").delete().eq("project_id", projectId);
        if (legacyCacheCleanupError && !this._isMissingTableError(legacyCacheCleanupError)) throw legacyCacheCleanupError;
      }

      const { error: rateSeriesError } = await client.from("rate_series_cache").delete().eq("project_id", projectId);
      if (rateSeriesError && rateSeriesError.code !== "42P01") throw rateSeriesError;

      const { error: rateHealthError } = await client.from("rate_region_health").delete().eq("project_id", projectId);
      if (rateHealthError && rateHealthError.code !== "42P01") throw rateHealthError;

      const { error: projectError } = await client.from("projects").delete().eq("id", projectId);
      if (projectError) throw projectError;

      const scopedPrefix = `energyapp.project.${projectId}.`;
      const sharedCachePrefix = `energyapp.shared.project.${projectId}.`;
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(scopedPrefix) || key.startsWith(sharedCachePrefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      if (localStorage.getItem(LAST_PROJECT_STORAGE_KEY) === projectId) {
        localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }
      return true;
    },
    async listAssets(projectId) {
      const { data, error } = await client.from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(fromAssetRow);
    },
    async upsertAsset(payload) {
      const row = toAssetRow({ ...payload, id: payload.id || uid() });
      const { data, error } = await client.from("assets").upsert(row).select().single();
      if (error) throw error;
      return fromAssetRow(data);
    },
    async deleteAsset(assetId) {
      const { error } = await client.from("assets").delete().eq("id", assetId);
      if (error) throw error;
      return true;
    },
    async getWeatherCache(projectId, provider, dataset, dateKey, options = {}) {
      const { sourceYear = null, intervalMinutes = null } = options;
      const runLookup = async (tableName) => {
        let query = client
          .from(tableName)
          .select("*")
          .eq("project_id", projectId)
          .eq("dataset", dataset)
          .eq("date_key", dateKey);

        if (provider === "nrel") {
          query = query.or("provider.eq.nrel,provider.is.null");
        } else {
          query = query.eq("provider", provider);
        }

        if (sourceYear != null) {
          query = query.eq("source_year", sourceYear);
        } else {
          query = query.is("source_year", null);
        }

        if (intervalMinutes != null) {
          query = query.eq("interval_minutes", intervalMinutes);
        }
        return query.order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      };

      let response = await runLookup("weather_cache");
      if (response.error && this._isMissingTableError(response.error)) {
        response = await runLookup("nrel_cache");
      }
      if (response.error) {
        throw response.error;
      }
      return response.data || null;
    },
    async upsertWeatherCache(payload) {
      const row = {
        project_id: payload.projectId,
        provider: payload.provider || "nrel",
        dataset: payload.dataset,
        date_key: payload.dateKey,
        source_year: payload.sourceYear == null ? null : Number(payload.sourceYear),
        interval_minutes: payload.intervalMinutes,
        wkt: payload.wkt || null,
        timezone: payload.timezone || null,
        source: payload.source || "weather_proxy",
        fetched_at: payload.fetchedAt || new Date().toISOString(),
        payload: payload.payload,
        updated_at: new Date().toISOString(),
      };
      let response = await client
        .from("weather_cache")
        .upsert(row, { onConflict: "project_id,provider,dataset,date_key,interval_minutes,source_year" })
        .select()
        .single();
      if (response.error && this._isMissingTableError(response.error)) {
        response = await client
          .from("nrel_cache")
          .upsert(row, { onConflict: "project_id,provider,dataset,date_key,interval_minutes,source_year" })
          .select()
          .single();
      }
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    async getNrelCache(projectId, dataset, dateKey, options = {}) {
      return this.getWeatherCache(projectId, "nrel", dataset, dateKey, options);
    },
    async upsertNrelCache(payload) {
      return this.upsertWeatherCache({ ...payload, provider: "nrel" });
    },
    async getRateSeriesCache(projectId, { regionId, serviceType, marketMode, windowStart, windowEnd } = {}) {
      let query = client
        .from("rate_series_cache")
        .select("*")
        .eq("project_id", projectId)
        .eq("window_start", windowStart)
        .eq("window_end", windowEnd);
      if (regionId) query = query.eq("region_id", regionId);
      if (serviceType) query = query.eq("service_type", serviceType);
      if (marketMode) query = query.eq("market_mode", marketMode);
      const { data, error } = await query.order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      if (error) {
        throw error;
      }
      return data || null;
    },
    async upsertRateSeriesCache(payload) {
      const row = {
        project_id: payload.projectId,
        region_id: payload.regionId,
        service_type: payload.serviceType,
        market_mode: payload.marketMode,
        window_start: payload.windowStart,
        window_end: payload.windowEnd,
        timezone: payload.timezone || null,
        source: payload.source || "rates_proxy_phase1",
        source_unit: payload.sourceUnit || null,
        confidence: payload.confidence || null,
        quality_status: payload.qualityStatus || "unknown",
        api_version: payload.apiVersion || "v2",
        ingest_notes: payload.ingestNotes || {},
        fetched_at: payload.fetchedAt || new Date().toISOString(),
        payload: payload.payload,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client
        .from("rate_series_cache")
        .upsert(row, { onConflict: "project_id,region_id,service_type,market_mode,window_start,window_end" })
        .select()
        .single();
      if (error) {
        throw error;
      }
      return data;
    },
    async clearRateSeriesCache(projectId, { regionId, serviceType, marketMode, windowStart, windowEnd } = {}) {
      let query = client.from("rate_series_cache").delete().eq("project_id", projectId);
      if (regionId) query = query.eq("region_id", regionId);
      if (serviceType) query = query.eq("service_type", serviceType);
      if (marketMode) query = query.eq("market_mode", marketMode);
      if (windowStart) query = query.eq("window_start", windowStart);
      if (windowEnd) query = query.eq("window_end", windowEnd);
      const { error } = await query;
      if (error) {
        throw error;
      }
      return true;
    },
    async listRateRegionHealth(projectId, { windowStart, windowEnd } = {}) {
      let query = client
        .from("rate_region_health")
        .select("*")
        .eq("project_id", projectId)
        .eq("window_start", windowStart)
        .eq("window_end", windowEnd);
      const { data, error } = await query
        .order("region_id", { ascending: true })
        .order("service_type", { ascending: true })
        .order("market_mode", { ascending: true });
      if (error) {
        throw error;
      }
      return data || [];
    },
    async upsertRateRegionHealth(payload = {}) {
      const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((healthRow) => ({
        project_id: payload.projectId,
        region_id: healthRow.regionId,
        service_type: healthRow.serviceType,
        market_mode: healthRow.marketMode || (healthRow.serviceType === "tariff" ? "tariff" : "day_ahead"),
        status: healthRow.status,
        last_updated_at: healthRow.lastUpdatedAt || null,
        source: healthRow.source || null,
        source_unit: healthRow.sourceUnit || null,
        confidence: healthRow.confidence || null,
        api_version: payload.apiVersion || "v2",
        window_start: payload.windowStart,
        window_end: payload.windowEnd,
        expected_hours: Number(healthRow.expectedHours || 0),
        missing_hours: Number(healthRow.missingHours || 0),
        details: healthRow.details || {},
        updated_at: new Date().toISOString(),
      }));
      if (!rows.length) {
        return [];
      }
      const { error } = await client
        .from("rate_region_health")
        .upsert(rows, { onConflict: "project_id,region_id,service_type,market_mode,window_start,window_end" });
      if (error) {
        throw error;
      }
      return this.listRateRegionHealth(payload.projectId, {
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
      });
    },
    async insertRateIngestRun(payload = {}) {
      const row = {
        project_id: payload.projectId || null,
        region_id: payload.regionId || "NON-ISO",
        service_type: payload.serviceType || "lmp",
        market_mode: payload.marketMode || "day_ahead",
        source: payload.source || null,
        source_unit: payload.sourceUnit || null,
        api_version: payload.apiVersion || "v2",
        status: payload.status || "failed",
        row_count: Number(payload.rowCount || 0),
        missing_hours: Number(payload.missingHours || 0),
        message: payload.message || null,
        details: payload.details || {},
        window_start: payload.windowStart || null,
        window_end: payload.windowEnd || null,
        run_started_at: payload.runStartedAt || new Date().toISOString(),
        run_finished_at: payload.runFinishedAt || new Date().toISOString(),
      };
      const { data, error } = await client.from("rate_ingest_runs").insert(row).select().single();
      if (error) {
        throw error;
      }
      return data;
    },
    async listRateIngestRuns(projectId, { regionId, serviceType, marketMode, status, limit = 500 } = {}) {
      let query = client
        .from("rate_ingest_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("run_finished_at", { ascending: false })
        .limit(Math.max(1, Math.min(1000, Number(limit) || 500)));
      if (regionId) query = query.eq("region_id", regionId);
      if (serviceType) query = query.eq("service_type", serviceType);
      if (marketMode) query = query.eq("market_mode", marketMode);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return data || [];
    },
  });

  const dataService = async () => {
    const client = await getClient();
    if (!client) {
      backendStatus.type = "supabase_unavailable";
      backendStatus.isWorking = false;
      backendStatus.lastError = backendStatus.lastError || "Supabase is required but unavailable.";
      backendStatus.errorCode = backendStatus.errorCode || "SUPABASE_REQUIRED";
      throw new Error("Supabase is required for persistence. Check Supabase credentials and SDK loading.");
    }
    console.debug("[EnergySupabaseService] Using persistence backend: Supabase");
    return supabaseDb(client);
  };

  const listProjects = async () => (await dataService()).listProjects();
  const createProject = async (payload) => (await dataService()).createProject(payload);
  const getProject = async (projectId) => (await dataService()).getProject(projectId);
  const updateProject = async (projectId, patch) => (await dataService()).updateProject(projectId, patch);
  const deleteProject = async (projectId) => (await dataService()).deleteProject(projectId);
  const listAssets = async (projectId) => (await dataService()).listAssets(projectId);
  const upsertAsset = async (payload) => (await dataService()).upsertAsset(payload);
  const deleteAsset = async (assetId) => (await dataService()).deleteAsset(assetId);
  const getWeatherCache = async (projectId, provider, dataset, dateKey, options) =>
    (await dataService()).getWeatherCache(projectId, provider, dataset, dateKey, options);
  const upsertWeatherCache = async (payload) => (await dataService()).upsertWeatherCache(payload);
  const getNrelCache = async (projectId, dataset, dateKey, options) =>
    (await dataService()).getNrelCache(projectId, dataset, dateKey, options);
  const upsertNrelCache = async (payload) => (await dataService()).upsertNrelCache(payload);
  const getRateSeriesCache = async (projectId, options) => (await dataService()).getRateSeriesCache(projectId, options);
  const upsertRateSeriesCache = async (payload) => (await dataService()).upsertRateSeriesCache(payload);
  const clearRateSeriesCache = async (projectId, options) =>
    (await dataService()).clearRateSeriesCache(projectId, options);
  const listRateRegionHealth = async (projectId, options) => (await dataService()).listRateRegionHealth(projectId, options);
  const upsertRateRegionHealth = async (payload) => (await dataService()).upsertRateRegionHealth(payload);
  const insertRateIngestRun = async (payload) => (await dataService()).insertRateIngestRun(payload);
  const listRateIngestRuns = async (projectId, options) => (await dataService()).listRateIngestRuns(projectId, options);

  const setLastOpenedProjectId = (projectId) => {
    if (projectId) {
      localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
    }
  };

  const getLastOpenedProjectId = () => localStorage.getItem(LAST_PROJECT_STORAGE_KEY);

  const buildScopedUiStorageKey = (projectId, suffix) => `energyapp.project.${projectId}.${suffix}`;

  const migrateLegacyLocalData = async () => {
    if (localStorage.getItem(MIGRATION_STORAGE_KEY) === "done") {
      return;
    }

    const projects = await listProjects();
    if (projects.length > 0) {
      localStorage.setItem(MIGRATION_STORAGE_KEY, "done");
      return;
    }

    const legacyFacility = safeParse(localStorage.getItem(LEGACY_KEYS.facility) || "null", null);
    const legacyAssets = safeParse(localStorage.getItem(LEGACY_KEYS.assetsState) || "null", null);
    const hasLegacyFacility = Boolean(legacyFacility && (legacyFacility.name || legacyFacility.lat != null || legacyFacility.lng != null));
    const hasLegacyAssets =
      Boolean(legacyAssets && (Array.isArray(legacyAssets.solar) ? legacyAssets.solar.length : 0) + (Array.isArray(legacyAssets.wind) ? legacyAssets.wind.length : 0) > 0);

    if (!hasLegacyFacility && !hasLegacyAssets) {
      localStorage.setItem(MIGRATION_STORAGE_KEY, "done");
      return;
    }

    const project = await createProject({
      name: legacyFacility?.name || "Migrated Project",
      lat: legacyFacility?.lat ?? null,
      lng: legacyFacility?.lng ?? null,
      weatherProvider: "nrel",
    });

    const solarAssets = Array.isArray(legacyAssets?.solar) ? legacyAssets.solar : [];
    const windAssets = Array.isArray(legacyAssets?.wind) ? legacyAssets.wind : [];

    for (const model of solarAssets) {
      await upsertAsset({ projectId: project.id, type: "solar", model });
    }
    for (const model of windAssets) {
      await upsertAsset({ projectId: project.id, type: "wind", model });
    }

    const legacyDate = localStorage.getItem(LEGACY_KEYS.selectedDate);
    if (legacyDate) {
      localStorage.setItem(buildScopedUiStorageKey(project.id, "selectedDate"), legacyDate);
    }
    const legacyMapState = localStorage.getItem(LEGACY_KEYS.mapState);
    if (legacyMapState) {
      localStorage.setItem(buildScopedUiStorageKey(project.id, "mapState"), legacyMapState);
    }

    setLastOpenedProjectId(project.id);
    localStorage.setItem(MIGRATION_STORAGE_KEY, "done");
  };

  window.EnergySupabaseService = {
    LAST_PROJECT_STORAGE_KEY,
    buildScopedUiStorageKey,
    listProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    listAssets,
    upsertAsset,
    deleteAsset,
    getWeatherCache,
    upsertWeatherCache,
    getNrelCache,
    upsertNrelCache,
    getRateSeriesCache,
    upsertRateSeriesCache,
    clearRateSeriesCache,
    listRateRegionHealth,
    upsertRateRegionHealth,
    insertRateIngestRun,
    listRateIngestRuns,
    getLastOpenedProjectId,
    setLastOpenedProjectId,
    migrateLegacyLocalData,
    // Status reporting functions
    getBackendStatus: () => ({ ...backendStatus }),
    isUsingLocalStorage: () => false,
    getLastError: () => backendStatus.lastError,
    getErrorCode: () => backendStatus.errorCode,
  };
  
  // Verify Supabase is working after all scripts load
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        console.log('[Supabase Client Verification] On DOMContentLoaded + 100ms:', {
          hasSupabase: !!window.supabase,
          hasURL: !!window.ENERGYAPP_SUPABASE_URL,
          hasKey: !!window.ENERGYAPP_SUPABASE_ANON_KEY,
          hasConfigObject: !!window.ENERGYAPP_SUPABASE_CONFIG,
        });
        
        if (!window.supabase) {
          console.error('[ERROR] Supabase JS SDK failed to load from CDN. Check network tab for failures. Supabase is required.');
        }
        if (!window.ENERGYAPP_SUPABASE_URL) {
          console.error('[ERROR] Supabase URL missing. Provide it via server injection, supabase-config.js, or /api/runtime-config.');
        }
        if (!window.ENERGYAPP_SUPABASE_ANON_KEY) {
          console.error('[ERROR] Supabase ANON key missing. Provide it via server injection, supabase-config.js, or /api/runtime-config.');
        }
      }, 100);
    });
  }
})();
