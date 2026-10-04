import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { advanceJob } from "../app/pipeline/job-chain.js";
import { startReportJob } from "../app/pipeline/start-job.js";
import { STAGES } from "../app/pipeline/job-stages.js";
import { buildProductsBulkQuery } from "../app/pipeline/products-bulk-query.js";

// In-memory Prisma stand-in implementing just what the chain uses.
function fakeDb(initial) {
  const jobs = new Map(initial.map((j) => [j.id, { ...j }]));
  return {
    jobs,
    reportJob: {
      create: async ({ data }) => {
        const job = { id: `job${jobs.size + 1}`, error: null, ordersBulkOpId: null, productsBulkOpId: null, ...data };
        jobs.set(job.id, job);
        return { ...job };
      },
      update: async ({ where, data }) => {
        Object.assign(jobs.get(where.id), data);
        return { ...jobs.get(where.id) };
      },
      updateMany: async ({ where, data }) => {
        const job = jobs.get(where.id);
        if (!job || (where.stage !== undefined && job.stage !== where.stage)) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      },
    },
  };
}

const baseJob = (overrides = {}) => ({ id: "job1", shop: "demo.myshopify.com", stage: STAGES.ORDERS_RUNNING, ordersBulkOpId: "op-orders", productsBulkOpId: null, error: null, ...overrides });
const finished = (job, which, operation) => ({ job, which, operation: { id: `op-${which}`, status: "COMPLETED", errorCode: null, url: "https://example.test/f", ...operation } });

function makeDeps(overrides = {}) {
  const calls = { download: [], startProducts: 0, verify: [] };
  return {
    calls,
    deps: {
      download: async (url, dest) => { calls.download.push({ url, dest }); },
      verify: {
        orders: async (file) => { calls.verify.push(file); return { orders: 3 }; },
        products: async (file) => { calls.verify.push(file); return { products: 2 }; },
      },
      startProducts: async () => { calls.startProducts += 1; return { id: "op-products", status: "CREATED" }; },
      filePath: (id, which) => `/data/${id}/${which}.jsonl`,
      ...overrides,
    },
  };
}

describe("advanceJob", () => {
  test("orders export completed: downloads, then starts the products export", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps();
    const outcome = await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders"), deps });

    assert.equal(outcome.action, "products-started");
    const job = db.jobs.get("job1");
    assert.equal(job.stage, STAGES.PRODUCTS_RUNNING);
    assert.equal(job.ordersFile, "/data/job1/orders.jsonl");
    assert.equal(job.productsBulkOpId, "op-products");
    assert.deepEqual(calls.download, [{ url: "https://example.test/f", dest: "/data/job1/orders.jsonl" }]);
    assert.equal(calls.startProducts, 1);
  });

  test("products export completed: job is DATA_READY", async () => {
    const db = fakeDb([baseJob({ stage: STAGES.PRODUCTS_RUNNING, productsBulkOpId: "op-products" })]);
    const { deps, calls } = makeDeps();
    const outcome = await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "products"), deps });

    assert.equal(outcome.action, "data-ready");
    assert.equal(db.jobs.get("job1").stage, STAGES.DATA_READY);
    assert.equal(db.jobs.get("job1").productsFile, "/data/job1/products.jsonl");
    assert.equal(calls.startProducts, 0);
  });

  test("a duplicate webhook does nothing the second time", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps();
    const result = finished(db.jobs.get("job1"), "orders");
    const first = await advanceJob({ db, admin: {}, result, deps });
    const second = await advanceJob({ db, admin: {}, result, deps });

    assert.equal(first.action, "products-started");
    assert.equal(second.action, "skipped");
    assert.equal(calls.download.length, 1);
    assert.equal(calls.startProducts, 1);
  });

  test("two deliveries racing: only one wins the claim", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps();
    const result = finished(db.jobs.get("job1"), "orders");
    const outcomes = await Promise.all([advanceJob({ db, admin: {}, result, deps }), advanceJob({ db, admin: {}, result, deps })]);

    assert.deepEqual(outcomes.map((o) => o.action).sort(), ["products-started", "skipped"]);
    assert.equal(calls.startProducts, 1);
  });

  test("failed export marks the job FAILED with Shopify's error code", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps();
    const outcome = await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders", { status: "FAILED", errorCode: "TIMEOUT", url: null }), deps });

    assert.equal(outcome.action, "failed");
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
    assert.match(db.jobs.get("job1").error, /orders export FAILED \(TIMEOUT\)/);
    assert.equal(calls.download.length, 0);
  });

  test("a stale failure webhook cannot undo a job that already moved on", async () => {
    const db = fakeDb([baseJob({ stage: STAGES.PRODUCTS_RUNNING })]);
    const { deps } = makeDeps();
    const outcome = await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders", { status: "FAILED" }), deps });
    assert.equal(outcome.action, "skipped");
    assert.equal(db.jobs.get("job1").stage, STAGES.PRODUCTS_RUNNING);
  });

  test("download failure marks the job FAILED with the reason", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps({ download: async () => { throw new Error("HTTP 403"); } });
    const outcome = await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders"), deps });

    assert.equal(outcome.action, "failed");
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
    assert.equal(db.jobs.get("job1").error, "HTTP 403");
    assert.equal(calls.startProducts, 0);
  });

  test("a corrupt file fails the job instead of moving on", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps({ verify: { orders: async () => { throw new Error("Orphan bulk line"); }, products: async () => ({}) } });
    await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders"), deps });
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
    assert.equal(calls.startProducts, 0);
  });

  test("products export refused: orders stay safe on disk, job waits at ORDERS_READY with the error", async () => {
    const db = fakeDb([baseJob()]);
    const { deps } = makeDeps({ startProducts: async () => { throw new Error("OPERATION_IN_PROGRESS"); } });
    const outcome = await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders"), deps });

    assert.equal(outcome.action, "products-start-failed");
    const job = db.jobs.get("job1");
    assert.equal(job.stage, STAGES.ORDERS_READY);
    assert.equal(job.ordersFile, "/data/job1/orders.jsonl");
    assert.match(job.error, /OPERATION_IN_PROGRESS/);
  });

  test("an export with no results (no URL) still advances", async () => {
    const db = fakeDb([baseJob()]);
    const { deps, calls } = makeDeps();
    await advanceJob({ db, admin: {}, result: finished(db.jobs.get("job1"), "orders", { url: null }), deps });
    assert.equal(calls.download[0].url, null);
    assert.equal(db.jobs.get("job1").stage, STAGES.PRODUCTS_RUNNING);
  });
});

describe("startReportJob", () => {
  const range = { start: "2026-08-01T00:00:00Z", end: "2026-08-31T23:59:59Z" };

  test("creates the job and records the running orders export", async () => {
    const db = fakeDb([]);
    const job = await startReportJob({ db, admin: {}, shop: "demo.myshopify.com", reportType: "generalSales", range, params: { channels: ["pos"] }, startOrders: async () => ({ id: "op-orders" }) });

    assert.equal(job.stage, STAGES.ORDERS_RUNNING);
    assert.equal(job.ordersBulkOpId, "op-orders");
    const params = JSON.parse(job.params);
    assert.deepEqual(params.channels, ["pos"]);
    assert.equal(params.range.start, "2026-08-01T00:00:00.000Z");
  });

  test("when Shopify refuses to start, the job is FAILED with the reason and the error is rethrown", async () => {
    const db = fakeDb([]);
    await assert.rejects(
      startReportJob({ db, admin: {}, shop: "s", reportType: "generalSales", range, startOrders: async () => { throw new Error("busy"); } }),
      /busy/,
    );
    const [job] = [...db.jobs.values()];
    assert.equal(job.stage, STAGES.FAILED);
    assert.equal(job.error, "busy");
  });
});

test("products query uses 3 connections and no search filter", () => {
  const query = buildProductsBulkQuery();
  assert.equal(query.match(/edges\s*\{/g).length, 3);
  assert.ok(!query.includes("query:"));
});
