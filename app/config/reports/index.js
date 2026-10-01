// Registry of all report configs plus a resolver that merges `ref` entries
// with their shared definition from app/config/schema.js. UI and backend
// should read field/filter definitions only through these exports.
import { SHARED_DIMENSIONS, SHARED_METRICS } from "../schema.js";
import { generalSalesReport } from "./r1-general-sales.js";
import { stockReport } from "./r2-stock-by-location.js";
import { salesComparisonReport } from "./r3-sales-comparison.js";
import { totalSalesMatrixReport } from "./r4-total-sales-matrix.js";
import { skuQuantityReport } from "./r5-sku-quantity.js";

export const REPORTS = Object.freeze({
  [generalSalesReport.key]: generalSalesReport,
  [stockReport.key]: stockReport,
  [salesComparisonReport.key]: salesComparisonReport,
  [totalSalesMatrixReport.key]: totalSalesMatrixReport,
  [skuQuantityReport.key]: skuQuantityReport,
});

export function getReport(key) {
  const report = REPORTS[key];
  if (!report) throw new Error(`Unknown report: ${key}`);
  return report;
}

// Returns the entry with its shared definition merged in. Local properties
// (e.g. a report-specific label) override the shared ones.
export function resolveItem(item) {
  if (!item.ref) return item;
  const shared = SHARED_DIMENSIONS[item.ref] ?? SHARED_METRICS[item.ref];
  if (!shared) throw new Error(`Unknown shared schema ref: ${item.ref}`);
  const local = { ...item };
  delete local.ref;
  return { ...shared, ...local };
}

export function getReportFields(key) {
  const report = getReport(key);
  return (report.fields ?? report.columns ?? []).map(resolveItem);
}

export function getReportFilters(key) {
  return getReport(key).filters.map(resolveItem);
}
