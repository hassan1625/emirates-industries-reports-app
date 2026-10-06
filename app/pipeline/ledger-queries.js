// Dated sales events per order (the "sales agreements" Shopify keeps for every
// order). Each agreement is something that HAPPENED on a date: the order being
// placed, an edit, a refund, a return or an exchange. Its sales are the money
// movements, with negative quantities and amounts for returns. This is the data
// behind Shopify's own sales analytics, and what a report needs to count a
// return on the day it was returned. Only read_orders and read_returns needed.
//
// 3 connections (orders, agreements, sales), inside the 5-connection limit. The
// matching order details (line items, discounts, returns) come from the orders
// export, joined on order and line item id: together they would exceed the
// connection limit in one query.
import { startBulkOperation } from "./bulk.js";

const toIso = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
const MONEY = "shopMoney { amount currencyCode }";

export function buildAgreementsQuery({ start }) {
  return `{
  orders(query: ${JSON.stringify(`updated_at:>=${toIso(start)}`)}, sortKey: UPDATED_AT) {
    edges {
      node {
        id
        name
        createdAt
        agreements {
          edges {
            node {
              __typename
              id
              happenedAt
              reason
              ... on ReturnAgreement { return { id } }
              ... on RefundAgreement { refund { id } }
              sales {
                edges {
                  node {
                    __typename
                    id
                    actionType
                    lineType
                    quantity
                    totalAmount { ${MONEY} }
                    totalTaxAmount { ${MONEY} }
                    totalDiscountAmountAfterTaxes { ${MONEY} }
                    totalDiscountAmountBeforeTaxes { ${MONEY} }
                    ... on ProductSale { lineItem { id } }
                    ... on ShippingLineSale { shippingLine { id } }
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

export function startAgreementsBulkOperation(admin, range) {
  return startBulkOperation(admin, buildAgreementsQuery(range), "agreements bulk query");
}
