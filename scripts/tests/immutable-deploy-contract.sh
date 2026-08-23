#!/usr/bin/env bash
# Literal source assertions and indirect test doubles are intentional in this contract.
# shellcheck disable=SC1003,SC1090,SC2016,SC2034,SC2317,SC2329
set -Eeuo pipefail

fail() {
  printf 'immutable deploy contract: %s\n' "$1" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
builder="$repo_root/scripts/build-release-artifact.sh"
runner="$repo_root/scripts/ssm-deploy-release.sh"
sender="$repo_root/scripts/send-ssm-deployment.sh"
workflow="$repo_root/.github/workflows/ci-cd.yml"
production_compose="$repo_root/infra/production.compose.yml"
runtime_isolation_contract="$script_dir/runtime-isolation-contract.sh"
production_compose_loopback_contract="$script_dir/production-compose-loopback-contract.sh"

for path in \
  "$builder" \
  "$runner" \
  "$sender" \
  "$workflow" \
  "$production_compose" \
  "$runtime_isolation_contract" \
  "$production_compose_loopback_contract"; do
  [[ -f "$path" ]] || fail "missing required file: $path"
done

bash -n "$builder"
bash -n "$runner"
bash -n "$sender"
bash -n "$runtime_isolation_contract"
bash -n "$production_compose_loopback_contract"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$builder" "$runner" "$sender" "$runtime_isolation_contract" \
    "$production_compose_loopback_contract" "$0"
fi

bash "$runtime_isolation_contract"

grep -Eq '^[[:space:]]*uses:[[:space:]]+aws-actions/configure-aws-credentials@[0-9a-f]{40}[[:space:]]+#[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+[[:space:]]*$' "$workflow" ||
  fail 'workflow does not establish AWS credentials through GitHub OIDC'
grep -Fq 'id-token: write' "$workflow" || fail 'workflow cannot request an OIDC identity token'
grep -Fq 'scripts/build-release-artifact.sh' "$workflow" || fail 'workflow does not build the immutable artifact'
grep -Fq 'scripts/send-ssm-deployment.sh' "$workflow" || fail 'workflow does not use the SSM sender'
grep -Eq '^[[:space:]]*uses:[[:space:]]+actions/upload-artifact@[0-9a-f]{40}[[:space:]]+#[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+[[:space:]]*$' "$workflow" ||
  fail 'workflow does not preserve diagnostics through an immutable action reference'
if grep -E '^[[:space:]]*uses:' "$workflow" |
  grep -Ev '^[[:space:]]*uses:[[:space:]]+[^@[:space:]]+@[0-9a-f]{40}[[:space:]]+#[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+[[:space:]]*$' >/dev/null; then
  fail 'workflow contains an action without a full commit SHA and version comment'
fi
grep -Fq 'AWS_SSM_INSTANCE_ID' "$workflow" || fail 'workflow does not inject the SSM instance ID'
grep -Fq 'AWS_RELEASE_BUCKET' "$workflow" || fail 'workflow does not inject the release bucket'
grep -Fq 'scripts/tests/production-compose-loopback-contract.sh' "$workflow" ||
  fail 'workflow does not verify production data services from the host network namespace'

postgres_image='pgvector/pgvector:pg16@sha256:00ba258a66dac104fd5171074a0084462a64a1369d8513f3d0a634e2f24d15bc'
valkey_image='valkey/valkey:9.1.1-alpine@sha256:ee91f7a174ac4d6a6b0685b3a60e321f0a9dbbb691f9b0e285be2ba1d1be8328'
for image in "$postgres_image" "$valkey_image"; do
  grep -Fq "image: $image" "$workflow" || fail "CI service image is not digest-pinned: $image"
  grep -Fq "image: $image" "$production_compose" ||
    fail "production service image does not match the CI digest: $image"
done
grep -Fq "postgres_container=\"\${{ job.services.postgres.id }}\"" "$workflow" ||
  fail 'PostgreSQL diagnostics do not use the service container ID'
grep -Fq "valkey_container=\"\${{ job.services.valkey.id }}\"" "$workflow" ||
  fail 'Valkey diagnostics do not use the service container ID'
if grep -Fq -- '--filter ancestor=' "$workflow"; then
  fail 'CI diagnostics still depend on a mutable image ancestor filter'
fi

if grep -Eq 'EC2_SSH_KEY|ssh-keyscan|(^|[[:space:]])ssh[[:space:]]' "$workflow"; then
  fail 'workflow still contains a long-lived SSH deployment path'
fi
if sed -E 's/127\.0\.0\.1//g; s/0\.0\.0\.0//g' "$workflow" |
  grep -Eq '(^|[^0-9])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9]|$)'; then
  fail 'workflow contains a hard-coded IPv4 address'
fi

grep -Fq -- "--if-none-match '*'" "$sender" || fail 'S3 writes are not conditional'
grep -Fq -- '--object-lock-mode GOVERNANCE' "$sender" || fail 'S3 release objects are not retention locked'
grep -Fq 'ssm send-command' "$sender" || fail 'sender does not use SSM Run Command'
grep -Fq 'AWS-RunShellScript' "$sender" || fail 'sender does not identify the SSM document'
grep -Fq 'last-known-good' "$runner" || fail 'runner does not maintain a last known good pointer'
grep -Fq 'config_fingerprint' "$runner" || fail 'runner does not persist a config fingerprint'
grep -Fq 'check_disk_space' "$runner" || fail 'runner has no disk preflight'
grep -Fq 'rollback_previous_release' "$runner" || fail 'runner has no rollback path'
grep -Fq 'studytube-deploy-resume.service' "$runner" || fail 'runner cannot recover after reboot'
grep -Fq 'studytube-deploy-resume-guard.service' "$runner" ||
  fail 'runner has no short boot guard for interrupted recovery'
grep -Fq "DEPLOYMENT_WATCHDOG_SERVICE='studytube-deployment-watchdog.service'" "$runner" ||
  fail 'runner has no PID 1-owned deployment watchdog'
grep -Fq 'watch-deployment' "$runner" ||
  fail 'runner cannot monitor a deployment owner lease independently'
grep -Fq 'flock -w "$DEPLOYMENT_WATCHDOG_TIMEOUT_SECONDS" 200' "$runner" ||
  fail 'deployment watchdog cannot detect a killed or hung deployment owner'
grep -Fq -- '--property=Restart=on-failure' "$runner" ||
  fail 'deployment watchdog is not restarted after an abnormal termination'
grep -Fq 'verify_deployment_watchdog_active' "$runner" ||
  fail 'the deployment guard can open without a live watchdog'
grep -Fq 'deployment_watchdog_trip_path' "$runner" ||
  fail 'watchdog timeout and guard release are not interlocked'
grep -Fq 'deployment_owner_proof_file' "$runner" ||
  fail 'guard release does not prove inherited deployment ownership'
grep -Fq 'deployment_watchdog_armed_path' "$runner" ||
  fail 'watchdog service activity is not bound to its live main process'
grep -Fq 'stop_release_transient_units || trip_status=$?' "$runner" ||
  fail 'watchdog does not terminate orphaned build and migration units'
grep -Fq 'stop_public_edge || seal_status=$?' "$runner" ||
  fail 'sealed recovery can leave the public edge serving a mixed release'
grep -Fq -- '--property=RuntimeMaxSec=155min' "$runner" ||
  fail 'watchdog lifetime cannot cover a bounded mutation holding the control lock'
watchdog_lease_seconds="$(sed -nE "s/^readonly DEPLOYMENT_WATCHDOG_TIMEOUT_SECONDS='([0-9]+)'$/\1/p" "$runner")"
watchdog_runtime_minutes="$(sed -nE 's/.*--property=RuntimeMaxSec=([0-9]+)min.*/\1/p' "$runner")"
[[ "$watchdog_lease_seconds" =~ ^[0-9]+$ && "$watchdog_runtime_minutes" =~ ^[0-9]+$ ]] ||
  fail 'could not parse watchdog lease and runtime budgets'
((watchdog_runtime_minutes * 60 >= watchdog_lease_seconds + 300)) ||
  fail 'watchdog runtime does not reserve five minutes to trip and seal after lease expiry'
grep -Fq 'local runtime_limit="${4:-110m}"' "$runner" ||
  fail 'release activation does not have a bounded primary runtime budget'
grep -Fq '"$release_path" "$release_sha" "$snapshot_path" 25m reactivate-prepared' "$runner" ||
  fail 'previous-release rollback does not use the bounded prepared reactivation path'
grep -Fq "readonly DEPLOYMENT_WATCHDOG_TIMEOUT_SECONDS='8700'" "$runner" ||
  fail 'deployment watchdog lease does not cover primary activation and fast rollback'
grep -Fq "'TimeoutStartSec=160min'" "$runner" ||
  fail 'resume service timeout does not cover the watchdog lifecycle'
grep -Fq "timeout_seconds='9600'" "$sender" ||
  fail 'SSM execution timeout does not cover the bounded recovery lifecycle'
grep -Fq 'timeout-minutes: 175' "$workflow" ||
  fail 'CI deploy timeout does not reserve time beyond the SSM execution budget'
primary_minutes=110
rollback_minutes=25
finalization_minutes=5
ssm_minutes=$((9600 / 60))
ci_minutes=175
((watchdog_lease_seconds >= (primary_minutes + rollback_minutes + finalization_minutes) * 60)) ||
  fail 'watchdog lease cannot cover primary activation, prepared rollback, and finalization'
((ssm_minutes >= watchdog_runtime_minutes + 5)) ||
  fail 'SSM execution timeout does not reserve five minutes beyond the watchdog runtime'
((ci_minutes >= ssm_minutes + 15)) ||
  fail 'CI deploy job does not reserve fifteen minutes around remote execution'
grep -Fq 'Before=studytube-deploy-resume.service studytube-api.service studytube-ai.service studytube-worker.service studytube-caddy.service' "$runner" ||
  fail 'short boot guard is not ordered before recovery and application services'
grep -Fq 'wait_for_public_edge_inspection' "$runner" ||
  fail 'boot guard can fail before Docker becomes inspectable and strand interrupted recovery'
grep -Fq 'TimeoutStartSec=infinity' "$runner" ||
  fail 'systemd can time out the boot guard before Docker recovers'
grep -Fq 'ExecStopPost=' "$runner" ||
  fail 'boot recovery cannot reseal failed post-start verification'
grep -Fq 'seal-resume-guard' "$runner" ||
  fail 'failed boot recovery does not stop partial application runtime'
grep -Fq 'ConditionPathExists=!$deployment_guard_path' "$runner" ||
  fail 'host-owned application drop-ins do not gate interrupted recovery'
grep -Fq '90-studytube-deployment-guard.conf' "$runner" ||
  fail 'application recovery guard is not installed as a host-priority drop-in'
if grep -Fq "'Before=studytube-api.service studytube-ai.service studytube-worker.service'" "$runner"; then
  fail 'long-running resume service still blocks the application jobs it restarts'
fi
for unit_template in \
  "$repo_root/infra/systemd/studytube-api.service.in" \
  "$repo_root/infra/systemd/studytube-ai.service.in" \
  "$repo_root/infra/systemd/studytube-worker.service.in" \
  "$repo_root/infra/systemd/studytube-caddy.service.in"; do
  if grep -Fq 'studytube-deploy-resume.service' "$unit_template"; then
    fail "application unit has a cyclic dependency on the long resume service: $unit_template"
  fi
  grep -Fq 'Wants=network-online.target' "$unit_template" ||
    fail "application unit does not request network startup: $unit_template"
  if grep -Fq 'Wants=network-online.target docker.service' "$unit_template"; then
    fail "application unit can restart Docker during an intentional maintenance stop: $unit_template"
  fi
  grep -Fq 'StartLimitIntervalSec=0' "$unit_template" ||
    fail "application unit can exhaust retries while Docker is restarting: $unit_template"
  if grep -Fq 'Requires=docker.service' "$unit_template"; then
    fail "application unit is clean-stopped without recovery when Docker restarts: $unit_template"
  fi
done
grep -Fq 'ExecStart=/usr/bin/docker start --attach studytube-caddy' \
  "$repo_root/infra/systemd/studytube-caddy.service.in" ||
  fail 'public edge is not owned by the recovery-gated systemd service'
grep -Fq 'restart: "no"' "$production_compose" ||
  fail 'Docker can auto-start the public edge before the boot recovery guard'
grep -Fq "Requires=\$DEPLOYMENT_GUARD_SERVICE" "$runner" ||
  fail 'resume service no longer requires the deployment guard'
if grep -Fq 'Requires=docker.service $DEPLOYMENT_GUARD_SERVICE' "$runner"; then
  fail 'resume service is clean-stopped without retry when Docker restarts'
fi
grep -Fq "'Wants=docker.service'" "$runner" ||
  fail 'deployment guard does not request Docker without coupling its lifetime'
grep -Fq 'STUDYTUBE_DEPLOYMENT_GUARD_PATH="$deployment_guard_path"' "$runner" ||
  fail 'release activation cannot open the host deployment guard intentionally'
grep -Fq 'STUDYTUBE_SCHEMA_BARRIER_PATH="$release_schema_barrier_path"' "$runner" ||
  fail 'release activation does not receive its persistent schema compatibility barrier'
grep -Fq 'STUDYTUBE_CUTOVER_STARTED_PATH="$cutover_started_path"' "$runner" ||
  fail 'release activation does not receive its deployment-owned cutover boundary'
grep -Fq 'STUDYTUBE_WATCHDOG_TRIP_PATH="$deployment_watchdog_trip_path"' "$runner" ||
  fail 'release activation cannot observe a watchdog trip'
grep -Fq 'STUDYTUBE_OWNER_PROOF_PATH="$deployment_owner_proof_file"' "$runner" ||
  fail 'release activation cannot prove that it inherited the deployment owner lock'
grep -Fq 'STUDYTUBE_WATCHDOG_ARMED_PATH="$deployment_watchdog_armed_path"' "$runner" ||
  fail 'release activation cannot verify the live watchdog process'
grep -Fq 'snapshot_legacy_course_state' "$runner" ||
  fail 'first immutable cutover does not classify legacy Course markers'
grep -Fq 'STUDYTUBE_LEGACY_COURSE_STATE_DIR="$legacy_course_state_dir"' "$runner" ||
  fail 'first immutable release cannot migrate its classified legacy Course state'
grep -Fq 'release_deployment_guard' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'release activation does not open the guard before controlled restart'
grep -Fq 'write_cutover_started_marker' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'release activation does not durably mark the start of cutover'
grep -Fq '$state_dir/$deployment_owner_sha-cutover-started' \
  "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'rollback cannot share the current deployment owner cutover marker'
grep -Fq 'run_controlled_deployment_mutation publish_verified_release' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'public edge publication can start after the deployment watchdog trips'
grep -Fq 'acquire_deployment_control' "$repo_root/scripts/install-production-runtime.sh" ||
  fail 'release transient units can start after the deployment watchdog trips'
grep -Fq 'validate_deployment_trip_marker' "$repo_root/scripts/install-production-runtime.sh" ||
  fail 'release transient units do not reject a durable watchdog cancellation'
guard_release_line="$(grep -n 'release_deployment_guard$' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
service_restart_line="$(grep -n 'systemctl restart studytube-ai.service studytube-api.service studytube-worker.service' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
[[ "$guard_release_line" =~ ^[0-9]+$ && "$service_restart_line" =~ ^[0-9]+$ ]] ||
  fail 'could not locate guarded application restart'
((guard_release_line < service_restart_line)) ||
  fail 'application services restart before the recovery guard opens'
preparation_line="$(grep -n 'bash scripts/install-production-runtime.sh prepare-release' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
cutover_seal_line="$(grep -nE '^[[:space:]]*seal_deployment_guard_for_cutover$' \
  "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
data_reconcile_line="$(grep -n -- '--remove-orphans postgres valkey' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
runtime_install_line="$(grep -n 'bash scripts/install-production-runtime.sh$' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
[[ "$preparation_line" =~ ^[0-9]+$ && "$cutover_seal_line" =~ ^[0-9]+$ &&
   "$data_reconcile_line" =~ ^[0-9]+$ && "$runtime_install_line" =~ ^[0-9]+$ ]] ||
  fail 'could not locate the live preparation and sealed cutover boundaries'
((preparation_line < cutover_seal_line &&
  cutover_seal_line < data_reconcile_line &&
  data_reconcile_line < runtime_install_line)) ||
  fail 'normal deployment mutates live runtime state before its durable cutover boundary'
grep -Fq -- '--no-recreate postgres valkey' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'pre-cutover data-service readiness can recreate containers under live traffic'
grep -Fq 'finalize_pre_cutover_failure' "$runner" ||
  fail 'pre-cutover preparation failure cannot preserve the current live release'
grep -Fq 'Interrupted pre-cutover deployment restored' "$runner" ||
  fail 'boot recovery cannot distinguish pre-cutover interruption from mutation'
for transient_unit in \
  studytube-release-web-dependencies.service \
  studytube-release-api-dependencies.service \
  studytube-release-web-build.service \
  studytube-release-api-build.service \
  studytube-release-web-prune.service \
  studytube-release-api-prune.service \
  studytube-release-ai-venv.service \
  studytube-release-ai-dependencies.service \
  studytube-release-migration.service \
  studytube-release-course-backfill.service \
  studytube-release-course-verify.service; do
  grep -Fq "$transient_unit" "$runner" ||
    fail "runner cannot detect orphaned transient unit $transient_unit"
done
grep -Fq 'assert_release_transient_units_quiescent' "$runner" ||
  fail 'a new deployment does not fail closed on an orphaned transient unit'
grep -Fq 'stop_release_transient_units || return 1' "$runner" ||
  fail 'activation failure can roll back before transient mutations stop'
grep -Fq 'stop_release_transient_units || exit 1' "$runner" ||
  fail 'resume can recover while transient mutations remain active'
grep -Fq 'release_transient_unit_is_quiescent "$unit_name" || {' "$runner" ||
  fail 'conditional transient cleanup can ignore a unit that remained active'
grep -Fq 'if ((rollback_status != 0)); then' "$runner" ||
  fail 'previous release rollback can record success after a failed deployment'
grep -Fq 'release_supports_prepared_reactivation "$release_path"' "$runner" ||
  fail 'rollback does not prove that the previous release supports fast reactivation'
grep -Fq 'previous release does not support bounded prepared reactivation; recovery remains sealed' "$runner" ||
  fail 'unsupported previous releases do not fail closed during rollback'
if grep -Fq 'invoke_legacy_release_deploy' "$runner"; then
  fail 'rollback can still rebuild or migrate a legacy previous release'
fi
grep -Fq "STUDYTUBE_RELEASE_EXECUTION_MODE=\"\$execution_mode\"" "$runner" ||
  fail 'release invocation does not select the bounded execution mode explicitly'
grep -Fq "if [ \"\$prepared_reactivation\" = 'false' ]; then" \
  "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'prepared rollback does not exclude full activation mutations'
grep -Fq 'verify_prepared_release_for_reactivation' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'prepared rollback does not verify its existing runtime artifacts'
grep -Fq 'require_sealed_prepared_reactivation' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'prepared rollback can reactivate without the deployment guard'
grep -Fq 'timeout --signal=TERM --kill-after=30s 25m \' \
  "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'release preparation is not bounded inside the primary activation budget'
grep -Fq 'timeout --signal=TERM --kill-after=30s 15m \' \
  "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'migration is not bounded inside the primary activation budget'
[[ "$(grep -Fc 'timeout --signal=TERM --kill-after=30s 10m \' \
  "$repo_root/scripts/deploy-ec2.sh")" -eq 2 ]] ||
  fail 'Course backfill and verification are not bounded inside the primary activation budget'
grep -Fq 'verify_application_units_active' "$runner" ||
  fail 'rollback can clear pending state before restored services are active'
grep -Fq 'verify_release_public_endpoints "$previous_snapshot"' "$runner" ||
  fail 'rollback can clear pending state before the adopted public edge answers HTTPS probes'
grep -Fq 'Interrupted deployment crossed durable Course activation; rolling forward' "$runner" ||
  fail 'resume can deadlock by selecting rollback after durable Course activation'
grep -Fq 'previous_release_course_activation_state' "$runner" ||
  fail 'Course activation baseline ignores the current immutable release marker'
grep -Fq 'pending activation state has no durable Course activation baseline' "$runner" ||
  fail 'recovery can infer a missing Course activation baseline after cutover began'
grep -Fq 'temporary_pending=' "$runner" ||
  fail 'pending deployment state is not replaced atomically'
grep -Fq 'sync -f "$temporary_state"' "$runner" ||
  fail 'deployment phase state can be lost after an acknowledged rename'
grep -Fq 'sync -f "$temporary_pending"' "$runner" ||
  fail 'pending deployment state can be lost after an acknowledged rename'
grep -Fq 'sync -f "$state_dir"' "$runner" ||
  fail 'deployment state directory updates are not made durable'
grep -Fq "refusing to replace an unresolved deployment; run resume first" "$runner" ||
  fail 'a new deployment can overwrite unresolved pending state'
grep -Fq 'temporary_state="$(mktemp "$state_dir/.${deploy_sha}.state.XXXXXX")" || return 1' "$runner" ||
  fail 'conditional state persistence can continue after temporary-file creation fails'
grep -Fq 'rm -f -- "$root_environment_path" || return 1' "$runner" ||
  fail 'conditional release configuration can ignore a failed environment replacement'
grep -Fq 'rm -f -- "$temporary_link" || return 1' "$runner" ||
  fail 'conditional symlink replacement can reuse an unsafe stale link'
if grep -Fq 'rollback_legacy_runtime' "$runner"; then
  fail 'first immutable activation can still downgrade across irreversible schema changes'
fi
grep -Fq 'schema_compatibility_barrier_state' "$runner" ||
  fail 'previous release rollback does not honor an irreversible schema barrier'
grep -Fq 'write_schema_compatibility_barrier' "$repo_root/scripts/deploy-ec2.sh" ||
  fail 'irreversible migrations do not create a persistent compatibility barrier'
grep -Fq 'clear_schema_compatibility_barrier' "$runner" ||
  fail 'a successful same-SHA redeployment can inherit a stale schema barrier'
barrier_line="$(grep -n 'write_schema_compatibility_barrier' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
migration_line="$(grep -n 'bash scripts/install-production-runtime.sh run-migration' "$repo_root/scripts/deploy-ec2.sh" | tail -1 | cut -d: -f1)"
[[ "$barrier_line" =~ ^[0-9]+$ && "$migration_line" =~ ^[0-9]+$ ]] ||
  fail 'could not locate schema barrier and migration execution'
((barrier_line < migration_line)) ||
  fail 'irreversible migration can start before its compatibility barrier is durable'
grep -Fq -- '--property=ActiveState --value' "$runner" ||
  fail 'transient cleanup does not verify the final systemd active state'
grep -Fq 'disable_legacy_pull_deployment' "$runner" || fail 'runner leaves the legacy pull deploy active'
grep -Fq 'snapshot_legacy_runtime' "$runner" || fail 'runner does not preserve first-cutover evidence'

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-artifact-contract.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

(
  # Load function definitions without executing the runner CLI.
  source <(sed '/^command_name=/,$d' "$runner")
  install() {
    local destination="${*: -1}"
    if [[ " $* " == *' -d '* ]]; then
      mkdir -p -- "$destination"
      chmod 0700 "$destination"
      return
    fi
    local source_path="${*: -2:1}"
    cp -- "$source_path" "$destination"
    chmod 0600 "$destination"
  }
  sync() { return 0; }

  legacy_app="$temporary_dir/user-owned-legacy-app"
  legacy_snapshot="$temporary_dir/root-snapshot-fixture"
  mkdir -p -- \
    "$legacy_app/infra" \
    "$legacy_app/.studytube-deploy-state" \
    "$legacy_snapshot"
  chmod 0755 "$legacy_app" "$legacy_app/infra" "$legacy_app/.studytube-deploy-state"
  : >"$legacy_app/infra/production.compose.yml"
  chmod 0644 "$legacy_app/infra/production.compose.yml"
  printf '%s\n' \
    'course_activated=true' \
    'first_deploy_sha=0123456789abcdef0123456789abcdef01234567' \
    'database_identity=fixture' \
    >"$legacy_app/.studytube-deploy-state/course-activated"
  printf '%s\n' \
    'parity_verified=true' \
    'deploy_sha=0123456789abcdef0123456789abcdef01234567' \
    'database_identity=fixture' \
    >"$legacy_app/.studytube-deploy-state/course-freeze-verified"
  chmod 0600 "$legacy_app/.studytube-deploy-state/course-activated" \
    "$legacy_app/.studytube-deploy-state/course-freeze-verified"

  legacy_owner_uid="$(stat -c '%u' "$legacy_app")"
  snapshot_legacy_course_state "$legacy_app" "$legacy_snapshot" "$legacy_owner_uid"
  cmp -s \
    "$legacy_app/.studytube-deploy-state/course-activated" \
    "$legacy_snapshot/course-state/course-activated" ||
    fail 'user-owned legacy Course activation marker was not classified into the root snapshot'
  cmp -s \
    "$legacy_app/.studytube-deploy-state/course-freeze-verified" \
    "$legacy_snapshot/course-state/course-freeze-verified" ||
    fail 'user-owned legacy frozen parity marker was not classified into the root snapshot'
)

(
  source <(sed '/^command_name=/,$d' "$runner")
  safe_release_target() { return 0; }
  course_activation_boundary_state() { printf '%s\n' "$fixture_boundary_state"; }
  course_activation_marker_state() {
    if [[ "$1" == "$previous_release/source/.studytube-deploy-state/course-activated" ]]; then
      printf 'present\n'
    else
      printf 'absent\n'
    fi
  }

  previous_release="$temporary_dir/releases/0123456789abcdef0123456789abcdef01234567"
  mkdir -p -- "$previous_release/source/.studytube-deploy-state"
  legacy_runtime_snapshot=''
  fixture_boundary_state='absent'
  course_activation_baseline=''
  record_course_activation_baseline
  [[ "$course_activation_baseline" == 'present' ]] ||
    fail 'Course activation baseline ignored the previous immutable release marker'

  course_activation_marker_state() { printf 'absent\n'; }
  if [[ "$(uname -s)" != MINGW* ]]; then
    rm -rf -- "$previous_release/source/.studytube-deploy-state"
    ln -s -- "$temporary_dir" "$previous_release/source/.studytube-deploy-state"
    [[ "$(previous_release_course_activation_state)" == 'invalid' ]] ||
      fail 'Course activation baseline followed a symlinked previous-release state directory'
  fi

  previous_release=''
  course_activation_baseline='present'
  fixture_boundary_state='present'
  [[ "$(course_activation_transition_state)" == 'unchanged' ]] ||
    fail 'an existing Course activation boundary was not treated as unchanged'
  course_activation_baseline='absent'
  [[ "$(course_activation_transition_state)" == 'crossed' ]] ||
    fail 'a new Course activation boundary was not detected'
  course_activation_baseline='present'
  fixture_boundary_state='absent'
  [[ "$(course_activation_transition_state)" == 'invalid' ]] ||
    fail 'removal of an existing Course activation boundary was not rejected'
)

(
  source <(sed '/^command_name=/,$d' "$runner")
  course_activation_baseline='absent'
  previous_release=''
  release_dir="$temporary_dir/release"
  deploy_sha='0123456789abcdef0123456789abcdef01234567'
  config_snapshot="$temporary_dir/config.env"
  finalize_count=0
  seal_count=0
  write_state() { return 0; }
  start_deployment_watchdog() { return 0; }
  invoke_interlocked_release_deploy() { return 1; }
  cutover_started_state() { printf 'absent\n'; }
  finalize_pre_cutover_failure() { finalize_count=$((finalize_count + 1)); }
  seal_deployment_guard() { seal_count=$((seal_count + 1)); }

  if activate_release deploy >/dev/null 2>&1; then
    fail 'pre-cutover release failure unexpectedly succeeded'
  fi
  [[ "$finalize_count" -eq 1 ]] ||
    fail 'pre-cutover release failure did not preserve the current release'
  [[ "$seal_count" -eq 0 ]] ||
    fail 'pre-cutover release failure sealed the still-live current release'
)

safe_config="$temporary_dir/safe-deployment.env"
unexpected_command_marker="$temporary_dir/config-command-executed"
cat >"$safe_config" <<EOF
SAFE_LITERAL=\$(touch $unexpected_command_marker)
SAFE_DELIMITERS=value;still-literal&not-a-command
EOF
bash "$runner" validate-config-content --config-file "$safe_config" >/dev/null
[[ ! -e "$unexpected_command_marker" ]] ||
  fail 'deployment config value executed as shell code'

for invalid_entry in \
  'BAD-NAME=value' \
  'BASH_ENV=/tmp/untrusted-startup' \
  'NODE_OPTIONS=--require=/tmp/untrusted.js' \
  'STUDYTUBE_WATCHDOG_TRIP_PATH=/tmp/untrusted-control' \
  'STUDYTUBE_LEGACY_COURSE_STATE_DIR=/tmp/untrusted-state' \
  'STUDYTUBE_RELEASE_EXECUTION_MODE=reactivate-prepared'; do
  invalid_config="$temporary_dir/invalid-deployment.env"
  printf '%s\n' "$invalid_entry" >"$invalid_config"
  if bash "$runner" validate-config-content --config-file "$invalid_config" >/dev/null 2>&1; then
    fail "unsafe deployment config entry was accepted: $invalid_entry"
  fi
done

deploy_sha="$(git -C "$repo_root" rev-parse HEAD)"
first_output="$temporary_dir/first"
second_output="$temporary_dir/second"
bash "$builder" --deploy-sha "$deploy_sha" --repo-root "$repo_root" --output-dir "$first_output" >/dev/null
bash "$builder" --deploy-sha "$deploy_sha" --repo-root "$repo_root" --output-dir "$second_output" >/dev/null

artifact_name="studytube-$deploy_sha.tar.gz"
first_artifact="$first_output/$artifact_name"
second_artifact="$second_output/$artifact_name"
first_sha256="$(sha256sum "$first_artifact" | awk '{print $1}')"
second_sha256="$(sha256sum "$second_artifact" | awk '{print $1}')"
[[ "$first_sha256" == "$second_sha256" ]] || fail 'the same commit produced different artifacts'

source_layout_a="$temporary_dir/source-layout-a"
source_layout_b="$temporary_dir/source-layout-b"
layout_output_a="$temporary_dir/layout-output-a"
layout_output_b="$temporary_dir/layout-output-b"
git clone --quiet --no-local "$repo_root" "$source_layout_a"
git clone --quiet --no-local "$repo_root" "$source_layout_b"
git -C "$source_layout_a" -c pack.threads=1 -c pack.compression=1 \
  repack -a -d -F --window=0
git -C "$source_layout_b" -c pack.threads=8 -c pack.compression=9 \
  repack -a -d -F --window=32 --depth=50
bash "$builder" --deploy-sha "$deploy_sha" --repo-root "$source_layout_a" \
  --output-dir "$layout_output_a" >/dev/null
bash "$builder" --deploy-sha "$deploy_sha" --repo-root "$source_layout_b" \
  --output-dir "$layout_output_b" >/dev/null
layout_sha256_a="$(sha256sum "$layout_output_a/$artifact_name" | awk '{print $1}')"
layout_sha256_b="$(sha256sum "$layout_output_b/$artifact_name" | awk '{print $1}')"
[[ "$layout_sha256_a" == "$layout_sha256_b" ]] ||
  fail 'repository pack layout changed the release artifact'

bash "$runner" verify-artifact \
  --artifact-file "$first_artifact" \
  --artifact-sha256 "$first_sha256" \
  --deploy-sha "$deploy_sha" \
  >/dev/null

extracted_artifact="$temporary_dir/extracted-artifact"
staged_checkout="$temporary_dir/staged-checkout"
mkdir -p -- "$extracted_artifact"
tar -xzf "$first_artifact" -C "$extracted_artifact"
git clone --quiet --branch release --single-branch \
  "$extracted_artifact/repository.bundle" "$staged_checkout" ||
  fail 'the verified release bundle cannot be cloned on the deployment host'
[[ "$(git -C "$staged_checkout" rev-parse HEAD)" == "$deploy_sha" ]] ||
  fail 'the cloned release bundle does not resolve to the deployed commit'

tampered_artifact="$temporary_dir/tampered.tar.gz"
cp -- "$first_artifact" "$tampered_artifact"
printf 'tamper\n' >>"$tampered_artifact"
if bash "$runner" verify-artifact \
  --artifact-file "$tampered_artifact" \
  --artifact-sha256 "$first_sha256" \
  --deploy-sha "$deploy_sha" \
  >/dev/null 2>&1; then
  fail 'tampered artifact unexpectedly passed verification'
fi

wrong_sha='0000000000000000000000000000000000000000'
if bash "$runner" verify-artifact \
  --artifact-file "$first_artifact" \
  --artifact-sha256 "$first_sha256" \
  --deploy-sha "$wrong_sha" \
  >/dev/null 2>&1; then
  fail 'artifact unexpectedly verified for a different commit'
fi

if command -v jq >/dev/null 2>&1; then
  fake_bin="$temporary_dir/fake-bin"
  fake_aws_log="$temporary_dir/fake-aws.log"
  mkdir -p -- "$fake_bin"
  cat >"$fake_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_AWS_LOG"
case "${1:-} ${2:-}" in
  's3api head-object')
    printf 'An error occurred (404) when calling the HeadObject operation: Not Found\n' >&2
    exit 1
    ;;
  's3api put-object')
    printf '{"ETag":"fixture"}\n'
    ;;
  'ssm send-command')
    printf '{"Command":{"CommandId":"11111111-2222-3333-4444-555555555555"}}\n'
    ;;
  'ssm get-command-invocation')
    printf '{"Status":"Success","StandardOutputContent":"fixture deployment succeeded","StandardErrorContent":""}\n'
    ;;
  's3 sync') ;;
  *)
    printf 'unexpected fake AWS command: %s\n' "$*" >&2
    exit 2
    ;;
esac
EOF
  chmod 0755 "$fake_bin/aws"

  FAKE_AWS_LOG="$fake_aws_log" PATH="$fake_bin:$PATH" \
    bash "$sender" \
      --artifact-file "$first_artifact" \
      --digest-file "$first_artifact.sha256" \
      --runner-file "$runner" \
      --deploy-sha "$deploy_sha" \
      --bucket studytube-release-contract \
      --instance-id i-0123456789abcdef0 \
      --region ap-northeast-2 \
      --diagnostics-dir "$temporary_dir/sender-diagnostics" \
      >/dev/null
  grep -Fq 'ssm send-command' "$fake_aws_log" || fail 'sender did not issue SSM SendCommand'
  [[ "$(grep -Fc 'ssm get-command-invocation' "$fake_aws_log")" -eq 2 ]] ||
    fail 'sender does not perform a final authoritative SSM status read'
  grep -Fq 'local_wait_buffer_seconds=60' "$sender" ||
    fail 'local SSM waiter has no scheduling buffer beyond the remote timeout'
  grep -Fq 'AWS-RunShellScript' "$fake_aws_log" || fail 'sender did not select AWS-RunShellScript'
  grep -Fq "releases/$deploy_sha/$artifact_name" "$fake_aws_log" ||
    fail 'sender did not address the content-pinned artifact key'
fi

printf 'Immutable deployment contract checks passed.\n'
