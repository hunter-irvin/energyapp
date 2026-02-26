const createMemoryIngestionJobStore = () => {
  const jobs = [];
  const syncState = [];
  const weatherSeries = [];
  const generationSeries = [];
  const projectState = new Map();
  let seq = 0;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const findJobIndexById = (id) => jobs.findIndex((entry) => entry.id === id);

  return {
    async findActiveDuplicate({ projectId, domain, mode, windowStart, windowEnd }) {
      const hit = jobs
        .filter(
          (job) =>
            job.project_id === projectId &&
            job.domain === domain &&
            job.mode === mode &&
            (job.window_start || null) === (windowStart || null) &&
            (job.window_end || null) === (windowEnd || null) &&
            (job.status === "queued" || job.status === "running")
        )
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
      return hit ? clone(hit) : null;
    },
    async insert(row) {
      seq += 1;
      const next = { ...row, id: `job-${seq}` };
      jobs.push(next);
      return clone(next);
    },
    async claim(jobId, nowIso) {
      const index = findJobIndexById(jobId);
      if (index < 0) return null;
      if (jobs[index].status !== "queued") return null;
      jobs[index] = { ...jobs[index], status: "running", started_at: nowIso, updated_at: nowIso };
      return clone(jobs[index]);
    },
    async claimNextRunnable(nowIso) {
      const nowMs = new Date(nowIso).getTime();
      const candidate = jobs
        .filter((job) => {
          if (job.status !== "queued") return false;
          if (!job.next_retry_at) return true;
          const retryAt = new Date(job.next_retry_at).getTime();
          return Number.isFinite(retryAt) && retryAt <= nowMs;
        })
        .sort((a, b) => {
          const pa = Number(a.priority || 100);
          const pb = Number(b.priority || 100);
          if (pa !== pb) return pa - pb;
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        })[0];
      return candidate ? clone(candidate) : null;
    },
    async update(jobId, patch) {
      const index = findJobIndexById(jobId);
      if (index < 0) return null;
      jobs[index] = { ...jobs[index], ...patch };
      return clone(jobs[index]);
    },
    async upsertDomainSyncState(row) {
      const index = syncState.findIndex(
        (entry) => entry.project_id === row.project_id && entry.domain === row.domain
      );
      if (index < 0) {
        syncState.push({ ...row });
      } else {
        syncState[index] = { ...syncState[index], ...row };
      }
      return clone(syncState[index < 0 ? syncState.length - 1 : index]);
    },
    async upsertWeatherSeriesRows(rows = []) {
      rows.forEach((row) => {
        const index = weatherSeries.findIndex(
          (entry) =>
            entry.project_id === row.project_id &&
            entry.provider === row.provider &&
            entry.dataset === row.dataset &&
            Number(entry.resolution_minutes) === Number(row.resolution_minutes) &&
            String(entry.ts) === String(row.ts)
        );
        if (index < 0) {
          weatherSeries.push({ ...row });
        } else {
          weatherSeries[index] = { ...weatherSeries[index], ...row };
        }
      });
      return { count: rows.length };
    },
    async deleteWeatherSeriesOutsideWindow({ projectId, provider, windowStart, windowEnd }) {
      const startMs = new Date(windowStart).getTime();
      const endMs = new Date(windowEnd).getTime();
      for (let i = weatherSeries.length - 1; i >= 0; i -= 1) {
        const row = weatherSeries[i];
        if (row.project_id !== projectId) continue;
        if (provider && row.provider !== provider) continue;
        const tsMs = new Date(row.ts).getTime();
        if (tsMs < startMs || tsMs > endMs) {
          weatherSeries.splice(i, 1);
        }
      }
      return true;
    },
    async updateProjectWeatherFingerprint() {
      return true;
    },
    async upsertGenerationSeriesRows(rows = []) {
      rows.forEach((row) => {
        const index = generationSeries.findIndex(
          (entry) =>
            entry.project_id === row.project_id &&
            Number(entry.resolution_minutes) === Number(row.resolution_minutes) &&
            String(entry.ts) === String(row.ts)
        );
        if (index < 0) {
          generationSeries.push({ ...row });
        } else {
          generationSeries[index] = { ...generationSeries[index], ...row };
        }
      });
      return { count: rows.length };
    },
    async deleteGenerationSeriesOutsideWindow({ projectId, windowStart, windowEnd, resolutionMinutes }) {
      const startMs = new Date(windowStart).getTime();
      const endMs = new Date(windowEnd).getTime();
      for (let i = generationSeries.length - 1; i >= 0; i -= 1) {
        const row = generationSeries[i];
        if (row.project_id !== projectId) continue;
        if (resolutionMinutes && Number(row.resolution_minutes) !== Number(resolutionMinutes)) continue;
        const tsMs = new Date(row.ts).getTime();
        if (tsMs < startMs || tsMs > endMs) {
          generationSeries.splice(i, 1);
        }
      }
      return true;
    },
    async updateProjectGenerationFingerprints(projectId, patch = {}) {
      const current = projectState.get(projectId) || {};
      projectState.set(projectId, { ...current, ...patch });
      return true;
    },
    _debugState() {
      return {
        jobs: clone(jobs),
        syncState: clone(syncState),
        weatherSeries: clone(weatherSeries),
        generationSeries: clone(generationSeries),
        projectState: clone(Object.fromEntries(projectState.entries())),
      };
    },
  };
};

module.exports = {
  createMemoryIngestionJobStore,
};
