#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'npm audit CI contract: %s\n' "$1" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
runner="$repo_root/scripts/npm-audit-ci.sh"
workflow="$repo_root/.github/workflows/ci-cd.yml"

[[ -f "$runner" ]] || fail "missing audit runner: $runner"
[[ -f "$workflow" ]] || fail "missing CI workflow: $workflow"
bash -n "$runner"

[[ "$(grep -Fc 'run: bash ../scripts/npm-audit-ci.sh' "$workflow")" -eq 2 ]] ||
  fail 'Web and API jobs do not both use the bounded audit runner'
grep -Fq '../scripts/tests/npm-audit-ci-contract.sh' "$workflow" ||
  fail 'CI does not execute this retry contract'

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-npm-audit-contract.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

fake_bin="$temporary_dir/bin"
mkdir -p -- "$fake_bin"
cat >"$fake_bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ "$*" == 'audit --omit=dev --audit-level=high' ]] || {
  printf 'unexpected npm arguments: %s\n' "$*" >&2
  exit 2
}
[[ "${npm_config_fetch_timeout:-}" == '60000' ]] || {
  printf 'unexpected npm audit fetch timeout: %s\n' "${npm_config_fetch_timeout:-unset}" >&2
  exit 2
}

attempt=0
if [[ -f "$FAKE_NPM_ATTEMPT_FILE" ]]; then
  attempt="$(cat "$FAKE_NPM_ATTEMPT_FILE")"
fi
attempt=$((attempt + 1))
printf '%s' "$attempt" >"$FAKE_NPM_ATTEMPT_FILE"

case "$FAKE_NPM_MODE" in
  vulnerability)
    printf '1 high severity vulnerability\n' >&2
    exit 1
    ;;
  transient-then-success)
    if ((attempt < 3)); then
      printf 'npm error audit 503 Service Unavailable\n' >&2
      printf 'npm error audit endpoint returned an error\n' >&2
      exit 1
    fi
    printf 'found 0 vulnerabilities\n'
    ;;
  persistent-transient)
    printf 'npm error network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\n' >&2
    printf 'npm error audit endpoint returned an error\n' >&2
    exit 1
    ;;
  *)
    printf 'unknown fake npm mode\n' >&2
    exit 2
    ;;
esac
EOF
chmod 0755 "$fake_bin/npm"

run_case() {
  local mode="$1"
  local attempt_file="$temporary_dir/$mode-attempts"
  local status=0

  FAKE_NPM_MODE="$mode" \
    FAKE_NPM_ATTEMPT_FILE="$attempt_file" \
    NPM_AUDIT_RETRY_DELAY_SECONDS=0 \
    PATH="$fake_bin:$PATH" \
    bash "$runner" >/dev/null 2>&1 || status=$?

  printf '%s:%s:%s\n' "$mode" "$status" "$(cat "$attempt_file")"
}

[[ "$(run_case vulnerability)" == 'vulnerability:1:1' ]] ||
  fail 'a real vulnerability result was retried or accepted'
[[ "$(run_case transient-then-success)" == 'transient-then-success:0:3' ]] ||
  fail 'a temporary audit-service failure did not recover within the retry bound'
[[ "$(run_case persistent-transient)" == 'persistent-transient:1:3' ]] ||
  fail 'persistent audit-service failure did not fail after the retry bound'

printf 'npm audit CI contract checks passed.\n'
