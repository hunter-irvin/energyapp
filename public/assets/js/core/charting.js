(() => {
  const hasChartJs = () => typeof window !== "undefined" && typeof window.Chart !== "undefined";
  const TARGET_TIME_STEPS_HOURS = Object.freeze({ short: 3, medium: 6, long: 12 });

  const toLabelText = (label) => {
    if (Array.isArray(label)) return label.join("\n");
    return String(label ?? "");
  };

  const parseLabelTime = (label) => {
    const text = toLabelText(label);
    const match = text.match(/(^|[^0-9])(\d{1,2}):(\d{2})(?!\d)/);
    if (!match) return null;
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return { hour, minute };
  };

  const inferTimeTickStepHours = (labels = []) => {
    const count = Array.isArray(labels) ? labels.length : 0;
    if (!count) return TARGET_TIME_STEPS_HOURS.short;
    if (count <= 48) return TARGET_TIME_STEPS_HOURS.short;
    if (count <= 120) return TARGET_TIME_STEPS_HOURS.medium;
    return TARGET_TIME_STEPS_HOURS.long;
  };

  const inferCountTickStep = (labels = []) => {
    const count = Array.isArray(labels) ? labels.length : 0;
    if (!count) return 1;
    return Math.max(1, Math.ceil(count / 12));
  };

  const shouldShowAxisTick = (labels = [], index = 0) => {
    const labelCount = Array.isArray(labels) ? labels.length : 0;
    if (!labelCount) return false;
    const sampled = labels.slice(0, Math.min(labelCount, 24));
    const parsedCount = sampled.reduce((sum, label) => (parseLabelTime(label) ? sum + 1 : sum), 0);
    const isTimeLike = parsedCount >= Math.ceil(sampled.length * 0.6);
    if (!isTimeLike) {
      const step = inferCountTickStep(labels);
      return index % step === 0;
    }
    const tickHours = inferTimeTickStepHours(labels);
    const parsed = parseLabelTime(labels[index]);
    if (!parsed) {
      const step = inferCountTickStep(labels);
      return index % step === 0;
    }
    return parsed.minute === 0 && parsed.hour % tickHours === 0;
  };

  const axisTickLabelCallback = function axisTickLabelCallback(value, index) {
    const labels = this?.chart?.data?.labels || [];
    if (!shouldShowAxisTick(labels, index)) return "";
    if (typeof this?.getLabelForValue === "function") return this.getLabelForValue(value);
    return toLabelText(labels[index]);
  };

  const xGridColorCallback = (context) => {
    const chart = context?.chart;
    const labels = chart?.data?.labels || [];
    const index = Number.isFinite(context?.index) ? context.index : Number(context?.tick?.value);
    const label = labels[index];
    const period = chart?.$energyappPeriod || "";
    const isSubHourlyHiddenPeriod = period === "day" || period === "week";
    if (isSubHourlyHiddenPeriod) {
      const parsed = parseLabelTime(label);
      if (parsed && parsed.minute !== 0) return "rgba(120,120,120,0)";
    }
    return "rgba(120,120,120,0.15)";
  };

  const baseOptions = ({ showLegend = false, interactionMode = "index" } = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: interactionMode, intersect: false },
    animation: false,
    elements: {
      point: { radius: 0, hoverRadius: 3 },
      line: { tension: 0.22, borderWidth: 2 },
    },
    plugins: {
      legend: { display: showLegend },
      tooltip: {
        enabled: true,
        backgroundColor: "#ffffff",
        titleColor: "#111111",
        bodyColor: "#111111",
        borderColor: "#d0d0d0",
        borderWidth: 1,
        callbacks: {
          label(context) {
            const numeric = Number(context?.parsed?.y ?? context?.raw ?? 0);
            const formatted = Number.isFinite(numeric) ? numeric.toFixed(1) : "0.0";
            const unit = context?.dataset?.tooltipUnit ? ` ${context.dataset.tooltipUnit}` : "";
            return `${context.dataset.label}: ${formatted}${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: xGridColorCallback },
        ticks: {
          color: "#353535",
          autoSkip: false,
          maxRotation: 0,
          callback: axisTickLabelCallback,
        },
      },
    },
  });

  const createSettingsChart = (canvas) => {
    if (!canvas || !hasChartJs()) return null;
    const chart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Solar",
            data: [],
            yAxisID: "ySolar",
            tooltipUnit: "W/m²",
            borderColor: "rgba(249, 168, 37, 0.95)",
            backgroundColor: "rgba(249, 168, 37, 0.35)",
            fill: true,
          },
          {
            label: "Wind",
            data: [],
            yAxisID: "yWind",
            tooltipUnit: "m/s",
            borderColor: "rgba(31, 119, 180, 0.95)",
            backgroundColor: "rgba(31, 119, 180, 0.28)",
            fill: true,
          },
        ],
      },
      options: {
        ...baseOptions({ showLegend: false }),
        scales: {
          ...baseOptions().scales,
          x: {
            ...baseOptions().scales.x,
            ticks: {
              ...baseOptions().scales.x.ticks,
              display: false,
            },
          },
          yWind: {
            type: "linear",
            position: "left",
            min: 0,
            title: { display: true, text: "Wind (m/s)", color: "#2d2d2d", font: { weight: "700" } },
            ticks: { color: "#2d2d2d" },
            grid: { color: "rgba(120,120,120,0.15)" },
          },
          ySolar: {
            type: "linear",
            position: "right",
            min: 0,
            title: { display: true, text: "Solar (W/m²)", color: "#2d2d2d", font: { weight: "700" } },
            ticks: { color: "#2d2d2d" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    return {
      update({ labels = [], solar = [], wind = [], showSolar = true, showWind = true, period = "" }) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = solar;
        chart.data.datasets[1].data = wind;
        chart.data.datasets[0].hidden = !showSolar;
        chart.data.datasets[1].hidden = !showWind;
        chart.$energyappPeriod = period || "";
        chart.update();
      },
      destroy() {
        chart.destroy();
      },
    };
  };

  const createAssetsChart = (canvas) => {
    if (!canvas || !hasChartJs()) return null;
    const chart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Wind",
            data: [],
            yAxisID: "yGen",
            stack: "generation",
            borderColor: "rgba(31, 119, 180, 0.8)",
            backgroundColor: "rgba(31, 119, 180, 0.35)",
            fill: "origin",
          },
          {
            label: "Solar",
            data: [],
            yAxisID: "yGen",
            stack: "generation",
            borderColor: "rgba(249, 168, 37, 0.85)",
            backgroundColor: "rgba(249, 168, 37, 0.5)",
            fill: "-1",
          },
          {
            label: "Total",
            data: [],
            yAxisID: "yGen",
            stack: "total",
            borderColor: "#000000",
            backgroundColor: "transparent",
            fill: false,
          },
        ],
      },
      options: {
        ...baseOptions({ showLegend: false }),
        scales: {
          ...baseOptions().scales,
          yGen: {
            type: "linear",
            position: "left",
            stacked: true,
            min: 0,
            title: { display: true, text: "Generation", color: "#2d2d2d", font: { weight: "700" } },
            ticks: { color: "#2d2d2d" },
            grid: { color: "rgba(120,120,120,0.35)" },
          },
        },
      },
    });

    return {
      update({
        labels = [],
        solar = [],
        wind = [],
        total = [],
        yTitle = "Generation (kWh)",
        visible = { solar: true, wind: true, total: true },
        period = "",
      }) {
        const unitMatch = String(yTitle).match(/\(([^)]+)\)/);
        const generationUnit = unitMatch?.[1] || "kWh";
        chart.data.labels = labels;
        chart.data.datasets[0].data = wind;
        chart.data.datasets[1].data = solar;
        chart.data.datasets[2].data = total;
        chart.data.datasets[0].tooltipUnit = generationUnit;
        chart.data.datasets[1].tooltipUnit = generationUnit;
        chart.data.datasets[2].tooltipUnit = generationUnit;
        chart.data.datasets[0].hidden = !visible.wind;
        chart.data.datasets[1].hidden = !visible.solar;
        chart.data.datasets[2].hidden = !visible.total;
        chart.options.scales.yGen.title.text = yTitle;
        chart.options.scales.yGen.suggestedMax = Math.max(1, ...total);
        chart.$energyappPeriod = period || "";
        chart.update();
      },
      destroy() {
        chart.destroy();
      },
    };
  };

  const createStorageChart = (canvas) => {
    if (!canvas || !hasChartJs()) return null;
    const chart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Wind",
            data: [],
            yAxisID: "yGen",
            stack: "generation",
            borderColor: "rgba(31, 119, 180, 0.8)",
            backgroundColor: "rgba(31, 119, 180, 0.35)",
            fill: "origin",
          },
          {
            label: "Solar",
            data: [],
            yAxisID: "yGen",
            stack: "generation",
            borderColor: "rgba(249, 168, 37, 0.85)",
            backgroundColor: "rgba(249, 168, 37, 0.5)",
            fill: "-1",
          },
          {
            label: "Total",
            data: [],
            yAxisID: "yGen",
            stack: "total",
            borderColor: "#000000",
            backgroundColor: "transparent",
            fill: false,
          },
          {
            label: "SOC",
            data: [],
            yAxisID: "ySoc",
            borderColor: "#000000",
            borderDash: [6, 4],
            backgroundColor: "transparent",
            fill: false,
            order: 99,
          },
        ],
      },
      options: {
        ...baseOptions({ showLegend: false }),
        scales: {
          ...baseOptions().scales,
          ySoc: {
            type: "linear",
            position: "left",
            min: 0,
            max: 110,
            title: { display: true, text: "State of Charge (%)", color: "#2d2d2d", font: { weight: "700" } },
            ticks: { color: "#2d2d2d" },
            grid: { drawOnChartArea: false },
          },
          yGen: {
            type: "linear",
            position: "right",
            stacked: true,
            min: 0,
            title: { display: true, text: "Generation (kWh)", color: "#2d2d2d", font: { weight: "700" } },
            ticks: { color: "#2d2d2d" },
            grid: { color: "rgba(120,120,120,0.35)" },
          },
        },
      },
    });

    return {
      update({
        labels = [],
        solar = [],
        wind = [],
        total = [],
        soc = [],
        visible = { solar: true, wind: true, total: true, soc: true },
        period = "",
      }) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = wind;
        chart.data.datasets[1].data = solar;
        chart.data.datasets[2].data = total;
        chart.data.datasets[3].data = soc;
        chart.data.datasets[0].tooltipUnit = "kWh";
        chart.data.datasets[1].tooltipUnit = "kWh";
        chart.data.datasets[2].tooltipUnit = "kWh";
        chart.data.datasets[3].tooltipUnit = "%";
        chart.data.datasets[0].hidden = !visible.wind;
        chart.data.datasets[1].hidden = !visible.solar;
        chart.data.datasets[2].hidden = !visible.total;
        chart.data.datasets[3].hidden = !visible.soc;
        chart.options.scales.yGen.suggestedMax = Math.max(1, ...total);
        chart.$energyappPeriod = period || "";
        chart.update();
      },
      destroy() {
        chart.destroy();
      },
    };
  };

  window.EnergyCharts = {
    createSettingsChart,
    createAssetsChart,
    createStorageChart,
    shouldShowAxisTick,
    toLabelText,
  };
})();
