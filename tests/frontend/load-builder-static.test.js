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
};

module.exports = { runLoadBuilderStaticTests };
