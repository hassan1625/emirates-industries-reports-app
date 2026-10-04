import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildRowFilter, selectColumns } from "../app/pipeline/report-filter.js";
import { getReportFilters } from "../app/config/index.js";

const REPORT = "generalSales";
const row = (meta) => ({ values: {}, meta: { sourceName: "pos", locationId: "L1", collectionName: "Boys", kind: "line", ...meta } });

describe("config", () => {
  test("every available select filter of Report 1 says which row property it matches", () => {
    const selects = getReportFilters(REPORT).filter((f) => f.type === "multiSelect" && f.available !== false);
    assert.deepEqual(selects.map((f) => [f.key, f.matchOn]), [["salesChannel", "sourceName"], ["posLocation", "locationId"], ["collection", "collectionName"]]);
  });
});

describe("buildRowFilter", () => {
  test("no filters keeps every row", () => {
    const keep = buildRowFilter(REPORT, {});
    assert.equal(keep(row({})), true);
    assert.equal(buildRowFilter(REPORT)(row({})), true);
  });

  test("an empty list means everything", () => {
    assert.equal(buildRowFilter(REPORT, { salesChannel: [] })(row({ sourceName: "web" })), true);
  });

  test("sales channel matches the order's source", () => {
    const keep = buildRowFilter(REPORT, { salesChannel: ["pos", "web"] });
    assert.equal(keep(row({ sourceName: "pos" })), true);
    assert.equal(keep(row({ sourceName: "web" })), true);
    assert.equal(keep(row({ sourceName: "304980787201" })), false);
  });

  test("location matches by id; a draft order with no location is excluded", () => {
    const keep = buildRowFilter(REPORT, { posLocation: ["L1"] });
    assert.equal(keep(row({ locationId: "L1" })), true);
    assert.equal(keep(row({ locationId: "L2" })), false);
    assert.equal(keep(row({ locationId: null })), false);
  });

  test("online orders mapped to Head office match a Head office filter", () => {
    const keep = buildRowFilter(REPORT, { posLocation: ["HEAD"] });
    assert.equal(keep(row({ sourceName: "web", locationId: "HEAD", locationVia: "mapped" })), true);
  });

  test("collection matches the line's collection; shipping rows and uncollected lines are excluded", () => {
    const keep = buildRowFilter(REPORT, { collection: ["Boys"] });
    assert.equal(keep(row({ collectionName: "Boys" })), true);
    assert.equal(keep(row({ collectionName: "Girls" })), false);
    assert.equal(keep(row({ kind: "shipping", collectionName: null })), false);
    assert.equal(keep(row({ collectionName: null })), false);
  });

  test("several filters must all match", () => {
    const keep = buildRowFilter(REPORT, { salesChannel: ["pos"], posLocation: ["L1"], collection: ["Boys"] });
    assert.equal(keep(row({})), true);
    assert.equal(keep(row({ sourceName: "web" })), false);
    assert.equal(keep(row({ locationId: "L2" })), false);
    assert.equal(keep(row({ collectionName: "Girls" })), false);
  });

  test("the unavailable POS Staff filter never excludes anything", () => {
    assert.equal(buildRowFilter(REPORT, { posStaff: ["Someone"] })(row({})), true);
  });

  test("unknown filter keys are ignored", () => {
    assert.equal(buildRowFilter(REPORT, { nonsense: ["x"] })(row({})), true);
  });
});

describe("selectColumns", () => {
  const values = { orderName: "#1", sku: "A", totalSales: 10 };
  test("keeps only the chosen columns, in the given order", () => {
    assert.deepEqual(Object.keys(selectColumns(values, ["totalSales", "orderName"])), ["totalSales", "orderName"]);
    assert.deepEqual(selectColumns(values, ["sku"]), { sku: "A" });
  });
  test("a chosen column the row lacks is null", () => assert.deepEqual(selectColumns(values, ["barcode"]), { barcode: null }));
  test("no selection means every column", () => assert.equal(selectColumns(values, null), values));
});
