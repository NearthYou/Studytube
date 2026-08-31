#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
purge_script="$repo_root/scripts/user-data-reset-purge-backup.sh"
temporary_dir="$(mktemp -d)"
trap 'rm -rf -- "$temporary_dir"' EXIT

[[ -f "$purge_script" ]] || {
  echo 'backup purge script is missing' >&2
  exit 1
}

fake_bin="$temporary_dir/bin"
state_dir="$temporary_dir/state"
run_id='reset-20260831T160000Z'
run_directory="$state_dir/$run_id"
proof="$run_directory/verified-backup.json"
command_log="$temporary_dir/commands.log"
list_counter="$temporary_dir/list-counter"
mkdir -p -- "$fake_bin" "$run_directory"
: >"$command_log"
printf '0' >"$list_counter"

cat >"$proof" <<'JSON'
{"schemaVersion":"studytube.user-data-reset-backup.v1","runId":"reset-20260831T160000Z","databaseName":"app","manifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","planSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","dumpSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","s3Bucket":"studytube-private-backup","s3ObjectKey":"user-data-reset/reset-20260831T160000Z/postgres.dump","s3VersionId":"version-1","createdAt":"2026-08-31T16:00:00.000Z","deleteAfter":"2026-09-07T16:00:00.000Z","restoreVerified":true}
JSON

cat >"$fake_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'aws <%s>\n' "$*" >>"$RESET_COMMAND_LOG"
if [[ "$*" == *list-object-versions* ]]; then
  count="$(cat "$RESET_LIST_COUNTER")"
  if [ "$count" = '0' ]; then
    printf '1' >"$RESET_LIST_COUNTER"
    cat <<'JSON'
{"Versions":[{"Key":"user-data-reset/reset-20260831T160000Z/postgres.dump","VersionId":"version-1"},{"Key":"user-data-reset/another-run/postgres.dump","VersionId":"do-not-delete"}],"DeleteMarkers":[{"Key":"user-data-reset/reset-20260831T160000Z/postgres.dump","VersionId":"marker-1"}]}
JSON
  else
    printf '{"Versions":[],"DeleteMarkers":[]}'
  fi
  exit 0
fi
if [[ "$*" == *head-object* ]]; then
  echo 'An error occurred (404) when calling the HeadObject operation: Not Found' >&2
  exit 44
fi
exit 0
EOF

cat >"$fake_bin/stat" <<'EOF'
#!/usr/bin/env bash
printf '0\n'
EOF

cat >"$fake_bin/find" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"$fake_bin/id" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = '-u' ]; then printf '0\n'; fi
EOF
chmod +x "$fake_bin"/*

common_environment=(
  "PATH=$fake_bin:$PATH"
  "RESET_COMMAND_LOG=$command_log"
  "RESET_LIST_COUNTER=$list_counter"
  'USER_DATA_RESET_ALLOW_NON_ROOT_TEST=true'
  "USER_DATA_RESET_STATE_DIR=$state_dir"
  'AWS_REGION=ap-northeast-2'
)

safe_config="$temporary_dir/deployment.env"
: >"$safe_config"
set +e
env "${common_environment[@]}" \
  USER_DATA_RESET_ALLOW_NON_ROOT_TEST=false \
  STUDYTUBE_CONFIG_FILE="$safe_config" \
  bash "$purge_script" --run-id invalid \
  >"$temporary_dir/config.stdout" 2>"$temporary_dir/config.stderr"
config_status=$?
set -e
[[ "$config_status" -ne 0 ]] || {
  echo 'invalid purge identity unexpectedly succeeded' >&2
  exit 1
}
grep -Fq 'RESET_PURGE_IDENTITY_INVALID' "$temporary_dir/config.stderr"

set +e
env "${common_environment[@]}" USER_DATA_RESET_NOW='2026-09-07T15:59:59.000Z' \
  bash "$purge_script" --run-id "$run_id" \
  >"$temporary_dir/early.stdout" 2>"$temporary_dir/early.stderr"
early_status=$?
set -e
[[ "$early_status" -ne 0 ]] || {
  echo 'backup was purged before deleteAfter' >&2
  exit 1
}
if grep -Fq 'delete-object' "$command_log"; then
  echo 'early purge issued delete-object' >&2
  exit 1
fi

bad_run_id='reset-20260831T161000Z'
bad_run_directory="$state_dir/$bad_run_id"
mkdir -p -- "$bad_run_directory"
sed \
  -e "s/$run_id/$bad_run_id/g" \
  -e 's#user-data-reset/reset-20260831T161000Z/postgres.dump#user-data-reset/another-run/postgres.dump#' \
  "$proof" >"$bad_run_directory/verified-backup.json"
set +e
env "${common_environment[@]}" USER_DATA_RESET_NOW='2026-09-07T16:10:00.000Z' \
  bash "$purge_script" --run-id "$bad_run_id" \
  >"$temporary_dir/bad-key.stdout" 2>"$temporary_dir/bad-key.stderr"
bad_key_status=$?
set -e
[[ "$bad_key_status" -ne 0 ]] || {
  echo 'purge accepted a backup key outside its exact run' >&2
  exit 1
}

: >"$command_log"
printf '0' >"$list_counter"
env "${common_environment[@]}" USER_DATA_RESET_NOW='2026-09-07T16:00:00.000Z' \
  bash "$purge_script" --run-id "$run_id" >"$temporary_dir/purged.json"

grep -Fq -- '--key user-data-reset/reset-20260831T160000Z/postgres.dump --version-id version-1' "$command_log"
grep -Fq -- '--key user-data-reset/reset-20260831T160000Z/postgres.dump --version-id marker-1' "$command_log"
if grep -Fq 'do-not-delete' "$command_log"; then
  echo 'purge touched another backup' >&2
  exit 1
fi
[[ -f "$run_directory/backup-purged.json" ]] || {
  echo 'purge evidence is missing' >&2
  exit 1
}

echo 'User data reset backup purge contract checks passed.'
