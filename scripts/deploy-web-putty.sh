#!/usr/bin/env bash
#
# Deploy the website build to app.catalogshare.online from a machine with no
# SSH key for it.
#
# `scripts/deploy-web.sh` is the same deploy and is the one to read for what it
# does and why; it calls plain `ssh`/`scp`, which fail on the Windows dev box
# because the host takes a password and there are no keys on it. This runs the
# identical steps through PuTTY's pscp/plink instead, exactly as
# `scripts/apply-selfhost-migration.sh` already does for migrations.
#
#     CS_SSH_PASSWORD='...' bash scripts/deploy-web-putty.sh
#
# Keep the two in step: the remote half below is copied from deploy-web.sh and
# a change to one belongs in the other.
set -euo pipefail

if [[ -z "${CS_SSH_PASSWORD:-}" ]]; then
  echo "set CS_SSH_PASSWORD first — the server takes a password, not a key." >&2
  exit 2
fi

HOST="${CS_SSH_HOST:-dhairya@103.233.65.233}"
REMOTE_ROOT="/var/www/app.catalogshare.online"
PUTTY="${PUTTY_DIR:-/c/Program Files/PuTTY}"

cd "$(dirname "$0")/.."

# `build`, not `build:app`. The app-mode bundle stubs out the platform-owner
# console, so shipping it to the website would silently remove /master.
if [[ "${CS_SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building website bundle"
  npm run build
fi

echo "==> Packing dist/"
TARBALL="$(mktemp -d)/dist.tar.gz"
tar -czf "$TARBALL" -C dist .

echo "==> Uploading"
"$PUTTY/pscp.exe" -batch -pw "$CS_SSH_PASSWORD" "$TARBALL" "$HOST:/tmp/catalogshare-dist.tar.gz"

# The document root is ${REMOTE_ROOT}/public, NOT ${REMOTE_ROOT} itself: the
# site directory also holds ./acme, the webroot certbot renews the certificate
# through. Unpacking over ${REMOTE_ROOT} destroys both — every route 404s
# because nginx's root no longer exists, and renewal breaks silently until the
# cert lapses. That mistake has been made once.
#
# Unpack beside the live directory and swap, so a half-extracted tree is never
# served. The old release is kept until the next deploy as a manual rollback.
echo "==> Activating"
"$PUTTY/plink.exe" -batch -ssh "$HOST" -pw "$CS_SSH_PASSWORD" "
set -euo pipefail
sudo rm -rf ${REMOTE_ROOT}/public.new ${REMOTE_ROOT}/public.old
sudo mkdir -p ${REMOTE_ROOT}/public.new
sudo tar -xzf /tmp/catalogshare-dist.tar.gz -C ${REMOTE_ROOT}/public.new
sudo chown -R www-data:www-data ${REMOTE_ROOT}/public.new
sudo find ${REMOTE_ROOT}/public.new -type d -exec chmod 755 {} +
sudo find ${REMOTE_ROOT}/public.new -type f -exec chmod 644 {} +
sudo mv ${REMOTE_ROOT}/public ${REMOTE_ROOT}/public.old
sudo mv ${REMOTE_ROOT}/public.new ${REMOTE_ROOT}/public
rm -f /tmp/catalogshare-dist.tar.gz
# No reload is needed — nginx resolves the root per request — but this clears
# any open file handles on the replaced directory.
sudo nginx -t && sudo systemctl reload nginx
"

rm -f "$TARBALL"
echo "==> Done: https://app.catalogshare.online/"
