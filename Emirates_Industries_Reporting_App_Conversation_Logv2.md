# Emirates Industries — Custom Shopify Reporting App
## Full Conversation Log & Decision Record

---

## 1. Initial Problem & Technical Feasibility Discussion

The client shared a report structure that Shopify's native Dashboard cannot produce in a single report. Requested fields:

Order name, Order Date, Sales Channel, POS Location, POS Staff, Collection Name, Product title, Product variant SKU at time of sale, Product variant price, Net items sold, Gross sales, Discounts, Net sales, Taxes, Total sales.

**Two architectural paths identified:**

- **Option A — ShopifyQL** (`sales` schema via GraphQL Admin API `shopifyqlQuery`): near-exact field match, but **Plus-only**, requires `read_reports` scope + Level-2 Protected Customer Data approval (friction even for non-PII queries per developer reports).
- **Option B — Raw Admin GraphQL + custom ETL**: Bulk Operations API for orders/line items and products/collections (separate queries, joined client-side), works on any plan, no PCD approval needed since no customer PII involved.

**Client confirmed: not on Shopify Plus — on Basic or Grow.** ("Grow" confirmed as the current name for Shopify's renamed mid-tier plan.) → **Option B is the only viable path.**

Key technical facts established:
- `Order.staffMember`, `Order.retailLocation`, `Order.sourceName` — POS staff/location/channel attribution.
- `LineItem.sku`, `discountAllocations`, `taxLines`, `variant.barcode`.
- Bulk Operations: max 5 connections / 2 levels of nesting; only **one bulk query operation per shop at a time** — two-step exports (orders, then products/collections) must run sequentially.
- `groupObjects: true` on `bulkOperationRunQuery` avoids the `__parentId` JSONL-flattening reconstruction problem (nests line items directly under each order) at the cost of a slower/less reliable bulk job — recommended for this store's scale.
- `BULK_OPERATIONS_FINISH` webhook payload only contains `admin_graphql_api_id` — the download URL must be fetched via a follow-up `node(id:)` query. Webhook delivery isn't guaranteed — needs a polling fallback.
- `read_all_orders` scope needed for order history beyond Shopify's default 60-day window (separate, easier approval than Protected Customer Data).
- POS-only staff (PIN logins) are exempt from plan-based staff-account limits, but typically require **POS Pro** — client confirmed they have POS Pro at all locations, so POS Staff attribution is meaningful.

---

## 2. Framework & Hosting Decisions

- **App framework: React Router** — Shopify's current officially recommended framework (successor to Remix), package `@shopify/shopify-app-react-router`. Chosen over building a raw script.
- Architecture chains: kick off orders bulk query → webhook fires → fetch URL via `node(id:)` → download/parse → kick off products/collections bulk query → webhook fires again → join → compute → write output.
- **Hosting: AWS**, leaning toward **App Runner** or **ECS Fargate** (always-on container, avoids Lambda's execution-time/cold-start mismatch with the async bulk-op chain) + **RDS Postgres** for session/job-state + **S3** for generated files + **SES** for email.
- Client may alternatively provide their own server — must support a persistent Node.js/Docker process with stable domain/SSL (explicitly **not** compatible with shared/cPanel hosting).
- **Shopify Extensions (Admin UI extensions, Functions, etc.) are not a substitute** for the backend — they're narrow, event-bound UI/logic surfaces, not general-purpose background job runners. Could optionally add an Admin UI Action button later as a front door into the existing backend, not a replacement for it.

---

## 3. General Report — Field-by-Field Validation

Client shared a real Shopify export CSV as the target field list. Full validation:

| Field | Status |
|---|---|
| Order name, Order Date, Sales Channel | ✅ Native |
| POS Location, POS Staff | ✅ Available via Order fields; blank for online — later resolved (see §5) |
| Collection Name | ✅ — resolved to a clean 1:1 join once client confirmed each product sits in exactly one collection |
| Product title, SKU, Barcode, Variant price | ✅ Native |
| Unit Price Before VAT | ✅ Computed — formula finalized as `Variant Price ÷ 1.05` (client's own spreadsheet formula `=J2/1.05`), **unrounded** |
| Net items sold, Gross sales, Discounts, Net sales, Taxes, Total sales | ✅ Computed — Total sales formula confirmed against a client Shopify dashboard screenshot: `Net sales + Shipping + Taxes` |
| Discount Code or Reason | 🔧 Code: ✅ confirmed (`Order.discountApplications`). Reason: ⚠️ **not a documented Shopify API field** — no confirmed GraphQL field found despite searching. Resolved as: included in Phase 1 scope by default, validated during development via a real POS test transaction; if unavailable, Discount Code still populates and no scope/price adjustment needed. Client uses POS Pro + reason codes at all locations, so it's plausible but unverified until tested. |
| Shipping Charges | ✅ Order-level, not line-item-level — client decided **once per order** display (pending final client sign-off). Formula: `ROUND(Shipping ÷ 1.05, 2)` |
| Payment Method | ✅ Order-level, once per order (same as shipping) |
| Return Reason | ✅ Confirmed structured field (`ReturnLineItem.returnReason`) — populates since client processes returns through Shopify's POS Returns flow. (Noted: this field is marked deprecated in the newest Admin API version.) |

**Filters:** Date Range (mandatory), Sales Channel, POS Location, POS Staff, Collection Name — all confirmed feasible.
**UI:** Select All + individual field checkboxes for a dynamic, user-configurable report.

---

## 4. Location Mapping Resolution

Client confirmed: all Online Store and Mobile App orders should be attributed to the POS location **"Emirates Industries LLC Al Quoz"** for location-based reporting (not left blank). Built as a **configurable mapping table**, not hardcoded, so it extends cleanly if additional physical locations open later.

---

## 5. Stock Report by Location — Validation

Fields: Collection Name, Product Name, SKU, Barcode, Location Name, Stock on Hand, Committed, Available.
Filters: Location, Collection/Tag.
Rule: stock ≤ 5 → highlighted **red**.

**Key finding:** CSV cannot support cell highlighting (plain text format) — resolved by switching **all five reports to XLSX** output (client confirmed this is fine).

**Layout resolved via client's actual sample file** (`Stock_Report.xlsx`):
- **Location Name** = a single fixed header value at the top of the sheet (report is always anchored to one selected location).
- **Collection Name** = always its own **column**, positioned right before Product Name — this way one/many collections selected all produce the same sheet shape (no conditional layout logic needed).
- Confirmed via Shopify's own Inventory screen screenshot that On Hand/Committed/Available are the three native metrics, including real edge cases like negative available stock (oversold items) — flagged but not specially treated beyond the existing ≤5 highlight rule.

---

## 6. Sales Comparison Report (Yearly) — Validation

Two sub-reports:
1. **By Collection**: Collection Name, Total Sales Year 1, Total Sales Year 2, Difference.
2. **By Location**: Location Name, Total Sales Year 1, Total Sales Year 2, Difference.

Confirmed:
- Difference shown as **both value and percentage**.
- Collection filter applies to both sub-reports; optional on the location one (unapplied = all collections).
- Location Name includes real POS locations plus the Al Quoz online/mobile mapping.
- Total Sales formula confirmed against Shopify's own dashboard screenshot.
- Date range: **auto-calculated prior year by default**, with a manual override so the client can compare non-adjacent or custom ranges — both buildable with no real complexity difference.

---

## 7. Total Sales Report by Date Range — Validation

A dynamic pivot: Collections in rows, Locations in columns (confirmed via client's sample image with merged "Location Name" header spanning location columns — standard XLSX merged-cell header, fully doable).

Confirmed:
- Row totals (per collection) at end of each row.
- Column totals (per location) at end of each column.
- Grand total in the corner.
- Collections generated **dynamically** from whatever had sales in the selected range (not a fixed list).
- Date Range is the only filter.

---

## 8. Quantity Report for SKU (Yearly) — Validation

Fields: SKU, Barcode, Quantity Sold Last Year, Quantity Sold Current Year, **Difference (value + %)** (added at client's request to match the Sales Comparison Report's pattern).
Filters: Location and Collection — **filters only, not columns**.
Confirmed: every SKU shown regardless of zero sales in either year (not excluded).

---

## 9. Async Generation, Email & Download Flow

- Reports are **never rendered live in-app** — confirmed necessary given real sample data showed 8,000+ rows.
- Flow: generate in background → store XLSX in **S3** → email the client a **download link** (not an attachment, to avoid attachment size limits and support both fresh and older reports through one mechanism) → same link available via an in-app download button.
- UI shows a "generating — this may take a few minutes" status indicator; no in-app data table/dashboard.

---

## 10. Devsinc-Branded Proposal Document (Formal Template)

Built a full 17-page `.docx` proposal using Devsinc's own branded template (provided as a sample `Big Bird Foods` proposal), adapted for Emirates Industries:
- Cover page, CEO letter (Usman Asif), static Table of Contents, About Devsinc/Why Choose Us/Our Experience sections reused from the template.
- Full Statement of Work split into Phase 1 (General Report) and Phase 2 (four remaining reports), each as detailed feature tables.
- Technical Overview with an architecture-flow table and tech stack table.
- Development Timeline, Implementation Methodology (Agile diagram reused from template), Client Responsibilities.
- Assumptions & Constraints reflecting every decision above (Discount Reason caveat, VAT formula, location mapping, once-per-order shipping/payment, XLSX-only delivery, etc.).
- Original pricing in this version: **$3,550–$4,750 (Phase 1) + $2,500–$3,300 (Phase 2) = $6,050–$8,050 total**, based on a $25/hr rate.
- Delivered as a downloadable file: `Emirates_Industries_Reporting_App_Proposal.docx`.

*(Note: the client-facing proposal was subsequently redrafted in plain text/markdown instead of this formal template — see §11 below. The docx remains available as the "formal" version if needed.)*

---

## 11. Plain-Text Proposal Draft (Client-Facing, Final Direction)

Per instruction to draft informally in chat (not the docx template) so it could be copy-pasted directly. Iterated through several rounds of adjustment:

### Scope, Phases, What Will Be Developed, Tech Stack — locked as drafted (see final version in §12).

### Timeline & Pricing negotiation history:
1. Initial ask: quote $7,000 total, Phase 1 in ~13 days. **Flagged as unrealistic** — Phase 1's own estimate (142–190 hrs) doesn't fit a 13-day single-developer window even generously.
2. Revised: Phase 1 = 3–4 weeks (later tightened to **3 weeks**) including deployment to Devsinc's server, +2–3 days if deploying to client's own server. $7,000 confirmed as the **whole-project** total (not Phase 1 alone).
3. Hours rebalanced to hit $7,000 exactly at $25/hr: Phase 1 = 120 hrs, Phase 2 = 160 hrs (280 hrs × $25 = $7,000).
4. **Final negotiated outcome (post client negotiation with Hassan's manager): total locked at $5,000**, hours adjusted to **252 total** (Phase 1 = 120 hrs, Phase 2 reverted to 132 hrs). Internal working rate ≈ $20/hr — **not disclosed to the client**; only the flat total appears in the client-facing document.
5. Monthly recurring cost: Devsinc-managed AWS hosting ≈ $50/month; client-provided server ≈ $100–150/month (estimated, client's own infrastructure cost).

### Scope confirmation (final):
Everything in the locked scope is technically achievable. The only non-guaranteed item is **Discount Reason (POS)** — included in Phase 1 by default, built if technically feasible during development, Discount Code populates regardless. Shipping/Payment "once per order" was Hassan's working assumption, still pending explicit final client sign-off as of the last exchange.

---

## 12. Final Client-Facing Proposal Text (as last drafted, $5,000 / 252 hours)

# Custom Shopify Reporting Application — Project Proposal
**Emirates Industries**

## Scope

This project covers the design and development of a custom Shopify reporting application for Emirates Industries. The application will consolidate order, POS, product, collection, and inventory data — currently spread across multiple native Shopify screens — into unified, filterable, exportable reports.

The application will be built as a custom Shopify app, installed exclusively on the Emirates Industries store, and will not be listed publicly on the Shopify App Store.

**In scope:**
- Development of five reports: General Sales Report, Stock Report by Location, Sales Comparison Report (Yearly), Total Sales Report by Date Range, and Quantity Report for SKU (Yearly).
- Filters, dynamic field selection, and date-range logic as specified for each report.
- Asynchronous report generation, email notification with a download link, and an in-app download button.
- All reports delivered as XLSX, including conditional formatting where required (e.g., low-stock highlighting).

**Out of scope:**
- Any modification to the Shopify storefront, theme, or checkout.
- In-app charts, graphs, or dashboards — all reports are file-based deliverables only.
- Server/hosting provisioning, maintenance, and associated costs beyond what's listed under Monthly Recurring Cost.
- Shopify, POS Pro, or any third-party app subscription costs.

## Phases

**Phase 1 — General Sales Report**
The foundational report and the core data pipeline (Bulk Operations, join logic, async generation, email/download delivery) that the remaining reports will build on.

**Phase 2 — Additional Reports**
Stock Report by Location, Sales Comparison Report (Yearly), Total Sales Report by Date Range, and Quantity Report for SKU (Yearly) — each reusing the Phase 1 pipeline and infrastructure.

## What Will Be Developed

### Phase 1 — General Sales Report
- Custom Shopify app (React Router) with OAuth, session handling, and required access scopes (`read_orders`, `read_all_orders`, `read_products`).
- Bulk Operations data pipeline: sequential export of orders/line items and products/collections, with webhook-driven completion handling and a fallback status check.
- Join and calculation logic: collection mapping, VAT-exclusive pricing (÷1.05), discount code/reason, return reason, and location mapping (online/mobile → Al Quoz location).
- All 21 confirmed fields with correct calculations, as validated.
- Filters: Date Range, Sales Channel, POS Location, POS Staff, Collection Name.
- Dynamic field selection (Select All + individual fields).
- Asynchronous generation with status indicator, XLSX output, email delivery (download link), and in-app download button.

### Phase 2 — Additional Reports
- **Stock Report by Location** — inventory pipeline (on hand, committed, available), location/collection/tag filters, red-highlighted low-stock rows.
- **Sales Comparison Report (Yearly)** — collection and location views, year-over-year logic with auto-calculated prior year and manual override, value + percentage difference.
- **Total Sales Report by Date Range** — dynamic collection × location matrix with row, column, and grand totals.
- **Quantity Report for SKU (Yearly)** — SKU/barcode quantity comparison with difference, location/collection as filters only.

## Tech Stack

- **Application Framework:** React Router — Shopify's current recommended framework for custom apps.
- **Backend:** Node.js for Bulk Operations orchestration, data joins, and calculations; PostgreSQL for session and job-state tracking.
- **APIs & Integrations:** Shopify Admin GraphQL API (Bulk Operations, Orders, Products, Collections, Inventory, Returns) and Shopify webhooks.
- **Hosting & Infrastructure:** Devsinc-managed by default (see Monthly Recurring Cost), or the client's own server if preferred — must be capable of running a persistent Node.js/Docker process with a stable domain and SSL certificate, along with a PostgreSQL database and file storage/email-sending capability. Not compatible with shared/cPanel-style hosting.
- **Development Tools:** Shopify CLI, Git.

## Timeline & Effort Breakdown

### Phase 1 — General Sales Report (3 weeks)

| Task | Hours |
|---|---|
| App scaffolding + infrastructure setup | 14 |
| Bulk Operations pipeline (orders, products/collections, webhook handling) | 20 |
| Join & computation logic (VAT, discounts, returns, location mapping) | 20 |
| Filters + dynamic field selection | 13 |
| XLSX generation & formatting | 7 |
| Email delivery + download link + status UI | 9 |
| Report page UI | 13 |
| QA | 10 |
| Deployment & handoff documentation | 7 |
| Revisions buffer | 7 |
| **Total** | **120 hours** |

### Phase 2 — Additional Reports (~4 weeks)

| Task | Hours |
|---|---|
| Stock Report by Location | 28 |
| Sales Comparison Report (Yearly) | 26 |
| Total Sales Report by Date Range | 20 |
| Quantity Report for SKU (Yearly) | 16 |
| UI for four report screens | 14 |
| QA across all four reports | 18 |
| Revisions buffer | 10 |
| **Total** | **132 hours** |

Phase 1 will be delivered within **3 weeks**, including deployment to Devsinc's hosting environment. If the client's own server is used instead, add **2–3 additional days** for coordination, access provisioning, and configuration.

*Note: This timeline assumes the Shopify `read_all_orders` protected-data access request is submitted at project kickoff, as Shopify's review process runs independently of development and is outside Devsinc's control.*

## Proposed Pricing

Total professional services for the complete scope (Phase 1 and Phase 2): **US $5,000**

## Monthly Recurring Cost

| Hosting Option | Estimated Monthly Cost |
|---|---|
| Devsinc-managed hosting (AWS) | US $50/month |
| Client-provided server | US $100 – $150/month (estimated, depending on the client's infrastructure) |

## Why This Isn't a Simple Report

**1. Shopify genuinely doesn't offer this anywhere — you're not paying for something "easy that we're charging a lot for."**
Shopify's native reporting was checked field-by-field with you (order data, POS data, collection data, and inventory data each live in separate systems). No native screen, no export button, and no off-the-shelf app combines all of it. This has to be built from the ground up against Shopify's raw API.

**2. It's five distinct reports, not one.**
Each report has its own filters, its own aggregation logic (some are flat tables, one is a year-over-year comparison, one is a dynamic pivot matrix with row/column/grand totals). That's closer to five small applications sharing infrastructure than one report with five views.

**3. Large data volumes force a harder architecture than a simple export.**
The sample data alone showed 8,000+ rows. A simple report can just query and display; at this volume, the app has to generate reports in the background, handle multi-step data exports safely, and notify the client by email once ready — the same pattern Shopify itself uses for its own large exports, because there's no shortcut around it at this scale.

**4. The financial numbers have to be exactly right, not approximately right.**
VAT calculations, discounts, returns, shipping, and taxes all have to reconcile to the same figures Shopify's own reports would show — get the formula subtly wrong and every report has a quietly incorrect number in it. That precision was worth the multiple rounds of validation you and the client already went through together, and it's worth the same care in the build.

**5. Real-world data isn't clean, and the app has to handle that.**
Products spanning multiple collections, online orders with no physical location, returns processed differently than plain refunds, discount attribution that differs between online and POS — each of these edge cases (which came up naturally while defining the requirements) needs explicit handling, not just a happy-path query.

**6. This is a maintainable system, not a one-off script.**
Filters, a field-picker, async generation, email delivery, and a download button are all reusable infrastructure — Phase 2's four reports build on exactly what Phase 1 establishes rather than starting over. That's why Phase 2 is faster than Phase 1 despite having more reports in it.

## Framing for the Client Conversation

- **Cost comparison, not cost in isolation**: this replaces what would otherwise be hours of manual work across multiple Shopify screens, every time someone needs a report — the app pays for itself in staff time saved.
- **One-time cost, standing capability**: $5,000 buys a permanent tool the business keeps using, not a one-off deliverable.
- **It's the accurate version of what they're already trying to do by hand** — the sample sheet you validated together showed real gaps (missing collection names, missing location data) that manual workarounds can't fully close.

---

## 13. Final Confirmations (Client Sign-Off)

1. **Shipping Charges / Payment Method shown once per order** — ✅ **Confirmed by client.** No longer an assumption.
2. **Discount Reason (POS)** — ✅ **Confirmed by client**: included in Phase 1 by default; if achievable during development it will be added to the app, if not, no impact on scope, timeline, or price. Discount Code populates either way.

All scope items are now fully confirmed with no outstanding open items.
