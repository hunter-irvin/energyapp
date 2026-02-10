(() => {
  const createProjectButton = document.getElementById("create-project");
  const projectsGrid = document.getElementById("projects-grid");
  const loadingState = document.getElementById("projects-loading");
  const errorState = document.getElementById("projects-error");
  const emptyState = document.getElementById("projects-empty");
  const supabaseService = window.EnergySupabaseService;

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
      await supabaseService.migrateLegacyLocalData();
      const projects = await supabaseService.listProjects();
      if (!projects.length) {
        setState({ empty: true });
        return;
      }
      renderProjects(projects);
      setState({ showGrid: true });
    } catch (error) {
      setState({ error: error?.message || "Unable to load projects." });
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

  void loadProjects();
})();
