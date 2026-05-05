const MODE_ASK_FOLLOWUP = "ask_followup";
const MODE_GENERATE_PROFILE = "generate_profile";
const MODE_ERROR = "error";

const RESPONSE_MODES = Object.freeze([MODE_ASK_FOLLOWUP, MODE_GENERATE_PROFILE, MODE_ERROR]);
const DEFAULT_EV_EFFICIENCY_KWH_PER_MILE = 0.33;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_ANSWERS = 20;
const MAX_QUESTION_OPTIONS = 6;
const MAX_PROPOSED_LOADS = 25;
const MAX_PROFILE_NAME_LENGTH = 120;
const MAX_PROJECT_ID_LENGTH = 160;

const toArray = (value) => (Array.isArray(value) ? value : []);
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const cleanText = (value, maxLength = 500) => String(value || "").trim().slice(0, maxLength);
const isPlainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isEmptyFactValue = (value) => value == null || value === "";

const normalizeFacts = (facts = {}, { dropEmpty = false } = {}) => {
  if (!isPlainObject(facts)) return {};
  const normalized = { ...facts };
  if (normalized.projectType) normalized.projectType = cleanText(normalized.projectType, 40).toLowerCase();
  if (normalized.squareFeet != null) normalized.squareFeet = Math.max(0, Math.round(toNumber(normalized.squareFeet, 0)));
  if (normalized.occupants != null) normalized.occupants = Math.max(0, Math.round(toNumber(normalized.occupants, 0)));
  if (normalized.evCount != null) normalized.evCount = Math.max(0, Math.min(8, Math.round(toNumber(normalized.evCount, 0))));
  if (normalized.evAverageNightlyKwh != null) normalized.evAverageNightlyKwh = Math.max(0, toNumber(normalized.evAverageNightlyKwh, 0));
  if (normalized.evDailyMiles != null) normalized.evDailyMiles = Math.max(0, toNumber(normalized.evDailyMiles, 0));
  if (normalized.evChargerPeakKw != null) normalized.evChargerPeakKw = Math.max(0, Math.min(150, toNumber(normalized.evChargerPeakKw, 0)));
  if (normalized.evEfficiencyKwhPerMile != null) {
    normalized.evEfficiencyKwhPerMile = Math.max(0.15, Math.min(0.8, toNumber(normalized.evEfficiencyKwhPerMile, DEFAULT_EV_EFFICIENCY_KWH_PER_MILE)));
  }
  if (normalized.poolPumpHours != null) normalized.poolPumpHours = Math.max(0, Math.min(24, toNumber(normalized.poolPumpHours, 0)));
  if (normalized.laundryLoads != null) normalized.laundryLoads = Math.max(0, Math.round(toNumber(normalized.laundryLoads, 0)));
  [
    "hvacPresence",
    "hasPoolOrHotTub",
    "hasPoolPump",
    "hasHotTubSpa",
    "electricCooking",
    "hasWellPump",
    "hasSumpPump",
    "hasDehumidifier",
    "hasExtraRefrigeration",
    "exteriorLighting",
    "majorLoadScreenComplete",
    "mediumLoadScreenComplete",
  ].forEach((key) => {
    if (normalized[key] != null) normalized[key] = Boolean(normalized[key]);
  });
  if (dropEmpty) {
    Object.keys(normalized).forEach((key) => {
      if (isEmptyFactValue(normalized[key])) delete normalized[key];
    });
  }
  return normalized;
};

const normalizeFactPatch = (facts = {}) => normalizeFacts(facts, { dropEmpty: true });

const normalizeAnswer = (answer = {}) => ({
  questionId: cleanText(answer.questionId || answer.id, 120),
  optionId: cleanText(answer.optionId, 120),
  selectedOptionIds: toArray(answer.selectedOptionIds).map((id) => cleanText(id, 120)).filter(Boolean),
  customText: cleanText(answer.customText, 1000),
  value: isPlainObject(answer.value) ? normalizeFactPatch(answer.value) : {},
});

const normalizeSelectionType = (selectionType) => (selectionType === "multiple" ? "multiple" : "single");

const normalizeAssistantRequest = (payload = {}) => {
  const projectLocation = isPlainObject(payload.projectLocation)
    ? {
        lat: Number.isFinite(Number(payload.projectLocation.lat)) ? Number(payload.projectLocation.lat) : null,
        lng: Number.isFinite(Number(payload.projectLocation.lng)) ? Number(payload.projectLocation.lng) : null,
      }
    : { lat: null, lng: null };
  const interviewState = isPlainObject(payload.interviewState) ? payload.interviewState : {};
  return {
    mode: cleanText(payload.mode || "continue", 40) || "continue",
    forceGenerate: Boolean(payload.forceGenerate || payload.startWithThat),
    debug: Boolean(payload.debug),
    projectId: cleanText(payload.projectId, MAX_PROJECT_ID_LENGTH),
    profileName: cleanText(payload.profileName || "Untitled Load Profile", MAX_PROFILE_NAME_LENGTH) || "Untitled Load Profile",
    description: cleanText(payload.description, MAX_DESCRIPTION_LENGTH),
    projectLocation,
    facts: normalizeFacts(payload.facts),
    answers: toArray(payload.answers).slice(0, MAX_ANSWERS).map(normalizeAnswer),
    interviewState: {
      questionsAsked: Math.max(0, Math.round(toNumber(interviewState.questionsAsked, 0))),
      recommendedStop: Boolean(interviewState.recommendedStop),
      remainingUncertaintyScore: Math.max(0, toNumber(interviewState.remainingUncertaintyScore, 0)),
      progressPercent: Math.max(0, Math.min(100, toNumber(interviewState.progressPercent, 0))),
      remainingQuestionWeight: Math.max(0, toNumber(interviewState.remainingQuestionWeight, 0)),
      totalQuestionWeight: Math.max(0, toNumber(interviewState.totalQuestionWeight, 0)),
      answeredQuestionIds: toArray(interviewState.answeredQuestionIds).slice(0, MAX_ANSWERS).map((id) => cleanText(id, 120)).filter(Boolean),
      completedCandidateKeys: toArray(interviewState.completedCandidateKeys).slice(0, MAX_ANSWERS).map((key) => cleanText(key, 120)).filter(Boolean),
      nextQuestionCandidates: toArray(interviewState.nextQuestionCandidates).slice(0, 5),
    },
  };
};

const validateAssistantRequest = (payload = {}) => {
  const request = normalizeAssistantRequest(payload);
  const errors = [];
  const rawDescription = String(payload.description || "");
  const rawProfileName = String(payload.profileName || "");
  const rawProjectId = String(payload.projectId || "");
  const rawAnswers = toArray(payload.answers);
  if (rawDescription.length > MAX_DESCRIPTION_LENGTH) errors.push("Description is too long.");
  if (rawProfileName.length > MAX_PROFILE_NAME_LENGTH) errors.push("Profile name is too long.");
  if (rawProjectId.length > MAX_PROJECT_ID_LENGTH) errors.push("Project id is too long.");
  if (rawAnswers.length > MAX_ANSWERS) errors.push("Too many assistant answers.");
  if (request.projectLocation.lat != null && (request.projectLocation.lat < -90 || request.projectLocation.lat > 90)) errors.push("Invalid latitude.");
  if (request.projectLocation.lng != null && (request.projectLocation.lng < -180 || request.projectLocation.lng > 180)) errors.push("Invalid longitude.");
  return { ok: errors.length === 0, errors, request };
};

const normalizeQuestion = (question = {}) => ({
  id: cleanText(question.id, 120),
  text: cleanText(question.text, 500),
  why: cleanText(question.why, 500),
  selectionType: normalizeSelectionType(question.selectionType),
  options: toArray(question.options)
    .slice(0, MAX_QUESTION_OPTIONS)
    .map((option) => ({
      id: cleanText(option.id, 120),
      label: cleanText(option.label, 160),
      value: normalizeFactPatch(option.value),
    }))
    .filter((option) => option.id && option.label),
  allowCustomResponse: question.allowCustomResponse !== false,
});

const normalizeModifier = (modifier = {}) => {
  const normalized = {
    type: cleanText(modifier.type, 80),
    reason: cleanText(modifier.reason, 300),
  };
  ["factor", "kwh", "hours", "shiftHours", "kwhPerMile", "peakKw"].forEach((key) => {
    if (modifier[key] != null) normalized[key] = toNumber(modifier[key], 0);
  });
  ["value", "model", "season"].forEach((key) => {
    if (modifier[key] != null) normalized[key] = cleanText(modifier[key], 120);
  });
  return normalized;
};

const normalizeProposedLoad = (load = {}) => ({
  templateId: cleanText(load.templateId, 120),
  name: cleanText(load.name, 120),
  peakKw: load.peakKw == null ? null : Math.max(0, toNumber(load.peakKw, 0)),
  reason: cleanText(load.reason, 500),
  assumption: cleanText(load.assumption || load.assumptions, 500),
  modifiers: toArray(load.modifiers).slice(0, 8).map(normalizeModifier).filter((modifier) => modifier.type),
});

const normalizeAssistantResponse = (payload = {}) => {
  const mode = RESPONSE_MODES.includes(payload.mode) ? payload.mode : MODE_ERROR;
  return {
    mode,
    profileName: cleanText(payload.profileName, 120),
    facts: normalizeFacts(payload.facts),
    assumptions: toArray(payload.assumptions).slice(0, 12).map((item) => cleanText(item, 500)).filter(Boolean),
    friendlyLoadList: toArray(payload.friendlyLoadList).slice(0, MAX_PROPOSED_LOADS).map((item) => cleanText(item, 160)).filter(Boolean),
    question: normalizeQuestion(payload.question),
    loads: toArray(payload.loads).slice(0, MAX_PROPOSED_LOADS).map(normalizeProposedLoad).filter((load) => load.templateId),
    error: cleanText(payload.error || payload.message, 500),
  };
};

const validateAssistantResponse = (payload = {}, allowedTemplateIds = []) => {
  const response = normalizeAssistantResponse(payload);
  const errors = [];
  const allowed = new Set(toArray(allowedTemplateIds).map(String));
  if (!RESPONSE_MODES.includes(response.mode)) errors.push("Unsupported response mode.");
  if (response.mode === MODE_ASK_FOLLOWUP) {
    if (!response.question.id || !response.question.text) errors.push("Follow-up response must include a question.");
    if (response.question.options.length < 2) errors.push("Follow-up question must include at least two options.");
  }
  if (response.mode === MODE_GENERATE_PROFILE) {
    if (!response.loads.length) errors.push("Generated profile must include at least one load.");
    response.loads.forEach((load) => {
      if (allowed.size && !allowed.has(String(load.templateId))) errors.push(`Unsupported templateId: ${load.templateId}`);
    });
  }
  return { ok: errors.length === 0, errors, response };
};

const assistantFactsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectType",
    "homeType",
    "squareFeet",
    "occupants",
    "occupancy",
    "hasEv",
    "evCount",
    "evAverageNightlyKwh",
    "evDailyMiles",
    "evModel",
    "evEfficiencyKwhPerMile",
    "evEnergyKnown",
    "evEnergyEstimateMode",
    "evChargerLevel",
    "evChargerPeakKw",
    "evChargerClue",
    "evChargingConcurrency",
    "evChargingSchedule",
    "waterHeating",
    "hvacType",
    "hvacPresence",
    "hvacSeasonUse",
    "cooling",
    "electricCooking",
    "laundryEfficiency",
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
    "exteriorLighting",
    "hasExtraRefrigeration",
    "refrigerationIntensity",
    "dishwasherFrequency",
    "dishwasherSchedule",
    "homeOfficeIntensity",
    "entertainmentIntensity",
    "hasWellPump",
    "wellPumpUse",
    "hasSumpPump",
    "sumpPumpFrequency",
    "hasDehumidifier",
    "dehumidifierSeasonality",
    "majorLoadScreenComplete",
    "mediumLoadScreenComplete",
  ],
  properties: {
    projectType: { type: ["string", "null"] },
    homeType: { type: ["string", "null"] },
    squareFeet: { type: ["number", "null"] },
    occupants: { type: ["number", "null"] },
    occupancy: { type: ["string", "null"] },
    hasEv: { type: ["boolean", "null"] },
    evCount: { type: ["number", "null"] },
    evAverageNightlyKwh: { type: ["number", "null"] },
    evDailyMiles: { type: ["number", "null"] },
    evModel: { type: ["string", "null"] },
    evEfficiencyKwhPerMile: { type: ["number", "null"] },
    evEnergyKnown: { type: ["boolean", "null"] },
    evEnergyEstimateMode: { type: ["string", "null"] },
    evChargerLevel: { type: ["string", "null"] },
    evChargerPeakKw: { type: ["number", "null"] },
    evChargerClue: { type: ["string", "null"] },
    evChargingConcurrency: { type: ["string", "null"] },
    evChargingSchedule: { type: ["string", "null"] },
    waterHeating: { type: ["string", "null"] },
    hvacType: { type: ["string", "null"] },
    hvacPresence: { type: ["boolean", "null"] },
    hvacSeasonUse: { type: ["string", "null"] },
    cooling: { type: ["boolean", "null"] },
    electricCooking: { type: ["boolean", "null"] },
    laundryEfficiency: { type: ["string", "null"] },
    hasPoolPump: { type: ["boolean", "null"] },
    hasPoolOrHotTub: { type: ["boolean", "null"] },
    poolPumpHours: { type: ["number", "null"] },
    poolSeasonality: { type: ["string", "null"] },
    hasHotTubSpa: { type: ["boolean", "null"] },
    hotTubUse: { type: ["string", "null"] },
    cookingFrequency: { type: ["string", "null"] },
    dryerType: { type: ["string", "null"] },
    laundryLoads: { type: ["number", "null"] },
    laundrySchedule: { type: ["string", "null"] },
    plugLoadIntensity: { type: ["string", "null"] },
    lightingType: { type: ["string", "null"] },
    exteriorLighting: { type: ["boolean", "null"] },
    hasExtraRefrigeration: { type: ["boolean", "null"] },
    refrigerationIntensity: { type: ["string", "null"] },
    dishwasherFrequency: { type: ["string", "null"] },
    dishwasherSchedule: { type: ["string", "null"] },
    homeOfficeIntensity: { type: ["string", "null"] },
    entertainmentIntensity: { type: ["string", "null"] },
    hasWellPump: { type: ["boolean", "null"] },
    wellPumpUse: { type: ["string", "null"] },
    hasSumpPump: { type: ["boolean", "null"] },
    sumpPumpFrequency: { type: ["string", "null"] },
    hasDehumidifier: { type: ["boolean", "null"] },
    dehumidifierSeasonality: { type: ["string", "null"] },
    majorLoadScreenComplete: { type: ["boolean", "null"] },
    mediumLoadScreenComplete: { type: ["boolean", "null"] },
  },
};

const assistantFactPatchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: assistantFactsJsonSchema.properties,
};

const assistantModifierJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "reason", "factor", "kwh", "hours", "shiftHours", "kwhPerMile", "peakKw", "value", "model", "season"],
  properties: {
    type: { type: "string" },
    reason: { type: "string" },
    factor: { type: ["number", "null"] },
    kwh: { type: ["number", "null"] },
    hours: { type: ["number", "null"] },
    shiftHours: { type: ["number", "null"] },
    kwhPerMile: { type: ["number", "null"] },
    peakKw: { type: ["number", "null"] },
    value: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    season: { type: ["string", "null"] },
  },
};

const assistantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "profileName", "facts", "assumptions", "friendlyLoadList", "question", "loads"],
  properties: {
    mode: { type: "string", enum: [MODE_ASK_FOLLOWUP, MODE_GENERATE_PROFILE] },
    profileName: { type: "string" },
    facts: assistantFactsJsonSchema,
    assumptions: { type: "array", items: { type: "string" } },
    friendlyLoadList: { type: "array", items: { type: "string" } },
    question: {
      type: "object",
      additionalProperties: false,
      required: ["id", "text", "why", "selectionType", "options", "allowCustomResponse"],
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        why: { type: "string" },
        selectionType: { type: "string", enum: ["single", "multiple"] },
        allowCustomResponse: { type: "boolean" },
        options: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "value"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              value: assistantFactPatchJsonSchema,
            },
          },
        },
      },
    },
    loads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["templateId", "name", "peakKw", "reason", "assumption", "modifiers"],
        properties: {
          templateId: { type: "string" },
          name: { type: "string" },
          peakKw: { type: ["number", "null"] },
          reason: { type: "string" },
          assumption: { type: "string" },
          modifiers: {
            type: "array",
            items: assistantModifierJsonSchema,
          },
        },
      },
    },
  },
};

const assistantFollowupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "facts", "question"],
  properties: {
    mode: { type: "string", enum: [MODE_ASK_FOLLOWUP] },
    facts: assistantFactsJsonSchema,
    question: assistantResponseJsonSchema.properties.question,
  },
};

module.exports = {
  MODE_ASK_FOLLOWUP,
  MODE_GENERATE_PROFILE,
  MODE_ERROR,
  DEFAULT_EV_EFFICIENCY_KWH_PER_MILE,
  MAX_DESCRIPTION_LENGTH,
  MAX_ANSWERS,
  MAX_PROPOSED_LOADS,
  normalizeFacts,
  normalizeFactPatch,
  normalizeAssistantRequest,
  validateAssistantRequest,
  normalizeAssistantResponse,
  validateAssistantResponse,
  assistantFactsJsonSchema,
  assistantFollowupJsonSchema,
  assistantResponseJsonSchema,
};
