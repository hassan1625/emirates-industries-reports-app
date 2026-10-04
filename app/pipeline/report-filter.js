// Applies a request's filters and field selection to Report 1 rows (Dev Plan
// Step 26). Generic over the config: each select filter names the row `meta`
// property it matches (`matchOn`), so no filter is written out here.
//
// A filter with no chosen values means "everything". A filter without
// `matchOn` (or marked unavailable, like POS Staff) never excludes anything.
// Rows have no value for a property they don't carry (a shipping row has no
// collection, a draft order no location) and so are excluded when that filter
// is active.
import { getReportFilters } from "../config/index.js";

// Builds a predicate for a report's rows from the request's `filters`.
export function buildRowFilter(reportKey, filters = {}) {
  const active = getReportFilters(reportKey)
    .filter((filter) => filter.matchOn && filter.available !== false && filters[filter.key]?.length)
    .map((filter) => ({ matchOn: filter.matchOn, allowed: new Set(filters[filter.key]) }));
  if (active.length === 0) return () => true;
  return (row) => active.every(({ matchOn, allowed }) => allowed.has(row.meta[matchOn]));
}

// Keeps only the chosen columns of a row's values, in the order given.
// `fields` null/undefined means every column.
export function selectColumns(values, fields) {
  if (!fields) return values;
  return Object.fromEntries(fields.map((key) => [key, values[key] ?? null]));
}
