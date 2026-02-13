(() => {
  const createProjectButton = document.getElementById("create-project");
  const projectsGrid = document.getElementById("projects-grid");
  const loadingState = document.getElementById("projects-loading");
  const errorState = document.getElementById("projects-error");
  const emptyState = document.getElementById("projects-empty");
  const supabaseService = window.EnergySupabaseService;
  const LOAD_TIMEOUT_MS = 15000;
  const LOAD_RETRIES = 3;

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
    if (project.lat == null || project.lng == null) {
      return "No location selected";
    }
    return `${project.lat.toFixed(4)}, ${project.lng.toFixed(4)}`;
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

  const renderProjects = (projects) => {
    if (!projectsGrid) {
      return;
    }

    projectsGrid.innerHTML = projects
      .map(
        (project) => `
          <a class="project-card" href="index.html?projectId=${encodeURIComponent(project.id)}">
            <h2 class="project-card__name">${project.name || "Untitled Project"}</h2>
            <p class="project-card__location">${formatLocation(project)}</p>
            <p class="project-card__updated">Updated: ${formatTimestamp(project.updatedAt)}</p>
          </a>
        `
      )
      .join("");
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
      renderProjects(projects);
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
        window.location.href = `index.html?projectId=${encodeURIComponent(newProject.id)}`;
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

  void loadProjects();
})();
