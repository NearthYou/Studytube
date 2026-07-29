#!/usr/bin/env bash
set -euo pipefail

deploy_branch="${1:-${DEPLOY_BRANCH:-sw}}"
deploy_sha="${DEPLOY_SHA:-}"
app_dir="${APP_DIR:-$(pwd)}"
auth_migration="1753660802000_auth-hardening"
course_cutover_mode=""
course_cutover_state_dir=""
frozen_parity_marker=""
course_activation_marker=""
course_already_activated="false"
course_database_identity=""

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
    echo "Refusing irreversible auth migration: AUTH_CUTOVER_VERIFIED_BACKUP_MARKER must name a readable regular non-symlink file created by the #11 backup and restore rehearsal." >&2
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

cd "$app_dir"

git fetch origin "$deploy_branch"

if [ -n "$deploy_sha" ]; then
  fetched_sha="$(git rev-parse "origin/$deploy_branch")"
  if [ "$fetched_sha" != "$deploy_sha" ]; then
    echo "Refusing stale deployment: CI verified $deploy_sha but origin/$deploy_branch is $fetched_sha" >&2
    exit 1
  fi
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

require_auth_cutover_backup
require_course_cutover_configuration
if [ "$course_cutover_mode" != "course" ] && [ "$course_already_activated" = "false" ]; then
  invalidate_frozen_parity_marker
fi

pkill -f '[n]pm run all' || true
pkill -f '[s]cripts/dev-all.mjs' || true
pkill -f '[u]vicorn' || true
pkill -f '[v]ite' || true
pkill -f '[n]est start' || true
pkill -f '[a]pi/dist/main' || true

for port in 3000 5173 8000; do
  pids="$(sudo lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill
  fi
done

sleep 2

for port in 3000 5173 8000; do
  pids="$(sudo lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill -9
  fi
done

if [ -n "$deploy_sha" ]; then
  git checkout --detach "$deploy_sha"
else
  git checkout "$deploy_branch"
  git pull --ff-only origin "$deploy_branch"
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

python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --upgrade pip
ai/.venv/bin/python -m pip install -r ai/requirements.txt

npm --prefix api run db:migrate:up

if [ "$course_cutover_mode" = "course" ] && [ "$course_already_activated" = "false" ]; then
  write_course_activation_marker
  course_already_activated="true"
fi

COURSE_CUTOVER_MODE="$course_cutover_mode" setsid nohup npm run all > npm-run-all.log 2>&1 < /dev/null &

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
  tail -120 npm-run-all.log >&2 || true
  return 1
}

wait_for_url http://localhost:3000/health/ready api
wait_for_url http://localhost:8000/health ai
wait_for_url http://localhost:5173/ web >/dev/null

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

git rev-parse --short HEAD
