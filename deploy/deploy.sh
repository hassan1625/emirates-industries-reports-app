#!/usr/bin/env bash
# Puts the latest version of the app live on the server.
#   deploy/deploy.sh            deploy the latest main
#   deploy/deploy.sh --force    deploy even if a report is being built (that report must be started again)
#   deploy/deploy.sh v1.2.0     deploy another branch or tag
# Every step must succeed: the script stops at the first failure and the running app is
# only restarted at the very end, after the new version has built.
set -euo pipefail

FORCE=0
REF="main"
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then FORCE=1; else REF="$arg"; fi
done

cd "$(dirname "$0")/.."

# Node comes from nvm on this server; load it when it is there (cron and ssh scripts do not).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

[ -f .env ] || { echo "No .env file here. Copy .env.production.example to .env and fill it in first."; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node 22 or newer is needed (this is $(node -v))."; exit 1; }

echo "==> Checking for reports in progress"
if ! node --env-file=.env deploy/running-jobs.mjs; then
  if [ "$FORCE" -eq 1 ]; then echo "   --force given: continuing anyway"; else
    echo "A report is being built. Wait for it to finish, or run again with --force."; exit 1; fi
fi

echo "==> Getting the code ($REF)"
git fetch --tags origin
git checkout -q "$REF"
if git show-ref --verify -q "refs/remotes/origin/$REF"; then git merge --ff-only "origin/$REF"; fi
echo "   now at $(git log --oneline -1)"

echo "==> Installing packages"
npm ci --no-audit --no-fund

echo "==> Preparing the database client and tables"
npx prisma generate
npx prisma migrate deploy

echo "==> Building"
npm run build

echo "==> Restarting the app"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Done. Status:"
pm2 status emirates-reports
