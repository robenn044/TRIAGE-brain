#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/TRIAGE-brain}"
SERVICE_DIR="/etc/systemd/system"
CURRENT_USER="${SUDO_USER:-$USER}"

render_unit() {
  local template_path="$1"
  local output_path="$2"

  sed \
    -e "s|__TRIAGE_USER__|${CURRENT_USER}|g" \
    -e "s|__TRIAGE_ROOT__|${ROOT_DIR}|g" \
    "$template_path" | sudo tee "$output_path" > /dev/null
}

render_unit "$ROOT_DIR/brain/deploy/systemd/triage-brain-camera.service" "$SERVICE_DIR/triage-brain-camera.service"
render_unit "$ROOT_DIR/brain/deploy/systemd/triage-brain-app.service" "$SERVICE_DIR/triage-brain-app.service"
sudo systemctl daemon-reload
sudo systemctl enable --now triage-brain-camera.service
sudo systemctl enable --now triage-brain-app.service

echo "Brain Pi services installed for user ${CURRENT_USER} from $ROOT_DIR"
