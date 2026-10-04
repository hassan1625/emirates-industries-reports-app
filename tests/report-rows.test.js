import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderRows, buildGeneralSalesRows, formatStoreDate, salesChannelName, GENERAL_SALES_FIELD_KEYS } from "../app/pipeline/report-rows.js";
import { getReportFields } from "../app/config/index.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const money = (amount) => ({ shopMoney: { amount: String(amount), currencyCode: "AED" } });
const tax = (amount) => ({ title: "VAT", rate: 0.05, priceSet: money(amount) });
const alloc = (amount, index = 0) => ({ allocatedAmountSet: money(amount), discountApplication: { index } });

const HEAD = { locationId: "gid://shopify/Location/1", locationName: "Emirates Industries L.L.C,  Head office" };
const mappings = new Map([["web", HEAD], ["304980787201", HEAD]]);
const productIndex = {
  byProductId: new Map([["P1", { collectionName: "Boys Uniforms" }], ["P2", { collectionName: null }]]),
  byVariantId: new Map(),
};

const line = (over = {}) => ({
  id: "gid://shopify/LineItem/1",
  title: "Boys Trouser",
  sku: "TR-1",
  quantity: 1,
  currentQuantity: 1,
  originalUnitPriceSet: money(52.5),
  discountAllocations: [],
  taxLines: [tax(2.5)],
  variant: { id: "V1", barcode: "6290001" },
  product: { id: "P1" },
  ...over,
});
const order = (over = {}) => ({
  id: "gid://shopify/Order/1",
  name: "#1001",
  createdAt: "2026-08-01T20:30:00Z",
  sourceName: "pos",
  retailLocation: { id: "gid://shopify/Location/9", name: "Al Ain" },
  paymentGatewayNames: ["card"],
  taxesIncluded: true,
  currentShippingPriceSet: money(0),
  discountApplications: [],
  returns: [],
  lineItems: [line()],
  ...over,
});
const ctx = { productIndex, mappings };

describe("row shape", () => {
  test("every row has exactly the 21 configured columns, in config order", () => {
    const [row] = orderRows(order(), ctx);
    assert.deepEqual(Object.keys(row.values), getReportFields("generalSales").map((f) => f.key));
    assert.equal(GENERAL_SALES_FIELD_KEYS.length, 21);
  });

  test("a POS line fills the columns from the joins and calculations", () => {
    const [row] = orderRows(order(), ctx);
    assert.deepEqual(row.values, {
      orderName: "#1001",
      orderDate: "2026-08-02 00:30:00", // 20:30 UTC is 00:30 next day in Muscat
      salesChannel: "Point of Sale",
      posLocation: "Al Ain",
      posStaff: null,
      collectionName: "Boys Uniforms",
      productTitle: "Boys Trouser",
      sku: "TR-1",
      barcode: "6290001",
      variantPrice: 52.5,
      unitPriceBeforeVat: 52.5 / 1.05,
      netItemsSold: 1,
      grossSales: 50,
      discounts: 0,
      discountCodeReason: null,
      netSales: 50,
      shippingCharges: null,
      paymentMethod: "card",
      taxes: 2.5,
      returnReason: null,
      totalSales: 52.5,
    });
  });

  test("meta keeps the ids the filters need", () => {
    const [row] = orderRows(order(), ctx);
    assert.deepEqual(row.meta, { orderId: "gid://shopify/Order/1", sourceName: "pos", locationId: "gid://shopify/Location/9", locationVia: "retail", kind: "line", lineItemId: "gid://shopify/LineItem/1", variantId: "V1", productId: "P1", collectionName: "Boys Uniforms" });
  });

  test("POS Staff is always empty (not available on this plan)", () => {
    assert.ok(orderRows(order(), ctx).every((r) => r.values.posStaff === null));
  });
});

describe("once-per-order columns", () => {
  const two = () => order({ lineItems: [line({ id: "L1" }), line({ id: "L2", sku: "TR-2" })], paymentGatewayNames: ["cash", "card"] });

  test("Payment Method is on the first row only", () => {
    const rows = orderRows(two(), ctx);
    assert.deepEqual(rows.map((r) => r.values.paymentMethod), ["cash, card", null]);
  });

  test("a shipping row follows the lines when shipping was charged", () => {
    const rows = orderRows(order({ sourceName: "web", retailLocation: null, currentShippingPriceSet: money(22), lineItems: [line()] }), ctx);
    assert.equal(rows.length, 2);
    const shipping = rows[1];
    assert.equal(shipping.meta.kind, "shipping");
    assert.equal(shipping.values.shippingCharges, 20.95);
    assert.equal(shipping.values.taxes, 1.05);
    assert.equal(shipping.values.totalSales, 22);
    assert.equal(shipping.values.netSales, 0);
    assert.equal(shipping.values.productTitle, null);
    assert.equal(shipping.values.paymentMethod, null); // already on the first row
    assert.equal(shipping.values.posLocation, HEAD.locationName);
  });

  test("Shipping Charges is empty on line rows (once per order, not per line)", () => {
    const rows = orderRows(order({ currentShippingPriceSet: money(22), lineItems: [line(), line({ id: "L2" })] }), ctx);
    assert.deepEqual(rows.map((r) => r.values.shippingCharges), [null, null, 20.95]);
  });

  test("free shipping (0 after discounts) gets no shipping row", () => {
    assert.equal(orderRows(order({ currentShippingPriceSet: money(0) }), ctx).length, 1);
  });

  test("an order with shipping but no lines carries Payment Method on the shipping row", () => {
    const rows = orderRows(order({ lineItems: [], currentShippingPriceSet: money(22) }), ctx);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].values.paymentMethod, "card");
  });
});

describe("joins", () => {
  test("Online Store and Mobile App orders are reported under the mapped location", () => {
    for (const [sourceName, channel] of [["web", "Online Store"], ["304980787201", "Mobile App"]]) {
      const [row] = orderRows(order({ sourceName, retailLocation: null }), ctx);
      assert.equal(row.values.salesChannel, channel);
      assert.equal(row.values.posLocation, HEAD.locationName);
      assert.equal(row.meta.locationVia, "mapped");
    }
  });

  test("an unmapped channel (draft order) has a blank location, not a guess", () => {
    const [row] = orderRows(order({ sourceName: "shopify_draft_order", retailLocation: null }), ctx);
    assert.equal(row.values.salesChannel, "Draft Orders");
    assert.equal(row.values.posLocation, null);
    assert.equal(row.meta.locationId, null);
  });

  test("a product with no collection, or no product at all, has a blank Collection Name", () => {
    const rows = orderRows(order({ lineItems: [line({ product: { id: "P2" } }), line({ id: "L2", product: null }), line({ id: "L3", product: { id: "GONE" } })] }), ctx);
    assert.deepEqual(rows.map((r) => r.values.collectionName), [null, null, null]);
  });

  test("a discounted line shows its code or reason", () => {
    const [row] = orderRows(
      order({ discountApplications: [{ __typename: "ManualDiscountApplication", index: 0, title: "Teachers discount" }], lineItems: [line({ originalUnitPriceSet: money(100), discountAllocations: [alloc(10)], taxLines: [tax(4.29)] })] }),
      ctx,
    );
    assert.equal(row.values.discountCodeReason, "Teachers discount");
    assert.ok(row.values.discounts < 0);
  });

  test("a returned line shows its readable return reason and zero net", () => {
    const [row] = orderRows(
      order({
        lineItems: [line({ id: "L1", quantity: 1, currentQuantity: 0 })],
        returns: [{ id: "R1", status: "CLOSED", returnLineItems: [{ quantity: 1, returnReasonDefinition: { name: "Too small" }, fulfillmentLineItem: { lineItem: { id: "L1" } } }] }],
      }),
      ctx,
    );
    assert.equal(row.values.returnReason, "Too small");
    assert.equal(row.values.netSales, 0);
    assert.equal(row.values.netItemsSold, 0);
    assert.equal(row.values.grossSales, 50);
  });

  test("a missing barcode is empty, not 'undefined'", () => {
    const [row] = orderRows(order({ lineItems: [line({ variant: { id: "V" } })] }), ctx);
    assert.equal(row.values.barcode, null);
  });
});

describe("helpers", () => {
  test("formatStoreDate converts to the store time zone and handles bad input", () => {
    assert.equal(formatStoreDate("2026-08-01T20:30:00Z"), "2026-08-02 00:30:00");
    assert.equal(formatStoreDate("2026-08-01T20:30:00Z", "UTC"), "2026-08-01 20:30:00");
    assert.equal(formatStoreDate(undefined), null);
    assert.equal(formatStoreDate("nonsense"), null);
  });

  test("midnight is 00:00:00, not 24:00:00", () => {
    assert.equal(formatStoreDate("2026-08-01T20:00:00Z"), "2026-08-02 00:00:00");
  });

  test("salesChannelName falls back to the raw source", () => {
    assert.equal(salesChannelName("pos"), "Point of Sale");
    assert.equal(salesChannelName("some-new-app"), "some-new-app");
    assert.equal(salesChannelName(undefined), null);
  });
});

test("buildGeneralSalesRows streams rows for many orders", async () => {
  async function* orders() {
    yield order({ id: "O1", name: "#1" });
    yield order({ id: "O2", name: "#2", currentShippingPriceSet: money(22) });
  }
  const rows = [];
  for await (const row of buildGeneralSalesRows(orders(), ctx)) rows.push(row);
  assert.deepEqual(rows.map((r) => `${r.values.orderName}:${r.meta.kind}`), ["#1:line", "#2:line", "#2:shipping"]);
});

// The client's sheet vs the row set built from real pipeline output.
describe("against the client's sample sheet", () => {
  const sheet = fixture("general-report.json");
  const orders = fixture("sample-orders.json").orders;
  const EXCHANGED = new Set(["#22374", "#22392", "#22402", "#22411"]); // exchanged after the sheet was exported
  const round2 = (n) => Math.round(n * 100) / 100;

  const sheetTotal = new Map();
  for (const r of sheet.rows) sheetTotal.set(r.orderName, round2((sheetTotal.get(r.orderName) ?? 0) + r.totalSales));
  const ourTotal = new Map();
  for (const o of orders) for (const row of orderRows(o, ctx)) ourTotal.set(o.name, round2((ourTotal.get(o.name) ?? 0) + row.values.totalSales));

  test("the Total Sales of every sample order, shipping included, matches the sheet (except the four exchanged orders)", () => {
    const off = [];
    for (const [name, want] of sheetTotal) {
      if (EXCHANGED.has(name)) continue;
      if (Math.abs((ourTotal.get(name) ?? NaN) - want) > 0.0101) off.push(`${name}: got ${ourTotal.get(name)}, sheet ${want}`);
    }
    assert.deepEqual(off, []);
  });

  test("all 48 orders are covered", () => {
    assert.equal(sheetTotal.size, 48);
    assert.equal(ourTotal.size, 48);
  });

  test("our shipping rows exist exactly for the orders whose sheet shipping row is not free", () => {
    const sheetPaid = new Set(sheet.rows.filter((r) => r.rowType === "shipping" && r.totalSales > 0).map((r) => r.orderName));
    const ourPaid = new Set(orders.filter((o) => orderRows(o, ctx).some((r) => r.meta.kind === "shipping")).map((o) => o.name));
    assert.deepEqual([...ourPaid].sort(), [...sheetPaid].sort());
  });
});
