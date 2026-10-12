// Server side of a report request screen, shared by every report that has one:
// the loader (filter choices, recent reports, default dates) and the action that
// validates a request again on the server and starts its job. Which filters and
// fields exist comes from the report's config, so a new report needs only a route
// file that points here.
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { defaultFieldKeys, hasFieldSelection } from "../config";
import { STORE_TIME_ZONE } from "../config/store";
import { addDays, todayInZone } from "./dates";
import { allowedValues, loadFilterOptions } from "./filter-options";
import { describeFilters, parseReportRequest } from "./report-request";
import { listRecentJobs } from "./recent-jobs";
import { startReportJob } from "./start-job";

export async function reportScreenLoader({ request, reportKey }) {
  const { admin, session } = await authenticate.admin(request);
  const today = todayInZone(STORE_TIME_ZONE);
  return {
    options: await loadFilterOptions(admin, session.shop),
    recent: await listRecentJobs({ db, shop: session.shop, reportType: reportKey }),
    // last 30 days, every field on
    defaults: { today, dateRange: { from: addDays(today, -29), to: today }, ...(hasFieldSelection(reportKey) ? { fields: defaultFieldKeys(reportKey) } : {}) },
  };
}

// Reads the submitted request body back into { dateRange, filters, fields }.
const readRequest = async (request) => {
  const body = await request.json();
  return { dateRange: body.dateRange ?? {}, filters: body.filters ?? {}, fields: body.fields };
};

export async function reportScreenAction({ request, reportKey }) {
  const { admin, session } = await authenticate.admin(request);
  const options = await loadFilterOptions(admin, session.shop);
  const result = parseReportRequest(reportKey, await readRequest(request), { allowedOptions: allowedValues(options) });
  if (!result.ok) return { errors: result.errors, jobId: null };

  const { range, filters, fields } = result.value;
  try {
    const job = await startReportJob({
      db,
      admin,
      shop: session.shop,
      reportType: reportKey,
      range: { start: range.start, end: range.end },
      params: { reportKey, filters, filterSummary: describeFilters(reportKey, filters, options), fields, localRange: { from: range.from, to: range.to, timeZone: range.timeZone } },
    });
    return { errors: {}, jobId: job.id };
  } catch (error) {
    // Shopify refused to start the export (for example it is busy).
    return { errors: { form: `Could not start the report: ${error.message}` }, jobId: null };
  }
}
