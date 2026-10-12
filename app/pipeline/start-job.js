// Creates a ReportJob and starts its orders export (the first step of the
// chain; job-chain.js continues from the finish webhook: orders, then the dated
// events, then products).
import { startOrdersUpdatedSinceOperation } from "./orders-bulk-query.js";
import { STAGES } from "./job-stages.js";

// `range` is { start, end }; `params` is anything else the request carries
// (filters, selected fields), stored as JSON for the later steps.
//
// The orders export covers every order that changed from the range start up to
// the moment the job is created (`cutoff`); the events export uses the same
// window, and the report keeps only the events dated inside the range.
export async function startReportJob({ db, admin, shop, reportType, range, params = {}, startOrders = startOrdersUpdatedSinceOperation, now = () => new Date() }) {
  const cutoff = new Date(now()).toISOString();
  const job = await db.reportJob.create({
    data: {
      shop,
      reportType,
      stage: STAGES.PENDING,
      params: JSON.stringify({ ...params, range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() }, cutoff }),
    },
  });

  try {
    const operation = await startOrders(admin, { start: range.start, cutoff });
    return await db.reportJob.update({
      where: { id: job.id },
      data: { stage: STAGES.ORDERS_RUNNING, ordersBulkOpId: operation.id },
    });
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: error.message } });
    throw error;
  }
}
