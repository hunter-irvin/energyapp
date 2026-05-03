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
    const source = toArray(values);
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
        className: `load-builder-mini-area${selected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`,
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

  const LibraryPanel = ({ templates, canEdit, onDropTemplate }) => {
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
        e("button", { className: "btn btn--icon", type: "button", disabled: true, title: "Custom templates arrive later" }, "+")
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

  const RowActions = ({ row, isEditingAnyRow, onEnterEditRow, onDuplicateRow, onDeleteRow }) =>
    e(
      "div",
      { className: "load-builder-row-actions", "aria-label": `${row.name || "Layer"} actions` },
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

  const RowHeader = ({ row, isEditingAnyRow, onRenameRow, onEnterEditRow, onDuplicateRow, onDeleteRow }) => {
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
          ? e(RowActions, {
              row,
              isEditingAnyRow,
              onEnterEditRow,
              onDuplicateRow,
              onDeleteRow,
            })
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
            className: `load-builder-row${row.selected ? " is-selected" : ""}`,
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

  const NewProfileModal = ({ open, onClose, onCreateProfile }) => {
    const [name, setName] = ReactRef.useState("");
    ReactRef.useEffect(() => {
      if (open) setName("");
    }, [open]);
    if (!open) return null;
    const trimmed = name.trim();
    return e(
      "div",
      { className: "load-builder-modal-backdrop", role: "presentation" },
      e(
        "section",
        { className: "load-builder-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "load-builder-new-profile-title" },
        e("h3", { id: "load-builder-new-profile-title" }, "New Load Profile"),
        e("label", null, "Profile name"),
        e("input", { value: name, onChange: (event) => setName(event.target.value), autoFocus: true }),
        e(
          "div",
          { className: "load-builder-modal__actions" },
          e("button", { className: "btn", type: "button", onClick: onClose }, "Cancel"),
          e(
            "button",
            {
              className: "btn btn--primary",
              type: "button",
              disabled: !trimmed,
              onClick: () => {
                onCreateProfile?.(trimmed);
                onClose();
              },
            },
            "Create"
          )
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
                  e("td", null, e(ProfilePreview, { profile }))
                )
              )
            )
          )
        )
      ),
      e(NewProfileModal, { open: newOpen, onClose: () => setNewOpen(false), onCreateProfile: props.onCreateProfile })
    );
  };

  const LoadBuilderScreen = (props) => {
    const [newOpen, setNewOpen] = ReactRef.useState(false);
    const [profilesOpen, setProfilesOpen] = ReactRef.useState(false);
    const rows = toArray(props.model?.rows);
    const aggregateRows = getAggregateLayerRows(rows);
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
            e(LibraryPanel, { templates: props.templates, canEdit: props.canEdit, onDropTemplate: props.onDropTemplate })
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
                  aggregateRows.length
                    ? aggregateRows.map((row) =>
                        e(
                          "p",
                          { key: row.id },
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
      e(NewProfileModal, { open: newOpen, onClose: () => setNewOpen(false), onCreateProfile: props.onCreateProfile })
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
