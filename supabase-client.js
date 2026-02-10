(() => {
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

  const getClient = () => {
    const sdk = window.supabase;
    const url = window.ENERGYAPP_SUPABASE_URL;
    const anonKey = window.ENERGYAPP_SUPABASE_ANON_KEY;
    if (!sdk || !url || !anonKey) {
      return null;
    }
    return sdk.createClient(url, anonKey);
  };

  const toProjectRow = (project) => ({
    id: project.id,
    name: project.name || "Untitled Facility",
    location_lat: project.lat ?? null,
    location_lng: project.lng ?? null,
    selected_date: project.selectedDate || null,
    map_state: project.mapState || null,
    created_at: project.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const fromProjectRow = (row) => ({
    id: row.id,
    name: row.name || "Untitled Facility",
    lat: row.location_lat == null ? null : Number(row.location_lat),
    lng: row.location_lng == null ? null : Number(row.location_lng),
    selectedDate: row.selected_date || null,
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
    async getNrelCache(projectId, dataset, dateKey) {
      return (
        loadArray(DB_STORAGE_KEYS.nrelCache).find(
          (entry) => entry.project_id === projectId && entry.dataset === dataset && entry.date_key === dateKey
        ) || null
      );
    },
    async upsertNrelCache(payload) {
      const rows = loadArray(DB_STORAGE_KEYS.nrelCache);
      const keyMatch = (entry) =>
        entry.project_id === payload.projectId && entry.dataset === payload.dataset && entry.date_key === payload.dateKey;
      const index = rows.findIndex(keyMatch);
      const row = {
        id: index >= 0 ? rows[index].id : uid(),
        project_id: payload.projectId,
        dataset: payload.dataset,
        date_key: payload.dateKey,
        payload: payload.payload,
        updated_at: new Date().toISOString(),
      };
      if (index >= 0) {
        rows[index] = { ...rows[index], ...row };
      } else {
        rows.push({ ...row, created_at: new Date().toISOString() });
      }
      saveArray(DB_STORAGE_KEYS.nrelCache, rows);
      return rows.find(keyMatch);
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
    async getNrelCache(projectId, dataset, dateKey) {
      const { data, error } = await client
        .from("nrel_cache")
        .select("*")
        .eq("project_id", projectId)
        .eq("dataset", dataset)
        .eq("date_key", dateKey)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async upsertNrelCache(payload) {
      const row = {
        project_id: payload.projectId,
        dataset: payload.dataset,
        date_key: payload.dateKey,
        payload: payload.payload,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from("nrel_cache").upsert(row).select().single();
      if (error) throw error;
      return data;
    },
  });

  const dataService = () => {
    const client = getClient();
    return client ? supabaseDb(client) : localDb;
  };

  const listProjects = async () => dataService().listProjects();
  const createProject = async (payload) => dataService().createProject(payload);
  const getProject = async (projectId) => dataService().getProject(projectId);
  const updateProject = async (projectId, patch) => dataService().updateProject(projectId, patch);
  const listAssets = async (projectId) => dataService().listAssets(projectId);
  const upsertAsset = async (payload) => dataService().upsertAsset(payload);
  const deleteAsset = async (assetId) => dataService().deleteAsset(assetId);
  const getNrelCache = async (projectId, dataset, dateKey) => dataService().getNrelCache(projectId, dataset, dateKey);
  const upsertNrelCache = async (payload) => dataService().upsertNrelCache(payload);

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
    getNrelCache,
    upsertNrelCache,
    getLastOpenedProjectId,
    setLastOpenedProjectId,
    migrateLegacyLocalData,
  };
})();
