# Emirates Industries — Custom Shopify Reporting App
## Development Plan for Claude Code

---

## How to use this file

This file is the complete spec and step-by-step build plan for this project. Do not ask for scope clarification on anything already defined below — it has been validated with the client field-by-field.

**Execution rule: implement ONE numbered step at a time, then stop.** After completing a step, summarize what was built/changed and wait for explicit approval before starting the next step. Do not batch multiple steps together even if the next step seems obvious or small.

---

## 1. Project Overview

Build a custom Shopify application for Emirates Industries that consolidates order, POS, product, collection, and inventory data — currently spread across separate native Shopify screens — into five exportable reports. The client is on Shopify's **Basic/Grow plan (not Plus)**, so ShopifyQL/Notebooks are unavailable; all data access goes through the standard **Admin GraphQL API** and **Bulk Operations API**.

The app is a **custom (private) distribution app** — installed only on the Emirates Industries store, not listed publicly.

---

## 2. Tech Stack

- **Framework:** React Router (Shopify's current recommended app framework, via Shopify CLI template)
- **Database:** PostgreSQL via Prisma (not the default SQLite)
- **Hosting:** AWS (App Runner or ECS Fargate) or a client-provided server capable of running a persistent Node.js/Docker process with a stable domain + SSL — not compatible with shared/cPanel hosting
- **File storage:** Amazon S3
- **Email:** **Resend** (not AWS SES)
- **Shopify data access:** Admin GraphQL API + Bulk Operations API
- **Dev tools:** Shopify CLI, Git

---

## 3. Locked Business Rules & Formulas

These are final, client-confirmed. Do not deviate or "improve" on them.

- **Unit Price Before VAT** = `Variant Price ÷ 1.05` — **unrounded**.
- **Shipping Charges (excl. VAT)** = `ROUND(Shipping Charges ÷ 1.05, 2)` — rounded to 2 decimal places. Rounding applies **only** to shipping, not to the unit price calculation above.
- **Total Sales** = `Net Sales + Shipping + Taxes` (confirmed against the client's own Shopify dashboard screenshot).
- **Net Sales** = `Gross Sales − Discounts − Returns`.
- **Gross Sales** = `Σ(original unit price × quantity)`.
- **Net Items Sold** = quantity ordered − quantity returned.
- **Shipping Charges and Payment Method are shown once per order**, not repeated per line item (client-confirmed).
- **Each product belongs to exactly one Shopify collection** — no multi-collection deduplication logic needed anywhere.
- **Online Store and Mobile App orders are mapped to the POS location "Emirates Industries LLC Al Quoz"** for all location-based reporting. This must be a **configurable mapping table**, not a hardcoded string, so it can be extended if more physical locations are added later.
- **Discount Code** is confirmed available via `Order.discountApplications` for both online and POS sales.
- **Discount Reason** (POS) is **not a documented Shopify API field**. Attempt to resolve it via a real POS test transaction during Milestone 2 (see step 15). If a usable field is found, implement it. If not, leave that column populated by Discount Code only. This has **zero impact on scope, price, or timeline** either way — do not treat this as a blocker.
- **Return Reason** is confirmed available via `ReturnLineItem.returnReason` (Shopify's Returns API) since the client processes returns through Shopify POS's formal Returns flow, not plain refunds. Note: this field is marked deprecated in the newest Admin API version but is currently functional — use it as-is.
- **Reports are delivered as XLSX only, never CSV** — CSV cannot support cell highlighting/conditional formatting, which is required for the Stock Report.
- **No in-app charts, graphs, or dashboards** — every report is a generated file, downloaded or emailed. Do not build any data visualization.

---

## 4. Field & Filter Schema

### 4a. Shared dimensions/metrics (define once, reference from every report that uses them)

| Shared item | Used by | Notes |
|---|---|---|
| **Collection Name** | R1, R2, R3, R4 (also a filter in R1, R2, R3-optional, R5) | Single collection per product — simple 1:1 join |
| **Location Name** | R1, R2, R3, R4 (also a filter in R1, R2, R5) | Includes real POS locations + the Al Quoz online/mobile mapping |
| **Date Range** | All 5 reports (as a filter) | Needs a `mode` property: `single` (R1, R4 — plain range) vs `yearly-pair` (R3, R5 — auto-calculated prior year by default, with manual override) |
| **SKU / Barcode / Product Title** | R1, R2, R5 | |
| **Total Sales** | R1, R3, R4 | One calculation function (see §3), called from all three reports — do not reimplement per report |
| **Difference (value + %)** | R3, R5 | Shared calculation helper, not a schema dimension — reused between the two "yearly comparison" reports |

### 4b. Report 1 — General Sales Report (Phase 1)

**All 21 fields, ALL selected by default, individually toggleable, with a "Select All" control:**
Order Name, Order Date, Sales Channel, POS Location, POS Staff, Collection Name, Product Title, Product Variant SKU, Product Variant Barcode, Product Variant Price, Unit Price Before VAT, Net Items Sold, Gross Sales, Discounts, Discount Code/Reason, Net Sales, Shipping Charges (excl. VAT), Payment Method, Taxes, Return Reason, Total Sales.

**Filters:** Date Range (mandatory, `single` mode), Sales Channel, POS Location, POS Staff, Collection Name.

### 4c. Report 2 — Stock Report by Location (Phase 2)

**Fields:** Location Name (fixed header value, not a column), Collection Name (**always a column**, regardless of how many collections are selected — this avoids conditional layout logic), Product Name, SKU, Barcode, Stock Committed, Stock Available, Stock On Hand.

**Filters:** Location (single-select, drives the header), Collection, Tag.

**Formatting rule:** rows where **Available ≤ 5** get a **red** highlight — this requires XLSX conditional formatting.

### 4d. Report 3 — Sales Comparison Report, Yearly (Phase 2)

Two sub-reports, same underlying Total Sales calculation:
- **3A — By Collection:** Collection Name, Total Sales Year 1, Total Sales Year 2, Difference (value + %).
- **3B — By Location:** Location Name, Total Sales Year 1, Total Sales Year 2, Difference (value + %).

**Filters:** Date Range (`yearly-pair` mode, auto-calc prior year + manual override), Collection (optional, applies to both sub-reports).

### 4e. Report 4 — Total Sales Report by Date Range (Phase 2)

A **dynamic pivot matrix**: Collections in rows, Locations in columns (merged header spanning location columns), using the shared Total Sales calculation.

- Row totals (per collection) at the end of each row.
- Column totals (per location) at the end of each column.
- Grand total in the corner.
- Collections/locations generated **dynamically** from whatever had sales in the selected range — never a hardcoded list.

**Filters:** Date Range only (`single` mode).

### 4f. Report 5 — Quantity Report for SKU, Yearly (Phase 2)

**Fields:** SKU, Barcode, Quantity Sold Last Year, Quantity Sold Current Year, Difference (value + %).

**Filters:** Location, Collection (**filters only — never output columns**), Date Range (`yearly-pair` mode).

**Rule:** every SKU is shown regardless of whether it had sales in either year — zero-sales SKUs are included, not excluded.

---

## 5. Development Steps

Implement one step at a time. Stop after each and wait for approval.

### Milestone 1 — Project Foundation

1. Scaffold the app using the Shopify CLI React Router template.
2. Configure `shopify.app.toml`: app name, custom distribution, access scopes (`read_orders`, `read_all_orders`, `read_products`).
3. Set up Prisma with PostgreSQL. Models: `Session` (Shopify OAuth) and `ReportJob` (fields: shop, report type, stage, orders bulk-op ID, products bulk-op ID, result file URL, created/updated timestamps).
4. Set up environment config: AWS credentials (S3 bucket, RDS connection string) and a Resend API key.
5. Note for the user (not a code step): submit the `read_all_orders` protected-data access request via Partner Dashboard — this runs in parallel with development and is not blocked by it.
6. Note for the user (not a code step): app creation/configuration in Partner Dashboard and installing the finished app on the live store are manual actions outside this codebase.

### Milestone 1a — Shared Field & Filter Schema

7. Create a single schema config file defining every shared dimension/metric from §4a (Collection Name, Location Name, Date Range with `mode`, SKU, Barcode, Product Title, Total Sales) — including data source and calculation reference for each.
8. Create per-report config files (R1–R5) that reference the shared schema items plus each report's own unique fields/filters, per §4b–§4f.
9. Confirm both the future UI and backend will read from these configs — no field or filter list should ever be hardcoded a second time elsewhere in the codebase.

### Milestone 1b — Test Fixtures (build before touching live Shopify data)

10. Convert the client's sample General Report CSV and Stock Report XLSX (already validated) into test fixture files.
11. Write unit tests for every formula in §3 (VAT, shipping, gross/net/total sales, net items sold) against these fixtures, so calculation correctness is verified independently of the live Bulk Operations pipeline.
12. Build a webhook-simulation utility (a CLI command or test route) that feeds a fake `BULK_OPERATIONS_FINISH` payload into the job-handling code, since real webhook delivery requires a publicly reachable HTTPS endpoint that isn't available in normal local development. Use this to test the job-chaining logic in Milestone 2 without needing a live tunnel on every run.

### Milestone 2 — Bulk Data Pipeline

13. Build the orders + line items Bulk Operations query (`groupObjects: true`, scoped to the selected date range): order name, createdAt, sourceName, retailLocation, staffMember, discountApplications, shippingLines, paymentGatewayNames; nested line items with title, sku, variant.barcode, quantity, originalUnitPriceSet, discountAllocations, taxLines, product.id, staffMember.
14. Build `app/routes/webhooks.bulk-operations-finish.tsx`: verify via `authenticate.webhook`, extract `admin_graphql_api_id`, follow up with a `node(id:)` query for `status`/`url`/`errorCode`. Test using the Milestone 1b webhook simulator before testing against a live store.
15. Implement job-state chaining: on orders-export completion, download/parse the JSONL, then kick off the products + collections bulk query (id, title, collections).
16. Implement a fallback poller for jobs stuck running past a timeout, in case a webhook is dropped (Shopify does not guarantee webhook delivery).
17. Build return-reason extraction via the Returns API (`ReturnLineItem.returnReason`).
18. Test Discount Reason against a real POS test transaction on the client's dev/live store. Implement if a usable field is found; otherwise leave the Discount Code column standing alone. Document the outcome either way.

### Milestone 3 — Join, Calculations & Business Rules

19. Build the product→collection join (confirmed 1:1 — no dedup logic).
20. Build the configurable location-mapping table (Online Store / Mobile App → "Emirates Industries LLC Al Quoz") as data, not a hardcoded string.
21. Implement the §3 calculation layer as standalone, reusable functions (not inlined into report-specific code) — Phase 2 reports 3 and 4 will call the same Total Sales function built here.
22. Run the Milestone 1b unit tests against real pipeline output to confirm the live calculations match the fixture-verified formulas.
23. Assemble the final 21-column row set per order line item for Report 1.

### Milestone 4 — Filters, Field Selection & Report UI

24. Build the Report 1 request screen (Polaris components), rendering filters and fields from the Milestone 1a schema. This can be built and tested against mock/fixture data before Milestone 2–3 are fully complete.
25. Build the dynamic field-selection UI: "Select All" + individual checkboxes, all 21 fields on by default.
26. Wire the UI's filter/field selections to trigger the real backend pipeline, replacing mock data — this is the integration point joining Milestones 2–4.

### Milestone 5 — Report Generation, Delivery & Status

27. Build XLSX generation from the joined/computed dataset.
28. Upload the generated file to S3.
29. Build the in-app download button and status indicator (processing → ready). **Get this working and tested before building email delivery** — this is how report correctness gets validated throughout development, by direct download.
30. Build frontend polling: if the job finishes while the user is still on the page, show the download button immediately — no email needed for that case.
31. Build the email step using Resend: regardless of how fast the job finished, send a download-link email once the file is ready — this is the reliable fallback for closed tabs or longer-running jobs.
32. Confirm no timeouts anywhere in the pipeline against a large dataset (8,000+ rows, matching the client's real sample volume).

### Milestone 6 — Testing & Deployment (Phase 1 close-out)

33. Full QA: real order volumes, multiple sales channels, refunds/returns, every formula in §3.
34. Confirm final Discount Reason outcome from Milestone 2, step 18.
35. Deploy to AWS (App Runner/ECS + RDS + S3) or the client's server, per final hosting decision.
36. Write handoff documentation for using the report screen.

---

## Phase 2 — Additional Reports

Reuses Milestone 1, 1a, 1b, and 2's foundation entirely — app auth, shared schema, Bulk Operations pipeline, job-state model, S3/Resend delivery, and the Total Sales calculation function. **Do not rebuild any of this.**

### Milestone 7 — Stock Report by Location

37. Build the inventory data pipeline: `InventoryLevel`/`InventoryItem` query for on-hand, committed, available, joined to product/collection/barcode via the shared schema.
38. Build the report layout per §4c: Location Name as a fixed header, Collection Name always as a column before Product Name.
39. Implement location/collection/tag filters.
40. Implement XLSX conditional formatting: red highlight where Available ≤ 5.

### Milestone 8 — Sales Comparison Report (Yearly)

41. Build the collection-wise view (§4d, 3A) using the shared Total Sales function.
42. Build the location-wise view (§4d, 3B).
43. Build year-over-year date logic using the shared Date Range `yearly-pair` mode.
44. Implement the optional Collection filter across both sub-reports.

### Milestone 9 — Total Sales Report by Date Range

45. Build the dynamic Collection × Location pivot matrix (§4e) using shared Collection/Location/Total-Sales logic.
46. Implement row totals, column totals, grand total.
47. Implement the merged-header layout for the location column group.

### Milestone 10 — Quantity Report for SKU (Yearly)

48. Build the SKU/barcode quantity aggregation (§4f) using shared SKU/Barcode/Date-Range schema entries.
49. Implement Location/Collection as filters only.
50. Confirm zero-sales SKUs are included, not excluded.

### Milestone 11 — Final QA & Handover

51. Regression QA across all five reports together.
52. Full documentation and handover.

---

## 6. Things NOT to build

- No AWS SES — email is Resend only.
- No CSV output anywhere — XLSX only.
- No in-app charts, graphs, or dashboards.
- No public Shopify App Store listing — this is a custom/private distribution app.
- No second, non-Bulk-Operations data-fetching path "for speed" — the single pipeline plus the polling/email notification logic in Milestone 5 already covers the fast-vs-slow UX without a second implementation to maintain.
- No hardcoded field/filter lists outside the Milestone 1a schema.
- No collection-deduplication logic — each product has exactly one collection.
