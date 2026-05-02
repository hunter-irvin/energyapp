const assert = require("assert");
const path = require("path");

const loadBuilder = require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "load-builder.js"));

const runLoadBuilderEngineTests = () => {
  assert.strictEqual(loadBuilder.INTERVALS_PER_DAY, 96);
  assert.strictEqual(loadBuilder.INTERVAL_HOURS, 0.25);
  assert.strictEqual(loadBuilder.MAX_LOAD_ROWS, 25);

  loadBuilder.BUILT_IN_TEMPLATES.forEach((template) => {
    assert.strictEqual(template.normalizedValues.length, 96, `${template.id} should have 96 values`);
    template.normalizedValues.forEach((value) => {
      assert.ok(value >= 0 && value <= 1, `${template.id} values should be normalized`);
    });
  });

  const normalized = loadBuilder.normalizeValues([1, -2, "3", Number.NaN]);
  assert.strictEqual(normalized.length, 96);
  assert.deepStrictEqual(normalized.slice(0, 4), [1, 0, 3, 0]);

  const baseRow = {
    id: "base",
    name: "Base",
    values: Array.from({ length: 96 }, () => 10),
  };
  const peakRow = {
    id: "peak",
    name: "Peak",
    values: Array.from({ length: 96 }, (_, index) => (index === 4 ? 20 : 0)),
  };
  const aggregate = loadBuilder.calculateAggregate([baseRow, peakRow]);
  assert.strictEqual(aggregate.length, 96);
  assert.strictEqual(aggregate[0], 10);
  assert.strictEqual(aggregate[4], 30);
  assert.strictEqual(loadBuilder.calculateDailyEnergyKwh(baseRow.values), 240);

  const mutedAggregate = loadBuilder.calculateAggregate([baseRow, { ...peakRow, muted: true }]);
  assert.strictEqual(mutedAggregate[4], 10);

  const stats = loadBuilder.getAggregateStats([baseRow, peakRow]);
  assert.strictEqual(stats.peak, 30);
  assert.strictEqual(stats.kwh, 245);
  assert.strictEqual(stats.loads, 2);
  assert.strictEqual(loadBuilder.getIndividualAxisMax([baseRow, peakRow]), 20);

  const template = loadBuilder.BUILT_IN_TEMPLATES.find((candidate) => candidate.id === "office-lighting");
  const row = loadBuilder.createRowFromTemplate(template, { id: "lighting", peakKw: 50 });
  assert.strictEqual(row.values.length, 96);
  assert.ok(Math.max(...row.values) <= 50);
  assert.ok(row.kwh > 0);
  assert.strictEqual(row.sourceTemplateId, "office-lighting");

  const added = loadBuilder.addRowFromTemplate([], template, { id: "added" });
  assert.strictEqual(added.rows.length, 1);
  assert.strictEqual(added.rows[0].id, "added");
  assert.strictEqual(added.rows[0].selected, true);

  const maxRows = Array.from({ length: 25 }, (_, index) => ({ ...baseRow, id: `row-${index}` }));
  const rejected = loadBuilder.addRowFromTemplate(maxRows, template);
  assert.strictEqual(rejected.rows.length, 25);
  assert.ok(rejected.error);

  const duplicateSource = [{ ...baseRow, id: "a", selected: true }];
  const duplicated = loadBuilder.duplicateRow(duplicateSource, "a", { id: "b" });
  assert.strictEqual(duplicated.rows.length, 2);
  assert.strictEqual(duplicated.rows[1].id, "b");
  assert.strictEqual(duplicated.rows[1].selected, true);

  const lockedDuplicate = loadBuilder.duplicateRow([{ ...baseRow, id: "locked", locked: true }], "locked", { id: "copy" });
  assert.strictEqual(lockedDuplicate.rows.length, 1);
  assert.strictEqual(lockedDuplicate.row, null);

  assert.strictEqual(loadBuilder.deleteRow([{ ...baseRow, id: "locked", locked: true }], "locked").length, 1);
  assert.strictEqual(loadBuilder.deleteRow([{ ...baseRow, id: "delete-me" }], "delete-me").length, 0);

  const toggled = loadBuilder.toggleRowLocked([{ ...baseRow, id: "toggle", locked: false }], "toggle");
  assert.strictEqual(toggled[0].locked, true);

  const reordered = loadBuilder.reorderRows(
    [
      { ...baseRow, id: "a" },
      { ...baseRow, id: "b" },
      { ...baseRow, id: "c" },
    ],
    "a",
    2
  );
  assert.deepStrictEqual(
    reordered.map((candidate) => candidate.id),
    ["b", "c", "a"]
  );

  const insertRects = [
    { top: 100, bottom: 200 },
    { top: 220, bottom: 320 },
    { top: 340, bottom: 440 },
  ];
  assert.strictEqual(loadBuilder.getInsertionIndexFromPoint(insertRects, 99), 0);
  assert.strictEqual(loadBuilder.getInsertionIndexFromPoint(insertRects, 120), 0);
  assert.strictEqual(loadBuilder.getInsertionIndexFromPoint(insertRects, 180), 1);
  assert.strictEqual(loadBuilder.getInsertionIndexFromPoint(insertRects, 250), 1);
  assert.strictEqual(loadBuilder.getInsertionIndexFromPoint(insertRects, 300), 2);
  assert.strictEqual(loadBuilder.getInsertionIndexFromPoint(insertRects, 500), 3);

  const emptyProfile = loadBuilder.createEmptyProfileModel(" Weekday ");
  assert.strictEqual(emptyProfile.name, "Weekday");
  assert.deepStrictEqual(emptyProfile.rows, []);

  const validated = loadBuilder.validateProfileModel({
    name: "Profile",
    selectedRowId: "b",
    rows: [
      { ...baseRow, id: "a", values: [1, 2] },
      { ...baseRow, id: "b", values: [-1, 2, 3] },
    ],
  });
  assert.strictEqual(validated.rows.length, 2);
  assert.strictEqual(validated.rows[0].values.length, 96);
  assert.strictEqual(validated.rows[1].selected, true);
  assert.strictEqual(validated.rows[1].values[0], 0);
};

module.exports = { runLoadBuilderEngineTests };
