#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/TRIAGE-brain}"

sudo apt update
sudo apt install -y git nodejs npm python3 python3-pip python3-opencv v4l-utils chromium-browser

cd "$ROOT_DIR"
npm ci
npm run build

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ".env created from .env.example. Add your GEMINI_API_KEY before starting services."
fi

echo "Brain Pi app files installed in $ROOT_DIR"
