// Stock levels export, for the Stock Report by Location: every inventory item
// with its level at each location (on hand, committed, available). 2 connections
// (inventory items, their levels), well inside the bulk limits. Each item points
// at its variant, which the products export joins to product, collection, SKU
// and barcode. Facts verified on the client store: about 78% of the levels are
// zero or negative, and on hand = available + committed except in rare cases.
//
// INACTIVE levels are included (an item deactivated at a location keeps its stock
// there): Shopify's analytics counts that stock, and leaving it out made the
// report miss a whole location (EI Factory) and some items at others (checked
// 2026-11-05).
import { startBulkOperation } from "./bulk.js";

export const STOCK_QUANTITY_NAMES = Object.freeze(["available", "committed", "on_hand"]);

export function buildInventoryBulkQuery() {
  return `{
  inventoryItems {
    edges {
      node {
        id
        variant { id }
        inventoryLevels(includeInactive: true) {
          edges {
            node {
              id
              isActive
              location { id name }
              quantities(names: [${STOCK_QUANTITY_NAMES.map((name) => `"${name}"`).join(", ")}]) { name quantity }
            }
          }
        }
      }
    }
  }
}`;
}

export function startInventoryBulkOperation(admin) {
  return startBulkOperation(admin, buildInventoryBulkQuery(), "inventory bulk query");
}
