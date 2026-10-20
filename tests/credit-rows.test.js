import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCreditRows, creditColumns, creditOrderRows, summarizeCredits } from "../app/pipeline/credit-rows.js";

const money = (a) => ({ shopMoney: { amount: String(a), currencyCode: "AED" } });
const sale = (actionType, lineType, lineId, quantity, total) => ({ actionType, lineType, quantity, totalAmount: money(total), totalTaxAmount: money(0), ...(lineType === "PRODUCT" ? { lineItem: { id: lineId } } : {}) });

const order = {
  id: "O1",
  name: "#36547",
  createdAt: "2026-08-25T13:18:16Z",
  sourceName: "pos",
  retailLocation: { id: "L1", name: "Al Garhoud" },
  lineItems: [{ id: "I1", title: "Lab Coat", sku: "LAB-M" }, { id: "I2", title: "Trouser", sku: "TRS-10" }, { id: "I3", title: "Trouser", sku: "TRS-12" }, { id: "I4", title: "Belt", sku: null }],
  returns: [{ id: "R1", status: "CLOSED", returnLineItems: [{ quantity: 2, returnReasonDefinition: { name: "Too big" }, fulfillmentLineItem: { lineItem: { id: "I1" } } }, { quantity: 1, returnReasonDefinition: { name: "Changed my mind" }, fulfillmentLineItem: { lineItem: { id: "I2" } } }] }],
};
const exchange = { id: "A2", happenedAt: "2026-08-31T18:03:38Z", reason: "RETURN", return: { id: "R1" }, sales: [sale("RETURN", "PRODUCT", "I1", -2, -113.4), sale("RETURN", "PRODUCT", "I2", -1, -50), sale("ORDER", "PRODUCT", "I2", 1, 20), sale("RETURN", "ADJUSTMENT", null, null, 113.4)] };
const original = { id: "A1", happenedAt: "2026-08-25T13:18:16Z", reason: "ORDER", sales: [sale("ORDER", "PRODUCT", "I1", 2, 113.4)] };
const context = { mappings: new Map(), staffByOrder: new Map([["#36547", "Cashier01 Garhoud"]]), startMs: Date.parse("2026-08-23T20:00:00Z"), endMs: Date.parse("2026-08-31T19:59:59Z") + 999 };

describe("creditOrderRows", () => {
  test("a credit becomes one row with its dates, staff, items returned and reasons", () => {
    const [row] = creditOrderRows(order, [original, exchange], context);
    assert.deepEqual(row.values, {
      orderName: "#36547",
      eventDate: "2026-08-31 22:03:38", // 18:03 UTC is 22:03 in Muscat
      originalOrderDate: "2026-08-25 17:18:16",
      salesChannel: "Point of Sale",
      posLocation: "Al Garhoud",
      posStaff: "Cashier01 Garhoud",
      creditAmount: 113.4,
      itemsReturned: "Lab Coat × 2; Trouser × 1", // the replacement (an ORDER sale) is not a returned item
      sku: "LAB-M; TRS-10",
      returnReason: "Too big; Changed my mind",
    });
  });

  test("only events with an adjustment make rows", () => {
    assert.equal(creditOrderRows(order, [original], context).length, 0);
    const empty = { ...exchange, sales: exchange.sales.filter((s) => s.lineType !== "ADJUSTMENT") };
    assert.equal(creditOrderRows(order, [empty], context).length, 0);
  });

  test("several adjustments in one event are added; a zero total makes no row", () => {
    const twice = { ...exchange, sales: [...exchange.sales, sale("RETURN", "ADJUSTMENT", null, null, 10.5)] };
    assert.equal(creditOrderRows(order, [twice], context)[0].values.creditAmount, 123.9);
    const cancelled = { ...exchange, sales: [sale("RETURN", "ADJUSTMENT", null, null, 5), sale("RETURN", "ADJUSTMENT", null, null, -5)] };
    assert.equal(creditOrderRows(order, [cancelled], context).length, 0);
  });

  test("credits outside the period are left out", () => {
    assert.equal(creditOrderRows(order, [exchange], { ...context, endMs: Date.parse("2026-08-30T00:00:00Z") }).length, 0);
    assert.equal(creditOrderRows(order, [exchange], { ...context, startMs: Date.parse("2026-09-01T00:00:00Z") }).length, 0);
  });

  test("the filter predicate sees the row's channel, location and staff", () => {
    const seen = [];
    creditOrderRows(order, [exchange], { ...context, keep: (row) => { seen.push(row.meta); return false; } });
    assert.deepEqual(seen.map(({ sourceName, locationId, posStaff }) => ({ sourceName, locationId, posStaff })), [{ sourceName: "pos", locationId: "L1", posStaff: "Cashier01 Garhoud" }]);
    assert.equal(creditOrderRows(order, [exchange], { ...context, keep: () => false }).length, 0);
  });

  test("a credit on an order with no returned items or staff still lists, with blanks", () => {
    const lone = { ...exchange, return: undefined, sales: [sale("RETURN", "ADJUSTMENT", null, null, 7)] };
    const [row] = creditOrderRows({ ...order, retailLocation: null, sourceName: "web" }, [lone], { ...context, staffByOrder: new Map() });
    assert.equal(row.values.creditAmount, 7);
    assert.equal(row.values.itemsReturned, null);
    assert.equal(row.values.returnReason, null);
    assert.equal(row.values.posStaff, null);
    assert.equal(row.values.salesChannel, "Online Store");
  });

  test("the SKU column lines up with Items Returned, so two sizes of one product can be told apart", () => {
    const sizes = { ...exchange, sales: [sale("RETURN", "PRODUCT", "I2", -1, -50), sale("RETURN", "PRODUCT", "I3", -1, -50), sale("RETURN", "ADJUSTMENT", null, null, 10)] };
    const [row] = creditOrderRows(order, [sizes], context);
    assert.equal(row.values.itemsReturned, "Trouser × 1; Trouser × 1");
    assert.equal(row.values.sku, "TRS-10; TRS-12");
  });

  test("a returned item with no SKU says so, and a credit with no returned items has no SKU", () => {
    const belt = { ...exchange, sales: [sale("RETURN", "PRODUCT", "I4", -1, -9), sale("RETURN", "ADJUSTMENT", null, null, 9)] };
    assert.equal(creditOrderRows(order, [belt], context)[0].values.sku, "(no SKU)");
    const lone = { ...exchange, return: undefined, sales: [sale("RETURN", "ADJUSTMENT", null, null, 7)] };
    assert.equal(creditOrderRows(order, [lone], context)[0].values.sku, null);
  });

  test("a returned item no longer on the order is still named", () => {
    const ghost = { ...exchange, sales: [sale("RETURN", "PRODUCT", "GONE", -1, -9), sale("RETURN", "ADJUSTMENT", null, null, 9)] };
    const [row] = creditOrderRows(order, [ghost], context);
    assert.equal(row.values.itemsReturned, "(item no longer on the order) × 1");
    assert.equal(row.values.sku, "(item no longer on the order)");
  });
});

describe("buildCreditRows and summarizeCredits", () => {
  const second = { ...order, id: "O2", name: "#40000", sourceName: "web", retailLocation: null };
  const later = { ...exchange, id: "A9", happenedAt: "2026-08-28T08:00:00Z", sales: [sale("RETURN", "ADJUSTMENT", null, null, 25.5)] };

  test("rows come out oldest first, across orders", async () => {
    const agreements = new Map([["O1", [exchange]], ["O2", [later]]]);
    const rows = await buildCreditRows([order, second], agreements, context);
    assert.deepEqual(rows.map((r) => r.values.orderName), ["#40000", "#36547"]);
  });

  test("the summary counts credits and orders and splits the total by channel", async () => {
    const agreements = new Map([["O1", [exchange]], ["O2", [later]]]);
    const summary = summarizeCredits(await buildCreditRows([order, second], agreements, context));
    assert.equal(summary.count, 2);
    assert.equal(summary.orders, 2);
    assert.equal(summary.total, 138.9);
    assert.deepEqual(summary.byChannel, [{ channel: "Point of Sale", count: 1, total: 113.4 }, { channel: "Online Store", count: 1, total: 25.5 }]);
  });

  test("an empty period summarizes to zero", () => {
    assert.deepEqual(summarizeCredits([]), { count: 0, orders: 0, total: 0, byChannel: [] });
  });

  test("the columns come from the config, ten of them, with the SKU right after Items Returned", () => {
    const keys = creditColumns().map((c) => c.key);
    assert.equal(keys.length, 10);
    assert.equal(keys[keys.indexOf("itemsReturned") + 1], "sku");
  });
});
