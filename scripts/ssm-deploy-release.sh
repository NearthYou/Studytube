#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly DEFAULT_DEPLOY_ROOT='/opt/studytube'
readonly DEFAULT_CONFIG_FILE='/etc/studytube/deployment.env'
readonly DEFAULT_RETAIN_RELEASES='5'
readonly DEFAULT_MINIMUM_FREE_BYTES='3221225472'
readonly DEFAULT_DEPLOYMENT_GUARD_PATH='/run/studytube-deploy/resume-active'
readonly DEPLOYMENT_GUARD_SERVICE='studytube-deploy-resume-guard.service'
readonly DEPLOYMENT_WATCHDOG_SERVICE='studytube-deployment-watchdog.service'
readonly DEPLOYMENT_WATCHDOG_TIMEOUT_SECONDS='8700'
readonly COURSE_ACTIVATION_MARKER='/var/lib/studytube/course-cutover/course-activated'
readonly -a APPLICATION_UNITS=(
  studytube-api.service
  studytube-ai.service
  studytube-worker.service
  studytube-caddy.service
)
readonly -a RELEASE_TRANSIENT_UNITS=(
  studytube-release-web-dependencies.service
  studytube-release-api-dependencies.service
  studytube-release-web-build.service
  studytube-release-api-build.service
  studytube-release-web-prune.service
  studytube-release-api-prune.service
  studytube-release-ai-venv.service
  studytube-release-ai-dependencies.service
  studytube-release-migration.service
  studytube-release-course-backfill.service
  studytube-release-course-verify.service
)

usage() {
  cat <<'EOF'
Usage:
  ssm-deploy-release.sh deploy [options]
  ssm-deploy-release.sh resume [--deploy-root PATH]
  ssm-deploy-release.sh watch-deployment --deploy-root PATH \
    --deploy-sha SHA --lease-file PATH
  ssm-deploy-release.sh validate-config-content --config-file PATH
  ssm-deploy-release.sh verify-artifact --artifact-file PATH \
    --artifact-sha256 SHA256 --deploy-sha SHA

Deploy options:
  --artifact-uri S3_URI       Immutable tar.gz object to download.
  --artifact-sha256 SHA256    Expected lowercase SHA-256 digest.
  --deploy-sha SHA            Full Git commit SHA carried by the artifact.
  --region REGION             AWS Region containing the artifact bucket.
  --config-file PATH          Root-owned deployment environment file.
  --deploy-root PATH          Release root. Default: /opt/studytube.
  --retain-releases NUMBER    Number of newest releases to retain.
  --minimum-free-bytes BYTES  Free-space reserve after staging.

The resume command is installed as a boot-time systemd oneshot. It either
continues a pre-activation stage or rolls an interrupted activation back to
the recorded last known good release.
EOF
}

fail() {
  printf 'ssm-deploy-release: %s\n' "$1" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

release_transient_unit_state() {
  local load_state load_status=0 unit_state
  load_state="$(systemctl show "$1" --property=LoadState --value 2>/dev/null)" ||
    load_status=$?
  if [[ "$load_state" == 'not-found' ]]; then
    printf 'inactive\n'
    return 0
  fi
  ((load_status == 0)) && [[ "$load_state" == 'loaded' ]] || return 1
  unit_state="$(systemctl show "$1" --property=ActiveState --value 2>/dev/null)" || return 1
  [[ -n "$unit_state" ]] || return 1
  printf '%s\n' "$unit_state"
}

release_transient_unit_is_quiescent() {
  case "$(release_transient_unit_state "$1")" in
    inactive|failed) return 0 ;;
    *) return 1 ;;
  esac
}

assert_release_transient_units_quiescent() {
  local unit_name
  for unit_name in "${RELEASE_TRANSIENT_UNITS[@]}"; do
    release_transient_unit_is_quiescent "$unit_name" ||
      fail "refusing to overlap active release transient unit: $unit_name"
  done
}

stop_release_transient_units() {
  local unit_name
  for unit_name in "${RELEASE_TRANSIENT_UNITS[@]}"; do
    if ! release_transient_unit_is_quiescent "$unit_name"; then
      systemctl kill --kill-whom=all --signal=KILL "$unit_name" >/dev/null 2>&1 || true
      systemctl stop "$unit_name" >/dev/null 2>&1 || true
    fi
    release_transient_unit_is_quiescent "$unit_name" || {
      fail "release transient unit did not stop before recovery: $unit_name"
      return 1
    }
    systemctl reset-failed "$unit_name" >/dev/null 2>&1 || true
  done
}

stop_deployment_watchdog() {
  if ! release_transient_unit_is_quiescent "$DEPLOYMENT_WATCHDOG_SERVICE"; then
    systemctl kill --kill-whom=all --signal=KILL "$DEPLOYMENT_WATCHDOG_SERVICE" \
      >/dev/null 2>&1 || true
    systemctl stop "$DEPLOYMENT_WATCHDOG_SERVICE" >/dev/null 2>&1 || true
  fi
  release_transient_unit_is_quiescent "$DEPLOYMENT_WATCHDOG_SERVICE" || {
    fail 'deployment watchdog did not stop before recovery'
    return 1
  }
  systemctl reset-failed "$DEPLOYMENT_WATCHDOG_SERVICE" >/dev/null 2>&1 || true
  deployment_watchdog_started='false'
}

arm_deployment_guard() {
  local guard_directory
  guard_directory="$(dirname -- "$deployment_guard_path")"
  install -d -o root -g root -m 0700 "$guard_directory"
  if [[ -e "$pending_file" || -L "$pending_file" ]]; then
    install -o root -g root -m 0600 /dev/null "$deployment_guard_path"
    wait_for_public_edge_inspection
    [[ -f "$pending_file" && ! -L "$pending_file" ]] || {
      fail 'pending deployment state is not a regular file'
      return 1
    }
  else
    rm -f -- "$deployment_guard_path"
  fi
}

wait_for_public_edge_inspection() {
  local retry_count=0
  until stop_public_edge; do
    retry_count=$((retry_count + 1))
    if ((retry_count == 1 || retry_count % 20 == 0)); then
      printf 'ssm-deploy-release: Docker is not inspectable; interrupted recovery remains sealed (retry %s)\n' \
        "$retry_count" >&2
    fi
    sleep 3
  done
}

deployment_guard_state() {
  if [[ ! -e "$deployment_guard_path" && ! -L "$deployment_guard_path" ]]; then
    printf 'absent\n'
    return 0
  fi
  if [[ ! -f "$deployment_guard_path" || -L "$deployment_guard_path" ]] ||
    [[ "$(stat -c '%u' "$deployment_guard_path" 2>/dev/null)" != '0' ]]; then
    printf 'invalid\n'
    return 0
  fi
  local mode
  mode="$(stat -c '%a' "$deployment_guard_path" 2>/dev/null)" || {
    printf 'invalid\n'
    return 0
  }
  if (( (8#$mode & 0077) != 0 )); then
    printf 'invalid\n'
    return 0
  fi
  printf 'present\n'
}

seal_deployment_guard() {
  local guard_directory unit_name unit_state seal_status=0
  if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
    rm -f -- "$deployment_guard_path"
    return 0
  fi
  guard_directory="$(dirname -- "$deployment_guard_path")"
  install -d -o root -g root -m 0700 "$guard_directory" || seal_status=$?
  install -o root -g root -m 0600 /dev/null "$deployment_guard_path" || seal_status=$?
  timeout --signal=TERM --kill-after=5s 30s \
    systemctl stop "${APPLICATION_UNITS[@]}" >/dev/null 2>&1 || true
  stop_public_edge || seal_status=$?
  for unit_name in "${APPLICATION_UNITS[@]}"; do
    unit_state="$(application_unit_state "$unit_name")" || {
      seal_status=1
      continue
    }
    if [[ "$unit_state" != 'inactive' && "$unit_state" != 'failed' ]]; then
      printf 'ssm-deploy-release: application unit did not stop after recovery failure: %s (%s)\n' \
        "$unit_name" "$unit_state" >&2
      seal_status=1
    fi
  done
  return "$seal_status"
}

application_unit_state() {
  local load_state load_status=0 unit_state
  load_state="$(
    timeout --signal=TERM --kill-after=5s 15s \
      systemctl show "$1" --property=LoadState --value 2>/dev/null
  )" || load_status=$?
  if [[ "$load_state" == 'not-found' ]]; then
    printf 'inactive\n'
    return 0
  fi
  if ((load_status != 0)) || [[ "$load_state" != 'loaded' ]]; then
    fail "could not inspect application unit load state: $1"
    return 1
  fi
  unit_state="$(
    timeout --signal=TERM --kill-after=5s 15s \
      systemctl show "$1" --property=ActiveState --value 2>/dev/null
  )" || {
    fail "could not inspect application unit active state: $1"
    return 1
  }
  case "$unit_state" in
    active|activating|deactivating|inactive|failed) printf '%s\n' "$unit_state" ;;
    *)
      fail "application unit returned an invalid active state: $1"
      return 1
      ;;
  esac
}

stop_public_edge() {
  timeout --signal=TERM --kill-after=5s 30s \
    systemctl stop studytube-caddy.service >/dev/null 2>&1 || true
  local container_state
  container_state="$(public_edge_container_state)" || return 1
  if [[ "$container_state" == 'running' ]]; then
    timeout --signal=TERM --kill-after=5s 20s \
      docker stop --time 10 studytube-caddy >/dev/null || return 1
  fi
  container_state="$(public_edge_container_state)" || return 1
  [[ "$container_state" == 'stopped' || "$container_state" == 'absent' ]] || {
    fail 'public edge remained active after deployment was sealed'
    return 1
  }
}

public_edge_container_state() {
  local inspect_output inspect_status=0
  inspect_output="$(
    timeout --signal=TERM --kill-after=5s 15s \
      docker inspect --format '{{.State.Running}}' studytube-caddy 2>&1
  )" || inspect_status=$?
  if ((inspect_status != 0)); then
    case "$inspect_output" in
      *'No such object: studytube-caddy'*|*'No such container: studytube-caddy'*)
        printf 'absent\n'
        return 0
        ;;
    esac
    fail 'could not verify the public edge container state'
    return 1
  fi
  case "$inspect_output" in
    true) printf 'running\n' ;;
    false) printf 'stopped\n' ;;
    *)
      fail 'public edge container returned an invalid state'
      return 1
      ;;
  esac
}

verify_deployment_watchdog_active() {
  systemctl is-active --quiet "$DEPLOYMENT_WATCHDOG_SERVICE" || {
    fail 'deployment watchdog is not active'
    return 1
  }
  [[ ! -e "$deployment_watchdog_trip_path" && ! -L "$deployment_watchdog_trip_path" ]] || {
    fail 'deployment watchdog has tripped; recovery must remain sealed'
    return 1
  }
  [[ ! -e "$deployment_watchdog_cancel_path" && ! -L "$deployment_watchdog_cancel_path" ]] || {
    fail 'deployment watchdog has cancelled this release; recovery must remain sealed'
    return 1
  }
  validate_watchdog_file "$deployment_watchdog_armed_path" DEPLOYMENT_WATCHDOG_ARMED || return 1
  local watchdog_main_pid
  watchdog_main_pid="$(systemctl show "$DEPLOYMENT_WATCHDOG_SERVICE" \
    --property=MainPID --value)" || return 1
  [[ "$watchdog_main_pid" =~ ^[1-9][0-9]*$ ]] || {
    fail 'deployment watchdog has no live main process'
    return 1
  }
  if [[ "$(wc -l <"$deployment_watchdog_armed_path")" -ne 3 ]] ||
    ! grep -Fqx -- 'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' "$deployment_watchdog_armed_path" ||
    ! grep -Fqx -- "DEPLOY_SHA=$deploy_sha" "$deployment_watchdog_armed_path" ||
    ! grep -Fqx -- "WATCHDOG_PID=$watchdog_main_pid" "$deployment_watchdog_armed_path"; then
    fail 'deployment watchdog armed marker does not match its live process'
    return 1
  fi
}

verify_deployment_owner_lease_held() {
  [[ "$deployment_owner_lease_held" == 'true' ]] || {
    fail 'deployment owner lease is not held by this process tree'
    return 1
  }
  local inherited_lease_target inherited_proof_target
  inherited_lease_target="$(readlink -f -- "/proc/$$/fd/200" 2>/dev/null || true)"
  inherited_proof_target="$(readlink -f -- "/proc/$$/fd/201" 2>/dev/null || true)"
  [[ -n "$inherited_lease_target" &&
      "$inherited_lease_target" == "$(readlink -f -- "$deployment_lease_file")" ]] || {
    fail 'deployment owner lease descriptor targets an unexpected file'
    return 1
  }
  if (
    exec 198<>"$deployment_lease_file"
    flock -n 198
  ); then
    fail 'deployment owner lease is not locked'
    return 1
  fi
  [[ -n "$inherited_proof_target" &&
      "$inherited_proof_target" == "$(readlink -f -- "$deployment_owner_proof_file")" ]] || {
    fail 'deployment owner proof descriptor targets an unexpected file'
    return 1
  }
  if (
    exec 197<>"$deployment_owner_proof_file"
    flock -n 197
  ); then
    fail 'deployment owner proof is not locked'
    return 1
  fi
}

run_controlled_watchdog_mutation() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    verify_deployment_owner_lease_held || exit 1
    verify_deployment_watchdog_active || exit 1
    "$@"
  )
}

release_deployment_guard() {
  [[ -f "$deployment_watchdog_control_path" && ! -L "$deployment_watchdog_control_path" ]] || {
    fail 'deployment watchdog control lock is invalid'
    return 1
  }
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    verify_deployment_owner_lease_held || exit 1
    verify_deployment_watchdog_active || exit 1
    timeout --signal=TERM --kill-after=5s 30s \
      systemctl start "$DEPLOYMENT_GUARD_SERVICE" || exit 1
    timeout --signal=TERM --kill-after=5s 15s \
      systemctl is-active --quiet "$DEPLOYMENT_GUARD_SERVICE" || {
      fail 'deployment guard service is not active'
      exit 1
    }
    rm -f -- "$deployment_guard_path" || exit 1
  )
}

validate_watchdog_state_path() {
  local path="$1"
  local expected="$2"
  local label="$3"
  validate_absolute_path "$path" "$label" || return 1
  [[ "$path" == "$expected" ]] || {
    fail "$label does not match the immutable deployment state"
    return 1
  }
}

validate_watchdog_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" && ! -L "$path" ]] || {
    fail "$label must be a regular non-symlink file"
    return 1
  }
  [[ "$(stat -c '%u' "$path")" == '0' ]] || {
    fail "$label must be owned by root"
    return 1
  }
  local mode
  mode="$(stat -c '%a' "$path")" || return 1
  (( (8#$mode & 0077) == 0 )) || {
    fail "$label must only be accessible by root"
    return 1
  }
}

prepare_deployment_watchdog_interlock() {
  local path
  for path in \
    "$deployment_lease_file" \
    "$deployment_owner_proof_file" \
    "$deployment_watchdog_control_path" \
    "$deployment_watchdog_decision_path"; do
    if [[ -e "$path" || -L "$path" ]]; then
      validate_watchdog_file "$path" DEPLOYMENT_WATCHDOG_STATE || return 1
    else
      install -o root -g root -m 0600 /dev/null "$path" || return 1
    fi
  done

  exec 200<>"$deployment_lease_file"
  flock -n 200 || {
    fail 'another deployment owner still holds the watchdog lease'
    return 1
  }
  exec 201<>"$deployment_owner_proof_file"
  flock -n 201 || {
    fail 'another deployment owner still holds the ownership proof'
    return 1
  }
  deployment_owner_lease_held='true'

  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    rm -f -- \
      "$deployment_watchdog_trip_path" \
      "$deployment_watchdog_cancel_path" \
      "$deployment_watchdog_armed_path" || exit 1
    sync -f "$state_dir" || exit 1
  )
}

start_deployment_watchdog() {
  local activation_mode="${1:-recovery}"
  [[ "$activation_mode" == 'deploy' || "$activation_mode" == 'recovery' ]] || {
    fail 'deployment watchdog activation mode must be deploy or recovery'
    return 1
  }
  if [[ "$deployment_watchdog_started" == 'true' ]]; then
    verify_deployment_watchdog_active
    return
  fi
  [[ -f "$pending_file" && ! -L "$pending_file" ]] || {
    fail 'deployment watchdog requires regular pending state'
    return 1
  }
  [[ "$(state_value "$pending_file" DEPLOY_SHA)" == "$deploy_sha" ]] || {
    fail 'deployment watchdog pending state belongs to another release'
    return 1
  }
  case "$activation_mode" in
    deploy)
      [[ "$(deployment_guard_state)" == 'absent' ]] || {
        fail 'normal deployment watchdog must start while the current release is live'
        return 1
      }
      ;;
    recovery)
      [[ "$(deployment_guard_state)" == 'present' ]] || {
        fail 'recovery watchdog must start while application activation is sealed'
        return 1
      }
      ;;
  esac

  prepare_deployment_watchdog_interlock || return 1
  release_transient_unit_is_quiescent "$DEPLOYMENT_WATCHDOG_SERVICE" || {
    fail 'refusing to overlap an active deployment watchdog'
    return 1
  }
  systemctl reset-failed "$DEPLOYMENT_WATCHDOG_SERVICE" >/dev/null 2>&1 || true

  local installed_script="$deploy_root/deploy-tools/ssm-deploy-release.sh"
  [[ -f "$installed_script" && ! -L "$installed_script" ]] || {
    fail 'installed deployment watchdog runner is missing'
    return 1
  }
  systemd-run \
    --quiet \
    --no-block \
    --collect \
    --service-type=exec \
    --unit="$DEPLOYMENT_WATCHDOG_SERVICE" \
    --uid=root \
    --gid=root \
    --property=NoNewPrivileges=yes \
    --property=PrivateDevices=yes \
    --property=PrivateTmp=yes \
    --property=ProtectHome=yes \
    --property=ProtectSystem=strict \
    --property=ProtectKernelTunables=yes \
    --property=ProtectKernelModules=yes \
    --property=ProtectControlGroups=yes \
    --property=RestrictAddressFamilies=AF_UNIX \
    --property=UMask=0077 \
    --property=RuntimeMaxSec=155min \
    --property=TimeoutStopSec=30s \
    --property=KillMode=control-group \
    --property=Restart=on-failure \
    --property=RestartSec=1s \
    --property="ReadWritePaths=$state_dir $(dirname -- "$deployment_guard_path")" \
    -- "$installed_script" watch-deployment \
      --deploy-root "$deploy_root" \
      --deploy-sha "$deploy_sha" \
      --lease-file "$deployment_lease_file" || return 1

  local attempt
  for ((attempt = 1; attempt <= 50; attempt++)); do
    if verify_deployment_watchdog_active >/dev/null 2>&1; then
      deployment_watchdog_started='true'
      return 0
    fi
    sleep 0.1
  done
  fail 'deployment watchdog did not become active'
}

arm_deployment_watchdog() {
  local temporary_armed
  temporary_armed="$(mktemp "$state_dir/.${deploy_sha}.watchdog-armed.XXXXXX")" || return 1
  if ! printf '%s\n' \
      'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' \
      "DEPLOY_SHA=$deploy_sha" \
      "WATCHDOG_PID=$$" >"$temporary_armed"; then
    rm -f -- "$temporary_armed"
    return 1
  fi
  chmod 0600 "$temporary_armed" || {
    rm -f -- "$temporary_armed"
    return 1
  }
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    mv -f -- "$temporary_armed" "$deployment_watchdog_armed_path" || exit 1
  ) || {
    rm -f -- "$temporary_armed"
    return 1
  }
}

mark_deployment_watchdog_cancelled() {
  (
    exec 202<>"$deployment_watchdog_decision_path"
    flock -w 30 202 || exit 1
    if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
      exit 0
    fi
    if [[ -f "$pending_file" && ! -L "$pending_file" ]]; then
      local pending_sha=''
      pending_sha="$(state_value "$pending_file" DEPLOY_SHA 2>/dev/null || true)"
      if [[ "$pending_sha" =~ ^[0-9a-f]{40}$ && "$pending_sha" != "$deploy_sha" ]]; then
        exit 0
      fi
    fi
    if [[ -e "$deployment_watchdog_cancel_path" || -L "$deployment_watchdog_cancel_path" ]]; then
      validate_watchdog_file "$deployment_watchdog_cancel_path" \
        DEPLOYMENT_WATCHDOG_CANCEL || exit 1
      if [[ "$(wc -l <"$deployment_watchdog_cancel_path")" -ne 2 ]] ||
        ! grep -Fqx -- 'STUDYTUBE_WATCHDOG_CANCEL_FORMAT=1' "$deployment_watchdog_cancel_path" ||
        ! grep -Fqx -- "DEPLOY_SHA=$deploy_sha" "$deployment_watchdog_cancel_path"; then
        fail 'deployment watchdog cancellation marker is invalid'
        exit 1
      fi
      exit 0
    fi

    local temporary_cancel
    temporary_cancel="$(mktemp "$state_dir/.${deploy_sha}.watchdog-cancelled.XXXXXX")" || exit 1
    if ! printf '%s\n' \
        'STUDYTUBE_WATCHDOG_CANCEL_FORMAT=1' \
        "DEPLOY_SHA=$deploy_sha" >"$temporary_cancel"; then
      rm -f -- "$temporary_cancel"
      exit 1
    fi
    chmod 0600 "$temporary_cancel" || {
      rm -f -- "$temporary_cancel"
      exit 1
    }
    sync -f "$temporary_cancel" || {
      rm -f -- "$temporary_cancel"
      exit 1
    }
    if ! mv -f -- "$temporary_cancel" "$deployment_watchdog_cancel_path"; then
      rm -f -- "$temporary_cancel"
      exit 1
    fi
    sync -f "$state_dir" || exit 1
  )
}

trip_deployment_watchdog() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
      exit 0
    fi
    if [[ -f "$pending_file" && ! -L "$pending_file" ]]; then
      local pending_sha=''
      pending_sha="$(state_value "$pending_file" DEPLOY_SHA 2>/dev/null || true)"
      if [[ "$pending_sha" =~ ^[0-9a-f]{40}$ && "$pending_sha" != "$deploy_sha" ]]; then
        exit 0
      fi
    fi
    if [[ -e "$deployment_watchdog_trip_path" || -L "$deployment_watchdog_trip_path" ]]; then
      if [[ ! -f "$deployment_watchdog_trip_path" || -L "$deployment_watchdog_trip_path" ]]; then
        rm -f -- "$deployment_watchdog_trip_path" || exit 1
        install -o root -g root -m 0600 /dev/null "$deployment_watchdog_trip_path" || exit 1
      else
        validate_watchdog_file "$deployment_watchdog_trip_path" \
          DEPLOYMENT_WATCHDOG_TRIP || exit 1
      fi
    else
      install -o root -g root -m 0600 /dev/null "$deployment_watchdog_trip_path" || exit 1
    fi
    local trip_status=0
    seal_deployment_guard || trip_status=$?
    stop_public_edge || trip_status=$?
    stop_release_transient_units || trip_status=$?
    exit "$trip_status"
  )
}

watch_deployment_lease() {
  ((EUID == 0)) || {
    fail 'deployment watchdog must run as root'
    return 1
  }
  validate_sha "$deploy_sha" || return 1
  validate_absolute_path "$deploy_root" DEPLOY_ROOT || return 1
  state_dir="$deploy_root/deployment-state"
  pending_file="$state_dir/pending.env"
  deployment_lease_file="$state_dir/$deploy_sha-watchdog.lease"
  deployment_watchdog_control_path="$state_dir/$deploy_sha-watchdog-control.lock"
  deployment_watchdog_decision_path="$state_dir/$deploy_sha-watchdog-decision.lock"
  deployment_watchdog_trip_path="$state_dir/$deploy_sha-watchdog-tripped"
  deployment_watchdog_cancel_path="$state_dir/$deploy_sha-watchdog-cancelled"
  deployment_watchdog_armed_path="$state_dir/$deploy_sha-watchdog-armed"
  validate_watchdog_state_path "$watchdog_requested_lease_file" \
    "$deployment_lease_file" DEPLOYMENT_WATCHDOG_LEASE || return 1
  validate_watchdog_file "$deployment_lease_file" DEPLOYMENT_WATCHDOG_LEASE || return 1
  validate_watchdog_file "$deployment_watchdog_control_path" \
    DEPLOYMENT_WATCHDOG_CONTROL || return 1
  validate_watchdog_file "$deployment_watchdog_decision_path" \
    DEPLOYMENT_WATCHDOG_DECISION || return 1
  require_command flock
  require_command systemctl
  require_command docker
  require_command timeout

  exec 200<>"$deployment_lease_file"
  arm_deployment_watchdog || return 1
  if [[ -e "$deployment_watchdog_trip_path" || -L "$deployment_watchdog_trip_path" ||
        -e "$deployment_watchdog_cancel_path" || -L "$deployment_watchdog_cancel_path" ]]; then
    trip_deployment_watchdog
    return
  fi
  local lease_acquired='true'
  if ! flock -w "$DEPLOYMENT_WATCHDOG_TIMEOUT_SECONDS" 200; then
    lease_acquired='false'
  fi

  if [[ "$lease_acquired" == 'false' ]]; then
    mark_deployment_watchdog_cancelled || return 1
  fi

  if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
    return 0
  fi
  if [[ "$lease_acquired" == 'true' && -f "$pending_file" && ! -L "$pending_file" ]]; then
    local pending_sha=''
    pending_sha="$(state_value "$pending_file" DEPLOY_SHA 2>/dev/null || true)"
    if [[ "$pending_sha" =~ ^[0-9a-f]{40}$ && "$pending_sha" != "$deploy_sha" ]]; then
      printf 'Deployment watchdog %s was superseded by %s.\n' "$deploy_sha" "$pending_sha"
      return 0
    fi
  fi

  if [[ "$lease_acquired" == 'true' ]]; then
    mark_deployment_watchdog_cancelled || return 1
  fi

  printf 'Deployment watchdog sealed incomplete activation for %s.\n' "$deploy_sha" >&2
  trip_deployment_watchdog
}

verify_application_units_active() {
  local unit_name unit_state
  for unit_name in "${APPLICATION_UNITS[@]}"; do
    unit_state="$(application_unit_state "$unit_name")" || return 1
    [[ "$unit_state" == 'active' ]] || {
      fail "recovered application unit is not active: $unit_name"
      return 1
    }
  done
  [[ "$(public_edge_container_state)" == 'running' ]] || {
    fail 'recovered public edge container is not running'
    return 1
  }
}

public_edge_unit_load_state() {
  local load_state load_status=0
  load_state="$(
    timeout --signal=TERM --kill-after=5s 15s \
      systemctl show studytube-caddy.service --property=LoadState --value 2>/dev/null
  )" || load_status=$?
  ((load_status == 0)) || {
    fail 'could not inspect the public edge systemd unit'
    return 1
  }
  case "$load_state" in
    loaded|not-found) printf '%s\n' "$load_state" ;;
    *)
      fail 'public edge systemd unit returned an invalid load state'
      return 1
      ;;
  esac
}

verify_legacy_public_edge_active() {
  [[ "$(public_edge_container_state)" == 'running' ]] || {
    fail 'legacy public edge container is not running'
    return 1
  }
  local restart_policy
  restart_policy="$(
    timeout --signal=TERM --kill-after=5s 15s \
      docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' studytube-caddy 2>/dev/null
  )" || {
    fail 'could not verify the legacy public edge restart policy'
    return 1
  }
  [[ "$restart_policy" == 'unless-stopped' || "$restart_policy" == 'always' ]] || {
    fail 'legacy public edge has no reboot-safe restart policy'
    return 1
  }
}

prepare_previous_release_public_edge() {
  local load_state unit_state container_state
  load_state="$(public_edge_unit_load_state)" || return 1
  if [[ "$load_state" == 'not-found' ]]; then
    verify_legacy_public_edge_active
    return
  fi

  timeout --signal=TERM --kill-after=5s 30s \
    systemctl enable studytube-caddy.service >/dev/null || return 1
  unit_state="$(application_unit_state studytube-caddy.service)" || return 1
  if [[ "$unit_state" == 'active' ]]; then
    verify_application_units_active
    return
  fi
  container_state="$(public_edge_container_state)" || return 1
  if [[ "$container_state" == 'running' ]]; then
    timeout --signal=TERM --kill-after=5s 20s \
      docker stop --time 10 studytube-caddy >/dev/null || return 1
  elif [[ "$container_state" != 'stopped' ]]; then
    fail 'cannot adopt a missing legacy public edge container'
    return 1
  fi
  timeout --signal=TERM --kill-after=5s 15s \
    docker update --restart=no studytube-caddy >/dev/null || return 1
  timeout --signal=TERM --kill-after=5s 15s \
    systemctl reset-failed studytube-caddy.service >/dev/null 2>&1 || true
  timeout --signal=TERM --kill-after=5s 30s \
    systemctl start studytube-caddy.service || return 1
}

verify_previous_release_units_active() {
  local unit_name unit_state load_state
  for unit_name in \
    studytube-api.service \
    studytube-ai.service \
    studytube-worker.service; do
    unit_state="$(application_unit_state "$unit_name")" || return 1
    [[ "$unit_state" == 'active' ]] || {
      fail "recovered application unit is not active: $unit_name"
      return 1
    }
  done
  load_state="$(public_edge_unit_load_state)" || return 1
  if [[ "$load_state" == 'loaded' ]]; then
    unit_state="$(application_unit_state studytube-caddy.service)" || return 1
    [[ "$unit_state" == 'active' ]] || {
      fail 'recovered public edge systemd unit is not active'
      return 1
    }
    [[ "$(public_edge_container_state)" == 'running' ]] || {
      fail 'recovered public edge container is not running'
      return 1
    }
    return 0
  fi
  verify_legacy_public_edge_active
}

deployment_config_value() {
  local path="$1"
  local expected_key="$2"
  local line key value=''
  local found='false'
  validate_config_content "$path" || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    if [[ "$key" == "$expected_key" ]]; then
      value="${line#*=}"
      found='true'
    fi
  done <"$path"
  [[ "$found" == 'true' ]] || return 1
  printf '%s\n' "$value"
}

verify_release_public_endpoints() {
  local snapshot_path="$1"
  local web_origin public_origin
  validate_config_file "$snapshot_path" || return 1
  web_origin="$(deployment_config_value "$snapshot_path" WEB_ORIGIN)" || {
    fail 'release snapshot has no WEB_ORIGIN for public recovery verification'
    return 1
  }
  public_origin="$(deployment_config_value "$snapshot_path" STUDYTUBE_PUBLIC_URL 2>/dev/null || true)"
  public_origin="${public_origin:-$web_origin}"
  web_origin="${web_origin%/}"
  public_origin="${public_origin%/}"
  if [[ ! "$public_origin" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]] ||
     [[ "$public_origin" != "$web_origin" ]]; then
    fail 'release snapshot public origin is not a matching HTTPS origin'
    return 1
  fi

  local curl_path timeout_path env_path
  curl_path="$(command -v curl)" || {
    fail 'curl is required to verify the recovered public edge'
    return 1
  }
  timeout_path="$(command -v timeout)" || return 1
  env_path="$(command -v env)" || return 1
  local deadline endpoint label ready
  for endpoint in /api/health/live /; do
    deadline=$((SECONDS + 60))
    label="${endpoint#/}"
    label="${label:-public web root}"
    ready='false'
    while ((SECONDS < deadline)); do
      if "$env_path" -i PATH=/usr/bin:/bin \
        "$timeout_path" --signal=TERM --kill-after=2s 7s \
        "$curl_path" --fail --silent --show-error --noproxy '*' \
        --proto '=https' --connect-timeout 2 --max-time 5 \
        --output /dev/null "$public_origin$endpoint" 2>/dev/null; then
        ready='true'
        break
      fi
      sleep 1
    done
    [[ "$ready" == 'true' ]] || {
      fail "recovered public edge did not become ready: $label"
      return 1
    }
  done
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail 'DEPLOY_SHA must be a lowercase full commit SHA'
}

validate_digest() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || fail 'artifact SHA-256 must contain 64 lowercase hex characters'
}

validate_absolute_path() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    fail "$label must be a simple absolute path"
    return 1
  }
  [[ "$value" != '/' && "$value" != *'/../'* && "$value" != */.. && "$value" != *'//'* ]] ||
    {
      fail "$label is too broad or contains traversal"
      return 1
    }
}

validate_positive_integer() {
  local value="$1"
  local label="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || ((10#$value <= 0)); then
    fail "$label must be a positive integer"
  fi
}

manifest_value() {
  local manifest_path="$1"
  local key="$2"
  awk -F= -v expected_key="$key" '$1 == expected_key { print substr($0, length($1) + 2); found = 1 } END { if (!found) exit 1 }' \
    "$manifest_path"
}

state_value() {
  manifest_value "$1" "$2"
}

verify_archive_members() {
  local artifact_path="$1"
  local members
  members="$(tar -tzf "$artifact_path")" || return 1
  [[ "$members" == $'manifest.env\nrepository.bundle' ]] ||
    {
      fail 'release artifact contains an unexpected path or member order'
      return 1
    }

  local listing
  listing="$(tar -tvzf "$artifact_path")" || return 1
  while IFS= read -r entry; do
    [[ "${entry:0:1}" == '-' ]] || {
      fail 'release artifact members must be regular files'
      return 1
    }
  done <<<"$listing"
}

verify_artifact() {
  local artifact_path="$1"
  local expected_sha256="$2"
  local expected_deploy_sha="$3"

  [[ -f "$artifact_path" && ! -L "$artifact_path" ]] || fail 'artifact must be a regular non-symlink file'
  validate_digest "$expected_sha256"
  validate_sha "$expected_deploy_sha"

  local actual_sha256
  actual_sha256="$(sha256sum "$artifact_path" | awk '{print $1}')"
  [[ "$actual_sha256" == "$expected_sha256" ]] || fail 'artifact SHA-256 verification failed'
  verify_archive_members "$artifact_path"

  local verification_dir
  verification_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-verify.XXXXXX")"
  cleanup_verification_dir() {
    rm -rf -- "$verification_dir"
  }
  trap cleanup_verification_dir RETURN

  tar -xzf "$artifact_path" --no-same-owner --no-same-permissions -C "$verification_dir"
  local manifest_path="$verification_dir/manifest.env"
  local bundle_path="$verification_dir/repository.bundle"
  [[ "$(manifest_value "$manifest_path" STUDYTUBE_RELEASE_FORMAT)" == '1' ]] ||
    fail 'unsupported release artifact format'
  [[ "$(manifest_value "$manifest_path" DEPLOY_SHA)" == "$expected_deploy_sha" ]] ||
    fail 'artifact commit does not match the requested deploy SHA'
  [[ "$(manifest_value "$manifest_path" RELEASE_REF)" == 'refs/heads/release' ]] ||
    fail 'artifact release ref is invalid'

  local expected_bundle_sha256 actual_bundle_sha256 bundle_head
  expected_bundle_sha256="$(manifest_value "$manifest_path" BUNDLE_SHA256)"
  validate_digest "$expected_bundle_sha256"
  actual_bundle_sha256="$(sha256sum "$bundle_path" | awk '{print $1}')"
  [[ "$actual_bundle_sha256" == "$expected_bundle_sha256" ]] ||
    fail 'repository bundle SHA-256 verification failed'
  bundle_head="$(git bundle list-heads "$bundle_path" refs/heads/release)"
  [[ "$bundle_head" == "$expected_deploy_sha refs/heads/release" ]] ||
    fail 'repository bundle does not carry the requested commit'

  local verification_repository="$verification_dir/verification.git"
  git init --quiet --bare "$verification_repository"
  git -C "$verification_repository" bundle verify "$bundle_path" >/dev/null
  trap - RETURN
  cleanup_verification_dir
}

validate_config_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || {
    fail 'deployment config must be a regular non-symlink file'
    return 1
  }
  [[ "$(stat -c '%u' "$path")" == '0' ]] || {
    fail 'deployment config must be owned by root'
    return 1
  }
  [[ "$(stat -c '%g' "$path")" == '0' ]] || {
    fail 'deployment config must use the root group'
    return 1
  }

  local mode
  mode="$(stat -c '%a' "$path")" || return 1
  (( (8#$mode & 0077) == 0 )) ||
    {
      fail 'deployment config must only be accessible by root'
      return 1
    }

  validate_config_content "$path" || return 1
}

validate_config_content() {
  local path="$1"
  [[ -f "$path" ]] || {
    fail 'deployment config content must be a regular file'
    return 1
  }

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *$'\r'* ]] ||
      {
        fail 'deployment config must use Unix line endings'
        return 1
      }
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] ||
      {
        fail 'deployment config must contain only KEY=value entries'
        return 1
      }
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      BASH_ENV|BASHOPTS|CDPATH|ENV|GLOBIGNORE|HOME|IFS|PATH|PROMPT_COMMAND|PS4|SHELLOPTS|NODE_OPTIONS|PYTHONHOME|PYTHONPATH|PERL5OPT|RUBYOPT|LD_PRELOAD|LD_LIBRARY_PATH|NPM_CONFIG_USERCONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*|DYLD_*|STUDYTUBE_DEPLOYMENT_GUARD_PATH|STUDYTUBE_DEPLOYMENT_OWNER_SHA|STUDYTUBE_SCHEMA_BARRIER_PATH|STUDYTUBE_CUTOVER_STARTED_PATH|STUDYTUBE_WATCHDOG_LEASE_PATH|STUDYTUBE_OWNER_PROOF_PATH|STUDYTUBE_WATCHDOG_CONTROL_PATH|STUDYTUBE_WATCHDOG_TRIP_PATH|STUDYTUBE_WATCHDOG_CANCEL_PATH|STUDYTUBE_WATCHDOG_ARMED_PATH|STUDYTUBE_LEGACY_COURSE_STATE_DIR|STUDYTUBE_RELEASE_EXECUTION_MODE)
        fail "deployment config contains forbidden process-control variable $key"
        return 1
        ;;
    esac
    [[ "$value" != *"'"* && "$value" != *'"'* && "$value" != *\\* ]] ||
      {
        fail 'deployment config values must use portable unquoted literals'
        return 1
      }
  done <"$path"
}

load_config_file() {
  local path="$1"
  validate_config_content "$path" || return 1

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    export "$key=$value" || return 1
  done <"$path"
}

atomic_symlink() {
  local target="$1"
  local link_path="$2"
  local temporary_link="${link_path}.incoming.$$"
  rm -f -- "$temporary_link" || return 1
  if ! ln -s -- "$target" "$temporary_link"; then
    rm -f -- "$temporary_link"
    return 1
  fi
  if ! mv -Tf -- "$temporary_link" "$link_path"; then
    rm -f -- "$temporary_link"
    return 1
  fi
  sync -f "$(dirname -- "$link_path")" || return 1
}

safe_release_target() {
  local candidate="$1"
  [[ -n "$candidate" && -d "$candidate" && ! -L "$candidate" ]] || return 1
  [[ "$candidate" == "$releases_dir"/* ]] || return 1
  [[ "$(basename -- "$candidate")" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ -f "$candidate/release-metadata.env" && -d "$candidate/source/.git" ]] || return 1
}

current_release_target() {
  local link_path="$1"
  [[ -L "$link_path" ]] || return 1
  local target
  target="$(readlink -f -- "$link_path")"
  safe_release_target "$target" || return 1
  printf '%s\n' "$target"
}

link_release_config() {
  local release_path="$1"
  local snapshot_path="$2"
  local root_environment_path="$release_path/source/.env"
  if [[ -e "$root_environment_path" && ! -L "$root_environment_path" ]]; then
    fail "refusing to replace tracked environment path $root_environment_path"
    return 1
  fi
  rm -f -- "$root_environment_path" || return 1
  ln -s -- "$snapshot_path" "$root_environment_path" || return 1

  local legacy_environment_path
  for legacy_environment_path in \
    "$release_path/source/api/.env" \
    "$release_path/source/ai/.env"; do
    if [[ -e "$legacy_environment_path" && ! -L "$legacy_environment_path" ]]; then
      fail "refusing to replace tracked environment path $legacy_environment_path"
      return 1
    fi
    rm -f -- "$legacy_environment_path" || return 1
  done
}

check_disk_space() {
  local payload_bytes="$1"
  local available_kib available_bytes required_bytes
  available_kib="$(df -Pk "$deploy_root" | awk 'NR == 2 { print $4 }')"
  [[ "$available_kib" =~ ^[0-9]+$ ]] || fail 'could not determine available deployment disk space'
  available_bytes=$((available_kib * 1024))
  required_bytes=$((minimum_free_bytes + payload_bytes * 4))
  ((available_bytes >= required_bytes)) ||
    fail "disk preflight failed: $available_bytes bytes available, $required_bytes required"
}

parse_s3_uri() {
  local uri="$1"
  [[ "$uri" =~ ^s3://([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/([A-Za-z0-9._/-]+)$ ]] ||
    fail 'artifact URI must be a simple s3://bucket/key URI'
  artifact_bucket="${BASH_REMATCH[1]}"
  artifact_key="${BASH_REMATCH[2]}"
}

download_artifact() {
  parse_s3_uri "$artifact_uri"
  local content_length
  content_length="$(aws s3api head-object \
    --bucket "$artifact_bucket" \
    --key "$artifact_key" \
    --region "$aws_region" \
    --query ContentLength \
    --output text)"
  [[ "$content_length" =~ ^[0-9]+$ ]] || fail 'S3 did not return an artifact content length'
  check_disk_space "$content_length"

  local cache_path="$artifacts_dir/$deploy_sha-$artifact_sha256.tar.gz"
  if [[ -f "$cache_path" && ! -L "$cache_path" ]] &&
    [[ "$(sha256sum "$cache_path" | awk '{print $1}')" == "$artifact_sha256" ]]; then
    artifact_file="$cache_path"
    return 0
  fi

  local temporary_download
  temporary_download="$(mktemp "$artifacts_dir/.${deploy_sha}.download.XXXXXX")"
  if ! aws s3 cp "$artifact_uri" "$temporary_download" \
    --only-show-errors --region "$aws_region"; then
    rm -f -- "$temporary_download"
    return 1
  fi
  [[ "$(sha256sum "$temporary_download" | awk '{print $1}')" == "$artifact_sha256" ]] || {
    rm -f -- "$temporary_download"
    fail 'downloaded artifact SHA-256 verification failed'
    return 1
  }
  chmod 0444 "$temporary_download"
  mv -f -- "$temporary_download" "$cache_path"
  artifact_file="$cache_path"
}

persist_config_snapshot() {
  local source_path="$1"
  local destination_path="$2"
  local temporary_snapshot
  temporary_snapshot="$(mktemp "$config_snapshots_dir/.config.XXXXXX")" || return 1
  if ! install -o root -g root -m 0600 "$source_path" "$temporary_snapshot"; then
    rm -f -- "$temporary_snapshot"
    return 1
  fi
  sync -f "$temporary_snapshot" || {
    rm -f -- "$temporary_snapshot"
    return 1
  }
  if ! mv -f -- "$temporary_snapshot" "$destination_path"; then
    rm -f -- "$temporary_snapshot"
    return 1
  fi
  sync -f "$config_snapshots_dir"
}

snapshot_config() {
  if [[ -n "$config_snapshot" ]]; then
    if [[ ! -e "$config_snapshot" && ! -L "$config_snapshot" ]]; then
      validate_config_file "$config_file" || return 1
      [[ "$(sha256sum "$config_file" | awk '{print $1}')" == "$config_fingerprint" ]] ||
        fail 'deployment config no longer matches the missing saved snapshot'
      persist_config_snapshot "$config_file" "$config_snapshot" || return 1
    fi
    validate_config_file "$config_snapshot"
    [[ "$(sha256sum "$config_snapshot" | awk '{print $1}')" == "$config_fingerprint" ]] ||
      fail 'saved config snapshot fingerprint does not match deployment state'
    sync -f "$config_snapshot" || return 1
    sync -f "$config_snapshots_dir" || return 1
    return 0
  fi

  validate_config_file "$config_file"
  config_fingerprint="$(sha256sum "$config_file" | awk '{print $1}')"
  config_snapshot="$config_snapshots_dir/$config_fingerprint.env"
  if [[ -e "$config_snapshot" ]]; then
    validate_config_file "$config_snapshot"
    [[ "$(sha256sum "$config_snapshot" | awk '{print $1}')" == "$config_fingerprint" ]] ||
      fail 'existing config snapshot has unexpected content'
  else
    persist_config_snapshot "$config_file" "$config_snapshot" || return 1
  fi
  sync -f "$config_snapshot" || return 1
  sync -f "$config_snapshots_dir" || return 1
}

write_state() {
  local temporary_state temporary_pending
  temporary_state="$(mktemp "$state_dir/.${deploy_sha}.state.XXXXXX")" || return 1
  temporary_pending="$(mktemp "$state_dir/.pending.XXXXXX")" || {
    rm -f -- "$temporary_state"
    return 1
  }
  if ! printf '%s\n' \
    'STUDYTUBE_DEPLOY_STATE_FORMAT=1' \
    "PHASE=$phase" \
    "DEPLOY_SHA=$deploy_sha" \
    "ARTIFACT_URI=$artifact_uri" \
    "ARTIFACT_SHA256=$artifact_sha256" \
    "AWS_REGION=$aws_region" \
    "CONFIG_FILE=$config_file" \
    "CONFIG_FINGERPRINT=$config_fingerprint" \
    "CONFIG_SNAPSHOT=$config_snapshot" \
    "DEPLOY_ROOT=$deploy_root" \
    "RETAIN_RELEASES=$retain_releases" \
    "MINIMUM_FREE_BYTES=$minimum_free_bytes" \
    "PREVIOUS_RELEASE=$previous_release" \
    "LEGACY_RUNTIME_SNAPSHOT=$legacy_runtime_snapshot" \
    "COURSE_ACTIVATION_BASELINE=$course_activation_baseline" \
    >"$temporary_state"; then
    rm -f -- "$temporary_state" "$temporary_pending"
    return 1
  fi
  chmod 0600 "$temporary_state" || {
    rm -f -- "$temporary_state" "$temporary_pending"
    return 1
  }
  if ! install -o root -g root -m 0600 "$temporary_state" "$temporary_pending"; then
    rm -f -- "$temporary_state" "$temporary_pending"
    return 1
  fi
  sync -f "$temporary_state" || {
    rm -f -- "$temporary_state" "$temporary_pending"
    return 1
  }
  sync -f "$temporary_pending" || {
    rm -f -- "$temporary_state" "$temporary_pending"
    return 1
  }
  if ! mv -f -- "$temporary_state" "$state_file"; then
    rm -f -- "$temporary_state" "$temporary_pending"
    return 1
  fi
  sync -f "$state_dir" || {
    rm -f -- "$temporary_pending"
    return 1
  }
  if ! mv -f -- "$temporary_pending" "$pending_file"; then
    rm -f -- "$temporary_pending"
    return 1
  fi
  sync -f "$state_dir" || return 1
}

load_pending_state() {
  [[ -f "$pending_file" && ! -L "$pending_file" ]] || return 1
  [[ "$(state_value "$pending_file" STUDYTUBE_DEPLOY_STATE_FORMAT)" == '1' ]] ||
    fail 'unsupported pending deployment state'
  phase="$(state_value "$pending_file" PHASE)"
  deploy_sha="$(state_value "$pending_file" DEPLOY_SHA)"
  artifact_uri="$(state_value "$pending_file" ARTIFACT_URI)"
  artifact_sha256="$(state_value "$pending_file" ARTIFACT_SHA256)"
  aws_region="$(state_value "$pending_file" AWS_REGION)"
  config_file="$(state_value "$pending_file" CONFIG_FILE)"
  config_fingerprint="$(state_value "$pending_file" CONFIG_FINGERPRINT)"
  config_snapshot="$(state_value "$pending_file" CONFIG_SNAPSHOT)"
  deploy_root="$(state_value "$pending_file" DEPLOY_ROOT)"
  retain_releases="$(state_value "$pending_file" RETAIN_RELEASES)"
  minimum_free_bytes="$(state_value "$pending_file" MINIMUM_FREE_BYTES)"
  previous_release="$(state_value "$pending_file" PREVIOUS_RELEASE)"
  legacy_runtime_snapshot="$(state_value "$pending_file" LEGACY_RUNTIME_SNAPSHOT)"
  course_activation_baseline="$(
    state_value "$pending_file" COURSE_ACTIVATION_BASELINE 2>/dev/null || true
  )"
}

clear_pending_state() {
  if [[ -e "$pending_file" || -L "$pending_file" ]]; then
    [[ -f "$pending_file" && ! -L "$pending_file" ]] || {
      fail 'pending deployment state is not a regular file'
      return 1
    }
    [[ "$(state_value "$pending_file" DEPLOY_SHA)" == "$deploy_sha" ]] || {
      fail 'refusing to clear a different pending deployment'
      return 1
    }
    rm -f -- "$pending_file" || return 1
    sync -f "$state_dir" || return 1
  fi
}

install_resume_service() {
  local tools_dir="$deploy_root/deploy-tools"
  local installed_script="$tools_dir/ssm-deploy-release.sh"
  local source_script
  source_script="$(readlink -f -- "${BASH_SOURCE[0]}")"
  mkdir -p -- "$tools_dir"
  if [[ "$source_script" != "$installed_script" ]]; then
    install -o root -g root -m 0755 "$source_script" "$installed_script"
  fi

  local guard_unit_path="/etc/systemd/system/$DEPLOYMENT_GUARD_SERVICE"
  local resume_unit_path='/etc/systemd/system/studytube-deploy-resume.service'
  local temporary_guard_unit temporary_resume_unit temporary_dropin unit_name
  temporary_guard_unit="$(mktemp "$state_dir/.resume-guard-unit.XXXXXX")"
  temporary_resume_unit="$(mktemp "$state_dir/.resume-unit.XXXXXX")"
  temporary_dropin="$(mktemp "$state_dir/.resume-dropin.XXXXXX")"

  printf '%s\n' \
    '[Unit]' \
    'Description=Seal StudyTube application startup before interrupted recovery' \
    'After=docker.service' \
    'Wants=docker.service' \
    'StartLimitIntervalSec=0' \
    'Before=studytube-deploy-resume.service studytube-api.service studytube-ai.service studytube-worker.service studytube-caddy.service' \
    '' \
    '[Service]' \
    'Type=oneshot' \
    "ExecStart=$installed_script arm-resume-guard --deploy-root $deploy_root" \
    'TimeoutStartSec=infinity' \
    'RemainAfterExit=yes' \
    'Restart=on-failure' \
    'RestartSec=3' \
    'RuntimeDirectory=studytube-deploy' \
    'RuntimeDirectoryMode=0700' \
    'RuntimeDirectoryPreserve=yes' \
    'UMask=0077' \
    'NoNewPrivileges=true' \
    'PrivateTmp=true' \
    'ProtectSystem=strict' \
    'RestrictAddressFamilies=AF_UNIX' \
    'ReadWritePaths=/run/studytube-deploy' \
    '' \
    '[Install]' \
    'WantedBy=multi-user.target' \
    >"$temporary_guard_unit"

  printf '%s\n' \
    '[Unit]' \
    'Description=Resume or roll back an interrupted StudyTube deployment' \
    "After=network-online.target docker.service $DEPLOYMENT_GUARD_SERVICE" \
    "Requires=$DEPLOYMENT_GUARD_SERVICE" \
    'Wants=network-online.target docker.service' \
    'StartLimitIntervalSec=0' \
    "ConditionPathExists=$pending_file" \
    '' \
    '[Service]' \
    'Type=oneshot' \
    "ExecStart=$installed_script resume --deploy-root $deploy_root" \
    "ExecStopPost=$installed_script seal-resume-guard --deploy-root $deploy_root" \
    'Restart=on-failure' \
    'RestartSec=10' \
    'TimeoutStartSec=160min' \
    'TimeoutStopSec=2min' \
    'UMask=0077' \
    'NoNewPrivileges=true' \
    '' \
    '[Install]' \
    'WantedBy=multi-user.target' \
    >"$temporary_resume_unit"

  printf '%s\n' \
    '[Unit]' \
    "Requires=$DEPLOYMENT_GUARD_SERVICE" \
    "After=$DEPLOYMENT_GUARD_SERVICE" \
    "ConditionPathExists=!$deployment_guard_path" \
    >"$temporary_dropin"

  install -o root -g root -m 0644 "$temporary_guard_unit" "$guard_unit_path"
  install -o root -g root -m 0644 "$temporary_resume_unit" "$resume_unit_path"
  for unit_name in "${APPLICATION_UNITS[@]}"; do
    install -d -o root -g root -m 0755 "/etc/systemd/system/$unit_name.d"
    install -o root -g root -m 0644 \
      "$temporary_dropin" "/etc/systemd/system/$unit_name.d/90-studytube-deployment-guard.conf"
  done
  rm -f -- "$temporary_guard_unit" "$temporary_resume_unit" "$temporary_dropin"
  systemctl daemon-reload
  systemctl enable --now "$DEPLOYMENT_GUARD_SERVICE" >/dev/null
  systemctl enable studytube-deploy-resume.service >/dev/null
}

initialize_paths() {
  releases_dir="$deploy_root/releases"
  artifacts_dir="$deploy_root/artifacts"
  state_dir="$deploy_root/deployment-state"
  diagnostics_dir="$deploy_root/deployment-diagnostics/$deploy_sha"
  config_snapshots_dir="$deploy_root/config-snapshots"
  current_link="$deploy_root/current"
  last_known_good_link="$deploy_root/last-known-good"
  state_file="$state_dir/$deploy_sha.env"
  pending_file="$state_dir/pending.env"
  schema_barrier_path="$state_dir/$deploy_sha-schema-barrier"
  cutover_started_path="$state_dir/$deploy_sha-cutover-started"
  deployment_lease_file="$state_dir/$deploy_sha-watchdog.lease"
  deployment_owner_proof_file="$state_dir/$deploy_sha-owner-proof.lock"
  deployment_watchdog_control_path="$state_dir/$deploy_sha-watchdog-control.lock"
  deployment_watchdog_decision_path="$state_dir/$deploy_sha-watchdog-decision.lock"
  deployment_watchdog_trip_path="$state_dir/$deploy_sha-watchdog-tripped"
  deployment_watchdog_cancel_path="$state_dir/$deploy_sha-watchdog-cancelled"
  deployment_watchdog_armed_path="$state_dir/$deploy_sha-watchdog-armed"
  mkdir -p -- \
    "$releases_dir" \
    "$artifacts_dir" \
    "$state_dir" \
    "$diagnostics_dir" \
    "$config_snapshots_dir"
  chmod 0755 "$deploy_root" "$releases_dir"
  chmod 0700 "$state_dir" "$config_snapshots_dir"
}

start_diagnostic_log() {
  [[ "$diagnostics_initialized" == 'false' ]] || return 0
  diagnostic_log="$diagnostics_dir/deploy.log"
  touch "$diagnostic_log"
  chmod 0600 "$diagnostic_log"
  diagnostics_initialized='true'
  exec > >(tee -a "$diagnostic_log") 2>&1
}

collect_diagnostics() {
  [[ "$diagnostics_initialized" == 'true' ]] || return 0
  {
    printf '\nDeployment diagnostics for %s\n' "$deploy_sha"
    date -u '+utc=%Y-%m-%dT%H:%M:%SZ'
    printf 'phase=%s\n' "$phase"
    df -h "$deploy_root" || true
    if [[ -f "$state_file" ]]; then
      sed -E 's#^(CONFIG_FILE|CONFIG_SNAPSHOT)=.*#\1=[redacted-path]#' "$state_file" || true
    fi
    systemctl --no-pager --full status \
      studytube-api.service \
      studytube-ai.service \
      studytube-worker.service \
      studytube-caddy.service || true
    journalctl --no-pager -n 160 \
      -u studytube-api.service \
      -u studytube-ai.service \
      -u studytube-worker.service \
      -u studytube-caddy.service || true
    local diagnostic_release
    diagnostic_release="$(current_release_target "$current_link" 2>/dev/null || true)"
    if [[ -n "$diagnostic_release" && -f "$diagnostic_release/source/infra/production.compose.yml" ]]; then
      (
        cd -- "$diagnostic_release/source"
        docker compose -f infra/production.compose.yml ps || true
      )
    fi
  } >>"$diagnostic_log" 2>&1
}

exit_handler() {
  local exit_code="$1"
  if ((exit_code != 0)); then
    if [[ "$command_name" == 'resume' && -n "$pending_file" &&
          ( -e "$pending_file" || -L "$pending_file" ) ]]; then
      seal_deployment_guard || true
      stop_public_edge || true
    else
      case "$phase" in
        activating|rollback_required|rolling_back)
          if [[ -n "$pending_file" && ( -e "$pending_file" || -L "$pending_file" ) ]]; then
            seal_deployment_guard || true
            stop_public_edge || true
          fi
          ;;
      esac
    fi
    collect_diagnostics || true
  fi
}

stage_release() {
  local release_path="$releases_dir/$deploy_sha"
  if [[ -d "$release_path" && ! -L "$release_path" ]]; then
    [[ "$(state_value "$release_path/release-metadata.env" DEPLOY_SHA)" == "$deploy_sha" ]] ||
      fail 'existing release directory has a different deploy SHA'
    [[ "$(state_value "$release_path/release-metadata.env" ARTIFACT_SHA256)" == "$artifact_sha256" ]] ||
      fail 'existing release directory has a different artifact digest'
    [[ "$(git -C "$release_path/source" rev-parse HEAD)" == "$deploy_sha" ]] ||
      fail 'existing release checkout has a different commit'
    link_release_config "$release_path" "$config_snapshot"
    release_dir="$release_path"
    return 0
  fi
  [[ ! -e "$release_path" && ! -L "$release_path" ]] ||
    fail 'release destination exists but is not a valid directory'

  verify_artifact "$artifact_file" "$artifact_sha256" "$deploy_sha"
  local incoming_dir
  incoming_dir="$(mktemp -d "$releases_dir/.${deploy_sha}.incoming.XXXXXX")"
  if ! tar -xzf "$artifact_file" --no-same-owner --no-same-permissions -C "$incoming_dir"; then
    rm -rf -- "$incoming_dir"
    return 1
  fi
  if ! git clone --quiet --branch release --single-branch \
    "$incoming_dir/repository.bundle" "$incoming_dir/source"; then
    rm -rf -- "$incoming_dir"
    return 1
  fi
  [[ "$(git -C "$incoming_dir/source" rev-parse HEAD)" == "$deploy_sha" ]] || {
    rm -rf -- "$incoming_dir"
    fail 'staged checkout does not match the deploy SHA'
    return 1
  }
  git -C "$incoming_dir/source" remote set-url origin "$release_path/repository.bundle"
  printf '%s\n' \
    'STUDYTUBE_RELEASE_METADATA_FORMAT=1' \
    "DEPLOY_SHA=$deploy_sha" \
    "ARTIFACT_SHA256=$artifact_sha256" \
    "BUNDLE_SHA256=$(manifest_value "$incoming_dir/manifest.env" BUNDLE_SHA256)" \
    >"$incoming_dir/release-metadata.env"
  chmod -R go-w "$incoming_dir"
  chmod 0755 "$incoming_dir" "$incoming_dir/source"
  mv -- "$incoming_dir" "$release_path"
  link_release_config "$release_path" "$config_snapshot"
  release_dir="$release_path"
}

prepare_release() {
  local source_dir="$release_dir/source"
  [[ -x "$source_dir/scripts/deploy-ec2.sh" || -f "$source_dir/scripts/deploy-ec2.sh" ]] ||
    fail 'release does not contain scripts/deploy-ec2.sh'
  [[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
    fail 'release checkout is dirty before preparation'

  (
    load_config_file "$config_snapshot"
    cd -- "$source_dir"
    docker compose -f infra/production.compose.yml config --quiet
    docker compose -f infra/production.compose.yml run --rm --no-deps caddy \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  )

  [[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
    fail 'release preparation modified tracked source'
}

disable_legacy_pull_deployment() {
  exec 7>'/tmp/studytube-autodeploy.lock'
  flock -w 60 7 || fail 'legacy pull deployment is still running'

  local app_user
  app_user="$({
    load_config_file "$config_snapshot"
    printf '%s' "${APP_USER:-ubuntu}"
  })"
  [[ "$app_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] ||
    fail 'APP_USER is invalid while disabling the legacy deploy timer'
  id "$app_user" >/dev/null 2>&1 || fail "APP_USER=$app_user does not exist"

  local app_home
  app_home="$(getent passwd "$app_user" | awk -F: 'NR == 1 { print $6 }')"
  validate_absolute_path "$app_home" APP_USER_HOME
  local user_unit_dir="$app_home/.config/systemd/user"
  local user_uid
  user_uid="$(id -u "$app_user")"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$app_user" -- env "XDG_RUNTIME_DIR=/run/user/$user_uid" \
      systemctl --user disable --now studytube-autodeploy.timer studytube-autodeploy.service \
      >/dev/null 2>&1 || true
  fi
  rm -f -- \
    "$user_unit_dir/studytube-autodeploy.timer" \
    "$user_unit_dir/studytube-autodeploy.service"

  if command -v crontab >/dev/null 2>&1; then
    local existing_crontab filtered_crontab
    existing_crontab="$(mktemp "$state_dir/.legacy-crontab.XXXXXX")"
    filtered_crontab="$(mktemp "$state_dir/.filtered-crontab.XXXXXX")"
    if crontab -u "$app_user" -l >"$existing_crontab" 2>/dev/null; then
      grep -vF 'scripts/ec2-autodeploy.sh' "$existing_crontab" >"$filtered_crontab" || true
      crontab -u "$app_user" "$filtered_crontab"
    fi
    rm -f -- "$existing_crontab" "$filtered_crontab"
  fi
}

validate_legacy_runtime_path_owner() {
  local path="$1"
  local legacy_app_uid="$2"
  local forbidden_mode_mask="$3"
  local label="$4"
  local owner_uid mode
  owner_uid="$(stat -c '%u' "$path")" || return 1
  [[ "$owner_uid" == '0' || "$owner_uid" == "$legacy_app_uid" ]] || {
    fail "$label is not owned by root or the legacy service user"
    return 1
  }
  mode="$(stat -c '%a' "$path")" || return 1
  (( (8#$mode & forbidden_mode_mask) == 0 )) || {
    fail "$label has unsafe legacy permissions"
    return 1
  }
}

snapshot_legacy_course_state() {
  local legacy_app_dir="$1"
  local snapshot_dir="$2"
  local legacy_app_uid="$3"
  validate_absolute_path "$legacy_app_dir" LEGACY_APP_DIR || return 1
  [[ -d "$legacy_app_dir" && ! -L "$legacy_app_dir" ]] || {
    fail 'legacy runtime working directory is not a regular directory'
    return 1
  }
  validate_legacy_runtime_path_owner \
    "$legacy_app_dir" "$legacy_app_uid" 8#0022 'legacy runtime working directory' || return 1
  [[ -f "$legacy_app_dir/infra/production.compose.yml" &&
     ! -L "$legacy_app_dir/infra/production.compose.yml" ]] || {
    fail 'legacy runtime working directory cannot be classified safely'
    return 1
  }
  validate_legacy_runtime_path_owner \
    "$legacy_app_dir/infra/production.compose.yml" "$legacy_app_uid" 8#0022 \
    'legacy production Compose file' || return 1

  printf 'APP_DIR=%s\n' "$legacy_app_dir" >"$snapshot_dir/runtime.env"
  chmod 0600 "$snapshot_dir/runtime.env"
  sync -f "$snapshot_dir/runtime.env" || return 1

  local source_dir="$legacy_app_dir/.studytube-deploy-state"
  local course_snapshot_dir="$snapshot_dir/course-state"
  install -o root -g root -m 0700 -d "$course_snapshot_dir" || return 1
  if [[ -e "$source_dir" || -L "$source_dir" ]]; then
    [[ -d "$source_dir" && ! -L "$source_dir" ]] || {
      fail 'legacy Course state path cannot be classified safely'
      return 1
    }
    validate_legacy_runtime_path_owner \
      "$source_dir" "$legacy_app_uid" 8#0022 'legacy Course state directory' || return 1
  fi

  local marker_name source_marker
  for marker_name in course-activated course-freeze-verified; do
    source_marker="$source_dir/$marker_name"
    if [[ ! -e "$source_marker" && ! -L "$source_marker" ]]; then
      continue
    fi
    [[ -f "$source_marker" && ! -L "$source_marker" ]] || {
      fail "legacy Course marker must be a regular non-symlink file: $marker_name"
      return 1
    }
    validate_legacy_runtime_path_owner \
      "$source_marker" "$legacy_app_uid" 8#0077 "legacy Course marker $marker_name" || return 1
    install -o root -g root -m 0600 \
      "$source_marker" "$course_snapshot_dir/$marker_name" || return 1
    sync -f "$course_snapshot_dir/$marker_name" || return 1
  done
  sync -f "$course_snapshot_dir" || return 1
  sync -f "$snapshot_dir" || return 1
}

snapshot_legacy_runtime() {
  [[ -z "$previous_release" ]] || return 0
  [[ -z "$legacy_runtime_snapshot" ]] || return 0
  local snapshot_dir="$state_dir/$deploy_sha-legacy-runtime"
  mkdir -p -- "$snapshot_dir"
  chmod 0700 "$snapshot_dir"

  local unit_name unit_source captured_units=0
  for unit_name in studytube-api.service studytube-ai.service studytube-worker.service; do
    unit_source="/etc/systemd/system/$unit_name"
    if [[ -f "$unit_source" && ! -L "$unit_source" ]]; then
      install -o root -g root -m 0600 "$unit_source" "$snapshot_dir/$unit_name"
      captured_units=$((captured_units + 1))
      if systemctl is-active --quiet "$unit_name"; then
        : >"$snapshot_dir/$unit_name.active"
      fi
    fi
  done

  local legacy_web_link='/var/www/studytube/current'
  if [[ -L "$legacy_web_link" ]]; then
    local legacy_web_target
    legacy_web_target="$(readlink -f -- "$legacy_web_link")"
    if [[ "$legacy_web_target" == /var/www/studytube/releases/* && -d "$legacy_web_target" ]]; then
      printf 'WEB_TARGET=%s\n' "$legacy_web_target" >"$snapshot_dir/web.env"
      chmod 0600 "$snapshot_dir/web.env"
    fi
  fi

  if ((captured_units > 0)); then
    local legacy_app_dir legacy_app_uid
    legacy_app_dir="$(systemctl show studytube-api.service --property=WorkingDirectory --value 2>/dev/null)" || {
      fail 'could not inspect the legacy runtime working directory'
      return 1
    }
    [[ -d "$legacy_app_dir" && ! -L "$legacy_app_dir" ]] || {
      fail 'legacy runtime working directory is not a regular directory'
      return 1
    }
    legacy_app_uid="$(stat -c '%u' "$legacy_app_dir")" || return 1
    [[ "$legacy_app_uid" =~ ^[0-9]+$ ]] || {
      fail 'legacy runtime working directory owner is invalid'
      return 1
    }
    snapshot_legacy_course_state \
      "$legacy_app_dir" "$snapshot_dir" "$legacy_app_uid" || return 1
    legacy_runtime_snapshot="$snapshot_dir"
  else
    rmdir -- "$snapshot_dir" 2>/dev/null || true
    legacy_runtime_snapshot=''
  fi
}

legacy_course_state_snapshot_dir() {
  if [[ -z "$legacy_runtime_snapshot" ]]; then
    printf '\n'
    return 0
  fi
  local expected_snapshot="$state_dir/$deploy_sha-legacy-runtime"
  [[ "$legacy_runtime_snapshot" == "$expected_snapshot" &&
     -d "$legacy_runtime_snapshot" && ! -L "$legacy_runtime_snapshot" ]] || {
    fail 'legacy runtime snapshot is outside immutable deployment state'
    return 1
  }
  local course_state_dir="$legacy_runtime_snapshot/course-state"
  [[ -d "$course_state_dir" && ! -L "$course_state_dir" ]] || {
    fail 'legacy Course state was not classified before immutable cutover'
    return 1
  }
  [[ "$(stat -c '%u' "$course_state_dir")" == '0' ]] || {
    fail 'legacy Course state snapshot must be owned by root'
    return 1
  }
  local mode
  mode="$(stat -c '%a' "$course_state_dir")" || return 1
  (( (8#$mode & 0077) == 0 )) || {
    fail 'legacy Course state snapshot must only be accessible by root'
    return 1
  }
  printf '%s\n' "$course_state_dir"
}

schema_compatibility_barrier_state() {
  if [[ ! -e "$schema_barrier_path" && ! -L "$schema_barrier_path" ]]; then
    printf 'absent\n'
    return 0
  fi
  if ! validate_watchdog_file "$schema_barrier_path" SCHEMA_COMPATIBILITY_BARRIER; then
    printf 'invalid\n'
    return 0
  fi
  if [[ "$(wc -l <"$schema_barrier_path")" -ne 3 ]] ||
    ! grep -Fqx -- 'STUDYTUBE_SCHEMA_BARRIER_FORMAT=1' "$schema_barrier_path" ||
    ! grep -Fqx -- "DEPLOY_SHA=$deploy_sha" "$schema_barrier_path" ||
    ! grep -Fqx -- 'IRREVERSIBLE_MIGRATION_PENDING=true' "$schema_barrier_path"; then
    printf 'invalid\n'
    return 0
  fi
  printf 'present\n'
}

cutover_started_state() {
  if [[ ! -e "$cutover_started_path" && ! -L "$cutover_started_path" ]]; then
    printf 'absent\n'
    return 0
  fi
  if ! validate_watchdog_file "$cutover_started_path" CUTOVER_STARTED_MARKER; then
    printf 'invalid\n'
    return 0
  fi
  if [[ "$(wc -l <"$cutover_started_path")" -ne 2 ]] ||
    ! grep -Fqx -- 'STUDYTUBE_CUTOVER_STARTED_FORMAT=1' "$cutover_started_path" ||
    ! grep -Fqx -- "DEPLOY_SHA=$deploy_sha" "$cutover_started_path"; then
    printf 'invalid\n'
    return 0
  fi
  printf 'present\n'
}

course_activation_marker_state() {
  local marker_path="$1"
  if [[ ! -e "$marker_path" && ! -L "$marker_path" ]]; then
    printf 'absent\n'
    return 0
  fi
  if ! validate_watchdog_file "$marker_path" COURSE_ACTIVATION_MARKER ||
     [[ "$(wc -l <"$marker_path")" -ne 3 ]] ||
     ! grep -Fqx -- 'course_activated=true' "$marker_path" ||
     ! grep -Eq '^first_deploy_sha=[0-9a-f]{40}$' "$marker_path" ||
     ! grep -Eq '^database_identity=.+$' "$marker_path"; then
    printf 'invalid\n'
    return 0
  fi
  printf 'present\n'
}

course_activation_boundary_state() {
  course_activation_marker_state "$COURSE_ACTIVATION_MARKER"
}

previous_release_course_activation_state() {
  if [[ -z "$previous_release" ]]; then
    printf 'absent\n'
    return 0
  fi
  safe_release_target "$previous_release" || {
    fail 'cannot inspect Course activation state from an unsafe previous release'
    return 1
  }
  local previous_state_dir="$previous_release/source/.studytube-deploy-state"
  if [[ -e "$previous_state_dir" || -L "$previous_state_dir" ]]; then
    if [[ ! -d "$previous_state_dir" || -L "$previous_state_dir" ]]; then
      printf 'invalid\n'
      return 0
    fi
  fi
  course_activation_marker_state "$previous_state_dir/course-activated"
}

record_course_activation_baseline() {
  local baseline_state legacy_marker previous_release_state
  baseline_state="$(course_activation_boundary_state)" || return 1
  if [[ "$baseline_state" == 'absent' ]]; then
    previous_release_state="$(previous_release_course_activation_state)" || return 1
    baseline_state="$previous_release_state"
  fi
  if [[ "$baseline_state" == 'absent' && -n "$legacy_runtime_snapshot" ]]; then
    legacy_marker="$legacy_runtime_snapshot/course-state/course-activated"
    baseline_state="$(course_activation_marker_state "$legacy_marker")" || return 1
  fi
  case "$baseline_state" in
    absent|present) course_activation_baseline="$baseline_state" ;;
    invalid)
      fail 'cannot record an invalid Course activation baseline'
      return 1
      ;;
    *)
      fail 'Course activation baseline returned an unknown state'
      return 1
      ;;
  esac
}

course_activation_transition_state() {
  local current_state
  current_state="$(course_activation_boundary_state)" || return 1
  case "$course_activation_baseline:$current_state" in
    absent:absent|present:present) printf 'unchanged\n' ;;
    absent:present) printf 'crossed\n' ;;
    absent:invalid|present:absent|present:invalid) printf 'invalid\n' ;;
    *)
      fail 'Course activation baseline is unavailable or invalid'
      return 1
      ;;
  esac
}

write_release_success_metadata() {
  local release_path="$1"
  local snapshot_path="$2"
  local fingerprint="$3"
  local metadata_path="$release_path/deploy-success.env"
  local temporary_metadata
  temporary_metadata="$(mktemp "$release_path/.deploy-success.XXXXXX")" || return 1
  if ! printf '%s\n' \
    'STUDYTUBE_DEPLOY_SUCCESS_FORMAT=1' \
    "DEPLOY_SHA=$(basename -- "$release_path")" \
    "CONFIG_FINGERPRINT=$fingerprint" \
    "CONFIG_SNAPSHOT=$snapshot_path" \
    >"$temporary_metadata"; then
    rm -f -- "$temporary_metadata"
    return 1
  fi
  chmod 0600 "$temporary_metadata" || {
    rm -f -- "$temporary_metadata"
    return 1
  }
  if ! mv -f -- "$temporary_metadata" "$metadata_path"; then
    rm -f -- "$temporary_metadata"
    return 1
  fi
  sync -f "$metadata_path" || return 1
  sync -f "$release_path" || return 1
}

clear_schema_compatibility_barrier() {
  local barrier_state
  barrier_state="$(schema_compatibility_barrier_state)" || return 1
  case "$barrier_state" in
    absent) return 0 ;;
    present) ;;
    invalid)
      fail 'refusing to clear an invalid schema compatibility barrier'
      return 1
      ;;
    *)
      fail 'schema compatibility barrier returned an unknown state'
      return 1
      ;;
  esac
  rm -f -- "$schema_barrier_path" || return 1
  sync -f "$state_dir" || return 1
}

clear_cutover_started_marker() {
  local cutover_state
  cutover_state="$(cutover_started_state)" || return 1
  case "$cutover_state" in
    absent) return 0 ;;
    present) ;;
    invalid)
      fail 'refusing to clear an invalid cutover-started marker'
      return 1
      ;;
    *)
      fail 'cutover-started marker returned an unknown state'
      return 1
      ;;
  esac
  rm -f -- "$cutover_started_path" || return 1
  sync -f "$state_dir" || return 1
}

finalize_successful_activation() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    exec 202<>"$deployment_watchdog_decision_path"
    flock -w 30 202 || exit 1
    verify_deployment_owner_lease_held || exit 1
    verify_deployment_watchdog_active || exit 1
    verify_application_units_active || exit 1
    write_release_success_metadata \
      "$release_dir" "$config_snapshot" "$config_fingerprint" || exit 1
    atomic_symlink "$release_dir" "$current_link" || exit 1
    if [[ ! -L "$last_known_good_link" ]]; then
      atomic_symlink "$release_dir" "$last_known_good_link" || exit 1
    fi
    phase='complete'
    write_state || exit 1
    clear_schema_compatibility_barrier || exit 1
    clear_cutover_started_marker || exit 1
    clear_pending_state || exit 1
  ) || return 1
  phase='complete'
}

finalize_previous_release_rollback() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    exec 202<>"$deployment_watchdog_decision_path"
    flock -w 30 202 || exit 1
    verify_deployment_owner_lease_held || exit 1
    verify_deployment_watchdog_active || exit 1
    verify_previous_release_units_active || exit 1
    verify_release_public_endpoints "$previous_snapshot" || exit 1
    atomic_symlink "$previous_release" "$current_link" || exit 1
    atomic_symlink "$previous_release" "$last_known_good_link" || exit 1
    phase='rolled_back'
    write_state || exit 1
    clear_cutover_started_marker || exit 1
    clear_pending_state || exit 1
  ) || return 1
  phase='rolled_back'
}

finalize_completed_recovery() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    exec 202<>"$deployment_watchdog_decision_path"
    flock -w 30 202 || exit 1
    verify_deployment_owner_lease_held || exit 1
    verify_deployment_watchdog_active || exit 1
    verify_application_units_active || exit 1
    [[ ! -e "$deployment_guard_path" && ! -L "$deployment_guard_path" ]] || {
      fail 'completed recovery remains sealed'
      exit 1
    }
    if [[ "$phase" == 'complete' ]]; then
      clear_schema_compatibility_barrier || exit 1
    fi
    clear_cutover_started_marker || exit 1
    clear_pending_state || exit 1
  )
}

finalize_pre_cutover_failure() {
  (
    exec 199<>"$deployment_watchdog_control_path"
    flock -w 30 199 || exit 1
    exec 202<>"$deployment_watchdog_decision_path"
    flock -w 30 202 || exit 1
    verify_deployment_owner_lease_held || exit 1
    verify_deployment_watchdog_active || exit 1
    [[ "$(cutover_started_state)" == 'absent' ]] || {
      fail 'pre-cutover failure cannot be finalized after cutover started'
      exit 1
    }
    [[ "$(schema_compatibility_barrier_state)" == 'absent' ]] || {
      fail 'pre-cutover failure crossed the schema compatibility boundary'
      exit 1
    }
    stop_release_transient_units || exit 1
    if [[ -n "$previous_release" ]]; then
      verify_previous_release_units_active || exit 1
    fi
    phase='pre_cutover_failed'
    write_state || exit 1
    clear_pending_state || exit 1
  ) || return 1
  phase='pre_cutover_failed'
}

invoke_release_deploy() {
  local release_path="$1"
  local release_sha="$2"
  local snapshot_path="$3"
  local runtime_limit="${4:-110m}"
  local execution_mode="${5:-activate}"
  case "$execution_mode" in
    activate|reactivate-prepared) ;;
    *)
      fail 'release execution mode must be activate or reactivate-prepared'
      return 1
      ;;
  esac
  local legacy_course_state_dir
  legacy_course_state_dir="$(legacy_course_state_snapshot_dir)" || return 1
  local release_schema_barrier_path="$state_dir/$release_sha-schema-barrier"
  (
    load_config_file "$snapshot_path" || exit 1
    cd -- "$release_path/source" || exit 1
    DEPLOY_SHA="$release_sha" \
      DEPLOY_BRANCH=release \
      APP_DIR="$release_path/source" \
      STUDYTUBE_DEPLOYMENT_GUARD_PATH="$deployment_guard_path" \
      STUDYTUBE_DEPLOYMENT_OWNER_SHA="$deploy_sha" \
      STUDYTUBE_SCHEMA_BARRIER_PATH="$release_schema_barrier_path" \
      STUDYTUBE_CUTOVER_STARTED_PATH="$cutover_started_path" \
      STUDYTUBE_WATCHDOG_LEASE_PATH="$deployment_lease_file" \
      STUDYTUBE_OWNER_PROOF_PATH="$deployment_owner_proof_file" \
      STUDYTUBE_WATCHDOG_CONTROL_PATH="$deployment_watchdog_control_path" \
      STUDYTUBE_WATCHDOG_TRIP_PATH="$deployment_watchdog_trip_path" \
      STUDYTUBE_WATCHDOG_CANCEL_PATH="$deployment_watchdog_cancel_path" \
      STUDYTUBE_WATCHDOG_ARMED_PATH="$deployment_watchdog_armed_path" \
      STUDYTUBE_LEGACY_COURSE_STATE_DIR="$legacy_course_state_dir" \
      STUDYTUBE_RELEASE_EXECUTION_MODE="$execution_mode" \
      timeout --signal=TERM --kill-after=30s "$runtime_limit" \
        bash scripts/deploy-ec2.sh release
  )
}

release_supports_prepared_reactivation() {
  local release_path="$1"
  local deploy_script="$release_path/source/scripts/deploy-ec2.sh"
  [[ -f "$deploy_script" && ! -L "$deploy_script" ]] || return 1
  grep -Fq 'STUDYTUBE_WATCHDOG_CANCEL_PATH' "$deploy_script" &&
    grep -Fq 'release_deployment_guard' "$deploy_script" &&
    grep -Fq 'assert_deployment_mutation_allowed' "$deploy_script" &&
    grep -Fq 'reactivate-prepared' "$deploy_script" &&
    grep -Fq 'verify_prepared_release_for_reactivation' "$deploy_script"
}

invoke_interlocked_release_deploy() {
  local release_path="$1"
  local release_sha="$2"
  local snapshot_path="$3"
  local runtime_limit="${4:-110m}"
  local execution_mode="${5:-activate}"
  run_controlled_watchdog_mutation \
    link_release_config "$release_path" "$snapshot_path" || return 1
  invoke_release_deploy \
    "$release_path" "$release_sha" "$snapshot_path" "$runtime_limit" "$execution_mode"
}

invoke_prepared_release_reactivation() {
  local release_path="$1"
  local release_sha="$2"
  local snapshot_path="$3"
  release_supports_prepared_reactivation "$release_path" || {
    fail 'previous release does not support bounded prepared reactivation; recovery remains sealed'
    return 1
  }
  invoke_interlocked_release_deploy \
    "$release_path" "$release_sha" "$snapshot_path" 25m reactivate-prepared
}

rollback_previous_release() {
  local cutover_state course_transition_state barrier_state
  cutover_state="$(cutover_started_state)" || return 1
  case "$cutover_state" in
    absent) ;;
    present)
      course_transition_state="$(course_activation_transition_state)" || return 1
      case "$course_transition_state" in
        unchanged) ;;
        crossed)
          fail 'refusing previous-release rollback after durable Course activation; roll forward in freeze mode'
          return 1
          ;;
        invalid)
          fail 'refusing previous-release rollback because the Course activation transition is invalid'
          return 1
          ;;
        *)
          fail 'Course activation transition returned an unknown state'
          return 1
          ;;
      esac
      ;;
    invalid)
      fail 'refusing previous-release rollback because the cutover-started marker is invalid'
      return 1
      ;;
    *)
      fail 'cutover-started marker returned an unknown state'
      return 1
      ;;
  esac
  barrier_state="$(schema_compatibility_barrier_state)" || return 1
  [[ "$barrier_state" == 'absent' ]] || {
    fail "refusing previous-release rollback because schema barrier is $barrier_state"
    return 1
  }
  safe_release_target "$previous_release" || {
    fail 'recorded previous release is not safe to roll back to'
    return 1
  }
  local previous_metadata="$previous_release/deploy-success.env"
  [[ -f "$previous_metadata" && ! -L "$previous_metadata" ]] ||
    {
      fail 'previous release has no successful deployment metadata'
      return 1
    }
  [[ "$(state_value "$previous_metadata" STUDYTUBE_DEPLOY_SUCCESS_FORMAT)" == '1' ]] ||
    {
      fail 'previous release success metadata is invalid'
      return 1
    }

  local previous_sha previous_snapshot previous_fingerprint
  previous_sha="$(state_value "$previous_metadata" DEPLOY_SHA)" || return 1
  previous_snapshot="$(state_value "$previous_metadata" CONFIG_SNAPSHOT)" || return 1
  previous_fingerprint="$(state_value "$previous_metadata" CONFIG_FINGERPRINT)" || return 1
  validate_sha "$previous_sha" || return 1
  validate_config_file "$previous_snapshot" || return 1
  [[ "$(sha256sum "$previous_snapshot" | awk '{print $1}')" == "$previous_fingerprint" ]] ||
    {
      fail 'previous release config snapshot fingerprint is invalid'
      return 1
    }

  phase='rolling_back'
  write_state || return 1
  local rollback_status=0
  invoke_prepared_release_reactivation \
    "$previous_release" "$previous_sha" "$previous_snapshot" || rollback_status=$?
  if ((rollback_status != 0)); then
    seal_deployment_guard || true
    return 1
  fi
  run_controlled_watchdog_mutation prepare_previous_release_public_edge || {
    seal_deployment_guard || true
    return 1
  }
  verify_previous_release_units_active || {
    seal_deployment_guard || true
    return 1
  }
  finalize_previous_release_rollback || {
    seal_deployment_guard || true
    stop_public_edge || true
    return 1
  }
}

activate_release() {
  local activation_mode="$1"
  [[ "$activation_mode" == 'deploy' || "$activation_mode" == 'recovery' ]] || {
    fail 'activation mode must be deploy or recovery'
    return 1
  }
  [[ "$course_activation_baseline" == 'absent' ||
     "$course_activation_baseline" == 'present' ]] || {
    fail 'Course activation baseline must be recorded before activation'
    return 1
  }
  if [[ -n "$previous_release" ]]; then
    atomic_symlink "$previous_release" "$last_known_good_link"
  fi

  phase='activating'
  write_state
  if [[ "$activation_mode" == 'recovery' ]]; then
    seal_deployment_guard || return 1
  fi
  start_deployment_watchdog "$activation_mode" || return 1
  if ! invoke_interlocked_release_deploy "$release_dir" "$deploy_sha" "$config_snapshot"; then
    local cutover_state barrier_state course_transition_state
    cutover_state="$(cutover_started_state)" || return 1
    if [[ "$cutover_state" == 'absent' ]]; then
      finalize_pre_cutover_failure || {
        seal_deployment_guard || true
        return 1
      }
      fail 'release preparation failed before cutover; the current release remains active'
      return 1
    elif [[ "$cutover_state" == 'invalid' ]]; then
      fail 'cutover-started marker became invalid during activation'
    fi
    phase='rollback_required'
    write_state
    seal_deployment_guard || return 1
    stop_release_transient_units || return 1
    course_transition_state="$(course_activation_transition_state)" || return 1
    case "$course_transition_state" in
      crossed)
        fail 'activation crossed durable Course activation; recover by rolling forward the same release'
        return 1
        ;;
      invalid)
        fail 'Course activation transition is invalid; recovery remains sealed'
        return 1
        ;;
      unchanged) ;;
      *)
        fail 'Course activation transition returned an unknown state'
        return 1
        ;;
    esac
    barrier_state="$(schema_compatibility_barrier_state)" || return 1
    case "$barrier_state" in
      absent)
        if [[ -n "$previous_release" ]]; then
          rollback_previous_release || return 1
        else
          fail 'first immutable activation failed; automatic legacy downgrade is forbidden'
        fi
        ;;
      present)
        fail 'activation crossed an irreversible schema boundary; recover by rolling forward the same release'
        ;;
      invalid)
        fail 'schema compatibility barrier is invalid; recovery remains sealed'
        ;;
      *) fail 'schema compatibility barrier returned an unknown state' ;;
    esac
    return 1
  fi

  finalize_successful_activation || {
    seal_deployment_guard || true
    stop_public_edge || true
    return 1
  }
}

prune_releases() {
  local current_target last_known_good_target
  current_target="$(current_release_target "$current_link" 2>/dev/null || true)"
  last_known_good_target="$(current_release_target "$last_known_good_link" 2>/dev/null || true)"
  local index=0 candidate resolved_candidate
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    resolved_candidate="$(readlink -f -- "$candidate")"
    safe_release_target "$resolved_candidate" || continue
    index=$((index + 1))
    if ((index <= retain_releases)) ||
      [[ "$resolved_candidate" == "$current_target" || "$resolved_candidate" == "$last_known_good_target" ]]; then
      continue
    fi
    [[ "$resolved_candidate" == "$releases_dir"/[0-9a-f][0-9a-f]* ]] || continue
    rm -rf -- "$resolved_candidate"
  done < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d \
    -name '[0-9a-f][0-9a-f]*' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}

acquire_deployment_lock() {
  [[ "$deployment_lock_held" == 'false' ]] || return 0
  exec 9>"$state_dir/deployment.lock"
  flock -n 9 || {
    fail 'another immutable deployment is already running'
    return 1
  }
  deployment_lock_held='true'
}

run_deployment() {
  local deployment_mode="${1:-deploy}"
  local recovery_phase="$phase"
  [[ "$deployment_mode" == 'deploy' || "$deployment_mode" == 'recovery' ]] ||
    fail 'deployment mode must be deploy or recovery'
  validate_sha "$deploy_sha"
  validate_digest "$artifact_sha256"
  validate_absolute_path "$deploy_root" DEPLOY_ROOT
  validate_absolute_path "$config_file" CONFIG_FILE
  validate_positive_integer "$retain_releases" RETAIN_RELEASES
  validate_positive_integer "$minimum_free_bytes" MINIMUM_FREE_BYTES
  parse_s3_uri "$artifact_uri"
  [[ "$aws_region" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]] || fail 'AWS region is invalid'

  ((EUID == 0)) || fail 'deploy and resume must run as root'
  for command_name in aws git tar sha256sum stat df flock sync systemctl systemd-run npm python3 docker getent id timeout; do
    require_command "$command_name"
  done

  mkdir -p -- "$deploy_root"
  initialize_paths
  if [[ "$deployment_mode" == 'deploy' && "$(cutover_started_state)" != 'absent' ]]; then
    fail 'refusing a new deployment with unresolved cutover state'
    return 1
  fi
  acquire_deployment_lock
  if [[ "$deployment_mode" == 'deploy' && ( -e "$pending_file" || -L "$pending_file" ) ]]; then
    seal_deployment_guard || true
    stop_public_edge || true
    fail 'refusing to replace an unresolved deployment; run resume first'
  fi
  if [[ "$deployment_mode" == 'recovery' ]]; then
    [[ -f "$pending_file" && ! -L "$pending_file" ]] ||
      fail 'recovery requires regular pending deployment state'
    [[ "$(state_value "$pending_file" DEPLOY_SHA)" == "$deploy_sha" ]] ||
      fail 'recovery pending state belongs to another release'
  else
    release_transient_unit_is_quiescent "$DEPLOYMENT_WATCHDOG_SERVICE" ||
      fail 'refusing to overlap an active deployment watchdog'
  fi
  assert_release_transient_units_quiescent

  start_diagnostic_log
  install_resume_service
  snapshot_config
  state_file="$state_dir/$deploy_sha.env"

  if [[ -z "$previous_release" ]]; then
    previous_release="$(current_release_target "$current_link" 2>/dev/null || true)"
  fi
  phase='initialized'
  write_state

  download_artifact
  verify_artifact "$artifact_file" "$artifact_sha256" "$deploy_sha"
  phase='artifact_verified'
  write_state

  stage_release
  check_disk_space "$(stat -c '%s' "$artifact_file")"
  phase='release_staged'
  write_state

  prepare_release
  disable_legacy_pull_deployment
  snapshot_legacy_runtime
  case "$course_activation_baseline" in
    '')
      if [[ "$deployment_mode" == 'deploy' ||
         "$recovery_phase" == 'initialized' ||
         "$recovery_phase" == 'artifact_verified' ||
         "$recovery_phase" == 'release_staged' ]]; then
        record_course_activation_baseline
      else
        fail 'pending activation state has no durable Course activation baseline'
        return 1
      fi
      ;;
    absent|present) ;;
    *)
      fail 'persisted Course activation baseline is invalid'
      return 1
      ;;
  esac
  phase='prepared'
  write_state

  activate_release "$deployment_mode"
  prune_releases
  printf 'deployed_sha=%s\nartifact_sha256=%s\nconfig_fingerprint=%s\n' \
    "$deploy_sha" "$artifact_sha256" "$config_fingerprint"
}

command_name="${1:-}"
[[ -n "$command_name" ]] || {
  usage >&2
  exit 2
}
shift

artifact_uri=''
artifact_file=''
artifact_sha256=''
aws_region=''
deploy_sha=''
config_file="$DEFAULT_CONFIG_FILE"
deploy_root="$DEFAULT_DEPLOY_ROOT"
retain_releases="$DEFAULT_RETAIN_RELEASES"
minimum_free_bytes="$DEFAULT_MINIMUM_FREE_BYTES"
deployment_guard_path="$DEFAULT_DEPLOYMENT_GUARD_PATH"
config_fingerprint=''
config_snapshot=''
previous_release=''
legacy_runtime_snapshot=''
course_activation_baseline=''
phase='new'
artifact_bucket=''
artifact_key=''
releases_dir=''
artifacts_dir=''
state_dir=''
diagnostics_dir=''
config_snapshots_dir=''
current_link=''
last_known_good_link=''
state_file=''
pending_file=''
release_dir=''
diagnostic_log=''
diagnostics_initialized='false'
schema_barrier_path=''
cutover_started_path=''
deployment_lease_file=''
deployment_owner_proof_file=''
deployment_watchdog_control_path=''
deployment_watchdog_decision_path=''
deployment_watchdog_trip_path=''
deployment_watchdog_cancel_path=''
deployment_watchdog_armed_path=''
deployment_watchdog_started='false'
deployment_owner_lease_held='false'
deployment_lock_held='false'
watchdog_requested_lease_file=''

while (($# > 0)); do
  case "$1" in
    --artifact-uri)
      (($# >= 2)) || { fail '--artifact-uri requires a value'; exit 2; }
      artifact_uri="$2"
      shift 2
      ;;
    --artifact-file)
      (($# >= 2)) || { fail '--artifact-file requires a value'; exit 2; }
      artifact_file="$2"
      shift 2
      ;;
    --artifact-sha256)
      (($# >= 2)) || { fail '--artifact-sha256 requires a value'; exit 2; }
      artifact_sha256="$2"
      shift 2
      ;;
    --deploy-sha)
      (($# >= 2)) || { fail '--deploy-sha requires a value'; exit 2; }
      deploy_sha="$2"
      shift 2
      ;;
    --region)
      (($# >= 2)) || { fail '--region requires a value'; exit 2; }
      aws_region="$2"
      shift 2
      ;;
    --config-file)
      (($# >= 2)) || { fail '--config-file requires a value'; exit 2; }
      config_file="$2"
      shift 2
      ;;
    --deploy-root)
      (($# >= 2)) || { fail '--deploy-root requires a value'; exit 2; }
      deploy_root="$2"
      shift 2
      ;;
    --lease-file)
      (($# >= 2)) || { fail '--lease-file requires a value'; exit 2; }
      watchdog_requested_lease_file="$2"
      shift 2
      ;;
    --retain-releases)
      (($# >= 2)) || { fail '--retain-releases requires a value'; exit 2; }
      retain_releases="$2"
      shift 2
      ;;
    --minimum-free-bytes)
      (($# >= 2)) || { fail '--minimum-free-bytes requires a value'; exit 2; }
      minimum_free_bytes="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      exit 2
      ;;
  esac
done

trap 'exit_handler $?' EXIT

case "$command_name" in
  arm-resume-guard)
    validate_absolute_path "$deploy_root" DEPLOY_ROOT
    ((EUID == 0)) || { fail 'deployment guard must run as root'; exit 1; }
    require_command docker
    require_command sleep
    require_command systemctl
    require_command timeout
    state_dir="$deploy_root/deployment-state"
    pending_file="$state_dir/pending.env"
    arm_deployment_guard
    ;;
  seal-resume-guard)
    validate_absolute_path "$deploy_root" DEPLOY_ROOT
    ((EUID == 0)) || { fail 'deployment guard must run as root'; exit 1; }
    require_command systemctl
    require_command docker
    require_command timeout
    state_dir="$deploy_root/deployment-state"
    pending_file="$state_dir/pending.env"
    seal_deployment_guard
    ;;
  validate-config-content)
    load_config_file "$config_file"
    printf 'deployment config content is safe to load\n'
    ;;
  verify-artifact)
    for command in git tar sha256sum mktemp; do
      require_command "$command"
    done
    [[ -n "$artifact_file" && -n "$artifact_sha256" && -n "$deploy_sha" ]] || {
      fail 'verify-artifact requires --artifact-file, --artifact-sha256, and --deploy-sha'
      exit 2
    }
    verify_artifact "$artifact_file" "$artifact_sha256" "$deploy_sha"
    printf 'verified_sha=%s\nartifact_sha256=%s\n' "$deploy_sha" "$artifact_sha256"
    ;;
  watch-deployment)
    [[ -n "$deploy_sha" && -n "$watchdog_requested_lease_file" ]] || {
      fail 'watch-deployment requires --deploy-sha and --lease-file'
      exit 2
    }
    watch_deployment_lease
    ;;
  deploy)
    [[ -n "$artifact_uri" && -n "$artifact_sha256" && -n "$deploy_sha" && -n "$aws_region" ]] || {
      fail 'deploy requires --artifact-uri, --artifact-sha256, --deploy-sha, and --region'
      exit 2
    }
    run_deployment deploy
    ;;
  resume)
    validate_absolute_path "$deploy_root" DEPLOY_ROOT
    ((EUID == 0)) || { fail 'resume must run as root'; exit 1; }
    require_command flock
    require_command systemctl
    require_command docker
    require_command timeout
    releases_dir="$deploy_root/releases"
    state_dir="$deploy_root/deployment-state"
    pending_file="$state_dir/pending.env"
    if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
      printf 'No interrupted StudyTube deployment is pending.\n'
      exit 0
    fi
    resume_requested_deploy_root="$deploy_root"
    acquire_deployment_lock
    if [[ ! -e "$pending_file" && ! -L "$pending_file" ]]; then
      printf 'No interrupted StudyTube deployment is pending.\n'
      exit 0
    fi
    seal_deployment_guard
    stop_public_edge
    stop_deployment_watchdog || exit 1
    stop_release_transient_units || exit 1
    [[ -f "$pending_file" && ! -L "$pending_file" ]] || {
      fail 'pending deployment state is not a regular file'
      exit 1
    }
    load_pending_state
    [[ "$deploy_root" == "$resume_requested_deploy_root" ]] || {
      fail 'pending deployment root does not match the requested recovery root'
      exit 1
    }
    validate_absolute_path "$deploy_root" DEPLOY_ROOT
    initialize_paths
    start_diagnostic_log
    state_file="$state_dir/$deploy_sha.env"
    install_resume_service
    start_deployment_watchdog
    if [[ "$phase" == 'complete' ]]; then
      release_dir="$releases_dir/$deploy_sha"
      safe_release_target "$release_dir" || {
        fail 'completed deployment release is not safe to recover'
        exit 1
      }
      invoke_interlocked_release_deploy "$release_dir" "$deploy_sha" "$config_snapshot"
      finalize_completed_recovery
      printf 'Recovered completed deployment state for %s.\n' "$deploy_sha"
      exit 0
    fi
    if [[ "$phase" == 'rolled_back' ]]; then
      [[ -n "$previous_release" ]] || {
        fail 'rolled-back deployment has no previous immutable release'
        exit 1
      }
      rollback_previous_release
      printf 'Recovered rolled-back deployment state for %s.\n' "$deploy_sha"
      exit 0
    fi
    if [[ "$phase" == 'activating' || "$phase" == 'rollback_required' || "$phase" == 'rolling_back' ]]; then
      cutover_state="$(cutover_started_state)"
      case "$cutover_state" in
        absent)
          if [[ -n "$previous_release" ]]; then
            rollback_previous_release
            printf 'Interrupted pre-cutover deployment restored %s.\n' \
              "$(basename -- "$previous_release")"
            exit 0
          fi
          ;;
        present) ;;
        invalid)
          fail 'cutover-started marker is invalid; recovery remains sealed'
          exit 1
          ;;
        *)
          fail 'cutover-started marker returned an unknown state'
          exit 1
          ;;
      esac
      course_transition_state="$(course_activation_transition_state)"
      case "$course_transition_state" in
        crossed)
          printf 'Interrupted deployment crossed durable Course activation; rolling forward %s.\n' "$deploy_sha"
          run_deployment recovery
          printf 'Interrupted deployment rolled forward release %s.\n' "$deploy_sha"
          exit 0
          ;;
        invalid)
          fail 'Course activation transition is invalid; recovery remains sealed'
          exit 1
          ;;
        unchanged) ;;
        *)
          fail 'Course activation transition returned an unknown state'
          exit 1
          ;;
      esac
      barrier_state="$(schema_compatibility_barrier_state)"
      case "$barrier_state" in
        present)
          run_deployment recovery
          printf 'Interrupted deployment rolled forward release %s.\n' "$deploy_sha"
          exit 0
          ;;
        invalid)
          fail 'schema compatibility barrier is invalid; recovery remains sealed'
          exit 1
          ;;
        absent)
          if [[ -n "$previous_release" ]]; then
            rollback_previous_release
            printf 'Interrupted deployment rolled back to %s.\n' "$(basename -- "$previous_release")"
            exit 0
          fi
          ;;
        *)
          fail 'schema compatibility barrier returned an unknown state'
          exit 1
          ;;
      esac
    fi
    run_deployment recovery
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
