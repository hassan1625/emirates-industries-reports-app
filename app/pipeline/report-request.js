// Validates and normalises a report request from the request screen (Dev Plan
// Step 24). Driven entirely by the report's config: whichever filters the
// config lists are the filters accepted here, so the screen and the backend
// cannot drift apart. The server always runs this; the browser is not trusted.
import { getReportFilters } from "../config/index.js";
import { STORE_TIME_ZONE } from "../config/store.js";
import { DATE_RANGE_MODES } from "../config/schema.js";
import { defaultFieldKeys, getSelectableFields, hasFieldSelection } from "../config/field-selection.js";
import { daysBetween, endOfDayUtc, isValidDateString, startOfDayUtc } from "./dates.js";

// Longest date range accepted. A year of this store is about 37,000 orders; two
// years would still be fine, anything beyond is almost certainly a mistake.
export const MAX_RANGE_DAYS = 800;

const SELECT_TYPES = new Set(["multiSelect", "singleSelect"]);

const cleanList = (value) => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map((v) => String(v).trim()).filter(Boolean))];

// input:   { dateRange: { from, to }, filters: { [filterKey]: string[] }, fields?: string[] }
// options: { allowedOptions: { [filterKey]: string[] }, timeZone }
// Returns { ok: true, value } or { ok: false, errors: { [filterKey]: message } }.
export function parseReportRequest(reportKey, input = {}, { allowedOptions = {}, timeZone = STORE_TIME_ZONE } = {}) {
  const errors = {};
  const value = { reportKey, range: null, filters: {}, fields: null, ignored: [] };

  for (const filter of getReportFilters(reportKey)) {
    if (filter.type === "dateRange") {
      if (filter.mode !== DATE_RANGE_MODES.SINGLE) {
        errors[filter.key] = `Date range mode "${filter.mode}" is not supported on this screen yet`;
        continue;
      }
      const { from, to } = input.dateRange ?? {};
      if (!from || !to) {
        if (filter.required) errors[filter.key] = "Choose a start and an end date";
        continue;
      }
      if (!isValidDateString(from) || !isValidDateString(to)) {
        errors[filter.key] = "Dates must be real calendar dates";
      } else if (from > to) {
        errors[filter.key] = "The start date must not be after the end date";
      } else if (daysBetween(from, to) > MAX_RANGE_DAYS) {
        errors[filter.key] = `Choose a range of at most ${MAX_RANGE_DAYS} days`;
      } else {
        value.range = { from, to, timeZone, start: startOfDayUtc(from, timeZone), end: endOfDayUtc(to, timeZone) };
      }
      continue;
    }

    if (!SELECT_TYPES.has(filter.type)) continue;
    const chosen = cleanList(input.filters?.[filter.key]);

    // A filter with no data source on this plan is accepted but never applied.
    if (filter.available === false) {
      if (chosen.length) value.ignored.push(filter.key);
      continue;
    }
    if (filter.type === "singleSelect" && chosen.length > 1) {
      errors[filter.key] = "Choose only one";
      continue;
    }
    const allowed = allowedOptions[filter.key];
    const unknown = allowed ? chosen.filter((v) => !allowed.includes(v)) : [];
    if (unknown.length) {
      errors[filter.key] = "One of the selected options no longer exists; reload the page";
      continue;
    }
    if (filter.required && chosen.length === 0) {
      errors[filter.key] = "Choose an option";
      continue;
    }
    if (chosen.length) value.filters[filter.key] = chosen; // empty means "everything"
  }

  // Field selection (only for reports that offer it). Omitting `fields` means
  // the defaults; sending an empty list is a mistake, not "everything".
  if (hasFieldSelection(reportKey)) {
    const selectable = getSelectableFields(reportKey);
    if (input.fields === undefined || input.fields === null) {
      value.fields = defaultFieldKeys(reportKey);
    } else {
      const chosen = cleanList(input.fields);
      const known = new Set(selectable.map((f) => f.key));
      const unavailable = new Set(selectable.filter((f) => !f.available).map((f) => f.key));
      if (chosen.some((key) => !known.has(key))) {
        errors.fields = "One of the selected fields does not exist; reload the page";
      } else {
        value.ignored.push(...chosen.filter((key) => unavailable.has(key)).map((key) => `field:${key}`));
        // Config (column) order, never the order the browser sent.
        value.fields = selectable.filter((f) => f.available && chosen.includes(f.key)).map((f) => f.key);
        if (value.fields.length === 0) errors.fields = "Choose at least one field";
      }
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
