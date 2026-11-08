// Report 3 — Sales Comparison Report, Yearly (Dev Plan §4d). Phase 2.
import { DATE_RANGE_MODES } from "../schema.js";

// The columns after the grouping column are the same in both sub-reports. A column
// with a `period` is headed with that period's year(s) by the report builder.
const comparisonColumns = (dimension) => [
  { key: dimension, ref: dimension, width: 40 },
  { key: "totalSalesPrevious", ref: "totalSales", period: "previous", width: 22 },
  { key: "totalSalesCurrent", ref: "totalSales", period: "current", width: 22 },
  { key: "difference", label: "Difference", type: "currency", calculation: "difference", width: 16 },
  { key: "differencePercent", label: "Difference %", type: "percent", calculation: "difference", width: 14 },
];

export const salesComparisonReport = {
  id: "R3",
  key: "salesComparison",
  label: "Sales Comparison Report (Yearly)",
  route: "/app/report-sales-comparison",
  phase: 2,
  hasScreen: true,
  description: "Total sales of a period against the same period a year earlier, by collection and by location. Downloads as an Excel file with one sheet for each.",

  // Two sub-reports (two sheets) sharing the same Total Sales calculation.
  subReports: [
    { key: "byCollection", id: "3A", label: "By Collection", groupBy: { key: "collectionName", ref: "collectionName" }, columns: comparisonColumns("collectionName") },
    { key: "byLocation", id: "3B", label: "By Location", groupBy: { key: "locationName", ref: "locationName" }, columns: comparisonColumns("locationName") },
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
    // Optional; applies to both sub-reports. Shipping has no collection, so a collection filter leaves it out.
    { key: "collection", ref: "collectionName", allLabel: "All collections", type: "multiSelect", required: false, matchOn: "collectionName", appliesTo: ["byCollection", "byLocation"] },
  ],
};
