# AI Assistant

## Task Summary

| Task # | Phase | Status | Area | Deliverable | Tests |
| --- | --- | --- | --- | --- | --- |
| AI-1 | 0 | Complete | Product decisions | Confirm assistant persona, adaptive interview stop rules, review UX, residential launch scope, and load-sizing assumptions. | Spec review completed through clarifying-question decisions captured below. |
| AI-2 | 1 | Complete | Shared assistant contract | Define request/response JSON schemas for `ask_followup`, `generate_profile`, and error states. | `tests/ai-assistant.test.js` validates requests, responses, unsupported template IDs, and generated proposals. |
| AI-3 | 1 | Complete | Template catalog context | Add a compact assistant-facing catalog derived from built-in residential load templates, including a dedicated residential furnace-fan template. | Unit tests verify the catalog is residential-only and includes `residential-furnace-fan`; engine tests verify template counts. |
| AI-4 | 1 | Complete | Inference state model | Add deterministic helpers for known facts, adaptive stop logic, uncertainty scoring, and next-question priority scoring. | Unit tests cover free-text inference, EV/water-heating facts, forced-air HVAC inference, climate buckets, and fallback generation. |
| AI-5 | 1 | Complete | Local API route | Add local `server.js` route for assistant turns, loading `OPENAI_API_KEY` only server-side. | Mock/fallback API test plus local `localhost:8000` smoke test. |
| AI-6 | 1 | Complete | Production API entrypoint | Add mirrored Vercel API entrypoint that delegates to shared handler logic. | API file count remains under the Vercel budget; endpoint delegates to shared handler. |
| AI-7 | 2 | Complete | Assistant prompt | Implement persona, desired outcome, process rules, multiple-choice requirement, and `Start with that` behavior. | Prompt builder covered through assistant handler tests and local smoke. |
| AI-8 | 2 | Complete | Modal UI | Extend New Profile modal with optional `Generate with AI` free text, interview questions, custom response, Back, and `Start with that`. | `node --check`, static UI tests, and browser smoke for modal flow. |
| AI-9 | 2 | Complete | Profile proposal review | Add final concise review screen inside the modal with friendly load list, per-load assumptions, proposed-load removal, and create action. | Static UI tests and browser smoke verify review screen and editor handoff. |
| AI-10 | 2 | Complete | Proposal interpreter | Convert validated assistant JSON instructions into normal load rows using templates and deterministic modifiers. | Unit tests verify generated rows, 96 values, target daily energy, AI provenance, and unsupported-template rejection. |
| AI-11 | 3 | Complete | Editor entrypoint and provenance UI | Add `AI Gen` action near the Library header and show AI-generated layer reason text from an info icon. | Static UI tests and browser smoke verify button, replacement flow, and reason tooltip. |
| AI-12 | 3 | Partial | Location/climate calibration | Use project lat/lng for simple climate buckets and HVAC/furnace-fan assumptions. Weather-data calibration remains future scope. | Unit tests cover climate buckets and fallback behavior. |
| AI-13 | 4 | Complete | Observability and safeguards | Add debug-only diagnostics, sanitized OpenAI fallback reasons, raw payload limits, and no-key/no-user-text diagnostic behavior. | Redaction, payload-limit, and live-model failure tests pass. |
| AI-14 | 4 | Complete | End-to-end verification | Verify complete create-profile and editor AI generation journeys. | `node --check`, `npm run -s test`, local API smoke, live OpenAI smoke, and manual browser reload persistence checks pass. |
| AI-15 | 4 | Complete | Interview guide and prompt reliability | Add a JS-backed whole-home interview guide with tiered loads, clarification examples, bundled screening rules, and known-fact avoidance. | Unit tests verify guide inclusion, known facts are not re-asked, major/medium priorities, minor-load rules, and prompt/model routing; live smoke verifies no fallback and no square-footage repeat. |
| AI-16 | 5 | Complete | Guided intake controls and multiselect answers | Add residential-only facility type selection, an upfront major-load checklist, revised nuance text prompt, and assistant-supported multiselect follow-up questions. | Static UI tests, schema tests, fact-merge tests, prompt tests, and browser smoke verify checklist seeding, disabled non-residential choices, and multiselect answer handling. |
| AI-17 | 6 | Partial | Deterministic follow-up question engine | Replace model-selected follow-up question choice with a JS question catalog and deterministic next-question selector; fixed catalog wording is active by default, with model wording polish/extraction still future optional work. | Unit tests verify no repeated questions, resolved-condition behavior, weighted progress scoring, medium-load screening, initial text inference, and final proposal handoff; local API smoke verifies a complete residential intake without loops. Browser smoke remains pending because browser automation could not attach to the opened localhost page. |
| AI-18 | 6 | Done | Fact-to-profile control coverage | Add an EV charger-level follow-up and close the gaps between collected Major/Medium facts and generated load rows, scaling, timing, and assumptions. | Unit tests verify each asked fact is either applied to a generated row/modifier or explicitly folded into assumptions; EV charger level changes peak kW and charge duration; missing modifier types are applied by the row interpreter. |
| AI-19 | 6 | Done | Intake UX and load-shape refinements | Polish the AI modal flow, explicit none-of-these choices, daytime occupancy lighting, work-from-home timing, generated-row ordering, and residential dryer shape. | Static UI tests, assistant tests, load-builder engine tests, `node --check`, and `npm run -s test` verify modal copy/layout hooks, follow-up options, deterministic modifiers, generated row sorting, and dryer plateau shape. |

## Feature Overview

The AI Assistant helps users create an editable 24-hour load profile by describing their project in natural language and answering a short intake interview. The experience should feel like a consultant filling out an intake form with the user: simple, clean, and multiple-choice-first, with free-text available for edge cases.

The assistant does not directly produce final load curves. It extracts project facts, asks prioritized follow-up questions, and returns structured instructions. The application validates those instructions and converts them into normal Load Profiles rows using the existing built-in templates, deterministic scaling rules, 96-sample daily data model, and autosave workflow.

The follow-up interview should move toward a deterministic medium-flow architecture. The app should own which question is asked next from a JS question catalog. The model may still lightly rewrite the selected question and options, parse nuance text, and generate the final profile proposal, but it should not be responsible for selecting the next follow-up question in the core residential flow.

The first implementation is residential-only. Commercial and industrial project types should be recognized as future scope, not generated in the first release. If a user selects or describes a non-residential project in v1, the UI should clearly explain that AI generation currently supports residential profiles and allow the user to continue manually in the normal editor.

Primary entrypoints:

- New profile flow: inside the `New Load Profile` modal, beneath the manual profile name field.
- Existing editor flow: an `AI Gen` action above or near the Library panel opens the same assistant modal.

The final assistant screen remains inside the modal. It shows a concise "does this look right?" summary with a friendly load list, facts used, and assumptions. It must not show charts or detailed load curves. The actual load layers appear only after the user creates or updates the profile and lands in the editor.

## Full Feature Components

This feature has four cooperating parts:

1. Intake UI: the modal experience for free-text description, option-based followups, custom answers, final review, and handoff into the editor.
2. Assistant turn API: the server-side OpenAI boundary that receives the current intake state and returns either the next question or a profile proposal.
3. Uncertainty and feedback engine: deterministic app logic that tracks known facts, missing facts, expected value of unresolved questions, and stop recommendations; this feedback is sent to the assistant so it asks the most useful next question.
4. Proposal interpreter: deterministic app logic that validates assistant JSON and converts it into normal Load Builder rows from existing templates, modifiers, stats, aggregate math, and autosave.

In this document, a "row" means an individual editable load layer in the Load Profiles editor. For example, `Residential EV Level 2`, `Electric Water Heater`, and `Residential Base Load` are separate rows/layers that stack into the aggregate profile.

## User Flow

1. User clicks `New Profile`, enters or accepts a profile name, and opens `Generate with AI`.
2. User sees a facility type selector with `Residential`, `Commercial`, and `Industrial`; only `Residential` is selectable in v1.
3. User checks any upfront major loads present at the facility: heat pump or AC, EV charging, pool or hot tub, electric oven, clothes dryer, or `None of these`.
4. User enters optional nuance text under `Please describe any nuances about your daily electricity use`.
5. Assistant asks the next best follow-up question, using either single-select or multiselect options when that is clearest, always allowing a custom typed response and always showing `Start with that`.
6. Assistant presents a concise final summary inside the modal with friendly load names and assumptions.
7. User clicks `Create profile`; the app creates editable template-based load layers and opens the editor.

## Assistant Interaction Requirements

- Ask high-level questions first, then progressively ask more specific questions based on the known facts.
- Every follow-up question must include 2-6 concise options.
- Follow-up questions may be single-select or multiselect. Use multiselect when the user is confirming the presence of several independent loads or usage traits in one step.
- Major and medium multiselect screens include an explicit `None of these` option, treated as exclusive in the UI and as confirmed absence facts in the fact model.
- Every option must include a machine-readable `value` patch that can update the fact model.
- For multiselect questions, selected option values must merge into one fact patch without overwriting unrelated selected values.
- Every question must allow a custom response.
- The modal must support a `Back` action so users can review and change prior answers before generation.
- The user can click `Start with that` at any point to skip additional questions and generate from current facts.
- The assistant should stop asking questions when the fact model is good enough, the adaptive stop logic recommends stopping, the hard cap is reached, or the user chooses `Start with that`.
- Questions should prioritize facts that materially affect template selection, peak sizing, timing, seasonal behavior, or climate sensitivity.
- When a load can be represented in multiple materially different ways, the assistant should ask the user instead of guessing. For example, if a home has two EVs, the assistant should clarify whether both usually charge on the same night, whether charging is staggered, or whether the household knows its average nightly charging energy.
- The assistant must expose assumptions instead of pretending inferred values are certain.

## Current AI Modal UX

- The initial profile modal shows `AI Generated` on the left and `Custom` on the right, separated by `or`.
- `Cancel` is in the modal header.
- Before the quiz starts, the modal shows the profile name field and initial intake controls.
- Once the quiz starts, the modal header changes to the profile name, the profile-name input is hidden, and the progress bar appears between the title and `Cancel`.
- The first intake screen remains residential-only for v1: `Residential` is selectable, while `Commercial` and `Industrial` are visible but disabled.
- The initial checklist seeds known presence and absence for major loads. Selecting `None of these` clears the other major-load selections; selecting a major load clears `None of these`.
- Follow-up multiselect questions use the same exclusive `None of these` behavior when that option is present.

## Assistant Persona

The assistant is an energy management consultant helping the user create a practical editable starting profile. It should be concise, curious, and confidence-aware. It should avoid over-interviewing and should prefer the next highest-value question over broad data collection.

The assistant should optimize for:

- A useful editable starting point, not a perfect engineering model.
- Clear assumptions and user trust.
- Structured output that the app can validate and safely apply.
- A clean form-like interview instead of an open-ended chat surface.
- Specific fact extraction that maps directly into profile instructions. For example, if the user says the home has two EVs, the assistant should return `evCount: 2`, and the proposal interpreter should scale the EV load accordingly.
- Nuanced load characterization when the nuance changes the profile. For EVs, the assistant should prefer asking for average nightly `kWh`; if the user does not know, it can ask for daily miles and vehicle model so the system can infer charging energy from a vehicle-efficiency lookup or fallback assumptions.
- When the user provides an EV model, the assistant should infer the average `kWh/mile` for that model and return the value with the supporting model name in structured output. V1 uses model-provided inference rather than a separate source-backed lookup.
- When the assistant cannot confidently identify an EV model, v1 should use a default fallback of `0.33 kWh/mile`. This is a conservative rounded default near 3 miles/kWh; EPA labels publish EV consumption in `kWh/100 miles`, which maps directly to `kWh/mile`.

## Interview Guide Plan

The assistant should be seeded with a JS-backed interview guide rather than relying only on free-form prompt text. The guide should help the model behave like an energy management consultant building a whole-home daily electric load profile in conversation.

Recommended file:

- `lib/load-profile-assistant/interview-guide.js`

Recommended guide shape:

```js
const INTERVIEW_GUIDE = {
  strategy: {
    profileScope: "whole_home",
    askKnownFactsAgain: false,
    allowBundledQuestions: true,
    minorLoadsRule: "ask_only_if_mentioned",
    mediumLoadsRule: "ask_directly_when_material",
  },
  tiers: {
    major: [],
    medium: [],
    minor: [],
  },
};
```

Interview strategy decisions:

- Build a whole-home starting profile, not only loads explicitly confirmed by the user.
- Ask only about unknown facts after parsing the description and prior answers.
- Do not re-ask facts already declared by the user, such as square footage, EV count, water-heating type, or HVAC type.
- Ask Medium loads directly when they can materially change timing, daily energy, peak, or seasonality.
- Do not ask about Minor loads unless the user mentions them.
- Allow bundled checklist-style questions when they can eliminate many load options at once.
- Prefer multiple choice. Use numeric questions only for high-impact sizing facts such as home size, occupants, EV kWh/miles, and pool pump hours.
- Final proposals should briefly mention ordinary Medium/Minor usage folded into baseline assumptions.

Major loads to investigate first when unknown:

- Space cooling / central A/C
- Electric space heating / heat pump
- Electric resistance heating
- EV charging
- Electric water heating
- Heat pump water heater
- Pool pump
- Hot tub / spa
- Electric cooking / oven / range
- Clothes dryer

Medium loads to ask about directly when material:

- Base plug loads / always-on devices
- Lighting
- Refrigerator / freezer
- Dishwasher
- Clothes washer
- Home office / work-from-home equipment
- Entertainment / media equipment
- Well pump
- Sump pump / sewage pump
- Dehumidifier

Minor loads should normally be folded into baseline unless user-mentioned:

- Microwave / small kitchen appliances
- Coffee maker / kettle
- Bathroom fans / ventilation fans
- Smart home / networking gear
- Battery chargers / tools / garage equipment

Clarification examples should be stored with each Major/Medium load in the guide. The model should treat them as a question bank, not a script, and ask only the next highest-value question.

Proposed follow-up prompt direction:

```text
You are an energy management consultant helping a client build a practical whole-home daily electric load profile.

Return JSON only using the provided schema. Do not include markdown.

Your goal is to ask the next highest-value intake question so the app can build an editable whole-home profile of typical daily use. Prioritize facts that change load inclusion, daily energy, peak demand, timing, or seasonality.

Use knownFacts, recentAnswers, nextQuestionCandidates, and interviewGuide before asking. Do not ask for information the user already provided in the description or prior answers.

Use the interviewGuide:
- Major loads should be investigated first when unknown.
- Medium loads should be asked directly when they may materially shape the profile.
- Minor loads should not be asked about unless the user mentioned them.
- Bundled checklist-style questions are allowed when they can eliminate many load options at once.
- Prefer multiple choice. Ask numeric questions only for high-impact sizing facts.

Every follow-up question must include 2-6 concise options and allowCustomResponse true.
Every option value must patch the fact model with useful fields.
Use typical sentence capitalization in user-facing question and option text.

Do not generate profile loads, assumptions, template IDs, or raw 96-point load curves in follow-up mode.
```

Proposed final proposal prompt direction:

```text
You are an energy management consultant creating an editable whole-home residential daily electric load profile.

Return JSON only using the provided schema. Do not include markdown.

Generate a practical starting profile, not a perfect engineering model. Use knownFacts, recentAnswers, templateCatalog, climateBucket, and interviewGuide.

Include loads that materially affect whole-home daily use:
- Include confirmed Major loads.
- Include confirmed or strongly indicated Medium loads when templates/support exist.
- Fold ordinary Medium and Minor usage into baseline loads when separate modeling is unnecessary.
- Do not create separate Minor loads unless the user explicitly mentioned them and they materially affect usage.

Do not ask for facts already provided.
Do not output raw 96-point load curves.
Select only template IDs from the provided catalog.
Generated loads must include reason and a one-sentence assumption.

When details are unknown, use visible assumptions instead of pretending certainty.
The final assumptions should mention important usage folded into the baseline, such as lighting, refrigerator/freezer cycling, plug loads, small appliances, and other minor loads not modeled separately.
```

## Technical Architecture

### API Boundary

Add a shared assistant handler under `lib/`, with thin route dispatch in both local and production entrypoints.

Recommended files:

- `lib/load-profile-assistant/assistant-handler.js`
- `lib/load-profile-assistant/assistant-schema.js`
- `lib/load-profile-assistant/assistant-prompt.js`
- `lib/load-profile-assistant/fact-state.js`
- `lib/load-profile-assistant/template-catalog.js`
- `api/load-profile-assistant.js`

Local and production routing must stay mirrored. If a new public API entrypoint is added under `api/`, confirm the total serverless API entrypoint count stays below 10.

Assistant model routing:

- Follow-up question selection uses deterministic app logic first. Initial free-text fact extraction, follow-up wording polish, and nuance-text extraction use a smaller structured-output schema and default to `gpt-5.4-nano` when enabled.
- Final profile proposal turns use the full proposal schema and default to `gpt-5.4-mini`.
- `OPENAI_FOLLOWUP_MODEL` and `OPENAI_PROPOSAL_MODEL` can override those defaults. `OPENAI_MODEL` remains a backward-compatible final-proposal override.
- Both paths default to `reasoning.effort: "none"` because deterministic app logic supplies the uncertainty scoring and next-question priorities.

### Request Shape

```json
{
  "mode": "continue",
  "projectId": "project-id",
  "profileName": "Home profile",
  "description": "2500 sq ft single-family home with an EV and electric water heater.",
  "projectLocation": {
    "lat": 34.05,
    "lng": -118.24
  },
  "facts": {
    "projectType": "residential",
    "squareFeet": 2500,
    "hasEv": true,
    "evCount": 2,
    "evAverageNightlyKwh": 18,
    "evModel": "Tesla Model Y",
    "evEfficiencyKwhPerMile": 0.28,
    "evChargingConcurrency": "staggered",
    "waterHeating": "electric"
  },
  "answers": [
    {
      "questionId": "project_type",
      "optionId": "residential",
      "customText": ""
    }
  ],
  "interviewState": {
    "questionsAsked": 2,
    "recommendedStop": false,
    "remainingUncertaintyScore": 145,
    "nextQuestionCandidates": [
      {
        "key": "hvacType",
        "priority": 80,
        "reason": "HVAC type strongly affects residential peak load and climate sensitivity."
      },
      {
        "key": "evChargingSchedule",
        "priority": 65,
        "reason": "EV charging time changes the daily load shape."
      }
    ]
  }
}
```

### Response Modes

`ask_followup`:

```json
{
  "mode": "ask_followup",
  "facts": {},
  "assumptions": [],
  "question": {
    "id": "ev_charging_schedule",
    "text": "When do you usually charge your EV?",
    "why": "Charging time affects whether the profile peaks overnight, during the day, or in the evening.",
    "options": [
      {
        "id": "overnight",
        "label": "Mostly overnight",
        "value": {
          "evChargingSchedule": "overnight"
        }
      }
    ],
    "allowCustomResponse": true
  }
}
```

`generate_profile`:

```json
{
  "mode": "generate_profile",
  "profileName": "Single-Family Home with EV",
  "facts": {},
  "assumptions": [
    "EV charging is assumed to occur mostly overnight."
  ],
  "friendlyLoadList": [
    "Base household load",
    "Lighting and small appliances",
    "EV charging",
    "Electric water heater"
  ],
  "loads": [
    {
      "templateId": "residential-base-load",
      "name": "Base Household Load",
      "peakKw": 0.55,
      "modifiers": [
        {
          "type": "scale",
          "factor": 1.15,
          "reason": "Scaled for a larger home."
        }
      ],
      "reason": "Single-family home baseline scaled for size."
    },
    {
      "templateId": "residential-ev-level-2",
      "name": "EV Charging",
      "peakKw": 7.2,
      "modifiers": [
        {
          "type": "target_daily_energy",
          "kwh": 18,
          "reason": "User estimated average nightly EV charging energy."
        },
        {
          "type": "ev_efficiency",
          "model": "Tesla Model Y",
          "kwhPerMile": 0.28,
          "reason": "Assistant lookup for the provided EV model."
        },
        {
          "type": "charging_concurrency",
          "value": "staggered",
          "reason": "Two EVs are present, but charging is assumed to be staggered."
        }
      ],
      "reason": "Two EV household with estimated nightly charging energy."
    }
  ]
}
```

### Deterministic App Responsibilities

The app, not the assistant, should:

- Extract and merge structured facts from option selections and custom free-text answers.
- Score remaining uncertainties and provide next-question feedback to the assistant.
- Decide when the interview has reached diminishing returns.
- Validate all `templateId` values.
- Clamp peak and scale values to safe bounds.
- Apply square-footage, occupancy, EV, water-heating, and climate modifiers.
- Interpret explicit quantities from the assistant. For example, `evCount: 2` should scale the EV load to twice the single-EV template unless a separate charging behavior says otherwise.
- Interpret EV-specific facts such as `evAverageNightlyKwh`, `evDailyMiles`, `evModel`, and `evChargingConcurrency` so EV load may scale by energy, duration, peak, or a combination depending on the user's answer.
- Interpret assistant-provided `evEfficiencyKwhPerMile` for the user's EV model when nightly kWh is inferred from daily miles.
- Use `0.33 kWh/mile` as the v1 fallback when an EV model is unknown or uncertain.
- Add small furnace-fan loads from a dedicated residential furnace-fan template when the assistant identifies gas or other combustion heating with forced-air distribution.
- Use climate and season context to shape HVAC and furnace-fan assumptions, including whether the relevant driver is winter heating, summer cooling, or both.
- Use `ev_charging_profile` so EV daily kWh is preserved while peak and duration are capped by charger level and charging schedule.
- Use `workday_window` so work-from-home plug loads concentrate around broad working hours instead of reusing a flat baseline shape.
- Use `occupancy_lighting` so daytime occupancy adds a modest daytime lighting component.
- Use `hours` for runtime-driven loads such as pool pumps.
- Convert proposal instructions into existing load rows.
- Maintain exactly 96 non-negative interval values per row.
- Enforce the 25-row maximum.
- Recompute row stats and aggregate stats using existing Load Builder helpers.
- Sort AI-generated rows by shape-derived baseline-ness at creation time. Discrete/peaky event loads are placed above broad baseline-like loads, while base and other steady loads settle toward the bottom. Users can override the resulting order with normal drag/drop.
- Autosave accepted profile data through the existing persistence path.
- When AI generation is launched from an existing profile in v1, replace the current profile's load rows with the accepted AI proposal.
- Persist AI-generated row reason text so the editor can expose it from an info icon next to the existing row action buttons.

Residential shape assumptions now include:

- Clothes dryer defaults to a single roughly 1.5-hour plateau at about `2.67 kW`, totaling about `4 kWh`.
- Work-from-home plug loads are shaped as a daytime workday window and scaled by `homeOfficeIntensity`.
- Lighting keeps morning/evening emphasis but receives a modest daytime component when `occupancy` indicates someone is home during the day.

## Follow-Up Prioritization

Use deterministic scoring to tell the assistant what matters most next. The model can phrase the question naturally, but the app should provide the missing critical facts and reasons.

### Recommended Stop Logic

The interview should be adaptive rather than a fixed number of questions. The app should estimate the value of each unresolved fact and stop when the remaining highest-value question is unlikely to materially change the generated profile. In practice, the first residential version should use:

- A soft target of 3-5 questions for typical residential descriptions.
- A hard cap of 7 questions to prevent over-interviewing.
- Early stop after 1-2 questions when the free text already contains the high-impact facts.
- Required final review before creating or updating loads, even when the user clicks `Start with that`.

Recommended diminishing-returns rule:

```text
Ask another question only if the top unresolved uncertainty is expected to change at least one of:
- whether a load template is included
- when a major load occurs
- peak sizing by a meaningful amount
- climate/HVAC assumptions
- daily occupancy shape
```

If the top unresolved fact only changes assumptions text or minor sizing, stop and generate with a visible assumption instead.

Example high-priority facts:

- `projectType`: required first because template families depend on it.
- `squareFeet`: high value for residential base load, lighting, and HVAC sizing.
- `hvacPresence`: high value because some homes may have heating, cooling, both, or neither represented in electric load.
- `hvacType`: high value because electric heat pumps, electric resistance, gas furnace fans, and cooling systems affect load shape differently.
- `evChargingSchedule`: high value when an EV is present.
- `evCount`: high value when EVs are present because it can directly scale EV charging load.
- `evAverageNightlyKwh`: high value when known because it directly calibrates EV charging energy.
- `evDailyMiles`, `evModel`, and `evEfficiencyKwhPerMile`: fallback EV facts when the user does not know nightly kWh; the assistant should return the looked-up or inferred model efficiency so the interpreter can calculate charging energy.
- `evChargingConcurrency`: high value for multi-EV households because charging all vehicles simultaneously changes peak more than staggered charging.
- `waterHeating`: medium value, especially when electric.
- `occupants`: medium value for residential water heating, cooking, and appliance use.
- `electricCooking`: medium value when the user mentions all-electric appliances or cooking-heavy usage.
- `laundryEfficiency`: low to medium value; ask only if laundry was mentioned or the description is sparse.

Deferred future facts:

- `operatingHours`: high value for future commercial profiles.
- `majorProcessLoads`: high value for future industrial profiles.

## UI Requirements

- Keep the assistant modal form-like and calm.
- Do not render charts in the assistant modal.
- Add a facility type segmented control before the description step with `Residential`, `Commercial`, and `Industrial`; `Residential` is selected/enabled in v1, while `Commercial` and `Industrial` are visible but disabled.
- Add an upfront multiselect major-load checklist before the nuance text field. Initial checklist items are heat pump or AC, electric vehicle charging, pool or hot tub, electric oven, clothes dryer, and `None of these`.
- The checklist should seed structured facts before the first assistant turn so the model focuses follow-up questions on selected or still-unknown major loads.
- Use single-select multiple-choice buttons or multiselect checkboxes for assistant options based on the returned question type.
- Include a compact custom response input for every question.
- The initial free-text field should be framed as nuance capture, not primary facility classification, with label text `Please describe any nuances about your daily electricity use`.
- Keep `Start with that` visible during follow-up questions.
- Provide `Back` during the interview and final review so users can revise previous answers.
- Final review should use plain-language load names, not a technical table first.
- Show one-sentence assumptions per proposed load and allow the user to ask another question before accepting.
- Show assistant-provided EV efficiency values in the final review when they affect EV load sizing.
- Let users remove individual proposed loads before creation without requiring them to enter the editor first.
- After acceptance, show generated loads only in the editor screen.
- AI-generated rows should show an info icon next to the existing row actions when selected. Hovering the icon should expose only the assistant-provided `reason` sentence for that load.

## Security, Billing, and Hosting

- Store `OPENAI_API_KEY` only in local or production server environment variables.
- Never expose the API key in browser JavaScript.
- OpenAI API usage is billed through the OpenAI Platform separately from ChatGPT subscriptions.
- The browser calls this app's server endpoint; the server calls OpenAI.
- Server responses should be validated before returning data to the browser.
- Logs should avoid storing raw user descriptions by default unless an explicit debug mode is enabled.

## Reference Notes

- EV efficiency fallback: use `0.33 kWh/mile` in v1 when model-specific inference is unavailable. EPA electric vehicle labels publish consumption as `kWh/100 miles`, so the app can convert model-specific values by dividing by 100. EPA source: https://www.epa.gov/fueleconomy/interactive-version-electric-vehicle-label

## Phased Workplan

### Phase 0: Decisions and Spec Closure

Goal: lock the smallest useful first version.

Tasks:

- [x] AI-1: Resolve clarifying questions or mark them deferred.

Tests:

- [x] Spec review confirms each open question has an answer, a default assumption, or a deferral.

### Phase 1: Backend Contract and Deterministic Core

Goal: make assistant output safe and make the app's non-AI decision logic testable before building the UI.

Tasks:

- [x] AI-2: Define strict assistant schemas.
- [x] AI-3: Build compact template catalog.
- [x] AI-4: Build fact-state, uncertainty-scoring, adaptive stop, and priority-scoring helpers.
- [x] AI-5: Add local assistant endpoint.
- [x] AI-6: Add mirrored production API entrypoint.

Tests:

- [x] Unit/schema tests for all response modes.
- [x] Unit tests for unresolved uncertainty scoring, diminishing-returns stop decisions, and next-question feedback payloads.
- [x] Mock API tests for success and fallback generation paths.
- [x] Route parity and Vercel function budget checked by implementation shape and API count.
- [x] Local API smoke test passed on `localhost:8000`.

### Phase 2: New Profile Modal Experience

Goal: deliver the first user-facing AI generation path.

Tasks:

- [x] AI-7: Implement assistant prompt and structured model call.
- [x] AI-8: Extend New Profile modal with description, follow-up questions, custom response, Back, and `Start with that`.
- [x] AI-9: Add final concise review screen inside the modal, including proposed-load removal before creation.
- [x] AI-10: Convert accepted assistant JSON proposal into editable load rows.

Tests:

- [x] `node --check` edited JS files.
- [x] Unit tests for proposal conversion.
- [x] Static UI tests for AI modal/review/editor wiring.
- [x] UI smoke for new profile AI flow, skipped followups, final review, editor handoff, and autosave status.

### Phase 3: Editor Entrypoint and Location Calibration

Goal: support AI generation after a profile already exists and improve climate-aware defaults.

Tasks:

- [x] AI-11: Add `AI Gen` action near the Library panel.
- [~] AI-12: Add simple location/climate calibration based on project lat/lng.

Tests:

- [x] UI smoke for editor-launched modal and accepted load insertion.
- [x] UI smoke verifies accepted AI generation replaces existing profile rows in v1.
- [x] UI smoke verifies selected AI-generated rows expose an info icon and hover text for the persisted reason.
- [x] Unit tests for climate buckets and simple HVAC/furnace-fan behavior.
- [ ] Add richer seasonal/weather calibration beyond simple lat/lng buckets.
- [x] Autosave/reload persistence check.

### Phase 4: Hardening and Verification

Goal: prepare the feature for broader use.

Tasks:

- [x] AI-13: Add observability, redaction, bounded payloads, and clear errors.
- [x] AI-14: Complete end-to-end verification.
- [x] AI-15: Add JS-backed interview guide and update assistant prompt/scoring for whole-home question reliability.

Tests:

- [x] Redaction and payload-limit tests.
- [x] `npm run -s test`.
- [x] Manual browser verification for profile creation, interview flow, proposal review, editor generation, load rendering, and autosave status.
- [x] Verify live OpenAI path without deterministic fallback.
- [x] Static persistence check for AI-created and AI-updated profiles.
- [x] Verify reload persistence after AI profile creation/update in browser.
- [x] Unit tests verify the interview guide exports Major/Medium/Minor load tiers and clarification examples.
- [x] Unit tests verify description-derived known facts suppress repeated questions, especially square footage, EV count, HVAC type, and water-heating type.
- [x] Unit tests verify prompt builders include the compact interview guide context for both follow-up and final proposal turns.
- [x] Unit tests verify follow-up prompt rules: whole-home scope, bundled questions allowed, Medium loads asked directly when material, Minor loads only when mentioned, one question per turn.
- [x] Live smoke verifies the first 3-5 model-written questions avoid already-known facts and use bundled screening when useful.

### Phase 5: Guided Intake Controls

Goal: reduce avoidable first-turn ambiguity and make major-load screening faster for residential users.

Tasks:

- [x] AI-16: Add guided intake controls and multiselect answer support.

Tests:

- [x] Static UI tests verify the facility selector renders `Residential`, `Commercial`, and `Industrial`, with only `Residential` enabled.
- [x] Static UI tests verify the upfront major-load checklist renders before the nuance text field and seeds the expected fact keys.
- [x] Schema tests verify assistant follow-up questions can declare `selectionType: "single"` or `selectionType: "multiple"`.
- [x] Fact-merge tests verify multiselect answers merge selected option value patches without dropping unrelated selected facts.
- [x] Prompt tests verify the model is allowed to use multiselect questions when that is clearer than one-at-a-time single choice.
- [x] Browser smoke verifies selecting initial checklist items changes the first assistant follow-up priorities and does not re-ask already confirmed major-load presence.
- [x] Browser smoke verifies disabled `Commercial` and `Industrial` options are visible, non-clickable, and do not start unsupported generation.
- [x] `node --check` edited frontend/server-side JS files.
- [x] `npm run -s test`.

#### AI-16 Planned Implementation

Tasks:

- [x] Update the assistant modal state to include `facilityType`, `majorLoadChecklist`, and `dailyUseNuance`.
- [x] Add a single-select facility type segmented control above the intake text. `Residential` should be selected by default; `Commercial` and `Industrial` should be disabled in v1.
- [x] Add an introductory multiselect checklist before free-text input with these initial options: heat pump or AC, electric vehicle charging, pool or hot tub, electric oven, clothes dryer, and `None of these`.
- [x] Map checklist selections to structured facts before the first assistant API call, such as `hvacPresence`, `hasEv`, `hasPoolOrHotTub`, `electricCooking`, and `dryerType: "electric"`.
- [x] Replace the initial description prompt with `Please describe any nuances about your daily electricity use`.
- [x] Keep the nuance text optional and treat it as additional context, not the primary source for facility type or major-load presence.
- [x] Extend the follow-up question schema with a selection type field so the assistant can return either single-select or multiselect questions.
- [x] Update answer handling so multiselect selected options merge all selected value patches into the fact model, including any custom-text option selected at the bottom of the list.
- [x] Update prompt instructions so the assistant uses multiselect only when it reduces friction, such as confirming several independent load traits at once.
- [x] Allow users to select any or all applicable multiselect options, without a maximum selection count.
- [x] Preserve existing `Back`, `Start with that`, loading, progress, final preview, and profile creation behavior.

Tests:

- [x] Unit tests cover checklist-to-fact mapping for each initial major-load option.
- [x] Unit tests cover multiselect schema validation and invalid mixed/empty values.
- [x] Unit tests cover multiselect fact merging, including boolean facts and enum-like facts.
- [x] Prompt tests cover selection type instructions and continued known-fact avoidance.
- [x] Static UI tests cover disabled non-residential options and initial checklist layout.
- [x] Browser smoke covers the new first step, a multiselect model follow-up, and final profile creation.

### Phase 6: Deterministic Follow-Up Engine

Goal: make the residential intake stable, testable, and loop-resistant by moving follow-up question selection out of the model and into deterministic app logic.

Tasks:

- [x] AI-17: Add a deterministic question catalog and next-question selector for residential follow-ups.
- [x] AI-18: Add EV charger-level intake and fact-to-profile control coverage for Major/Medium loads.

Tests:

- [x] Unit tests verify every catalog question has an id, trigger condition, resolved condition, options, fact patches, and weight.
- [x] Unit tests verify each option either resolves the current candidate or advances to a specific child candidate.
- [x] Unit tests verify answered question ids and completed screen ids are not selected again unless explicitly reset by Back.
- [x] Unit tests verify weighted progress increases or stays stable after every answer and never decreases from null/empty fact patches.
- [x] Unit tests verify high-priority unresolved questions count for 3x the progress weight of medium-priority questions.
- [x] Unit tests verify deterministic questions cover the current high-value residential path: square feet, occupancy, occupants, HVAC, EV count, EV energy mode, EV kWh, EV daily miles, EV schedule, water heating, pool/hot tub, cooking, dryer, medium-load screen, and selected medium-load details.
- [x] Unit tests verify the upfront and follow-up medium-load multiselect screen marks selected medium loads as present and unselected medium loads as not present so only applicable medium-load detail questions are asked.
- [x] Unit tests verify Back restores the previous facts, progress, answered ids, completed screen ids, and current question snapshot through existing modal snapshot state.
- [x] API tests verify follow-up turns select questions deterministically and can return deterministic questions without calling OpenAI when wording polish is disabled or unavailable.
- [ ] API tests verify model wording polish cannot change question ids, option ids, option values, selection type, priority, or resolved-condition behavior.
- [x] API tests verify initial user free text is interpreted before deterministic question selection so declared facts such as square footage, occupants, EV count, HVAC type, or water-heating type suppress already-answered catalog questions.
- [x] API/local smoke verifies final proposal generation handoff still works after deterministic follow-ups.
- [~] Browser smoke verifies a complete residential intake from initial checklist through final review without repeated questions. Browser automation could not attach to the opened localhost page; local API smoke passed.
- [x] `node --check` edited frontend/server-side JS files.
- [x] `npm run -s test`.

#### AI-17 Planned Implementation

Tasks:

- [x] Add `lib/load-profile-assistant/question-catalog.js` with a compact residential question catalog.
- [x] Each catalog item should define `id`, `candidateKey`, `text`, `why`, `selectionType`, `priority`, `options`, `isRelevant(facts)`, `isResolved(facts)`, and `weight`.
- [x] Add child candidate handling for branched questions, especially EV energy mode to EV nightly kWh or EV daily miles.
- [x] Add explicit completion flags for bundled screens and one-time questions where appropriate.
- [x] Add `selectNextDeterministicQuestion(request, interviewState)` that returns the next catalog question or `null` when the interview is ready for proposal generation.
- [x] Change follow-up turns so deterministic catalog questions are selected before any model call.
- [ ] Add optional model wording polish for the selected question and options. The model may lightly rewrite user-facing text only; it must preserve ids, option values, selection type, priority, and resolved behavior.
- [x] Use fixed catalog wording by default. Only call model wording polish when custom text or accumulated context makes the fixed catalog wording awkward, redundant, or too generic.
- [ ] Keep model-selected follow-up question generation behind a debug/experimental flag only for comparison with the deterministic selector.
- [x] Keep OpenAI final proposal generation unchanged, using `gpt-5.4-mini`, the template catalog, known facts, assumptions, and deterministic safeguards.
- [x] Update progress scoring to use weighted catalog completion rather than only `remainingUncertaintyScore`; high-priority questions count for 3x the progress weight of medium-priority questions.
- [x] Ask all unresolved high-priority and medium-priority questions before the deterministic engine recommends proposal generation.
- [x] Store answered question ids, completed candidate keys, progress, and fact snapshots in interview state so Back restores the exact previous facts/progress/current-question state and normal forward progress never repeats a completed question.
- [x] Interpret the initial user free text before selecting the first deterministic follow-up question. Deterministic helpers parse common declared facts first; optional model extraction remains future work.
- [x] Preserve custom text handling by parsing it with deterministic helpers first and never allowing custom text extraction to erase known facts.
- [x] Add medium-load detail follow-ups in v1, gated by a bundled multiselect screen that records both which medium loads apply and which do not.
- [x] Preserve existing UI rendering for single-select and multiselect questions.

Behavior changes from today:

- The model no longer chooses the next residential follow-up question in the normal flow.
- The model may still lightly rewrite the chosen question/options, but it cannot change what is being asked or what each answer means.
- Fixed catalog wording is the default; model wording polish is used only when custom text or context makes the fixed wording awkward, redundant, or too generic.
- The app chooses the next question from known facts, answered ids, relevance, resolved conditions, and weights.
- Initial user free text is interpreted before deterministic question selection so facts declared in the text, such as square footage, occupants, EV count, HVAC type, or water-heating type, prevent duplicate questions.
- Progress becomes deterministic and should not decrease after an answer.
- High-priority questions contribute 3x the progress of medium-priority questions.
- The interview asks all unresolved high-priority and medium-priority questions before recommending the final proposal.
- The same broad bundled screen should not repeat after completion.
- The medium-load multiselect screen acts as a gate: selected medium loads can receive follow-up detail questions; unselected medium loads are treated as intentionally absent and should not be asked about later.
- Gateway questions should not repeat after selecting a branch. For example, choosing `I know nightly kWh` should ask for kWh amount, not ask again how EV charging should be estimated.
- Back restores the exact previous facts/progress/current-question snapshot, not only the last visible answer.
- The model is still used for final proposal synthesis, nuance-text extraction/polish, and optional follow-up wording polish.

#### AI-18 Completed Implementation

Goal: make sure the assistant does not ask questions whose answers disappear. Every Major/Medium follow-up should either change load inclusion, peak kW, daily kWh, timing, seasonality, or appear explicitly as a folded baseline assumption.

EV charger-level slice:

- [x] Add `evChargerLevel` and `evChargerPeakKw` to the assistant fact schema.
- [x] Add a deterministic `ev_charger_level` follow-up when EV charging is present and charger power is unknown.
- [x] Suggested options: `Level 1 outlet` at about `1.4 kW`, `Typical Level 2` at about `7.2 kW`, `High-power Level 2 / 48A` at about `11.5 kW`, `DC fast / Level 3` for unusual residential cases, and `Not sure`.
- [x] If the user selects `Not sure`, ask one more simple clue question: regular wall outlet, installed charging station, or not sure. If still unknown, default to typical Level 2 at `7.2 kW`.
- [x] Update EV proposal generation so daily energy controls total kWh and charger level controls peak kW / charging duration.
- [x] Update the EV row modifier interpreter so EV charging energy does not accidentally create unrealistic peaks when charger power is lower than the energy target would require in the default window.
- [x] Add tests for Level 1, typical Level 2, high-power Level 2, DC fast / Level 3, and unknown charger behavior.

Modifier and scaling coverage:

- [x] Add row-interpreter support for `hours` modifiers, at minimum for pool pump runtime.
- [x] Add schedule shifting for dryer and dishwasher, not only EV charging.
- [x] Store `season` modifiers as persisted assumptions for now; do not numerically scale seasonal loads until the app asks users which season the profile represents.
- [x] Use `occupants` to scale water heating, cooking, laundry, base load, and plug load where applicable.
- [x] Use `laundryLoads` to scale electric dryer contribution.
- [x] Use `homeOfficeIntensity` to scale the work-from-home plug-load row instead of using a fixed value.
- [x] Use `plugLoadIntensity`, `lightingType`, and `entertainmentIntensity` to scale baseline/lighting assumptions or rows.
- [x] Use `refrigerationIntensity` to scale baseline or add a separate refrigeration row if a residential refrigeration template is introduced.
- [x] Add lightweight residential templates for missing Major/Medium loads: hot tub/spa, well pump, sump/sewage pump, dehumidifier, and extra refrigeration.
- [x] Continue using broad schedule buckets such as daytime, evening, and overnight; do not add exact start-time controls in this pass.
- [x] Treat assumption-only facts as covered when they are intentionally stored/displayed as assumptions. Facts that materially change the final profile assessment should change generated rows, scaling, timing, or daily energy.

Recommended implementation order:

1. EV charger level: schema, catalog question, proposal generation, row interpreter, tests.
2. Existing-template modifiers: pool pump hours, dryer/dishwasher schedule, occupants, laundry loads, home office intensity.
3. Medium-load baseline scaling: plug loads, lighting, entertainment, refrigeration.
4. Missing-load templates: add lightweight templates for hot tub/spa, well pump, sump pump, dehumidifier, and extra refrigeration.
5. Coverage audit test: enumerate catalog fact keys and assert every non-screening fact is consumed by proposal generation, row modifiers, or documented folded assumptions.

Tests:

- [x] Unit tests verify `ev_charger_level` is asked only after EV presence is known and before proposal generation when charger power is unknown.
- [x] Unit tests verify EV charger level changes generated EV peak kW while preserving target daily kWh.
- [x] Unit tests verify Level 1 charging produces a lower, longer EV shape than Level 2.
- [x] Unit tests verify DC fast / Level 3 can be represented without breaking residential profile generation, while final assumptions flag it as unusual for a home.
- [x] Unit tests verify `Not sure` can branch to a simple clue question and then default safely if still unknown.
- [x] Unit tests verify pool pump hours change daily kWh.
- [x] Unit tests verify dryer and dishwasher schedules shift their load shapes.
- [x] Unit tests verify occupants change water-heating, cooking, laundry, base-load, and plug-load scaling where applicable.
- [x] Unit tests verify home office intensity changes the work-from-home row scale.
- [x] Unit tests verify missing-load templates can generate hot tub/spa, well pump, sump/sewage pump, dehumidifier, and extra refrigeration rows.
- [x] Unit tests verify seasonal facts are stored as assumptions and do not numerically scale the 24-hour shape yet.
- [x] Unit tests verify assumption-only facts count as covered only when final-review assumptions explicitly mention them.
- [ ] Browser smoke verifies the EV charger-level question appears in an EV workflow and the created EV row reflects the selected charger level. Browser DevTools attachment was unavailable in this session; automated engine/API coverage passed.

#### AI-19 Completed Implementation

Modal and question UX:

- [x] Put `AI Generated` left and `Custom` right in the initial new-profile choice row.
- [x] Move `Cancel` into the modal header.
- [x] After the quiz starts, show the profile name as the modal title and hide the profile-name field.
- [x] Move the progress bar into the header between the modal title and `Cancel`.
- [x] Add exclusive `None of these` options to major and medium multiselect questions.
- [x] Rename the upfront dryer checklist option from `Electric clothes dryer` to `Clothes dryer`, while still mapping the answer to electric dryer facts.

Load-shape and proposal behavior:

- [x] Add `occupancy_lighting` so daytime occupancy raises daytime lighting.
- [x] Add `workday_window` so work-from-home plug loads are concentrated around broad working hours instead of using a flat base-load shape.
- [x] Sort AI-generated load rows by shape-derived baseline-ness, with event/discrete loads higher and base/steady loads lower.
- [x] Update the clothes dryer template to one 1.5-hour plateau at about `4 kWh` total.

Tests:

- [x] Static UI tests verify the modal header/progress hooks, none-of-these option support, clothes dryer copy, and layer hide/show hooks.
- [x] Assistant tests verify daytime lighting and WFH plug-load shaping.
- [x] Engine tests verify AI row sorting, muted-row aggregate behavior, and dryer plateau shape.
- [x] `node --check` edited JS files.
- [x] `npm run -s test`.

#### AI-15 Planned Implementation

Tasks:

- [x] Add `lib/load-profile-assistant/interview-guide.js` with a compact `INTERVIEW_GUIDE` constant.
- [x] Store Major, Medium, and Minor load tiers plus up to three clarification examples per Major/Medium load.
- [x] Feed a compact guide payload into `buildAssistantFollowupPrompt` and `buildAssistantPrompt`.
- [x] Update follow-up prompt language to use whole-home scope, known-fact avoidance, bundled screening, Medium-load direct questioning, and Minor-load suppression.
- [x] Update final proposal prompt language to include confirmed Major loads, material Medium loads, and baseline assumptions for folded Medium/Minor usage.
- [x] Align `fact-state.js` scoring with the guide so known description facts are not re-asked and screening priorities match the load tiers.
- [x] Keep the public API contract unchanged.

Tests:

- [x] `tests/ai-assistant.test.js` verifies guide tier counts and required load IDs/names.
- [x] Description inference tests verify declared facts are present in `knownFacts` and removed from next-question candidates.
- [x] Prompt tests verify guide strategy flags and tier summaries are included without bloating the request excessively.
- [x] Scoring tests verify Major unknowns rank ahead of Medium unknowns, and Minor loads do not appear unless mentioned.
- [x] Mock API tests verify bundled-question-compatible responses validate correctly.
- [x] `node --check` edited server-side files.
- [x] `npm run -s test`.
- [x] Optional live debug smoke verifies `usedFallback: false`, no repeated square-footage question when square footage is in the description, and sensible first bundled screen.

#### AI-14 Verification Completed

Manual browser reload-persistence verification passed on `http://localhost:8000` using project `1771627246556-do9pstmk`:

1. Created an AI-assisted residential load profile from the New Profile modal.
2. Confirmed the editor opened, generated layers rendered, autosave reached `Autosaved`, and selected AI-generated rows exposed the AI reason icon.
3. Reloaded the generated `profileId` URL and confirmed the same profile name, generated rows, AI reason icon, and autosaved state restored.
4. Used editor `AI Gen` on the existing profile, accepted a replacement proposal, and confirmed replacement rows autosaved.
5. Reloaded the replacement `profileId` URL and confirmed replacement rows, AI reason icon, and autosaved state restored.

## Clarifying Questions

### AI-17 Deterministic Follow-Up Engine

Resolved decisions:

- The app should deterministically select the next follow-up question, but the model may lightly rewrite the selected question and option text.
- Fixed catalog wording should be used by default. The model should polish question/option wording only when custom text or context makes the fixed wording awkward, redundant, or too generic.
- The initial user free text should be interpreted before the first deterministic follow-up so declared facts update the fact model and suppress duplicate questions.
- The deterministic flow should ask all unresolved high-priority and medium-priority questions before recommending proposal generation.
- High-priority questions should count for 3x the progress weight of medium-priority questions.
- Custom text answers should be parsed with deterministic helpers first, with optional model extraction/polish when useful.
- Back should restore the exact previous facts/progress/current-question snapshot.
- Medium-load detail follow-ups should be included in v1.
- A bundled medium-load multiselect screen is required so selected medium loads can trigger follow-ups and unselected medium loads can be treated as intentionally absent.
- Model-selected follow-up question generation should be removed from the normal flow but may remain behind a debug/experimental flag. Model-polished wording is still allowed in the normal flow.

### AI-16 Guided Intake Controls

Resolved decisions:

- `Pool / Hot tub` remains one upfront checkbox.
- `Clothes dryer` should be labeled as `Clothes dryer` and should map to electric dryer facts for v1 because most residential dryers are electric.
- `Heat Pump or AC` simply confirms HVAC presence; the assistant can later clarify type if needed.
- The upfront major-load checklist includes an explicit exclusive `None of these` option.
- For assistant multiselect questions, custom text should appear as an option at the bottom of the multiselect list.
- Multiselect answers should allow users to select any/all applicable options without a max selection count.

### Earlier Open Questions

1. Should the assistant ask one question at a time only, or can it ask two small related questions together?
2. What residential row-level peak-kW bounds should be considered safe for generated loads before user editing?
3. Should the assistant ever add a load that is not in the current template library, or should it only suggest missing loads as assumptions/future additions?
4. Should location calibration use only lat/lng climate buckets at first, or should it query existing weather data when available?
5. Should the final review show estimated load intensity/scale in plain language, such as `low`, `typical`, or `high`, without showing charts?
6. Should custom text answers be interpreted immediately by the assistant, or should they be stored as notes until the next assistant turn extracts facts?
7. Should AI generation be disabled when no project lat/lng exists, or should it proceed with a climate assumption?
8. What default furnace-fan peak and baseline operating schedule should the new residential furnace-fan template use before climate/customer usage modifiers are applied?
9. Should the assistant ask about furnace fan behavior as a heating-season question only, or ask separately about winter heating and summer cooling fan usage?
10. Should assistant-provided EV efficiency values be shown as exact values, such as `0.28 kWh/mile`, or rounded/plain language, such as `about 0.28 kWh/mile`?

## Resolved Decisions

- Interview length is adaptive and based on unresolved uncertainty rather than a fixed count.
- First version launches residential-only; commercial and industrial generation are deferred.
- `Start with that` still shows the final review before creating or updating loads.
- Raw user free-text descriptions are discarded after generation by default.
- Users can go back and change prior answers in v1.
- Users can remove individual proposed loads in the final review before creating the profile.
- HVAC is handled through the interview rather than included blindly by default.
- Non-electric forced-air heating can create a small furnace-fan load, shaped by winter/climate assumptions.
- Existing-profile AI generation replaces the current profile's load rows in v1.
- AI-generated rows persist assistant-provided `reason` text and expose it via an info icon in the editor.
- EV charging should be calibrated from average nightly kWh when known; otherwise the assistant may ask for daily miles and vehicle model to infer charging energy.
- When an EV model is provided, the assistant should return the model's average `kWh/mile` in structured output.
- V1 uses model-provided inference for EV model efficiency rather than a separate source-backed lookup.
- If EV model identification is uncertain, v1 uses a default fallback of `0.33 kWh/mile`.
- Users are expected to know their EV model in v1.
- Furnace-fan load should use a dedicated new residential template.
- The editor info icon shows only the assistant-provided reason sentence.
- The final review shows one-sentence assumptions per proposed load.
- Assistant-provided EV efficiency values appear in the final review when used for sizing.
- AI-17 should implement the medium deterministic approach: the app owns residential follow-up question selection from a JS catalog, while the model remains responsible for final proposal generation, deterministic-helper-assisted text extraction/polish, and optional light rewriting of selected follow-up question/options.

## Initial Implementation Assumptions

- First version asks one question at a time.
- First version always shows final review before creating or updating loads.
- First version uses only existing built-in templates.
- First version does not ask the model to output raw 96-point load curves.
- First version supports residential AI generation only.
- Commercial and industrial project descriptions receive a clear "coming later" message and can continue with manual profile creation.
- First version uses lat/lng climate buckets without requiring a weather-data fetch.
- First version does not store raw AI chat text in the profile payload unless explicitly added later.
