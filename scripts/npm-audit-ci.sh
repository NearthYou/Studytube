#!/usr/bin/env bash
set -Eeuo pipefail

readonly max_attempts=3
readonly osv_scanner_version='2.5.1'
readonly osv_scanner_sha256='f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be'
retry_delay_seconds="${NPM_AUDIT_RETRY_DELAY_SECONDS:-15}"
fetch_timeout_ms="${NPM_AUDIT_FETCH_TIMEOUT_MS:-60000}"
[[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || {
  printf 'NPM_AUDIT_RETRY_DELAY_SECONDS must be a non-negative integer\n' >&2
  exit 2
}
[[ "$fetch_timeout_ms" =~ ^[1-9][0-9]*$ ]] || {
  printf 'NPM_AUDIT_FETCH_TIMEOUT_MS must be a positive integer\n' >&2
  exit 2
}

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-npm-audit.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

run_osv_fallback() {
  local scanner="$temporary_dir/osv-scanner"
  local scanner_url="https://github.com/google/osv-scanner/releases/download/v$osv_scanner_version/osv-scanner_linux_amd64"

  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    --output "$scanner" "$scanner_url" || return $?
  printf '%s  %s\n' "$osv_scanner_sha256" "$scanner" |
    sha256sum --check --strict || return $?
  chmod 0700 "$scanner" || return $?
  "$scanner" scan source -r .
}

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  audit_log="$temporary_dir/attempt-$attempt.log"
  status=0
  npm_config_fetch_timeout="$fetch_timeout_ms" \
    npm audit --omit=dev --audit-level=high >"$audit_log" 2>&1 || status=$?
  cat "$audit_log"

  if ((status == 0)); then
    exit 0
  fi

  if ! grep -Eiq \
    'audit endpoint returned an error|network timeout|503 Service Unavailable|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up' \
    "$audit_log"; then
    exit "$status"
  fi

  if ((attempt == max_attempts)); then
    printf 'npm audit service remained unavailable after %s attempts; using OSV-Scanner\n' \
      "$max_attempts" >&2
    run_osv_fallback
    exit 0
  fi

  printf 'npm audit service unavailable; retrying attempt %s of %s\n' \
    "$((attempt + 1))" "$max_attempts" >&2
  if ((retry_delay_seconds > 0)); then
    sleep "$((retry_delay_seconds * attempt))"
  fi
done
