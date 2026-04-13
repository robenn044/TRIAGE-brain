#!/usr/bin/env python3
import json
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2


HOST = "0.0.0.0"
PORT = int(os.getenv("TRIAGE_CAMERA_PORT", "8085"))
WIDTH = int(os.getenv("TRIAGE_CAMERA_WIDTH", "1280"))
HEIGHT = int(os.getenv("TRIAGE_CAMERA_HEIGHT", "720"))
FPS = int(os.getenv("TRIAGE_CAMERA_FPS", "30"))
JPEG_QUALITY = int(os.getenv("TRIAGE_CAMERA_JPEG_QUALITY", "85"))
DEVICE_RAW = os.getenv("TRIAGE_CAMERA_DEVICE", "0")
BOUNDARY = b"--frame\r\n"


def camera_device():
    return int(DEVICE_RAW) if DEVICE_RAW.isdigit() else DEVICE_RAW


class CameraFeed:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._capture = None
        self._frame = None
        self._last_frame_at = 0.0
        self._running = True
        self._worker = threading.Thread(target=self._loop, daemon=True)
        self._worker.start()

    def _open_capture(self):
        capture = cv2.VideoCapture(camera_device())
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        capture.set(cv2.CAP_PROP_FPS, FPS)
        return capture

    def _release_capture(self):
        if self._capture is not None:
            self._capture.release()
            self._capture = None

    def _loop(self):
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]

        while self._running:
            if self._capture is None or not self._capture.isOpened():
                self._release_capture()
                self._capture = self._open_capture()
                if not self._capture.isOpened():
                    time.sleep(1.0)
                    continue

            ok, frame = self._capture.read()
            if not ok or frame is None:
                self._release_capture()
                time.sleep(0.3)
                continue

            success, encoded = cv2.imencode(".jpg", frame, encode_params)
            if not success:
                time.sleep(0.03)
                continue

            with self._lock:
                self._frame = encoded.tobytes()
                self._last_frame_at = time.time()

            time.sleep(max(0.0, (1.0 / FPS) - 0.001))

    def get_frame(self):
        with self._lock:
            return self._frame, self._last_frame_at

    def health(self):
        _, last_frame_at = self.get_frame()
        age_ms = int((time.time() - last_frame_at) * 1000) if last_frame_at else None
        return {
            "ok": last_frame_at is not None and age_ms is not None and age_ms < 5000,
            "device": DEVICE_RAW,
            "width": WIDTH,
            "height": HEIGHT,
            "fps": FPS,
            "last_frame_age_ms": age_ms,
        }

    def stop(self):
        self._running = False
        self._release_capture()


CAMERA = CameraFeed()


class CameraHandler(BaseHTTPRequestHandler):
    server_version = "TriageBrainCamera/1.0"

    def log_message(self, format, *args):
        return

    def _send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            health = CAMERA.health()
            self._send_json(health, HTTPStatus.OK if health["ok"] else HTTPStatus.SERVICE_UNAVAILABLE)
            return

        if self.path == "/frame":
            frame, _ = CAMERA.get_frame()
            if frame is None:
                self._send_json({"ok": False, "error": "No camera frame available yet"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(frame)
            return

        if self.path == "/stream":
            self.send_response(HTTPStatus.OK)
            self.send_header("Age", "0")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()

            try:
                while True:
                    frame, _ = CAMERA.get_frame()
                    if frame is None:
                        time.sleep(0.1)
                        continue

                    self.wfile.write(BOUNDARY)
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode("utf-8"))
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
                    time.sleep(max(0.0, 1.0 / FPS))
            except (BrokenPipeError, ConnectionResetError):
                return

        self._send_json({"ok": False, "error": "Not found"}, HTTPStatus.NOT_FOUND)


def main():
    server = ThreadingHTTPServer((HOST, PORT), CameraHandler)
    print(f"TRIAGE Brain camera server listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        CAMERA.stop()
        server.server_close()


if __name__ == "__main__":
    main()
