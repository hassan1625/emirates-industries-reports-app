import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOrdersBulkQuery,
  buildOrdersSearchQuery,
  RUN_BULK_QUERY_MUTATION,
  startOrdersBulkOperation,
} from "../app/pipeline/orders-bulk-query.js";

const range = { start: "2026-01-01T00:00:00Z", end: "2026-01-31T23:59:59Z" };

test("date range becomes an inclusive created_at filter in UTC whole seconds", () => {
  assert.equal(
    buildOrdersSearchQuery({ start: new Date("2026-01-01T00:00:00.000Z"), end: new Date("2026-01-31T23:59:59.999Z") }),
    "created_at:>=2026-01-01T00:00:00Z created_at:<=2026-01-31T23:59:59Z",
  );
});

test("invalid or reversed ranges are rejected", () => {
  assert.throws(() => buildOrdersSearchQuery({ start: "nope", end: range.end }), /Invalid date range start/);
  assert.throws(() => buildOrdersSearchQuery({ start: range.end, end: range.start }), /must not be after/);
});

test("query respects bulk limits: <= 5 connections, nesting depth 1, sorted by CREATED_AT", () => {
  const query = buildOrdersBulkQuery(range);
  const connections = query.match(/edges\s*\{/g).length;
  assert.equal(connections, 4); // orders + discountApplications + shippingLines + lineItems
  assert.ok(connections - 1 <= 5, "connections under the order");
  assert.match(query, /sortKey: CREATED_AT/);
  assert.match(query, /created_at:>=2026-01-01T00:00:00Z/);
});

test("query selects every order-side field Report 1 needs", () => {
  const query = buildOrdersBulkQuery(range);
  for (const field of [
    "name", "createdAt", "sourceName", "retailLocation", "paymentGatewayNames",
    "discountApplications", "shippingLines", "lineItems", "sku", "quantity", "originalUnitPriceSet",
    "discountAllocations", "taxLines", "barcode", "product { id }",
  ]) assert.ok(query.includes(field), `missing ${field}`);
});

test("query never selects staffMember (needs read_users, Plus/Advanced only)", () => {
  assert.ok(!buildOrdersBulkQuery(range).includes("staffMember"));
});

test("mutation requests grouped objects", () => {
  assert.match(RUN_BULK_QUERY_MUTATION, /groupObjects: true/);
});

const fakeAdmin = (payload) => ({ graphql: async () => ({ json: async () => payload }) });

test("startOrdersBulkOperation returns the created operation", async () => {
  const op = { id: "gid://shopify/BulkOperation/1", status: "CREATED" };
  const result = await startOrdersBulkOperation(fakeAdmin({ data: { bulkOperationRunQuery: { bulkOperation: op, userErrors: [] } } }), range);
  assert.deepEqual(result, op);
});

test("startOrdersBulkOperation surfaces Shopify userErrors", async () => {
  const admin = fakeAdmin({
    data: { bulkOperationRunQuery: { bulkOperation: null, userErrors: [{ code: "OPERATION_IN_PROGRESS", message: "busy", field: null }] } },
  });
  await assert.rejects(() => startOrdersBulkOperation(admin, range), /OPERATION_IN_PROGRESS: busy/);
});

test("startOrdersBulkOperation surfaces top-level GraphQL errors", async () => {
  await assert.rejects(() => startOrdersBulkOperation(fakeAdmin({ errors: [{ message: "Access denied" }] }), range), /Access denied/);
});
