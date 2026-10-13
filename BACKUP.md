# Backup branch — 2026-10-13

A snapshot of the Emirates Custom Report App taken on 2026-10-13 (code at `main` commit `094d736`).
Everything needed to rebuild and continue the app is in this branch: source, tests, fixtures,
Prisma migrations, scripts and the project docs. **Real store data and secrets are deliberately
not in git** (this repository is public): see "What is not in git".

## What state the app was in

- Milestones 1–4 done; Phase 1 reports built and verified against the Shopify Dashboard:
  - **General Sales Report** (approved by the client): rows built from dated sales events
    (orders, returns, exchanges), Order Type / Is Shipping Charges, POS staff via ShopifyQL.
  - **Refund Credit Report**: the exchange credit Shopify keeps, one row per credit, with a
    total row and a Summary sheet.
- Report jobs run three Shopify bulk exports in sequence (orders, events, products), build an
  XLSX, and offer a signed download link; recent reports are listed on each screen and on the
  Reports page.
- Not built yet: S3 file storage (plan Step 28) and email (Step 31), which need credentials;
  Phase 2 reports (stock, sales comparison, total sales matrix, SKU quantity); final QA/handoff.
- Temporary: `app/routes/app.debug.orders-bulk.jsx` (debug page) and `storage/` must be removed
  or emptied before production.

## Restore and run

```bash
git switch backup/2026-10-13        # or: git checkout -b work backup/2026-10-13
npm install
npx prisma migrate deploy           # creates prisma/dev.sqlite with all migrations
shopify app dev                     # needs the Shopify CLI login for the app
npm test                            # ~400 tests, no Shopify access needed
```

Required scopes (in `shopify.app.toml`): read_orders, read_all_orders, read_products,
read_locations, read_inventory, read_returns, read_reports.

After a fresh install of the app on a store, open the debug page once and use
"Seed location mappings" so Online Store / Mobile App orders are reported under Head office.
Restart the dev server after any Prisma schema change (a stale client caused a failed job once).

## What is not in git (and why)

| Item | Why it is not here | How to get it back |
|---|---|---|
| `storage/` (bulk exports, generated reports, ledger prototype files, about 1 GB) | real client sales data; files over 100 MB are also refused by GitHub | local archive made by the developer (see below), or re-run the exports from the app |
| `prisma/dev.sqlite` | contains Shopify access tokens and job history | `npx prisma migrate deploy`, then re-install / re-authenticate the app |
| `.shopify/` | local CLI/app link state | `shopify app dev` re-links |

Local backup made on 2026-10-13 (kept outside git, on the developer's computer):
`../backups/emirates-report-app-data-2026-10-13.tar.gz` (storage, database, CLI state) and
`../backups/emirates-report-app-2026-10-13.bundle` (the whole git history, all branches).

## Regenerating test data

- **Exports for a period:** use the app (a report job runs orders, events, products), or the debug
  page's "LEDGER PROTOTYPE 1/2" and "2/2" buttons followed by "Save latest export to disk".
- **Verifying a report against Shopify:** run in the store's ShopifyQL:
  `FROM sales SHOW gross_sales, discounts, returns, net_sales, shipping_charges, taxes, total_sales SINCE <start> UNTIL <end>`.
  Gross sales and Discounts match the report's Order rows; Net/Total match except for the exchange
  credit, which is the Refund Credit Report's total. See `docs/shopifyql-verification.md`.

## Where the design decisions live

- `Emirates_Industries_Reporting_App_Dev_Plan.md` — the client's plan and report definitions.
- `docs/shopifyql-verification.md` — how the numbers were checked against Shopify.
- Code comments at the top of `app/pipeline/ledger-rows.js` (amount rules), `credit-rows.js`,
  `job-chain.js` (the three exports) and `staff.js` (POS staff).
