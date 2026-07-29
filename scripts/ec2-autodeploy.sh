#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-/home/ubuntu/studytube}"
deploy_branch="${DEPLOY_BRANCH:-main}"
repo_full_name="${GITHUB_REPOSITORY:-NearthYou/studytube}"
workflow_name="${GITHUB_WORKFLOW_NAME:-CI/CD}"
lock_file="${AUTODEPLOY_LOCK_FILE:-/tmp/studytube-autodeploy.lock}"

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "autodeploy already running"
  exit 0
fi

cd "$app_dir"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  source ./.env
fi
if [ -f api/.env ]; then
  # shellcheck disable=SC1091
  source ./api/.env
fi

git fetch origin "$deploy_branch"
remote_sha="$(git rev-parse "origin/$deploy_branch")"

state_dir="${COURSE_CUTOVER_STATE_DIR:-.studytube-deploy-state}"
case "$state_dir" in
  /*) ;;
  *) state_dir="$app_dir/$state_dir" ;;
esac
success_marker="$state_dir/deploy-success"
deployed_sha=""

if [ -f "$success_marker" ] && [ -r "$success_marker" ] &&
   [ ! -L "$success_marker" ] &&
   grep -Fqx -- "deploy_succeeded=true" "$success_marker"; then
  deployed_sha="$(sed -n 's/^deploy_sha=//p' "$success_marker")"
fi

if [ "$remote_sha" = "$deployed_sha" ] &&
   systemctl is-active --quiet studytube-api.service &&
   systemctl is-active --quiet studytube-ai.service &&
   systemctl is-active --quiet studytube-worker.service &&
   [ "$(docker inspect --format '{{.State.Running}}' studytube-postgres 2>/dev/null || true)" = "true" ] &&
   [ "$(docker inspect --format '{{.State.Running}}' studytube-valkey 2>/dev/null || true)" = "true" ] &&
   [ "$(docker inspect --format '{{.State.Running}}' studytube-caddy 2>/dev/null || true)" = "true" ]; then
  echo "already deployed $deployed_sha"
  exit 0
fi

ci_state="$(
  python3 - "$repo_full_name" "$deploy_branch" "$remote_sha" "$workflow_name" <<'PY'
import json
import sys
import urllib.request

repo, branch, sha, workflow_name = sys.argv[1:]
url = f"https://api.github.com/repos/{repo}/actions/runs?branch={branch}&per_page=20"
request = urllib.request.Request(
    url,
    headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "studytube-autodeploy",
    },
)

with urllib.request.urlopen(request, timeout=20) as response:
    payload = json.load(response)

for run in payload.get("workflow_runs", []):
    if run.get("head_sha") == sha and run.get("name") == workflow_name:
        print(f"{run.get('status') or ''}:{run.get('conclusion') or ''}")
        break
else:
    print("missing:")
PY
)"

case "$ci_state" in
  completed:success)
    echo "deploying $remote_sha after successful CI"
    deploy_script="$(mktemp "${TMPDIR:-/tmp}/studytube-autodeploy.XXXXXX")"
    trap 'rm -f "$deploy_script"' EXIT
    git show "$remote_sha:scripts/deploy-ec2.sh" >"$deploy_script"
    APP_DIR="$app_dir" DEPLOY_BRANCH="$deploy_branch" DEPLOY_SHA="$remote_sha" bash "$deploy_script" "$deploy_branch"
    ;;
  completed:*)
    echo "skip deploy: CI completed without success for $remote_sha ($ci_state)"
    ;;
  missing:*|*:)
    echo "skip deploy: CI run is not ready for $remote_sha ($ci_state)"
    ;;
  *)
    echo "skip deploy: CI is not successful yet for $remote_sha ($ci_state)"
    ;;
esac
