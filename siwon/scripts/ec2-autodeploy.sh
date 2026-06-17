#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-/home/ubuntu/agentic-board/siwon}"
deploy_branch="${DEPLOY_BRANCH:-sw}"
repo_full_name="${GITHUB_REPOSITORY:-NearthYou/agentic-board}"
workflow_name="${GITHUB_WORKFLOW_NAME:-CI/CD}"
lock_file="${AUTODEPLOY_LOCK_FILE:-/tmp/agentic-board-autodeploy.lock}"

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "autodeploy already running"
  exit 0
fi

cd "$app_dir"

git fetch origin "$deploy_branch"
remote_sha="$(git rev-parse "origin/$deploy_branch")"
current_sha="$(git rev-parse HEAD)"

if [ "$remote_sha" = "$current_sha" ]; then
  echo "already deployed $current_sha"
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
        "User-Agent": "agentic-board-autodeploy",
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
    APP_DIR="$app_dir" DEPLOY_BRANCH="$deploy_branch" bash "$app_dir/scripts/deploy-ec2.sh" "$deploy_branch"
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
