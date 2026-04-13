# TRIAGE Brain Pi

Dashboard-only TRIAGE build for the Raspberry Pi 5 "Brain Pi". This repo removes the robot face completely and is designed to:

- boot straight into the TRIAGE dashboard
- read a local USB camera from `brain/camera/camera.py` at 30fps
- proxy that camera feed into the frontend as `/camera/stream` and `/api/camera/frame`
- call Google's Gemma 4 model from a local Node app server
- keep browser microphone STT/TTS on the Pi screen with one Chrome permission prompt

## Repo Layout

- `src/`: dashboard-only frontend
- `brain/server/index.js`: local app server and Gemma proxy
- `brain/camera/camera.py`: local USB camera server
- `brain/deploy/systemd/`: service files for Brain Pi boot
- `brain/scripts/`: install and kiosk helpers
- `brain/docs/BRAIN_PI_SETUP.md`: step-by-step Pi setup

## Local Commands

```bash
npm ci
npm run build
npm run brain:camera
npm run brain:server
```

For frontend-only development:

```bash
npm run dev
```

That Vite server proxies `/api` and `/camera` to `http://127.0.0.1:3000`.

## Environment

Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY`.

## Raspberry Pi Setup

Full setup guide: `brain/docs/BRAIN_PI_SETUP.md`
