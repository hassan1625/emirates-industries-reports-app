# Deployment settings

Everything the app reads from its environment. Nothing here is a secret unless marked.

## Shopify (set by the Shopify CLI in development)

| Variable | Meaning |
|---|---|
| `SHOPIFY_API_KEY` | the app's client ID |
| `SHOPIFY_API_SECRET` (secret) | the app's client secret; also signs the app's own download links |
| `SHOPIFY_APP_URL` | the app's public web address (HTTPS) |
| `SCOPES` | `read_orders,read_all_orders,read_products,read_locations,read_inventory,read_returns,read_reports` |

## Report files (Step 28)

Finished reports go to Amazon S3 when `REPORT_S3_BUCKET` is set, otherwise to the server's disk
(development). Downloads then use a short-lived (10 minute) presigned S3 link.

| Variable | Meaning | Default |
|---|---|---|
| `REPORT_S3_BUCKET` | bucket for finished reports; setting it switches S3 on | not set (local disk) |
| `REPORT_S3_REGION` | the bucket's region, for example `eu-west-1` or `me-central-1` (`AWS_REGION` also works) | SDK default |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (secret) | credentials of a dedicated IAM user; not needed when the server has an IAM role | not set |
| `REPORT_RETENTION_DAYS` | days a finished report is kept; afterwards the file is deleted and the report shows "Expired". `0` keeps forever | `30` |
| `REPORT_KEEP_WORK_FILES` | `on` keeps the three bulk exports of each job on disk after the report is built (production deletes them) | off in production, on elsewhere |
| `REPORT_STORAGE_DIR` | folder for working files (and local reports) | `./storage` |
| `JOB_POLLER` | `off` disables the background recovery and retention timers | on |

Minimal IAM permissions for the app's user, on the bucket's `reports/` folder only:
`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`. As a safety net, also add an S3 lifecycle
rule that expires objects under `reports/` after the same number of days.

The bulk exports (orders, events, products; 100-250 MB per job) are working files on the
server's disk and are deleted once the report exists. A server restart in the middle of a
report loses them; that job then fails with a clear message and can simply be run again.

## Database

Development uses SQLite (`prisma/dev.sqlite`). The plan calls for PostgreSQL (AWS RDS) in
production: change the Prisma datasource provider to `postgresql`, set `DATABASE_URL`, and run
`npx prisma migrate deploy`. Not done yet; it needs the client's database.

## Email

Step 31 (email with Resend) is not built. Reports are downloaded from the app (Recent reports
list); email remains an optional later addition if the client wants it.
