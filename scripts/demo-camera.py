#!/usr/bin/env python3
"""
Demo camera simulator for testing the detection pipeline.
Simulates an IP Webcam by serving /shot.jpg with rotating video frames.

Usage: python3 scripts/demo-camera.py

Camera "Касса 1-2" URL should be: http://localhost:8080
The motion detector auto-appends /shot.jpg for IP Webcam URLs.
"""

import http.server
import glob
import os
import sys
import time

# Use extracted video frames (people walking) for realistic motion
FRAME_PATTERN = "/tmp/people-frame-*.jpg"
FALLBACK_IMAGES = [
    "/tmp/test-people.jpg",
    "/tmp/test-people2.jpg",
    "/tmp/test-people3.jpg",
    "/tmp/test-office.jpg",
]

PORT = 8080
_images_data: list[bytes] = []
_start_time = time.time()


def load_images():
    global _images_data
    # Try video frames first
    frame_files = sorted(glob.glob(FRAME_PATTERN))
    if frame_files:
        for p in frame_files:
            with open(p, "rb") as f:
                _images_data.append(f.read())
        print(f"Loaded {len(_images_data)} video frames")
        return

    # Fallback to static images
    for p in FALLBACK_IMAGES:
        if os.path.exists(p):
            with open(p, "rb") as f:
                _images_data.append(f.read())
    if not _images_data:
        print("No test images found")
        sys.exit(1)
    print(f"Loaded {len(_images_data)} static images")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/shot.jpg", "/", "/video"):
            # Rotate frames at ~10fps (natural camera speed)
            elapsed = time.time() - _start_time
            idx = int(elapsed * 10) % len(_images_data)
            frame = _images_data[idx]
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(frame)
        else:
            self.send_response(302)
            self.send_header("Location", "/shot.jpg")
            self.end_headers()

    def log_message(self, format, *args):
        pass  # quiet


if __name__ == "__main__":
    load_images()
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Demo camera on http://localhost:{PORT}/shot.jpg")
    print(f"Serving {len(_images_data)} frames, rotating every 1s")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
