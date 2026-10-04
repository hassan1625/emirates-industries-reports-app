import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPreviewAccumulator } from "../app/pipeline/report-preview.js";

const row = (over = {}) => {
  const { meta, ...values } = over;
  return {
    values: { orderDate: "2026-09-05 10:00:00", posLocation: "Al Ain", salesChannel: "Point of Sale", collectionName: "Boys", netItemsSold: 1, grossSales: 100, discounts: 0, netSales: 100, shippingCharges: null, taxes: 5, totalSales: 105, ...values },
    meta: { orderId: "O1", kind: "line", ...meta },
  };
};
const run = (rows, options) => {
  const acc = createPreviewAccumulator(options);
  rows.forEach((r) => acc.add(r));
  return acc.result();
};

describe("totals", () => {
  test("sums every money column and derives Returns = Gross + Discounts - Net", () => {
    const { totals } = run([row({ grossSales: 100, discounts: -10, netSales: 80, taxes: 4, totalSales: 84 })]);
    assert.deepEqual(totals, { orders: 1, lineRows: 1, shippingRows: 0, itemsSold: 1, gross: 100, discounts: -10, returns: 10, net: 80, shipping: 0, taxes: 4, total: 84 });
  });

  test("orders are counted once however many rows they have", () => {
    const { totals } = run([row({ meta: { orderId: "A" } }), row({ meta: { orderId: "A" } }), row({ meta: { orderId: "B" } })]);
    assert.equal(totals.orders, 2);
    assert.equal(totals.lineRows, 3);
  });

  test("a shipping row adds shipping and total but no extra order", () => {
    const { totals } = run([row({ meta: { orderId: "A" } }), row({ meta: { orderId: "A", kind: "shipping" }, grossSales: 0, netSales: 0, netItemsSold: 0, shippingCharges: 20.95, taxes: 1.05, totalSales: 22 })]);
    assert.equal(totals.orders, 1);
    assert.equal(totals.shippingRows, 1);
    assert.equal(totals.shipping, 20.95);
    assert.equal(totals.total, 127);
  });

  test("many small amounts do not drift (0.1 added 10,000 times is 1000.00)", () => {
    const rows = Array.from({ length: 10000 }, (_, i) => row({ meta: { orderId: `O${i}` }, grossSales: 0.1, netSales: 0.1, taxes: 0, totalSales: 0.1 }));
    const { totals } = run(rows);
    assert.equal(totals.gross, 1000);
    assert.equal(totals.total, 1000);
  });

  test("an empty stream gives zeros", () => {
    assert.equal(run([]).totals.total, 0);
    assert.equal(run([]).byMonth.length, 0);
  });
});

describe("groupings", () => {
  const rows = [
    row({ meta: { orderId: "A" }, orderDate: "2026-08-31 23:00:00", posLocation: "Al Ain", salesChannel: "Point of Sale", collectionName: "Boys", totalSales: 10 }),
    row({ meta: { orderId: "B" }, orderDate: "2026-09-01 00:10:00", posLocation: "Head office", salesChannel: "Online Store", collectionName: "Girls", totalSales: 20 }),
    row({ meta: { orderId: "B" }, orderDate: "2026-09-01 00:10:00", posLocation: "Head office", salesChannel: "Online Store", collectionName: "Boys", totalSales: 5 }),
    row({ meta: { orderId: "C" }, orderDate: "2026-09-02 09:00:00", posLocation: null, salesChannel: "Draft Orders", collectionName: null, totalSales: 1 }),
  ];
  const result = run(rows);

  test("by month and by day use the order date already in store time", () => {
    assert.deepEqual(result.byMonth.map((m) => [m.key, m.orders, m.total]), [["2026-08", 1, 10], ["2026-09", 2, 26]]);
    assert.deepEqual(result.byDay.map((d) => d.key), ["2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  test("by location counts orders; a missing location is labelled", () => {
    const byKey = Object.fromEntries(result.byLocation.map((l) => [l.key, l]));
    assert.equal(byKey["Head office"].orders, 1);
    assert.equal(byKey["Head office"].total, 25);
    assert.equal(byKey["(no location)"].total, 1);
  });

  test("by channel", () => {
    assert.deepEqual(result.byChannel.map((c) => c.key).sort(), ["Draft Orders", "Online Store", "Point of Sale"]);
  });

  test("by collection counts rows; no collection and shipping rows are labelled", () => {
    const withShipping = run([...rows, row({ meta: { orderId: "C", kind: "shipping" }, collectionName: null, totalSales: 22, shippingCharges: 20.95 })]);
    const byKey = Object.fromEntries(withShipping.byCollection.map((c) => [c.key, c]));
    assert.equal(byKey.Boys.lineRows, 2);
    assert.equal(byKey["(no collection)"].lineRows, 1);
    assert.equal(byKey["(shipping rows)"].shippingRows, 1);
  });

  test("location, channel and collection are sorted by Total Sales, largest first", () => {
    assert.equal(result.byLocation[0].key, "Head office");
  });

  test("group totals add up to the overall total", () => {
    for (const group of ["byMonth", "byDay", "byLocation", "byChannel", "byCollection"]) {
      const sum = Math.round(result[group].reduce((s, g) => s + g.total * 100, 0)) / 100;
      assert.equal(sum, result.totals.total, group);
    }
  });
});

describe("sample", () => {
  test("keeps the first N rows' values", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ meta: { orderId: `O${i}` }, sku: `S${i}` }));
    assert.deepEqual(run(rows, { sampleSize: 3 }).sample.map((v) => v.sku), ["S0", "S1", "S2"]);
  });
});
