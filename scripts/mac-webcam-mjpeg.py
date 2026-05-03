#!/usr/bin/env python3
"""Tiny MJPEG webcam server for local CamAI testing.

Uses ffmpeg as the capture backend (not OpenCV's cv2.VideoCapture) — OpenCV's
AVFoundation backend can't request camera permission from a worker thread on
macOS, so it fails silently with all-black frames or "cannot open device".
ffmpeg handles AVFoundation's TCC dance correctly: macOS shows the permission
prompt the first time the binary captures from device 0.

Endpoints:
  GET /shot.jpg     → single still (matches attendance-service IP Webcam mode)
  GET /             → MJPEG multipart stream (open in browser to verify)
  GET /video        → same as / (alias used by go2rtc)

Run:
  attendance-service/venv/bin/python scripts/mac-webcam-mjpeg.py
"""
from __future__ import annotations
import sys
import time
import threading
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8090
DEVICE = "0"   # FaceTime HD on Mac (use `ffmpeg -f avfoundation -list_devices true -i ""` to confirm)
WIDTH = 1280
HEIGHT = 720
FPS = 30

_lock = threading.Lock()
_latest_jpeg: bytes | None = None
_stop = threading.Event()


def grabber():
    """Spawn ffmpeg, read MJPEG bytestream, split on SOI/EOI markers, keep latest."""
    global _latest_jpeg
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning",
        "-f", "avfoundation",
        "-framerate", str(FPS),
        "-video_size", f"{WIDTH}x{HEIGHT}",
        "-i", DEVICE,
        "-f", "mjpeg",
        "-q:v", "5",
        "pipe:1",
    ]
    print(f"[webcam] launching: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=sys.stderr, bufsize=0)
    if proc.stdout is None:
        print("[webcam] FATAL: ffmpeg stdout missing", file=sys.stderr)
        sys.exit(1)

    buf = bytearray()
    while not _stop.is_set():
        chunk = proc.stdout.read(65536)
        if not chunk:
            print("[webcam] ffmpeg exited", file=sys.stderr)
            break
        buf.extend(chunk)
        # Walk through buffer extracting full JPEGs (FF D8 ... FF D9)
        while True:
            soi = buf.find(b"\xff\xd8")
            if soi < 0:
                buf.clear()
                break
            eoi = buf.find(b"\xff\xd9", soi + 2)
            if eoi < 0:
                if soi > 0:
                    del buf[:soi]
                break
            jpeg = bytes(buf[soi:eoi + 2])
            del buf[:eoi + 2]
            with _lock:
                _latest_jpeg = jpeg

    try:
        proc.terminate()
    except Exception:
        pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return  # quiet

    def do_GET(self):  # noqa: N802
        if self.path == "/shot.jpg":
            with _lock:
                jpeg = _latest_jpeg
            if jpeg is None:
                self.send_error(503, "no frame yet")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(jpeg)
            return

        if self.path in ("/", "/stream", "/video"):
            self.send_response(200)
            boundary = "frame"
            self.send_header(
                "Content-Type", f"multipart/x-mixed-replace; boundary={boundary}"
            )
            self.end_headers()
            try:
                while not _stop.is_set():
                    with _lock:
                        jpeg = _latest_jpeg
                    if jpeg:
                        self.wfile.write(f"--{boundary}\r\n".encode())
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                        self.wfile.write(jpeg)
                        self.wfile.write(b"\r\n")
                    time.sleep(1.0 / FPS)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        self.send_error(404)


def main():
    threading.Thread(target=grabber, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[webcam] serving on http://localhost:{PORT}")
    print(f"[webcam] still:   http://localhost:{PORT}/shot.jpg")
    print(f"[webcam] stream:  http://localhost:{PORT}/  (open in browser)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _stop.set()
        server.shutdown()


if __name__ == "__main__":
    main()
