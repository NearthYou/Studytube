#!/usr/bin/env bash
set -euo pipefail

deploy_branch="${1:-${DEPLOY_BRANCH:-sw}}"
deploy_sha="${DEPLOY_SHA:-}"
app_dir="${APP_DIR:-$(pwd)}"
auth_migration="1753660802000_auth-hardening"

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

setsid nohup npm run all > npm-run-all.log 2>&1 < /dev/null &

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
git rev-parse --short HEAD
