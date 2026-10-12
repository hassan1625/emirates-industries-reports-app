// Fallback for dropped or late webhooks and for a process that died mid-way
// (Dev Plan Step 16). Shopify does not guarantee webhook delivery, so every
// unfinished job is re-checked here and pushed through the same chain
// (advanceJob) the webhook uses. All state moves are atomic claims on `stage`
// (plus `updatedAt` where a stage has no other guard), so a recovery pass can
// never double-run a step that a webhook, or another pass, already took.
import { BULK_ID_COLUMN, DOWNLOADING_STAGE, EXPORT_LABEL, NEXT_EXPORT, RUNNING_STAGE, STAGES, exportOfStage } from "./job-stages.js";
import { fetchBulkOperation } from "./bulk-finish.js";
import { startNextExport } from "./job-chain.js";
import { advanceAndGenerate } from "./job-runner.js";
import { GENERATED_REPORT_TYPES, generateReport } from "./report-generation.js";

const MINUTE = 60 * 1000;

export const RECOVERY_CONFIG = Object.freeze({
  // A running export normally reports via webhook within seconds of finishing;
  // only poll jobs that have been quiet at least this long.
  runningPollAfterMs: 90 * 1000,
  // Give up on an export still running after this long.
  maxRunningMs: 3 * 60 * MINUTE,
  // A download that has not progressed in this long is assumed dead.
  downloadStaleAfterMs: 15 * MINUTE,
  // Retry a refused/never-started next export (events or products) after this long...
  nextExportRetryAfterMs: 1 * MINUTE,
  // ...and stop trying once the job is this old.
  nextExportRetryUntilMs: 30 * MINUTE,
  // Created but its orders export never started.
  pendingStaleAfterMs: 10 * MINUTE,
  // Data is in but the report file was not started (a crash between the two).
  generateAfterMs: 1 * MINUTE,
  // The file has been "being written" this long: assume the writer died.
  generatingStaleAfterMs: 20 * MINUTE,
});

const UNFINISHED = [
  STAGES.PENDING,
  STAGES.ORDERS_RUNNING,
  STAGES.ORDERS_DOWNLOADING,
  STAGES.ORDERS_READY,
  STAGES.EVENTS_RUNNING,
  STAGES.EVENTS_DOWNLOADING,
  STAGES.EVENTS_READY,
  STAGES.PRODUCTS_RUNNING,
  STAGES.PRODUCTS_DOWNLOADING,
  STAGES.DATA_READY,
  STAGES.GENERATING,
];

// Moves `job` from its current stage, only if nobody has touched it since we
// read it. True when this caller won.
async function claim(db, job, data) {
  const { count } = await db.reportJob.updateMany({ where: { id: job.id, stage: job.stage, updatedAt: job.updatedAt }, data });
  return count === 1;
}

const fail = async (db, job, error) => ((await claim(db, job, { stage: STAGES.FAILED, error })) ? "failed" : "skipped");

// `getAdmin(shop)` returns an authenticated admin client for a shop.
// Returns [{ jobId, stage, action }] for every job it looked at.
export async function recoverStuckJobs({ db, getAdmin, now = new Date(), config = {}, deps = {} }) {
  const cfg = { ...RECOVERY_CONFIG, ...config };
  const lookup = deps.fetchBulkOperation ?? fetchBulkOperation;
  const advance = deps.advanceJob ?? advanceAndGenerate;
  const generate = deps.generateReport ?? generateReport;

  const jobs = await db.reportJob.findMany({ where: { stage: { in: UNFINISHED } } });
  const outcomes = [];

  for (const original of jobs) {
    let job = original;
    const age = now - new Date(job.updatedAt);
    const sinceCreated = now - new Date(job.createdAt);
    const record = (action) => outcomes.push({ jobId: job.id, stage: original.stage, action });

    try {
      if (job.stage === STAGES.PENDING) {
        record(age >= cfg.pendingStaleAfterMs ? await fail(db, job, "Orders export was never started") : "waiting");
        continue;
      }

      // Data is in; build the report file if nothing has (or the writer died).
      if (job.stage === STAGES.DATA_READY || job.stage === STAGES.GENERATING) {
        if (!GENERATED_REPORT_TYPES.includes(job.reportType)) {
          record("waiting"); // a job kind with no file to build (e.g. debug jobs)
          continue;
        }
        if (job.stage === STAGES.GENERATING) {
          if (age < cfg.generatingStaleAfterMs) {
            record("waiting");
            continue;
          }
          if (!(await claim(db, job, { stage: STAGES.DATA_READY, error: null }))) {
            record("skipped");
            continue;
          }
        } else if (age < cfg.generateAfterMs) {
          record("waiting");
          continue;
        }
        const generated = await generate({ db, admin: await getAdmin(job.shop), jobId: job.id });
        record(`generated:${generated.action}`);
        continue;
      }

      // An export's file is on disk but the next export never started (Shopify
      // was busy, or the process died in between): start it.
      if (job.stage === STAGES.ORDERS_READY || job.stage === STAGES.EVENTS_READY) {
        const which = exportOfStage(job.stage);
        if (age < cfg.nextExportRetryAfterMs) {
          record("waiting");
          continue;
        }
        if (sinceCreated > cfg.nextExportRetryUntilMs) {
          record(await fail(db, job, `The ${EXPORT_LABEL[NEXT_EXPORT[which]]} export could not be started: ${job.error ?? "unknown error"}`));
          continue;
        }
        // Take the retry by bumping updatedAt, so a second pass backs off.
        if (!(await claim(db, job, { error: `Retrying the ${EXPORT_LABEL[NEXT_EXPORT[which]]} export` }))) {
          record("skipped");
          continue;
        }
        const admin = await getAdmin(job.shop);
        const outcome = await startNextExport({ db, admin, job, which, deps: { start: deps.start } });
        record(outcome.started ? `${outcome.next}-started` : `${outcome.next}-start-failed`);
        continue;
      }

      // A download that stopped making progress: send the job back to its
      // "running" stage and handle it below like any other waiting job.
      const current = exportOfStage(job.stage);
      if (job.stage === DOWNLOADING_STAGE[current]) {
        if (age < cfg.downloadStaleAfterMs) {
          record("waiting");
          continue;
        }
        const running = RUNNING_STAGE[current];
        if (!(await claim(db, job, { stage: running, error: null }))) {
          record("skipped");
          continue;
        }
        job = { ...job, stage: running, error: null, updatedAt: new Date(now) };
        // Fresh read so later claims use the real updatedAt.
        job = (await db.reportJob.findUnique({ where: { id: job.id } })) ?? job;
      } else if (age < cfg.runningPollAfterMs) {
        record("waiting");
        continue;
      }

      // Waiting on a Shopify export: ask Shopify what happened to it.
      const which = current;
      const operationId = job[BULK_ID_COLUMN[which]];
      if (!operationId) {
        record(await fail(db, job, `No ${EXPORT_LABEL[which]} export id recorded`));
        continue;
      }

      const admin = await getAdmin(job.shop);
      const operation = await lookup(admin, operationId);
      if (!operation) {
        record(await fail(db, job, `Shopify does not know the ${EXPORT_LABEL[which]} export ${operationId}`));
        continue;
      }
      if (operation.status === "CREATED" || operation.status === "RUNNING") {
        record(sinceCreated > cfg.maxRunningMs ? await fail(db, job, `${EXPORT_LABEL[which]} export still running after ${Math.round(sinceCreated / MINUTE)} minutes`) : "still-running");
        continue;
      }

      const outcome = await advance({ db, admin, result: { job, which, operation } });
      record(`recovered:${outcome.action}`);
    } catch (error) {
      // One bad job (for example an uninstalled shop) must not stop the rest.
      outcomes.push({ jobId: job.id, stage: original.stage, action: "error", error: error.message });
    }
  }
  return outcomes;
}
