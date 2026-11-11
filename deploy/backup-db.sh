#!/usr/bin/env bash
# Dumps the database to a compressed file and keeps the last 14. Run it daily from cron:
#   30 2 * * * /home/reportingemirate/emirates-report-app/deploy/backup-db.sh >> /home/reportingemirate/logs/backup.log 2>&1
#
# The database login is read from ~/.emirates-db.cnf (so no password appears in a command line):
#   [client]
#   user=DBUSER
#   password=THE-PASSWORD
#   host=localhost
# Create it with:  chmod 600 ~/.emirates-db.cnf
# The database name is the first argument or the DB_NAME environment value.
set -euo pipefail

DB_NAME="${1:-${DB_NAME:?Give the database name as the first argument}}"
DEST="${BACKUP_DIR:-$HOME/backups/db}"
KEEP_DAYS="${KEEP_DAYS:-14}"
CNF="$HOME/.emirates-db.cnf"

[ -f "$CNF" ] || { echo "Missing $CNF (see the comments in this script)"; exit 1; }
mkdir -p "$DEST"
FILE="$DEST/$DB_NAME-$(date +%Y-%m-%d_%H%M).sql.gz"
mysqldump --defaults-extra-file="$CNF" --single-transaction --routines "$DB_NAME" | gzip > "$FILE"
[ -s "$FILE" ] || { echo "Backup is empty: $FILE"; exit 1; }
chmod 600 "$FILE"
find "$DEST" -name "$DB_NAME-*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup written: $FILE ($(du -h "$FILE" | cut -f1))"
