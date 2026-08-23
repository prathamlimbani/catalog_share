#!/bin/bash
# Push SMTP and Google sign-in settings from the database into GoTrue.
#
# The functions host reads its credentials from integration_secrets live, so
# Razorpay and Resend changes take effect within a minute with no restart.
# GoTrue is different: it reads SMTP and its OAuth providers from its
# environment at startup, so a change there genuinely needs the container
# restarted. This is the only component that does.
#
# Runs as root on a timer (catalogshare-smtp.timer - the name predates the
# Google half; the installed path /usr/local/bin/catalogshare-smtp-reconcile is
# kept so the unit file never has to change). It restarts GoTrue ONLY when a
# value actually changed - a restart on every tick would drop in-flight
# sign-ins once a minute.
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
GOOGLE_ID=$(get GOOGLE_CLIENT_ID); GOOGLE_SECRET=$(get GOOGLE_CLIENT_SECRET)

# Resend's SMTP password IS the API key. Accepting either field spares the
# operator from filling the same secret in twice and wondering why one of them
# did not take.
if [ -z "$PASS" ] && [ -n "$RESEND" ] && [ "$HOST" = "smtp.resend.com" ]; then
  PASS="$RESEND"
fi

# A Google client id is `<digits>-<hash>.apps.googleusercontent.com`: letters,
# digits, dots and dashes, nothing else. The value is written into a compose
# env file and into an SQL statement below, so anything outside that alphabet
# is refused outright rather than quoted - a pasted-in stray character should
# fail loudly here, not become a YAML or SQL surprise later.
#
# The check uses bash's `=~` against the WHOLE string, not `grep`. grep matches
# line by line, so a two-line paste whose first line happened to be valid would
# slip through and the second line would land in the env file and the SQL. Trim
# surrounding whitespace first (a trailing newline off a copy-paste is common).
GOOGLE_ID=$(printf '%s' "$GOOGLE_ID" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
if [ -n "$GOOGLE_ID" ] && ! [[ "$GOOGLE_ID" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "GOOGLE_CLIENT_ID is not of the form <chars>.apps.googleusercontent.com; ignoring it until it is fixed in the console" >&2
  GOOGLE_ID=""
fi
# The secret only ever goes into the env file; compose reads it as a plain
# string. Newlines are the one thing that would break that file's format.
GOOGLE_SECRET=$(printf '%s' "$GOOGLE_SECRET" | tr -d '\n\r')

# Google sign-in is only switched on when THREE things are true: the client id,
# the client secret, AND working SMTP.
#
# The SMTP requirement is a security gate, not a nicety. While SMTP is unset the
# stack runs GOTRUE_MAILER_AUTOCONFIRM=true, which marks every email/password
# signup as verified without the person proving they own the address. GoTrue
# then auto-links a Google sign-in to any existing account with the same
# verified email. Together those two would let an attacker pre-register
# victim@gmail.com, wait for the victim to "Sign in with Google", and have the
# victim land inside the attacker's account. Requiring SMTP (which flips
# autoconfirm OFF below) closes that: an unverified pre-registration can no
# longer be the link target.
GOOGLE_ENABLED=false
if [ -n "$GOOGLE_ID" ] && [ -n "$GOOGLE_SECRET" ] && [ -n "$PASS" ]; then
  GOOGLE_ENABLED=true
fi

# The public row that makes the app show a Google button carries the client id
# ONLY when the provider is actually enabled. Publishing it earlier would show a
# button that opens Google and then fails (provider off), or worse, is on while
# the takeover gate above is still open.
PUBLISH_GOOGLE_ID=""
if [ "$GOOGLE_ENABLED" = true ]; then
  PUBLISH_GOOGLE_ID="$GOOGLE_ID"
fi

FINGERPRINT=$(printf '%s|%s|%s|%s|%s|%s|%s|%s' "$HOST" "$PORT" "$USER" "$PASS" "$FROM" "$FROM_NAME" "$GOOGLE_ID" "$GOOGLE_SECRET" | sha256sum | cut -d' ' -f1)
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

# Google. ENABLED is derived here, not stored: docker-compose.yml reads it as
# GOTRUE_EXTERNAL_GOOGLE_ENABLED and GoTrue refuses to boot a provider whose
# secret is blank, so the switch may only flip on once both halves are in.
set_env GOOGLE_CLIENT_ID      "${GOOGLE_ID}"
set_env GOOGLE_CLIENT_SECRET  "${GOOGLE_SECRET}"
set_env GOOGLE_SIGN_IN_ENABLED "${GOOGLE_ENABLED}"

# The app needs the WEB client id before it can ask Google for a token, and it
# reads app_settings with the anon key - so the id (and only the id) is
# mirrored into the public row, and only once the provider is truly enabled
# (PUBLISH_GOOGLE_ID). The id was validated above to contain nothing but
# [A-Za-z0-9.-], which is why it can be placed in a quoted SQL literal without
# an escaping step; an empty value clears the row and hides the button.
sudo -u postgres psql -d catalogshare -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('auth', jsonb_build_object('google_web_client_id', '${PUBLISH_GOOGLE_ID}'), now())
ON CONFLICT (key) DO UPDATE
  SET value      = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object('google_web_client_id', '${PUBLISH_GOOGLE_ID}'),
      updated_at = now();
SQL

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

if [ "$GOOGLE_ENABLED" = true ]; then
  echo "google sign-in configured; provider ENABLED"
elif [ -n "$GOOGLE_ID" ] && [ -n "$GOOGLE_SECRET" ] && [ -z "$PASS" ]; then
  echo "google sign-in has its client id and secret but SMTP is not set; provider left OFF (enabling it before SMTP would allow account takeover - see the script header)" >&2
else
  echo "google sign-in not configured (needs client id, secret, and SMTP); provider left OFF"
fi

cd /opt/catalogshare-backend
docker compose up -d auth >/dev/null 2>&1
echo "$FINGERPRINT" > "$STATE"
echo "gotrue reconciled"
