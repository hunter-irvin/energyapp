(() => {
  const AUTOSAVE_DEBOUNCE_MS = 650;
  const supabaseService = window.EnergySupabaseService;
  const loadBuilder = window.EnergyLoadBuilder;

  const root = document.getElementById("load-builder-root");
  const headerProjectNameInput = document.getElementById("load-builder-header-project-name");
  const headerProjectNameDisplay = document.getElementById("load-builder-header-project-name-display");
  const headerProjectNameEditButton = document.getElementById("load-builder-header-project-name-edit");
  const headerProjectNameSaveButton = document.getElementById("load-builder-header-project-name-save");
  const headerProjectNameCancelButton = document.getElementById("load-builder-header-project-name-cancel");
  const weatherLink = document.getElementById("load-builder-weather-link");
  const generationLink = document.getElementById("load-builder-generation-link");
  const currentLoadBuilderLink = document.getElementById("load-builder-current-link");
  const storageLink = document.getElementById("load-builder-storage-link");
  const ratesLink = document.getElementById("load-builder-rates-link");

  const queryParams = new URLSearchParams(window.location.search);
  const selectedProjectId = queryParams.get("projectId");
  const requestedProfileId = queryParams.get("profileId");
  const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

  let currentProject = null;
  let profiles = [];
  let currentProfileId = null;
  let currentModel = loadBuilder?.createEmptyProfileModel ? loadBuilder.createEmptyProfileModel("No Profile Selected") : { rows: [] };
  let autosaveStatus = "Idle";
  let notice = "";
  let bridge = null;
  let autosaveTimer = null;
  let saveInFlight = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const withRetry = async (operation, { retries = 2, delayMs = 400 } = {}) => {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
        await sleep(delayMs * (attempt + 1));
      }
    }
    throw lastError;
  };

  const setProjectNameDisplay = (name) => {
    const resolvedName = String(name || "Untitled Facility").trim() || "Untitled Facility";
    if (headerProjectNameDisplay) headerProjectNameDisplay.textContent = resolvedName;
    if (headerProjectNameInput) {
      headerProjectNameInput.value = resolvedName;
      headerProjectNameInput.size = Math.min(Math.max(resolvedName.length + 1, 8), 40);
    }
  };

  const setProjectNameEditorMode = (isEditing) => {
    if (headerProjectNameDisplay) headerProjectNameDisplay.hidden = isEditing;
    if (headerProjectNameEditButton) headerProjectNameEditButton.hidden = isEditing;
    if (headerProjectNameInput) headerProjectNameInput.hidden = !isEditing;
    if (headerProjectNameSaveButton) headerProjectNameSaveButton.hidden = !isEditing;
    if (headerProjectNameCancelButton) headerProjectNameCancelButton.hidden = !isEditing;
  };

  const saveProjectName = async () => {
    if (!currentProject || !headerProjectNameInput) return;
    const nextName = String(headerProjectNameInput.value || "").trim() || "Untitled Facility";
    try {
      currentProject = await withRetry(() => supabaseService.updateProject(currentProject.id, { name: nextName }));
      setProjectNameDisplay(currentProject.name);
      setProjectNameEditorMode(false);
    } catch (error) {
      notice = "Could not save project name.";
      render();
    }
  };

  const withProjectId = (path) => `/projects/${path}.html?projectId=${encodeURIComponent(currentProject.id)}`;

  const setProjectLinks = () => {
    if (!currentProject?.id) return;
    if (weatherLink) weatherLink.href = withProjectId("weather");
    if (generationLink) generationLink.href = withProjectId("generation");
    if (currentLoadBuilderLink) currentLoadBuilderLink.href = withProjectId("load-builder");
    if (storageLink) storageLink.href = withProjectId("storage");
    if (ratesLink) ratesLink.href = "/projects/rates-v4.html?projectId=" + encodeURIComponent(currentProject.id);
  };

  const getCurrentProfile = () => profiles.find((profile) => String(profile.id) === String(currentProfileId)) || null;
  const isBuilderOpen = () => Boolean(getCurrentProfile());

  const buildLoadBuilderUrl = (profileId = "") => {
    const params = new URLSearchParams({ projectId: currentProject.id });
    if (profileId) params.set("profileId", profileId);
    return `/projects/load-builder.html?${params.toString()}`;
  };

  const setBrowserProfileUrl = (profileId = "") => {
    if (!currentProject?.id || !window.history?.replaceState) return;
    window.history.replaceState({}, "", buildLoadBuilderUrl(profileId));
  };

  const serializeModel = () => ({
    ...loadBuilder.validateProfileModel(currentModel),
    selectedRowId: currentModel.selectedRowId || currentModel.rows.find((row) => row.selected)?.id || null,
    updatedAt: new Date().toISOString(),
  });

  const render = () => {
    if (!root || !window.EnergyLoadBuilderUI?.createBridge) return;
    if (!bridge) {
      bridge = window.EnergyLoadBuilderUI.createBridge();
      bridge.mount(root, {});
    }
    const stats = loadBuilder.getAggregateStats(currentModel.rows || []);
    bridge.update({
      templates: loadBuilder.BUILT_IN_TEMPLATES,
      profiles,
      currentProfile: getCurrentProfile(),
      model: currentModel,
      aggregateStats: stats,
      autosaveStatus,
      notice,
      canEdit: Boolean(currentProfileId),
      view: isBuilderOpen() ? "builder" : "landing",
      onCreateProfile: createProfile,
      onOpenProfile: openProfile,
      onReturnToProfiles: returnToProfiles,
      onSelectRow: selectRow,
      onDropTemplate: dropTemplate,
      onReorderRow: reorderRow,
      onDuplicateRow: duplicateRow,
      onDeleteRow: deleteRow,
      onToggleLock: toggleLock,
    });
  };

  const persistCurrentProfile = async () => {
    const profile = getCurrentProfile();
    if (!profile || !currentProject?.id) return null;
    const model = serializeModel();
    autosaveStatus = "Saving...";
    render();
    try {
      const saved = await withRetry(() =>
        supabaseService.upsertLoadProfile({
          id: profile.id,
          projectId: currentProject.id,
          name: profile.name,
          model,
        })
      );
      profiles = [saved, ...profiles.filter((candidate) => String(candidate.id) !== String(saved.id))];
      currentModel = loadBuilder.validateProfileModel(saved.model || model);
      autosaveStatus = "Autosaved";
      notice = "";
      render();
      return saved;
    } catch (error) {
      autosaveStatus = "Error saving";
      notice = "Autosave failed. Your latest edits are still on screen.";
      render();
      return null;
    }
  };

  const flushAutosave = async () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (saveInFlight) {
      await saveInFlight;
    }
    saveInFlight = persistCurrentProfile();
    await saveInFlight;
    saveInFlight = null;
  };

  const scheduleAutosave = () => {
    if (!currentProfileId) return;
    autosaveStatus = "Saving...";
    render();
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      saveInFlight = persistCurrentProfile().finally(() => {
        saveInFlight = null;
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const commitModel = (nextModel) => {
    currentModel = loadBuilder.validateProfileModel(nextModel);
    render();
    scheduleAutosave();
  };

  const createProfile = async (name) => {
    if (!currentProject?.id) return;
    await flushAutosave();
    const model = loadBuilder.createEmptyProfileModel(name);
    autosaveStatus = "Saving...";
    notice = "";
    render();
    try {
      const saved = await withRetry(() =>
        supabaseService.upsertLoadProfile({
          projectId: currentProject.id,
          name: model.name,
          model,
        })
      );
      profiles = [saved, ...profiles];
      currentProfileId = saved.id;
      currentModel = loadBuilder.validateProfileModel(saved.model || model);
      autosaveStatus = "Autosaved";
      setBrowserProfileUrl(saved.id);
      render();
    } catch (error) {
      autosaveStatus = "Error saving";
      notice = "Could not create the load profile.";
      render();
    }
  };

  const openProfile = async (profileId) => {
    await flushAutosave();
    const profile = profiles.find((candidate) => String(candidate.id) === String(profileId));
    if (!profile) return;
    currentProfileId = profile.id;
    currentModel = loadBuilder.validateProfileModel(profile.model || loadBuilder.createEmptyProfileModel(profile.name));
    autosaveStatus = "Autosaved";
    notice = "";
    setBrowserProfileUrl(profile.id);
    render();
  };

  const returnToProfiles = async () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (currentProfileId) {
      saveInFlight = persistCurrentProfile().finally(() => {
        saveInFlight = null;
      });
    }
    currentProfileId = null;
    currentModel = loadBuilder.createEmptyProfileModel("No Profile Selected");
    autosaveStatus = profiles.length ? "Select a profile" : "No profile";
    notice = "";
    setBrowserProfileUrl("");
    render();
  };

  const selectRow = (rowId) => {
    commitModel({
      ...currentModel,
      selectedRowId: rowId,
      rows: loadBuilder.selectRow(currentModel.rows, rowId),
    });
  };

  const dropTemplate = (templateId, index) => {
    if (!currentProfileId) {
      notice = "Create a load profile before adding loads.";
      render();
      return;
    }
    const template = loadBuilder.BUILT_IN_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    const result = loadBuilder.addRowFromTemplate(currentModel.rows, template, { index });
    if (result.error) {
      notice = result.error;
      render();
      return;
    }
    commitModel({
      ...currentModel,
      rows: result.rows,
      selectedRowId: result.row?.id || currentModel.selectedRowId,
    });
  };

  const reorderRow = (rowId, targetIndex) => {
    commitModel({
      ...currentModel,
      rows: loadBuilder.reorderRows(currentModel.rows, rowId, targetIndex),
    });
  };

  const duplicateRow = (rowId) => {
    const result = loadBuilder.duplicateRow(currentModel.rows, rowId);
    if (!result.row) return;
    commitModel({
      ...currentModel,
      rows: result.rows,
      selectedRowId: result.row.id,
    });
  };

  const deleteRow = (rowId) => {
    const rows = loadBuilder.deleteRow(currentModel.rows, rowId);
    commitModel({
      ...currentModel,
      rows,
      selectedRowId: rows.find((row) => row.selected)?.id || null,
    });
  };

  const toggleLock = (rowId) => {
    commitModel({
      ...currentModel,
      rows: loadBuilder.toggleRowLocked(currentModel.rows, rowId),
    });
  };

  const restoreProfiles = async () => {
    profiles = await withRetry(() => supabaseService.listLoadProfiles(currentProject.id));
    const requestedProfile = profiles.find((profile) => String(profile.id) === String(requestedProfileId));
    currentProfileId = requestedProfile?.id || null;
    currentModel = requestedProfile
      ? loadBuilder.validateProfileModel(requestedProfile.model || loadBuilder.createEmptyProfileModel(requestedProfile.name))
      : loadBuilder.createEmptyProfileModel("No Profile Selected");
    autosaveStatus = requestedProfile ? "Autosaved" : profiles.length ? "Select a profile" : "No profile";
    if (requestedProfile) setBrowserProfileUrl(requestedProfile.id);
    else setBrowserProfileUrl("");
  };

  const initProject = async () => {
    await supabaseService.migrateLegacyLocalData();
    if (!selectedProjectId || !isValidProjectId(selectedProjectId)) {
      window.location.href = "/";
      return;
    }
    currentProject = await withRetry(() => supabaseService.getProject(selectedProjectId));
    if (!currentProject) {
      window.location.href = "/";
      return;
    }
    setProjectNameDisplay(currentProject.name);
    setProjectNameEditorMode(false);
    setProjectLinks();
    await restoreProfiles();
    render();
  };

  if (headerProjectNameEditButton && headerProjectNameInput) {
    headerProjectNameEditButton.addEventListener("click", () => {
      setProjectNameEditorMode(true);
      headerProjectNameInput.focus();
      headerProjectNameInput.select();
    });
  }
  if (headerProjectNameSaveButton) {
    headerProjectNameSaveButton.addEventListener("click", () => {
      void saveProjectName();
    });
  }
  if (headerProjectNameCancelButton && headerProjectNameInput) {
    headerProjectNameCancelButton.addEventListener("click", () => {
      setProjectNameDisplay(currentProject?.name);
      setProjectNameEditorMode(false);
    });
  }
  if (headerProjectNameInput) {
    headerProjectNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveProjectName();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setProjectNameDisplay(currentProject?.name);
        setProjectNameEditorMode(false);
      }
    });
  }

  void initProject().catch((error) => {
    notice = error?.message || "Unable to initialize Load Builder.";
    autosaveStatus = "Error";
    render();
  });
})();
