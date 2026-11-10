// Report 5 (Quantity Report for SKU, Yearly): the quantity sold of every item in
// two periods. Quantities are the General Sales Report's Net Items Sold (its ledger
// rows), so a period's total here equals that report's Net Items Sold for the same
// dates and filters.
//
// Every item of the catalogue is listed, whether or not it sold. Items are told
// apart by variant (SKUs are not unique, so two variants can share a SKU and then
// appear on two rows, told apart by barcode). A product sold once and since deleted
// is listed from what its order lines say; a line with no catalogue item at all (a
// custom item) is added up on one row, so the totals still tie to the General Sales
// Report.
import { getReport, resolveItem } from "../config/index.js";
import { difference } from "../calculations/index.js";
import { ledgerColumns, ledgerOrderRows } from "./ledger-rows.js";

export const CUSTOM_ITEMS = "(items with no SKU or product)";

const entryOf = (map, key, init) => {
  if (!map.has(key)) map.set(key, { ...init, previous: 0, current: 0, sold: false });
  return map.get(key);
};

// periods: { previous: { startMs, endMs }, current: { startMs, endMs } }
// collections: collection names to list (empty = every collection)
// Returns { entries: Map, stats }.
export async function buildSkuQuantities(orders, agreementsByOrder, { periods, productIndex, mappings, keep = () => true, collections = [] }) {
  const columns = ledgerColumns();
  const entries = new Map();
  const wanted = new Set(collections);

  // The catalogue first: every variant is listed even if nothing was sold.
  for (const [variantId, variant] of productIndex.byVariantId) {
    const product = productIndex.byProductId.get(variant.productId);
    const collectionName = product?.collectionName ?? null;
    if (wanted.size && !wanted.has(collectionName)) continue;
    entryOf(entries, variantId, { sku: variant.sku, barcode: variant.barcode, collectionName });
  }
  const catalogue = entries.size;

  let customQuantity = 0;
  for await (const order of orders) {
    const agreements = agreementsByOrder.get(order.id);
    for (const period of ["previous", "current"]) {
      const { startMs, endMs } = periods[period];
      for (const { values, meta } of ledgerOrderRows(order, agreements, { columns, productIndex, mappings, startMs, endMs, keep })) {
        if (meta.kind !== "line") continue;
        const quantity = values.netItemsSold ?? 0;
        if (!meta.variantId) {
          customQuantity += quantity;
          entryOf(entries, CUSTOM_ITEMS, { sku: CUSTOM_ITEMS, barcode: null, collectionName: null })[period] += quantity;
          entries.get(CUSTOM_ITEMS).sold = true;
          continue;
        }
        // A variant that is no longer in the catalogue is listed from the order line.
        const entry = entryOf(entries, meta.variantId, { sku: values.sku, barcode: values.barcode, collectionName: meta.collectionName });
        entry[period] += quantity;
        entry.sold = true;
      }
    }
  }

  const listed = [...entries.values()];
  const skuCount = new Map();
  for (const entry of listed) if (entry.sku && entry.sku !== CUSTOM_ITEMS) skuCount.set(entry.sku, (skuCount.get(entry.sku) ?? 0) + 1);
  return {
    entries,
    stats: {
      listed: listed.length,
      catalogue,
      withSales: listed.filter((entry) => entry.sold && (entry.previous !== 0 || entry.current !== 0)).length,
      sharedSkus: [...skuCount.values()].filter((n) => n > 1).length,
      customQuantity,
    },
  };
}

const sortKey = (entry) => (entry.sku ? entry.sku : "￿");

// Sheet columns (headed with the periods' years) and rows from the config's columns.
export function skuQuantitySheet(reportKey, entries, labels) {
  const columns = getReport(reportKey).columns.map(resolveItem).map(({ key, label, type, width, period }) => ({ key, label: period ? `${label} ${labels[period]}` : label, type, width }));
  const figures = ({ previous, current }) => {
    const { value, percent } = difference(current, previous);
    return { quantityPrevious: previous, quantityCurrent: current, difference: value, differencePercent: percent === null ? null : percent / 100 };
  };
  const rows = [...entries.values()]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.barcode ?? "").localeCompare(b.barcode ?? ""))
    .map((entry) => ({ sku: entry.sku, barcode: entry.barcode, ...figures(entry) }));
  const total = [...entries.values()].reduce((sum, entry) => ({ previous: sum.previous + entry.previous, current: sum.current + entry.current }), { previous: 0, current: 0 });
  return { columns, rows, footer: { sku: "Total", ...figures(total) }, total };
}
