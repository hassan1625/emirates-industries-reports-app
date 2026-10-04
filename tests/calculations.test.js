import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unitPriceBeforeVat, shippingExclVat, grossSales, netSales, netItemsSold, totalSales } from "../app/calculations/sales.js";
import { difference } from "../app/calculations/difference.js";
import { round2 } from "../app/calculations/money.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const general = fixture("general-report.json");
const lines = general.rows.filter((r) => r.rowType === "line");
const shippingRows = general.rows.filter((r) => r.rowType === "shipping");

// Shopify rounds discount allocations per line, so discounted lines can be
// off by one cent from the exact formula.
const near = (actual, expected, tol = 0.0101) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

describe("unit formulas", () => {
  test("unitPriceBeforeVat is price ÷ 1.05 and NOT rounded to cents", () => {
    assert.equal(unitPriceBeforeVat(105), 100);
    assert.ok(Math.abs(unitPriceBeforeVat(0.25) - 0.25 / 1.05) < 1e-9);
    assert.notEqual(unitPriceBeforeVat(0.25), 0.24); // would be 0.24 if rounded to cents
    assert.equal(unitPriceBeforeVat(0.25), 0.2380952381);
  });

  test("unitPriceBeforeVat has no floating-point noise (91.35 / 1.05 is exactly 87)", () => {
    assert.equal(91.35 / 1.05, 86.99999999999999); // what plain JavaScript gives
    assert.equal(unitPriceBeforeVat(91.35), 87);
    assert.equal(unitPriceBeforeVat(37.8), 36);
    assert.equal(unitPriceBeforeVat(13.2), 12.5714285714);
  });

  test("shippingExclVat rounds to 2 decimals", () => {
    assert.equal(shippingExclVat(22), 20.95); // 20.952...
    assert.equal(shippingExclVat(10.5), 10);
    assert.equal(shippingExclVat(0), 0);
  });

  test("round2 rounds half away from zero, tolerant of float error", () => {
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(-1.005), -1.01);
    assert.equal(round2(2.675), 2.68);
  });

  test("netItemsSold = ordered − returned", () => {
    assert.equal(netItemsSold(3, 1), 2);
    assert.equal(netItemsSold(2, 2), 0);
    assert.equal(netItemsSold(4), 4);
  });

  test("netSales = gross − discounts − returns", () => {
    assert.equal(netSales(90.01, 9.01), 81);
    assert.equal(netSales(68, 0, 68), 0);
    assert.equal(netSales(100), 100);
  });

  test("totalSales = net + shipping + taxes", () => {
    assert.equal(totalSales(87, 0, 4.35), 91.35);
    assert.equal(totalSales(0, 20.95, 1.05), 22);
  });
});

describe("difference", () => {
  test("value and percent", () => {
    assert.deepEqual(difference(150, 100), { value: 50, percent: 50 });
    assert.deepEqual(difference(50, 100), { value: -50, percent: -50 });
    assert.deepEqual(difference(100, 100), { value: 0, percent: 0 });
  });
  test("previous of 0 gives null percent, not Infinity", () => {
    assert.deepEqual(difference(10, 0), { value: 10, percent: null });
    assert.deepEqual(difference(0, 0), { value: 0, percent: null });
  });
});

describe("General Report fixture (client's sample)", () => {
  test("fixture loaded", () => {
    assert.equal(general.rows.length, 278);
    assert.equal(lines.length + shippingRows.length, 278);
  });

  test("Gross Sales = price × qty ÷ 1.05 on every line with items sold", () => {
    const sold = lines.filter((r) => r.netItemsSold > 0);
    assert.ok(sold.length > 200);
    for (const r of sold) near(grossSales(r.variantPrice, r.netItemsSold), r.grossSales);
    // undiscounted lines match exactly
    for (const r of sold.filter((x) => x.discounts === 0)) {
      assert.equal(grossSales(r.variantPrice, r.netItemsSold), r.grossSales, `${r.orderName} ${r.sku}`);
    }
  });

  test("Net Sales = Gross − Discounts on every line (discounts stored negative in the sheet)", () => {
    for (const r of lines.filter((x) => x.netItemsSold > 0)) {
      assert.equal(netSales(r.grossSales, -r.discounts), r.netSales, `${r.orderName} ${r.sku}`);
    }
  });

  test("fully returned lines: net items 0 and net sales 0 despite gross", () => {
    const returned = lines.filter((r) => r.netItemsSold === 0 && r.grossSales > 0);
    assert.ok(returned.length > 0);
    for (const r of returned) {
      assert.equal(netSales(r.grossSales, -r.discounts, r.grossSales), 0);
      assert.equal(r.netSales, 0);
      assert.equal(r.totalSales, 0);
    }
  });

  test("Total Sales = Net + Taxes on every line (shipping is on its own row)", () => {
    for (const r of lines) {
      assert.equal(totalSales(r.netSales, 0, r.taxes), r.totalSales, `${r.orderName} ${r.sku}`);
    }
  });

  test("taxes are 5% of net sales (±0.01)", () => {
    for (const r of lines) near(r.netSales * 0.05, r.taxes);
  });

  test("shipping rows: Total = ROUND(Total ÷ 1.05, 2) + taxes, or 0 for free shipping", () => {
    assert.ok(shippingRows.length > 0);
    for (const r of shippingRows) {
      assert.equal(r.netSales, 0);
      if (r.totalSales === 0) {
        assert.equal(r.taxes, 0);
        continue;
      }
      const shippingInclVat = r.totalSales; // sheet leaves Shipping Charges blank
      assert.equal(totalSales(0, shippingExclVat(shippingInclVat), r.taxes), r.totalSales);
    }
  });
});
