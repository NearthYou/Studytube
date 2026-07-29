#!/usr/bin/env bash
set -euo pipefail

deploy_branch="${1:-${DEPLOY_BRANCH:-main}}"
deploy_sha="${DEPLOY_SHA:-}"
app_dir="${APP_DIR:-$(pwd)}"
requested_course_cutover_mode="${COURSE_CUTOVER_MODE:-}"
auth_migration="1753660802000_auth-hardening"
course_cutover_mode=""
course_cutover_state_dir=""
frozen_parity_marker=""
course_activation_marker=""
course_already_activated="false"
course_database_identity=""
production_web_origin=""

normalize_https_origin() {
  local value="${1%/}"
  if [[ ! "$value" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]]; then
    return 1
  fi

  printf '%s\n' "$value"
}

require_production_origins() {
  if ! production_web_origin="$(normalize_https_origin "$WEB_ORIGIN")"; then
    echo "WEB_ORIGIN must use https and contain only an origin in production" >&2
    return 1
  fi

  local site_origin
  case "$STUDYTUBE_SITE_ADDRESS" in
    http://*)
      echo "STUDYTUBE_SITE_ADDRESS must use HTTPS" >&2
      return 1
      ;;
    https://*)
      if ! site_origin="$(normalize_https_origin "$STUDYTUBE_SITE_ADDRESS")"; then
        echo "STUDYTUBE_SITE_ADDRESS must use HTTPS" >&2
        return 1
      fi
      ;;
    *://*)
      echo "STUDYTUBE_SITE_ADDRESS must use HTTPS" >&2
      return 1
      ;;
    *)
      if ! site_origin="$(normalize_https_origin "https://$STUDYTUBE_SITE_ADDRESS")"; then
        echo "STUDYTUBE_SITE_ADDRESS must use HTTPS" >&2
        return 1
      fi
      ;;
  esac

  if [ "$site_origin" != "$production_web_origin" ]; then
    echo "STUDYTUBE_SITE_ADDRESS must match WEB_ORIGIN" >&2
    return 1
  fi

  local public_origin
  if ! public_origin="$(normalize_https_origin "${STUDYTUBE_PUBLIC_URL:-$WEB_ORIGIN}")" ||
     [ "$public_origin" != "$production_web_origin" ]; then
    echo "STUDYTUBE_PUBLIC_URL must match WEB_ORIGIN" >&2
    return 1
  fi
}

require_auth_cutover_backup() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "Refusing irreversible auth migration: psql is required to verify migration state before cutover." >&2
    return 1
  fi

  local migration_history
  migration_history="$(
    psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --command "SELECT COALESCE(to_regclass('public.pgmigrations')::text, '')"
  )"

  local migration_applied="false"
  if [ -n "$migration_history" ]; then
    migration_applied="$(
      psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
        --set ON_ERROR_STOP=1 \
        --set migration_name="$auth_migration" \
        --command "SELECT EXISTS (SELECT 1 FROM pgmigrations WHERE name = :'migration_name')"
    )"
  fi

  if [ "$migration_applied" = "t" ]; then
    return 0
  fi

  local marker_path="${AUTH_CUTOVER_VERIFIED_BACKUP_MARKER:-}"
  local expected_sha="${deploy_sha:-$(git rev-parse HEAD)}"

  if [ -z "$marker_path" ] || [ ! -f "$marker_path" ] || [ ! -r "$marker_path" ] || [ -L "$marker_path" ]; then
    echo "Refusing irreversible auth migration: AUTH_CUTOVER_VERIFIED_BACKUP_MARKER must name a readable regular non-symlink file created by the backup and restore rehearsal." >&2
    return 1
  fi

  if ! grep -Fqx -- "backup_verified=true" "$marker_path" ||
     ! grep -Fqx -- "migration=$auth_migration" "$marker_path" ||
     ! grep -Fqx -- "deploy_sha=$expected_sha" "$marker_path"; then
    echo "Refusing irreversible auth migration: the verified backup marker does not match this migration and deploy SHA." >&2
    return 1
  fi
}

require_course_cutover_configuration() {
  course_cutover_mode="${COURSE_CUTOVER_MODE:-}"

  case "$course_cutover_mode" in
    legacy|freeze|course) ;;
    *)
      echo "COURSE_CUTOVER_MODE must be explicitly set to legacy, freeze, or course" >&2
      return 1
      ;;
  esac

  if [ -z "$deploy_sha" ]; then
    echo "Refusing unpinned production deployment: DEPLOY_SHA is required." >&2
    return 1
  fi

  course_cutover_state_dir="${COURSE_CUTOVER_STATE_DIR:-.studytube-deploy-state}"
  case "$course_cutover_state_dir" in
    /*) ;;
    *) course_cutover_state_dir="$app_dir/$course_cutover_state_dir" ;;
  esac
  frozen_parity_marker="$course_cutover_state_dir/course-freeze-verified"
  course_activation_marker="$course_cutover_state_dir/course-activated"

  if [ -e "$course_activation_marker" ] || [ -L "$course_activation_marker" ]; then
    course_database_identity="$(read_course_database_identity)"
    if [ ! -f "$course_activation_marker" ] ||
       [ ! -r "$course_activation_marker" ] ||
       [ -L "$course_activation_marker" ] ||
       ! grep -Fqx -- "course_activated=true" "$course_activation_marker" ||
       ! grep -Fqx -- "database_identity=$course_database_identity" "$course_activation_marker"; then
      echo "Refusing deployment: the Course activation marker is invalid." >&2
      return 1
    fi
    course_already_activated="true"
  fi

  if [ "$course_already_activated" = "true" ] && [ "$course_cutover_mode" = "legacy" ]; then
    echo "Refusing legacy rollback after Course activation; native Course writes may already exist. Freeze and roll forward." >&2
    return 1
  fi

  if [ "$course_already_activated" = "false" ] && [ "$course_cutover_mode" = "course" ]; then
    course_database_identity="$(read_course_database_identity)"
    if [ ! -f "$frozen_parity_marker" ] ||
       [ ! -r "$frozen_parity_marker" ] ||
       [ -L "$frozen_parity_marker" ] ||
       ! grep -Fqx -- "parity_verified=true" "$frozen_parity_marker" ||
       ! grep -Fqx -- "deploy_sha=$deploy_sha" "$frozen_parity_marker" ||
       ! grep -Fqx -- "database_identity=$course_database_identity" "$frozen_parity_marker"; then
      echo "Refusing Course activation: frozen parity was not verified for DEPLOY_SHA=$deploy_sha" >&2
      return 1
    fi
  fi
}

read_course_database_identity() {
  psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
    --set ON_ERROR_STOP=1 \
    --command "SELECT current_database() || ':' || (SELECT oid::text FROM pg_database WHERE datname = current_database()) || '@' || COALESCE(inet_server_addr()::text, 'local') || ':' || COALESCE(inet_server_port()::text, current_setting('port'))"
}

invalidate_frozen_parity_marker() {
  if [ -f "$frozen_parity_marker" ] || [ -L "$frozen_parity_marker" ]; then
    rm -f -- "$frozen_parity_marker"
  elif [ -e "$frozen_parity_marker" ]; then
    echo "Refusing deployment: frozen parity marker path is not a regular file." >&2
    return 1
  fi
}

write_frozen_parity_marker() {
  install -m 700 -d "$course_cutover_state_dir"
  local temporary_marker
  course_database_identity="$(read_course_database_identity)"
  temporary_marker="$(mktemp "$course_cutover_state_dir/.freeze-verified.XXXXXX")"
  printf '%s\n' \
    "parity_verified=true" \
    "deploy_sha=$deploy_sha" \
    "database_identity=$course_database_identity" >"$temporary_marker"
  chmod 600 "$temporary_marker"
  mv -f -- "$temporary_marker" "$frozen_parity_marker"
}

write_course_activation_marker() {
  install -m 700 -d "$course_cutover_state_dir"
  local temporary_marker
  if [ -z "$course_database_identity" ]; then
    course_database_identity="$(read_course_database_identity)"
  fi
  temporary_marker="$(mktemp "$course_cutover_state_dir/.course-activated.XXXXXX")"
  printf '%s\n' \
    "course_activated=true" \
    "first_deploy_sha=$deploy_sha" \
    "database_identity=$course_database_identity" >"$temporary_marker"
  chmod 600 "$temporary_marker"
  mv -f -- "$temporary_marker" "$course_activation_marker"
}

write_deploy_success_marker() {
  install -m 700 -d "$course_cutover_state_dir"
  local marker_path="$course_cutover_state_dir/deploy-success"
  local temporary_marker
  temporary_marker="$(mktemp "$course_cutover_state_dir/.deploy-success.XXXXXX")"
  printf '%s\n' \
    "deploy_succeeded=true" \
    "deploy_sha=$deploy_sha" \
    "course_cutover_mode=$course_cutover_mode" >"$temporary_marker"
  chmod 600 "$temporary_marker"
  mv -f -- "$temporary_marker" "$marker_path"
}

publish_web_release() {
  local release_root="${WEB_RELEASE_ROOT:-/var/www/studytube}"
  if [ "$release_root" != "/var/www/studytube" ]; then
    echo "WEB_RELEASE_ROOT must be /var/www/studytube" >&2
    return 1
  fi

  local releases_dir="$release_root/releases"
  local release_dir="$releases_dir/$deploy_sha"
  sudo install -d -o root -g root -m 755 "$releases_dir"

  if sudo test -e "$release_dir" || sudo test -L "$release_dir"; then
    if ! sudo test -d "$release_dir" || sudo test -L "$release_dir" ||
       ! sudo test -f "$release_dir/index.html"; then
      echo "Refusing to reuse an invalid web release at $release_dir" >&2
      return 1
    fi
  else
    local staging_dir
    staging_dir="$(sudo mktemp -d "$releases_dir/.${deploy_sha}.XXXXXX")"
    if ! sudo cp -a "$app_dir/web/dist/." "$staging_dir/"; then
      sudo rm -rf -- "$staging_dir"
      return 1
    fi
    sudo chown -R root:root "$staging_dir"
    sudo find "$staging_dir" -type d -exec chmod 755 {} +
    sudo find "$staging_dir" -type f -exec chmod 644 {} +
    sudo mv -- "$staging_dir" "$release_dir"
  fi

  local temporary_link="$release_root/.current.$deploy_sha.$$"
  sudo ln -s "releases/$deploy_sha" "$temporary_link"
  sudo mv -Tf -- "$temporary_link" "$release_root/current"
}

cd "$app_dir"

deploy_lock_file="${DEPLOY_LOCK_FILE:-/tmp/studytube-deploy.lock}"
exec 8>"$deploy_lock_file"
if ! flock -n 8; then
  echo "Another StudyTube deployment is already running" >&2
  exit 1
fi

if [[ ! "$deploy_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Refusing unpinned production deployment: DEPLOY_SHA must be a full commit SHA." >&2
  exit 1
fi

git fetch origin "$deploy_branch"
fetched_sha="$(git rev-parse "origin/$deploy_branch")"
if [ "$fetched_sha" != "$deploy_sha" ]; then
  echo "Refusing stale deployment: CI verified $deploy_sha but origin/$deploy_branch is $fetched_sha" >&2
  exit 1
fi

# Deployment env files are trusted Bash-compatible key=value files.
set -a
if [ -f .env ]; then
  # shellcheck disable=SC1091
  source ./.env
fi
if [ -f api/.env ]; then
  # shellcheck disable=SC1091
  source ./api/.env
fi
set +a

if [ -n "$requested_course_cutover_mode" ]; then
  export COURSE_CUTOVER_MODE="$requested_course_cutover_mode"
fi

for required_name in \
  DATABASE_URL \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  STUDYTUBE_SITE_ADDRESS \
  WEB_ORIGIN; do
  if [ -z "${!required_name:-}" ]; then
    echo "$required_name is required for production deployment" >&2
    exit 1
  fi
done

require_production_origins

git checkout --detach "$deploy_sha"
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Refusing to build a dirty deployment checkout" >&2
  git status --short >&2
  exit 1
fi

docker compose -f infra/production.compose.yml up -d --wait postgres

require_auth_cutover_backup
require_course_cutover_configuration
if [ "$course_cutover_mode" != "course" ] && [ "$course_already_activated" = "false" ]; then
  invalidate_frozen_parity_marker
fi

if ! sudo swapon --show --noheadings | grep -q '/swapfile'; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi

  sudo chmod 600 /swapfile
  sudo mkswap /swapfile || true
  sudo swapon /swapfile
fi

npm ci --prefix web --no-audit --fund=false
npm ci --prefix api --no-audit --fund=false
npm --prefix web run build
npm --prefix api run build

python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --upgrade pip
ai/.venv/bin/python -m pip install -r ai/requirements.txt

APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
  bash scripts/install-production-runtime.sh

docker compose -f infra/production.compose.yml run --rm --no-deps caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile

sudo systemctl stop studytube-api.service studytube-ai.service || true

# One-time cleanup for hosts that used the previous development runtime.
pkill -f '[s]cripts/dev-all.mjs' || true
pkill -f '[u]vicorn' || true
pkill -f '[v]ite' || true
pkill -f '[n]est start' || true
pkill -f '[a]pi/dist/main' || true
sleep 1

for port in 3000 5173 8000; do
  pids="$(sudo lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Refusing deployment while unmanaged process $pids listens on port $port" >&2
    exit 1
  fi
done

# Recheck every database-bound guard immediately before migration.
require_auth_cutover_backup
require_course_cutover_configuration

npm --prefix api run db:migrate:up

if [ "$course_cutover_mode" = "course" ] && [ "$course_already_activated" = "false" ]; then
  write_course_activation_marker
  course_already_activated="true"
fi

sudo systemctl restart studytube-ai.service studytube-api.service

healthcheck_output="$(mktemp "${TMPDIR:-/tmp}/studytube-healthcheck.XXXXXX")"
cleanup_healthcheck_output() {
  rm -f "$healthcheck_output"
}
trap cleanup_healthcheck_output EXIT

wait_for_url() {
  local url="$1"
  local label="$2"

  for _attempt in $(seq 1 60); do
    if curl -fsS --connect-timeout 2 --max-time 5 "$url" >"$healthcheck_output" 2>/dev/null; then
      cat "$healthcheck_output"
      return 0
    fi

    sleep 1
  done

  echo "Timed out waiting for $label at $url" >&2
  return 1
}

if ! wait_for_url http://127.0.0.1:3000/health/ready api; then
  sudo journalctl -u studytube-api.service -n 120 --no-pager >&2 || true
  exit 1
fi
if ! wait_for_url http://127.0.0.1:8000/health ai; then
  sudo journalctl -u studytube-ai.service -n 120 --no-pager >&2 || true
  exit 1
fi

if [ "$course_cutover_mode" = "freeze" ]; then
  if [ "$course_already_activated" = "false" ]; then
    ALLOW_COURSE_BACKFILL=true COURSE_CUTOVER_MODE=freeze \
      npm --prefix api run db:course:backfill
    COURSE_CUTOVER_MODE=freeze npm --prefix api run db:course:verify
    write_frozen_parity_marker
  else
    echo "Post-activation freeze: automatic legacy backfill is disabled; diagnose and roll forward."
  fi
fi

publish_web_release

docker compose -f infra/production.compose.yml up -d caddy
docker compose -f infra/production.compose.yml exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

public_base_url="$production_web_origin"
wait_for_url "$public_base_url/api/health/ready" public-api >/dev/null
wait_for_url "$public_base_url/" public-web >/dev/null

write_deploy_success_marker
git rev-parse --short HEAD
