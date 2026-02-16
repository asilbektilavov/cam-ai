"""
CamAI Line Crossing Service — body detection + tripwire + face recognition.

Watches cameras with purpose='line_crossing', detects bodies via YOLO,
tracks them with centroid tracker, and when a body crosses the configured
tripwire line, triggers face recognition and reports attendance.

Works autonomously without the browser.
Supports GPU (CUDA/MPS) and CPU automatically.

Port: 8004
"""

from __future__ import annotations

import io
import os
import sys
import time
import json
import base64
import logging
import threading
from typing import Optional

import cv2
import numpy as np
import face_recognition
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from line_detector import LineCrossingDetector
from face_recognizer import FaceRecognizer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CAM_AI_API_URL = os.getenv("CAM_AI_API_URL", "http://localhost:3000")
API_KEY = os.getenv("ATTENDANCE_API_KEY", "")
PORT = int(os.getenv("LINE_CROSSING_PORT", "8004"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("line-crossing")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="CamAI Line Crossing Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_face_recognizer = FaceRecognizer()

# Camera detectors: cameraId -> LineCrossingDetector thread
_detectors: dict[str, LineCrossingDetector] = {}
_detectors_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Employee sync
# ---------------------------------------------------------------------------


def _download_and_encode_photo(photo_url: str) -> Optional[np.ndarray]:
    """Download employee photo and extract face encoding."""
    try:
        full_url = photo_url if photo_url.startswith("http") else f"{CAM_AI_API_URL}{photo_url}"
        resp = httpx.get(full_url, timeout=10)
        if resp.status_code != 200:
            return None
        nparr = np.frombuffer(resp.content, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return None
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb)
        if not encodings:
            return None
        return encodings[0]
    except Exception as e:
        log.warning("Failed to encode photo %s: %s", photo_url, e)
        return None


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    with _detectors_lock:
        cameras = {}
        for cid, det in _detectors.items():
            cameras[cid] = {
                "alive": det.is_alive(),
                "fps": round(det.fps, 1),
                "bodies": det.bodies_detected,
                "crossings": det.crossings_detected,
                "faces": det.faces_recognized,
            }
    return {
        "status": "ok",
        "service": "line-crossing",
        "cameras": cameras,
    }


@app.post("/cameras/start")
async def start_camera(data: dict):
    """Start watching a camera for line crossings.

    Body: {cameraId, streamUrl, tripwireLine: {x1,y1,x2,y2,enabled}, direction}
    """
    camera_id = data.get("cameraId")
    stream_url = data.get("streamUrl")
    tripwire = data.get("tripwireLine")
    direction = data.get("direction", "entry")

    if not camera_id or not stream_url:
        raise HTTPException(400, "cameraId and streamUrl required")
    if not tripwire or not tripwire.get("enabled"):
        raise HTTPException(400, "tripwireLine must be enabled with x1,y1,x2,y2")

    for key in ("x1", "y1", "x2", "y2"):
        if key not in tripwire:
            raise HTTPException(400, f"tripwireLine missing {key}")

    with _detectors_lock:
        if camera_id in _detectors:
            # Stop existing
            _detectors[camera_id].stop()
            _detectors[camera_id].join(timeout=5)

        detector = LineCrossingDetector(
            camera_id=camera_id,
            stream_url=stream_url,
            tripwire=tripwire,
            direction=direction,
            face_recognizer=_face_recognizer,
            api_url=CAM_AI_API_URL,
        )
        detector.start()
        _detectors[camera_id] = detector

    log.info("Started line crossing detector for camera %s", camera_id)
    return {"status": "started", "cameraId": camera_id}


@app.post("/cameras/stop")
async def stop_camera(data: dict):
    """Stop watching a camera."""
    camera_id = data.get("cameraId")
    if not camera_id:
        raise HTTPException(400, "cameraId required")

    with _detectors_lock:
        det = _detectors.pop(camera_id, None)

    if det:
        det.stop()
        det.join(timeout=5)
        log.info("Stopped line crossing detector for camera %s", camera_id)
        return {"status": "stopped", "cameraId": camera_id}
    else:
        return {"status": "not_running", "cameraId": camera_id}


@app.post("/employees/sync")
async def sync_employees(data: list[dict]):
    """Sync known employees for face recognition.

    Body: [{id, name, photoUrl}]
    """
    employees = []
    for emp in data:
        emp_id = emp.get("id")
        name = emp.get("name")
        photo_url = emp.get("photoUrl")

        if not emp_id or not name:
            continue

        if photo_url:
            encoding = _download_and_encode_photo(photo_url)
            if encoding is not None:
                employees.append({
                    "id": emp_id,
                    "name": name,
                    "encoding": encoding,
                })
                log.info("Loaded employee: %s (%s)", name, emp_id)
            else:
                log.warning("No face found for employee: %s", name)

    _face_recognizer.update_employees(employees)
    return {"status": "ok", "loaded": len(employees)}


@app.get("/cameras/{camera_id}/events")
async def get_events(camera_id: str):
    """Get recent crossing events for browser overlay (polling endpoint)."""
    with _detectors_lock:
        det = _detectors.get(camera_id)
    if not det:
        return {"events": []}
    return {"events": det.get_recent_events()}


# ---------------------------------------------------------------------------
# Startup: auto-recover cameras
# ---------------------------------------------------------------------------

def _recover_cameras():
    """On startup, fetch line_crossing cameras from CamAI API and start them."""
    time.sleep(3)  # wait for Next.js to be ready
    try:
        resp = httpx.get(
            f"{CAM_AI_API_URL}/api/line-crossing/cameras",
            headers={**({"x-api-key": API_KEY} if API_KEY else {})},
            timeout=10,
        )
        if resp.status_code != 200:
            log.warning("Failed to fetch line_crossing cameras: %s", resp.status_code)
            return

        cameras = resp.json()
        if not cameras:
            log.info("No line_crossing cameras to recover")
            return

        # First sync employees
        try:
            emp_resp = httpx.get(
                f"{CAM_AI_API_URL}/api/attendance/employees",
                headers={**({"x-api-key": API_KEY} if API_KEY else {})},
                timeout=10,
            )
            if emp_resp.status_code == 200:
                emp_data = emp_resp.json()
                employees = emp_data if isinstance(emp_data, list) else emp_data.get("employees", [])
                if employees:
                    # Download and encode
                    encoded = []
                    for emp in employees:
                        photo = emp.get("photoPath") or emp.get("photoUrl")
                        if not photo:
                            continue
                        encoding = _download_and_encode_photo(photo)
                        if encoding is not None:
                            encoded.append({
                                "id": emp["id"],
                                "name": emp["name"],
                                "encoding": encoding,
                            })
                    _face_recognizer.update_employees(encoded)
        except Exception as e:
            log.warning("Failed to sync employees on recovery: %s", e)

        # Start detectors
        for cam in cameras:
            tripwire = cam.get("tripwireLine")
            if not tripwire or not tripwire.get("enabled"):
                continue

            with _detectors_lock:
                if cam["id"] in _detectors:
                    continue

                detector = LineCrossingDetector(
                    camera_id=cam["id"],
                    stream_url=cam["streamUrl"],
                    tripwire=tripwire,
                    direction=cam.get("direction", "entry"),
                    face_recognizer=_face_recognizer,
                    api_url=CAM_AI_API_URL,
                )
                detector.start()
                _detectors[cam["id"]] = detector
                log.info("Recovered line-crossing camera: %s (%s)", cam["name"], cam["id"])

    except Exception as e:
        log.error("Camera recovery failed: %s", e)


@app.on_event("startup")
async def on_startup():
    threading.Thread(target=_recover_cameras, daemon=True).start()
    log.info("Line Crossing Service started on port %d", PORT)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
