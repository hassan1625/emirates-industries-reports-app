// Creates a ReportJob and starts its first export (the first step of the chain;
// job-chain.js continues from the finish webhook). Sales reports start with the
// orders export (then the dated events, then products); the stock report has no
// dates and starts with the products export (then the stock levels).
import { startOrdersUpdatedSinceOperation } from "./orders-bulk-query.js";
import { startProductsBulkOperation } from "./products-bulk-query.js";
import { RUNNING_STAGE, STAGES, BULK_ID_COLUMN, firstExport } from "./job-stages.js";

// `range` is { start, end } (omitted for reports without dates); `params` is
// anything else the request carries (filters, selected fields), stored as JSON
// for the later steps.
//
// The orders export covers every order that changed from the range start up to
// the moment the job is created (`cutoff`); the events export uses the same
// window, and the report keeps only the events dated inside the range.
export async function startReportJob({ db, admin, shop, reportType, range, params = {}, startOrders = startOrdersUpdatedSinceOperation, startProducts = startProductsBulkOperation, now = () => new Date() }) {
  const cutoff = new Date(now()).toISOString();
  const first = firstExport(reportType);
  const stored = range ? { range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() }, cutoff } : { cutoff };
  const job = await db.reportJob.create({
    data: { shop, reportType, stage: STAGES.PENDING, params: JSON.stringify({ ...params, ...stored }) },
  });

  try {
    const operation = first === "orders" ? await startOrders(admin, { start: range.start, cutoff, ...(params.periods ? { periods: [params.periods.previous, params.periods.current].map(({ start, end }) => ({ start, end })) } : {}) }) : await startProducts(admin);
    return await db.reportJob.update({
      where: { id: job.id },
      data: { stage: RUNNING_STAGE[first], [BULK_ID_COLUMN[first]]: operation.id },
    });
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: error.message } });
    throw error;
  }
}
