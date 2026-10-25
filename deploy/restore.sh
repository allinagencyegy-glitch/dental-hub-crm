#!/usr/bin/env bash
# Puts the Dental Hub CRM database back to how it was when a backup was taken.
#
#   sudo bash /opt/dental-hub-crm/deploy/restore.sh                lists the backups
#   sudo bash /opt/dental-hub-crm/deploy/restore.sh <backup>       restores one
#
# <backup> is a file name from the list, or the path of a .dump file made by
# backup.sh and copied onto this server.
#
# What it does, in order:
#   - checks that the backup can be read and holds the CRM's tables
#   - backs up the database as it is now (marked before-restore), so the
#     restore itself can be undone
#   - loads the backup into a separate database while the CRM keeps running
#   - stops the CRM, swaps the restored database in, applies any migrations the
#     running version needs, starts the CRM and checks that it answers
#   - if any of that fails, puts the old database back and starts the CRM again
#
# Everything entered after the backup was taken is replaced: that is what a
# restore means. The before-restore backup still has it.
# The CRM is down for the swap, usually under a minute.
#
# Options:
#   --yes   do not ask for confirmation
set -Eeuo pipefail

main() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=deploy/lib.sh
  . "$script_dir/lib.sh"
  trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR

  local backup='' yes=0
  while (($#)); do
    case "$1" in
      --yes) yes=1; shift ;;
      -h | --help) usage 0 ;;
      -*) printf 'Unknown option: %s\n\n' "$1" >&2; usage 1 ;;
      *)
        [[ -z "$backup" ]] || die 'give only one backup.'
        backup="$1"; shift ;;
    esac
  done

  ((EUID == 0)) || die 'run this as root: sudo bash deploy/restore.sh'
  [[ -f "$ENV_FILE" && -L "$CURRENT_LINK" ]] || die 'the CRM is not installed here. Run deploy/setup.sh first.'
  # runuser keeps the working directory, which the postgres user may not be able to enter.
  cd /
  shopt -s nullglob

  if [[ -z "$backup" ]]; then
    list_backups
    return
  fi

  local file
  if [[ "$backup" != */* && -f "$BACKUP_DIR/$backup" ]]; then
    file="$BACKUP_DIR/$backup"
  elif [[ -f "$backup" ]]; then
    file="$(readlink -f "$backup")"
  else
    die "there is no backup \"$backup\". Run restore.sh without arguments to list them."
  fi
  # The list only needs the start of the file; reading it all also catches a damaged end.
  local contents
  if ! contents="$(pg_restore --list "$file" 2>/dev/null)" || ! pg_restore --file=/dev/null "$file" 2>/dev/null; then
    die "$file is damaged or is not a backup made by backup.sh."
  fi
  grep -qE ' TABLE DATA public crm_schema_migration( |$)' <<<"$contents" ||
    die "$file does not hold the CRM's tables."

  echo "Restoring $file"
  echo "taken $(date -r "$file" '+%Y-%m-%d %H:%M'). Everything entered after that will be replaced."
  if ((!yes)); then
    [[ -t 0 ]] || die 'pass --yes to restore without being asked.'
    local answer
    read -r -p 'Type RESTORE to continue: ' answer
    [[ "$answer" == RESTORE ]] || die 'cancelled; nothing was changed.'
  fi

  # No update while restoring.
  exec 9>/run/lock/dental-hub-crm-deploy.lock
  flock -n 9 || die 'an update is running. Try again when it has finished.'

  local staging="${DB_NAME}_restoring" previous_db="${DB_NAME}_before_restore"
  db_exists "$previous_db" &&
    die "$previous_db exists: an earlier restore was interrupted. Check which database holds the right data before going on."

  # Not pruned here: the backup being restored may be about to expire.
  bash "$script_dir/backup.sh" --label before-restore --no-prune
  local safety
  safety="$(newest_backup before-restore)"

  # The nightly backup waits until the swap is over.
  exec 8>/run/lock/dental-hub-crm-backup.lock
  flock -w 600 8 || die 'a backup has been running for 10 minutes. Try again later.'

  # -------------------------------------------------------------------------
  log 'Loading the backup into a separate database'
  trap 'drop_db "$staging"; die "the restore failed (the error is above). The database was not changed."' ERR
  drop_db "$staging"
  psql_admin -c "CREATE DATABASE $staging OWNER $DB_USER"
  # Read from stdin, so the postgres user needs no access to the file.
  runuser -u postgres -- pg_restore --dbname="$staging" --no-owner --no-acl --role="$DB_USER" \
    --exit-on-error --single-transaction <"$file"

  # -------------------------------------------------------------------------
  log 'Swapping the restored database in'
  trap 'put_back; die "the restore failed (the error is above). The database is as it was before."' ERR
  systemctl stop "$SERVICE"
  disconnect_all "$DB_NAME"
  # Both renames or neither.
  psql_admin -d postgres <<SQL
BEGIN;
ALTER DATABASE $DB_NAME RENAME TO $previous_db;
ALTER DATABASE $staging RENAME TO $DB_NAME;
COMMIT;
SQL
  as_app_in "$CURRENT_LINK" npm run db:migrate
  systemctl start "$SERVICE"
  wait_healthy 60 || { warn 'the CRM did not answer its health check on the restored database.'; false; }

  trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR
  drop_db "$previous_db"
  log "Restored $(basename "$file")"
  echo "The database as it was just before is in $safety."
  echo "To undo this restore: sudo bash $script_dir/restore.sh $(basename "$safety")"
}

usage() {
  sed -n '2,/^set -Eeuo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
  exit "${1:-0}"
}

list_backups() {
  local -a files=("$BACKUP_DIR/$DB_NAME"-*.dump)
  if ((${#files[@]} == 0)); then
    echo "There are no backups in $BACKUP_DIR yet."
    return
  fi
  echo "Backups in $BACKUP_DIR, newest first:"
  echo
  local i
  for ((i = ${#files[@]} - 1; i >= 0; i--)); do
    printf '  %-56s %s  %6s\n' "$(basename "${files[i]}")" \
      "$(date -r "${files[i]}" '+%Y-%m-%d %H:%M')" "$(du -h "${files[i]}" | cut -f1)"
  done
  echo
  echo "To restore one: sudo bash ${BASH_SOURCE[0]} <file name>"
}

# The newest backup with the given label. File names sort by date.
newest_backup() {
  local -a files=("$BACKUP_DIR/$DB_NAME"-*-"$1".dump)
  ((${#files[@]})) || die "the $1 backup is missing."
  echo "${files[-1]}"
}

db_exists() {
  [[ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]
}

disconnect_all() {
  psql_admin -d postgres -tAc \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$1' AND pid <> pg_backend_pid()" >/dev/null
}

drop_db() {
  disconnect_all "$1"
  psql_admin -d postgres -c "DROP DATABASE IF EXISTS $1"
}

# Undoes the swap and starts the CRM on its old database again. Called from the ERR trap.
# shellcheck disable=SC2317,SC2329
put_back() {
  trap - ERR
  systemctl stop "$SERVICE" || true
  if db_exists "$previous_db"; then
    disconnect_all "$DB_NAME" || true
    drop_db "$DB_NAME" || true
    psql_admin -d postgres -c "ALTER DATABASE $previous_db RENAME TO $DB_NAME" ||
      warn "could not rename $previous_db back to $DB_NAME. Do it by hand before starting the CRM."
  fi
  drop_db "$staging" || true
  systemctl start "$SERVICE" || true
  wait_healthy 60 || warn "the CRM did not come back on its old database either. See: journalctl -u $SERVICE -n 100"
}

main "$@"; exit
