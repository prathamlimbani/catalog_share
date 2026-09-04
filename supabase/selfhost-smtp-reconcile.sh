#!/bin/bash
# Push SMTP and Google sign-in settings from the database into GoTrue.
#
# SMTP now comes from the ACTIVE row in email_providers (Resend, Microsoft
# 365, Gmail, anything), falling back to the older integration_secrets SMTP_*
# fields when that table is not there yet.
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

# One column off the ACTIVE row in email_providers, or empty when the table does
# not exist yet. 2>/dev/null swallows the "relation does not exist" so a
# deployment that has not run the migration falls through to the legacy fields
# below instead of failing the whole reconcile.
provider() {
  sudo -u postgres psql -d catalogshare -tAc \
    "SELECT $1 FROM public.email_providers WHERE active LIMIT 1" 2>/dev/null | tr -d '\r'
}

# -----------------------------------------------------------------------------
# Where SMTP comes from, in order of authority
#
# 1. email_providers, the row marked active. This is what the admin console
#    edits and what the functions host sends through, so GoTrue MUST agree with
#    it — otherwise the app sends receipts from Microsoft 365 while password
#    reset links still come from Resend, and only one of the two domains is
#    aligned for SPF.
# 2. integration_secrets SMTP_*, the pre-provider fields. Kept as the fallback
#    so applying the code before the SQL does not stop email.
# -----------------------------------------------------------------------------
ACTIVE_ID=$(provider id)
if [ -n "$ACTIVE_ID" ]; then
  HOST=$(provider host); PORT=$(provider port); USER=$(provider username)
  PASS=$(provider password); FROM=$(provider from_email); FROM_NAME=$(provider from_name)
  TRANSPORT=$(provider transport)
  echo "active email provider: $ACTIVE_ID ($TRANSPORT)"

  # GoTrue can only speak SMTP. A provider set to the Resend HTTPS API is
  # correct for the functions host but leaves GoTrue with nothing, so its SMTP
  # equivalent is filled in from the same credential: for Resend the API key IS
  # the SMTP password.
  if [ "$TRANSPORT" = "resend_api" ]; then
    HOST="smtp.resend.com"
    PORT="465"
    USER="resend"
    echo "provider uses the HTTPS API; pointing GoTrue at Resend SMTP with the same key"
  fi
else
  HOST=$(get SMTP_HOST); PORT=$(get SMTP_PORT); USER=$(get SMTP_USER)
  PASS=$(get SMTP_PASS); FROM=$(get SMTP_FROM); FROM_NAME=$(get SMTP_FROM_NAME)
  echo "no active email provider row; using the legacy integration_secrets fields"
fi

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

# ACTIVE_ID is in the fingerprint deliberately: two providers can share a host
# and username (two Microsoft 365 mailboxes, a primary and a backup), and
# without the id a switch between them would not look like a change and GoTrue
# would never be restarted onto the new one.
FINGERPRINT=$(printf '%s|%s|%s|%s|%s|%s|%s|%s|%s' "$ACTIVE_ID" "$HOST" "$PORT" "$USER" "$PASS" "$FROM" "$FROM_NAME" "$GOOGLE_ID" "$GOOGLE_SECRET" | sha256sum | cut -d' ' -f1)
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

# RESEND_API_KEY is still written because the functions host reads it as its
# last-resort fallback (see mailer.mjs legacyProvider). It holds whatever the
# ACTIVE provider's password is, whichever provider that now happens to be.
set_env RESEND_API_KEY "${PASS}"
set_env SMTP_HOST      "${HOST:-smtp.resend.com}"
set_env SMTP_PORT      "${PORT:-465}"
set_env SMTP_USER      "${USER:-resend}"
set_env SMTP_FROM      "${FROM:-catalogshare123@gmail.com}"
set_env SMTP_FROM_NAME "${FROM_NAME:-CatalogShare}"

# Fast2SMS. The functions host reads these from integration_secrets live and
# needs no restart, so they are mirrored here only so a `docker compose` shell
# and the env file agree about what is configured.
set_env FAST2SMS_API_KEY         "$(get FAST2SMS_API_KEY)"
set_env FAST2SMS_PHONE_NUMBER_ID "$(get FAST2SMS_PHONE_NUMBER_ID)"

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
#
# It is now gated on GOOGLE_ENABLED rather than on $PASS alone. Confirm-on-signup
# exists for exactly one reason (see the takeover note above): while GoTrue
# auto-confirms, enabling Google would let someone pre-register a Google address
# and inherit the account. With Google off that buys nothing — and it cost every
# registration on this deployment. Pasting the Resend key on 2026-08-24 flipped
# this to "false", and from that moment signup ended at "Confirm your email
# first" and no new company could be created.
#
# GOOGLE_ENABLED already requires $PASS (see its assignment above), so this only
# ever narrows when the flip happens; it never turns confirmation off on a
# deployment that has Google running.
if [ "$GOOGLE_ENABLED" = true ]; then
  sed -i 's/GOTRUE_MAILER_AUTOCONFIRM: "true"/GOTRUE_MAILER_AUTOCONFIRM: "false"/' /opt/catalogshare-backend/docker-compose.yml || true
  echo "google sign-in enabled; email confirmation ENABLED (takeover gate)"
else
  sed -i 's/GOTRUE_MAILER_AUTOCONFIRM: "false"/GOTRUE_MAILER_AUTOCONFIRM: "true"/' /opt/catalogshare-backend/docker-compose.yml || true
  echo "google sign-in off; autoconfirm left ON so signups keep working"
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
