#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: build-release-artifact.sh [options]

Builds a deterministic StudyTube release artifact for one exact Git commit.

Options:
  --deploy-sha SHA       Full commit SHA. Defaults to DEPLOY_SHA or HEAD.
  --repo-root PATH       Repository root. Defaults to the parent of scripts/.
  --output-dir PATH      Output directory. Defaults to .release-artifacts.
  --help                 Show this help.
EOF
}

fail() {
  printf 'build-release-artifact: %s\n' "$1" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"
output_dir=""
deploy_sha="${DEPLOY_SHA:-}"

while (($# > 0)); do
  case "$1" in
    --deploy-sha)
      (($# >= 2)) || fail '--deploy-sha requires a value'
      deploy_sha="$2"
      shift 2
      ;;
    --repo-root)
      (($# >= 2)) || fail '--repo-root requires a value'
      repo_root="$2"
      shift 2
      ;;
    --output-dir)
      (($# >= 2)) || fail '--output-dir requires a value'
      output_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

for command_name in git tar gzip sha256sum mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

repo_root="$(cd -- "$repo_root" && pwd -P)"
git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "$repo_root is not a Git work tree"

if [[ -z "$deploy_sha" ]]; then
  deploy_sha="$(git -C "$repo_root" rev-parse HEAD)"
fi
if [[ ! "$deploy_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'the deploy SHA must be a lowercase full commit SHA'
fi

resolved_sha="$(git -C "$repo_root" rev-parse --verify "$deploy_sha^{commit}")"
[[ "$resolved_sha" == "$deploy_sha" ]] || fail 'the deploy SHA did not resolve exactly'
head_sha="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$head_sha" == "$deploy_sha" ]] ||
  fail "the checked out commit $head_sha does not match DEPLOY_SHA=$deploy_sha"

if [[ -z "$output_dir" ]]; then
  output_dir="$repo_root/.release-artifacts"
elif [[ "$output_dir" != /* ]]; then
  output_dir="$repo_root/$output_dir"
fi
mkdir -p -- "$output_dir"
output_dir="$(cd -- "$output_dir" && pwd -P)"

umask 077
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-release.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

payload_dir="$temporary_dir/payload"
bare_repository="$temporary_dir/repository.git"
mkdir -p -- "$payload_dir"
git init --quiet --bare "$bare_repository"
git -C "$bare_repository" fetch --quiet --depth=1 "$repo_root" \
  "$deploy_sha:refs/heads/release"
git -c pack.threads=1 -c pack.compression=9 -C "$bare_repository" \
  repack -a -d -F --window=0
git -c pack.threads=1 -c pack.compression=9 -c pack.window=0 \
  -C "$bare_repository" bundle create \
  "$payload_dir/repository.bundle" refs/heads/release

bundle_head="$(git bundle list-heads "$payload_dir/repository.bundle" refs/heads/release)"
[[ "$bundle_head" == "$deploy_sha refs/heads/release" ]] ||
  fail 'the release bundle does not expose the verified SHA'

bundle_sha256="$(sha256sum "$payload_dir/repository.bundle" | awk '{print $1}')"
printf '%s\n' \
  'STUDYTUBE_RELEASE_FORMAT=1' \
  "DEPLOY_SHA=$deploy_sha" \
  'RELEASE_REF=refs/heads/release' \
  "BUNDLE_SHA256=$bundle_sha256" \
  >"$payload_dir/manifest.env"

source_date_epoch="$(git -C "$repo_root" show -s --format=%ct "$deploy_sha")"
artifact_name="studytube-$deploy_sha.tar.gz"
artifact_path="$output_dir/$artifact_name"
digest_path="$artifact_path.sha256"
temporary_artifact="$temporary_dir/$artifact_name"

tar --sort=name \
  --format=posix \
  --mtime="@$source_date_epoch" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --pax-option=delete=atime,delete=ctime \
  -C "$payload_dir" \
  -cf - \
  manifest.env repository.bundle |
  gzip -n -9 >"$temporary_artifact"

artifact_sha256="$(sha256sum "$temporary_artifact" | awk '{print $1}')"
if [[ -e "$artifact_path" ]]; then
  existing_sha256="$(sha256sum "$artifact_path" | awk '{print $1}')"
  [[ "$existing_sha256" == "$artifact_sha256" ]] ||
    fail "an artifact for $deploy_sha already exists with different content"
else
  install -m 0644 "$temporary_artifact" "$artifact_path"
fi

temporary_digest="$temporary_dir/$artifact_name.sha256"
printf '%s  %s\n' "$artifact_sha256" "$artifact_name" >"$temporary_digest"
install -m 0644 "$temporary_digest" "$digest_path"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'artifact_path=%s\n' "$artifact_path"
    printf 'digest_path=%s\n' "$digest_path"
    printf 'artifact_name=%s\n' "$artifact_name"
    printf 'artifact_sha256=%s\n' "$artifact_sha256"
  } >>"$GITHUB_OUTPUT"
fi

printf 'artifact=%s\nsha256=%s\n' "$artifact_path" "$artifact_sha256"
