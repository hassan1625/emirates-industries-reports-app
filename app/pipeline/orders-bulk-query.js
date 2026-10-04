// Orders export for Report 1 and the order side of Reports 3, 4 and 5
// (Dev Plan Step 13, revised after validation on the client store).
//
// ONE query carries everything: attribution (channel, POS location), payment,
// discounts, shipping total, refunds, line items (sku, barcode, quantities,
// prices, taxes, allocations, product id) and returns with their reasons.
// Collections come from the separate products export and are joined in
// Milestone 3 (Step 19).
//
// Shopify bulk limits (verified against the live API):
//   * at most 5 connections INCLUDING the root `orders`;
//   * no connection inside a list field. `Order.refunds` is a list, so it is
//     selected for totals only; refund line items cannot be fetched in bulk.
// This query uses exactly 5 connections: orders, discountApplications,
// lineItems, returns and returnLineItems. That is why shipping is read from
// `currentShippingPriceSet` and not from the `shippingLines` connection.
//
// Field choices proven on the client store:
//   * `currentShippingPriceSet` is shipping AFTER discounts (0 for Free
//     Shipping orders). `totalShippingPriceSet` is the pre-discount price and
//     would overstate shipping, so it is NOT used for the report.
//   * `lineItems.currentQuantity` is the quantity after returns/removals, which
//     gives Net Items Sold. Canceled returns must not be counted: filter on
//     `returns.status` when reading return reasons.
//   * POS Staff is deliberately NOT queried: staffMember needs `read_users`,
//     which Shopify only grants to Plus/Advanced stores (client is on Grow).
//   * `returnReasonDefinition` is used for readable return reasons; the old
//     `returnReason` enum is deprecated and coarser.

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
        taxesIncluded
        currentShippingPriceSet { ${MONEY} }
        totalRefundedSet { ${MONEY} }
        refunds {
          id
          createdAt
          totalRefundedSet { ${MONEY} }
        }
        discountApplications {
          edges {
            node {
              __typename
              index
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
              discountedUnitPriceAfterAllDiscountsSet { ${MONEY} }
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
        returns {
          edges {
            node {
              id
              status
              returnLineItems {
                edges {
                  node {
                    ... on ReturnLineItem {
                      id
                      quantity
                      returnReasonDefinition { name handle }
                      fulfillmentLineItem { lineItem { id } }
                    }
                  }
                }
              }
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
