# Handover guide: running the Emirates reporting app on the server

This is everything needed to install, update, run and recover the app. Commands are for the
server login `reportingemirate` (Linux, Node 22 through nvm, `pm2` installed); adjust the paths
if the server is different. Settings are explained in `docs/deployment.md`.

## 1. How it fits together

```
Shopify admin  ->  https://reporting.emiratesind.com  (Apache, SSL certificate)
                      |  proxy rule in ~/public_html/.htaccess
                      v
                   Node app on 127.0.0.1:3000  (kept running by pm2)
                      |-- MariaDB database (jobs, sessions, location mapping)
                      |-- ~/app-data/storage  (export working files, finished reports)
                      '-- Shopify Admin API (bulk exports, ShopifyQL)
```

- One copy of the app must run (it has a background poller). `ecosystem.config.cjs` makes pm2 run exactly one.
- The app listens on this machine only (`127.0.0.1`); the web server's proxy is the only way in.
- Reports are built from Shopify's bulk exports: about 1 to 8 minutes depending on the period. A year-long General Sales Report peaks near 1 GB of memory.

## 2. Before the first deploy (checklist)

- [ ] Node 22 or newer: `node -v` (nvm: `nvm install 22 && nvm alias default 22`)
- [ ] pm2: `npm install -g pm2`
- [ ] MariaDB/MySQL database and its user created (cPanel > Manage My Databases), character set `utf8mb4_unicode_ci`
- [ ] The domain's proxy rule is in `~/public_html/.htaccess` (section 3.4)
- [ ] The Shopify app is set up for production (section 4); development and production share one app, with the rules in 4.1
- [ ] The developer diagnostic page stays hidden (it is, unless `ENABLE_DEBUG_PAGE=on` is set; see section 6)

## 3. First-time setup on the server

### 3.1 Folders and code

```bash
mkdir -p ~/app-data/storage ~/logs ~/backups/db
git clone https://github.com/hassan1625/emirates-industries-reports-app.git ~/emirates-report-app
cd ~/emirates-report-app
```

### 3.2 Settings

```bash
cp .env.production.example .env
chmod 600 .env
```

Edit `.env` (cPanel File Manager, `nano .env` or `vi .env`) and fill in every value: the database
URL, the Shopify app's client ID and secret, and the app URL. Replace all the example text. The file
must never be committed or shared.

### 3.3 Start

If a test app is still running on port 3000, remove it first (the port must be free):

```bash
pm2 delete proxytest 2>/dev/null; rm -f ~/proxytest.js
```

Then:

```bash
cd ~/emirates-report-app
deploy/deploy.sh
```

It installs the packages, creates the database tables, builds the app and starts it. Check:

```bash
pm2 status
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/      # expect 200
curl -s -o /dev/null -w "%{http_code}\n" https://reporting.emiratesind.com/   # expect 200
pm2 logs emirates-reports --lines 30
```

The log should say `Job poller started`.

### 3.4 The domain's proxy rule

`~/public_html/.htaccess` must forward the domain to the app and leave the certificate-renewal path alone.
Keep the lines cPanel put there (take a copy first: `cp ~/public_html/.htaccess ~/public_html/.htaccess.bak`) and add these at the end:

```apache
# proxy to the Node app (port 3000)
DirectoryIndex disabled
RewriteEngine On
RewriteRule ^\.well-known/ - [L]
RewriteRule ^index\.php$ http://127.0.0.1:3000/ [P,L]
RewriteRule ^(.*)$ http://127.0.0.1:3000/$1 [P,L]
<IfModule mod_headers.c>
  RequestHeader set X-Forwarded-Proto "https"
</IfModule>
```

- The `.well-known` line matters: without it the free SSL certificate cannot renew and the site goes down.
- `DirectoryIndex disabled` and the `index.php` line matter: cPanel's Apache turns a request for `/` into `/index.php`,
  which the app does not have (it answers 404). With these two lines the front page reaches the app.
- Test: `https://reporting.emiratesind.com/` and `/auth/login` answer 200, `/app` answers 410 (Shopify wants a login).

### 3.5 Start again after a server reboot

```bash
pm2 save
crontab -e
```

Add this line:

```cron
@reboot /bin/bash -lc 'source ~/.nvm/nvm.sh && pm2 resurrect' >> $HOME/logs/pm2-reboot.log 2>&1
```

(In cPanel: Advanced > Cron Jobs > "Common settings" > "Once per reboot"; same command.)
To keep pm2's own logs from growing: `pm2 install pm2-logrotate`.

### 3.6 Daily database backup

```bash
cat > ~/.emirates-db.cnf <<'EOT'
[client]
user=DBUSER
password=THE-DATABASE-PASSWORD
host=localhost
EOT
chmod 600 ~/.emirates-db.cnf
```

Fill in the real user and password, then add a daily cron job (cPanel > Cron Jobs, or `crontab -e`):

```cron
30 2 * * * DB_NAME=reportingemirate_reporting /home/reportingemirate/emirates-report-app/deploy/backup-db.sh >> /home/reportingemirate/logs/backup.log 2>&1
```

It keeps the last 14 dumps in `~/backups/db`. Test once by hand and check a file appears. Copy backups off
the server now and then (the host's own backup of the account is not a replacement).

## 4. Shopify app setup (done once, from a developer machine)

### 4.1 One Shopify app for development and production

The same Shopify app (client ID `55a91743cf2b14a2f4e1f347dbfc25a2`) is used for development and for the
client's live store. It already has the `read_all_orders` approval, which a new app would have to request again.
Shopify's documentation says `shopify app dev` makes a "dev preview" on the development store you choose, isolated to
that store, and does not change the app address on other stores. Shopify still recommends a separate app for production,
so these rules keep the live store safe:

1. **Never run `shopify app dev` against the client's store.** Develop only on the development store (`hassan-app-development`).
   If the CLI asks which store to use, choose the development store.
2. **Test the isolation once, right after the first deploy** (section 4.4). Do not rely on it before that.
3. **After any development session,** if there is any doubt, put the production settings back:
   `shopify app deploy --config production`.
4. `shopify.app.toml` (development settings, tunnel address) and `shopify.app.production.toml` (production address) must
   not be mixed up. The production file has `automatically_update_urls_on_dev = false`.

If the isolation test fails (a development session changes what the client's store loads), use one of these instead:
- **Uninstall and reinstall** the app on the client's store around each development session (the live reports stop meanwhile;
  the client has to approve the install again; the app deletes the store's saved login on uninstall but keeps jobs, reports and
  location mappings), or
- **Create a separate development app** in the Shopify Dev Dashboard, install it on the development store, and point
  `shopify.app.toml` at its client ID (`shopify app config link`). Its `read_all_orders` access has to be requested separately.

### 4.2 Push the production settings

```bash
shopify app deploy --config production
```

This sets the app URL to `https://reporting.emiratesind.com`, the permissions and the webhooks
(`bulk_operations/finish`, `app/uninstalled`, `app/scopes_update`).

### 4.3 Install on the store

Open the app from the store's admin (Apps). On first open the app logs in and stores its access
token in the database. The server's `.env` must have the same client ID and secret as the app.

### 4.4 One-time isolation test (after the first deploy)

With the production app live and installed on the client's store:

1. On the developer machine, run `shopify app dev` and choose the development store.
2. Open the app from the **client's** store admin. It must still load from `reporting.emiratesind.com` and show the reports.
   Also check, in the Shopify Dev Dashboard, that the production app's address is still `https://reporting.emiratesind.com`.
3. Stop `shopify app dev`. If the preview was left on the development store, `shopify app dev clean` removes it.
4. If step 2 failed, run `shopify app deploy --config production` to put production back, then choose a fallback in 4.1.

## 5. Updating the app

On the server:

```bash
cd ~/emirates-report-app
deploy/deploy.sh
```

It refuses to run while a report is being built (a restart would lose that report's working files).
Wait for it to finish, or run `deploy/deploy.sh --force` if that is acceptable. The script stops at
the first failed step; the running app is only restarted at the end, after a successful build.

Database changes arrive as migrations and are applied by the same script (`prisma migrate deploy`).
They only move forward.

## 6. Everyday operations

| Task | Command |
|---|---|
| Is it running? | `pm2 status` |
| Recent log lines | `pm2 logs emirates-reports --lines 100` |
| Restart | `pm2 restart emirates-reports` |
| Stop / start | `pm2 stop emirates-reports` / `pm2 start emirates-reports` |
| Disk space | `df -h ~` and `du -sh ~/app-data/storage` |
| Reports in progress | `cd ~/emirates-report-app && node --env-file=.env deploy/running-jobs.mjs` |

- Finished reports are kept `REPORT_RETENTION_DAYS` (default 30) days, then deleted; the report then shows "Expired".
- Working files are deleted when a report is built. A restart in the middle of a build loses them; that report shows "Failed" and is simply started again.
- The developer diagnostic page (`/app/debug/orders-bulk`) is hidden on the server. A developer who needs it adds `ENABLE_DEBUG_PAGE="on"` to `.env`, runs `pm2 restart emirates-reports --update-env`, uses it, then removes the line and restarts again. It can run Shopify queries against the store and start exports, so leave it off otherwise.
- If a report seems stuck, the app checks unfinished reports every minute and finishes or fails them on its own.

## 7. Rolling back

```bash
cd ~/emirates-report-app
deploy/deploy.sh <tag-or-commit>        # for example: deploy/deploy.sh f5bb680
```

Database migrations are not undone by this. If a bad migration must be undone, restore the last dump from `~/backups/db`.

```bash
gunzip -c ~/backups/db/DBNAME-DATE.sql.gz | mysql --defaults-extra-file=$HOME/.emirates-db.cnf DBNAME
```

## 8. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| The domain's front page answers 404 and the app log says `No route matches URL "/index.php"` | The proxy rule lacks `DirectoryIndex disabled` and the `index.php` line (section 3.4). |
| Opening a report works, but "Generate report" gives "Application Error" and the log says `POST ... .data 400` / `Error: Bad Request` | The app was built without `SHOPIFY_APP_URL`, so React Router refuses POSTs coming from the public address (`react-router.config.js`). Make sure `.env` has `SHOPIFY_APP_URL` and run `deploy/deploy.sh` again (it builds with the `.env` settings). |
| The domain shows an Apache error (503/500) | The app is not running: `pm2 status`, `pm2 logs emirates-reports`. Or the proxy rule is missing from `.htaccess`. |
| `pm2 status` shows errored / restarting | Read the log. Most often a wrong `DATABASE_URL` (the log mentions `P1001` or access denied) or a missing value in `.env`. |
| Blank page or login loop in the Shopify admin | `SHOPIFY_APP_URL` in `.env` and the app URL in Shopify must be identical (`https://reporting.emiratesind.com`, no trailing slash); client ID and secret must match the app. |
| Reports never finish, "waiting" for a long time | Check the log for webhook or Shopify errors. The app polls every minute even if the finish webhook does not arrive. |
| "Could not set up the default locations" | The location "Emirates Industries L.L.C, Head office" does not exist in Shopify; the app maps Online Store and Mobile App orders to it. |
| `P1001`: cannot reach the database | Wrong host or port, or a special character in the password that is not percent-encoded. |
| Site shows a certificate warning | The certificate did not renew. Check that `.well-known` is excluded in the proxy rule (3.4) and run AutoSSL in cPanel. |
| Out of disk space | `du -sh ~/app-data/storage`; delete old `jobs/*` folders that are not in progress; lower `REPORT_RETENTION_DAYS`. |
| Node not found in cron or scripts | Scripts load nvm themselves; for cron lines use `/bin/bash -lc 'source ~/.nvm/nvm.sh && ...'`. |

## 9. Still to do (developer tasks, not server tasks)

- The diagnostic page (`app/routes/app.debug.orders-bulk.jsx`) is kept for investigating client feedback; it is hidden on the server unless switched on. Remove it, and the prototype files it writes, once the app is finished.
- Decide on Amazon S3 for finished reports (optional; without it reports stay on the server's disk under `REPORT_STORAGE_DIR`).
- Run the one-time isolation test (section 4.4) after the first deploy.

## 10. Security notes

- `.env` holds the database password and the Shopify secret: `chmod 600 .env`, never commit it, never paste it in chat or email.
- The app only listens on `127.0.0.1`; keep it that way.
- Change the cPanel and database passwords that were shared during setup, and remove unused SSH keys (cPanel > SSH Access > Manage SSH Keys).
- To change the Shopify secret, rotate it in the Dev Dashboard, update `.env`, then `pm2 restart emirates-reports --update-env`.
