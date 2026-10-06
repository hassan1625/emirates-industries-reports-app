// Report 1 rows built from the dated sales events (the "ledger") instead of the
// order's current state. Every row is something that HAPPENED on a day:
//   * Order Type "Order": items sold (or exchange replacements) and shipping;
//   * Order Type "Reversal": items returned, with negative quantity and amounts,
//     dated on the day of the return or exchange, with the Return Reason.
// Summing Net, Taxes and Total over the rows of a period equals Shopify's own
// Sales report for that period (checked to the cent for September 2026).
//
// Amount semantics (verified against the Dashboard): a sale's totalAmount is the
// customer-facing amount INCLUDING VAT and AFTER discounts, so
//   Net Sales = totalAmount - totalTaxAmount          (ex VAT, after discounts)
//   Discounts = -totalDiscountAmountBeforeTaxes       (ex VAT, shown negative)
//   Gross     = Net + Discounts-as-positive           (ex VAT, before discounts)
// On a reversal every figure is the mirror image (negative Net/Gross/Taxes/
// Total, positive Discounts).
//
// This is the prototype of the rebuilt Report 1 (sample for client approval).
// The columns are the Report 1 config plus Order Type and Is Shipping Charges.
import { getReportFields } from "../config/index.js";
import { SALES_CHANNEL_NAMES, STORE_TIME_ZONE } from "../config/store.js";
import { round2 } from "../calculations/money.js";
import { unitPriceBeforeVat } from "../calculations/sales.js";
import { buildDiscountIndex, discountCodeOrReason } from "./discounts.js";
import { lookupCollection } from "./join.js";
import { resolveOrderLocation } from "./location-mapping.js";
import { formatStoreDate, salesChannelName } from "./report-rows.js";

const REPORT = "generalSales";
export const ORDER_TYPES = Object.freeze({ order: "Order", reversal: "Reversal" });
export const ADJUSTMENT_TITLE = "Exchange adjustment (credit kept)";

const amount = (set) => Number(set?.shopMoney?.amount ?? 0);
const clean = (value) => (value === 0 ? 0 : value); // no -0 in sheets

// The sheet's columns: the config's fields (POS Staff switched on) with the two
// new columns placed next to the ones they belong with.
export function ledgerColumns() {
  const columns = [];
  for (const field of getReportFields(REPORT)) {
    const { key, label, type, width } = field;
    columns.push({ key, label, type, width });
    if (key === "orderDate") columns.push({ key: "orderType", label: "Order Type", type: "string", width: 12 });
    if (key === "shippingCharges") columns.push({ key: "isShippingCharges", label: "Is Shipping Charges", type: "string", width: 20 });
  }
  return columns;
}

const emptyValues = (columns) => Object.fromEntries(columns.map((column) => [column.key, null]));

// One agreement's sales, merged per (action, line): a line can carry several
// sales inside one event.
function mergeSales(agreement) {
  const merged = new Map();
  for (const sale of agreement.sales ?? []) {
    const lineId = sale.lineItem?.id ?? sale.shippingLine?.id ?? null;
    const key = `${sale.actionType}|${sale.lineType}|${lineId}`;
    const entry = merged.get(key) ?? { actionType: sale.actionType, lineType: sale.lineType, lineId, quantity: 0, total: 0, tax: 0, discountBefore: 0 };
    entry.quantity += sale.quantity ?? 0;
    entry.total += amount(sale.totalAmount);
    entry.tax += amount(sale.totalTaxAmount);
    entry.discountBefore += amount(sale.totalDiscountAmountBeforeTaxes);
    merged.set(key, entry);
  }
  return [...merged.values()];
}

// Return reasons for one line in one return event.
function reasonFor(order, returnId, lineId) {
  const reasons = [];
  for (const ret of order.returns ?? []) {
    if (returnId && ret.id !== returnId) continue;
    for (const returnLine of ret.returnLineItems ?? []) {
      if (returnLine.fulfillmentLineItem?.lineItem?.id !== lineId) continue;
      const name = returnLine.returnReasonDefinition?.name;
      if (name && !reasons.includes(name)) reasons.push(name);
    }
  }
  return reasons.length ? reasons.join("; ") : null;
}

// Money columns of one sale. `net` and the rest keep the sale's own sign.
export function saleFigures({ total, tax, discountBefore }) {
  const net = round2(total - tax);
  const discount = round2(discountBefore);
  return { net, taxes: round2(tax), total: round2(total), grossSales: round2(net + discount), discounts: clean(-discount) };
}

// Rows of one order for the events inside [startMs, endMs].
// `order` comes from groupOrders(); `agreements` from groupAgreementOrders().
export function ledgerOrderRows(order, agreements, { columns, productIndex, mappings, staffByOrder, startMs, endMs, timeZone = STORE_TIME_ZONE, channelNames = SALES_CHANNEL_NAMES, discountOptions }) {
  const location = resolveOrderLocation(order, mappings);
  const discountIndex = buildDiscountIndex(order);
  const linesById = new Map(order.lineItems.map((line) => [line.id, line]));
  const staff = staffByOrder?.get(order.name) ?? null;
  const paymentMethod = (order.paymentGatewayNames ?? []).join(", ") || null;
  const baseMeta = { orderId: order.id, sourceName: order.sourceName ?? null, locationId: location.locationId, locationVia: location.via };

  const events = (agreements ?? [])
    .filter((agreement) => {
      const at = Date.parse(agreement.happenedAt);
      return at >= startMs && at <= endMs;
    })
    .sort((a, b) => Date.parse(a.happenedAt) - Date.parse(b.happenedAt));

  const rows = [];
  for (const agreement of events) {
    const common = {
      orderName: order.name ?? null,
      orderDate: formatStoreDate(agreement.happenedAt, timeZone),
      salesChannel: salesChannelName(order.sourceName, channelNames),
      posLocation: location.locationName,
      posStaff: staff,
    };
    const sales = mergeSales(agreement);
    const shipping = sales.filter((sale) => sale.lineType === "SHIPPING");
    const others = sales.filter((sale) => sale.lineType !== "SHIPPING");

    for (const sale of others) {
      const values = emptyValues(columns);
      const type = sale.actionType === "ORDER" ? ORDER_TYPES.order : ORDER_TYPES.reversal;
      const figures = saleFigures(sale);
      if (sale.lineType === "PRODUCT") {
        const line = linesById.get(sale.lineId);
        const collectionName = line ? lookupCollection(line, productIndex).collectionName : null;
        const price = amount(line?.originalUnitPriceSet);
        Object.assign(values, common, {
          orderType: type,
          collectionName,
          productTitle: line?.title ?? "(item no longer on the order)",
          sku: line?.sku ?? null,
          barcode: line?.variant?.barcode ?? null,
          variantPrice: line ? price : null,
          unitPriceBeforeVat: line ? unitPriceBeforeVat(price) : null,
          netItemsSold: sale.quantity,
          grossSales: figures.grossSales,
          discounts: figures.discounts,
          discountCodeReason: line && figures.discounts !== 0 ? discountCodeOrReason(line, discountIndex, discountOptions) : null,
          netSales: figures.net,
          taxes: figures.taxes,
          returnReason: type === ORDER_TYPES.reversal ? reasonFor(order, agreement.return?.id, sale.lineId) : null,
          totalSales: figures.total,
        });
        rows.push({ values, meta: { ...baseMeta, kind: "line", actionType: sale.actionType, happenedAt: agreement.happenedAt, lineItemId: sale.lineId, productId: line?.product?.id ?? null, collectionName } });
      } else {
        // A retained exchange credit: money Shopify keeps that sits on no item.
        Object.assign(values, common, { orderType: type, productTitle: ADJUSTMENT_TITLE, netItemsSold: 0, grossSales: figures.net, discounts: 0, netSales: figures.net, taxes: figures.taxes, totalSales: figures.total });
        rows.push({ values, meta: { ...baseMeta, kind: "adjustment", actionType: sale.actionType, happenedAt: agreement.happenedAt, lineItemId: null, productId: null, collectionName: null } });
      }
    }

    // Shipping: one row per event that charged it (nothing when it was free).
    const charged = shipping.reduce((sum, sale) => ({ total: sum.total + sale.total, tax: sum.tax + sale.tax }), { total: 0, tax: 0 });
    if (shipping.length && round2(charged.total) !== 0) {
      const isReturn = shipping[0].actionType !== "ORDER";
      const values = emptyValues(columns);
      Object.assign(values, common, {
        orderType: isReturn ? ORDER_TYPES.reversal : ORDER_TYPES.order,
        netItemsSold: 0,
        grossSales: 0,
        discounts: 0,
        netSales: 0,
        shippingCharges: round2(charged.total - charged.tax),
        isShippingCharges: "Yes",
        taxes: round2(charged.tax),
        totalSales: round2(charged.total),
      });
      rows.push({ values, meta: { ...baseMeta, kind: "shipping", actionType: shipping[0].actionType, happenedAt: agreement.happenedAt, lineItemId: null, productId: null, collectionName: null } });
    }
  }

  // Payment Method sits once per order, on its first row in the report.
  if (rows.length) rows[0].values.paymentMethod = paymentMethod;
  return rows;
}

// Builds every row for a period. `orders` is an async iterable from
// groupOrders(); `agreementsByOrder` a Map(orderId -> agreements[]).
export async function buildLedgerRows(orders, agreementsByOrder, context) {
  const rows = [];
  for await (const order of orders) rows.push(...ledgerOrderRows(order, agreementsByOrder.get(order.id), context));
  // Report order: by event time, then order, shipping after items.
  return rows.sort((a, b) => a.meta.happenedAt.localeCompare(b.meta.happenedAt) || a.values.orderName.localeCompare(b.values.orderName));
}

// Map(orderId -> agreements[]) from the grouped agreements export.
export async function indexAgreements(agreementOrders) {
  const index = new Map();
  for await (const order of agreementOrders) index.set(order.id, order.agreements);
  return index;
}

// Sums for checking a sample against Shopify's analytics.
export function summarizeRows(rows) {
  const totals = { rows: rows.length, orderRows: 0, reversalRows: 0, orders: new Set(), net: 0, taxes: 0, shipping: 0, total: 0, gross: 0, discounts: 0, reversalNet: 0 };
  for (const { values } of rows) {
    const isReversal = values.orderType === ORDER_TYPES.reversal;
    if (isReversal) totals.reversalRows += 1;
    else totals.orderRows += 1;
    totals.orders.add(values.orderName);
    totals.net += values.netSales ?? 0;
    totals.taxes += values.taxes ?? 0;
    totals.shipping += values.shippingCharges ?? 0;
    totals.total += values.totalSales ?? 0;
    if (!isReversal) {
      totals.gross += values.grossSales ?? 0;
      totals.discounts += values.discounts ?? 0;
    } else {
      totals.reversalNet += values.netSales ?? 0;
    }
  }
  const fixed = (value) => round2(value);
  return { rows: totals.rows, orderRows: totals.orderRows, reversalRows: totals.reversalRows, distinctOrders: totals.orders.size, grossOrders: fixed(totals.gross), discountsOrders: fixed(totals.discounts), reversalsNet: fixed(totals.reversalNet), netSales: fixed(totals.net), shipping: fixed(totals.shipping), taxes: fixed(totals.taxes), totalSales: fixed(totals.total) };
}
