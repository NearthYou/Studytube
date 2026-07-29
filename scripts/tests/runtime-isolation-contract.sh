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
  studytube-release-ai-venv.service \
  studytube-release-ai-dependencies.service; do
  grep -Fq "<--unit=$build_unit>" "$command_log" ||
    fail "dependency preparation did not use stable transient unit $build_unit"
done
grep -Fq '<--property=IPAddressDeny=169.254.169.254/32>' "$command_log" ||
  fail 'dependency preparation did not block the IPv4 instance metadata endpoint'
grep -Fq '<--property=IPAddressDeny=fd00:ec2::254/128>' "$command_log" ||
  fail 'dependency preparation did not block the IPv6 instance metadata endpoint'
grep -Fq '<AWS_EC2_METADATA_DISABLED=true>' "$command_log" ||
  fail 'dependency preparation did not disable AWS SDK metadata lookup'
[[ "$(grep -Fc "<chown> <-R> <studytube-build:studytube-build>" "$command_log")" == '3' ]] ||
  fail 'release build directories were not delegated to the build principal'
[[ "$(grep -Fc '<chmod> <-R> <a+rX,go-w>' "$command_log")" == '3' ]] ||
  fail 'prepared runtime artifacts were not made read-only and traversable'
restore_count="$(
  grep -F '<chown> <-R>' "$command_log" |
    grep -Fv '<studytube-build:studytube-build>' |
    wc -l |
    tr -d '[:space:]'
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

grep -Fq '<--require-hashes>' "$command_log" ||
  fail 'Python dependencies were not constrained by the hashed lock file'
grep -Fq '<--only-binary=:all:>' "$command_log" ||
  fail 'Python dependency installation allowed executable source builds'

printf 'Runtime dependency isolation contract checks passed.\n'

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
flock() { return 0; }
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
  return 0
}
npm() { printf 'legacy-npm <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
python3() { printf 'legacy-python <%s>\\n' "\$*" >>"\$DEPLOY_COMMAND_LOG"; return 0; }
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
STUDYTUBE_SITE_ADDRESS=studytube.test \
STUDYTUBE_PUBLIC_URL=https://studytube.test \
WEB_ORIGIN=https://studytube.test \
DEPLOY_SHA=0123456789abcdef0123456789abcdef01234567 \
  bash -c "$deploy_harness" >/dev/null 2>&1
deploy_status=$?
set -e

[[ "$deploy_status" == '42' ]] ||
  fail "controlled deploy did not stop at the preparation boundary: $deploy_status"
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
flock() { return 0; }
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
STUDYTUBE_SITE_ADDRESS=studytube.test \
STUDYTUBE_PUBLIC_URL=https://studytube.test \
WEB_ORIGIN=https://studytube.test \
DEPLOY_SHA=0123456789abcdef0123456789abcdef01234567 \
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
flock() { return 0; }
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
STUDYTUBE_SITE_ADDRESS=studytube.test \
STUDYTUBE_PUBLIC_URL=https://studytube.test \
WEB_ORIGIN=https://studytube.test \
DEPLOY_SHA=0123456789abcdef0123456789abcdef01234567 \
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
AUTH_EMAIL_AWS_REGION
AUTH_EMAIL_PROVIDER
AUTH_EMAIL_SENDER
AUTH_RATE_LIMIT_PEPPER
AUTH_VERIFICATION_PEPPER
DATABASE_URL
INTERNAL_AI_API_KEY
MCP_SERVICE_ASSERTION_SECRET
VALKEY_URL
WEB_ORIGIN'

assert_environment_keys "$runtime_config_dir/ai.env" 'DATABASE_URL
EMBEDDING_MODEL
INTERNAL_AI_API_KEY
LLM_MODEL
MCP_SERVICE_ASSERTION_SECRET
OPENAI_API_KEY
YOUTUBE_API_KEY'

assert_environment_keys "$runtime_config_dir/worker.env" 'AI_SERVICE_URL
AUTH_EMAIL_AWS_REGION
AUTH_EMAIL_PROVIDER
AUTH_EMAIL_SENDER
AUTH_RATE_LIMIT_PEPPER
AUTH_VERIFICATION_PEPPER
DATABASE_URL
INTERNAL_AI_API_KEY
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
  grep -Fxq 'After=network-online.target docker.service studytube-deploy-resume.service' \
    "$systemd_unit_dir/studytube-$service_name.service" ||
    fail "$service_name unit was not ordered after interrupted deployment recovery"
done

grep -Fxq 'Group=studytube-api-socket' \
  "$systemd_unit_dir/studytube-api.service" ||
  fail 'API socket was not owned by the dedicated socket group'
grep -Fxq 'SupplementaryGroups=studytube-api studytube-runtime' \
  "$systemd_unit_dir/studytube-api.service" ||
  fail 'API process could not read its credentials and shared runtime state'
grep -Fxq 'SupplementaryGroups=studytube-api-socket studytube-runtime' \
  "$systemd_unit_dir/studytube-ai.service" ||
  fail 'AI process could not connect to the API Unix socket'
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
    bash "$installer" run-migration >/dev/null; then
  fail 'runtime installer rejected the isolated migration command'
fi

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
if grep -Eq 'must-not-reach-migration|AUTH_VERIFICATION_PEPPER|OPENAI_API_KEY' "$command_log"; then
  fail 'database migration inherited an unrelated production secret'
fi

printf 'Migration runtime isolation contract checks passed.\n'
