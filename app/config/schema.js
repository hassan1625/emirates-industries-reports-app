// Shared dimension/metric schema (Dev Plan §4a).
//
// Single source of truth for every item used by more than one report.
// Per-report configs (Step 8) reference these entries by key and must not
// redefine labels, data sources or calculations. The UI and the backend both
// read from here.
//
// `source` describes where the raw value comes from:
//   operation: which Bulk Operation / query supplies it
//                ("orders" | "products" | "inventory")
//   path:      field path on that operation's node (GraphQL Admin API)
// `calculation` names an entry in SHARED_CALCULATIONS (implemented in
// Milestone 3, Step 21). Nothing here implements math.

export const DATE_RANGE_MODES = Object.freeze({
  // Plain start/end range (Reports 1 and 4).
  SINGLE: "single",
  // Range plus a comparison range: prior year auto-calculated by default,
  // with a manual override (Reports 3 and 5).
  YEARLY_PAIR: "yearly-pair",
});

export const SHARED_CALCULATIONS = Object.freeze({
  totalSales: {
    label: "Total Sales",
    formula: "Net Sales + Shipping + Taxes",
    implementedIn: "app/calculations/sales.js", // Milestone 3, Step 21
    usedBy: ["R1", "R3", "R4"],
  },
  difference: {
    label: "Difference (value + %)",
    formula: "value = current - previous; percent = value / previous",
    implementedIn: "app/calculations/difference.js", // Milestone 3, Step 21
    usedBy: ["R3", "R5"],
  },
});

export const SHARED_DIMENSIONS = Object.freeze({
  collectionName: {
    key: "collectionName",
    label: "Collection Name",
    type: "string",
    // Each product belongs to exactly one collection: plain 1:1 join.
    source: { operation: "products", path: "collections.title" },
    joinKey: { from: "lineItem.product.id", to: "product.id" },
    usedBy: ["R1", "R2", "R3", "R4"],
    filterIn: ["R1", "R2", "R3", "R5"], // R3: optional
  },

  locationName: {
    key: "locationName",
    label: "Location Name",
    type: "string",
    // Orders: retailLocation, with Online Store / Mobile App mapped to the
    // configured location (Milestone 3, Step 20). Inventory: Location.name.
    source: {
      operation: "orders",
      path: "retailLocation.name",
      alternate: { operation: "inventory", path: "location.name" },
    },
    mapping: "locationMapping", // configurable table, not a hardcoded string
    usedBy: ["R1", "R2", "R3", "R4"],
    filterIn: ["R1", "R2", "R5"],
  },

  dateRange: {
    key: "dateRange",
    label: "Date Range",
    type: "dateRange",
    source: { operation: "orders", path: "createdAt" },
    modes: DATE_RANGE_MODES,
    usedBy: ["R1", "R2", "R3", "R4", "R5"],
    filterIn: ["R1", "R3", "R4", "R5"],
  },

  sku: {
    key: "sku",
    label: "SKU",
    type: "string",
    source: { operation: "orders", path: "lineItems.sku" },
    usedBy: ["R1", "R2", "R5"],
  },

  barcode: {
    key: "barcode",
    label: "Barcode",
    type: "string",
    source: { operation: "orders", path: "lineItems.variant.barcode" },
    usedBy: ["R1", "R2", "R5"],
  },

  productTitle: {
    key: "productTitle",
    label: "Product Title",
    type: "string",
    source: { operation: "orders", path: "lineItems.title" },
    usedBy: ["R1", "R2"],
  },
});

export const SHARED_METRICS = Object.freeze({
  totalSales: {
    key: "totalSales",
    label: "Total Sales",
    type: "currency",
    calculation: "totalSales",
    usedBy: ["R1", "R3", "R4"],
  },
});

export const SHARED_SCHEMA = Object.freeze({
  dimensions: SHARED_DIMENSIONS,
  metrics: SHARED_METRICS,
  calculations: SHARED_CALCULATIONS,
});
