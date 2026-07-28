#!/usr/bin/env bash
set -euo pipefail

deploy_branch="${1:-${DEPLOY_BRANCH:-sw}}"
app_dir="${APP_DIR:-$(pwd)}"

cd "$app_dir"

git fetch origin "$deploy_branch"
git checkout "$deploy_branch"
git pull --ff-only origin "$deploy_branch"

if ! sudo swapon --show --noheadings | grep -q '/swapfile'; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi

  sudo chmod 600 /swapfile
  sudo mkswap /swapfile || true
  sudo swapon /swapfile
fi

npm ci --prefix web --no-audit --fund=false
npm ci --prefix api --no-audit --fund=false

python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --upgrade pip
ai/.venv/bin/python -m pip install -r ai/requirements.txt

pkill -f '[n]pm run all' || true
pkill -f '[s]cripts/dev-all.mjs' || true
pkill -f '[u]vicorn' || true
pkill -f '[v]ite' || true
pkill -f '[n]est start' || true
pkill -f '[a]pi/dist/main' || true

for port in 3000 5173 8000; do
  pids="$(sudo lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill
  fi
done

sleep 2

for port in 3000 5173 8000; do
  pids="$(sudo lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill -9
  fi
done

setsid nohup npm run all > npm-run-all.log 2>&1 < /dev/null &

wait_for_url() {
  url="$1"
  label="$2"

  for _attempt in $(seq 1 60); do
    if curl -fsS "$url" >/tmp/agentic-board-healthcheck.out 2>/dev/null; then
      cat /tmp/agentic-board-healthcheck.out
      rm -f /tmp/agentic-board-healthcheck.out
      return 0
    fi

    sleep 1
  done

  echo "Timed out waiting for $label at $url" >&2
  tail -120 npm-run-all.log >&2 || true
  return 1
}

wait_for_url http://localhost:3000/health api
wait_for_url http://localhost:3000/health/ai ai
wait_for_url http://localhost:5173/ web >/dev/null
git rev-parse --short HEAD
