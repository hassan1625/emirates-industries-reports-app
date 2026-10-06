// Builds a job's report file once its data is on disk (Dev Plan Step 27):
// DATA_READY -> GENERATING -> READY (or FAILED). The file is the XLSX of the
// Report 1 row set, narrowed by the request's filters and chosen fields.
//
// Like the other chain steps, the move out of DATA_READY is an atomic claim, so
// a duplicate trigger (webhook plus recovery pass) builds the file once. A
// process that dies mid-write leaves the job in GENERATING; the recovery pass
// puts it back and builds again.
import { defaultFieldKeys, getReport, getReportFields } from "../config/index.js";
import { groupOrders, readJsonl } from "./bulk-file.js";
import { loadProductIndex } from "./join.js";
import { loadMappings } from "./location-mapping.js";
import { buildRowFilter } from "./report-filter.js";
import { buildGeneralSalesRows } from "./report-rows.js";
import { parseLocalDateTime, writeReportXlsx } from "./report-xlsx.js";
import { formatStoreDate } from "./report-rows.js";
import { jobReportPath, toLocalUrl } from "./storage.js";
import { STAGES } from "./job-stages.js";

export const GENERATED_REPORT_TYPES = Object.freeze(["generalSales"]);

const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

// The sheet's columns: the chosen fields that have data, in config order.
export function buildReportColumns(reportKey, fields) {
  const chosen = new Set(fields ?? defaultFieldKeys(reportKey));
  return getReportFields(reportKey)
    .filter((field) => chosen.has(field.key) && field.available !== false)
    .map(({ key, label, type, width }) => ({ key, label, type, width }));
}

async function* filteredValues(rows, keep) {
  for await (const row of rows) if (keep(row)) yield row.values;
}

// Returns { action: "ready" | "skipped" | "failed" | "not-supported", ... }.
export async function generateReport({ db, jobId, deps = {} }) {
  const write = deps.write ?? writeReportXlsx;
  const pathFor = deps.reportPath ?? jobReportPath;
  const now = deps.now ?? (() => new Date());

  const job = await db.reportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`No job ${jobId}`);
  if (!GENERATED_REPORT_TYPES.includes(job.reportType)) return { action: "not-supported" };

  const { count } = await db.reportJob.updateMany({ where: { id: job.id, stage: STAGES.DATA_READY }, data: { stage: STAGES.GENERATING, error: null } });
  if (count !== 1) return { action: "skipped" };

  const started = Date.now();
  try {
    if (!job.ordersFile || !job.productsFile) throw new Error("the downloaded data files are missing");
    const params = parseParams(job.params);
    const reportKey = params.reportKey ?? job.reportType;
    const report = getReport(reportKey);
    const columns = buildReportColumns(reportKey, params.fields);
    if (columns.length === 0) throw new Error("no columns were selected");

    const productIndex = await loadProductIndex(job.productsFile);
    const mappings = await loadMappings(db, job.shop);
    const rows = buildGeneralSalesRows(groupOrders(readJsonl(job.ordersFile)), { productIndex, mappings });
    const filePath = pathFor(job.id);

    const { rows: rowCount, bytes } = await write({
      filePath,
      sheetName: report.label,
      columns,
      rows: filteredValues(rows, buildRowFilter(reportKey, params.filters)),
      request: {
        reportLabel: report.label,
        generatedAt: parseLocalDateTime(formatStoreDate(now())), // store wall-clock, like Order Date
        range: params.localRange ?? null,
        filters: params.filterSummary ?? Object.entries(params.filters ?? {}).map(([key, values]) => ({ label: key, values })),
        notes: [
          "Sales, discounts and returns are attributed to the original order date.",
          "Shipping appears once per order, on its own row, when it was charged.",
          "POS Staff is not available on this Shopify plan.",
        ],
      },
    });

    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.READY, resultFileUrl: toLocalUrl(filePath), error: null } });
    return { action: "ready", rows: rowCount, bytes, seconds: (Date.now() - started) / 1000 };
  } catch (error) {
    await db.reportJob.update({ where: { id: job.id }, data: { stage: STAGES.FAILED, error: `Could not build the report file: ${error.message}` } });
    return { action: "failed", error: error.message };
  }
}
