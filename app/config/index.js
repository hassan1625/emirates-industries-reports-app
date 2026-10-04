// Single entry point for report/field/filter configuration.
//
// Rule (Dev Plan Step 9): the UI and the backend import field and filter
// definitions ONLY from here. Never hardcode a field or filter list (or its
// labels) anywhere else. `npm run check:config` enforces this.
export { SHARED_SCHEMA, SHARED_DIMENSIONS, SHARED_METRICS, SHARED_CALCULATIONS, DATE_RANGE_MODES } from "./schema.js";
export { REPORTS, getReport, getReportFields, getReportFilters, resolveItem } from "./reports/index.js";
export { hasFieldSelection, getSelectableFields, defaultFieldKeys } from "./field-selection.js";
