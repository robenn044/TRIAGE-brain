#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/TRIAGE-brain}"
SERVICE_DIR="/etc/systemd/system"

sudo cp "$ROOT_DIR/brain/deploy/systemd/triage-brain-camera.service" "$SERVICE_DIR/"
sudo cp "$ROOT_DIR/brain/deploy/systemd/triage-brain-app.service" "$SERVICE_DIR/"
sudo systemctl daemon-reload
sudo systemctl enable --now triage-brain-camera.service
sudo systemctl enable --now triage-brain-app.service

echo "Brain Pi services installed from $ROOT_DIR"
