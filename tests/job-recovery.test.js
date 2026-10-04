import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recoverStuckJobs, RECOVERY_CONFIG } from "../app/pipeline/job-recovery.js";
import { advanceJob } from "../app/pipeline/job-chain.js";
import { STAGES } from "../app/pipeline/job-stages.js";

const NOW = new Date("2026-10-03T12:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);

// In-memory Prisma stand-in. Like Prisma's @updatedAt, every write bumps
// updatedAt, which the recovery claims rely on.
function fakeDb(initial) {
  let tick = 0;
  const jobs = new Map(initial.map((j) => [j.id, { shop: "demo.myshopify.com", error: null, ordersBulkOpId: null, productsBulkOpId: null, createdAt: minutesAgo(60), ...j }]));
  const bump = (job) => {
    job.updatedAt = new Date(NOW.getTime() + ++tick);
  };
  return {
    jobs,
    reportJob: {
      findMany: async ({ where }) => [...jobs.values()].filter((j) => where.stage.in.includes(j.stage)).map((j) => ({ ...j })),
      findUnique: async ({ where }) => (jobs.has(where.id) ? { ...jobs.get(where.id) } : null),
      update: async ({ where, data }) => {
        const job = jobs.get(where.id);
        Object.assign(job, data);
        bump(job);
        return { ...job };
      },
      updateMany: async ({ where, data }) => {
        const job = jobs.get(where.id);
        if (!job) return { count: 0 };
        if (where.stage !== undefined && job.stage !== where.stage) return { count: 0 };
        if (where.updatedAt !== undefined && new Date(job.updatedAt).getTime() !== new Date(where.updatedAt).getTime()) return { count: 0 };
        Object.assign(job, data);
        bump(job);
        return { count: 1 };
      },
    },
  };
}

const job = (overrides) => ({ id: "job1", stage: STAGES.ORDERS_RUNNING, ordersBulkOpId: "op-orders", updatedAt: minutesAgo(5), ...overrides });
const operation = (overrides) => ({ id: "op", status: "COMPLETED", errorCode: null, url: "https://example.test/f", ...overrides });

function harness(db, { op = operation(), advanceCalls = [], products } = {}) {
  const calls = { lookup: [], startProducts: 0, getAdmin: [] };
  return {
    calls,
    run: (extra = {}) =>
      recoverStuckJobs({
        db,
        now: NOW,
        getAdmin: async (shop) => {
          calls.getAdmin.push(shop);
          return { shop };
        },
        deps: {
          fetchBulkOperation: async (_admin, id) => {
            calls.lookup.push(id);
            return typeof op === "function" ? op(id) : op;
          },
          advanceJob: async (args) => {
            advanceCalls.push(args);
            return { action: "advanced" };
          },
          startProducts: products ?? (async () => {
            calls.startProducts += 1;
            return { id: "op-products" };
          }),
        },
        ...extra,
      }),
  };
}

describe("running exports whose webhook never arrived", () => {
  test("a finished export is pushed through the same chain the webhook uses", async () => {
    const db = fakeDb([job()]);
    const advanceCalls = [];
    const h = harness(db, { advanceCalls });
    const [outcome] = await h.run();

    assert.equal(outcome.action, "recovered:advanced");
    assert.deepEqual(h.calls.lookup, ["op-orders"]);
    assert.equal(advanceCalls.length, 1);
    assert.equal(advanceCalls[0].result.which, "orders");
    assert.equal(advanceCalls[0].result.operation.status, "COMPLETED");
  });

  test("a products export is looked up by its own id", async () => {
    const db = fakeDb([job({ stage: STAGES.PRODUCTS_RUNNING, productsBulkOpId: "op-products" })]);
    const advanceCalls = [];
    const h = harness(db, { advanceCalls });
    await h.run();
    assert.deepEqual(h.calls.lookup, ["op-products"]);
    assert.equal(advanceCalls[0].result.which, "products");
  });

  test("a failed or canceled export is passed on so the chain can mark the job FAILED", async () => {
    const db = fakeDb([job()]);
    const advanceCalls = [];
    const h = harness(db, { op: operation({ status: "FAILED", errorCode: "TIMEOUT", url: null }), advanceCalls });
    await h.run();
    assert.equal(advanceCalls[0].result.operation.status, "FAILED");
  });

  test("an export still running is left alone", async () => {
    const db = fakeDb([job()]);
    const advanceCalls = [];
    const h = harness(db, { op: operation({ status: "RUNNING", url: null }), advanceCalls });
    const [outcome] = await h.run();
    assert.equal(outcome.action, "still-running");
    assert.equal(advanceCalls.length, 0);
    assert.equal(db.jobs.get("job1").stage, STAGES.ORDERS_RUNNING);
  });

  test("a job updated moments ago is not polled (the webhook usually wins)", async () => {
    const db = fakeDb([job({ updatedAt: minutesAgo(0.5) })]);
    const h = harness(db);
    const [outcome] = await h.run();
    assert.equal(outcome.action, "waiting");
    assert.equal(h.calls.lookup.length, 0);
  });

  test("an export running past the maximum is failed with a clear reason", async () => {
    const db = fakeDb([job({ createdAt: minutesAgo(4 * 60) })]);
    const h = harness(db, { op: operation({ status: "RUNNING", url: null }) });
    const [outcome] = await h.run();
    assert.equal(outcome.action, "failed");
    assert.match(db.jobs.get("job1").error, /still running after 240 minutes/);
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
  });

  test("Shopify no longer knowing the export fails the job", async () => {
    const db = fakeDb([job()]);
    const h = harness(db, { op: null });
    await h.run();
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
    assert.match(db.jobs.get("job1").error, /does not know/);
  });

  test("a job with no recorded export id fails instead of looping", async () => {
    const db = fakeDb([job({ ordersBulkOpId: null })]);
    await harness(db).run();
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
  });
});

describe("downloads that stopped part-way (process died)", () => {
  test("a stale download goes back to running and is re-checked", async () => {
    const db = fakeDb([job({ stage: STAGES.ORDERS_DOWNLOADING, updatedAt: minutesAgo(30) })]);
    const advanceCalls = [];
    const h = harness(db, { advanceCalls });
    const [outcome] = await h.run();

    assert.equal(outcome.action, "recovered:advanced");
    assert.equal(advanceCalls[0].result.job.stage, STAGES.ORDERS_RUNNING); // chain can claim it again
    assert.equal(db.jobs.get("job1").stage, STAGES.ORDERS_RUNNING);
  });

  test("a download in progress is left alone", async () => {
    const db = fakeDb([job({ stage: STAGES.ORDERS_DOWNLOADING, updatedAt: minutesAgo(2) })]);
    const h = harness(db);
    const [outcome] = await h.run();
    assert.equal(outcome.action, "waiting");
    assert.equal(db.jobs.get("job1").stage, STAGES.ORDERS_DOWNLOADING);
  });
});

describe("products export that was refused or never started", () => {
  const readyJob = (overrides) => job({ stage: STAGES.ORDERS_READY, createdAt: minutesAgo(10), updatedAt: minutesAgo(5), error: "Products export not started: OPERATION_IN_PROGRESS", ...overrides });

  test("is retried and recorded as running", async () => {
    const db = fakeDb([readyJob()]);
    const h = harness(db);
    const [outcome] = await h.run();
    assert.equal(outcome.action, "products-started");
    assert.equal(db.jobs.get("job1").stage, STAGES.PRODUCTS_RUNNING);
    assert.equal(db.jobs.get("job1").productsBulkOpId, "op-products");
    assert.equal(db.jobs.get("job1").error, null);
  });

  test("a retry that fails again keeps the job at ORDERS_READY with the new error", async () => {
    const db = fakeDb([readyJob()]);
    const h = harness(db, { products: async () => { throw new Error("still busy"); } });
    const [outcome] = await h.run();
    assert.equal(outcome.action, "products-start-failed");
    assert.equal(db.jobs.get("job1").stage, STAGES.ORDERS_READY);
    assert.match(db.jobs.get("job1").error, /still busy/);
  });

  test("a second pass right after backs off instead of retrying again", async () => {
    const db = fakeDb([readyJob()]);
    const h = harness(db, { products: async () => { throw new Error("busy"); } });
    await h.run();
    const [second] = await h.run({ now: new Date(NOW.getTime() + 1000) });
    assert.equal(second.action, "waiting");
  });

  test("gives up after 30 minutes", async () => {
    const db = fakeDb([readyJob({ createdAt: minutesAgo(45) })]);
    const h = harness(db);
    const [outcome] = await h.run();
    assert.equal(outcome.action, "failed");
    assert.match(db.jobs.get("job1").error, /Products export could not be started/);
    assert.equal(h.calls.startProducts, 0);
  });

  test("a job that only just reached ORDERS_READY is not touched", async () => {
    const db = fakeDb([readyJob({ updatedAt: minutesAgo(0.1) })]);
    const h = harness(db);
    assert.equal((await h.run())[0].action, "waiting");
  });
});

describe("other cases", () => {
  test("a job whose orders export never started is failed after 10 minutes", async () => {
    const db = fakeDb([{ id: "job1", stage: STAGES.PENDING, updatedAt: minutesAgo(20) }]);
    await harness(db).run();
    assert.equal(db.jobs.get("job1").stage, STAGES.FAILED);
    assert.match(db.jobs.get("job1").error, /never started/);
  });

  test("a recent PENDING job is left alone", async () => {
    const db = fakeDb([{ id: "job1", stage: STAGES.PENDING, updatedAt: minutesAgo(1) }]);
    assert.equal((await harness(db).run())[0].action, "waiting");
  });

  test("finished jobs are never looked at", async () => {
    const db = fakeDb([job({ stage: STAGES.DATA_READY }), job({ id: "job2", stage: STAGES.FAILED })]);
    assert.deepEqual(await harness(db).run(), []);
  });

  test("one failing job (e.g. uninstalled shop) does not stop the others", async () => {
    const db = fakeDb([job({ id: "bad", shop: "gone.myshopify.com" }), job({ id: "good" })]);
    const advanceCalls = [];
    const outcomes = await recoverStuckJobs({
      db,
      now: NOW,
      getAdmin: async (shop) => {
        if (shop === "gone.myshopify.com") throw new Error("No session");
        return {};
      },
      deps: { fetchBulkOperation: async () => operation(), advanceJob: async (args) => { advanceCalls.push(args); return { action: "advanced" }; } },
    });
    assert.equal(outcomes.find((o) => o.jobId === "bad").action, "error");
    assert.equal(outcomes.find((o) => o.jobId === "good").action, "recovered:advanced");
    assert.equal(advanceCalls.length, 1);
  });

  test("a job claimed by someone else between read and write is skipped", async () => {
    const db = fakeDb([{ id: "job1", stage: STAGES.PENDING, updatedAt: minutesAgo(20) }]);
    // The webhook path moves the job right after the pass read it.
    const realFindMany = db.reportJob.findMany;
    db.reportJob.findMany = async (args) => {
      const found = await realFindMany(args);
      await db.reportJob.update({ where: { id: "job1" }, data: { stage: STAGES.ORDERS_RUNNING } });
      return found;
    };
    const [outcome] = await harness(db).run();
    assert.equal(outcome.action, "skipped");
    assert.equal(db.jobs.get("job1").stage, STAGES.ORDERS_RUNNING);
  });

  test("defaults match the documented timings", () => {
    assert.equal(RECOVERY_CONFIG.runningPollAfterMs, 90_000);
    assert.equal(RECOVERY_CONFIG.maxRunningMs, 3 * 60 * 60 * 1000);
    assert.equal(RECOVERY_CONFIG.productsRetryUntilMs, 30 * 60 * 1000);
  });
});

// The real chain, driven by the recovery pass, end to end with a fake Shopify.
describe("recovery drives the real chain", () => {
  test("a completed orders export reaches ORDERS_READY then PRODUCTS_RUNNING with no webhook", async () => {
    const db = fakeDb([job()]);
    const calls = { download: [] };
    const chainDeps = {
      download: async (url, dest) => calls.download.push({ url, dest }),
      verify: { orders: async () => ({ orders: 1 }), products: async () => ({ products: 1 }) },
      startProducts: async () => ({ id: "op-products" }),
      filePath: (id, which) => `/data/${id}/${which}.jsonl`,
    };
    const outcomes = await recoverStuckJobs({
      db,
      now: NOW,
      getAdmin: async () => ({}),
      deps: { fetchBulkOperation: async () => operation(), advanceJob: (args) => advanceJob({ ...args, deps: chainDeps }) },
    });
    assert.equal(outcomes[0].action, "recovered:products-started");
    assert.equal(db.jobs.get("job1").stage, STAGES.PRODUCTS_RUNNING);
    assert.equal(db.jobs.get("job1").ordersFile, "/data/job1/orders.jsonl");
    assert.equal(calls.download.length, 1);
  });
});
