(() => {
  const ReactRef = window.React;
  const ReactDOMRef = window.ReactDOM;
  if (!ReactRef || !ReactDOMRef) return;

  const e = ReactRef.createElement;

  const toArray = (value) => (Array.isArray(value) ? value : []);

  const defaultTooltipLabel = (context) => {
    const numeric = Number(context?.parsed?.y ?? context?.raw ?? 0);
    return `${context?.dataset?.label || "Value"}: ${Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"}`;
  };

  const buildOptions = (props = {}) => {
    const defaultScales = {
      x: {
        grid: { color: "rgba(120,120,120,0.15)" },
        ticks: {
          color: "#353535",
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
        grid: { color: "rgba(120,120,120,0.2)" },
        ticks: { color: "#353535" },
        title: {
          display: Boolean(props.yTitle),
          text: props.yTitle || "",
          color: "#2d2d2d",
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
        tooltip: {
          callbacks: {
            label: props.tooltipLabel || defaultTooltipLabel,
          },
        },
      },
      scales: props?.scales || defaultScales,
    };
  };

  const buildDatasets = (datasets = []) =>
    toArray(datasets).map((series) => ({
      label: series?.label || "Series",
      data: toArray(series?.data),
      borderColor: series?.borderColor || "#000000",
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

    ReactRef.useEffect(() => {
      if (!canvasRef.current || !window.Chart) return undefined;
      const chart = new window.Chart(canvasRef.current, {
        type: props.type || "line",
        data: {
          labels: toArray(props.labels),
          datasets: buildDatasets(props.datasets),
        },
        options: buildOptions(props),
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
      chart.data.labels = toArray(props.labels);
      chart.data.datasets = buildDatasets(props.datasets);
      chart.options = buildOptions(props);
      chart.update();
    }, [props.labels, props.datasets, props.yTitle, props.minY, props.tooltipLabel, props.type, props.scales]);

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
