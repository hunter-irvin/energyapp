(() => {
  const hasChartJs = () => typeof window !== "undefined" && typeof window.Chart !== "undefined";

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
        grid: { color: "rgba(120,120,120,0.15)" },
        ticks: { color: "#353535", autoSkip: true, maxTicksLimit: 12, maxRotation: 0 },
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
      update({ labels = [], solar = [], wind = [], showSolar = true, showWind = true }) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = solar;
        chart.data.datasets[1].data = wind;
        chart.data.datasets[0].hidden = !showSolar;
        chart.data.datasets[1].hidden = !showWind;
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
  };
})();
