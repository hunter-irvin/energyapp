const { DEFAULT_EV_EFFICIENCY_KWH_PER_MILE, normalizeFacts, normalizeFactPatch } = require("./assistant-schema");
const { getGuideTier } = require("./interview-guide");
const { QUESTION_CATALOG, buildDeterministicProgress } = require("./question-catalog");

const toArray = (value) => (Array.isArray(value) ? value : []);
const cleanText = (value) => String(value || "").trim();
const hasFactValue = (value) => value != null && value !== "";
const mergeFacts = (...sources) =>
  sources.reduce((merged, source, index) => ({ ...merged, ...(index === 0 ? normalizeFacts(source) : normalizeFactPatch(source)) }), {});

const inferFactsFromDescription = (description = "") => {
  const text = cleanText(description).toLowerCase();
  const facts = {};
  const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const parseCount = (value) => Number(value) || numberWords[String(value || "").toLowerCase()] || 0;
  const sqftMatch = text.match(/(\d{1,2},?\d{3}|\d{3,5})\s*(?:sq\.?\s*ft|sqft|square\s*feet|sf)\b/);
  if (sqftMatch) facts.squareFeet = Number(String(sqftMatch[1]).replace(/,/g, ""));
  const occupantMatch = text.match(/\b(\d+|one|two|three|four|five|six)\s*(?:people|occupants|residents|person household|person home|person family|people household)\b/);
  if (occupantMatch) facts.occupants = parseCount(occupantMatch[1]);
  const evMatch = text.match(/\b(\d+|one|two|three|four)\s*(?:evs|electric vehicles|electric cars|teslas|rivians)\b/);
  if (evMatch) facts.evCount = parseCount(evMatch[1]);
  else if (/\bev\b|electric vehicle|electric car|tesla|rivian|mustang mach-e|bolt|leaf/.test(text)) facts.evCount = 1;
  if (facts.evCount > 0) facts.hasEv = true;
  if (/single[-\s]*family|house|home|residential|apartment|condo|townhome/.test(text)) facts.projectType = "residential";
  if (/commercial|office|retail|restaurant|store\b/.test(text)) facts.projectType = "commercial";
  if (/industrial|factory|warehouse|manufacturing|process load/.test(text)) facts.projectType = "industrial";
  if (/work from home|wfh|home office|remote work/.test(text)) facts.occupancy = "work_from_home";
  if (/electric water heater|electric hot water|heat pump water heater/.test(text)) facts.waterHeating = "electric";
  else if (/gas water heater|natural gas water/.test(text)) facts.waterHeating = "gas";
  if (/heat pump/.test(text)) {
    facts.hvacType = "heat_pump";
    facts.hvacPresence = true;
  }
  else if (/electric resistance|electric heat/.test(text)) {
    facts.hvacType = "electric_resistance";
    facts.hvacPresence = true;
  } else if (/gas furnace|natural gas heat|forced[-\s]*air/.test(text)) {
    facts.hvacType = "gas_forced_air";
    facts.hvacPresence = true;
  }
  if (/air conditioning|a\/c| ac |cooling/.test(` ${text} `)) {
    facts.cooling = true;
    facts.hvacPresence = true;
  }
  if (/pool pump|swimming pool| pool\b/.test(text)) {
    facts.hasPoolPump = true;
    facts.hasPoolOrHotTub = true;
  }
  if (/hot tub|spa\b|jacuzzi/.test(text)) {
    facts.hasHotTubSpa = true;
    facts.hasPoolOrHotTub = true;
  }
  if (/electric (?:stove|oven|range|cooktop)|induction|electric cooking/.test(text)) facts.electricCooking = true;
  else if (/gas (?:stove|oven|range|cooktop)|gas cooking/.test(text)) facts.electricCooking = false;
  if (/electric dryer/.test(text)) facts.dryerType = "electric";
  else if (/gas dryer/.test(text)) facts.dryerType = "gas";
  if (/well pump|private well/.test(text)) facts.hasWellPump = true;
  if (/no well pump|city water|municipal water/.test(text)) facts.hasWellPump = false;
  if (/sump pump|sewage pump|ejector pump/.test(text)) facts.hasSumpPump = true;
  if (/no sump pump|no sewage pump|no ejector pump/.test(text)) facts.hasSumpPump = false;
  if (/dehumidifier/.test(text)) facts.hasDehumidifier = true;
  if (/no dehumidifier/.test(text)) facts.hasDehumidifier = false;
  if (/extra (?:fridge|refrigerator|freezer)|garage (?:fridge|refrigerator|freezer)|chest freezer|wine fridge|beverage fridge/.test(text)) {
    facts.hasExtraRefrigeration = true;
  }
  if (/led lighting|mostly led/.test(text)) facts.lightingType = "led";
  else if (/incandescent|halogen/.test(text)) facts.lightingType = "legacy";
  if (/overnight|at night|night charging/.test(text)) facts.evChargingSchedule = "overnight";
  if (/stagger/.test(text)) facts.evChargingConcurrency = "staggered";
  if (/same time|simultaneous|both charge/.test(text)) facts.evChargingConcurrency = "simultaneous";
  const chargerKwMatch = text.match(/(\d+(?:\.\d+)?)\s*kw\b\s*(?:ev\s*)?(?:charger|charging|level\s*[123])?/);
  if (/dc fast|level\s*3|lvl\s*3/.test(text)) {
    facts.evChargerLevel = "dc_fast";
    facts.evChargerPeakKw = chargerKwMatch ? Number(chargerKwMatch[1]) : 50;
  } else if (/level\s*1|lvl\s*1|120v|120 volt|wall outlet|regular outlet/.test(text)) {
    facts.evChargerLevel = "level_1";
    facts.evChargerPeakKw = 1.4;
  } else if (/48\s*amp|48a|11\.5\s*kw|high[-\s]*power level\s*2/.test(text)) {
    facts.evChargerLevel = "level_2_high_power";
    facts.evChargerPeakKw = chargerKwMatch ? Number(chargerKwMatch[1]) : 11.5;
  } else if (/level\s*2|lvl\s*2|240v|240 volt|installed charger|charging station/.test(text)) {
    facts.evChargerLevel = "level_2_typical";
    facts.evChargerPeakKw = chargerKwMatch ? Number(chargerKwMatch[1]) : 7.2;
  } else if (chargerKwMatch && (facts.hasEv || /ev|electric vehicle|electric car|charger|charging/.test(text))) {
    facts.evChargerLevel = "custom";
    facts.evChargerPeakKw = Number(chargerKwMatch[1]);
  }
  const kwhMatch = text.match(/(\d+(?:\.\d+)?)\s*kwh(?:\/night| per night| nightly)?/);
  if (kwhMatch) facts.evAverageNightlyKwh = Number(kwhMatch[1]);
  const milesMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:miles|mi)(?:\/day| per day| daily)?/);
  if (milesMatch) facts.evDailyMiles = Number(milesMatch[1]);
  return normalizeFacts(facts);
};

const buildKnownFacts = (request = {}) => {
  const initialFacts = mergeFacts(inferFactsFromDescription(request.description), request.facts);
  const answerFacts = toArray(request.answers).reduce((merged, answer) => {
    const selectedOptionIds = toArray(answer.selectedOptionIds);
    const questionId = String(answer.questionId || answer.id || "");
    const completionFacts = {};
    if (questionId === "major_load_screen" || selectedOptionIds.some((id) => ["hvac_ev_water", "pool_spa_laundry", "few_major_loads", "hvac", "ev", "pool_spa", "electric_cooking", "electric_dryer"].includes(id))) {
      Object.assign(completionFacts, {
        majorLoadScreenComplete: true,
      });
      if (!hasFactValue(merged.hvacPresence)) completionFacts.hvacPresence = false;
      if (!hasFactValue(merged.hasEv)) completionFacts.hasEv = false;
      if (!hasFactValue(merged.hasPoolOrHotTub)) completionFacts.hasPoolOrHotTub = false;
      if (!hasFactValue(merged.hasPoolPump)) completionFacts.hasPoolPump = false;
      if (!hasFactValue(merged.hasHotTubSpa)) completionFacts.hasHotTubSpa = false;
      if (!hasFactValue(merged.electricCooking)) completionFacts.electricCooking = false;
      if (!hasFactValue(merged.dryerType)) completionFacts.dryerType = "non_electric_or_none";
    }
    if (questionId === "medium_load_screen" || selectedOptionIds.some((id) => ["office_extra_fridge", "pumps_dehumidifier", "typical_medium_loads", "home_office", "extra_refrigeration", "dishwasher_laundry", "heavy_plug_lighting"].includes(id))) {
      Object.assign(completionFacts, {
        mediumLoadScreenComplete: true,
      });
      if (!hasFactValue(merged.hasExtraRefrigeration)) completionFacts.hasExtraRefrigeration = false;
      if (!hasFactValue(merged.hasWellPump)) completionFacts.hasWellPump = false;
      if (!hasFactValue(merged.hasSumpPump)) completionFacts.hasSumpPump = false;
      if (!hasFactValue(merged.hasDehumidifier)) completionFacts.hasDehumidifier = false;
    }
    return mergeFacts(merged, completionFacts, answer.value);
  }, initialFacts);
  return mergeFacts(initialFacts, answerFacts);
};

const getClimateBucket = (location = {}) => {
  const lat = Number(location.lat);
  if (!Number.isFinite(lat)) return "unknown";
  const absLat = Math.abs(lat);
  if (absLat < 28) return "hot";
  if (absLat > 43) return "cold";
  return "mixed";
};

const buildCandidate = (key, priority, reason) => ({ key, priority, reason });

const hasAnyFact = (facts, keys) => toArray(keys).some((key) => hasFactValue(facts[key]));
const isMentioned = (facts, keys) => hasAnyFact(facts, keys);

const scoreResidentialUncertainties = (facts = {}, location = {}) => {
  const candidates = [];
  if (!facts.projectType) candidates.push(buildCandidate("projectType", 100, "Project type determines which load templates are valid."));
  if (facts.projectType && facts.projectType !== "residential") return candidates;
  const majorLoads = getGuideTier("major");
  const mediumLoads = getGuideTier("medium");
  const unknownMajorLoads = majorLoads.filter((load) => !hasAnyFact(facts, load.factKeys));
  const unknownMediumLoads = mediumLoads.filter((load) => !hasAnyFact(facts, load.factKeys));
  if (!facts.majorLoadScreenComplete && unknownMajorLoads.length >= 4) {
    candidates.push(buildCandidate("majorLoadScreen", 86, "A bundled screen can quickly identify which major electric loads belong in the whole-home profile."));
  }
  if (!facts.squareFeet) candidates.push(buildCandidate("squareFeet", 80, "Home size affects base load, lighting, and HVAC sizing."));
  if (facts.hvacPresence == null && !facts.hvacType && facts.cooling == null) {
    candidates.push(buildCandidate("hvacType", 78, "Heating and cooling equipment can dominate residential load shape."));
  } else if (facts.hvacPresence && !facts.hvacType && facts.cooling == null) {
    candidates.push(buildCandidate("hvacType", 62, "HVAC is present, and the type controls whether heating, cooling, or fan loads should be modeled."));
  }
  if (facts.hasEv || facts.evCount > 0) {
    if (!facts.evCount) candidates.push(buildCandidate("evCount", 72, "EV count directly changes charging energy and possible peak."));
    if (!facts.evAverageNightlyKwh && !facts.evDailyMiles && facts.evEnergyKnown === true) {
      candidates.push(buildCandidate("evAverageNightlyKwh", 70, "Average nightly EV charging kWh directly calibrates EV energy."));
    } else if (!facts.evAverageNightlyKwh && !facts.evDailyMiles && /daily_miles/.test(String(facts.evEnergyEstimateMode || ""))) {
      candidates.push(buildCandidate("evDailyMiles", 70, "Daily EV miles can estimate charging energy when nightly kWh is unknown."));
    } else if (!facts.evAverageNightlyKwh && !facts.evDailyMiles && facts.evEnergyEstimateMode !== "conservative_default_estimate") {
      candidates.push(buildCandidate("evEnergy", 70, "Average EV charging energy gives a better profile than assuming a default."));
    }
    if (!facts.evChargerPeakKw && facts.evChargerLevel !== "unknown") {
      candidates.push(buildCandidate("evChargerLevel", 69, "Charger level changes EV peak demand and charging duration."));
    }
    if (facts.evChargerLevel === "unknown" && !facts.evChargerPeakKw) {
      candidates.push(buildCandidate("evChargerClue", 69, "A simple clue can estimate EV charging peak when the exact charger level is unknown."));
    }
    if (facts.evCount > 1 && !facts.evChargingConcurrency) {
      candidates.push(buildCandidate("evChargingConcurrency", 68, "Multi-EV charging can change peak if vehicles charge simultaneously."));
    }
    if (!facts.evChargingSchedule) candidates.push(buildCandidate("evChargingSchedule", 64, "Charging time changes the daily load shape."));
  } else if (facts.hasEv == null && /residential|^$/.test(String(facts.projectType || "residential"))) {
    candidates.push(buildCandidate("evPresence", 55, "EV charging is a major optional residential load."));
  }
  if (!facts.waterHeating) candidates.push(buildCandidate("waterHeating", 48, "Electric water heating adds morning and evening peaks."));
  if (facts.hasPoolOrHotTub && !facts.hasPoolPump && !facts.hasHotTubSpa) {
    candidates.push(buildCandidate("poolOrHotTubType", 67, "Pool and hot tub loads differ, so the assistant should clarify which one is present."));
  }
  if (facts.hasPoolPump && !facts.poolPumpHours) candidates.push(buildCandidate("poolPumpSchedule", 66, "Pool pump hours and schedule can add a large recurring daily load."));
  if (facts.hasHotTubSpa && !facts.hotTubUse) candidates.push(buildCandidate("hotTubUse", 63, "Hot tub operating mode and use frequency can materially change daily energy."));
  if (facts.electricCooking == null) candidates.push(buildCandidate("electricCooking", 46, "Electric cooking can add a meaningful dinner-time peak."));
  if (!facts.dryerType) candidates.push(buildCandidate("dryerType", 44, "An electric dryer adds a high short-duration load on laundry days."));
  if (!facts.occupancy) candidates.push(buildCandidate("occupancy", 42, "Daytime occupancy changes plug loads and HVAC use."));
  if (!facts.occupants) candidates.push(buildCandidate("occupants", 32, "Occupants affect water heating, cooking, and appliance usage."));
  if (!facts.mediumLoadScreenComplete && unknownMediumLoads.length >= 5) {
    candidates.push(buildCandidate("mediumLoadScreen", 40, "A bundled screen can identify medium loads that materially shape the whole-home profile."));
  }
  if (facts.occupancy === "work_from_home" && !facts.homeOfficeIntensity) {
    candidates.push(buildCandidate("homeOfficeIntensity", 38, "Work-from-home equipment can add a weekday daytime load."));
  }
  if (facts.hasWellPump && !facts.wellPumpUse) candidates.push(buildCandidate("wellPumpUse", 36, "Well pump usage can add intermittent load tied to water use."));
  if (facts.hasDehumidifier && !facts.dehumidifierSeasonality) candidates.push(buildCandidate("dehumidifierUse", 34, "Dehumidifiers can add seasonal or year-round background load."));
  const climate = getClimateBucket(location);
  if (climate !== "unknown" && (facts.hvacType || facts.cooling) && !facts.hvacSeasonUse) {
    candidates.push(buildCandidate("hvacSeasonUse", 36, `The ${climate} climate affects whether heating, cooling, or both matter most.`));
  }
  return candidates.sort((a, b) => b.priority - a.priority);
};

const buildInterviewState = (request = {}) => {
  const facts = buildKnownFacts(request);
  const answeredQuestionIds = toArray(request.answers).map((answer) => String(answer.questionId || answer.id || "")).filter(Boolean);
  const answeredSet = new Set(answeredQuestionIds);
  const deterministicCandidates = QUESTION_CATALOG
    .filter((item) => item.isRelevant(facts) && !item.isResolved(facts) && !answeredSet.has(item.id))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return QUESTION_CATALOG.indexOf(a) - QUESTION_CATALOG.indexOf(b);
    });
  const nextQuestionCandidates = deterministicCandidates.slice(0, 5).map((item) => ({
    key: item.candidateKey,
    questionId: item.id,
    priority: item.priority === "high" ? 90 : 40,
    weight: item.weight,
    reason: item.why,
  }));
  const questionsAsked = Number(request.interviewState?.questionsAsked || request.answers?.length || 0);
  const progress = buildDeterministicProgress({ facts, request });
  const remainingUncertaintyScore = Math.round((1 - progress.progressPercent / 100) * 360);
  const recommendedStop = Boolean(request.forceGenerate || deterministicCandidates.length === 0);
  return {
    facts,
    climateBucket: getClimateBucket(request.projectLocation),
    questionsAsked,
    recommendedStop,
    remainingUncertaintyScore,
    progressPercent: progress.progressPercent,
    remainingQuestionWeight: progress.remainingQuestionWeight,
    totalQuestionWeight: progress.totalQuestionWeight,
    answeredQuestionIds,
    completedCandidateKeys: QUESTION_CATALOG.filter((item) => item.isRelevant(facts) && item.isResolved(facts)).map((item) => item.candidateKey),
    nextQuestionCandidates,
    evEfficiencyFallbackKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE,
  };
};

module.exports = {
  inferFactsFromDescription,
  buildKnownFacts,
  getClimateBucket,
  scoreResidentialUncertainties,
  buildInterviewState,
};
