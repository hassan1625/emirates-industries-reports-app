// Orders + line items bulk export (Dev Plan Step 13).
//
// One query covers every order-side field of Report 1: order attribution
// (channel, POS location), discounts, shipping, payment, and nested
// line items (sku, barcode, quantity, price, discount allocations, taxes,
// product id). Collections are NOT fetched here; they come from the separate
// products export and are joined in Milestone 3 (Step 19).
//
// POS Staff is deliberately NOT queried: Order.staffMember / LineItem.staffMember
// need the read_users scope, which Shopify only grants to Plus/Advanced stores
// (the client is on Basic/Grow). Selecting it fails the whole export with
// ACCESS_DENIED. Revisit if the client's plan changes.
//
// Bulk query limits: >= 1 connection, <= 5 connections, <= 2 levels of nesting.
// This query uses 3 connections (discountApplications, shippingLines,
// lineItems), all at depth 1.

import { startBulkOperation } from "./bulk.js";

const MONEY = "shopMoney { amount currencyCode }";

// `orders(query:)` body. Kept as a function so the date filter is injected
// safely and the same text can be validated against Shopify's schema.
export function buildOrdersBulkQuery({ start, end }) {
  const filter = buildOrdersSearchQuery({ start, end });
  return `{
  orders(query: ${JSON.stringify(filter)}, sortKey: CREATED_AT) {
    edges {
      node {
        id
        name
        createdAt
        sourceName
        retailLocation { id name }
        paymentGatewayNames
        discountApplications {
          edges {
            node {
              __typename
              allocationMethod
              targetSelection
              targetType
              value {
                __typename
                ... on MoneyV2 { amount currencyCode }
                ... on PricingPercentageValue { percentage }
              }
              ... on DiscountCodeApplication { code }
              ... on ManualDiscountApplication { title description }
              ... on AutomaticDiscountApplication { title }
              ... on ScriptDiscountApplication { title }
            }
          }
        }
        shippingLines {
          edges {
            node {
              id
              title
              originalPriceSet { ${MONEY} }
              discountedPriceSet { ${MONEY} }
              taxLines { title rate priceSet { ${MONEY} } }
            }
          }
        }
        lineItems {
          edges {
            node {
              id
              title
              sku
              quantity
              currentQuantity
              originalUnitPriceSet { ${MONEY} }
              discountAllocations {
                allocatedAmountSet { ${MONEY} }
                discountApplication { index }
              }
              taxLines { title rate priceSet { ${MONEY} } }
              variant { id barcode }
              product { id }
            }
          }
        }
      }
    }
  }
}`;
}

// Shopify search syntax. `start` and `end` are Date objects or ISO strings
// (UTC); both bounds are inclusive. A range search is paired with
// sortKey: CREATED_AT so it matches the sort and avoids timeouts.
export function buildOrdersSearchQuery({ start, end }) {
  const from = toIso(start, "start");
  const to = toIso(end, "end");
  if (new Date(from) > new Date(to)) throw new Error("Date range start must not be after end");
  return `created_at:>=${from} created_at:<=${to}`;
}

function toIso(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date range ${name}: ${value}`);
  // Whole seconds, UTC, e.g. 2026-01-01T00:00:00Z
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export { RUN_BULK_QUERY_MUTATION } from "./bulk.js";

// Starts the orders export. Returns { id, status }; see startBulkOperation.
export function startOrdersBulkOperation(admin, range) {
  return startBulkOperation(admin, buildOrdersBulkQuery(range), "orders bulk query");
}
