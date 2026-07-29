#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'production compose loopback contract: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == 'Linux' ]] ||
  fail 'this integration contract must run on a Linux Docker host'
command -v docker >/dev/null 2>&1 || fail 'docker is required'
docker info >/dev/null 2>&1 || fail 'the Docker daemon is unavailable'

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
compose_file="$repo_root/infra/production.compose.yml"
project_name="studytube-loopback-contract-${GITHUB_RUN_ID:-$$}"
postgres_image='pgvector/pgvector:pg16@sha256:00ba258a66dac104fd5171074a0084462a64a1369d8513f3d0a634e2f24d15bc'
valkey_image='valkey/valkey:9.1.1-alpine@sha256:ee91f7a174ac4d6a6b0685b3a60e321f0a9dbbb691f9b0e285be2ba1d1be8328'

for container_name in studytube-postgres studytube-valkey; do
  if docker container inspect "$container_name" >/dev/null 2>&1; then
    fail "refusing to replace pre-existing container $container_name"
  fi
done

cleanup() {
  docker compose -p "$project_name" -f "$compose_file" down \
    --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

export POSTGRES_USER='loopback_probe'
export POSTGRES_PASSWORD='loopback-contract-not-a-production-secret'
export POSTGRES_DB='loopback_probe'
export STUDYTUBE_SITE_ADDRESS='http://localhost'

docker compose -p "$project_name" -f "$compose_file" up \
  --detach --wait postgres valkey

docker run --rm --network host "$postgres_image" \
  pg_isready --host 127.0.0.1 --port 5432 \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" >/dev/null ||
  fail 'PostgreSQL is not reachable through its host loopback binding'

[[ "$(docker run --rm --network host "$valkey_image" \
  valkey-cli -h 127.0.0.1 -p 6379 ping)" == 'PONG' ]] ||
  fail 'Valkey is not reachable through its host loopback binding'

printf 'Production Compose loopback contract checks passed.\n'
