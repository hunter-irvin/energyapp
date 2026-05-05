const { buildAssistantFollowupPrompt, buildAssistantPrompt } = require("./assistant-prompt");
const { buildInterviewState } = require("./fact-state");
const { selectNextDeterministicQuestion } = require("./question-catalog");
const { buildAssistantTemplateCatalog, getAllowedTemplateIds } = require("./template-catalog");
const {
  DEFAULT_EV_EFFICIENCY_KWH_PER_MILE,
  MODE_ASK_FOLLOWUP,
  MODE_GENERATE_PROFILE,
  assistantFollowupJsonSchema,
  assistantResponseJsonSchema,
  validateAssistantRequest,
  validateAssistantResponse,
} = require("./assistant-schema");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_FOLLOWUP_MODEL = "gpt-5.4-nano";
const DEFAULT_PROPOSAL_MODEL = "gpt-5.4-mini";
const MAX_REQUEST_BODY_BYTES = 80_000;

const isDebugEnabled = (request = {}) => Boolean(request.debug || process.env.ENERGYAPP_AI_ASSISTANT_DEBUG === "1");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const getFactor = (value, factors = {}, fallback = 1) => {
  const key = String(value || "");
  const factor = Number(factors[key]);
  return Number.isFinite(factor) ? factor : fallback;
};

const sanitizeDiagnosticMessage = (message = "") =>
  String(message || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 240);

const sanitizeOpenAiError = (error = {}) => ({
  provider: "openai",
  status: Number.isFinite(Number(error.status)) ? Number(error.status) : null,
  code: sanitizeDiagnosticMessage(error.code || ""),
  type: sanitizeDiagnosticMessage(error.type || error.name || "Error"),
  message: sanitizeDiagnosticMessage(error.message || "OpenAI request failed."),
});

const getFollowupModel = () => process.env.OPENAI_FOLLOWUP_MODEL || DEFAULT_FOLLOWUP_MODEL;
const getProposalModel = () => process.env.OPENAI_PROPOSAL_MODEL || process.env.OPENAI_MODEL || DEFAULT_PROPOSAL_MODEL;
const getReasoningEffort = (turnType) =>
  turnType === "followup"
    ? process.env.OPENAI_FOLLOWUP_REASONING_EFFORT || "none"
    : process.env.OPENAI_PROPOSAL_REASONING_EFFORT || "none";

const buildDiagnostics = ({ usedFallback = false, fallbackReason = null, model = getProposalModel(), turnType = "proposal" } = {}) => ({
  usedFallback: Boolean(usedFallback),
  fallbackReason,
  model,
  turnType,
});

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
};

const createQuestion = (id, text, why, options, selectionType = "single") => ({
  mode: MODE_ASK_FOLLOWUP,
  facts: {},
  assumptions: [],
  friendlyLoadList: [],
  loads: [],
  question: {
    id,
    text,
    why,
    selectionType,
    options,
    allowCustomResponse: true,
  },
});

const buildFallbackQuestion = (request, interviewState) => {
  const candidate = interviewState.nextQuestionCandidates[0];
  const key = candidate?.key || "projectType";
  if (key === "majorLoadScreen") {
    return createQuestion("major_load_screen", "Which major electric loads are present at the home?", candidate.reason, [
      {
        id: "hvac_ev_water",
        label: "HVAC, EV charging, or electric water heating",
        value: { hvacPresence: true, cooling: true, hasEv: true, waterHeating: "electric" },
      },
      {
        id: "pool_spa_laundry",
        label: "Pool, spa, electric cooking, or clothes dryer",
        value: { hasPoolOrHotTub: true, electricCooking: true, dryerType: "electric" },
      },
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
    ], "multiple");
  }
  if (key === "mediumLoadScreen") {
    return createQuestion("medium_load_screen", "Which additional loads should the profile account for?", candidate.reason, [
      {
        id: "office_extra_fridge",
        label: "Home office or extra refrigerator/freezer",
        value: { homeOfficeIntensity: "typical", hasExtraRefrigeration: true },
      },
      {
        id: "pumps_dehumidifier",
        label: "Well pump, sump pump, or dehumidifier",
        value: { hasWellPump: true, hasSumpPump: true, hasDehumidifier: true },
      },
      {
        id: "typical_medium_loads",
        label: "Typical lighting, appliances, and plug loads",
        value: { plugLoadIntensity: "typical", lightingType: "typical", refrigerationIntensity: "typical" },
      },
      {
        id: "none_of_these",
        label: "None of these",
        value: { hasExtraRefrigeration: false, hasWellPump: false, hasSumpPump: false, hasDehumidifier: false },
      },
    ], "multiple");
  }
  if (key === "poolOrHotTubType") {
    return createQuestion("pool_or_hot_tub_type", "Which pool or spa loads are present?", candidate.reason, [
      { id: "pool", label: "Pool pump", value: { hasPoolPump: true, hasHotTubSpa: false } },
      { id: "hot_tub", label: "Hot tub or spa", value: { hasHotTubSpa: true, hasPoolPump: false } },
      { id: "both", label: "Both pool and hot tub", value: { hasPoolPump: true, hasHotTubSpa: true } },
    ]);
  }
  if (key === "projectType") {
    return createQuestion("project_type", "What type of home is this profile for?", candidate?.reason || "The home type shapes the starting assumptions.", [
      { id: "single_family", label: "Single-family home", value: { projectType: "residential", homeType: "single_family" } },
      { id: "townhome", label: "Townhome", value: { projectType: "residential", homeType: "townhome" } },
      { id: "apartment", label: "Apartment or condo", value: { projectType: "residential", homeType: "apartment" } },
    ]);
  }
  if (key === "squareFeet") {
    return createQuestion("square_feet", "About how large is the home?", candidate.reason, [
      { id: "small", label: "Under 1,200 sq ft", value: { squareFeet: 1000 } },
      { id: "medium", label: "1,200-2,000 sq ft", value: { squareFeet: 1600 } },
      { id: "large", label: "2,000-3,000 sq ft", value: { squareFeet: 2500 } },
      { id: "very_large", label: "Over 3,000 sq ft", value: { squareFeet: 3500 } },
    ]);
  }
  if (key === "hvacType") {
    return createQuestion("hvac_type", "How is the home heated or cooled?", candidate.reason, [
      { id: "heat_pump", label: "Electric heat pump", value: { hvacType: "heat_pump", cooling: true } },
      { id: "electric_cooling", label: "A/C plus non-electric heat", value: { hvacType: "gas_forced_air", cooling: true } },
      { id: "gas_heat", label: "Gas forced-air heat", value: { hvacType: "gas_forced_air", cooling: false } },
      { id: "not_sure", label: "Not sure", value: { hvacType: "unknown" } },
    ]);
  }
  if (key === "evPresence") {
    return createQuestion("ev_presence", "Does the home charge any electric vehicles?", candidate.reason, [
      { id: "none", label: "No EVs", value: { hasEv: false, evCount: 0 } },
      { id: "one", label: "One EV", value: { hasEv: true, evCount: 1 } },
      { id: "two", label: "Two EVs", value: { hasEv: true, evCount: 2 } },
    ]);
  }
  if (key === "evCount") {
    return createQuestion("ev_count", "How many EVs usually charge at home?", candidate.reason, [
      { id: "one", label: "One EV", value: { hasEv: true, evCount: 1 } },
      { id: "two", label: "Two EVs", value: { hasEv: true, evCount: 2 } },
      { id: "three_plus", label: "Three or more EVs", value: { hasEv: true, evCount: 3 } },
    ]);
  }
  if (key === "evEnergy") {
    return createQuestion("ev_energy", "How should EV charging be estimated?", candidate.reason, [
      { id: "know_kwh", label: "I know nightly kWh", value: { evEnergyKnown: true, evEnergyEstimateMode: "nightly_kwh_known" } },
      { id: "daily_miles", label: "Use daily miles and model", value: { evEnergyKnown: false, evEnergyEstimateMode: "daily_miles_model" } },
      { id: "typical", label: "Use a typical estimate", value: { evEnergyKnown: false, evEnergyEstimateMode: "conservative_default_estimate", evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE } },
    ]);
  }
  if (key === "evAverageNightlyKwh") {
    return createQuestion("ev_average_nightly_kwh", "About how much energy does the EV usually add overnight?", candidate.reason, [
      { id: "light", label: "5-10 kWh", value: { evAverageNightlyKwh: 8 } },
      { id: "typical", label: "10-20 kWh", value: { evAverageNightlyKwh: 15 } },
      { id: "heavy", label: "20-35 kWh", value: { evAverageNightlyKwh: 28 } },
      { id: "very_heavy", label: "More than 35 kWh", value: { evAverageNightlyKwh: 40 } },
    ]);
  }
  if (key === "evDailyMiles") {
    return createQuestion("ev_daily_miles", "About how many miles does the EV usually drive per day?", candidate.reason, [
      { id: "short", label: "Under 20 miles", value: { evDailyMiles: 15, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE } },
      { id: "typical", label: "20-40 miles", value: { evDailyMiles: 30, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE } },
      { id: "long", label: "40-70 miles", value: { evDailyMiles: 55, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE } },
      { id: "very_long", label: "More than 70 miles", value: { evDailyMiles: 80, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE } },
    ]);
  }
  if (key === "evChargerLevel") {
    return createQuestion("ev_charger_level", "What charger level is usually used at home?", candidate.reason, [
      { id: "level_1", label: "Level 1 wall outlet", value: { evChargerLevel: "level_1", evChargerPeakKw: 1.4 } },
      { id: "level_2_typical", label: "Typical Level 2 charger", value: { evChargerLevel: "level_2_typical", evChargerPeakKw: 7.2 } },
      { id: "level_2_high_power", label: "High-power Level 2 charger", value: { evChargerLevel: "level_2_high_power", evChargerPeakKw: 11.5 } },
      { id: "dc_fast", label: "DC fast or Level 3 charger", value: { evChargerLevel: "dc_fast", evChargerPeakKw: 50 } },
      { id: "not_sure", label: "Not sure", value: { evChargerLevel: "unknown" } },
    ]);
  }
  if (key === "evChargerClue") {
    return createQuestion("ev_charger_clue", "Which clue best describes the home EV charger?", candidate.reason, [
      { id: "wall_outlet", label: "Regular wall outlet", value: { evChargerClue: "wall_outlet", evChargerLevel: "level_1", evChargerPeakKw: 1.4 } },
      { id: "installed_station", label: "Installed charging station", value: { evChargerClue: "installed_station", evChargerLevel: "level_2_typical", evChargerPeakKw: 7.2 } },
      { id: "still_not_sure", label: "Still not sure", value: { evChargerClue: "unknown", evChargerLevel: "level_2_typical", evChargerPeakKw: 7.2 } },
    ]);
  }
  if (key === "evChargingConcurrency") {
    return createQuestion("ev_charging_concurrency", "When multiple EVs charge, do they usually charge at the same time?", candidate.reason, [
      { id: "staggered", label: "Usually staggered", value: { evChargingConcurrency: "staggered" } },
      { id: "simultaneous", label: "Often simultaneous", value: { evChargingConcurrency: "simultaneous" } },
      { id: "varies", label: "It varies", value: { evChargingConcurrency: "mixed" } },
    ]);
  }
  if (key === "evChargingSchedule") {
    return createQuestion("ev_charging_schedule", "When does EV charging usually happen?", candidate.reason, [
      { id: "overnight", label: "Mostly overnight", value: { evChargingSchedule: "overnight" } },
      { id: "evening", label: "Evening after work", value: { evChargingSchedule: "evening" } },
      { id: "daytime", label: "Mostly daytime", value: { evChargingSchedule: "daytime" } },
    ]);
  }
  if (key === "waterHeating") {
    return createQuestion("water_heating", "How is water heated?", candidate.reason, [
      { id: "electric", label: "Electric water heater", value: { waterHeating: "electric" } },
      { id: "heat_pump", label: "Heat pump water heater", value: { waterHeating: "heat_pump" } },
      { id: "gas", label: "Gas water heater", value: { waterHeating: "gas" } },
    ]);
  }
  if (key === "poolPumpSchedule") {
    return createQuestion("pool_pump_schedule", "How does the pool pump usually run?", candidate.reason, [
      { id: "short_daytime", label: "A few daytime hours", value: { poolPumpHours: 4, poolSeasonality: "seasonal" } },
      { id: "long_daytime", label: "Most of the day", value: { poolPumpHours: 8, poolSeasonality: "seasonal" } },
      { id: "year_round", label: "Year-round schedule", value: { poolPumpHours: 6, poolSeasonality: "year_round" } },
    ]);
  }
  if (key === "hotTubUse") {
    return createQuestion("hot_tub_use", "How is the hot tub or spa usually used?", candidate.reason, [
      { id: "kept_hot", label: "Kept hot continuously", value: { hotTubUse: "kept_hot" } },
      { id: "before_use", label: "Heated before use", value: { hotTubUse: "before_use" } },
      { id: "occasional", label: "Occasional use", value: { hotTubUse: "occasional" } },
    ]);
  }
  if (key === "electricCooking") {
    return createQuestion("electric_cooking", "What best describes cooking equipment?", candidate.reason, [
      { id: "electric_frequent", label: "Electric cooking most days", value: { electricCooking: true, cookingFrequency: "daily" } },
      { id: "electric_light", label: "Electric cooking occasionally", value: { electricCooking: true, cookingFrequency: "occasional" } },
      { id: "gas_or_other", label: "Mostly gas or non-electric", value: { electricCooking: false } },
    ]);
  }
  if (key === "dryerType") {
    return createQuestion("dryer_type", "What type of clothes dryer is used?", candidate.reason, [
      { id: "electric_evening", label: "Usually evening", value: { dryerType: "electric", laundrySchedule: "evening" } },
      { id: "electric_daytime", label: "Usually daytime", value: { dryerType: "electric", laundrySchedule: "daytime" } },
      { id: "gas_or_none", label: "Gas dryer or no dryer", value: { dryerType: "gas" } },
    ]);
  }
  if (key === "homeOfficeIntensity") {
    return createQuestion("home_office_intensity", "How much work-from-home equipment runs on weekdays?", candidate.reason, [
      { id: "light", label: "Laptop and light office use", value: { homeOfficeIntensity: "light" } },
      { id: "typical", label: "Desktop or several monitors", value: { homeOfficeIntensity: "typical" } },
      { id: "heavy", label: "Workstation or equipment all day", value: { homeOfficeIntensity: "heavy" } },
    ]);
  }
  if (key === "occupants") {
    return createQuestion("occupants", "How many people usually live in the home?", candidate.reason, [
      { id: "one", label: "One person", value: { occupants: 1 } },
      { id: "two", label: "Two people", value: { occupants: 2 } },
      { id: "three_four", label: "Three to four people", value: { occupants: 4 } },
      { id: "five_plus", label: "Five or more people", value: { occupants: 5 } },
    ]);
  }
  if (key === "occupancy") {
    return createQuestion("occupancy", "What best describes daytime occupancy?", candidate.reason, [
      { id: "away", label: "Mostly away weekdays", value: { occupancy: "away_weekdays" } },
      { id: "work_from_home", label: "Work from home", value: { occupancy: "work_from_home" } },
      { id: "occupied", label: "Usually occupied", value: { occupancy: "occupied_daytime" } },
    ]);
  }
  return createQuestion("occupancy", "What best describes daytime occupancy?", "Occupancy changes daytime loads.", [
    { id: "away", label: "Mostly away weekdays", value: { occupancy: "away_weekdays" } },
    { id: "work_from_home", label: "Work from home", value: { occupancy: "work_from_home" } },
    { id: "occupied", label: "Usually occupied", value: { occupancy: "occupied_daytime" } },
  ]);
};

const buildFallbackProfile = (request, interviewState) => {
  const facts = interviewState.facts || {};
  const sizeFactor = Math.sqrt((facts.squareFeet || 1800) / 1800);
  const occupants = Math.max(1, Number(facts.occupants || 2));
  const occupantFactor = clamp(occupants / 2, 0.65, 1.8);
  const softOccupantFactor = clamp(Math.sqrt(occupants / 2), 0.8, 1.45);
  const plugLoadFactor = getFactor(facts.plugLoadIntensity, { light: 0.85, typical: 1, heavy: 1.35 }, 1);
  const lightingFactor = getFactor(facts.lightingType, { led: 0.65, typical: 1, heavy: 1.25, legacy: 1.35 }, 1);
  const occupancyPlugFactor = getFactor(facts.occupancy, { away_weekdays: 0.9, work_from_home: 1.15, occupied_daytime: 1.1 }, 1);
  const homeOfficeFactor = getFactor(facts.homeOfficeIntensity, { light: 0.55, typical: 0.8, heavy: 1.2 }, 0.8);
  const cookingFactor = getFactor(facts.cookingFrequency, { occasional: 0.5, daily: 1, frequent: 1.15 }, facts.cookingFrequency === "occasional" ? 0.5 : 1);
  const laundryFactor = facts.laundryLoads ? clamp(Number(facts.laundryLoads) / 2, 0.5, 2) : softOccupantFactor;
  const loads = [
    {
      templateId: "residential-base-load",
      name: "Base Household Load",
      peakKw: clamp(0.35 * sizeFactor * softOccupantFactor * plugLoadFactor * occupancyPlugFactor, 0.3, 1.8),
      reason: "Baseline residential load scaled from known home size and occupancy.",
      assumption: "Always-on household loads use a typical residential baseline.",
      modifiers: [],
    },
    {
      templateId: "residential-lighting",
      name: "Lighting and Small Appliances",
      peakKw: clamp(0.8 * sizeFactor * lightingFactor * softOccupantFactor, 0.35, 1.8),
      reason: "Lighting and small-appliance load is included for a typical home.",
      assumption: "Lighting follows a morning and evening residential pattern.",
      modifiers: facts.occupancy ? [{ type: "occupancy_lighting", value: facts.occupancy, reason: "Daytime occupancy adds a modest daytime lighting component." }] : [],
    },
  ];
  if (facts.occupancy === "work_from_home" || facts.occupancy === "occupied_daytime") {
    loads.push({
      templateId: "residential-base-load",
      name: "Work From Home Plug Loads",
      peakKw: 0.8,
      reason: "Daytime occupancy increases plug-load usage.",
      assumption: "Work-from-home equipment is modeled as a small daytime plug load.",
      modifiers: [
        { type: "workday_window", value: facts.occupancy, reason: "Daytime plug loads are concentrated around broad working hours." },
        { type: "scale", factor: 0.45 * homeOfficeFactor, reason: "Scaled workday plug-load shape for home office equipment intensity." },
      ],
    });
  }
  if (facts.hvacType === "heat_pump" || facts.hvacType === "electric_resistance") {
    loads.push({
      templateId: "residential-heat-pump-heating",
      name: "Electric Heating",
      peakKw: facts.hvacType === "electric_resistance" ? 5.5 : 4.5,
      reason: "Electric heating was identified during the intake.",
      assumption: "Heating shape is climate-sensitive and can be edited after creation.",
      modifiers: [{ type: "climate_bucket", value: interviewState.climateBucket, reason: "Adjusted by project climate bucket." }],
    });
  } else if (facts.hvacType === "gas_forced_air") {
    loads.push({
      templateId: "residential-furnace-fan",
      name: "Furnace Fan",
      peakKw: 0.6,
      reason: "Non-electric forced-air heating still uses electricity for the blower fan.",
      assumption: "Fan operation follows heating-season usage and project climate.",
      modifiers: [{ type: "season", season: "winter", reason: "Fan load is tied to winter heating calls." }],
    });
  }
  if (facts.cooling || interviewState.climateBucket === "hot") {
    loads.push({
      templateId: "residential-hvac-cooling",
      name: "Cooling",
      peakKw: clamp(3.5 * sizeFactor, 2.5, 6),
      reason: "Cooling is included based on the intake and project climate.",
      assumption: "Cooling peaks in the afternoon and early evening.",
      modifiers: [{ type: "climate_bucket", value: interviewState.climateBucket, reason: "Adjusted by project climate bucket." }],
    });
  }
  if (facts.waterHeating === "electric" || facts.waterHeating === "heat_pump") {
    loads.push({
      templateId: "residential-electric-water-heater",
      name: facts.waterHeating === "heat_pump" ? "Heat Pump Water Heater" : "Electric Water Heater",
      peakKw: facts.waterHeating === "heat_pump" ? 1.5 : 4.5,
      reason: "Electric water heating was identified during the intake.",
      assumption: "Water heating is modeled with morning and evening usage.",
      modifiers:
        facts.waterHeating === "heat_pump"
          ? [{ type: "scale", factor: 0.35 * occupantFactor, reason: "Heat-pump water heaters use lower peak power, scaled for household size." }]
          : [{ type: "scale", factor: occupantFactor, reason: "Water-heating energy is scaled for household size." }],
    });
  }
  if (facts.electricCooking) {
    loads.push({
      templateId: "residential-electric-range",
      name: "Electric Cooking",
      peakKw: facts.cookingFrequency === "occasional" ? 3.5 : 7,
      reason: "Electric cooking was identified during the intake.",
      assumption: "Cooking load is concentrated around typical meal times, especially dinner.",
      modifiers: [{ type: "scale", factor: cookingFactor * softOccupantFactor, reason: "Cooking contribution is scaled for frequency and household size." }],
    });
  }
  if (facts.dryerType === "electric") {
    loads.push({
      templateId: "residential-clothes-dryer",
      name: "Electric Clothes Dryer",
      peakKw: 2.67,
      reason: "An electric clothes dryer was identified during the intake.",
      assumption: "Dryer load is modeled as a short, high-power laundry-period load.",
      modifiers: [
        { type: "scale", factor: laundryFactor, reason: "Laundry contribution is scaled for declared or inferred household laundry volume." },
        ...(facts.laundrySchedule ? [{ type: "schedule", value: facts.laundrySchedule, reason: "Laundry timing controls when dryer load appears." }] : []),
      ],
    });
  }
  if (facts.dishwasherFrequency || facts.dishwasherSchedule) {
    loads.push({
      templateId: "residential-dishwasher",
      name: "Dishwasher",
      peakKw: 1.5,
      reason: "Dishwasher use was identified during the intake.",
      assumption: "Dishwasher load is modeled as a moderate evening or overnight appliance load.",
      modifiers: [
        { type: "scale", factor: softOccupantFactor, reason: "Dishwasher contribution is scaled for household size." },
        ...(facts.dishwasherSchedule ? [{ type: "schedule", value: facts.dishwasherSchedule, reason: "Dishwasher timing controls when the load appears." }] : []),
      ],
    });
  }
  if (facts.hasPoolPump) {
    loads.push({
      templateId: "residential-pool-pump",
      name: "Pool Pump",
      peakKw: 1.5,
      reason: "Pool pump use was identified during the intake.",
      assumption: "Pool pump load follows the stated or typical daytime run schedule.",
      modifiers: [
        { type: "hours", hours: Number(facts.poolPumpHours || 6), reason: "Pool pump daily runtime controls energy use." },
        { type: "season", season: facts.poolSeasonality || "seasonal", reason: "Pool pumps are often seasonal unless stated otherwise." },
      ],
    });
  }
  if (facts.hasHotTubSpa) {
    const hotTubFactor = getFactor(facts.hotTubUse, { kept_hot: 1, before_use: 0.75, occasional: 0.45 }, 0.85);
    loads.push({
      templateId: "residential-hot-tub-spa",
      name: "Hot Tub / Spa",
      peakKw: facts.hotTubUse === "before_use" ? 4 : 3.5,
      reason: "Hot tub or spa use was identified during the intake.",
      assumption: `Hot tub operation is treated as ${facts.hotTubUse || "typical"}; seasonality is stored as an assumption until season-specific intake is added.`,
      modifiers: [{ type: "scale", factor: hotTubFactor, reason: "Hot tub contribution is scaled for declared operating mode." }],
    });
  }
  if (facts.hasExtraRefrigeration) {
    const refrigerationFactor = getFactor(facts.refrigerationIntensity, { one_extra: 1, multiple_extra: 1.8, heavy: 1.6, typical: 1 }, 1);
    loads.push({
      templateId: "residential-extra-refrigeration",
      name: "Extra Refrigerator / Freezer",
      peakKw: 0.25,
      reason: "Extra refrigeration was identified during the intake.",
      assumption: "Extra refrigeration is modeled as an additional cycling background load.",
      modifiers: [{ type: "scale", factor: refrigerationFactor, reason: "Scaled for the declared number or intensity of extra refrigeration units." }],
    });
  }
  if (facts.hasWellPump) {
    const wellPumpFactor = getFactor(facts.wellPumpUse, { household: 1, irrigation: 1.8, unknown: 1.1 }, 1);
    loads.push({
      templateId: "residential-well-pump",
      name: "Well Pump",
      peakKw: facts.wellPumpUse === "irrigation" ? 1.3 : 1,
      reason: "Well pump use was identified during the intake.",
      assumption: "Well pump events are modeled as intermittent household water-use pulses.",
      modifiers: [{ type: "scale", factor: wellPumpFactor, reason: "Scaled for ordinary household use versus irrigation or high water use." }],
    });
  }
  if (facts.hasSumpPump) {
    const sumpFactor = getFactor(facts.sumpPumpFrequency, { rare: 0.35, seasonal: 0.75, frequent: 1.3 }, 0.75);
    loads.push({
      templateId: "residential-sump-sewage-pump",
      name: "Sump / Sewage Pump",
      peakKw: 0.8,
      reason: "Sump, sewage, or ejector pump use was identified during the intake.",
      assumption: `Pump frequency is treated as ${facts.sumpPumpFrequency || "seasonal"} for the typical-day profile.`,
      modifiers: [{ type: "scale", factor: sumpFactor, reason: "Scaled for declared pump frequency." }],
    });
  }
  if (facts.hasDehumidifier) {
    const dehumidifierFactor = getFactor(facts.dehumidifierSeasonality, { occasional: 0.45, seasonal: 0.85, year_round: 1 }, 0.75);
    loads.push({
      templateId: "residential-dehumidifier",
      name: "Dehumidifier",
      peakKw: 0.6,
      reason: "Dehumidifier use was identified during the intake.",
      assumption: `Dehumidifier seasonality is stored as ${facts.dehumidifierSeasonality || "unknown"} until season-specific profile selection is added.`,
      modifiers: [{ type: "scale", factor: dehumidifierFactor, reason: "Scaled for declared dehumidifier run pattern." }],
    });
  }
  if (facts.hasEv || facts.evCount > 0) {
    const evCount = Math.max(1, Number(facts.evCount || 1));
    const chargerPeakKw = Number(facts.evChargerPeakKw) || 7.2;
    const effectivePeakKw = facts.evChargingConcurrency === "simultaneous" ? chargerPeakKw * evCount : chargerPeakKw;
    const chargerLabel = getFactor(facts.evChargerLevel, {}, null)
      ? String(facts.evChargerLevel)
      : {
          level_1: "Level 1",
          level_2_typical: "typical Level 2",
          level_2_high_power: "high-power Level 2",
          dc_fast: "DC fast / Level 3",
          custom: "custom",
        }[String(facts.evChargerLevel || "")] || "typical Level 2";
    const unusualChargerNote = facts.evChargerLevel === "dc_fast" ? " DC fast / Level 3 charging is unusual for a home and should be reviewed." : "";
    const dailyEnergy =
      Number(facts.evAverageNightlyKwh) ||
      Number(facts.evDailyMiles || 0) * Number(facts.evEfficiencyKwhPerMile || DEFAULT_EV_EFFICIENCY_KWH_PER_MILE) * evCount ||
      10 * evCount;
    loads.push({
      templateId: "residential-ev-level-2",
      name: evCount > 1 ? `${evCount} EVs Charging` : "EV Charging",
      peakKw: effectivePeakKw,
      reason: "EV charging was identified during the intake.",
      assumption: `EV charging uses ${Number(facts.evEfficiencyKwhPerMile || DEFAULT_EV_EFFICIENCY_KWH_PER_MILE).toFixed(2)} kWh/mile when mileage-based and a ${chargerLabel} charger.${unusualChargerNote}`,
      modifiers: [
        {
          type: "ev_charging_profile",
          kwh: dailyEnergy,
          peakKw: effectivePeakKw,
          value: facts.evChargingSchedule || "overnight",
          reason: "Sized from EV energy, charger level, concurrency, and schedule.",
        },
      ],
    });
  }
  return {
    mode: MODE_GENERATE_PROFILE,
    profileName: request.profileName || "AI Assisted Residential Profile",
    facts,
    assumptions: [
      ...loads.map((load) => load.assumption),
      "Ordinary lighting, refrigerator/freezer cycling, plug loads, small appliances, and minor devices are folded into the baseline unless modeled separately.",
    ],
    friendlyLoadList: loads.map((load) => load.name),
    question: { id: "", text: "", why: "", selectionType: "single", options: [], allowCustomResponse: true },
    loads,
  };
};

const extractOutputText = (payload = {}) => {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part.text === "string") return part.text;
    }
  }
  return "";
};

const buildOpenAiRequestBody = ({ request, interviewState, templateCatalog, turnType }) => {
  const isFollowup = turnType === "followup";
  const model = isFollowup ? getFollowupModel() : getProposalModel();
  return {
    model,
    input: isFollowup
      ? buildAssistantFollowupPrompt({ request, interviewState })
      : buildAssistantPrompt({ request, interviewState, templateCatalog }),
    reasoning: { effort: getReasoningEffort(turnType) },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: isFollowup ? "load_profile_assistant_followup_response" : "load_profile_assistant_response",
        schema: isFollowup ? assistantFollowupJsonSchema : assistantResponseJsonSchema,
        strict: true,
      },
    },
    max_output_tokens: isFollowup ? 2200 : 3000,
  };
};

const callOpenAi = async ({ request, interviewState, templateCatalog, turnType }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.ENERGYAPP_AI_ASSISTANT_FORCE_MOCK === "1") return null;
  const body = buildOpenAiRequestBody({ request, interviewState, templateCatalog, turnType });
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = payload?.error?.code || "";
    error.type = payload?.error?.type || "";
    throw error;
  }
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("OpenAI response did not include JSON text.");
  return { payload: JSON.parse(outputText), model: body.model };
};

const createAssistantTurn = async (payload = {}) => {
  const validation = validateAssistantRequest(payload);
  if (!validation.ok) return { status: 400, body: { errors: validation.errors } };
  const request = validation.request;
  const interviewState = buildInterviewState(request);
  const templateCatalog = buildAssistantTemplateCatalog();
  const allowedTemplateIds = getAllowedTemplateIds();
  let turnType = request.forceGenerate || interviewState.recommendedStop ? "proposal" : "followup";
  let model = turnType === "followup" ? getFollowupModel() : getProposalModel();
  let assistantPayload = null;
  let usedFallback = false;
  let fallbackReason = null;
  if (turnType === "followup") {
    assistantPayload = selectNextDeterministicQuestion({ facts: interviewState.facts, request });
    if (!assistantPayload) {
      turnType = "proposal";
      model = getProposalModel();
    }
  }
  try {
    if (!assistantPayload) {
      const openAiResult = await callOpenAi({ request, interviewState, templateCatalog, turnType });
      if (openAiResult) {
        assistantPayload = openAiResult.payload;
        model = openAiResult.model || model;
      }
    }
  } catch (error) {
    usedFallback = true;
    fallbackReason = sanitizeOpenAiError(error);
    assistantPayload = null;
  }
  if (!assistantPayload) {
    usedFallback = true;
    assistantPayload = request.forceGenerate || interviewState.recommendedStop ? buildFallbackProfile(request, interviewState) : buildFallbackQuestion(request, interviewState);
  }
  const responseValidation = validateAssistantResponse(assistantPayload, allowedTemplateIds);
  if (!responseValidation.ok) {
    const fallback = buildFallbackProfile(request, interviewState);
    const fallbackValidation = validateAssistantResponse(fallback, allowedTemplateIds);
    return {
      status: fallbackValidation.ok ? 200 : 502,
      body: fallbackValidation.ok
        ? {
            ...fallbackValidation.response,
            interviewState,
            usedFallback: true,
            validationWarnings: responseValidation.errors,
            ...(isDebugEnabled(request)
              ? {
                  diagnostics: buildDiagnostics({
                    usedFallback: true,
                    fallbackReason: { type: "assistant_validation", message: responseValidation.errors.join("; ") },
                    model,
                    turnType,
                  }),
                }
              : {}),
          }
        : { errors: responseValidation.errors },
    };
  }
  return {
    status: 200,
    body: {
      ...responseValidation.response,
      interviewState,
      usedFallback,
      ...(isDebugEnabled(request) ? { diagnostics: buildDiagnostics({ usedFallback, fallbackReason, model, turnType }) } : {}),
    },
  };
};

const handleLoadProfileAssistant = async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { errors: ["Method not allowed."] });
    return;
  }
  try {
    const payload = await readJsonBody(req);
    const result = await createAssistantTurn(payload);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, 400, { errors: [error.message || "Unable to process assistant request."] });
  }
};

module.exports = {
  createAssistantTurn,
  handleLoadProfileAssistant,
  buildFallbackQuestion,
  buildFallbackProfile,
  sanitizeDiagnosticMessage,
  sanitizeOpenAiError,
  buildOpenAiRequestBody,
  DEFAULT_FOLLOWUP_MODEL,
  DEFAULT_PROPOSAL_MODEL,
  MAX_REQUEST_BODY_BYTES,
};
