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

const money = (a) => ({ shopMoney: { amount: String(a), currencyCode: "AED" } });
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const HEAD = "gid://shopify/Location/HEAD";
const ALAIN = "gid://shopify/Location/ALAIN";

const ORDERS = [
  { id: "O1", name: "#1", createdAt: "2026-09-02T08:00:00Z", sourceName: "pos", retailLocation: { id: ALAIN, name: "Al Ain" }, paymentGatewayNames: ["cash"], taxesIncluded: true, currentShippingPriceSet: money(0) },
  { id: "gid://shopify/LineItem/1", title: "Trouser", sku: "T1", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money(52.5), taxLines: [{ rate: 0.05, priceSet: money(2.5) }], product: { id: "P1" }, variant: { id: "V1", barcode: "6290000000011" }, discountAllocations: [], __parentId: "O1" },
  { id: "O2", name: "#2", createdAt: "2026-09-03T08:00:00Z", sourceName: "web", retailLocation: null, paymentGatewayNames: ["card"], taxesIncluded: true, currentShippingPriceSet: money(22) },
  { id: "gid://shopify/LineItem/2", title: "Skirt", sku: "S1", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money(105), taxLines: [{ rate: 0.05, priceSet: money(5) }], product: { id: "P2" }, variant: { id: "V2", barcode: null }, discountAllocations: [], __parentId: "O2" },
];
const PRODUCTS = [
  { id: "P1", title: "Trouser", status: "ACTIVE", tags: [] },
  { id: "gid://shopify/Collection/1", title: "Boys", __parentId: "P1" },
  { id: "P2", title: "Skirt", status: "ACTIVE", tags: [] },
  { id: "gid://shopify/Collection/2", title: "Girls", __parentId: "P2" },
];

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
    files = { ordersFile: join(dir, "orders.jsonl"), productsFile: join(dir, "products.jsonl") };
    await writeFile(files.ordersFile, jsonl(ORDERS));
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

  test("builds the file, marks the job READY and records where the file is", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales", filters: {}, fields: null, localRange: { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Muscat" } }) });
    const outcome = await generateReport({ db, jobId: "job1" });

    assert.equal(outcome.action, "ready");
    assert.equal(outcome.rows, 3); // two lines + the online order's shipping row
    assert.equal(db.row.stage, STAGES.READY);
    assert.match(db.row.resultFileUrl, /^local:jobs\/job1\/report\.xlsx$/);
    assert.ok(existsSync(fromLocalUrl(db.row.resultFileUrl)));
    assert.equal(fromLocalUrl(db.row.resultFileUrl), jobReportPath("job1"));
  });

  test("with no field selection the sheet has every available column, in config order", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales", filters: {} }) });
    await generateReport({ db, jobId: "job1" });
    const sheet = (await read(db)).getWorksheet("General Sales Report");
    assert.equal(headers(sheet).length, 20); // POS Staff has no data on this plan
    assert.equal(headers(sheet)[0], "Order Name");
    assert.ok(!headers(sheet).includes("POS Staff"));
    assert.equal(headers(sheet).at(-1), "Total Sales");
  });

  test("the rows carry real values, typed", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales" }) });
    await generateReport({ db, jobId: "job1" });
    const sheet = (await read(db)).getWorksheet("General Sales Report");
    const col = (label) => headers(sheet).indexOf(label) + 1;
    const first = sheet.getRow(2);
    assert.equal(first.getCell(col("Order Name")).value, "#1");
    assert.equal(first.getCell(col("Order Date")).value.toISOString(), "2026-09-02T12:00:00.000Z"); // 08:00 UTC is 12:00 in Muscat
    assert.equal(first.getCell(col("Sales Channel")).value, "Point of Sale");
    assert.equal(first.getCell(col("POS Location")).value, "Al Ain");
    assert.equal(first.getCell(col("Collection Name")).value, "Boys");
    assert.equal(first.getCell(col("Product Variant Barcode")).value, "6290000000011");
    assert.equal(first.getCell(col("Net Sales")).value, 50);
    assert.equal(first.getCell(col("Total Sales")).value, 52.5);
    const shipping = sheet.getRow(4);
    assert.equal(shipping.getCell(col("Shipping Charges (excl. VAT)")).value, 20.95);
    assert.equal(shipping.getCell(col("Total Sales")).value, 22);
  });

  test("only the chosen fields become columns", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales", fields: ["totalSales", "orderName"] }) });
    await generateReport({ db, jobId: "job1" });
    assert.deepEqual(headers((await read(db)).getWorksheet("General Sales Report")), ["Order Name", "Total Sales"]); // config order, not request order
  });

  test("filters narrow the rows", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales", filters: { salesChannel: ["web"] } }) });
    const outcome = await generateReport({ db, jobId: "job1" });
    assert.equal(outcome.rows, 2); // the web order's line and its shipping row
    const sheet = (await read(db)).getWorksheet("General Sales Report");
    assert.equal(sheet.getRow(2).getCell(1).value, "#2");
  });

  test("the Request sheet shows the period and readable filter names", async () => {
    const db = fakeDb({
      ...files,
      params: JSON.stringify({ reportKey: "generalSales", filters: { posLocation: [ALAIN] }, filterSummary: [{ key: "posLocation", label: "POS Location", values: ["Al Ain"] }], localRange: { from: "2026-09-01", to: "2026-09-30", timeZone: "Asia/Muscat" } }),
    });
    await generateReport({ db, jobId: "job1", deps: { now: () => new Date("2026-10-04T12:00:00Z") } });
    const info = (await read(db)).getWorksheet("Request");
    const lines = new Map();
    info.eachRow((row) => lines.set(row.getCell(1).value, row.getCell(2).value));
    assert.equal(lines.get("Period"), "2026-09-01 to 2026-09-30 (Asia/Muscat)");
    assert.equal(lines.get("Generated (store time)").toISOString(), "2026-10-04T16:00:00.000Z"); // 12:00 UTC is 16:00 in Muscat, shown as written
    assert.equal(lines.get("POS Location"), "Al Ain");
    assert.equal(lines.get("Rows"), 1);
  });

  test("a second trigger does not build the file again", async () => {
    const db = fakeDb({ ...files, params: "{}" });
    let writes = 0;
    const deps = { write: async (args) => { writes += 1; return (await import("../app/pipeline/report-xlsx.js")).writeReportXlsx(args); } };
    const outcomes = await Promise.all([generateReport({ db, jobId: "job1", deps }), generateReport({ db, jobId: "job1", deps })]);
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
    const db = fakeDb({ params: "{}" });
    const outcome = await generateReport({ db, jobId: "job1" });
    assert.equal(outcome.action, "failed");
    assert.equal(db.row.stage, STAGES.FAILED);
    assert.match(db.row.error, /Could not build the report file: the downloaded data files are missing/);
  });

  test("a writer error fails the job and keeps the message", async () => {
    const db = fakeDb({ ...files, params: "{}" });
    const outcome = await generateReport({ db, jobId: "job1", deps: { write: async () => { throw new Error("disk full"); } } });
    assert.equal(outcome.action, "failed");
    assert.match(db.row.error, /disk full/);
  });

  test("an empty column selection fails clearly", async () => {
    const db = fakeDb({ ...files, params: JSON.stringify({ reportKey: "generalSales", fields: ["posStaff"] }) });
    assert.equal((await generateReport({ db, jobId: "job1" })).action, "failed");
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
    assert.deepEqual(buildReportColumns("generalSales", ["totalSales", "posStaff", "sku"]).map((c) => c.key), ["sku", "totalSales"]);
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
