import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseReportRequest, MAX_RANGE_DAYS } from "../app/pipeline/report-request.js";
import { getReportFilters } from "../app/config/index.js";

const REPORT = "generalSales";
const good = { dateRange: { from: "2026-09-01", to: "2026-09-30" }, filters: {} };

describe("date range", () => {
  test("a valid range becomes store-day UTC instants", () => {
    const result = parseReportRequest(REPORT, good);
    assert.equal(result.ok, true);
    assert.deepEqual(
      { from: result.value.range.from, to: result.value.range.to, tz: result.value.range.timeZone, start: result.value.range.start.toISOString(), end: result.value.range.end.toISOString() },
      { from: "2026-09-01", to: "2026-09-30", tz: "Asia/Muscat", start: "2026-08-31T20:00:00.000Z", end: "2026-09-30T19:59:59.000Z" },
    );
  });

  test("it is mandatory (Report 1)", () => {
    for (const input of [{}, { dateRange: {} }, { dateRange: { from: "2026-09-01" } }, { dateRange: { to: "2026-09-30" } }]) {
      const result = parseReportRequest(REPORT, input);
      assert.equal(result.ok, false);
      assert.match(result.errors.dateRange, /start and an end date/);
    }
  });

  test("start after end is rejected", () => {
    assert.match(parseReportRequest(REPORT, { dateRange: { from: "2026-09-30", to: "2026-09-01" } }).errors.dateRange, /must not be after/);
  });

  test("a single day is fine", () => {
    assert.equal(parseReportRequest(REPORT, { dateRange: { from: "2026-09-05", to: "2026-09-05" } }).ok, true);
  });

  test("impossible dates are rejected", () => {
    assert.match(parseReportRequest(REPORT, { dateRange: { from: "2026-02-30", to: "2026-03-01" } }).errors.dateRange, /real calendar dates/);
  });

  test("an unreasonably long range is rejected, the limit itself is allowed", () => {
    assert.match(parseReportRequest(REPORT, { dateRange: { from: "2020-01-01", to: "2026-09-30" } }).errors.dateRange, new RegExp(`at most ${MAX_RANGE_DAYS} days`));
    assert.equal(parseReportRequest(REPORT, { dateRange: { from: "2024-07-01", to: "2026-09-08" } }).ok, true); // 799 days
  });
});

describe("select filters (driven by the config)", () => {
  const allowed = { salesChannel: ["pos", "web"], posLocation: ["L1", "L2"], collection: ["Boys", "Girls"] };

  test("every select filter in the config is accepted", () => {
    const keys = getReportFilters(REPORT).filter((f) => f.type === "multiSelect").map((f) => f.key);
    assert.deepEqual(keys.sort(), ["collection", "posLocation", "posStaff", "salesChannel"]);
  });

  test("chosen values are kept, empty means everything (the filter is left out)", () => {
    const result = parseReportRequest(REPORT, { ...good, filters: { salesChannel: ["pos"], posLocation: [] } }, { allowedOptions: allowed });
    assert.deepEqual(result.value.filters, { salesChannel: ["pos"] });
  });

  test("values are trimmed and de-duplicated; a single string is treated as one value", () => {
    const result = parseReportRequest(REPORT, { ...good, filters: { salesChannel: [" pos ", "pos", "web"], collection: "Boys" } }, { allowedOptions: allowed });
    assert.deepEqual(result.value.filters, { salesChannel: ["pos", "web"], collection: ["Boys"] });
  });

  test("a value that is not an option is rejected", () => {
    const result = parseReportRequest(REPORT, { ...good, filters: { salesChannel: ["pos", "carrier-pigeon"] } }, { allowedOptions: allowed });
    assert.equal(result.ok, false);
    assert.match(result.errors.salesChannel, /no longer exists/);
  });

  test("POS Staff is unavailable on this plan: accepted but ignored, never an error", () => {
    const result = parseReportRequest(REPORT, { ...good, filters: { posStaff: ["Someone"] } });
    assert.equal(result.ok, true);
    assert.ok(!("posStaff" in result.value.filters));
    assert.deepEqual(result.value.ignored, ["posStaff"]);
  });

  test("unknown filter keys sent by a client are ignored", () => {
    const result = parseReportRequest(REPORT, { ...good, filters: { evil: ["x"] } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.filters, {});
  });

  test("without a list of allowed options any string is accepted", () => {
    assert.equal(parseReportRequest(REPORT, { ...good, filters: { collection: ["Anything"] } }).ok, true);
  });
});

test("several problems are reported together", () => {
  const result = parseReportRequest(REPORT, { dateRange: { from: "bad", to: "2026-09-30" }, filters: { salesChannel: ["nope"] } }, { allowedOptions: { salesChannel: ["pos"] } });
  assert.deepEqual(Object.keys(result.errors).sort(), ["dateRange", "salesChannel"]);
});

test("another time zone changes the instants but not the calendar days", () => {
  const result = parseReportRequest(REPORT, good, { timeZone: "UTC" });
  assert.equal(result.value.range.start.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(result.value.range.from, "2026-09-01");
});

test("reports whose date range mode is not supported yet report it instead of crashing", () => {
  const result = parseReportRequest("salesComparison", { dateRange: { from: "2026-01-01", to: "2026-12-31" } });
  assert.equal(result.ok, false);
  assert.match(result.errors.dateRange, /not supported/);
});

import { getSelectableFields, defaultFieldKeys, hasFieldSelection } from "../app/config/index.js";

describe("field selection (Report 1)", () => {
  const ALL_AVAILABLE = defaultFieldKeys(REPORT);

  test("Report 1 offers field selection with all 21 fields as candidates, in column order", () => {
    assert.equal(hasFieldSelection(REPORT), true);
    const fields = getSelectableFields(REPORT);
    assert.equal(fields.length, 21);
    assert.deepEqual(fields.slice(0, 3).map((f) => f.key), ["orderName", "orderDate", "salesChannel"]);
    assert.equal(fields.at(-1).key, "totalSales");
  });

  test("POS Staff is a candidate but unavailable, so it is not on by default", () => {
    const staff = getSelectableFields(REPORT).find((f) => f.key === "posStaff");
    assert.equal(staff.available, false);
    assert.match(staff.unavailableReason, /Plus and Advanced/);
    assert.equal(ALL_AVAILABLE.length, 20);
    assert.ok(!ALL_AVAILABLE.includes("posStaff"));
  });

  test("omitting `fields` gives the defaults", () => {
    assert.deepEqual(parseReportRequest(REPORT, good).value.fields, ALL_AVAILABLE);
  });

  test("a subset is kept, in config order whatever order was sent", () => {
    const result = parseReportRequest(REPORT, { ...good, fields: ["totalSales", "sku", "orderName"] });
    assert.deepEqual(result.value.fields, ["orderName", "sku", "totalSales"]);
  });

  test("an empty selection is an error, not 'everything'", () => {
    const result = parseReportRequest(REPORT, { ...good, fields: [] });
    assert.equal(result.ok, false);
    assert.match(result.errors.fields, /at least one field/);
  });

  test("a field that does not exist is an error", () => {
    const result = parseReportRequest(REPORT, { ...good, fields: ["orderName", "madeUp"] });
    assert.equal(result.ok, false);
    assert.match(result.errors.fields, /does not exist/);
  });

  test("an unavailable field is quietly dropped, and a request with only that field is empty", () => {
    const some = parseReportRequest(REPORT, { ...good, fields: ["orderName", "posStaff"] });
    assert.deepEqual(some.value.fields, ["orderName"]);
    assert.ok(some.value.ignored.includes("field:posStaff"));
    assert.match(parseReportRequest(REPORT, { ...good, fields: ["posStaff"] }).errors.fields, /at least one field/);
  });

  test("duplicates collapse", () => {
    assert.deepEqual(parseReportRequest(REPORT, { ...good, fields: ["sku", "sku"] }).value.fields, ["sku"]);
  });

  test("a field error is reported together with a date error", () => {
    const result = parseReportRequest(REPORT, { dateRange: {}, fields: [] });
    assert.deepEqual(Object.keys(result.errors).sort(), ["dateRange", "fields"]);
  });

  test("reports without field selection get no `fields` (all their columns)", () => {
    assert.equal(hasFieldSelection("stockByLocation"), false);
    assert.deepEqual(getSelectableFields("stockByLocation"), []);
  });
});

import { describeFilters } from "../app/pipeline/report-request.js";

describe("describeFilters", () => {
  const options = { salesChannel: [{ value: "pos", label: "Point of Sale" }], posLocation: [{ value: "L1", label: "Al Ain" }] };

  test("turns chosen values into readable names, with the config's labels", () => {
    assert.deepEqual(describeFilters(REPORT, { salesChannel: ["pos"], posLocation: ["L1"] }, options), [
      { key: "salesChannel", label: "Sales Channel", values: ["Point of Sale"] },
      { key: "posLocation", label: "POS Location", values: ["Al Ain"] },
    ]);
  });
  test("a value without a known label is shown as it is", () => {
    assert.deepEqual(describeFilters(REPORT, { salesChannel: ["web"] }, options)[0].values, ["web"]);
  });
  test("filters with nothing chosen are left out", () => {
    assert.deepEqual(describeFilters(REPORT, { salesChannel: [], posLocation: ["L1"] }, options).map((f) => f.key), ["posLocation"]);
    assert.deepEqual(describeFilters(REPORT, {}, options), []);
  });
});
