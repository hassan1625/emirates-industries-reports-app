// Server side of a report request screen, shared by every report that has one:
// the loader (filter choices, recent reports, default dates) and the action that
// validates a request again on the server and starts its job. Which filters and
// fields exist comes from the report's config, so a new report needs only a route
// file that points here.
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { defaultFieldKeys, hasFieldSelection } from "../config";
import { STORE_TIME_ZONE } from "../config/store";
import { addDays, priorYearRange, todayInZone } from "./dates";
import { allowedValues, loadFilterOptions } from "./filter-options";
import { describeFilters, parseReportRequest } from "./report-request";
import { listRecentJobs } from "./recent-jobs";
import { STOCK_REPORT_TYPES } from "./job-stages";
import { ensureDefaultMappings } from "./location-mapping";
import { startReportJob } from "./start-job";

export async function reportScreenLoader({ request, reportKey }) {
  const { admin, session } = await authenticate.admin(request);
  const today = todayInZone(STORE_TIME_ZONE);
  return {
    options: await loadFilterOptions(admin, session.shop),
    recent: await listRecentJobs({ db, shop: session.shop, reportType: reportKey }),
    // last 30 days, every field on
    defaults: { today, dateRange: { from: addDays(today, -29), to: today }, comparison: priorYearRange({ from: addDays(today, -29), to: today }), ...(hasFieldSelection(reportKey) ? { fields: defaultFieldKeys(reportKey) } : {}) },
  };
}

// Reads the submitted request body back into { dateRange, filters, fields }.
const readRequest = async (request) => {
  const body = await request.json();
  return { dateRange: body.dateRange ?? {}, comparison: body.comparison, filters: body.filters ?? {}, fields: body.fields };
};

// A period as the job stores it: its dates and the first and last instants of it.
const storedPeriod = ({ from, to, start, end }) => ({ from, to, start: new Date(start).toISOString(), end: new Date(end).toISOString() });

export async function reportScreenAction({ request, reportKey }) {
  const { admin, session } = await authenticate.admin(request);
  const options = await loadFilterOptions(admin, session.shop);
  const result = parseReportRequest(reportKey, await readRequest(request), { allowedOptions: allowedValues(options) });
  if (!result.ok) return { errors: result.errors, jobId: null };

  const { range, compareRange, window, filters, fields } = result.value;

  // Online Store and Mobile App orders are reported under the Head office location. Those
  // channel -> location rows are created here the first time a sales report runs (existing
  // rows are never touched), so no separate setup step is needed on a new server.
  if (!STOCK_REPORT_TYPES.includes(reportKey)) {
    try {
      await ensureDefaultMappings({ db, admin, shop: session.shop });
    } catch (error) {
      return { errors: { form: `Could not set up the default locations: ${error.message}` }, jobId: null };
    }
  }

  try {
    const job = await startReportJob({
      db,
      admin,
      shop: session.shop,
      reportType: reportKey,
      // A yearly-pair report exports the whole stretch that covers both periods.
      range: window ?? (range ? { start: range.start, end: range.end } : undefined),
      params: {
        reportKey,
        filters,
        filterSummary: describeFilters(reportKey, filters, options),
        fields,
        ...(range ? { localRange: { from: range.from, to: range.to, timeZone: range.timeZone } } : {}),
        ...(compareRange ? { periods: { current: storedPeriod(range), previous: storedPeriod(compareRange) } } : {}),
      },
    });
    return { errors: {}, jobId: job.id };
  } catch (error) {
    // Shopify refused to start the export (for example it is busy).
    return { errors: { form: `Could not start the report: ${error.message}` }, jobId: null };
  }
}
