"""
Test different PTZ zoom speed values to find the actual maximum.
PelcoD protocol supports zoom speed 0x00-0x33 (0-51).
Camera web UI only exposes 1-7 via slider.
"""
import requests
import time
import cv2
import numpy as np

CAM_URL = "http://192.168.1.55"
RTSP_URL = "rtsp://admin:12072000xO@192.168.1.55/live/0/MAIN"
AUTH = ("admin", "")

session = requests.Session()
session.auth = AUTH

def ptz_cmd(action, start, speed=7):
    p1 = 1 if start else 0
    p2 = speed if start else 0
    resp = session.put(
        f"{CAM_URL}/PTZ/1/{action}",
        data=f"Param1={p1}&Param2={p2}",
        headers={"If-Modified-Since": "0"},
        timeout=3,
    )
    return resp.status_code

def grab_frame():
    """Grab a single frame via RTSP."""
    cap = cv2.VideoCapture(RTSP_URL)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    for _ in range(5):  # skip buffered frames
        cap.read()
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None
    return cv2.resize(frame, (640, 360))

def mse(a, b):
    return np.mean((a.astype(float) - b.astype(float)) ** 2)

print("=== Testing zoom speeds beyond web UI range ===")
print("PelcoD zoom speed: 0x00-0x33 (0-51), web UI: 1-7")
print()

# Test speeds: 1, 7, 10, 20, 33, 51 (0x33), 63 (0x3F)
test_speeds = [1, 7, 15, 33, 51, 63, 100]

for speed in test_speeds:
    # 1. Zoom out fully first
    ptz_cmd("ZoomOut", True, 7)
    time.sleep(4)
    ptz_cmd("ZoomOut", False)
    time.sleep(1)

    # 2. Grab reference frame
    ref = grab_frame()
    if ref is None:
        print(f"Speed {speed:3d}: FAILED to grab frame")
        continue

    # 3. Zoom in for exactly 2 seconds at test speed
    status = ptz_cmd("ZoomIn", True, speed)
    time.sleep(2.0)
    ptz_cmd("ZoomIn", False)
    time.sleep(0.5)

    # 4. Grab after frame
    after = grab_frame()
    if after is None:
        print(f"Speed {speed:3d}: FAILED to grab after frame")
        continue

    diff = mse(ref, after)
    print(f"Speed {speed:3d} (0x{speed:02X}): MSE = {diff:.0f}, HTTP status = {status}")

# Reset to wide angle
print("\nResetting to wide angle...")
ptz_cmd("ZoomOut", True, 7)
time.sleep(5)
ptz_cmd("ZoomOut", False)
print("Done.")
