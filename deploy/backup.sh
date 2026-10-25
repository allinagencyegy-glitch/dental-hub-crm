#!/usr/bin/env bash
# Backs up the Dental Hub CRM database into /var/backups/dentalhub.
#
#   sudo bash /opt/dental-hub-crm/deploy/backup.sh
#
# You rarely need to run it by hand: it runs every night at about 03:00 (Cairo
# time) from the dental-hub-crm-backup timer that setup.sh installs, and
# update.sh runs it before applying migrations.
#
# Each backup is one file, dental_hub_crm-<date>-<time>.dump, readable only by
# root. A backup only counts once it has been read back successfully; a failed
# one is deleted and leaves the older backups as they were. Backups older than
# 14 days are then deleted, but the newest one is always kept.
#
# Restore one with deploy/restore.sh. A backup on this server does not survive
# losing the server, so copy them somewhere else as well.
#
# Options:
#   --keep-days N   delete backups older than N days (default 14)
#   --label NAME    add NAME to the file name, for example before-update
#   --no-prune      keep every older backup this time
set -Eeuo pipefail

main() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=deploy/lib.sh
  . "$script_dir/lib.sh"
  trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR

  local keep_days=14 label='' prune=1
  while (($#)); do
    case "$1" in
      --keep-days) keep_days="${2:-}"; shift 2 ;;
      --label) label="${2:-}"; shift 2 ;;
      --no-prune) prune=0; shift ;;
      -h | --help) usage 0 ;;
      *) printf 'Unknown option: %s\n\n' "$1" >&2; usage 1 ;;
    esac
  done
  if ! [[ "$keep_days" =~ ^[0-9]+$ ]] || ((keep_days < 1)); then
    die '--keep-days must be a number, 1 or more.'
  fi
  [[ "$label" =~ ^[a-z0-9-]*$ ]] || die '--label may contain only lowercase letters, digits and dashes.'

  ((EUID == 0)) || die 'run this as root: sudo bash deploy/backup.sh'
  # runuser keeps the working directory, which the postgres user may not be able to enter.
  cd /
  [[ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" == 1 ]] ||
    die "there is no $DB_NAME database to back up. Run deploy/setup.sh first."

  # One backup at a time; a second one waits for the first.
  exec 8>/run/lock/dental-hub-crm-backup.lock
  flock -w 600 8 || die 'another backup has been running for 10 minutes.'

  install -d -o root -g root -m 0700 "$BACKUP_DIR"
  local name file partial
  name="$DB_NAME-$(date +%Y%m%d-%H%M%S)${label:+-$label}.dump"
  file="$BACKUP_DIR/$name"
  partial="$BACKUP_DIR/.$name.partial"
  trap 'rm -f -- "$partial"; die "the backup failed (the error is above). Older backups were not touched."' ERR

  log "Backing up $DB_NAME"
  (umask 077 && runuser -u postgres -- pg_dump --format=custom --dbname="$DB_NAME" >"$partial")
  # Reads the whole file back: proves it is complete, not just that pg_dump exited.
  pg_restore --file=/dev/null "$partial"
  mv -T -- "$partial" "$file"
  trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR
  echo "Saved $file ($(du -h "$file" | cut -f1))"

  # Never deletes the backup just written, whatever the clock says.
  local old
  if ((prune)); then
    while IFS= read -r -d '' old; do
      [[ "$old" == "$file" ]] && continue
      rm -f -- "$old"
      echo "Deleted $(basename "$old") (older than $keep_days days)"
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$DB_NAME-*.dump" -mmin "+$((keep_days * 24 * 60))" -print0)
  fi

  local count
  count="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$DB_NAME-*.dump" | wc -l)"
  echo "$count backup(s) in $BACKUP_DIR, $(du -sh "$BACKUP_DIR" | cut -f1) in total."
}

usage() {
  sed -n '2,/^set -Eeuo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
  exit "${1:-0}"
}

main "$@"; exit
