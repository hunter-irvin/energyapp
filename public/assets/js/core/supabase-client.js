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
    type: 'unknown', // 'supabase', 'localStorage', or 'unknown'
    isWorking: null, // true, false, or null (untested)
    lastError: null, // Last error message if fallback occurred
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

  const DB_STORAGE_KEYS = {
    projects: "energyapp.db.projects",
    assets: "energyapp.db.assets",
    weatherCache: "energyapp.db.weatherCache",
    nrelCache: "energyapp.db.nrelCache",
  };

  const safeParse = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  };

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const loadArray = (key) => {
    const parsed = safeParse(localStorage.getItem(key) || "[]", []);
    return Array.isArray(parsed) ? parsed : [];
  };

  const saveArray = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const isQuotaExceededError = (error) =>
    error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

  const trySaveArray = (key, value) => {
    try {
      saveArray(key, value);
      return true;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        return false;
      }
      throw error;
    }
  };

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
        backendStatus.type = 'localStorage';
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
        backendStatus.type = 'localStorage';
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
        backendStatus.type = 'localStorage';
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

  const getLocalWeatherRows = () => {
    const primary = loadArray(DB_STORAGE_KEYS.weatherCache);
    if (primary.length > 0) {
      return primary;
    }
    const legacy = loadArray(DB_STORAGE_KEYS.nrelCache).map((entry) => ({
      ...entry,
      provider: entry.provider || "nrel",
    }));
    if (legacy.length > 0) {
      void trySaveArray(DB_STORAGE_KEYS.weatherCache, legacy);
    }
    return legacy;
  };

  const localDb = {
    async listProjects() {
      return loadArray(DB_STORAGE_KEYS.projects).map(fromProjectRow);
    },
    async createProject(payload = {}) {
      const rows = loadArray(DB_STORAGE_KEYS.projects);
      const row = toProjectRow({ id: payload.id || uid(), ...payload });
      rows.push(row);
      saveArray(DB_STORAGE_KEYS.projects, rows);
      return fromProjectRow(row);
    },
    async getProject(projectId) {
      const row = loadArray(DB_STORAGE_KEYS.projects).find((entry) => entry.id === projectId);
      return row ? fromProjectRow(row) : null;
    },
    async updateProject(projectId, patch = {}) {
      const rows = loadArray(DB_STORAGE_KEYS.projects);
      const index = rows.findIndex((entry) => entry.id === projectId);
      if (index < 0) {
        return null;
      }
      rows[index] = toProjectRow({ ...fromProjectRow(rows[index]), ...patch, id: projectId, created_at: rows[index].created_at });
      saveArray(DB_STORAGE_KEYS.projects, rows);
      return fromProjectRow(rows[index]);
    },
    async listAssets(projectId) {
      return loadArray(DB_STORAGE_KEYS.assets)
        .filter((entry) => entry.project_id === projectId)
        .map(fromAssetRow);
    },
    async upsertAsset(payload) {
      const rows = loadArray(DB_STORAGE_KEYS.assets);
      const id = payload.id || uid();
      const next = toAssetRow({ ...payload, id });
      const index = rows.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...next };
      } else {
        rows.push({ ...next, created_at: new Date().toISOString() });
      }
      saveArray(DB_STORAGE_KEYS.assets, rows);
      return fromAssetRow(rows.find((entry) => entry.id === id));
    },
    async deleteAsset(assetId) {
      const rows = loadArray(DB_STORAGE_KEYS.assets).filter((entry) => entry.id !== assetId);
      saveArray(DB_STORAGE_KEYS.assets, rows);
      return true;
    },
    async getWeatherCache(projectId, provider, dataset, dateKey, options = {}) {
      const { sourceYear = null, intervalMinutes = null } = options;
      return (
        getLocalWeatherRows().find(
          (entry) =>
            entry.project_id === projectId &&
            (entry.provider || "nrel") === provider &&
            entry.dataset === dataset &&
            entry.date_key === dateKey &&
            (sourceYear == null || Number(entry.source_year) === Number(sourceYear)) &&
            (intervalMinutes == null || Number(entry.interval_minutes) === Number(intervalMinutes))
        ) || null
      );
    },
    async upsertWeatherCache(payload) {
      const rows = getLocalWeatherRows();
      const provider = payload.provider || "nrel";
      const sourceYear = payload.sourceYear == null ? null : Number(payload.sourceYear);
      const keyMatch = (entry) =>
        entry.project_id === payload.projectId &&
        (entry.provider || "nrel") === provider &&
        entry.dataset === payload.dataset &&
        entry.date_key === payload.dateKey &&
        Number(entry.interval_minutes) === Number(payload.intervalMinutes) &&
        (sourceYear == null ? entry.source_year == null : Number(entry.source_year) === sourceYear);

      const index = rows.findIndex(keyMatch);
      const row = {
        id: index >= 0 ? rows[index].id : uid(),
        project_id: payload.projectId,
        provider,
        dataset: payload.dataset,
        date_key: payload.dateKey,
        source_year: sourceYear,
        interval_minutes: payload.intervalMinutes,
        wkt: payload.wkt || null,
        timezone: payload.timezone || null,
        source: payload.source || "weather_proxy",
        fetched_at: payload.fetchedAt || new Date().toISOString(),
        payload: payload.payload,
        updated_at: new Date().toISOString(),
      };
      if (index >= 0) {
        rows[index] = { ...rows[index], ...row };
      } else {
        rows.push({ ...row, created_at: new Date().toISOString() });
      }

      if (trySaveArray(DB_STORAGE_KEYS.weatherCache, rows)) {
        return rows.find(keyMatch);
      }

      const boundedRows = rows
        .filter((entry) => entry.project_id === payload.projectId)
        .sort((a, b) => new Date(b.fetched_at || 0).getTime() - new Date(a.fetched_at || 0).getTime())
        .slice(0, 4);

      if (trySaveArray(DB_STORAGE_KEYS.weatherCache, boundedRows)) {
        return boundedRows.find(keyMatch) || row;
      }

      console.warn("Weather cache payload exceeded localStorage quota; skipping local persistence for this payload.");
      return { ...row, persisted: false };
    },
    async getNrelCache(projectId, dataset, dateKey, options = {}) {
      return this.getWeatherCache(projectId, "nrel", dataset, dateKey, options);
    },
    async upsertNrelCache(payload) {
      return this.upsertWeatherCache({ ...payload, provider: "nrel" });
    },
  };

  const supabaseDb = (client) => ({
    async listProjects() {
      const { data, error } = await client.from("projects").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(fromProjectRow);
    },
    async createProject(payload = {}) {
      const { data, error } = await client.from("projects").insert(toProjectRow({ id: payload.id || uid(), ...payload })).select().single();
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
      if (Object.prototype.hasOwnProperty.call(patch, "mapState")) updatePayload.map_state = patch.mapState;
      updatePayload.updated_at = new Date().toISOString();
      const { data, error } = await client.from("projects").update(updatePayload).eq("id", projectId).select().single();
      if (error) throw error;
      return fromProjectRow(data);
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
      let query = client
        .from("nrel_cache")
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
      const { data, error } = await query.order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data || null;
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
      const { data, error } = await client
        .from("nrel_cache")
        .upsert(row, { onConflict: "project_id,provider,dataset,date_key,interval_minutes,source_year" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    async getNrelCache(projectId, dataset, dateKey, options = {}) {
      return this.getWeatherCache(projectId, "nrel", dataset, dateKey, options);
    },
    async upsertNrelCache(payload) {
      return this.upsertWeatherCache({ ...payload, provider: "nrel" });
    },
  });

  const dataService = async () => {
    const client = await getClient();
    const service = client ? supabaseDb(client) : localDb;
    const backend = client ? 'Supabase' : 'localStorage (fallback)';
    
    // Update status to reflect actual backend being used this call
    if (!client) {
      backendStatus.type = 'localStorage';
    }
    
    console.debug('[EnergySupabaseService] Using persistence backend:', backend);
    return service;
  };

  const listProjects = async () => (await dataService()).listProjects();
  const createProject = async (payload) => (await dataService()).createProject(payload);
  const getProject = async (projectId) => (await dataService()).getProject(projectId);
  const updateProject = async (projectId, patch) => (await dataService()).updateProject(projectId, patch);
  const listAssets = async (projectId) => (await dataService()).listAssets(projectId);
  const upsertAsset = async (payload) => (await dataService()).upsertAsset(payload);
  const deleteAsset = async (assetId) => (await dataService()).deleteAsset(assetId);
  const getWeatherCache = async (projectId, provider, dataset, dateKey, options) =>
    (await dataService()).getWeatherCache(projectId, provider, dataset, dateKey, options);
  const upsertWeatherCache = async (payload) => (await dataService()).upsertWeatherCache(payload);
  const getNrelCache = async (projectId, dataset, dateKey, options) =>
    (await dataService()).getNrelCache(projectId, dataset, dateKey, options);
  const upsertNrelCache = async (payload) => (await dataService()).upsertNrelCache(payload);

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
    listAssets,
    upsertAsset,
    deleteAsset,
    getWeatherCache,
    upsertWeatherCache,
    getNrelCache,
    upsertNrelCache,
    getLastOpenedProjectId,
    setLastOpenedProjectId,
    migrateLegacyLocalData,
    // Status reporting functions
    getBackendStatus: () => ({ ...backendStatus }),
    isUsingLocalStorage: () => backendStatus.type === 'localStorage',
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
          console.error('[ERROR] Supabase JS SDK failed to load from CDN. Check network tab for failures. Application will use localStorage fallback.');
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
