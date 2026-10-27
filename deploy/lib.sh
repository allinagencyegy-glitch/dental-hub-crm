# shellcheck shell=bash
# Shared by the deploy scripts. Sourced, never run on its own.
#
# Layout on the server:
#   <checkout>                       the git clone the scripts live in, owned by root
#   /var/lib/dentalhub/shared/.env   database password and settings, readable only by dentalhub
#   /var/lib/dentalhub/releases/*    one fully built copy of the app per update
#   /var/lib/dentalhub/current       symlink to the release the service runs
#   /var/backups/dentalhub/*.dump    database backups, readable only by root
#
# The constants are used by the scripts that source this file.
# shellcheck disable=SC2034

umask 022

readonly APP_USER=dentalhub
readonly APP_HOME=/var/lib/dentalhub
readonly RELEASES_DIR="$APP_HOME/releases"
readonly CURRENT_LINK="$APP_HOME/current"
readonly ENV_FILE="$APP_HOME/shared/.env"
readonly ENV_MARKER='# Written by deploy/setup.sh.'
readonly APP_PORT=3000
readonly SERVICE=dental-hub-crm
readonly DB_NAME=dental_hub_crm
readonly DB_USER=dental_hub_crm
readonly BACKUP_DIR=/var/backups/dentalhub
readonly HEALTH_URL="http://127.0.0.1:$APP_PORT/api/health"
# Written into a release once it has served healthily.
readonly HEALTHY_MARKER=HEALTHY

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf '%s: %s\n' "$(basename "$0")" "$*" >&2
  exit 1
}

# Runs a command as the app user, with a home for npm's cache.
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_HOME" NEXT_TELEMETRY_DISABLED=1 "$@"; }

# The same, from inside directory $1.
as_app_in() {
  local dir="$1"
  shift
  as_app env -C "$dir" "$@"
}

# psql as the PostgreSQL superuser, stopping at the first error.
psql_admin() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# Waits up to $1 seconds (default 60) for the app to answer its health check.
wait_healthy() {
  local seconds="${1:-60}"
  for _ in $(seq 1 "$seconds"); do
    # Straight to the app: a proxy set in the environment must not answer for it.
    curl -fsS --noproxy '*' -o /dev/null "$HEALTH_URL" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
