const INTERVIEW_GUIDE = Object.freeze({
  strategy: Object.freeze({
    profileScope: "whole_home",
    askKnownFactsAgain: false,
    allowBundledQuestions: true,
    minorLoadsRule: "ask_only_if_mentioned",
    mediumLoadsRule: "ask_directly_when_material",
    preferredQuestionStyle: "multiple_choice",
  }),
  tiers: Object.freeze({
    major: Object.freeze([
      {
        id: "space_cooling",
        name: "Space cooling / central A/C",
        factKeys: ["hvacPresence", "cooling", "hvacType", "hvacSeasonUse"],
        clarifications: [
          "Is cooling central A/C, mini-split, heat pump cooling, or window units?",
          "When does cooling usually run hardest: afternoon, evening, or overnight?",
          "Is the home occupied during the day in cooling season?",
        ],
      },
      {
        id: "electric_space_heating",
        name: "Electric space heating / heat pump",
        factKeys: ["hvacPresence", "hvacType", "hvacSeasonUse"],
        clarifications: [
          "Is heating provided by a heat pump, electric resistance, or both?",
          "Is it the main heat source or backup/supplemental heat?",
          "Does heating run mostly overnight, morning, daytime, or evening?",
        ],
      },
      {
        id: "electric_resistance_heating",
        name: "Electric resistance heating",
        factKeys: ["hvacPresence", "hvacType", "hvacSeasonUse"],
        clarifications: [
          "Is this whole-home resistance heat, baseboards, wall heaters, or auxiliary heat strips?",
          "Is it used daily in winter or only during cold snaps?",
          "Are there multiple zones or rooms heated separately?",
        ],
      },
      {
        id: "ev_charging",
        name: "EV charging",
        factKeys: ["hasEv", "evCount", "evAverageNightlyKwh", "evDailyMiles", "evModel", "evChargingConcurrency", "evChargingSchedule"],
        clarifications: [
          "How many EVs charge at home?",
          "Do you know average nightly charging kWh, or should we estimate from daily miles and vehicle model?",
          "Do vehicles charge mostly overnight, evening, daytime, or on a set schedule?",
        ],
      },
      {
        id: "electric_water_heating",
        name: "Electric water heating",
        factKeys: ["waterHeating", "occupants"],
        clarifications: [
          "Is it standard electric tank, tankless electric, or heat pump water heater?",
          "How many people regularly use hot water?",
          "Are showers, laundry, and dishwasher use mostly morning, evening, or spread out?",
        ],
      },
      {
        id: "heat_pump_water_heater",
        name: "Heat pump water heater",
        factKeys: ["waterHeating", "occupants"],
        clarifications: [
          "Is it in heat-pump-only mode, hybrid mode, or often using resistance backup?",
          "How many people regularly use hot water?",
          "Is hot water use mostly morning, evening, or spread out?",
        ],
      },
      {
        id: "pool_pump",
        name: "Pool pump",
        factKeys: ["hasPoolOrHotTub", "hasPoolPump", "poolPumpHours", "poolSeasonality"],
        clarifications: [
          "Does the pool pump run on a timer, variable speed schedule, or mostly manual?",
          "About how many hours per day does it run?",
          "Does it run year-round or mainly in swim season?",
        ],
      },
      {
        id: "hot_tub_spa",
        name: "Hot tub / spa",
        factKeys: ["hasPoolOrHotTub", "hasHotTubSpa", "hotTubUse"],
        clarifications: [
          "Is it kept hot continuously or heated only before use?",
          "How often is it used per week?",
          "Is use mostly evening/weekend or spread throughout the week?",
        ],
      },
      {
        id: "electric_cooking",
        name: "Electric cooking / oven / range",
        factKeys: ["electricCooking", "cookingFrequency"],
        clarifications: [
          "Is cooking electric resistance, induction, or mostly gas?",
          "Is there frequent oven use or mostly stovetop/microwave?",
          "Is cooking concentrated around dinner or also breakfast/lunch?",
        ],
      },
      {
        id: "clothes_dryer",
        name: "Clothes dryer",
        factKeys: ["dryerType", "laundryLoads", "laundrySchedule"],
        clarifications: [
          "Is the dryer electric or gas?",
          "How many loads are dried on a typical laundry day?",
          "Is laundry usually daytime, evening, or weekend?",
        ],
      },
    ]),
    medium: Object.freeze([
      {
        id: "base_plug_loads",
        name: "Base plug loads / always-on devices",
        factKeys: ["plugLoadIntensity"],
        clarifications: [
          "Is the home light, typical, or heavy on electronics and always-on devices?",
          "Are there servers, aquariums, medical devices, or other continuous loads?",
          "Is overnight usage unusually high or low?",
        ],
      },
      {
        id: "lighting",
        name: "Lighting",
        factKeys: ["lightingType", "exteriorLighting"],
        clarifications: [
          "Is the home mostly LED lighting or older incandescent/halogen?",
          "Are lights used heavily in mornings/evenings or mostly evenings?",
          "Is there significant exterior/security lighting overnight?",
        ],
      },
      {
        id: "refrigeration",
        name: "Refrigerator / freezer",
        factKeys: ["hasExtraRefrigeration", "refrigerationIntensity"],
        clarifications: [
          "Is there just one refrigerator, or extra garage/basement refrigerators/freezers?",
          "Are any units older or known to run heavily?",
          "Is there a wine fridge, beverage fridge, or similar constant appliance?",
        ],
      },
      {
        id: "dishwasher",
        name: "Dishwasher",
        factKeys: ["dishwasherFrequency", "dishwasherSchedule"],
        clarifications: [
          "How often does the dishwasher run?",
          "Does it usually run after dinner, overnight, or during the day?",
          "Is heated dry usually used?",
        ],
      },
      {
        id: "clothes_washer",
        name: "Clothes washer",
        factKeys: ["laundryLoads", "laundrySchedule", "laundryEfficiency"],
        clarifications: [
          "How many laundry loads happen on a typical laundry day?",
          "Is washing mostly daytime, evening, or weekend?",
          "Is it a standard washer or high-efficiency/front-load washer?",
        ],
      },
      {
        id: "home_office",
        name: "Home office / work-from-home equipment",
        factKeys: ["occupancy", "homeOfficeIntensity"],
        clarifications: [
          "How many people work from home on a typical weekday?",
          "Is it laptop/light office use or desktop/workstation/monitor-heavy use?",
          "Are printers, network gear, or equipment running all day?",
        ],
      },
      {
        id: "entertainment_media",
        name: "Entertainment / media equipment",
        factKeys: ["entertainmentIntensity"],
        clarifications: [
          "Is evening TV/media use light, typical, or heavy?",
          "Are there gaming PCs/consoles or home theater equipment?",
          "Is usage mostly evening or spread through the day?",
        ],
      },
      {
        id: "well_pump",
        name: "Well pump",
        factKeys: ["hasWellPump", "wellPumpUse"],
        clarifications: [
          "Is the home on a private well?",
          "Is water use mostly normal household use, irrigation, livestock, or other high-use activity?",
          "Does the pump run more during certain times or seasons?",
        ],
      },
      {
        id: "sump_pump",
        name: "Sump pump / sewage pump",
        factKeys: ["hasSumpPump", "sumpPumpFrequency"],
        clarifications: [
          "Is there a sump, ejector, or sewage pump?",
          "Does it run frequently, seasonally, or only during storms?",
          "Is the basement/area known to have regular water intrusion?",
        ],
      },
      {
        id: "dehumidifier",
        name: "Dehumidifier",
        factKeys: ["hasDehumidifier", "dehumidifierSeasonality"],
        clarifications: [
          "Is there a dehumidifier running regularly?",
          "Does it run seasonally or year-round?",
          "Is it a small room unit or larger basement/whole-home unit?",
        ],
      },
    ]),
    minor: Object.freeze([
      { id: "small_kitchen_appliances", name: "Microwave / small kitchen appliances" },
      { id: "coffee_kettle", name: "Coffee maker / kettle" },
      { id: "ventilation_fans", name: "Bathroom fans / ventilation fans" },
      { id: "smart_home_networking", name: "Smart home / networking gear" },
      { id: "chargers_tools", name: "Battery chargers / tools / garage equipment" },
    ]),
  }),
});

const summarizeGuideForPrompt = () => ({
  strategy: INTERVIEW_GUIDE.strategy,
  tiers: {
    major: INTERVIEW_GUIDE.tiers.major.map((load) => ({
      id: load.id,
      name: load.name,
      factKeys: load.factKeys,
      clarifications: load.clarifications,
    })),
    medium: INTERVIEW_GUIDE.tiers.medium.map((load) => ({
      id: load.id,
      name: load.name,
      factKeys: load.factKeys,
      clarifications: load.clarifications,
    })),
    minor: INTERVIEW_GUIDE.tiers.minor.map((load) => ({
      id: load.id,
      name: load.name,
    })),
  },
});

const getGuideTier = (tier) => INTERVIEW_GUIDE.tiers[tier] || [];

module.exports = {
  INTERVIEW_GUIDE,
  getGuideTier,
  summarizeGuideForPrompt,
};
