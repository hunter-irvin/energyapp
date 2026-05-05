const { DEFAULT_EV_EFFICIENCY_KWH_PER_MILE } = require("./assistant-schema");
const { summarizeGuideForPrompt } = require("./interview-guide");

const buildBaseContext = ({ request = {}, interviewState = {} } = {}) => ({
  profileName: request.profileName,
  description: request.description,
  projectLocation: request.projectLocation,
  knownFacts: interviewState.facts || {},
  climateBucket: interviewState.climateBucket || "unknown",
  forceGenerate: Boolean(request.forceGenerate),
  interviewState: {
    questionsAsked: interviewState.questionsAsked || 0,
    recommendedStop: Boolean(interviewState.recommendedStop),
    remainingUncertaintyScore: interviewState.remainingUncertaintyScore || 0,
    nextQuestionCandidates: interviewState.nextQuestionCandidates || [],
  },
  recentAnswers: Array.isArray(request.answers) ? request.answers.slice(-3) : [],
  interviewGuide: summarizeGuideForPrompt(),
  evEfficiencyFallbackKwhPerMile: DEFAULT_EV_EFFICIENCY_KWH_PER_MILE,
});

const buildAssistantFollowupPrompt = ({ request = {}, interviewState = {} } = {}) => {
  const context = {
    goal: "Ask the next highest-value whole-home residential load-profile intake question.",
    ...buildBaseContext({ request, interviewState }),
  };
  return [
    {
      role: "developer",
      content: [
        "You are an energy management consultant helping a client build a practical whole-home daily electric load profile.",
        "Return JSON only using the provided schema. Do not include markdown.",
        "Your goal is to ask the next highest-value intake question so the app can build an editable whole-home profile of typical daily use.",
        "Prioritize facts that change load inclusion, daily energy, peak demand, timing, or seasonality.",
        "Use knownFacts, recentAnswers, nextQuestionCandidates, and interviewGuide before asking.",
        "Do not ask for information the user already provided in the description or prior answers.",
        "Treat boolean false knownFacts as confirmed absences, not unknowns; do not re-ask about loads the user left unchecked in the initial intake checklist.",
        "Use interviewGuide: Major loads first when unknown; Medium loads directly when material; Minor loads only when user-mentioned.",
        "Bundled checklist-style questions are allowed when they can eliminate many load options at once.",
        "Ask one question per turn, but that question may contain bundled options.",
        "Prefer multiple choice. Ask numeric questions only for high-impact sizing facts such as home size, occupants, EV kWh/miles, and pool pump hours.",
        "Set question.selectionType to single for one-answer questions and multiple when the user should check any/all applicable options.",
        "Use multiselect questions only when selecting several independent facts is clearer than forcing one answer.",
        "Every follow-up question must include 2-6 concise options and allowCustomResponse true.",
        "Every option value must patch the fact model with one or more useful fields.",
        "Use typical sentence capitalization in user-facing question and option text.",
        "Do not generate profile loads, assumptions, template IDs, or raw 96-point load curves in follow-up mode.",
        "If the project is commercial or industrial, ask a residential-only/manual-continuation question.",
        "For EVs, prefer average nightly kWh. If unknown, ask for daily miles and vehicle model. Ask charger level or a simple charger clue when charger peak is unknown.",
        `If EV model identification is uncertain, use ${DEFAULT_EV_EFFICIENCY_KWH_PER_MILE} kWh/mile when that fact is needed.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(context),
    },
  ];
};

const buildAssistantPrompt = ({ request = {}, interviewState = {}, templateCatalog = [] } = {}) => {
  const context = {
    goal: "Create an editable whole-home residential 24-hour electric load profile proposal.",
    ...buildBaseContext({ request, interviewState }),
    templateCatalog,
  };
  return [
    {
      role: "developer",
      content: [
        "You are an energy management consultant creating an editable whole-home residential daily electric load profile.",
        "Return JSON only using the provided schema. Do not include markdown.",
        "V1 supports residential AI generation only. If the project is commercial or industrial, generate an ask_followup response that explains residential-only support and offers residential/manual continuation options.",
        "Generate a final profile proposal when forceGenerate is true or recommendedStop is true.",
        "Generate a practical starting profile, not a perfect engineering model. Use knownFacts, recentAnswers, templateCatalog, climateBucket, and interviewGuide.",
        "Include confirmed Major loads from interviewGuide.",
        "Include confirmed or strongly indicated Medium loads when templates/support exist.",
        "Fold ordinary Medium and Minor usage into baseline loads when separate modeling is unnecessary.",
        "Do not create separate Minor loads unless the user explicitly mentioned them and they materially affect usage.",
        "Do not ask for facts already provided.",
        "For EVs, prefer average nightly kWh. If unknown, ask for daily miles and vehicle model. If a model is provided, infer kWh/mile and return evEfficiencyKwhPerMile. Use charger level facts to set EV peak demand and duration.",
        `If EV model identification is uncertain, use ${DEFAULT_EV_EFFICIENCY_KWH_PER_MILE} kWh/mile and state that assumption.`,
        "Do not output raw 96-point load curves. Select only template IDs from the provided catalog and structured modifiers.",
        "Generated loads must include reason and a one-sentence assumption.",
        "Final assumptions should mention important usage folded into the baseline, such as lighting, refrigerator/freezer cycling, plug loads, small appliances, and other minor loads not modeled separately.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(context),
    },
  ];
};

module.exports = {
  buildAssistantFollowupPrompt,
  buildAssistantPrompt,
};
