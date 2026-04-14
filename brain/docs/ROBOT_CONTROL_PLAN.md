# Brain Pi Robot Control Plan

This robot must support two modes without adding hardware:

1. `LINE`
   The Arduino keeps the original line follower behavior.
   This is the safe fallback mode and should remain the default.

2. `AI`
   Brain Pi takes over motion over the USB serial link.
   This is a supervised low-speed mode for development, testing, and constrained autonomy experiments.

## Core Rule

The Pi never replaces the Arduino as the motor safety layer.

- Arduino still owns the motor pins.
- Arduino still enforces stop behavior.
- Brain Pi only sends high-level motion commands in `AI` mode.

## Current Architecture

- `brain/arduino/triage_robot_dual_mode.ino`
  Dual-mode Arduino sketch with unchanged line follower logic inside `LINE` mode.
- `brain/server/robot-controller.js`
  USB serial controller for the Arduino.
- `brain/server/index.js`
  HTTP API for robot connect, mode, status, and drive commands.
- `src/components/DashboardPanel.tsx`
  Compact Brain Pi robot test panel.

## Serial Protocol

Brain Pi sends newline-delimited commands:

- `MODE LINE`
- `MODE AI`
- `DRIVE FWD`
- `DRIVE BACK`
- `DRIVE LEFT`
- `DRIVE RIGHT`
- `DRIVE STOP`
- `PING`
- `STATUS`

Arduino replies with:

- `OK MODE ...`
- `OK DRIVE ...`
- `STATE MODE=... DRIVE=... DIST=...`
- `WARN ...`
- `ERR ...`

## Safety Behavior

- Arduino boots in `LINE` mode.
- `AI` mode requires an explicit mode switch from Brain Pi.
- `AI` mode has a heartbeat timeout.
- If the Pi stops sending `PING`, Arduino stops the motors.
- If the ultrasonic sensor sees a close obstacle during forward AI movement, Arduino stops.

## What AI Mode Can Realistically Do Right Now

With the current hardware only:

- supervised manual drive testing
- short movement bursts from the dashboard
- future camera-assisted stop / turn suggestions
- future object-approach experiments at very low speed

It cannot safely provide:

- precise tourist following in crowds
- reliable person re-identification
- accurate relative positioning like AirTag/UWB
- robust autonomous navigation in unstructured public spaces

## Development Phases

### Phase 1: Implemented in this repo

- dual-mode Arduino sketch
- Brain Pi serial controller
- dashboard mode switching and manual drive panel
- safety heartbeat

### Phase 2: Next realistic step

- log camera frames plus robot state during AI drive tests
- add a simple vision decision loop:
  - obstacle ahead -> stop
  - clear corridor -> allow short forward burst
  - target offset left/right -> small corrective turns
- keep every motion short and reversible

### Phase 3: Guided tour experiments

- cloud sends structured intents only:
  - `FOLLOW_FOR_2M`
  - `STOP_AND_LOOK`
  - `APPROACH_OBJECT`
  - `RETURN_TO_LINE_MODE`
- Brain Pi converts those intents into tiny AI motion bursts
- operator can always flip back to `LINE`

## Testing Flow

1. Flash `triage_robot_dual_mode.ino` to Arduino.
2. Connect Arduino to Brain Pi by USB.
3. Open the dashboard.
4. Confirm robot USB connection.
5. Switch to `LINE` and verify original line follower still works.
6. Switch to `AI` and test:
   - forward
   - left
   - right
   - back
   - stop
7. Confirm the robot stops automatically if the Pi disconnects.

## Non-Negotiable Deployment Rules

- Keep `LINE` mode as the default startup mode.
- Treat `AI` mode as supervised until repeated real-world testing proves otherwise.
- Never let cloud text directly command continuous motor output.
- Every Brain Pi motion command should be time-bounded.
