// Filters used by more than one report (Report 1 and the Refund Credit Report):
// each names the row property it matches (`matchOn`, see pipeline/report-filter.js).
// Dates, channels, locations and staff mean the same thing in every report.
export const salesChannelFilter = { key: "salesChannel", label: "Sales Channel", allLabel: "All sales channels", type: "multiSelect", matchOn: "sourceName", source: { operation: "orders", path: "sourceName" } };
export const posLocationFilter = { key: "posLocation", ref: "locationName", label: "POS Location", allLabel: "All locations", type: "multiSelect", matchOn: "locationId" };
// Order.staffMember needs read_users (Plus/Advanced only), so staff names come from ShopifyQL.
export const posStaffFilter = { key: "posStaff", label: "POS Staff", allLabel: "All staff", type: "multiSelect", matchOn: "posStaff", source: { operation: "shopifyql", path: "staff_member_name" } };
