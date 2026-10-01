// Report 4 — Total Sales Report by Date Range (Dev Plan §4e). Phase 2.
import { DATE_RANGE_MODES } from "../schema.js";

export const totalSalesMatrixReport = {
  id: "R4",
  key: "totalSalesMatrix",
  label: "Total Sales Report by Date Range",
  route: "/app/report-total-sales",
  phase: 2,

  // Dynamic pivot: rows and columns come from whatever had sales in the range.
  matrix: {
    rows: { key: "collectionName", ref: "collectionName", dynamic: true },
    columns: { key: "locationName", ref: "locationName", dynamic: true, mergedHeader: true },
    value: { key: "totalSales", ref: "totalSales" },
    totals: { rowTotals: true, columnTotals: true, grandTotal: true },
  },

  filters: [
    { key: "dateRange", ref: "dateRange", mode: DATE_RANGE_MODES.SINGLE, required: true },
  ],
};
