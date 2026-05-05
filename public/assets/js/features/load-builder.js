(() => {
  const INTERVAL_MINUTES = 15;
  const INTERVALS_PER_DAY = 96;
  const INTERVAL_HOURS = INTERVAL_MINUTES / 60;
  const MAX_LOAD_ROWS = 25;
  const MIN_EDIT_POINTS = 2;
  const MAX_EDIT_POINTS = 24;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const toArray = (value) => (Array.isArray(value) ? value : []);
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

  const pulse = (center, spread, height = 1) => (hour) => height * Math.exp(-((hour - center) ** 2) / (2 * spread * spread));

  const smoothWindow = (hour, start, end, ramp = 0.75) => {
    const isWrapped = end < start;
    const activeHour = isWrapped && hour < start ? hour + 24 : hour;
    const activeEnd = isWrapped ? end + 24 : end;
    if (activeHour < start || activeHour > activeEnd) return 0;
    const up = clamp((activeHour - start) / Math.max(ramp, 0.01), 0, 1);
    const down = clamp((activeEnd - activeHour) / Math.max(ramp, 0.01), 0, 1);
    return Math.min(up, down, 1);
  };

  const windowShape = (start, end, base = 0.02, height = 0.95, ramp = 0.75) =>
    buildTemplateValues((hour) => base + height * smoothWindow(hour, start, end, ramp));

  const combinedShape = (...shapeFns) =>
    buildTemplateValues((hour, index) => clamp(shapeFns.reduce((sum, shapeFn) => sum + shapeFn(hour, index), 0), 0, 1));

  const BUILT_IN_TEMPLATES = [
    {
      id: "residential-base-load",
      name: "Residential Base Load",
      category: "Residential",
      defaultPeakKw: 0.35,
      color: "#7ee787",
      normalizedValues: buildTemplateValues((hour) => 0.74 + 0.08 * Math.sin((hour / 24) * Math.PI * 4)),
    },
    {
      id: "residential-lighting",
      name: "Residential Lighting",
      category: "Residential",
      defaultPeakKw: 0.8,
      color: "#ffb84d",
      normalizedValues: combinedShape(
        () => 0.04,
        pulse(6.8, 0.9, 0.22),
        pulse(19.4, 2.1, 0.86)
      ),
    },
    {
      id: "residential-hvac-cooling",
      name: "Residential HVAC Cooling",
      category: "Residential",
      defaultPeakKw: 3.5,
      color: "#55c7ff",
      normalizedValues: combinedShape(() => 0.04, pulse(16, 3.7, 0.96), pulse(21, 1.8, 0.28)),
    },
    {
      id: "residential-heat-pump-heating",
      name: "Residential Heat Pump Heating",
      category: "Residential",
      defaultPeakKw: 4.5,
      color: "#ff9b73",
      normalizedValues: combinedShape(() => 0.06, pulse(6.6, 1.5, 0.82), pulse(19.5, 2.2, 0.62)),
    },
    {
      id: "residential-ev-level-2",
      name: "Residential EV Level 2",
      category: "Residential",
      defaultPeakKw: 7.2,
      color: "#b18cff",
      normalizedValues: windowShape(21.5, 5.5, 0, 1, 0.35),
    },
    {
      id: "residential-electric-water-heater",
      name: "Electric Water Heater",
      category: "Residential",
      defaultPeakKw: 4.5,
      color: "#5eead4",
      normalizedValues: combinedShape(() => 0.03, pulse(6.5, 0.7, 1), pulse(19, 0.9, 0.58), pulse(12, 0.7, 0.2)),
    },
    {
      id: "residential-clothes-dryer",
      name: "Clothes Dryer",
      category: "Residential",
      defaultPeakKw: 2.67,
      color: "#f97316",
      normalizedValues: buildTemplateValues((hour) => (hour >= 19 && hour < 20.5 ? 1 : 0)),
    },
    {
      id: "residential-dishwasher",
      name: "Dishwasher",
      category: "Residential",
      defaultPeakKw: 1.5,
      color: "#60a5fa",
      normalizedValues: combinedShape(() => 0.01, pulse(21.2, 0.8, 0.82), pulse(22.4, 0.5, 0.38)),
    },
    {
      id: "residential-electric-range",
      name: "Electric Range / Oven",
      category: "Residential",
      defaultPeakKw: 7,
      color: "#fb7185",
      normalizedValues: combinedShape(() => 0.01, pulse(7.2, 0.35, 0.25), pulse(18.4, 0.85, 1)),
    },
    {
      id: "residential-pool-pump",
      name: "Pool Pump",
      category: "Residential",
      defaultPeakKw: 1.5,
      color: "#38bdf8",
      normalizedValues: windowShape(10, 16, 0.01, 0.92, 0.4),
    },
    {
      id: "residential-furnace-fan",
      name: "Furnace Fan",
      category: "Residential",
      defaultPeakKw: 0.6,
      color: "#c4b5fd",
      normalizedValues: combinedShape(() => 0.03, pulse(6.5, 1.6, 0.75), pulse(20, 2.2, 0.62)),
    },
    {
      id: "residential-hot-tub-spa",
      name: "Hot Tub / Spa",
      category: "Residential",
      defaultPeakKw: 3.5,
      color: "#f472b6",
      normalizedValues: combinedShape(() => 0.18, pulse(18.8, 1.1, 0.74), pulse(22.2, 0.8, 0.38)),
    },
    {
      id: "residential-well-pump",
      name: "Well Pump",
      category: "Residential",
      defaultPeakKw: 1,
      color: "#2dd4bf",
      normalizedValues: combinedShape(() => 0.02, pulse(6.7, 0.35, 0.9), pulse(12.2, 0.32, 0.42), pulse(18.8, 0.4, 1)),
    },
    {
      id: "residential-sump-sewage-pump",
      name: "Sump / Sewage Pump",
      category: "Residential",
      defaultPeakKw: 0.8,
      color: "#a78bfa",
      normalizedValues: combinedShape(() => 0.01, pulse(4, 0.25, 0.58), pulse(11.5, 0.25, 0.44), pulse(21.5, 0.25, 0.68)),
    },
    {
      id: "residential-dehumidifier",
      name: "Dehumidifier",
      category: "Residential",
      defaultPeakKw: 0.6,
      color: "#93c5fd",
      normalizedValues: buildTemplateValues((hour) => 0.38 + 0.2 * smoothWindow(hour, 11, 23, 1.2) + 0.05 * Math.sin(hour * Math.PI * 2)),
    },
    {
      id: "residential-extra-refrigeration",
      name: "Extra Refrigerator / Freezer",
      category: "Residential",
      defaultPeakKw: 0.25,
      color: "#86efac",
      normalizedValues: buildTemplateValues((hour) => 0.54 + 0.12 * Math.sin((hour / 24) * Math.PI * 8) + 0.06 * smoothWindow(hour, 12, 21, 1)),
    },
    {
      id: "commercial-office-lighting",
      name: "Office Lighting",
      category: "Commercial",
      defaultPeakKw: 12,
      color: "#facc15",
      normalizedValues: windowShape(7, 18.5, 0.04, 0.94, 1),
    },
    {
      id: "commercial-plug-loads",
      name: "Office Plug Loads",
      category: "Commercial",
      defaultPeakKw: 8,
      color: "#a3e635",
      normalizedValues: combinedShape(() => 0.06, pulse(10.5, 2.4, 0.55), pulse(14.8, 2.6, 0.5)),
    },
    {
      id: "commercial-rtu-cooling",
      name: "Packaged RTU Cooling",
      category: "Commercial",
      defaultPeakKw: 25,
      color: "#55c7ff",
      normalizedValues: combinedShape(() => 0.05, pulse(14.5, 3.9, 0.9), pulse(8, 1.1, 0.2)),
    },
    {
      id: "commercial-rtu-heating",
      name: "Packaged RTU Heating",
      category: "Commercial",
      defaultPeakKw: 18,
      color: "#fb923c",
      normalizedValues: combinedShape(() => 0.05, pulse(6.5, 1, 1), pulse(11, 2.5, 0.38)),
    },
    {
      id: "commercial-ventilation-fan",
      name: "Ventilation Fan",
      category: "Commercial",
      defaultPeakKw: 5,
      color: "#93c5fd",
      normalizedValues: windowShape(6.5, 19, 0.08, 0.78, 0.5),
    },
    {
      id: "commercial-elevator",
      name: "Elevator / Vertical Transport",
      category: "Commercial",
      defaultPeakKw: 15,
      color: "#c084fc",
      normalizedValues: combinedShape(() => 0.02, pulse(8.3, 0.8, 0.88), pulse(12.2, 0.65, 0.52), pulse(17.2, 0.9, 0.72)),
    },
    {
      id: "commercial-refrigeration",
      name: "Commercial Refrigeration",
      category: "Commercial",
      defaultPeakKw: 6,
      color: "#67e8f9",
      normalizedValues: buildTemplateValues((hour) => 0.68 + 0.18 * smoothWindow(hour, 8, 22, 1) + 0.06 * Math.sin((hour / 24) * Math.PI * 8)),
    },
    {
      id: "commercial-kitchen-line",
      name: "Commercial Kitchen Line",
      category: "Commercial",
      defaultPeakKw: 30,
      color: "#ff7b72",
      normalizedValues: combinedShape(() => 0.03, pulse(7.5, 0.8, 0.55), pulse(12.1, 1, 1), pulse(18.4, 1.2, 0.82)),
    },
    {
      id: "commercial-retail-display-lighting",
      name: "Retail Display Lighting",
      category: "Commercial",
      defaultPeakKw: 10,
      color: "#f59e0b",
      normalizedValues: windowShape(9, 21.5, 0.05, 0.92, 0.6),
    },
    {
      id: "commercial-server-rack",
      name: "Server Rack / IT Closet",
      category: "Commercial",
      defaultPeakKw: 12,
      color: "#a5d6ff",
      normalizedValues: buildTemplateValues((hour) => 0.82 + 0.07 * Math.sin((hour / 24) * Math.PI * 6)),
    },
    {
      id: "industrial-process-base",
      name: "Continuous Process Base",
      category: "Industrial",
      defaultPeakKw: 50,
      color: "#94a3b8",
      normalizedValues: flat(0.95),
    },
    {
      id: "industrial-production-line",
      name: "Shift Production Line",
      category: "Industrial",
      defaultPeakKw: 120,
      color: "#ef4444",
      normalizedValues: windowShape(6, 18, 0.04, 0.96, 0.35),
    },
    {
      id: "industrial-conveyor-motors",
      name: "Conveyor Motors",
      category: "Industrial",
      defaultPeakKw: 35,
      color: "#f97316",
      normalizedValues: windowShape(5.5, 17.5, 0.06, 0.82, 0.25),
    },
    {
      id: "industrial-compressed-air",
      name: "Compressed Air Compressor",
      category: "Industrial",
      defaultPeakKw: 75,
      color: "#22c55e",
      normalizedValues: buildTemplateValues((hour) => 0.18 + 0.64 * smoothWindow(hour, 6, 18, 0.4) + 0.1 * Math.max(0, Math.sin(hour * Math.PI * 2))),
    },
    {
      id: "industrial-process-heating",
      name: "Process Heating",
      category: "Industrial",
      defaultPeakKw: 150,
      color: "#dc2626",
      normalizedValues: combinedShape(() => 0.03, pulse(8, 1.4, 0.85), pulse(13.5, 2.2, 1)),
    },
    {
      id: "industrial-process-chiller",
      name: "Process Chiller",
      category: "Industrial",
      defaultPeakKw: 100,
      color: "#06b6d4",
      normalizedValues: combinedShape(() => 0.18, pulse(14.5, 4.5, 0.78)),
    },
    {
      id: "industrial-cold-storage",
      name: "Cold Storage Refrigeration",
      category: "Industrial",
      defaultPeakKw: 60,
      color: "#38bdf8",
      normalizedValues: buildTemplateValues((hour) => 0.66 + 0.18 * pulse(15, 5, 1)(hour) + 0.07 * Math.sin(hour * Math.PI * 1.5)),
    },
    {
      id: "industrial-welding-station",
      name: "Welding Station",
      category: "Industrial",
      defaultPeakKw: 40,
      color: "#e879f9",
      normalizedValues: combinedShape(() => 0.01, pulse(9.4, 0.55, 0.72), pulse(11.2, 0.45, 0.9), pulse(14.6, 0.6, 1), pulse(16.3, 0.45, 0.62)),
    },
    {
      id: "industrial-cnc-machine",
      name: "CNC Machine",
      category: "Industrial",
      defaultPeakKw: 25,
      color: "#818cf8",
      normalizedValues: combinedShape(() => 0.04, pulse(9.5, 1.4, 0.7), pulse(13.5, 1.7, 0.84), pulse(16.2, 1, 0.45)),
    },
    {
      id: "industrial-irrigation-pump",
      name: "Irrigation Pump",
      category: "Industrial",
      defaultPeakKw: 30,
      color: "#2dd4bf",
      normalizedValues: windowShape(4.5, 10.5, 0, 1, 0.4),
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

  const toggleRowMuted = (rows = [], rowId) =>
    (Array.isArray(rows) ? rows : []).map((row) =>
      String(row.id) === String(rowId) ? { ...row, muted: !row.muted } : row
    );

  const renameRow = (rows = [], rowId, name = "") => {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return Array.isArray(rows) ? rows : [];
    return (Array.isArray(rows) ? rows : []).map((row) =>
      String(row.id) === String(rowId) ? { ...row, name: trimmedName } : row
    );
  };

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

  const createPointId = (index) => `point-${index}`;

  const smoothValues = (values = [], radius = 2) => {
    const source = normalizeValues(values);
    return source.map((_, index) => {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const candidate = source[index + offset];
        if (candidate == null) continue;
        sum += candidate;
        count += 1;
      }
      return count ? sum / count : source[index];
    });
  };

  const perpendicularDistance = (point, start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
  };

  const rdpIndices = (points = [], epsilon = 0) => {
    if (!Array.isArray(points) || points.length <= 2) return [0, Math.max(points.length - 1, 0)];
    const keep = new Set([0, points.length - 1]);
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [startIndex, endIndex] = stack.pop();
      let maxDistance = -1;
      let splitIndex = -1;
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const distance = perpendicularDistance(points[index], points[startIndex], points[endIndex]);
        if (distance > maxDistance) {
          maxDistance = distance;
          splitIndex = index;
        }
      }
      if (maxDistance > epsilon && splitIndex > startIndex && splitIndex < endIndex) {
        keep.add(splitIndex);
        stack.push([startIndex, splitIndex], [splitIndex, endIndex]);
      }
    }
    return Array.from(keep).sort((left, right) => left - right);
  };

  const clusterIndices = (indices = [], minGap = 3) => {
    const source = Array.isArray(indices) ? indices.slice().sort((left, right) => left - right) : [];
    if (!source.length) return [];
    const groups = [[source[0]]];
    for (let index = 1; index < source.length; index += 1) {
      const current = source[index];
      const group = groups[groups.length - 1];
      if (current - group[group.length - 1] <= minGap) group.push(current);
      else groups.push([current]);
    }
    return groups.map((group) => group[Math.floor(group.length / 2)]);
  };

  const countActiveSegments = (values = [], threshold = 0) => {
    let segments = 0;
    let active = false;
    values.forEach((value) => {
      if (value > threshold && !active) {
        active = true;
        segments += 1;
      } else if (value <= threshold) {
        active = false;
      }
    });
    return segments;
  };

  const getLoadStackBaselineScore = (row = {}) => {
    const values = normalizeValues(row.values);
    const peak = Math.max(...values, 0);
    const kwh = calculateDailyEnergyKwh(values);
    if (!peak || !kwh) return 0;
    const activeThreshold = peak * 0.08;
    const activeValues = values.filter((value) => value > activeThreshold);
    const activeRatio = activeValues.length / Math.max(1, values.length);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const coefficientOfVariation = mean ? Math.sqrt(variance) / mean : 0;
    const sorted = values.slice().sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const medianToPeak = peak ? median / peak : 0;
    const segments = countActiveSegments(values, activeThreshold);
    const peakToAverage = mean ? peak / mean : 0;

    return (
      activeRatio * 5 +
      medianToPeak * 3 -
      Math.min(coefficientOfVariation, 3) * 1.4 -
      Math.min(Math.max(peakToAverage - 1, 0), 12) * 0.22 -
      Math.min(Math.max(segments - 1, 0), 6) * 0.35
    );
  };

  const sortRowsByLoadStackPosition = (rows = []) =>
    (Array.isArray(rows) ? rows : [])
      .map((row, index) => ({
        row,
        index,
        baselineScore: getLoadStackBaselineScore(row),
        kwh: calculateDailyEnergyKwh(row?.values),
        peak: Math.max(...normalizeValues(row?.values), 0),
      }))
      .sort((left, right) => {
        if (Math.abs(left.baselineScore - right.baselineScore) > 0.01) return left.baselineScore - right.baselineScore;
        const leftPeaky = left.peak / Math.max(left.kwh, 0.001);
        const rightPeaky = right.peak / Math.max(right.kwh, 0.001);
        if (Math.abs(leftPeaky - rightPeaky) > 0.01) return rightPeaky - leftPeaky;
        return left.index - right.index;
      })
      .map((item) => item.row);

  const findActiveEdgeIndices = (values = [], threshold = 0) => {
    const starts = [];
    const ends = [];
    let active = values[0] > threshold;
    for (let index = 1; index < values.length; index += 1) {
      const isActive = values[index] > threshold;
      if (isActive && !active) starts.push(index);
      if (!isActive && active) ends.push(index - 1);
      active = isActive;
    }
    if (values[values.length - 1] > threshold) ends.push(values.length - 1);
    return {
      starts: clusterIndices(starts, 3),
      ends: clusterIndices(ends, 3),
    };
  };

  const findProminentExtrema = (values = [], amplitude = 0) => {
    if (!values.length || amplitude <= 0) return [];
    const prominenceThreshold = amplitude * 0.08;
    const candidates = [];
    for (let index = 1; index < values.length - 1; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      const next = values[index + 1];
      const isPeak = current >= previous && current >= next && (current - Math.min(previous, next)) >= prominenceThreshold;
      const isTrough = current <= previous && current <= next && (Math.max(previous, next) - current) >= prominenceThreshold;
      if (isPeak || isTrough) candidates.push(index);
    }
    return clusterIndices(candidates, 3);
  };

  const findSlopeChangeIndices = (values = [], amplitude = 0) => {
    if (!values.length || amplitude <= 0) return [];
    const slopes = values.slice(1).map((value, index) => value - values[index]);
    const threshold = amplitude * 0.03;
    const candidates = [];
    for (let index = 1; index < slopes.length; index += 1) {
      const previous = slopes[index - 1];
      const current = slopes[index];
      const change = Math.abs(current - previous);
      const signChange = previous * current < 0;
      const entersPlateau = Math.abs(previous) >= threshold && Math.abs(current) < threshold * 0.5;
      const leavesPlateau = Math.abs(previous) < threshold * 0.5 && Math.abs(current) >= threshold;
      if (signChange || entersPlateau || leavesPlateau || change >= threshold * 1.6) candidates.push(index);
    }
    if (candidates.length > 20) return [];
    return clusterIndices(candidates, 3);
  };

  const deriveEditPoints = (values = [], options = {}) => {
    const source = normalizeValues(values);
    const minPoints = clamp(toNumber(options.minPoints, MIN_EDIT_POINTS), MIN_EDIT_POINTS, MAX_EDIT_POINTS);
    const maxPoints = clamp(toNumber(options.maxPoints, MAX_EDIT_POINTS), minPoints, MAX_EDIT_POINTS);
    const smoothed = smoothValues(source);
    const minValue = Math.min(...smoothed, 0);
    const maxValue = Math.max(...smoothed, 1);
    const amplitude = Math.max(0, maxValue - minValue);
    if (amplitude <= 0.5) {
      return [
        { id: createPointId(0), index: 0, valueKw: source[0] },
        { id: createPointId(INTERVALS_PER_DAY - 1), index: INTERVALS_PER_DAY - 1, valueKw: source[INTERVALS_PER_DAY - 1] },
      ];
    }
    const activeThreshold = minValue + amplitude * 0.12;
    const activeSegments = countActiveSegments(smoothed, activeThreshold);
    const activeEdges = findActiveEdgeIndices(smoothed, activeThreshold);
    const extrema = findProminentExtrema(smoothed, amplitude);
    const slopeChanges = findSlopeChangeIndices(source, amplitude);
    const preferredCount = clamp(2 + activeSegments * 2 + extrema.length + slopeChanges.length, minPoints, maxPoints);
    const points = smoothed.map((value, index) => ({
      x: index / Math.max(INTERVALS_PER_DAY - 1, 1),
      y: value / maxValue,
    }));

    let low = 0;
    let high = 1;
    let best = rdpIndices(points, low);
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const epsilon = (low + high) / 2;
      const candidate = rdpIndices(points, epsilon);
      if (candidate.length > preferredCount) {
        low = epsilon;
      } else {
        high = epsilon;
        best = candidate;
      }
    }

    let indices = best;
    if (indices.length < minPoints) {
      indices = Array.from({ length: minPoints }, (_, slot) =>
        Math.round((slot / Math.max(minPoints - 1, 1)) * (INTERVALS_PER_DAY - 1))
      );
    }
    indices = clusterIndices([...indices, ...activeEdges.starts, ...activeEdges.ends, ...extrema, ...slopeChanges], 3);
    if (!indices.includes(0)) indices = [0, ...indices];
    if (!indices.includes(INTERVALS_PER_DAY - 1)) indices = [...indices, INTERVALS_PER_DAY - 1];
    indices = Array.from(new Set(indices)).sort((left, right) => left - right).slice(0, maxPoints);
    if (indices[0] !== 0) indices[0] = 0;
    if (indices[indices.length - 1] !== INTERVALS_PER_DAY - 1) indices[indices.length - 1] = INTERVALS_PER_DAY - 1;

    return indices.map((index) => ({
      id: createPointId(index),
      index,
      valueKw: source[index],
    }));
  };

  const normalizeEditPoints = (points = []) => {
    const source = Array.isArray(points) ? points : [];
    const normalized = source
      .map((point, order) => ({
        id: point?.id || createPointId(point?.index ?? order),
        index: clamp(Math.round(toNumber(point?.index, order)), 0, INTERVALS_PER_DAY - 1),
        valueKw: Math.max(0, toNumber(point?.valueKw, 0)),
      }))
      .sort((left, right) => left.index - right.index)
      .filter((point, index, items) => index === 0 || point.index !== items[index - 1].index);

    if (!normalized.length) {
      return [
        { id: createPointId(0), index: 0, valueKw: 0 },
        { id: createPointId(INTERVALS_PER_DAY - 1), index: INTERVALS_PER_DAY - 1, valueKw: 0 },
      ];
    }
    normalized[0] = { ...normalized[0], id: normalized[0].id || createPointId(0), index: 0 };
    normalized[normalized.length - 1] = {
      ...normalized[normalized.length - 1],
      id: normalized[normalized.length - 1].id || createPointId(INTERVALS_PER_DAY - 1),
      index: INTERVALS_PER_DAY - 1,
    };
    return normalized;
  };

  const buildMonotoneTangents = (points = []) => {
    if (points.length <= 1) return [0];
    const delta = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const dx = points[index + 1].index - points[index].index;
      delta[index] = dx ? (points[index + 1].valueKw - points[index].valueKw) / dx : 0;
    }
    const tangents = Array.from({ length: points.length }, () => 0);
    tangents[0] = delta[0];
    tangents[points.length - 1] = delta[delta.length - 1];
    for (let index = 1; index < points.length - 1; index += 1) {
      tangents[index] = delta[index - 1] * delta[index] <= 0 ? 0 : (delta[index - 1] + delta[index]) / 2;
    }
    for (let index = 0; index < delta.length; index += 1) {
      if (!delta[index]) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
        continue;
      }
      const alpha = tangents[index] / delta[index];
      const beta = tangents[index + 1] / delta[index];
      const scale = Math.hypot(alpha, beta);
      if (scale > 3) {
        const factor = 3 / scale;
        tangents[index] = factor * alpha * delta[index];
        tangents[index + 1] = factor * beta * delta[index];
      }
    }
    return tangents;
  };

  const sampleEditPoints = (points = [], sampleCount = INTERVALS_PER_DAY) => {
    const controlPoints = normalizeEditPoints(points);
    const tangents = buildMonotoneTangents(controlPoints);
    const samples = Array.from({ length: sampleCount }, () => 0);
    let segment = 0;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const x = sampleIndex;
      while (segment < controlPoints.length - 2 && x > controlPoints[segment + 1].index) {
        segment += 1;
      }
      const start = controlPoints[segment];
      const end = controlPoints[Math.min(segment + 1, controlPoints.length - 1)];
      const dx = Math.max(1, end.index - start.index);
      const t = clamp((x - start.index) / dx, 0, 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const value =
        h00 * start.valueKw +
        h10 * dx * tangents[segment] +
        h01 * end.valueKw +
        h11 * dx * tangents[Math.min(segment + 1, tangents.length - 1)];
      samples[sampleIndex] = Math.max(0, value);
    }
    return normalizeValues(samples, sampleCount);
  };

  const createEditSession = (row = {}, options = {}) => {
    const originalValues = normalizeValues(row?.values);
    const savedPoints = Array.isArray(row?.editPoints) && row.editPoints.length ? normalizeEditPoints(row.editPoints) : [];
    const points = savedPoints.length >= MIN_EDIT_POINTS ? savedPoints : deriveEditPoints(originalValues, options);
    return {
      rowId: String(row?.id || ""),
      originalValues,
      originalPoints: points.map((point) => ({ ...point })),
      draftValues: originalValues.slice(),
      points,
      selectedPointIds: [],
      mode: "point",
    };
  };

  const normalizeSelectedPointIds = (points = [], selectedPointIds = []) => {
    const available = new Set(normalizeEditPoints(points).map((point) => String(point.id)));
    return toArray(selectedPointIds)
      .map((pointId) => String(pointId))
      .filter((pointId, index, items) => available.has(pointId) && items.indexOf(pointId) === index);
  };

  const setSelectedEditPoints = (session = {}, selectedPointIds = []) => ({
    ...session,
    selectedPointIds: normalizeSelectedPointIds(session?.points, selectedPointIds),
  });

  const toggleEditPointSelection = (session = {}, pointId) => {
    const targetId = String(pointId || "");
    if (!targetId) return session;
    const selectedPointIds = normalizeSelectedPointIds(session?.points, session?.selectedPointIds);
    return setSelectedEditPoints(
      session,
      selectedPointIds.includes(targetId)
        ? selectedPointIds.filter((candidate) => candidate !== targetId)
        : [...selectedPointIds, targetId]
    );
  };

  const getSelectedPointIdsForMove = (session = {}, pointId) => {
    const targetId = String(pointId || "");
    const selectedPointIds = normalizeSelectedPointIds(session?.points, session?.selectedPointIds);
    if (targetId && selectedPointIds.includes(targetId)) return selectedPointIds;
    return targetId ? [targetId] : selectedPointIds;
  };

  const getIndexBoundsForSelection = (points = [], selectedIds = []) => {
    const normalizedPoints = normalizeEditPoints(points);
    const selected = new Set(toArray(selectedIds).map((pointId) => String(pointId)));
    let minDelta = -Infinity;
    let maxDelta = Infinity;
    normalizedPoints.forEach((point, index) => {
      if (!selected.has(String(point.id))) return;
      const previousUnselected = normalizedPoints
        .slice(0, index)
        .reverse()
        .find((candidate) => !selected.has(String(candidate.id)));
      const nextUnselected = normalizedPoints
        .slice(index + 1)
        .find((candidate) => !selected.has(String(candidate.id)));
      const lowerBound = index === 0 ? point.index : (previousUnselected?.index ?? 0) + 1;
      const upperBound =
        index === normalizedPoints.length - 1
          ? point.index
          : (nextUnselected?.index ?? INTERVALS_PER_DAY - 1) - 1;
      minDelta = Math.max(minDelta, lowerBound - point.index);
      maxDelta = Math.min(maxDelta, upperBound - point.index);
    });
    if (minDelta > maxDelta) {
      return { minDelta: 0, maxDelta: 0 };
    }
    return {
      minDelta: Number.isFinite(minDelta) ? minDelta : 0,
      maxDelta: Number.isFinite(maxDelta) ? maxDelta : 0,
    };
  };

  const updateEditPoint = (session = {}, pointId, nextPoint = {}) => {
    const sourcePoints = normalizeEditPoints(session?.points);
    const index = sourcePoints.findIndex((point) => String(point.id) === String(pointId));
    if (index < 0) return session;
    const previousPoint = sourcePoints[index - 1] || null;
    const nextNeighbor = sourcePoints[index + 1] || null;
    const isEndpoint = index === 0 || index === sourcePoints.length - 1;
    const lowerBound = (previousPoint?.index ?? 0) + 1;
    const upperBound = (nextNeighbor?.index ?? INTERVALS_PER_DAY - 1) - 1;
    const nextIndex = isEndpoint
      ? sourcePoints[index].index
      : lowerBound > upperBound
        ? sourcePoints[index].index
        : clamp(Math.round(toNumber(nextPoint.index, sourcePoints[index].index)), lowerBound, upperBound);
    const updatedPoints = sourcePoints.map((point, pointIndex) =>
      pointIndex === index
        ? {
            ...point,
            index: nextIndex,
            valueKw: Math.max(0, toNumber(nextPoint.valueKw, point.valueKw)),
          }
        : point
    );
    const points = normalizeEditPoints(updatedPoints);
    return {
      ...session,
      points,
      draftValues: sampleEditPoints(points),
    };
  };

  const moveEditPoints = (session = {}, pointId, movement = {}) => {
    const sourcePoints = normalizeEditPoints(session?.points);
    const selectedPointIds = getSelectedPointIdsForMove(session, pointId);
    if (!sourcePoints.length || !selectedPointIds.length) return session;
    const selected = new Set(selectedPointIds.map((candidate) => String(candidate)));
    const deltaValueKw = toNumber(movement?.deltaValueKw, 0);
    const { minDelta, maxDelta } = getIndexBoundsForSelection(sourcePoints, selectedPointIds);
    const deltaIndex = clamp(Math.round(toNumber(movement?.deltaIndex, 0)), minDelta, maxDelta);
    const updatedPoints = sourcePoints.map((point, index) => {
      const isSelected = selected.has(String(point.id));
      if (!isSelected) return point;
      const isEndpoint = index === 0 || index === sourcePoints.length - 1;
      return {
        ...point,
        index: isEndpoint ? point.index : point.index + deltaIndex,
        valueKw: Math.max(0, point.valueKw + deltaValueKw),
      };
    });
    const points = normalizeEditPoints(updatedPoints);
    return {
      ...session,
      points,
      selectedPointIds: normalizeSelectedPointIds(points, selectedPointIds),
      mode: "point",
      draftValues: sampleEditPoints(points),
    };
  };

  const addEditPoint = (session = {}, nextPoint = {}, options = {}) => {
    const sourcePoints = normalizeEditPoints(session?.points);
    if (sourcePoints.length >= MAX_EDIT_POINTS) return session;
    const snappedIndex = clamp(Math.round(toNumber(nextPoint?.index, 0)), 0, INTERVALS_PER_DAY - 1);
    const proximityThreshold = Math.max(1, Math.round(toNumber(options?.minIntervalGap, 1)));
    const duplicateNearby = sourcePoints.some((point) => Math.abs(point.index - snappedIndex) <= proximityThreshold);
    if (duplicateNearby) return session;
    const currentValues = normalizeValues(session?.draftValues || sampleEditPoints(sourcePoints));
    const valueKw = Math.max(0, toNumber(currentValues[snappedIndex], nextPoint?.valueKw || 0));
    const newPoint = {
      id: createPointId(`${snappedIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      index: snappedIndex,
      valueKw,
    };
    const points = normalizeEditPoints([...sourcePoints, newPoint]);
    return {
      ...session,
      points,
      selectedPointIds: [newPoint.id],
      mode: "point",
      draftValues: currentValues,
    };
  };

  const deleteEditPoints = (session = {}, pointIds = []) => {
    const sourcePoints = normalizeEditPoints(session?.points);
    const idsToDelete = new Set(toArray(pointIds).map((pointId) => String(pointId)));
    if (!idsToDelete.size) return session;
    const remaining = sourcePoints.filter((point, index) => {
      const isEndpoint = index === 0 || index === sourcePoints.length - 1;
      return isEndpoint || !idsToDelete.has(String(point.id));
    });
    if (remaining.length < MIN_EDIT_POINTS) return session;
    const points = normalizeEditPoints(remaining);
    return {
      ...session,
      points,
      selectedPointIds: [],
      mode: "point",
      draftValues: sampleEditPoints(points),
    };
  };

  const wrapArray = (values = [], shiftIntervals = 0) => {
    const source = normalizeValues(values);
    const length = source.length;
    if (!length) return [];
    const offset = ((Math.round(toNumber(shiftIntervals, 0)) % length) + length) % length;
    if (!offset) return source.slice();
    return Array.from({ length }, (_, index) => source[(index - offset + length) % length]);
  };

  const scaleValues = (values = [], scaleFactor = 1) =>
    normalizeValues(values).map((value) => (value > 0 ? Math.max(0, value * Math.max(0, toNumber(scaleFactor, 1))) : 0));

  const scaleValuesToDailyEnergy = (values = [], targetKwh = 0) => {
    const source = normalizeValues(values);
    const currentKwh = calculateDailyEnergyKwh(source);
    const nextKwh = Math.max(0, toNumber(targetKwh, 0));
    if (!currentKwh || !nextKwh) return source;
    return scaleValues(source, nextKwh / currentKwh);
  };

  const shiftValuesByHours = (values = [], hours = 0) => wrapArray(values, Math.round(toNumber(hours, 0) * (60 / INTERVAL_MINUTES)));

  const getTemplateById = (templateId) => BUILT_IN_TEMPLATES.find((template) => String(template.id) === String(templateId)) || null;

  const getScheduledStartHour = (templateId, schedule) => {
    const id = String(templateId || "");
    const value = String(schedule || "");
    if (id === "residential-ev-level-2") {
      if (value === "daytime") return 10;
      if (value === "evening") return 18;
      return 21.5;
    }
    if (id === "residential-pool-pump") return 10;
    if (id === "residential-clothes-dryer") {
      if (value === "daytime") return 13;
      if (value === "overnight") return 22;
      return 19;
    }
    if (id === "residential-dishwasher") {
      if (value === "daytime") return 12;
      if (value === "overnight") return 23;
      return 21;
    }
    return 10;
  };

  const buildRuntimeWindowValues = ({ templateId, peakKw = 0, hours = 0, schedule = "" } = {}) => {
    const peak = Math.max(0, toNumber(peakKw, 0));
    const runtimeHours = clamp(toNumber(hours, 0), 0, 24);
    const values = Array.from({ length: INTERVALS_PER_DAY }, () => 0);
    if (!peak || !runtimeHours) return values;
    const startIndex = Math.round(getScheduledStartHour(templateId, schedule) * (60 / INTERVAL_MINUTES)) % INTERVALS_PER_DAY;
    const fullIntervals = Math.floor(runtimeHours / INTERVAL_HOURS);
    const partialHours = runtimeHours - fullIntervals * INTERVAL_HOURS;
    for (let offset = 0; offset < fullIntervals; offset += 1) {
      values[(startIndex + offset) % INTERVALS_PER_DAY] = peak;
    }
    if (partialHours > 0) {
      values[(startIndex + fullIntervals) % INTERVALS_PER_DAY] = peak * (partialHours / INTERVAL_HOURS);
    }
    return values;
  };

  const buildCappedEnergyWindowValues = ({ templateId, peakKw = 0, kwh = 0, schedule = "" } = {}) => {
    const peak = Math.max(0, toNumber(peakKw, 0));
    let remainingKwh = Math.max(0, toNumber(kwh, 0));
    const values = Array.from({ length: INTERVALS_PER_DAY }, () => 0);
    if (!peak || !remainingKwh) return values;
    const startIndex = Math.round(getScheduledStartHour(templateId, schedule) * (60 / INTERVAL_MINUTES)) % INTERVALS_PER_DAY;
    for (let offset = 0; offset < INTERVALS_PER_DAY && remainingKwh > 0; offset += 1) {
      const index = (startIndex + offset) % INTERVALS_PER_DAY;
      const value = Math.min(peak, remainingKwh / INTERVAL_HOURS);
      values[index] = value;
      remainingKwh -= value * INTERVAL_HOURS;
    }
    return values;
  };

  const buildWorkdayWindowValues = (peakKw = 0) => {
    const peak = Math.max(0, toNumber(peakKw, 0));
    return buildTemplateValues((hour) => 0.06 + 0.94 * smoothWindow(hour, 8.5, 17.5, 1)).map((value) => value * peak);
  };

  const addOccupancyLighting = (values = [], occupancy = "") => {
    const source = normalizeValues(values);
    const peak = Math.max(...source, 0);
    if (!peak) return source;
    const daytimeFactor = {
      away_weekdays: 0.03,
      work_from_home: 0.18,
      occupied_daytime: 0.24,
    }[String(occupancy || "")] || 0;
    if (!daytimeFactor) return source;
    return source.map((value, index) => {
      const hour = index / 4;
      const daytimeValue = peak * daytimeFactor * smoothWindow(hour, 8, 17.75, 1.25);
      return Math.max(value, daytimeValue);
    });
  };

  const getScheduleShiftHours = (templateId, schedule) => {
    const id = String(templateId || "");
    if (id === "residential-ev-level-2") {
      if (schedule === "daytime") return 12;
      if (schedule === "evening") return -3;
      return 0;
    }
    if (id === "residential-clothes-dryer") {
      if (schedule === "daytime") return -6;
      if (schedule === "overnight") return 3;
      return 0;
    }
    if (id === "residential-dishwasher") {
      if (schedule === "daytime") return -9;
      if (schedule === "overnight") return 2;
      return 0;
    }
    return 0;
  };

  const applyAssistantModifiers = (row = {}, modifiers = []) => {
    let values = normalizeValues(row.values);
    toArray(modifiers).forEach((modifier) => {
      const type = String(modifier?.type || "");
      if (type === "scale") values = scaleValues(values, toNumber(modifier.factor, 1));
      if (type === "target_daily_energy") values = scaleValuesToDailyEnergy(values, modifier.kwh);
      if (type === "time_shift") values = shiftValuesByHours(values, modifier.hours ?? modifier.shiftHours);
      if (type === "schedule") values = shiftValuesByHours(values, getScheduleShiftHours(row.sourceTemplateId, modifier.value));
      if (type === "hours") {
        values = buildRuntimeWindowValues({
          templateId: row.sourceTemplateId,
          peakKw: Math.max(...values, toNumber(row.peak, 0)),
          hours: modifier.hours,
          schedule: modifier.value,
        });
      }
      if (type === "ev_charging_profile") {
        values = buildCappedEnergyWindowValues({
          templateId: row.sourceTemplateId,
          peakKw: modifier.peakKw || Math.max(...values, toNumber(row.peak, 0)),
          kwh: modifier.kwh,
          schedule: modifier.value || "overnight",
        });
      }
      if (type === "workday_window") values = buildWorkdayWindowValues(Math.max(...values, toNumber(row.peak, 0)));
      if (type === "occupancy_lighting") values = addOccupancyLighting(values, modifier.value);
      if (type === "charging_concurrency" && modifier.value === "simultaneous" && row.aiFacts?.evCount > 1) {
        values = scaleValues(values, row.aiFacts.evCount);
      }
      if (type === "climate_bucket" && row.sourceTemplateId === "residential-hvac-cooling" && modifier.value === "hot") {
        values = scaleValues(values, 1.15);
      }
      if (type === "climate_bucket" && row.sourceTemplateId === "residential-heat-pump-heating" && modifier.value === "cold") {
        values = scaleValues(values, 1.15);
      }
    });
    return updateRowStats({ ...row, values });
  };

  const createRowsFromAssistantProposal = (proposal = {}, options = {}) => {
    const loads = toArray(proposal.loads).slice(0, MAX_LOAD_ROWS);
    const facts = proposal.facts && typeof proposal.facts === "object" ? proposal.facts : {};
    const rows = [];
    const errors = [];
    loads.forEach((load, index) => {
      const template = getTemplateById(load?.templateId);
      if (!template) {
        errors.push(`Unsupported template: ${load?.templateId || "unknown"}`);
        return;
      }
      const row = createRowFromTemplate(template, {
        id: options.idFactory ? options.idFactory(load, index) : uid("ai-load"),
        name: load.name || template.name,
        peakKw: load.peakKw ?? template.defaultPeakKw,
        selected: false,
      });
      rows.push(
        applyAssistantModifiers(
          {
            ...row,
            group: template.category,
            category: template.category,
            aiAssisted: true,
            aiReason: String(load.reason || "").trim(),
            aiAssumption: String(load.assumption || "").trim(),
            aiFacts: facts,
            aiModifiers: toArray(load.modifiers),
          },
          load.modifiers
        )
      );
    });
    const sortedRows = sortRowsByLoadStackPosition(rows);
    const selectedRowId = sortedRows[0]?.id || null;
    return {
      rows: selectedRowId ? selectRow(sortedRows, selectedRowId) : sortedRows,
      selectedRowId,
      errors,
    };
  };

  const createProfileModelFromAssistantProposal = (proposal = {}, options = {}) => {
    const converted = createRowsFromAssistantProposal(proposal, options);
    return validateProfileModel({
      ...createEmptyProfileModel(proposal.profileName || options.name || "AI Assisted Load Profile"),
      rows: converted.rows,
      selectedRowId: converted.selectedRowId,
      aiAssisted: true,
      aiGeneratedAt: new Date().toISOString(),
    });
  };

  const transformEditSession = (session = {}, transform = {}) => {
    const baseValues = normalizeValues(transform?.baseValues || session?.draftValues || session?.originalValues);
    const shiftIntervals = Math.round(toNumber(transform?.shiftIntervals, 0));
    const scaleFactor = Math.max(0, toNumber(transform?.scaleFactor, 1));
    const shiftedValues = wrapArray(baseValues, shiftIntervals);
    const draftValues = scaleValues(shiftedValues, scaleFactor);
    const sourcePoints = normalizeEditPoints(session?.points);
    const shiftedPoints = sourcePoints.map((point) => {
      const shiftedIndex = ((point.index + shiftIntervals) % INTERVALS_PER_DAY + INTERVALS_PER_DAY) % INTERVALS_PER_DAY;
      return {
        ...point,
        index: shiftedIndex,
        valueKw: Math.max(0, point.valueKw > 0 ? point.valueKw * scaleFactor : 0),
      };
    });
    const points = normalizeEditPoints(shiftedPoints.length ? shiftedPoints : deriveEditPoints(draftValues));
    return {
      ...session,
      points,
      selectedPointIds: normalizeSelectedPointIds(points, session?.selectedPointIds),
      mode: "transform",
      draftValues,
    };
  };

  const commitEditSession = (row = {}, session = {}) => {
    const values = normalizeValues(session?.draftValues || row?.values);
    const points = normalizeEditPoints(session?.points || row?.editPoints || []);
    return updateRowStats({
      ...row,
      values,
      editPoints: points.map((point) => ({
        id: point.id,
        index: point.index,
        valueKw: Math.max(0, toNumber(values[point.index], point.valueKw)),
      })),
    });
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
    MIN_EDIT_POINTS,
    MAX_EDIT_POINTS,
    BUILT_IN_TEMPLATES,
    normalizeValues,
    calculateAggregate,
    calculateDailyEnergyKwh,
    getAggregateStats,
    getIndividualAxisMax,
    updateRowStats,
    createRowFromTemplate,
    createRowsFromAssistantProposal,
    createProfileModelFromAssistantProposal,
    addRowFromTemplate,
    duplicateRow,
    deleteRow,
    toggleRowLocked,
    toggleRowMuted,
    renameRow,
    reorderRows,
    getInsertionIndexFromPoint,
    deriveEditPoints,
    sampleEditPoints,
    createEditSession,
    setSelectedEditPoints,
    toggleEditPointSelection,
    updateEditPoint,
    moveEditPoints,
    addEditPoint,
    deleteEditPoints,
    transformEditSession,
    commitEditSession,
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
