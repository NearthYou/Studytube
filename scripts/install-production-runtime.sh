#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-$(pwd)}"
app_user="${APP_USER:-$(id -un)}"
app_group="${APP_GROUP:-$(id -gn "$app_user")}"
course_cutover_mode="${COURSE_CUTOVER_MODE:-}"
installer_command="${1:-install-runtime}"
build_user="${BUILD_USER:-studytube-build}"
build_group="${BUILD_GROUP:-studytube-build}"
build_home="${BUILD_HOME:-/var/lib/studytube-build}"
runtime_group="${RUNTIME_GROUP:-studytube-runtime}"
socket_group="${SOCKET_GROUP:-studytube-api-socket}"
api_user="${API_USER:-studytube-api}"
ai_user="${AI_USER:-studytube-ai}"
worker_user="${WORKER_USER:-studytube-worker}"
migration_user="${MIGRATION_USER:-studytube-migrate}"
runtime_config_dir="${RUNTIME_CONFIG_DIR:-/etc/studytube/runtime}"
systemd_unit_dir="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
web_release_root="${WEB_RELEASE_ROOT:-/var/www/studytube}"
deployment_guard_path='/run/studytube-deploy/resume-active'
deployment_guard_service='studytube-deploy-resume-guard.service'
deployment_watchdog_service='studytube-deployment-watchdog.service'
deployment_watchdog_control_path="${STUDYTUBE_WATCHDOG_CONTROL_PATH:-}"
deployment_watchdog_trip_path="${STUDYTUBE_WATCHDOG_TRIP_PATH:-}"
deployment_watchdog_cancel_path="${STUDYTUBE_WATCHDOG_CANCEL_PATH:-}"
deployment_watchdog_armed_path="${STUDYTUBE_WATCHDOG_ARMED_PATH:-}"
deployment_owner_sha="${STUDYTUBE_DEPLOYMENT_OWNER_SHA:-}"
deployment_control_enabled=false
build_tree_delegated=false
build_tree_trusted_owner=''
declare -a build_tree_paths=()
active_transient_unit=''

fail() {
  echo "$1" >&2
  exit 1
}

case "$app_dir" in
  /*) ;;
  *) fail "APP_DIR must be an absolute path" ;;
esac

if [[ ! "$app_dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  fail "APP_DIR contains unsupported characters"
fi
if [[ ! "$app_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  fail "APP_USER is invalid"
fi
if [[ ! "$app_group" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  fail "APP_GROUP is invalid"
fi
if [[ ! "$build_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  fail "BUILD_USER is invalid"
fi
if [[ ! "$build_group" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  fail "BUILD_GROUP is invalid"
fi
for principal_name in \
  "$runtime_group" \
  "$socket_group" \
  "$api_user" \
  "$ai_user" \
  "$worker_user" \
  "$migration_user"; do
  [[ "$principal_name" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] ||
    fail "runtime principal is invalid: $principal_name"
done
validate_install_path() {
  local value="$1"
  local label="$2"
  if [[ ! "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
     [[ "$value" == '/' || "$value" == *'/../'* || "$value" == */.. ]]; then
    fail "$label must be a simple absolute path"
  fi
}
validate_install_path "$build_home" BUILD_HOME
validate_install_path "$runtime_config_dir" RUNTIME_CONFIG_DIR
validate_install_path "$systemd_unit_dir" SYSTEMD_UNIT_DIR
validate_install_path "$web_release_root" WEB_RELEASE_ROOT

initialize_deployment_control() {
  if [[ -z "$deployment_watchdog_control_path" &&
        -z "$deployment_watchdog_trip_path" &&
        -z "$deployment_watchdog_cancel_path" &&
        -z "$deployment_watchdog_armed_path" &&
        -z "$deployment_owner_sha" ]]; then
    return 0
  fi
  [[ -n "$deployment_watchdog_control_path" &&
      -n "$deployment_watchdog_trip_path" &&
      -n "$deployment_watchdog_cancel_path" &&
      -n "$deployment_watchdog_armed_path" &&
      -n "$deployment_owner_sha" ]] ||
    fail "deployment watchdog control, trip, cancellation, armed, and owner values must be provided together"
  [[ "$deployment_owner_sha" =~ ^[0-9a-f]{40}$ ]] ||
    fail "deployment watchdog owner must be a lowercase full commit SHA"
  validate_install_path "$deployment_watchdog_control_path" STUDYTUBE_WATCHDOG_CONTROL_PATH
  validate_install_path "$deployment_watchdog_trip_path" STUDYTUBE_WATCHDOG_TRIP_PATH
  validate_install_path "$deployment_watchdog_cancel_path" STUDYTUBE_WATCHDOG_CANCEL_PATH
  validate_install_path "$deployment_watchdog_armed_path" STUDYTUBE_WATCHDOG_ARMED_PATH
  [[ "$deployment_watchdog_control_path" == */deployment-state/*-watchdog-control.lock ]] ||
    fail "deployment watchdog control path is outside immutable deployment state"
  local control_prefix="${deployment_watchdog_control_path%-watchdog-control.lock}"
  [[ "$control_prefix" != "$deployment_watchdog_control_path" &&
      "$deployment_watchdog_trip_path" == "$control_prefix-watchdog-tripped" &&
      "$deployment_watchdog_cancel_path" == "$control_prefix-watchdog-cancelled" ]] ||
    fail "deployment watchdog stop-marker paths do not match the control lock"
  [[ "$deployment_watchdog_armed_path" == "$control_prefix-watchdog-armed" &&
      "$control_prefix" == *"/$deployment_owner_sha" ]] ||
    fail "deployment watchdog armed path does not match its owner"
  [[ -f "$deployment_watchdog_control_path" && ! -L "$deployment_watchdog_control_path" ]] ||
    fail "deployment watchdog control lock must be a regular non-symlink file"
  [[ "$(stat -c '%u' "$deployment_watchdog_control_path")" == '0' ]] ||
    fail "deployment watchdog control lock must be owned by root"
  local control_mode
  control_mode="$(stat -c '%a' "$deployment_watchdog_control_path")" ||
    fail "could not inspect deployment watchdog control lock"
  (( (8#$control_mode & 0077) == 0 )) ||
    fail "deployment watchdog control lock must only be accessible by root"
  [[ -f "$deployment_watchdog_armed_path" && ! -L "$deployment_watchdog_armed_path" ]] ||
    fail "deployment watchdog armed marker must be a regular non-symlink file"
  [[ "$(stat -c '%u' "$deployment_watchdog_armed_path")" == '0' ]] ||
    fail "deployment watchdog armed marker must be owned by root"
  local armed_mode
  armed_mode="$(stat -c '%a' "$deployment_watchdog_armed_path")" ||
    fail "could not inspect deployment watchdog armed marker"
  (( (8#$armed_mode & 0077) == 0 )) ||
    fail "deployment watchdog armed marker must only be accessible by root"
  local command_name
  for command_name in flock sudo systemctl; do
    command -v "$command_name" >/dev/null 2>&1 ||
      fail "$command_name is required for controlled deployment work"
  done
  deployment_control_enabled=true
}

validate_deployment_trip_marker() {
  [[ "$deployment_control_enabled" == true ]] || return 0
  local marker_path marker_label marker_mode
  for marker_path in \
    "$deployment_watchdog_trip_path" \
    "$deployment_watchdog_cancel_path"; do
    [[ -e "$marker_path" || -L "$marker_path" ]] || continue
    if [[ "$marker_path" == "$deployment_watchdog_trip_path" ]]; then
      marker_label='trip'
    else
      marker_label='cancellation'
    fi
    [[ -f "$marker_path" && ! -L "$marker_path" ]] ||
      fail "deployment watchdog $marker_label marker is invalid"
    [[ "$(stat -c '%u' "$marker_path")" == '0' ]] ||
      fail "deployment watchdog $marker_label marker must be owned by root"
    marker_mode="$(stat -c '%a' "$marker_path")" ||
      fail "could not inspect deployment watchdog $marker_label marker"
    (( (8#$marker_mode & 0077) == 0 )) ||
      fail "deployment watchdog $marker_label marker must only be accessible by root"
    if [[ "$marker_label" == 'trip' ]]; then
      fail "deployment watchdog has tripped; refusing a new release mutation"
    fi
    fail "deployment watchdog has cancelled this release; refusing a new release mutation"
  done
}

verify_live_deployment_watchdog() {
  [[ "$deployment_control_enabled" == true ]] || return 0
  sudo systemctl is-active --quiet "$deployment_watchdog_service" ||
    fail "deployment watchdog is not active"
  local watchdog_main_pid
  watchdog_main_pid="$(sudo systemctl show "$deployment_watchdog_service" \
    --property=MainPID --value)" || fail "could not inspect deployment watchdog"
  [[ "$watchdog_main_pid" =~ ^[1-9][0-9]*$ ]] ||
    fail "deployment watchdog has no live main process"
  if [[ "$(wc -l <"$deployment_watchdog_armed_path")" -ne 3 ]] ||
    ! grep -Fqx -- 'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' "$deployment_watchdog_armed_path" ||
    ! grep -Fqx -- "DEPLOY_SHA=$deployment_owner_sha" "$deployment_watchdog_armed_path" ||
    ! grep -Fqx -- "WATCHDOG_PID=$watchdog_main_pid" "$deployment_watchdog_armed_path"; then
    fail "deployment watchdog armed marker does not match its live process"
  fi
}

acquire_deployment_control() {
  [[ "$deployment_control_enabled" == true ]] || return 0
  exec 196<>"$deployment_watchdog_control_path"
  flock -w 30 196 || fail "timed out waiting for deployment watchdog control"
  validate_deployment_trip_marker
  verify_live_deployment_watchdog
}

release_deployment_control() {
  [[ "$deployment_control_enabled" == true ]] || return 0
  exec 196>&-
}

initialize_deployment_control
case "$course_cutover_mode" in
  legacy|freeze|course) ;;
  *) fail "COURSE_CUTOVER_MODE must be legacy, freeze, or course" ;;
esac

validate_stt_cost_approval() {
  [[ "${STT_PROVIDER_ENABLED:-false}" == 'true' ]] || return 0
  local key value
  local required=(
    STT_COST_APPROVAL_RECORD
    STT_COST_APPROVAL_MODEL
    STT_COST_APPROVAL_ENVIRONMENT
    STT_COST_APPROVAL_MAX_USD
    STT_COST_APPROVAL_EXPIRES_AT
    STT_COST_APPROVAL_ID
  )
  for key in "${required[@]}"; do
    value="${!key:-}"
    [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
      fail "STT-enabled deployment requires a complete cost approval record"
  done
  [[ "$STT_COST_APPROVAL_MODEL" == 'gpt-4o-mini-transcribe-2025-12-15' ]] ||
    fail "STT cost approval model is not the pinned snapshot"
  [[ "$STT_COST_APPROVAL_ENVIRONMENT" == 'production' ]] ||
    fail "STT cost approval is not for production"
  [[ "$STT_COST_APPROVAL_MAX_USD" =~ ^[0-9]+([.][0-9]{1,2})?$ ]] ||
    fail "STT cost approval maximum is invalid"
  awk -v amount="$STT_COST_APPROVAL_MAX_USD" 'BEGIN { exit !(amount > 0) }' ||
    fail "STT cost approval maximum must be greater than zero"
  local expiry_epoch
  expiry_epoch="$(date -u -d "$STT_COST_APPROVAL_EXPIRES_AT" +%s 2>/dev/null || true)"
  [[ "$expiry_epoch" =~ ^[0-9]+$ && "$expiry_epoch" -gt "$(date -u +%s)" ]] ||
    fail "STT cost approval is invalid or expired"
}

validate_stt_cost_approval

ensure_build_principal() {
  if ! getent group "$build_group" >/dev/null 2>&1; then
    sudo groupadd --system "$build_group"
  fi
  if ! getent passwd "$build_user" >/dev/null 2>&1; then
    sudo useradd \
      --system \
      --gid "$build_group" \
      --home-dir "$build_home" \
      --shell /usr/sbin/nologin \
      "$build_user"
  fi
  sudo install -d -o "$build_user" -g "$build_group" -m 0750 "$build_home"
}

ensure_runtime_principals() {
  if ! getent group "$runtime_group" >/dev/null 2>&1; then
    sudo groupadd --system "$runtime_group"
  fi
  if ! getent group "$socket_group" >/dev/null 2>&1; then
    sudo groupadd --system "$socket_group"
  fi

  local service_user
  for service_user in "$api_user" "$ai_user" "$worker_user" "$migration_user"; do
    if ! getent group "$service_user" >/dev/null 2>&1; then
      sudo groupadd --system "$service_user"
    fi
    if ! getent passwd "$service_user" >/dev/null 2>&1; then
      sudo useradd \
        --system \
        --gid "$service_user" \
        --home-dir /nonexistent \
        --shell /usr/sbin/nologin \
        "$service_user"
    fi
    if [[ "$service_user" != "$migration_user" ]]; then
      sudo usermod --append --groups "$runtime_group" "$service_user"
    fi
  done
  sudo usermod --append --groups "$socket_group" "$api_user"
  sudo usermod --append --groups "$socket_group" "$ai_user"
}

write_runtime_environment() {
  local service_user="$1"
  local output_path="$2"
  shift 2
  local temporary_path
  temporary_path="$temporary_dir/$(basename -- "$output_path")"
  : >"$temporary_path"

  local key value
  for key in "$@"; do
    if [[ -v "$key" ]]; then
      value="${!key}"
      [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
        fail "$key cannot contain a line break"
      printf '%s=%s\n' "$key" "$value" >>"$temporary_path"
    fi
  done
  chmod 0600 "$temporary_path"
  sudo install -o root -g "$service_user" -m 0640 "$temporary_path" "$output_path"
}

transient_unit_state() {
  local unit_name="$1"
  local load_state load_status=0 unit_state
  load_state="$(sudo systemctl show "$unit_name" --property=LoadState --value)" ||
    load_status=$?
  if [[ "$load_state" == 'not-found' ]]; then
    printf 'inactive\n'
    return 0
  fi
  ((load_status == 0)) && [[ "$load_state" == 'loaded' ]] || return 1
  unit_state="$(sudo systemctl show "$unit_name" --property=ActiveState --value)" || return 1
  [[ -n "$unit_state" ]] || return 1
  printf '%s\n' "$unit_state"
}

transient_unit_is_quiescent() {
  case "$(transient_unit_state "$1")" in
    inactive|failed) return 0 ;;
    *) return 1 ;;
  esac
}

assert_transient_unit_inactive() {
  local unit_name="$1"
  if ! transient_unit_is_quiescent "$unit_name"; then
    fail "refusing to overlap active release transient unit: $unit_name"
  fi
}

cleanup_active_transient_unit() {
  local unit_name="$active_transient_unit"
  [[ -n "$unit_name" ]] || return 0
  local cleanup_status=0
  if ! transient_unit_is_quiescent "$unit_name"; then
    sudo systemctl kill --kill-whom=all --signal=KILL "$unit_name" >/dev/null 2>&1 ||
      cleanup_status=$?
    sudo systemctl stop "$unit_name" >/dev/null 2>&1 || cleanup_status=$?
  fi
  if ! transient_unit_is_quiescent "$unit_name"; then
    cleanup_status=1
  fi
  sudo systemctl reset-failed "$unit_name" >/dev/null 2>&1 || true
  ((cleanup_status == 0)) && active_transient_unit=''
  return "$cleanup_status"
}

run_isolated_build_command() {
  local network_mode="$1"
  local unit_name="$2"
  local command_path="$3"
  shift 3
  local -a network_properties=()
  case "$network_mode" in
    offline) network_properties+=(--property=PrivateNetwork=yes) ;;
    online) ;;
    *) fail "unsupported build network mode: $network_mode" ;;
  esac
  local system_path='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  assert_transient_unit_inactive "$unit_name"
  acquire_deployment_control
  active_transient_unit="$unit_name"
  local run_status=0 cleanup_status=0
  sudo env -i "PATH=$system_path" systemd-run \
    --quiet \
    --wait \
    --pipe \
    --collect \
    --service-type=exec \
    --unit="$unit_name" \
    --uid="$build_user" \
    --gid="$build_group" \
    --working-directory="$app_dir" \
    --property=NoNewPrivileges=yes \
    --property=PrivateDevices=yes \
    --property=PrivateTmp=yes \
    --property=ProtectHome=read-only \
    --property=ProtectSystem=strict \
    --property=ProtectKernelTunables=yes \
    --property=ProtectKernelModules=yes \
    --property=ProtectControlGroups=yes \
    --property=ProtectProc=invisible \
    --property=ProcSubset=pid \
    --property=RestrictSUIDSGID=yes \
    --property=UMask=0022 \
    --property=RuntimeMaxSec=20min \
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
    --property=IPAddressDeny=127.0.0.1/32 \
    --property=IPAddressDeny=::1/128 \
    --property=IPAddressDeny=169.254.169.254/32 \
    --property=IPAddressDeny=fd00:ec2::254/128 \
    "${network_properties[@]}" \
    --property="ReadWritePaths=$app_dir/web $app_dir/api $app_dir/ai $build_home" \
    -- /usr/bin/env -i \
      "HOME=$build_home" \
      "PATH=$system_path" \
      LANG=C.UTF-8 \
      LC_ALL=C.UTF-8 \
      CI=true \
      AWS_EC2_METADATA_DISABLED=true \
      npm_config_audit=false \
      npm_config_fund=false \
      npm_config_ignore_scripts=true \
      PIP_DISABLE_PIP_VERSION_CHECK=1 \
      PIP_NO_INPUT=1 \
      "$command_path" "$@" || run_status=$?
  cleanup_active_transient_unit || cleanup_status=$?
  release_deployment_control
  ((run_status == 0)) || return "$run_status"
  return "$cleanup_status"
}

restore_build_tree_ownership() {
  [[ "$build_tree_delegated" == true ]] || return 0
  local restore_status=0
  local restore_path
  for restore_path in "${build_tree_paths[@]}"; do
    sudo chown -R "$build_tree_trusted_owner" "$restore_path" || restore_status=$?
    sudo chmod -R a+rX,go-w "$restore_path" || restore_status=$?
  done
  ((restore_status == 0)) && build_tree_delegated=false
  return "$restore_status"
}

cleanup_prepare_release() {
  cleanup_active_transient_unit || return $?
  restore_build_tree_ownership
}

prepare_release() {
  local command_name
  for command_name in getent git npm python3 stat sudo systemctl systemd-run; do
    command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
  done
  local source_path
  for source_path in "$app_dir/web" "$app_dir/api" "$app_dir/ai"; do
    [[ -d "$source_path" && ! -L "$source_path" ]] ||
      fail "release source directory is invalid: $source_path"
  done
  local nested_environment_path
  for nested_environment_path in "$app_dir/api/.env" "$app_dir/ai/.env"; do
    [[ ! -e "$nested_environment_path" && ! -L "$nested_environment_path" ]] ||
      fail "legacy nested dotenv must be removed before release preparation: $nested_environment_path"
  done

  local npm_bin python_bin
  npm_bin="$(command -v npm)"
  python_bin="$(command -v python3)"
  [[ "$npm_bin" == /* ]] || fail "npm must resolve to an absolute path"
  [[ "$python_bin" == /* ]] || fail "python3 must resolve to an absolute path"

  ensure_build_principal

  local -a source_paths=("$app_dir/web" "$app_dir/api" "$app_dir/ai")
  build_tree_paths=("${source_paths[@]}")
  build_tree_trusted_owner="$(stat -c '%u:%g' "$app_dir")"

  sudo chmod 0755 "$(dirname -- "$app_dir")" "$app_dir"
  trap cleanup_prepare_release EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  build_tree_delegated=true

  local index
  for index in "${!source_paths[@]}"; do
    sudo chown -R "$build_user:$build_group" "${source_paths[$index]}"
  done

  local build_status=0
  run_isolated_build_command online studytube-release-web-dependencies.service \
    "$npm_bin" ci --prefix web --no-audit --fund=false --ignore-scripts ||
    build_status=$?
  if ((build_status == 0)); then
    run_isolated_build_command online studytube-release-api-dependencies.service \
      "$npm_bin" ci --prefix api --no-audit --fund=false --ignore-scripts ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command offline studytube-release-web-build.service \
      "$npm_bin" --prefix web run build --ignore-scripts ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command offline studytube-release-api-build.service \
      "$npm_bin" --prefix api run build --ignore-scripts ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command offline studytube-release-web-prune.service \
      "$npm_bin" prune --prefix web --omit=dev --ignore-scripts \
      --no-audit --fund=false ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command offline studytube-release-api-prune.service \
      "$npm_bin" prune --prefix api --omit=dev --ignore-scripts \
      --no-audit --fund=false ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command offline studytube-release-ai-venv.service \
      "$python_bin" -m venv ai/.venv ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command online studytube-release-ai-dependencies.service \
      "$app_dir/ai/.venv/bin/python" -m pip install \
      --disable-pip-version-check \
      --no-cache-dir \
      --require-hashes \
      --only-binary=:all: \
      -r ai/requirements.txt ||
      build_status=$?
  fi

  local cleanup_status=0
  cleanup_prepare_release || cleanup_status=$?
  ((cleanup_status == 0)) || return "$cleanup_status"
  trap - EXIT INT TERM
  ((build_status == 0)) || return "$build_status"

  [[ -z "$(git -C "$app_dir" status --porcelain --untracked-files=all)" ]] ||
    fail "release preparation modified tracked source"
}

run_isolated_migration_command() {
  local unit_name="$1"
  local allow_course_backfill="$2"
  local command_path="$3"
  shift 3
  local command_name
  for command_name in sudo systemctl systemd-run; do
    command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
  done
  local migration_environment="$runtime_config_dir/migration.env"
  [[ -f "$migration_environment" && ! -L "$migration_environment" ]] ||
    fail "migration runtime environment is missing"

  [[ "$command_path" == /* && -x "$command_path" ]] ||
    fail "migration command must resolve to an executable absolute path"
  local system_path
  system_path='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

  local executor
  # The isolated child shell expands these positional and allowlisted variables.
  # shellcheck disable=SC2016
  executor='exec /usr/bin/env -i HOME=/nonexistent PATH="$1" LANG=C.UTF-8 LC_ALL=C.UTF-8 NODE_ENV=production DATABASE_URL="$DATABASE_URL" COURSE_CUTOVER_MODE="${COURSE_CUTOVER_MODE:-}" REQUIRED_MIGRATIONS_DIR="${REQUIRED_MIGRATIONS_DIR:-}" STT_PROVIDER_ENABLED="${STT_PROVIDER_ENABLED:-false}" STT_COST_APPROVAL_MODEL="${STT_COST_APPROVAL_MODEL:-}" STT_COST_APPROVAL_MAX_USD="${STT_COST_APPROVAL_MAX_USD:-}" STT_COST_APPROVAL_EXPIRES_AT="${STT_COST_APPROVAL_EXPIRES_AT:-}" ALLOW_COURSE_BACKFILL="$2" "${@:3}"'
  assert_transient_unit_inactive "$unit_name"
  acquire_deployment_control
  trap cleanup_active_transient_unit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  active_transient_unit="$unit_name"
  local run_status=0 cleanup_status=0
  sudo env -i "PATH=$system_path" systemd-run \
    --quiet \
    --wait \
    --pipe \
    --collect \
    --service-type=exec \
    --unit="$unit_name" \
    --uid="$migration_user" \
    --gid="$migration_user" \
    --working-directory="$app_dir" \
    --property=NoNewPrivileges=yes \
    --property=PrivateDevices=yes \
    --property=PrivateTmp=yes \
    --property=ProtectHome=yes \
    --property=ProtectSystem=strict \
    --property=ProtectKernelTunables=yes \
    --property=ProtectKernelModules=yes \
    --property=ProtectControlGroups=yes \
    --property=ProtectProc=invisible \
    --property=ProcSubset=pid \
    --property=RestrictSUIDSGID=yes \
    --property=UMask=0077 \
    --property=RuntimeMaxSec=15min \
    --property=TimeoutStopSec=30s \
    --property=KillMode=control-group \
    --property=SendSIGKILL=yes \
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
    --property=IPAddressDeny=169.254.169.254/32 \
    --property=IPAddressDeny=fd00:ec2::254/128 \
    --property="EnvironmentFile=$migration_environment" \
    -- /usr/bin/bash -c "$executor" migration-runtime \
      "$system_path" "$allow_course_backfill" "$command_path" "$@" || run_status=$?
  cleanup_active_transient_unit || cleanup_status=$?
  release_deployment_control
  ((cleanup_status == 0)) || return "$cleanup_status"
  trap - EXIT INT TERM
  return "$run_status"
}

case "$installer_command" in
  prepare-release)
    prepare_release
    exit 0
    ;;
  run-migration)
    run_isolated_migration_command studytube-release-migration.service \
      false "$(command -v npm)" --prefix api run db:migrate:up
    exit 0
    ;;
  run-stt-approval)
    run_isolated_migration_command studytube-release-stt-approval.service \
      false "$(command -v node)" api/dist/scripts/apply-stt-cost-approval.js
    exit 0
    ;;
  run-course-backfill)
    run_isolated_migration_command studytube-release-course-backfill.service \
      true "$(command -v node)" api/dist/scripts/backfill-courses.js
    exit 0
    ;;
  run-course-verify)
    run_isolated_migration_command studytube-release-course-verify.service \
      false "$(command -v node)" api/dist/scripts/verify-course-backfill.js
    exit 0
    ;;
  run-learning-cutover)
    [[ "$course_cutover_mode" == 'course' ]] ||
      fail "learning cutover requires COURSE_CUTOVER_MODE=course"
    [[ "${DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]] ||
      fail "DEPLOY_SHA must be a full release SHA for learning cutover"
    run_isolated_migration_command studytube-release-learning-cutover.service \
      true "$(command -v env)" \
      "NODE_ENV=production" \
      "LEARNING_CUTOVER_WRITER_RELEASE=$DEPLOY_SHA" \
      "LEARNING_CUTOVER_ACTIVATE=true" \
      "LEARNING_CUTOVER_MAX_FREEZE_MS=${LEARNING_CUTOVER_MAX_FREEZE_MS:-30000}" \
      "$(command -v node)" api/dist/scripts/backfill-learning-items.js
    exit 0
    ;;
  install-runtime) ;;
  *) fail "unknown installer command: $installer_command" ;;
esac

acquire_deployment_control

for command_name in docker getent node sudo systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

node_bin="$(command -v node)"
case "$node_bin" in
  /*) ;;
  *) fail "node must resolve to an absolute path" ;;
esac

template_dir="$app_dir/infra/systemd"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-units.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
  release_deployment_control
}
trap cleanup EXIT

deployment_guard_dropin="$temporary_dir/90-studytube-deployment-guard.conf"
printf '%s\n' \
  '[Unit]' \
  "Requires=$deployment_guard_service" \
  "After=$deployment_guard_service" \
  "ConditionPathExists=!$deployment_guard_path" \
  >"$deployment_guard_dropin"

render_unit() {
  local template_path="$1"
  local output_path="$2"
  local content
  content="$(<"$template_path")"
  content="${content//@APP_DIR@/$app_dir}"
  content="${content//@API_USER@/$api_user}"
  content="${content//@AI_USER@/$ai_user}"
  content="${content//@WORKER_USER@/$worker_user}"
  content="${content//@RUNTIME_GROUP@/$runtime_group}"
  content="${content//@SOCKET_GROUP@/$socket_group}"
  content="${content//@RUNTIME_CONFIG_DIR@/$runtime_config_dir}"
  content="${content//@NODE_BIN@/$node_bin}"
  content="${content//@COURSE_CUTOVER_MODE@/$course_cutover_mode}"
  printf '%s\n' "$content" >"$output_path"
}

ensure_runtime_principals
sudo install -d -o root -g root -m 0755 \
  "$runtime_config_dir" \
  "$systemd_unit_dir" \
  "$web_release_root/releases"

api_environment_keys=(
  DEPLOY_SHA
  DATABASE_URL
  VALKEY_URL
  OUTBOX_POLL_INTERVAL_MS
  OUTBOX_PUBLISH_TIMEOUT_MS
  DB_INIT_ATTEMPTS
  DB_INIT_RETRY_DELAY_MS
  DB_QUERY_TIMEOUT_MS
  WEB_ORIGIN
  AI_SERVICE_URL
  AI_EMBEDDING_TIMEOUT_MS
  AI_CAPTION_TIMEOUT_MS
  AI_TRANSCRIPTION_TIMEOUT_MS
  AI_SUMMARY_TIMEOUT_MS
  AI_AGENT_TIMEOUT_MS
  AI_QUIZ_TIMEOUT_MS
  AI_GLOBAL_DAILY_AUDIO_SECONDS
  AI_USER_DAILY_AUDIO_SECONDS
  AI_MAX_CONCURRENT_WORKS
  AI_MAX_CONCURRENT_WORKS_PER_USER
  AI_ESTIMATED_MICROUNITS_PER_AUDIO_SECOND
  AI_GLOBAL_DAILY_COST_MICROUNITS
  AI_GLOBAL_MONTHLY_COST_MICROUNITS
  INTERNAL_AI_API_KEY
  MCP_SERVICE_ASSERTION_SECRET
  AUTH_VERIFICATION_PEPPER
  AUTH_RATE_LIMIT_PEPPER
  AUTH_MINIMUM_RESPONSE_MS
  AUTH_RATE_LIMIT_WINDOW_SECONDS
  AUTH_RATE_LIMIT_MAX_ATTEMPTS
  AUTH_EMAIL_PROVIDER
  AUTH_EMAIL_SENDER
  AUTH_EMAIL_CAPTURE_DIR
  AUTH_EMAIL_AWS_CREDENTIAL_SOURCE
  AUTH_EMAIL_AWS_REGION
  AUTH_EMAIL_SES_CONFIGURATION_SET
  AUTH_EMAIL_POLL_INTERVAL_MS
  AUTH_EMAIL_LEASE_MS
  AUTH_EMAIL_SEND_TIMEOUT_MS
  AUTH_EMAIL_MAX_ATTEMPTS
  AUTH_EMAIL_RETRY_BASE_MS
  AUTH_EMAIL_RETRY_MAX_MS
  COURSE_CUTOVER_STATE_DIR
  IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER
  REQUIRED_MIGRATIONS_DIR
  OTEL_SERVICE_NAME
  OTEL_SDK_DISABLED
  OTEL_TRACES_EXPORTER
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  OTEL_EXPORTER_OTLP_HEADERS
  OTEL_EXPORTER_OTLP_TRACES_HEADERS
  OTEL_EXPORTER_OTLP_PROTOCOL
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
  OTEL_EXPORTER_OTLP_TIMEOUT
  OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
  OTEL_EXPORTER_OTLP_CERTIFICATE
  OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE
  OTEL_EXPORTER_OTLP_CLIENT_KEY
  OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY
  OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE
  OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE
)
ai_environment_keys=(
  DATABASE_URL
  INTERNAL_AI_API_KEY
  MCP_SERVICE_ASSERTION_SECRET
  OPENAI_API_KEY
  STT_PROVIDER_ENABLED
  STT_COST_APPROVAL_RECORD
  STT_COST_APPROVAL_MODEL
  STT_COST_APPROVAL_ENVIRONMENT
  STT_COST_APPROVAL_MAX_USD
  STT_COST_APPROVAL_EXPIRES_AT
  STT_COST_APPROVAL_ID
  LLM_MODEL
  EMBEDDING_MODEL
  YOUTUBE_API_KEY
  YOUTUBE_PO_TOKEN
  YOUTUBE_VISITOR_DATA
  YOUTUBE_PROXY_URL
  YOUTUBE_AUTO_SUBTITLE_PO_TOKEN
  YOUTUBE_BGUTIL_SERVER_HOME
  YOUTUBE_COOKIES_FILE
  YOUTUBE_COOKIES_FROM_BROWSER
  YT_DLP_FETCH_PO_TOKEN
  YT_DLP_JS_RUNTIME
  YT_DLP_PATH
  YT_DLP_YOUTUBE_EXTRACTOR_ARGS
  FFMPEG_PATH
  MCP_BIND_HOST
  MCP_ASSERTION_ISSUER
  MCP_ASSERTION_AUDIENCE
  MCP_TOOL_TIMEOUT_SECONDS
  MCP_AUDIT_TIMEOUT_SECONDS
  MCP_RESOURCE_SERVER_URL
  MCP_ALLOWED_HOSTS
  STUDYTUBE_INTERNAL_API_URL
  OTEL_SERVICE_NAME
  OTEL_SDK_DISABLED
  OTEL_TRACES_EXPORTER
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  OTEL_EXPORTER_OTLP_HEADERS
  OTEL_EXPORTER_OTLP_TRACES_HEADERS
  OTEL_EXPORTER_OTLP_PROTOCOL
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
  OTEL_EXPORTER_OTLP_TIMEOUT
  OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
  OTEL_EXPORTER_OTLP_CERTIFICATE
  OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE
  OTEL_EXPORTER_OTLP_CLIENT_KEY
  OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY
  OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE
  OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE
)
worker_environment_keys=(
  DEPLOY_SHA
  DATABASE_URL
  VALKEY_URL
  OUTBOX_POLL_INTERVAL_MS
  OUTBOX_PUBLISH_TIMEOUT_MS
  DB_INIT_ATTEMPTS
  DB_INIT_RETRY_DELAY_MS
  DB_QUERY_TIMEOUT_MS
  WEB_ORIGIN
  AI_SERVICE_URL
  AI_EMBEDDING_TIMEOUT_MS
  AI_CAPTION_TIMEOUT_MS
  AI_TRANSCRIPTION_TIMEOUT_MS
  AI_SUMMARY_TIMEOUT_MS
  AI_AGENT_TIMEOUT_MS
  AI_QUIZ_TIMEOUT_MS
  AI_GLOBAL_DAILY_AUDIO_SECONDS
  AI_USER_DAILY_AUDIO_SECONDS
  AI_MAX_CONCURRENT_WORKS
  AI_MAX_CONCURRENT_WORKS_PER_USER
  AI_ESTIMATED_MICROUNITS_PER_AUDIO_SECOND
  AI_GLOBAL_DAILY_COST_MICROUNITS
  AI_GLOBAL_MONTHLY_COST_MICROUNITS
  INTERNAL_AI_API_KEY
  MCP_SERVICE_ASSERTION_SECRET
  AUTH_VERIFICATION_PEPPER
  AUTH_RATE_LIMIT_PEPPER
  AUTH_MINIMUM_RESPONSE_MS
  AUTH_RATE_LIMIT_WINDOW_SECONDS
  AUTH_RATE_LIMIT_MAX_ATTEMPTS
  AUTH_EMAIL_PROVIDER
  AUTH_EMAIL_SENDER
  AUTH_EMAIL_CAPTURE_DIR
  AUTH_EMAIL_AWS_CREDENTIAL_SOURCE
  AUTH_EMAIL_AWS_REGION
  AUTH_EMAIL_SES_CONFIGURATION_SET
  AUTH_EMAIL_POLL_INTERVAL_MS
  AUTH_EMAIL_LEASE_MS
  AUTH_EMAIL_SEND_TIMEOUT_MS
  AUTH_EMAIL_MAX_ATTEMPTS
  AUTH_EMAIL_RETRY_BASE_MS
  AUTH_EMAIL_RETRY_MAX_MS
  COURSE_CUTOVER_STATE_DIR
  IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER
  REQUIRED_MIGRATIONS_DIR
  AGENT_RUN_LEASE_MS
  AGENT_RUN_POLL_INTERVAL_MS
  AGENT_RUN_PROCESS_TIMEOUT_MS
  AGENT_RUN_WORKER_ID
  RETRIEVAL_EMBEDDING_CACHE_MAINTENANCE_INTERVAL_MS
  RETRIEVAL_EMBEDDING_CACHE_PRUNE_BATCH_SIZE
  RETRIEVAL_EMBEDDING_CACHE_RETENTION_DAYS
  OTEL_SERVICE_NAME
  OTEL_SDK_DISABLED
  OTEL_TRACES_EXPORTER
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  OTEL_EXPORTER_OTLP_HEADERS
  OTEL_EXPORTER_OTLP_TRACES_HEADERS
  OTEL_EXPORTER_OTLP_PROTOCOL
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
  OTEL_EXPORTER_OTLP_TIMEOUT
  OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
  OTEL_EXPORTER_OTLP_CERTIFICATE
  OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE
  OTEL_EXPORTER_OTLP_CLIENT_KEY
  OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY
  OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE
  OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE
)
migration_environment_keys=(
  DATABASE_URL
  COURSE_CUTOVER_MODE
  REQUIRED_MIGRATIONS_DIR
  STT_PROVIDER_ENABLED
  STT_COST_APPROVAL_MODEL
  STT_COST_APPROVAL_MAX_USD
  STT_COST_APPROVAL_EXPIRES_AT
)

write_runtime_environment \
  "$api_user" \
  "$runtime_config_dir/api.env" \
  "${api_environment_keys[@]}"
write_runtime_environment \
  "$ai_user" \
  "$runtime_config_dir/ai.env" \
  "${ai_environment_keys[@]}"
write_runtime_environment \
  "$worker_user" \
  "$runtime_config_dir/worker.env" \
  "${worker_environment_keys[@]}"
write_runtime_environment \
  "$migration_user" \
  "$runtime_config_dir/migration.env" \
  "${migration_environment_keys[@]}"

render_unit \
  "$template_dir/studytube-api.service.in" \
  "$temporary_dir/studytube-api.service"
render_unit \
  "$template_dir/studytube-ai.service.in" \
  "$temporary_dir/studytube-ai.service"
render_unit \
  "$template_dir/studytube-worker.service.in" \
  "$temporary_dir/studytube-worker.service"
render_unit \
  "$template_dir/studytube-caddy.service.in" \
  "$temporary_dir/studytube-caddy.service"

sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-api.service" \
  "$systemd_unit_dir/studytube-api.service"
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-ai.service" \
  "$systemd_unit_dir/studytube-ai.service"
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-worker.service" \
  "$systemd_unit_dir/studytube-worker.service"
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-caddy.service" \
  "$systemd_unit_dir/studytube-caddy.service"
for service_name in api ai worker caddy; do
  sudo install -d -o root -g root -m 0755 \
    "$systemd_unit_dir/studytube-$service_name.service.d"
  sudo install -o root -g root -m 0644 \
    "$deployment_guard_dropin" \
    "$systemd_unit_dir/studytube-$service_name.service.d/90-studytube-deployment-guard.conf"
done
sudo systemctl daemon-reload
sudo systemctl enable \
  studytube-api.service \
  studytube-ai.service \
  studytube-worker.service \
  studytube-caddy.service
