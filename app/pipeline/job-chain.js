// Moves a ReportJob forward when one of its bulk exports finishes (Dev Plan
// Step 15). Called with the result of handleBulkOperationsFinish().
//
//   orders export COMPLETED   -> download file -> ORDERS_READY -> start the
//                                products export -> PRODUCTS_RUNNING
//   products export COMPLETED -> download file -> DATA_READY
//   either export not completed (failed / canceled / expired) -> FAILED
//
// Webhooks can arrive twice, and the process can die mid-download. Each move
// is claimed with an atomic compare-and-set on `stage`, so a duplicate does
// nothing; a job that stalls mid-way keeps its last stage and `error`, which
// the Step 16 poller uses to recover it.
import { DOWNLOADING_STAGE, RUNNING_STAGE, STAGES } from "./job-stages.js";
import { downloadBulkFile, verifyOrdersFile, verifyProductsFile } from "./bulk-file.js";
import { jobFilePath } from "./storage.js";
import { startProductsBulkOperation } from "./products-bulk-query.js";

const defaultDeps = {
  download: downloadBulkFile,
  verify: { orders: verifyOrdersFile, products: verifyProductsFile },
  startProducts: startProductsBulkOperation,
  filePath: jobFilePath,
};

const describeFailure = (which, operation) =>
  `${which} export ${operation.status}${operation.errorCode ? ` (${operation.errorCode})` : ""}`;

// Atomically moves a job from `from` to `data.stage`. True if this caller won.
async function claim(db, jobId, from, data) {
  const { count } = await db.reportJob.updateMany({ where: { id: jobId, stage: from }, data });
  return count === 1;
}

export async function advanceJob({ db, admin, result, deps = {} }) {
  const { download, verify, startProducts, filePath } = { ...defaultDeps, ...deps };
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
      data: which === "orders"
        ? { stage: STAGES.ORDERS_READY, ordersFile: destination }
        : { stage: STAGES.DATA_READY, productsFile: destination },
    });
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: error.message } });
    return { action: "failed", error: error.message };
  }

  if (which === "products") return { action: "data-ready", stats };

  // Orders are safely on disk. If starting the products export fails (for
  // example Shopify is busy) the job stays ORDERS_READY with the error
  // recorded; the Step 16 poller retries from there.
  try {
    const productsOperation = await startProducts(admin);
    await db.reportJob.update({
      where: { id: job.id },
      data: { stage: STAGES.PRODUCTS_RUNNING, productsBulkOpId: productsOperation.id, error: null },
    });
    return { action: "products-started", stats, productsBulkOpId: productsOperation.id };
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { error: `Products export not started: ${error.message}` } });
    return { action: "products-start-failed", stats, error: error.message };
  }
}
