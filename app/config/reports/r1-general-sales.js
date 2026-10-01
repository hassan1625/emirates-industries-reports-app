// Report 1 — General Sales Report (Dev Plan §4b). Phase 1.
// `ref` entries point at app/config/schema.js; all other entries are defined
// here. `calculation` names are implemented in Milestone 3 (Step 21).
import { DATE_RANGE_MODES } from "../schema.js";

export const generalSalesReport = {
  id: "R1",
  key: "generalSales",
  label: "General Sales Report",
  route: "/app/report-general-sales",
  phase: 1,

  // All fields selected by default, individually toggleable, with Select All.
  fieldSelection: { selectAll: true, defaultSelected: "all" },

  fields: [
    { key: "orderName", label: "Order Name", type: "string", source: { operation: "orders", path: "name" } },
    { key: "orderDate", label: "Order Date", type: "date", source: { operation: "orders", path: "createdAt" } },
    { key: "salesChannel", label: "Sales Channel", type: "string", source: { operation: "orders", path: "sourceName" } },
    { key: "posLocation", ref: "locationName", label: "POS Location" },
    { key: "posStaff", label: "POS Staff", type: "string", source: { operation: "orders", path: "staffMember.name" } },
    { key: "collectionName", ref: "collectionName" },
    { key: "productTitle", ref: "productTitle" },
    { key: "sku", ref: "sku", label: "Product Variant SKU" },
    { key: "barcode", ref: "barcode", label: "Product Variant Barcode" },
    { key: "variantPrice", label: "Product Variant Price", type: "currency", source: { operation: "orders", path: "lineItems.originalUnitPriceSet" } },
    { key: "unitPriceBeforeVat", label: "Unit Price Before VAT", type: "currency", calculation: "unitPriceBeforeVat" },
    { key: "netItemsSold", label: "Net Items Sold", type: "number", calculation: "netItemsSold" },
    { key: "grossSales", label: "Gross Sales", type: "currency", calculation: "grossSales" },
    { key: "discounts", label: "Discounts", type: "currency", calculation: "discounts" },
    { key: "discountCodeReason", label: "Discount Code/Reason", type: "string", source: { operation: "orders", path: "discountApplications" } },
    { key: "netSales", label: "Net Sales", type: "currency", calculation: "netSales" },
    // Order-level: shown once per order, not per line item.
    { key: "shippingCharges", label: "Shipping Charges (excl. VAT)", type: "currency", calculation: "shippingExclVat", perOrder: true },
    { key: "paymentMethod", label: "Payment Method", type: "string", source: { operation: "orders", path: "paymentGatewayNames" }, perOrder: true },
    { key: "taxes", label: "Taxes", type: "currency", source: { operation: "orders", path: "lineItems.taxLines" } },
    { key: "returnReason", label: "Return Reason", type: "string", source: { operation: "returns", path: "returnLineItems.returnReason" } },
    { key: "totalSales", ref: "totalSales" },
  ],

  filters: [
    { key: "dateRange", ref: "dateRange", mode: DATE_RANGE_MODES.SINGLE, required: true },
    { key: "salesChannel", label: "Sales Channel", type: "multiSelect", source: { operation: "orders", path: "sourceName" } },
    { key: "posLocation", ref: "locationName", label: "POS Location", type: "multiSelect" },
    { key: "posStaff", label: "POS Staff", type: "multiSelect", source: { operation: "orders", path: "staffMember.name" } },
    { key: "collection", ref: "collectionName", type: "multiSelect" },
  ],
};
