import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ledgerColumns, ledgerOrderRows, saleFigures, summarizeRows } from "../app/pipeline/ledger-rows.js";

const money = (amount) => ({ shopMoney: { amount: String(amount), currencyCode: "AED" } });
const sale = (actionType, lineType, lineId, quantity, total, tax, discountBefore = 0) => ({
  actionType,
  lineType,
  quantity,
  totalAmount: money(total),
  totalTaxAmount: money(tax),
  totalDiscountAmountBeforeTaxes: money(discountBefore),
  ...(lineType === "PRODUCT" ? { lineItem: { id: lineId } } : lineType === "SHIPPING" ? { shippingLine: { id: lineId } } : {}),
});

const order = {
  id: "O1",
  name: "#1",
  sourceName: "pos",
  paymentGatewayNames: ["cash"],
  lineItems: [{ id: "L1", title: "Shirt", sku: "S", quantity: 2, originalUnitPriceSet: money(115.5), variant: { barcode: "B" }, product: { id: "P" }, discountAllocations: [] }],
  returns: [{ id: "R1", status: "CLOSED", returnLineItems: [{ quantity: 1, returnReasonDefinition: { name: "Too small" }, fulfillmentLineItem: { lineItem: { id: "L1" } } }] }],
  discountApplications: [],
};
const agreements = [
  { id: "A1", happenedAt: "2026-09-01T06:00:00Z", reason: "ORDER", sales: [sale("ORDER", "PRODUCT", "L1", 2, 231, 11, 10), sale("ORDER", "SHIPPING", "S1", null, 22, 1.05)] },
  { id: "A2", happenedAt: "2026-09-05T06:00:00Z", reason: "RETURN", return: { id: "R1" }, sales: [sale("RETURN", "PRODUCT", "L1", -1, -115.5, -5.5, -5), sale("RETURN", "ADJUSTMENT", null, null, 3, 0)] },
];
const context = { columns: ledgerColumns(), productIndex: { byProductId: new Map([["P", { collectionName: "Coll" }]]) }, mappings: new Map(), staffByOrder: new Map([["#1", "Sam"]]), startMs: Date.parse("2026-08-31T20:00:00Z"), endMs: Date.parse("2026-09-30T19:59:59Z") };

describe("ledgerColumns", () => {
  test("adds Order Type after Order Date and Is Shipping Charges after Shipping Charges", () => {
    const keys = ledgerColumns().map((c) => c.key);
    assert.equal(keys[keys.indexOf("orderDate") + 1], "orderType");
    assert.equal(keys[keys.indexOf("shippingCharges") + 1], "isShippingCharges");
  });
});

describe("saleFigures", () => {
  test("splits a VAT-inclusive, discounted amount into net, gross and discounts", () => {
    assert.deepEqual(saleFigures({ total: 231, tax: 11, discountBefore: 10 }), { net: 220, taxes: 11, total: 231, grossSales: 230, discounts: -10 });
  });
  test("mirrors on a reversal", () => {
    assert.deepEqual(saleFigures({ total: -115.5, tax: -5.5, discountBefore: -5 }), { net: -110, taxes: -5.5, total: -115.5, grossSales: -115, discounts: 5 });
  });
});

describe("ledgerOrderRows", () => {
  const rows = ledgerOrderRows(order, agreements, context);
  const by = (kind, type) => rows.find((r) => r.meta.kind === kind && r.values.orderType === type);

  test("an order event gives an item row and a shipping row dated on the event", () => {
    const line = by("line", "Order");
    assert.equal(line.values.orderDate, "2026-09-01 10:00:00");
    assert.equal(line.values.netItemsSold, 2);
    assert.equal(line.values.netSales, 220);
    assert.equal(line.values.paymentMethod, "cash");
    assert.equal(line.values.posStaff, "Sam");
    assert.equal(line.values.collectionName, "Coll");
    assert.equal(line.values.returnReason, null);
    const ship = by("shipping", "Order");
    assert.equal(ship.values.isShippingCharges, "Yes");
    assert.equal(ship.values.shippingCharges, 20.95);
    assert.equal(ship.values.taxes, 1.05);
    assert.equal(line.values.isShippingCharges, null);
  });

  test("a return is a negative Reversal row on the return day with its reason", () => {
    const rev = by("line", "Reversal");
    assert.equal(rev.values.orderDate, "2026-09-05 10:00:00");
    assert.equal(rev.values.netItemsSold, -1);
    assert.equal(rev.values.netSales, -110);
    assert.equal(rev.values.totalSales, -115.5);
    assert.equal(rev.values.returnReason, "Too small");
    assert.equal(rev.values.paymentMethod, null);
  });

  test("a retained exchange credit becomes an adjustment row", () => {
    assert.equal(by("adjustment", "Reversal").values.netSales, 3);
  });

  test("only events inside the period are included", () => {
    const only = ledgerOrderRows(order, agreements, { ...context, endMs: Date.parse("2026-09-02T00:00:00Z") });
    assert.ok(only.every((r) => r.values.orderType === "Order"));
  });

  test("totals add up to net + shipping + taxes", () => {
    const s = summarizeRows(rows);
    assert.equal(s.netSales, 113);
    assert.equal(s.totalSales, round(113 + 20.95 + 6.55 + 0));
    function round(v) { return Math.round(v * 100) / 100; }
  });
});
