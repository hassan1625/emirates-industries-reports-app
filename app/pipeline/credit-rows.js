// Refund Credit Report rows: one row per exchange credit. When an exchange
// returns items worth more than the replacement and the difference is not paid
// back, Shopify books that money as sales kept, on no item (an "adjustment"
// sale inside the return or exchange event). The General Sales Report leaves it
// out; this report lists it for the audit team, dated on the day it was booked.
//
// Adding this report's total to the General Sales Report's Net sales gives
// Shopify's own Net sales for the period (checked for 24-31 Aug 2026: 511.88).
// The credit carries no VAT, so the same amount is also the Total sales
// difference.
import { getReportFields } from "../config/index.js";
import { SALES_CHANNEL_NAMES, STORE_TIME_ZONE } from "../config/store.js";
import { round2 } from "../calculations/money.js";
import { resolveOrderLocation } from "./location-mapping.js";
import { formatStoreDate, reasonFor, salesChannelName } from "./ledger-rows.js";

const REPORT = "refundCredit";
const amount = (set) => Number(set?.shopMoney?.amount ?? 0);

export const creditColumns = () => getReportFields(REPORT).map(({ key, label, type, width }) => ({ key, label, type, width }));

// "Jacket × 2; Trouser × 1" for the items returned in the same event.
function itemsReturned(order, agreement) {
  const byLine = new Map();
  for (const sale of agreement.sales ?? []) {
    if (sale.lineType !== "PRODUCT" || sale.actionType === "ORDER") continue;
    const quantity = Math.abs(sale.quantity ?? 0);
    if (!quantity) continue;
    byLine.set(sale.lineItem?.id, (byLine.get(sale.lineItem?.id) ?? 0) + quantity);
  }
  const titles = new Map(order.lineItems.map((line) => [line.id, line.title]));
  return [...byLine].map(([lineId, quantity]) => `${titles.get(lineId) ?? "(item no longer on the order)"} × ${quantity}`).join("; ");
}

// Rows of one order for the credits booked inside [startMs, endMs].
export function creditOrderRows(order, agreements, { mappings, staffByOrder, startMs, endMs, keep = () => true, timeZone = STORE_TIME_ZONE, channelNames = SALES_CHANNEL_NAMES }) {
  const location = resolveOrderLocation(order, mappings);
  const staff = staffByOrder?.get(order.name) ?? null;
  const rows = [];

  for (const agreement of agreements ?? []) {
    const at = Date.parse(agreement.happenedAt);
    if (!(at >= startMs && at <= endMs)) continue;
    const credit = round2((agreement.sales ?? []).filter((sale) => sale.lineType === "ADJUSTMENT").reduce((sum, sale) => sum + amount(sale.totalAmount), 0));
    if (credit === 0) continue;

    // The reasons of the items returned in this event.
    const reasons = [];
    for (const sale of agreement.sales ?? []) {
      if (sale.lineType !== "PRODUCT" || sale.actionType === "ORDER") continue;
      const reason = reasonFor(order, agreement.return?.id, sale.lineItem?.id);
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }

    const row = {
      values: {
        orderName: order.name ?? null,
        eventDate: formatStoreDate(agreement.happenedAt, timeZone),
        originalOrderDate: formatStoreDate(order.createdAt, timeZone),
        salesChannel: salesChannelName(order.sourceName, channelNames),
        posLocation: location.locationName,
        posStaff: staff,
        creditAmount: credit,
        itemsReturned: itemsReturned(order, agreement) || null,
        returnReason: reasons.length ? reasons.join("; ") : null,
      },
      meta: { orderId: order.id, sourceName: order.sourceName ?? null, locationId: location.locationId, posStaff: staff, happenedAt: agreement.happenedAt },
    };
    if (keep(row)) rows.push(row);
  }
  return rows;
}

// All credit rows of a period, oldest first.
export async function buildCreditRows(orders, agreementsByOrder, context) {
  const rows = [];
  for await (const order of orders) rows.push(...creditOrderRows(order, agreementsByOrder.get(order.id), context));
  return rows.sort((a, b) => a.meta.happenedAt.localeCompare(b.meta.happenedAt) || a.values.orderName.localeCompare(b.values.orderName));
}

// The numbers shown on the Summary sheet and in the total row.
export function summarizeCredits(rows) {
  const byChannel = new Map();
  let total = 0;
  for (const { values } of rows) {
    total += values.creditAmount;
    const channel = values.salesChannel ?? "Unknown";
    const entry = byChannel.get(channel) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += values.creditAmount;
    byChannel.set(channel, entry);
  }
  return {
    count: rows.length,
    orders: new Set(rows.map((row) => row.values.orderName)).size,
    total: round2(total),
    byChannel: [...byChannel].map(([channel, { count, total: sum }]) => ({ channel, count, total: round2(sum) })).sort((a, b) => b.total - a.total),
  };
}
