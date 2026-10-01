// Report 2 — Stock Report by Location (Dev Plan §4c). Phase 2.

export const stockReport = {
  id: "R2",
  key: "stockByLocation",
  label: "Stock Report by Location",
  route: "/app/report-stock",
  phase: 2,

  // Fixed header value above the table, not a column.
  header: { key: "locationName", ref: "locationName" },

  // Collection Name is always a column, placed before Product Name, so one or
  // many selected collections produce the same sheet layout.
  columns: [
    { key: "collectionName", ref: "collectionName" },
    { key: "productName", ref: "productTitle", label: "Product Name" },
    { key: "sku", ref: "sku" },
    { key: "barcode", ref: "barcode" },
    { key: "stockCommitted", label: "Stock Committed", type: "number", source: { operation: "inventory", path: "quantities.committed" } },
    { key: "stockAvailable", label: "Stock Available", type: "number", source: { operation: "inventory", path: "quantities.available" } },
    { key: "stockOnHand", label: "Stock On Hand", type: "number", source: { operation: "inventory", path: "quantities.on_hand" } },
  ],

  filters: [
    { key: "location", ref: "locationName", type: "singleSelect", required: true },
    { key: "collection", ref: "collectionName", type: "multiSelect" },
    { key: "tag", label: "Tag", type: "multiSelect", source: { operation: "products", path: "tags" } },
  ],

  // XLSX conditional formatting.
  formatting: [
    { key: "lowStock", column: "stockAvailable", operator: "lessThanOrEqual", value: 5, style: { fill: "red" } },
  ],
};
