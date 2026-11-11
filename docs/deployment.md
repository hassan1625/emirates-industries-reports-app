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

The app uses MariaDB 10.11 (MySQL 8 also works) through Prisma. The connection string is
the `DATABASE_URL` environment value:

    mysql://USER:PASSWORD@HOST:3306/DATABASE

- Create an empty database with the `utf8mb4` character set (`utf8mb4_unicode_ci`) and a user
  with all privileges on that one database. No other privileges are needed: the app never
  creates databases.
- Special characters in the password must be percent-encoded in the URL (`@` is `%40`).
- Create the tables with `npx prisma migrate deploy` (part of `npm run setup`). It is safe to
  run on every deploy: it applies only the migrations not yet applied.
- For development, run a local MariaDB that mirrors the server, for example:
  `docker run -d --name emirates-mariadb -e MARIADB_ROOT_PASSWORD=localdev -e MARIADB_DATABASE=emirates_report -p 3307:3306 -v emirates-mariadb-data:/var/lib/mysql mariadb:10.11 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci`
  and put `DATABASE_URL="mysql://root:localdev@127.0.0.1:3307/emirates_report"` in `.env`
  (see `.env.example`). Changing the schema in development uses `npx prisma migrate dev`.

## Email

Step 31 (email with Resend) is not built. Reports are downloaded from the app (Recent reports
list); email remains an optional later addition if the client wants it.
