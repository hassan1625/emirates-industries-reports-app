// Report 5 — Quantity Report for SKU, Yearly (Dev Plan §4f). Phase 2.
// One row per item (variant) with the quantity sold in each of two periods, counted
// like the General Sales Report's Net Items Sold (returns take quantity back on the
// day they were processed).
import { DATE_RANGE_MODES } from "../schema.js";
import { posLocationFilter } from "../shared-filters.js";

export const skuQuantityReport = {
  id: "R5",
  key: "skuQuantity",
  label: "Quantity Report for SKU (Yearly)",
  route: "/app/report-sku-quantity",
  phase: 2,
  hasScreen: true,
  description: "The quantity sold of every SKU in two periods, for example this year and last year, with the difference. SKUs with no sales are listed too. Downloads as an Excel file.",

  // A column with a `period` is headed with that period's year(s) by the report builder.
  columns: [
    { key: "sku", ref: "sku", width: 24 },
    { key: "barcode", ref: "barcode", width: 22 },
    { key: "quantityPrevious", label: "Quantity Sold", type: "number", period: "previous", width: 20, source: { operation: "orders", path: "lineItems.quantity" } },
    { key: "quantityCurrent", label: "Quantity Sold", type: "number", period: "current", width: 20, source: { operation: "orders", path: "lineItems.quantity" } },
    { key: "difference", label: "Difference", type: "number", calculation: "difference", width: 14 },
    { key: "differencePercent", label: "Difference %", type: "percent", calculation: "difference", width: 14 },
  ],

  // Every SKU is listed, including those with zero sales in either year.
  includeZeroSales: true,

  // Filters only: these never appear as output columns. The location narrows the
  // sales that are counted; the collection narrows the SKUs listed.
  filters: [
    {
      key: "dateRange",
      ref: "dateRange",
      mode: DATE_RANGE_MODES.YEARLY_PAIR,
      required: true,
      comparison: { default: "priorYear", manualOverride: true },
    },
    posLocationFilter,
    { key: "collection", ref: "collectionName", allLabel: "All collections", type: "multiSelect", matchOn: "collectionName" },
  ],
};
