#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server and starts Dental Hub CRM on it.
#
#   git clone <repository> /opt/dental-hub-crm
#   sudo bash /opt/dental-hub-crm/deploy/setup.sh --domain crm.example.com --email you@example.com
#
# What it does, in order:
#   - sets the clock to Africa/Cairo and adds swap when the server has none
#   - turns on automatic security updates, and fail2ban for SSH
#   - installs Node.js 22, PostgreSQL 17 and Caddy from their official repositories
#   - creates the unprivileged `dentalhub` user that runs the app
#   - creates the database and a database role with a random password, kept in
#     /var/lib/dentalhub/shared/.env
#   - builds the first release with deploy/update.sh and runs it under systemd
#     on 127.0.0.1:3000, restarting it if it ever stops
#   - puts Caddy in front for HTTPS (certificates are issued and renewed automatically)
#   - closes the firewall to everything except SSH, HTTP and HTTPS
#
# Safe to run again. An existing database, password and .env are kept as they are.
# Later code changes go out with deploy/update.sh, not with this script.
#
# Options:
#   --domain NAME    the address the CRM will be served on (required)
#   --email ADDRESS  where Let's Encrypt sends certificate expiry warnings (optional)
#   --ssh-port PORT  the SSH port to keep open in the firewall (default 22)
set -Eeuo pipefail

readonly NODE_MAJOR=22
readonly PG_MAJOR=17
readonly DB_NAME=dental_hub_crm
readonly DB_USER=dental_hub_crm
readonly TIMEZONE=Africa/Cairo
readonly KEYRINGS=/etc/apt/keyrings
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly APP_DIR
# shellcheck source=deploy/lib.sh
. "$APP_DIR/deploy/lib.sh"
trap 'die "stopped at line $LINENO: $BASH_COMMAND"' ERR

usage() {
  sed -n '2,/^set -Eeuo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
  exit "${1:-0}"
}

DOMAIN=''
EMAIL=''
SSH_PORT=22
while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --ssh-port) SSH_PORT="${2:-}"; shift 2 ;;
    -h | --help) usage 0 ;;
    *) printf 'Unknown option: %s\n\n' "$1" >&2; usage 1 ;;
  esac
done

DOMAIN="${DOMAIN,,}"
[[ -n "$DOMAIN" ]] || die '--domain is required, for example --domain crm.example.com'
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] ||
  die "\"$DOMAIN\" is not a domain name. Give just the name, without https:// or a path."
[[ -z "$EMAIL" || "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] ||
  die "\"$EMAIL\" is not an email address."
if ! [[ "$SSH_PORT" =~ ^[0-9]+$ ]] || ((SSH_PORT < 1 || SSH_PORT > 65535)); then
  die '--ssh-port must be a number between 1 and 65535.'
fi

((EUID == 0)) || die 'run this as root: sudo bash deploy/setup.sh ...'
[[ -f "$APP_DIR/package.json" && -d "$APP_DIR/migrations" ]] ||
  die "$APP_DIR does not look like the dental-hub-crm checkout."
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || die 'this script supports Ubuntu only.'
[[ "${VERSION_ID:-}" == 24.04 ]] || warn "tested on Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}."

export DEBIAN_FRONTEND=noninteractive
if [[ -f "$ENV_FILE" ]] && ! grep -qF "$ENV_MARKER" "$ENV_FILE"; then
  die "$ENV_FILE exists but was not written by this script. Move it away and run again; the script writes its own."
fi
# runuser keeps the working directory, and the postgres user cannot enter /root.
cd /

# ---------------------------------------------------------------------------
log 'Base packages, timezone and automatic security updates'
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git iproute2 openssl tzdata ufw fail2ban unattended-upgrades
ln -sf "/usr/share/zoneinfo/$TIMEZONE" /etc/localtime
echo "$TIMEZONE" >/etc/timezone
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban >/dev/null

# ---------------------------------------------------------------------------
# A build can briefly need more memory than a small server has.
if [[ -z "$(swapon --noheadings --show 2>/dev/null)" ]]; then
  log 'Adding 2 GB of swap'
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  if swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  else
    warn 'could not enable swap here; continuing without it.'
  fi
fi

# ---------------------------------------------------------------------------
log "Node.js $NODE_MAJOR, PostgreSQL $PG_MAJOR and Caddy"
install -d -m 0755 "$KEYRINGS"
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
  gpg --dearmor --yes -o "$KEYRINGS/nodesource.gpg"
echo "deb [signed-by=$KEYRINGS/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
  >/etc/apt/sources.list.d/nodesource.list
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$KEYRINGS/postgresql.asc"
echo "deb [signed-by=$KEYRINGS/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  >/etc/apt/sources.list.d/pgdg.list
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
  gpg --dearmor --yes -o "$KEYRINGS/caddy.gpg"
echo "deb [signed-by=$KEYRINGS/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
  >/etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y -q nodejs "postgresql-$PG_MAJOR" caddy

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == "$NODE_MAJOR" ]] || die "expected Node.js $NODE_MAJOR, found $(node -v)."

# ---------------------------------------------------------------------------
log 'App user'
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$(dirname "$ENV_FILE")"

# ---------------------------------------------------------------------------
log 'Database'
systemctl enable --now postgresql >/dev/null
for _ in $(seq 1 30); do
  pg_isready -q -h 127.0.0.1 -p 5432 && break
  sleep 1
done
pg_isready -q -h 127.0.0.1 -p 5432 || die 'PostgreSQL did not start on 127.0.0.1:5432.'

psql_admin() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }

if [[ -f "$ENV_FILE" ]]; then
  echo "Keeping the existing database settings in $ENV_FILE."
else
  # Hex only, so the password needs no escaping inside the connection URL.
  db_password="$(openssl rand -hex 24)"
  role_exists="$(psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")"
  verb=CREATE
  [[ "$role_exists" == 1 ]] && verb=ALTER
  # Sent on stdin so the password never appears in the process list.
  printf "%s ROLE %s LOGIN PASSWORD '%s';\n" "$verb" "$DB_USER" "$db_password" | psql_admin
  {
    echo "$ENV_MARKER Keep this file private: it holds the database password."
    echo "DATABASE_URL=postgresql://$DB_USER:$db_password@127.0.0.1:5432/$DB_NAME"
    echo 'SESSION_TTL_HOURS=12'
  } >"$ENV_FILE"
  unset db_password
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

if [[ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != 1 ]]; then
  psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
fi

# ---------------------------------------------------------------------------
log 'Service'
unit_file="/etc/systemd/system/$SERVICE.service"
cat >"$unit_file.new" <<EOF
[Unit]
Description=Dental Hub CRM
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$CURRENT_LINK
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=TZ=$TIMEZONE
ExecStart=/usr/bin/node $CURRENT_LINK/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $APP_PORT
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
unit_changed=0
if ! cmp -s "$unit_file.new" "$unit_file"; then
  mv "$unit_file.new" "$unit_file"
  unit_changed=1
else
  rm -f "$unit_file.new"
fi
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

# Builds and starts the commit this checkout is on. Already running it: no-op.
bash "$APP_DIR/deploy/update.sh" --no-fetch
if ((unit_changed)) || ! systemctl is-active --quiet "$SERVICE"; then
  systemctl restart "$SERVICE"
fi
wait_healthy 60 || die "the app did not become healthy. See: journalctl -u $SERVICE -n 50"
echo "The app is running and can reach its database."

# ---------------------------------------------------------------------------
log "HTTPS for $DOMAIN"
caddyfile=/etc/caddy/Caddyfile
if [[ -f "$caddyfile" && ! -f "$caddyfile.orig" ]]; then
  cp "$caddyfile" "$caddyfile.orig"
fi
{
  if [[ -n "$EMAIL" ]]; then
    printf '{\n\temail %s\n}\n\n' "$EMAIL"
  fi
  cat <<EOF
$DOMAIN {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	reverse_proxy 127.0.0.1:$APP_PORT
}
EOF
} >"$caddyfile"
caddy validate --adapter caddyfile --config "$caddyfile" >/dev/null
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

# ---------------------------------------------------------------------------
log 'Firewall: SSH, HTTP and HTTPS only'
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit "$SSH_PORT/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null
ufw status

# ---------------------------------------------------------------------------
resolved="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
server_ips="$(ip -4 -o addr show scope global 2>/dev/null | awk '{ sub(/\/.*/, "", $4); print $4 }' | paste -sd ' ' || true)"

log 'Done'
if [[ -z "$resolved" ]]; then
  warn "$DOMAIN does not resolve yet. Add a DNS A record pointing it at this server (${server_ips:-its IP})."
  echo "Caddy keeps retrying and issues the certificate once the record works."
elif [[ " $server_ips " != *" $resolved "* ]]; then
  warn "$DOMAIN points at $resolved, but this server's addresses are: ${server_ips:-unknown}."
  echo "Fix the DNS A record; Caddy issues the certificate once it points here."
else
  echo "$DOMAIN points at this server."
fi
cat <<EOF

Next step: create the first admin account (only once):

  cd $CURRENT_LINK && sudo -u $APP_USER npm run admin:create

Then open https://$DOMAIN and sign in.

Useful commands:
EOF
printf '  %-48s %s\n' \
  "sudo bash $APP_DIR/deploy/update.sh" 'deploy the latest code' \
  "systemctl status $SERVICE" 'is the app running?' \
  "journalctl -u $SERVICE -f" "follow the app's log" \
  'journalctl -u caddy -n 50' 'HTTPS and certificate log'
