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
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CAM_AI_API_URL = os.getenv("CAM_AI_API_URL", "http://localhost:3000")
API_KEY = os.getenv("ATTENDANCE_API_KEY", "")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "0.5"))  # seconds between frames
MATCH_TOLERANCE = float(os.getenv("MATCH_TOLERANCE", "0.55"))  # lower = stricter
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "120"))  # 2 min cooldown per (person, camera)
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

# Search persons: list of {id, name, encoding (np.ndarray), integrationId}
_search_persons: list[dict] = []
_search_persons_lock = threading.Lock()

# Camera watchers: cameraId -> CameraWatcher thread
_watchers: dict[str, "CameraWatcher"] = {}
_watchers_lock = threading.Lock()

# Cooldown tracker: (personId, cameraId) -> last_event_timestamp
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
        # Clear cooldowns for this person on ALL other cameras
        # so they can be re-recorded there after switching cameras
        to_remove = [k for k in _cooldowns if k[0] == employee_id and k[1] != camera_id]
        for k in to_remove:
            del _cooldowns[k]

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
                headers={"x-attendance-sync": "true", **({"x-api-key": API_KEY} if API_KEY else {})},
                timeout=10,
            )
            if resp.status_code >= 400:
                log.warning("API returned %s: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            log.warning("Failed to push event: %s", e)

    threading.Thread(target=_push, daemon=True).start()
    log.info("ATTENDANCE: %s %s (%s) via camera %s (conf=%.2f)",
             direction.upper(), employee_name, employee_id, camera_id, confidence)


def _report_search_sighting(person_id: str, person_name: str, camera_id: str,
                             confidence: float, frame: np.ndarray,
                             bbox: tuple[int, int, int, int] | None = None):
    """Report a search person sighting to the CamAI API."""
    key = (person_id, camera_id)
    now = time.time()

    with _cooldowns_lock:
        last = _cooldowns.get(key, 0)
        if now - last < COOLDOWN_SECONDS:
            return  # skip duplicate
        _cooldowns[key] = now

    # Draw bbox on snapshot if available
    snapshot_frame = frame.copy()
    if bbox:
        top, right, bottom, left = bbox
        cv2.rectangle(snapshot_frame, (left, top), (right, bottom), (0, 0, 255), 2)
        cv2.putText(snapshot_frame, person_name, (left, top - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

    snapshot_b64 = _frame_to_b64_jpeg(snapshot_frame, max_side=640)

    # Push to CamAI API (non-blocking)
    def _push():
        try:
            resp = httpx.post(
                f"{CAM_AI_API_URL}/api/person-search/{person_id}/sightings",
                json={
                    "cameraId": camera_id,
                    "confidence": round(confidence, 4),
                    "snapshot": snapshot_b64,
                },
                headers={"x-attendance-sync": "true", **({"x-api-key": API_KEY} if API_KEY else {})},
                timeout=10,
            )
            if resp.status_code >= 400:
                log.warning("Sighting API returned %s: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            log.warning("Failed to push sighting: %s", e)

    threading.Thread(target=_push, daemon=True).start()
    log.info("SEARCH SIGHTING: %s (%s) via camera %s (conf=%.2f)",
             person_name, person_id, camera_id, confidence)


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

class FrameGrabber(threading.Thread):
    """Background thread that continuously reads from RTSP/HTTP and keeps only the latest frame."""

    def __init__(self, stream_url: str, camera_id: str):
        super().__init__(daemon=True)
        self.stream_url = stream_url
        self.camera_id = camera_id
        self._stop_event = threading.Event()
        self._frame: Optional[np.ndarray] = None
        self._frame_lock = threading.Lock()
        self._connected = False
        # Detect IP Webcam (HTTP without explicit video path)
        self._is_ipwebcam = (
            stream_url.startswith("http://") and
            not stream_url.endswith(("/video", "/stream", ".mjpg", ".mjpeg"))
        )

    def stop(self):
        self._stop_event.set()

    @property
    def stopped(self) -> bool:
        return self._stop_event.is_set()

    @property
    def connected(self) -> bool:
        return self._connected

    def get_latest_frame(self) -> Optional[np.ndarray]:
        """Return the latest frame and clear it (so same frame isn't processed twice)."""
        with self._frame_lock:
            frame = self._frame
            self._frame = None
            return frame

    def _grab_ipwebcam(self):
        """Grab frames from IP Webcam by polling /shot.jpg endpoint."""
        base = self.stream_url.rstrip("/")
        shot_url = f"{base}/shot.jpg"
        retry_count = 0
        max_retries = 10
        log.info("Grabber %s: using IP Webcam mode (%s)", self.camera_id, shot_url)

        while not self.stopped:
            try:
                resp = httpx.get(shot_url, timeout=5)
                if resp.status_code != 200:
                    retry_count += 1
                    if retry_count >= max_retries:
                        log.error("Grabber %s: max retries reached", self.camera_id)
                        break
                    log.warning("Grabber %s: HTTP %s, retry %d/%d",
                                self.camera_id, resp.status_code, retry_count, max_retries)
                    time.sleep(5)
                    continue

                nparr = np.frombuffer(resp.content, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame is None:
                    retry_count += 1
                    time.sleep(1)
                    continue

                retry_count = 0
                if not self._connected:
                    self._connected = True
                    log.info("Grabber %s: connected to %s (%dx%d)",
                             self.camera_id, shot_url, frame.shape[1], frame.shape[0])

                with self._frame_lock:
                    self._frame = frame

                time.sleep(0.3)  # ~3fps polling — avoid overloading phone camera

            except Exception as e:
                retry_count += 1
                self._connected = False
                if retry_count >= max_retries:
                    log.error("Grabber %s: max retries reached (%s)", self.camera_id, e)
                    break
                log.warning("Grabber %s: error %s, retry %d/%d",
                            self.camera_id, e, retry_count, max_retries)
                time.sleep(5)

        self._connected = False
        log.info("Grabber stopped for camera %s", self.camera_id)

    def run(self):
        if self._is_ipwebcam:
            self._grab_ipwebcam()
            return

        cap = None
        retry_count = 0
        max_retries = 10

        while not self.stopped:
            if cap is None or not cap.isOpened():
                if retry_count >= max_retries:
                    log.error("Grabber %s: max retries reached, stopping", self.camera_id)
                    break
                cap = cv2.VideoCapture(self.stream_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if self.stream_url.startswith("rtsp://"):
                    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;2000000|fflags;nobuffer"
                if not cap.isOpened():
                    retry_count += 1
                    self._connected = False
                    log.warning("Grabber %s: cannot open, retry %d/%d in 5s",
                                self.camera_id, retry_count, max_retries)
                    time.sleep(5)
                    continue
                retry_count = 0
                self._connected = True
                log.info("Grabber %s: connected to %s", self.camera_id, self.stream_url)

            ret, frame = cap.read()
            if not ret or frame is None:
                log.warning("Grabber %s: frame read failed, reconnecting...", self.camera_id)
                cap.release()
                cap = None
                self._connected = False
                time.sleep(2)
                continue

            # Always overwrite with the latest frame
            with self._frame_lock:
                self._frame = frame

        if cap is not None:
            cap.release()
        self._connected = False
        log.info("Grabber stopped for camera %s", self.camera_id)


class CameraWatcher(threading.Thread):
    """Continuously reads frames from a camera and detects/matches faces."""

    def __init__(self, camera_id: str, stream_url: str, direction: str):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.stream_url = stream_url
        self.direction = direction  # "entry", "exit", or "search"
        self._stop_event = threading.Event()
        self.fps = 0.0
        self.last_frame_time = 0.0
        self.faces_detected = 0
        self.matches_found = 0
        # Annotated frame for MJPEG streaming
        self._annotated_frame: Optional[bytes] = None
        self._frame_lock = threading.Lock()

    def stop(self):
        self._stop_event.set()

    @property
    def stopped(self) -> bool:
        return self._stop_event.is_set()

    def get_frame(self) -> Optional[bytes]:
        """Return latest annotated JPEG frame."""
        with self._frame_lock:
            return self._annotated_frame

    def _push_face_events(self, faces: list[dict]):
        """Send face detection events to CamAI API for browser overlay rendering."""
        try:
            httpx.post(
                f"{CAM_AI_API_URL}/api/attendance/face-events",
                json={"cameraId": self.camera_id, "faces": faces},
                headers={"x-attendance-sync": "true"},
                timeout=5,
            )
        except Exception as e:
            log.debug("Failed to push face events: %s", e)

    def run(self):
        log.info("Starting watcher for camera %s (%s) direction=%s",
                 self.camera_id, self.stream_url, self.direction)

        # Start background frame grabber
        grabber = FrameGrabber(self.stream_url, self.camera_id)
        grabber.start()
        first_frame_logged = False

        while not self.stopped:
            frame = grabber.get_latest_frame()
            if frame is None:
                if grabber.stopped:
                    log.error("Camera %s: grabber died, stopping watcher", self.camera_id)
                    break
                time.sleep(0.05)  # wait for frame
                continue

            if not first_frame_logged:
                first_frame_logged = True
                log.info("Camera %s: first frame received (%dx%d)", self.camera_id, frame.shape[1], frame.shape[0])

            t0 = time.time()
            h, w = frame.shape[:2]

            # Convert BGR -> RGB for face_recognition
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Downscale for faster CNN detection, keep scale for bbox mapping
            max_width = 400
            if w > max_width:
                scale = max_width / w
                small = cv2.resize(rgb, (max_width, int(h * scale)))
            else:
                scale = 1.0
                small = rgb

            locations = face_recognition.face_locations(small, model="cnn")
            detect_time = time.time() - t0

            if not locations:
                log.debug("Camera %s: no faces (%.1fs)", self.camera_id, detect_time)
                # No faces — send empty once to clear browser overlays
                if hasattr(self, '_had_faces') and self._had_faces:
                    self._push_face_events([])
                    self._had_faces = False
                elapsed = time.time() - t0
                self.fps = 1.0 / max(elapsed + POLL_INTERVAL, 0.001)
                self.last_frame_time = time.time()
                time.sleep(POLL_INTERVAL)
                continue

            # Map locations back to original resolution for encoding
            if scale != 1.0:
                locations = [
                    (int(top / scale), int(right / scale), int(bottom / scale), int(left / scale))
                    for top, right, bottom, left in locations
                ]

            encodings = face_recognition.face_encodings(rgb, locations)
            self.faces_detected += len(encodings)
            log.info("Camera %s: detected %d face(s)", self.camera_id, len(encodings))

            is_search = self.direction == "search"

            # Load employee encodings (for attendance cameras)
            emp_encodings = emp_ids = emp_names = []
            if not is_search:
                with _employees_lock:
                    emp_encodings = [e["encoding"] for e in _employees] if _employees else []
                    emp_ids = [e["id"] for e in _employees] if _employees else []
                    emp_names = [e["name"] for e in _employees] if _employees else []

            # Load search person encodings (for ALL cameras)
            sp_encodings = sp_ids = sp_names = []
            with _search_persons_lock:
                sp_encodings = [p["encoding"] for p in _search_persons] if _search_persons else []
                sp_ids = [p["id"] for p in _search_persons] if _search_persons else []
                sp_names = [p["name"] for p in _search_persons] if _search_persons else []

            face_events: list[dict] = []

            for i, enc in enumerate(encodings):
                top, right, bottom, left = locations[i]

                matched_name: str | None = None
                confidence = 0.0

                # 1) Check search persons first (highest priority — wanted people)
                if sp_encodings:
                    sp_distances = face_recognition.face_distance(sp_encodings, enc)
                    sp_best_idx = int(np.argmin(sp_distances))
                    sp_best_dist = sp_distances[sp_best_idx]
                    log.debug("Camera %s: search dist=%.3f (tol=%.2f) for %s",
                              self.camera_id, sp_best_dist, MATCH_TOLERANCE, sp_names[sp_best_idx])

                    if sp_best_dist <= MATCH_TOLERANCE:
                        matched_name = sp_names[sp_best_idx]
                        confidence = 1.0 - sp_best_dist
                        _report_search_sighting(
                            sp_ids[sp_best_idx],
                            matched_name,
                            self.camera_id,
                            confidence,
                            frame,
                            bbox=(top, right, bottom, left),
                        )
                        self.matches_found += 1

                # 2) Check employees (only for attendance cameras, and only if not already matched as search person)
                if not matched_name and emp_encodings:
                    emp_distances = face_recognition.face_distance(emp_encodings, enc)
                    emp_best_idx = int(np.argmin(emp_distances))
                    emp_best_dist = emp_distances[emp_best_idx]
                    log.debug("Camera %s: emp dist=%.3f (tol=%.2f) for %s",
                              self.camera_id, emp_best_dist, MATCH_TOLERANCE, emp_names[emp_best_idx])

                    if emp_best_dist <= MATCH_TOLERANCE:
                        matched_name = emp_names[emp_best_idx]
                        confidence = 1.0 - emp_best_dist
                        snapshot = _frame_to_b64_jpeg(frame)
                        direction = "check_in" if self.direction == "entry" else "check_out"
                        _report_event(
                            emp_ids[emp_best_idx],
                            matched_name,
                            self.camera_id,
                            direction,
                            confidence,
                            snapshot,
                        )
                        self.matches_found += 1

                # Normalized bbox (0-1) for browser overlay
                face_events.append({
                    "bbox": {
                        "x": round(left / w, 4),
                        "y": round(top / h, 4),
                        "w": round((right - left) / w, 4),
                        "h": round((bottom - top) / h, 4),
                    },
                    "name": matched_name,
                    "confidence": round(confidence if matched_name else 0.5, 4),
                })

            # Push face events to CamAI API for browser overlay
            self._had_faces = True
            self._push_face_events(face_events)

            elapsed = time.time() - t0
            self.fps = 1.0 / max(elapsed, 0.001)
            self.last_frame_time = time.time()

            # Throttle
            sleep_time = max(0, POLL_INTERVAL - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        grabber.stop()
        grabber.join(timeout=3)
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
        "search_persons_loaded": len(_search_persons),
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


def _download_and_encode(emp_id: str, emp_name: str, photo_url: str) -> dict | None:
    """Download employee photo from CamAI API and extract face encoding."""
    try:
        resp = httpx.get(photo_url, timeout=15)
        if resp.status_code != 200:
            log.warning("Employee %s (%s): photo download failed HTTP %s", emp_name, emp_id, resp.status_code)
            return None
        nparr = np.frombuffer(resp.content, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            log.warning("Employee %s (%s): cannot decode photo", emp_name, emp_id)
            return None
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb)
        if not encodings:
            log.warning("Employee %s (%s): no face found in photo", emp_name, emp_id)
            return None
        return {"id": emp_id, "name": emp_name, "encoding": encodings[0]}
    except Exception as e:
        log.warning("Employee %s (%s): error %s", emp_name, emp_id, e)
        return None


@app.post("/employees/sync")
async def sync_employees(employees: list[dict]):
    """
    Receive employee list from CamAI API.
    Each item: {id, name, photoUrl: str} — downloads photo and extracts encoding via dlib.
    """
    loaded = []
    errors = []
    for emp in employees:
        photo_url = emp.get("photoUrl")
        if not photo_url:
            errors.append(f"{emp.get('id', '?')}: missing photoUrl")
            continue
        result = _download_and_encode(emp["id"], emp.get("name", "Unknown"), photo_url)
        if result:
            loaded.append(result)
        else:
            errors.append(f"{emp.get('id', '?')}: face extraction failed")

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


@app.post("/search-persons/sync")
async def sync_search_persons(persons: list[dict]):
    """
    Receive search persons list from CamAI API.
    Each item: {id, name, descriptor: list[float], integrationId: str|null}
    """
    loaded = []
    errors = []
    for p in persons:
        descriptor = p.get("descriptor")
        if not descriptor or not isinstance(descriptor, list):
            errors.append(f"{p.get('id', '?')}: missing or invalid descriptor")
            continue
        try:
            encoding = np.array(descriptor, dtype=np.float64)
            if encoding.shape != (128,):
                errors.append(f"{p.get('id', '?')}: descriptor not 128-D (got {encoding.shape})")
                continue
            loaded.append({
                "id": p["id"],
                "name": p.get("name", "Unknown"),
                "encoding": encoding,
                "integrationId": p.get("integrationId"),
            })
        except Exception as e:
            errors.append(f"{p.get('id', '?')}: {e}")

    with _search_persons_lock:
        _search_persons.clear()
        _search_persons.extend(loaded)

    log.info("Synced %d search persons (%d errors)", len(loaded), len(errors))
    return {"loaded": len(loaded), "errors": errors}


@app.post("/cameras/start")
async def start_camera(camera_id: str = Form(...),
                       stream_url: str = Form(...),
                       direction: str = Form("entry")):
    """Start watching a camera for face recognition."""
    if direction not in ("entry", "exit", "search"):
        raise HTTPException(status_code=400, detail="direction must be 'entry', 'exit', or 'search'")

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


@app.get("/cameras/{camera_id}/stream")
async def camera_stream(camera_id: str):
    """MJPEG stream of annotated frames with face bounding boxes."""
    with _watchers_lock:
        watcher = _watchers.get(camera_id)
    if watcher is None or not watcher.is_alive():
        raise HTTPException(status_code=404, detail="Camera watcher not running")

    def generate():
        last_frame = None
        while True:
            frame = watcher.get_frame()
            if frame is not None and frame is not last_frame:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                )
                last_frame = frame
            time.sleep(0.05)  # ~20 fps max
            if watcher.stopped:
                break

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


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

    # Try to sync employees from API — download photos and extract dlib encodings
    def _initial_sync():
        time.sleep(3)  # wait for API to be ready
        try:
            headers = {"x-attendance-sync": "true"}
            if API_KEY:
                headers["x-api-key"] = API_KEY
            resp = httpx.get(f"{CAM_AI_API_URL}/api/attendance/employees", headers=headers, timeout=15)
            if resp.status_code != 200:
                log.warning("Initial sync failed: HTTP %s", resp.status_code)
                return

            data = resp.json()
            employees = data if isinstance(data, list) else data.get("employees", [])
            loaded = []
            for emp in employees:
                photo_path = emp.get("photoPath")
                if not photo_path:
                    log.warning("Employee %s: no photo, skipping", emp.get("name", "?"))
                    continue
                # Download photo from CamAI API
                photo_url = f"{CAM_AI_API_URL}/api/attendance/{emp['id']}/photo"
                result = _download_and_encode(emp["id"], emp.get("name", "Unknown"), photo_url)
                if result:
                    loaded.append(result)

            with _employees_lock:
                _employees.clear()
                _employees.extend(loaded)
            log.info("Initial sync: loaded %d/%d employees with face encodings", len(loaded), len(employees))

            # Sync search persons
            _sync_search_persons(headers)

            # Auto-recover active attendance + people_search cameras
            _recover_cameras(headers)
        except Exception as e:
            log.warning("Initial sync failed: %s (will retry via /employees/sync)", e)

    def _sync_search_persons(headers: dict):
        """Load search persons from CamAI API and store their descriptors."""
        try:
            resp = httpx.get(f"{CAM_AI_API_URL}/api/person-search/descriptors", headers=headers, timeout=15)
            if resp.status_code != 200:
                log.warning("Search persons sync failed: HTTP %s", resp.status_code)
                return
            persons = resp.json()
            loaded = []
            for p in persons:
                descriptor = p.get("descriptor")
                if not descriptor:
                    continue
                try:
                    encoding = np.array(descriptor, dtype=np.float64)
                    if encoding.shape == (128,):
                        loaded.append({
                            "id": p["id"],
                            "name": p.get("name", "Unknown"),
                            "encoding": encoding,
                            "integrationId": p.get("integrationId"),
                        })
                except Exception:
                    pass

            with _search_persons_lock:
                _search_persons.clear()
                _search_persons.extend(loaded)
            log.info("Search persons sync: loaded %d persons", len(loaded))
        except Exception as e:
            log.warning("Search persons sync failed: %s", e)

    def _recover_cameras(headers: dict):
        """Restore camera watchers for cameras that were monitoring before service restart."""
        try:
            resp = httpx.get(f"{CAM_AI_API_URL}/api/attendance/cameras", headers=headers, timeout=15)
            if resp.status_code != 200:
                log.warning("Camera recovery failed: HTTP %s", resp.status_code)
                return
            cameras = resp.json()
            for cam in cameras:
                cam_id = cam["id"]
                stream_url = cam["streamUrl"]
                direction = cam.get("direction", "entry")
                with _watchers_lock:
                    if cam_id in _watchers and _watchers[cam_id].is_alive():
                        continue
                    watcher = CameraWatcher(cam_id, stream_url, direction)
                    watcher.start()
                    _watchers[cam_id] = watcher
                log.info("Recovered camera: %s (%s) direction=%s", cam.get("name", "?"), cam_id, direction)
            if cameras:
                log.info("Camera recovery: restored %d cameras", len(cameras))
        except Exception as e:
            log.warning("Camera recovery failed: %s", e)

    threading.Thread(target=_initial_sync, daemon=True).start()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
