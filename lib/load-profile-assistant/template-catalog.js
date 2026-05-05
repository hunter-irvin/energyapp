const path = require("path");

const loadBuilder = require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "load-builder.js"));

const TEMPLATE_DESCRIPTIONS = Object.freeze({
  "residential-base-load": "Always-on residential background load from standby appliances, networking, refrigeration, and miscellaneous plug loads.",
  "residential-lighting": "Residential lighting with morning and evening emphasis.",
  "residential-hvac-cooling": "Electric cooling load with afternoon and early evening peak.",
  "residential-heat-pump-heating": "Electric heat-pump heating load with morning and evening heating peaks.",
  "residential-ev-level-2": "Residential Level 2 EV charging, usually overnight unless user indicates otherwise.",
  "residential-electric-water-heater": "Electric water heating with morning, evening, and small midday usage.",
  "residential-clothes-dryer": "Electric clothes dryer load as a single roughly 1.5-hour plateau totaling about 4 kWh by default.",
  "residential-dishwasher": "Dishwasher load, often evening or overnight.",
  "residential-electric-range": "Electric cooking load with breakfast and dinner peaks.",
  "residential-pool-pump": "Pool pump load, typically daytime scheduled operation.",
  "residential-furnace-fan": "Small forced-air furnace fan load for non-electric heating systems, shaped by heating season and user usage.",
  "residential-hot-tub-spa": "Hot tub or spa load with steady standby heat and evening use emphasis.",
  "residential-well-pump": "Intermittent well pump load tied to household water use and irrigation if present.",
  "residential-sump-sewage-pump": "Short intermittent sump, sewage, or ejector pump events.",
  "residential-dehumidifier": "Dehumidifier load that behaves like a seasonal or year-round background appliance.",
  "residential-extra-refrigeration": "Additional refrigerator or freezer cycling load beyond ordinary kitchen refrigeration.",
});

const buildAssistantTemplateCatalog = (templates = loadBuilder.BUILT_IN_TEMPLATES) =>
  templates
    .filter((template) => template.category === "Residential")
    .map((template) => ({
      templateId: template.id,
      name: template.name,
      category: template.category,
      defaultPeakKw: template.defaultPeakKw,
      description: TEMPLATE_DESCRIPTIONS[template.id] || `${template.category} load template for ${template.name}.`,
      tags: [
        "residential",
        ...String(template.id)
          .split("-")
          .filter((part) => part !== "residential" && part !== "load"),
      ],
    }));

const getAllowedTemplateIds = (templates = loadBuilder.BUILT_IN_TEMPLATES) => buildAssistantTemplateCatalog(templates).map((template) => template.templateId);

module.exports = {
  TEMPLATE_DESCRIPTIONS,
  buildAssistantTemplateCatalog,
  getAllowedTemplateIds,
};
