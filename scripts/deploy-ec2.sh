#!/usr/bin/env bash
set -euo pipefail

readonly deployment_guard_path='/run/studytube-deploy/resume-active'
readonly deployment_guard_service='studytube-deploy-resume-guard.service'
readonly deployment_watchdog_service='studytube-deployment-watchdog.service'
readonly host_course_cutover_state_dir='/var/lib/studytube/course-cutover'
readonly host_migration_backup_marker='/var/lib/studytube/migration-backup/verified-backup'
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
irreversible_schema_change_pending="false"
schema_barrier_path="${STUDYTUBE_SCHEMA_BARRIER_PATH:-}"
cutover_started_path="${STUDYTUBE_CUTOVER_STARTED_PATH:-}"
deployment_watchdog_lease_path="${STUDYTUBE_WATCHDOG_LEASE_PATH:-}"
deployment_owner_proof_path="${STUDYTUBE_OWNER_PROOF_PATH:-}"
deployment_watchdog_control_path="${STUDYTUBE_WATCHDOG_CONTROL_PATH:-}"
deployment_watchdog_trip_path="${STUDYTUBE_WATCHDOG_TRIP_PATH:-}"
deployment_watchdog_cancel_path="${STUDYTUBE_WATCHDOG_CANCEL_PATH:-}"
deployment_watchdog_armed_path="${STUDYTUBE_WATCHDOG_ARMED_PATH:-}"
deployment_owner_sha="${STUDYTUBE_DEPLOYMENT_OWNER_SHA:-$deploy_sha}"
legacy_course_state_dir="${STUDYTUBE_LEGACY_COURSE_STATE_DIR:-}"
release_execution_mode="${STUDYTUBE_RELEASE_EXECUTION_MODE:-activate}"
case "$release_execution_mode" in
  activate) prepared_reactivation='false' ;;
  reactivate-prepared) prepared_reactivation='true' ;;
  *)
    echo "STUDYTUBE_RELEASE_EXECUTION_MODE must be activate or reactivate-prepared" >&2
    exit 1
    ;;
esac

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

run_psql() {
  timeout --signal=TERM --kill-after=5s 30s \
    psql --dbname "$DATABASE_URL" "$@"
}

validate_root_only_file() {
  local path="$1"
  local label="$2"
  if [ ! -f "$path" ] || [ -L "$path" ]; then
    echo "$label must be a regular non-symlink file" >&2
    return 1
  fi
  if [ "$(stat -c '%u' "$path")" != "0" ]; then
    echo "$label must be owned by root" >&2
    return 1
  fi
  local mode
  mode="$(stat -c '%a' "$path")" || return 1
  if (( (8#$mode & 0077) != 0 )); then
    echo "$label must only be accessible by root" >&2
    return 1
  fi
}

validate_immutable_deployment_state_paths() {
  if [[ ! "$deploy_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "DEPLOY_SHA must be a lowercase full commit SHA" >&2
    return 1
  fi
  if [[ ! "$deployment_owner_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "STUDYTUBE_DEPLOYMENT_OWNER_SHA must be a lowercase full commit SHA" >&2
    return 1
  fi
  local state_dir
  state_dir="$(dirname -- "$schema_barrier_path")"
  if [[ ! "$state_dir" =~ ^/[A-Za-z0-9._/-]+/deployment-state$ ]] ||
     [ "$state_dir" = "/deployment-state" ] ||
     [ ! -d "$state_dir" ] ||
     [ -L "$state_dir" ] ||
     [ "$(stat -c '%u' "$state_dir")" != "0" ]; then
    echo "Immutable deployment state directory is invalid" >&2
    return 1
  fi
  local state_mode
  state_mode="$(stat -c '%a' "$state_dir")" || return 1
  if (( (8#$state_mode & 0077) != 0 )); then
    echo "Immutable deployment state directory must only be accessible by root" >&2
    return 1
  fi

  [ "$schema_barrier_path" = "$state_dir/$deploy_sha-schema-barrier" ] || {
    echo "STUDYTUBE_SCHEMA_BARRIER_PATH does not match DEPLOY_SHA" >&2
    return 1
  }
  [ "$cutover_started_path" = "$state_dir/$deployment_owner_sha-cutover-started" ] || {
    echo "STUDYTUBE_CUTOVER_STARTED_PATH does not match the deployment owner" >&2
    return 1
  }
  [ "$deployment_watchdog_lease_path" = "$state_dir/$deployment_owner_sha-watchdog.lease" ] || {
    echo "STUDYTUBE_WATCHDOG_LEASE_PATH does not match the deployment owner" >&2
    return 1
  }
  [ "$deployment_owner_proof_path" = "$state_dir/$deployment_owner_sha-owner-proof.lock" ] || {
    echo "STUDYTUBE_OWNER_PROOF_PATH does not match the deployment owner" >&2
    return 1
  }
  [ "$deployment_watchdog_control_path" = "$state_dir/$deployment_owner_sha-watchdog-control.lock" ] || {
    echo "STUDYTUBE_WATCHDOG_CONTROL_PATH does not match the deployment owner" >&2
    return 1
  }
  [ "$deployment_watchdog_trip_path" = "$state_dir/$deployment_owner_sha-watchdog-tripped" ] || {
    echo "STUDYTUBE_WATCHDOG_TRIP_PATH does not match the deployment owner" >&2
    return 1
  }
  [ "$deployment_watchdog_cancel_path" = "$state_dir/$deployment_owner_sha-watchdog-cancelled" ] || {
    echo "STUDYTUBE_WATCHDOG_CANCEL_PATH does not match the deployment owner" >&2
    return 1
  }
  [ "$deployment_watchdog_armed_path" = "$state_dir/$deployment_owner_sha-watchdog-armed" ] || {
    echo "STUDYTUBE_WATCHDOG_ARMED_PATH does not match the deployment owner" >&2
    return 1
  }
  validate_root_only_file "$deployment_watchdog_lease_path" "Deployment watchdog lease" || return 1
  validate_root_only_file "$deployment_owner_proof_path" "Deployment owner proof" || return 1
  validate_root_only_file "$deployment_watchdog_control_path" "Deployment watchdog control lock" || return 1
  validate_root_only_file "$deployment_watchdog_armed_path" "Deployment watchdog armed marker" || return 1
  if [ -e "$cutover_started_path" ] || [ -L "$cutover_started_path" ]; then
    validate_root_only_file "$cutover_started_path" "Cutover-started marker" || return 1
    if [ "$(wc -l <"$cutover_started_path")" -ne 2 ] ||
       ! grep -Fqx -- 'STUDYTUBE_CUTOVER_STARTED_FORMAT=1' "$cutover_started_path" ||
       ! grep -Fqx -- "DEPLOY_SHA=$deployment_owner_sha" "$cutover_started_path"; then
      echo "Cutover-started marker does not match the deployment owner" >&2
      return 1
    fi
  fi
  if [ -e "$deployment_watchdog_trip_path" ] || [ -L "$deployment_watchdog_trip_path" ]; then
    validate_root_only_file "$deployment_watchdog_trip_path" "Deployment watchdog trip marker" || return 1
  fi
  if [ -e "$deployment_watchdog_cancel_path" ] || [ -L "$deployment_watchdog_cancel_path" ]; then
    validate_root_only_file "$deployment_watchdog_cancel_path" "Deployment watchdog cancellation marker" || return 1
  fi
}

verify_inherited_deployment_owner() {
  validate_immutable_deployment_state_paths || return 1
  local inherited_lease_target inherited_proof_target
  inherited_lease_target="$(readlink -f -- "/proc/$$/fd/200" 2>/dev/null || true)"
  inherited_proof_target="$(readlink -f -- "/proc/$$/fd/201" 2>/dev/null || true)"
  if [ -z "$inherited_lease_target" ] ||
     [ "$inherited_lease_target" != "$(readlink -f -- "$deployment_watchdog_lease_path")" ]; then
    echo "Deployment watchdog lease descriptor was not inherited" >&2
    return 1
  fi
  if [ -z "$inherited_proof_target" ] ||
     [ "$inherited_proof_target" != "$(readlink -f -- "$deployment_owner_proof_path")" ]; then
    echo "Deployment owner proof descriptor was not inherited" >&2
    return 1
  fi
  if (
    exec 198<>"$deployment_watchdog_lease_path"
    flock -n 198
  ); then
    echo "Deployment watchdog lease is not locked by the deployment owner" >&2
    return 1
  fi
  if (
    exec 197<>"$deployment_owner_proof_path"
    flock -n 197
  ); then
    echo "Deployment owner proof is not locked by the deployment owner" >&2
    return 1
  fi
}

verify_live_deployment_watchdog() {
  sudo systemctl is-active --quiet "$deployment_watchdog_service" || {
    echo "Deployment watchdog is not active" >&2
    return 1
  }
  local watchdog_main_pid
  watchdog_main_pid="$(sudo systemctl show "$deployment_watchdog_service" \
    --property=MainPID --value)" || return 1
  [[ "$watchdog_main_pid" =~ ^[1-9][0-9]*$ ]] || {
    echo "Deployment watchdog has no live main process" >&2
    return 1
  }
  if [ "$(wc -l <"$deployment_watchdog_armed_path")" -ne 3 ] ||
    ! grep -Fqx -- 'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' "$deployment_watchdog_armed_path" ||
    ! grep -Fqx -- "DEPLOY_SHA=$deployment_owner_sha" "$deployment_watchdog_armed_path" ||
    ! grep -Fqx -- "WATCHDOG_PID=$watchdog_main_pid" "$deployment_watchdog_armed_path"; then
    echo "Deployment watchdog armed marker does not match its live process" >&2
    return 1
  fi
}

assert_deployment_mutation_allowed() {
  verify_inherited_deployment_owner || return 1
  if [ -e "$deployment_watchdog_trip_path" ] || [ -L "$deployment_watchdog_trip_path" ]; then
    echo "Deployment watchdog has tripped; refusing a new release mutation" >&2
    return 1
  fi
  if [ -e "$deployment_watchdog_cancel_path" ] || [ -L "$deployment_watchdog_cancel_path" ]; then
    echo "Deployment watchdog has cancelled this release; refusing a new mutation" >&2
    return 1
  fi
  verify_live_deployment_watchdog
}

run_controlled_deployment_mutation() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    assert_deployment_mutation_allowed || exit 1
    "$@"
  )
}

release_deployment_guard() {
  local requested_guard_path="${STUDYTUBE_DEPLOYMENT_GUARD_PATH:-$deployment_guard_path}"
  if [ "$requested_guard_path" != "$deployment_guard_path" ]; then
    echo "STUDYTUBE_DEPLOYMENT_GUARD_PATH must use the host-owned recovery guard" >&2
    return 1
  fi
  verify_inherited_deployment_owner || return 1
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    assert_deployment_mutation_allowed || exit 1
    timeout --signal=TERM --kill-after=5s 30s \
      sudo systemctl start "$deployment_guard_service" || exit 1
    timeout --signal=TERM --kill-after=5s 15s \
      sudo systemctl is-active --quiet "$deployment_guard_service" || {
      echo "Deployment guard service is not active" >&2
      exit 1
    }
    sudo rm -f -- "$deployment_guard_path" || exit 1
  )
}

seal_deployment_guard_for_cutover() {
  verify_inherited_deployment_owner || return 1
  local deployment_state_dir deployment_root deployment_runner runner_mode
  deployment_state_dir="$(dirname -- "$deployment_watchdog_control_path")"
  [[ "$deployment_state_dir" == */deployment-state ]] || {
    echo "Deployment state directory is invalid" >&2
    return 1
  }
  deployment_root="${deployment_state_dir%/deployment-state}"
  [[ -n "$deployment_root" && "$deployment_root" != "$deployment_state_dir" ]] || {
    echo "Deployment root could not be derived from immutable state" >&2
    return 1
  }
  deployment_runner="$deployment_root/deploy-tools/ssm-deploy-release.sh"
  if [[ ! -f "$deployment_runner" || -L "$deployment_runner" ]] ||
     [[ "$(stat -c '%u' "$deployment_runner")" != '0' ]]; then
    echo "Installed deployment guard runner is not a root-owned regular file" >&2
    return 1
  fi
  runner_mode="$(stat -c '%a' "$deployment_runner")" || return 1
  if (( (8#$runner_mode & 0022) != 0 )); then
    echo "Installed deployment guard runner must not be group- or world-writable" >&2
    return 1
  fi
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    assert_deployment_mutation_allowed || exit 1
    write_cutover_started_marker || exit 1
    timeout --signal=TERM --kill-after=10s 2m \
      sudo "$deployment_runner" seal-resume-guard \
        --deploy-root "$deployment_root"
  )
}

write_cutover_started_marker() {
  local state_dir temporary_marker
  state_dir="$(dirname -- "$cutover_started_path")"
  if [ -e "$cutover_started_path" ] || [ -L "$cutover_started_path" ]; then
    validate_root_only_file "$cutover_started_path" "Cutover-started marker" || return 1
    if [ "$(wc -l <"$cutover_started_path")" -ne 2 ] ||
       ! grep -Fqx -- 'STUDYTUBE_CUTOVER_STARTED_FORMAT=1' "$cutover_started_path" ||
       ! grep -Fqx -- "DEPLOY_SHA=$deployment_owner_sha" "$cutover_started_path"; then
      echo "Cutover-started marker does not match the deployment owner" >&2
      return 1
    fi
    return 0
  fi
  temporary_marker="$(mktemp "$state_dir/.${deployment_owner_sha}.cutover-started.XXXXXX")" || return 1
  if ! printf '%s\n' \
      'STUDYTUBE_CUTOVER_STARTED_FORMAT=1' \
      "DEPLOY_SHA=$deployment_owner_sha" >"$temporary_marker"; then
    rm -f -- "$temporary_marker"
    return 1
  fi
  chmod 0600 "$temporary_marker" || {
    rm -f -- "$temporary_marker"
    return 1
  }
  sync -f "$temporary_marker" || {
    rm -f -- "$temporary_marker"
    return 1
  }
  if ! mv -f -- "$temporary_marker" "$cutover_started_path"; then
    rm -f -- "$temporary_marker"
    return 1
  fi
  sync -f "$state_dir"
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
      BASH_ENV|BASHOPTS|CDPATH|ENV|GLOBIGNORE|HOME|IFS|PATH|PROMPT_COMMAND|PS4|SHELLOPTS|NODE_OPTIONS|PYTHONHOME|PYTHONPATH|PERL5OPT|RUBYOPT|LD_PRELOAD|LD_LIBRARY_PATH|NPM_CONFIG_USERCONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*|DYLD_*|STUDYTUBE_DEPLOYMENT_GUARD_PATH|STUDYTUBE_DEPLOYMENT_OWNER_SHA|STUDYTUBE_SCHEMA_BARRIER_PATH|STUDYTUBE_CUTOVER_STARTED_PATH|STUDYTUBE_WATCHDOG_LEASE_PATH|STUDYTUBE_OWNER_PROOF_PATH|STUDYTUBE_WATCHDOG_CONTROL_PATH|STUDYTUBE_WATCHDOG_TRIP_PATH|STUDYTUBE_WATCHDOG_CANCEL_PATH|STUDYTUBE_WATCHDOG_ARMED_PATH|STUDYTUBE_LEGACY_COURSE_STATE_DIR|STUDYTUBE_RELEASE_EXECUTION_MODE)
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
  if ! command -v psql >/dev/null 2>&1 || ! command -v timeout >/dev/null 2>&1; then
    echo "Refusing irreversible migration: psql and timeout are required to verify migration state before cutover." >&2
    return 1
  fi

  local migration_history
  migration_history="$(
    run_psql --no-psqlrc --tuples-only --no-align \
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
        printf '%s\n' \
          "SELECT EXISTS (SELECT 1 FROM pgmigrations WHERE name = :'migration_name')" |
          run_psql --no-psqlrc --tuples-only --no-align \
            --set ON_ERROR_STOP=1 \
            --set migration_name="$migration_name" \
            --file=-
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
  irreversible_schema_change_pending="true"

  local marker_path="${IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER:-${AUTH_CUTOVER_VERIFIED_BACKUP_MARKER:-}}"
  local expected_sha="${deploy_sha:-$(git rev-parse HEAD)}"

  if [ "$marker_path" != "$host_migration_backup_marker" ] ||
     [ "$(readlink -f -- "$marker_path" 2>/dev/null || true)" != "$host_migration_backup_marker" ] ||
     ! validate_root_only_file "$marker_path" "Verified migration backup marker"; then
    echo "Refusing irreversible migration: IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER must name the root-only host marker at $host_migration_backup_marker." >&2
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

validate_schema_compatibility_barrier() {
  validate_root_only_file "$schema_barrier_path" "Schema compatibility barrier" || return 1
  [ "$(wc -l <"$schema_barrier_path")" -eq 3 ] || {
    echo "Schema compatibility barrier has unexpected content" >&2
    return 1
  }
  if ! grep -Fqx -- "STUDYTUBE_SCHEMA_BARRIER_FORMAT=1" "$schema_barrier_path" ||
    ! grep -Fqx -- "DEPLOY_SHA=$deploy_sha" "$schema_barrier_path" ||
    ! grep -Fqx -- "IRREVERSIBLE_MIGRATION_PENDING=true" "$schema_barrier_path"; then
    echo "Schema compatibility barrier does not match this deployment" >&2
    return 1
  fi
}

write_schema_compatibility_barrier() {
  [ "$irreversible_schema_change_pending" = "true" ] || return 0
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    assert_deployment_mutation_allowed || exit 1
    if [ -e "$schema_barrier_path" ] || [ -L "$schema_barrier_path" ]; then
      validate_schema_compatibility_barrier
      exit
    fi

    local state_dir temporary_barrier
    state_dir="$(dirname -- "$schema_barrier_path")"
    temporary_barrier="$(sudo mktemp "$state_dir/.${deploy_sha}.schema-barrier.XXXXXX")" || exit 1
    if ! printf '%s\n' \
        'STUDYTUBE_SCHEMA_BARRIER_FORMAT=1' \
        "DEPLOY_SHA=$deploy_sha" \
        'IRREVERSIBLE_MIGRATION_PENDING=true' |
        sudo tee "$temporary_barrier" >/dev/null; then
      sudo rm -f -- "$temporary_barrier"
      exit 1
    fi
    sudo chown root:root "$temporary_barrier" || {
      sudo rm -f -- "$temporary_barrier"
      exit 1
    }
    sudo chmod 0600 "$temporary_barrier" || {
      sudo rm -f -- "$temporary_barrier"
      exit 1
    }
    sudo sync -f "$temporary_barrier" || {
      sudo rm -f -- "$temporary_barrier"
      exit 1
    }
    sudo mv -f -- "$temporary_barrier" "$schema_barrier_path" || {
      sudo rm -f -- "$temporary_barrier"
      exit 1
    }
    sudo sync -f "$state_dir" || exit 1
    validate_schema_compatibility_barrier
  )
}

retrieval_duplicate_excess_count() {
  local table_name
  table_name="$(
    run_psql --no-psqlrc --tuples-only --no-align \
      --set ON_ERROR_STOP=1 \
      --command "SELECT COALESCE(to_regclass('public.retrieval_embeddings')::text, '')"
  )"
  if [ -z "$table_name" ]; then
    printf '0\n'
    return 0
  fi

  run_psql --no-psqlrc --tuples-only --no-align \
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

ensure_course_cutover_state_directory() {
  local state_parent
  state_parent="$(dirname -- "$course_cutover_state_dir")"
  if [ -e "$state_parent" ] || [ -L "$state_parent" ]; then
    [ -d "$state_parent" ] && [ ! -L "$state_parent" ] || {
      echo "Course cutover state parent must be a regular directory" >&2
      return 1
    }
  else
    install -o root -g root -m 0700 -d "$state_parent" || return 1
    sync -f "$(dirname -- "$state_parent")" || return 1
  fi
  [ "$(stat -c '%u:%g' "$state_parent")" = '0:0' ] || {
    echo "Course cutover state parent must be owned by root:root" >&2
    return 1
  }
  local parent_mode
  parent_mode="$(stat -c '%a' "$state_parent")" || return 1
  (( (8#$parent_mode & 0077) == 0 )) || {
    echo "Course cutover state parent must only be accessible by root" >&2
    return 1
  }

  if [ -e "$course_cutover_state_dir" ] || [ -L "$course_cutover_state_dir" ]; then
    [ -d "$course_cutover_state_dir" ] && [ ! -L "$course_cutover_state_dir" ] || {
      echo "Course cutover state path must be a regular directory" >&2
      return 1
    }
  else
    install -o root -g root -m 0700 -d "$course_cutover_state_dir" || return 1
    sync -f "$state_parent" || return 1
  fi
  [ "$(stat -c '%u:%g' "$course_cutover_state_dir")" = '0:0' ] || {
    echo "Course cutover state directory must be owned by root:root" >&2
    return 1
  }
  local state_mode
  state_mode="$(stat -c '%a' "$course_cutover_state_dir")" || return 1
  (( (8#$state_mode & 0077) == 0 )) || {
    echo "Course cutover state directory must only be accessible by root" >&2
    return 1
  }
}

validate_course_activation_marker() {
  local marker_path="$1"
  local label="$2"
  validate_root_only_file "$marker_path" "$label" || return 1
  if [ -z "$course_database_identity" ]; then
    course_database_identity="$(read_course_database_identity)" || return 1
  fi
  [ "$(wc -l <"$marker_path")" -eq 3 ] &&
    grep -Fqx -- 'course_activated=true' "$marker_path" &&
    grep -Eq '^first_deploy_sha=[0-9a-f]{40}$' "$marker_path" &&
    grep -Fqx -- "database_identity=$course_database_identity" "$marker_path"
}

validate_frozen_course_parity_marker() {
  local marker_path="$1"
  local label="$2"
  validate_root_only_file "$marker_path" "$label" || return 1
  if [ -z "$course_database_identity" ]; then
    course_database_identity="$(read_course_database_identity)" || return 1
  fi
  [ "$(wc -l <"$marker_path")" -eq 3 ] &&
    grep -Fqx -- 'parity_verified=true' "$marker_path" &&
    grep -Eq '^deploy_sha=[0-9a-f]{40}$' "$marker_path" &&
    grep -Fqx -- "database_identity=$course_database_identity" "$marker_path"
}

copy_legacy_course_marker() {
  local source_marker="$1"
  local target_marker="$2"
  local marker_name="$3"
  if [ -e "$target_marker" ] || [ -L "$target_marker" ]; then
    validate_root_only_file "$target_marker" "Host Course $marker_name marker" || return 1
    cmp -s -- "$source_marker" "$target_marker" || {
      echo "Legacy and host Course $marker_name markers disagree" >&2
      return 1
    }
    return 0
  fi

  local temporary_marker
  temporary_marker="$(mktemp "$course_cutover_state_dir/.$marker_name-migration.XXXXXX")" || return 1
  if ! install -o root -g root -m 0600 "$source_marker" "$temporary_marker"; then
    rm -f -- "$temporary_marker"
    return 1
  fi
  sync -f "$temporary_marker" || {
    rm -f -- "$temporary_marker"
    return 1
  }
  mv -f -- "$temporary_marker" "$target_marker" || {
    rm -f -- "$temporary_marker"
    return 1
  }
  sync -f "$course_cutover_state_dir"
}

validate_classified_legacy_course_state_dir() {
  local state_dir
  state_dir="$(dirname -- "$schema_barrier_path")"
  local expected="$state_dir/$deployment_owner_sha-legacy-runtime/course-state"
  [ "$legacy_course_state_dir" = "$expected" ] &&
    [ -d "$legacy_course_state_dir" ] &&
    [ ! -L "$legacy_course_state_dir" ] || {
      echo "STUDYTUBE_LEGACY_COURSE_STATE_DIR is outside immutable deployment state" >&2
      return 1
    }
  [ "$(stat -c '%u:%g' "$legacy_course_state_dir")" = '0:0' ] || {
    echo "Classified legacy Course state must be owned by root:root" >&2
    return 1
  }
  local mode
  mode="$(stat -c '%a' "$legacy_course_state_dir")" || return 1
  (( (8#$mode & 0077) == 0 )) || {
    echo "Classified legacy Course state must only be accessible by root" >&2
    return 1
  }
}

migrate_legacy_course_markers() {
  local deployment_root current_target current_sha current_state_dir
  deployment_root="$(dirname -- "$(dirname -- "$schema_barrier_path")")"
  local -a source_dirs=()
  if [ -e "$deployment_root/current" ] || [ -L "$deployment_root/current" ]; then
    [ -L "$deployment_root/current" ] || {
      echo "Current release pointer is not an immutable symlink" >&2
      return 1
    }
    current_target="$(readlink -f -- "$deployment_root/current")" || return 1
    [ "$(dirname -- "$current_target")" = "$deployment_root/releases" ] || {
      echo "Current release is outside the immutable deployment root" >&2
      return 1
    }
    current_sha="$(basename -- "$current_target")"
    [[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] || {
      echo "Current release does not use a full immutable SHA" >&2
      return 1
    }
    current_state_dir="$current_target/source/.studytube-deploy-state"
    source_dirs+=("$current_state_dir")
  fi
  if [ -n "$legacy_course_state_dir" ]; then
    validate_classified_legacy_course_state_dir || return 1
    source_dirs+=("$legacy_course_state_dir")
  fi

  local source_dir marker_name source_marker target_marker marker_sha
  local -a validated_source_dirs=()
  for source_dir in "${source_dirs[@]}"; do
    if [ -e "$source_dir" ] || [ -L "$source_dir" ]; then
      [ -d "$source_dir" ] && [ ! -L "$source_dir" ] || {
        echo "Legacy Course state source is not a regular directory" >&2
        return 1
      }
    else
      continue
    fi
    validated_source_dirs+=("$source_dir")
  done

  local durable_activation_present='false'
  if [ -e "$course_activation_marker" ] || [ -L "$course_activation_marker" ]; then
    validate_course_activation_marker \
      "$course_activation_marker" "Course activation marker" || return 1
    durable_activation_present='true'
  fi
  for marker_name in course-activated course-freeze-verified; do
    for source_dir in "${validated_source_dirs[@]}"; do
      source_marker="$source_dir/$marker_name"
      if [ ! -e "$source_marker" ] && [ ! -L "$source_marker" ]; then
        continue
      fi
      case "$marker_name" in
        course-activated)
          validate_course_activation_marker \
            "$source_marker" "Legacy Course activation marker" || {
            echo "Legacy Course activation marker is invalid" >&2
            return 1
          }
          target_marker="$course_activation_marker"
          copy_legacy_course_marker \
            "$source_marker" "$target_marker" "$marker_name" || return 1
          durable_activation_present='true'
          continue
          ;;
        course-freeze-verified)
          validate_frozen_course_parity_marker \
            "$source_marker" "Legacy frozen Course parity marker" || {
            echo "Legacy frozen Course parity marker is invalid" >&2
            return 1
          }
          if [ "$durable_activation_present" = 'true' ]; then
            continue
          fi
          marker_sha="$(sed -n 's/^deploy_sha=//p' "$source_marker")"
          if [ "$marker_sha" != "$deploy_sha" ]; then
            if [ "${COURSE_CUTOVER_MODE:-}" = 'course' ]; then
              echo "Legacy frozen Course parity belongs to another release; deploy freeze before Course activation" >&2
              return 1
            fi
            continue
          fi
          target_marker="$frozen_parity_marker"
          ;;
      esac
      copy_legacy_course_marker "$source_marker" "$target_marker" "$marker_name" || return 1
    done
  done
}

configure_course_cutover_state_paths() {
  course_cutover_state_dir="${COURSE_CUTOVER_STATE_DIR:-$host_course_cutover_state_dir}"
  [ "$course_cutover_state_dir" = "$host_course_cutover_state_dir" ] || {
    echo "COURSE_CUTOVER_STATE_DIR must use $host_course_cutover_state_dir in production" >&2
    return 1
  }
  frozen_parity_marker="$course_cutover_state_dir/course-freeze-verified"
  course_activation_marker="$course_cutover_state_dir/course-activated"
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

  configure_course_cutover_state_paths || return 1

  if [ -e "$course_activation_marker" ] || [ -L "$course_activation_marker" ]; then
    course_database_identity="$(read_course_database_identity)"
    if ! validate_root_only_file "$course_activation_marker" "Course activation marker" ||
       [ "$(wc -l <"$course_activation_marker")" -ne 3 ] ||
       ! grep -Fqx -- "course_activated=true" "$course_activation_marker" ||
       ! grep -Eq '^first_deploy_sha=[0-9a-f]{40}$' "$course_activation_marker" ||
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
    if ! validate_root_only_file "$frozen_parity_marker" "Frozen Course parity marker" ||
       [ "$(wc -l <"$frozen_parity_marker")" -ne 3 ] ||
       ! grep -Fqx -- "parity_verified=true" "$frozen_parity_marker" ||
       ! grep -Fqx -- "deploy_sha=$deploy_sha" "$frozen_parity_marker" ||
       ! grep -Fqx -- "database_identity=$course_database_identity" "$frozen_parity_marker"; then
      echo "Refusing Course activation: frozen parity was not verified for DEPLOY_SHA=$deploy_sha" >&2
      return 1
    fi
  fi
}

read_course_database_identity() {
  run_psql --no-psqlrc --tuples-only --no-align \
    --set ON_ERROR_STOP=1 \
    --command "SELECT current_database() || ':' || (SELECT oid::text FROM pg_database WHERE datname = current_database()) || '@' || COALESCE(inet_server_addr()::text, 'local') || ':' || COALESCE(inet_server_port()::text, current_setting('port'))"
}

invalidate_frozen_parity_marker() {
  if [ -L "$frozen_parity_marker" ]; then
    echo "Refusing deployment: frozen parity marker must not be a symlink." >&2
    return 1
  elif [ -f "$frozen_parity_marker" ]; then
    rm -f -- "$frozen_parity_marker"
    sync -f "$course_cutover_state_dir"
  elif [ -e "$frozen_parity_marker" ]; then
    echo "Refusing deployment: frozen parity marker path is not a regular file." >&2
    return 1
  fi
}

write_frozen_parity_marker() {
  ensure_course_cutover_state_directory
  local temporary_marker
  course_database_identity="$(read_course_database_identity)"
  temporary_marker="$(mktemp "$course_cutover_state_dir/.freeze-verified.XXXXXX")"
  printf '%s\n' \
    "parity_verified=true" \
    "deploy_sha=$deploy_sha" \
    "database_identity=$course_database_identity" >"$temporary_marker"
  chmod 600 "$temporary_marker"
  sync -f "$temporary_marker"
  mv -f -- "$temporary_marker" "$frozen_parity_marker"
  sync -f "$course_cutover_state_dir"
}

write_course_activation_marker() {
  ensure_course_cutover_state_directory
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
  sync -f "$temporary_marker"
  mv -f -- "$temporary_marker" "$course_activation_marker"
  sync -f "$course_cutover_state_dir"
}

write_deploy_success_marker() {
  ensure_course_cutover_state_directory
  local marker_path="$course_cutover_state_dir/deploy-success"
  local temporary_marker
  temporary_marker="$(mktemp "$course_cutover_state_dir/.deploy-success.XXXXXX")"
  printf '%s\n' \
    "deploy_succeeded=true" \
    "deploy_sha=$deploy_sha" \
    "course_cutover_mode=$course_cutover_mode" >"$temporary_marker"
  chmod 600 "$temporary_marker"
  sync -f "$temporary_marker"
  mv -f -- "$temporary_marker" "$marker_path"
  sync -f "$course_cutover_state_dir"
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

ensure_host_swap() {
  if timeout --signal=TERM --kill-after=5s 15s \
      sudo swapon --show --noheadings | grep -q '/swapfile'; then
    return 0
  fi
  if [ ! -f /swapfile ]; then
    timeout --signal=TERM --kill-after=10s 3m sudo fallocate -l 2G /swapfile ||
      timeout --signal=TERM --kill-after=10s 5m \
        sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi

  sudo chmod 600 /swapfile
  timeout --signal=TERM --kill-after=5s 30s sudo mkswap /swapfile || true
  timeout --signal=TERM --kill-after=5s 30s sudo swapon /swapfile
}

verify_prepared_release_for_reactivation() {
  local prepared_head
  prepared_head="$(git rev-parse HEAD)" || return 1
  [ "$prepared_head" = "$deploy_sha" ] || {
    echo "Prepared rollback release does not match DEPLOY_SHA" >&2
    return 1
  }
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Prepared rollback release has modified tracked files" >&2
    git status --short --untracked-files=no >&2
    return 1
  fi

  local required_directory
  for required_directory in web/dist api/dist api/node_modules ai/.venv; do
    [ -d "$required_directory" ] && [ ! -L "$required_directory" ] || {
      echo "Prepared rollback release is missing a trusted directory: $required_directory" >&2
      return 1
    }
  done
  local required_file
  for required_file in \
    web/dist/index.html \
    api/dist/src/main.js \
    api/dist/src/worker.js \
    ai/.venv/bin/python \
    infra/Caddyfile \
    infra/production.compose.yml; do
    [ -f "$required_file" ] || {
      echo "Prepared rollback release is missing a runtime artifact: $required_file" >&2
      return 1
    }
  done
  [ -x ai/.venv/bin/python ] || {
    echo "Prepared rollback Python runtime is not executable" >&2
    return 1
  }
  local untrusted_runtime_path
  untrusted_runtime_path="$(
    find web/dist api/dist api/node_modules ai/.venv -xdev \
      \( -type d -o -type f \) \
      \( ! -user root -o -perm /022 \) -print -quit
  )" || return 1
  [ -z "$untrusted_runtime_path" ] || {
    echo "Prepared rollback runtime is not root-owned and read-only: $untrusted_runtime_path" >&2
    return 1
  }
}

require_sealed_prepared_reactivation() {
  validate_root_only_file "$deployment_guard_path" "Prepared reactivation guard" || return 1
  timeout --signal=TERM --kill-after=5s 15s \
    sudo systemctl is-active --quiet "$deployment_guard_service" || {
    echo "Prepared reactivation requires the active deployment guard" >&2
    return 1
  }
  course_cutover_mode="${COURSE_CUTOVER_MODE:-}"
  case "$course_cutover_mode" in
    legacy|freeze|course) ;;
    *)
      echo "Prepared reactivation requires a valid persisted COURSE_CUTOVER_MODE" >&2
      return 1
      ;;
  esac
  configure_course_cutover_state_paths
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
  MCP_SERVICE_ASSERTION_SECRET \
  AUTH_MODE \
  AUTH_VERIFICATION_PEPPER \
  AUTH_RATE_LIMIT_PEPPER \
  GOOGLE_OAUTH_CLIENT_ID \
  GOOGLE_OAUTH_CLIENT_SECRET \
  GOOGLE_AUTH_ATTEMPT_ENCRYPTION_KEY \
  STUDYTUBE_SITE_ADDRESS \
  STUDYTUBE_PUBLIC_URL \
  WEB_ORIGIN; do
  if [ -z "${!required_name:-}" ]; then
    echo "$required_name is required for production deployment" >&2
    exit 1
  fi
done

if [ "$AUTH_MODE" = "legacy" ]; then
  for required_name in \
    AUTH_EMAIL_PROVIDER \
    AUTH_EMAIL_SENDER \
    AUTH_EMAIL_AWS_CREDENTIAL_SOURCE \
    AUTH_EMAIL_AWS_REGION; do
    if [ -z "${!required_name:-}" ]; then
      echo "$required_name is required for legacy production authentication" >&2
      exit 1
    fi
  done
  if [ "$AUTH_EMAIL_PROVIDER" != "ses" ]; then
    echo "AUTH_EMAIL_PROVIDER must be ses in production" >&2
    exit 1
  fi
  if [ "$AUTH_EMAIL_AWS_CREDENTIAL_SOURCE" != "instance-role" ]; then
    echo "AUTH_EMAIL_AWS_CREDENTIAL_SOURCE must be instance-role in production" >&2
    exit 1
  fi
elif [ "$AUTH_MODE" != "google_only" ]; then
  echo "AUTH_MODE must be google_only or legacy" >&2
  exit 1
fi

for forbidden_name in \
  AUTH_EMAIL_AWS_ACCESS_KEY_ID \
  AUTH_EMAIL_AWS_SECRET_ACCESS_KEY \
  AUTH_EMAIL_AWS_SESSION_TOKEN \
  AWS_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY \
  AWS_SESSION_TOKEN; do
  if [ -n "${!forbidden_name:-}" ]; then
    echo "$forbidden_name is forbidden for production SES; use the EC2 instance role" >&2
    exit 1
  fi
done

for secret_name in \
  POSTGRES_PASSWORD \
  INTERNAL_AI_API_KEY \
  MCP_SERVICE_ASSERTION_SECRET \
  AUTH_VERIFICATION_PEPPER \
  AUTH_RATE_LIMIT_PEPPER; do
  require_strong_secret "$secret_name"
done

require_distinct_secrets INTERNAL_AI_API_KEY AUTH_VERIFICATION_PEPPER
require_distinct_secrets INTERNAL_AI_API_KEY AUTH_RATE_LIMIT_PEPPER
require_distinct_secrets AUTH_VERIFICATION_PEPPER AUTH_RATE_LIMIT_PEPPER
require_distinct_secrets MCP_SERVICE_ASSERTION_SECRET INTERNAL_AI_API_KEY
require_distinct_secrets MCP_SERVICE_ASSERTION_SECRET AUTH_VERIFICATION_PEPPER
require_distinct_secrets MCP_SERVICE_ASSERTION_SECRET AUTH_RATE_LIMIT_PEPPER

if [ "$VALKEY_URL" != "redis://127.0.0.1:6379" ]; then
  echo "VALKEY_URL must use the loopback Valkey service in production" >&2
  exit 1
fi

require_production_origins

verify_inherited_deployment_owner
if [ "$prepared_reactivation" = 'false' ]; then
  run_controlled_deployment_mutation \
    timeout --signal=TERM --kill-after=10s 2m git fetch origin "$deploy_branch"
  fetched_sha="$(git rev-parse "origin/$deploy_branch")"
  if [ "$fetched_sha" != "$deploy_sha" ]; then
    echo "Refusing stale deployment: CI verified $deploy_sha but origin/$deploy_branch is $fetched_sha" >&2
    exit 1
  fi

  run_controlled_deployment_mutation \
    timeout --signal=TERM --kill-after=10s 1m git checkout --detach "$deploy_sha"
  if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    echo "Refusing to build a dirty deployment checkout" >&2
    git status --short >&2
    exit 1
  fi

  run_controlled_deployment_mutation \
    timeout --signal=TERM --kill-after=10s 5m \
      docker compose -f infra/production.compose.yml up -d --wait \
        --remove-orphans --no-recreate postgres valkey

  require_irreversible_migration_backup
  configure_course_cutover_state_paths
  run_controlled_deployment_mutation ensure_course_cutover_state_directory
  run_controlled_deployment_mutation migrate_legacy_course_markers
  require_course_cutover_configuration
  if [ "$course_cutover_mode" != "course" ] && [ "$course_already_activated" = "false" ]; then
    run_controlled_deployment_mutation invalidate_frozen_parity_marker
  fi

  run_controlled_deployment_mutation ensure_host_swap

  APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
    timeout --signal=TERM --kill-after=30s 25m \
      bash scripts/install-production-runtime.sh prepare-release

  seal_deployment_guard_for_cutover
else
  verify_prepared_release_for_reactivation
  require_sealed_prepared_reactivation
  run_controlled_deployment_mutation ensure_course_cutover_state_directory
fi

run_controlled_deployment_mutation \
  timeout --signal=TERM --kill-after=10s 5m \
    docker compose -f infra/production.compose.yml up -d --wait \
      --remove-orphans postgres valkey

APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
  DEPLOY_SHA="$deploy_sha" \
  timeout --signal=TERM --kill-after=30s 5m \
    bash scripts/install-production-runtime.sh

STUDYTUBE_API_SOCKET_GID="$(getent group studytube-api-socket | cut -d: -f3)"
if [[ ! "$STUDYTUBE_API_SOCKET_GID" =~ ^[0-9]+$ ]] ||
  ((STUDYTUBE_API_SOCKET_GID <= 0)); then
  echo "Could not resolve the dedicated API socket group" >&2
  exit 1
fi
export STUDYTUBE_API_SOCKET_GID

run_controlled_deployment_mutation \
  timeout --signal=TERM --kill-after=10s 2m \
    docker compose -f infra/production.compose.yml run --rm --no-deps caddy \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

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

if [ "$prepared_reactivation" = 'false' ]; then
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

  write_schema_compatibility_barrier
  APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
    timeout --signal=TERM --kill-after=30s 15m \
      bash scripts/install-production-runtime.sh run-migration

  if [ "$course_cutover_mode" = 'course' ]; then
    APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
      DEPLOY_SHA="$deploy_sha" \
      timeout --signal=TERM --kill-after=30s 15m \
        bash scripts/install-production-runtime.sh run-learning-cutover
  fi

  if [ "$retrieval_dedup_pending" = "true" ]; then
    retrieval_duplicate_rows_after="$(retrieval_duplicate_excess_count)"
    if [ "$retrieval_duplicate_rows_after" != "0" ]; then
      echo "Retrieval duplicate verification failed after migration" >&2
      exit 1
    fi
    printf 'retrieval_duplicate_rows_after=%s\n' "$retrieval_duplicate_rows_after"
  fi

  if [ "$course_cutover_mode" = "course" ] && [ "$course_already_activated" = "false" ]; then
    run_controlled_deployment_mutation write_course_activation_marker
    course_already_activated="true"
  fi
fi

APP_DIR="$app_dir" COURSE_CUTOVER_MODE="$course_cutover_mode" \
  timeout --signal=TERM --kill-after=30s 2m \
    bash scripts/install-production-runtime.sh run-stt-approval

release_deployment_guard
timeout --signal=TERM --kill-after=5s 45s \
  sudo systemctl restart studytube-ai.service studytube-api.service studytube-worker.service

healthcheck_output="$(mktemp "${TMPDIR:-/tmp}/studytube-healthcheck.XXXXXX")"
cleanup_healthcheck_output() {
  rm -f "$healthcheck_output"
}
trap cleanup_healthcheck_output EXIT

wait_for_url() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + 120))

  while ((SECONDS < deadline)); do
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
  local deadline=$((SECONDS + 120))

  while ((SECONDS < deadline)); do
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

if [ "$prepared_reactivation" = 'false' ] && [ "$course_cutover_mode" = "freeze" ]; then
  if [ "$course_already_activated" = "false" ]; then
    APP_DIR="$app_dir" COURSE_CUTOVER_MODE=freeze \
      timeout --signal=TERM --kill-after=30s 10m \
        bash scripts/install-production-runtime.sh run-course-backfill
    APP_DIR="$app_dir" COURSE_CUTOVER_MODE=freeze \
      timeout --signal=TERM --kill-after=30s 10m \
        bash scripts/install-production-runtime.sh run-course-verify
    run_controlled_deployment_mutation write_frozen_parity_marker
  else
    echo "Post-activation freeze: automatic legacy backfill is disabled; diagnose and roll forward."
  fi
fi

publish_verified_release() {
  publish_web_release
  timeout --signal=TERM --kill-after=10s 2m \
    docker compose -f infra/production.compose.yml create --force-recreate caddy
  timeout --signal=TERM --kill-after=5s 30s \
    sudo systemctl restart studytube-caddy.service
  timeout --signal=TERM --kill-after=5s 15s \
    sudo systemctl is-active --quiet studytube-caddy.service || {
    echo "Caddy systemd service did not become active" >&2
    return 1
  }

  local public_base_url="$production_web_origin"
  wait_for_url "$public_base_url/api/health/live" public-api >/dev/null
  wait_for_url "$public_base_url/" public-web >/dev/null
  write_deploy_success_marker
}

run_controlled_deployment_mutation publish_verified_release
git rev-parse --short HEAD
