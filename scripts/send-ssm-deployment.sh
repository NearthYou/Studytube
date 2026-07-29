#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: send-ssm-deployment.sh [options]

Uploads an immutable StudyTube release and starts AWS Systems Manager Run
Command without opening SSH or using a host address.

Required options:
  --artifact-file PATH
  --digest-file PATH
  --runner-file PATH
  --deploy-sha SHA
  --bucket NAME
  --instance-id ID
  --region REGION

Optional deployment settings:
  --config-file PATH          Default: /etc/studytube/deployment.env
  --deploy-root PATH          Default: /opt/studytube
  --retain-releases NUMBER    Default: 5
  --minimum-free-bytes BYTES  Default: 3221225472
  --object-lock-days NUMBER   Default: 30
  --timeout-seconds NUMBER    Default: 2700
  --diagnostics-dir PATH      Default: .deployment-diagnostics
  --cloudwatch-log-group NAME Also stream Run Command output to CloudWatch.
EOF
}

fail() {
  printf 'send-ssm-deployment: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail 'deploy SHA must be a lowercase full commit SHA'
}

validate_digest() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || fail 'SHA-256 digest must contain 64 lowercase hex characters'
}

validate_absolute_remote_path() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "$label must be a simple absolute path"
  [[ "$value" != '/' && "$value" != *'/../'* && "$value" != */.. && "$value" != *'//'* ]] ||
    fail "$label is too broad or contains traversal"
}

validate_positive_integer() {
  if [[ ! "$1" =~ ^[0-9]+$ ]] || ((10#$1 <= 0)); then
    fail "$2 must be a positive integer"
  fi
}

artifact_file=''
digest_file=''
runner_file=''
deploy_sha=''
bucket=''
instance_id=''
region=''
config_file='/etc/studytube/deployment.env'
deploy_root='/opt/studytube'
retain_releases='5'
minimum_free_bytes='3221225472'
object_lock_days='30'
timeout_seconds='2700'
diagnostics_dir='.deployment-diagnostics'
cloudwatch_log_group=''

while (($# > 0)); do
  case "$1" in
    --artifact-file|--digest-file|--runner-file|--deploy-sha|--bucket|--instance-id|--region|--config-file|--deploy-root|--retain-releases|--minimum-free-bytes|--object-lock-days|--timeout-seconds|--diagnostics-dir|--cloudwatch-log-group)
      (($# >= 2)) || fail "$1 requires a value"
      option_name="${1#--}"
      option_name="${option_name//-/_}"
      printf -v "$option_name" '%s' "$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

for command_name in aws jq sha256sum openssl date mktemp; do
  require_command "$command_name"
done

[[ -f "$artifact_file" && ! -L "$artifact_file" ]] || fail 'artifact file is missing or is a symlink'
[[ -f "$digest_file" && ! -L "$digest_file" ]] || fail 'digest file is missing or is a symlink'
[[ -f "$runner_file" && ! -L "$runner_file" ]] || fail 'runner file is missing or is a symlink'
validate_sha "$deploy_sha"
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail 'S3 bucket name is invalid'
[[ "$instance_id" =~ ^i-[0-9a-f]{8,17}$ ]] || fail 'SSM instance ID is invalid'
[[ "$region" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]] || fail 'AWS region is invalid'
validate_absolute_remote_path "$config_file" CONFIG_FILE
validate_absolute_remote_path "$deploy_root" DEPLOY_ROOT
validate_positive_integer "$retain_releases" RETAIN_RELEASES
validate_positive_integer "$minimum_free_bytes" MINIMUM_FREE_BYTES
validate_positive_integer "$object_lock_days" OBJECT_LOCK_DAYS
validate_positive_integer "$timeout_seconds" TIMEOUT_SECONDS
[[ "$diagnostics_dir" != '' && "$diagnostics_dir" != '/' ]] || fail 'diagnostics directory is invalid'
[[ -z "$cloudwatch_log_group" || "$cloudwatch_log_group" =~ ^[A-Za-z0-9_./#-]+$ ]] ||
  fail 'CloudWatch log group name is invalid'

artifact_sha256="$(awk 'NR == 1 { print $1 }' "$digest_file")"
validate_digest "$artifact_sha256"
actual_artifact_sha256="$(sha256sum "$artifact_file" | awk '{print $1}')"
[[ "$actual_artifact_sha256" == "$artifact_sha256" ]] ||
  fail 'artifact does not match its SHA-256 digest file'

artifact_name="$(basename -- "$artifact_file")"
expected_artifact_name="studytube-$deploy_sha.tar.gz"
[[ "$artifact_name" == "$expected_artifact_name" ]] ||
  fail "artifact must be named $expected_artifact_name"
digest_name="$artifact_name.sha256"
[[ "$(basename -- "$digest_file")" == "$digest_name" ]] ||
  fail "digest must be named $digest_name"

mkdir -p -- "$diagnostics_dir"
diagnostics_dir="$(cd -- "$diagnostics_dir" && pwd -P)"
object_lock_until="$(date -u -d "+$object_lock_days days" '+%Y-%m-%dT%H:%M:%SZ')"

put_immutable_object() {
  local source_path="$1"
  local object_key="$2"
  local content_sha256="$3"
  local object_key_hash head_path
  object_key_hash="$(printf '%s' "$object_key" | sha256sum | awk '{print $1}')"
  head_path="$diagnostics_dir/head-$object_key_hash.json"
  local head_error="$head_path.error"

  if aws s3api head-object \
    --bucket "$bucket" \
    --key "$object_key" \
    --checksum-mode ENABLED \
    --region "$region" \
    >"$head_path" 2>"$head_error"; then
    remote_sha256="$(jq -r '.Metadata.sha256 // empty' "$head_path")"
    remote_size="$(jq -r '.ContentLength // empty' "$head_path")"
    local_size="$(stat -c '%s' "$source_path")"
    [[ "$remote_sha256" == "$content_sha256" && "$remote_size" == "$local_size" ]] ||
      fail "refusing to overwrite s3://$bucket/$object_key with different content"
    return 0
  fi

  if ! grep -Eq '(404|Not Found|NoSuchKey)' "$head_error"; then
    cat "$head_error" >&2
    fail "could not determine whether s3://$bucket/$object_key already exists"
  fi

  local checksum_base64
  checksum_base64="$(openssl dgst -sha256 -binary "$source_path" | openssl base64 -A)"
  local -a put_arguments=(
    s3api put-object
    --bucket "$bucket"
    --key "$object_key"
    --body "$source_path"
    --if-none-match '*'
    --checksum-algorithm SHA256
    --checksum-sha256 "$checksum_base64"
    --metadata "sha256=$content_sha256,git-sha=$deploy_sha"
    --server-side-encryption AES256
    --object-lock-mode GOVERNANCE
    --object-lock-retain-until-date "$object_lock_until"
    --region "$region"
  )
  if ! aws "${put_arguments[@]}" >"$head_path.put" 2>"$head_error.put"; then
    if aws s3api head-object \
      --bucket "$bucket" \
      --key "$object_key" \
      --checksum-mode ENABLED \
      --region "$region" \
      >"$head_path" 2>>"$head_error.put" &&
      [[ "$(jq -r '.Metadata.sha256 // empty' "$head_path")" == "$content_sha256" ]]; then
      return 0
    fi
    cat "$head_error.put" >&2
    fail "immutable upload failed for s3://$bucket/$object_key"
  fi
}

artifact_key="releases/$deploy_sha/$artifact_name"
digest_key="releases/$deploy_sha/$digest_name"
runner_sha256="$(sha256sum "$runner_file" | awk '{print $1}')"
validate_digest "$runner_sha256"
runner_key="deploy-tools/ssm-deploy-release-$runner_sha256.sh"
digest_sha256="$(sha256sum "$digest_file" | awk '{print $1}')"

put_immutable_object "$artifact_file" "$artifact_key" "$artifact_sha256"
put_immutable_object "$digest_file" "$digest_key" "$digest_sha256"
put_immutable_object "$runner_file" "$runner_key" "$runner_sha256"

artifact_uri="s3://$bucket/$artifact_key"
runner_uri="s3://$bucket/$runner_key"
installed_runner="$deploy_root/deploy-tools/ssm-deploy-release.sh"
runner_parent="$(dirname -- "$installed_runner")"

remote_command="$({
  printf '%s\n' 'set -eu' 'umask 077'
  printf "install -d -o root -g root -m 0755 '%s'\n" "$runner_parent"
  printf "runner_tmp=\$(mktemp '%s/.ssm-deploy.XXXXXX')\n" "$runner_parent"
  printf "aws s3 cp '%s' \"\$runner_tmp\" --only-show-errors --region '%s'\n" "$runner_uri" "$region"
  printf "printf '%%s  %%s\\n' '%s' \"\$runner_tmp\" | sha256sum -c -\n" "$runner_sha256"
  printf "install -o root -g root -m 0755 \"\$runner_tmp\" '%s'\n" "$installed_runner"
  # shellcheck disable=SC2016
  printf '%s\n' 'rm -f -- "$runner_tmp"'
  printf "'%s' deploy --artifact-uri '%s' --artifact-sha256 '%s' --deploy-sha '%s' --region '%s' --config-file '%s' --deploy-root '%s' --retain-releases '%s' --minimum-free-bytes '%s'\n" \
    "$installed_runner" \
    "$artifact_uri" \
    "$artifact_sha256" \
    "$deploy_sha" \
    "$region" \
    "$config_file" \
    "$deploy_root" \
    "$retain_releases" \
    "$minimum_free_bytes"
} )"

parameters_json="$(jq -cn \
  --arg command "$remote_command" \
  --arg timeout "$timeout_seconds" \
  '{commands: [$command], executionTimeout: [$timeout]}')"
run_label="${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
output_prefix="ssm-output/$deploy_sha/$run_label"

send_command_path="$diagnostics_dir/send-command.json"
send_error_path="$diagnostics_dir/send-command.stderr"
declare -a send_arguments=(
  ssm send-command
  --document-name AWS-RunShellScript
  --instance-ids "$instance_id"
  --parameters "$parameters_json"
  --timeout-seconds "$timeout_seconds"
  --comment "StudyTube immutable release $deploy_sha"
  --output-s3-bucket-name "$bucket"
  --output-s3-key-prefix "$output_prefix"
  --region "$region"
)
if [[ -n "$cloudwatch_log_group" ]]; then
  send_arguments+=(
    --cloud-watch-output-config
    "CloudWatchOutputEnabled=true,CloudWatchLogGroupName=$cloudwatch_log_group"
  )
fi

aws "${send_arguments[@]}" >"$send_command_path" 2>"$send_error_path" || {
  cat "$send_error_path" >&2
  fail 'SSM SendCommand request failed'
}
command_id="$(jq -r '.Command.CommandId // empty' "$send_command_path")"
[[ "$command_id" =~ ^[0-9a-f-]{36}$ ]] || fail 'SSM did not return a valid command ID'
printf 'ssm_command_id=%s\n' "$command_id"

invocation_path="$diagnostics_dir/command-invocation.json"
invocation_error_path="$diagnostics_dir/command-invocation.stderr"
wait_exit=0
command_status='Pending'
deadline=$((SECONDS + timeout_seconds))
while ((SECONDS < deadline)); do
  if aws ssm get-command-invocation \
    --command-id "$command_id" \
    --instance-id "$instance_id" \
    --region "$region" \
    >"$invocation_path.tmp" 2>"$invocation_error_path"; then
    mv -f -- "$invocation_path.tmp" "$invocation_path"
    command_status="$(jq -r '.Status // "Unknown"' "$invocation_path")"
    case "$command_status" in
      Pending|InProgress|Delayed) ;;
      *) break ;;
    esac
  fi
  sleep 10
done
if [[ "$command_status" == 'Pending' || "$command_status" == 'InProgress' || "$command_status" == 'Delayed' ]]; then
  wait_exit=1
  printf 'Timed out waiting for SSM command %s while status=%s\n' \
    "$command_id" "$command_status" >"$diagnostics_dir/wait.stderr"
fi

aws s3 sync \
  "s3://$bucket/$output_prefix" \
  "$diagnostics_dir/ssm-output" \
  --only-show-errors \
  --region "$region" || true

command_status="$(jq -r '.Status // "Unknown"' "$invocation_path" 2>/dev/null || printf 'Unknown')"
jq -r '.StandardOutputContent // empty' "$invocation_path" 2>/dev/null || true
if [[ "$command_status" != 'Success' || "$wait_exit" -ne 0 ]]; then
  jq -r '.StandardErrorContent // empty' "$invocation_path" >&2 2>/dev/null || true
  fail "SSM deployment did not succeed; status=$command_status command_id=$command_id"
fi

printf 'deployed_sha=%s\nartifact_uri=%s\nartifact_sha256=%s\n' \
  "$deploy_sha" "$artifact_uri" "$artifact_sha256"
