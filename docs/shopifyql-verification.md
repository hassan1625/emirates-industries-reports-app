# Checking our report numbers against Shopify with ShopifyQL

Run these in the Shopify admin: **Analytics > Reports > Explore / custom report (ShopifyQL editor)**.
Our numbers come from the pipeline job `cmusdpr5b0000v2f6ieizdgo5` (orders created about 3 Aug to 3 Oct 2026, store time zone Asia/Muscat).

## Why Dashboard totals differ

ShopifyQL's `sales` schema records **one event per sale, return or adjustment, each dated by when it happened**. Our report keeps everything on the **original order date** (like the client's sheet). So:

* **Orders** and **shipping** are not affected by timing and should match exactly.
* **Gross / Returns / Net / Taxes / Total** can differ in a month where an exchange or return happened on an order from an earlier month.
* The per-order query (Query 5) removes the timing question completely, so it is the definitive check.

Dimensions used below (all in the `sales` schema): `sales_channel`, `pos_location_name`, `order_name`, `is_sale_adjustment`, `is_sales_reversal`. Metrics: `orders`, `net_items_sold`, `gross_sales`, `discounts`, `sales_reversals`, `net_sales`, `shipping_charges`, `taxes`, `total_sales`.
If a total looks one day short, change `UNTIL 2026-09-30` to `UNTIL 2026-10-01`.

## Query 1: September totals (compare with our September row)

```shopifyql
FROM sales
  SHOW orders, net_items_sold, gross_sales, discounts, sales_reversals,
    net_sales, shipping_charges, taxes, total_sales
  SINCE 2026-09-01 UNTIL 2026-09-30
```

Ours: orders **6,965**, items 26,382, gross 1,519,454.97, discounts -6,026.60, returns 49,501.34, net 1,463,927.03, shipping 23,715.40, taxes 74,378.77, total 1,562,021.20.
Already known from the Dashboard: orders and shipping match exactly; gross, returns, net, taxes, total differ (exchange timing).

## Query 2: how much of September is exchanges and adjustments?

Tests the explanation for the Gross and Returns gap.

```shopifyql
FROM sales
  SHOW gross_sales, discounts, sales_reversals, net_sales, taxes, total_sales
  GROUP BY is_sale_adjustment, is_sales_reversal WITH TOTALS
  SINCE 2026-09-01 UNTIL 2026-09-30
```

Read the rows like this: `is_sales_reversal = true` rows are returns (Shopify's returns total was 114,507.26). `is_sale_adjustment = true` with `is_sales_reversal = false` rows are items **added** after the order was placed (exchange replacements). If adjustments have gross of about **68k** and reversals of about **114k**, the gap to our order-date numbers (68,327 and 65,006) is fully explained.

## Query 3: September by sales channel

```shopifyql
FROM sales
  SHOW orders, gross_sales, discounts, sales_reversals, net_sales,
    shipping_charges, taxes, total_sales
  WHERE sales_channel IS NOT NULL
  GROUP BY sales_channel WITH TOTALS
  SINCE 2026-09-01 UNTIL 2026-09-30
  ORDER BY total_sales DESC
```

Orders and shipping per channel should match our preview's channel table for September (use the preview's *By day* rows, or ask me for a September-only breakdown).

## Query 4: September by POS location

```shopifyql
FROM sales
  SHOW orders, gross_sales, discounts, sales_reversals, net_sales,
    shipping_charges, taxes, total_sales
  GROUP BY pos_location_name WITH TOTALS
  SINCE 2026-09-01 UNTIL 2026-09-30
  ORDER BY total_sales DESC
```

Note: Shopify leaves `pos_location_name` empty for Online Store and Mobile App orders; we report those under the Head office location (client-confirmed).

## Query 5: the definitive check, 27 specific orders over their whole life

Looks up exactly these orders and adds up **every event on them, whenever it happened**, so exchange and return timing cannot matter. Our values for the same orders are in the table below.

```shopifyql
FROM sales
  SHOW orders, net_items_sold, gross_sales, discounts, sales_reversals,
    net_sales, shipping_charges, taxes, total_sales
  WHERE order_name IN ('#23430', '#23472', '#23556', '#23451', '#23542', '#23591', '#24116', '#26160', '#33643', '#23423', '#23444', '#23458', '#23437', '#23465', '#23647', '#23752', '#23507', '#23724', '#24249', '#37647', '#41315', '#46516', '#23416', '#23479', '#23514', '#23493', '#23535')
  GROUP BY order_name WITH TOTALS
  SINCE 2025-01-01 UNTIL today
  ORDER BY order_name
```

Orders were chosen to cover every case: plain POS, discount code, manual POS discount, online with paid shipping, online free shipping, Mobile App, partly returned, fully returned, exchange, and large orders. All were created between 12 and 31 Aug 2026, so they have settled.

### Our values (lifetime per order)

| Category | Order | Date | Items | Gross | Discounts | Returns | Net | Shipping | Taxes | Total |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| POS, no discount, 1-2 lines | #23430 | 2026-08-12 | 3 | 72.24 | 0.00 | 0.00 | 72.24 | 0.00 | 3.61 | 75.85 |
| POS, no discount, 1-2 lines | #23472 | 2026-08-12 | 2 | 124.00 | 0.00 | 0.00 | 124.00 | 0.00 | 6.20 | 130.20 |
| POS, no discount, 1-2 lines | #23556 | 2026-08-12 | 2 | 74.00 | 0.00 | 0.00 | 74.00 | 0.00 | 3.70 | 77.70 |
| Discount code | #23451 | 2026-08-12 | 3 | 102.00 | -10.20 | 0.00 | 91.80 | 20.95 | 5.64 | 118.39 |
| Discount code | #23542 | 2026-08-12 | 1 | 68.00 | -6.80 | 0.00 | 61.20 | 20.95 | 4.11 | 86.26 |
| Discount code | #23591 | 2026-08-12 | 2 | 68.00 | -6.80 | 0.00 | 61.20 | 20.95 | 4.11 | 86.26 |
| Manual POS discount | #24116 | 2026-08-12 | 4 | 317.00 | -31.70 | 0.00 | 285.30 | 0.00 | 14.27 | 299.57 |
| Manual POS discount | #26160 | 2026-08-15 | 9 | 658.24 | -65.82 | 0.00 | 592.42 | 0.00 | 29.62 | 622.04 |
| Manual POS discount | #33643 | 2026-08-23 | 11 | 976.25 | -146.44 | 0.00 | 829.81 | 0.00 | 41.49 | 871.30 |
| Online, shipping charged | #23423 | 2026-08-12 | 4 | 329.00 | 0.00 | 0.00 | 329.00 | 20.95 | 17.50 | 367.45 |
| Online, shipping charged | #23444 | 2026-08-12 | 6 | 290.00 | 0.00 | 0.00 | 290.00 | 20.95 | 15.55 | 326.50 |
| Online, shipping charged | #23458 | 2026-08-12 | 4 | 180.00 | 0.00 | 0.00 | 180.00 | 20.95 | 10.05 | 211.00 |
| Online, free shipping | #23437 | 2026-08-12 | 11 | 510.00 | 0.00 | 0.00 | 510.00 | 0.00 | 25.50 | 535.50 |
| Online, free shipping | #23465 | 2026-08-12 | 5 | 338.00 | 0.00 | 0.00 | 338.00 | 0.00 | 16.90 | 354.90 |
| Mobile App | #23647 | 2026-08-12 | 7 | 430.00 | 0.00 | 0.00 | 430.00 | 0.00 | 21.50 | 451.50 |
| Mobile App | #23752 | 2026-08-12 | 4 | 136.00 | -13.60 | 0.00 | 122.40 | 20.95 | 7.17 | 150.52 |
| Partly returned line | #23507 | 2026-08-12 | 10 | 671.48 | 0.00 | 287.00 | 384.48 | 0.00 | 19.22 | 403.70 |
| Partly returned line | #23724 | 2026-08-12 | 4 | 360.00 | 0.00 | 59.00 | 301.00 | 0.00 | 15.05 | 316.05 |
| Partly returned line | #24249 | 2026-08-12 | 11 | 665.00 | 0.00 | 171.00 | 494.00 | 0.00 | 24.70 | 518.70 |
| Fully returned order | #37647 | 2026-08-26 | 0 | 579.24 | 0.00 | 579.24 | 0.00 | 0.00 | 0.00 | 0.00 |
| Fully returned order | #41315 | 2026-08-28 | 0 | 158.00 | 0.00 | 158.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Fully returned order | #46516 | 2026-08-31 | 0 | 103.00 | 0.00 | 103.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Exchange (returned + other lines kept) | #23416 | 2026-08-12 | 6 | 661.00 | 0.00 | 125.00 | 536.00 | 0.00 | 26.80 | 562.80 |
| Exchange (returned + other lines kept) | #23479 | 2026-08-12 | 4 | 260.24 | 0.00 | 68.00 | 192.24 | 0.00 | 9.61 | 201.85 |
| Exchange (returned + other lines kept) | #23514 | 2026-08-12 | 20 | 1160.00 | 0.00 | 92.00 | 1068.00 | 0.00 | 53.40 | 1121.40 |
| Large order (8+ lines) | #23493 | 2026-08-12 | 13 | 515.24 | 0.00 | 0.00 | 515.24 | 0.00 | 25.76 | 541.00 |
| Large order (8+ lines) | #23535 | 2026-08-12 | 28 | 1234.72 | 0.00 | 0.00 | 1234.72 | 0.00 | 61.73 | 1296.45 |
| **Sum** | | | 174 | 11040.65 | -281.36 | 1642.24 | 9117.05 | 146.65 | 463.19 | 9726.89 |

Compare per order: Shopify's `gross_sales`, `discounts`, `sales_reversals`, `net_sales`, `shipping_charges`, `taxes` and `total_sales` against our columns. Differences of **0.01** on a discounted line are expected (Shopify rounds discounts differently on some lines). Anything larger: send me the order name and both rows.

## Results so far (run by the client's developer on 2026-10-04)

* **Query 1** equals the Dashboard exactly (so ShopifyQL and the Dashboard agree with each other).
* **Query 2:** `is_sale_adjustment = Yes` rows exist only together with `is_sales_reversal = Yes` (+2,253.63 in September); they carry no gross. So exchange replacements are ordinary sale rows, not adjustment rows, and this query cannot isolate them.
* **Query 3:** orders and shipping match ours exactly in every channel. Net sales differ: Point of Sale higher in Shopify by 16,052, Mobile App lower by 7,655, Online Store lower by 5,376, Draft Orders identical (516.51).
* **Query 5:** over 27 orders, shipping (146.65), taxes (463.19) and net items (174) are identical. Gross and discounts differ by 0.09 in total (cents on discounted orders). Returns differ by 7.35, all from order **#23416** (exchange, refund 0.00): Shopify keeps 7.35 of net sales on it that is on no line item. The other four partial-return and exchange orders match to the cent.

## Conclusion (2026-10-04)

* Order #23416, inspected in Shopify: an exchange where the returned item (131.25) was worth more than the replacement (123.90). Shopify records the 7.35 left over as a `REFUND_DISCREPANCY` order adjustment and counts it as sales kept. The order's own current total (562.80) equals our figure; only ShopifyQL adds the 7.35 (570.15).
* Payment check over 37,010 orders: 40 orders have net payment above current total, all of them with a refund and none without; total 4,172.33 (Aug 1,719.19, Sep 2,453.14 vs Shopify's 2,253.63). Negative gaps total -0.14. So the gap is detectable at order level, but it is about 0.03% of sales and is not included in our report.
* Explained September Net gap (3,022): about 2,250-2,450 retained exchange credit, the rest exchange/return timing across month boundaries, plus cents of discount rounding.

## Query 6: online and mobile orders with returns (the channels where Query 3 differs most)

Same query as Query 5 with this list. Created 1 to 14 Sep 2026.

```shopifyql
FROM sales
  SHOW orders, net_items_sold, gross_sales, discounts, sales_reversals,
    net_sales, shipping_charges, taxes, total_sales
  WHERE order_name IN ('#47352', '#48927', '#50835', '#52260', '#48459', '#48744', '#49470', '#49998', '#47343', '#47346', '#47988', '#47340', '#47349', '#47355')
  GROUP BY order_name WITH TOTALS
  SINCE 2025-01-01 UNTIL today
  ORDER BY order_name
```

### Our values (lifetime per order)

| Category | Order | Date | Items | Gross | Discounts | Returns | Net | Shipping | Taxes | Total |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Online, partly/fully returned | #47352 | 2026-09-01 | 1 | 164.00 | 0.00 | 82.00 | 82.00 | 20.95 | 5.15 | 108.10 |
| Online, partly/fully returned | #48927 | 2026-09-03 | 4 | 450.00 | 0.00 | 138.00 | 312.00 | 20.95 | 16.65 | 349.60 |
| Online, partly/fully returned | #50835 | 2026-09-07 | 5 | 473.00 | 0.00 | 69.00 | 404.00 | 0.00 | 20.20 | 424.20 |
| Online, partly/fully returned | #52260 | 2026-09-13 | 5 | 318.00 | 0.00 | 80.00 | 238.00 | 20.95 | 12.95 | 271.90 |
| Mobile App, partly/fully returned | #48459 | 2026-09-02 | 6 | 319.00 | -23.29 | 32.40 | 263.31 | 20.95 | 14.21 | 298.47 |
| Mobile App, partly/fully returned | #48744 | 2026-09-02 | 2 | 312.00 | -31.20 | 140.40 | 140.40 | 20.95 | 8.07 | 169.42 |
| Mobile App, partly/fully returned | #49470 | 2026-09-05 | 4 | 435.00 | 0.00 | 150.00 | 285.00 | 20.95 | 15.30 | 321.25 |
| Mobile App, partly/fully returned | #49998 | 2026-09-06 | 4 | 374.00 | 0.00 | 187.00 | 187.00 | 20.95 | 10.40 | 218.35 |
| Online / Mobile, discounted, no return | #47343 | 2026-09-01 | 11 | 992.00 | -99.20 | 0.00 | 892.80 | 20.95 | 45.69 | 959.44 |
| Online / Mobile, discounted, no return | #47346 | 2026-09-01 | 6 | 466.00 | -46.60 | 0.00 | 419.40 | 20.95 | 22.02 | 462.37 |
| Online / Mobile, discounted, no return | #47988 | 2026-09-01 | 2 | 134.00 | -13.40 | 0.00 | 120.60 | 20.95 | 7.08 | 148.63 |
| Online / Mobile, plain | #47340 | 2026-09-01 | 4 | 142.00 | 0.00 | 0.00 | 142.00 | 20.95 | 8.15 | 171.10 |
| Online / Mobile, plain | #47349 | 2026-09-01 | 2 | 174.00 | 0.00 | 0.00 | 174.00 | 20.95 | 9.75 | 204.70 |
| Online / Mobile, plain | #47355 | 2026-09-01 | 5 | 297.00 | 0.00 | 0.00 | 297.00 | 20.95 | 15.90 | 333.85 |
| **Sum** | | | 61 | 5050.00 | -213.69 | 878.80 | 3957.51 | 272.35 | 211.52 | 4441.38 |
