// Report 5 — Quantity Report for SKU, Yearly (Dev Plan §4f). Phase 2.
import { DATE_RANGE_MODES } from "../schema.js";

export const skuQuantityReport = {
  id: "R5",
  key: "skuQuantity",
  label: "Quantity Report for SKU (Yearly)",
  route: "/app/report-sku-quantity",
  phase: 2,

  columns: [
    { key: "sku", ref: "sku" },
    { key: "barcode", ref: "barcode" },
    { key: "quantityLastYear", label: "Quantity Sold Last Year", type: "number", period: "previous", source: { operation: "orders", path: "lineItems.quantity" } },
    { key: "quantityCurrentYear", label: "Quantity Sold Current Year", type: "number", period: "current", source: { operation: "orders", path: "lineItems.quantity" } },
    { key: "difference", label: "Difference", type: "differencePair", calculation: "difference" },
  ],

  // Every SKU is listed, including those with zero sales in either year.
  includeZeroSales: true,

  // Filters only: these never appear as output columns.
  filters: [
    { key: "location", ref: "locationName", type: "multiSelect" },
    { key: "collection", ref: "collectionName", type: "multiSelect" },
    {
      key: "dateRange",
      ref: "dateRange",
      mode: DATE_RANGE_MODES.YEARLY_PAIR,
      required: true,
      comparison: { default: "priorYear", manualOverride: true },
    },
  ],
};
