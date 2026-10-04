import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadBulkFile, groupOrders, groupProducts, readJsonl, verifyOrdersFile, verifyProductsFile } from "../app/pipeline/bulk-file.js";

const O1 = "gid://shopify/Order/1";
const O2 = "gid://shopify/Order/2";
const toJsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

// Shape taken from the real client-store export: flat lines, children right
// after their parent, discount applications without an id, returns nesting
// returnLineItems, and inlined `refunds` / `retailLocation`.
const ORDER_LINES = [
  { id: O1, name: "#1", createdAt: "2026-08-01T00:00:00Z", sourceName: "pos", retailLocation: { id: "gid://shopify/Location/9", name: "Al Ain" }, refunds: [{ id: "gid://shopify/Refund/5" }] },
  { __typename: "DiscountCodeApplication", code: "SAVE", allocationMethod: "ACROSS", __parentId: O1 },
  { id: "gid://shopify/LineItem/11", sku: "A", quantity: 2, __parentId: O1 },
  { id: "gid://shopify/LineItem/12", sku: "B", quantity: 1, __parentId: O1 },
  { id: "gid://shopify/Return/21", status: "CLOSED", __parentId: O1 },
  { id: "gid://shopify/ReturnLineItem/31", quantity: 1, __parentId: "gid://shopify/Return/21" },
  { id: O2, name: "#2", createdAt: "2026-08-02T00:00:00Z", sourceName: "web", retailLocation: null, refunds: [] },
  { id: "gid://shopify/LineItem/13", sku: "C", quantity: 1, __parentId: O2 },
];

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

describe("groupOrders", () => {
  test("attaches children to the right order and nests return line items under their return", async () => {
    const [first, second] = await collect(groupOrders(ORDER_LINES));
    assert.equal(first.id, O1);
    assert.deepEqual(first.lineItems.map((l) => l.sku), ["A", "B"]);
    assert.equal(first.discountApplications[0].code, "SAVE");
    assert.equal(first.returns.length, 1);
    assert.equal(first.returns[0].returnLineItems[0].id, "gid://shopify/ReturnLineItem/31");
    assert.equal(first.retailLocation.name, "Al Ain");
    assert.deepEqual(first.refunds, [{ id: "gid://shopify/Refund/5" }]);
    assert.deepEqual(second.lineItems.map((l) => l.sku), ["C"]);
  });

  test("every order has the child arrays, even when empty; __parentId is stripped", async () => {
    const [, second] = await collect(groupOrders(ORDER_LINES));
    assert.deepEqual(second.discountApplications, []);
    assert.deepEqual(second.returns, []);
    assert.ok(!("__parentId" in second.lineItems[0]));
  });

  test("an order with no children still comes out", async () => {
    const [only] = await collect(groupOrders([{ id: O1, name: "#1" }]));
    assert.deepEqual(only.lineItems, []);
  });

  test("empty input yields nothing", async () => {
    assert.deepEqual(await collect(groupOrders([])), []);
  });

  test("a child whose parent is not in the current group throws instead of dropping data", async () => {
    const broken = [{ id: O1 }, { id: O2 }, { id: "gid://shopify/LineItem/99", __parentId: O1 }];
    await assert.rejects(collect(groupOrders(broken)), /Orphan bulk line/);
  });

  test("all discount application types are recognised (code, manual, automatic)", async () => {
    const lines = [{ id: O1 }, ...["DiscountCodeApplication", "ManualDiscountApplication", "AutomaticDiscountApplication"].map((t) => ({ __typename: t, __parentId: O1 }))];
    const [order] = await collect(groupOrders(lines));
    assert.equal(order.discountApplications.length, 3);
  });

  test("an unrecognised child type throws", async () => {
    await assert.rejects(collect(groupOrders([{ id: O1 }, { id: "gid://shopify/Mystery/1", __parentId: O1 }])), /Unexpected order child/);
  });
});

describe("groupProducts", () => {
  test("attaches collections and variants", async () => {
    const P = "gid://shopify/Product/1";
    const [product] = await collect(
      groupProducts([
        { id: P, title: "Shirt", tags: ["AIS"] },
        { id: "gid://shopify/Collection/3", title: "Boys", __parentId: P },
        { id: "gid://shopify/ProductVariant/7", sku: "X", __parentId: P },
        { id: "gid://shopify/ProductVariant/8", sku: "X", __parentId: P },
      ]),
    );
    assert.equal(product.collections.length, 1);
    assert.deepEqual(product.variants.map((v) => v.id), ["gid://shopify/ProductVariant/7", "gid://shopify/ProductVariant/8"]);
  });

  test("a product with no collection is kept", async () => {
    const [product] = await collect(groupProducts([{ id: "gid://shopify/Product/2" }]));
    assert.deepEqual(product.collections, []);
  });
});

describe("files", () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "bulk-file-test-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("downloadBulkFile streams the body to disk", async () => {
    const dest = join(dir, "nested", "orders.jsonl");
    const body = toJsonl(ORDER_LINES);
    const result = await downloadBulkFile("https://example.test/file", dest, async () => new Response(body));
    assert.equal(await readFile(dest, "utf8"), body);
    assert.equal(result.bytes, Buffer.byteLength(body));
  });

  test("a missing URL (completed with no results) writes an empty file", async () => {
    const dest = join(dir, "empty.jsonl");
    const result = await downloadBulkFile(null, dest);
    assert.equal(result.empty, true);
    assert.equal(await readFile(dest, "utf8"), "");
    assert.deepEqual(await verifyOrdersFile(dest), { orders: 0, lineItems: 0, returns: 0, returnLineItems: 0, discountApplications: 0 });
  });

  test("a failed download throws", async () => {
    await assert.rejects(downloadBulkFile("https://example.test/x", join(dir, "x.jsonl"), async () => new Response("no", { status: 403 })), /HTTP 403/);
  });

  test("verifyOrdersFile counts what is in the file", async () => {
    const file = join(dir, "orders.jsonl");
    await writeFile(file, toJsonl(ORDER_LINES));
    assert.deepEqual(await verifyOrdersFile(file), { orders: 2, lineItems: 3, returns: 1, returnLineItems: 1, discountApplications: 1 });
  });

  test("verifyProductsFile counts products, variants and collections", async () => {
    const file = join(dir, "products.jsonl");
    await writeFile(file, toJsonl([{ id: "gid://shopify/Product/1" }, { id: "gid://shopify/ProductVariant/2", __parentId: "gid://shopify/Product/1" }]));
    assert.deepEqual(await verifyProductsFile(file), { products: 1, variants: 1, collections: 0 });
  });

  test("invalid JSON reports the line number", async () => {
    const file = join(dir, "bad.jsonl");
    await writeFile(file, '{"id":1}\n{nope\n');
    await assert.rejects(collect(readJsonl(file)), /line 2/);
  });

  test("handles a large file without holding it all in memory (50,000 orders)", async () => {
    const file = join(dir, "big.jsonl");
    const lines = [];
    for (let i = 0; i < 50000; i++) {
      lines.push({ id: `gid://shopify/Order/${i}`, name: `#${i}` });
      lines.push({ id: `gid://shopify/LineItem/${i}`, sku: "S", quantity: 1, __parentId: `gid://shopify/Order/${i}` });
    }
    await writeFile(file, toJsonl(lines));
    const stats = await verifyOrdersFile(file);
    assert.equal(stats.orders, 50000);
    assert.equal(stats.lineItems, 50000);
  });
});
