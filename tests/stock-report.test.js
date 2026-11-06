import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { groupInventory, readJsonl, verifyInventoryFile } from "../app/pipeline/bulk-file.js";
import { buildStockRows, levelQuantities, stockColumns, summarizeStock } from "../app/pipeline/stock-rows.js";
import { buildInventoryBulkQuery } from "../app/pipeline/inventory-bulk-query.js";
import { advanceJob } from "../app/pipeline/job-chain.js";
import { startReportJob } from "../app/pipeline/start-job.js";
import { generateReport } from "../app/pipeline/report-generation.js";
import { recoverStuckJobs } from "../app/pipeline/job-recovery.js";
import { parseReportRequest } from "../app/pipeline/report-request.js";
import { handleBulkOperationsFinish } from "../app/pipeline/bulk-finish.js";
import { fromLocalUrl } from "../app/pipeline/storage.js";
import { STAGES } from "../app/pipeline/job-stages.js";

const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const ALQUOZ = "gid://shopify/Location/1";
const ALAIN = "gid://shopify/Location/2";
const level = (id, locationId, name, committed, available, onHand, parent, isActive = true) => ({
  id,
  isActive,
  location: { id: locationId, name },
  quantities: [{ name: "available", quantity: available }, { name: "committed", quantity: committed }, { name: "on_hand", quantity: onHand }],
  __parentId: parent,
});

// Three items at Al Quoz (one zero-stock, one oversold), one only at Al Ain,
// one whose product no longer exists.
const INVENTORY = [
  { id: "gid://shopify/InventoryItem/1", variant: { id: "V1" } },
  level("gid://shopify/InventoryLevel/11", ALQUOZ, "Al Quoz", 4, 36, 40, "gid://shopify/InventoryItem/1"),
  level("gid://shopify/InventoryLevel/12", ALAIN, "Al Ain", 0, 9, 9, "gid://shopify/InventoryItem/1"),
  { id: "gid://shopify/InventoryItem/2", variant: { id: "V2" } },
  level("gid://shopify/InventoryLevel/21", ALQUOZ, "Al Quoz", 7, 5, 12, "gid://shopify/InventoryItem/2"),
  // deactivated at Al Ain but still holding stock: Shopify's analytics counts it
  level("gid://shopify/InventoryLevel/22", ALAIN, "Al Ain", 0, 40, 40, "gid://shopify/InventoryItem/2", false),
  { id: "gid://shopify/InventoryItem/3", variant: { id: "V3" } },
  level("gid://shopify/InventoryLevel/31", ALQUOZ, "Al Quoz", 0, 0, 0, "gid://shopify/InventoryItem/3"),
  { id: "gid://shopify/InventoryItem/4", variant: { id: "V4" } },
  level("gid://shopify/InventoryLevel/41", ALQUOZ, "Al Quoz", 2, -2, 0, "gid://shopify/InventoryItem/4"),
  { id: "gid://shopify/InventoryItem/5", variant: { id: "V-gone" } },
  level("gid://shopify/InventoryLevel/51", ALQUOZ, "Al Quoz", 1, 1, 2, "gid://shopify/InventoryItem/5"),
  { id: "gid://shopify/InventoryItem/6", variant: { id: "V5" } },
  level("gid://shopify/InventoryLevel/61", ALAIN, "Al Ain", 0, 3, 3, "gid://shopify/InventoryItem/6"),
];
const variant = (id, sku, barcode, parent) => ({ id, sku, barcode, title: "10", price: "50.00", __parentId: parent });
const PRODUCTS = [
  { id: "P1", title: "PE T-shirt", status: "ACTIVE", tags: ["school", "adek"] },
  { id: "gid://shopify/Collection/1", title: "ADEK Uniforms", __parentId: "P1" },
  variant("gid://shopify/ProductVariant/V1", "ADK-1", "6290000000011", "P1"),
  { id: "P2", title: "Winter Jacket", status: "ACTIVE", tags: ["winter"] },
  { id: "gid://shopify/Collection/2", title: "Jackets", __parentId: "P2" },
  variant("gid://shopify/ProductVariant/V2", "JKT-1", "6290000000028", "P2"),
  variant("gid://shopify/ProductVariant/V3", "JKT-2", null, "P2"),
  variant("gid://shopify/ProductVariant/V4", "JKT-3", "6290000000035", "P2"),
  { id: "P3", title: "Belt", status: "ACTIVE", tags: [] },
  variant("gid://shopify/ProductVariant/V5", null, null, "P3"),
];
// Variant ids in the inventory file are full gids; keep the fixtures short.
const gid = (items) => items.map((line) => (line.variant ? { ...line, variant: { id: `gid://shopify/ProductVariant/${line.variant.id}` } } : line));

let dir;
let files;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "stock-"));
  files = { inventoryFile: join(dir, "inventory.jsonl"), productsFile: join(dir, "products.jsonl") };
  await writeFile(files.inventoryFile, jsonl(gid(INVENTORY)));
  await writeFile(files.productsFile, jsonl(PRODUCTS));
});
after(async () => rm(dir, { recursive: true, force: true }));

describe("inventory export", () => {
  test("the query asks for items, their variant and the three quantities per location", () => {
    const query = buildInventoryBulkQuery();
    assert.match(query, /inventoryItems/);
    assert.match(query, /variant \{ id \}/);
    assert.match(query, /quantities\(names: \["available", "committed", "on_hand"\]\)/);
    assert.match(query, /location \{ id name \}/);
    assert.match(query, /inventoryLevels\(includeInactive: true\)/); // stock at deactivated item-locations still counts
    assert.match(query, /isActive/);
  });

  test("levels are attached to their item, and the file is verified", async () => {
    const items = [];
    for await (const item of groupInventory(readJsonl(files.inventoryFile))) items.push(item);
    assert.equal(items.length, 6);
    assert.equal(items[0].levels.length, 2);
    assert.deepEqual(levelQuantities(items[0].levels[0]), { committed: 4, available: 36, onHand: 40 });
    assert.deepEqual(await verifyInventoryFile(files.inventoryFile), { items: 6, levels: 8 });
  });

  test("an item without levels still comes through", async () => {
    const file = join(dir, "no-levels.jsonl");
    await writeFile(file, jsonl([{ id: "gid://shopify/InventoryItem/9", variant: null }]));
    assert.deepEqual(await verifyInventoryFile(file), { items: 1, levels: 0 });
  });
});

describe("buildStockRows", () => {
  test("lists the items at the location, by collection and product; hideZero leaves out all-zero levels", async () => {
    const { rows, locationNames, stats } = await buildStockRows(files, { locationIds: [ALQUOZ], hideZero: true });
    assert.deepEqual(locationNames, ["Al Quoz"]);
    assert.deepEqual(rows.map((r) => r.sku), ["ADK-1", "JKT-1", "JKT-3"]);
    assert.deepEqual(rows[0], { locationName: "Al Quoz", collectionName: "ADEK Uniforms", productName: "PE T-shirt", sku: "ADK-1", barcode: "6290000000011", stockCommitted: 4, stockAvailable: 36, stockOnHand: 40 });
    assert.equal(stats.hiddenNoStock, 1);
    assert.equal(stats.noVariant, 1);
    assert.equal(stats.low, 2); // 5 available and -2 available
  });

  test("oversold (negative available) items are listed as they are", async () => {
    const { rows } = await buildStockRows(files, { locationIds: [ALQUOZ] });
    assert.equal(rows.find((r) => r.sku === "JKT-3").stockAvailable, -2);
  });

  test("by default the all-zero levels are listed too", async () => {
    const { rows, stats } = await buildStockRows(files, { locationIds: [ALQUOZ] });
    assert.ok(rows.some((r) => r.sku === "JKT-2" && r.barcode === null));
    assert.equal(rows.length, 4);
    assert.equal(stats.hiddenNoStock, 0);
  });

  test("the collection and tag filters narrow the rows", async () => {
    const byCollection = await buildStockRows(files, { locationIds: [ALQUOZ], collections: ["Jackets"], hideZero: true });
    assert.deepEqual(byCollection.rows.map((r) => r.sku), ["JKT-1", "JKT-3"]);
    const byTag = await buildStockRows(files, { locationIds: [ALQUOZ], tags: ["adek", "other"] });
    assert.deepEqual(byTag.rows.map((r) => r.sku), ["ADK-1"]);
  });

  test("the no-stock count only covers records that pass the collection and tag filters", async () => {
    const { stats } = await buildStockRows(files, { locationIds: [ALQUOZ], collections: ["Jackets"], hideZero: true });
    assert.equal(stats.hiddenNoStock, 1); // JKT-2; the zero-stock item of another collection is not counted
    const other = await buildStockRows(files, { locationIds: [ALQUOZ], collections: ["ADEK Uniforms"], hideZero: true });
    assert.equal(other.stats.hiddenNoStock, 0);
  });

  test("another location gets its own rows; a product with no collection has a blank one", async () => {
    const { rows, locationNames } = await buildStockRows(files, { locationIds: [ALAIN] });
    assert.deepEqual(locationNames, ["Al Ain"]);
    assert.deepEqual(rows.map((r) => [r.sku, r.collectionName]), [[null, null], ["ADK-1", "ADEK Uniforms"], ["JKT-1", "Jackets"]]);
  });

  test("with no location chosen every location is listed, one row per item and location, by location first", async () => {
    const { rows, locationNames } = await buildStockRows(files, {});
    assert.deepEqual(locationNames, ["Al Ain", "Al Quoz"]);
    assert.equal(rows.length, 7); // 4 at Al Quoz (zero level shown) + 3 at Al Ain (one of them inactive)
    assert.deepEqual(rows.slice(0, 3).map((x) => x.locationName), ["Al Ain", "Al Ain", "Al Ain"]);
    assert.ok(rows.slice(3).every((x) => x.locationName === "Al Quoz"));
  });

  test("two locations can be chosen together", async () => {
    const { rows } = await buildStockRows(files, { locationIds: [ALQUOZ, ALAIN], hideZero: true });
    assert.equal(rows.length, 6);
  });

  test("stock at a deactivated item-location is listed and counted separately", async () => {
    const { rows, stats } = await buildStockRows(files, { locationIds: [ALAIN] });
    const inactive = rows.find((x) => x.sku === "JKT-1");
    assert.equal(inactive.stockOnHand, 40);
    assert.equal(stats.inactiveRows, 1);
    assert.equal(stats.inactiveOnHand, 40);
    const quoz = await buildStockRows(files, { locationIds: [ALQUOZ] });
    assert.equal(quoz.stats.inactiveRows, 0);
  });

  test("summary counts low and negative items and totals the quantities", async () => {
    const { rows } = await buildStockRows(files, { locationIds: [ALQUOZ], hideZero: true });
    assert.deepEqual(summarizeStock(rows), { items: 3, low: 2, negative: 1, committed: 13, available: 39, onHand: 52 });
  });

  test("the columns come from the config, with Collection Name right before Product Name", () => {
    assert.deepEqual(stockColumns().map((c) => c.label), ["Collection Name", "Product Name", "SKU", "Barcode", "Stock Committed", "Stock Available", "Stock On Hand"]);
  });

  test("a Location Name column leads the sheet only when the report covers several locations", () => {
    assert.deepEqual(stockColumns({ withLocation: true }).map((c) => c.label).slice(0, 2), ["Location Name", "Collection Name"]);
  });
});

// ------------------------------------------------------------------ the chain

function fakeDb(initial) {
  const jobs = new Map(initial.map((j) => [j.id, { ...j }]));
  return {
    jobs,
    reportJob: {
      create: async ({ data }) => {
        const job = { id: `job${jobs.size + 1}`, error: null, ...data };
        jobs.set(job.id, job);
        return { ...job };
      },
      update: async ({ where, data }) => Object.assign(jobs.get(where.id), data),
      findFirst: async ({ where }) => [...jobs.values()].find((job) => job.shop === where.shop && where.OR.some((cond) => Object.entries(cond).every(([k, v]) => job[k] === v))) ?? null,
      updateMany: async ({ where, data }) => {
        const job = jobs.get(where.id);
        if (!job || (where.stage !== undefined && job.stage !== where.stage)) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      },
    },
  };
}
const stockJob = (overrides = {}) => ({ id: "job1", shop: "s.myshopify.com", reportType: "stockByLocation", stage: STAGES.PRODUCTS_RUNNING, productsBulkOpId: "op-products", params: "{}", ...overrides });
const done = (job, which) => ({ job, which, operation: { id: `op-${which}`, status: "COMPLETED", url: "https://example.test/f" } });

describe("a stock job", () => {
  test("starts with the products export and no date range", async () => {
    const db = fakeDb([]);
    const job = await startReportJob({ db, admin: {}, shop: "s", reportType: "stockByLocation", params: { reportKey: "stockByLocation" }, startProducts: async () => ({ id: "op-products" }), startOrders: async () => assert.fail("a stock job does not export orders") });
    assert.equal(job.stage, STAGES.PRODUCTS_RUNNING);
    assert.equal(job.productsBulkOpId, "op-products");
    assert.equal(JSON.parse(job.params).range, undefined);
  });

  test("products done: rests at PRODUCTS_READY and starts the inventory export", async () => {
    const db = fakeDb([stockJob()]);
    const started = [];
    const outcome = await advanceJob({
      db, admin: {}, result: done(db.jobs.get("job1"), "products"),
      deps: { download: async () => {}, verify: { products: async () => ({}) }, filePath: (id, w) => `/d/${id}/${w}.jsonl`, start: { inventory: async () => { started.push(1); return { id: "op-inventory" }; } } },
    });
    assert.equal(outcome.action, "inventory-started");
    assert.equal(db.jobs.get("job1").stage, STAGES.INVENTORY_RUNNING);
    assert.equal(db.jobs.get("job1").inventoryBulkOpId, "op-inventory");
    assert.equal(db.jobs.get("job1").productsFile, "/d/job1/products.jsonl");
    assert.equal(started.length, 1);
  });

  test("inventory done: DATA_READY, nothing further started", async () => {
    const db = fakeDb([stockJob({ stage: STAGES.INVENTORY_RUNNING, inventoryBulkOpId: "op-inventory", productsFile: "/d/p" })]);
    const outcome = await advanceJob({ db, admin: {}, result: done(db.jobs.get("job1"), "inventory"), deps: { download: async () => {}, verify: { inventory: async () => ({ items: 5, levels: 9 }) }, filePath: (id, w) => `/d/${id}/${w}.jsonl` } });
    assert.equal(outcome.action, "data-ready");
    assert.equal(db.jobs.get("job1").stage, STAGES.DATA_READY);
    assert.equal(db.jobs.get("job1").inventoryFile, "/d/job1/inventory.jsonl");
  });

  test("a failed inventory export fails the job and says which export", async () => {
    const db = fakeDb([stockJob({ stage: STAGES.INVENTORY_RUNNING, inventoryBulkOpId: "op-inventory" })]);
    await advanceJob({ db, admin: {}, result: { job: db.jobs.get("job1"), which: "inventory", operation: { status: "FAILED", errorCode: "INTERNAL_SERVER_ERROR" } } });
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
    assert.match(db.jobs.get("job1").error, /stock levels export FAILED/);
  });

  test("the finish webhook finds a job by its inventory export", async () => {
    const db = fakeDb([stockJob({ stage: STAGES.INVENTORY_RUNNING, inventoryBulkOpId: "gid://shopify/BulkOperation/7" })]);
    const admin = { graphql: async () => ({ json: async () => ({ data: { node: { id: "gid://shopify/BulkOperation/7", status: "COMPLETED" } } }) }) };
    const result = await handleBulkOperationsFinish({ shop: "s.myshopify.com", payload: { admin_graphql_api_id: "gid://shopify/BulkOperation/7" }, admin, db });
    assert.equal(result.which, "inventory");
  });

  test("recovery restarts a stuck products-to-inventory hand-over", async () => {
    const now = new Date("2026-11-05T12:00:00Z");
    const db = {
      reportJob: {
        findMany: async () => [{ ...stockJob({ stage: STAGES.PRODUCTS_READY, error: "busy", updatedAt: new Date("2026-11-05T11:00:00Z"), createdAt: new Date("2026-11-05T11:55:00Z") }) }],
        updateMany: async () => ({ count: 1 }),
        update: async () => ({}),
      },
    };
    const outcomes = await recoverStuckJobs({ db, getAdmin: async () => ({}), now, deps: { start: { inventory: async () => ({ id: "op-inventory" }) } } });
    assert.equal(outcomes[0].action, "inventory-started");
  });
});

describe("the stock request", () => {
  const options = { posLocation: [ALQUOZ, ALAIN], collection: ["Jackets"], tag: ["winter"], zeroStock: ["hide"] };
  test("a location is optional (empty means all), several can be chosen, and there is no date range", () => {
    const none = parseReportRequest("stockByLocation", { filters: {} }, { allowedOptions: options });
    assert.equal(none.ok, true);
    assert.deepEqual(none.value.filters, {});
    assert.equal(parseReportRequest("stockByLocation", { filters: { posLocation: [ALQUOZ, ALAIN] } }, { allowedOptions: options }).ok, true);
    assert.equal(parseReportRequest("stockByLocation", { filters: { posLocation: ["gid://nope"] } }, { allowedOptions: options }).ok, false);
    const ok = parseReportRequest("stockByLocation", { filters: { posLocation: [ALQUOZ], tag: ["winter"], zeroStock: ["hide"] } }, { allowedOptions: options });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.range, null);
    assert.deepEqual(ok.value.filters, { posLocation: [ALQUOZ], tag: ["winter"], zeroStock: ["hide"] });
  });
});

// ---------------------------------------------------------------- the report

describe("generateReport for the stock report", () => {
  const request = (filters) => JSON.stringify({ reportKey: "stockByLocation", filters, filterSummary: [{ key: "posLocation", label: "Location", values: ["Emirates Al Quoz"] }], cutoff: "2026-11-05T10:00:00.000Z" });
  const fake = (params) => {
    const row = { id: "job1", shop: "s", reportType: "stockByLocation", stage: STAGES.DATA_READY, error: null, ...files, params };
    return {
      row,
      reportJob: {
        findUnique: async () => ({ ...row }),
        updateMany: async ({ where, data }) => (row.stage === where.stage ? (Object.assign(row, data), { count: 1 }) : { count: 0 }),
        update: async ({ data }) => Object.assign(row, data),
      },
      locationMapping: { findMany: async () => [] },
    };
  };
  const original = process.env.REPORT_STORAGE_DIR;
  before(() => { process.env.REPORT_STORAGE_DIR = dir; });
  after(() => { if (original === undefined) delete process.env.REPORT_STORAGE_DIR; else process.env.REPORT_STORAGE_DIR = original; });

  test("writes the location header, the table, red highlighting and a Summary (no-stock items hidden)", async () => {
    const db = fake(request({ posLocation: [ALQUOZ], zeroStock: ["hide"] }));
    const outcome = await generateReport({ db, jobId: "job1", deps: { keepWorkFiles: true } });
    assert.equal(outcome.action, "ready", db.row.error);
    assert.equal(outcome.rows, 3);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fromLocalUrl(db.row.resultFileUrl));
    const sheet = workbook.getWorksheet("Stock Report by Location");
    assert.deepEqual(sheet.getRow(1).values.slice(1, 3), ["Location", "Emirates Al Quoz"]);
    assert.equal(sheet.getRow(2).values.length, 0); // blank line
    assert.deepEqual(sheet.getRow(3).values.slice(1), ["Collection Name", "Product Name", "SKU", "Barcode", "Stock Committed", "Stock Available", "Stock On Hand"]);
    assert.deepEqual(sheet.getRow(4).values.slice(1), ["ADEK Uniforms", "PE T-shirt", "ADK-1", "6290000000011", 4, 36, 40]);
    assert.equal(sheet.getCell("F5").value, 5);

    // The red rule is conditional formatting on the data rows, keyed on Stock Available.
    const [{ ref, rules }] = sheet.conditionalFormattings;
    assert.equal(ref, "A4:G6");
    assert.equal(rules[0].type, "expression");
    assert.deepEqual(rules[0].formulae, ["$F4<=5"]);

    assert.equal(sheet.views[0].ySplit, 3);
    const summary = workbook.getWorksheet("Summary");
    assert.equal(summary.getCell("A1").value, "Items listed");
    assert.equal(summary.getCell("B1").value, 3);
    const info = workbook.getWorksheet("Request");
    assert.match(info.getCell("B3").value, /not a date range/);
  });

  test("by default the empty levels are listed too", async () => {
    const db = fake(request({ posLocation: [ALQUOZ] }));
    const outcome = await generateReport({ db, jobId: "job1", deps: { keepWorkFiles: true } });
    assert.equal(outcome.rows, 4);
  });

  test("all locations: a Location Name column leads, the header says All locations", async () => {
    const db = fake(JSON.stringify({ reportKey: "stockByLocation", filters: {}, filterSummary: [], cutoff: "2026-11-05T10:00:00.000Z" }));
    const outcome = await generateReport({ db, jobId: "job1", deps: { keepWorkFiles: true } });
    assert.equal(outcome.action, "ready", db.row.error);
    assert.equal(outcome.rows, 7);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fromLocalUrl(db.row.resultFileUrl));
    const sheet = workbook.getWorksheet("Stock Report by Location");
    assert.deepEqual(sheet.getRow(1).values.slice(1, 3), ["Location", "All locations"]);
    assert.deepEqual(sheet.getRow(3).values.slice(1, 3), ["Location Name", "Collection Name"]);
    assert.equal(sheet.getRow(4).getCell(1).value, "Al Ain");
    assert.equal(sheet.conditionalFormattings[0].ref, "A4:H10");
    assert.deepEqual(sheet.conditionalFormattings[0].rules[0].formulae, ["$G4<=5"]);

    // Stock at deactivated item-locations is listed and called out on the Summary and Request sheets.
    const labels = [];
    workbook.getWorksheet("Summary").eachRow((row) => labels.push([row.getCell(1).value, row.getCell(2).value]));
    assert.deepEqual(labels.find(([label]) => /deactivated/.test(label)), ["Rows where the item is deactivated at the location", 1]);
    assert.deepEqual(labels.find(([label]) => /in those rows/.test(label)), ["Stock on hand in those rows", 40]);
    const notes = [];
    workbook.getWorksheet("Request").eachRow((row) => notes.push(String(row.getCell(2).value)));
    assert.ok(notes.some((text) => /deactivated at that location/.test(text) && /40 units/.test(text)));
  });

  test("a missing inventory file fails the job clearly", async () => {
    const db = fake(request({ posLocation: [ALQUOZ] }));
    db.row.inventoryFile = null;
    const outcome = await generateReport({ db, jobId: "job1", deps: { keepWorkFiles: true } });
    assert.equal(outcome.action, "failed");
    assert.match(db.row.error, /data files are missing/);
  });
});
