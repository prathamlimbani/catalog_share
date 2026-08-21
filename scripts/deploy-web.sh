#!/usr/bin/env bash
#
# Deploy the website build to app.catalogshare.online.
#
# The app is a static SPA — nginx on the host only serves files, so a deploy is
# "build, ship the folder, swap it in". Nothing is compiled server-side.
#
# Run from the repo root:
#     bash scripts/deploy-web.sh
#
# Requires SSH access to the host as a user with sudo. Set DEPLOY_HOST/DEPLOY_USER
# to override the defaults.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-dhairya}"
DEPLOY_HOST="${DEPLOY_HOST:-103.233.65.233}"
REMOTE_ROOT="/var/www/app.catalogshare.online"

cd "$(dirname "$0")/.."

# `build`, not `build:app`. The app-mode bundle stubs out the platform-owner
# console, so shipping it to the website would silently remove /master.
echo "==> Building website bundle"
npm run build

echo "==> Packing dist/"
TARBALL="$(mktemp -d)/dist.tar.gz"
tar -czf "$TARBALL" -C dist .

echo "==> Uploading"
scp "$TARBALL" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/catalogshare-dist.tar.gz"

# Unpack beside the live directory and swap, so a half-extracted tree is never
# served. The old release is kept until the next deploy as a manual rollback.
echo "==> Activating"
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash -se <<REMOTE
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
# No reload needed - nginx resolves the root per request - but this clears any
# open file handles on the replaced directory.
sudo nginx -t && sudo systemctl reload nginx
REMOTE

rm -f "$TARBALL"
echo "==> Done: https://app.catalogshare.online/"
