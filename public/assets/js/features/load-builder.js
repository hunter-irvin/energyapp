(() => {
  const INTERVAL_MINUTES = 15;
  const INTERVALS_PER_DAY = 96;
  const INTERVAL_HOURS = INTERVAL_MINUTES / 60;
  const MAX_LOAD_ROWS = 25;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const uid = (prefix = "load") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const normalizeValues = (values = [], length = INTERVALS_PER_DAY) =>
    Array.from({ length }, (_, index) => Math.max(0, toNumber(values[index], 0)));

  const normalizeShape = (values = []) => normalizeValues(values).map((value) => clamp(value, 0, 1));

  const calculateDailyEnergyKwh = (values = []) =>
    normalizeValues(values).reduce((sum, value) => sum + value, 0) * INTERVAL_HOURS;

  const calculateAggregate = (rows = []) =>
    Array.from({ length: INTERVALS_PER_DAY }, (_, index) =>
      (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
        if (row?.muted) return sum;
        return sum + Math.max(0, toNumber(row?.values?.[index], 0));
      }, 0)
    );

  const getAggregateStats = (rows = []) => {
    const aggregate = calculateAggregate(rows);
    return {
      peak: Math.max(...aggregate, 0),
      kwh: calculateDailyEnergyKwh(aggregate),
      loads: Array.isArray(rows) ? rows.length : 0,
      aggregate,
    };
  };

  const getIndividualAxisMax = (rows = []) => {
    const peaks = (Array.isArray(rows) ? rows : []).map((row) => Math.max(...normalizeValues(row?.values), toNumber(row?.peak, 0), 0));
    return Math.ceil(Math.max(...peaks, 1));
  };

  const updateRowStats = (row = {}) => {
    const values = normalizeValues(row.values);
    const peak = Math.max(...values, 0);
    return {
      ...row,
      values,
      peak,
      kwh: calculateDailyEnergyKwh(values),
    };
  };

  const buildTemplateValues = (shapeFn) =>
    Array.from({ length: INTERVALS_PER_DAY }, (_, index) => {
      const hour = index / 4;
      return clamp(shapeFn(hour, index), 0, 1);
    });

  const plateau = (start, end, base = 0.08, softness = 0.75) =>
    buildTemplateValues((hour) => {
      if (hour < start || hour > end) return base;
      const ratio = (hour - start) / Math.max(1, end - start);
      return base + softness * Math.sin(Math.PI * ratio);
    });

  const bell = (center, spread, base = 0.04) =>
    buildTemplateValues((hour) => base + (1 - base) * Math.exp(-((hour - center) ** 2) / (2 * spread * spread)));

  const flat = (value = 1) => buildTemplateValues(() => value);

  const BUILT_IN_TEMPLATES = [
    {
      id: "office-lighting",
      name: "Office Lighting",
      category: "Lighting",
      defaultPeakKw: 42,
      color: "#ffb84d",
      normalizedValues: plateau(7, 19, 0.08, 0.82),
    },
    {
      id: "hvac-cooling",
      name: "HVAC Cooling",
      category: "HVAC",
      defaultPeakKw: 96,
      color: "#55c7ff",
      normalizedValues: bell(15, 4.5, 0.05),
    },
    {
      id: "ev-charging",
      name: "EV Charging",
      category: "EV",
      defaultPeakKw: 64,
      color: "#b18cff",
      normalizedValues: bell(20, 1.7, 0.02),
    },
    {
      id: "base-load",
      name: "Base Load",
      category: "Base",
      defaultPeakKw: 28,
      color: "#7ee787",
      normalizedValues: flat(1),
    },
    {
      id: "kitchen-equipment",
      name: "Kitchen Equipment",
      category: "Process",
      defaultPeakKw: 74,
      color: "#ff7b72",
      normalizedValues: buildTemplateValues((hour) => {
        const breakfast = Math.exp(-((hour - 7.5) ** 2) / 1.6);
        const lunch = Math.exp(-((hour - 12.5) ** 2) / 1.2);
        const dinner = Math.exp(-((hour - 18.5) ** 2) / 1.8);
        return 0.04 + Math.max(breakfast, lunch, dinner);
      }),
    },
    {
      id: "server-room",
      name: "Server Room",
      category: "Process",
      defaultPeakKw: 55,
      color: "#a5d6ff",
      normalizedValues: buildTemplateValues((hour) => 0.72 + 0.08 * Math.sin((hour / 24) * Math.PI * 6)),
    },
  ].map((template) => ({
    ...template,
    normalizedValues: normalizeShape(template.normalizedValues),
  }));

  const createRowFromTemplate = (template, options = {}) => {
    const peakKw = Math.max(0, toNumber(options.peakKw ?? template?.defaultPeakKw, 0));
    const normalized = normalizeShape(template?.normalizedValues);
    const values = normalized.map((value) => value * peakKw);
    return updateRowStats({
      id: options.id || uid("load"),
      name: options.name || template?.name || "Load",
      group: options.group || template?.category || "Load",
      category: template?.category || options.category || "",
      color: options.color || template?.color || "#7fc1ff",
      muted: false,
      locked: Boolean(options.locked),
      selected: true,
      sourceTemplateId: template?.id || null,
      values,
    });
  };

  const selectRow = (rows = [], rowId) =>
    (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      selected: String(row.id) === String(rowId),
    }));

  const addRowFromTemplate = (rows = [], template, options = {}) => {
    const currentRows = Array.isArray(rows) ? rows : [];
    if (currentRows.length >= MAX_LOAD_ROWS) {
      return { rows: currentRows, row: null, error: "Maximum load rows reached." };
    }
    const row = createRowFromTemplate(template, options);
    const insertIndex = clamp(toNumber(options.index, currentRows.length), 0, currentRows.length);
    const nextRows = selectRow(
      [...currentRows.slice(0, insertIndex), row, ...currentRows.slice(insertIndex)],
      row.id
    );
    return { rows: nextRows, row, error: "" };
  };

  const duplicateRow = (rows = [], rowId, options = {}) => {
    const currentRows = Array.isArray(rows) ? rows : [];
    const index = currentRows.findIndex((row) => String(row.id) === String(rowId));
    const source = currentRows[index];
    if (!source || source.locked || currentRows.length >= MAX_LOAD_ROWS) {
      return { rows: currentRows, row: null };
    }
    const duplicate = updateRowStats({
      ...source,
      id: options.id || uid("load"),
      name: options.name || `${source.name || "Load"} Copy`,
      locked: false,
      selected: true,
      values: normalizeValues(source.values),
    });
    return {
      rows: selectRow([...currentRows.slice(0, index + 1), duplicate, ...currentRows.slice(index + 1)], duplicate.id),
      row: duplicate,
    };
  };

  const deleteRow = (rows = [], rowId) => {
    const currentRows = Array.isArray(rows) ? rows : [];
    const target = currentRows.find((row) => String(row.id) === String(rowId));
    if (!target || target.locked) return currentRows;
    const nextRows = currentRows.filter((row) => String(row.id) !== String(rowId));
    if (nextRows.some((row) => row.selected)) return nextRows;
    return nextRows.map((row, index) => ({ ...row, selected: index === 0 }));
  };

  const toggleRowLocked = (rows = [], rowId) =>
    (Array.isArray(rows) ? rows : []).map((row) =>
      String(row.id) === String(rowId) ? { ...row, locked: !row.locked } : row
    );

  const reorderRows = (rows = [], sourceId, targetIndex) => {
    const currentRows = Array.isArray(rows) ? rows : [];
    const sourceIndex = currentRows.findIndex((row) => String(row.id) === String(sourceId));
    if (sourceIndex < 0) return currentRows;
    const [row] = currentRows.slice(sourceIndex, sourceIndex + 1);
    const withoutSource = currentRows.filter((candidate) => String(candidate.id) !== String(sourceId));
    const insertIndex = clamp(toNumber(targetIndex, withoutSource.length), 0, withoutSource.length);
    return [...withoutSource.slice(0, insertIndex), row, ...withoutSource.slice(insertIndex)];
  };

  const getInsertionIndexFromPoint = (rowRects = [], pointerY = 0) => {
    const rects = Array.isArray(rowRects) ? rowRects : [];
    if (!rects.length) return 0;
    const y = toNumber(pointerY, 0);
    for (let index = 0; index < rects.length; index += 1) {
      const top = toNumber(rects[index]?.top, 0);
      const bottom = toNumber(rects[index]?.bottom, top);
      if (y < top + (bottom - top) / 2) return index;
    }
    return rects.length;
  };

  const createEmptyProfileModel = (name = "Untitled Load Profile") => ({
    name: String(name || "Untitled Load Profile").trim() || "Untitled Load Profile",
    intervalMinutes: INTERVAL_MINUTES,
    rows: [],
    selectedRowId: null,
    updatedAt: new Date().toISOString(),
  });

  const validateProfileModel = (model = {}) => {
    const rows = Array.isArray(model.rows) ? model.rows.slice(0, MAX_LOAD_ROWS).map(updateRowStats) : [];
    const selectedRow = rows.find((row) => row.selected) || rows.find((row) => String(row.id) === String(model.selectedRowId));
    const selectedRowId = selectedRow?.id || null;
    return {
      ...createEmptyProfileModel(model.name),
      ...model,
      intervalMinutes: INTERVAL_MINUTES,
      rows: selectedRowId ? selectRow(rows, selectedRowId) : rows.map((row) => ({ ...row, selected: false })),
      selectedRowId,
    };
  };

  const api = {
    INTERVAL_MINUTES,
    INTERVALS_PER_DAY,
    INTERVAL_HOURS,
    MAX_LOAD_ROWS,
    BUILT_IN_TEMPLATES,
    normalizeValues,
    calculateAggregate,
    calculateDailyEnergyKwh,
    getAggregateStats,
    getIndividualAxisMax,
    updateRowStats,
    createRowFromTemplate,
    addRowFromTemplate,
    duplicateRow,
    deleteRow,
    toggleRowLocked,
    reorderRows,
    getInsertionIndexFromPoint,
    selectRow,
    validateProfileModel,
    createEmptyProfileModel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof window !== "undefined") {
    window.EnergyLoadBuilder = api;
  }
})();
