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
  let editSession = null;

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
  const isEditingRow = () => Boolean(editSession?.rowId);

  const buildRenderedModel = () => {
    if (!editSession?.rowId) return currentModel;
    const rows = currentModel.rows.map((row) =>
      String(row.id) === String(editSession.rowId)
        ? loadBuilder.commitEditSession({ ...row, selected: true }, editSession)
        : { ...row, selected: false }
    );
    return loadBuilder.validateProfileModel({
      ...currentModel,
      rows,
      selectedRowId: editSession.rowId,
    });
  };

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
    const renderedModel = buildRenderedModel();
    const stats = loadBuilder.getAggregateStats(renderedModel.rows || []);
    bridge.update({
      templates: loadBuilder.BUILT_IN_TEMPLATES,
      profiles,
      currentProfile: getCurrentProfile(),
      model: renderedModel,
      aggregateStats: stats,
      autosaveStatus,
      notice,
      canEdit: Boolean(currentProfileId) && !isEditingRow(),
      editSession,
      view: isBuilderOpen() ? "builder" : "landing",
      onCreateProfile: createProfile,
      onOpenProfile: openProfile,
      onReturnToProfiles: returnToProfiles,
      onRenameProfile: renameProfile,
      onSelectRow: selectRow,
      onDropTemplate: dropTemplate,
      onReorderRow: reorderRow,
      onDuplicateRow: duplicateRow,
      onDeleteRow: deleteRow,
      onToggleLock: toggleLock,
      onRenameRow: renameRow,
      onEnterEditRow: enterEditRow,
      onCancelEditRow: cancelEditRow,
      onDoneEditRow: doneEditRow,
      onUpdateEditPoint: updateEditPoint,
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
    editSession = null;
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
    editSession = null;
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
    editSession = null;
    currentProfileId = null;
    currentModel = loadBuilder.createEmptyProfileModel("No Profile Selected");
    autosaveStatus = profiles.length ? "Select a profile" : "No profile";
    notice = "";
    setBrowserProfileUrl("");
    render();
  };

  const renameProfile = (name) => {
    const profile = getCurrentProfile();
    const trimmedName = String(name || "").trim();
    if (!profile || !trimmedName || trimmedName === profile.name) return;
    profiles = profiles.map((candidate) =>
      String(candidate.id) === String(profile.id) ? { ...candidate, name: trimmedName } : candidate
    );
    currentModel = loadBuilder.validateProfileModel({
      ...currentModel,
      name: trimmedName,
    });
    render();
    scheduleAutosave();
  };

  const selectRow = (rowId) => {
    if (editSession?.rowId && String(editSession.rowId) !== String(rowId)) return;
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
    if (isEditingRow()) return;
    commitModel({
      ...currentModel,
      rows: loadBuilder.reorderRows(currentModel.rows, rowId, targetIndex),
    });
  };

  const duplicateRow = (rowId) => {
    if (isEditingRow()) return;
    const result = loadBuilder.duplicateRow(currentModel.rows, rowId);
    if (!result.row) return;
    commitModel({
      ...currentModel,
      rows: result.rows,
      selectedRowId: result.row.id,
    });
  };

  const deleteRow = (rowId) => {
    if (isEditingRow()) return;
    const rows = loadBuilder.deleteRow(currentModel.rows, rowId);
    commitModel({
      ...currentModel,
      rows,
      selectedRowId: rows.find((row) => row.selected)?.id || null,
    });
  };

  const toggleLock = (rowId) => {
    if (isEditingRow()) return;
    commitModel({
      ...currentModel,
      rows: loadBuilder.toggleRowLocked(currentModel.rows, rowId),
    });
  };

  const renameRow = (rowId, name) => {
    if (isEditingRow()) return;
    const row = currentModel.rows.find((candidate) => String(candidate.id) === String(rowId));
    const trimmedName = String(name || "").trim();
    if (!row || row.locked || !trimmedName || trimmedName === row.name) return;
    commitModel({
      ...currentModel,
      rows: loadBuilder.renameRow(currentModel.rows, rowId, trimmedName),
    });
  };

  const enterEditRow = (rowId) => {
    if (!currentProfileId) return;
    const row = currentModel.rows.find((candidate) => String(candidate.id) === String(rowId));
    if (!row || row.locked) return;
    editSession = loadBuilder.createEditSession(row, {
      minPoints: loadBuilder.MIN_EDIT_POINTS,
      maxPoints: loadBuilder.MAX_EDIT_POINTS,
    });
    currentModel = loadBuilder.validateProfileModel({
      ...currentModel,
      rows: loadBuilder.selectRow(currentModel.rows, rowId),
      selectedRowId: rowId,
    });
    notice = "";
    render();
  };

  const cancelEditRow = () => {
    if (!editSession) return;
    editSession = null;
    notice = "";
    render();
  };

  const doneEditRow = () => {
    if (!editSession?.rowId) return;
    const rows = currentModel.rows.map((row) =>
      String(row.id) === String(editSession.rowId) ? loadBuilder.commitEditSession(row, editSession) : row
    );
    const selectedRowId = editSession.rowId;
    editSession = null;
    commitModel({
      ...currentModel,
      rows,
      selectedRowId,
    });
  };

  const updateEditPoint = (action, payload) => {
    if (!editSession) return;
    if (action === "session" && payload?.session) {
      editSession = payload.session;
      render();
      return;
    }
    if (action === "points") {
      editSession = loadBuilder.moveEditPoints(payload?.baseSession || editSession, payload?.pointId, payload);
      render();
      return;
    }
    if (action === "transform") {
      editSession = loadBuilder.transformEditSession(payload?.baseSession || editSession, payload);
      render();
      return;
    }
    if (action === "add") {
      editSession = loadBuilder.addEditPoint(editSession, payload, { minIntervalGap: 1 });
      render();
      return;
    }
    if (action === "delete") {
      editSession = loadBuilder.deleteEditPoints(editSession, payload?.pointIds || []);
      render();
      return;
    }
    editSession = loadBuilder.updateEditPoint(editSession, action, payload);
    render();
  };

  const restoreProfiles = async () => {
    profiles = await withRetry(() => supabaseService.listLoadProfiles(currentProject.id));
    const requestedProfile = profiles.find((profile) => String(profile.id) === String(requestedProfileId));
    currentProfileId = requestedProfile?.id || null;
    editSession = null;
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
