#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-$(pwd)}"
app_user="${APP_USER:-$(id -un)}"
app_group="${APP_GROUP:-$(id -gn "$app_user")}"
course_cutover_mode="${COURSE_CUTOVER_MODE:-}"

fail() {
  echo "$1" >&2
  exit 1
}

case "$app_dir" in
  /*) ;;
  *) fail "APP_DIR must be an absolute path" ;;
esac

if [[ ! "$app_dir" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  fail "APP_DIR contains unsupported characters"
fi
if [[ ! "$app_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  fail "APP_USER is invalid"
fi
if [[ ! "$app_group" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  fail "APP_GROUP is invalid"
fi
case "$course_cutover_mode" in
  legacy|freeze|course) ;;
  *) fail "COURSE_CUTOVER_MODE must be legacy, freeze, or course" ;;
esac

for command_name in docker node systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

node_bin="$(command -v node)"
case "$node_bin" in
  /*) ;;
  *) fail "node must resolve to an absolute path" ;;
esac

template_dir="$app_dir/infra/systemd"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/studytube-units.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

render_unit() {
  local template_path="$1"
  local output_path="$2"
  local content
  content="$(<"$template_path")"
  content="${content//@APP_DIR@/$app_dir}"
  content="${content//@APP_USER@/$app_user}"
  content="${content//@APP_GROUP@/$app_group}"
  content="${content//@NODE_BIN@/$node_bin}"
  content="${content//@COURSE_CUTOVER_MODE@/$course_cutover_mode}"
  printf '%s\n' "$content" >"$output_path"
}

render_unit \
  "$template_dir/studytube-api.service.in" \
  "$temporary_dir/studytube-api.service"
render_unit \
  "$template_dir/studytube-ai.service.in" \
  "$temporary_dir/studytube-ai.service"
render_unit \
  "$template_dir/studytube-worker.service.in" \
  "$temporary_dir/studytube-worker.service"

sudo install -d -o root -g root -m 755 /var/www/studytube/releases
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-api.service" \
  /etc/systemd/system/studytube-api.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-ai.service" \
  /etc/systemd/system/studytube-ai.service
sudo install -o root -g root -m 644 \
  "$temporary_dir/studytube-worker.service" \
  /etc/systemd/system/studytube-worker.service
sudo systemctl daemon-reload
sudo systemctl enable \
  studytube-api.service \
  studytube-ai.service \
  studytube-worker.service
