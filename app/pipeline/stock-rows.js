// Stock Report by Location rows: one row per item that has a stock level at a
// chosen location (at every location when none is chosen), built from the inventory export joined to the products export
// (by variant id; SKUs are not unique). Each row carries the three native Shopify
// quantities: committed, available and on hand (negative available stock, an
// oversold item, is shown as it is).
//
// A level that is zero in all three quantities usually means the item is not kept
// at the location (about 78% of all levels on the client store). They are listed
// by default; the request can ask to hide them.
import { getReport, getReportFields } from "../config/index.js";
import { groupInventory, readJsonl } from "./bulk-file.js";
import { loadProductIndex } from "./join.js";

const REPORT = "stockByLocation";

// The sheet's columns. The Location Name column only appears when the report
// covers more than one location; with exactly one, its name is a header line.
export const stockColumns = ({ withLocation = false } = {}) =>
  getReportFields(REPORT)
    .filter((field) => withLocation || !field.severalLocationsOnly)
    .map(({ key, label, type, width }) => ({ key, label, type, width }));

// The available quantity at or below which a row is highlighted (from the config).
export const lowStockThreshold = () => getReport(REPORT).formatting.find((rule) => rule.key === "lowStock").value;

// The three quantities of a level as numbers.
export function levelQuantities(level) {
  const byName = Object.fromEntries((level.quantities ?? []).map(({ name, quantity }) => [name, Number(quantity) || 0]));
  return { committed: byName.committed ?? 0, available: byName.available ?? 0, onHand: byName.on_hand ?? 0 };
}

const compare = (a, b) => (a ?? "").localeCompare(b ?? "");
// Shopify spells one location with a double space; show it tidily.
const tidy = (name) => String(name ?? "").replace(/\s+/g, " ").trim();

// options: { locationIds?: string[] (empty or missing = every location), collections?: string[], tags?: string[], hideZero?: boolean }
// Returns { rows, locationNames, stats }; rows are objects keyed by column key
// (including locationName) and `locationNames` lists the locations that have rows.
export async function buildStockRows({ inventoryFile, productsFile }, { locationIds = [], collections = [], tags = [], hideZero = false }) {
  const index = await loadProductIndex(productsFile);
  const wantedLocations = new Set(locationIds);
  const wantedCollections = new Set(collections);
  const wantedTags = new Set(tags);
  const stats = { itemsSeen: 0, itemsAtLocation: 0, noVariant: 0, hiddenNoStock: 0, filteredOut: 0, listed: 0, low: 0, inactiveRows: 0, inactiveOnHand: 0 };
  const locationNames = new Set();
  const rows = [];
  const threshold = lowStockThreshold();

  for await (const item of groupInventory(readJsonl(inventoryFile))) {
    stats.itemsSeen += 1;
    const variant = index.byVariantId.get(item.variant?.id);
    const product = variant ? index.byProductId.get(variant.productId) : null;

    for (const level of item.levels) {
      if (wantedLocations.size && !wantedLocations.has(level.location?.id)) continue;
      stats.itemsAtLocation += 1; // stock levels at the chosen locations
      if (!variant || !product) {
        stats.noVariant += 1; // an item whose product was deleted: it cannot be named
        continue;
      }
      const quantities = levelQuantities(level);
      if (wantedCollections.size && !wantedCollections.has(product.collectionName)) {
        stats.filteredOut += 1;
        continue;
      }
      if (wantedTags.size && !product.tags.some((tag) => wantedTags.has(tag))) {
        stats.filteredOut += 1;
        continue;
      }
      // Counted after the collection and tag filters, so the report can say how many of ITS records were left out.
      if (hideZero && quantities.committed === 0 && quantities.available === 0 && quantities.onHand === 0) {
        stats.hiddenNoStock += 1;
        continue;
      }
      if (quantities.available <= threshold) stats.low += 1;
      if (level.isActive === false) {
        stats.inactiveRows += 1; // stock held at a location where the item is deactivated
        stats.inactiveOnHand += quantities.onHand;
      }
      const locationName = tidy(level.location?.name);
      locationNames.add(locationName);
      rows.push({
        locationName,
        collectionName: product.collectionName,
        productName: product.title,
        sku: variant.sku,
        barcode: variant.barcode,
        stockCommitted: quantities.committed,
        stockAvailable: quantities.available,
        stockOnHand: quantities.onHand,
      });
    }
  }

  rows.sort((a, b) => compare(a.locationName, b.locationName) || compare(a.collectionName, b.collectionName) || compare(a.productName, b.productName) || compare(a.sku, b.sku));
  stats.listed = rows.length;
  return { rows, locationNames: [...locationNames].sort(compare), stats };
}

export function summarizeStock(rows) {
  const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  const threshold = lowStockThreshold();
  return {
    items: rows.length,
    low: rows.filter((row) => row.stockAvailable <= threshold).length,
    negative: rows.filter((row) => row.stockAvailable < 0).length,
    committed: total("stockCommitted"),
    available: total("stockAvailable"),
    onHand: total("stockOnHand"),
  };
}
