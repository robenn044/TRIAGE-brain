# Brain Pi Setup

This build is for the Raspberry Pi 5 that powers the live TRIAGE dashboard. It does not include the robot face.

## 1. Flash Raspberry Pi OS

- Use Raspberry Pi OS (64-bit) with Desktop, Bookworm.
- Set hostname to `brain-pi`.
- Enable SSH.
- Configure Wi-Fi and your username/password.

## 2. Clone The Repo

```bash
cd ~
git clone https://github.com/your-user/TRIAGE-brain.git
cd TRIAGE-brain
```

## 3. Install Packages

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git nodejs npm python3 python3-pip python3-opencv v4l-utils chromium
```

## 4. Install App Dependencies

```bash
npm ci
cp .env.example .env
```

Edit `.env` and add:

```env
GEMINI_API_KEY=your_real_google_ai_key
```

## 5. Confirm The USB Camera

Plug in the webcam and run:

```bash
v4l2-ctl --list-devices
ls /dev/video*
```

Expected result:
- your USB webcam appears
- `/dev/video0` exists, or update `TRIAGE_CAMERA_DEVICE` in `.env`

## 6. Build The Frontend

```bash
npm run build
```

## 7. Test The Camera Service

Terminal 1:

```bash
npm run brain:camera
```

Terminal 2:

```bash
curl http://127.0.0.1:8085/health
curl http://127.0.0.1:8085/frame --output frame.jpg
```

Expected result:
- `/health` returns `ok: true`
- `frame.jpg` contains a fresh webcam snapshot

## 8. Test The App Server

Terminal 3:

```bash
npm run brain:server
```

Then test:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/camera/health
curl http://127.0.0.1:3000/api/camera/frame --output proxied-frame.jpg
```

Expected result:
- `/health` returns app status
- `/api/camera/health` proxies the camera health
- `/api/camera/frame` returns a webcam frame through the app server

## 9. Open The Dashboard

On the Pi:

```bash
chromium http://127.0.0.1:3000/ --start-maximized
```

Expected result:
- dashboard opens directly
- no robot face page appears
- local camera stream fills the preview
- mic asks for permission once

## 10. Install Systemd Services

Install and render the services for the current user automatically:

```bash
bash brain/scripts/install-services.sh
```

Check status:

```bash
systemctl status triage-brain-camera.service
systemctl status triage-brain-app.service
```

## 11. Enable Kiosk Boot

Run:

```bash
bash brain/scripts/setup-kiosk.sh http://127.0.0.1:3000/
sudo reboot
```

Expected result after reboot:
- Pi auto-logs in
- Chromium launches in kiosk mode
- TRIAGE opens directly to the dashboard

## 12. Final Validation

After reboot:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/camera/health
```

Manual checks:
- live camera stream is visible
- mic can be enabled once and reused after refresh
- speech recognition restarts after each answer
- Gemma replies do not show thinking process or prompt text
