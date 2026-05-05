const assert = require("assert");
const path = require("path");

const loadBuilder = require(path.join(__dirname, "..", "public", "assets", "js", "features", "load-builder.js"));
const {
  validateAssistantRequest,
  validateAssistantResponse,
  assistantFollowupJsonSchema,
  normalizeFactPatch,
  DEFAULT_EV_EFFICIENCY_KWH_PER_MILE,
  MAX_DESCRIPTION_LENGTH,
  MAX_ANSWERS,
} = require(path.join(__dirname, "..", "lib", "load-profile-assistant", "assistant-schema.js"));
const { buildInterviewState } = require(path.join(__dirname, "..", "lib", "load-profile-assistant", "fact-state.js"));
const { INTERVIEW_GUIDE } = require(path.join(__dirname, "..", "lib", "load-profile-assistant", "interview-guide.js"));
const {
  QUESTION_CATALOG,
  buildDeterministicProgress,
  selectNextDeterministicQuestion,
} = require(path.join(__dirname, "..", "lib", "load-profile-assistant", "question-catalog.js"));
const { buildAssistantTemplateCatalog, getAllowedTemplateIds } = require(path.join(
  __dirname,
  "..",
  "lib",
  "load-profile-assistant",
  "template-catalog.js"
));
const {
  createAssistantTurn,
  sanitizeDiagnosticMessage,
  buildOpenAiRequestBody,
  buildFallbackQuestion,
  DEFAULT_FOLLOWUP_MODEL,
  DEFAULT_PROPOSAL_MODEL,
} = require(path.join(
  __dirname,
  "..",
  "lib",
  "load-profile-assistant",
  "assistant-handler.js"
));

const runAiAssistantTests = async () => {
  const requestValidation = validateAssistantRequest({
    profileName: "Home",
    description: "2500 sq ft single-family home with 2 EVs, electric water heater, and work from home.",
    projectLocation: { lat: 34, lng: -118 },
  });
  assert.strictEqual(requestValidation.ok, true);
  assert.strictEqual(requestValidation.request.profileName, "Home");

  const oversizedDescription = validateAssistantRequest({
    profileName: "Home",
    description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
  });
  assert.strictEqual(oversizedDescription.ok, false);
  assert.ok(oversizedDescription.errors.includes("Description is too long."));

  const tooManyAnswers = validateAssistantRequest({
    profileName: "Home",
    description: "Small home.",
    answers: Array.from({ length: MAX_ANSWERS + 1 }, (_item, index) => ({ questionId: `q${index}` })),
  });
  assert.strictEqual(tooManyAnswers.ok, false);
  assert.ok(tooManyAnswers.errors.includes("Too many assistant answers."));
  assert.strictEqual(sanitizeDiagnosticMessage("Authorization Bearer abc.def sk-test-secret"), "Authorization Bearer [redacted] [redacted]");

  const multiselectRequest = validateAssistantRequest({
    profileName: "Checklist Home",
    description: "",
    facts: {
      projectType: "residential",
      squareFeet: 1800,
      hvacPresence: true,
      hvacType: "heat_pump",
      cooling: true,
      hasEv: true,
      evCount: 1,
      evAverageNightlyKwh: 12,
      evChargingSchedule: "overnight",
      waterHeating: "gas",
      hasPoolOrHotTub: true,
      electricCooking: true,
      dryerType: "electric",
    },
    answers: [
      {
        questionId: "major_load_screen",
        optionId: "hvac,ev,pool_spa",
        selectedOptionIds: ["hvac", "ev", "pool_spa"],
        value: { hvacPresence: true, hasEv: true, hasPoolOrHotTub: true },
      },
    ],
  });
  assert.strictEqual(multiselectRequest.ok, true);
  assert.deepStrictEqual(multiselectRequest.request.answers[0].selectedOptionIds, ["hvac", "ev", "pool_spa"]);
  assert.strictEqual(multiselectRequest.request.facts.hvacPresence, true);
  assert.strictEqual(multiselectRequest.request.facts.hasPoolOrHotTub, true);
  assert.deepStrictEqual(normalizeFactPatch({ hvacPresence: null, hasEv: true, dryerType: "", waterHeating: "electric" }), {
    hasEv: true,
    waterHeating: "electric",
  });

  const interviewState = buildInterviewState(requestValidation.request);
  assert.strictEqual(interviewState.facts.projectType, "residential");
  assert.strictEqual(interviewState.facts.squareFeet, 2500);
  assert.strictEqual(interviewState.facts.evCount, 2);
  assert.strictEqual(interviewState.facts.waterHeating, "electric");
  assert.ok(interviewState.nextQuestionCandidates.some((candidate) => candidate.key === "hvacType"));
  assert.ok(!interviewState.nextQuestionCandidates.some((candidate) => candidate.key === "squareFeet"));

  const sqftState = buildInterviewState({
    profileName: "Sqft Home",
    description: "2200 sqft home with heat pump and electric water heater.",
  });
  assert.strictEqual(sqftState.facts.squareFeet, 2200);
  assert.ok(!sqftState.nextQuestionCandidates.some((candidate) => candidate.key === "squareFeet"));

  const forcedAirState = buildInterviewState({
    profileName: "Gas Heat Home",
    description: "2500 sq ft single-family home with gas forced-air heat.",
  });
  assert.strictEqual(forcedAirState.facts.hvacType, "gas_forced_air");

  assert.strictEqual(INTERVIEW_GUIDE.strategy.profileScope, "whole_home");
  assert.strictEqual(INTERVIEW_GUIDE.strategy.allowBundledQuestions, true);
  assert.ok(INTERVIEW_GUIDE.tiers.major.length >= 10);
  assert.ok(INTERVIEW_GUIDE.tiers.medium.length >= 10);
  assert.ok(INTERVIEW_GUIDE.tiers.minor.length >= 5);
  assert.ok(INTERVIEW_GUIDE.tiers.major.every((load) => load.clarifications.length > 0 && load.clarifications.length <= 3));
  assert.ok(INTERVIEW_GUIDE.tiers.medium.every((load) => load.clarifications.length > 0 && load.clarifications.length <= 3));
  assert.ok(QUESTION_CATALOG.length >= 20);
  QUESTION_CATALOG.forEach((catalogQuestion) => {
    assert.ok(catalogQuestion.id);
    assert.ok(catalogQuestion.candidateKey);
    assert.ok(catalogQuestion.text);
    assert.ok(catalogQuestion.why);
    assert.ok(["single", "multiple"].includes(catalogQuestion.selectionType));
    assert.ok(["high", "medium"].includes(catalogQuestion.priority));
    assert.ok(catalogQuestion.weight > 0);
    assert.strictEqual(typeof catalogQuestion.isRelevant, "function");
    assert.strictEqual(typeof catalogQuestion.isResolved, "function");
    assert.ok(catalogQuestion.options.length >= 2 && catalogQuestion.options.length <= 6);
    catalogQuestion.options.forEach((catalogOption) => {
      assert.ok(catalogOption.id);
      assert.ok(catalogOption.label);
      assert.ok(catalogOption.value && typeof catalogOption.value === "object");
    });
  });
  assert.strictEqual(QUESTION_CATALOG.find((item) => item.id === "square_feet").weight, 3);
  assert.strictEqual(QUESTION_CATALOG.find((item) => item.id === "occupancy").weight, 1);
  assert.strictEqual(QUESTION_CATALOG.find((item) => item.id === "ev_charger_level").options.find((item) => item.id === "dc_fast").value.evChargerPeakKw, 50);
  assert.strictEqual(QUESTION_CATALOG.find((item) => item.id === "ev_charger_clue").options.find((item) => item.id === "still_not_sure").value.evChargerPeakKw, 7.2);
  const profileControlledFacts = new Set([
    "projectType",
    "homeType",
    "squareFeet",
    "occupants",
    "occupancy",
    "hasEv",
    "evCount",
    "evAverageNightlyKwh",
    "evDailyMiles",
    "evChargerPeakKw",
    "evChargerLevel",
    "evChargerClue",
    "evEnergyEstimateMode",
    "evChargingConcurrency",
    "evChargingSchedule",
    "waterHeating",
    "hvacType",
    "hvacPresence",
    "hvacSeasonUse",
    "cooling",
    "electricCooking",
    "hasPoolPump",
    "hasPoolOrHotTub",
    "poolPumpHours",
    "poolSeasonality",
    "hasHotTubSpa",
    "hotTubUse",
    "cookingFrequency",
    "dryerType",
    "laundryLoads",
    "laundrySchedule",
    "plugLoadIntensity",
    "lightingType",
    "hasExtraRefrigeration",
    "refrigerationIntensity",
    "dishwasherSchedule",
    "homeOfficeIntensity",
    "hasWellPump",
    "wellPumpUse",
    "hasSumpPump",
    "sumpPumpFrequency",
    "hasDehumidifier",
    "dehumidifierSeasonality",
    "majorLoadScreenComplete",
    "mediumLoadScreenComplete",
  ]);
  const catalogFactKeys = Array.from(new Set(QUESTION_CATALOG.flatMap((item) => item.factKeys)));
  assert.deepStrictEqual(catalogFactKeys.filter((key) => !profileControlledFacts.has(key)), []);

  const sparseState = buildInterviewState({
    profileName: "Sparse Home",
    description: "Residential home.",
  });
  assert.ok(sparseState.nextQuestionCandidates.some((candidate) => candidate.key === "majorLoadScreen"));
  assert.ok(sparseState.nextQuestionCandidates.findIndex((candidate) => candidate.key === "majorLoadScreen") < sparseState.nextQuestionCandidates.findIndex((candidate) => candidate.key === "waterHeating"));

  const checklistState = buildInterviewState(multiselectRequest.request);
  assert.strictEqual(checklistState.facts.projectType, "residential");
  assert.strictEqual(checklistState.facts.hvacPresence, true);
  assert.strictEqual(checklistState.facts.hasEv, true);
  assert.strictEqual(checklistState.facts.hasPoolOrHotTub, true);
  assert.strictEqual(checklistState.facts.electricCooking, true);
  assert.strictEqual(checklistState.facts.dryerType, "electric");
  assert.ok(!checklistState.nextQuestionCandidates.some((candidate) => candidate.key === "majorLoadScreen"));
  assert.ok(checklistState.nextQuestionCandidates.some((candidate) => candidate.key === "poolOrHotTubType"));

  const evOnlyChecklistState = buildInterviewState({
    profileName: "EV Only Checklist Home",
    description: "Charging is usually overnight.",
    facts: {
      projectType: "residential",
      hvacPresence: false,
      hasEv: true,
      hasPoolOrHotTub: false,
      hasPoolPump: false,
      hasHotTubSpa: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
  });
  assert.ok(!evOnlyChecklistState.nextQuestionCandidates.some((candidate) => candidate.key === "majorLoadScreen"));
  assert.ok(!evOnlyChecklistState.nextQuestionCandidates.some((candidate) => candidate.key === "hvacType"));
  assert.ok(!evOnlyChecklistState.nextQuestionCandidates.some((candidate) => candidate.key === "poolOrHotTubType"));
  assert.ok(!evOnlyChecklistState.nextQuestionCandidates.some((candidate) => candidate.key === "electricCooking"));
  assert.ok(!evOnlyChecklistState.nextQuestionCandidates.some((candidate) => candidate.key === "dryerType"));
  assert.ok(evOnlyChecklistState.nextQuestionCandidates.some((candidate) => candidate.key === "evCount" || candidate.key === "evEnergy"));

  const evKnownKwhState = buildInterviewState({
    profileName: "EV Known Kwh Home",
    description: "EV charging is usually overnight.",
    facts: {
      projectType: "residential",
      hvacPresence: false,
      hasEv: true,
      evCount: 1,
      squareFeet: 1800,
      hasPoolOrHotTub: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
    answers: [{ questionId: "ev_energy", optionId: "know_kwh", value: { evEnergyKnown: true, evEnergyEstimateMode: "nightly_kwh_known" } }],
  });
  assert.ok(evKnownKwhState.nextQuestionCandidates.some((candidate) => candidate.key === "evAverageNightlyKwh"));
  assert.ok(!evKnownKwhState.nextQuestionCandidates.some((candidate) => candidate.key === "evEnergy"));

  const evTypicalEstimateState = buildInterviewState({
    profileName: "EV Typical Estimate Home",
    description: "EV charging is usually overnight.",
    facts: {
      projectType: "residential",
      hvacPresence: false,
      hasEv: true,
      evCount: 1,
      squareFeet: 1800,
      hasPoolOrHotTub: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
    answers: [
      {
        questionId: "ev_energy",
        optionId: "typical",
        value: { evEnergyKnown: false, evEnergyEstimateMode: "conservative_default_estimate", evEfficiencyKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE },
      },
    ],
  });
  assert.ok(!evTypicalEstimateState.nextQuestionCandidates.some((candidate) => candidate.key === "evEnergy"));
  assert.ok(!evTypicalEstimateState.nextQuestionCandidates.some((candidate) => candidate.key === "evAverageNightlyKwh"));

  const evChargerLevelState = buildInterviewState({
    profileName: "EV Charger Level Home",
    description: "1800 sq ft residential home with one EV and 12 kWh nightly charging.",
    facts: {
      projectType: "residential",
      squareFeet: 1800,
      hvacPresence: false,
      hasEv: true,
      evCount: 1,
      evAverageNightlyKwh: 12,
      evChargingSchedule: "overnight",
      waterHeating: "gas",
      hasPoolOrHotTub: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
  });
  assert.ok(evChargerLevelState.nextQuestionCandidates.some((candidate) => candidate.key === "evChargerLevel"));

  const evChargerClueState = buildInterviewState({
    profileName: "EV Charger Clue Home",
    description: "1800 sq ft residential home with one EV and 12 kWh nightly charging.",
    facts: {
      projectType: "residential",
      squareFeet: 1800,
      hvacPresence: false,
      hasEv: true,
      evCount: 1,
      evAverageNightlyKwh: 12,
      evChargingSchedule: "overnight",
      waterHeating: "gas",
      hasPoolOrHotTub: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
    answers: [{ questionId: "ev_charger_level", optionId: "not_sure", value: { evChargerLevel: "unknown" } }],
  });
  assert.ok(evChargerClueState.nextQuestionCandidates.some((candidate) => candidate.key === "evChargerClue"));

  const evChargerTextState = buildInterviewState({
    profileName: "EV Charger Text Home",
    description: "2400 sq ft home with an EV using a 120V wall outlet charger.",
  });
  assert.strictEqual(evChargerTextState.facts.evChargerLevel, "level_1");
  assert.strictEqual(evChargerTextState.facts.evChargerPeakKw, 1.4);

  const nullPatchLoopState = buildInterviewState({
    profileName: "Null Patch Loop Home",
    description: "EV charging is usually overnight.",
    facts: {
      projectType: "residential",
      hvacPresence: false,
      hasEv: true,
      hasPoolOrHotTub: false,
      hasPoolPump: false,
      hasHotTubSpa: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
    answers: [
      {
        questionId: "water_heating",
        optionId: "electric",
        value: {
          hvacPresence: null,
          hasPoolOrHotTub: null,
          electricCooking: null,
          dryerType: null,
          waterHeating: "electric",
        },
      },
    ],
  });
  assert.strictEqual(nullPatchLoopState.facts.hvacPresence, false);
  assert.strictEqual(nullPatchLoopState.facts.hasPoolOrHotTub, false);
  assert.strictEqual(nullPatchLoopState.facts.electricCooking, false);
  assert.strictEqual(nullPatchLoopState.facts.dryerType, "non_electric_or_none");
  assert.strictEqual(nullPatchLoopState.facts.waterHeating, "electric");
  assert.ok(!nullPatchLoopState.nextQuestionCandidates.some((candidate) => candidate.key === "majorLoadScreen"));
  assert.ok(!nullPatchLoopState.nextQuestionCandidates.some((candidate) => candidate.key === "hvacType"));

  const mediumScreenLoopState = buildInterviewState({
    profileName: "Medium Screen Loop Home",
    description: "Residential home with EV charging overnight.",
    facts: {
      projectType: "residential",
      hvacPresence: false,
      hasEv: true,
      hasPoolOrHotTub: false,
      hasPoolPump: false,
      hasHotTubSpa: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
      squareFeet: 1800,
      evCount: 1,
      evAverageNightlyKwh: 10,
      waterHeating: "gas",
      occupancy: "away_weekdays",
    },
    answers: [
      {
        questionId: "medium_load_screen",
        selectedOptionIds: ["typical_medium_loads"],
        value: {
          plugLoadIntensity: "typical",
          lightingType: "typical",
          refrigerationIntensity: "typical",
        },
      },
    ],
  });
  assert.strictEqual(mediumScreenLoopState.facts.mediumLoadScreenComplete, true);
  assert.strictEqual(mediumScreenLoopState.facts.plugLoadIntensity, "typical");
  assert.ok(!mediumScreenLoopState.nextQuestionCandidates.some((candidate) => candidate.key === "mediumLoadScreen"));

  const mediumGateState = buildInterviewState({
    profileName: "Medium Gate Home",
    description: "1800 sq ft residential home.",
    facts: {
      projectType: "residential",
      squareFeet: 1800,
      hvacPresence: false,
      hasEv: false,
      waterHeating: "gas",
      hasPoolOrHotTub: false,
      hasPoolPump: false,
      hasHotTubSpa: false,
      electricCooking: false,
      dryerType: "non_electric_or_none",
      occupancy: "away_weekdays",
      occupants: 2,
    },
    answers: [
      {
        questionId: "medium_load_screen",
        selectedOptionIds: ["extra_refrigeration"],
        value: { hasExtraRefrigeration: true },
      },
    ],
  });
  assert.strictEqual(mediumGateState.facts.mediumLoadScreenComplete, true);
  assert.strictEqual(mediumGateState.facts.hasExtraRefrigeration, true);
  assert.strictEqual(mediumGateState.facts.hasWellPump, false);
  assert.strictEqual(mediumGateState.facts.hasSumpPump, false);
  assert.strictEqual(mediumGateState.facts.hasDehumidifier, false);
  assert.ok(mediumGateState.nextQuestionCandidates.some((candidate) => candidate.key === "refrigerationIntensity"));
  assert.ok(!mediumGateState.nextQuestionCandidates.some((candidate) => candidate.key === "wellPumpUse"));

  const repeatedQuestion = selectNextDeterministicQuestion({
    facts: { projectType: "residential", squareFeet: 1600 },
    request: { answers: [{ questionId: "square_feet", optionId: "medium", value: { squareFeet: 1600 } }] },
  });
  assert.notStrictEqual(repeatedQuestion.question.id, "square_feet");

  const progressBefore = buildDeterministicProgress({
    facts: { projectType: "residential" },
    request: { interviewState: { progressPercent: 0 } },
  });
  const progressAfter = buildDeterministicProgress({
    facts: { projectType: "residential", squareFeet: 1600 },
    request: { interviewState: { progressPercent: progressBefore.progressPercent } },
  });
  const progressAfterEmptyPatch = buildDeterministicProgress({
    facts: { projectType: "residential", squareFeet: 1600 },
    request: { interviewState: { progressPercent: progressAfter.progressPercent } },
  });
  assert.ok(progressAfter.progressPercent >= progressBefore.progressPercent);
  assert.ok(progressAfterEmptyPatch.progressPercent >= progressAfter.progressPercent);

  const firstQuestionFromTextState = buildInterviewState({
    profileName: "Declared Facts Home",
    description: "2,400 sq ft single-family home with two EVs, electric water heater, and a heat pump.",
  });
  assert.strictEqual(firstQuestionFromTextState.facts.squareFeet, 2400);
  assert.strictEqual(firstQuestionFromTextState.facts.evCount, 2);
  assert.strictEqual(firstQuestionFromTextState.facts.hvacType, "heat_pump");
  assert.strictEqual(firstQuestionFromTextState.facts.waterHeating, "electric");
  assert.ok(!firstQuestionFromTextState.nextQuestionCandidates.some((candidate) => candidate.key === "squareFeet"));
  assert.ok(!firstQuestionFromTextState.nextQuestionCandidates.some((candidate) => candidate.key === "evCount"));
  assert.ok(!firstQuestionFromTextState.nextQuestionCandidates.some((candidate) => candidate.key === "waterHeating"));

  const evCountFallbackQuestion = buildFallbackQuestion(
    {},
    { nextQuestionCandidates: [{ key: "evCount", reason: "EV count directly changes charging energy and possible peak." }] }
  );
  assert.strictEqual(evCountFallbackQuestion.question.id, "ev_count");
  assert.ok(!/daytime occupancy/i.test(evCountFallbackQuestion.question.text));

  const evKnownKwhFallbackQuestion = buildFallbackQuestion(
    {},
    { nextQuestionCandidates: [{ key: "evAverageNightlyKwh", reason: "Average nightly EV charging kWh directly calibrates EV energy." }] }
  );
  assert.strictEqual(evKnownKwhFallbackQuestion.question.id, "ev_average_nightly_kwh");

  const occupancyFallbackQuestion = buildFallbackQuestion(
    {},
    { nextQuestionCandidates: [{ key: "occupancy", reason: "Daytime occupancy changes plug loads and HVAC use." }] }
  );
  assert.strictEqual(occupancyFallbackQuestion.question.id, "occupancy");
  assert.ok(/Occupancy changes daytime loads|Daytime occupancy/.test(occupancyFallbackQuestion.question.why));

  const minorMentionState = buildInterviewState({
    profileName: "Minor Mention Home",
    description: "1800 sqft home with coffee maker, kettle, and smart home devices.",
  });
  assert.ok(!minorMentionState.nextQuestionCandidates.some((candidate) => /coffee|kettle|smart/i.test(candidate.key)));

  const catalog = buildAssistantTemplateCatalog();
  assert.ok(catalog.some((template) => template.templateId === "residential-furnace-fan"));
  assert.ok(catalog.some((template) => template.templateId === "residential-hot-tub-spa"));
  assert.ok(catalog.some((template) => template.templateId === "residential-well-pump"));
  assert.ok(catalog.some((template) => template.templateId === "residential-extra-refrigeration"));
  assert.ok(catalog.every((template) => template.category === "Residential"));

  const allowedTemplateIds = getAllowedTemplateIds();
  const responseValidation = validateAssistantResponse(
    {
      mode: "generate_profile",
      profileName: "AI Home",
      facts: { evCount: 2 },
      assumptions: ["Two EVs are included."],
      friendlyLoadList: ["EV Charging"],
      question: { id: "", text: "", why: "", options: [], allowCustomResponse: true },
      loads: [
        {
          templateId: "residential-ev-level-2",
          name: "EV Charging",
          peakKw: 7.2,
          reason: "Two EVs were identified.",
          assumption: "Charging uses the inferred efficiency.",
          modifiers: [
            { type: "ev_charging_profile", kwh: 18, peakKw: 7.2, value: "overnight", reason: "User estimate." },
          ],
        },
      ],
    },
    allowedTemplateIds
  );
  assert.strictEqual(responseValidation.ok, true);

  const followupValidation = validateAssistantResponse(
    {
      mode: "ask_followup",
      facts: { projectType: "residential" },
      question: {
        id: "major_load_screen",
        text: "Which major electric loads are present at the home?",
        why: "A bundled screen can quickly identify major daily loads.",
        selectionType: "multiple",
        options: [
          { id: "hvac_ev_water", label: "HVAC, EV charging, or electric water heating", value: { cooling: true, hasEv: true, waterHeating: "electric", dryerType: null } },
          { id: "pool_spa_laundry", label: "Pool, spa, electric cooking, or electric dryer", value: { hasPoolOrHotTub: true, electricCooking: true, dryerType: "electric", hvacPresence: null } },
        ],
        allowCustomResponse: true,
      },
    },
    allowedTemplateIds
  );
  assert.strictEqual(followupValidation.ok, true);
  assert.strictEqual(followupValidation.response.question.selectionType, "multiple");
  assert.strictEqual(followupValidation.response.question.options[0].value.dryerType, undefined);
  assert.strictEqual(followupValidation.response.question.options[1].value.hvacPresence, undefined);
  assert.deepStrictEqual(assistantFollowupJsonSchema.properties.mode.enum, ["ask_followup"]);
  assert.deepStrictEqual(assistantFollowupJsonSchema.properties.question.properties.selectionType.enum, ["single", "multiple"]);

  const followupBody = buildOpenAiRequestBody({
    request: requestValidation.request,
    interviewState,
    templateCatalog: catalog,
    turnType: "followup",
  });
  assert.strictEqual(followupBody.model, DEFAULT_FOLLOWUP_MODEL);
  assert.strictEqual(followupBody.reasoning.effort, "none");
  assert.strictEqual(followupBody.max_output_tokens, 2200);
  assert.strictEqual(followupBody.text.format.schema, assistantFollowupJsonSchema);
  const followupInput = JSON.stringify(followupBody.input);
  assert.ok(!followupInput.includes("templateCatalog"));
  assert.ok(followupInput.includes("interviewGuide"));
  assert.ok(followupInput.includes("whole-home"));
  assert.ok(followupInput.includes("Bundled checklist-style questions are allowed"));
  assert.ok(followupInput.includes("question.selectionType"));
  assert.ok(followupInput.includes("check any/all applicable options"));
  assert.ok(followupInput.includes("confirmed absences"));
  assert.ok(followupInput.length < 18000);

  const proposalBody = buildOpenAiRequestBody({
    request: { ...requestValidation.request, forceGenerate: true },
    interviewState: { ...interviewState, recommendedStop: true },
    templateCatalog: catalog,
    turnType: "proposal",
  });
  assert.strictEqual(proposalBody.model, DEFAULT_PROPOSAL_MODEL);
  assert.strictEqual(proposalBody.reasoning.effort, "none");
  assert.strictEqual(proposalBody.max_output_tokens, 3000);
  const proposalInput = JSON.stringify(proposalBody.input);
  assert.ok(proposalInput.includes("templateCatalog"));
  assert.ok(proposalInput.includes("interviewGuide"));
  assert.ok(proposalInput.includes("Fold ordinary Medium and Minor usage into baseline"));

  const unsupported = validateAssistantResponse(
    {
      ...responseValidation.response,
      loads: [{ ...responseValidation.response.loads[0], templateId: "not-a-template" }],
    },
    allowedTemplateIds
  );
  assert.strictEqual(unsupported.ok, false);

  const converted = loadBuilder.createProfileModelFromAssistantProposal(responseValidation.response, {
    idFactory: (_load, index) => `ai-${index}`,
  });
  assert.strictEqual(converted.rows.length, 1);
  assert.strictEqual(converted.rows[0].id, "ai-0");
  assert.strictEqual(converted.rows[0].aiAssisted, true);
  assert.strictEqual(converted.rows[0].aiReason, "Two EVs were identified.");
  assert.strictEqual(converted.rows[0].values.length, 96);
  assert.ok(Math.abs(loadBuilder.calculateDailyEnergyKwh(converted.rows[0].values) - 18) < 0.001);

  const makeEvProposal = (peakKw) => ({
    ...responseValidation.response,
    loads: [
      {
        templateId: "residential-ev-level-2",
        name: "EV Charging",
        peakKw,
        reason: "EV charging was identified.",
        assumption: "Charging uses declared charger peak.",
        modifiers: [{ type: "ev_charging_profile", kwh: 14, peakKw, value: "overnight", reason: "Size from charger level." }],
      },
    ],
  });
  const level1Rows = loadBuilder.createProfileModelFromAssistantProposal(makeEvProposal(1.4), { idFactory: () => "ev-l1" }).rows;
  const level2Rows = loadBuilder.createProfileModelFromAssistantProposal(makeEvProposal(7.2), { idFactory: () => "ev-l2" }).rows;
  const activeIntervals = (values) => values.filter((value) => value > 0.01).length;
  assert.ok(Math.abs(loadBuilder.calculateDailyEnergyKwh(level1Rows[0].values) - 14) < 0.001);
  assert.ok(Math.abs(loadBuilder.calculateDailyEnergyKwh(level2Rows[0].values) - 14) < 0.001);
  assert.ok(Math.max(...level1Rows[0].values) < Math.max(...level2Rows[0].values));
  assert.ok(activeIntervals(level1Rows[0].values) > activeIntervals(level2Rows[0].values));

  const poolFourHours = loadBuilder.createProfileModelFromAssistantProposal(
    {
      ...responseValidation.response,
      loads: [
        {
          templateId: "residential-pool-pump",
          name: "Pool Pump",
          peakKw: 1.5,
          reason: "Pool pump was identified.",
          assumption: "Pool pump runs daytime.",
          modifiers: [{ type: "hours", hours: 4, reason: "Runtime." }],
        },
      ],
    },
    { idFactory: () => "pool-4h" }
  ).rows[0];
  const poolEightHours = loadBuilder.createProfileModelFromAssistantProposal(
    {
      ...responseValidation.response,
      loads: [
        {
          templateId: "residential-pool-pump",
          name: "Pool Pump",
          peakKw: 1.5,
          reason: "Pool pump was identified.",
          assumption: "Pool pump runs daytime.",
          modifiers: [{ type: "hours", hours: 8, reason: "Runtime." }],
        },
      ],
    },
    { idFactory: () => "pool-8h" }
  ).rows[0];
  assert.ok(loadBuilder.calculateDailyEnergyKwh(poolEightHours.values) > loadBuilder.calculateDailyEnergyKwh(poolFourHours.values));

  const peakIndex = (values) => values.reduce((bestIndex, value, index, items) => (value > items[bestIndex] ? index : bestIndex), 0);
  const scheduledRow = (templateId, schedule) =>
    loadBuilder.createProfileModelFromAssistantProposal(
      {
        ...responseValidation.response,
        loads: [
          {
            templateId,
            name: templateId,
            peakKw: templateId === "residential-dishwasher" ? 1.5 : 5,
            reason: "Schedule test.",
            assumption: "Schedule test.",
            modifiers: [{ type: "schedule", value: schedule, reason: "Schedule test." }],
          },
        ],
      },
      { idFactory: () => `${templateId}-${schedule}` }
    ).rows[0];
  assert.notStrictEqual(peakIndex(scheduledRow("residential-clothes-dryer", "evening").values), peakIndex(scheduledRow("residential-clothes-dryer", "daytime").values));
  assert.notStrictEqual(peakIndex(scheduledRow("residential-dishwasher", "evening").values), peakIndex(scheduledRow("residential-dishwasher", "overnight").values));

  const stackedProfile = loadBuilder.createProfileModelFromAssistantProposal(
    {
      ...responseValidation.response,
      loads: [
        {
          templateId: "residential-base-load",
          name: "Base Household Load",
          peakKw: 0.4,
          reason: "Baseline.",
          assumption: "Baseline.",
          modifiers: [],
        },
        {
          templateId: "residential-lighting",
          name: "Lighting",
          peakKw: 0.8,
          reason: "Lighting.",
          assumption: "Lighting.",
          modifiers: [],
        },
        {
          templateId: "residential-clothes-dryer",
          name: "Dryer",
          peakKw: 5,
          reason: "Dryer.",
          assumption: "Dryer.",
          modifiers: [],
        },
        {
          templateId: "residential-ev-level-2",
          name: "EV Level 1 Charging",
          peakKw: 1.4,
          reason: "EV.",
          assumption: "EV.",
          modifiers: [{ type: "ev_charging_profile", kwh: 12, peakKw: 1.4, value: "overnight", reason: "Long charging event." }],
        },
      ],
    },
    { idFactory: (_load, index) => `stack-${index}` }
  );
  assert.deepStrictEqual(
    stackedProfile.rows.map((row) => row.name),
    ["Dryer", "EV Level 1 Charging", "Lighting", "Base Household Load"]
  );

  process.env.ENERGYAPP_AI_ASSISTANT_FORCE_MOCK = "1";
  const fallbackTurn = await createAssistantTurn({
    profileName: "Fallback Home",
    description: "1800 sq ft home with an EV",
    projectLocation: { lat: 40, lng: -105 },
    forceGenerate: true,
  });
  assert.strictEqual(fallbackTurn.status, 200);
  assert.strictEqual(fallbackTurn.body.mode, "generate_profile");
  assert.ok(fallbackTurn.body.loads.length >= 2);
  assert.ok(fallbackTurn.body.loads.some((load) => load.templateId === "residential-ev-level-2" && load.peakKw === 7.2));

  const mediumLoadFallbackTurn = await createAssistantTurn({
    profileName: "Medium Load Fallback Home",
    description: "2200 sq ft residential home.",
    facts: {
      projectType: "residential",
      squareFeet: 2200,
      hasEv: false,
      hvacPresence: false,
      waterHeating: "gas",
      hasPoolOrHotTub: true,
      hasPoolPump: true,
      poolPumpHours: 8,
      hasHotTubSpa: true,
      hotTubUse: "kept_hot",
      hasExtraRefrigeration: true,
      refrigerationIntensity: "multiple_extra",
      hasWellPump: true,
      wellPumpUse: "irrigation",
      hasSumpPump: true,
      sumpPumpFrequency: "frequent",
      hasDehumidifier: true,
      dehumidifierSeasonality: "year_round",
      electricCooking: false,
      dryerType: "non_electric_or_none",
    },
    forceGenerate: true,
  });
  const mediumLoadTemplateIds = mediumLoadFallbackTurn.body.loads.map((load) => load.templateId);
  assert.ok(mediumLoadTemplateIds.includes("residential-pool-pump"));
  assert.ok(mediumLoadTemplateIds.includes("residential-hot-tub-spa"));
  assert.ok(mediumLoadTemplateIds.includes("residential-extra-refrigeration"));
  assert.ok(mediumLoadTemplateIds.includes("residential-well-pump"));
  assert.ok(mediumLoadTemplateIds.includes("residential-sump-sewage-pump"));
  assert.ok(mediumLoadTemplateIds.includes("residential-dehumidifier"));

  const oneOccupantTurn = await createAssistantTurn({
    profileName: "One Occupant Home",
    description: "1800 sq ft residential home.",
    facts: { projectType: "residential", squareFeet: 1800, occupants: 1, waterHeating: "electric", electricCooking: true, dryerType: "electric", hasEv: false, hvacPresence: false, hasPoolOrHotTub: false },
    forceGenerate: true,
  });
  const fiveOccupantTurn = await createAssistantTurn({
    profileName: "Five Occupant Home",
    description: "1800 sq ft residential home.",
    facts: { projectType: "residential", squareFeet: 1800, occupants: 5, waterHeating: "electric", electricCooking: true, dryerType: "electric", hasEv: false, hvacPresence: false, hasPoolOrHotTub: false },
    forceGenerate: true,
  });
  const getLoad = (turn, templateId) => turn.body.loads.find((load) => load.templateId === templateId);
  assert.ok(getLoad(fiveOccupantTurn, "residential-base-load").peakKw > getLoad(oneOccupantTurn, "residential-base-load").peakKw);
  assert.ok(getLoad(fiveOccupantTurn, "residential-electric-water-heater").modifiers[0].factor > getLoad(oneOccupantTurn, "residential-electric-water-heater").modifiers[0].factor);
  assert.ok(getLoad(fiveOccupantTurn, "residential-electric-range").modifiers[0].factor > getLoad(oneOccupantTurn, "residential-electric-range").modifiers[0].factor);
  assert.ok(getLoad(fiveOccupantTurn, "residential-clothes-dryer").modifiers[0].factor > getLoad(oneOccupantTurn, "residential-clothes-dryer").modifiers[0].factor);

  const heavyOfficeTurn = await createAssistantTurn({
    profileName: "Heavy Office Home",
    description: "1800 sq ft residential home.",
    facts: { projectType: "residential", squareFeet: 1800, occupancy: "work_from_home", homeOfficeIntensity: "heavy", waterHeating: "gas", hasEv: false, hvacPresence: false, hasPoolOrHotTub: false, electricCooking: false, dryerType: "non_electric_or_none" },
    forceGenerate: true,
  });
  assert.ok(heavyOfficeTurn.body.loads.find((load) => load.name === "Work From Home Plug Loads").modifiers.some((modifier) => modifier.type === "workday_window"));
  assert.ok(heavyOfficeTurn.body.loads.find((load) => load.name === "Work From Home Plug Loads").modifiers.find((modifier) => modifier.type === "scale").factor > 0.45);
  const heavyOfficeProfile = loadBuilder.createProfileModelFromAssistantProposal(heavyOfficeTurn.body, { idFactory: (_load, index) => `office-${index}` });
  const officeRow = heavyOfficeProfile.rows.find((row) => row.name === "Work From Home Plug Loads");
  assert.ok(officeRow.values[48] > officeRow.values[4]);
  assert.ok(peakIndex(officeRow.values) >= 34 && peakIndex(officeRow.values) <= 70);

  const awayLightingTurn = await createAssistantTurn({
    profileName: "Away Lighting Home",
    description: "1800 sq ft residential home.",
    facts: { projectType: "residential", squareFeet: 1800, occupancy: "away_weekdays", waterHeating: "gas", hasEv: false, hvacPresence: false, hasPoolOrHotTub: false, electricCooking: false, dryerType: "non_electric_or_none" },
    forceGenerate: true,
  });
  const occupiedLightingTurn = await createAssistantTurn({
    profileName: "Occupied Lighting Home",
    description: "1800 sq ft residential home.",
    facts: { projectType: "residential", squareFeet: 1800, occupancy: "occupied_daytime", waterHeating: "gas", hasEv: false, hvacPresence: false, hasPoolOrHotTub: false, electricCooking: false, dryerType: "non_electric_or_none" },
    forceGenerate: true,
  });
  const awayLighting = loadBuilder.createProfileModelFromAssistantProposal(awayLightingTurn.body, { idFactory: (_load, index) => `away-light-${index}` }).rows.find((row) => row.sourceTemplateId === "residential-lighting");
  const occupiedLighting = loadBuilder.createProfileModelFromAssistantProposal(occupiedLightingTurn.body, { idFactory: (_load, index) => `occupied-light-${index}` }).rows.find((row) => row.sourceTemplateId === "residential-lighting");
  assert.ok(occupiedLighting.values[48] > awayLighting.values[48]);

  const dcFastTurn = await createAssistantTurn({
    profileName: "DC Fast Home",
    description: "1800 sq ft residential home with one EV.",
    facts: { projectType: "residential", squareFeet: 1800, hasEv: true, evCount: 1, evAverageNightlyKwh: 20, evChargerLevel: "dc_fast", evChargerPeakKw: 50, evChargingSchedule: "daytime", waterHeating: "gas", hvacPresence: false, hasPoolOrHotTub: false, electricCooking: false, dryerType: "non_electric_or_none" },
    forceGenerate: true,
  });
  const dcFastLoad = dcFastTurn.body.loads.find((load) => load.templateId === "residential-ev-level-2");
  assert.strictEqual(dcFastLoad.peakKw, 50);
  assert.ok(/unusual for a home/i.test(dcFastLoad.assumption));
  assert.strictEqual(DEFAULT_EV_EFFICIENCY_KWH_PER_MILE, 0.33);
  delete process.env.ENERGYAPP_AI_ASSISTANT_FORCE_MOCK;

  const originalFetchForDeterministic = global.fetch;
  const originalApiKeyForDeterministic = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-test-secret";
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      throw new Error("Follow-up turns should not call OpenAI during deterministic selection.");
    };
    const deterministicTurn = await createAssistantTurn({
      profileName: "Deterministic Home",
      description: "2,400 sq ft residential home with one EV and gas water heater.",
      facts: { projectType: "residential", hasEv: true, hvacPresence: false, hasPoolOrHotTub: false, electricCooking: false, dryerType: "non_electric_or_none" },
      debug: true,
    });
    assert.strictEqual(deterministicTurn.status, 200);
    assert.strictEqual(deterministicTurn.body.mode, "ask_followup");
    assert.strictEqual(deterministicTurn.body.usedFallback, false);
    assert.strictEqual(deterministicTurn.body.diagnostics.turnType, "followup");
    assert.strictEqual(fetchCalled, false);
    assert.notStrictEqual(deterministicTurn.body.question.id, "square_feet");
  } finally {
    global.fetch = originalFetchForDeterministic;
    if (originalApiKeyForDeterministic == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKeyForDeterministic;
  }

  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-test-secret";
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          message: "Invalid key sk-test-secret sent as Bearer abc.def.",
          code: "invalid_api_key",
          type: "invalid_request_error",
        },
      }),
    });
    const debugTurn = await createAssistantTurn({
      profileName: "Debug Home",
      description: "1800 sq ft home with an EV",
      projectLocation: { lat: 40, lng: -105 },
      forceGenerate: true,
      debug: true,
    });
    assert.strictEqual(debugTurn.status, 200);
    assert.strictEqual(debugTurn.body.usedFallback, true);
    assert.strictEqual(debugTurn.body.diagnostics.usedFallback, true);
    assert.strictEqual(debugTurn.body.diagnostics.fallbackReason.status, 401);
    assert.strictEqual(debugTurn.body.diagnostics.model, DEFAULT_PROPOSAL_MODEL);
    assert.strictEqual(debugTurn.body.diagnostics.turnType, "proposal");
    assert.ok(!JSON.stringify(debugTurn.body.diagnostics).includes("sk-test-secret"));
    assert.ok(!JSON.stringify(debugTurn.body.diagnostics).includes("abc.def"));
    assert.ok(!JSON.stringify(debugTurn.body.diagnostics).includes("1800 sq ft home"));
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
};

module.exports = { runAiAssistantTests };
