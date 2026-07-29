#!/usr/bin/env bash
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

for path in \
  "$builder" \
  "$runner" \
  "$sender" \
  "$workflow" \
  "$production_compose" \
  "$runtime_isolation_contract"; do
  [[ -f "$path" ]] || fail "missing required file: $path"
done

bash -n "$builder"
bash -n "$runner"
bash -n "$sender"
bash -n "$runtime_isolation_contract"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$builder" "$runner" "$sender" "$runtime_isolation_contract" "$0"
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
grep -Fq 'Before=studytube-api.service studytube-ai.service studytube-worker.service' "$runner" ||
  fail 'resume is not ordered before application services after reboot'
for transient_unit in \
  studytube-release-web-dependencies.service \
  studytube-release-api-dependencies.service \
  studytube-release-web-build.service \
  studytube-release-api-build.service \
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
grep -Fq -- '--property=ActiveState --value' "$runner" ||
  fail 'transient cleanup does not verify the final systemd active state'
grep -Fq 'disable_legacy_pull_deployment' "$runner" || fail 'runner leaves the legacy pull deploy active'
grep -Fq 'snapshot_legacy_runtime' "$runner" || fail 'runner cannot restore the first cutover'

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-artifact-contract.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

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
  'NODE_OPTIONS=--require=/tmp/untrusted.js'; do
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

bash "$runner" verify-artifact \
  --artifact-file "$first_artifact" \
  --artifact-sha256 "$first_sha256" \
  --deploy-sha "$deploy_sha" \
  >/dev/null

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
  grep -Fq 'AWS-RunShellScript' "$fake_aws_log" || fail 'sender did not select AWS-RunShellScript'
  grep -Fq "releases/$deploy_sha/$artifact_name" "$fake_aws_log" ||
    fail 'sender did not address the content-pinned artifact key'
fi

printf 'Immutable deployment contract checks passed.\n'
