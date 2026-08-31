#!/usr/bin/env bash
set -euo pipefail

load_operator_config() {
  local config_file="${STUDYTUBE_CONFIG_FILE:-/etc/studytube/deployment.env}"
  [ -e "$config_file" ] || return 0
  if [ -L "$config_file" ] || [ ! -f "$config_file" ]; then
    echo 'RESET_CONFIG_FILE_UNSAFE' >&2
    exit 2
  fi
  if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ]; then
    [ "$(stat -c '%u' "$config_file")" = '0' ] || {
      echo 'RESET_CONFIG_OWNER_INVALID' >&2
      exit 2
    }
    [ -z "$(find "$config_file" -maxdepth 0 -perm /022 -print)" ] || {
      echo 'RESET_CONFIG_MODE_INVALID' >&2
      exit 2
    }
  fi
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
}

load_operator_config

state_root="${USER_DATA_RESET_STATE_DIR:-/var/lib/studytube/user-data-reset}"
aws_region="${AWS_REGION:-}"
run_id=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-id) run_id="${2:-}"; shift 2 ;;
    *) echo 'RESET_PURGE_ARGUMENT_INVALID' >&2; exit 2 ;;
  esac
done

if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ] &&
   [ "$(id -u)" -ne 0 ]; then
  echo 'RESET_PURGE_ROOT_REQUIRED' >&2
  exit 2
fi
if [[ ! "$run_id" =~ ^reset-[0-9]{8}T[0-9]{6}Z$ ]] || [ -z "$aws_region" ]; then
  echo 'RESET_PURGE_IDENTITY_INVALID' >&2
  exit 2
fi

run_directory="$state_root/$run_id"
proof_path="$run_directory/verified-backup.json"
purged_path="$run_directory/backup-purged.json"
if [ ! -f "$proof_path" ] || [ -e "$purged_path" ]; then
  echo 'RESET_PURGE_PROOF_INVALID' >&2
  exit 2
fi
if [ -L "$proof_path" ] || [ ! -f "$proof_path" ]; then
  echo 'RESET_PURGE_PROOF_UNSAFE' >&2
  exit 2
fi
if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ]; then
  [ "$(stat -c '%u' "$proof_path")" = '0' ] || {
    echo 'RESET_PURGE_PROOF_OWNER_INVALID' >&2
    exit 2
  }
  [ -z "$(find "$proof_path" -maxdepth 0 -perm /077 -print)" ] || {
    echo 'RESET_PURGE_PROOF_MODE_INVALID' >&2
    exit 2
  }
fi

if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" = 'true' ]; then
  now="${USER_DATA_RESET_NOW:-$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')}"
else
  now="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
fi
mapfile -t proof_fields < <(node - "$proof_path" "$run_id" "$now" <<'NODE'
const fs = require('node:fs');
const [path, expectedRunId, now] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(path, 'utf8'));
if (proof.schemaVersion !== 'studytube.user-data-reset-backup.v1' ||
    proof.runId !== expectedRunId || proof.restoreVerified !== true) {
  throw new Error('RESET_PURGE_PROOF_INVALID');
}
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(proof.s3Bucket) ||
    !/^[A-Za-z0-9._/-]+$/.test(proof.s3ObjectKey)) {
  throw new Error('RESET_PURGE_OBJECT_INVALID');
}
if (!proof.s3ObjectKey.endsWith(`/${expectedRunId}/postgres.dump`) ||
    !/^[0-9a-f]{64}$/.test(proof.manifestSha256) ||
    !/^[0-9a-f]{64}$/.test(proof.planSha256) ||
    !/^[0-9a-f]{64}$/.test(proof.dumpSha256)) {
  throw new Error('RESET_PURGE_OBJECT_INVALID');
}
const createdAt = Date.parse(proof.createdAt);
const deleteAfter = Date.parse(proof.deleteAfter);
const current = Date.parse(now);
if (!Number.isFinite(createdAt) || !Number.isFinite(deleteAfter) ||
    deleteAfter - createdAt !== 7 * 24 * 60 * 60 * 1000 ||
    !Number.isFinite(current) || current < deleteAfter) {
  throw new Error('RESET_PURGE_TOO_EARLY');
}
console.log(proof.s3Bucket);
console.log(proof.s3ObjectKey);
console.log(proof.deleteAfter);
NODE
)

bucket="${proof_fields[0]:-}"
object_key="${proof_fields[1]:-}"
delete_after="${proof_fields[2]:-}"
if [ -z "$bucket" ] || [ -z "$object_key" ] || [ -z "$delete_after" ]; then
  echo 'RESET_PURGE_PROOF_INVALID' >&2
  exit 2
fi

versions_file="$(mktemp "$run_directory/.versions.XXXXXX")"
head_error="$(mktemp "$run_directory/.head-error.XXXXXX")"
trap 'rm -f -- "$versions_file" "$head_error"' EXIT
aws s3api list-object-versions --bucket "$bucket" --prefix "$object_key" \
  --region "$aws_region" --output json >"$versions_file"

mapfile -t versions < <(node - "$versions_file" "$object_key" <<'NODE'
const fs = require('node:fs');
const [path, exactKey] = process.argv.slice(2);
const listing = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const item of [...(listing.Versions || []), ...(listing.DeleteMarkers || [])]) {
  if (item.Key === exactKey && typeof item.VersionId === 'string') {
    console.log(item.VersionId);
  }
}
NODE
)

if [ "${#versions[@]}" -gt 0 ]; then
  for version_id in "${versions[@]}"; do
    aws s3api delete-object --bucket "$bucket" --key "$object_key" \
      --version-id "$version_id" --region "$aws_region" >/dev/null
  done
else
  if aws s3api head-object --bucket "$bucket" --key "$object_key" \
    --region "$aws_region" >/dev/null 2>"$head_error"; then
    aws s3api delete-object --bucket "$bucket" --key "$object_key" \
      --region "$aws_region" >/dev/null
  elif ! grep -Eqi '404|Not Found|NoSuchKey' "$head_error"; then
    echo 'RESET_PURGE_OBJECT_CHECK_FAILED' >&2
    exit 1
  fi
fi

aws s3api list-object-versions --bucket "$bucket" --prefix "$object_key" \
  --region "$aws_region" --output json >"$versions_file"
node - "$versions_file" "$object_key" <<'NODE'
const fs = require('node:fs');
const [path, exactKey] = process.argv.slice(2);
const listing = JSON.parse(fs.readFileSync(path, 'utf8'));
const remaining = [...(listing.Versions || []), ...(listing.DeleteMarkers || [])]
  .filter((item) => item.Key === exactKey);
if (remaining.length !== 0) throw new Error('RESET_PURGE_VERSIONS_REMAIN');
NODE
if aws s3api head-object --bucket "$bucket" --key "$object_key" \
  --region "$aws_region" >/dev/null 2>"$head_error"; then
  echo 'RESET_PURGE_OBJECT_REMAINS' >&2
  exit 1
elif ! grep -Eqi '404|Not Found|NoSuchKey' "$head_error"; then
  echo 'RESET_PURGE_OBJECT_CHECK_FAILED' >&2
  exit 1
fi

purged_at="$now"
temporary_proof="$run_directory/.backup-purged.json.tmp"
node - "$temporary_proof" "$run_id" "$object_key" "$delete_after" "$purged_at" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [path, runId, objectKey, deleteAfter, purgedAt] = process.argv.slice(2);
fs.writeFileSync(path, `${JSON.stringify({
  schemaVersion: 'studytube.user-data-reset-purge.v1',
  runId,
  objectKeySha256: crypto.createHash('sha256').update(objectKey).digest('hex'),
  deleteAfter,
  purgedAt,
  versionsRemaining: 0,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
chmod 0600 "$temporary_proof"
mv -- "$temporary_proof" "$purged_path"

printf '{"status":"purged","runId":"%s","versionsRemaining":0}\n' "$run_id"
