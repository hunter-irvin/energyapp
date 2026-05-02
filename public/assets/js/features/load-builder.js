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
    const prominenceThreshold = amplitude * 0.18;
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
    const preferredCount = clamp(2 + activeSegments * 2 + extrema.length, minPoints, Math.min(maxPoints, 10));
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
    indices = clusterIndices([...indices, ...activeEdges.starts, ...activeEdges.ends], 3);
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
    const points = deriveEditPoints(originalValues, options);
    return {
      rowId: String(row?.id || ""),
      originalValues,
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
    const nextIndex = isEndpoint
      ? sourcePoints[index].index
      : clamp(
          Math.round(toNumber(nextPoint.index, sourcePoints[index].index)),
          (previousPoint?.index ?? 0) + 1,
          (nextNeighbor?.index ?? INTERVALS_PER_DAY - 1) - 1
        );
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
    const valueKw = Math.max(0, toNumber(nextPoint?.valueKw, 0));
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
      draftValues: sampleEditPoints(points),
    };
  };

  const deleteEditPoints = (session = {}, pointIds = []) => {
    const sourcePoints = normalizeEditPoints(session?.points);
    const idsToDelete = new Set(toArray(pointIds).map((pointId) => String(pointId)));
    if (!idsToDelete.size) return session;
    const remaining = sourcePoints.filter((point) => !idsToDelete.has(String(point.id)));
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

  const transformEditSession = (session = {}, transform = {}) => {
    const baseValues = normalizeValues(transform?.baseValues || session?.draftValues || session?.originalValues);
    const shiftedValues = wrapArray(baseValues, transform?.shiftIntervals);
    const draftValues = scaleValues(shiftedValues, transform?.scaleFactor);
    const points = deriveEditPoints(draftValues, {
      minPoints: MIN_EDIT_POINTS,
      maxPoints: MAX_EDIT_POINTS,
    });
    return {
      ...session,
      points,
      selectedPointIds: [],
      mode: "transform",
      draftValues,
    };
  };

  const commitEditSession = (row = {}, session = {}) =>
    updateRowStats({
      ...row,
      values: normalizeValues(session?.draftValues || row?.values),
    });

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
    addRowFromTemplate,
    duplicateRow,
    deleteRow,
    toggleRowLocked,
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
