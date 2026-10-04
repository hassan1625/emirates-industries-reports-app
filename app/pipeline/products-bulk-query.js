// Products + collections + variants export (Dev Plan Step 15). Joined to the
// orders export in Milestone 3 (Step 19) and used by the stock and SKU reports.
//
// 3 connections (products, collections, variants), well inside the 5-connection
// limit. No `query:` filter: an invalid filter (e.g. "status:any") silently
// returns zero products. Drafts are included; filter them when joining.
// Facts verified on the client store: 1 collection per product except a couple
// with none, 37 SKUs are shared by more than one variant (key by variant id,
// never by SKU), and some variants have no SKU or barcode.
import { startBulkOperation } from "./bulk.js";

export function buildProductsBulkQuery() {
  return `{
  products {
    edges {
      node {
        id
        title
        status
        tags
        collections {
          edges {
            node {
              id
              title
            }
          }
        }
        variants {
          edges {
            node {
              id
              sku
              barcode
              title
              price
              inventoryItem { id }
            }
          }
        }
      }
    }
  }
}`;
}

export function startProductsBulkOperation(admin) {
  return startBulkOperation(admin, buildProductsBulkQuery(), "products bulk query");
}
