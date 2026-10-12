import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { generateReport, buildReportColumns, GENERATED_REPORT_TYPES } from "../app/pipeline/report-generation.js";
import { advanceAndGenerate } from "../app/pipeline/job-runner.js";
import { fromLocalUrl, toLocalUrl, jobReportPath } from "../app/pipeline/storage.js";
import { STAGES } from "../app/pipeline/job-stages.js";
import { defaultFieldKeys } from "../app/config/index.js";
import { withStaffUnavailable } from "./helpers/staff-unavailable.js";

const money = (a) => ({ shopMoney: { amount: String(a), currencyCode: "AED" } });
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const HEAD = "gid://shopify/Location/HEAD";
const ALAIN = "gid://shopify/Location/ALAIN";

const line = (id, title, sku, qty, price, tax, productId, parent) => ({ id, title, sku, quantity: qty, currentQuantity: qty, originalUnitPriceSet: money(price), taxLines: [{ rate: 0.05, priceSet: money(tax) }], product: { id: productId }, variant: { id: `V-${sku}`, barcode: `BC-${sku}` }, discountAllocations: [], __parentId: parent });
const order = (id, name, createdAt, sourceName, retail, gateway, shipping) => ({ id, name, createdAt, sourceName, retailLocation: retail, paymentGatewayNames: [gateway], taxesIncluded: true, currentShippingPriceSet: money(shipping) });

// #1 POS order placed in range; #2 online order with shipping; #3 POS order
// placed in AUGUST, one item returned in SEPTEMBER (the return is in range, the
// original sale is not).
const ORDERS = [
  order("O1", "#1", "2026-09-02T08:00:00Z", "pos", { id: ALAIN, name: "Al Ain" }, "cash", 0),
  line("gid://shopify/LineItem/1", "Trouser", "T1", 1, 52.5, 2.5, "P1", "O1"),
  order("O2", "#2", "2026-09-03T08:00:00Z", "web", null, "card", 22),
  line("gid://shopify/LineItem/2", "Skirt", "S1", 1, 105, 5, "P2", "O2"),
  order("O3", "#3", "2026-08-28T08:00:00Z", "pos", { id: ALAIN, name: "Al Ain" }, "cash", 0),
  line("gid://shopify/LineItem/3", "Jacket", "J1", 2, 105, 10, "P1", "O3"),
  { id: "gid://shopify/Return/3", status: "CLOSED", __parentId: "O3" },
  { id: "gid://shopify/ReturnLineItem/3", quantity: 1, returnReasonDefinition: { name: "Too big" }, fulfillmentLineItem: { lineItem: { id: "gid://shopify/LineItem/3" } }, __parentId: "gid://shopify/Return/3" },
];
const sale = (actionType, lineType, ref, qty, total, tax, parent) => ({ actionType, lineType, quantity: qty, totalAmount: money(total), totalTaxAmount: money(tax), totalDiscountAmountBeforeTaxes: money(0), ...(lineType === "PRODUCT" ? { lineItem: { id: ref } } : { shippingLine: { id: ref } }), __parentId: parent });
const EVENTS = [
  { id: "O1", name: "#1", createdAt: "2026-09-02T08:00:00Z" },
  { __typename: "OrderAgreement", id: "A1", happenedAt: "2026-09-02T08:00:00Z", reason: "ORDER", __parentId: "O1" },
  sale("ORDER", "PRODUCT", "gid://shopify/LineItem/1", 1, 52.5, 2.5, "A1"),
  { id: "O2", name: "#2", createdAt: "2026-09-03T08:00:00Z" },
  { __typename: "OrderAgreement", id: "A2", happenedAt: "2026-09-03T08:00:00Z", reason: "ORDER", __parentId: "O2" },
  sale("ORDER", "PRODUCT", "gid://shopify/LineItem/2", 1, 105, 5, "A2"),
  sale("ORDER", "SHIPPING", "S2", null, 22, 1.05, "A2"),
  { id: "O3", name: "#3", createdAt: "2026-08-28T08:00:00Z" },
  { __typename: "OrderAgreement", id: "A3a", happenedAt: "2026-08-28T08:00:00Z", reason: "ORDER", __parentId: "O3" },
  sale("ORDER", "PRODUCT", "gid://shopify/LineItem/3", 2, 210, 10, "A3a"),
  { __typename: "ReturnAgreement", id: "A3b", happenedAt: "2026-09-10T08:00:00Z", reason: "RETURN", return: { id: "gid://shopify/Return/3" }, __parentId: "O3" },
  sale("RETURN", "PRODUCT", "gid://shopify/LineItem/3", -1, -105, -5, "A3b"),
];
const PRODUCTS = [
  { id: "P1", title: "Trouser", status: "ACTIVE", tags: [] },
  { id: "gid://shopify/Collection/1", title: "Boys", __parentId: "P1" },
  { id: "P2", title: "Skirt", status: "ACTIVE", tags: [] },
  { id: "gid://shopify/Collection/2", title: "Girls", __parentId: "P2" },
];
const STAFF = new Map([["#1", "Sara"], ["#3", "Omar"]]);
const RANGE = { start: "2026-08-31T20:00:00.000Z", end: "2026-09-30T19:59:59.000Z" }; // September in Muscat
const LOCAL = { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Muscat" };
const request = (extra = {}) => JSON.stringify({ reportKey: "generalSales", range: RANGE, localRange: LOCAL, filters: {}, ...extra });
const withStaff = { fetchStaff: async () => STAFF };

// In-memory Prisma stand-in.
function fakeDb(job) {
  const row = { id: "job1", shop: "s", reportType: "generalSales", stage: STAGES.DATA_READY, error: null, resultFileUrl: null, ...job };
  return {
    row,
    reportJob: {
      findUnique: async ({ where }) => (where.id === row.id ? { ...row } : null),
      updateMany: async ({ where, data }) => {
        if (where.id !== row.id || (where.stage !== undefined && row.stage !== where.stage)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ data }) => Object.assign(row, data),
    },
    locationMapping: { findMany: async () => [{ sourceName: "web", locationId: HEAD, locationName: "Head office" }] },
  };
}

describe("generateReport", () => {
  let dir;
  let files;
  const originalRoot = process.env.REPORT_STORAGE_DIR;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "generate-"));
    process.env.REPORT_STORAGE_DIR = dir;
    files = { ordersFile: join(dir, "orders.jsonl"), eventsFile: join(dir, "events.jsonl"), productsFile: join(dir, "products.jsonl") };
    await writeFile(files.ordersFile, jsonl(ORDERS));
    await writeFile(files.eventsFile, jsonl(EVENTS));
    await writeFile(files.productsFile, jsonl(PRODUCTS));
  });
  after(async () => {
    if (originalRoot === undefined) delete process.env.REPORT_STORAGE_DIR;
    else process.env.REPORT_STORAGE_DIR = originalRoot;
    await rm(dir, { recursive: true, force: true });
  });

  const read = async (db) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fromLocalUrl(db.row.resultFileUrl));
    return workbook;
  };
  const headers = (sheet) => sheet.getRow(1).values.slice(1);
  const sheetOf = async (db) => (await read(db)).getWorksheet("General Sales Report");
  const col = (sheet, label) => headers(sheet).indexOf(label) + 1;

  test("builds the file, marks the job READY and records where the file is", async () => {
    const db = fakeDb({ ...files, params: request() });
    const outcome = await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });

    assert.equal(outcome.action, "ready", db.row.error);
    assert.equal(outcome.rows, 4); // #1 line, #2 line + shipping, #3's September return
    assert.equal(db.row.stage, STAGES.READY);
    assert.match(db.row.resultFileUrl, /^local:jobs\/job1\/report\.xlsx$/);
    assert.ok(existsSync(fromLocalUrl(db.row.resultFileUrl)));
    assert.equal(fromLocalUrl(db.row.resultFileUrl), jobReportPath("job1"));
  });

  test("with no field selection the sheet has every column, in config order", async () => {
    const db = fakeDb({ ...files, params: request() });
    await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });
    const sheet = await sheetOf(db);
    assert.equal(headers(sheet).length, 23);
    assert.equal(headers(sheet)[0], "Order Name");
    assert.deepEqual(headers(sheet).slice(1, 3), ["Order Date", "Order Type"]);
    for (const label of ["POS Staff", "Is Shipping Charges"]) assert.ok(headers(sheet).includes(label), label);
    assert.equal(headers(sheet).at(-1), "Total Sales");
  });

  test("rows are dated on the day the event happened: a September return of an August order is a September Reversal row", async () => {
    const db = fakeDb({ ...files, params: request() });
    await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });
    const sheet = await sheetOf(db);
    const names = [];
    sheet.eachRow((row, n) => n > 1 && names.push(row.getCell(1).value));
    assert.deepEqual(names, ["#1", "#2", "#2", "#3"]); // #3's August sale is outside the range
    const reversal = sheet.getRow(5);
    assert.equal(reversal.getCell(col(sheet, "Order Type")).value, "Reversal");
    assert.equal(reversal.getCell(col(sheet, "Order Date")).value.toISOString(), "2026-09-10T12:00:00.000Z");
    assert.equal(reversal.getCell(col(sheet, "Net Items Sold")).value, -1);
    assert.equal(reversal.getCell(col(sheet, "Net Sales")).value, -100);
    assert.equal(reversal.getCell(col(sheet, "Total Sales")).value, -105);
    assert.equal(reversal.getCell(col(sheet, "Return Reason")).value, "Too big");
  });

  test("the rows carry real values, typed", async () => {
    const db = fakeDb({ ...files, params: request() });
    await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });
    const sheet = await sheetOf(db);
    const first = sheet.getRow(2);
    assert.equal(first.getCell(col(sheet, "Order Name")).value, "#1");
    assert.equal(first.getCell(col(sheet, "Order Date")).value.toISOString(), "2026-09-02T12:00:00.000Z"); // 08:00 UTC is 12:00 in Muscat
    assert.equal(first.getCell(col(sheet, "Order Type")).value, "Order");
    assert.equal(first.getCell(col(sheet, "Sales Channel")).value, "Point of Sale");
    assert.equal(first.getCell(col(sheet, "POS Location")).value, "Al Ain");
    assert.equal(first.getCell(col(sheet, "POS Staff")).value, "Sara");
    assert.equal(first.getCell(col(sheet, "Collection Name")).value, "Boys");
    assert.equal(first.getCell(col(sheet, "Product Variant Barcode")).value, "BC-T1");
    assert.equal(first.getCell(col(sheet, "Net Sales")).value, 50);
    assert.equal(first.getCell(col(sheet, "Total Sales")).value, 52.5);
    const shipping = sheet.getRow(4);
    assert.equal(shipping.getCell(col(sheet, "Shipping Charges (excl. VAT)")).value, 20.95);
    assert.equal(shipping.getCell(col(sheet, "Is Shipping Charges")).value, "Yes");
    assert.equal(shipping.getCell(col(sheet, "Total Sales")).value, 22);
    assert.equal(shipping.getCell(col(sheet, "POS Staff")).value, null); // online order
  });

  test("only the chosen fields become columns", async () => {
    const db = fakeDb({ ...files, params: request({ fields: ["totalSales", "orderName"] }) });
    await generateReport({ db, admin: {}, jobId: "job1" });
    assert.deepEqual(headers(await sheetOf(db)), ["Order Name", "Total Sales"]); // config order, not request order
  });

  test("staff names are only looked up when the report shows or filters on them", async () => {
    let lookups = 0;
    const deps = { fetchStaff: async () => { lookups += 1; return STAFF; } };
    await generateReport({ db: fakeDb({ ...files, params: request({ fields: ["orderName"] }) }), admin: {}, jobId: "job1", deps });
    assert.equal(lookups, 0);
    await generateReport({ db: fakeDb({ ...files, params: request({ fields: ["orderName", "posStaff"] }) }), admin: {}, jobId: "job1", deps });
    assert.equal(lookups, 1);
    await generateReport({ db: fakeDb({ ...files, params: request({ fields: ["orderName"], filters: { posStaff: ["Sara"] } }) }), admin: {}, jobId: "job1", deps });
    assert.equal(lookups, 2);
  });

  test("the staff lookup uses the request's store days", async () => {
    let seen;
    const deps = { fetchStaff: async (_admin, from, to) => { seen = [from, to]; return STAFF; } };
    await generateReport({ db: fakeDb({ ...files, params: request() }), admin: {}, jobId: "job1", deps });
    assert.deepEqual(seen, ["2026-09-01", "2026-09-30"]);
  });

  test("filters narrow the rows", async () => {
    const db = fakeDb({ ...files, params: request({ filters: { salesChannel: ["web"] } }) });
    const outcome = await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });
    assert.equal(outcome.rows, 2); // the web order's line and its shipping row
    assert.equal((await sheetOf(db)).getRow(2).getCell(1).value, "#2");
  });

  test("the POS Staff filter keeps that person's rows, including their returns", async () => {
    const db = fakeDb({ ...files, params: request({ filters: { posStaff: ["Omar"] } }) });
    const outcome = await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });
    assert.equal(outcome.rows, 1); // #3's return only
    assert.equal((await sheetOf(db)).getRow(2).getCell(1).value, "#3");
  });

  test("Payment Method sits on the first row left after filtering", async () => {
    const db = fakeDb({ ...files, params: request({ filters: { collection: ["Girls"] } }) });
    await generateReport({ db, admin: {}, jobId: "job1", deps: withStaff });
    const sheet = await sheetOf(db);
    assert.equal(sheet.getRow(2).getCell(col(sheet, "Payment Method")).value, "card"); // the line row survives, the shipping row does not
  });

  test("the Request sheet shows the period, readable filter names and the notes", async () => {
    const db = fakeDb({ ...files, params: request({ filters: { posLocation: [ALAIN] }, filterSummary: [{ key: "posLocation", label: "POS Location", values: ["Al Ain"] }] }) });
    await generateReport({ db, admin: {}, jobId: "job1", deps: { ...withStaff, now: () => new Date("2026-10-04T12:00:00Z") } });
    const info = (await read(db)).getWorksheet("Request");
    const lines = new Map();
    const notes = [];
    info.eachRow((row) => {
      lines.set(row.getCell(1).value, row.getCell(2).value);
      if (row.getCell(1).value === "Note") notes.push(row.getCell(2).value);
    });
    assert.equal(lines.get("Period"), "2026-09-01 to 2026-09-30 (Asia/Muscat)");
    assert.equal(lines.get("Generated (store time)").toISOString(), "2026-10-04T16:00:00.000Z"); // 12:00 UTC is 16:00 in Muscat, shown as written
    assert.equal(lines.get("POS Location"), "Al Ain");
    assert.equal(lines.get("Rows"), 2); // #1 and #3 are the Al Ain orders in range
    assert.ok(notes.some((note) => /day it happened/.test(note)));
    assert.ok(notes.some((note) => /Refund Credit Report/.test(note)));
  });

  test("a second trigger does not build the file again", async () => {
    const db = fakeDb({ ...files, params: request({ fields: ["orderName"] }) });
    let writes = 0;
    const deps = { write: async (args) => { writes += 1; return (await import("../app/pipeline/report-xlsx.js")).writeReportXlsx(args); } };
    const outcomes = await Promise.all([generateReport({ db, admin: {}, jobId: "job1", deps }), generateReport({ db, admin: {}, jobId: "job1", deps })]);
    assert.deepEqual(outcomes.map((o) => o.action).sort(), ["ready", "skipped"]);
    assert.equal(writes, 1);
  });

  test("a job that is not DATA_READY is left alone", async () => {
    for (const stage of [STAGES.ORDERS_RUNNING, STAGES.READY, STAGES.FAILED, STAGES.GENERATING]) {
      const db = fakeDb({ ...files, stage });
      assert.equal((await generateReport({ db, jobId: "job1" })).action, "skipped", stage);
      assert.equal(db.row.stage, stage);
    }
  });

  test("missing data files fail the job with a reason", async () => {
    for (const missing of ["ordersFile", "eventsFile", "productsFile"]) {
      const db = fakeDb({ ...files, [missing]: null, params: request() });
      const outcome = await generateReport({ db, jobId: "job1" });
      assert.equal(outcome.action, "failed", missing);
      assert.match(db.row.error, /Could not build the report file: the downloaded data files are missing/);
    }
  });

  test("a staff lookup that cannot finish fails the job instead of writing a file without names", async () => {
    const db = fakeDb({ ...files, params: request() });
    const outcome = await generateReport({ db, admin: {}, jobId: "job1", deps: { fetchStaff: async () => { throw new Error("Could not read POS staff from Shopify after 5 tries"); } } });
    assert.equal(outcome.action, "failed");
    assert.equal(db.row.stage, STAGES.FAILED);
    assert.match(db.row.error, /Could not read POS staff/);
    assert.equal(db.row.resultFileUrl, null);
  });

  test("staff are needed but there is no Shopify connection: fails clearly", async () => {
    const db = fakeDb({ ...files, params: request() });
    assert.equal((await generateReport({ db, jobId: "job1" })).action, "failed");
    assert.match(db.row.error, /no Shopify connection/);
  });

  test("a request without a date range fails clearly", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales", fields: ["orderName"] }) });
    assert.equal((await generateReport({ db, jobId: "job1" })).action, "failed");
    assert.match(db.row.error, /no date range/);
  });

  test("a writer error fails the job and keeps the message", async () => {
    const db = fakeDb({ ...files, params: request({ fields: ["orderName"] }) });
    const outcome = await generateReport({ db, admin: {}, jobId: "job1", deps: { write: async () => { throw new Error("disk full"); } } });
    assert.equal(outcome.action, "failed");
    assert.match(db.row.error, /disk full/);
  });

  test("an empty column selection fails clearly", async () => {
    const db = fakeDb({ ...files, params: request({ fields: ["madeUp"] }) });
    assert.equal((await generateReport({ db, admin: {}, jobId: "job1" })).action, "failed");
    assert.match(db.row.error, /no columns were selected/);
  });

  test("jobs of other kinds (debug jobs) are not given a file", async () => {
    const db = fakeDb({ ...files, reportType: "debugPipeline" });
    assert.equal((await generateReport({ db, jobId: "job1" })).action, "not-supported");
    assert.equal(db.row.stage, STAGES.DATA_READY);
    assert.deepEqual(GENERATED_REPORT_TYPES, ["generalSales"]);
  });

  test("an unknown job id is an error", async () => {
    await assert.rejects(generateReport({ db: fakeDb({}), jobId: "nope" }), /No job nope/);
  });
});

describe("buildReportColumns", () => {
  test("keeps config order and drops unavailable fields", () => {
    assert.deepEqual(buildReportColumns("generalSales", ["totalSales", "posStaff", "sku"]).map((c) => c.key), ["posStaff", "sku", "totalSales"]);
    withStaffUnavailable(() => assert.deepEqual(buildReportColumns("generalSales", ["totalSales", "posStaff", "sku"]).map((c) => c.key), ["sku", "totalSales"]));
  });
  test("no selection means the defaults", () => {
    assert.deepEqual(buildReportColumns("generalSales", null).map((c) => c.key), defaultFieldKeys("generalSales"));
  });
  test("columns carry label, type and optional width from the config", () => {
    const [orderName] = buildReportColumns("generalSales", ["orderName"]);
    assert.deepEqual(orderName, { key: "orderName", label: "Order Name", type: "string", width: 12 });
  });
});

describe("storage helpers", () => {
  test("local urls round-trip, and S3-style urls are not treated as local", () => {
    const path = jobReportPath("abc");
    assert.equal(fromLocalUrl(toLocalUrl(path)), path);
    assert.equal(fromLocalUrl("s3://bucket/key"), null);
    assert.equal(fromLocalUrl(null), null);
  });
  test("job ids are checked", () => assert.throws(() => jobReportPath("../etc"), /Unsafe job id/));
});

describe("advanceAndGenerate", () => {
  const result = { job: { id: "job1" }, which: "products", operation: {} };

  test("builds the report only when the chain says all data is in", async () => {
    let generated = 0;
    const deps = { advanceJob: async () => ({ action: "data-ready" }), generateReport: async () => { generated += 1; return { action: "ready", rows: 5 }; } };
    const outcome = await advanceAndGenerate({ db: {}, admin: {}, result, deps });
    assert.equal(outcome.action, "ready");
    assert.equal(generated, 1);
  });

  test("any other chain outcome is returned untouched and nothing is built", async () => {
    for (const action of ["products-started", "skipped", "failed"]) {
      let generated = 0;
      const outcome = await advanceAndGenerate({ db: {}, admin: {}, result, deps: { advanceJob: async () => ({ action }), generateReport: async () => { generated += 1; } } });
      assert.equal(outcome.action, action);
      assert.equal(generated, 0);
    }
  });

  test("a build problem is visible in the action", async () => {
    const outcome = await advanceAndGenerate({ db: {}, admin: {}, result, deps: { advanceJob: async () => ({ action: "data-ready" }), generateReport: async () => ({ action: "failed" }) } });
    assert.equal(outcome.action, "data-ready:failed");
  });
});
