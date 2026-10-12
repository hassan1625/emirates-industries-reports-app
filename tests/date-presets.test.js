import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DATE_PRESETS, matchPreset, presetRange } from "../app/pipeline/date-presets.js";

describe("presetRange", () => {
  test("month to date runs from the 1st to today", () => {
    assert.deepEqual(presetRange("monthToDate", "2026-10-13"), { from: "2026-10-01", to: "2026-10-13" });
  });
  test("last 7 and 30 days include today", () => {
    assert.deepEqual(presetRange("last7", "2026-10-13"), { from: "2026-10-07", to: "2026-10-13" });
    assert.deepEqual(presetRange("last30", "2026-10-13"), { from: "2026-09-14", to: "2026-10-13" });
  });
  test("last month is the whole previous calendar month, across a year end and in a leap year", () => {
    assert.deepEqual(presetRange("lastMonth", "2026-10-13"), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(presetRange("lastMonth", "2026-01-05"), { from: "2025-12-01", to: "2025-12-31" });
    assert.deepEqual(presetRange("lastMonth", "2028-03-10"), { from: "2028-02-01", to: "2028-02-29" });
  });
  test("last quarter is the whole previous calendar quarter", () => {
    assert.deepEqual(presetRange("lastQuarter", "2026-10-13"), { from: "2026-07-01", to: "2026-09-30" });
    assert.deepEqual(presetRange("lastQuarter", "2026-02-02"), { from: "2025-10-01", to: "2025-12-31" });
    assert.deepEqual(presetRange("lastQuarter", "2026-05-20"), { from: "2026-01-01", to: "2026-03-31" });
  });
  test("custom has no range", () => assert.equal(presetRange("custom", "2026-10-13"), null));
});

describe("matchPreset", () => {
  test("recognises a preset's dates, otherwise custom", () => {
    assert.equal(matchPreset("2026-09-14", "2026-10-13", "2026-10-13"), "last30");
    assert.equal(matchPreset("2026-09-01", "2026-09-30", "2026-10-13"), "lastMonth");
    assert.equal(matchPreset("2026-09-02", "2026-09-30", "2026-10-13"), "custom");
  });
  test("every preset has a label", () => {
    for (const preset of DATE_PRESETS) assert.ok(preset.label);
  });
});
