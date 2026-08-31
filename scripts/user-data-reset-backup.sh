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

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
state_root="${USER_DATA_RESET_STATE_DIR:-/var/lib/studytube/user-data-reset}"
compose_file="${USER_DATA_RESET_COMPOSE_FILE:-$repo_root/infra/production.compose.yml}"
postgres_container="${USER_DATA_RESET_CONTAINER:-studytube-postgres}"
maintenance_marker="${USER_DATA_RESET_MAINTENANCE_MARKER:-/run/studytube/user-data-reset-active}"
backup_prefix="${USER_DATA_RESET_BACKUP_PREFIX:-user-data-reset}"
mode="plan"
run_id=""
manifest_sha=""
plan_sha=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan)
      mode="plan"
      shift
      ;;
    --execute)
      mode="execute"
      shift
      ;;
    --run-id)
      run_id="${2:-}"
      shift 2
      ;;
    --manifest-sha256)
      manifest_sha="${2:-}"
      shift 2
      ;;
    --plan-sha256)
      plan_sha="${2:-}"
      shift 2
      ;;
    *)
      echo 'RESET_BACKUP_ARGUMENT_INVALID' >&2
      exit 2
      ;;
  esac
done

bucket="${AWS_USER_RESET_BACKUP_BUCKET:-}"
aws_region="${AWS_REGION:-}"
postgres_user="${POSTGRES_USER:-}"
postgres_database="${POSTGRES_DB:-}"
instance_id="${USER_DATA_RESET_INSTANCE_ID:-}"

require_value() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "$name is required" >&2
    exit 2
  fi
}

require_value AWS_USER_RESET_BACKUP_BUCKET "$bucket"
require_value AWS_REGION "$aws_region"
require_value POSTGRES_USER "$postgres_user"
require_value POSTGRES_DB "$postgres_database"
require_value USER_DATA_RESET_INSTANCE_ID "$instance_id"

if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] ||
   [[ ! "$backup_prefix" =~ ^[A-Za-z0-9._/-]+$ ]] ||
   [[ ! "$postgres_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
   [[ ! "$postgres_database" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
   [[ ! "$instance_id" =~ ^i-[0-9a-f]{8,17}$ ]]; then
  echo 'RESET_BACKUP_IDENTIFIER_INVALID' >&2
  exit 2
fi

if [ ! -f "$compose_file" ]; then
  echo 'RESET_BACKUP_COMPOSE_FILE_MISSING' >&2
  exit 2
fi

s3_preflight() {
  local public_access encryption lock_configuration versioning lifecycle
  public_access="$(aws s3api get-public-access-block \
    --bucket "$bucket" --region "$aws_region" \
    --query '[PublicAccessBlockConfiguration.BlockPublicAcls,PublicAccessBlockConfiguration.IgnorePublicAcls,PublicAccessBlockConfiguration.BlockPublicPolicy,PublicAccessBlockConfiguration.RestrictPublicBuckets]' \
    --output text)"
  if [[ "$public_access" != $'True\tTrue\tTrue\tTrue' ]]; then
    echo 'RESET_BACKUP_BUCKET_PUBLIC_ACCESS_UNSAFE' >&2
    return 1
  fi
  encryption="$(aws s3api get-bucket-encryption \
    --bucket "$bucket" --region "$aws_region" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
    --output text)"
  if [ "$encryption" != 'AES256' ] && [ "$encryption" != 'aws:kms' ]; then
    echo 'RESET_BACKUP_BUCKET_ENCRYPTION_MISSING' >&2
    return 1
  fi
  lock_configuration="$(aws s3api get-object-lock-configuration \
    --bucket "$bucket" --region "$aws_region" \
    --output json 2>/dev/null || printf '{}')"
  node - "$lock_configuration" <<'NODE'
const configuration = JSON.parse(process.argv[2]);
const retention = configuration.ObjectLockConfiguration?.Rule?.DefaultRetention;
if ((Number.isInteger(retention?.Days) && retention.Days > 7) ||
    (Number.isInteger(retention?.Years) && retention.Years > 0)) {
  throw new Error('RESET_BACKUP_RETENTION_INCOMPATIBLE');
}
NODE
  versioning="$(aws s3api get-bucket-versioning \
    --bucket "$bucket" --region "$aws_region" \
    --query 'Status' --output text)"
  case "$versioning" in
    Enabled|Suspended|None|NONE|'') ;;
    *)
      echo 'RESET_BACKUP_VERSIONING_UNKNOWN' >&2
      return 1
      ;;
  esac
  lifecycle="$(aws s3api get-bucket-lifecycle-configuration \
    --bucket "$bucket" --region "$aws_region" --output json)"
  node - "$lifecycle" "$versioning" <<'NODE'
const [raw, versioning] = process.argv.slice(2);
const configuration = JSON.parse(raw);
const rules = Array.isArray(configuration.Rules) ? configuration.Rules : [];
const matching = rules.find((rule) => {
  if (rule.Status !== 'Enabled' || rule.Expiration?.Days !== 7) return false;
  const tag = rule.Filter?.Tag;
  return tag?.Key === 'studytube-retention' && tag.Value === 'user-reset-7d';
});
if (!matching) throw new Error('RESET_BACKUP_LIFECYCLE_MISSING');
if ((versioning === 'Enabled' || versioning === 'Suspended') &&
    matching.NoncurrentVersionExpiration?.NoncurrentDays !== 7) {
  throw new Error('RESET_BACKUP_NONCURRENT_RETENTION_INVALID');
}
NODE
}

s3_preflight
account_id="$(aws sts get-caller-identity --query Account --output text)"
if [[ ! "$account_id" =~ ^[0-9]{12}$ ]]; then
  echo 'RESET_BACKUP_AWS_ACCOUNT_INVALID' >&2
  exit 2
fi

if [ "$mode" = 'plan' ]; then
  if [[ ! "$run_id" =~ ^reset-[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo 'RESET_BACKUP_PLAN_RUN_ID_REQUIRED' >&2
    exit 2
  fi
  node - "$account_id" "$instance_id" "$aws_region" "$bucket" \
    "$backup_prefix" "$run_id" <<'NODE'
const [awsAccountId, instanceId, region, bucket, prefix, runId] = process.argv.slice(2);
const match = runId.match(/^reset-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
if (!match) throw new Error('RESET_BACKUP_PLAN_RUN_ID_REQUIRED');
const [, year, month, day, hour, minute, second] = match;
const plannedCreatedAt = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`);
if (!Number.isFinite(plannedCreatedAt.getTime()) ||
    plannedCreatedAt.toISOString() !== `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`) {
  throw new Error('RESET_BACKUP_PLAN_RUN_ID_INVALID');
}
const plannedDeleteAfter = new Date(plannedCreatedAt.getTime() +
  7 * 24 * 60 * 60 * 1000).toISOString();
console.log(JSON.stringify({
  mode: 'plan',
  awsAccountId,
  instanceId,
  region,
  bucket,
  prefix,
  objectKey: `${prefix}/${runId}/postgres.dump`,
  plannedCreatedAt: plannedCreatedAt.toISOString(),
  plannedDeleteAfter,
  retentionDays: 7,
  writes: false,
}));
NODE
  exit 0
fi

if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ] &&
   [ "$(id -u)" -ne 0 ]; then
  echo 'RESET_BACKUP_ROOT_REQUIRED' >&2
  exit 2
fi
if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ] &&
   { [ -L "$maintenance_marker" ] || [ ! -f "$maintenance_marker" ]; }; then
  echo 'RESET_BACKUP_MAINTENANCE_REQUIRED' >&2
  exit 2
fi
if [ "${USER_DATA_RESET_ALLOW_NON_ROOT_TEST:-false}" != 'true' ]; then
  printf -v expected_marker 'run_id=%s\nmanifest_sha256=%s\nplan_sha256=%s' \
    "$run_id" "$manifest_sha" "$plan_sha"
  if [ "$(<"$maintenance_marker")" != "$expected_marker" ]; then
    echo 'RESET_BACKUP_MAINTENANCE_INVALID' >&2
    exit 2
  fi
fi
if [[ ! "$run_id" =~ ^reset-[0-9]{8}T[0-9]{6}Z$ ]] ||
   [[ ! "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] ||
   [[ ! "$plan_sha" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'RESET_BACKUP_IDENTITY_INVALID' >&2
  exit 2
fi

run_directory="$state_root/$run_id"
mkdir -p -- "$run_directory"
chmod 0700 "$run_directory"
proof_path="$run_directory/verified-backup.json"
if [ -e "$proof_path" ]; then
  echo 'RESET_BACKUP_PROOF_ALREADY_EXISTS' >&2
  exit 2
fi

host_dump="$(mktemp "$run_directory/.database.dump.XXXXXX")"
chmod 0600 "$host_dump"
container_dump="/tmp/$run_id.dump"
restore_database="studytube_reset_verify_$(printf '%s' "$run_id" | tr -cd '0-9A-Za-z_' | tail -c 32)"
object_key="$backup_prefix/$run_id/postgres.dump"
restore_created=false
uploaded=false
proof_written=false
version_id=""

docker_compose() {
  docker compose -f "$compose_file" "$@"
}

database_snapshot() {
  local database="$1"
  docker_compose exec -T postgres \
    psql -X -v ON_ERROR_STOP=1 -U "$postgres_user" -d "$database" \
      --no-psqlrc --tuples-only --no-align --command "
        CREATE OR REPLACE FUNCTION pg_temp.studytube_reset_snapshot()
        RETURNS text LANGUAGE plpgsql AS \$snapshot\$
        DECLARE
          table_name text;
          row_count bigint;
          snapshot text := '';
          invalid_fks bigint;
        BEGIN
          FOR table_name IN
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' ORDER BY tablename
          LOOP
            IF table_name !~ '^[a-z_]+$' THEN
              RAISE EXCEPTION 'unsafe table name';
            END IF;
            EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
            snapshot := snapshot || table_name || '=' || row_count || ';';
          END LOOP;
          SELECT count(*) INTO invalid_fks
          FROM pg_constraint AS constraint_row
          JOIN pg_namespace AS namespace
            ON namespace.oid = constraint_row.connamespace
          WHERE namespace.nspname = 'public'
            AND constraint_row.contype = 'f'
            AND NOT constraint_row.convalidated;
          RETURN snapshot || 'invalid_fks=' || invalid_fks;
        END
        \$snapshot\$;
        SELECT 'RESET_SNAPSHOT_V1:' || pg_temp.studytube_reset_snapshot();"
}

cleanup() {
  local status="$?"
  set +e
  if [ "$restore_created" = 'true' ]; then
    docker_compose exec -T postgres \
      dropdb -U "$postgres_user" --if-exists "$restore_database" >/dev/null 2>&1
  fi
  docker_compose exec -T postgres rm -f "$container_dump" >/dev/null 2>&1
  rm -f -- "$host_dump"
  if [ "$uploaded" = 'true' ] && [ "$proof_written" != 'true' ]; then
    if [ -n "$version_id" ]; then
      aws s3api delete-object --bucket "$bucket" --key "$object_key" \
        --version-id "$version_id" --region "$aws_region" >/dev/null 2>&1
    else
      aws s3api delete-object --bucket "$bucket" --key "$object_key" \
        --region "$aws_region" >/dev/null 2>&1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

ready="$(docker_compose exec -T postgres \
  pg_isready -U "$postgres_user" -d "$postgres_database")"
if [[ "$ready" != *'accepting connections'* ]]; then
  echo 'RESET_BACKUP_DATABASE_UNAVAILABLE' >&2
  exit 1
fi

source_snapshot="$(database_snapshot "$postgres_database")"
docker_compose exec -T postgres \
  pg_dump -U "$postgres_user" -d "$postgres_database" \
    --format=custom --no-owner --no-privileges --serializable-deferrable \
    --file "$container_dump"
docker_compose exec -T postgres \
  createdb -U "$postgres_user" --template=template0 "$restore_database"
restore_created=true
docker_compose exec -T postgres \
  pg_restore -U "$postgres_user" --dbname "$restore_database" \
    --exit-on-error --no-owner --no-privileges "$container_dump"
restored_snapshot="$(database_snapshot "$restore_database")"
if [ "$source_snapshot" != "$restored_snapshot" ]; then
  echo 'RESET_BACKUP_RESTORE_MISMATCH' >&2
  exit 1
fi

docker cp "$postgres_container:$container_dump" "$host_dump"
dump_sha="$(sha256sum "$host_dump" | awk '{print $1}')"
created_at="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
delete_after="$(date -u -d "$created_at + 7 days" +'%Y-%m-%dT%H:%M:%S.000Z')"
put_output="$(aws s3api put-object \
  --bucket "$bucket" --key "$object_key" --body "$host_dump" \
  --region "$aws_region" --server-side-encryption AES256 \
  --tagging "studytube-retention=user-reset-7d&delete-after=$delete_after" \
  --query '[ETag,VersionId]' --output text)"
uploaded=true
version_id="$(printf '%s' "$put_output" | awk '{print $2}')"
if [ "$version_id" = 'None' ] || [ "$version_id" = 'null' ]; then
  version_id=""
fi
stored_encryption="$(aws s3api head-object \
  --bucket "$bucket" --key "$object_key" --region "$aws_region" \
  --query 'ServerSideEncryption' --output text)"
if [ "$stored_encryption" != 'AES256' ] && [ "$stored_encryption" != 'aws:kms' ]; then
  echo 'RESET_BACKUP_OBJECT_ENCRYPTION_MISSING' >&2
  exit 1
fi

proof_temporary="$run_directory/.verified-backup.json.tmp"
node - "$proof_temporary" "$run_id" "$postgres_database" "$manifest_sha" "$plan_sha" \
  "$dump_sha" "$bucket" "$object_key" "$version_id" "$created_at" "$delete_after" <<'NODE'
const fs = require('node:fs');
const [path, runId, databaseName, manifestSha256, planSha256, dumpSha256, s3Bucket,
  s3ObjectKey, s3VersionId, createdAt, deleteAfter] = process.argv.slice(2);
const proof = {
  schemaVersion: 'studytube.user-data-reset-backup.v1',
  runId,
  databaseName,
  manifestSha256,
  planSha256,
  dumpSha256,
  s3Bucket,
  s3ObjectKey,
  ...(s3VersionId ? { s3VersionId } : {}),
  createdAt,
  deleteAfter,
  restoreVerified: true,
};
fs.writeFileSync(path, `${JSON.stringify(proof)}\n`, { mode: 0o600, flag: 'wx' });
NODE
chmod 0600 "$proof_temporary"
mv -- "$proof_temporary" "$proof_path"
proof_written=true

node - "$proof_path" <<'NODE'
const fs = require('node:fs');
const proof = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  status: 'verified',
  runId: proof.runId,
  dumpSha256: proof.dumpSha256,
  deleteAfter: proof.deleteAfter,
  restoreVerified: proof.restoreVerified,
}));
NODE
