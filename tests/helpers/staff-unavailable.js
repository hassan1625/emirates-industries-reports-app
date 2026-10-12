import { generalSalesReport } from "../../app/config/reports/r1-general-sales.js";

// Runs `fn` with POS Staff switched off, the way a field or filter with no data
// source is described in the config (`available: false`), to test that mechanism.
// Pass `report` when another module instance reads the config (Vite's SSR loader
// keeps its own copy of the config modules).
export const withStaffUnavailable = (fn, report = generalSalesReport) => {
  const reason = "Not available on this plan.";
  const field = report.fields.find((f) => f.key === "posStaff");
  const filter = report.filters.find((f) => f.key === "posStaff");
  Object.assign(field, { available: false, unavailableReason: reason });
  Object.assign(filter, { available: false, unavailableReason: reason });
  try {
    return fn();
  } finally {
    for (const item of [field, filter]) {
      delete item.available;
      delete item.unavailableReason;
    }
  }
};
