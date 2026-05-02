const assert = require("assert");
const path = require("path");

const loadBuilder = require(path.join(__dirname, "..", "..", "public", "assets", "js", "features", "load-builder.js"));

const runLoadBuilderEngineTests = () => {
  assert.strictEqual(loadBuilder.INTERVALS_PER_DAY, 96);
  assert.strictEqual(loadBuilder.INTERVAL_HOURS, 0.25);
  assert.strictEqual(loadBuilder.MAX_LOAD_ROWS, 25);
  assert.strictEqual(loadBuilder.MIN_EDIT_POINTS, 2);
  assert.strictEqual(loadBuilder.MAX_EDIT_POINTS, 24);

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

  const flatPoints = loadBuilder.deriveEditPoints(Array.from({ length: 96 }, () => 10));
  assert.strictEqual(flatPoints.length, 2);
  assert.strictEqual(flatPoints[0].index, 0);
  assert.strictEqual(flatPoints[1].index, 95);

  const waveValues = Array.from({ length: 96 }, (_, index) => {
    const radians = (index / 95) * Math.PI * 2;
    return 20 + Math.sin(radians) * 10;
  });
  const wavePoints = loadBuilder.deriveEditPoints(waveValues);
  assert.ok(wavePoints.length >= 4, "Wave should keep more than endpoints.");
  assert.ok(wavePoints.length <= 10, "Wave points should stay meaningfully simplified.");

  const noisyValues = Array.from({ length: 96 }, (_, index) => 20 + ((index * 17) % 9) - 4);
  const noisyPoints = loadBuilder.deriveEditPoints(noisyValues);
  assert.ok(noisyPoints.length <= 10, "Noisy curves should bias toward fewer points.");
  assert.ok(noisyPoints.length >= 2, "Noisy curves should retain endpoint guardrail.");

  const sampled = loadBuilder.sampleEditPoints([
    { id: "start", index: 0, valueKw: 0 },
    { id: "peak", index: 48, valueKw: 40 },
    { id: "end", index: 95, valueKw: 0 },
  ]);
  assert.strictEqual(sampled.length, 96);
  assert.strictEqual(sampled[0], 0);
  assert.strictEqual(sampled[95], 0);
  assert.ok(sampled[48] >= 39);

  const editRow = {
    id: "editable",
    name: "Editable",
    values: waveValues,
  };
  const editSession = loadBuilder.createEditSession(editRow, { minPoints: 2, maxPoints: 24 });
  assert.strictEqual(editSession.rowId, "editable");
  assert.strictEqual(editSession.originalValues.length, 96);
  assert.strictEqual(editSession.draftValues.length, 96);
  assert.ok(editSession.points.length >= 2 && editSession.points.length <= 24);

  const middlePoint = editSession.points[Math.floor(editSession.points.length / 2)];
  const movedSession = loadBuilder.updateEditPoint(editSession, middlePoint.id, {
    index: middlePoint.index + 2,
    valueKw: middlePoint.valueKw + 5,
  });
  const movedPoint = movedSession.points.find((point) => point.id === middlePoint.id);
  assert.ok(movedPoint.index >= middlePoint.index, "Moved point should update index.");
  assert.ok(movedPoint.valueKw >= middlePoint.valueKw, "Moved point should update value.");
  assert.ok(movedSession.draftValues.every((value) => value >= 0), "Edited draft should remain non-negative.");

  const selectedSession = loadBuilder.setSelectedEditPoints(editSession, editSession.points.slice(1, 3).map((point) => point.id));
  assert.strictEqual(selectedSession.selectedPointIds.length, Math.min(2, Math.max(editSession.points.length - 2, 0)));

  const toggledSelection = loadBuilder.toggleEditPointSelection(selectedSession, selectedSession.selectedPointIds[0]);
  assert.strictEqual(toggledSelection.selectedPointIds.length, Math.max(selectedSession.selectedPointIds.length - 1, 0));

  const multiMoveSource = loadBuilder.createEditSession({
    id: "grouped",
    name: "Grouped",
    values: loadBuilder.BUILT_IN_TEMPLATES.find((candidate) => candidate.id === "office-lighting").normalizedValues.map((value) => value * 40),
  });
  const moveIds = multiMoveSource.points.slice(1, 3).map((point) => point.id);
  const multiSelected = loadBuilder.setSelectedEditPoints(multiMoveSource, moveIds);
  const multiMoved = loadBuilder.moveEditPoints(multiSelected, moveIds[0], { deltaIndex: 2, deltaValueKw: 3 });
  const movedPoints = multiMoved.points.filter((point) => moveIds.includes(point.id));
  movedPoints.forEach((point, index) => {
    const original = multiSelected.points.find((candidate) => candidate.id === point.id);
    assert.ok(point.index >= original.index, "Grouped move should push selected points together.");
    assert.ok(point.valueKw >= original.valueKw, "Grouped move should increase selected point values together.");
    assert.strictEqual(multiMoved.selectedPointIds[index], point.id, "Grouped selection should be preserved.");
  });

  const transformed = loadBuilder.transformEditSession(editSession, {
    baseValues: editSession.draftValues,
    shiftIntervals: 4,
    scaleFactor: 1.5,
  });
  assert.strictEqual(transformed.draftValues.length, 96);
  assert.strictEqual(transformed.draftValues[4], editSession.draftValues[0] * 1.5);
  assert.ok(transformed.draftValues.every((value) => value >= 0), "Transform should remain non-negative.");

  const zeroPreserving = loadBuilder.transformEditSession({
    ...editSession,
    draftValues: [0, 10, 0, 20, ...Array.from({ length: 92 }, () => 0)],
  }, {
    baseValues: [0, 10, 0, 20, ...Array.from({ length: 92 }, () => 0)],
    shiftIntervals: 0,
    scaleFactor: 0.5,
  });
  assert.strictEqual(zeroPreserving.draftValues[0], 0);
  assert.strictEqual(zeroPreserving.draftValues[2], 0);
  assert.strictEqual(zeroPreserving.draftValues[1], 5);
  assert.strictEqual(zeroPreserving.draftValues[3], 10);

  const addPointSource = loadBuilder.createEditSession({
    id: "addable",
    name: "Addable",
    values: loadBuilder.BUILT_IN_TEMPLATES.find((candidate) => candidate.id === "office-lighting").normalizedValues.map((value) => value * 40),
  });
  const addedSession = loadBuilder.addEditPoint(addPointSource, { index: 37, valueKw: 12 }, { minIntervalGap: 1 });
  assert.strictEqual(addedSession.points.length, addPointSource.points.length + 1, "Add should create one new control point.");
  assert.strictEqual(addedSession.selectedPointIds.length, 1, "Newly added point should become the only selection.");
  const addedPoint = addedSession.points.find((point) => point.id === addedSession.selectedPointIds[0]);
  assert.strictEqual(addedPoint.index, 37);

  const ignoredDuplicateAdd = loadBuilder.addEditPoint(addedSession, { index: 37, valueKw: 14 }, { minIntervalGap: 1 });
  assert.strictEqual(ignoredDuplicateAdd.points.length, addedSession.points.length, "Near-duplicate add should be ignored.");

  const deleteSource = loadBuilder.setSelectedEditPoints(addedSession, addedSession.points.slice(1, 3).map((point) => point.id));
  const deletedSession = loadBuilder.deleteEditPoints(deleteSource, deleteSource.selectedPointIds);
  assert.strictEqual(deletedSession.points.length, addedSession.points.length - deleteSource.selectedPointIds.length, "Delete should remove all selected points.");
  assert.deepStrictEqual(deletedSession.selectedPointIds, [], "Delete should clear the selection.");

  const minPointSession = {
    ...loadBuilder.createEditSession({
      id: "minimal",
      name: "Minimal",
      values: Array.from({ length: 96 }, () => 10),
    }),
    selectedPointIds: [],
  };
  const protectedDelete = loadBuilder.deleteEditPoints(minPointSession, minPointSession.points.map((point) => point.id));
  assert.strictEqual(protectedDelete.points.length, 2, "Delete should respect the 2-point minimum.");

  const committedRow = loadBuilder.commitEditSession(editRow, movedSession);
  assert.strictEqual(committedRow.values.length, 96);
  assert.ok(committedRow.peak >= 0);
};

module.exports = { runLoadBuilderEngineTests };
