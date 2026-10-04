// Store-level facts the reports need. Verified on the client store; change here,
// not in the row builders.

// Order dates and any day/month grouping use the store's own time zone, as
// Shopify's reports do. (Client item 7 asks them to confirm.)
export const STORE_TIME_ZONE = "Asia/Muscat";

// How an order's `sourceName` is shown as "Sales Channel". Unknown sources are
// shown as Shopify reports them.
export const SALES_CHANNEL_NAMES = Object.freeze({
  pos: "Point of Sale",
  web: "Online Store",
  "304980787201": "Mobile App",
  shopify_draft_order: "Draft Orders",
});
