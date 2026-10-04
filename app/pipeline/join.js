// Product -> collection join (Dev Plan Step 19).
//
// The products export gives each product its collection(s); an order line
// points at its product through `product.id`. Per the confirmed business rule
// every product sits in exactly ONE collection, so this is a plain lookup with
// no de-duplication logic. Facts verified on the client store:
//   * 773 of 775 products have exactly one collection; 2 have none (their
//     Collection Name stays blank until the client assigns one);
//   * no product has two or more collections. If that ever changes, the first
//     collection in Shopify's order wins and the product is counted in
//     stats.productsWithSeveralCollections so it is visible, not silent;
//   * order lines can point at products that no longer exist (deleted
//     products) or have no product at all (custom/POS items). They are
//     reported with a blank Collection Name and counted separately;
//   * SKUs are NOT unique (37 are shared between variants), so everything is
//     keyed by product id / variant id, never by SKU.
import { groupProducts, readJsonl } from "./bulk-file.js";

// Loads the products export into lookup maps. Streams the file, so it is safe
// for large catalogues; only the small per-product records are kept.
export async function loadProductIndex(productsFile) {
  const byProductId = new Map();
  const byVariantId = new Map();
  const stats = { products: 0, variants: 0, productsWithoutCollection: 0, productsWithSeveralCollections: 0, variantsWithoutSku: 0 };

  for await (const product of groupProducts(readJsonl(productsFile))) {
    stats.products += 1;
    const collections = product.collections ?? [];
    if (collections.length === 0) stats.productsWithoutCollection += 1;
    if (collections.length > 1) stats.productsWithSeveralCollections += 1;

    const record = {
      id: product.id,
      title: product.title ?? null,
      status: product.status ?? null,
      tags: product.tags ?? [],
      collectionId: collections[0]?.id ?? null,
      collectionName: collections[0]?.title ?? null,
    };
    byProductId.set(product.id, record);

    for (const variant of product.variants ?? []) {
      stats.variants += 1;
      if (!variant.sku) stats.variantsWithoutSku += 1;
      byVariantId.set(variant.id, { id: variant.id, productId: product.id, sku: variant.sku ?? null, barcode: variant.barcode ?? null, title: variant.title ?? null, price: variant.price ?? null });
    }
  }
  return { byProductId, byVariantId, stats };
}

// Why a line has the collection it has. `collectionName` is null for every
// reason except "found".
export function lookupCollection(line, index) {
  const productId = line.product?.id;
  if (!productId) return { collectionName: null, reason: "no-product" };
  const product = index.byProductId.get(productId);
  if (!product) return { collectionName: null, reason: "product-not-found" };
  if (!product.collectionName) return { collectionName: null, reason: "no-collection" };
  return { collectionName: product.collectionName, reason: "found" };
}

// Yields each order with `collectionName` set on every line item. Returns new
// objects (the input is left untouched) so a file can be joined more than once.
export async function* joinCollections(orders, index) {
  for await (const order of orders) {
    yield {
      ...order,
      lineItems: order.lineItems.map((line) => ({ ...line, collectionName: lookupCollection(line, index).collectionName })),
    };
  }
}

// Counts how the lines of a stream of orders resolved. No names are returned.
export async function summarizeCollectionJoin(orders, index) {
  const stats = { orders: 0, lines: 0, found: 0, noProduct: 0, productNotFound: 0, noCollection: 0, distinctCollections: new Set() };
  for await (const order of orders) {
    stats.orders += 1;
    for (const line of order.lineItems) {
      stats.lines += 1;
      const { collectionName, reason } = lookupCollection(line, index);
      if (reason === "found") {
        stats.found += 1;
        stats.distinctCollections.add(collectionName);
      } else if (reason === "no-product") stats.noProduct += 1;
      else if (reason === "product-not-found") stats.productNotFound += 1;
      else stats.noCollection += 1;
    }
  }
  return { ...stats, distinctCollections: stats.distinctCollections.size };
}
