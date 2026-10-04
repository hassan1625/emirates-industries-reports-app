// Assembles the Report 1 row set (Dev Plan Step 23): one row per order line
// item with all 21 columns, plus one shipping row per order that was charged
// shipping. Column keys come from the Report 1 config; this file never lists
// them a second time (it only checks it filled exactly those).
//
// Layout (mirrors the client's reference sheet):
//   * line rows carry the line's figures; Shipping Charges is empty;
//   * Payment Method appears ONCE per order, on the order's first row;
//   * a shipping row follows the lines when shipping was charged (> 0 after
//     discounts): Shipping Charges (excl VAT, rounded), its VAT in Taxes, and
//     the amount paid in Total Sales; product columns and Net/Gross are 0 or
//     empty. Free-shipping orders get no shipping row;
//   * Total Sales summed over all rows equals Net + Shipping + Taxes;
//   * POS Staff is empty: Shopify does not expose it on this plan.
// Each row is { values, meta }. `values` are the sheet columns; `meta` keeps
// ids and raw facts the filters (Milestone 4) and later reports need.
import { getReportFields } from "../config/index.js";
import { SALES_CHANNEL_NAMES, STORE_TIME_ZONE } from "../config/store.js";
import { orderCalculation } from "../calculations/index.js";
import { buildDiscountIndex, discountCodeOrReason } from "./discounts.js";
import { lookupCollection } from "./join.js";
import { resolveOrderLocation } from "./location-mapping.js";
import { buildReturnIndex, returnReasonFor } from "./returns.js";

const REPORT = "generalSales";
const FIELD_KEYS = getReportFields(REPORT).map((field) => field.key);

// "2026-08-02 00:30:00" in the given time zone (24-hour clock).
export function formatStoreDate(iso, timeZone = STORE_TIME_ZONE) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export const salesChannelName = (sourceName, names = SALES_CHANNEL_NAMES) => names[sourceName] ?? sourceName ?? null;

// A row with every configured column present (null by default).
function emptyValues() {
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, null]));
}

function fill(values, entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (!(key in values)) throw new Error(`"${key}" is not a Report 1 field in the config`);
    values[key] = value;
  }
  return values;
}

// Rows for one order.
export function orderRows(order, { productIndex, mappings, timeZone = STORE_TIME_ZONE, channelNames = SALES_CHANNEL_NAMES, discountOptions }) {
  const calc = orderCalculation(order);
  const location = resolveOrderLocation(order, mappings);
  const returnIndex = buildReturnIndex(order);
  const discountIndex = buildDiscountIndex(order);

  const common = {
    orderName: order.name ?? null,
    orderDate: formatStoreDate(order.createdAt, timeZone),
    salesChannel: salesChannelName(order.sourceName, channelNames),
    posLocation: location.locationName,
    posStaff: null, // unavailable on this plan; see the config
  };
  const baseMeta = { orderId: order.id, sourceName: order.sourceName ?? null, locationId: location.locationId, locationVia: location.via };
  const rows = [];

  calc.lines.forEach(({ line, ...figures }, position) => {
    const { collectionName } = lookupCollection(line, productIndex);
    rows.push({
      values: fill(emptyValues(), {
        ...common,
        collectionName,
        productTitle: line.title ?? null,
        sku: line.sku ?? null,
        barcode: line.variant?.barcode ?? null,
        variantPrice: figures.variantPrice,
        unitPriceBeforeVat: figures.unitPriceBeforeVat,
        netItemsSold: figures.netItemsSold,
        grossSales: figures.grossSales,
        discounts: figures.discounts,
        discountCodeReason: discountCodeOrReason(line, discountIndex, discountOptions),
        netSales: figures.netSales,
        paymentMethod: position === 0 ? calc.paymentMethod : null,
        taxes: figures.taxes,
        returnReason: returnReasonFor(line.id, returnIndex),
        totalSales: figures.totalSales,
      }),
      meta: { ...baseMeta, kind: "line", lineItemId: line.id, variantId: line.variant?.id ?? null, productId: line.product?.id ?? null, collectionName },
    });
  });

  const { shippingInclVat, shippingExclVat, shippingTax } = calc.shipping;
  if (shippingInclVat > 0) {
    rows.push({
      values: fill(emptyValues(), {
        ...common,
        netItemsSold: 0,
        grossSales: 0,
        discounts: 0,
        netSales: 0,
        shippingCharges: shippingExclVat,
        paymentMethod: rows.length === 0 ? calc.paymentMethod : null,
        taxes: shippingTax,
        totalSales: shippingInclVat,
      }),
      meta: { ...baseMeta, kind: "shipping", lineItemId: null, variantId: null, productId: null, collectionName: null },
    });
  }
  return rows;
}

// Streams rows for a stream of orders (as rebuilt by groupOrders()).
export async function* buildGeneralSalesRows(orders, context) {
  for await (const order of orders) yield* orderRows(order, context);
}

export const GENERAL_SALES_FIELD_KEYS = Object.freeze(FIELD_KEYS);
