// Report 4 (Total Sales Report by Date Range): Total Sales of one period as a
// matrix, collections down the side and locations across the top, with row totals,
// column totals and a grand total. The numbers are the General Sales Report's own
// ledger rows (the same Total Sales as Report 3), so the grand total equals that
// report's Total Sales for the same dates.
//
// Collections and locations are not listed anywhere: the matrix has a row for every
// collection and a column for every location that had a sale in the period.
// Shipping belongs to no collection and has its own row, so the location columns
// add up to the same total as the rows.
import { getReport, resolveItem } from "../config/index.js";
import { round2 } from "../calculations/money.js";
import { ledgerColumns, ledgerOrderRows } from "./ledger-rows.js";
import { NO_COLLECTION, NO_LOCATION, SHIPPING_GROUP } from "./comparison-rows.js";

// Shopify spells a location with a double space in places; show it tidily.
const tidy = (name) => String(name).replace(/\s+/g, " ").trim();

// range: { startMs, endMs }. Returns { collections: Map(key -> name), locations: Map(key -> name), cells: Map("collectionKey\u0000locationKey" -> amount) }.
export async function buildSalesMatrix(orders, agreementsByOrder, { range, productIndex, mappings, keep = () => true }) {
  const columns = ledgerColumns();
  const collections = new Map();
  const locations = new Map();
  const cells = new Map();
  for await (const order of orders) {
    for (const { values, meta } of ledgerOrderRows(order, agreementsByOrder.get(order.id), { columns, productIndex, mappings, startMs: range.startMs, endMs: range.endMs, keep })) {
      const collection = meta.kind === "shipping" ? SHIPPING_GROUP : (meta.collectionName ?? NO_COLLECTION);
      const locationKey = meta.locationId ?? "none";
      collections.set(collection, collection);
      if (!locations.has(locationKey)) locations.set(locationKey, values.posLocation ? tidy(values.posLocation) : NO_LOCATION);
      const key = `${collection}\u0000${locationKey}`;
      cells.set(key, round2((cells.get(key) ?? 0) + (values.totalSales ?? 0)));
    }
  }
  return { collections, locations, cells };
}

// Names in order, the ones for "nothing to attribute it to" at the end.
const ordered = (entries, last) => [...entries].sort(([, a], [, b]) => (last.includes(a) - last.includes(b)) || a.localeCompare(b));

// The matrix as the sheet needs it: headings from the config, a row per collection, a
// column per location, the totals, and the grand total.
export function matrixSheet(reportKey, { collections, locations, cells }) {
  const { matrix } = getReport(reportKey);
  const rowHeading = resolveItem(matrix.rows).label;
  const columnHeading = resolveItem(matrix.columns).label;
  const rowKeys = ordered(collections.entries(), [NO_COLLECTION, SHIPPING_GROUP]);
  const columnKeys = ordered(locations.entries(), [NO_LOCATION]);
  const rows = rowKeys.map(([key, name]) => {
    const values = columnKeys.map(([locationKey]) => cells.get(`${key}\u0000${locationKey}`) ?? 0);
    return { label: name, values, total: round2(values.reduce((a, b) => a + b, 0)) };
  });
  const columnTotals = columnKeys.map((_, i) => round2(rows.reduce((sum, row) => sum + row.values[i], 0)));
  const grandTotal = round2(columnTotals.reduce((a, b) => a + b, 0));
  return {
    rowHeading,
    columnHeading,
    columns: columnKeys.map(([, name]) => name),
    rows,
    footer: { label: "Total", values: columnTotals, total: grandTotal },
    grandTotal,
    shipping: rows.find((row) => row.label === SHIPPING_GROUP)?.total ?? 0,
  };
}
