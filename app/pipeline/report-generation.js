// Builds a job's report file once its data is on disk (Dev Plan Step 27):
// DATA_READY -> GENERATING -> READY (or FAILED). The file is the XLSX of the
// report's rows, built from the dated sales events inside the requested range,
// narrowed by the request's filters and chosen fields. Each report type has a
// builder below that returns its rows (and, if it has them, a totals row, a
// Summary sheet and notes). POS staff names are fetched from ShopifyQL here, only
// when the report needs them.
//
// Like the other chain steps, the move out of DATA_READY is an atomic claim, so
// a duplicate trigger (webhook plus recovery pass) builds the file once. A
// process that dies mid-write leaves the job in GENERATING; the recovery pass
// puts it back and builds again.
import { defaultFieldKeys, getReport, getReportFields, hasFieldSelection } from "../config/index.js";
import { groupAgreementOrders, groupOrders, readJsonl } from "./bulk-file.js";
import { buildCreditRows, summarizeCredits } from "./credit-rows.js";
import { loadProductIndex } from "./join.js";
import { buildLedgerRows, formatStoreDate, indexAgreements, ledgerColumns } from "./ledger-rows.js";
import { loadMappings } from "./location-mapping.js";
import { buildRowFilter } from "./report-filter.js";
import { fetchStaffByOrder } from "./staff.js";
import { parseLocalDateTime, writeReportXlsx } from "./report-xlsx.js";
import { jobReportPath, toLocalUrl } from "./storage.js";
import { STAGES } from "./job-stages.js";

export const GENERATED_REPORT_TYPES = Object.freeze(["generalSales", "refundCredit"]);

const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

// The sheet's columns: the chosen fields that have data, in config order. A
// report without field selection always has all of its fields.
export function buildReportColumns(reportKey, fields) {
  const chosen = hasFieldSelection(reportKey) ? new Set(fields ?? defaultFieldKeys(reportKey)) : null;
  return getReportFields(reportKey)
    .filter((field) => (!chosen || chosen.has(field.key)) && field.available !== false)
    .map(({ key, label, type, width }) => ({ key, label, type, width }));
}

const MONEY = { type: "currency" };

// Each builder gets { job, columns, range, filters, mappings, staffByOrder, keep }
// and returns { rows, footer?, summary?, notes } (rows are objects keyed by column key).
const BUILDERS = {
  async generalSales({ job, range, mappings, staffByOrder, keep }) {
    const productIndex = await loadProductIndex(job.productsFile);
    const agreementsByOrder = await indexAgreements(groupAgreementOrders(readJsonl(job.eventsFile)));
    const rows = await buildLedgerRows(groupOrders(readJsonl(job.ordersFile)), agreementsByOrder, {
      columns: ledgerColumns(),
      productIndex,
      mappings,
      staffByOrder,
      startMs: Date.parse(range.start),
      endMs: Date.parse(range.end) + 999, // the range ends at the last whole second of the day
      keep,
    });
    return {
      rows: rows.map((row) => row.values),
      notes: [
        "Every row is dated on the day it happened: returns and exchanges count on the day they were processed, not on the original order date.",
        "Order Type: Order = items sold (including exchange replacements) and shipping; Reversal = items returned, with negative quantity and amounts and the Return Reason.",
        "Shipping appears on its own row (Is Shipping Charges = Yes); orders with a shipping discount such as Free Shipping show 0.00 and the discount's name.",
        "Credit Shopify keeps on exchanges is not included here; it is reported in the Refund Credit Report.",
      ],
    };
  },

  // The products file is collected with every job but not needed here.
  async refundCredit({ job, range, mappings, staffByOrder, keep }) {
    const agreementsByOrder = await indexAgreements(groupAgreementOrders(readJsonl(job.eventsFile)));
    const rows = await buildCreditRows(groupOrders(readJsonl(job.ordersFile)), agreementsByOrder, {
      mappings,
      staffByOrder,
      startMs: Date.parse(range.start),
      endMs: Date.parse(range.end) + 999,
      keep,
    });
    const totals = summarizeCredits(rows);
    return {
      rows: rows.map((row) => row.values),
      footer: { orderName: "Total", creditAmount: totals.total },
      summary: [
        { label: "Credits in this period", value: totals.count, type: "number" },
        { label: "Orders affected", value: totals.orders, type: "number" },
        { label: "Total credit (AED, no VAT)", value: totals.total, ...MONEY },
        { label: "" },
        ...(totals.byChannel.length ? [{ label: "By sales channel" }] : []),
        ...totals.byChannel.flatMap(({ channel, count, total }) => [
          { label: `${channel}: credits`, value: count, type: "number" },
          { label: `${channel}: amount`, value: total, ...MONEY },
        ]),
      ],
      notes: [
        "Each row is an exchange credit: the customer returned items worth more than the replacement and the difference was not refunded, so Shopify keeps it as sales on no item.",
        "Event Date is the day the credit was booked; Original Order Date is when the order was placed.",
        "The credit carries no VAT. Adding the total to the General Sales Report's Net sales (and Total sales) gives Shopify's own figures for the same period.",
      ],
    };
  },
};

// Returns { action: "ready" | "skipped" | "failed" | "not-supported", ... }.
export async function generateReport({ db, admin, jobId, deps = {} }) {
  const write = deps.write ?? writeReportXlsx;
  const pathFor = deps.reportPath ?? jobReportPath;
  const now = deps.now ?? (() => new Date());
  const fetchStaff = deps.fetchStaff ?? fetchStaffByOrder;

  const job = await db.reportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`No job ${jobId}`);
  if (!GENERATED_REPORT_TYPES.includes(job.reportType)) return { action: "not-supported" };

  const { count } = await db.reportJob.updateMany({ where: { id: job.id, stage: STAGES.DATA_READY }, data: { stage: STAGES.GENERATING, error: null } });
  if (count !== 1) return { action: "skipped" };

  const started = Date.now();
  try {
    if (!job.ordersFile || !job.eventsFile || !job.productsFile) throw new Error("the downloaded data files are missing");
    const params = parseParams(job.params);
    const reportKey = params.reportKey ?? job.reportType;
    const report = getReport(reportKey);
    const columns = buildReportColumns(reportKey, params.fields);
    if (columns.length === 0) throw new Error("no columns were selected");

    const range = params.range;
    if (!range?.start || !range?.end) throw new Error("the request has no date range");
    const build = BUILDERS[reportKey];
    if (!build) throw new Error(`there is no builder for ${reportKey}`);
    const mappings = await loadMappings(db, job.shop);
    const filters = params.filters ?? {};

    // Staff names are only looked up when the report shows or filters on them.
    const needsStaff = columns.some((column) => column.key === "posStaff") || Boolean(filters.posStaff?.length);
    let staffByOrder = new Map();
    if (needsStaff) {
      if (!admin) throw new Error("no Shopify connection is available to look up POS staff");
      const local = params.localRange;
      if (!local?.from || !local?.to) throw new Error("the request has no store dates for the staff lookup");
      staffByOrder = await fetchStaff(admin, local.from, local.to);
    }

    const built = await build({ job, columns, range, filters, mappings, staffByOrder, keep: buildRowFilter(reportKey, filters) });
    const filePath = pathFor(job.id);

    const { rows: rowCount, bytes } = await write({
      filePath,
      sheetName: report.label,
      columns,
      rows: built.rows,
      footer: built.footer,
      summary: built.summary,
      request: {
        reportLabel: report.label,
        generatedAt: parseLocalDateTime(formatStoreDate(now())), // store wall-clock, like Order Date
        range: params.localRange ?? null,
        filters: params.filterSummary ?? Object.entries(filters).map(([key, values]) => ({ label: key, values })),
        notes: built.notes,
      },
    });

    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.READY, resultFileUrl: toLocalUrl(filePath), resultRows: rowCount, resultBytes: bytes, error: null } });
    return { action: "ready", rows: rowCount, bytes, seconds: (Date.now() - started) / 1000 };
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: `Could not build the report file: ${error.message}` } });
    return { action: "failed", error: error.message };
  }
}
