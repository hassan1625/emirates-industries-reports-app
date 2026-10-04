// Dev-only report preview (testing aid, NOT a product feature: the plan has no
// in-app dashboards). Folds the Report 1 row stream into totals and a few
// groupings so numbers can be compared with Shopify before the XLSX download
// exists (Milestone 5). Remove with the debug page before production.
import { groupOrders, readJsonl } from "./bulk-file.js";
import { loadProductIndex } from "./join.js";
import { buildGeneralSalesRows } from "./report-rows.js";
import { loadMappings } from "./location-mapping.js";
import { STORE_TIME_ZONE } from "../config/store.js";

// Money is accumulated in whole cents so thousands of additions do not drift.
const cents = (value) => Math.round((value ?? 0) * 100);
const money = (c) => Math.round(c) / 100;

const emptyTotals = () => ({ orders: 0, lineRows: 0, shippingRows: 0, itemsSold: 0, gross: 0, discounts: 0, net: 0, shipping: 0, taxes: 0, total: 0 });

function addToTotals(t, row) {
  const v = row.values;
  if (row.meta.kind === "line") t.lineRows += 1;
  else t.shippingRows += 1;
  t.itemsSold += v.netItemsSold ?? 0;
  t.gross += cents(v.grossSales);
  t.discounts += cents(v.discounts);
  t.net += cents(v.netSales);
  t.shipping += cents(v.shippingCharges);
  t.taxes += cents(v.taxes);
  t.total += cents(v.totalSales);
}

// Turns accumulated cents into display numbers. Returns = Gross + Discounts -
// Net (discounts are negative), the "Net = Gross - Discounts - Returns" rule.
function finish(t) {
  return {
    orders: t.orders,
    lineRows: t.lineRows,
    shippingRows: t.shippingRows,
    itemsSold: t.itemsSold,
    gross: money(t.gross),
    discounts: money(t.discounts),
    returns: money(t.gross + t.discounts - t.net),
    net: money(t.net),
    shipping: money(t.shipping),
    taxes: money(t.taxes),
    total: money(t.total),
  };
}

export function createPreviewAccumulator({ sampleSize = 50, timeZone = STORE_TIME_ZONE } = {}) {
  const overall = emptyTotals();
  const groups = { byMonth: new Map(), byDay: new Map(), byLocation: new Map(), byChannel: new Map(), byCollection: new Map() };
  const sample = [];
  let lastOrderId = null;

  const slot = (map, key) => {
    if (!map.has(key)) map.set(key, emptyTotals());
    return map.get(key);
  };

  return {
    add(row) {
      const { values, meta } = row;
      const isNewOrder = meta.orderId !== lastOrderId;
      lastOrderId = meta.orderId;

      const day = (values.orderDate ?? "unknown").slice(0, 10);
      const orderLevel = [
        [groups.byMonth, day.slice(0, 7)],
        [groups.byDay, day],
        [groups.byLocation, values.posLocation ?? "(no location)"],
        [groups.byChannel, values.salesChannel ?? "(no channel)"],
      ];
      // Collection is line-level, so it counts rows, not orders.
      const lineLevel = [[groups.byCollection, meta.kind === "shipping" ? "(shipping rows)" : values.collectionName ?? "(no collection)"]];

      addToTotals(overall, row);
      if (isNewOrder) overall.orders += 1;
      for (const [map, key] of orderLevel) {
        const t = slot(map, key);
        addToTotals(t, row);
        if (isNewOrder) t.orders += 1;
      }
      for (const [map, key] of lineLevel) addToTotals(slot(map, key), row);

      if (sample.length < sampleSize) sample.push(values);
    },

    result() {
      const table = (map, sortBy) => {
        const rows = [...map.entries()].map(([key, t]) => ({ key, ...finish(t) }));
        return sortBy === "key" ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.total - a.total);
      };
      return {
        timeZone,
        totals: finish(overall),
        byMonth: table(groups.byMonth, "key"),
        byDay: table(groups.byDay, "key"),
        byLocation: table(groups.byLocation),
        byChannel: table(groups.byChannel),
        byCollection: table(groups.byCollection),
        sample,
      };
    },
  };
}

// Runs the whole row pipeline over a DATA_READY job's files and summarizes it.
export async function previewJob({ db, job, sampleSize }) {
  if (!job.ordersFile || !job.productsFile) throw new Error("Job has no downloaded files; it must be DATA_READY");
  const productIndex = await loadProductIndex(job.productsFile);
  const mappings = await loadMappings(db, job.shop);
  const accumulator = createPreviewAccumulator({ sampleSize });
  for await (const row of buildGeneralSalesRows(groupOrders(readJsonl(job.ordersFile)), { productIndex, mappings })) accumulator.add(row);
  return accumulator.result();
}
