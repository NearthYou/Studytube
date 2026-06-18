#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-/home/ubuntu/agentic-board/siwon}"
deploy_branch="${DEPLOY_BRANCH:-sw}"
interval="${AUTODEPLOY_INTERVAL:-2min}"
unit_dir="${HOME}/.config/systemd/user"
service_name="agentic-board-autodeploy.service"
timer_name="agentic-board-autodeploy.timer"

mkdir -p "$unit_dir"

cat > "${unit_dir}/${service_name}" <<EOF
[Unit]
Description=Agentic Board pull-based deploy after successful CI

[Service]
Type=oneshot
WorkingDirectory=${app_dir}
Environment=APP_DIR=${app_dir}
Environment=DEPLOY_BRANCH=${deploy_branch}
ExecStart=/usr/bin/bash ${app_dir}/scripts/ec2-autodeploy.sh
EOF

cat > "${unit_dir}/${timer_name}" <<EOF
[Unit]
Description=Run Agentic Board pull-based deploy regularly

[Timer]
OnBootSec=1min
OnUnitActiveSec=${interval}
RandomizedDelaySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

if systemctl --user daemon-reload; then
  systemctl --user enable --now "$timer_name"
  sudo loginctl enable-linger "$USER" || true
  systemctl --user list-timers "$timer_name" --no-pager
else
  cron_line="*/2 * * * * cd ${app_dir} && APP_DIR=${app_dir} DEPLOY_BRANCH=${deploy_branch} bash scripts/ec2-autodeploy.sh >> autodeploy.log 2>&1"
  (crontab -l 2>/dev/null | grep -v 'scripts/ec2-autodeploy.sh' || true; echo "$cron_line") | crontab -
  echo "systemd user timer unavailable; installed cron fallback"
fi
