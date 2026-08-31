#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backup_script="$repo_root/scripts/user-data-reset-backup.sh"
temporary_dir="$(mktemp -d)"
trap 'rm -rf -- "$temporary_dir"' EXIT

[[ -f "$backup_script" ]] || {
  echo 'backup script is missing' >&2
  exit 1
}

fake_bin="$temporary_dir/bin"
state_dir="$temporary_dir/state"
command_log="$temporary_dir/commands.log"
mkdir -p -- "$fake_bin" "$state_dir"
: >"$command_log"

cat >"$fake_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'aws <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
case "$*" in
  *get-public-access-block*) printf 'True\tTrue\tTrue\tTrue\n' ;;
  *get-bucket-encryption*) printf 'AES256\n' ;;
  *get-object-lock-configuration*)
    if [ "${FAKE_OBJECT_LOCK_YEARS:-false}" = 'true' ]; then
      printf '%s\n' '{"ObjectLockConfiguration":{"Rule":{"DefaultRetention":{"Years":1}}}}'
    else
      printf '{}\n'
    fi
    ;;
  *get-bucket-versioning*) printf 'Suspended\n' ;;
  *get-bucket-lifecycle-configuration*)
    if [ "${FAKE_LIFECYCLE_EXTRA_TAG:-false}" = 'true' ]; then
      printf '%s\n' '{"Rules":[{"Status":"Enabled","Filter":{"And":{"Tags":[{"Key":"studytube-retention","Value":"user-reset-7d"},{"Key":"missing","Value":"tag"}]}},"Expiration":{"Days":7},"NoncurrentVersionExpiration":{"NoncurrentDays":7}}]}'
    elif [ "${FAKE_NONCURRENT_MISSING:-false}" = 'true' ]; then
      printf '%s\n' '{"Rules":[{"Status":"Enabled","Filter":{"Tag":{"Key":"studytube-retention","Value":"user-reset-7d"}},"Expiration":{"Days":7}}]}'
    else
      printf '%s\n' '{"Rules":[{"Status":"Enabled","Filter":{"Tag":{"Key":"studytube-retention","Value":"user-reset-7d"}},"Expiration":{"Days":7},"NoncurrentVersionExpiration":{"NoncurrentDays":7}}]}'
    fi
    ;;
  *head-object*) printf 'AES256\n' ;;
  *put-object*) printf '"etag"\tversion-1\n' ;;
  *get-caller-identity*) printf '123456789012\n' ;;
  *) exit 0 ;;
esac
EOF

cat >"$fake_bin/mv" <<'EOF'
#!/usr/bin/env bash
if [ "${FAKE_PROOF_FINALIZE_FAILURE:-false}" = 'true' ]; then
  exit 31
fi
exec /usr/bin/mv "$@"
EOF

cat >"$fake_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
if [[ "$*" == *'pg_restore'* && "${FAKE_RESTORE_FAILURE:-false}" == 'true' ]]; then
  exit 23
fi
if [[ "$*" == *'pg_isready'* ]]; then
  printf 'accepting connections\n'
fi
if [[ "$*" == *'RESET_SNAPSHOT_V1'* ]]; then
  printf 'RESET_SNAPSHOT_V1:users=2:sessions=3\n'
fi
if [[ "${1:-}" == 'cp' ]]; then
  destination="${3:-}"
  printf 'fake-custom-format-dump' >"$destination"
fi
EOF

chmod +x "$fake_bin/aws" "$fake_bin/docker" "$fake_bin/mv"

manifest_sha="$(printf 'a%.0s' {1..64})"
plan_sha="$(printf 'b%.0s' {1..64})"
common_environment=(
  "PATH=$fake_bin:$PATH"
  "RESET_COMMAND_LOG=$command_log"
  'USER_DATA_RESET_ALLOW_NON_ROOT_TEST=true'
  "USER_DATA_RESET_STATE_DIR=$state_dir"
  'AWS_USER_RESET_BACKUP_BUCKET=studytube-private-backup'
  'AWS_REGION=ap-northeast-2'
  'POSTGRES_USER=app'
  'POSTGRES_DB=app'
  'USER_DATA_RESET_COMPOSE_FILE=infra/production.compose.yml'
  'USER_DATA_RESET_CONTAINER=studytube-postgres'
  'USER_DATA_RESET_INSTANCE_ID=i-0123456789abcdef0'
)

env "${common_environment[@]}" \
  bash "$backup_script" --plan --run-id reset-20260831T110000Z \
  >"$temporary_dir/plan.json"
grep -Fq '"mode":"plan"' "$temporary_dir/plan.json"
grep -Fq '"awsAccountId":"123456789012"' "$temporary_dir/plan.json"
grep -Fq '"instanceId":"i-0123456789abcdef0"' "$temporary_dir/plan.json"
grep -Fq '"objectKey":"user-data-reset/reset-20260831T110000Z/postgres.dump"' "$temporary_dir/plan.json"
grep -Fq '"plannedDeleteAfter":"2026-09-07T11:00:00.000Z"' "$temporary_dir/plan.json"
if grep -Fq 'docker ' "$command_log"; then
  echo 'plan mode invoked Docker' >&2
  exit 1
fi

set +e
env "${common_environment[@]}" FAKE_LIFECYCLE_EXTRA_TAG=true \
  bash "$backup_script" --plan --run-id reset-20260831T110000Z >/dev/null 2>&1
extra_tag_status=$?
env "${common_environment[@]}" FAKE_NONCURRENT_MISSING=true \
  bash "$backup_script" --plan --run-id reset-20260831T110000Z >/dev/null 2>&1
missing_noncurrent_status=$?
env "${common_environment[@]}" FAKE_OBJECT_LOCK_YEARS=true \
  bash "$backup_script" --plan --run-id reset-20260831T110000Z >/dev/null 2>&1
object_lock_status=$?
set -e
[[ "$extra_tag_status" -ne 0 && "$missing_noncurrent_status" -ne 0 &&
   "$object_lock_status" -ne 0 ]] || {
  echo 'unsafe lifecycle rule unexpectedly passed preflight' >&2
  exit 1
}
if grep -Fq 'put-object' "$command_log"; then
  echo 'plan mode uploaded data' >&2
  exit 1
fi

: >"$command_log"
set +e
env "${common_environment[@]}" FAKE_RESTORE_FAILURE=true \
  bash "$backup_script" --execute \
    --run-id reset-20260831T120000Z \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    >"$temporary_dir/failure.stdout" 2>"$temporary_dir/failure.stderr"
failure_status=$?
set -e
[[ "$failure_status" -ne 0 ]] || {
  echo 'restore failure unexpectedly succeeded' >&2
  exit 1
}
if grep -Fq 'put-object' "$command_log"; then
  echo 'restore failure uploaded an unverified backup' >&2
  exit 1
fi
[[ ! -e "$state_dir/reset-20260831T120000Z/verified-backup.json" ]] || {
  echo 'restore failure wrote verified proof' >&2
  exit 1
}

: >"$command_log"
set +e
env "${common_environment[@]}" FAKE_PROOF_FINALIZE_FAILURE=true \
  bash "$backup_script" --execute \
    --run-id reset-20260831T125000Z \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    >"$temporary_dir/proof-failure.stdout" 2>"$temporary_dir/proof-failure.stderr"
proof_failure_status=$?
set -e
[[ "$proof_failure_status" -ne 0 ]] || {
  echo 'proof finalization failure unexpectedly succeeded' >&2
  exit 1
}
grep -Fq -- 'delete-object --bucket studytube-private-backup --key user-data-reset/reset-20260831T125000Z/postgres.dump --version-id version-1' "$command_log" || {
  echo 'proof failure did not remove the uploaded object version' >&2
  exit 1
}
: >"$command_log"
env "${common_environment[@]}" \
  bash "$backup_script" --execute \
    --run-id reset-20260831T130000Z \
    --manifest-sha256 "$manifest_sha" \
    --plan-sha256 "$plan_sha" \
    >"$temporary_dir/success.json"
proof="$state_dir/reset-20260831T130000Z/verified-backup.json"
[[ -f "$proof" ]] || {
  echo 'successful restore did not write proof' >&2
  exit 1
}
grep -Fq '"restoreVerified":true' "$proof"
grep -Fq '"schemaVersion":"studytube.user-data-reset-backup.v1"' "$proof"
grep -Fq "\"planSha256\":\"$plan_sha\"" "$proof"
grep -Fq 'put-object' "$command_log"
grep -Fq -- '--server-side-encryption AES256' "$command_log"
grep -Fq 'pg_dump' "$command_log"
grep -Fq 'pg_restore' "$command_log"

node - "$proof" <<'NODE'
const fs = require('node:fs');
const proof = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const retention = Date.parse(proof.deleteAfter) - Date.parse(proof.createdAt);
if (retention !== 7 * 24 * 60 * 60 * 1000) {
  throw new Error(`unexpected retention: ${retention}`);
}
NODE

echo 'User data reset backup contract checks passed.'
