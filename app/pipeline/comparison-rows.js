// Report 3 (Sales Comparison, Yearly): Total Sales of two periods side by side,
// grouped by collection and by location. The numbers are the General Sales
// Report's own ledger rows (ledgerOrderRows), so a period's total here equals
// that report's Total Sales column for the same dates and filters.
//
// Each order is read once and its events are counted into whichever period they
// fall in (events dated in neither period are ignored). Shipping has no collection:
// in the By Collection sheet it is shown on its own row, so both sheets add up to
// the same total.
import { getReport, resolveItem } from "../config/index.js";
import { difference } from "../calculations/index.js";
import { round2 } from "../calculations/money.js";
import { ledgerColumns, ledgerOrderRows } from "./ledger-rows.js";

export const NO_COLLECTION = "(No collection)";
export const SHIPPING_GROUP = "Shipping (no collection)";
export const NO_LOCATION = "(No location)";

// Shopify spells a location with a double space in places; show it tidily.
const tidy = (name) => String(name).replace(/\s+/g, " ").trim();

const emptyGroups = () => ({ byCollection: new Map(), byLocation: new Map() });

function add(groups, key, name, period, amount) {
  const entry = groups.get(key) ?? { name, previous: 0, current: 0 };
  entry[period] = round2(entry[period] + amount);
  groups.set(key, entry);
}

// periods: { current: { startMs, endMs }, previous: { startMs, endMs } }
// orders: async iterable from groupOrders(); agreementsByOrder: Map(orderId -> agreements[]).
// Returns { byCollection: Map, byLocation: Map } of { name, previous, current }.
export async function buildComparisonGroups(orders, agreementsByOrder, { periods, productIndex, mappings, keep = () => true }) {
  const columns = ledgerColumns();
  const groups = emptyGroups();
  for await (const order of orders) {
    const agreements = agreementsByOrder.get(order.id);
    for (const period of ["previous", "current"]) {
      const { startMs, endMs } = periods[period];
      for (const { values, meta } of ledgerOrderRows(order, agreements, { columns, productIndex, mappings, startMs, endMs, keep })) {
        const amount = values.totalSales ?? 0;
        const collection = meta.kind === "shipping" ? SHIPPING_GROUP : (meta.collectionName ?? NO_COLLECTION);
        add(groups.byCollection, collection, collection, period, amount);
        add(groups.byLocation, meta.locationId ?? "none", values.posLocation ? tidy(values.posLocation) : NO_LOCATION, period, amount);
      }
    }
  }
  return groups;
}

// "2025" for a period inside one year, otherwise its dates. When both periods
// would get the same heading, both use their dates.
export function periodLabels(previous, current) {
  const label = (p) => (p.from.slice(0, 4) === p.to.slice(0, 4) ? p.from.slice(0, 4) : `${p.from} to ${p.to}`);
  const dates = (p) => `${p.from} to ${p.to}`;
  const labels = { previous: label(previous), current: label(current) };
  return labels.previous === labels.current ? { previous: dates(previous), current: dates(current) } : labels;
}

// One row of a sheet: the figures of a group, with the difference worked out.
function figures({ previous, current }) {
  const { value, percent } = difference(current, previous);
  return { totalSalesPrevious: previous, totalSalesCurrent: current, difference: round2(value), differencePercent: percent === null ? null : percent / 100 };
}

// The sheets of the report from the config's sub-reports, headed with the periods' years.
// Returns { sheets: [{ name, columns, rows, footer }], totals } (rows sorted by name).
export function comparisonSheets(reportKey, groups, labels) {
  const sheets = [];
  const grandTotals = {};
  for (const sub of getReport(reportKey).subReports) {
    const columns = sub.columns.map(resolveItem).map(({ key, label, type, width, period }) => ({ key, label: period ? `${label} ${labels[period]}` : label, type, width }));
    const [nameColumn] = columns;
    // A group that netted to nothing in both periods says nothing, so it is left out (the totals are unchanged).
    const data = [...groups[sub.key].values()].filter((entry) => entry.previous !== 0 || entry.current !== 0).sort((a, b) => a.name.localeCompare(b.name));
    const rows = data.map((entry) => ({ [nameColumn.key]: entry.name, ...figures(entry) }));
    const total = data.reduce((sum, entry) => ({ previous: round2(sum.previous + entry.previous), current: round2(sum.current + entry.current) }), { previous: 0, current: 0 });
    sheets.push({ key: sub.key, name: sub.label, columns, rows, footer: { [nameColumn.key]: "Total", ...figures(total) } });
    grandTotals[sub.key] = total;
  }
  return { sheets, totals: grandTotals };
}
