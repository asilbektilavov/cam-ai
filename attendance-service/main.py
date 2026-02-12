"""
CamAI Attendance Service — standalone face recognition for check-in/check-out.

Connects to cameras via RTSP/HTTP, detects faces, matches against known employees,
and reports attendance events to the CamAI API.
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
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
import face_recognition
import httpx
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CAM_AI_API_URL = os.getenv("CAM_AI_API_URL", "http://localhost:3000")
API_KEY = os.getenv("ATTENDANCE_API_KEY", "")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "0.5"))  # seconds between frames
MATCH_TOLERANCE = float(os.getenv("MATCH_TOLERANCE", "0.45"))  # lower = stricter
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "300"))  # 5 min between same person events
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("attendance")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="CamAI Attendance Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

# Known employees: list of {id, name, encoding (np.ndarray)}
_employees: list[dict] = []
_employees_lock = threading.Lock()

# Camera watchers: cameraId -> CameraWatcher thread
_watchers: dict[str, "CameraWatcher"] = {}
_watchers_lock = threading.Lock()

# Cooldown tracker: (employeeId, cameraId) -> last_event_timestamp
_cooldowns: dict[tuple[str, str], float] = {}
_cooldowns_lock = threading.Lock()

# Recent attendance events (ring buffer for /status endpoint)
_recent_events: list[dict] = []
_recent_events_lock = threading.Lock()
MAX_RECENT = 100


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _report_event(employee_id: str, employee_name: str, camera_id: str,
                  direction: str, confidence: float, snapshot_b64: str | None = None):
    """Send attendance event to the CamAI API."""
    key = (employee_id, camera_id)
    now = time.time()

    with _cooldowns_lock:
        last = _cooldowns.get(key, 0)
        if now - last < COOLDOWN_SECONDS:
            return  # skip duplicate
        _cooldowns[key] = now

    event = {
        "employeeId": employee_id,
        "employeeName": employee_name,
        "cameraId": camera_id,
        "direction": direction,
        "confidence": round(confidence, 4),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "snapshot": snapshot_b64,
    }

    # Store locally
    with _recent_events_lock:
        _recent_events.append(event)
        if len(_recent_events) > MAX_RECENT:
            _recent_events.pop(0)

    # Push to CamAI API (non-blocking)
    def _push():
        try:
            resp = httpx.post(
                f"{CAM_AI_API_URL}/api/attendance/event",
                json=event,
                headers={"x-api-key": API_KEY} if API_KEY else {},
                timeout=10,
            )
            if resp.status_code >= 400:
                log.warning("API returned %s: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            log.warning("Failed to push event: %s", e)

    threading.Thread(target=_push, daemon=True).start()
    log.info("ATTENDANCE: %s %s (%s) via camera %s (conf=%.2f)",
             direction.upper(), employee_name, employee_id, camera_id, confidence)


def _frame_to_b64_jpeg(frame: np.ndarray, max_side: int = 320) -> str:
    """Encode a frame to a small base64 JPEG for snapshot storage."""
    h, w = frame.shape[:2]
    scale = min(max_side / max(h, w), 1.0)
    if scale < 1.0:
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return base64.b64encode(buf.tobytes()).decode()


# ---------------------------------------------------------------------------
# Camera Watcher — one thread per camera
# ---------------------------------------------------------------------------

class CameraWatcher(threading.Thread):
    """Continuously reads frames from a camera and detects/matches faces."""

    def __init__(self, camera_id: str, stream_url: str, direction: str):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.stream_url = stream_url
        self.direction = direction  # "entry" or "exit"
        self._stop_event = threading.Event()
        self.fps = 0.0
        self.last_frame_time = 0.0
        self.faces_detected = 0
        self.matches_found = 0

    def stop(self):
        self._stop_event.set()

    @property
    def stopped(self) -> bool:
        return self._stop_event.is_set()

    def run(self):
        log.info("Starting watcher for camera %s (%s) direction=%s",
                 self.camera_id, self.stream_url, self.direction)
        cap = None
        retry_count = 0
        max_retries = 10

        while not self.stopped:
            # Open / reconnect
            if cap is None or not cap.isOpened():
                if retry_count >= max_retries:
                    log.error("Camera %s: max retries reached, stopping", self.camera_id)
                    break
                cap = cv2.VideoCapture(self.stream_url)
                if not cap.isOpened():
                    retry_count += 1
                    log.warning("Camera %s: cannot open, retry %d/%d in 5s",
                                self.camera_id, retry_count, max_retries)
                    time.sleep(5)
                    continue
                retry_count = 0
                log.info("Camera %s: connected", self.camera_id)

            ret, frame = cap.read()
            if not ret:
                log.warning("Camera %s: frame read failed, reconnecting...", self.camera_id)
                cap.release()
                cap = None
                time.sleep(2)
                continue

            t0 = time.time()

            # Convert BGR -> RGB for face_recognition
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Downscale for speed (process at 1/2 resolution)
            small = cv2.resize(rgb, (0, 0), fx=0.5, fy=0.5)

            # Detect faces
            locations = face_recognition.face_locations(small, model="hog")
            if not locations:
                self.last_frame_time = time.time()
                time.sleep(POLL_INTERVAL)
                continue

            encodings = face_recognition.face_encodings(small, locations)
            self.faces_detected += len(encodings)

            # Match against known employees
            with _employees_lock:
                if not _employees:
                    time.sleep(POLL_INTERVAL)
                    continue
                known_encodings = [e["encoding"] for e in _employees]
                known_ids = [e["id"] for e in _employees]
                known_names = [e["name"] for e in _employees]

            for enc in encodings:
                distances = face_recognition.face_distance(known_encodings, enc)
                best_idx = int(np.argmin(distances))
                best_dist = distances[best_idx]

                if best_dist <= MATCH_TOLERANCE:
                    confidence = 1.0 - best_dist
                    snapshot = _frame_to_b64_jpeg(frame)
                    direction = "check_in" if self.direction == "entry" else "check_out"
                    _report_event(
                        known_ids[best_idx],
                        known_names[best_idx],
                        self.camera_id,
                        direction,
                        confidence,
                        snapshot,
                    )
                    self.matches_found += 1

            elapsed = time.time() - t0
            self.fps = 1.0 / max(elapsed, 0.001)
            self.last_frame_time = time.time()

            # Throttle
            sleep_time = max(0, POLL_INTERVAL - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        if cap is not None:
            cap.release()
        log.info("Watcher stopped for camera %s", self.camera_id)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    with _watchers_lock:
        cams = {cid: {
            "direction": w.direction,
            "alive": w.is_alive(),
            "fps": round(w.fps, 1),
            "faces_detected": w.faces_detected,
            "matches_found": w.matches_found,
        } for cid, w in _watchers.items()}

    return {
        "status": "ok",
        "service": "attendance",
        "employees_loaded": len(_employees),
        "cameras": cams,
        "config": {
            "poll_interval": POLL_INTERVAL,
            "match_tolerance": MATCH_TOLERANCE,
            "cooldown_seconds": COOLDOWN_SECONDS,
        },
    }


@app.get("/status")
def status():
    """Return recent attendance events."""
    with _recent_events_lock:
        events = list(_recent_events)
    return {"events": events, "total": len(events)}


@app.post("/employees/sync")
async def sync_employees(employees: list[dict]):
    """
    Receive employee list from CamAI API.
    Each item: {id, name, faceDescriptor: number[128]}
    """
    loaded = []
    errors = []
    for emp in employees:
        try:
            desc = emp.get("faceDescriptor")
            if not desc or not isinstance(desc, list):
                errors.append(f"{emp.get('id', '?')}: missing faceDescriptor")
                continue
            encoding = np.array(desc, dtype=np.float64)
            if encoding.shape != (128,):
                errors.append(f"{emp.get('id', '?')}: descriptor must be 128-D, got {encoding.shape}")
                continue
            loaded.append({
                "id": emp["id"],
                "name": emp.get("name", "Unknown"),
                "encoding": encoding,
            })
        except Exception as e:
            errors.append(f"{emp.get('id', '?')}: {e}")

    with _employees_lock:
        _employees.clear()
        _employees.extend(loaded)

    log.info("Synced %d employees (%d errors)", len(loaded), len(errors))
    return {"loaded": len(loaded), "errors": errors}


@app.post("/employees/register")
async def register_employee(
    id: str = Form(...),
    name: str = Form(...),
    photo: UploadFile = File(...),
):
    """
    Register a single employee by uploading a face photo.
    Extracts the face descriptor and stores it.
    """
    contents = await photo.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Cannot decode image")

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb)
    if not encodings:
        raise HTTPException(status_code=400, detail="No face found in image")

    encoding = encodings[0]
    with _employees_lock:
        # Remove existing if re-registering
        _employees[:] = [e for e in _employees if e["id"] != id]
        _employees.append({
            "id": id,
            "name": name,
            "encoding": encoding,
        })

    log.info("Registered employee: %s (%s)", name, id)
    return {
        "id": id,
        "name": name,
        "faceDescriptor": encoding.tolist(),
        "descriptorLength": len(encoding),
    }


@app.post("/cameras/start")
async def start_camera(camera_id: str = Form(...),
                       stream_url: str = Form(...),
                       direction: str = Form("entry")):
    """Start watching a camera for face recognition."""
    if direction not in ("entry", "exit"):
        raise HTTPException(status_code=400, detail="direction must be 'entry' or 'exit'")

    with _watchers_lock:
        if camera_id in _watchers and _watchers[camera_id].is_alive():
            return {"status": "already_running", "camera_id": camera_id}

        watcher = CameraWatcher(camera_id, stream_url, direction)
        watcher.start()
        _watchers[camera_id] = watcher

    return {"status": "started", "camera_id": camera_id, "direction": direction}


@app.post("/cameras/stop")
async def stop_camera(camera_id: str = Form(...)):
    """Stop watching a camera."""
    with _watchers_lock:
        watcher = _watchers.pop(camera_id, None)

    if watcher is None:
        raise HTTPException(status_code=404, detail="Camera watcher not found")

    watcher.stop()
    watcher.join(timeout=5)
    return {"status": "stopped", "camera_id": camera_id}


@app.post("/detect")
async def detect_faces(photo: UploadFile = File(...)):
    """
    Detect faces in an uploaded image. Returns face locations and encodings.
    Useful for testing and for the web UI to extract descriptors server-side.
    """
    contents = await photo.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Cannot decode image")

    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb, model="hog")
    encodings = face_recognition.face_encodings(rgb, locations)

    h, w = rgb.shape[:2]
    faces = []
    for loc, enc in zip(locations, encodings):
        top, right, bottom, left = loc
        faces.append({
            "bbox": {
                "x": round(left / w, 4),
                "y": round(top / h, 4),
                "w": round((right - left) / w, 4),
                "h": round((bottom - top) / h, 4),
            },
            "descriptor": enc.tolist(),
        })

    return {"faces": faces, "count": len(faces)}


@app.post("/match")
async def match_face(descriptor: list[float]):
    """Match a single 128-D descriptor against known employees."""
    enc = np.array(descriptor, dtype=np.float64)
    if enc.shape != (128,):
        raise HTTPException(status_code=400, detail=f"Expected 128-D, got {enc.shape}")

    with _employees_lock:
        if not _employees:
            return {"match": None, "reason": "no_employees_loaded"}
        known_encodings = [e["encoding"] for e in _employees]
        known_meta = [(e["id"], e["name"]) for e in _employees]

    distances = face_recognition.face_distance(known_encodings, enc)
    best_idx = int(np.argmin(distances))
    best_dist = float(distances[best_idx])

    if best_dist > MATCH_TOLERANCE:
        return {"match": None, "best_distance": round(best_dist, 4), "threshold": MATCH_TOLERANCE}

    return {
        "match": {
            "employeeId": known_meta[best_idx][0],
            "employeeName": known_meta[best_idx][1],
            "distance": round(best_dist, 4),
            "confidence": round(1.0 - best_dist, 4),
        }
    }


# ---------------------------------------------------------------------------
# Startup: auto-sync employees from CamAI API
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def _startup():
    log.info("Attendance service starting...")
    log.info("  CAM_AI_API_URL = %s", CAM_AI_API_URL)
    log.info("  POLL_INTERVAL  = %s", POLL_INTERVAL)
    log.info("  MATCH_TOLERANCE = %s", MATCH_TOLERANCE)
    log.info("  COOLDOWN_SECONDS = %s", COOLDOWN_SECONDS)

    # Try to sync employees from API
    def _initial_sync():
        time.sleep(3)  # wait for API to be ready
        try:
            headers = {"x-api-key": API_KEY} if API_KEY else {}
            resp = httpx.get(f"{CAM_AI_API_URL}/api/attendance/employees", headers=headers, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                employees = data if isinstance(data, list) else data.get("employees", [])
                loaded = []
                for emp in employees:
                    desc = emp.get("faceDescriptor")
                    if desc and isinstance(desc, (list, str)):
                        if isinstance(desc, str):
                            desc = json.loads(desc)
                        encoding = np.array(desc, dtype=np.float64)
                        if encoding.shape == (128,):
                            loaded.append({"id": emp["id"], "name": emp["name"], "encoding": encoding})
                with _employees_lock:
                    _employees.clear()
                    _employees.extend(loaded)
                log.info("Initial sync: loaded %d employees", len(loaded))
            else:
                log.warning("Initial sync failed: HTTP %s", resp.status_code)
        except Exception as e:
            log.warning("Initial sync failed: %s (will retry via /employees/sync)", e)

    threading.Thread(target=_initial_sync, daemon=True).start()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
