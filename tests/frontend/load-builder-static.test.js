const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (...segments) => fs.readFileSync(path.join(__dirname, "..", "..", ...segments), "utf8");

const runLoadBuilderStaticTests = () => {
  const html = read("public", "projects", "load-builder.html");
  assert.ok(html.includes("Load Profiles | Energy Explorer"), "Page title should use Load Profiles.");
  assert.ok(html.includes('label: "Load Profiles"'), "Project nav should label the page Load Profiles.");
  assert.ok(html.includes("EnergyProjectShell"), "Load Builder page should mount the project shell.");
  assert.ok(html.includes("/assets/js/features/load-builder.js"), "Load Builder page should load feature helpers.");
  assert.ok(html.includes("/assets/js/components/load-builder-ui.js"), "Load Builder page should load the React bridge.");
  assert.ok(html.includes("/assets/js/pages/load-builder.js"), "Load Builder page should load page orchestration.");
  assert.ok(!/<template/i.test(html), "Load Builder should not introduce template-driven editor rendering.");

  const projectPages = ["weather.html", "generation.html", "storage.html", "rates-v4.html", "load-builder.html"];
  projectPages.forEach((fileName) => {
    const source = read("public", "projects", fileName);
    assert.ok(source.includes("/projects/load-builder.html"), `${fileName} should link to Load Builder.`);
  });

  const pageScripts = ["weather.js", "generation.js", "storage.js", "rates-v4.js"];
  pageScripts.forEach((fileName) => {
    const source = read("public", "assets", "js", "pages", fileName);
    assert.ok(source.includes("load-builder.html"), `${fileName} should preserve Load Builder project navigation.`);
  });

  const pageScript = read("public", "assets", "js", "pages", "load-builder.js");
  assert.ok(pageScript.includes("load-builder-current-link"), "Load Builder should preserve projectId on its active nav link.");
  assert.ok(pageScript.includes("profileId"), "Load Builder should support profileId URLs.");
  assert.ok(pageScript.includes("replaceState"), "Load Builder should update the URL when opening profiles.");
  assert.ok(pageScript.includes("onRenameProfile"), "Load Builder should wire profile rename actions.");
  assert.ok(pageScript.includes("onRenameRow"), "Load Builder should wire layer rename actions.");

  const uiScript = read("public", "assets", "js", "components", "load-builder-ui.js");
  assert.ok(uiScript.includes("EditableProfileTitle"), "Load Builder should expose inline profile title renaming.");
  assert.ok(uiScript.includes("load-builder-profile-name-input"), "Load Builder profile rename should use an inline input.");
  assert.ok(uiScript.includes("load-builder-row-name-input"), "Load Builder rows should expose inline layer renaming.");
  assert.ok(uiScript.includes("getAggregateLayerRows"), "Aggregate chart should derive its own layer order.");
  assert.ok(uiScript.includes("rows: aggregateRows"), "Aggregate chart should use the same order as the legend.");
  assert.ok(uiScript.includes("SelectedPointValueGuide"), "Load Builder should show a selected-point value guide during curve editing.");
  assert.ok(uiScript.includes("guidePoint.valueKw, 1"), "Selected-point value guide should format kW with one decimal place.");
  assert.ok(uiScript.includes("XAxisTicks"), "Aggregate chart should render sub-hour x-axis tick marks.");
  assert.ok(uiScript.includes("showXTicks: true"), "Aggregate chart should opt into x-axis tick marks.");
  assert.ok(uiScript.includes("row.selected ? e(ChartAxis) : null"), "Selected layer rows should render their own x-axis labels.");
  assert.ok(!uiScript.includes("load-builder-row-axis"), "Layer rows should not render a shared x-axis footer.");
  assert.ok(uiScript.includes("row.selected") && uiScript.includes("load-builder-row-metrics"), "Layer metrics should render only for selected rows.");
  assert.ok(uiScript.includes("load-builder-row-actions"), "Layer row actions should render as discrete buttons.");
  assert.ok(uiScript.includes('icon: "edit"') && uiScript.includes('icon: "copy"') && uiScript.includes('icon: "delete"'), "Layer actions should use edit, copy, and delete icons.");
  assert.ok(!uiScript.includes("RowMenu"), "Layer rows should not render an overflow menu.");
  assert.ok(uiScript.includes("row.selected") && uiScript.includes("RowActions"), "Layer row actions should render only for selected rows.");
  assert.ok(uiScript.includes("rowClickTimerRef") && uiScript.includes("200"), "Selected layer single-click deselect should use a short delay.");
  assert.ok(uiScript.includes("onCancelPendingRowClick"), "Layer chart double-click should cancel pending row deselect.");
  assert.ok(!uiScript.includes('e("h1", null, "Load Builder")'), "Load Builder editor should not render a redundant Load Builder title.");
  assert.ok(uiScript.includes("load-builder-landing-actions"), "New Profile should sit below the landing header divider.");
  assert.ok(uiScript.includes('className: "btn btn--primary", type: "button", onClick: props.onReturnToProfiles'), "Profiles button should use primary styling.");
};

module.exports = { runLoadBuilderStaticTests };
