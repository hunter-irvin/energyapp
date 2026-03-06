(() => {
  const ReactRef = window.React;
  const ReactDOMRef = window.ReactDOM;
  if (!ReactRef || !ReactDOMRef) return;

  const e = ReactRef.createElement;

  const toArray = (value) => (Array.isArray(value) ? value : []);
  const getCssValue = (styles, key, fallback) => {
    const value = styles?.getPropertyValue(key)?.trim();
    return value || fallback;
  };
  const readThemePalette = () => {
    const styles = window.getComputedStyle(document.documentElement);
    return {
      axisTick: getCssValue(styles, "--color-text-muted", "#6d7982"),
      axisTitle: getCssValue(styles, "--color-text-secondary", "#d0d7dc"),
      gridPrimary: getCssValue(styles, "--chart-grid-primary", "rgba(120,120,120,0.2)"),
      gridSecondary: getCssValue(styles, "--chart-grid-secondary", "rgba(120,120,120,0.15)"),
      zeroLine: getCssValue(styles, "--chart-zero-line", "#ffffff"),
      seriesDefault: getCssValue(styles, "--color-chart-total", "#a8b4be"),
      nowIndicator: getCssValue(styles, "--color-now-indicator", "#68d37f"),
      missingFill: getCssValue(styles, "--chart-missing-fill", "rgba(220, 38, 38, 0.14)"),
      missingStroke: getCssValue(styles, "--chart-missing-stroke", "rgba(239, 68, 68, 0.55)"),
    };
  };

  const nowIndicatorPlugin = {
    id: "nowIndicator",
    afterDatasetsDraw(chart, args, pluginOptions) {
      if (!pluginOptions?.enabled) return;
      const ratioRaw = Number(pluginOptions.ratio);
      if (!Number.isFinite(ratioRaw)) return;
      const ratio = Math.min(Math.max(ratioRaw, 0), 1);
      const area = chart?.chartArea;
      if (!area || area.left >= area.right) return;
      const x = area.left + (area.right - area.left) * ratio;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.lineWidth = Number.isFinite(pluginOptions.width) ? Math.max(1, pluginOptions.width) : 1;
      ctx.strokeStyle = pluginOptions.color || "#68d37f";
      ctx.globalAlpha = Number.isFinite(pluginOptions.alpha) ? Math.min(Math.max(pluginOptions.alpha, 0), 1) : 0.95;
      ctx.stroke();
      ctx.restore();
    },
  };

  const missingRangesPlugin = {
    id: "missingRanges",
    beforeDatasetsDraw(chart, args, pluginOptions) {
      const ranges = toArray(pluginOptions?.ranges);
      if (!pluginOptions?.enabled || !ranges.length) return;
      const area = chart?.chartArea;
      const xScale = chart?.scales?.x;
      const labels = toArray(chart?.data?.labels);
      if (!area || !xScale || !labels.length || area.left >= area.right || area.top >= area.bottom) {
        return;
      }

      const centerForIndex = (index) => xScale.getPixelForValue(index);
      const leftBoundaryForIndex = (index) => {
        if (index <= 0) return centerForIndex(0);
        return (centerForIndex(index - 1) + centerForIndex(index)) / 2;
      };
      const rightBoundaryForIndex = (index) => {
        if (index >= labels.length - 1) return centerForIndex(labels.length - 1);
        return (centerForIndex(index) + centerForIndex(index + 1)) / 2;
      };

      const normalizedRanges = ranges
        .map((range) => {
          const rawStart = Number(range?.startIndex);
          const rawEnd = Number(range?.endIndex);
          if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
          const startIndex = Math.max(0, Math.min(labels.length - 1, Math.floor(Math.min(rawStart, rawEnd))));
          const endIndex = Math.max(0, Math.min(labels.length - 1, Math.ceil(Math.max(rawStart, rawEnd))));
          return { startIndex, endIndex };
        })
        .filter(Boolean)
        .sort((a, b) => a.startIndex - b.startIndex)
        .reduce((acc, range) => {
          const previous = acc[acc.length - 1];
          if (previous && range.startIndex <= previous.endIndex + 1) {
            previous.endIndex = Math.max(previous.endIndex, range.endIndex);
            return acc;
          }
          acc.push({ ...range });
          return acc;
        }, []);

      const spacing = Number.isFinite(pluginOptions?.spacing)
        ? Math.max(6, Number(pluginOptions.spacing))
        : 8;
      const hatchHeight = area.bottom - area.top;
      const ctx = chart.ctx;
      ctx.save();

      normalizedRanges.forEach((range) => {
        let left = leftBoundaryForIndex(range.startIndex);
        let right = rightBoundaryForIndex(range.endIndex);
        left = Math.max(area.left, left);
        right = Math.min(area.right, right);
        if (!(right > left)) return;

        ctx.fillStyle = pluginOptions?.fillColor || "rgba(220, 38, 38, 0.14)";
        ctx.fillRect(left, area.top, right - left, hatchHeight);

        ctx.strokeStyle = pluginOptions?.strokeColor || "rgba(239, 68, 68, 0.55)";
        ctx.lineWidth = 1;
        for (let x = left - hatchHeight; x < right + hatchHeight; x += spacing) {
          ctx.beginPath();
          ctx.moveTo(x, area.bottom);
          ctx.lineTo(x + hatchHeight, area.top);
          ctx.stroke();
        }
      });

      ctx.restore();
    },
  };

  const defaultTooltipLabel = (context) => {
    const numeric = Number(context?.parsed?.y ?? context?.raw ?? 0);
    return `${context?.dataset?.label || "Value"}: ${Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"}`;
  };

  const buildOptions = (props = {}, palette = readThemePalette()) => {
    const defaultScales = {
      x: {
        grid: { color: palette.gridSecondary },
        ticks: {
          color: palette.axisTick,
          autoSkip: false,
          maxRotation: 0,
          callback(value, index) {
            const labels = this?.chart?.data?.labels || [];
            const shouldShow =
              window.EnergyCharts?.shouldShowAxisTick?.(labels, index) ??
              (index % Math.max(1, Math.ceil((labels?.length || 0) / 12)) === 0);
            if (!shouldShow) return "";
            return typeof this?.getLabelForValue === "function" ? this.getLabelForValue(value) : labels[index] || "";
          },
        },
      },
      y: {
        min: props.minY ?? 0,
        grid: {
          color: (ctx) => {
            const tickValue = Number(ctx?.tick?.value);
            return Number.isFinite(tickValue) && Math.abs(tickValue) < 1e-9 ? palette.zeroLine : palette.gridPrimary;
          },
          lineWidth: (ctx) => {
            const tickValue = Number(ctx?.tick?.value);
            return Number.isFinite(tickValue) && Math.abs(tickValue) < 1e-9 ? 1.5 : 1;
          },
        },
        ticks: { color: palette.axisTick },
        title: {
          display: Boolean(props.yTitle),
          text: props.yTitle || "",
          color: palette.axisTitle,
          font: { weight: "700" },
        },
      },
    };

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        nowIndicator: {
          enabled: Boolean(props?.nowIndicator && Number.isFinite(props.nowIndicator.ratio)),
          ratio: props?.nowIndicator?.ratio,
          color: props?.nowIndicator?.color || palette.nowIndicator,
          width: props?.nowIndicator?.width || 1,
          alpha: props?.nowIndicator?.alpha,
        },
        missingRanges: {
          enabled: Array.isArray(props?.missingRanges) && props.missingRanges.length > 0,
          ranges: toArray(props?.missingRanges),
          fillColor: props?.missingRangeFill || palette.missingFill,
          strokeColor: props?.missingRangeStroke || palette.missingStroke,
          spacing: props?.missingRangeSpacing || 8,
        },
        tooltip: {
          enabled: props?.tooltipEnabled !== false,
          callbacks: {
            label: props.tooltipLabel || defaultTooltipLabel,
          },
        },
      },
      scales: props?.scales || defaultScales,
    };
  };

  const buildDatasets = (datasets = [], palette = readThemePalette()) =>
    toArray(datasets).map((series) => ({
      label: series?.label || "Series",
      data: toArray(series?.data),
      borderColor: series?.borderColor || palette.seriesDefault,
      backgroundColor: series?.backgroundColor || "transparent",
      tension: Number.isFinite(series?.tension) ? series.tension : 0.22,
      borderWidth: Number.isFinite(series?.borderWidth) ? series.borderWidth : 2,
      pointRadius: Number.isFinite(series?.pointRadius) ? series.pointRadius : 0,
      fill: series?.fill ?? false,
      yAxisID: series?.yAxisID,
      hidden: Boolean(series?.hidden),
      spanGaps: series?.spanGaps !== false,
      borderDash: toArray(series?.borderDash),
      order: Number.isFinite(series?.order) ? series.order : undefined,
    }));

  const TimeSeriesChart = (props) => {
    const canvasRef = ReactRef.useRef(null);
    const chartRef = ReactRef.useRef(null);
    const [themeVersion, setThemeVersion] = ReactRef.useState(0);

    ReactRef.useEffect(() => {
      const root = document.documentElement;
      if (!root || typeof MutationObserver !== "function") return undefined;
      const observer = new MutationObserver(() => setThemeVersion((value) => value + 1));
      observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
      return () => observer.disconnect();
    }, []);

    ReactRef.useEffect(() => {
      if (!canvasRef.current || !window.Chart) return undefined;
      const palette = readThemePalette();
      const chart = new window.Chart(canvasRef.current, {
        type: props.type || "line",
        data: {
          labels: toArray(props.labels),
          datasets: buildDatasets(props.datasets, palette),
        },
        options: buildOptions(props, palette),
        plugins: [missingRangesPlugin, nowIndicatorPlugin],
      });
      chartRef.current = chart;
      if (typeof props.onChartReady === "function") {
        props.onChartReady(chart);
      }
      return () => {
        chart.destroy();
        chartRef.current = null;
      };
    }, []);

    ReactRef.useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      const palette = readThemePalette();
      chart.data.labels = toArray(props.labels);
      chart.data.datasets = buildDatasets(props.datasets, palette);
      chart.options = buildOptions(props, palette);
      chart.update();
    }, [props.labels, props.datasets, props.yTitle, props.minY, props.tooltipLabel, props.type, props.scales, props.missingRanges, themeVersion]);

    return e("canvas", {
      ref: canvasRef,
      className: props.className || "generation-chart",
      "aria-label": props.ariaLabel || "Time series chart",
    });
  };

  const createBridge = () => {
    let root = null;
    let container = null;
    let lastProps = {};

    const render = () => {
      if (!container || !root) return;
      root.render(e(TimeSeriesChart, lastProps));
    };

    return {
      mount(el, props) {
        if (!el) return;
        container = el;
        lastProps = { ...props };
        if (typeof ReactDOMRef.render === "function") {
          ReactDOMRef.render(e(TimeSeriesChart, lastProps), container);
          return;
        }
        root = typeof ReactDOMRef.createRoot === "function" ? ReactDOMRef.createRoot(container) : null;
        if (!root) return;
        if (typeof ReactDOMRef.flushSync === "function") {
          ReactDOMRef.flushSync(() => render());
        } else {
          render();
        }
      },
      update(nextProps) {
        lastProps = { ...lastProps, ...nextProps };
        if (root) {
          render();
          return;
        }
        if (container && typeof ReactDOMRef.render === "function") {
          ReactDOMRef.render(e(TimeSeriesChart, lastProps), container);
        }
      },
      unmount() {
        if (root) {
          root.unmount();
          root = null;
        } else if (container && typeof ReactDOMRef.unmountComponentAtNode === "function") {
          ReactDOMRef.unmountComponentAtNode(container);
        }
        container = null;
      },
    };
  };

  window.EnergyTimeSeriesChart = {
    createBridge,
  };
})();
