#!/usr/bin/env bash
#
# Apply one migration to the SELF-HOSTED database on 103.233.65.233.
#
# `scripts/apply-migrations.mjs` is the other one and it is not this: that talks
# to Supabase Cloud over the Management API. app.catalogshare.online runs its own
# Postgres on the host (see SELF-HOSTING.md:184), reachable only over SSH, and
# this machine has no SSH keys for it — so it goes through PuTTY's pscp/plink
# exactly as every previous session has.
#
#   CS_SSH_PASSWORD='...' bash scripts/apply-selfhost-migration.sh \
#     supabase/migrations/20260829000000_points_buy_credits_and_slots.sql
#
# Run from Git Bash. The migration is applied with ON_ERROR_STOP and
# --single-transaction, so a failure anywhere leaves the database exactly as it
# was rather than half-migrated. Its trailing SELECT prints a status row per
# object; every one must read OK.
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "usage: CS_SSH_PASSWORD=... bash $0 <path/to/migration.sql>" >&2
  exit 2
fi
if [[ ! -f "$FILE" ]]; then
  echo "no such file: $FILE" >&2
  exit 2
fi
if [[ -z "${CS_SSH_PASSWORD:-}" ]]; then
  echo "set CS_SSH_PASSWORD first — the server takes a password, not a key." >&2
  exit 2
fi

HOST="${CS_SSH_HOST:-dhairya@103.233.65.233}"
DB="${CS_DB_NAME:-catalogshare}"
PUTTY="${PUTTY_DIR:-/c/Program Files/PuTTY}"
BASE="$(basename "$FILE")"

echo "==> uploading $BASE"
"$PUTTY/pscp.exe" -batch -pw "$CS_SSH_PASSWORD" "$FILE" "$HOST:/tmp/$BASE"

# The reward tables are small and this is the only part that is not additive
# (the day-based offers get deactivated), so a copy is taken first. Restoring is
# `psql -d catalogshare -f /tmp/reward-backup-*.sql` after dropping the tables.
echo "==> backing up the reward tables"
"$PUTTY/plink.exe" -batch -ssh "$HOST" -pw "$CS_SSH_PASSWORD" \
  "sudo -u postgres pg_dump -d $DB -t public.reward_offers -t public.reward_redemptions \
     > /tmp/reward-backup-\$(date +%Y%m%d-%H%M%S).sql && ls -la /tmp/reward-backup-*.sql | tail -1"

echo "==> applying $BASE"
"$PUTTY/plink.exe" -batch -ssh "$HOST" -pw "$CS_SSH_PASSWORD" \
  "sudo -u postgres psql -d $DB -v ON_ERROR_STOP=1 --single-transaction -f /tmp/$BASE"

echo
echo "Every status row above must read OK. Anything else means nothing was applied —"
echo "the whole file runs in one transaction."
