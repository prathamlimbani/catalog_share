#!/bin/bash
# Push SMTP settings from the database into GoTrue.
#
# The functions host reads its credentials from integration_secrets live, so
# Razorpay and Resend changes take effect within a minute with no restart.
# GoTrue is different: it reads SMTP from its environment at startup, so a
# change there genuinely needs the container restarted. This is the only
# component that does.
#
# Runs as root on a timer. It restarts GoTrue ONLY when a value actually
# changed - a restart on every tick would drop in-flight sign-ins once a minute.
set -euo pipefail

ENV_FILE=/opt/catalogshare-backend/.env
STATE=/var/lib/catalogshare/smtp.state
mkdir -p "$(dirname "$STATE")"

get() {
  sudo -u postgres psql -d catalogshare -tAc \
    "SELECT value FROM public.integration_secrets WHERE key = '$1'" 2>/dev/null | tr -d '\r'
}

HOST=$(get SMTP_HOST); PORT=$(get SMTP_PORT); USER=$(get SMTP_USER)
PASS=$(get SMTP_PASS); FROM=$(get SMTP_FROM); FROM_NAME=$(get SMTP_FROM_NAME)
RESEND=$(get RESEND_API_KEY)

# Resend's SMTP password IS the API key. Accepting either field spares the
# operator from filling the same secret in twice and wondering why one of them
# did not take.
if [ -z "$PASS" ] && [ -n "$RESEND" ] && [ "$HOST" = "smtp.resend.com" ]; then
  PASS="$RESEND"
fi

FINGERPRINT=$(printf '%s|%s|%s|%s|%s|%s' "$HOST" "$PORT" "$USER" "$PASS" "$FROM" "$FROM_NAME" | sha256sum | cut -d' ' -f1)
PREVIOUS=$(cat "$STATE" 2>/dev/null || echo "")

if [ "$FINGERPRINT" = "$PREVIOUS" ]; then
  exit 0
fi

set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
    # The value can contain slashes and &, so use a delimiter that cannot appear
    # in a base64/API key and escape the replacement.
    python3 - "$ENV_FILE" "$k" "$v" <<'PY'
import sys, pathlib, re
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path); lines = p.read_text().splitlines()
out = [f"{key}={val}" if l.startswith(key + "=") else l for l in lines]
p.write_text("\n".join(out) + "\n")
PY
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

set_env RESEND_API_KEY "${PASS}"
set_env SMTP_HOST      "${HOST:-smtp.resend.com}"
set_env SMTP_PORT      "${PORT:-465}"
set_env SMTP_USER      "${USER:-resend}"
set_env SMTP_FROM      "${FROM:-catalogshare123@gmail.com}"
set_env SMTP_FROM_NAME "${FROM_NAME:-CatalogShare}"

# Autoconfirm must stay ON while there is no working password, or every new
# registration stalls on a confirmation email that cannot be sent. Turning it
# off is the LAST step of wiring SMTP, not the first.
if [ -n "$PASS" ]; then
  sed -i 's/GOTRUE_MAILER_AUTOCONFIRM: "true"/GOTRUE_MAILER_AUTOCONFIRM: "false"/' /opt/catalogshare-backend/docker-compose.yml || true
  echo "smtp configured; email confirmation ENABLED"
else
  sed -i 's/GOTRUE_MAILER_AUTOCONFIRM: "false"/GOTRUE_MAILER_AUTOCONFIRM: "true"/' /opt/catalogshare-backend/docker-compose.yml || true
  echo "no smtp password; autoconfirm left ON so signups keep working"
fi

cd /opt/catalogshare-backend
docker compose up -d auth >/dev/null 2>&1
echo "$FINGERPRINT" > "$STATE"
echo "gotrue reconciled"
