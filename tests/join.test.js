import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProductIndex, lookupCollection, joinCollections, summarizeCollectionJoin } from "../app/pipeline/join.js";

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const C = (n) => `gid://shopify/Collection/${n}`;
const toJsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

// Flat bulk lines, as in the real products export.
const PRODUCT_LINES = [
  { id: P(1), title: "Boys Trouser", status: "ACTIVE", tags: ["AIS"] },
  { id: C(10), title: "Boys Uniforms", __parentId: P(1) },
  { id: V(11), sku: "TR-1", barcode: "111", title: "S", price: "10.00", __parentId: P(1) },
  { id: V(12), sku: "DUP", barcode: null, title: "M", price: "10.00", __parentId: P(1) },
  { id: P(2), title: "Girls Skirt", status: "ACTIVE", tags: [] },
  { id: C(20), title: "Girls Uniforms", __parentId: P(2) },
  { id: V(21), sku: "DUP", barcode: "222", title: "S", price: "12.00", __parentId: P(2) }, // same SKU as V(12)
  { id: P(3), title: "Loose Item", status: "DRAFT", tags: [] }, // no collection
  { id: V(31), sku: null, barcode: null, title: "Default", price: "1.00", __parentId: P(3) },
  { id: P(4), title: "Two Collections", status: "ACTIVE", tags: [] },
  { id: C(40), title: "First", __parentId: P(4) },
  { id: C(41), title: "Second", __parentId: P(4) },
];

describe("loadProductIndex", () => {
  let dir, file, index;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "join-test-"));
    file = join(dir, "products.jsonl");
    await writeFile(file, toJsonl(PRODUCT_LINES));
    index = await loadProductIndex(file);
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("indexes products with their single collection", () => {
    const product = index.byProductId.get(P(1));
    assert.equal(product.collectionName, "Boys Uniforms");
    assert.equal(product.collectionId, C(10));
    assert.deepEqual(product.tags, ["AIS"]);
    assert.equal(product.status, "ACTIVE");
  });

  test("a product with no collection has a null collection (not an error)", () => {
    assert.equal(index.byProductId.get(P(3)).collectionName, null);
  });

  test("with several collections the first wins and the product is counted", () => {
    assert.equal(index.byProductId.get(P(4)).collectionName, "First");
    assert.equal(index.stats.productsWithSeveralCollections, 1);
  });

  test("variants are keyed by id, so duplicate SKUs stay distinct", () => {
    assert.equal(index.byVariantId.get(V(12)).productId, P(1));
    assert.equal(index.byVariantId.get(V(21)).productId, P(2));
    assert.equal(index.byVariantId.get(V(12)).sku, index.byVariantId.get(V(21)).sku);
    assert.equal(index.byVariantId.size, 4);
  });

  test("stats", () => {
    assert.deepEqual(index.stats, { products: 4, variants: 4, productsWithoutCollection: 1, productsWithSeveralCollections: 1, variantsWithoutSku: 1 });
  });

  test("an empty products file gives an empty index", async () => {
    const empty = join(dir, "empty.jsonl");
    await writeFile(empty, "");
    const result = await loadProductIndex(empty);
    assert.equal(result.byProductId.size, 0);
  });

  describe("lookupCollection", () => {
    test("found", () => assert.deepEqual(lookupCollection({ product: { id: P(2) } }, index), { collectionName: "Girls Uniforms", reason: "found" }));
    test("product has no collection", () => assert.deepEqual(lookupCollection({ product: { id: P(3) } }, index), { collectionName: null, reason: "no-collection" }));
    test("product deleted since the sale", () => assert.deepEqual(lookupCollection({ product: { id: P(999) } }, index), { collectionName: null, reason: "product-not-found" }));
    test("line without a product (custom item)", () => {
      assert.deepEqual(lookupCollection({ product: null }, index), { collectionName: null, reason: "no-product" });
      assert.deepEqual(lookupCollection({}, index), { collectionName: null, reason: "no-product" });
    });
  });

  describe("joinCollections", () => {
    async function* orders() {
      yield { id: "O1", lineItems: [{ id: "L1", product: { id: P(1) } }, { id: "L2", product: { id: P(3) } }, { id: "L3", product: null }] };
      yield { id: "O2", lineItems: [] };
    }
    const collect = async (iterable) => {
      const out = [];
      for await (const x of iterable) out.push(x);
      return out;
    };

    test("sets collectionName on every line", async () => {
      const [first, second] = await collect(joinCollections(orders(), index));
      assert.deepEqual(first.lineItems.map((l) => l.collectionName), ["Boys Uniforms", null, null]);
      assert.deepEqual(second.lineItems, []);
    });

    test("does not mutate its input", async () => {
      const original = { id: "O1", lineItems: [{ id: "L1", product: { id: P(1) } }] };
      async function* one() {
        yield original;
      }
      await collect(joinCollections(one(), index));
      assert.ok(!("collectionName" in original.lineItems[0]));
    });

    test("summarizeCollectionJoin counts every outcome", async () => {
      const stats = await summarizeCollectionJoin(orders(), index);
      assert.deepEqual(stats, { orders: 2, lines: 3, found: 1, noProduct: 1, productNotFound: 0, noCollection: 1, distinctCollections: 1 });
    });
  });
});
