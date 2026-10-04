// Builds fixtures/sample-orders.json: the real pipeline output (orders.jsonl)
// for the orders that appear in the client's sample sheet, reduced to the
// fields the calculations read. Discount names, locations and returns are
// dropped on purpose. Used to regression-test the calculation layer against the
// sheet the client validated (Dev Plan Steps 21-22).
//
//   node scripts/extract-sample-orders.js storage/jobs/<jobId>/orders.jsonl
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { groupOrders, readJsonl } from "../app/pipeline/bulk-file.js";

const [ordersFile] = process.argv.slice(2);
if (!ordersFile) {
  console.error("Usage: node scripts/extract-sample-orders.js <orders.jsonl>");
  process.exit(1);
}

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const sample = JSON.parse(readFileSync(path("../fixtures/general-report.json"), "utf8"));
const wanted = new Set(sample.rows.map((row) => row.orderName));

const orders = [];
for await (const order of groupOrders(readJsonl(ordersFile))) {
  if (!wanted.has(order.name)) continue;
  orders.push({
    id: order.id,
    name: order.name,
    taxesIncluded: order.taxesIncluded,
    currentShippingPriceSet: order.currentShippingPriceSet,
    paymentGatewayNames: order.paymentGatewayNames,
    lineItems: order.lineItems.map((line) => ({
      id: line.id,
      sku: line.sku,
      quantity: line.quantity,
      currentQuantity: line.currentQuantity,
      originalUnitPriceSet: line.originalUnitPriceSet,
      discountAllocations: line.discountAllocations,
      taxLines: line.taxLines,
    })),
  });
}

writeFileSync(path("../fixtures/sample-orders.json"), JSON.stringify({ source: "pipeline output for the orders in general-report.json", orders }, null, 2) + "\n");
console.log(`sample-orders.json: ${orders.length} of ${wanted.size} orders`);
