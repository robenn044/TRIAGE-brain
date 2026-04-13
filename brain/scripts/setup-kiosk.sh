#!/usr/bin/env bash
set -euo pipefail

APP_URL="${1:-http://127.0.0.1:3000/}"

sudo raspi-config nonint do_boot_behaviour B4
mkdir -p "$HOME/.config/labwc"

cat > "$HOME/.config/labwc/autostart" <<EOF
chromium ${APP_URL} --kiosk --noerrdialogs --disable-infobars --no-first-run --start-maximized &
EOF

echo "Kiosk autostart configured for ${APP_URL}"
