#!/usr/bin/env python3
"""
Serve laptop webcam as an IP Webcam-compatible HTTP stream.
Endpoints: /shot.jpg (snapshot), /video (MJPEG stream)

Usage: python3 scripts/webcam-server.py [--port 8081] [--device 0]

Then add camera in CamAI with URL: http://localhost:8081
"""

import argparse
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

import cv2

lock = threading.Lock()
latest_frame: bytes | None = None
cap: cv2.VideoCapture | None = None


def capture_loop(device: int):
    global latest_frame, cap
    cap = cv2.VideoCapture(device)
    if not cap.isOpened():
        print(f"ERROR: Cannot open webcam device {device}")
        return

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Webcam opened: {w}x{h}")

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.01)
            continue
        _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        with lock:
            latest_frame = jpeg.tobytes()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/shot.jpg", "/"):
            with lock:
                frame = latest_frame
            if frame is None:
                self.send_response(503)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(frame)

        elif self.path == "/video":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while True:
                    with lock:
                        frame = latest_frame
                    if frame:
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(frame)}\r\n".encode())
                        self.wfile.write(b"\r\n")
                        self.wfile.write(frame)
                        self.wfile.write(b"\r\n")
                    time.sleep(0.033)  # ~30fps
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_response(302)
            self.send_header("Location", "/shot.jpg")
            self.end_headers()

    def log_message(self, format, *args):
        pass  # quiet


def main():
    parser = argparse.ArgumentParser(description="Webcam HTTP server")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--device", type=int, default=0)
    args = parser.parse_args()

    t = threading.Thread(target=capture_loop, args=(args.device,), daemon=True)
    t.start()

    # Wait for first frame
    for _ in range(50):
        with lock:
            if latest_frame is not None:
                break
        time.sleep(0.1)

    server = HTTPServer(("0.0.0.0", args.port), Handler)
    print(f"Webcam server on http://localhost:{args.port}/shot.jpg")
    print(f"Add camera in CamAI with URL: http://localhost:{args.port}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        if cap:
            cap.release()


if __name__ == "__main__":
    main()
