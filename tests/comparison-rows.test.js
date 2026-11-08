import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonSheets, periodLabels } from "../app/pipeline/comparison-rows.js";

const period = (from, to) => ({ from, to });

test("periods inside one year are headed with the year", () => {
  assert.deepEqual(periodLabels(period("2025-01-01", "2025-03-31"), period("2026-01-01", "2026-03-31")), { previous: "2025", current: "2026" });
});

test("periods that cross a year end, or share a year, are headed with their dates", () => {
  assert.deepEqual(periodLabels(period("2024-07-01", "2025-06-30"), period("2025-07-01", "2026-06-30")), { previous: "2024-07-01 to 2025-06-30", current: "2025-07-01 to 2026-06-30" });
  assert.deepEqual(periodLabels(period("2026-01-01", "2026-03-31"), period("2026-07-01", "2026-09-30")), { previous: "2026-01-01 to 2026-03-31", current: "2026-07-01 to 2026-09-30" });
});

test("rows are sorted by name; groups with no sales in either period are left out; the footer is the sum of the rows kept", () => {
  const groups = {
    byCollection: new Map([
      ["b", { name: "Boys", previous: 100, current: 150 }],
      ["a", { name: "Adults", previous: 0, current: 0 }],
      ["c", { name: "Charter", previous: 0, current: 40 }],
    ]),
    byLocation: new Map(),
  };
  const { sheets, totals } = comparisonSheets("salesComparison", groups, { previous: "2025", current: "2026" });
  const [collection] = sheets;
  assert.equal(collection.name, "By Collection");
  assert.deepEqual(collection.rows.map((r) => r.collectionName), ["Boys", "Charter"]);
  assert.deepEqual(collection.rows[0], { collectionName: "Boys", totalSalesPrevious: 100, totalSalesCurrent: 150, difference: 50, differencePercent: 0.5 });
  assert.equal(collection.rows[1].differencePercent, null); // no sales the year before
  assert.deepEqual(collection.footer, { collectionName: "Total", totalSalesPrevious: 100, totalSalesCurrent: 190, difference: 90, differencePercent: 0.9 });
  assert.deepEqual(totals.byCollection, { previous: 100, current: 190 });
});

test("the percentage is relative to the earlier period, so a loss shows as negative", () => {
  const groups = { byCollection: new Map([["x", { name: "X", previous: 200, current: 50 }]]), byLocation: new Map() };
  const { sheets } = comparisonSheets("salesComparison", groups, { previous: "2025", current: "2026" });
  assert.equal(sheets[0].rows[0].difference, -150);
  assert.equal(sheets[0].rows[0].differencePercent, -0.75);
});
