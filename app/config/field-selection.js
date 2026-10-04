// Which fields of a report can be picked on the request screen, and which are
// on by default (Dev Plan Step 25). Read from the report's config only; the
// screen and the server both use this, so the field list exists once.
//
// A report offers field selection when its config has `fieldSelection`
// (Report 1). Its `fields` are the candidates. A field marked
// `available: false` has no data source on this plan: it is listed, disabled and
// off, and any request that names it is quietly narrowed to the rest.
import { getReport, getReportFields } from "./reports/index.js";

export function hasFieldSelection(reportKey) {
  return Boolean(getReport(reportKey).fieldSelection);
}

// [{ key, label, available, unavailableReason? }] in config (column) order.
export function getSelectableFields(reportKey) {
  if (!hasFieldSelection(reportKey)) return [];
  return getReportFields(reportKey).map((field) => ({
    key: field.key,
    label: field.label,
    available: field.available !== false,
    unavailableReason: field.unavailableReason ?? null,
  }));
}

// Keys on when the screen first opens: every available field.
export function defaultFieldKeys(reportKey) {
  return getSelectableFields(reportKey).filter((field) => field.available).map((field) => field.key);
}
