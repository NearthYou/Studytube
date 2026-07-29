#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly DEFAULT_DEPLOY_ROOT='/opt/studytube'
readonly DEFAULT_CONFIG_FILE='/etc/studytube/deployment.env'
readonly DEFAULT_RETAIN_RELEASES='5'
readonly DEFAULT_MINIMUM_FREE_BYTES='3221225472'

usage() {
  cat <<'EOF'
Usage:
  ssm-deploy-release.sh deploy [options]
  ssm-deploy-release.sh resume [--deploy-root PATH]
  ssm-deploy-release.sh validate-config-content --config-file PATH
  ssm-deploy-release.sh verify-artifact --artifact-file PATH \
    --artifact-sha256 SHA256 --deploy-sha SHA

Deploy options:
  --artifact-uri S3_URI       Immutable tar.gz object to download.
  --artifact-sha256 SHA256    Expected lowercase SHA-256 digest.
  --deploy-sha SHA            Full Git commit SHA carried by the artifact.
  --region REGION             AWS Region containing the artifact bucket.
  --config-file PATH          Root-owned deployment environment file.
  --deploy-root PATH          Release root. Default: /opt/studytube.
  --retain-releases NUMBER    Number of newest releases to retain.
  --minimum-free-bytes BYTES  Free-space reserve after staging.

The resume command is installed as a boot-time systemd oneshot. It either
continues a pre-activation stage or rolls an interrupted activation back to
the recorded last known good release.
EOF
}

fail() {
  printf 'ssm-deploy-release: %s\n' "$1" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail 'DEPLOY_SHA must be a lowercase full commit SHA'
}

validate_digest() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || fail 'artifact SHA-256 must contain 64 lowercase hex characters'
}

validate_absolute_path() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "$label must be a simple absolute path"
  [[ "$value" != '/' && "$value" != *'/../'* && "$value" != */.. && "$value" != *'//'* ]] ||
    fail "$label is too broad or contains traversal"
}

validate_positive_integer() {
  local value="$1"
  local label="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || ((10#$value <= 0)); then
    fail "$label must be a positive integer"
  fi
}

manifest_value() {
  local manifest_path="$1"
  local key="$2"
  awk -F= -v expected_key="$key" '$1 == expected_key { print substr($0, length($1) + 2); found = 1 } END { if (!found) exit 1 }' \
    "$manifest_path"
}

state_value() {
  manifest_value "$1" "$2"
}

verify_archive_members() {
  local artifact_path="$1"
  local members
  members="$(tar -tzf "$artifact_path")" || return 1
  [[ "$members" == $'manifest.env\nrepository.bundle' ]] ||
    fail 'release artifact contains an unexpected path or member order'

  local listing
  listing="$(tar -tvzf "$artifact_path")" || return 1
  while IFS= read -r entry; do
    [[ "${entry:0:1}" == '-' ]] || fail 'release artifact members must be regular files'
  done <<<"$listing"
}

verify_artifact() {
  local artifact_path="$1"
  local expected_sha256="$2"
  local expected_deploy_sha="$3"

  [[ -f "$artifact_path" && ! -L "$artifact_path" ]] || fail 'artifact must be a regular non-symlink file'
  validate_digest "$expected_sha256"
  validate_sha "$expected_deploy_sha"

  local actual_sha256
  actual_sha256="$(sha256sum "$artifact_path" | awk '{print $1}')"
  [[ "$actual_sha256" == "$expected_sha256" ]] || fail 'artifact SHA-256 verification failed'
  verify_archive_members "$artifact_path"

  local verification_dir
  verification_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-verify.XXXXXX")"
  cleanup_verification_dir() {
    rm -rf -- "$verification_dir"
  }
  trap cleanup_verification_dir RETURN

  tar -xzf "$artifact_path" --no-same-owner --no-same-permissions -C "$verification_dir"
  local manifest_path="$verification_dir/manifest.env"
  local bundle_path="$verification_dir/repository.bundle"
  [[ "$(manifest_value "$manifest_path" STUDYTUBE_RELEASE_FORMAT)" == '1' ]] ||
    fail 'unsupported release artifact format'
  [[ "$(manifest_value "$manifest_path" DEPLOY_SHA)" == "$expected_deploy_sha" ]] ||
    fail 'artifact commit does not match the requested deploy SHA'
  [[ "$(manifest_value "$manifest_path" RELEASE_REF)" == 'refs/heads/release' ]] ||
    fail 'artifact release ref is invalid'

  local expected_bundle_sha256 actual_bundle_sha256 bundle_head
  expected_bundle_sha256="$(manifest_value "$manifest_path" BUNDLE_SHA256)"
  validate_digest "$expected_bundle_sha256"
  actual_bundle_sha256="$(sha256sum "$bundle_path" | awk '{print $1}')"
  [[ "$actual_bundle_sha256" == "$expected_bundle_sha256" ]] ||
    fail 'repository bundle SHA-256 verification failed'
  bundle_head="$(git bundle list-heads "$bundle_path" refs/heads/release)"
  [[ "$bundle_head" == "$expected_deploy_sha refs/heads/release" ]] ||
    fail 'repository bundle does not carry the requested commit'

  local verification_repository="$verification_dir/verification.git"
  git init --quiet --bare "$verification_repository"
  git -C "$verification_repository" bundle verify "$bundle_path" >/dev/null
  trap - RETURN
  cleanup_verification_dir
}

validate_config_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail 'deployment config must be a regular non-symlink file'
  [[ "$(stat -c '%u' "$path")" == '0' ]] || fail 'deployment config must be owned by root'

  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 0037) == 0 )) ||
    fail 'deployment config may only be readable by root and its group'

  validate_config_content "$path"
}

validate_config_content() {
  local path="$1"
  [[ -f "$path" ]] || fail 'deployment config content must be a regular file'

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *$'\r'* ]] ||
      fail 'deployment config must use Unix line endings'
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] ||
      fail 'deployment config must contain only KEY=value entries'
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      BASH_ENV|BASHOPTS|CDPATH|ENV|GLOBIGNORE|HOME|IFS|PATH|PROMPT_COMMAND|PS4|SHELLOPTS|NODE_OPTIONS|PYTHONHOME|PYTHONPATH|PERL5OPT|RUBYOPT|LD_PRELOAD|LD_LIBRARY_PATH|NPM_CONFIG_USERCONFIG|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*|DYLD_*)
        fail "deployment config contains forbidden process-control variable $key"
        ;;
    esac
    [[ "$value" != *"'"* && "$value" != *'"'* && "$value" != *\\* ]] ||
      fail 'deployment config values must use portable unquoted literals'
  done <"$path"
}

load_config_file() {
  local path="$1"
  validate_config_content "$path"

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    export "$key=$value"
  done <"$path"
}

atomic_symlink() {
  local target="$1"
  local link_path="$2"
  local temporary_link="${link_path}.incoming.$$"
  rm -f -- "$temporary_link"
  ln -s -- "$target" "$temporary_link"
  mv -Tf -- "$temporary_link" "$link_path"
}

safe_release_target() {
  local candidate="$1"
  [[ -n "$candidate" && -d "$candidate" && ! -L "$candidate" ]] || return 1
  [[ "$candidate" == "$releases_dir"/* ]] || return 1
  [[ "$(basename -- "$candidate")" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ -f "$candidate/release-metadata.env" && -d "$candidate/source/.git" ]] || return 1
}

current_release_target() {
  local link_path="$1"
  [[ -L "$link_path" ]] || return 1
  local target
  target="$(readlink -f -- "$link_path")"
  safe_release_target "$target" || return 1
  printf '%s\n' "$target"
}

link_release_config() {
  local release_path="$1"
  local snapshot_path="$2"
  local environment_path
  for environment_path in \
    "$release_path/source/.env" \
    "$release_path/source/api/.env" \
    "$release_path/source/ai/.env"; do
    if [[ -e "$environment_path" && ! -L "$environment_path" ]]; then
      fail "refusing to replace tracked environment path $environment_path"
      return 1
    fi
    rm -f -- "$environment_path"
    ln -s -- "$snapshot_path" "$environment_path"
  done
}

check_disk_space() {
  local payload_bytes="$1"
  local available_kib available_bytes required_bytes
  available_kib="$(df -Pk "$deploy_root" | awk 'NR == 2 { print $4 }')"
  [[ "$available_kib" =~ ^[0-9]+$ ]] || fail 'could not determine available deployment disk space'
  available_bytes=$((available_kib * 1024))
  required_bytes=$((minimum_free_bytes + payload_bytes * 4))
  ((available_bytes >= required_bytes)) ||
    fail "disk preflight failed: $available_bytes bytes available, $required_bytes required"
}

parse_s3_uri() {
  local uri="$1"
  [[ "$uri" =~ ^s3://([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/([A-Za-z0-9._/-]+)$ ]] ||
    fail 'artifact URI must be a simple s3://bucket/key URI'
  artifact_bucket="${BASH_REMATCH[1]}"
  artifact_key="${BASH_REMATCH[2]}"
}

download_artifact() {
  parse_s3_uri "$artifact_uri"
  local content_length
  content_length="$(aws s3api head-object \
    --bucket "$artifact_bucket" \
    --key "$artifact_key" \
    --region "$aws_region" \
    --query ContentLength \
    --output text)"
  [[ "$content_length" =~ ^[0-9]+$ ]] || fail 'S3 did not return an artifact content length'
  check_disk_space "$content_length"

  local cache_path="$artifacts_dir/$deploy_sha-$artifact_sha256.tar.gz"
  if [[ -f "$cache_path" && ! -L "$cache_path" ]] &&
    [[ "$(sha256sum "$cache_path" | awk '{print $1}')" == "$artifact_sha256" ]]; then
    artifact_file="$cache_path"
    return 0
  fi

  local temporary_download
  temporary_download="$(mktemp "$artifacts_dir/.${deploy_sha}.download.XXXXXX")"
  if ! aws s3 cp "$artifact_uri" "$temporary_download" \
    --only-show-errors --region "$aws_region"; then
    rm -f -- "$temporary_download"
    return 1
  fi
  [[ "$(sha256sum "$temporary_download" | awk '{print $1}')" == "$artifact_sha256" ]] || {
    rm -f -- "$temporary_download"
    fail 'downloaded artifact SHA-256 verification failed'
    return 1
  }
  chmod 0444 "$temporary_download"
  mv -f -- "$temporary_download" "$cache_path"
  artifact_file="$cache_path"
}

snapshot_config() {
  if [[ -n "$config_snapshot" ]]; then
    validate_config_file "$config_snapshot"
    [[ "$(sha256sum "$config_snapshot" | awk '{print $1}')" == "$config_fingerprint" ]] ||
      fail 'saved config snapshot fingerprint does not match deployment state'
    return 0
  fi

  validate_config_file "$config_file"
  config_fingerprint="$(sha256sum "$config_file" | awk '{print $1}')"
  config_snapshot="$config_snapshots_dir/$config_fingerprint.env"
  if [[ -e "$config_snapshot" ]]; then
    validate_config_file "$config_snapshot"
    [[ "$(sha256sum "$config_snapshot" | awk '{print $1}')" == "$config_fingerprint" ]] ||
      fail 'existing config snapshot has unexpected content'
  else
    install -o root -g root -m 0600 "$config_file" "$config_snapshot"
  fi
}

write_state() {
  local temporary_state
  temporary_state="$(mktemp "$state_dir/.${deploy_sha}.state.XXXXXX")"
  printf '%s\n' \
    'STUDYTUBE_DEPLOY_STATE_FORMAT=1' \
    "PHASE=$phase" \
    "DEPLOY_SHA=$deploy_sha" \
    "ARTIFACT_URI=$artifact_uri" \
    "ARTIFACT_SHA256=$artifact_sha256" \
    "AWS_REGION=$aws_region" \
    "CONFIG_FILE=$config_file" \
    "CONFIG_FINGERPRINT=$config_fingerprint" \
    "CONFIG_SNAPSHOT=$config_snapshot" \
    "DEPLOY_ROOT=$deploy_root" \
    "RETAIN_RELEASES=$retain_releases" \
    "MINIMUM_FREE_BYTES=$minimum_free_bytes" \
    "PREVIOUS_RELEASE=$previous_release" \
    "LEGACY_RUNTIME_SNAPSHOT=$legacy_runtime_snapshot" \
    >"$temporary_state"
  chmod 0600 "$temporary_state"
  mv -f -- "$temporary_state" "$state_file"
  install -o root -g root -m 0600 "$state_file" "$pending_file"
}

load_pending_state() {
  [[ -f "$pending_file" && ! -L "$pending_file" ]] || return 1
  [[ "$(state_value "$pending_file" STUDYTUBE_DEPLOY_STATE_FORMAT)" == '1' ]] ||
    fail 'unsupported pending deployment state'
  phase="$(state_value "$pending_file" PHASE)"
  deploy_sha="$(state_value "$pending_file" DEPLOY_SHA)"
  artifact_uri="$(state_value "$pending_file" ARTIFACT_URI)"
  artifact_sha256="$(state_value "$pending_file" ARTIFACT_SHA256)"
  aws_region="$(state_value "$pending_file" AWS_REGION)"
  config_file="$(state_value "$pending_file" CONFIG_FILE)"
  config_fingerprint="$(state_value "$pending_file" CONFIG_FINGERPRINT)"
  config_snapshot="$(state_value "$pending_file" CONFIG_SNAPSHOT)"
  deploy_root="$(state_value "$pending_file" DEPLOY_ROOT)"
  retain_releases="$(state_value "$pending_file" RETAIN_RELEASES)"
  minimum_free_bytes="$(state_value "$pending_file" MINIMUM_FREE_BYTES)"
  previous_release="$(state_value "$pending_file" PREVIOUS_RELEASE)"
  legacy_runtime_snapshot="$(state_value "$pending_file" LEGACY_RUNTIME_SNAPSHOT)"
}

clear_pending_state() {
  if [[ -f "$pending_file" ]] && [[ "$(state_value "$pending_file" DEPLOY_SHA)" == "$deploy_sha" ]]; then
    rm -f -- "$pending_file"
  fi
}

install_resume_service() {
  local tools_dir="$deploy_root/deploy-tools"
  local installed_script="$tools_dir/ssm-deploy-release.sh"
  local source_script
  source_script="$(readlink -f -- "${BASH_SOURCE[0]}")"
  mkdir -p -- "$tools_dir"
  if [[ "$source_script" != "$installed_script" ]]; then
    install -o root -g root -m 0755 "$source_script" "$installed_script"
  fi

  local unit_path='/etc/systemd/system/studytube-deploy-resume.service'
  local temporary_unit
  temporary_unit="$(mktemp "$state_dir/.resume-unit.XXXXXX")"
  printf '%s\n' \
    '[Unit]' \
    'Description=Resume or roll back an interrupted StudyTube deployment' \
    'After=network-online.target docker.service' \
    'Wants=network-online.target' \
    "ConditionPathExists=$pending_file" \
    '' \
    '[Service]' \
    'Type=oneshot' \
    "ExecStart=$installed_script resume --deploy-root $deploy_root" \
    'TimeoutStartSec=45min' \
    'UMask=0077' \
    'NoNewPrivileges=true' \
    '' \
    '[Install]' \
    'WantedBy=multi-user.target' \
    >"$temporary_unit"
  install -o root -g root -m 0644 "$temporary_unit" "$unit_path"
  rm -f -- "$temporary_unit"
  systemctl daemon-reload
  systemctl enable studytube-deploy-resume.service >/dev/null
}

initialize_paths() {
  releases_dir="$deploy_root/releases"
  artifacts_dir="$deploy_root/artifacts"
  state_dir="$deploy_root/deployment-state"
  diagnostics_dir="$deploy_root/deployment-diagnostics/$deploy_sha"
  config_snapshots_dir="$deploy_root/config-snapshots"
  current_link="$deploy_root/current"
  last_known_good_link="$deploy_root/last-known-good"
  state_file="$state_dir/$deploy_sha.env"
  pending_file="$state_dir/pending.env"
  mkdir -p -- \
    "$releases_dir" \
    "$artifacts_dir" \
    "$state_dir" \
    "$diagnostics_dir" \
    "$config_snapshots_dir"
  chmod 0700 "$state_dir" "$config_snapshots_dir"
}

start_diagnostic_log() {
  diagnostic_log="$diagnostics_dir/deploy.log"
  touch "$diagnostic_log"
  chmod 0600 "$diagnostic_log"
  diagnostics_initialized='true'
  exec > >(tee -a "$diagnostic_log") 2>&1
}

collect_diagnostics() {
  [[ "$diagnostics_initialized" == 'true' ]] || return 0
  {
    printf '\nDeployment diagnostics for %s\n' "$deploy_sha"
    date -u '+utc=%Y-%m-%dT%H:%M:%SZ'
    printf 'phase=%s\n' "$phase"
    df -h "$deploy_root" || true
    if [[ -f "$state_file" ]]; then
      sed -E 's#^(CONFIG_FILE|CONFIG_SNAPSHOT)=.*#\1=[redacted-path]#' "$state_file" || true
    fi
    systemctl --no-pager --full status \
      studytube-api.service \
      studytube-ai.service \
      studytube-worker.service || true
    journalctl --no-pager -n 160 \
      -u studytube-api.service \
      -u studytube-ai.service \
      -u studytube-worker.service || true
    local diagnostic_release
    diagnostic_release="$(current_release_target "$current_link" 2>/dev/null || true)"
    if [[ -n "$diagnostic_release" && -f "$diagnostic_release/source/infra/production.compose.yml" ]]; then
      (
        cd -- "$diagnostic_release/source"
        docker compose -f infra/production.compose.yml ps || true
      )
    fi
  } >>"$diagnostic_log" 2>&1
}

exit_handler() {
  local exit_code="$1"
  if ((exit_code != 0)); then
    collect_diagnostics || true
  fi
}

stage_release() {
  local release_path="$releases_dir/$deploy_sha"
  if [[ -d "$release_path" && ! -L "$release_path" ]]; then
    [[ "$(state_value "$release_path/release-metadata.env" DEPLOY_SHA)" == "$deploy_sha" ]] ||
      fail 'existing release directory has a different deploy SHA'
    [[ "$(state_value "$release_path/release-metadata.env" ARTIFACT_SHA256)" == "$artifact_sha256" ]] ||
      fail 'existing release directory has a different artifact digest'
    [[ "$(git -C "$release_path/source" rev-parse HEAD)" == "$deploy_sha" ]] ||
      fail 'existing release checkout has a different commit'
    link_release_config "$release_path" "$config_snapshot"
    release_dir="$release_path"
    return 0
  fi
  [[ ! -e "$release_path" && ! -L "$release_path" ]] ||
    fail 'release destination exists but is not a valid directory'

  verify_artifact "$artifact_file" "$artifact_sha256" "$deploy_sha"
  local incoming_dir
  incoming_dir="$(mktemp -d "$releases_dir/.${deploy_sha}.incoming.XXXXXX")"
  if ! tar -xzf "$artifact_file" --no-same-owner --no-same-permissions -C "$incoming_dir"; then
    rm -rf -- "$incoming_dir"
    return 1
  fi
  if ! git clone --quiet --branch release --single-branch \
    "$incoming_dir/repository.bundle" "$incoming_dir/source"; then
    rm -rf -- "$incoming_dir"
    return 1
  fi
  [[ "$(git -C "$incoming_dir/source" rev-parse HEAD)" == "$deploy_sha" ]] || {
    rm -rf -- "$incoming_dir"
    fail 'staged checkout does not match the deploy SHA'
    return 1
  }
  git -C "$incoming_dir/source" remote set-url origin "$release_path/repository.bundle"
  printf '%s\n' \
    'STUDYTUBE_RELEASE_METADATA_FORMAT=1' \
    "DEPLOY_SHA=$deploy_sha" \
    "ARTIFACT_SHA256=$artifact_sha256" \
    "BUNDLE_SHA256=$(manifest_value "$incoming_dir/manifest.env" BUNDLE_SHA256)" \
    >"$incoming_dir/release-metadata.env"
  chmod -R go-w "$incoming_dir"
  mv -- "$incoming_dir" "$release_path"
  link_release_config "$release_path" "$config_snapshot"
  release_dir="$release_path"
}

prepare_release() {
  local source_dir="$release_dir/source"
  [[ -x "$source_dir/scripts/deploy-ec2.sh" || -f "$source_dir/scripts/deploy-ec2.sh" ]] ||
    fail 'release does not contain scripts/deploy-ec2.sh'
  [[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
    fail 'release checkout is dirty before preparation'

  (
    load_config_file "$config_snapshot"
    cd -- "$source_dir"
    npm ci --prefix web --no-audit --fund=false
    npm ci --prefix api --no-audit --fund=false
    npm --prefix web run build
    npm --prefix api run build
    python3 -m venv ai/.venv
    ai/.venv/bin/python -m pip install \
      --disable-pip-version-check \
      --no-cache-dir \
      --require-hashes \
      -r ai/requirements.txt
    docker compose -f infra/production.compose.yml config --quiet
    docker compose -f infra/production.compose.yml run --rm --no-deps caddy \
      validate --config /etc/caddy/Caddyfile --adapter caddyfile
  )

  [[ -z "$(git -C "$source_dir" status --porcelain --untracked-files=all)" ]] ||
    fail 'release preparation modified tracked source'
}

disable_legacy_pull_deployment() {
  exec 7>'/tmp/studytube-autodeploy.lock'
  flock -w 60 7 || fail 'legacy pull deployment is still running'

  local app_user
  app_user="$({
    load_config_file "$config_snapshot"
    printf '%s' "${APP_USER:-ubuntu}"
  })"
  [[ "$app_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] ||
    fail 'APP_USER is invalid while disabling the legacy deploy timer'
  id "$app_user" >/dev/null 2>&1 || fail "APP_USER=$app_user does not exist"

  local app_home
  app_home="$(getent passwd "$app_user" | awk -F: 'NR == 1 { print $6 }')"
  validate_absolute_path "$app_home" APP_USER_HOME
  local user_unit_dir="$app_home/.config/systemd/user"
  local user_uid
  user_uid="$(id -u "$app_user")"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$app_user" -- env "XDG_RUNTIME_DIR=/run/user/$user_uid" \
      systemctl --user disable --now studytube-autodeploy.timer studytube-autodeploy.service \
      >/dev/null 2>&1 || true
  fi
  rm -f -- \
    "$user_unit_dir/studytube-autodeploy.timer" \
    "$user_unit_dir/studytube-autodeploy.service"

  if command -v crontab >/dev/null 2>&1; then
    local existing_crontab filtered_crontab
    existing_crontab="$(mktemp "$state_dir/.legacy-crontab.XXXXXX")"
    filtered_crontab="$(mktemp "$state_dir/.filtered-crontab.XXXXXX")"
    if crontab -u "$app_user" -l >"$existing_crontab" 2>/dev/null; then
      grep -vF 'scripts/ec2-autodeploy.sh' "$existing_crontab" >"$filtered_crontab" || true
      crontab -u "$app_user" "$filtered_crontab"
    fi
    rm -f -- "$existing_crontab" "$filtered_crontab"
  fi
}

snapshot_legacy_runtime() {
  [[ -z "$previous_release" ]] || return 0
  local snapshot_dir="$state_dir/$deploy_sha-legacy-runtime"
  mkdir -p -- "$snapshot_dir"
  chmod 0700 "$snapshot_dir"

  local unit_name unit_source captured_units=0
  for unit_name in studytube-api.service studytube-ai.service studytube-worker.service; do
    unit_source="/etc/systemd/system/$unit_name"
    if [[ -f "$unit_source" && ! -L "$unit_source" ]]; then
      install -o root -g root -m 0600 "$unit_source" "$snapshot_dir/$unit_name"
      captured_units=$((captured_units + 1))
      if systemctl is-active --quiet "$unit_name"; then
        : >"$snapshot_dir/$unit_name.active"
      fi
    fi
  done

  local legacy_web_link='/var/www/studytube/current'
  if [[ -L "$legacy_web_link" ]]; then
    local legacy_web_target
    legacy_web_target="$(readlink -f -- "$legacy_web_link")"
    if [[ "$legacy_web_target" == /var/www/studytube/releases/* && -d "$legacy_web_target" ]]; then
      printf 'WEB_TARGET=%s\n' "$legacy_web_target" >"$snapshot_dir/web.env"
      chmod 0600 "$snapshot_dir/web.env"
    fi
  fi

  local legacy_app_dir
  legacy_app_dir="$(systemctl show studytube-api.service --property=WorkingDirectory --value 2>/dev/null || true)"
  if [[ "$legacy_app_dir" =~ ^/[A-Za-z0-9._/-]+$ &&
        "$legacy_app_dir" != '/' &&
        -f "$legacy_app_dir/infra/production.compose.yml" ]]; then
    printf 'APP_DIR=%s\n' "$legacy_app_dir" >"$snapshot_dir/runtime.env"
    chmod 0600 "$snapshot_dir/runtime.env"
  fi

  if ((captured_units > 0)); then
    legacy_runtime_snapshot="$snapshot_dir"
  else
    rmdir -- "$snapshot_dir" 2>/dev/null || true
    legacy_runtime_snapshot=''
  fi
}

rollback_legacy_runtime() {
  [[ -n "$legacy_runtime_snapshot" ]] || fail 'no legacy runtime snapshot is available'
  validate_absolute_path "$legacy_runtime_snapshot" LEGACY_RUNTIME_SNAPSHOT
  [[ "$legacy_runtime_snapshot" == "$state_dir"/* && -d "$legacy_runtime_snapshot" && ! -L "$legacy_runtime_snapshot" ]] ||
    fail 'legacy runtime snapshot is outside the deployment state directory'

  phase='rolling_back'
  write_state
  local unit_name restored_units=0
  for unit_name in studytube-api.service studytube-ai.service studytube-worker.service; do
    if [[ -f "$legacy_runtime_snapshot/$unit_name" && ! -L "$legacy_runtime_snapshot/$unit_name" ]]; then
      install -o root -g root -m 0644 \
        "$legacy_runtime_snapshot/$unit_name" "/etc/systemd/system/$unit_name"
      restored_units=$((restored_units + 1))
    fi
  done
  ((restored_units > 0)) || fail 'legacy runtime snapshot contains no systemd units'
  systemctl daemon-reload
  for unit_name in studytube-api.service studytube-ai.service studytube-worker.service; do
    if [[ -f "$legacy_runtime_snapshot/$unit_name.active" ]]; then
      systemctl restart "$unit_name"
    fi
  done

  if [[ -f "$legacy_runtime_snapshot/web.env" ]]; then
    local legacy_web_target
    legacy_web_target="$(state_value "$legacy_runtime_snapshot/web.env" WEB_TARGET)"
    [[ "$legacy_web_target" == /var/www/studytube/releases/* && -d "$legacy_web_target" ]] ||
      fail 'legacy web release target is invalid'
    atomic_symlink "$legacy_web_target" /var/www/studytube/current
  fi
  if [[ -f "$legacy_runtime_snapshot/runtime.env" ]]; then
    local legacy_app_dir
    legacy_app_dir="$(state_value "$legacy_runtime_snapshot/runtime.env" APP_DIR)"
    validate_absolute_path "$legacy_app_dir" LEGACY_APP_DIR
    [[ -f "$legacy_app_dir/infra/production.compose.yml" ]] ||
      fail 'legacy runtime Compose model is missing'
    (
      cd -- "$legacy_app_dir"
      docker compose -f infra/production.compose.yml up -d caddy
      docker compose -f infra/production.compose.yml exec -T caddy \
        caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    )
  fi
  phase='rolled_back'
  write_state
  clear_pending_state
}

write_release_success_metadata() {
  local release_path="$1"
  local snapshot_path="$2"
  local fingerprint="$3"
  local metadata_path="$release_path/deploy-success.env"
  local temporary_metadata
  temporary_metadata="$(mktemp "$release_path/.deploy-success.XXXXXX")"
  printf '%s\n' \
    'STUDYTUBE_DEPLOY_SUCCESS_FORMAT=1' \
    "DEPLOY_SHA=$(basename -- "$release_path")" \
    "CONFIG_FINGERPRINT=$fingerprint" \
    "CONFIG_SNAPSHOT=$snapshot_path" \
    >"$temporary_metadata"
  chmod 0600 "$temporary_metadata"
  mv -f -- "$temporary_metadata" "$metadata_path"
}

invoke_release_deploy() {
  local release_path="$1"
  local release_sha="$2"
  local snapshot_path="$3"
  link_release_config "$release_path" "$snapshot_path"
  (
    load_config_file "$snapshot_path"
    cd -- "$release_path/source"
    DEPLOY_SHA="$release_sha" \
      DEPLOY_BRANCH=release \
      APP_DIR="$release_path/source" \
      bash scripts/deploy-ec2.sh release
  )
}

rollback_previous_release() {
  safe_release_target "$previous_release" || fail 'recorded previous release is not safe to roll back to'
  local previous_metadata="$previous_release/deploy-success.env"
  [[ -f "$previous_metadata" && ! -L "$previous_metadata" ]] ||
    fail 'previous release has no successful deployment metadata'
  [[ "$(state_value "$previous_metadata" STUDYTUBE_DEPLOY_SUCCESS_FORMAT)" == '1' ]] ||
    fail 'previous release success metadata is invalid'

  local previous_sha previous_snapshot previous_fingerprint
  previous_sha="$(state_value "$previous_metadata" DEPLOY_SHA)"
  previous_snapshot="$(state_value "$previous_metadata" CONFIG_SNAPSHOT)"
  previous_fingerprint="$(state_value "$previous_metadata" CONFIG_FINGERPRINT)"
  validate_sha "$previous_sha"
  validate_config_file "$previous_snapshot"
  [[ "$(sha256sum "$previous_snapshot" | awk '{print $1}')" == "$previous_fingerprint" ]] ||
    fail 'previous release config snapshot fingerprint is invalid'

  phase='rolling_back'
  write_state
  invoke_release_deploy "$previous_release" "$previous_sha" "$previous_snapshot"
  atomic_symlink "$previous_release" "$current_link"
  atomic_symlink "$previous_release" "$last_known_good_link"
  phase='rolled_back'
  write_state
  clear_pending_state
}

activate_release() {
  if [[ -n "$previous_release" ]]; then
    atomic_symlink "$previous_release" "$last_known_good_link"
  fi

  phase='activating'
  write_state
  if ! invoke_release_deploy "$release_dir" "$deploy_sha" "$config_snapshot"; then
    phase='rollback_required'
    write_state
    if [[ -n "$previous_release" ]]; then
      rollback_previous_release || return 1
    elif [[ -n "$legacy_runtime_snapshot" ]]; then
      rollback_legacy_runtime || return 1
    fi
    return 1
  fi

  write_release_success_metadata "$release_dir" "$config_snapshot" "$config_fingerprint"
  atomic_symlink "$release_dir" "$current_link"
  if [[ ! -L "$last_known_good_link" ]]; then
    atomic_symlink "$release_dir" "$last_known_good_link"
  fi
  phase='complete'
  write_state
  clear_pending_state
}

prune_releases() {
  local current_target last_known_good_target
  current_target="$(current_release_target "$current_link" 2>/dev/null || true)"
  last_known_good_target="$(current_release_target "$last_known_good_link" 2>/dev/null || true)"
  local index=0 candidate resolved_candidate
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    resolved_candidate="$(readlink -f -- "$candidate")"
    safe_release_target "$resolved_candidate" || continue
    index=$((index + 1))
    if ((index <= retain_releases)) ||
      [[ "$resolved_candidate" == "$current_target" || "$resolved_candidate" == "$last_known_good_target" ]]; then
      continue
    fi
    [[ "$resolved_candidate" == "$releases_dir"/[0-9a-f][0-9a-f]* ]] || continue
    rm -rf -- "$resolved_candidate"
  done < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d \
    -name '[0-9a-f][0-9a-f]*' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}

run_deployment() {
  validate_sha "$deploy_sha"
  validate_digest "$artifact_sha256"
  validate_absolute_path "$deploy_root" DEPLOY_ROOT
  validate_absolute_path "$config_file" CONFIG_FILE
  validate_positive_integer "$retain_releases" RETAIN_RELEASES
  validate_positive_integer "$minimum_free_bytes" MINIMUM_FREE_BYTES
  parse_s3_uri "$artifact_uri"
  [[ "$aws_region" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]] || fail 'AWS region is invalid'

  ((EUID == 0)) || fail 'deploy and resume must run as root'
  for command_name in aws git tar sha256sum stat df flock systemctl npm python3 docker getent id; do
    require_command "$command_name"
  done

  mkdir -p -- "$deploy_root"
  initialize_paths
  start_diagnostic_log
  install_resume_service
  snapshot_config
  state_file="$state_dir/$deploy_sha.env"

  exec 9>"$state_dir/deployment.lock"
  flock -n 9 || fail 'another immutable deployment is already running'

  if [[ -z "$previous_release" ]]; then
    previous_release="$(current_release_target "$current_link" 2>/dev/null || true)"
  fi
  phase='initialized'
  write_state

  download_artifact
  verify_artifact "$artifact_file" "$artifact_sha256" "$deploy_sha"
  phase='artifact_verified'
  write_state

  stage_release
  check_disk_space "$(stat -c '%s' "$artifact_file")"
  phase='release_staged'
  write_state

  prepare_release
  disable_legacy_pull_deployment
  snapshot_legacy_runtime
  phase='prepared'
  write_state

  activate_release
  prune_releases
  printf 'deployed_sha=%s\nartifact_sha256=%s\nconfig_fingerprint=%s\n' \
    "$deploy_sha" "$artifact_sha256" "$config_fingerprint"
}

command_name="${1:-}"
[[ -n "$command_name" ]] || {
  usage >&2
  exit 2
}
shift

artifact_uri=''
artifact_file=''
artifact_sha256=''
aws_region=''
deploy_sha=''
config_file="$DEFAULT_CONFIG_FILE"
deploy_root="$DEFAULT_DEPLOY_ROOT"
retain_releases="$DEFAULT_RETAIN_RELEASES"
minimum_free_bytes="$DEFAULT_MINIMUM_FREE_BYTES"
config_fingerprint=''
config_snapshot=''
previous_release=''
legacy_runtime_snapshot=''
phase='new'
artifact_bucket=''
artifact_key=''
releases_dir=''
artifacts_dir=''
state_dir=''
diagnostics_dir=''
config_snapshots_dir=''
current_link=''
last_known_good_link=''
state_file=''
pending_file=''
release_dir=''
diagnostic_log=''
diagnostics_initialized='false'

while (($# > 0)); do
  case "$1" in
    --artifact-uri)
      (($# >= 2)) || { fail '--artifact-uri requires a value'; exit 2; }
      artifact_uri="$2"
      shift 2
      ;;
    --artifact-file)
      (($# >= 2)) || { fail '--artifact-file requires a value'; exit 2; }
      artifact_file="$2"
      shift 2
      ;;
    --artifact-sha256)
      (($# >= 2)) || { fail '--artifact-sha256 requires a value'; exit 2; }
      artifact_sha256="$2"
      shift 2
      ;;
    --deploy-sha)
      (($# >= 2)) || { fail '--deploy-sha requires a value'; exit 2; }
      deploy_sha="$2"
      shift 2
      ;;
    --region)
      (($# >= 2)) || { fail '--region requires a value'; exit 2; }
      aws_region="$2"
      shift 2
      ;;
    --config-file)
      (($# >= 2)) || { fail '--config-file requires a value'; exit 2; }
      config_file="$2"
      shift 2
      ;;
    --deploy-root)
      (($# >= 2)) || { fail '--deploy-root requires a value'; exit 2; }
      deploy_root="$2"
      shift 2
      ;;
    --retain-releases)
      (($# >= 2)) || { fail '--retain-releases requires a value'; exit 2; }
      retain_releases="$2"
      shift 2
      ;;
    --minimum-free-bytes)
      (($# >= 2)) || { fail '--minimum-free-bytes requires a value'; exit 2; }
      minimum_free_bytes="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      exit 2
      ;;
  esac
done

trap 'exit_handler $?' EXIT

case "$command_name" in
  validate-config-content)
    load_config_file "$config_file"
    printf 'deployment config content is safe to load\n'
    ;;
  verify-artifact)
    for command in git tar sha256sum mktemp; do
      require_command "$command"
    done
    [[ -n "$artifact_file" && -n "$artifact_sha256" && -n "$deploy_sha" ]] || {
      fail 'verify-artifact requires --artifact-file, --artifact-sha256, and --deploy-sha'
      exit 2
    }
    verify_artifact "$artifact_file" "$artifact_sha256" "$deploy_sha"
    printf 'verified_sha=%s\nartifact_sha256=%s\n' "$deploy_sha" "$artifact_sha256"
    ;;
  deploy)
    [[ -n "$artifact_uri" && -n "$artifact_sha256" && -n "$deploy_sha" && -n "$aws_region" ]] || {
      fail 'deploy requires --artifact-uri, --artifact-sha256, --deploy-sha, and --region'
      exit 2
    }
    run_deployment
    ;;
  resume)
    validate_absolute_path "$deploy_root" DEPLOY_ROOT
    ((EUID == 0)) || { fail 'resume must run as root'; exit 1; }
    releases_dir="$deploy_root/releases"
    state_dir="$deploy_root/deployment-state"
    pending_file="$state_dir/pending.env"
    if [[ ! -f "$pending_file" ]]; then
      printf 'No interrupted StudyTube deployment is pending.\n'
      exit 0
    fi
    load_pending_state
    validate_absolute_path "$deploy_root" DEPLOY_ROOT
    initialize_paths
    start_diagnostic_log
    state_file="$state_dir/$deploy_sha.env"
    if [[ "$phase" == 'complete' || "$phase" == 'rolled_back' ]]; then
      clear_pending_state
      printf 'Recovered completed deployment state for %s.\n' "$deploy_sha"
      exit 0
    fi
    if [[ "$phase" == 'activating' || "$phase" == 'rollback_required' || "$phase" == 'rolling_back' ]]; then
      exec 9>"$state_dir/deployment.lock"
      flock -n 9 || { fail 'another immutable deployment is already running'; exit 1; }
      if [[ -n "$previous_release" ]]; then
        rollback_previous_release
        printf 'Interrupted deployment rolled back to %s.\n' "$(basename -- "$previous_release")"
        exit 0
      elif [[ -n "$legacy_runtime_snapshot" ]]; then
        rollback_legacy_runtime
        printf 'Interrupted deployment rolled back to the captured legacy runtime.\n'
        exit 0
      fi
    fi
    run_deployment
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
