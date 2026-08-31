#!/usr/bin/env bash
set -euo pipefail

load_operator_config() {
  local config_file="${STUDYTUBE_CONFIG_FILE:-/etc/studytube/deployment.env}"
  [ -e "$config_file" ] || return 0
  if [ -L "$config_file" ] || [ ! -f "$config_file" ]; then
    echo 'RESET_CONFIG_FILE_UNSAFE' >&2
    exit 2
  fi
  if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ]; then
    [ "$(stat -c '%u' "$config_file")" = '0' ] || {
      echo 'RESET_CONFIG_OWNER_INVALID' >&2
      exit 2
    }
    [ -z "$(find "$config_file" -maxdepth 0 -perm /022 -print)" ] || {
      echo 'RESET_CONFIG_MODE_INVALID' >&2
      exit 2
    }
  fi
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
}

load_operator_config

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
state_root="${USER_DATA_RESET_STATE_DIR:-/var/lib/studytube/user-data-reset}"
maintenance_marker="${USER_DATA_RESET_MAINTENANCE_MARKER:-/run/studytube/user-data-reset-active}"
compose_file="${USER_DATA_RESET_COMPOSE_FILE:-$repo_root/infra/production.compose.yml}"
health_url="${USER_DATA_RESET_HEALTH_URL:-${STUDYTUBE_PUBLIC_URL:-https://studytube.page}/api/health/live}"
google_start_url="${STUDYTUBE_PUBLIC_URL:-https://studytube.page}/api/auth/google/start?returnTo=%2F"
mode="${1:-plan}"
if [ "$#" -gt 0 ]; then shift; fi
run_id=""
manifest_sha=""
plan_sha=""
approval=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-id) run_id="${2:-}"; shift 2 ;;
    --manifest-sha256) manifest_sha="${2:-}"; shift 2 ;;
    --plan-sha256) plan_sha="${2:-}"; shift 2 ;;
    --approval) approval="${2:-}"; shift 2 ;;
    *) echo 'RESET_RUN_ARGUMENT_INVALID' >&2; exit 2 ;;
  esac
done

reset_cli() {
  if [ -n "${USER_DATA_RESET_CLI_BIN:-}" ]; then
    "$USER_DATA_RESET_CLI_BIN" "$@"
  else
    node "$repo_root/api/dist/scripts/user-data-reset.js" "$@"
  fi
}

reset_backup() {
  if [ -n "${USER_DATA_RESET_BACKUP_BIN:-}" ]; then
    "$USER_DATA_RESET_BACKUP_BIN" "$@"
  else
    bash "$repo_root/scripts/user-data-reset-backup.sh" "$@"
  fi
}

docker_compose() {
  docker compose -f "$compose_file" "$@"
}

if [ "$mode" = 'plan' ]; then
  if [ -n "$manifest_sha" ] || [ -n "$plan_sha" ] || [ -n "$approval" ]; then
    echo 'RESET_RUN_PLAN_ARGUMENT_INVALID' >&2
    exit 2
  fi
  if [ -z "$run_id" ]; then
    run_id="reset-$(date -u +'%Y%m%dT%H%M%SZ')"
  fi
  if [[ ! "$run_id" =~ ^reset-[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo 'RESET_RUN_ID_INVALID' >&2
    exit 2
  fi
  backup_plan="$(reset_backup --plan --run-id "$run_id")"
  database_plan="$(reset_cli --plan)"
  valkey_keys="$(docker_compose exec -T valkey valkey-cli DBSIZE)"
  api_state="$(systemctl is-active studytube-api.service 2>/dev/null || true)"
  worker_state="$(systemctl is-active studytube-worker.service 2>/dev/null || true)"
  node - "$backup_plan" "$database_plan" "$valkey_keys" "$api_state" \
    "$worker_state" "$run_id" <<'NODE'
const [backup, database, valkeyKeys, apiState, workerState, runId] = process.argv.slice(2);
console.log(JSON.stringify({
  mode: 'plan',
  runId,
  writes: false,
  backup: JSON.parse(backup),
  database: JSON.parse(database),
  valkeyKeys: Number(valkeyKeys),
  services: { api: apiState, worker: workerState },
}));
NODE
  exit 0
fi

if [ "$mode" != 'execute' ]; then
  echo 'RESET_RUN_MODE_INVALID' >&2
  exit 2
fi
if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ] &&
   [ "$(id -u)" -ne 0 ]; then
  echo 'RESET_RUN_ROOT_REQUIRED' >&2
  exit 2
fi
if [[ ! "$run_id" =~ ^reset-[0-9]{8}T[0-9]{6}Z$ ]] ||
   [[ ! "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] ||
   [[ ! "$plan_sha" =~ ^[0-9a-f]{64}$ ]] ||
   [ "$approval" != "RESET:$run_id:$manifest_sha:$plan_sha" ]; then
  echo 'RESET_RUN_APPROVAL_INVALID' >&2
  exit 2
fi
if [ "${AUTH_MODE:-}" != 'google_only' ]; then
  echo 'RESET_RUN_GOOGLE_ONLY_REQUIRED' >&2
  exit 2
fi
if [ -e "$maintenance_marker" ]; then
  echo 'RESET_RUN_ALREADY_ACTIVE' >&2
  exit 2
fi
if [ ! -f "$compose_file" ]; then
  echo 'RESET_RUN_COMPOSE_FILE_MISSING' >&2
  exit 2
fi

current_plan="$(reset_cli --plan)"
node - "$current_plan" "$manifest_sha" "$plan_sha" <<'NODE'
const [raw, expectedManifest, expectedPlan] = process.argv.slice(2);
const plan = JSON.parse(raw);
if (plan.manifestSha256 !== expectedManifest || plan.planSha256 !== expectedPlan) {
  throw new Error('RESET_RUN_PLAN_CHANGED');
}
NODE

if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ]; then
  valkey_container="${USER_DATA_RESET_VALKEY_CONTAINER:-studytube-valkey}"
  expected_compose_project="${USER_DATA_RESET_COMPOSE_PROJECT:-studytube}"
  valkey_name="$(docker inspect --format '{{.Name}}' "$valkey_container")"
  valkey_project="$(docker inspect \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}' \
    "$valkey_container")"
  if [ "$valkey_name" != "/$valkey_container" ] ||
     [ "$valkey_project" != "$expected_compose_project" ]; then
    echo 'RESET_RUN_VALKEY_OWNERSHIP_INVALID' >&2
    exit 2
  fi
fi

mkdir -p -- "$(dirname "$maintenance_marker")" "$state_root/$run_id"
printf 'run_id=%s\nmanifest_sha256=%s\nplan_sha256=%s\n' \
  "$run_id" "$manifest_sha" "$plan_sha" \
  >"$maintenance_marker"
chmod 0600 "$maintenance_marker"

contain_failure() {
  local status="$?"
  trap - EXIT
  if [ "$status" -ne 0 ] && [ -e "$maintenance_marker" ]; then
    systemctl stop studytube-worker.service >/dev/null 2>&1 || true
    systemctl stop studytube-api.service >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap contain_failure EXIT

systemctl stop studytube-worker.service
systemctl stop studytube-api.service

reset_backup --execute --run-id "$run_id" \
  --manifest-sha256 "$manifest_sha" --plan-sha256 "$plan_sha"
proof_path="$state_root/$run_id/verified-backup.json"
if [ ! -f "$proof_path" ]; then
  echo 'RESET_RUN_BACKUP_PROOF_MISSING' >&2
  exit 1
fi

reset_result="$(
  USER_DATA_RESET_APPROVAL="$approval" \
  USER_DATA_RESET_BACKUP_PROOF="$proof_path" \
  USER_DATA_RESET_MAINTENANCE_MARKER="$maintenance_marker" \
    reset_cli --execute --run-id "$run_id" \
      --manifest-sha256 "$manifest_sha" --plan-sha256 "$plan_sha"
)"
node - "$reset_result" "$plan_sha" <<'NODE'
const [raw, expectedPlan] = process.argv.slice(2);
const result = JSON.parse(raw);
if (result.status !== 'reset' || result.totalResetRowsAfter !== 0 ||
    result.planSha256Before !== expectedPlan) {
  throw new Error('RESET_RUN_DATABASE_POSTCONDITION_FAILED');
}
NODE

flush_result="$(docker_compose exec -T valkey valkey-cli FLUSHDB)"
if [ "$flush_result" != 'OK' ]; then
  echo 'RESET_RUN_VALKEY_FLUSH_FAILED' >&2
  exit 1
fi
valkey_keys="$(docker_compose exec -T valkey valkey-cli DBSIZE)"
if [ "$valkey_keys" != '0' ]; then
  echo 'RESET_RUN_VALKEY_NOT_EMPTY' >&2
  exit 1
fi

systemctl start studytube-api.service
health_attempts="${USER_DATA_RESET_HEALTH_ATTEMPTS:-30}"
health_delay_seconds="${USER_DATA_RESET_HEALTH_DELAY_SECONDS:-2}"
if [[ ! "$health_attempts" =~ ^[1-9][0-9]?$ ]] ||
   [[ ! "$health_delay_seconds" =~ ^[0-9]+$ ]]; then
  echo 'RESET_RUN_HEALTH_CONFIG_INVALID' >&2
  exit 2
fi
health_ready=false
for ((attempt = 1; attempt <= health_attempts; attempt += 1)); do
  if curl -fsS --max-time 5 "$health_url" >/dev/null; then
    health_ready=true
    break
  fi
  sleep "$health_delay_seconds"
done
if [ "$health_ready" != 'true' ]; then
  echo 'RESET_RUN_API_HEALTH_FAILED' >&2
  exit 1
fi
google_headers="$(curl -fsSI --max-time 5 "$google_start_url")"
node - "$google_headers" <<'NODE'
const headers = process.argv[2];
if (!/^HTTP\/\S+ 302\b/m.test(headers)) {
  throw new Error('RESET_RUN_GOOGLE_START_STATUS_INVALID');
}
const location = headers.match(/^location:\s*(\S+)\s*$/im)?.[1];
if (!location || new URL(location).hostname !== 'accounts.google.com') {
  throw new Error('RESET_RUN_GOOGLE_START_LOCATION_INVALID');
}
NODE
systemctl start studytube-worker.service
rm -f -- "$maintenance_marker"
trap - EXIT

node - "$run_id" "$manifest_sha" "$plan_sha" <<'NODE'
const [runId, manifestSha256, planSha256] = process.argv.slice(2);
console.log(JSON.stringify({
  status: 'complete',
  runId,
  manifestSha256,
  planSha256,
  resetTotalRowsAfter: 0,
  valkeyKeysAfter: 0,
  authMode: 'google_only',
}));
NODE
