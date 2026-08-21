#!/bin/bash
# Nightly backup of the self-hosted CatalogShare backend.
#
# Supabase was doing this silently and nothing was doing it afterwards. A
# database holding 14 merchants' catalogues and invoices with no backup is one
# bad disk from being the end of the business.
#
# Keeps 14 daily copies of the database and 8 weekly copies of the uploads.
# Uploads are dumped less often because they are append-mostly and much larger.
set -euo pipefail

DEST=/var/backups/catalogshare
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

# --clean --if-exists so the dump can be restored over an existing database
# without hand-dropping it first, which is exactly the moment nobody wants to be
# improvising.
sudo -u postgres pg_dump --clean --if-exists catalogshare | gzip -9 > "$DEST/db-$STAMP.sql.gz"

# Weekly (Sunday) snapshot of uploaded files.
if [ "$(date +%u)" = "7" ] || [ ! -f "$DEST/storage-latest.tar.gz" ]; then
  tar -czf "$DEST/storage-$STAMP.tar.gz" -C /var/www catalogshare-storage
  ln -sf "$DEST/storage-$STAMP.tar.gz" "$DEST/storage-latest.tar.gz"
fi

# The secrets are not in the database, and a restore without them is a database
# nothing can connect to.
tar -czf "$DEST/config-$STAMP.tar.gz" \
  -C / opt/catalogshare-backend/.env opt/catalogshare-backend/docker-compose.yml \
       opt/catalogshare-storage/storage.env etc/catalogshare 2>/dev/null || true

find "$DEST" -name 'db-*.sql.gz'      -mtime +14 -delete
find "$DEST" -name 'storage-2*.tar.gz' -mtime +56 -delete
find "$DEST" -name 'config-*.tar.gz'  -mtime +14 -delete

# A backup that silently produces a 20-byte file is worse than no backup,
# because it looks like one. Fail loudly instead.
SIZE=$(stat -c%s "$DEST/db-$STAMP.sql.gz")
if [ "$SIZE" -lt 2000 ]; then
  echo "catalogshare backup suspiciously small: ${SIZE}b" >&2
  exit 1
fi
echo "backup ok: db-$STAMP.sql.gz (${SIZE}b)"
