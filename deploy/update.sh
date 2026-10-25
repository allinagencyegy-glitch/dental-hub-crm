#!/usr/bin/env bash
# Updates Dental Hub CRM on the server to the latest code, without breaking
# the running version if anything goes wrong.
#
#   sudo bash /opt/dental-hub-crm/deploy/update.sh
#
# What it does, in order:
#   - pulls the latest commit of the checkout's branch
#   - builds it in a new release folder while the current version keeps serving
#   - applies new database migrations
#   - switches the service to the new release and checks that it answers
#   - if the new release does not come up, switches straight back to the previous one
#   - keeps the last few releases so you can go back with --rollback
#
# If the build or a migration fails, nothing is switched: the running version
# stays as it was. Users see a few seconds of downtime only during the switch.
#
# Options:
#   --ref REF     deploy this branch, tag or commit instead of the latest on the branch
#   --no-fetch    build what the checkout already has, without contacting GitHub
#   --force       rebuild even when that commit is already running
#   --rollback    switch back to the release before the current one, and stop
#   --keep N      how many releases to keep on disk (default 3)
set -Eeuo pipefail

# Everything runs from main(), called on the last line: bash has then read the
# whole script, so pulling a new version of this file mid-run cannot break it.
main() {
  local script_dir app_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  app_dir="$(dirname "$script_dir")"
  # shellcheck source=deploy/lib.sh
  . "$script_dir/lib.sh"
  trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR

  local ref='' fetch=1 force=0 rollback=0 keep=3
  while (($#)); do
    case "$1" in
      --ref) ref="${2:-}"; shift 2 ;;
      --no-fetch) fetch=0; shift ;;
      --force) force=1; shift ;;
      --rollback) rollback=1; shift ;;
      --keep) keep="${2:-}"; shift 2 ;;
      -h | --help) usage 0 ;;
      *) printf 'Unknown option: %s\n\n' "$1" >&2; usage 1 ;;
    esac
  done
  if ! [[ "$keep" =~ ^[0-9]+$ ]] || ((keep < 2)); then
    die '--keep must be a number, 2 or more.'
  fi

  ((EUID == 0)) || die 'run this as root: sudo bash deploy/update.sh'
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing. Run deploy/setup.sh first."
  systemctl cat "$SERVICE" >/dev/null 2>&1 || die "the $SERVICE service is missing. Run deploy/setup.sh first."

  # One update at a time.
  exec 9>/run/lock/dental-hub-crm-deploy.lock
  flock -n 9 || die 'another update is already running.'
  install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$RELEASES_DIR"
  # runuser keeps the working directory, which the app user may not be able to enter.
  cd /
  shopt -s nullglob

  local previous=''
  [[ -L "$CURRENT_LINK" ]] && previous="$(readlink -f "$CURRENT_LINK")"

  if ((rollback)); then
    do_rollback "$previous"
    return
  fi

  git_() { git -c safe.directory="$app_dir" -C "$app_dir" "$@"; }

  # -------------------------------------------------------------------------
  if ((fetch)); then
    log 'Fetching the latest code'
    git_ fetch --prune --tags origin
    if [[ -z "$ref" ]]; then
      git_ merge --ff-only '@{upstream}' >/dev/null ||
        die "the checkout in $app_dir has local changes or has diverged from GitHub. Fix it, or pass --ref."
    fi
  fi
  # A branch name means its latest commit on GitHub, not a stale local copy.
  local target=HEAD sha
  if [[ -n "$ref" ]]; then
    if git_ rev-parse --verify --quiet "origin/$ref^{commit}" >/dev/null; then
      target="origin/$ref"
    elif git_ rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
      target="$ref"
    else
      die "\"$ref\" is not a branch, tag or commit in $app_dir."
    fi
  fi
  sha="$(git_ rev-parse "$target^{commit}")"

  if [[ -n "$previous" && -f "$previous/REVISION" && "$(<"$previous/REVISION")" == "$sha" ]] && ((!force)); then
    echo "Already running ${sha:0:7} ($(git_ log -1 --format=%s "$sha")). Nothing to do."
    return
  fi

  # -------------------------------------------------------------------------
  local release
  release="$RELEASES_DIR/$(date +%Y%m%d-%H%M%S)-${sha:0:7}"
  log "Building ${sha:0:7}: $(git_ log -1 --format=%s "$sha")"
  echo "Release folder: $release"

  # Until the switch, a failure only has to clean up the half-built release.
  local step='preparing the release'
  trap 'remove_release "$release"; die "$step failed (the error is above). The running version was not changed."' ERR

  install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$release"
  git_ archive --format=tar "$sha" | as_app tar -x -C "$release"
  echo "$sha" | as_app tee "$release/REVISION" >/dev/null
  as_app ln -s "$ENV_FILE" "$release/.env"

  step='installing dependencies'
  as_app_in "$release" npm ci --no-audit --no-fund
  step='building'
  as_app_in "$release" npm run build

  log 'Applying database migrations'
  step='applying migrations'
  as_app_in "$release" npm run db:migrate

  # -------------------------------------------------------------------------
  log 'Switching to the new release'
  trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR
  switch_to "$release"

  if ! wait_healthy 30; then
    if [[ -n "$previous" ]]; then
      warn 'the new release did not answer its health check. Switching back.'
      switch_to "$previous"
      wait_healthy 60 || die "the previous release did not come back either. See: journalctl -u $SERVICE -n 100"
      die "the update failed and the previous release is running again. Migrations it applied stay in place. See: journalctl -u $SERVICE -n 100"
    fi
    die "the app did not become healthy. See: journalctl -u $SERVICE -n 100"
  fi
  # Only releases that have served healthily are candidates for --rollback.
  touch "$release/$HEALTHY_MARKER"

  prune_releases "$keep" "$release" "$previous"
  log "Update complete: ${sha:0:7} is live"
}

usage() {
  sed -n '2,/^set -Eeuo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
  exit "${1:-0}"
}

# Points `current` at a release in one atomic rename, then restarts the service.
switch_to() {
  ln -sfn "$1" "$CURRENT_LINK.new"
  mv -T "$CURRENT_LINK.new" "$CURRENT_LINK"
  systemctl restart "$SERVICE"
}

do_rollback() {
  local current="$1" target=''
  [[ -n "$current" ]] || die 'there is no running release to roll back from.'
  local dir
  for dir in "$RELEASES_DIR"/*/; do
    dir="${dir%/}"
    [[ "$dir" < "$current" && -f "$dir/$HEALTHY_MARKER" ]] && target="$dir"
  done
  [[ -n "$target" ]] || die 'there is no older release that ran healthily to go back to.'

  log "Rolling back to $(basename "$target")"
  switch_to "$target"
  if ! wait_healthy 30; then
    warn 'the older release did not answer its health check. Switching back.'
    switch_to "$current"
    wait_healthy 60 || die "the current release did not come back either. See: journalctl -u $SERVICE -n 100"
    die "rollback failed; still running $(basename "$current"). See: journalctl -u $SERVICE -n 100"
  fi
  echo "Running $(basename "$target") again."
  warn 'database migrations are not undone by a rollback.'
}

# Deletes all but the newest $1 releases, never the running or the previous one.
prune_releases() {
  local keep="$1" running="$2" previous="$3" dir
  local -a releases=()
  for dir in "$RELEASES_DIR"/*/; do
    releases+=("${dir%/}")
  done
  local count="${#releases[@]}" i
  for ((i = 0; i < count - keep; i++)); do
    dir="${releases[i]}"
    [[ "$dir" == "$running" || "$dir" == "$previous" ]] && continue
    remove_release "$dir"
  done
}

# Deletes one release folder, and refuses anything that is not directly inside
# the releases folder.
remove_release() {
  local dir="$1"
  if [[ -z "$dir" || "$dir" != "$RELEASES_DIR"/* || "$dir" == *..* || "${dir#"$RELEASES_DIR"/}" == */* ]]; then
    warn "not deleting \"$dir\": it is not a release folder."
    return 0
  fi
  rm -rf -- "$dir"
}

main "$@"; exit
