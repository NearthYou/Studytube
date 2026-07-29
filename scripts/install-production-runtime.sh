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
case "$course_cutover_mode" in
  legacy|freeze|course) ;;
  *) fail "COURSE_CUTOVER_MODE must be legacy, freeze, or course" ;;
esac

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
  local temporary_path="$temporary_dir/$(basename -- "$output_path")"
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
  local unit_name="$1"
  local command_path="$2"
  shift 2
  local system_path='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  assert_transient_unit_inactive "$unit_name"
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
    --property=RestrictSUIDSGID=yes \
    --property=UMask=0022 \
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
    --property=IPAddressDeny=169.254.169.254/32 \
    --property=IPAddressDeny=fd00:ec2::254/128 \
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
  run_isolated_build_command studytube-release-web-dependencies.service \
    "$npm_bin" ci --prefix web --no-audit --fund=false --ignore-scripts ||
    build_status=$?
  if ((build_status == 0)); then
    run_isolated_build_command studytube-release-api-dependencies.service \
      "$npm_bin" ci --prefix api --no-audit --fund=false --ignore-scripts ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command studytube-release-web-build.service \
      "$npm_bin" --prefix web run build --ignore-scripts ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command studytube-release-api-build.service \
      "$npm_bin" --prefix api run build --ignore-scripts ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command studytube-release-ai-venv.service \
      "$python_bin" -m venv ai/.venv ||
      build_status=$?
  fi
  if ((build_status == 0)); then
    run_isolated_build_command studytube-release-ai-dependencies.service \
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
  shift 2
  local command_name
  for command_name in npm sudo systemctl systemd-run; do
    command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
  done
  local migration_environment="$runtime_config_dir/migration.env"
  [[ -f "$migration_environment" && ! -L "$migration_environment" ]] ||
    fail "migration runtime environment is missing"

  local npm_bin system_path
  npm_bin="$(command -v npm)"
  [[ "$npm_bin" == /* ]] || fail "npm must resolve to an absolute path"
  system_path='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

  local executor
  executor='exec /usr/bin/env -i HOME=/nonexistent PATH="$1" LANG=C.UTF-8 LC_ALL=C.UTF-8 NODE_ENV=production DATABASE_URL="$DATABASE_URL" COURSE_CUTOVER_MODE="${COURSE_CUTOVER_MODE:-}" REQUIRED_MIGRATIONS_DIR="${REQUIRED_MIGRATIONS_DIR:-}" ALLOW_COURSE_BACKFILL="$2" "${@:3}"'
  assert_transient_unit_inactive "$unit_name"
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
    --property=RestrictSUIDSGID=yes \
    --property=UMask=0077 \
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6' \
    --property=IPAddressDeny=169.254.169.254/32 \
    --property=IPAddressDeny=fd00:ec2::254/128 \
    --property="EnvironmentFile=$migration_environment" \
    -- /usr/bin/bash -c "$executor" migration-runtime \
      "$system_path" "$allow_course_backfill" "$npm_bin" "$@" || run_status=$?
  cleanup_active_transient_unit || cleanup_status=$?
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
      false --prefix api run db:migrate:up
    exit 0
    ;;
  run-course-backfill)
    run_isolated_migration_command studytube-release-course-backfill.service \
      true --prefix api run db:course:backfill
    exit 0
    ;;
  run-course-verify)
    run_isolated_migration_command studytube-release-course-verify.service \
      false --prefix api run db:course:verify
    exit 0
    ;;
  install-runtime) ;;
  *) fail "unknown installer command: $installer_command" ;;
esac

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
}
trap cleanup EXIT

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
  DATABASE_URL
  VALKEY_URL
  OUTBOX_POLL_INTERVAL_MS
  OUTBOX_PUBLISH_TIMEOUT_MS
  DB_INIT_ATTEMPTS
  DB_INIT_RETRY_DELAY_MS
  WEB_ORIGIN
  AI_SERVICE_URL
  AI_EMBEDDING_TIMEOUT_MS
  AI_CAPTION_TIMEOUT_MS
  AI_SUMMARY_TIMEOUT_MS
  AI_AGENT_TIMEOUT_MS
  AI_QUIZ_TIMEOUT_MS
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
  OTEL_SDK_DISABLED
  OTEL_TRACES_EXPORTER
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
)
ai_environment_keys=(
  DATABASE_URL
  INTERNAL_AI_API_KEY
  MCP_SERVICE_ASSERTION_SECRET
  OPENAI_API_KEY
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
)
worker_environment_keys=(
  DATABASE_URL
  VALKEY_URL
  OUTBOX_POLL_INTERVAL_MS
  OUTBOX_PUBLISH_TIMEOUT_MS
  DB_INIT_ATTEMPTS
  DB_INIT_RETRY_DELAY_MS
  WEB_ORIGIN
  AI_SERVICE_URL
  AI_EMBEDDING_TIMEOUT_MS
  AI_CAPTION_TIMEOUT_MS
  AI_SUMMARY_TIMEOUT_MS
  AI_AGENT_TIMEOUT_MS
  AI_QUIZ_TIMEOUT_MS
  INTERNAL_AI_API_KEY
  AUTH_VERIFICATION_PEPPER
  AUTH_RATE_LIMIT_PEPPER
  AUTH_MINIMUM_RESPONSE_MS
  AUTH_RATE_LIMIT_WINDOW_SECONDS
  AUTH_RATE_LIMIT_MAX_ATTEMPTS
  AUTH_EMAIL_PROVIDER
  AUTH_EMAIL_SENDER
  AUTH_EMAIL_CAPTURE_DIR
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
  OTEL_SDK_DISABLED
  OTEL_TRACES_EXPORTER
  OTEL_EXPORTER_OTLP_ENDPOINT
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
)
migration_environment_keys=(
  DATABASE_URL
  COURSE_CUTOVER_MODE
  REQUIRED_MIGRATIONS_DIR
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

sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-api.service" \
  "$systemd_unit_dir/studytube-api.service"
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-ai.service" \
  "$systemd_unit_dir/studytube-ai.service"
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-worker.service" \
  "$systemd_unit_dir/studytube-worker.service"
sudo systemctl daemon-reload
sudo systemctl enable \
  studytube-api.service \
  studytube-ai.service \
  studytube-worker.service
