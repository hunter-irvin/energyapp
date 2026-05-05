const { DEFAULT_EV_EFFICIENCY_KWH_PER_MILE, MODE_ASK_FOLLOWUP, normalizeFactPatch } = require("./assistant-schema");

const PRIORITY_WEIGHTS = Object.freeze({
  high: 3,
  medium: 1,
});

const toArray = (value) => (Array.isArray(value) ? value : []);
const hasValue = (value) => value != null && value !== "";
const hasAny = (facts, keys) => toArray(keys).some((key) => hasValue(facts[key]));
const option = (id, label, value = {}) => ({ id, label, value: normalizeFactPatch(value) });
const createQuestionPayload = (question) => ({
  mode: MODE_ASK_FOLLOWUP,
  facts: {},
  assumptions: [],
  friendlyLoadList: [],
  loads: [],
  question: {
    id: question.id,
    text: question.text,
    why: question.why,
    selectionType: question.selectionType || "single",
    options: question.options,
    allowCustomResponse: question.allowCustomResponse !== false,
  },
});

const question = ({
  id,
  candidateKey,
  text,
  why,
  selectionType = "single",
  priority = "medium",
  options,
  factKeys = [],
  isRelevant = () => true,
  isResolved,
}) => ({
  id,
  candidateKey,
  text,
  why,
  selectionType,
  priority,
  weight: PRIORITY_WEIGHTS[priority] || PRIORITY_WEIGHTS.medium,
  options: Object.freeze(options),
  factKeys: Object.freeze(factKeys),
  isRelevant,
  isResolved: isResolved || ((facts) => hasAny(facts, factKeys)),
  allowCustomResponse: true,
});

const QUESTION_CATALOG = Object.freeze([
  question({
    id: "project_type",
    candidateKey: "projectType",
    text: "What type of home is this profile for?",
    why: "The project type determines which load templates are valid.",
    priority: "high",
    factKeys: ["projectType"],
    isRelevant: (facts) => !facts.projectType,
    options: [
      option("single_family", "Single-family home", { projectType: "residential", homeType: "single_family" }),
      option("townhome", "Townhome", { projectType: "residential", homeType: "townhome" }),
      option("apartment", "Apartment or condo", { projectType: "residential", homeType: "apartment" }),
    ],
  }),
  question({
    id: "major_load_screen",
    candidateKey: "majorLoadScreen",
    text: "Which major electric loads are present at the home?",
    why: "A bundled screen can quickly identify which major electric loads belong in the whole-home profile.",
    selectionType: "multiple",
    priority: "high",
    factKeys: ["majorLoadScreenComplete"],
    isResolved: (facts) => facts.majorLoadScreenComplete === true,
    isRelevant: (facts) =>
      facts.projectType !== "commercial" &&
      facts.projectType !== "industrial" &&
      !facts.majorLoadScreenComplete &&
      [facts.hvacPresence, facts.hasEv, facts.hasPoolOrHotTub, facts.electricCooking, facts.dryerType].some((value) => !hasValue(value)),
    options: [
      option("hvac", "Heat pump or AC", { hvacPresence: true }),
      option("ev", "Electric vehicle charging", { hasEv: true }),
      option("pool_spa", "Pool or hot tub", { hasPoolOrHotTub: true }),
      option("electric_cooking", "Electric oven or range", { electricCooking: true }),
      option("electric_dryer", "Clothes dryer", { dryerType: "electric" }),
      option("none_of_these", "None of these", {
        hvacPresence: false,
        hasEv: false,
        hasPoolOrHotTub: false,
        hasPoolPump: false,
        hasHotTubSpa: false,
        electricCooking: false,
        dryerType: "non_electric_or_none",
      }),
    ],
  }),
  question({
    id: "square_feet",
    candidateKey: "squareFeet",
    text: "About how large is the home?",
    why: "Home size affects base load, lighting, and HVAC sizing.",
    priority: "high",
    factKeys: ["squareFeet"],
    options: [
      option("small", "Under 1,200 sq ft", { squareFeet: 1000 }),
      option("medium", "1,200 to 2,000 sq ft", { squareFeet: 1600 }),
      option("large", "2,000 to 3,000 sq ft", { squareFeet: 2500 }),
      option("very_large", "Over 3,000 sq ft", { squareFeet: 3500 }),
    ],
  }),
  question({
    id: "hvac_type",
    candidateKey: "hvacType",
    text: "How is the home heated or cooled?",
    why: "Heating and cooling equipment can dominate the residential load shape.",
    priority: "high",
    factKeys: ["hvacType", "cooling"],
    isRelevant: (facts) => facts.hvacPresence !== false && (!facts.hvacType || facts.cooling == null),
    isResolved: (facts) => facts.hvacPresence === false || (hasValue(facts.hvacType) && facts.cooling != null),
    options: [
      option("heat_pump", "Electric heat pump", { hvacType: "heat_pump", hvacPresence: true, cooling: true }),
      option("ac_non_electric_heat", "A/C plus non-electric heat", { hvacType: "gas_forced_air", hvacPresence: true, cooling: true }),
      option("gas_heat_only", "Gas forced-air heat, little or no A/C", { hvacType: "gas_forced_air", hvacPresence: true, cooling: false }),
      option("not_sure", "Not sure", { hvacType: "unknown", hvacPresence: true }),
    ],
  }),
  question({
    id: "ev_presence",
    candidateKey: "evPresence",
    text: "Does the home charge any electric vehicles?",
    why: "EV charging is a major optional residential load.",
    priority: "high",
    factKeys: ["hasEv"],
    isRelevant: (facts) => facts.hasEv == null,
    options: [
      option("none", "No EVs", { hasEv: false, evCount: 0 }),
      option("one", "One EV", { hasEv: true, evCount: 1 }),
      option("two", "Two EVs", { hasEv: true, evCount: 2 }),
    ],
  }),
  question({
    id: "ev_count",
    candidateKey: "evCount",
    text: "How many EVs usually charge at home?",
    why: "EV count directly changes charging energy and possible peak.",
    priority: "high",
    factKeys: ["evCount"],
    isRelevant: (facts) => facts.hasEv === true && !facts.evCount,
    options: [
      option("one", "One EV", { hasEv: true, evCount: 1 }),
      option("two", "Two EVs", { hasEv: true, evCount: 2 }),
      option("three_plus", "Three or more EVs", { hasEv: true, evCount: 3 }),
    ],
  }),
  question({
    id: "ev_energy",
    candidateKey: "evEnergy",
    text: "How should EV charging be estimated?",
    why: "Average EV charging energy gives a better profile than assuming a default.",
    priority: "high",
    factKeys: ["evAverageNightlyKwh", "evDailyMiles", "evEnergyEstimateMode"],
    isRelevant: (facts) => facts.hasEv === true && !facts.evAverageNightlyKwh && !facts.evDailyMiles && facts.evEnergyEstimateMode !== "conservative_default_estimate",
    options: [
      option("know_kwh", "I know nightly kWh", { evEnergyKnown: true, evEnergyEstimateMode: "nightly_kwh_known" }),
      option("daily_miles", "Use daily miles and model", { evEnergyKnown: false, evEnergyEstimateMode: "daily_miles_model" }),
      option("typical", "Use a typical estimate", {
        evEnergyKnown: false,
        evEnergyEstimateMode: "conservative_default_estimate",
        evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE,
      }),
    ],
  }),
  question({
    id: "ev_average_nightly_kwh",
    candidateKey: "evAverageNightlyKwh",
    text: "About how much energy does the EV usually add overnight?",
    why: "Average nightly EV charging kWh directly calibrates EV energy.",
    priority: "high",
    factKeys: ["evAverageNightlyKwh"],
    isRelevant: (facts) => facts.hasEv === true && facts.evEnergyKnown === true && !facts.evAverageNightlyKwh && !facts.evDailyMiles,
    options: [
      option("light", "5 to 10 kWh", { evAverageNightlyKwh: 8 }),
      option("typical", "10 to 20 kWh", { evAverageNightlyKwh: 15 }),
      option("heavy", "20 to 35 kWh", { evAverageNightlyKwh: 28 }),
      option("very_heavy", "More than 35 kWh", { evAverageNightlyKwh: 40 }),
    ],
  }),
  question({
    id: "ev_charger_level",
    candidateKey: "evChargerLevel",
    text: "What charger level is usually used at home?",
    why: "Charger level changes EV peak demand and how long charging lasts.",
    priority: "high",
    factKeys: ["evChargerPeakKw", "evChargerLevel"],
    isRelevant: (facts) => facts.hasEv === true && !facts.evChargerPeakKw && facts.evChargerLevel !== "unknown",
    options: [
      option("level_1", "Level 1 wall outlet", { evChargerLevel: "level_1", evChargerPeakKw: 1.4 }),
      option("level_2_typical", "Typical Level 2 charger", { evChargerLevel: "level_2_typical", evChargerPeakKw: 7.2 }),
      option("level_2_high_power", "High-power Level 2 charger", { evChargerLevel: "level_2_high_power", evChargerPeakKw: 11.5 }),
      option("dc_fast", "DC fast or Level 3 charger", { evChargerLevel: "dc_fast", evChargerPeakKw: 50 }),
      option("not_sure", "Not sure", { evChargerLevel: "unknown" }),
    ],
  }),
  question({
    id: "ev_charger_clue",
    candidateKey: "evChargerClue",
    text: "Which clue best describes the home EV charger?",
    why: "A simple clue can estimate charging peak when the exact level is unknown.",
    priority: "high",
    factKeys: ["evChargerPeakKw", "evChargerClue"],
    isRelevant: (facts) => facts.hasEv === true && facts.evChargerLevel === "unknown" && !facts.evChargerPeakKw,
    options: [
      option("wall_outlet", "Regular wall outlet", { evChargerClue: "wall_outlet", evChargerLevel: "level_1", evChargerPeakKw: 1.4 }),
      option("installed_station", "Installed charging station", { evChargerClue: "installed_station", evChargerLevel: "level_2_typical", evChargerPeakKw: 7.2 }),
      option("still_not_sure", "Still not sure", { evChargerClue: "unknown", evChargerLevel: "level_2_typical", evChargerPeakKw: 7.2 }),
    ],
  }),
  question({
    id: "ev_daily_miles",
    candidateKey: "evDailyMiles",
    text: "About how many miles does the EV usually drive per day?",
    why: "Daily EV miles can estimate charging energy when nightly kWh is unknown.",
    priority: "high",
    factKeys: ["evDailyMiles"],
    isRelevant: (facts) => facts.hasEv === true && /daily_miles/.test(String(facts.evEnergyEstimateMode || "")) && !facts.evAverageNightlyKwh && !facts.evDailyMiles,
    options: [
      option("short", "Under 20 miles", { evDailyMiles: 15, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE }),
      option("typical", "20 to 40 miles", { evDailyMiles: 30, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE }),
      option("long", "40 to 70 miles", { evDailyMiles: 55, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE }),
      option("very_long", "More than 70 miles", { evDailyMiles: 80, evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE }),
    ],
  }),
  question({
    id: "ev_charging_concurrency",
    candidateKey: "evChargingConcurrency",
    text: "When multiple EVs charge, do they usually charge at the same time?",
    why: "Multi-EV charging can change peak if vehicles charge simultaneously.",
    priority: "high",
    factKeys: ["evChargingConcurrency"],
    isRelevant: (facts) => facts.hasEv === true && Number(facts.evCount || 0) > 1 && !facts.evChargingConcurrency,
    options: [
      option("staggered", "Usually staggered", { evChargingConcurrency: "staggered" }),
      option("simultaneous", "Often simultaneous", { evChargingConcurrency: "simultaneous" }),
      option("varies", "It varies", { evChargingConcurrency: "mixed" }),
    ],
  }),
  question({
    id: "ev_charging_schedule",
    candidateKey: "evChargingSchedule",
    text: "When does EV charging usually happen?",
    why: "Charging time changes the daily load shape.",
    priority: "high",
    factKeys: ["evChargingSchedule"],
    isRelevant: (facts) => facts.hasEv === true && !facts.evChargingSchedule,
    options: [
      option("overnight", "Mostly overnight", { evChargingSchedule: "overnight" }),
      option("evening", "Evening after work", { evChargingSchedule: "evening" }),
      option("daytime", "Mostly daytime", { evChargingSchedule: "daytime" }),
    ],
  }),
  question({
    id: "water_heating",
    candidateKey: "waterHeating",
    text: "How is water heated?",
    why: "Electric water heating adds morning and evening peaks.",
    priority: "high",
    factKeys: ["waterHeating"],
    options: [
      option("electric", "Electric water heater", { waterHeating: "electric" }),
      option("heat_pump", "Heat pump water heater", { waterHeating: "heat_pump" }),
      option("gas", "Gas water heater", { waterHeating: "gas" }),
    ],
  }),
  question({
    id: "pool_or_hot_tub_type",
    candidateKey: "poolOrHotTubType",
    text: "Which pool or spa loads are present?",
    why: "Pool and hot tub loads differ, so the profile should clarify which one is present.",
    priority: "high",
    factKeys: ["hasPoolPump", "hasHotTubSpa"],
    isRelevant: (facts) => facts.hasPoolOrHotTub === true && !facts.hasPoolPump && !facts.hasHotTubSpa,
    isResolved: (facts) => facts.hasPoolOrHotTub === false || facts.hasPoolPump === true || facts.hasHotTubSpa === true,
    options: [
      option("pool", "Pool pump", { hasPoolPump: true, hasHotTubSpa: false }),
      option("hot_tub", "Hot tub or spa", { hasHotTubSpa: true, hasPoolPump: false }),
      option("both", "Both pool and hot tub", { hasPoolPump: true, hasHotTubSpa: true }),
    ],
  }),
  question({
    id: "pool_pump_schedule",
    candidateKey: "poolPumpSchedule",
    text: "How does the pool pump usually run?",
    why: "Pool pump hours and schedule can add a large recurring daily load.",
    priority: "high",
    factKeys: ["poolPumpHours"],
    isRelevant: (facts) => facts.hasPoolPump === true && !facts.poolPumpHours,
    options: [
      option("short_daytime", "A few daytime hours", { poolPumpHours: 4, poolSeasonality: "seasonal" }),
      option("long_daytime", "Most of the day", { poolPumpHours: 8, poolSeasonality: "seasonal" }),
      option("year_round", "Year-round schedule", { poolPumpHours: 6, poolSeasonality: "year_round" }),
    ],
  }),
  question({
    id: "hot_tub_use",
    candidateKey: "hotTubUse",
    text: "How is the hot tub or spa usually used?",
    why: "Hot tub operating mode and use frequency can materially change daily energy.",
    priority: "high",
    factKeys: ["hotTubUse"],
    isRelevant: (facts) => facts.hasHotTubSpa === true && !facts.hotTubUse,
    options: [
      option("kept_hot", "Kept hot continuously", { hotTubUse: "kept_hot" }),
      option("before_use", "Heated before use", { hotTubUse: "before_use" }),
      option("occasional", "Occasional use", { hotTubUse: "occasional" }),
    ],
  }),
  question({
    id: "electric_cooking",
    candidateKey: "electricCooking",
    text: "What best describes cooking equipment?",
    why: "Electric cooking can add a meaningful dinner-time peak.",
    priority: "high",
    factKeys: ["electricCooking"],
    isRelevant: (facts) => facts.electricCooking == null,
    options: [
      option("electric_frequent", "Electric cooking most days", { electricCooking: true, cookingFrequency: "daily" }),
      option("electric_light", "Electric cooking occasionally", { electricCooking: true, cookingFrequency: "occasional" }),
      option("gas_or_other", "Mostly gas or non-electric", { electricCooking: false }),
    ],
  }),
  question({
    id: "dryer_type",
    candidateKey: "dryerType",
    text: "What type of clothes dryer is used?",
    why: "An electric dryer adds a high short-duration load on laundry days.",
    priority: "high",
    factKeys: ["dryerType"],
    options: [
      option("electric_evening", "Electric, usually evening", { dryerType: "electric", laundrySchedule: "evening" }),
      option("electric_daytime", "Electric, usually daytime", { dryerType: "electric", laundrySchedule: "daytime" }),
      option("gas_or_none", "Gas dryer or no dryer", { dryerType: "non_electric_or_none" }),
    ],
  }),
  question({
    id: "occupancy",
    candidateKey: "occupancy",
    text: "What best describes daytime occupancy?",
    why: "Daytime occupancy changes plug loads and HVAC use.",
    priority: "medium",
    factKeys: ["occupancy"],
    options: [
      option("away", "Mostly away weekdays", { occupancy: "away_weekdays" }),
      option("work_from_home", "Work from home", { occupancy: "work_from_home" }),
      option("occupied", "Usually occupied", { occupancy: "occupied_daytime" }),
    ],
  }),
  question({
    id: "occupants",
    candidateKey: "occupants",
    text: "How many people usually live in the home?",
    why: "Occupants affect water heating, cooking, and appliance usage.",
    priority: "medium",
    factKeys: ["occupants"],
    options: [
      option("one", "One person", { occupants: 1 }),
      option("two", "Two people", { occupants: 2 }),
      option("three_four", "Three to four people", { occupants: 4 }),
      option("five_plus", "Five or more people", { occupants: 5 }),
    ],
  }),
  question({
    id: "medium_load_screen",
    candidateKey: "mediumLoadScreen",
    text: "Which additional loads should the profile account for?",
    why: "A bundled screen can identify medium loads that materially shape the whole-home profile.",
    selectionType: "multiple",
    priority: "medium",
    factKeys: ["mediumLoadScreenComplete"],
    isResolved: (facts) => facts.mediumLoadScreenComplete === true,
    isRelevant: (facts) => !facts.mediumLoadScreenComplete,
    options: [
      option("home_office", "Home office or weekday work-from-home equipment", { occupancy: "work_from_home" }),
      option("extra_refrigeration", "Extra refrigerator or freezer", { hasExtraRefrigeration: true }),
      option("pumps_dehumidifier", "Well pump, sump pump, or dehumidifier", { hasWellPump: true, hasSumpPump: true, hasDehumidifier: true }),
      option("dishwasher_laundry", "Frequent dishwasher or laundry loads", { dishwasherFrequency: "typical", laundryLoads: 2 }),
      option("heavy_plug_lighting", "Heavy lighting, entertainment, or plug loads", { plugLoadIntensity: "heavy", lightingType: "heavy", entertainmentIntensity: "heavy" }),
      option("none_of_these", "None of these", {
        hasExtraRefrigeration: false,
        hasWellPump: false,
        hasSumpPump: false,
        hasDehumidifier: false,
      }),
    ],
  }),
  question({
    id: "home_office_intensity",
    candidateKey: "homeOfficeIntensity",
    text: "How much work-from-home equipment runs on weekdays?",
    why: "Work-from-home equipment can add a weekday daytime load.",
    priority: "medium",
    factKeys: ["homeOfficeIntensity"],
    isRelevant: (facts) => facts.occupancy === "work_from_home" && !facts.homeOfficeIntensity,
    options: [
      option("light", "Laptop and light office use", { homeOfficeIntensity: "light" }),
      option("typical", "Desktop or several monitors", { homeOfficeIntensity: "typical" }),
      option("heavy", "Workstation or equipment all day", { homeOfficeIntensity: "heavy" }),
    ],
  }),
  question({
    id: "refrigeration_intensity",
    candidateKey: "refrigerationIntensity",
    text: "What extra refrigeration should be included?",
    why: "Extra refrigerators and freezers add steady background load.",
    priority: "medium",
    factKeys: ["refrigerationIntensity"],
    isRelevant: (facts) => facts.hasExtraRefrigeration === true && !facts.refrigerationIntensity,
    options: [
      option("one_extra", "One extra refrigerator or freezer", { refrigerationIntensity: "one_extra" }),
      option("multiple_extra", "Multiple extra units", { refrigerationIntensity: "multiple_extra" }),
      option("older_or_heavy", "Older or heavy-running unit", { refrigerationIntensity: "heavy" }),
    ],
  }),
  question({
    id: "well_pump_use",
    candidateKey: "wellPumpUse",
    text: "How should well pump use be represented?",
    why: "Well pump usage can add intermittent load tied to water use.",
    priority: "medium",
    factKeys: ["wellPumpUse"],
    isRelevant: (facts) => facts.hasWellPump === true && !facts.wellPumpUse,
    options: [
      option("household", "Normal household water use", { wellPumpUse: "household" }),
      option("irrigation", "Includes irrigation or high water use", { wellPumpUse: "irrigation" }),
      option("unknown", "Not sure", { wellPumpUse: "unknown" }),
    ],
  }),
  question({
    id: "sump_pump_frequency",
    candidateKey: "sumpPumpFrequency",
    text: "How often does the sump or sewage pump run?",
    why: "Pump frequency changes whether this is a background assumption or a distinct load.",
    priority: "medium",
    factKeys: ["sumpPumpFrequency"],
    isRelevant: (facts) => facts.hasSumpPump === true && !facts.sumpPumpFrequency,
    options: [
      option("rare", "Rarely or storms only", { sumpPumpFrequency: "rare" }),
      option("seasonal", "Seasonally", { sumpPumpFrequency: "seasonal" }),
      option("frequent", "Frequently", { sumpPumpFrequency: "frequent" }),
    ],
  }),
  question({
    id: "dehumidifier_use",
    candidateKey: "dehumidifierUse",
    text: "How does the dehumidifier usually run?",
    why: "Dehumidifiers can add seasonal or year-round background load.",
    priority: "medium",
    factKeys: ["dehumidifierSeasonality"],
    isRelevant: (facts) => facts.hasDehumidifier === true && !facts.dehumidifierSeasonality,
    options: [
      option("seasonal", "Seasonally", { dehumidifierSeasonality: "seasonal" }),
      option("year_round", "Year-round", { dehumidifierSeasonality: "year_round" }),
      option("occasional", "Occasionally", { dehumidifierSeasonality: "occasional" }),
    ],
  }),
  question({
    id: "dishwasher_schedule",
    candidateKey: "dishwasherSchedule",
    text: "When does the dishwasher usually run?",
    why: "Dishwasher timing can add a moderate evening or overnight appliance load.",
    priority: "medium",
    factKeys: ["dishwasherSchedule"],
    isRelevant: (facts) => hasValue(facts.dishwasherFrequency) && !facts.dishwasherSchedule,
    options: [
      option("after_dinner", "After dinner", { dishwasherSchedule: "evening" }),
      option("overnight", "Overnight", { dishwasherSchedule: "overnight" }),
      option("daytime", "During the day", { dishwasherSchedule: "daytime" }),
    ],
  }),
  question({
    id: "hvac_season_use",
    candidateKey: "hvacSeasonUse",
    text: "When does HVAC affect the home most?",
    why: "Seasonal heating and cooling emphasis shapes the daily profile.",
    priority: "medium",
    factKeys: ["hvacSeasonUse"],
    isRelevant: (facts) => (hasValue(facts.hvacType) || facts.cooling === true) && !facts.hvacSeasonUse,
    options: [
      option("summer", "Mostly summer cooling", { hvacSeasonUse: "summer_cooling" }),
      option("winter", "Mostly winter heating", { hvacSeasonUse: "winter_heating" }),
      option("both", "Both heating and cooling seasons", { hvacSeasonUse: "both" }),
    ],
  }),
]);

const getAnsweredQuestionIds = (request = {}) => new Set(toArray(request.answers).map((answer) => String(answer.questionId || answer.id || "")).filter(Boolean));

const getRelevantQuestions = (facts = {}) => QUESTION_CATALOG.filter((item) => item.isRelevant(facts));
const getUnresolvedQuestions = (facts = {}, answeredIds = new Set()) =>
  getRelevantQuestions(facts).filter((item) => !item.isResolved(facts) && !answeredIds.has(item.id));

const buildDeterministicProgress = ({ facts = {}, request = {} } = {}) => {
  const answeredIds = getAnsweredQuestionIds(request);
  const relevant = getRelevantQuestions(facts);
  const totalWeight = relevant.reduce((sum, item) => sum + item.weight, 0);
  const remainingWeight = getUnresolvedQuestions(facts, answeredIds).reduce((sum, item) => sum + item.weight, 0);
  const rawProgress = totalWeight ? Math.round(((totalWeight - remainingWeight) / totalWeight) * 100) : 100;
  const priorProgress = Number(request.interviewState?.progressPercent || 0);
  const progressPercent = Math.max(0, Math.min(100, Math.max(rawProgress, Number.isFinite(priorProgress) ? priorProgress : 0)));
  return {
    progressPercent,
    remainingQuestionWeight: remainingWeight,
    totalQuestionWeight: totalWeight,
  };
};

const selectNextDeterministicQuestion = ({ facts = {}, request = {} } = {}) => {
  const answeredIds = getAnsweredQuestionIds(request);
  const unresolved = getUnresolvedQuestions(facts, answeredIds).sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return QUESTION_CATALOG.indexOf(a) - QUESTION_CATALOG.indexOf(b);
  });
  return unresolved[0] ? createQuestionPayload(unresolved[0]) : null;
};

module.exports = {
  QUESTION_CATALOG,
  PRIORITY_WEIGHTS,
  buildDeterministicProgress,
  createQuestionPayload,
  selectNextDeterministicQuestion,
};
