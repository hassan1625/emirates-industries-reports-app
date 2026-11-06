// Report 2 — Stock Report by Location (Dev Plan §4c). Phase 2.
// A snapshot of the stock levels at one or more locations (all of them when none
// is chosen), taken when the report is built; it has no date range.

export const stockReport = {
  id: "R2",
  key: "stockByLocation",
  label: "Stock Report by Location",
  route: "/app/report-stock",
  phase: 2,
  hasScreen: true,
  description: "The stock of every item at one location: committed, available and on hand. Items with 5 or fewer available are highlighted in red. Downloads as an Excel file.",

  // With exactly one location chosen, its name is a fixed header value above the
  // table (the approved layout). With several or all locations, the same name
  // becomes the first column instead (the `severalLocationsOnly` column below).
  header: { key: "locationName", ref: "locationName" },

  // Collection Name is always a column, placed before Product Name, so one or
  // many selected collections produce the same sheet layout. No field selection:
  // the sheet always has these columns.
  columns: [
    { key: "locationName", ref: "locationName", width: 36, severalLocationsOnly: true },
    { key: "collectionName", ref: "collectionName", width: 28 },
    { key: "productName", ref: "productTitle", label: "Product Name", width: 48 },
    { key: "sku", ref: "sku", width: 22 },
    { key: "barcode", ref: "barcode", width: 18 },
    { key: "stockCommitted", label: "Stock Committed", type: "number", source: { operation: "inventory", path: "quantities.committed" } },
    { key: "stockAvailable", label: "Stock Available", type: "number", source: { operation: "inventory", path: "quantities.available" } },
    { key: "stockOnHand", label: "Stock On Hand", type: "number", source: { operation: "inventory", path: "quantities.on_hand" } },
  ],

  filters: [
    // Same location choices as the sales reports (the key names their option list).
    // Leave it empty for every location.
    { key: "posLocation", ref: "locationName", label: "Location", allLabel: "All locations", type: "multiSelect" },
    { key: "collection", ref: "collectionName", allLabel: "All collections", type: "multiSelect" },
    { key: "tag", label: "Tag", allLabel: "All tags", type: "multiSelect", source: { operation: "products", path: "tags" } },
    // Every item is listed by default, including those with no stock (most levels
    // are zero); choosing "Hide" leaves out the ones that are zero in all three quantities.
    { key: "zeroStock", label: "Items with no stock", allLabel: "Show items with no stock", type: "singleSelect", source: { operation: "inventory", path: "quantities" } },
  ],

  // XLSX conditional formatting: the whole row turns red when the column is at or
  // below the value.
  formatting: [
    { key: "lowStock", column: "stockAvailable", operator: "lessThanOrEqual", value: 5, style: { fill: "red" } },
  ],
};
