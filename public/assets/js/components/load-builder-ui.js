(() => {
  const ReactRef = window.React;
  const ReactDOMRef = window.ReactDOM;
  if (!ReactRef || !ReactDOMRef) return;

  const e = ReactRef.createElement;
  const INFO_PANEL_WIDTH = 224;
  const CHART_VERTICAL_PADDING = 7;
  const HOURS = Array.from({ length: 25 }, (_, index) => index);

  const toArray = (value) => (Array.isArray(value) ? value : []);
  const getAggregateLayerRows = (rows) => toArray(rows).slice().reverse();
  const formatNumber = (value, digits = 0) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return numeric.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  };
  const formatTimeAtIndex = (index = 0, intervalMinutes = 15) => {
    const totalMinutes = Math.max(0, Math.round(Number(index) || 0) * intervalMinutes);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };
  const sentenceCase = (value = "") => {
    const text = String(value || "");
    const firstLetterIndex = text.search(/[A-Za-z]/);
    if (firstLetterIndex < 0) return text;
    return `${text.slice(0, firstLetterIndex)}${text.charAt(firstLetterIndex).toUpperCase()}${text.slice(firstLetterIndex + 1)}`;
  };
  const getChartHoverIndex = (event, valueCount = 96) => {
    const count = Math.max(1, Number(valueCount) || 1);
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
  };
  const getChartHoverPosition = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100)),
    };
  };
  const valueToChartY = (value = 0, height = 88, maxValue = 1) =>
    height - (Math.max(0, Number(value) || 0) / Math.max(Number(maxValue) || 1, 1)) * (height - CHART_VERTICAL_PADDING * 2) - CHART_VERTICAL_PADDING;
  const pointValueFromClientY = (clientY, rect, maxValue, height = 88) => {
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    const y = ratio * height;
    const normalized = (height - CHART_VERTICAL_PADDING - y) / Math.max(1, height - CHART_VERTICAL_PADDING * 2);
    return Math.max(0, normalized * Math.max(Number(maxValue) || 1, 1));
  };

  const pointsFromValues = (values, height = 88, width = 100, maxValue = null) => {
    const source = toArray(values);
    const max = Math.max(Number(maxValue) || Math.max(...source, 1), 1);
    return source
      .map((value, index) => {
        const x = (index / Math.max(1, source.length - 1)) * width;
        const y =
          height -
          (Math.max(0, Number(value) || 0) / max) * (height - CHART_VERTICAL_PADDING * 2) -
          CHART_VERTICAL_PADDING;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const zeroY = (height = 88) => height - CHART_VERTICAL_PADDING;

  const areaPath = (values, height = 88, width = 100, maxValue = null) => {
    const points = pointsFromValues(values, height, width, maxValue).split(" ");
    const baseline = zeroY(height);
    return `M0,${baseline} L${points.join(" L")} L${width},${baseline} Z`;
  };

  const calculateStackedPaths = (rows, height = 88, width = 100) => {
    const activeRows = toArray(rows).filter((row) => !row?.muted);
    const intervals = Math.max(...activeRows.map((row) => toArray(row.values).length), 96);
    const baseline = Array.from({ length: intervals }, () => 0);
    const totals = Array.from({ length: intervals }, (_, index) =>
      activeRows.reduce((sum, row) => sum + (Number(row?.values?.[index]) || 0), 0)
    );
    const max = Math.max(...totals, 1);
    return activeRows.map((row) => {
      const lower = baseline.slice();
      const upper = baseline.map((value, index) => value + (Number(row?.values?.[index]) || 0));
      upper.forEach((value, index) => {
        baseline[index] = value;
      });
      const upperPoints = upper.map((value, index) => {
        const x = (index / Math.max(1, upper.length - 1)) * width;
        const y = height - (value / max) * (height - 14) - 7;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      const lowerPoints = lower.map((value, index) => {
        const x = (index / Math.max(1, lower.length - 1)) * width;
        const y = height - (value / max) * (height - 14) - 7;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      return {
        id: row.id,
        name: row.name,
        color: row.color,
        path: `M${upperPoints.join(" L")} L${lowerPoints.slice().reverse().join(" L")} Z`,
        line: upperPoints.join(" "),
      };
    });
  };

  const Sparkline = ({ values, color }) =>
    e(
      "svg",
      { className: "load-builder-sparkline", viewBox: "0 0 100 54", preserveAspectRatio: "none", "aria-hidden": "true" },
      e("path", { d: "M0,50 L100,50", className: "load-builder-sparkline__base" }),
      e("polyline", {
        points: pointsFromValues(toArray(values), 54, 100, 1),
        fill: "none",
        stroke: color || "currentColor",
        strokeWidth: 3,
        strokeLinecap: "round",
        vectorEffect: "non-scaling-stroke",
      })
    );

  const TooltipRows = ({ rows }) =>
    e(
      "div",
      { className: "load-builder-chart-tooltip__rows" },
      ...toArray(rows).map((row) =>
        e(
          "div",
          { key: row.id || row.name, className: "load-builder-chart-tooltip__row" },
          e("span", null, row.color ? e("i", { style: { background: row.color }, "aria-hidden": "true" }) : null, row.name || "Load"),
          e("b", null, `${formatNumber(row.value, 1)} ${row.unit || "kW"}`)
        )
      )
    );

  const ChartTooltip = ({ hover, rows }) => {
    if (!hover) return null;
    const x = Math.min(82, Math.max(18, hover.x));
    const y = Math.min(78, Math.max(12, hover.y));
    return e(
      "div",
      {
        className: "load-builder-chart-tooltip",
        style: { left: `${x}%`, top: `${y}%` },
        role: "tooltip",
      },
      e("div", { className: "load-builder-chart-tooltip__time" }, hover.time),
      e(TooltipRows, { rows })
    );
  };

  const XAxisTicks = ({ count = 96, activeIndex = null }) => {
    const tickCount = Math.max(1, Number(count) || 96);
    const active = Number.isInteger(activeIndex) ? activeIndex : null;
    return e(
      "div",
      { className: "load-builder-x-ticks", "aria-hidden": "true" },
      ...Array.from({ length: tickCount }, (_, index) =>
        e("span", {
          key: index,
          className: `load-builder-x-tick${active === index ? " is-active" : ""}`,
          style: { left: `${(index / Math.max(1, tickCount - 1)) * 100}%` },
        })
      )
    );
  };

  const YAxisLabels = ({ maxValue }) =>
    e(
      "div",
      { className: "load-builder-y-axis", "aria-hidden": "true" },
      e("span", null, formatNumber(Math.ceil(Math.max(Number(maxValue) || 1, 1)), 0)),
      e("span", null, "0")
    );

  const EditControls = ({ onDone, onCancel }) =>
    e(
      "div",
      {
        className: "load-builder-edit-controls",
        onPointerDown: (event) => event.stopPropagation(),
        onClick: (event) => event.stopPropagation(),
      },
      e("button", { className: "btn btn--primary", type: "button", onClick: onDone }, "Done"),
      e("button", { className: "btn", type: "button", onClick: onCancel }, "Cancel")
    );

  const EditPointOverlay = ({ points, selectedPointIds, maxValue, onPointerDown }) =>
    e(
      "div",
      { className: "load-builder-edit-points" },
      ...toArray(points).map((point) =>
        e("button", {
          key: point.id,
          className: `load-builder-edit-point${toArray(selectedPointIds).includes(point.id) ? " is-selected" : ""}`,
          type: "button",
          style: {
            left: `${(point.index / 95) * 100}%`,
            top: `${(valueToChartY(point.valueKw, 88, maxValue) / 88) * 100}%`,
          },
          onPointerDown: (event) => onPointerDown?.(event, point.id),
          "aria-label": `${point.id} control point`,
        })
      )
    );

  const SelectedPointValueGuide = ({ points, selectedPointIds, values, maxValue }) => {
    const selected = new Set(toArray(selectedPointIds).map((pointId) => String(pointId)));
    const selectedPoints = toArray(points).filter((point) => selected.has(String(point.id)));
    if (!selectedPoints.length) return null;
    const source = toArray(values);
    const selectedWithValues = selectedPoints.map((point) => {
      const index = Math.min(source.length - 1, Math.max(0, Math.round(Number(point.index) || 0)));
      const valueKw = Math.max(0, Number(source[index]) || 0);
      return { ...point, valueKw };
    });
    const guidePoint = selectedWithValues.reduce((maximum, point) => (point.valueKw > maximum.valueKw ? point : maximum), selectedWithValues[0]);
    const top = (valueToChartY(guidePoint.valueKw, 88, maxValue) / 88) * 100;
    return e(
      "div",
      {
        className: "load-builder-selected-value-guide",
        style: { top: `${top}%` },
        "aria-hidden": "true",
      },
      e("span", { className: "load-builder-selected-value-guide__line" }),
      e("span", { className: "load-builder-selected-value-guide__label" }, `${formatNumber(guidePoint.valueKw, 1)} kW`)
    );
  };

  const MiniArea = ({
    rowId,
    values,
    color,
    name,
    selected,
    muted,
    maxValue,
    editSession,
    onEnterEditRow,
    onCancelEditRow,
    onDoneEditRow,
    onUpdateEditPoint,
    onCancelPendingRowClick,
  }) => {
    const [clipId] = ReactRef.useState(() => `load-builder-mini-plot-clip-${Math.random().toString(36).slice(2)}`);
    const chartRef = ReactRef.useRef(null);
    const dragStateRef = ReactRef.useRef(null);
    const [hover, setHover] = ReactRef.useState(null);
    const source = muted ? toArray(values).map(() => 0) : toArray(values);
    const isEditing = Boolean(editSession?.rowId) && String(editSession.rowId) === String(rowId);
    const controlPoints = toArray(editSession?.points);
    const selectedPointIds = toArray(editSession?.selectedPointIds);
    const hoverRows = hover
      ? [
          {
            id: name || "load",
            name: name || "Load",
            color,
            value: Number(source[hover.index]) || 0,
            unit: "kW",
          },
        ]
      : [];
    const handlePointerMove = (event) => {
      const index = getChartHoverIndex(event, source.length || 96);
      setHover({
        ...getChartHoverPosition(event),
        index,
        time: formatTimeAtIndex(index),
      });
    };
    ReactRef.useEffect(() => {
      if (!isEditing) {
        dragStateRef.current = null;
        return undefined;
      }
      const handlePointerMove = (event) => {
        if (!dragStateRef.current || !chartRef.current) return;
        const rect = chartRef.current.getBoundingClientRect();
        const dragState = dragStateRef.current;
        if (dragState.type === "points") {
          const deltaIndex = Math.round(((event.clientX - dragState.startX) / Math.max(1, rect.width)) * 95);
          const startValueKw = pointValueFromClientY(dragState.startY, rect, maxValue, 88);
          const currentValueKw = pointValueFromClientY(event.clientY, rect, maxValue, 88);
          onUpdateEditPoint?.("points", {
            baseSession: dragState.baseSession,
            pointId: dragState.pointId,
            deltaIndex,
            deltaValueKw: currentValueKw - startValueKw,
          });
          return;
        }
        const shiftIntervals = Math.round(((event.clientX - dragState.startX) / Math.max(1, rect.width)) * 95);
        const verticalRatio = (dragState.startY - event.clientY) / Math.max(1, rect.height);
        onUpdateEditPoint?.("transform", {
          baseSession: dragState.baseSession,
          shiftIntervals,
          scaleFactor: Math.max(0, 1 + verticalRatio * 2),
        });
      };
      const handlePointerUp = () => {
        dragStateRef.current = null;
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };
    }, [isEditing, maxValue, onUpdateEditPoint]);
    ReactRef.useEffect(() => {
      if (!isEditing) return undefined;
      const handleKeyDown = (event) => {
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        if (!selectedPointIds.length) return;
        const targetTag = String(event.target?.tagName || "").toLowerCase();
        if (targetTag === "input" || targetTag === "textarea") return;
        event.preventDefault();
        onUpdateEditPoint?.("delete", { pointIds: selectedPointIds });
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isEditing, onUpdateEditPoint, selectedPointIds]);
    return e(
      "div",
      {
        ref: chartRef,
        className: `load-builder-mini-area${selected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}${muted ? " is-muted" : ""}`,
        onPointerMove: isEditing ? undefined : handlePointerMove,
        onPointerLeave: isEditing ? undefined : () => setHover(null),
        onDoubleClick: (event) => {
          onCancelPendingRowClick?.();
          if (!isEditing) {
            onEnterEditRow?.(rowId);
            return;
          }
          if (event.target?.closest?.(".load-builder-edit-point") || event.target?.closest?.(".load-builder-edit-controls")) return;
          const rect = chartRef.current?.getBoundingClientRect();
          if (!rect) return;
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
          onUpdateEditPoint?.("add", {
            index: Math.round(ratio * 95),
            valueKw: pointValueFromClientY(event.clientY, rect, maxValue, 88),
          });
        },
        onPointerDown: isEditing
          ? (event) => {
              if (event.target?.closest?.(".load-builder-edit-point") || event.target?.closest?.(".load-builder-edit-controls")) return;
              event.preventDefault();
              dragStateRef.current = {
                type: "transform",
                startX: event.clientX,
                startY: event.clientY,
                baseSession: editSession,
              };
            }
          : undefined,
      },
      e("div", { className: "load-builder-grid", "aria-hidden": "true" }),
      e(
        "svg",
        { viewBox: "0 0 100 88", preserveAspectRatio: "none", className: "load-builder-chart-svg", "aria-hidden": "true" },
        e(
          "defs",
          null,
          e("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" }, e("rect", { x: 0, y: 0, width: 100, height: zeroY(88) }))
        ),
        e(
          "g",
          { clipPath: `url(#${clipId})` },
          e("path", { d: areaPath(values, 88, 100, maxValue), fill: color || "currentColor", opacity: "0.22" }),
          e("polyline", {
            points: pointsFromValues(values, 88, 100, maxValue),
            fill: "none",
            stroke: color || "currentColor",
            strokeWidth: "1.8",
            vectorEffect: "non-scaling-stroke",
          })
        ),
        e("line", { className: "load-builder-zero-line", x1: 0, x2: 100, y1: zeroY(88), y2: zeroY(88), vectorEffect: "non-scaling-stroke" }),
      ),
      isEditing
        ? e(EditPointOverlay, {
            points: controlPoints,
            selectedPointIds,
            maxValue,
            onPointerDown: (event, pointId) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.shiftKey) {
                const nextSession = window.EnergyLoadBuilder?.toggleEditPointSelection
                  ? window.EnergyLoadBuilder.toggleEditPointSelection(editSession, pointId)
                  : editSession;
                onUpdateEditPoint?.("session", { session: nextSession });
                dragStateRef.current = null;
                return;
              }
              const preserveSelection = selectedPointIds.includes(pointId);
              const baseSession = preserveSelection
                ? editSession
                : window.EnergyLoadBuilder?.setSelectedEditPoints
                  ? window.EnergyLoadBuilder.setSelectedEditPoints(editSession, [pointId])
                  : editSession;
              onUpdateEditPoint?.("session", { session: baseSession });
              dragStateRef.current = {
                type: "points",
                pointId,
                startX: event.clientX,
                startY: event.clientY,
                baseSession,
              };
            },
          })
        : null,
      isEditing ? e(SelectedPointValueGuide, { points: controlPoints, selectedPointIds, values: editSession?.draftValues || source, maxValue }) : null,
      selected ? e(XAxisTicks, { count: source.length || 96, activeIndex: hover?.index ?? null }) : null,
      !isEditing ? e(ChartTooltip, { hover, rows: hoverRows }) : null,
      isEditing
        ? e(EditControls, {
            onDone: () => {
              onCancelPendingRowClick?.();
              onDoneEditRow?.();
            },
            onCancel: () => {
              onCancelPendingRowClick?.();
              onCancelEditRow?.();
            },
          })
        : null,
      e(YAxisLabels, { maxValue })
    );
  };

  const StackedArea = ({ rows, showTooltip = false, showYAxis = false, showXTicks = false }) => {
    const activeRows = toArray(rows).filter((row) => !row?.muted);
    const layers = calculateStackedPaths(activeRows);
    const [hover, setHover] = ReactRef.useState(null);
    const valueCount = Math.max(...activeRows.map((row) => toArray(row.values).length), 96);
    const axisMax = Math.max(
      ...Array.from({ length: valueCount }, (_, index) =>
        activeRows.reduce((sum, row) => sum + (Number(row?.values?.[index]) || 0), 0)
      ),
      1
    );
    const hoverRows = showTooltip && hover
      ? [
          {
            id: "total",
            name: "Total",
            value: activeRows.reduce((sum, row) => sum + (Number(row?.values?.[hover.index]) || 0), 0),
            unit: "kW",
          },
          ...activeRows.map((row) => ({
            id: row.id,
            name: row.name || "Load",
            color: row.color,
            value: Number(row?.values?.[hover.index]) || 0,
            unit: "kW",
          })),
        ]
      : [];
    const handlePointerMove = (event) => {
      if (!showTooltip) return;
      const index = getChartHoverIndex(event, valueCount);
      setHover({
        ...getChartHoverPosition(event),
        index,
        time: formatTimeAtIndex(index),
      });
    };
    return e(
      "div",
      {
        className: "load-builder-stacked-area",
        onPointerMove: showTooltip ? handlePointerMove : undefined,
        onPointerLeave: showTooltip ? () => setHover(null) : undefined,
      },
      e("div", { className: "load-builder-grid", "aria-hidden": "true" }),
      e(
        "svg",
        { viewBox: "0 0 100 88", preserveAspectRatio: "none", className: "load-builder-chart-svg", "aria-hidden": "true" },
        ...layers.map((layer) => e("path", { key: layer.id, d: layer.path, fill: layer.color, opacity: "0.48" })),
        ...layers.map((layer) =>
          e("polyline", {
            key: `${layer.id}-line`,
            points: layer.line,
            fill: "none",
            stroke: layer.color,
            strokeWidth: "1.4",
            vectorEffect: "non-scaling-stroke",
          })
        )
      ),
      showYAxis ? e(YAxisLabels, { maxValue: axisMax }) : null,
      showXTicks ? e(XAxisTicks, { count: valueCount, activeIndex: hover?.index ?? null }) : null,
      showTooltip ? e(ChartTooltip, { hover, rows: hoverRows }) : null
    );
  };

  const ChartAxis = () =>
    e(
      "div",
      { className: "load-builder-axis", "aria-hidden": "true" },
      ...HOURS.filter((hour) => hour % 4 === 0).map((hour, index, labels) =>
        e(
          "span",
          {
            key: hour,
            className: `${index === 0 ? "is-first" : ""}${index === labels.length - 1 ? " is-last" : ""}`.trim(),
            style: { left: `${(hour / 24) * 100}%` },
          },
          `${String(hour).padStart(2, "0")}:00`
        )
      )
    );

  const DropZone = ({ index, disabled, active, onDrop }) =>
    e("div", {
      className: `load-builder-drop-zone${disabled ? " is-disabled" : ""}${active ? " is-active" : ""}`,
      onDragOver: (event) => {
        if (disabled) return;
        event.preventDefault();
      },
      onDrop: (event) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        const templateId = event.dataTransfer.getData("application/x-load-template");
        const rowId = event.dataTransfer.getData("application/x-load-row");
        onDrop?.({ templateId, rowId, index });
      },
    });

  const LibraryPanel = ({ templates, canEdit, onDropTemplate, onOpenAiGen }) => {
    const [query, setQuery] = ReactRef.useState("");
    const [category, setCategory] = ReactRef.useState("All");
    const categories = ["All", "Residential", "Commercial", "Industrial"];
    const filteredTemplates = toArray(templates).filter((template) => {
      const matchesCategory = category === "All" || template.category === category;
      const text = `${template.name} ${template.category}`.toLowerCase();
      return matchesCategory && text.includes(query.trim().toLowerCase());
    });

    return e(
      "section",
      { className: "load-builder-library" },
      e(
        "div",
        { className: "load-builder-panel-header" },
        e("h3", null, "Library"),
        e("button", { className: "btn", type: "button", disabled: !canEdit, onClick: onOpenAiGen }, "AI Gen")
      ),
      e("input", {
        className: "load-builder-search",
        type: "search",
        value: query,
        placeholder: "Search normalized previews...",
        onChange: (event) => setQuery(event.target.value),
      }),
      e(
        "div",
        { className: "load-builder-chips", role: "group", "aria-label": "Filter load templates" },
        ...categories.map((chip) =>
          e(
            "button",
            {
              key: chip,
              className: `load-builder-chip${chip === category ? " is-active" : ""}`,
              type: "button",
              onClick: () => setCategory(chip),
            },
            chip
          )
        )
      ),
      e(
        "div",
        { className: "load-builder-template-list" },
        ...filteredTemplates.map((template) =>
          e(
            "article",
            {
              key: template.id,
              className: `load-builder-template${canEdit ? "" : " is-disabled"}`,
              draggable: Boolean(canEdit),
              onDragStart: (event) => {
                event.dataTransfer.setData("application/x-load-template", template.id);
                event.dataTransfer.effectAllowed = "copy";
              },
            },
            e("span", { className: "load-builder-grip", "aria-hidden": "true" }, "⋮⋮"),
            e(
              "div",
              { className: "load-builder-template__text" },
              e("h4", null, template.name),
              e("span", null, template.category)
            ),
            e("div", { className: "load-builder-template__spark" }, e(Sparkline, { values: template.normalizedValues, color: template.color }))
          )
        )
      )
    );
  };

  const Icon = ({ name }) => {
    const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
    const children =
      name === "edit"
        ? [
            e("path", { key: "body", ...common, d: "M12.5 3.5 16.5 7.5 7.5 16.5 3.5 17.5 4.5 13.5Z" }),
            e("path", { key: "tip", ...common, d: "M11 5 15 9" }),
          ]
        : name === "copy"
          ? [
              e("rect", { key: "back", ...common, x: 6, y: 3, width: 10, height: 10, rx: 1.5 }),
              e("rect", { key: "front", ...common, x: 3, y: 7, width: 10, height: 10, rx: 1.5 }),
            ]
          : name === "eye"
            ? [
                e("path", { key: "outline", ...common, d: "M2.5 10S5.3 5.5 10 5.5 17.5 10 17.5 10 14.7 14.5 10 14.5 2.5 10 2.5 10Z" }),
                e("circle", { key: "pupil", ...common, cx: 10, cy: 10, r: 2.2 }),
              ]
            : name === "eye-off"
              ? [
                  e("path", { key: "slash", ...common, d: "M3.5 3.5 16.5 16.5" }),
                  e("path", { key: "outline", ...common, d: "M2.5 10S5.3 5.5 10 5.5c1.1 0 2.1.25 3 .65M17.5 10s-2.8 4.5-7.5 4.5c-1.1 0-2.1-.24-3-.65" }),
                ]
              : [
              e("path", { key: "lid", ...common, d: "M3.5 5.5H16.5" }),
              e("path", { key: "can", ...common, d: "M6 5.5 6.8 17H13.2L14 5.5" }),
              e("path", { key: "handle", ...common, d: "M8 5.5 8.5 3.5H11.5L12 5.5" }),
              e("path", { key: "left", ...common, d: "M9 8.5V14" }),
              e("path", { key: "right", ...common, d: "M11 8.5V14" }),
              ];
    return e("svg", { className: "load-builder-row-action-icon", viewBox: "0 0 20 20", "aria-hidden": "true" }, ...children);
  };

  const RowActionButton = ({ label, icon, disabled, onClick }) =>
    e(
      "button",
      {
        className: "load-builder-row-action",
        type: "button",
        disabled,
        title: label,
        "aria-label": label,
        onPointerDown: (event) => event.stopPropagation(),
        onClick: (event) => {
          event.stopPropagation();
          onClick?.();
        },
      },
      e(Icon, { name: icon })
    );

  const RowActions = ({ row, isEditingAnyRow, onEnterEditRow, onDuplicateRow, onDeleteRow, onToggleRowMuted }) =>
    e(
      "div",
      { className: "load-builder-row-actions", "aria-label": `${row.name || "Layer"} actions` },
      e(RowActionButton, {
        label: row.muted ? "Show layer" : "Hide layer",
        icon: row.muted ? "eye-off" : "eye",
        disabled: isEditingAnyRow,
        onClick: () => onToggleRowMuted?.(row.id),
      }),
      e(RowActionButton, {
        label: "Edit layer",
        icon: "edit",
        disabled: row.locked || isEditingAnyRow,
        onClick: () => onEnterEditRow?.(row.id),
      }),
      e(RowActionButton, {
        label: "Copy layer",
        icon: "copy",
        disabled: row.locked || isEditingAnyRow,
        onClick: () => onDuplicateRow?.(row.id),
      }),
      e(RowActionButton, {
        label: "Delete layer",
        icon: "delete",
        disabled: row.locked || isEditingAnyRow,
        onClick: () => onDeleteRow?.(row.id),
      })
    );

  const RowHeader = ({ row, isEditingAnyRow, onRenameRow, onEnterEditRow, onDuplicateRow, onDeleteRow, onToggleRowMuted }) => {
    const [renaming, setRenaming] = ReactRef.useState(false);
    const [draftName, setDraftName] = ReactRef.useState(row.name || "Load");
    const inputRef = ReactRef.useRef(null);

    ReactRef.useEffect(() => {
      if (!renaming) setDraftName(row.name || "Load");
    }, [renaming, row.name]);

    ReactRef.useEffect(() => {
      if (!renaming) return undefined;
      inputRef.current?.focus();
      inputRef.current?.select();
      return undefined;
    }, [renaming]);

    const startRename = () => {
      if (row.locked || isEditingAnyRow) return;
      setDraftName(row.name || "Load");
      setRenaming(true);
    };

    const cancelRename = () => {
      setDraftName(row.name || "Load");
      setRenaming(false);
    };

    const commitRename = () => {
      const trimmedName = draftName.trim();
      if (trimmedName && trimmedName !== row.name) onRenameRow?.(row.id, trimmedName);
      setDraftName(trimmedName || row.name || "Load");
      setRenaming(false);
    };

    return e(
      "div",
      { className: "load-builder-row-info" },
      e("span", { className: "load-builder-grip", "aria-hidden": "true" }, "⋮⋮"),
      e(
        "div",
        { className: "load-builder-row-info__body" },
        e(
          "div",
          { className: "load-builder-row-title" },
          e("i", { style: { background: row.color || "currentColor" }, "aria-hidden": "true" }),
          renaming
            ? e("input", {
                ref: inputRef,
                className: "load-builder-row-name-input",
                value: draftName,
                maxLength: 80,
                "aria-label": "Layer name",
                onClick: (event) => event.stopPropagation(),
                onPointerDown: (event) => event.stopPropagation(),
                onChange: (event) => setDraftName(event.target.value),
                onBlur: commitRename,
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                },
              })
            : e(
                "button",
                {
                  className: "load-builder-row-name",
                  type: "button",
                  disabled: row.locked || isEditingAnyRow,
                  title: "Rename layer",
                  onClick: (event) => {
                    event.stopPropagation();
                    startRename();
                  },
                  onDoubleClick: (event) => event.stopPropagation(),
                },
                row.name || "Load"
          )
        ),
        e("span", { className: "load-builder-row-group" }, row.group || row.category || "Load"),
        row.selected
          ? e(
              "div",
              { className: "load-builder-row-metrics" },
              e("span", null, "Peak"),
              e("b", null, `${formatNumber(row.peak, 0)} kW`),
              e("span", null, "Total"),
              e("b", null, `${formatNumber(row.kwh, 0)} kWh`)
            )
          : null,
        row.selected
          ? e(
              ReactRef.Fragment,
              null,
              row.aiReason
                ? e(
                    "button",
                    {
                      className: "load-builder-row-action load-builder-row-info-action",
                      type: "button",
                      title: row.aiReason,
                      "aria-label": "AI reason",
                      onPointerDown: (event) => event.stopPropagation(),
                      onClick: (event) => event.stopPropagation(),
                    },
                    "i"
                  )
                : null,
              e(RowActions, {
                row,
                isEditingAnyRow,
                onEnterEditRow,
                onDuplicateRow,
                onDeleteRow,
                onToggleRowMuted,
              })
            )
          : null
      )
    );
  };

  const LoadRows = (props) => {
    const rows = toArray(props.model?.rows);
    const [activeDropIndex, setActiveDropIndex] = ReactRef.useState(null);
    const rowClickTimerRef = ReactRef.useRef(null);
    const axisMax = window.EnergyLoadBuilder?.getIndividualAxisMax ? window.EnergyLoadBuilder.getIndividualAxisMax(rows) : 1;
    const isEditingAnyRow = Boolean(props.editSession?.rowId);
    const cancelPendingRowClick = () => {
      if (!rowClickTimerRef.current) return;
      window.clearTimeout(rowClickTimerRef.current);
      rowClickTimerRef.current = null;
    };
    ReactRef.useEffect(() => () => cancelPendingRowClick(), []);
    const getDropIndex = (event) => {
      const rowRects = Array.from(event.currentTarget.querySelectorAll(".load-builder-row")).map((row) => {
        const rect = row.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      });
      return window.EnergyLoadBuilder?.getInsertionIndexFromPoint
        ? window.EnergyLoadBuilder.getInsertionIndexFromPoint(rowRects, event.clientY)
        : rows.length;
    };
    const getDropPayload = (event, index) => ({
      templateId: event.dataTransfer.getData("application/x-load-template"),
      rowId: event.dataTransfer.getData("application/x-load-row"),
      index,
    });
    const handleDrop = ({ templateId, rowId, index }) => {
      if (templateId) props.onDropTemplate?.(templateId, index);
      if (rowId) props.onReorderRow?.(rowId, index);
    };
    const handleListDragOver = (event) => {
      if (!props.canEdit || isEditingAnyRow) return;
      event.preventDefault();
      const types = Array.from(event.dataTransfer?.types || []);
      event.dataTransfer.dropEffect = types.includes("application/x-load-row") ? "move" : "copy";
      setActiveDropIndex(getDropIndex(event));
    };
    const handleListDrop = (event) => {
      if (!props.canEdit || isEditingAnyRow) return;
      event.preventDefault();
      const index = getDropIndex(event);
      setActiveDropIndex(null);
      handleDrop(getDropPayload(event, index));
    };
    const handleListDragLeave = (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setActiveDropIndex(null);
    };
    const handleRowClick = (row) => {
      cancelPendingRowClick();
      if (!row?.selected) {
        props.onSelectRow?.(row.id);
        return;
      }
      rowClickTimerRef.current = window.setTimeout(() => {
        rowClickTimerRef.current = null;
        props.onSelectRow?.(null);
      }, 200);
    };

    if (!props.canEdit && !isEditingAnyRow) {
      return e(
        "div",
        { className: "load-builder-empty" },
        e("h4", null, "Create a load profile to start"),
        e("p", null, "Use New Profile, then drag Library templates into this workspace.")
      );
    }

    if (!rows.length) {
      return e(
        "div",
        {
          className: "load-builder-row-list",
          onDragOver: handleListDragOver,
          onDragLeave: handleListDragLeave,
          onDrop: handleListDrop,
        },
        e(DropZone, { index: 0, active: activeDropIndex === 0, onDrop: handleDrop }),
        e(
          "div",
          {
            className: "load-builder-empty load-builder-empty--drop",
          },
          e("h4", null, "Drop load here"),
          e("p", null, "Build the profile by layering templates from the Library.")
        )
      );
    }

    return e(
      "div",
      {
        className: `load-builder-row-list${activeDropIndex !== null ? " is-dragging-over" : ""}`,
        onDragOver: handleListDragOver,
        onDragLeave: handleListDragLeave,
        onDrop: handleListDrop,
      },
      ...rows.flatMap((row, index) => [
        e(DropZone, { key: `drop-${index}`, index, active: activeDropIndex === index, onDrop: handleDrop }),
        e(
          "article",
          {
            key: row.id,
            className: `load-builder-row${row.selected ? " is-selected" : ""}${row.muted ? " is-muted" : ""}`,
            style: { gridTemplateColumns: `${INFO_PANEL_WIDTH}px minmax(0, 1fr)` },
            draggable: !isEditingAnyRow,
            onDragStart: (event) => {
              event.dataTransfer.setData("application/x-load-row", row.id);
              event.dataTransfer.effectAllowed = "move";
            },
            onClick: () => handleRowClick(row),
          },
          e(RowHeader, {
            row,
            isEditingAnyRow,
            isEditing: String(props.editSession?.rowId || "") === String(row.id),
            onEnterEditRow: props.onEnterEditRow,
            onDuplicateRow: props.onDuplicateRow,
            onDeleteRow: props.onDeleteRow,
            onToggleRowMuted: props.onToggleRowMuted,
            onRenameRow: props.onRenameRow,
          }),
          e(
            "div",
            { className: `load-builder-row-chart${row.selected ? " is-selected" : ""}` },
            e(MiniArea, {
              rowId: row.id,
              values: row.values,
              color: row.color,
              name: row.name,
              selected: row.selected,
              muted: row.muted,
              maxValue: axisMax,
              editSession: props.editSession,
              onEnterEditRow: props.onEnterEditRow,
              onCancelEditRow: props.onCancelEditRow,
              onDoneEditRow: props.onDoneEditRow,
              onUpdateEditPoint: props.onUpdateEditPoint,
              onCancelPendingRowClick: cancelPendingRowClick,
            }),
            row.selected ? e(ChartAxis) : null
          )
        ),
      ]),
      e(DropZone, { key: "drop-end", index: rows.length, active: activeDropIndex === rows.length, onDrop: handleDrop }),
    );
  };

  const ASSISTANT_MAX_UNCERTAINTY_SCORE = 360;
  const getAssistantProgress = ({ description, facts, assistantResponse, interviewState }) => {
    if (assistantResponse?.mode === "generate_profile" || interviewState?.recommendedStop) return 100;
    if (!String(description || "").trim() && !Object.keys(facts || {}).length) return 0;
    const progress = Number(interviewState?.progressPercent);
    if (Number.isFinite(progress) && progress > 0) return Math.round(Math.min(98, Math.max(0, progress)));
    const remaining = Number(interviewState?.remainingUncertaintyScore);
    if (!Number.isFinite(remaining)) return 8;
    return Math.round(Math.min(98, Math.max(8, (1 - remaining / ASSISTANT_MAX_UNCERTAINTY_SCORE) * 100)));
  };
  const ASSISTANT_FACILITY_TYPES = Object.freeze([
    { id: "residential", label: "Residential", disabled: false },
    { id: "commercial", label: "Commercial", disabled: true },
    { id: "industrial", label: "Industrial", disabled: true },
  ]);
  const ASSISTANT_MAJOR_LOAD_OPTIONS = Object.freeze([
    { id: "hvac", label: "Heat pump or AC", value: { hvacPresence: true } },
    { id: "ev", label: "Electric vehicle charging", value: { hasEv: true } },
    { id: "pool_spa", label: "Pool or hot tub", value: { hasPoolOrHotTub: true } },
    { id: "electric_oven", label: "Electric oven", value: { electricCooking: true } },
    { id: "electric_dryer", label: "Clothes dryer", value: { dryerType: "electric" } },
    {
      id: "none_of_these",
      label: "None of these",
      value: {
        hvacPresence: false,
        hasEv: false,
        hasPoolOrHotTub: false,
        hasPoolPump: false,
        hasHotTubSpa: false,
        electricCooking: false,
        dryerType: "non_electric_or_none",
      },
    },
  ]);
  const mergeAssistantFacts = (...sources) =>
    sources.reduce((merged, source) => {
      Object.entries(source || {}).forEach(([key, value]) => {
        if (value != null && value !== "") merged[key] = value;
      });
      return merged;
    }, {});

  const InlineEditableText = ({ value, placeholder, className, editing, multiline = false, onEdit, onChange, onBlur }) => {
    const displayValue = String(value || "").trim();
    if (!editing && displayValue) {
      return e(
        "button",
        {
          className,
          type: "button",
          onClick: onEdit,
        },
        displayValue
      );
    }
    const sharedProps = {
      value,
      placeholder,
      onChange,
      onBlur,
    };
    return multiline ? e("textarea", { ...sharedProps, rows: 3 }) : e("input", { ...sharedProps, autoFocus: true });
  };

  const NewProfileModal = ({ open, onClose, onCreateProfile, onAssistantTurn, assistantOnly = false, initialName = "", actionLabel = "Create profile" }) => {
    const [name, setName] = ReactRef.useState(initialName || "");
    const [description, setDescription] = ReactRef.useState("");
    const [facilityType, setFacilityType] = ReactRef.useState("residential");
    const [majorLoadChecklist, setMajorLoadChecklist] = ReactRef.useState([]);
    const [showAssistant, setShowAssistant] = ReactRef.useState(Boolean(assistantOnly));
    const [editingName, setEditingName] = ReactRef.useState(true);
    const [editingDescription, setEditingDescription] = ReactRef.useState(true);
    const [answers, setAnswers] = ReactRef.useState([]);
    const [facts, setFacts] = ReactRef.useState({});
    const [interviewState, setInterviewState] = ReactRef.useState({});
    const [assistantResponse, setAssistantResponse] = ReactRef.useState(null);
    const [proposalLoads, setProposalLoads] = ReactRef.useState([]);
    const [history, setHistory] = ReactRef.useState([]);
    const [pendingAnswerText, setPendingAnswerText] = ReactRef.useState("");
    const [selectedQuestionOptions, setSelectedQuestionOptions] = ReactRef.useState([]);
    const [questionCustomSelected, setQuestionCustomSelected] = ReactRef.useState(false);
    const [questionCustomText, setQuestionCustomText] = ReactRef.useState("");
    const [loading, setLoading] = ReactRef.useState(false);
    const [error, setError] = ReactRef.useState("");
    ReactRef.useEffect(() => {
      if (!open) return;
      setName(initialName || (assistantOnly ? "" : "Load Profile Name"));
      setDescription("");
      setFacilityType("residential");
      setMajorLoadChecklist([]);
      setShowAssistant(Boolean(assistantOnly));
      setEditingName(true);
      setEditingDescription(true);
      setAnswers([]);
      setFacts({});
      setInterviewState({});
      setAssistantResponse(null);
      setProposalLoads([]);
      setHistory([]);
      setPendingAnswerText("");
      setSelectedQuestionOptions([]);
      setQuestionCustomSelected(false);
      setQuestionCustomText("");
      setLoading(false);
      setError("");
    }, [open, initialName]);
    if (!open) return null;
    const trimmed = name.trim();
    const isReview = assistantResponse?.mode === "generate_profile";
    const isQuestion = assistantResponse?.mode === "ask_followup";
    const hasStartedAssistant = showAssistant && (Boolean(assistantResponse) || loading || answers.length > 0 || history.length > 0);
    const assistantProgressValue = getAssistantProgress({ description, facts, assistantResponse, interviewState });
    const modalTitle = hasStartedAssistant ? trimmed || assistantResponse?.profileName || initialName || "Load Profile Name" : assistantOnly ? "Generate with AI" : "New Load Profile";
    const buildReviewSummary = () => {
      const facts = assistantResponse?.facts || {};
      const loads = proposalLoads.map((load) => load.name || load.templateId).filter(Boolean);
      const descriptors = [
        facts.squareFeet ? `${formatNumber(facts.squareFeet, 0)} sq ft` : "",
        facts.occupancy === "work_from_home" ? "work-from-home" : "",
        facts.evCount ? `${formatNumber(facts.evCount, 0)} EV` : "",
        facts.waterHeating ? `${String(facts.waterHeating).replace(/_/g, " ")} water heating` : "",
        facts.hvacType ? `${String(facts.hvacType).replace(/_/g, " ")} HVAC` : "",
      ].filter(Boolean);
      const loadText = loads.slice(0, 4).join(", ");
      return `Thank you for your responses, based on your answers you have a ${descriptors.join(", ") || "residential"} profile with ${loadText || "typical residential loads"}.`;
    };
    const buildSnapshot = () => ({
      answers,
      facts,
      interviewState,
      assistantResponse,
      proposalLoads,
      description,
      facilityType,
      majorLoadChecklist,
    });
    const buildInitialIntakeFacts = () => {
      const checklistDefaults = {
        hvacPresence: false,
        hasEv: false,
        hasPoolOrHotTub: false,
        hasPoolPump: false,
        hasHotTubSpa: false,
        electricCooking: false,
        dryerType: "non_electric_or_none",
      };
      const checklistFacts = majorLoadChecklist.reduce((merged, optionId) => {
        const option = ASSISTANT_MAJOR_LOAD_OPTIONS.find((item) => item.id === optionId);
        return mergeAssistantFacts(merged, option?.value);
      }, checklistDefaults);
      return mergeAssistantFacts({ projectType: facilityType || "residential" }, checklistFacts);
    };
    const resetQuestionInputs = () => {
      setSelectedQuestionOptions([]);
      setQuestionCustomSelected(false);
      setQuestionCustomText("");
    };
    const runAssistant = async ({ forceGenerate = false, answer = null } = {}) => {
      if (!onAssistantTurn || loading) return;
      const nextAnswers = answer ? [...answers, answer] : answers;
      const requestFacts = mergeAssistantFacts(buildInitialIntakeFacts(), facts);
      setHistory((items) => [...items, buildSnapshot()]);
      setAnswers(nextAnswers);
      setLoading(true);
      setError("");
      try {
        const response = await onAssistantTurn({
          profileName: trimmed || initialName || "Load Profile Name",
          description,
          facts: requestFacts,
          answers: nextAnswers,
          interviewState,
          forceGenerate,
        });
        setAssistantResponse(response);
        setFacts(mergeAssistantFacts(requestFacts, answer?.value, response?.facts, response?.interviewState?.facts));
        setInterviewState(response?.interviewState || {});
        setProposalLoads(toArray(response?.loads));
        resetQuestionInputs();
        if (response?.profileName && !trimmed) setName(response.profileName);
      } catch (requestError) {
        setError(requestError?.message || "Unable to generate profile.");
      } finally {
        setLoading(false);
      }
    };
    const goBack = () => {
      const previous = history[history.length - 1];
      if (!previous) return;
      setHistory((items) => items.slice(0, -1));
      setAnswers(previous.answers || []);
      setFacts(previous.facts || {});
      setInterviewState(previous.interviewState || {});
      setAssistantResponse(previous.assistantResponse || null);
      setProposalLoads(previous.proposalLoads || []);
      setDescription(previous.description || "");
      setFacilityType(previous.facilityType || "residential");
      setMajorLoadChecklist(previous.majorLoadChecklist || []);
      setPendingAnswerText("");
      resetQuestionInputs();
      setError("");
    };
    const submitOption = (option) => {
      setPendingAnswerText(option.label || option.id || "selected answer");
      runAssistant({
        answer: {
          questionId: assistantResponse?.question?.id,
          optionId: option.id,
          value: option.value || {},
        },
      });
    };
    const submitCustom = () => {
      const customText = String(questionCustomText || "").trim();
      if (!customText) return;
      setPendingAnswerText(customText);
      runAssistant({
        answer: {
          questionId: assistantResponse?.question?.id,
          customText,
        },
      });
      setQuestionCustomText("");
    };
    const toggleMajorLoad = (optionId) => {
      setMajorLoadChecklist((items) => {
        if (optionId === "none_of_these") return items.includes(optionId) ? [] : ["none_of_these"];
        const withoutNone = items.filter((item) => item !== "none_of_these");
        return withoutNone.includes(optionId) ? withoutNone.filter((item) => item !== optionId) : [...withoutNone, optionId];
      });
    };
    const toggleQuestionOption = (optionId) => {
      setSelectedQuestionOptions((items) => {
        if (optionId === "none_of_these") return items.includes(optionId) ? [] : ["none_of_these"];
        const withoutNone = items.filter((item) => item !== "none_of_these");
        return withoutNone.includes(optionId) ? withoutNone.filter((item) => item !== optionId) : [...withoutNone, optionId];
      });
    };
    const submitMultipleOptions = () => {
      const options = toArray(assistantResponse?.question?.options);
      const selectedOptions = options.filter((option) => selectedQuestionOptions.includes(option.id));
      const customText = questionCustomSelected ? String(questionCustomText || "").trim() : "";
      const allowEmptySelection = ["major_load_screen", "medium_load_screen"].includes(assistantResponse?.question?.id);
      if (!selectedOptions.length && !customText && !allowEmptySelection) return;
      const value = selectedOptions.reduce((merged, option) => mergeAssistantFacts(merged, option.value), {});
      const selectedText = [
        ...selectedOptions.map((option) => option.label || option.id).filter(Boolean),
        customText ? `Other: ${customText}` : "",
      ].filter(Boolean);
      if (assistantResponse?.question?.id === "major_load_screen") value.majorLoadScreenComplete = true;
      if (assistantResponse?.question?.id === "medium_load_screen") value.mediumLoadScreenComplete = true;
      setPendingAnswerText(selectedText.join(", ") || "None selected");
      runAssistant({
        answer: {
          questionId: assistantResponse?.question?.id,
          optionId: selectedOptions.map((option) => option.id).join(","),
          selectedOptionIds: selectedOptions.map((option) => option.id),
          customText,
          value,
        },
      });
    };
    const skipToReview = () => {
      setPendingAnswerText("skip");
      runAssistant({ forceGenerate: true });
    };
    const createFromProposal = () => {
      if (!isReview) return;
      onCreateProfile?.(trimmed || assistantResponse.profileName || "Load Profile Name", {
        ...assistantResponse,
        profileName: trimmed || assistantResponse.profileName,
        loads: proposalLoads,
      });
      onClose();
    };
    return e(
      "div",
      { className: "load-builder-modal-backdrop", role: "presentation" },
      e(
        "section",
        { className: "load-builder-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "load-builder-new-profile-title" },
        e(
          "div",
          { className: "load-builder-modal__header" },
          e("h3", { id: "load-builder-new-profile-title" }, modalTitle),
          hasStartedAssistant
            ? e(
                "div",
                {
                  className: "load-builder-ai-progress load-builder-ai-progress--header",
                  role: "progressbar",
                  "aria-valuemin": 0,
                  "aria-valuemax": 100,
                  "aria-valuenow": assistantProgressValue,
                },
                e("span", { style: { width: `${assistantProgressValue}%` } })
              )
            : null,
          e("button", { className: "btn load-builder-modal__close", type: "button", onClick: onClose }, "Cancel")
        ),
        !hasStartedAssistant ? e("label", null, "Profile name") : null,
        !hasStartedAssistant
          ? e(InlineEditableText, {
              value: name,
              placeholder: "Load Profile Name",
              className: "load-builder-modal-editable-text load-builder-modal-editable-text--title",
              editing: editingName,
              onEdit: () => setEditingName(true),
              onChange: (event) => setName(event.target.value),
              onBlur: () => {
                if (String(name || "").trim()) setEditingName(false);
              },
            })
          : null,
        !assistantOnly && !showAssistant
          ? e(
              "div",
              { className: "load-builder-modal__actions load-builder-modal__actions--inline load-builder-modal__choice-actions" },
              e(
                "button",
                {
                  className: "btn",
                  type: "button",
                  disabled: loading,
                  onClick: () => setShowAssistant(true),
                },
                "AI Generated"
              ),
              e("span", { className: "load-builder-modal__choice-separator" }, "or"),
              e(
                "button",
                {
                  className: "btn",
                  type: "button",
                  disabled: !trimmed || loading,
                  onClick: () => {
                    onCreateProfile?.(trimmed);
                    onClose();
                  },
                },
                "Custom"
              ),
            )
          : null,
        showAssistant
          ? e(
              "div",
              { className: "load-builder-ai-panel" },
              !assistantResponse && !loading
                ? e(
                    "div",
                    { className: "load-builder-ai-intake-controls" },
                    e(
                      "div",
                      { className: "load-builder-ai-facility-toggle", role: "radiogroup", "aria-label": "Facility type" },
                      ...ASSISTANT_FACILITY_TYPES.map((type) =>
                        e(
                          "button",
                          {
                            key: type.id,
                            className: `btn load-builder-ai-facility-option${facilityType === type.id ? " is-selected" : ""}`,
                            type: "button",
                            role: "radio",
                            "aria-checked": facilityType === type.id,
                            disabled: type.disabled || loading,
                            onClick: () => setFacilityType(type.id),
                          },
                          type.label
                        )
                      )
                    ),
                    e(
                      "fieldset",
                      { className: "load-builder-ai-checklist" },
                      e("legend", null, "Check to confirm if your facility has any of the following:"),
                      ...ASSISTANT_MAJOR_LOAD_OPTIONS.map((option) =>
                        e(
                          "label",
                          { key: option.id, className: "load-builder-ai-checklist-option" },
                          e("input", {
                            type: "checkbox",
                            checked: majorLoadChecklist.includes(option.id),
                            disabled: loading,
                            onChange: () => toggleMajorLoad(option.id),
                          }),
                          e("span", null, option.label)
                        )
                      )
                    ),
                    e("label", null, "Please describe any nuances about your daily electricity use"),
                    e(InlineEditableText, {
                      value: description,
                      multiline: true,
                      editing: editingDescription,
                      className: "load-builder-modal-editable-text load-builder-modal-editable-text--description",
                      placeholder: "Example: EV charging is usually overnight, someone works from home most weekdays, or laundry usually runs in the evening.",
                      onEdit: () => setEditingDescription(true),
                      onChange: (event) => setDescription(event.target.value),
                      onBlur: () => {},
                    })
                  )
                : null,
              !assistantResponse
                ? e(
                    "button",
                    {
                      className: "btn btn--primary",
                      type: "button",
                      disabled: loading,
                      onClick: () => runAssistant(),
                    },
                    loading ? "Thinking..." : "Start"
                  )
                : null,
              isQuestion
                ? e(
                    "div",
                    { className: "load-builder-ai-question" },
                    e("h4", null, sentenceCase(assistantResponse.question.text)),
                    assistantResponse.question.why ? e("p", { className: "load-builder-muted" }, sentenceCase(assistantResponse.question.why)) : null,
                    loading
                      ? e(
                          "div",
                          { className: "load-builder-ai-pending" },
                          e("span", null, sentenceCase(pendingAnswerText || "Answer received")),
                          e(
                            "p",
                            { className: "load-builder-ai-loading-text" },
                            "Working on the next step",
                            e("span", { className: "load-builder-ai-loading-dots", "aria-hidden": "true" }, e("i"), e("i"), e("i"))
                          )
                        )
                      : assistantResponse.question.selectionType === "multiple"
                        ? e(
                            "div",
                            { className: "load-builder-ai-options load-builder-ai-options--multiple" },
                            ...toArray(assistantResponse.question.options).map((option) =>
                              e(
                                "label",
                                { key: option.id, className: "load-builder-ai-option load-builder-ai-option--checkbox" },
                                e("input", {
                                  type: "checkbox",
                                  checked: selectedQuestionOptions.includes(option.id),
                                  disabled: loading,
                                  onChange: () => toggleQuestionOption(option.id),
                                }),
                                e("span", null, sentenceCase(option.label))
                              )
                            ),
                            assistantResponse.question.allowCustomResponse
                              ? e(
                                  "label",
                                  { className: "load-builder-ai-option load-builder-ai-option--checkbox load-builder-ai-option--custom" },
                                  e("input", {
                                    type: "checkbox",
                                    checked: questionCustomSelected,
                                    disabled: loading,
                                    onChange: () => setQuestionCustomSelected((selected) => !selected),
                                  }),
                                  e("span", null, "Other"),
                                  e("input", {
                                    id: "load-builder-ai-custom-answer",
                                    value: questionCustomText,
                                    disabled: loading || !questionCustomSelected,
                                    placeholder: "Type a different answer...",
                                    onChange: (event) => setQuestionCustomText(event.target.value),
                                  })
                                )
                              : null,
                            e(
                              "button",
                              {
                                className: "btn btn--primary",
                                type: "button",
                                disabled:
                                  loading ||
                                  (!["major_load_screen", "medium_load_screen"].includes(assistantResponse?.question?.id) &&
                                    !selectedQuestionOptions.length &&
                                    !(questionCustomSelected && String(questionCustomText || "").trim())),
                                onClick: submitMultipleOptions,
                              },
                              "Continue"
                            )
                          )
                        : e(
                          "div",
                          { className: "load-builder-ai-options" },
                          ...toArray(assistantResponse.question.options).map((option) =>
                            e(
                              "button",
                              { key: option.id, className: "btn load-builder-ai-option", type: "button", disabled: loading, onClick: () => submitOption(option) },
                              sentenceCase(option.label)
                            )
                          ),
                          e(
                            "div",
                            { className: "load-builder-ai-option load-builder-ai-option--custom" },
                            e("span", null, "Other"),
                            e("input", {
                              id: "load-builder-ai-custom-answer",
                              value: questionCustomText,
                              placeholder: "Type a different answer...",
                              onChange: (event) => setQuestionCustomText(event.target.value),
                            }),
                            e("button", { className: "btn", type: "button", disabled: loading, onClick: submitCustom }, "Send")
                          )
                        )
                  )
                : null,
              isReview
                ? e(
                    "div",
                    { className: "load-builder-ai-review" },
                    e("h4", null, "Load Preview:"),
                    e("p", { className: "load-builder-muted" }, buildReviewSummary()),
                    e(
                      "div",
                      { className: "load-builder-ai-loads" },
                      ...proposalLoads.map((load, index) =>
                        e(
                          "article",
                          { key: `${load.templateId}-${index}`, className: "load-builder-ai-load" },
                          e(
                            "div",
                            { className: "load-builder-ai-load__body" },
                            e("strong", null, load.name || load.templateId),
                            load.assumption ? e("p", null, load.assumption) : null,
                            load.templateId === "residential-ev-level-2" && assistantResponse.facts?.evEfficiencyKwhPerMile
                              ? e("span", null, `EV efficiency: ${Number(assistantResponse.facts.evEfficiencyKwhPerMile).toFixed(2)} kWh/mile`)
                              : null
                          ),
                          e(
                            "button",
                            {
                              className: "load-builder-row-action load-builder-ai-load__remove",
                              type: "button",
                              title: `Remove ${load.name || "load"}`,
                              "aria-label": `Remove ${load.name || "load"}`,
                              onClick: () => setProposalLoads((loads) => loads.filter((_load, loadIndex) => loadIndex !== index)),
                            },
                            e(Icon, { name: "delete" })
                          )
                        )
                      )
                    )
                  )
                : null,
              error ? e("div", { className: "status status--warning" }, error) : null
            )
          : null,
        e(
          "div",
          { className: `load-builder-modal__actions${isQuestion ? " load-builder-modal__actions--split" : ""}` },
          history.length ? e("button", { className: "btn", type: "button", disabled: loading, onClick: goBack }, "Back") : null,
          isQuestion
            ? e("button", { className: "btn btn--primary", type: "button", disabled: loading, title: "Start with that", onClick: skipToReview }, "Skip")
            : null,
          isReview
            ? e(
                "button",
                {
                  className: "btn btn--primary",
                  type: "button",
                  disabled: loading || !proposalLoads.length,
                  onClick: createFromProposal,
                },
                actionLabel
              )
            : null
        )
      )
    );
  };

  const ProfilesModal = ({ open, profiles, currentProfile, onClose, onOpenProfile }) => {
    if (!open) return null;
    return e(
      "div",
      { className: "load-builder-modal-backdrop", role: "presentation" },
      e(
        "section",
        { className: "load-builder-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "load-builder-profiles-title" },
        e("h3", { id: "load-builder-profiles-title" }, "Load Profiles"),
        toArray(profiles).length
          ? e(
              "div",
              { className: "load-builder-profile-list" },
              ...toArray(profiles).map((profile) =>
                e(
                  "button",
                  {
                    key: profile.id,
                    className: `load-builder-profile-choice${currentProfile?.id === profile.id ? " is-active" : ""}`,
                    type: "button",
                    onClick: () => {
                      onOpenProfile?.(profile.id);
                      onClose();
                    },
                  },
                  e("strong", null, profile.name || "Untitled Load Profile"),
                  e("span", null, profile.updatedAt ? `Updated ${new Date(profile.updatedAt).toLocaleString()}` : "Not saved yet")
                )
              )
            )
          : e("p", { className: "load-builder-muted" }, "No saved load profiles yet."),
        e("div", { className: "load-builder-modal__actions" }, e("button", { className: "btn", type: "button", onClick: onClose }, "Close"))
      )
    );
  };

  const EditableProfileTitle = ({ name, disabled, onRenameProfile }) => {
    const resolvedName = name || "Untitled Load Profile";
    const [renaming, setRenaming] = ReactRef.useState(false);
    const [draftName, setDraftName] = ReactRef.useState(resolvedName);
    const inputRef = ReactRef.useRef(null);

    ReactRef.useEffect(() => {
      if (!renaming) setDraftName(resolvedName);
    }, [renaming, resolvedName]);

    ReactRef.useEffect(() => {
      if (!renaming) return undefined;
      inputRef.current?.focus();
      inputRef.current?.select();
      return undefined;
    }, [renaming]);

    const startRename = () => {
      if (disabled) return;
      setDraftName(resolvedName);
      setRenaming(true);
    };

    const cancelRename = () => {
      setDraftName(resolvedName);
      setRenaming(false);
    };

    const commitRename = () => {
      const trimmedName = draftName.trim();
      if (trimmedName && trimmedName !== resolvedName) onRenameProfile?.(trimmedName);
      setDraftName(trimmedName || resolvedName);
      setRenaming(false);
    };

    return renaming
      ? e("input", {
          ref: inputRef,
          className: "load-builder-profile-name-input",
          value: draftName,
          maxLength: 100,
          "aria-label": "Load profile name",
          onChange: (event) => setDraftName(event.target.value),
          onBlur: commitRename,
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          },
        })
      : e(
          "button",
          {
            className: "load-builder-profile-name",
            type: "button",
            disabled,
            title: disabled ? "Finish editing the layer before renaming the profile" : "Rename profile",
            onClick: startRename,
          },
          resolvedName
        );
  };

  const ProfilePreview = ({ profile }) => {
    const model = window.EnergyLoadBuilder?.validateProfileModel
      ? window.EnergyLoadBuilder.validateProfileModel(profile?.model || {})
      : profile?.model || {};
    const rows = toArray(model.rows);
    return e(
      "div",
      { className: "load-builder-profile-preview", "aria-label": `${profile?.name || "Profile"} aggregate preview` },
      rows.length ? e(StackedArea, { rows }) : e("span", null, "No loads")
    );
  };

  const ProfileDeleteButton = ({ profile, onDeleteProfile }) =>
    e(
      "button",
      {
        className: "load-builder-profile-delete",
        type: "button",
        title: `Delete ${profile?.name || "profile"}`,
        "aria-label": `Delete ${profile?.name || "profile"}`,
        onClick: (event) => {
          event.stopPropagation();
          onDeleteProfile?.(profile?.id);
        },
        onKeyDown: (event) => {
          event.stopPropagation();
        },
      },
      e(Icon, { name: "delete" })
    );

  const LoadProfilesLanding = (props) => {
    const [newOpen, setNewOpen] = ReactRef.useState(false);
    const profiles = toArray(props.profiles);
    return e(
      ReactRef.Fragment,
      null,
      e(
        "section",
        { className: "card assets-card load-builder-card load-profiles-card" },
        e(
          "header",
          { className: "load-builder-page-header" },
          e("h1", null, "Load Profiles")
        ),
        e(
          "div",
          { className: "load-builder-landing-actions" },
          e("button", { className: "btn btn--primary", type: "button", onClick: () => setNewOpen(true) }, "New Profile")
        ),
        props.notice ? e("div", { className: "status status--warning load-builder-notice" }, props.notice) : null,
        e(
          "div",
          { className: "load-builder-profile-table-wrap" },
          e(
            "table",
            { className: "load-builder-profile-table" },
            e(
              "thead",
              null,
              e("tr", null, e("th", null, "Name"), e("th", null, "Updated"), e("th", null, "Aggregate Preview"))
            ),
            e(
              "tbody",
              null,
              ...profiles.map((profile) =>
                e(
                  "tr",
                  {
                    key: profile.id,
                    tabIndex: 0,
                    onClick: () => props.onOpenProfile?.(profile.id),
                    onKeyDown: (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.onOpenProfile?.(profile.id);
                      }
                    },
                  },
                  e(
                    "td",
                    null,
                    e(
                      "button",
                      {
                        className: "load-builder-profile-open",
                        type: "button",
                        onClick: (event) => {
                          event.stopPropagation();
                          props.onOpenProfile?.(profile.id);
                        },
                      },
                      profile.name || "Untitled Load Profile"
                    )
                  ),
                  e("td", null, profile.updatedAt ? new Date(profile.updatedAt).toLocaleString() : "Not saved yet"),
                  e(
                    "td",
                    null,
                    e(
                      "div",
                      { className: "load-builder-profile-preview-actions" },
                      e(ProfilePreview, { profile }),
                      e(ProfileDeleteButton, { profile, onDeleteProfile: props.onDeleteProfile })
                    )
                  )
                )
              )
            )
          )
        )
      ),
      e(NewProfileModal, {
        open: newOpen,
        onClose: () => setNewOpen(false),
        onCreateProfile: props.onCreateProfile,
        onAssistantTurn: props.onAssistantTurn,
        actionLabel: "Create profile",
      })
    );
  };

  const LoadBuilderScreen = (props) => {
    const [newOpen, setNewOpen] = ReactRef.useState(false);
    const [profilesOpen, setProfilesOpen] = ReactRef.useState(false);
    const rows = toArray(props.model?.rows);
    const aggregateRows = getAggregateLayerRows(rows);
    const legendRows = rows;
    const aggregateStats = props.aggregateStats || {};

    return e(
      ReactRef.Fragment,
      null,
      props.view !== "builder"
        ? e(LoadProfilesLanding, props)
        : null,
      props.view !== "builder"
        ? null
        : e(
            ReactRef.Fragment,
            null,
      e(
        "section",
        { className: "card assets-card load-builder-card load-builder-card--editor" },
        props.notice ? e("div", { className: "status status--warning load-builder-notice" }, props.notice) : null,
        e(
          "div",
          { className: "load-builder-layout" },
          e(
            "div",
            { className: "load-builder-left-rail" },
            e(
              "header",
              { className: "load-builder-editor-heading" },
              e("button", { className: "btn btn--primary", type: "button", onClick: props.onReturnToProfiles }, "Profiles")
            ),
            e(LibraryPanel, { templates: props.templates, canEdit: props.canEdit, onDropTemplate: props.onDropTemplate, onOpenAiGen: () => setNewOpen(true) })
          ),
          e(
            "section",
            { className: "load-builder-workspace" },
            e(
              "div",
              { className: "load-builder-profile-header" },
              e(
                "div",
                null,
                e(
                  "div",
                  { className: "load-builder-title-row" },
                  e(EditableProfileTitle, {
                    name: props.currentProfile?.name || "No Profile Selected",
                    disabled: !props.currentProfile || Boolean(props.editSession?.rowId),
                    onRenameProfile: props.onRenameProfile,
                  }),
                  e(
                    "span",
                    {
                      className: `load-builder-save-pill ${String(props.autosaveStatus || "")
                        .toLowerCase()
                        .replace(/[^a-z]+/g, "-")
                        .replace(/^-|-$/g, "")}`,
                    },
                    props.autosaveStatus || "Idle"
                  )
                )
              ),
              e(
                "div",
                { className: "load-builder-metrics", "aria-label": "Aggregate metrics" },
                e("span", null, "Peak ", e("b", null, `${formatNumber(aggregateStats.peak, 0)} kW`)),
                e("span", null, "Daily Energy ", e("b", null, `${formatNumber(aggregateStats.kwh, 0)} kWh`)),
                e("span", null, "Load Layers: ", e("b", null, rows.length))
              )
            ),
            e(
              "section",
              { className: "load-builder-aggregate" },
              e("h3", null, "Aggregate Load"),
              e(
                "div",
                { className: "load-builder-aggregate-grid", style: { gridTemplateColumns: `${INFO_PANEL_WIDTH}px minmax(0, 1fr)` } },
                e(
                  "aside",
                  { className: "load-builder-legend" },
                  e("span", null, "Legend"),
                  legendRows.length
                    ? legendRows.map((row) =>
                        e(
                          "button",
                          {
                            key: row.id,
                            className: `load-builder-legend-item${row.muted ? " is-muted" : ""}`,
                            type: "button",
                            title: row.muted ? `Show ${row.name || "load"}` : `Hide ${row.name || "load"}`,
                            "aria-pressed": !row.muted,
                            onClick: () => props.onToggleRowMuted?.(row.id),
                          },
                          e("i", { style: { background: row.color || "currentColor" }, "aria-hidden": "true" }),
                          row.name || "Load"
                        )
                      )
                    : e("p", { className: "load-builder-muted" }, "No loads")
                ),
                e("div", { className: "load-builder-aggregate-chart" }, e(StackedArea, { rows: aggregateRows, showTooltip: true, showYAxis: true, showXTicks: true }), e(ChartAxis))
              )
            ),
            e(
              "section",
              { className: "load-builder-layers" },
              e("h3", null, "Layers"),
              e(LoadRows, props)
            )
          )
        )
      ),
      e(NewProfileModal, {
        open: newOpen,
        onClose: () => setNewOpen(false),
        onCreateProfile: props.onApplyAssistantProposal,
        onAssistantTurn: props.onAssistantTurn,
        assistantOnly: true,
        initialName: props.currentProfile?.name || "",
        actionLabel: "Replace loads",
      })
            )
    );
  };

  const createBridge = () => {
    let root = null;
    let container = null;
    let lastProps = {};
    const render = () => {
      if (!container || !root) return;
      root.render(e(LoadBuilderScreen, lastProps));
    };
    return {
      mount(el, props) {
        if (!el) return;
        container = el;
        lastProps = { ...props };
        if (typeof ReactDOMRef.render === "function") {
          ReactDOMRef.render(e(LoadBuilderScreen, lastProps), container);
          return;
        }
        root = typeof ReactDOMRef.createRoot === "function" ? ReactDOMRef.createRoot(container) : null;
        if (root) render();
      },
      update(nextProps) {
        lastProps = { ...lastProps, ...nextProps };
        if (root) {
          render();
          return;
        }
        if (container && typeof ReactDOMRef.render === "function") {
          ReactDOMRef.render(e(LoadBuilderScreen, lastProps), container);
        }
      },
      unmount() {
        if (root) root.unmount();
        else if (container && typeof ReactDOMRef.unmountComponentAtNode === "function") ReactDOMRef.unmountComponentAtNode(container);
        root = null;
        container = null;
      },
    };
  };

  window.EnergyLoadBuilderUI = {
    createBridge,
  };
})();
