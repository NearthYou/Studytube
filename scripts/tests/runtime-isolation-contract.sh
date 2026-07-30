#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'runtime isolation contract: %s\n' "$1" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
installer="$repo_root/scripts/install-production-runtime.sh"

[[ -f "$installer" ]] || fail "missing runtime installer: $installer"
bash -n "$installer"

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-runtime-isolation.XXXXXX")"
cleanup() {
  wait || true
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

fake_bin="$temporary_dir/fake-bin"
command_log="$temporary_dir/commands.log"
release_source="$temporary_dir/release/source"
mkdir -p -- "$fake_bin"
mkdir -p -- "$release_source/web" "$release_source/api" "$release_source/ai"
: >"$command_log"
mkdir -p -- "$release_source/infra/systemd"
cp -- "$repo_root"/infra/systemd/*.service.in "$release_source/infra/systemd/"
printf '{}\n' >"$release_source/web/package.json"
printf '{}\n' >"$release_source/api/package.json"
printf '# locked fixture\n' >"$release_source/ai/requirements.txt"
printf 'api/.env\nai/.env\n' >"$release_source/.gitignore"
printf 'LEGACY_API_SECRET=api-file-secret-canary\n' >"$release_source/api/.env"
printf 'LEGACY_AI_SECRET=ai-file-secret-canary\n' >"$release_source/ai/.env"
git -C "$release_source" init --quiet
git -C "$release_source" config core.autocrlf false
git -C "$release_source" config user.email runtime-contract@studytube.test
git -C "$release_source" config user.name 'Runtime Contract'
git -C "$release_source" add .
git -C "$release_source" commit --quiet -m fixture

cat >"$fake_bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo' >>"$COMMAND_LOG"
printf ' <%s>' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"

if [[ -n "${FAKE_SUDO_FAIL_ONCE_PATTERN:-}" &&
      " $* " == *"$FAKE_SUDO_FAIL_ONCE_PATTERN"* &&
      ! -e "${FAKE_SUDO_FAIL_MARKER:-}" ]]; then
  : >"$FAKE_SUDO_FAIL_MARKER"
  exit "${FAKE_SUDO_FAIL_STATUS:-71}"
fi

if [[ "${1:-}" == 'systemctl' ]]; then
  shift
  exec systemctl "$@"
fi

if [[ "${FAKE_SUDO_SIMULATE_TRANSIENT_ACTIVE:-}" == 'true' && "${1:-}" == 'env' ]]; then
  for argument in "$@"; do
    if [[ "$argument" == --unit=* ]]; then
      printf '%s\n' "${argument#--unit=}" >"$FAKE_TRANSIENT_ACTIVE_MARKER"
      exit "${FAKE_SYSTEMD_RUN_STATUS:-72}"
    fi
  done
fi

if [[ "${FAKE_SUDO_EXECUTE_INSTALL:-}" == 'true' && "${1:-}" == 'install' ]]; then
  shift
  filtered=()
  while (($# > 0)); do
    case "$1" in
      -o|-g)
        shift 2
        ;;
      *)
        filtered+=("$1")
        shift
        ;;
    esac
  done
  target="${filtered[${#filtered[@]} - 1]}"
  if [[ "$target" == "$FAKE_SAFE_ROOT" || "$target" == "$FAKE_SAFE_ROOT"/* ]]; then
    PATH=/usr/bin:/bin command install "${filtered[@]}"
  fi
fi
EOF

cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-} ${2:-}" == 'compose version' ]]
EOF

cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${COMMAND_LOG:-}" ]]; then
  printf 'systemctl' >>"$COMMAND_LOG"
  printf ' <%s>' "$@" >>"$COMMAND_LOG"
  printf '\n' >>"$COMMAND_LOG"
fi
if [[ "${1:-}" == 'show' ]]; then
  requested_unit="${2:-}"
  active_state=false
  if [[ -n "${FAKE_TRANSIENT_ACTIVE_MARKER:-}" && -f "$FAKE_TRANSIENT_ACTIVE_MARKER" &&
        "$(<"$FAKE_TRANSIENT_ACTIVE_MARKER")" == "$requested_unit" ]]; then
    active_state=true
  elif [[ "$requested_unit" == "${FAKE_ACTIVE_TRANSIENT_UNIT:-}" ]]; then
    active_state=true
  fi
  if [[ " $* " == *' --property=LoadState '* ]]; then
    if [[ "$active_state" == true ]]; then
      printf 'loaded\n'
    else
      printf 'not-found\n'
    fi
  elif [[ "$active_state" == true ]]; then
    printf 'active\n'
  else
    printf 'inactive\n'
  fi
  exit 0
fi
if [[ "${1:-}" == 'is-active' ]]; then
  requested_unit="${*: -1}"
  if [[ -n "${FAKE_TRANSIENT_ACTIVE_MARKER:-}" && -f "$FAKE_TRANSIENT_ACTIVE_MARKER" ]]; then
    [[ "$(<"$FAKE_TRANSIENT_ACTIVE_MARKER")" == "$requested_unit" ]]
    exit
  fi
  [[ "$requested_unit" == "${FAKE_ACTIVE_TRANSIENT_UNIT:-}" ]]
  exit
fi
if [[ "${1:-}" == 'stop' && -n "${FAKE_TRANSIENT_ACTIVE_MARKER:-}" ]]; then
  rm -f -- "$FAKE_TRANSIENT_ACTIVE_MARKER"
fi
exit 0
EOF

cat >"$fake_bin/systemd-run" <<'EOF'
#!/usr/bin/env bash
exit "${FAKE_SYSTEMD_RUN_STATUS:-0}"
EOF

cat >"$fake_bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

for fake_command in npm python3 node; do
  cat >"$fake_bin/$fake_command" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
done

cat >"$fake_bin/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
target="${*: -1}"
if [[ -n "${FAKE_ROOT_STATE_DIR:-}" &&
      ( "$target" == "$FAKE_ROOT_STATE_DIR" || "$target" == "$FAKE_ROOT_STATE_DIR"/* ) ]]; then
  case "$*" in
    *"%u"*) printf '0\n'; exit 0 ;;
    *"%a"*) printf '600\n'; exit 0 ;;
  esac
fi
exec /usr/bin/stat "$@"
EOF

cat >"$fake_bin/getent" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-} ${2:-}" in
  'group studytube-build') printf 'studytube-build:x:991:\n' ;;
  'passwd studytube-build') printf 'studytube-build:x:991:991::/var/lib/studytube-build:/usr/sbin/nologin\n' ;;
  *) exit 2 ;;
esac
EOF

chmod 0755 \
  "$fake_bin/sudo" \
  "$fake_bin/docker" \
  "$fake_bin/systemctl" \
  "$fake_bin/systemd-run" \
  "$fake_bin/flock" \
  "$fake_bin/npm" \
  "$fake_bin/python3" \
  "$fake_bin/node" \
  "$fake_bin/stat" \
  "$fake_bin/getent"

secret_canary='runtime-isolation-secret-canary'
set +e
COMMAND_LOG="$command_log" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=legacy \
  bash "$installer" prepare-release >"$temporary_dir/nested-dotenv.stdout" 2>"$temporary_dir/nested-dotenv.stderr"
nested_dotenv_status=$?
set -e

[[ "$nested_dotenv_status" != '0' ]] ||
  fail 'dependency preparation accepted a nested legacy dotenv'
grep -Fq 'legacy nested dotenv must be removed before release preparation' "$temporary_dir/nested-dotenv.stderr" ||
  fail 'dependency preparation did not explain the nested dotenv rejection'
if grep -Eq '<systemd-run>|<chown> <-R> <studytube-build:studytube-build>' "$command_log"; then
  fail 'dependency preparation crossed the build boundary before rejecting a nested dotenv'
fi
rm -f -- "$release_source/api/.env" "$release_source/ai/.env"
: >"$command_log"

set +e
COMMAND_LOG="$command_log" \
FAKE_SUDO_FAIL_ONCE_PATTERN="$release_source/api" \
FAKE_SUDO_FAIL_MARKER="$temporary_dir/sudo-failed-once" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=legacy \
  bash "$installer" prepare-release >/dev/null 2>"$temporary_dir/delegation-failure.stderr"
delegation_failure_status=$?
set -e

if [[ "$delegation_failure_status" != '71' ]]; then
  sed 's/^/installer stderr: /' "$temporary_dir/delegation-failure.stderr" >&2
  fail "controlled build-tree delegation did not fail as expected: $delegation_failure_status"
fi
failed_delegation_restore_count="$(
  { grep -F '<chown> <-R>' "$command_log" |
    grep -Fv '<studytube-build:studytube-build>' || true; } |
    wc -l |
    tr -d '[:space:]'
)"
[[ "$failed_delegation_restore_count" == '3' ]] ||
  fail 'build-tree ownership was not restored after partial delegation failure'
: >"$command_log"

set +e
COMMAND_LOG="$command_log" \
FAKE_SUDO_SIMULATE_TRANSIENT_ACTIVE=true \
FAKE_SYSTEMD_RUN_STATUS=72 \
FAKE_TRANSIENT_ACTIVE_MARKER="$temporary_dir/active-transient-unit" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=legacy \
  bash "$installer" prepare-release >/dev/null 2>"$temporary_dir/transient-failure.stderr"
transient_failure_status=$?
set -e

[[ "$transient_failure_status" == '72' ]] ||
  fail "controlled transient build did not preserve its failure status: $transient_failure_status"
[[ ! -e "$temporary_dir/active-transient-unit" ]] ||
  fail 'failed transient build remained active after installer cleanup'
grep -Fq '<kill> <--kill-whom=all> <--signal=KILL> <studytube-release-web-dependencies.service>' "$command_log" ||
  fail 'failed transient build was not killed before ownership restoration'
grep -Fq '<stop> <studytube-release-web-dependencies.service>' "$command_log" ||
  fail 'failed transient build was not stopped before deployment returned'
: >"$command_log"

printf 'studytube-release-web-dependencies.service\n' >"$temporary_dir/active-transient-unit"
set +e
COMMAND_LOG="$command_log" \
FAKE_TRANSIENT_ACTIVE_MARKER="$temporary_dir/active-transient-unit" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=legacy \
  bash "$installer" prepare-release >/dev/null 2>"$temporary_dir/orphaned-transient.stderr"
orphaned_transient_status=$?
set -e

[[ "$orphaned_transient_status" != '0' ]] ||
  fail 'dependency preparation overlapped an orphaned transient build'
grep -Fq 'refusing to overlap active release transient unit' "$temporary_dir/orphaned-transient.stderr" ||
  fail 'dependency preparation did not explain the orphaned transient rejection'
if grep -Fq '<systemd-run>' "$command_log"; then
  fail 'dependency preparation launched work while a fixed transient unit was active'
fi
rm -f -- "$temporary_dir/active-transient-unit"
: >"$command_log"

COMMAND_LOG="$command_log" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=legacy \
DATABASE_URL="postgresql://$secret_canary@db.invalid/studytube" \
OPENAI_API_KEY="$secret_canary" \
AWS_SECRET_ACCESS_KEY="$secret_canary" \
  bash "$installer" prepare-release >/dev/null

grep -Fq '<systemd-run>' "$command_log" ||
  fail 'dependency preparation did not run in an isolated transient unit'
grep -Fq '<--uid=studytube-build>' "$command_log" ||
  fail 'dependency preparation did not use the dedicated build principal'
for build_unit in \
  studytube-release-web-dependencies.service \
  studytube-release-api-dependencies.service \
  studytube-release-web-build.service \
  studytube-release-api-build.service \
  studytube-release-web-prune.service \
  studytube-release-api-prune.service \
  studytube-release-ai-venv.service \
  studytube-release-ai-dependencies.service; do
  grep -Fq "<--unit=$build_unit>" "$command_log" ||
    fail "dependency preparation did not use stable transient unit $build_unit"
done
for offline_unit in \
  studytube-release-web-build.service \
  studytube-release-api-build.service \
  studytube-release-web-prune.service \
  studytube-release-api-prune.service \
  studytube-release-ai-venv.service; do
  grep -F "<--unit=$offline_unit>" "$command_log" |
    grep -Fq '<--property=PrivateNetwork=yes>' ||
    fail "executable build phase retained host and data-service network access: $offline_unit"
done
runtime_limit_count="$(grep -Fc '<--property=RuntimeMaxSec=20min>' "$command_log")"
[[ "$runtime_limit_count" == '8' ]] ||
  fail "expected every build phase to have a runtime limit, observed $runtime_limit_count"
grep -Fq '<--property=IPAddressDeny=169.254.169.254/32>' "$command_log" ||
  fail 'dependency preparation did not block the IPv4 instance metadata endpoint'
grep -Fq '<--property=IPAddressDeny=fd00:ec2::254/128>' "$command_log" ||
  fail 'dependency preparation did not block the IPv6 instance metadata endpoint'
grep -Fq '<--property=IPAddressDeny=127.0.0.1/32>' "$command_log" ||
  fail 'dependency preparation could reach host loopback data services'
grep -Fq '<--property=IPAddressDeny=::1/128>' "$command_log" ||
  fail 'dependency preparation could reach IPv6 host loopback data services'
grep -Fq '<AWS_EC2_METADATA_DISABLED=true>' "$command_log" ||
  fail 'dependency preparation did not disable AWS SDK metadata lookup'
[[ "$(grep -Fc "<chown> <-R> <studytube-build:studytube-build>" "$command_log")" == '3' ]] ||
  fail 'release build directories were not delegated to the build principal'
[[ "$(grep -Fc '<chmod> <-R> <a+rX,go-w>' "$command_log")" == '3' ]] ||
  fail 'prepared runtime artifacts were not made read-only and traversable'
restore_count="$(
  awk '
    index($0, "<chown> <-R>") &&
      !index($0, "<studytube-build:studytube-build>") { count++ }
    END { print count + 0 }
  ' "$command_log"
)"
[[ "$restore_count" == '3' ]] ||
  fail 'release build directories were not returned to their trusted owner'

if grep -Fq "$secret_canary" "$command_log"; then
  fail 'dependency preparation propagated a production secret into the build boundary'
fi

npm_install_count="$(grep -Ec '<npm>|/npm>.*<ci>' "$command_log" || true)"
[[ "$npm_install_count" == '2' ]] ||
  fail "expected two npm install commands, observed $npm_install_count"
if grep -E '<npm>|/npm>.*<ci>' "$command_log" | grep -Fv '<--ignore-scripts>' >/dev/null; then
  fail 'an npm install command allowed dependency lifecycle scripts'
fi

npm_build_count="$(grep -Ec '<npm>|/npm>.*<run> <build>' "$command_log" || true)"
[[ "$npm_build_count" == '2' ]] ||
  fail "expected two explicit npm build commands, observed $npm_build_count"
if grep -E '<npm>|/npm>.*<run> <build>' "$command_log" | grep -Fv '<--ignore-scripts>' >/dev/null; then
  fail 'an explicit npm build allowed pre/post lifecycle scripts'
fi

npm_prune_count="$(grep -Ec '<npm>|/npm>.*<prune>' "$command_log" || true)"
[[ "$npm_prune_count" == '2' ]] ||
  fail "expected two production dependency prune commands, observed $npm_prune_count"
if grep -E '<npm>|/npm>.*<prune>' "$command_log" |
  grep -Fv '<--omit=dev>' >/dev/null; then
  fail 'a prepared runtime retained development dependencies'
fi
if grep -E '<npm>|/npm>.*<prune>' "$command_log" |
  grep -Fv '<--ignore-scripts>' >/dev/null; then
  fail 'an npm prune command allowed dependency lifecycle scripts'
fi

grep -Fq '<--require-hashes>' "$command_log" ||
  fail 'Python dependencies were not constrained by the hashed lock file'
grep -Fq '<--only-binary=:all:>' "$command_log" ||
  fail 'Python dependency installation allowed executable source builds'

printf 'Runtime dependency isolation contract checks passed.\n'

controlled_installer_sha='0123456789abcdef0123456789abcdef01234567'
controlled_installer_state="$temporary_dir/installer/deployment-state"
controlled_installer_control="$controlled_installer_state/$controlled_installer_sha-watchdog-control.lock"
controlled_installer_trip="$controlled_installer_state/$controlled_installer_sha-watchdog-tripped"
controlled_installer_cancel="$controlled_installer_state/$controlled_installer_sha-watchdog-cancelled"
controlled_installer_armed="$controlled_installer_state/$controlled_installer_sha-watchdog-armed"
mkdir -p -- "$controlled_installer_state"
: >"$controlled_installer_control"
: >"$controlled_installer_trip"
printf '%s\n' \
  'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' \
  "DEPLOY_SHA=$controlled_installer_sha" \
  'WATCHDOG_PID=4242' >"$controlled_installer_armed"
: >"$command_log"
set +e
COMMAND_LOG="$command_log" \
FAKE_ROOT_STATE_DIR="$controlled_installer_state" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=legacy \
STUDYTUBE_WATCHDOG_CONTROL_PATH="$controlled_installer_control" \
STUDYTUBE_WATCHDOG_TRIP_PATH="$controlled_installer_trip" \
STUDYTUBE_WATCHDOG_CANCEL_PATH="$controlled_installer_cancel" \
STUDYTUBE_WATCHDOG_ARMED_PATH="$controlled_installer_armed" \
STUDYTUBE_DEPLOYMENT_OWNER_SHA="$controlled_installer_sha" \
  bash "$installer" prepare-release >/dev/null 2>"$temporary_dir/tripped-installer.stderr"
tripped_installer_status=$?
set -e
[[ "$tripped_installer_status" != '0' ]] ||
  fail 'a tripped deployment watchdog allowed a new transient mutation'
grep -Fq 'deployment watchdog has tripped; refusing a new release mutation' \
  "$temporary_dir/tripped-installer.stderr" ||
  fail 'a tripped deployment watchdog was not reported at the mutation boundary'
if grep -Fq '<systemd-run>' "$command_log"; then
  fail 'a transient unit started after durable deployment cancellation'
fi

printf 'Deployment cancellation boundary checks passed.\n'

deploy_fixture="$temporary_dir/deploy-fixture"
deploy_command_log="$temporary_dir/deploy-commands.log"
mkdir -p -- \
  "$deploy_fixture/scripts" \
  "$deploy_fixture/web/dist" \
  "$deploy_fixture/api" \
  "$deploy_fixture/ai/.venv/bin" \
  "$deploy_fixture/infra"
printf '<!doctype html>\n' >"$deploy_fixture/web/dist/index.html"
printf 'name: fixture\n' >"$deploy_fixture/infra/production.compose.yml"
cat >"$deploy_fixture/ai/.venv/bin/python" <<'EOF'
#!/usr/bin/env bash
printf 'legacy-pip <%s>\n' "$*" >>"$DEPLOY_COMMAND_LOG"
EOF
cat >"$deploy_fixture/scripts/install-production-runtime.sh" <<'EOF'
#!/usr/bin/env bash
printf 'installer <%s>\n' "$*" >>"$DEPLOY_COMMAND_LOG"
exit 42
EOF
chmod 0755 \
  "$deploy_fixture/ai/.venv/bin/python" \
  "$deploy_fixture/scripts/install-production-runtime.sh"

controlled_deploy_sha='0123456789abcdef0123456789abcdef01234567'
deploy_state_dir="$temporary_dir/deployment-state"
watchdog_lease_path="$deploy_state_dir/$controlled_deploy_sha-watchdog.lease"
owner_proof_path="$deploy_state_dir/$controlled_deploy_sha-owner-proof.lock"
watchdog_control_path="$deploy_state_dir/$controlled_deploy_sha-watchdog-control.lock"
watchdog_armed_path="$deploy_state_dir/$controlled_deploy_sha-watchdog-armed"
schema_barrier_path="$deploy_state_dir/$controlled_deploy_sha-schema-barrier"
cutover_started_path="$deploy_state_dir/$controlled_deploy_sha-cutover-started"
mkdir -p -- "$deploy_state_dir" "$temporary_dir/deploy-tools"
printf '#!/usr/bin/env bash\nexit 0\n' \
  >"$temporary_dir/deploy-tools/ssm-deploy-release.sh"
chmod 0755 "$temporary_dir/deploy-tools/ssm-deploy-release.sh"
: >"$watchdog_lease_path"
: >"$owner_proof_path"
: >"$watchdog_control_path"
printf '%s\n' \
  'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' \
  "DEPLOY_SHA=$controlled_deploy_sha" \
  'WATCHDOG_PID=4242' >"$watchdog_armed_path"

deploy_harness="$(cat <<EOF
git() {
  printf 'git <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  case "\$*" in
    *'rev-parse origin/'*) printf '%s\\n' "\$DEPLOY_SHA" ;;
    *'status --porcelain'*) : ;;
    *'rev-parse --short HEAD'*) printf '%s\\n' "\${DEPLOY_SHA:0:7}" ;;
  esac
  return 0
}
timeout() {
  while [[ "\${1:-}" == --* ]]; do shift; done
  shift
  "\$@"
}
flock() {
  case "\${*: -1}" in
    197|198) return 1 ;;
    *) return 0 ;;
  esac
}
readlink() {
  case "\${*: -1}" in
    /proc/*/fd/200) printf '%s\\n' "\$STUDYTUBE_WATCHDOG_LEASE_PATH" ;;
    /proc/*/fd/201) printf '%s\\n' "\$STUDYTUBE_OWNER_PROOF_PATH" ;;
    *) printf '%s\\n' "\${*: -1}" ;;
  esac
}
stat() {
  case "\$*" in
    *'%u:%g'*) printf '0:0\\n' ;;
    *'%u'*) printf '0\\n' ;;
    *'%a'*) printf '600\\n' ;;
    *) command stat "\$@" ;;
  esac
}
install() { printf 'install <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
sync() { return 0; }
getent() {
  case "\${1:-} \${2:-}" in
    'group studytube-api-socket') printf 'studytube-api-socket:x:992:\n' ;;
    *) return 2 ;;
  esac
}
docker() { printf 'docker <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
psql() {
  case "\$*" in
    *to_regclass*) printf 'pgmigrations\\n' ;;
    *) printf 't\\n' ;;
  esac
}
sudo() {
  printf 'sudo <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  if [[ "\${1:-} \${2:-}" == 'swapon --show' ]]; then
    printf '/swapfile\\n'
  fi
  if [[ "\$*" == *'systemctl show'*'--property=MainPID --value'* ]]; then
    printf '4242\\n'
  fi
  return 0
}
npm() { printf 'legacy-npm <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
python3() { printf 'legacy-python <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
exec 200<>"\$STUDYTUBE_WATCHDOG_LEASE_PATH"
exec 201<>"\$STUDYTUBE_OWNER_PROOF_PATH"
source '$repo_root/scripts/deploy-ec2.sh' release
EOF
)"

set +e
DEPLOY_COMMAND_LOG="$deploy_command_log" \
APP_DIR="$deploy_fixture" \
COURSE_CUTOVER_MODE=legacy \
DATABASE_URL='postgresql://app:database-password@db.invalid/studytube' \
POSTGRES_USER=app \
POSTGRES_PASSWORD='postgres-password-111111111111111111111111' \
POSTGRES_DB=studytube \
INTERNAL_AI_API_KEY='internal-ai-key-111111111111111111111111' \
MCP_SERVICE_ASSERTION_SECRET='mcp-secret-1111111111111111111111111111' \
AUTH_VERIFICATION_PEPPER='verification-key-11111111111111111111111' \
AUTH_RATE_LIMIT_PEPPER='rate-limit-key-111111111111111111111111' \
AUTH_EMAIL_PROVIDER=ses \
AUTH_EMAIL_SENDER='no-reply@studytube.test' \
AUTH_EMAIL_AWS_REGION=ap-northeast-2 \
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE=instance-role \
STUDYTUBE_SITE_ADDRESS=studytube.test \
STUDYTUBE_PUBLIC_URL=https://studytube.test \
WEB_ORIGIN=https://studytube.test \
DEPLOY_SHA="$controlled_deploy_sha" \
STUDYTUBE_DEPLOYMENT_OWNER_SHA="$controlled_deploy_sha" \
STUDYTUBE_SCHEMA_BARRIER_PATH="$schema_barrier_path" \
STUDYTUBE_CUTOVER_STARTED_PATH="$cutover_started_path" \
STUDYTUBE_WATCHDOG_LEASE_PATH="$watchdog_lease_path" \
STUDYTUBE_OWNER_PROOF_PATH="$owner_proof_path" \
STUDYTUBE_WATCHDOG_CONTROL_PATH="$watchdog_control_path" \
STUDYTUBE_WATCHDOG_TRIP_PATH="$deploy_state_dir/$controlled_deploy_sha-watchdog-tripped" \
STUDYTUBE_WATCHDOG_CANCEL_PATH="$deploy_state_dir/$controlled_deploy_sha-watchdog-cancelled" \
STUDYTUBE_WATCHDOG_ARMED_PATH="$watchdog_armed_path" \
  bash -c "$deploy_harness" >"$temporary_dir/deploy-prepare.stdout" \
    2>"$temporary_dir/deploy-prepare.stderr"
deploy_status=$?
set -e

[[ "$deploy_status" == '42' ]] ||
  {
    sed 's/^/deploy stderr: /' "$temporary_dir/deploy-prepare.stderr" >&2
    fail "controlled deploy did not stop at the preparation boundary: $deploy_status"
  }
grep -Fxq 'installer <prepare-release>' "$deploy_command_log" ||
  fail 'deploy did not enter the isolated dependency preparation boundary'
if grep -Eq '^legacy-(npm|pip|python) ' "$deploy_command_log"; then
  fail 'deploy executed a legacy dependency command before the isolated boundary'
fi

printf 'Deploy dependency boundary contract checks passed.\n'

cat >"$deploy_fixture/scripts/install-production-runtime.sh" <<'EOF'
#!/usr/bin/env bash
printf 'installer <%s>\n' "$*" >>"$DEPLOY_COMMAND_LOG"
case "${1:-install-runtime}" in
  prepare-release|install-runtime) exit 0 ;;
  run-migration) exit 43 ;;
  *) exit 44 ;;
esac
EOF
chmod 0755 "$deploy_fixture/scripts/install-production-runtime.sh"
: >"$deploy_command_log"

deploy_harness="$(cat <<EOF
git() {
  printf 'git <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  case "\$*" in
    *'rev-parse origin/'*) printf '%s\\n' "\$DEPLOY_SHA" ;;
    *'status --porcelain'*) : ;;
    *'rev-parse --short HEAD'*) printf '%s\\n' "\${DEPLOY_SHA:0:7}" ;;
  esac
  return 0
}
timeout() {
  while [[ "\${1:-}" == --* ]]; do shift; done
  shift
  "\$@"
}
flock() {
  case "\${*: -1}" in
    197|198) return 1 ;;
    *) return 0 ;;
  esac
}
readlink() {
  case "\${*: -1}" in
    /proc/*/fd/200) printf '%s\\n' "\$STUDYTUBE_WATCHDOG_LEASE_PATH" ;;
    /proc/*/fd/201) printf '%s\\n' "\$STUDYTUBE_OWNER_PROOF_PATH" ;;
    *) printf '%s\\n' "\${*: -1}" ;;
  esac
}
stat() {
  case "\$*" in
    *'%u:%g'*) printf '0:0\\n' ;;
    *'%u'*) printf '0\\n' ;;
    *'%a'*) printf '600\\n' ;;
    *) command stat "\$@" ;;
  esac
}
install() { printf 'install <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
sync() { return 0; }
getent() {
  case "\${1:-} \${2:-}" in
    'group studytube-api-socket') printf 'studytube-api-socket:x:992:\n' ;;
    *) return 2 ;;
  esac
}
docker() { printf 'docker <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
psql() {
  case "\$*" in
    *to_regclass*) printf 'pgmigrations\\n' ;;
    *) printf 't\\n' ;;
  esac
}
sudo() {
  printf 'sudo <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  if [[ "\${1:-} \${2:-}" == 'swapon --show' ]]; then
    printf '/swapfile\\n'
  fi
  if [[ "\$*" == *'systemctl show'*'--property=MainPID --value'* ]]; then
    printf '4242\\n'
  fi
  return 0
}
npm() {
  printf 'legacy-npm <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  if [[ "\$*" == *'db:migrate:up'* ]]; then
    return 43
  fi
  return 0
}
pkill() { return 0; }
sleep() { return 0; }
exec 200<>"\$STUDYTUBE_WATCHDOG_LEASE_PATH"
exec 201<>"\$STUDYTUBE_OWNER_PROOF_PATH"
source '$repo_root/scripts/deploy-ec2.sh' release
EOF
)"

set +e
DEPLOY_COMMAND_LOG="$deploy_command_log" \
APP_DIR="$deploy_fixture" \
COURSE_CUTOVER_MODE=legacy \
DATABASE_URL='postgresql://app:database-password@db.invalid/studytube' \
POSTGRES_USER=app \
POSTGRES_PASSWORD='postgres-password-111111111111111111111111' \
POSTGRES_DB=studytube \
INTERNAL_AI_API_KEY='internal-ai-key-111111111111111111111111' \
MCP_SERVICE_ASSERTION_SECRET='mcp-secret-1111111111111111111111111111' \
AUTH_VERIFICATION_PEPPER='verification-key-11111111111111111111111' \
AUTH_RATE_LIMIT_PEPPER='rate-limit-key-111111111111111111111111' \
AUTH_EMAIL_PROVIDER=ses \
AUTH_EMAIL_SENDER='no-reply@studytube.test' \
AUTH_EMAIL_AWS_REGION=ap-northeast-2 \
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE=instance-role \
STUDYTUBE_SITE_ADDRESS=studytube.test \
STUDYTUBE_PUBLIC_URL=https://studytube.test \
WEB_ORIGIN=https://studytube.test \
DEPLOY_SHA="$controlled_deploy_sha" \
STUDYTUBE_DEPLOYMENT_OWNER_SHA="$controlled_deploy_sha" \
STUDYTUBE_SCHEMA_BARRIER_PATH="$schema_barrier_path" \
STUDYTUBE_CUTOVER_STARTED_PATH="$cutover_started_path" \
STUDYTUBE_WATCHDOG_LEASE_PATH="$watchdog_lease_path" \
STUDYTUBE_OWNER_PROOF_PATH="$owner_proof_path" \
STUDYTUBE_WATCHDOG_CONTROL_PATH="$watchdog_control_path" \
STUDYTUBE_WATCHDOG_TRIP_PATH="$deploy_state_dir/$controlled_deploy_sha-watchdog-tripped" \
STUDYTUBE_WATCHDOG_CANCEL_PATH="$deploy_state_dir/$controlled_deploy_sha-watchdog-cancelled" \
STUDYTUBE_WATCHDOG_ARMED_PATH="$watchdog_armed_path" \
  bash -c "$deploy_harness" >/dev/null 2>&1
deploy_status=$?
set -e

[[ "$deploy_status" == '43' ]] ||
  fail "controlled deploy did not stop at the migration boundary: $deploy_status"
grep -Fxq 'installer <run-migration>' "$deploy_command_log" ||
  fail 'deploy did not enter the isolated database migration boundary'
if grep -Fq 'legacy-npm <--prefix api run db:migrate:up>' "$deploy_command_log"; then
  fail 'deploy executed database migration in the root deployment process'
fi

printf 'Deploy migration boundary contract checks passed.\n'

cat >"$deploy_fixture/scripts/install-production-runtime.sh" <<'EOF'
#!/usr/bin/env bash
printf 'installer <%s>\n' "$*" >>"$DEPLOY_COMMAND_LOG"
case "${1:-install-runtime}" in
  prepare-release|install-runtime|run-migration) exit 0 ;;
  run-course-backfill) exit 44 ;;
  *) exit 45 ;;
esac
EOF
chmod 0755 "$deploy_fixture/scripts/install-production-runtime.sh"
: >"$deploy_command_log"
controlled_deploy_sha='0123456789abcdef0123456789abcdef01234567'
deploy_state_dir="$temporary_dir/deployment-state"
watchdog_lease_path="$deploy_state_dir/$controlled_deploy_sha-watchdog.lease"
owner_proof_path="$deploy_state_dir/$controlled_deploy_sha-owner-proof.lock"
watchdog_control_path="$deploy_state_dir/$controlled_deploy_sha-watchdog-control.lock"
watchdog_armed_path="$deploy_state_dir/$controlled_deploy_sha-watchdog-armed"
schema_barrier_path="$deploy_state_dir/$controlled_deploy_sha-schema-barrier"
mkdir -p -- "$deploy_state_dir"
: >"$watchdog_lease_path"
: >"$owner_proof_path"
: >"$watchdog_control_path"
printf '%s\n' \
  'STUDYTUBE_WATCHDOG_ARMED_FORMAT=1' \
  "DEPLOY_SHA=$controlled_deploy_sha" \
  'WATCHDOG_PID=4242' >"$watchdog_armed_path"

deploy_harness="$(cat <<EOF
git() {
  printf 'git <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  case "\$*" in
    *'rev-parse origin/'*) printf '%s\\n' "\$DEPLOY_SHA" ;;
    *'status --porcelain'*) : ;;
    *'rev-parse --short HEAD'*) printf '%s\\n' "\${DEPLOY_SHA:0:7}" ;;
  esac
  return 0
}
timeout() {
  while [[ "\${1:-}" == --* ]]; do shift; done
  shift
  "\$@"
}
flock() {
  case "\${*: -1}" in
    197|198) return 1 ;;
    *) return 0 ;;
  esac
}
readlink() {
  case "\${*: -1}" in
    /proc/*/fd/200) printf '%s\n' "\$STUDYTUBE_WATCHDOG_LEASE_PATH" ;;
    /proc/*/fd/201) printf '%s\n' "\$STUDYTUBE_OWNER_PROOF_PATH" ;;
    *) printf '%s\n' "\${*: -1}" ;;
  esac
}
stat() {
  case "\$*" in
    *'%u:%g'*) printf '0:0\n' ;;
    *'%u'*) printf '0\n' ;;
    *'%a'*) printf '600\n' ;;
    *) command stat "\$@" ;;
  esac
}
install() { printf 'install <%s>\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
sync() { return 0; }
getent() {
  case "\${1:-} \${2:-}" in
    'group studytube-api-socket') printf 'studytube-api-socket:x:992:\n' ;;
    *) return 2 ;;
  esac
}
docker() {
  printf 'docker <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  if [[ "\$*" == *'valkey-cli ping'* ]]; then printf 'PONG\\n'; fi
  return 0
}
psql() {
  case "\$*" in
    *to_regclass*) printf 'pgmigrations\\n' ;;
    *) printf 't\\n' ;;
  esac
}
sudo() {
  printf 'sudo <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  if [[ "\${1:-} \${2:-}" == 'swapon --show' ]]; then printf '/swapfile\\n'; fi
  if [[ "\$*" == *'systemctl show'*'--property=MainPID --value'* ]]; then printf '4242\\n'; fi
  return 0
}
npm() {
  printf 'legacy-npm <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"
  if [[ "\$*" == *'db:course:backfill'* ]]; then return 44; fi
  return 0
}
pkill() { return 0; }
sleep() { return 0; }
curl() { printf '{}\\n'; return 0; }
exec 200<>"\$STUDYTUBE_WATCHDOG_LEASE_PATH"
exec 201<>"\$STUDYTUBE_OWNER_PROOF_PATH"
source '$repo_root/scripts/deploy-ec2.sh' release
EOF
)"

set +e
DEPLOY_COMMAND_LOG="$deploy_command_log" \
APP_DIR="$deploy_fixture" \
COURSE_CUTOVER_MODE=freeze \
DATABASE_URL='postgresql://app:database-password@db.invalid/studytube' \
POSTGRES_USER=app \
POSTGRES_PASSWORD='postgres-password-111111111111111111111111' \
POSTGRES_DB=studytube \
INTERNAL_AI_API_KEY='internal-ai-key-111111111111111111111111' \
MCP_SERVICE_ASSERTION_SECRET='mcp-secret-1111111111111111111111111111' \
AUTH_VERIFICATION_PEPPER='verification-key-11111111111111111111111' \
AUTH_RATE_LIMIT_PEPPER='rate-limit-key-111111111111111111111111' \
AUTH_EMAIL_PROVIDER=ses \
AUTH_EMAIL_SENDER='no-reply@studytube.test' \
AUTH_EMAIL_AWS_REGION=ap-northeast-2 \
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE=instance-role \
STUDYTUBE_SITE_ADDRESS=studytube.test \
STUDYTUBE_PUBLIC_URL=https://studytube.test \
WEB_ORIGIN=https://studytube.test \
DEPLOY_SHA="$controlled_deploy_sha" \
STUDYTUBE_DEPLOYMENT_OWNER_SHA="$controlled_deploy_sha" \
STUDYTUBE_SCHEMA_BARRIER_PATH="$schema_barrier_path" \
STUDYTUBE_CUTOVER_STARTED_PATH="$cutover_started_path" \
STUDYTUBE_WATCHDOG_LEASE_PATH="$watchdog_lease_path" \
STUDYTUBE_OWNER_PROOF_PATH="$owner_proof_path" \
STUDYTUBE_WATCHDOG_CONTROL_PATH="$watchdog_control_path" \
STUDYTUBE_WATCHDOG_TRIP_PATH="$deploy_state_dir/$controlled_deploy_sha-watchdog-tripped" \
STUDYTUBE_WATCHDOG_CANCEL_PATH="$deploy_state_dir/$controlled_deploy_sha-watchdog-cancelled" \
STUDYTUBE_WATCHDOG_ARMED_PATH="$watchdog_armed_path" \
  bash -c "$deploy_harness" >/dev/null 2>&1
deploy_status=$?
set -e

[[ "$deploy_status" == '44' ]] ||
  fail "controlled deploy did not stop at the Course backfill boundary: $deploy_status"
grep -Fxq 'installer <run-course-backfill>' "$deploy_command_log" ||
  fail 'deploy did not enter the isolated Course backfill boundary'
if grep -Fq 'legacy-npm <--prefix api run db:course:backfill>' "$deploy_command_log"; then
  fail 'deploy executed Course backfill in the root deployment process'
fi

printf 'Deploy Course boundary contract checks passed.\n'

runtime_root="$temporary_dir/runtime-root"
runtime_config_dir="$runtime_root/etc/studytube/runtime"
systemd_unit_dir="$runtime_root/etc/systemd/system"
web_release_root="$runtime_root/var/www/studytube"
mkdir -p -- "$runtime_root"
: >"$command_log"

COMMAND_LOG="$command_log" \
FAKE_SUDO_EXECUTE_INSTALL=true \
FAKE_SAFE_ROOT="$runtime_root" \
PATH="$fake_bin:$PATH" \
APP_DIR="$release_source" \
APP_USER=fixture-app \
APP_GROUP=fixture-app \
COURSE_CUTOVER_MODE=course \
RUNTIME_CONFIG_DIR="$runtime_config_dir" \
SYSTEMD_UNIT_DIR="$systemd_unit_dir" \
WEB_RELEASE_ROOT="$web_release_root" \
DATABASE_URL='postgresql://runtime-db-secret@db.invalid/studytube' \
DB_QUERY_TIMEOUT_MS=1250 \
VALKEY_URL='redis://127.0.0.1:6379' \
WEB_ORIGIN='https://studytube.test' \
AI_SERVICE_URL='http://127.0.0.1:8000' \
INTERNAL_AI_API_KEY='internal-ai-secret-canary' \
MCP_SERVICE_ASSERTION_SECRET='mcp-assertion-secret-canary' \
AUTH_VERIFICATION_PEPPER='verification-secret-canary' \
AUTH_RATE_LIMIT_PEPPER='rate-limit-secret-canary' \
AUTH_EMAIL_PROVIDER=ses \
AUTH_EMAIL_SENDER='no-reply@studytube.test' \
AUTH_EMAIL_AWS_REGION=ap-northeast-2 \
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE=instance-role \
OTEL_SERVICE_NAME=studytube-contract \
OTEL_SDK_DISABLED=false \
OTEL_TRACES_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces \
OTEL_EXPORTER_OTLP_HEADERS='authorization=test-canary' \
OTEL_EXPORTER_OTLP_TRACES_HEADERS='trace-authorization=test-canary' \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf \
OTEL_EXPORTER_OTLP_TIMEOUT=10000 \
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT=9000 \
OTEL_EXPORTER_OTLP_CERTIFICATE=/etc/studytube/otel/ca.pem \
OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE=/etc/studytube/otel/traces-ca.pem \
OTEL_EXPORTER_OTLP_CLIENT_KEY=/etc/studytube/otel/client.key \
OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY=/etc/studytube/otel/traces-client.key \
OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE=/etc/studytube/otel/client.pem \
OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE=/etc/studytube/otel/traces-client.pem \
OTEL_RESOURCE_ATTRIBUTES='password=forbidden-resource-canary' \
OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST='.*' \
OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE='.*' \
OPENAI_API_KEY='openai-secret-canary' \
LLM_MODEL=gpt-4o-mini \
EMBEDDING_MODEL=text-embedding-3-small \
YOUTUBE_API_KEY='youtube-secret-canary' \
POSTGRES_PASSWORD='postgres-container-only-secret-canary' \
AWS_SECRET_ACCESS_KEY='host-role-secret-canary' \
  bash "$installer" install-runtime >/dev/null

for service_name in api ai worker; do
  [[ -f "$runtime_config_dir/$service_name.env" ]] ||
    fail "runtime installer did not create $service_name.env"
  grep -F "<-m> <0640>" "$command_log" |
    grep -Fq "<$runtime_config_dir/$service_name.env>" ||
      fail "$service_name.env was not installed with mode 0640"
  [[ -f "$systemd_unit_dir/studytube-$service_name.service" ]] ||
    fail "runtime installer did not install the $service_name unit"
done
[[ -f "$systemd_unit_dir/studytube-caddy.service" ]] ||
  fail 'runtime installer did not install the recovery-gated Caddy unit'
grep -Fxq 'ExecStart=/usr/bin/docker start --attach studytube-caddy' \
  "$systemd_unit_dir/studytube-caddy.service" ||
  fail 'Caddy is not started through its systemd owner'
[[ -f "$systemd_unit_dir/studytube-caddy.service.d/90-studytube-deployment-guard.conf" ]] ||
  fail 'Caddy is not gated by interrupted-deployment recovery'

assert_environment_keys() {
  local environment_file="$1"
  local expected_keys="$2"
  local actual_file="$temporary_dir/actual-keys"
  local expected_file="$temporary_dir/expected-keys"
  cut -d= -f1 "$environment_file" | sort >"$actual_file"
  printf '%s\n' "$expected_keys" | sed '/^$/d' | sort >"$expected_file"
  if ! diff -u "$expected_file" "$actual_file"; then
    fail "unexpected key set in $(basename -- "$environment_file")"
  fi
}

assert_environment_keys "$runtime_config_dir/api.env" 'AI_SERVICE_URL
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE
AUTH_EMAIL_AWS_REGION
AUTH_EMAIL_PROVIDER
AUTH_EMAIL_SENDER
AUTH_RATE_LIMIT_PEPPER
AUTH_VERIFICATION_PEPPER
DATABASE_URL
DB_QUERY_TIMEOUT_MS
INTERNAL_AI_API_KEY
MCP_SERVICE_ASSERTION_SECRET
OTEL_EXPORTER_OTLP_CERTIFICATE
OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE
OTEL_EXPORTER_OTLP_CLIENT_KEY
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS
OTEL_EXPORTER_OTLP_PROTOCOL
OTEL_EXPORTER_OTLP_TIMEOUT
OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE
OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE
OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
OTEL_EXPORTER_OTLP_TRACES_HEADERS
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
OTEL_SDK_DISABLED
OTEL_SERVICE_NAME
OTEL_TRACES_EXPORTER
VALKEY_URL
WEB_ORIGIN'

assert_environment_keys "$runtime_config_dir/ai.env" 'DATABASE_URL
EMBEDDING_MODEL
INTERNAL_AI_API_KEY
LLM_MODEL
MCP_SERVICE_ASSERTION_SECRET
OPENAI_API_KEY
OTEL_EXPORTER_OTLP_CERTIFICATE
OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE
OTEL_EXPORTER_OTLP_CLIENT_KEY
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS
OTEL_EXPORTER_OTLP_PROTOCOL
OTEL_EXPORTER_OTLP_TIMEOUT
OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE
OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE
OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
OTEL_EXPORTER_OTLP_TRACES_HEADERS
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
OTEL_SDK_DISABLED
OTEL_SERVICE_NAME
OTEL_TRACES_EXPORTER
YOUTUBE_API_KEY'

assert_environment_keys "$runtime_config_dir/worker.env" 'AI_SERVICE_URL
AUTH_EMAIL_AWS_CREDENTIAL_SOURCE
AUTH_EMAIL_AWS_REGION
AUTH_EMAIL_PROVIDER
AUTH_EMAIL_SENDER
AUTH_RATE_LIMIT_PEPPER
AUTH_VERIFICATION_PEPPER
DATABASE_URL
DB_QUERY_TIMEOUT_MS
INTERNAL_AI_API_KEY
OTEL_EXPORTER_OTLP_CERTIFICATE
OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE
OTEL_EXPORTER_OTLP_CLIENT_KEY
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS
OTEL_EXPORTER_OTLP_PROTOCOL
OTEL_EXPORTER_OTLP_TIMEOUT
OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE
OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE
OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
OTEL_EXPORTER_OTLP_TRACES_HEADERS
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
OTEL_SDK_DISABLED
OTEL_SERVICE_NAME
OTEL_TRACES_EXPORTER
VALKEY_URL
WEB_ORIGIN'

for environment_file in "$runtime_config_dir"/*.env; do
  if grep -Eq '^(AWS_SECRET_ACCESS_KEY|POSTGRES_PASSWORD)=' "$environment_file"; then
    fail "container or host credential leaked into $(basename -- "$environment_file")"
  fi
done
if grep -Eq '^(OPENAI_API_KEY|YOUTUBE_API_KEY|MCP_SERVICE_ASSERTION_SECRET)=' \
  "$runtime_config_dir/worker.env"; then
  fail 'worker inherited an AI-only or MCP assertion secret'
fi
if grep -Eq '^(AUTH_EMAIL_AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN))=' \
  "$runtime_config_dir"/*.env; then
  fail 'a runtime environment contains forbidden static AWS credentials'
fi
if grep -Eq '^(AUTH_RATE_LIMIT_PEPPER|AUTH_VERIFICATION_PEPPER|OPENAI_API_KEY|YOUTUBE_API_KEY)=' \
  "$runtime_config_dir/api.env"; then
  if grep -Eq '^(OPENAI_API_KEY|YOUTUBE_API_KEY)=' "$runtime_config_dir/api.env"; then
    fail 'API inherited an AI-provider secret'
  fi
fi
if grep -Eq '^(AUTH_RATE_LIMIT_PEPPER|AUTH_VERIFICATION_PEPPER)=' "$runtime_config_dir/ai.env"; then
  fail 'AI inherited an authentication pepper'
fi

assert_unit_identity() {
  local service_name="$1"
  local expected_user="$2"
  local unit_file="$systemd_unit_dir/studytube-$service_name.service"
  grep -Fxq "User=$expected_user" "$unit_file" ||
    fail "$service_name unit did not use $expected_user"
  [[ "$(grep -c '^EnvironmentFile=' "$unit_file")" == '1' ]] ||
    fail "$service_name unit loaded more than one environment file"
  grep -Fxq "EnvironmentFile=$runtime_config_dir/$service_name.env" "$unit_file" ||
    fail "$service_name unit did not load only its allowlisted environment"
}

assert_unit_identity api studytube-api
assert_unit_identity ai studytube-ai
assert_unit_identity worker studytube-worker

for service_name in api ai worker; do
  grep -Fxq 'After=network-online.target docker.service' \
    "$systemd_unit_dir/studytube-$service_name.service" ||
    fail "$service_name unit changed its normal runtime ordering"
  grep -Fxq 'Wants=network-online.target' \
    "$systemd_unit_dir/studytube-$service_name.service" ||
    fail "$service_name unit does not request network startup"
  if grep -Fq 'Wants=network-online.target docker.service' \
    "$systemd_unit_dir/studytube-$service_name.service"; then
    fail "$service_name unit can restart Docker during an intentional stop"
  fi
  grep -Fxq 'StartLimitIntervalSec=0' \
    "$systemd_unit_dir/studytube-$service_name.service" ||
    fail "$service_name unit can exhaust restart attempts while Docker is unavailable"
  if grep -Fxq 'Requires=docker.service' \
    "$systemd_unit_dir/studytube-$service_name.service"; then
    fail "$service_name unit is clean-stopped without recovery during Docker restart"
  fi
  if grep -Fq 'studytube-deploy-resume.service' \
    "$systemd_unit_dir/studytube-$service_name.service"; then
    fail "$service_name unit can deadlock on the long-running resume service"
  fi

  guard_dropin="$systemd_unit_dir/studytube-$service_name.service.d/90-studytube-deployment-guard.conf"
  [[ -f "$guard_dropin" ]] ||
    fail "$service_name unit did not receive the host-owned deployment guard drop-in"
  grep -Fxq 'Requires=studytube-deploy-resume-guard.service' "$guard_dropin" ||
    fail "$service_name unit does not fail closed when the boot guard fails"
  grep -Fxq 'After=studytube-deploy-resume-guard.service' "$guard_dropin" ||
    fail "$service_name unit is not ordered after the short boot guard"
  grep -Fxq 'ConditionPathExists=!/run/studytube-deploy/resume-active' "$guard_dropin" ||
    fail "$service_name unit can start while interrupted recovery is sealed"
done

grep -Fxq 'Restart=always' "$systemd_unit_dir/studytube-caddy.service" ||
  fail 'Caddy does not retry after Docker or its container exits cleanly'

grep -Fxq 'Group=studytube-api-socket' \
  "$systemd_unit_dir/studytube-api.service" ||
  fail 'API socket was not owned by the dedicated socket group'
grep -Fxq 'SupplementaryGroups=studytube-api studytube-runtime' \
  "$systemd_unit_dir/studytube-api.service" ||
  fail 'API process could not read its credentials and shared runtime state'
grep -Fxq 'SupplementaryGroups=studytube-api-socket studytube-runtime' \
  "$systemd_unit_dir/studytube-ai.service" ||
  fail 'AI process could not connect to the API Unix socket'
grep -Fxq 'CacheDirectory=studytube-ai' \
  "$systemd_unit_dir/studytube-ai.service" ||
  fail 'AI process has no systemd-managed cache for BGUtil'
grep -Fxq 'CacheDirectoryMode=0700' \
  "$systemd_unit_dir/studytube-ai.service" ||
  fail 'AI cache is not private to the AI principal'
grep -Fxq 'Environment=HOME=/var/cache/studytube-ai' \
  "$systemd_unit_dir/studytube-ai.service" ||
  fail 'AI subprocesses still inherit the non-writable passwd home'
grep -Fxq 'Environment=XDG_CACHE_HOME=/var/cache/studytube-ai' \
  "$systemd_unit_dir/studytube-ai.service" ||
  fail 'AI subprocesses do not share the managed cache root'
if grep -Eq '^(Group|SupplementaryGroups)=.*studytube-api-socket' \
  "$systemd_unit_dir/studytube-worker.service"; then
  fail 'worker unexpectedly received access to the API Unix socket'
fi
grep -Fxq 'RuntimeDirectoryMode=0750' \
  "$systemd_unit_dir/studytube-api.service" ||
  fail 'API runtime directory did not permit socket-group traversal'
grep -Fxq 'UMask=0007' "$systemd_unit_dir/studytube-api.service" ||
  fail 'API socket did not permit socket-group access'

printf 'Per-service runtime isolation contract checks passed.\n'

: >"$command_log"
for migration_command in run-migration run-course-backfill run-course-verify; do
  if ! COMMAND_LOG="$command_log" \
    PATH="$fake_bin:$PATH" \
    APP_DIR="$release_source" \
    APP_USER=fixture-app \
    APP_GROUP=fixture-app \
    COURSE_CUTOVER_MODE=course \
    RUNTIME_CONFIG_DIR="$runtime_config_dir" \
    DATABASE_URL='postgresql://migration-secret-canary@db.invalid/studytube' \
    OPENAI_API_KEY='must-not-reach-migration' \
    AUTH_VERIFICATION_PEPPER='must-not-reach-migration' \
      bash "$installer" "$migration_command" >/dev/null; then
    fail "runtime installer rejected the isolated $migration_command command"
  fi
done

grep -Fq '<systemd-run>' "$command_log" ||
  fail 'database migration did not run in an isolated transient unit'
grep -Fq '<--uid=studytube-migrate>' "$command_log" ||
  fail 'database migration did not use the dedicated migration principal'
grep -Fq '<--unit=studytube-release-migration.service>' "$command_log" ||
  fail 'database migration did not use a stable transient unit name'
grep -Fq "<--property=EnvironmentFile=$runtime_config_dir/migration.env>" "$command_log" ||
  fail 'database migration did not use only the migration environment file'
grep -Fq '<--property=IPAddressDeny=169.254.169.254/32>' "$command_log" ||
  fail 'database migration did not block the IPv4 instance metadata endpoint'
grep -Fq '<--property=IPAddressDeny=fd00:ec2::254/128>' "$command_log" ||
  fail 'database migration did not block the IPv6 instance metadata endpoint'
grep -Fq '<db:migrate:up>' "$command_log" ||
  fail 'database migration did not invoke the pinned migration entry point'
grep -Fq '<api/dist/scripts/backfill-courses.js>' "$command_log" ||
  fail 'Course backfill did not invoke the compiled runtime entry point'
grep -Fq '<api/dist/scripts/verify-course-backfill.js>' "$command_log" ||
  fail 'Course verification did not invoke the compiled runtime entry point'
for migration_unit in \
  studytube-release-migration.service \
  studytube-release-course-backfill.service \
  studytube-release-course-verify.service; do
  migration_invocation="$(grep -F "<--unit=$migration_unit>" "$command_log" || true)"
  [[ -n "$migration_invocation" ]] ||
    fail "database operation did not use stable transient unit $migration_unit"
  grep -Fq '<--property=RuntimeMaxSec=15min>' <<<"$migration_invocation" ||
    fail "$migration_unit did not have a 15 minute runtime limit"
  grep -Fq '<--property=TimeoutStopSec=30s>' <<<"$migration_invocation" ||
    fail "$migration_unit did not have a bounded stop timeout"
  grep -Fq '<--property=KillMode=control-group>' <<<"$migration_invocation" ||
    fail "$migration_unit did not terminate its complete process group"
  grep -Fq '<--property=SendSIGKILL=yes>' <<<"$migration_invocation" ||
    fail "$migration_unit could remain alive after its stop timeout"
done
if grep -Eq 'must-not-reach-migration|AUTH_VERIFICATION_PEPPER|OPENAI_API_KEY' "$command_log"; then
  fail 'database migration inherited an unrelated production secret'
fi

printf 'Migration runtime isolation contract checks passed.\n'
