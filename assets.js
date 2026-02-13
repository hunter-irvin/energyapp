(() => {
  const WEATHER_PROXY_ENDPOINT = "/api/weather-proxy";
  const DEFAULT_DATE_KEY = "2014-02-09";
  const WEATHER_CACHE_DATE_KEY = "all";
  const WEATHER_INTERVAL_MINUTES = 30;
  const POINTS_PER_DAY = (24 * 60) / WEATHER_INTERVAL_MINUTES;
  const WEATHER_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
  const WEATHER_PROVIDERS = {
    nrel: "NREL",
    open_meteo: "Open-Meteo",
  };
  const supabaseService = window.EnergySupabaseService;

  const solarList = document.getElementById("solar-assets");
  const windList = document.getElementById("wind-assets");
  const addSolarButton = document.getElementById("add-solar");
  const addWindButton = document.getElementById("add-wind");
  const solarTemplate = document.getElementById("solar-asset-template");
  const windTemplate = document.getElementById("wind-asset-template");
  const deleteModal = document.getElementById("delete-asset-modal");
  const confirmDeleteButton = document.getElementById("confirm-delete-asset");
  const generationChart = document.getElementById("generation-chart");
  const generationAxis = document.getElementById("generation-axis");
  const generationChartFrame = document.getElementById("assets-chart-frame");
  const generationTooltip = document.getElementById("generation-tooltip");
  const generationDonut = document.getElementById("generation-donut");
  const generationTotalEnergy = document.getElementById("generation-total-energy");
  const periodButtons = Array.from(document.querySelectorAll("[data-assets-period]"));
  const assetsDatePickerButton = document.getElementById("assets-date-picker-button");
  const assetsDatePickerInput = document.getElementById("assets-date-picker");
  const assetsDateRangeReadout = document.getElementById("assets-date-range-readout");
  const assetsShiftBackButton = document.getElementById("assets-shift-back");
  const assetsShiftForwardButton = document.getElementById("assets-shift-forward");
  const generationDebugOutput = document.getElementById("generation-debug-output");
  const headerProjectNameInput = document.getElementById("header-project-name");
  const headerSettingsLink = document.getElementById("header-settings-link");
  const assetFieldTooltip = document.getElementById("asset-field-tooltip");

  const queryParams = new URLSearchParams(window.location.search);
  const selectedProjectId = queryParams.get("projectId");
  const isValidProjectId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);

  let currentProject = null;
  let selectedDateKey = DEFAULT_DATE_KEY;
  const viewState = { period: "week" };

  const solarDefaults = window.EnergyModels?.DEFAULT_SOLAR_ASSET || {};
  const windDefaults = window.EnergyModels?.DEFAULT_WIND_ASSET || {};
  const createSolarAsset =
    window.EnergyModels?.createSolarAsset ||
    ((overrides = {}) => ({ ...solarDefaults, ...overrides }));
  const createWindAsset =
    window.EnergyModels?.createWindAsset ||
    ((overrides = {}) => ({ ...windDefaults, ...overrides }));

  let solarCount = 0;
  let windCount = 0;
  let pendingDeleteId = null;
  let pendingDeleteType = null;
  let recomputeRaf = 0;

  const solarAssets = [];
  const windAssets = [];

  const chartState = {
    labels: [],
    solar: [],
    wind: [],
    total: [],
    unit: "kWh",
    period: "day",
  };

  const weatherDay = {
    provider: "nrel",
    loading: false,
    loaded: false,
    error: "",
    timeZone: "UTC",
    solar: [],
    wind: [],
    matchedSolarRows: 0,
    matchedWindRows: 0,
    firstMatchedTimestamp: null,
    lastMatchedTimestamp: null,
    allSolar: [],
    allWind: [],
    windSpeedKey: "windspeed_100m",
    windTemperatureKey: null,
    windPressureKey: null,
  };

  const pad2 = (value) => String(value).padStart(2, "0");
  const cleanText = (value) => String(value || "").replace(/^\ufeff/, "").trim();
  const normalizeHeader = (header) => {
    const cleaned = cleanText(header)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (!cleaned) {
      return cleaned;
    }

    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("20")) {
      return "windspeed_20m";
    }
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("80")) {
      return "windspeed_80m";
    }
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("100")) {
      return "windspeed_100m";
    }
    if (cleaned.includes("wind") && cleaned.includes("speed") && cleaned.includes("120")) {
      return "windspeed_120m";
    }
    if (cleaned.includes("temperature") && cleaned.includes("100")) {
      return "temperature_100m";
    }
    if (cleaned.includes("pressure") && cleaned.includes("100")) {
      return "pressure_100m";
    }
    if (cleaned.includes("air") && cleaned.includes("temperature")) {
      return "air_temperature";
    }

    return cleaned;
  };

  const toNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const ASSET_FIELD_HELP = {
    solar: {
      capacity_ac_kw: {
        definition: "AC nameplate capacity that caps inverter-side output and scales total solar energy.",
        tokens: ["C_AC"],
      },
      dc_ac_ratio: {
        definition: "Ratio used to oversize DC array relative to inverter AC capacity in the energy model.",
        tokens: ["R_DCAC"],
      },
      system_losses_frac: {
        definition:
          "Fractional all-in derate applied before inverter clipping and interval energy output, including orientation mismatch and other aggregate losses.",
        tokens: ["L_SYS"],
      },
      availability_frac: {
        definition: "Fraction of time the asset is available to operate, applied directly to interval energy.",
        tokens: ["A_AVAIL"],
      },
      clip_at_ac_capacity: {
        definition: "When enabled, interval energy uses inverter clipping at AC capacity instead of unconstrained AC output.",
        tokens: ["CLIP", "C_AC"],
      },
      noct_c: {
        definition: "Nominal operating cell temperature parameter used to estimate cell temperature from weather.",
        tokens: ["NOCT", "T_CELL"],
      },
      temp_coeff_per_c: {
        definition: "Temperature coefficient that adjusts DC production as cell temperature deviates from 25 degrees C.",
        tokens: ["GAMMA", "T_CELL"],
      },
    },
    wind: {
      rated_power_kw: {
        definition: "Per-turbine nameplate power used as the top scale for converting curve fraction into interval energy.",
        tokens: ["P_RATED"],
      },
      num_turbines: {
        definition: "Turbine count multiplier applied to wind energy after per-turbine power is estimated.",
        tokens: ["N_TURB"],
      },
      hub_height_m: {
        definition: "Hub height used to select or extrapolate wind speed to turbine operating elevation.",
        tokens: ["H_HUB", "V_HUB"],
      },
      power_curve_id: {
        definition: "Lookup ID for the turbine power curve function f(v) used to map effective wind speed to output fraction.",
        tokens: ["F_V"],
      },
      cut_in_mps: {
        definition: "Minimum effective wind speed where turbine output starts; below this threshold interval energy is zero.",
        tokens: ["V_IN"],
      },
      rated_mps: {
        definition: "Wind speed near full rated output on the selected power curve.",
        tokens: ["F_V"],
      },
      cut_out_mps: {
        definition: "Safety cutoff speed where turbine output is forced to zero at and above this threshold.",
        tokens: ["V_OUT"],
      },
      availability_frac: {
        definition: "Operational availability fraction applied to wind interval energy after losses.",
        tokens: ["A_AVAIL"],
      },
      wake_losses_frac: {
        definition: "Farm-level wake loss fraction reducing aerodynamic energy capture.",
        tokens: ["L_WAKE"],
      },
      electrical_losses_frac: {
        definition: "Electrical and collection system loss fraction applied to turbine output.",
        tokens: ["L_ELEC"],
      },
      density_correction_enabled: {
        definition: "Enables air-density correction to convert hub wind speed into effective speed for power-curve use.",
        tokens: ["V_EFF", "RHO", "RHO0"],
      },
      air_density_std: {
        definition: "Reference standard air density used as baseline in density-correction scaling.",
        tokens: ["RHO0"],
      },
      shear_exponent_alpha: {
        definition: "Shear exponent used in the power-law relation from reference-height wind speed to hub height.",
        tokens: ["ALPHA"],
      },
      reference_height_m: {
        definition: "Reference height for shear extrapolation when an exact hub-height wind-speed column is unavailable.",
        tokens: ["H_REF"],
      },
    },
  };

  const buildFormulaVariable = (token, highlightSet, label = token) => {
    const highlighted = highlightSet.has(token) ? " is-highlighted" : "";
    return `<span class="asset-help__var${highlighted}">${label}</span>`;
  };

  const buildSolarBasicEnergyFormula = (highlightSet) => {
    const v = (token, label = token) => buildFormulaVariable(token, highlightSet, label);
    return [
      `<span class="asset-field-tooltip__line">${v("E_SOLAR", "E")}<sub>solar,&Delta;t</sub> = ${v("C_AC", "C")}<sub>AC</sub> * (${v("GHI")} / 1000) * (1 - ${v("L_SYS")} ) * ${v("DELTA_T", "&Delta;t")}</span>`,
    ].join("");
  };

  const buildSolarAdvancedEnergyFormula = (highlightSet) => {
    const v = (token, label = token) => buildFormulaVariable(token, highlightSet, label);
    return [
      `<span class="asset-field-tooltip__line">${v("E_SOLAR", "E")}<sub>solar,&Delta;t</sub> = ${v("CLIP", "clip")}(${v("P_DCSTC", "P")}<sub>DC,STC</sub> * (${v("GHI")} / 1000) * (1 + ${v("GAMMA", "&gamma;")} * (${v("T_CELL", "T")}<sub>cell</sub> - 25)) * (1 - ${v("L_SYS")} ), ${v("C_AC", "C")}<sub>AC</sub>) * ${v("A_AVAIL", "A")}<sub>avail</sub> * ${v("DELTA_T", "&Delta;t")}</span>`,
      `<span class="asset-field-tooltip__line">${v("P_DCSTC", "P")}<sub>DC,STC</sub> = ${v("C_AC", "C")}<sub>AC</sub> * ${v("R_DCAC", "R")}<sub>DC/AC</sub></span>`,
      `<span class="asset-field-tooltip__line">${v("T_CELL", "T")}<sub>cell</sub> = ${v("T_AIR", "T")}<sub>air</sub> + ((${v("NOCT")} - 20) / 800) * ${v("GHI")}</span>`,
    ].join("");
  };

  const buildWindBasicEnergyFormula = (highlightSet) => {
    const v = (token, label = token) => buildFormulaVariable(token, highlightSet, label);
    return [
      `<span class="asset-field-tooltip__line">${v("E_WIND", "E")}<sub>wind,&Delta;t</sub> = ${v("P_RATED", "P")}<sub>rated</sub> * ${v("N_TURB", "N")}<sub>turb</sub> * ${v("F_V", "f")}(${v("V_HUB", "v")}<sub>hub</sub>) * ${v("DELTA_T", "&Delta;t")}</span>`,
      `<span class="asset-field-tooltip__line">${v("V_HUB", "v")}<sub>hub</sub> = ${v("V_REF", "v")}<sub>ref</sub> * (${v("H_HUB", "H")}<sub>hub</sub> / ${v("H_REF", "H")}<sub>ref</sub>)<sup>${v("ALPHA", "&alpha;")}</sup></span>`,
    ].join("");
  };

  const buildWindAdvancedEnergyFormula = (highlightSet) => {
    const v = (token, label = token) => buildFormulaVariable(token, highlightSet, label);
    return [
      `<span class="asset-field-tooltip__line">${v("E_WIND", "E")}<sub>wind,&Delta;t</sub> = ${v("P_RATED", "P")}<sub>rated</sub> * ${v("N_TURB", "N")}<sub>turb</sub> * ${v("F_V", "f")}(${v("V_EFF", "v")}<sub>eff</sub>) * (1 - ${v("L_WAKE")} ) * (1 - ${v("L_ELEC")} ) * ${v("A_AVAIL", "A")}<sub>avail</sub> * ${v("DELTA_T", "&Delta;t")}</span>`,
      `<span class="asset-field-tooltip__line">${v("V_HUB", "v")}<sub>hub</sub> = ${v("V_REF", "v")}<sub>ref</sub> * (${v("H_HUB", "H")}<sub>hub</sub> / ${v("H_REF", "H")}<sub>ref</sub>)<sup>${v("ALPHA", "&alpha;")}</sup></span>`,
      `<span class="asset-field-tooltip__line">${v("V_EFF", "v")}<sub>eff</sub> = ${v("V_HUB", "v")}<sub>hub</sub> * (${v("RHO", "&rho;")} / ${v("RHO0", "&rho;")}<sub>0</sub>)<sup>1/3</sup>; ${v("F_V", "f")}(${v("V_EFF", "v")}<sub>eff</sub>) = 0 if ${v("V_EFF", "v")}<sub>eff</sub> &lt; ${v("V_IN")} or ${v("V_EFF", "v")}<sub>eff</sub> &ge; ${v("V_OUT")}</span>`,
    ].join("");
  };

  const getAssetFieldLabelText = (labelElement) => {
    const clone = labelElement.cloneNode(true);
    clone.querySelectorAll(".assets-optional").forEach((node) => node.remove());
    return clone.textContent?.trim() || "Variable";
  };

  const positionAssetFieldTooltipAt = (clientX, clientY) => {
    if (!assetFieldTooltip) {
      return;
    }
    const tooltipRect = assetFieldTooltip.getBoundingClientRect();
    const offset = 16;
    let left = clientX + offset;
    let top = clientY + offset;

    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = clientX - tooltipRect.width - offset;
    }
    if (left < 8) {
      left = 8;
    }
    if (top < 8) {
      top = 8;
    }
    if (top + tooltipRect.height > window.innerHeight - 8) {
      top = window.innerHeight - tooltipRect.height - 8;
    }

    assetFieldTooltip.style.left = `${Math.round(left)}px`;
    assetFieldTooltip.style.top = `${Math.round(top)}px`;
  };

  const positionAssetFieldTooltip = (anchor) => {
    if (!anchor) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    positionAssetFieldTooltipAt(rect.right, rect.top + rect.height / 2);
  };

  const showAssetFieldTooltip = (anchor, labelText, type, fieldKey, mouseEvent = null) => {
    if (!assetFieldTooltip) {
      return;
    }
    const help = ASSET_FIELD_HELP[type]?.[fieldKey];
    if (!help) {
      assetFieldTooltip.hidden = true;
      return;
    }
    const card = anchor?.closest?.(".asset-card");
    const advancedSection = card?.querySelector?.(".asset-section--advanced");
    const isAdvancedOpen = Boolean(advancedSection && !advancedSection.classList.contains("is-collapsed"));
    const highlightSet = new Set(help.tokens || []);
    const formulaHtml =
      type === "solar"
        ? isAdvancedOpen
          ? buildSolarAdvancedEnergyFormula(highlightSet)
          : buildSolarBasicEnergyFormula(highlightSet)
        : isAdvancedOpen
          ? buildWindAdvancedEnergyFormula(highlightSet)
          : buildWindBasicEnergyFormula(highlightSet);
    assetFieldTooltip.innerHTML = `
      <p class="asset-field-tooltip__title">${labelText}</p>
      <p class="asset-field-tooltip__definition">${help.definition}</p>
      <p class="asset-field-tooltip__formula">${formulaHtml}</p>
    `;
    assetFieldTooltip.hidden = false;
    if (mouseEvent && Number.isFinite(mouseEvent.clientX) && Number.isFinite(mouseEvent.clientY)) {
      positionAssetFieldTooltipAt(mouseEvent.clientX, mouseEvent.clientY);
    } else {
      positionAssetFieldTooltip(anchor);
    }
  };

  const hideAssetFieldTooltip = () => {
    if (assetFieldTooltip) {
      assetFieldTooltip.hidden = true;
    }
  };

  const wireFieldHelp = (card, type) => {
    const sectionBodies = card.querySelectorAll(".assets-fields");
    sectionBodies.forEach((body) => {
      body.querySelectorAll(".assets-label").forEach((labelElement) => {
        const fieldElement = labelElement.nextElementSibling;
        if (!(fieldElement instanceof HTMLInputElement || fieldElement instanceof HTMLSelectElement)) {
          return;
        }
        const datasetKey = type === "solar" ? "solarField" : "windField";
        const fieldKey = fieldElement.dataset[datasetKey];
        if (!fieldKey) {
          return;
        }
        const labelText = getAssetFieldLabelText(labelElement);
        const openTooltip = (eventTarget, event = null) =>
          showAssetFieldTooltip(eventTarget, labelText, type, fieldKey, event);
        const followCursor = (event) => {
          if (!assetFieldTooltip || assetFieldTooltip.hidden) {
            return;
          }
          positionAssetFieldTooltipAt(event.clientX, event.clientY);
        };
        labelElement.addEventListener("mouseenter", (event) => openTooltip(labelElement, event));
        fieldElement.addEventListener("mouseenter", (event) => openTooltip(fieldElement, event));
        labelElement.addEventListener("mousemove", followCursor);
        fieldElement.addEventListener("mousemove", followCursor);
        labelElement.addEventListener("focusin", () => openTooltip(labelElement));
        fieldElement.addEventListener("focus", () => openTooltip(fieldElement));
        labelElement.addEventListener("mouseleave", hideAssetFieldTooltip);
        fieldElement.addEventListener("mouseleave", hideAssetFieldTooltip);
        labelElement.addEventListener("focusout", hideAssetFieldTooltip);
        fieldElement.addEventListener("blur", hideAssetFieldTooltip);
      });
    });
  };

  const withRetry = async (operation, { retries = 2, delayMs = 400 } = {}) => {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
        await sleep(delayMs * (attempt + 1));
      }
    }
    throw lastError;
  };

  const setSyncMessage = (message, isError = false) => {
    if (!generationDebugOutput) {
      return;
    }
    generationDebugOutput.textContent = message;
    generationDebugOutput.style.color = isError ? "#ffb4b4" : "";
  };

  const formatHourLabel = (index) => {
    const totalMinutes = index * WEATHER_INTERVAL_MINUTES;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${pad2(hour)}:${pad2(minute)}`;
  };

  const formatDateKey = (date) =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  const parseDateKey = (dateKey) => {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) {
      return null;
    }
    return new Date(year, month - 1, day);
  };

  const formatShortDate = (date) => {
    const yy = String(date.getFullYear()).slice(-2);
    return `${date.getMonth() + 1}/${date.getDate()}/${yy}`;
  };

  const getDateRangeForPeriod = (period, selectedDate) => {
    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (period === "week") {
      const weekStart = getWeekStart(start);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return { start: weekStart, end: weekEnd };
    }
    if (period === "month") {
      const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
      const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      return { start: monthStart, end: monthEnd };
    }
    if (period === "year") {
      const yearStart = new Date(start.getFullYear(), 0, 1);
      const yearEnd = new Date(start.getFullYear(), 11, 31);
      return { start: yearStart, end: yearEnd };
    }
    return { start, end };
  };

  const updateDateRangeReadout = () => {
    if (!assetsDateRangeReadout) {
      return;
    }
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    const { start, end } = getDateRangeForPeriod(viewState.period, selectedDate);
    const startText = formatShortDate(start);
    const endText = formatShortDate(end);
    assetsDateRangeReadout.textContent = startText === endText ? startText : `${startText}-${endText}`;
  };

  const buildRecordDateKey = (record) =>
    `${record.year}-${pad2(record.month)}-${pad2(record.day)}`;

  const buildRecordMinuteKey = (record) =>
    `${buildRecordDateKey(record)}T${pad2(record.hour)}:${pad2(record.minute)}`;

  const getWeekStart = (date) => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  };

  const buildGridLines = (maxValue, width, height, tickCount = 4) => {
    const ticks = [];
    for (let i = 0; i <= tickCount; i += 1) {
      const value = (maxValue * i) / tickCount;
      const y = height - (value / maxValue) * height;
      ticks.push({ value, y });
    }
    const lines = ticks
      .map(
        ({ y }) =>
          `<line x1="0" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" stroke="rgba(110, 110, 110, 0.55)" stroke-width="1.2" />`
      )
      .join("");
    const labels = ticks
      .map(({ value, y }) => {
        const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1));
        return `<text x="8" y="${Math.max(12, y - 4).toFixed(2)}" fill="#2d2d2d" font-size="12" font-weight="600">${rounded}</text>`;
      })
      .join("");
    return { lines, labels };
  };

  const renderDonut = (solarEnergyKwh = 0, windEnergyKwh = 0, label = "Day Total") => {
    if (!generationDonut || !generationTotalEnergy) {
      return;
    }
    const total = Math.max(0, solarEnergyKwh) + Math.max(0, windEnergyKwh);
    generationTotalEnergy.textContent = `${total.toFixed(2)} kWh`;

    const cx = 110;
    const cy = 110;
    const r = 78;
    const strokeWidth = 32;
    const circumference = 2 * Math.PI * r;
    const solarRatio = total > 0 ? solarEnergyKwh / total : 0;
    const solarLen = circumference * solarRatio;
    const windLen = Math.max(circumference - solarLen, 0);

    generationDonut.innerHTML = `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ececec" stroke-width="${strokeWidth}" />
      <circle
        cx="${cx}"
        cy="${cy}"
        r="${r}"
        fill="none"
        stroke="#1f77b4"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${windLen} ${circumference}"
        stroke-dashoffset="0"
        transform="rotate(-90 ${cx} ${cy})"
      />
      <circle
        cx="${cx}"
        cy="${cy}"
        r="${r}"
        fill="none"
        stroke="#f9a825"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${solarLen} ${circumference}"
        stroke-dashoffset="${-windLen}"
        transform="rotate(-90 ${cx} ${cy})"
      />
      <circle cx="${cx}" cy="${cy}" r="${r - strokeWidth / 2}" fill="#ffffff" />
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="12" fill="#666666">${label}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="20" font-weight="700" fill="#000000">${total.toFixed(1)}</text>
    `;
  };

  const hideTooltip = () => {
    if (generationTooltip) {
      generationTooltip.hidden = true;
    }
  };

  const updateTooltip = (event) => {
    if (!generationChartFrame || !generationTooltip || !chartState.total.length) {
      return;
    }
    const rect = generationChartFrame.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const clampedX = Math.max(0, Math.min(rect.width, x));
    const ratio = rect.width > 0 ? clampedX / rect.width : 0;
    const pointCount = chartState.total.length;
    const index = Math.max(0, Math.min(pointCount - 1, Math.round(ratio * (pointCount - 1))));
    const solarValue = chartState.solar[index] || 0;
    const windValue = chartState.wind[index] || 0;
    const totalValue = chartState.total[index] || 0;
    const label = chartState.labels[index] || "";
    const unit = getSeriesUnitLabel(chartState.period);

    generationTooltip.innerHTML = `
      <div class="generation-tooltip__time">${label}</div>
      <div>Solar: ${solarValue.toFixed(2)} ${unit}</div>
      <div>Wind: ${windValue.toFixed(2)} ${unit}</div>
      <div>Total: ${totalValue.toFixed(2)} ${unit}</div>
    `;

    const offset = 14;
    const maxLeft = rect.width - generationTooltip.offsetWidth - 8;
    const left = Math.max(8, Math.min(maxLeft, clampedX + offset));
    const maxTop = rect.height - generationTooltip.offsetHeight - 8;
    const top = Math.max(8, Math.min(maxTop, event.clientY - rect.top - generationTooltip.offsetHeight - 10));
    generationTooltip.style.left = `${left}px`;
    generationTooltip.style.top = `${top}px`;
    generationTooltip.hidden = false;
  };

  const hasZoneInTimestamp = (timestampLike) => /(?:z|[+-]\d{2}:?\d{2})$/i.test(cleanText(timestampLike));

  const parseTimestampParts = (timestampLike) => {
    const raw = cleanText(timestampLike);
    if (!raw) {
      return null;
    }

    const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
    const match = withT.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second = "0"] = match;
    return {
      year: String(Number(year)),
      month: String(Number(month)),
      day: String(Number(day)),
      hour: String(Number(hour)),
      minute: String(Number(minute)),
      second: String(Number(second)),
    };
  };

  const toUtcDate = (timestampLike) => {
    const raw = cleanText(timestampLike);
    if (!raw) {
      return null;
    }
    const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
    const hasZone = hasZoneInTimestamp(withT);
    const primary = new Date(hasZone ? withT : `${withT}Z`);
    if (!Number.isNaN(primary.getTime())) {
      return primary;
    }
    const fallback = new Date(raw);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
    return null;
  };

  const withDateParts = (record) => {
    const hasDateParts = [record.year, record.month, record.day].every((value) => Number.isFinite(Number(value)));
    if (hasDateParts) {
      return record;
    }
    const timestampLike =
      record.timestamp || record.time || record.datetime || record.date_time || record.local_time || record.utc_time;
    if (!timestampLike) {
      return record;
    }

    if (!hasZoneInTimestamp(timestampLike)) {
      const localParts = parseTimestampParts(timestampLike);
      if (localParts) {
        return {
          ...record,
          ...localParts,
        };
      }
    }

    const utcDate = toUtcDate(timestampLike);
    if (!utcDate) {
      return record;
    }
    return {
      ...record,
      year: String(utcDate.getUTCFullYear()),
      month: String(utcDate.getUTCMonth() + 1),
      day: String(utcDate.getUTCDate()),
      hour: String(utcDate.getUTCHours()),
      minute: String(utcDate.getUTCMinutes()),
      second: String(utcDate.getUTCSeconds()),
    };
  };

  const buildUrl = (base, params) => {
    const url = new URL(base, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
  };

  const fetchTimeZone = async ({ lat, lng }) => {
    const url = new URL("https://timeapi.io/api/TimeZone/coordinate");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        return "UTC";
      }
      const payload = await response.json();
      return payload?.timeZone || "UTC";
    } catch (error) {
      return "UTC";
    }
  };

  const getTimeZoneFormatter = (timeZone) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

  const normalizeRecordsToTimeZone = (records, timeZone) => {
    if (!timeZone || timeZone === "UTC") {
      return records;
    }
    const formatter = getTimeZoneFormatter(timeZone);
    return records.map((record) => {
      const year = Number(record.year);
      const month = Number(record.month);
      const day = Number(record.day);
      const hour = Number(record.hour ?? 0);
      const minute = Number(record.minute ?? 0);
      if (![year, month, day, hour, minute].every(Number.isFinite)) {
        return record;
      }
      const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
      const parts = formatter.formatToParts(utcDate);
      const byType = parts.reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});
      return {
        ...record,
        year: String(Number(byType.year)),
        month: String(Number(byType.month)),
        day: String(Number(byType.day)),
        hour: String(Number(byType.hour)),
        minute: String(Number(byType.minute)),
        second: String(Number(byType.second || 0)),
        normalized_timestamp: `${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}:00`,
      };
    });
  };


  const TIMESTAMP_WITH_ZONE_RE = /(?:z|[+-]\d{2}:?\d{2})$/i;

  const getTimestampLike = (record) =>
    cleanText(
      record?.timestamp || record?.time || record?.datetime || record?.date_time || record?.local_time || record?.utc_time
    );

  const hasDiscreteDateParts = (record) =>
    [record?.year, record?.month, record?.day, record?.hour, record?.minute].every((value) =>
      Number.isFinite(Number(value))
    );

  const buildNormalizedTimestamp = (record) => {
    if (hasDiscreteDateParts(record)) {
      return `${pad2(record.year)}-${pad2(record.month)}-${pad2(record.day)}T${pad2(record.hour)}:${pad2(record.minute)}:00`;
    }
    return getTimestampLike(record) || null;
  };

  const detectRecordTimeBasis = (records) => {
    if (!records.length) {
      return "unknown";
    }

    const sample = records.slice(0, 48);
    const hasTimestampValues = sample.some((record) => Boolean(getTimestampLike(record)));
    const hasZonedTimestamp = sample.some((record) => {
      const timestampLike = getTimestampLike(record);
      return timestampLike && TIMESTAMP_WITH_ZONE_RE.test(timestampLike);
    });

    if (hasZonedTimestamp) {
      return "absolute";
    }

    const hasDateParts = sample.some((record) => hasDiscreteDateParts(record));
    if (hasDateParts && !hasTimestampValues) {
      // Match Facility Settings behavior for NREL-style year/month/day/hour/minute rows:
      // interpret these as UTC source records that must be shifted to facility local time.
      return "absolute";
    }

    if (hasDateParts) {
      return "local_wall_clock";
    }

    return "local_wall_clock";
  };

  const alignRecordsForFacilityTimeZone = (records, timeZone) => {
    const timeBasis = detectRecordTimeBasis(records);
    if (timeBasis === "absolute") {
      return normalizeRecordsToTimeZone(records, timeZone);
    }
    return records.map((record) => ({
      ...record,
      normalized_timestamp: record.normalized_timestamp || buildNormalizedTimestamp(record),
    }));
  };


  const normalizeRecordYears = (records, targetYear) =>
    records.map((record) =>
      record.year && String(record.year) !== String(targetYear) ? { ...record, year: String(targetYear) } : record
    );

  const parseCsv = (csvText) => {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => cleanText(line))
      .filter(Boolean);

    if (!lines.length) {
      return [];
    }

    const headerIndex = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      return lower.startsWith("year,") || lower.startsWith("timestamp,") || lower.startsWith("time,");
    });

    if (headerIndex < 0) {
      return [];
    }

    const headers = lines[headerIndex].split(",").map((value) => normalizeHeader(value));
    return lines.slice(headerIndex + 1).map((line) => {
      const cols = line.split(",");
      const record = {};
      headers.forEach((header, index) => {
        const raw = cleanText(cols[index]);
        if (raw === "") {
          record[header] = null;
          return;
        }
        const numeric = Number(raw);
        record[header] = Number.isNaN(numeric) ? raw : numeric;
      });
      return withDateParts(record);
    });
  };

  const pickWindSpeedKey = (records) => {
    if (!records.length) {
      return "windspeed_100m";
    }
    const sample = records.find(Boolean) || {};
    const keys = Object.keys(sample).filter((key) => /^windspeed_\d+m$/.test(key));
    if (keys.includes("windspeed_100m")) {
      return "windspeed_100m";
    }
    return keys[0] || "windspeed_100m";
  };

  const pickWindTemperatureKey = (records) => {
    const sample = records.find(Boolean) || {};
    const keys = Object.keys(sample).filter((key) => /^temperature_\d+m$/.test(key));
    if (keys.includes("temperature_100m")) {
      return "temperature_100m";
    }
    return keys[0] || null;
  };

  const pickWindPressureKey = (records) => {
    const sample = records.find(Boolean) || {};
    const keys = Object.keys(sample).filter((key) => /^pressure_\d+m$/.test(key));
    if (keys.includes("pressure_100m")) {
      return "pressure_100m";
    }
    return keys[0] || null;
  };

  const sliceDay = (records, dateKey, mapFn) => {
    const [yy, mm, dd] = dateKey.split("-").map(Number);
    const dayRecords = records.filter((record) =>
      Number(record.year) === yy && Number(record.month) === mm && Number(record.day) === dd
    );

    const byMinute = new Map();
    dayRecords.forEach((record) => {
      const hour = Number(record.hour ?? 0);
      const minute = Number(record.minute ?? 0);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return;
      }
      byMinute.set(hour * 60 + minute, record);
    });

    const points = [];
    for (let i = 0; i < POINTS_PER_DAY; i += 1) {
      const hour = Math.floor((i * WEATHER_INTERVAL_MINUTES) / 60);
      const minute = (i * WEATHER_INTERVAL_MINUTES) % 60;
      const key = hour * 60 + minute;
      points.push(mapFn(byMinute.get(key), `${dateKey}T${pad2(hour)}:${pad2(minute)}:00`));
    }

    return {
      points,
      matchedCount: dayRecords.length,
      firstMatchedTimestamp: dayRecords[0]?.normalized_timestamp || dayRecords[0]?.timestamp || null,
      lastMatchedTimestamp:
        dayRecords[dayRecords.length - 1]?.normalized_timestamp ||
        dayRecords[dayRecords.length - 1]?.timestamp ||
        null,
    };
  };

  const setNoWeatherLoaded = () => {
    weatherDay.provider = currentProject?.weatherProvider || "nrel";
    weatherDay.loaded = false;
    weatherDay.loading = false;
    weatherDay.error = "";
    weatherDay.timeZone = "UTC";
    weatherDay.solar = [];
    weatherDay.wind = [];
    weatherDay.matchedSolarRows = 0;
    weatherDay.matchedWindRows = 0;
    weatherDay.firstMatchedTimestamp = null;
    weatherDay.lastMatchedTimestamp = null;
  };

  const isFreshCache = (cacheRow) => {
    if (!cacheRow?.fetched_at) {
      return false;
    }
    const fetchedAt = new Date(cacheRow.fetched_at).getTime();
    return Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= WEATHER_CACHE_TTL_MS;
  };

  const getProviderLabel = (provider) => WEATHER_PROVIDERS[provider] || provider;

  const loadPersistedOrRemoteWeather = async ({ forceRefresh = false } = {}) => {
    if (currentProject?.lat == null || currentProject?.lng == null) {
      throw new Error("Project location is required to load weather data.");
    }

    const provider = currentProject.weatherProvider || "nrel";
    const sourceYear = provider === "nrel" ? 2014 : null;
    const wkt = `POINT(${currentProject.lng} ${currentProject.lat})`;
    const cacheLookup = { sourceYear, intervalMinutes: WEATHER_INTERVAL_MINUTES };
    const [cachedSolar, cachedWind] = await Promise.all([
      supabaseService.getWeatherCache(currentProject.id, provider, "solar", WEATHER_CACHE_DATE_KEY, cacheLookup),
      supabaseService.getWeatherCache(currentProject.id, provider, "wind", WEATHER_CACHE_DATE_KEY, cacheLookup),
    ]);

    if (!forceRefresh && isFreshCache(cachedSolar) && isFreshCache(cachedWind) && cachedSolar?.payload && cachedWind?.payload) {
      return {
        provider,
        rawSolarRecords: cachedSolar.payload,
        rawWindRecords: cachedWind.payload,
        timeZone: cachedSolar.timezone || cachedWind.timezone || (await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng })),
      };
    }

    const weatherResponse = await fetch(
      buildUrl(WEATHER_PROXY_ENDPOINT, {
        provider,
        lat: String(currentProject.lat),
        lng: String(currentProject.lng),
        mode: "load_default",
      })
    );

    if (!weatherResponse.ok) {
      throw new Error(`Unable to load ${getProviderLabel(provider)} weather data for selected location.`);
    }

    const weatherPayload = await weatherResponse.json();
    const rawSolarRecords = weatherPayload?.solar || [];
    const rawWindRecords = weatherPayload?.wind || [];
    const timeZone = await fetchTimeZone({ lat: currentProject.lat, lng: currentProject.lng });
    const fetchedAt = new Date().toISOString();

    await Promise.all([
      supabaseService.upsertWeatherCache({
        projectId: currentProject.id,
        provider,
        dataset: "solar",
        dateKey: WEATHER_CACHE_DATE_KEY,
        sourceYear,
        intervalMinutes: WEATHER_INTERVAL_MINUTES,
        wkt,
        timezone: timeZone,
        source: weatherPayload?.meta?.provider || provider,
        fetchedAt,
        payload: rawSolarRecords,
      }),
      supabaseService.upsertWeatherCache({
        projectId: currentProject.id,
        provider,
        dataset: "wind",
        dateKey: WEATHER_CACHE_DATE_KEY,
        sourceYear,
        intervalMinutes: WEATHER_INTERVAL_MINUTES,
        wkt,
        timezone: timeZone,
        source: weatherPayload?.meta?.provider || provider,
        fetchedAt,
        payload: rawWindRecords,
      }),
    ]);

    return { provider, rawSolarRecords, rawWindRecords, timeZone };
  };

  const fetchWeatherForDay = async (options = {}) => {
    const { forceRefresh = false } = options;
    if (!currentProject || currentProject.lat == null || currentProject.lng == null) {
      weatherDay.loaded = false;
      weatherDay.error = "Set a facility location before adding assets.";
      weatherDay.solar = [];
      weatherDay.wind = [];
      scheduleRecompute();
      return;
    }

    weatherDay.loading = true;
    weatherDay.error = "";
    scheduleRecompute();

    try {
      const { provider, rawSolarRecords, rawWindRecords, timeZone } = await withRetry(() =>
        loadPersistedOrRemoteWeather({ forceRefresh })
      );

      const [targetYear] = selectedDateKey.split("-");
      const normalizedSolarRecords =
        provider === "nrel" ? normalizeRecordYears(rawSolarRecords, targetYear) : rawSolarRecords;
      const normalizedWindRecords =
        provider === "nrel" ? normalizeRecordYears(rawWindRecords, targetYear) : rawWindRecords;

      weatherDay.provider = provider;
      weatherDay.timeZone = timeZone;

      const solarRecords = alignRecordsForFacilityTimeZone(normalizedSolarRecords, timeZone);
      const windRecords = alignRecordsForFacilityTimeZone(normalizedWindRecords, timeZone);

      const windSpeedKey = pickWindSpeedKey(windRecords);
      const windTemperatureKey = pickWindTemperatureKey(windRecords);
      const windPressureKey = pickWindPressureKey(windRecords);

      const solarSlice = sliceDay(solarRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        ghi: toNumber(record?.ghi, 0),
        dni: toNumber(record?.dni, 0),
        dhi: toNumber(record?.dhi, 0),
        air_temperature: toNumber(record?.air_temperature, 20),
      }));

      const windSlice = sliceDay(windRecords, selectedDateKey, (record, timestamp) => ({
        timestamp,
        [windSpeedKey]: toNumber(record?.[windSpeedKey], 0),
        ...(windTemperatureKey ? { [windTemperatureKey]: toNumber(record?.[windTemperatureKey], NaN) } : {}),
        ...(windPressureKey ? { [windPressureKey]: toNumber(record?.[windPressureKey], NaN) } : {}),
      }));

      weatherDay.solar = solarSlice.points;
      weatherDay.wind = windSlice.points;
      weatherDay.matchedSolarRows = solarSlice.matchedCount;
      weatherDay.matchedWindRows = windSlice.matchedCount;
      weatherDay.firstMatchedTimestamp = solarSlice.firstMatchedTimestamp || windSlice.firstMatchedTimestamp;
      weatherDay.lastMatchedTimestamp = solarSlice.lastMatchedTimestamp || windSlice.lastMatchedTimestamp;
      weatherDay.allSolar = solarRecords;
      weatherDay.allWind = windRecords;
      weatherDay.windSpeedKey = windSpeedKey;
      weatherDay.windTemperatureKey = windTemperatureKey;
      weatherDay.windPressureKey = windPressureKey;

      const needsSolar = solarAssets.length > 0;
      const needsWind = windAssets.length > 0;
      const solarReady = weatherDay.solar.length === POINTS_PER_DAY && weatherDay.matchedSolarRows > 0;
      const windReady = weatherDay.wind.length === POINTS_PER_DAY && weatherDay.matchedWindRows > 0;

      weatherDay.loaded = (!needsSolar || solarReady) && (!needsWind || windReady);

      if (!weatherDay.loaded) {
        const missingStreams = [];
        if (needsSolar && !solarReady) {
          missingStreams.push("solar");
        }
        if (needsWind && !windReady) {
          missingStreams.push("wind");
        }
        weatherDay.error =
          missingStreams.length === 1
            ? `No ${missingStreams[0]} weather rows matched selected date after alignment. Check timezone/year normalization.`
            : "No solar/wind weather rows matched selected date after alignment. Check timezone/year normalization.";
      }
    } catch (error) {
      weatherDay.loaded = false;
      weatherDay.error = error.message || "Unable to fetch weather data.";
      weatherDay.solar = [];
      weatherDay.wind = [];
      weatherDay.matchedSolarRows = 0;
      weatherDay.matchedWindRows = 0;
      weatherDay.firstMatchedTimestamp = null;
      weatherDay.lastMatchedTimestamp = null;
    } finally {
      weatherDay.loading = false;
      scheduleRecompute();
    }
  };

  const buildWeatherMaps = () => {
    const solarMap = new Map();
    weatherDay.allSolar.forEach((record) => {
      if (record.year == null || record.month == null || record.day == null) {
        return;
      }
      const key = buildRecordMinuteKey(record);
      solarMap.set(key, {
        ghi: toNumber(record?.ghi, 0),
        dni: toNumber(record?.dni, 0),
        dhi: toNumber(record?.dhi, 0),
        air_temperature: toNumber(record?.air_temperature, 20),
      });
    });

    const windMap = new Map();
    weatherDay.allWind.forEach((record) => {
      if (record.year == null || record.month == null || record.day == null) {
        return;
      }
      const key = buildRecordMinuteKey(record);
      windMap.set(key, {
        [weatherDay.windSpeedKey]: toNumber(record?.[weatherDay.windSpeedKey], 0),
        ...(weatherDay.windTemperatureKey
          ? { [weatherDay.windTemperatureKey]: toNumber(record?.[weatherDay.windTemperatureKey], NaN) }
          : {}),
        ...(weatherDay.windPressureKey
          ? { [weatherDay.windPressureKey]: toNumber(record?.[weatherDay.windPressureKey], NaN) }
          : {}),
      });
    });

    return { solarMap, windMap };
  };

  const computeSeriesFromWeather = (
    solarWeather,
    windWeather,
    labels,
    { unit = "kWh", period = "day", scaleFactor = 1 } = {}
  ) => {
    const solarPower = window.EnergyGeneration?.sumSolarAssets
      ? Array.from(window.EnergyGeneration.sumSolarAssets(solarAssets.map((entry) => entry.model), solarWeather))
      : Array.from(buildEmptySeries()).slice(0, labels.length);

    const windPower = window.EnergyGeneration?.sumWindAssets
      ? Array.from(window.EnergyGeneration.sumWindAssets(windAssets.map((entry) => entry.model), windWeather))
      : Array.from(buildEmptySeries()).slice(0, labels.length);

    const solarValues = solarPower.map((value) => value * scaleFactor);
    const windValues = windPower.map((value) => value * scaleFactor);
    const totalValues = labels.map((_, index) => (solarValues[index] || 0) + (windValues[index] || 0));

    return {
      labels,
      solar: solarValues,
      wind: windValues,
      total: totalValues,
      unit,
      period,
    };
  };

  const buildIntervalPeriodSeries = (period, selectedDate) => {
    const { solarMap, windMap } = buildWeatherMaps();
    const labels = [];
    const solarWeather = [];
    const windWeather = [];

    const start = period === "week" ? getWeekStart(selectedDate) : new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (period === "week" ? 6 : 0));
    end.setHours(23, 60 - WEATHER_INTERVAL_MINUTES, 0, 0);

    for (
      let cursor = new Date(start);
      cursor <= end;
      cursor.setMinutes(cursor.getMinutes() + WEATHER_INTERVAL_MINUTES)
    ) {
      const key = `${formatDateKey(cursor)}T${pad2(cursor.getHours())}:${pad2(cursor.getMinutes())}`;
      const solarRecord = solarMap.get(key) || { ghi: 0, dni: 0, dhi: 0, air_temperature: 20 };
      const windRecord = windMap.get(key) || { [weatherDay.windSpeedKey]: 0 };
      solarWeather.push({ timestamp: `${key}:00`, ...solarRecord });
      windWeather.push({ timestamp: `${key}:00`, ...windRecord });

      labels.push(
        period === "day"
          ? `${pad2(cursor.getHours())}:${pad2(cursor.getMinutes())}`
          : `${cursor.toLocaleString("en-US", {
              weekday: "short",
            })} ${cursor.getMonth() + 1}/${cursor.getDate()} ${pad2(cursor.getHours())}:${pad2(cursor.getMinutes())}`
      );
    }

    return computeSeriesFromWeather(solarWeather, windWeather, labels, {
      unit: "kWh",
      period,
      scaleFactor: WEATHER_INTERVAL_MINUTES / 60,
    });
  };

  const buildDailyAggregatedSeries = (period, selectedDate) => {
    const { solarMap, windMap } = buildWeatherMaps();
    const labels = [];
    const solarDaily = [];
    const windDaily = [];
    const intervalHours = WEATHER_INTERVAL_MINUTES / 60;

    const start =
      period === "month"
        ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
        : new Date(selectedDate.getFullYear(), 0, 1);
    const end =
      period === "month"
        ? new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)
        : new Date(selectedDate.getFullYear(), 11, 31);

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const dateKey = formatDateKey(cursor);
      const daySolarWeather = [];
      const dayWindWeather = [];
      for (let i = 0; i < POINTS_PER_DAY; i += 1) {
        const hour = Math.floor((i * WEATHER_INTERVAL_MINUTES) / 60);
        const minute = (i * WEATHER_INTERVAL_MINUTES) % 60;
        const minuteKey = `${dateKey}T${pad2(hour)}:${pad2(minute)}`;
        daySolarWeather.push({
          timestamp: `${minuteKey}:00`,
          ...(solarMap.get(minuteKey) || { ghi: 0, dni: 0, dhi: 0, air_temperature: 20 }),
        });
        dayWindWeather.push({
          timestamp: `${minuteKey}:00`,
          ...(windMap.get(minuteKey) || { [weatherDay.windSpeedKey]: 0 }),
        });
      }

      const daySolarKw = window.EnergyGeneration?.sumSolarAssets
        ? Array.from(window.EnergyGeneration.sumSolarAssets(solarAssets.map((entry) => entry.model), daySolarWeather))
        : Array.from(buildEmptySeries());
      const dayWindKw = window.EnergyGeneration?.sumWindAssets
        ? Array.from(window.EnergyGeneration.sumWindAssets(windAssets.map((entry) => entry.model), dayWindWeather))
        : Array.from(buildEmptySeries());

      const daySolarKwh = daySolarKw.reduce((sum, value) => sum + value * intervalHours, 0);
      const dayWindKwh = dayWindKw.reduce((sum, value) => sum + value * intervalHours, 0);

      labels.push(dateKey);
      solarDaily.push(daySolarKwh);
      windDaily.push(dayWindKwh);
    }

    const total = labels.map((_, index) => (solarDaily[index] || 0) + (windDaily[index] || 0));
    return { labels, solar: solarDaily, wind: windDaily, total, unit: "kWh", period };
  };

  const buildGenerationSeries = () => {
    const selectedDate = parseDateKey(selectedDateKey) || new Date();
    if (viewState.period === "day" || viewState.period === "week") {
      return buildIntervalPeriodSeries(viewState.period, selectedDate);
    }
    return buildDailyAggregatedSeries(viewState.period, selectedDate);
  };

  const getSeriesUnitLabel = (period) => (period === "month" || period === "year" ? "kWh/day" : "kWh");

  const renderAxis = (labels) => {
    if (!generationAxis) {
      return;
    }
    generationAxis.innerHTML = "";
    generationAxis.style.gridTemplateColumns = `repeat(${Math.max(labels.length, 1)}, minmax(0, 1fr))`;
    const skip = labels.length > 120 ? 24 : labels.length > 60 ? 12 : labels.length > 30 ? 6 : 1;
    labels.forEach((label, index) => {
      const span = document.createElement("span");
      span.textContent = index % skip === 0 ? label : "";
      generationAxis.appendChild(span);
    });
  };


  const areaPath = (values, baseline, yScale, width, height) => {
    const points = values.length;
    if (!points) {
      return "";
    }
    const stepX = points > 1 ? width / (points - 1) : width;
    let path = "";
    for (let i = 0; i < points; i += 1) {
      const x = i * stepX;
      const y = height - (values[i] + baseline[i]) * yScale;
      path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    for (let i = points - 1; i >= 0; i -= 1) {
      const x = i * stepX;
      const y = height - baseline[i] * yScale;
      path += ` L ${x} ${y}`;
    }
    return `${path} Z`;
  };

  const linePath = (values, yScale, width, height) => {
    const points = values.length;
    if (!points) {
      return "";
    }
    const stepX = points > 1 ? width / (points - 1) : width;
    let path = "";
    for (let i = 0; i < points; i += 1) {
      const x = i * stepX;
      const y = height - values[i] * yScale;
      path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return path;
  };

  const buildEmptySeries = () => new Float64Array(POINTS_PER_DAY);

  const renderDebugData = ({ solarDebug = [], windDebug = [], totalKw = null }) => {
    if (!generationDebugOutput) {
      return;
    }

    const payload = {
      selectedDate: selectedDateKey,
      weatherStatus: {
        provider: weatherDay.provider,
        loaded: weatherDay.loaded,
        loading: weatherDay.loading,
        error: weatherDay.error || null,
        timeZone: weatherDay.timeZone,
        solarPoints: weatherDay.solar.length,
        windPoints: weatherDay.wind.length,
        matchedSolarRows: weatherDay.matchedSolarRows,
        matchedWindRows: weatherDay.matchedWindRows,
        firstMatchedTimestamp: weatherDay.firstMatchedTimestamp,
        lastMatchedTimestamp: weatherDay.lastMatchedTimestamp,
      },
      solarAssets: solarDebug,
      windAssets: windDebug,
      totalSampleKw: totalKw ? Array.from(totalKw.slice(0, 8)).map((v) => Number(v.toFixed(3))) : [],
    };

    generationDebugOutput.textContent = JSON.stringify(payload, null, 2);
  };

  const renderChart = () => {
    if (!generationChart) {
      return;
    }

    if (weatherDay.loading) {
      hideTooltip();
      generationChart.innerHTML = '<text x="20" y="26" fill="#666666" font-size="14">Loading weather data…</text>';
      renderDonut(0, 0);
      return;
    }

    if (!weatherDay.loaded) {
      hideTooltip();
      const message = weatherDay.error || "No weather data loaded.";
      generationChart.innerHTML = `<text x="20" y="26" fill="#c85a5a" font-size="13">${message}</text>`;
      if (generationAxis) {
        generationAxis.innerHTML = "";
      }
      renderDonut(0, 0);
      renderDebugData({});
      return;
    }

    const series = buildGenerationSeries();
    const solarValues = series.solar;
    const windValues = series.wind;
    const totalValues = series.total;
    const maxValue = Math.max(1, ...totalValues);
    const width = 1000;
    const height = 240;
    const yScale = height / maxValue;
    const zero = new Float64Array(series.labels.length);
    const { lines: gridLines, labels: gridLabels } = buildGridLines(maxValue, width, height);
    const yAxisLabel = `Generation (${getSeriesUnitLabel(series.period)})`;

    generationChart.innerHTML = `
      <g class="generation-grid">${gridLines}</g>
      <g class="generation-grid-labels">${gridLabels}</g>
      <text x="20" y="132" fill="#2d2d2d" font-size="12" font-weight="700" transform="rotate(-90 20 132)">${yAxisLabel}</text>
      <path d="${areaPath(windValues, zero, yScale, width, height)}" fill="rgba(31, 119, 180, 0.35)" stroke="rgba(31, 119, 180, 0.8)" stroke-width="1" />
      <path d="${areaPath(solarValues, windValues, yScale, width, height)}" fill="rgba(249, 168, 37, 0.50)" stroke="rgba(249, 168, 37, 0.85)" stroke-width="1" />
      <path d="${linePath(totalValues, yScale, width, height)}" fill="none" stroke="#000000" stroke-width="2" />
    `;

    chartState.labels = series.labels;
    chartState.solar = solarValues;
    chartState.wind = windValues;
    chartState.total = totalValues;
    chartState.unit = series.unit;
    chartState.period = series.period;

    renderAxis(series.labels);

    const solarEnergyKwh = solarValues.reduce((sum, value) => sum + value, 0);
    const windEnergyKwh = windValues.reduce((sum, value) => sum + value, 0);
    const label = `${series.period[0].toUpperCase()}${series.period.slice(1)} Total`;
    renderDonut(solarEnergyKwh, windEnergyKwh, label);

    renderDebugData({ totalKw: Float64Array.from(totalValues) });
  };

  const scheduleRecompute = () => {
    if (recomputeRaf) {
      cancelAnimationFrame(recomputeRaf);
    }
    recomputeRaf = requestAnimationFrame(() => {
      recomputeRaf = 0;
      renderChart();
    });
  };

  const updateModelFromField = (model, field, prefix) => {
    const key = field.dataset[`${prefix}Field`];
    if (!key) {
      return;
    }

    if (field.type === "number") {
      model[key] = toNumber(field.value, model[key]);
    } else if (field.tagName === "SELECT") {
      if (field.value === "true" || field.value === "false") {
        model[key] = field.value === "true";
      } else {
        model[key] = field.value;
      }
    } else {
      model[key] = field.value;
    }
  };

  const persistAsset = async (entry, type) => {
    if (!currentProject) {
      return;
    }
    entry.syncing = true;
    try {
      const saved = await withRetry(() =>
        supabaseService.upsertAsset({ id: entry.id, projectId: currentProject.id, type, model: entry.model })
      );
      entry.id = saved.id;
      entry.model = { ...entry.model, ...saved.model };
      entry.syncing = false;
      setSyncMessage("", false);
    } catch (error) {
      entry.syncing = false;
      setSyncMessage("Sync failed. Changes will retry on the next edit.", true);
    }
  };

  const wireFieldChanges = (card, entry, prefix, type) => {
    card.querySelectorAll("input, select").forEach((field) => {
      const handler = () => {
        updateModelFromField(entry.model, field, prefix);
        scheduleRecompute();
        void persistAsset(entry, type);
      };
      field.addEventListener("input", handler);
      field.addEventListener("change", handler);
    });
  };

  const populateFields = (container, defaults, prefix) => {
    const fields = container.querySelectorAll(`[data-${prefix}-field]`);
    fields.forEach((field) => {
      const key = field.dataset[`${prefix}Field`];
      const value = defaults[key];
      if (value == null) {
        return;
      }
      if (field.tagName === "SELECT") {
        field.value = String(value);
      } else {
        field.value = value;
      }
    });
  };

  const wireSectionToggles = (card) => {
    card.querySelectorAll(".asset-section").forEach((section) => {
      const toggle = section.querySelector(".asset-section-toggle");
      if (!toggle) {
        return;
      }
      toggle.addEventListener("click", () => {
        const collapsed = section.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.textContent = collapsed ? "▸" : "▾";
        scheduleRecompute();
      });
    });
  };

  const wireDelete = (card, type, id) => {
    const deleteButton = card.querySelector(".asset-delete");
    if (!deleteButton || !deleteModal || !confirmDeleteButton) {
      return;
    }
    deleteButton.addEventListener("click", () => {
      pendingDeleteId = id;
      pendingDeleteType = type;
      deleteModal.showModal();
    });
  };

  const removeAsset = async (type, id) => {
    const list = type === "solar" ? solarAssets : windAssets;
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    const [entry] = list.splice(index, 1);
    entry.card.remove();
    scheduleRecompute();
    try {
      await withRetry(() => supabaseService.deleteAsset(id));
      setSyncMessage("", false);
    } catch (error) {
      list.splice(index, 0, entry);
      const listEl = type === "solar" ? solarList : windList;
      if (listEl) {
        listEl.insertBefore(entry.card, listEl.children[index] || null);
      }
      setSyncMessage("Delete failed. Please retry.", true);
      scheduleRecompute();
    }
  };

  if (deleteModal) {
    deleteModal.addEventListener("close", () => {
      pendingDeleteId = null;
      pendingDeleteType = null;
    });
  }

  if (confirmDeleteButton) {
    confirmDeleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (pendingDeleteId && pendingDeleteType) {
        void removeAsset(pendingDeleteType, pendingDeleteId);
      }
      deleteModal?.close();
    });
  }

  const addAsset = (type, restoredModel = null, restoredId = null, options = {}) => {
    const isSolar = type === "solar";
    const template = isSolar ? solarTemplate : windTemplate;
    const listEl = isSolar ? solarList : windList;
    if (!template || !listEl) {
      return;
    }

    const nextIndex = isSolar ? ++solarCount : ++windCount;
    const assetId = restoredId || `${type}-${nextIndex}-${Date.now()}`;
    const defaultModel = isSolar
      ? createSolarAsset(restoredModel || { name: `Solar ${nextIndex}` })
      : createWindAsset(restoredModel || { name: `Wind ${nextIndex}` });

    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".asset-card");
    if (!card) {
      return;
    }

    card.dataset.assetId = assetId;
    populateFields(card, defaultModel, isSolar ? "solar" : "wind");
    wireFieldHelp(card, isSolar ? "solar" : "wind");
    const nameInput = card.querySelector(".asset-title-input");
    if (nameInput) {
      nameInput.value = defaultModel.name;
    }

    wireSectionToggles(card);
    wireDelete(card, type, assetId);

    listEl.appendChild(card);

    const entry = {
      id: assetId,
      model: defaultModel,
      card,
      series: new Float64Array(POINTS_PER_DAY),
    };
    (isSolar ? solarAssets : windAssets).push(entry);
    wireFieldChanges(card, entry, isSolar ? "solar" : "wind", type);

    scheduleRecompute();
    if (currentProject && options.persist !== false) {
      void persistAsset(entry, type);
    }
  };

  if (addSolarButton) {
    addSolarButton.addEventListener("click", () => addAsset("solar"));
  }
  if (addWindButton) {
    addWindButton.addEventListener("click", () => addAsset("wind"));
  }

  if (generationChartFrame) {
    generationChartFrame.addEventListener("mousemove", updateTooltip);
    generationChartFrame.addEventListener("mouseleave", hideTooltip);
  }

  window.addEventListener("scroll", hideAssetFieldTooltip, true);
  window.addEventListener("resize", hideAssetFieldTooltip);

  if (assetsDatePickerInput) {
    assetsDatePickerInput.value = selectedDateKey;
  }

  const applyPeriodToggleState = () => {
    periodButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.assetsPeriod === viewState.period);
    });
  };

  periodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const period = button.dataset.assetsPeriod;
      if (!period) {
        return;
      }
      viewState.period = period;
      applyPeriodToggleState();
      updateDateRangeReadout();
      scheduleRecompute();
    });
  });

  if (assetsDatePickerButton && assetsDatePickerInput) {
    assetsDatePickerButton.addEventListener("click", () => {
      if (typeof assetsDatePickerInput.showPicker === "function") {
        assetsDatePickerInput.showPicker();
      } else {
        assetsDatePickerInput.click();
      }
    });
  }

  if (assetsDatePickerInput) {
    assetsDatePickerInput.addEventListener("change", (event) => {
      const value = event.target.value;
      if (!value || !currentProject) {
        return;
      }
      selectedDateKey = value;
      updateDateRangeReadout();
      void withRetry(() => supabaseService.updateProject(currentProject.id, { selectedDate: value }))
        .then((project) => {
          currentProject = project;
          setSyncMessage("", false);
        })
        .catch(() => setSyncMessage("Could not save selected date.", true));
      void fetchWeatherForDay();
    });
  }

  const shiftSelectedDate = (direction) => {
    const baseDate = parseDateKey(selectedDateKey) || new Date();
    const shifted = new Date(baseDate);
    if (viewState.period === "day") {
      shifted.setDate(shifted.getDate() + direction);
    } else if (viewState.period === "week") {
      shifted.setDate(shifted.getDate() + direction * 7);
    } else if (viewState.period === "month") {
      shifted.setMonth(shifted.getMonth() + direction);
    } else {
      shifted.setFullYear(shifted.getFullYear() + direction);
    }
    selectedDateKey = formatDateKey(shifted);
    if (assetsDatePickerInput) {
      assetsDatePickerInput.value = selectedDateKey;
    }
    updateDateRangeReadout();
    if (currentProject) {
      void withRetry(() => supabaseService.updateProject(currentProject.id, { selectedDate: selectedDateKey }))
        .then((project) => {
          currentProject = project;
          setSyncMessage("", false);
        })
        .catch(() => setSyncMessage("Could not save selected date.", true));
    }
    void fetchWeatherForDay();
  };

  if (assetsShiftBackButton) {
    assetsShiftBackButton.addEventListener("click", () => {
      shiftSelectedDate(-1);
    });
  }

  if (assetsShiftForwardButton) {
    assetsShiftForwardButton.addEventListener("click", () => {
      shiftSelectedDate(1);
    });
  }

  if (headerProjectNameInput) {
    headerProjectNameInput.addEventListener("input", (event) => {
      if (!currentProject) {
        return;
      }
      const nextName = event.target.value || "Untitled Facility";
      void withRetry(() => supabaseService.updateProject(currentProject.id, { name: nextName }))
        .then((project) => {
          currentProject = project;
          setSyncMessage("", false);
        })
        .catch(() => setSyncMessage("Could not save project name.", true));
    });
  }

  const restoreProjectAssets = async () => {
    if (!currentProject) {
      return;
    }
    const savedAssets = await supabaseService.listAssets(currentProject.id);
    savedAssets.forEach((asset) => addAsset(asset.type, asset.model, asset.id, { persist: false }));
  };

  const initProject = async () => {
    await supabaseService.migrateLegacyLocalData();
    if (!selectedProjectId || !isValidProjectId(selectedProjectId)) {
      window.location.href = "projects.html";
      return;
    }

    currentProject = await withRetry(() => supabaseService.getProject(selectedProjectId));
    if (!currentProject) {
      window.location.href = "projects.html";
      return;
    }

    if (headerSettingsLink) {
      headerSettingsLink.href = `index.html?projectId=${encodeURIComponent(currentProject.id)}`;
    }

    selectedDateKey = currentProject.selectedDate || DEFAULT_DATE_KEY;
    applyPeriodToggleState();
    updateDateRangeReadout();

    if (assetsDatePickerInput) {
      assetsDatePickerInput.value = selectedDateKey;
    }

    if (headerProjectNameInput) {
      headerProjectNameInput.value = currentProject.name || "Untitled Facility";
    }

    await restoreProjectAssets();
    scheduleRecompute();
    await fetchWeatherForDay();
  };

  // Monitor API error status and show/hide banner
  const setupApiErrorBanner = () => {
    const banner = document.getElementById('api-error-banner');
    const message = document.getElementById('api-error-message');
    const code = document.getElementById('api-error-code');
    const closeBtn = document.getElementById('api-error-close');
    
    if (!banner) return; // Element might not exist on all pages

    const checkBackendStatus = () => {
      const status = supabaseService.getBackendStatus();
      
      if (status.type === 'localStorage' && status.lastError) {
        // Show error banner
        message.textContent = status.lastError;
        code.textContent = `Error Code: ${status.errorCode}`;
        banner.style.display = 'block';
      } else {
        // Hide error banner
        banner.style.display = 'none';
      }
    };
    
    // Check status immediately
    checkBackendStatus();
    
    // Check status periodically (every 5 seconds)
    setInterval(checkBackendStatus, 5000);
    
    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
      });
    }
  };

  // Initialize error banner
  setupApiErrorBanner();

  void initProject();
})();
