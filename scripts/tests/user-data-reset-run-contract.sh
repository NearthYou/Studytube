#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
run_script="$repo_root/scripts/user-data-reset-run.sh"
temporary_dir="$(mktemp -d)"
trap 'rm -rf -- "$temporary_dir"' EXIT

[[ -f "$run_script" ]] || {
  echo 'reset run script is missing' >&2
  exit 1
}

fake_bin="$temporary_dir/bin"
state_dir="$temporary_dir/state"
marker="$temporary_dir/user-data-reset-active"
command_log="$temporary_dir/commands.log"
mkdir -p -- "$fake_bin" "$state_dir"
: >"$command_log"

cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf 'systemctl <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
exit 0
EOF

cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
if [ "${1:-}" = 'inspect' ]; then
  if [[ "$*" == *'com.docker.compose.project'* ]]; then
    printf 'studytube\n'
  else
    printf '/studytube-valkey\n'
  fi
fi
if [[ "$*" == *'DBSIZE'* ]]; then printf '0\n'; fi
if [[ "$*" == *'FLUSHDB'* ]]; then printf 'OK\n'; fi
exit 0
EOF

cat >"$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
if [[ "$*" == *'/auth/google/start'* ]]; then
  printf 'HTTP/1.1 302 Found\r\nLocation: https://accounts.google.com/\r\n\r\n'
elif [ "${FAKE_HEALTH_FAILURE:-false}" = 'true' ]; then
  exit 22
else
  printf '{"status":"ok"}\n'
fi
EOF

cat >"$fake_bin/stat" <<'EOF'
#!/usr/bin/env bash
printf '0\n'
EOF

cat >"$fake_bin/find" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"$fake_bin/id" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = '-u' ]; then printf '0\n'; fi
EOF

cat >"$fake_bin/reset-cli" <<'EOF'
#!/usr/bin/env bash
printf 'reset-cli <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
if [ "${1:-}" = '--plan' ]; then
  printf '{"databaseName":"app","manifestSha256":"%s","planSha256":"%s","totalResetRows":6}\n' "$RESET_MANIFEST_SHA" "$RESET_PLAN_SHA"
  exit 0
fi
if [[ "${FAKE_RESET_FAILURE:-false}" == 'true' ]]; then
  exit 29
fi
printf '{"status":"reset","totalResetRowsAfter":0,"planSha256Before":"%s"}\n' "$RESET_PLAN_SHA"
EOF

cat >"$fake_bin/reset-backup" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'reset-backup <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
if [ "${1:-}" = '--plan' ]; then
  printf '{"mode":"plan","writes":false}\n'
  exit 0
fi
run_id=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-id) run_id="$2"; shift 2 ;;
    *) shift ;;
  esac
done
directory="$USER_DATA_RESET_STATE_DIR/$run_id"
mkdir -p -- "$directory"
printf '{"schemaVersion":"studytube.user-data-reset-backup.v1","restoreVerified":true,"planSha256":"%s"}\n' "$RESET_PLAN_SHA" \
  >"$directory/verified-backup.json"
printf '{"status":"verified"}\n'
EOF

chmod +x "$fake_bin"/*
manifest_sha="$(printf 'a%.0s' {1..64})"
plan_sha="$(printf 'b%.0s' {1..64})"
common_environment=(
  "PATH=$fake_bin:$PATH"
  "RESET_COMMAND_LOG=$command_log"
  "RESET_MANIFEST_SHA=$manifest_sha"
  "RESET_PLAN_SHA=$plan_sha"
  'USER_DATA_RESET_ALLOW_NON_ROOT_TEST=true'
  "USER_DATA_RESET_STATE_DIR=$state_dir"
  "USER_DATA_RESET_MAINTENANCE_MARKER=$marker"
  "USER_DATA_RESET_CLI_BIN=$fake_bin/reset-cli"
  "USER_DATA_RESET_BACKUP_BIN=$fake_bin/reset-backup"
  'USER_DATA_RESET_COMPOSE_FILE=infra/production.compose.yml'
  'AUTH_MODE=google_only'
  'STUDYTUBE_PUBLIC_URL=https://studytube.test'
  'USER_DATA_RESET_HEALTH_ATTEMPTS=2'
  'USER_DATA_RESET_HEALTH_DELAY_SECONDS=0'
)

safe_config="$temporary_dir/deployment.env"
: >"$safe_config"
env "${common_environment[@]}" \
  USER_DATA_RESET_ALLOW_NON_ROOT_TEST=false \
  STUDYTUBE_CONFIG_FILE="$safe_config" \
  bash "$run_script" plan >"$temporary_dir/root-config-plan.json"
grep -Fq '"mode":"plan"' "$temporary_dir/root-config-plan.json"

env "${common_environment[@]}" \
  bash "$run_script" plan >"$temporary_dir/plan.json"
grep -Fq '"mode":"plan"' "$temporary_dir/plan.json"
grep -Eq '"runId":"reset-[0-9]{8}T[0-9]{6}Z"' "$temporary_dir/plan.json"
if grep -Eq 'systemctl <(stop|start)|FLUSHDB' "$command_log"; then
  echo 'plan mode changed service state' >&2
  exit 1
fi

: >"$command_log"
changed_plan_sha="$(printf 'c%.0s' {1..64})"
set +e
env "${common_environment[@]}" \
  bash "$run_script" execute \
    --run-id reset-20260831T135000Z \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$changed_plan_sha" \
    --approval "RESET:reset-20260831T135000Z:$manifest_sha:$changed_plan_sha" \
    >"$temporary_dir/changed-plan.stdout" 2>"$temporary_dir/changed-plan.stderr"
changed_plan_status=$?
set -e
[[ "$changed_plan_status" -ne 0 ]] || {
  echo 'changed reset plan unexpectedly passed approval' >&2
  exit 1
}
if grep -Eq 'systemctl <(stop|start)|FLUSHDB' "$command_log"; then
  echo 'changed reset plan altered service state' >&2
  exit 1
fi

: >"$command_log"
run_id='reset-20260831T140000Z'
set +e
env "${common_environment[@]}" \
  bash "$run_script" execute \
    --run-id "$run_id" \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    --approval "RESET:$run_id:$manifest_sha:$plan_sha" \
    >"$temporary_dir/success.json"
success_status=$?
set -e
if [ "$success_status" -ne 0 ]; then
  echo 'successful reset contract unexpectedly failed' >&2
  cat "$command_log" >&2
  find "$state_dir" -maxdepth 3 -print >&2
  exit 1
fi
[[ ! -e "$marker" ]] || {
  echo 'successful reset left maintenance marker' >&2
  exit 1
}


: >"$command_log"
root_mode_run='reset-20260831T141000Z'
env "${common_environment[@]}" \
  USER_DATA_RESET_ALLOW_NON_ROOT_TEST=false \
  STUDYTUBE_CONFIG_FILE="$safe_config" \
  bash "$run_script" execute \
    --run-id "$root_mode_run" \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    --approval "RESET:$root_mode_run:$manifest_sha:$plan_sha" \
    >"$temporary_dir/root-mode-success.json"
grep -Fq 'com.docker.compose.project' "$command_log"

line_number() {
  grep -n -F "$1" "$command_log" | head -n1 | cut -d: -f1
}

stop_worker="$(line_number 'systemctl <stop studytube-worker.service>')"
stop_api="$(line_number 'systemctl <stop studytube-api.service>')"
backup="$(line_number 'reset-backup <--execute')"
reset="$(line_number 'reset-cli <--execute')"
flush="$(line_number 'FLUSHDB')"
start_api="$(line_number 'systemctl <start studytube-api.service>')"
start_worker="$(line_number 'systemctl <start studytube-worker.service>')"
if ! (( stop_worker < stop_api && stop_api < backup && backup < reset &&
        reset < flush && flush < start_api && start_api < start_worker )); then
  echo 'reset command order is unsafe' >&2
  cat "$command_log" >&2
  exit 1
fi

: >"$command_log"
failure_run='reset-20260831T150000Z'
set +e
env "${common_environment[@]}" FAKE_RESET_FAILURE=true \
  bash "$run_script" execute \
    --run-id "$failure_run" \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    --approval "RESET:$failure_run:$manifest_sha:$plan_sha" \
    >"$temporary_dir/failure.stdout" 2>"$temporary_dir/failure.stderr"
failure_status=$?
set -e
[[ "$failure_status" -ne 0 ]] || {
  echo 'failed reset unexpectedly succeeded' >&2
  exit 1
}
[[ -f "$marker" ]] || {
  echo 'failed reset removed its maintenance marker' >&2
  exit 1
}
if grep -Fq 'systemctl <start ' "$command_log"; then
  echo 'failed reset reopened services' >&2
  exit 1
fi

: >"$command_log"
rm -f -- "$marker"
health_failure_run='reset-20260831T151000Z'
set +e
env "${common_environment[@]}" FAKE_HEALTH_FAILURE=true \
  bash "$run_script" execute \
    --run-id "$health_failure_run" \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    --approval "RESET:$health_failure_run:$manifest_sha:$plan_sha" \
    >"$temporary_dir/health-failure.stdout" 2>"$temporary_dir/health-failure.stderr"
health_failure_status=$?
set -e
[[ "$health_failure_status" -ne 0 && -f "$marker" ]] || {
  echo 'failed post-reset health verification was not contained' >&2
  exit 1
}
[[ "$(grep -Fc 'systemctl <stop studytube-api.service>' "$command_log")" -ge 2 ]] || {
  echo 'failed post-reset health verification left the API open' >&2
  exit 1
}
if grep -Fq 'systemctl <start studytube-worker.service>' "$command_log"; then
  echo 'failed post-reset health verification started the worker' >&2
  exit 1
fi

echo 'User data reset run contract checks passed.'
