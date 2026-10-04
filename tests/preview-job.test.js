import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewJob } from "../app/pipeline/report-preview.js";
import { STAGE_INFO, STAGES, isTerminalStage } from "../app/pipeline/job-stages.js";

const money = (a) => ({ shopMoney: { amount: String(a), currencyCode: "AED" } });
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const HEAD = "gid://shopify/Location/HEAD";
const ALAIN = "gid://shopify/Location/ALAIN";

// Three orders: POS at Al Ain (Boys), Online mapped to Head office (Girls, shipping charged), Draft (no location, Boys).
const ORDERS = [
  { id: "O1", name: "#1", createdAt: "2026-09-02T08:00:00Z", sourceName: "pos", retailLocation: { id: ALAIN, name: "Al Ain" }, paymentGatewayNames: ["cash"], taxesIncluded: true, currentShippingPriceSet: money(0) },
  { id: "gid://shopify/LineItem/1", title: "Trouser", sku: "T1", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money(52.5), taxLines: [{ rate: 0.05, priceSet: money(2.5) }], product: { id: "P1" }, variant: { id: "V1" }, discountAllocations: [], __parentId: "O1" },
  { id: "O2", name: "#2", createdAt: "2026-09-03T08:00:00Z", sourceName: "web", retailLocation: null, paymentGatewayNames: ["card"], taxesIncluded: true, currentShippingPriceSet: money(22) },
  { id: "gid://shopify/LineItem/2", title: "Skirt", sku: "S1", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money(105), taxLines: [{ rate: 0.05, priceSet: money(5) }], product: { id: "P2" }, variant: { id: "V2" }, discountAllocations: [], __parentId: "O2" },
  { id: "O3", name: "#3", createdAt: "2026-09-04T08:00:00Z", sourceName: "shopify_draft_order", retailLocation: null, paymentGatewayNames: [], taxesIncluded: true, currentShippingPriceSet: money(0) },
  { id: "gid://shopify/LineItem/3", title: "Trouser", sku: "T1", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money(52.5), taxLines: [{ rate: 0.05, priceSet: money(2.5) }], product: { id: "P1" }, variant: { id: "V1" }, discountAllocations: [], __parentId: "O3" },
];
const PRODUCTS = [
  { id: "P1", title: "Trouser", status: "ACTIVE", tags: [] },
  { id: "gid://shopify/Collection/1", title: "Boys", __parentId: "P1" },
  { id: "P2", title: "Skirt", status: "ACTIVE", tags: [] },
  { id: "gid://shopify/Collection/2", title: "Girls", __parentId: "P2" },
];
const db = { locationMapping: { findMany: async () => [{ sourceName: "web", locationId: HEAD, locationName: "Head office" }] } };

describe("previewJob", () => {
  let dir, job;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "preview-job-"));
    await writeFile(join(dir, "orders.jsonl"), jsonl(ORDERS));
    await writeFile(join(dir, "products.jsonl"), jsonl(PRODUCTS));
    job = { shop: "s", ordersFile: join(dir, "orders.jsonl"), productsFile: join(dir, "products.jsonl") };
  });
  after(async () => rm(dir, { recursive: true, force: true }));

  test("without filters it covers every order and row", async () => {
    const p = await previewJob({ db, job });
    assert.equal(p.totals.orders, 3);
    assert.equal(p.totals.lineRows, 3);
    assert.equal(p.totals.shippingRows, 1);
    assert.equal(p.totals.total, 52.5 + 105 + 22 + 52.5);
  });

  test("a sales channel filter narrows the rows", async () => {
    const p = await previewJob({ db, job, filters: { salesChannel: ["pos"] } });
    assert.equal(p.totals.orders, 1);
    assert.equal(p.totals.total, 52.5);
  });

  test("a location filter matches POS orders by their location and online orders by the mapped one", async () => {
    assert.equal((await previewJob({ db, job, filters: { posLocation: [ALAIN] } })).totals.orders, 1);
    const head = await previewJob({ db, job, filters: { posLocation: [HEAD] } });
    assert.equal(head.totals.orders, 1);
    assert.equal(head.totals.shippingRows, 1); // the online order's shipping row stays with its order
    assert.equal(head.totals.total, 105 + 22);
  });

  test("a collection filter drops shipping rows and lines of other collections", async () => {
    const boys = await previewJob({ db, job, filters: { collection: ["Boys"] } });
    assert.equal(boys.totals.lineRows, 2);
    assert.equal(boys.totals.shippingRows, 0);
    assert.equal(boys.totals.orders, 2);
  });

  test("filters combine", async () => {
    const p = await previewJob({ db, job, filters: { salesChannel: ["pos", "shopify_draft_order"], collection: ["Boys"], posLocation: [ALAIN] } });
    assert.equal(p.totals.orders, 1);
  });

  test("the sample shows only the chosen columns, with their labels", async () => {
    const p = await previewJob({ db, job, fields: ["orderName", "totalSales"], sampleSize: 10 });
    assert.deepEqual(p.columns, [{ key: "orderName", label: "Order Name" }, { key: "totalSales", label: "Total Sales" }]);
    assert.deepEqual(Object.keys(p.sample[0]), ["orderName", "totalSales"]);
    assert.equal(p.totals.total, 232); // totals still cover everything
  });

  test("all columns when no selection is given", async () => {
    const p = await previewJob({ db, job });
    assert.equal(p.columns.length, 21);
  });

  test("a job without files is refused", async () => {
    await assert.rejects(previewJob({ db, job: { shop: "s" } }), /DATA_READY/);
  });
});

describe("stage info", () => {
  test("every stage has a label, a detail and a progress value", () => {
    for (const stage of Object.values(STAGES)) {
      const info = STAGE_INFO[stage];
      assert.ok(info.label && info.detail, stage);
      assert.ok(info.progress >= 0 && info.progress <= 100, stage);
    }
  });

  test("progress rises through the pipeline", () => {
    const order = [STAGES.PENDING, STAGES.ORDERS_RUNNING, STAGES.ORDERS_DOWNLOADING, STAGES.ORDERS_READY, STAGES.PRODUCTS_RUNNING, STAGES.PRODUCTS_DOWNLOADING, STAGES.DATA_READY];
    const values = order.map((s) => STAGE_INFO[s].progress);
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
  });

  test("only DATA_READY and FAILED are terminal; unknown stages stop polling", () => {
    assert.equal(isTerminalStage(STAGES.DATA_READY), true);
    assert.equal(isTerminalStage(STAGES.FAILED), true);
    assert.equal(isTerminalStage(STAGES.ORDERS_RUNNING), false);
    assert.equal(isTerminalStage("SOMETHING_ELSE"), true);
  });
});
