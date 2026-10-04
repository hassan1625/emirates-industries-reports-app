// Creates a ReportJob and starts its orders export (the first step of the
// chain; Step 15's job-chain.js continues from the finish webhook).
import { startOrdersBulkOperation } from "./orders-bulk-query.js";
import { STAGES } from "./job-stages.js";

// `range` is { start, end }; `params` is anything else the request carries
// (filters, selected fields), stored as JSON for the later steps.
export async function startReportJob({ db, admin, shop, reportType, range, params = {}, startOrders = startOrdersBulkOperation }) {
  const job = await db.reportJob.create({
    data: {
      shop,
      reportType,
      stage: STAGES.PENDING,
      params: JSON.stringify({ ...params, range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() } }),
    },
  });

  try {
    const operation = await startOrders(admin, range);
    return await db.reportJob.update({
      where: { id: job.id },
      data: { stage: STAGES.ORDERS_RUNNING, ordersBulkOpId: operation.id },
    });
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: error.message } });
    throw error;
  }
}
