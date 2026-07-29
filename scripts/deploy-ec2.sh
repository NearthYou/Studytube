#!/usr/bin/env bash
set -euo pipefail

deploy_branch="${1:-${DEPLOY_BRANCH:-main}}"
deploy_sha="${DEPLOY_SHA:-}"
app_dir="${APP_DIR:-$(pwd)}"
requested_course_cutover_mode="${COURSE_CUTOVER_MODE:-}"
irreversible_migrations=(
  "1753660802000_auth-hardening"
  "1753660805000_retrieval-source-model-key"
)
retrieval_dedup_migration="1753660805000_retrieval-source-model-key"
retrieval_dedup_pending="false"
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

require_strong_secret() {
  local name="$1"
  local value="${!name:-}"

  if [ "${#value}" -lt 32 ]; then
    echo "$name must contain at least 32 characters in production" >&2
    return 1
  fi

  case "${value,,}" in
    *change-me*|*replace-with*|*example*|*placeholder*)
      echo "$name contains a documented placeholder and is forbidden in production" >&2
      return 1
      ;;
  esac
}

require_distinct_secrets() {
  local first_name="$1"
  local second_name="$2"
  if [ "${!first_name}" = "${!second_name}" ]; then
    echo "$first_name and $second_name must be different production secrets" >&2
    return 1
  fi
}

load_deployment_environment() {
  local path="$1"
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" == *$'\r'* ]] ||
       [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      echo "Deployment environment must contain only Unix KEY=value entries" >&2
      return 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      BASH_ENV|BASHOPTS|CDPATH|ENV|GLOBIGNORE|HOME|IFS|PATH|PROMPT_COMMAND|PS4|SHELLOPTS|NODE_OPTIONS|PYTHONHOME|PYTHONPATH|PERL5OPT|RUBYOPT|LD_PRELOAD|LD_LIBRARY_PATH|NPM_CONFIG_USERCONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*|DYLD_*)
        echo "Deployment environment contains forbidden process-control variable $key" >&2
        return 1
        ;;
    esac
    if [[ "$value" == *"'"* || "$value" == *'"'* || "$value" == *\\* ]]; then
      echo "Deployment environment values must use portable unquoted literals" >&2
      return 1
    fi
    export "$key=$value"
  done <"$path"
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

require_irreversible_migration_backup() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "Refusing irreversible migration: psql is required to verify migration state before cutover." >&2
    return 1
  fi

  local migration_history
  migration_history="$(
    psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --command "SELECT COALESCE(to_regclass('public.pgmigrations')::text, '')"
  )"

  local pending_migrations=()
  retrieval_dedup_pending="false"
  local migration_name
  local migration_applied
  for migration_name in "${irreversible_migrations[@]}"; do
    migration_applied="false"
    if [ -n "$migration_history" ]; then
      migration_applied="$(
        psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
          --set ON_ERROR_STOP=1 \
          --set migration_name="$migration_name" \
          --command "SELECT EXISTS (SELECT 1 FROM pgmigrations WHERE name = :'migration_name')"
      )"
    fi
    if [ "$migration_applied" != "t" ]; then
      pending_migrations+=("$migration_name")
      if [ "$migration_name" = "$retrieval_dedup_migration" ]; then
        retrieval_dedup_pending="true"
      fi
    fi
  done

  if [ "${#pending_migrations[@]}" -eq 0 ]; then
    return 0
  fi

  local marker_path="${IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER:-${AUTH_CUTOVER_VERIFIED_BACKUP_MARKER:-}}"
  local expected_sha="${deploy_sha:-$(git rev-parse HEAD)}"

  if [ -z "$marker_path" ] || [ ! -f "$marker_path" ] || [ ! -r "$marker_path" ] || [ -L "$marker_path" ]; then
    echo "Refusing irreversible migration: IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER must name a readable regular non-symlink file created by the backup and restore rehearsal." >&2
    return 1
  fi

  if ! grep -Fqx -- "backup_verified=true" "$marker_path" ||
     ! grep -Fqx -- "deploy_sha=$expected_sha" "$marker_path"; then
    echo "Refusing irreversible migration: the verified backup marker does not match this deploy SHA." >&2
    return 1
  fi

  for migration_name in "${pending_migrations[@]}"; do
    if ! grep -Fqx -- "migration=$migration_name" "$marker_path"; then
      echo "Refusing irreversible migration: the verified backup marker does not cover $migration_name." >&2
      return 1
    fi
  done
}

retrieval_duplicate_excess_count() {
  local table_name
  table_name="$(
    psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --command "SELECT COALESCE(to_regclass('public.retrieval_embeddings')::text, '')"
  )"
  if [ -z "$table_name" ]; then
    printf '0\n'
    return 0
  fi

  psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
    --set ON_ERROR_STOP=1 \
    --command "
      SELECT COALESCE(SUM(grouped.row_count - 1), 0)::bigint
      FROM (
        SELECT count(*)::bigint AS row_count
        FROM retrieval_embeddings
        GROUP BY source_kind, source_id, model
        HAVING count(*) > 1
      ) AS grouped
    "
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

if [ -f .env ]; then
  load_deployment_environment ./.env
fi
if [ -f api/.env ]; then
  load_deployment_environment ./api/.env
fi

if [ -n "$requested_course_cutover_mode" ]; then
  export COURSE_CUTOVER_MODE="$requested_course_cutover_mode"
fi

VALKEY_URL="${VALKEY_URL:-redis://127.0.0.1:6379}"
export VALKEY_URL

for required_name in \
  DATABASE_URL \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  INTERNAL_AI_API_KEY \
  AUTH_VERIFICATION_PEPPER \
  AUTH_RATE_LIMIT_PEPPER \
  AUTH_EMAIL_PROVIDER \
  AUTH_EMAIL_SENDER \
  AUTH_EMAIL_AWS_REGION \
  STUDYTUBE_SITE_ADDRESS \
  STUDYTUBE_PUBLIC_URL \
  WEB_ORIGIN; do
  if [ -z "${!required_name:-}" ]; then
    echo "$required_name is required for production deployment" >&2
    exit 1
  fi
done

if [ "$AUTH_EMAIL_PROVIDER" != "ses" ]; then
  echo "AUTH_EMAIL_PROVIDER must be ses in production" >&2
  exit 1
fi

for secret_name in \
  POSTGRES_PASSWORD \
  INTERNAL_AI_API_KEY \
  AUTH_VERIFICATION_PEPPER \
  AUTH_RATE_LIMIT_PEPPER; do
  require_strong_secret "$secret_name"
done

require_distinct_secrets INTERNAL_AI_API_KEY AUTH_VERIFICATION_PEPPER
require_distinct_secrets INTERNAL_AI_API_KEY AUTH_RATE_LIMIT_PEPPER
require_distinct_secrets AUTH_VERIFICATION_PEPPER AUTH_RATE_LIMIT_PEPPER

if [ "$VALKEY_URL" != "redis://127.0.0.1:6379" ]; then
  echo "VALKEY_URL must use the loopback Valkey service in production" >&2
  exit 1
fi

require_production_origins

git checkout --detach "$deploy_sha"
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Refusing to build a dirty deployment checkout" >&2
  git status --short >&2
  exit 1
fi

docker compose -f infra/production.compose.yml up -d --wait postgres valkey

require_irreversible_migration_backup
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
ai/.venv/bin/python -m pip install \
  --disable-pip-version-check \
  --no-cache-dir \
  --require-hashes \
  -r ai/requirements.txt

APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
  bash scripts/install-production-runtime.sh

docker compose -f infra/production.compose.yml run --rm --no-deps caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile

sudo systemctl stop studytube-api.service studytube-ai.service studytube-worker.service || true

# One-time cleanup for hosts that used the previous development runtime.
pkill -f '[s]cripts/dev-all.mjs' || true
pkill -f '[u]vicorn' || true
pkill -f '[v]ite' || true
pkill -f '[n]est start' || true
pkill -f '[a]pi/dist/src/main' || true
pkill -f '[a]pi/dist/src/worker' || true
sleep 1

for port in 3000 5173 8000; do
  pids="$(sudo lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Refusing deployment while unmanaged process $pids listens on port $port" >&2
    exit 1
  fi
done

# Recheck every database-bound guard immediately before migration.
require_irreversible_migration_backup
require_course_cutover_configuration

retrieval_duplicate_rows_before=""
if [ "$retrieval_dedup_pending" = "true" ]; then
  retrieval_duplicate_rows_before="$(retrieval_duplicate_excess_count)"
  if [[ ! "$retrieval_duplicate_rows_before" =~ ^[0-9]+$ ]]; then
    echo "Could not verify the retrieval duplicate count before migration" >&2
    exit 1
  fi
  printf 'retrieval_duplicate_rows_before=%s\n' "$retrieval_duplicate_rows_before"
fi

npm --prefix api run db:migrate:up

if [ "$retrieval_dedup_pending" = "true" ]; then
  retrieval_duplicate_rows_after="$(retrieval_duplicate_excess_count)"
  if [ "$retrieval_duplicate_rows_after" != "0" ]; then
    echo "Retrieval duplicate verification failed after migration" >&2
    exit 1
  fi
  printf 'retrieval_duplicate_rows_after=%s\n' "$retrieval_duplicate_rows_after"
fi

if [ "$course_cutover_mode" = "course" ] && [ "$course_already_activated" = "false" ]; then
  write_course_activation_marker
  course_already_activated="true"
fi

sudo systemctl restart studytube-ai.service studytube-api.service studytube-worker.service

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

wait_for_unix_url() {
  local socket_path="$1"
  local url="$2"
  local label="$3"

  for _attempt in $(seq 1 60); do
    if curl -fsS --unix-socket "$socket_path" \
      --connect-timeout 2 --max-time 5 "$url" >"$healthcheck_output" 2>/dev/null; then
      cat "$healthcheck_output"
      return 0
    fi

    sleep 1
  done

  echo "Timed out waiting for $label on Unix socket $socket_path" >&2
  return 1
}

if ! wait_for_unix_url /run/studytube/api.sock http://localhost/health/ready api; then
  sudo journalctl -u studytube-api.service -n 120 --no-pager >&2 || true
  exit 1
fi
if ! wait_for_url http://127.0.0.1:8000/health ai; then
  sudo journalctl -u studytube-ai.service -n 120 --no-pager >&2 || true
  exit 1
fi
if ! sudo systemctl is-active --quiet studytube-worker.service; then
  sudo journalctl -u studytube-worker.service -n 120 --no-pager >&2 || true
  exit 1
fi
if [ "$(docker compose -f infra/production.compose.yml exec -T valkey valkey-cli ping)" != "PONG" ]; then
  echo "Valkey health check failed" >&2
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
wait_for_url "$public_base_url/api/health/live" public-api >/dev/null
wait_for_url "$public_base_url/" public-web >/dev/null

write_deploy_success_marker
git rev-parse --short HEAD
