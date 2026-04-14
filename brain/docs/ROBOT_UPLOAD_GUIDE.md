# Brain Pi Robot Upload Guide

This guide lets you switch between the original Arduino line follower and the new Brain Pi driven AI mode without physically interacting with the Arduino after setup.

## 1. Upload the dual-mode sketch to the Arduino

1. Connect the Arduino to your PC with USB.
2. Open the Arduino IDE.
3. Open:
   `brain/arduino/triage_robot_dual_mode.ino`
4. In Arduino IDE choose the correct board and COM port.
5. Click **Upload**.

What this sketch does:
- boots into `LINE` mode by default
- preserves the current line follower logic and pin layout
- accepts `LINE` / `AI` mode switching over USB serial from Brain Pi
- stops automatically if AI heartbeat messages stop arriving

## 2. Connect the Arduino to Brain Pi

1. Unplug the Arduino from your PC.
2. Plug it into Brain Pi with USB.
3. On Brain Pi, check the serial port:

```bash
ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
```

If needed, set the preferred port in `.env`:

```env
TRIAGE_ROBOT_SERIAL_PORT=/dev/ttyACM0
```

## 3. Pull the latest Brain Pi repo

On Brain Pi:

```bash
cd ~/TRIAGE-brain
git pull
npm run build
sudo systemctl restart triage-brain-app.service
```

If your app service is not installed yet, run:

```bash
npm run brain:server
```

## 4. Open the remote robot control page

Open one of these in a browser:

- local Brain Pi screen:
  `http://127.0.0.1:3000/robot-control`
- from your phone or laptop on the same Wi-Fi:
  `http://BRAIN_PI_IP:3000/robot-control`

Example:

```text
http://192.168.1.40:3000/robot-control
```

## 5. Use the switch without touching the Arduino

On the `/robot-control` page:

1. Press **Connect robot**
2. Press **Switch to line mode** to use the original line follower
3. Press **Switch to AI mode** to hand movement control to Brain Pi
4. Use the drive pad only in AI mode
5. Press **Stop now** if needed

## 6. Recommended testing order

### Test A: confirm the original follower still works

1. Place the robot on the line track.
2. Open `/robot-control`.
3. Connect the robot.
4. Switch to `LINE`.
5. Confirm it follows the line exactly like before.

### Test B: confirm AI mode works

1. Lift the wheels off the ground first.
2. Switch to `AI`.
3. Tap `Forward`, `Left`, `Right`, `Back`.
4. Confirm the motors move in short bursts.
5. Press `Stop now`.

### Test C: confirm safety timeout works

1. Keep the robot in `AI`.
2. Send one movement command.
3. Do not send another command.
4. Confirm the robot stops automatically after the short burst.

## 7. Notes

- `LINE` mode is the default at Arduino boot.
- Brain Pi never needs direct physical access to the Arduino after it is uploaded once.
- The Arduino must stay connected to Brain Pi by USB for remote switching to work.
- AI mode is still supervised and should be tested slowly in open space.
