import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lineCalculation, orderShipping, paymentMethod, orderCalculation } from "../app/calculations/index.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const money = (amount) => ({ shopMoney: { amount: String(amount), currencyCode: "AED" } });
const tax = (amount, rate = 0.05) => ({ title: "VAT", rate, priceSet: money(amount) });
const alloc = (amount) => ({ allocatedAmountSet: money(amount), discountApplication: { index: 0 } });
const line = (over) => ({ id: "L", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money(0), discountAllocations: [], taxLines: [], ...over });

describe("lineCalculation", () => {
  test("a plain VAT-inclusive line: net = price / 1.05, tax 5%, total = price", () => {
    const r = lineCalculation(line({ originalUnitPriceSet: money(91.35), taxLines: [tax(4.35)] }));
    assert.deepEqual(r, { variantPrice: 91.35, unitPriceBeforeVat: 87, netItemsSold: 1, grossSales: 87, discounts: 0, returnsAmount: 0, netSales: 87, taxes: 4.35, totalSales: 91.35 });
  });

  test("unit price before VAT is the locked formula: price / 1.05, NOT rounded to cents", () => {
    assert.equal(lineCalculation(line({ originalUnitPriceSet: money(0.25), taxLines: [tax(0.01)] })).unitPriceBeforeVat, 0.2380952381);
  });

  test("quantity multiplies: 2 x 0.25 gives 0.48 gross and 0.02 tax", () => {
    const r = lineCalculation(line({ quantity: 2, currentQuantity: 2, originalUnitPriceSet: money(0.25), taxLines: [tax(0.02)] }));
    assert.equal(r.grossSales, 0.48);
    assert.equal(r.taxes, 0.02);
    assert.equal(r.totalSales, 0.5);
  });

  test("a discounted line (client sheet #22406): gross 90.01, discounts -9.01, net 81, tax 4.04, total 85.04", () => {
    const r = lineCalculation(line({ quantity: 2, currentQuantity: 2, originalUnitPriceSet: money(47.25), discountAllocations: [alloc(9.46)], taxLines: [tax(4.04)] }));
    assert.equal(r.grossSales, 90.01);
    assert.equal(r.discounts, -9.01);
    assert.equal(r.netSales, 81);
    assert.equal(r.taxes, 4.04);
    assert.equal(r.totalSales, 85.04);
  });

  test("Gross is derived as Net + Discounts, so Net = Gross + Discounts holds exactly", () => {
    const r = lineCalculation(line({ originalUnitPriceSet: money(100), discountAllocations: [alloc(9.52)], taxLines: [tax(4.31)] }));
    assert.equal(Math.round((r.grossSales + r.discounts) * 100) / 100, r.netSales);
  });

  test("a fully returned line keeps Gross but has Net 0, Taxes 0, Total 0 and 0 items (as in the sheet)", () => {
    const r = lineCalculation(line({ quantity: 2, currentQuantity: 0, originalUnitPriceSet: money(35.7), taxLines: [tax(3.4)] }));
    assert.equal(r.grossSales, 68);
    assert.equal(r.netSales, 0);
    assert.equal(r.taxes, 0);
    assert.equal(r.totalSales, 0);
    assert.equal(r.netItemsSold, 0);
    assert.equal(r.returnsAmount, 68);
  });

  test("a partly returned line scales Net and Taxes by the share still sold", () => {
    const r = lineCalculation(line({ quantity: 4, currentQuantity: 3, originalUnitPriceSet: money(21), taxLines: [tax(4)] }));
    assert.equal(r.grossSales, 80);
    assert.equal(r.netSales, 60);
    assert.equal(r.taxes, 3);
    assert.equal(r.netItemsSold, 3);
    assert.equal(r.returnsAmount, 20);
    assert.equal(r.totalSales, 63);
  });

  test("Net = Gross + Discounts - Returns", () => {
    const r = lineCalculation(line({ quantity: 2, currentQuantity: 1, originalUnitPriceSet: money(52.5), discountAllocations: [alloc(10)], taxLines: [tax(4.52)] }));
    assert.equal(Math.round((r.grossSales + r.discounts - r.returnsAmount) * 100) / 100, r.netSales);
  });

  test("a zero-quantity line yields zeros, not NaN", () => {
    const r = lineCalculation(line({ quantity: 0, currentQuantity: 0 }));
    assert.equal(r.netSales, 0);
    assert.equal(r.totalSales, 0);
    assert.ok(Object.values(r).every((v) => Number.isFinite(v)));
  });

  test("currentQuantity above quantity is capped (never a negative return)", () => {
    assert.equal(lineCalculation(line({ quantity: 1, currentQuantity: 5, originalUnitPriceSet: money(10.5), taxLines: [tax(0.5)] })).returnsAmount, 0);
  });

  test("prices that exclude tax (taxesIncluded false) are treated as net", () => {
    const r = lineCalculation(line({ originalUnitPriceSet: money(100), taxLines: [tax(5)] }), { taxesIncluded: false });
    assert.equal(r.grossSales, 100);
    assert.equal(r.netSales, 100);
    assert.equal(r.taxes, 5);
    assert.equal(r.totalSales, 105);
  });

  test("an untaxed line has no VAT to remove", () => {
    const r = lineCalculation(line({ originalUnitPriceSet: money(10), discountAllocations: [alloc(1)] }));
    assert.equal(r.discounts, -1);
    assert.equal(r.netSales, 9);
  });

  test("no -0 in results", () => {
    assert.ok(Object.is(lineCalculation(line({ originalUnitPriceSet: money(10.5), taxLines: [tax(0.5)] })).discounts, 0));
  });
});

describe("orderShipping", () => {
  test("22 incl VAT is 20.95 excl, with 1.05 VAT", () => {
    assert.deepEqual(orderShipping({ currentShippingPriceSet: money(22) }), { shippingInclVat: 22, shippingExclVat: 20.95, shippingTax: 1.05 });
  });
  test("free shipping (post-discount 0) is all zeros", () => {
    assert.deepEqual(orderShipping({ currentShippingPriceSet: money(0) }), { shippingInclVat: 0, shippingExclVat: 0, shippingTax: 0 });
  });
  test("an order with no shipping field is zero", () => {
    assert.equal(orderShipping({}).shippingInclVat, 0);
  });
});

test("paymentMethod joins gateways, or null", () => {
  assert.equal(paymentMethod({ paymentGatewayNames: ["cash", "card"] }), "cash, card");
  assert.equal(paymentMethod({ paymentGatewayNames: [] }), null);
  assert.equal(paymentMethod({}), null);
});

describe("orderCalculation", () => {
  test("order Total Sales = line totals + shipping", () => {
    const order = {
      taxesIncluded: true,
      currentShippingPriceSet: money(22),
      paymentGatewayNames: ["card"],
      lineItems: [line({ originalUnitPriceSet: money(52.5), taxLines: [tax(2.5)] }), line({ originalUnitPriceSet: money(25.2), taxLines: [tax(1.2)] })],
    };
    const calc = orderCalculation(order);
    assert.equal(calc.totals.netSales, 74);
    assert.equal(calc.totals.taxes, 3.7);
    assert.equal(calc.totals.totalSales, 99.7); // 77.7 + 22
    assert.equal(calc.shipping.shippingExclVat, 20.95);
    assert.equal(calc.paymentMethod, "card");
    assert.equal(calc.lines.length, 2);
  });
});

// The client's validated sheet vs the calculation layer fed with real pipeline
// output for the same 48 orders. Everything matches the sheet to the cent
// (+-0.01 on two discounted lines, where Shopify rounds the discount
// differently), EXCEPT six lines in three orders that were exchanged after the
// sheet was exported: the original item is now fully returned and a replacement
// was added.
describe("against the client's sample sheet", () => {
  const sheet = fixture("general-report.json");
  const orders = fixture("sample-orders.json").orders;
  const COLUMNS = ["grossSales", "discounts", "netSales", "taxes", "totalSales", "netItemsSold"];
  const EXCHANGED_AFTER_SHEET = new Set(["#22374|IAT-BLSE-0001-XXS", "#22392|AIS-SHRT-0010-5", "#22402|ADK-TSHT-0003-16", "#22402|ADK-TRSR-0002-12", "#22402|ADK-TRSR-0002-28", "#22411|ADK-TRSR-0002-8"]);

  const key = (name, sku) => `${name}|${sku}`;
  const sum = (rows, pick) => rows.reduce((a, r) => a + pick(r), 0);

  // Sheet and our output both aggregated per (order, sku), as a SKU can repeat.
  const wanted = new Map();
  for (const row of sheet.rows.filter((r) => r.rowType === "line")) {
    const acc = wanted.get(key(row.orderName, row.sku)) ?? Object.fromEntries(COLUMNS.map((c) => [c, 0]));
    for (const c of COLUMNS) acc[c] += row[c] ?? 0;
    wanted.set(key(row.orderName, row.sku), acc);
  }
  const got = new Map();
  for (const order of orders) {
    for (const l of orderCalculation(order).lines) {
      const acc = got.get(key(order.name, l.line.sku)) ?? Object.fromEntries(COLUMNS.map((c) => [c, 0]));
      for (const c of COLUMNS) acc[c] += l[c];
      got.set(key(order.name, l.line.sku), acc);
    }
  }

  test("all 48 sample orders and 251 sheet line groups are present", () => {
    assert.equal(orders.length, 48);
    assert.equal(wanted.size, 251);
    for (const k of wanted.keys()) assert.ok(got.has(k), `missing ${k}`);
  });

  test("every column matches the sheet to within one cent, except the six exchanged lines", () => {
    const off = [];
    for (const [k, want] of wanted) {
      if (EXCHANGED_AFTER_SHEET.has(k)) continue;
      for (const c of COLUMNS) if (Math.abs(got.get(k)[c] - want[c]) > 0.0101) off.push(`${k} ${c}: got ${got.get(k)[c]}, sheet ${want[c]}`);
    }
    assert.deepEqual(off, []);
  });

  test("243 of 251 groups match the sheet exactly on all six columns (the other 8: the six exchanged lines and two one-cent discount roundings)", () => {
    let exact = 0;
    for (const [k, want] of wanted) if (COLUMNS.every((c) => Math.abs(got.get(k)[c] - want[c]) < 0.005)) exact += 1;
    assert.equal(exact, 243);
  });

  test("the six exchanged lines kept their Gross but were returned since the sheet was exported", () => {
    for (const k of EXCHANGED_AFTER_SHEET) {
      assert.ok(Math.abs(got.get(k).grossSales - wanted.get(k).grossSales) < 0.0101, k);
      assert.equal(got.get(k).netItemsSold, 0, k);
      assert.ok(wanted.get(k).netItemsSold > 0, k);
    }
  });

  test("the sheet's shipping rows equal our shipping (incl VAT) for all 27 orders", () => {
    const shippingRows = sheet.rows.filter((r) => r.rowType === "shipping");
    const byOrder = new Map();
    for (const r of shippingRows) byOrder.set(r.orderName, (byOrder.get(r.orderName) ?? 0) + r.totalSales);
    assert.equal(byOrder.size, 27);
    for (const [name, total] of byOrder) {
      const order = orders.find((o) => o.name === name);
      assert.equal(orderShipping(order).shippingInclVat, total, name);
    }
  });

  test("shipping excl VAT follows ROUND(shipping / 1.05, 2) on the real orders", () => {
    for (const order of orders) {
      const { shippingInclVat, shippingExclVat } = orderShipping(order);
      assert.equal(shippingExclVat, Math.round((shippingInclVat / 1.05) * 100) / 100);
    }
  });

  test("order totals add up: sum of line totals plus shipping", () => {
    for (const order of orders) {
      const calc = orderCalculation(order);
      const expected = Math.round((sum(calc.lines, (l) => l.totalSales) + calc.shipping.shippingInclVat) * 100) / 100;
      assert.equal(calc.totals.totalSales, expected, order.name);
    }
  });
});
