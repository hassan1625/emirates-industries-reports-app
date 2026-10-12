// Report 6 — Refund Credit Report. Phase 1 (added after the client approved the
// General Sales Report). Lists the exchange credit Shopify keeps: when a returned
// item was worth more than its replacement and the difference was not refunded,
// Shopify books it as sales kept on no item. It is left out of the General Sales
// Report on purpose and reported here, one row per credit, for the audit team.
import { DATE_RANGE_MODES } from "../schema.js";
import { posLocationFilter, posStaffFilter, salesChannelFilter } from "../shared-filters.js";

export const refundCreditReport = {
  id: "R6",
  key: "refundCredit",
  label: "Refund Credit Report",
  route: "/app/report-refund-credit",
  phase: 1,
  description: "Every exchange credit Shopify kept, with its order, staff and location, for audit. Left out of the General Sales Report.",

  // No field selection: the sheet always has these columns.
  fields: [
    { key: "orderName", label: "Order Name", type: "string", width: 12, source: { operation: "events", path: "name" } },
    // The day the credit was booked.
    { key: "eventDate", label: "Event Date", type: "date", source: { operation: "events", path: "agreements.happenedAt" } },
    { key: "originalOrderDate", label: "Original Order Date", type: "date", source: { operation: "orders", path: "createdAt" } },
    { key: "salesChannel", label: "Sales Channel", type: "string", width: 16, source: { operation: "orders", path: "sourceName" } },
    { key: "posLocation", ref: "locationName", label: "POS Location", width: 36 },
    { key: "posStaff", label: "POS Staff", type: "string", width: 22, source: { operation: "shopifyql", path: "staff_member_name" } },
    // Amount including VAT; Shopify books no tax on it.
    { key: "creditAmount", label: "Credit Amount", type: "currency", source: { operation: "events", path: "agreements.sales.totalAmount" } },
    { key: "itemsReturned", label: "Items Returned", type: "string", width: 50, source: { operation: "events", path: "agreements.sales.lineItem" } },
    { key: "returnReason", label: "Return Reason", type: "string", width: 28, source: { operation: "returns", path: "returnLineItems.returnReason" } },
  ],

  filters: [
    { key: "dateRange", ref: "dateRange", mode: DATE_RANGE_MODES.SINGLE, required: true },
    salesChannelFilter,
    posLocationFilter,
    posStaffFilter,
  ],
};
