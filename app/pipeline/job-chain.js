// Moves a ReportJob forward when one of its bulk exports finishes (Dev Plan
// Step 15). Called with the result of handleBulkOperationsFinish().
//
// A job runs three exports, one after another (Shopify allows one at a time):
//   orders  -> download -> ORDERS_READY -> start the events export
//   events  -> download -> EVENTS_READY -> start the products export
//   products-> download -> DATA_READY
// An export that is not completed (failed / canceled / expired) -> FAILED.
//
// Webhooks can arrive twice, and the process can die mid-download. Each move
// is claimed with an atomic compare-and-set on `stage`, so a duplicate does
// nothing; a job that stalls mid-way keeps its last stage and `error`, which
// the Step 16 poller uses to recover it.
import { BULK_ID_COLUMN, DOWNLOADING_STAGE, EXPORT_LABEL, FILE_COLUMN, NEXT_EXPORT, READY_STAGE, RUNNING_STAGE, STAGES } from "./job-stages.js";
import { downloadBulkFile, verifyEventsFile, verifyOrdersFile, verifyProductsFile } from "./bulk-file.js";
import { jobFilePath } from "./storage.js";
import { jobWindow } from "./job-window.js";
import { startAgreementsBulkOperation } from "./ledger-queries.js";
import { startProductsBulkOperation } from "./products-bulk-query.js";

const defaultDeps = {
  download: downloadBulkFile,
  verify: { orders: verifyOrdersFile, events: verifyEventsFile, products: verifyProductsFile },
  // How each export is started: (admin, job) => { id }.
  start: {
    events: (admin, job) => startAgreementsBulkOperation(admin, jobWindow(job)),
    products: (admin) => startProductsBulkOperation(admin),
  },
  filePath: jobFilePath,
};

const describeFailure = (which, operation) =>
  `${EXPORT_LABEL[which]} export ${operation.status}${operation.errorCode ? ` (${operation.errorCode})` : ""}`;

// Atomically moves a job from `from` to `data.stage`. True if this caller won.
async function claim(db, jobId, from, data) {
  const { count } = await db.reportJob.updateMany({ where: { id: jobId, stage: from }, data });
  return count === 1;
}

// Starts the export that follows `which`, and records it on the job. If Shopify
// refuses (for example it is busy) the job stays at its READY stage with the
// error recorded; the Step 16 poller retries from there.
export async function startNextExport({ db, admin, job, which, deps = {} }) {
  const next = NEXT_EXPORT[which];
  const start = { ...defaultDeps.start, ...deps.start }[next];
  try {
    const operation = await start(admin, job);
    await db.reportJob.update({ where: { id: job.id }, data: { stage: RUNNING_STAGE[next], [BULK_ID_COLUMN[next]]: operation.id, error: null } });
    return { started: true, next, operationId: operation.id };
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { error: `${EXPORT_LABEL[next]} export not started: ${error.message}` } });
    return { started: false, next, error: error.message };
  }
}

export async function advanceJob({ db, admin, result, deps = {} }) {
  const download = deps.download ?? defaultDeps.download;
  const verify = { ...defaultDeps.verify, ...deps.verify };
  const filePath = deps.filePath ?? defaultDeps.filePath;
  const { job, which, operation } = result;
  const waitingStage = RUNNING_STAGE[which];

  if (operation.status !== "COMPLETED") {
    const moved = await claim(db, job.id, waitingStage, { stage: STAGES.FAILED, error: describeFailure(which, operation) });
    return { action: moved ? "failed" : "skipped" };
  }

  if (!(await claim(db, job.id, waitingStage, { stage: DOWNLOADING_STAGE[which], error: null }))) {
    return { action: "skipped" }; // duplicate delivery, or already handled
  }

  let stats;
  try {
    const destination = filePath(job.id, which);
    await download(operation.url, destination);
    stats = await verify[which](destination);
    await db.reportJob.update({
      where: { id: job.id },
      data: { stage: READY_STAGE[which] ?? STAGES.DATA_READY, [FILE_COLUMN[which]]: destination },
    });
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: error.message } });
    return { action: "failed", error: error.message };
  }

  if (!NEXT_EXPORT[which]) return { action: "data-ready", stats };

  // The file is safely on disk; start the next export.
  const { started, next, operationId, error } = await startNextExport({ db, admin, job, which, deps });
  return started ? { action: `${next}-started`, stats, operationId } : { action: `${next}-start-failed`, stats, error };
}
