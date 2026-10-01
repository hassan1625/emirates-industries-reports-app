// Report 3 — Sales Comparison Report, Yearly (Dev Plan §4d). Phase 2.
import { DATE_RANGE_MODES } from "../schema.js";

export const salesComparisonReport = {
  id: "R3",
  key: "salesComparison",
  label: "Sales Comparison Report (Yearly)",
  route: "/app/report-sales-comparison",
  phase: 2,

  // Two sub-reports sharing the same Total Sales calculation.
  subReports: [
    {
      key: "byCollection",
      id: "3A",
      label: "By Collection",
      groupBy: { key: "collectionName", ref: "collectionName" },
      columns: [
        { key: "collectionName", ref: "collectionName" },
        { key: "totalSalesYear1", ref: "totalSales", label: "Total Sales Year 1", period: "previous" },
        { key: "totalSalesYear2", ref: "totalSales", label: "Total Sales Year 2", period: "current" },
        { key: "difference", label: "Difference", type: "differencePair", calculation: "difference" },
      ],
    },
    {
      key: "byLocation",
      id: "3B",
      label: "By Location",
      groupBy: { key: "locationName", ref: "locationName" },
      columns: [
        { key: "locationName", ref: "locationName" },
        { key: "totalSalesYear1", ref: "totalSales", label: "Total Sales Year 1", period: "previous" },
        { key: "totalSalesYear2", ref: "totalSales", label: "Total Sales Year 2", period: "current" },
        { key: "difference", label: "Difference", type: "differencePair", calculation: "difference" },
      ],
    },
  ],

  filters: [
    {
      key: "dateRange",
      ref: "dateRange",
      mode: DATE_RANGE_MODES.YEARLY_PAIR,
      required: true,
      // Prior year auto-calculated by default; user may override manually.
      comparison: { default: "priorYear", manualOverride: true },
    },
    // Optional; applies to both sub-reports.
    { key: "collection", ref: "collectionName", type: "multiSelect", required: false, appliesTo: ["byCollection", "byLocation"] },
  ],
};
