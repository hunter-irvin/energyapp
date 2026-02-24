(() => {
  const createProjectButton = document.getElementById("create-project");
  const projectsGrid = document.getElementById("projects-grid");
  const loadingState = document.getElementById("projects-loading");
  const errorState = document.getElementById("projects-error");
  const emptyState = document.getElementById("projects-empty");
  const supabaseService = window.EnergySupabaseService;
  const LOAD_TIMEOUT_MS = 15000;
  const LOAD_RETRIES = 3;
  const THUMBNAIL_ZOOM = 12;
  const THUMBNAIL_WIDTH = 640;
  const THUMBNAIL_HEIGHT = 360;

  const formatTimestamp = (timestamp) => {
    if (!timestamp) {
      return "Never";
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return "Unknown";
    }
    return parsed.toLocaleString();
  };

  const formatLocation = (project) => {
    const city = project?.mapState?.city;
    if (city && String(city).trim()) {
      return city;
    }
    return "No location selected";
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatKw = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "0";
    const rounded = Math.round(numeric * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const formatKwh = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "0";
    const rounded = Math.round(numeric);
    return String(rounded);
  };

  const toWebMercator = (lat, lng) => {
    const latClamped = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const lngClamped = Number(lng);
    const x = (lngClamped * 20037508.34) / 180;
    const y =
      Math.log(Math.tan(((90 + latClamped) * Math.PI) / 360)) / (Math.PI / 180);
    return {
      x,
      y: (y * 20037508.34) / 180,
    };
  };

  const buildCenteredSatelliteUrl = (lat, lng, zoom) => {
    const center = toWebMercator(lat, lng);
    const resolution = 156543.03392804097 / 2 ** zoom;
    const halfWidth = (THUMBNAIL_WIDTH / 2) * resolution;
    const halfHeight = (THUMBNAIL_HEIGHT / 2) * resolution;
    const xmin = center.x - halfWidth;
    const ymin = center.y - halfHeight;
    const xmax = center.x + halfWidth;
    const ymax = center.y + halfHeight;
    return [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
      `?bbox=${xmin},${ymin},${xmax},${ymax}`,
      "&bboxSR=3857",
      "&imageSR=3857",
      `&size=${THUMBNAIL_WIDTH},${THUMBNAIL_HEIGHT}`,
      "&format=png32",
      "&f=image",
    ].join("");
  };

  const summarizeAssets = (assets = []) => {
    const solarKw = assets
      .filter((asset) => asset?.type === "solar")
      .reduce((sum, asset) => sum + Number(asset?.model?.capacity_ac_kw || 0), 0);

    const windKw = assets
      .filter((asset) => asset?.type === "wind")
      .reduce((sum, asset) => {
        const rated = Number(asset?.model?.rated_power_kw || 0);
        const turbines = Number(asset?.model?.num_turbines || 1);
        return sum + rated * (Number.isFinite(turbines) ? turbines : 1);
      }, 0);

    const storageAssets = assets.filter((asset) => asset?.type === "storage");
    const storageKwh = storageAssets.reduce((sum, asset) => sum + Number(asset?.model?.capacity_kwh || 0), 0);
    const storageTypes = Array.from(
      new Set(
        storageAssets
          .map((asset) => String(asset?.model?.battery_type || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    const storageType = storageTypes.length === 1 ? storageTypes[0] : storageTypes.length > 1 ? "MIXED" : "LFP";

    return {
      generationLine: `Generation: ${formatKw(solarKw)} KW Solar, ${formatKw(windKw)} KW Wind`,
      storageLine: `Storage: ${formatKwh(storageKwh)} KWh ${storageType}`,
    };
  };

  const buildSatelliteThumbnail = (project) => {
    if (project?.lat == null || project?.lng == null) {
      return `<div class="project-card__thumb project-card__thumb--empty">No location selected</div>`;
    }

    const tileUrl = buildCenteredSatelliteUrl(project.lat, project.lng, THUMBNAIL_ZOOM);
    const projectName = escapeHtml(project?.name || "Project");

    return `
      <div class="project-card__thumb">
        <img class="project-card__thumb-img" src="${tileUrl}" alt="Satellite location for ${projectName}" loading="lazy" />
        <span class="project-card__thumb-pin" style="left:50%; top:50%;" aria-hidden="true"></span>
      </div>
    `;
  };

  const setState = ({ loading = false, error = "", empty = false, showGrid = false }) => {
    if (loadingState) {
      loadingState.hidden = !loading;
    }
    if (errorState) {
      errorState.hidden = !error;
      errorState.textContent = error;
    }
    if (emptyState) {
      emptyState.hidden = !empty;
    }
    if (projectsGrid) {
      projectsGrid.hidden = !showGrid;
    }
  };

  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${LOAD_TIMEOUT_MS / 1000}s.`)), LOAD_TIMEOUT_MS)
      ),
    ]);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const withRetry = async (operation, label) => {
    let lastError = null;
    for (let attempt = 1; attempt <= LOAD_RETRIES; attempt += 1) {
      try {
        return await withTimeout(operation(), label);
      } catch (error) {
        lastError = error;
        if (attempt === LOAD_RETRIES) {
          break;
        }
        await sleep(500 * attempt);
      }
    }
    throw lastError;
  };

  const hideAllMenus = () => {
    if (!projectsGrid) return;
    projectsGrid.querySelectorAll("[data-project-menu]").forEach((menu) => {
      menu.hidden = true;
    });
  };

  const toggleMenuForTrigger = (trigger) => {
    if (!projectsGrid || !trigger) return;
    const card = trigger.closest("[data-project-id]");
    if (!card) return;
    const menu = card.querySelector("[data-project-menu]");
    if (!menu) return;
    const shouldOpen = menu.hidden;
    hideAllMenus();
    menu.hidden = !shouldOpen;
  };

  const deleteProjectWithConfirm = async (projectId, projectName) => {
    if (!projectId) return;
    const confirmed = window.confirm(
      `Delete project "${projectName || "Untitled Project"}"? This will permanently remove the project and all associated assets and weather data.`
    );
    if (!confirmed) return;

    setState({ loading: true });
    try {
      await withRetry(() => supabaseService.deleteProject(projectId), "Project delete");
      await loadProjects();
    } catch (error) {
      setState({ error: error?.message || "Unable to delete project." });
    }
  };

  const wireProjectCardActions = () => {
    if (!projectsGrid) return;

    projectsGrid.querySelectorAll("[data-project-menu-trigger]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMenuForTrigger(button);
      });
    });

    projectsGrid.querySelectorAll("[data-project-action='delete']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = button.closest("[data-project-id]");
        const projectId = card?.dataset.projectId || "";
        const projectName = card?.querySelector(".project-card__name")?.textContent || "Untitled Project";
        hideAllMenus();
        void deleteProjectWithConfirm(projectId, projectName);
      });
    });
  };

  const renderProjects = (projects) => {
    if (!projectsGrid) {
      return;
    }

    const sortedProjects = [...projects].sort((a, b) => {
      const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return bTime - aTime;
    });

    projectsGrid.innerHTML = sortedProjects
      .map((project) => {
        const summary = summarizeAssets(project.assets || []);
        const escapedName = escapeHtml(project.name || "Untitled Project");
        return `
          <article class="project-card" data-project-id="${escapeHtml(project.id)}">
            <div class="project-card__menu-wrap">
              <button class="project-card__menu-trigger" data-project-menu-trigger type="button" aria-label="Project options">⋯</button>
              <div class="project-card__menu" data-project-menu hidden>
                <button class="project-card__menu-item project-card__menu-item--danger" data-project-action="delete" type="button">Delete</button>
              </div>
            </div>
            <a class="project-card__open" href="/projects/location.html?projectId=${encodeURIComponent(project.id)}">
              <h2 class="project-card__name">${escapedName}</h2>
              ${buildSatelliteThumbnail(project)}
              <div class="project-card__meta">
                <p class="project-card__location">${escapeHtml(formatLocation(project))}</p>
                <p class="project-card__summary">${escapeHtml(summary.generationLine)}</p>
                <p class="project-card__summary">${escapeHtml(summary.storageLine)}</p>
                <p class="project-card__updated project-card__updated--footer">Updated: ${escapeHtml(
                  formatTimestamp(project.updatedAt)
                )}</p>
              </div>
            </a>
          </article>
        `;
      })
      .join("");

    wireProjectCardActions();
  };

  const loadProjects = async () => {
    setState({ loading: true });
    try {
      await withRetry(() => supabaseService.migrateLegacyLocalData(), "Project migration");
      const projects = await withRetry(() => supabaseService.listProjects(), "Project list fetch");
      if (!projects.length) {
        setState({ empty: true });
        return;
      }
      const projectsWithAssets = await Promise.all(
        projects.map(async (project) => {
          const assets = await withRetry(() => supabaseService.listAssets(project.id), "Asset list fetch");
          return { ...project, assets };
        })
      );
      renderProjects(projectsWithAssets);
      setState({ showGrid: true });
    } catch (error) {
      setState({
        error:
          error?.message ||
          "Unable to load projects after multiple attempts. Supabase connectivity may be unstable.",
      });
    }
  };

  if (createProjectButton) {
    createProjectButton.addEventListener("click", async () => {
      createProjectButton.disabled = true;
      try {
        const newProject = await supabaseService.createProject({
          name: "New Project",
          lat: null,
          lng: null,
        });
        window.location.href = `/projects/location.html?projectId=${encodeURIComponent(newProject.id)}`;
      } catch (error) {
        setState({ error: error?.message || "Unable to create project." });
      } finally {
        createProjectButton.disabled = false;
      }
    });
  }

  // Monitor API error status and show/hide banner
  const setupApiErrorBanner = () => {
    const banner = document.getElementById('api-error-banner');
    const message = document.getElementById('api-error-message');
    const code = document.getElementById('api-error-code');
    const closeBtn = document.getElementById('api-error-close');
    
    if (!banner) return; // Element might not exist on all pages

    const checkBackendStatus = () => {
      const status = supabaseService.getBackendStatus();
      
      if (status.type === 'localStorage' && status.lastError) {
        // Show error banner
        message.textContent = status.lastError;
        code.textContent = `Error Code: ${status.errorCode}`;
        banner.style.display = 'block';
      } else {
        // Hide error banner
        banner.style.display = 'none';
      }
    };
    
    // Check status immediately
    checkBackendStatus();
    
    // Check status periodically (every 5 seconds)
    setInterval(checkBackendStatus, 5000);
    
    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
      });
    }
  };

  // Initialize error banner
  setupApiErrorBanner();

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".project-card__menu-wrap")) {
      hideAllMenus();
    }
  });

  void loadProjects();
})();
