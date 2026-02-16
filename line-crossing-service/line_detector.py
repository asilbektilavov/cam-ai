"""
Line crossing detector — YOLO body detection + centroid tracking + tripwire crossing.

When a tracked body crosses the configured tripwire line, triggers face recognition
and reports attendance event.
"""

from __future__ import annotations

import logging
import time
import threading
from typing import Optional

import cv2
import numpy as np

from body_tracker import CentroidTracker
from face_recognizer import FaceRecognizer
from frame_grabber import FrameGrabber

log = logging.getLogger("line-crossing")

# YOLO detection config
YOLO_INPUT_SIZE = 640      # YOLO input resolution
DETECT_CONFIDENCE = 0.35   # Minimum confidence for person detection
PERSON_CLASS_ID = 0        # COCO class 0 = person

# Timing
POLL_INTERVAL = 0.3        # seconds between frames (~3fps)
COOLDOWN_SECONDS = 120     # per (person, camera) cooldown


def _crossed_line(prev: list[float], curr: list[float],
                  line: dict) -> bool:
    """Check if movement from prev to curr crosses the tripwire line.

    Uses cross product sign change to detect line crossing.

    Args:
        prev: [cx, cy] previous centroid (normalized 0-1)
        curr: [cx, cy] current centroid (normalized 0-1)
        line: {x1, y1, x2, y2} line endpoints (normalized 0-1)
    """
    lx1, ly1 = line["x1"], line["y1"]
    lx2, ly2 = line["x2"], line["y2"]

    dx = lx2 - lx1
    dy = ly2 - ly1

    # Cross products
    s1 = dx * (prev[1] - ly1) - dy * (prev[0] - lx1)
    s2 = dx * (curr[1] - ly1) - dy * (curr[0] - lx1)

    # Different signs = crossed the line
    return (s1 > 0) != (s2 > 0)


class LineCrossingDetector(threading.Thread):
    """Watches a camera for body line crossings and triggers face recognition.

    Architecture:
    1. YOLO detects bodies (GPU if available, else CPU)
    2. CentroidTracker tracks bodies across frames
    3. When a body centroid crosses the tripwire -> face recognition
    4. If face matches employee -> report attendance event
    """

    def __init__(self, camera_id: str, stream_url: str,
                 tripwire: dict, direction: str,
                 face_recognizer: FaceRecognizer,
                 api_url: str,
                 on_event=None):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.stream_url = stream_url
        self.tripwire = tripwire  # {x1, y1, x2, y2, enabled}
        self.direction = direction  # "entry" or "exit"
        self.face_recognizer = face_recognizer
        self.api_url = api_url
        self.on_event = on_event  # callback for event reporting

        self._stop_event = threading.Event()
        self._tracker = CentroidTracker(max_disappeared=15, max_distance=0.15)
        self._yolo = None  # lazy init
        self._cooldowns: dict[tuple[str, str], float] = {}

        # Stats
        self.fps = 0.0
        self.bodies_detected = 0
        self.crossings_detected = 0
        self.faces_recognized = 0
        self._crossing_events: list[dict] = []  # recent events for overlay
        self._events_lock = threading.Lock()

    def stop(self):
        self._stop_event.set()

    @property
    def stopped(self) -> bool:
        return self._stop_event.is_set()

    def get_recent_events(self) -> list[dict]:
        """Get recent crossing events for browser overlay."""
        with self._events_lock:
            events = list(self._crossing_events)
            return events

    def _init_yolo(self):
        """Initialize YOLO model. Auto-detects GPU availability."""
        try:
            from ultralytics import YOLO
            import torch

            model = YOLO("yolov8n.pt")

            if torch.cuda.is_available():
                model.to("cuda")
                log.info("Camera %s: YOLO using GPU (CUDA)", self.camera_id)
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                model.to("mps")
                log.info("Camera %s: YOLO using GPU (MPS/Apple)", self.camera_id)
            else:
                log.info("Camera %s: YOLO using CPU", self.camera_id)

            self._yolo = model
        except Exception as e:
            log.error("Camera %s: YOLO init failed: %s", self.camera_id, e)
            raise

    def _detect_bodies(self, frame: np.ndarray) -> list[tuple]:
        """Run YOLO person detection. Returns list of (x1, y1, x2, y2) normalized 0-1."""
        if self._yolo is None:
            return []

        h, w = frame.shape[:2]
        results = self._yolo(frame, classes=[PERSON_CLASS_ID],
                             conf=DETECT_CONFIDENCE, verbose=False,
                             imgsz=YOLO_INPUT_SIZE)

        detections = []
        for box in results[0].boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            # Normalize to 0-1
            detections.append((
                float(x1 / w),
                float(y1 / h),
                float(x2 / w),
                float(y2 / h),
            ))

        return detections

    def _check_cooldown(self, employee_id: str) -> bool:
        """Returns True if event can be reported (not in cooldown)."""
        key = (employee_id, self.camera_id)
        now = time.time()
        last = self._cooldowns.get(key, 0)
        return now - last >= COOLDOWN_SECONDS

    def _set_cooldown(self, employee_id: str):
        key = (employee_id, self.camera_id)
        self._cooldowns[key] = time.time()

    def _push_overlay_events(self, events: list[dict]):
        """Push crossing events to API for browser overlay."""
        try:
            import httpx
            httpx.post(
                f"{self.api_url}/api/line-crossing/events",
                json={"cameraId": self.camera_id, "events": events},
                headers={"x-attendance-sync": "true"},
                timeout=5,
            )
        except Exception as e:
            log.debug("Failed to push overlay events: %s", e)

    def _report_attendance(self, employee_id: str, employee_name: str,
                           confidence: float, frame: np.ndarray):
        """Report attendance event to CamAI API."""
        import httpx
        import base64

        self._set_cooldown(employee_id)

        # Create snapshot
        h, w = frame.shape[:2]
        scale = min(320 / max(h, w), 1.0)
        if scale < 1.0:
            small = cv2.resize(frame, (int(w * scale), int(h * scale)))
        else:
            small = frame
        _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
        snapshot_b64 = base64.b64encode(buf.tobytes()).decode()

        direction_str = "check_in" if self.direction == "entry" else "check_out"

        event = {
            "employeeId": employee_id,
            "employeeName": employee_name,
            "cameraId": self.camera_id,
            "direction": direction_str,
            "confidence": round(confidence, 4),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "snapshot": snapshot_b64,
        }

        def _push():
            try:
                resp = httpx.post(
                    f"{self.api_url}/api/attendance/event",
                    json=event,
                    headers={"x-attendance-sync": "true"},
                    timeout=10,
                )
                if resp.status_code >= 400:
                    log.warning("API returned %s: %s", resp.status_code, resp.text[:200])
            except Exception as e:
                log.warning("Failed to push attendance event: %s", e)

        threading.Thread(target=_push, daemon=True).start()
        log.info("LINE-CROSSING ATTENDANCE: %s %s (%s) via camera %s (conf=%.2f)",
                 direction_str.upper(), employee_name, employee_id,
                 self.camera_id, confidence)

    def run(self):
        log.info("Starting LineCrossingDetector for camera %s (%s) direction=%s",
                 self.camera_id, self.stream_url, self.direction)
        log.info("Camera %s: tripwire line (%.2f,%.2f)→(%.2f,%.2f)",
                 self.camera_id,
                 self.tripwire["x1"], self.tripwire["y1"],
                 self.tripwire["x2"], self.tripwire["y2"])

        # Init YOLO
        self._init_yolo()

        # Start frame grabber
        grabber = FrameGrabber(self.stream_url, self.camera_id)
        grabber.start()

        first_frame = False

        while not self.stopped:
            frame = grabber.get_latest_frame()
            if frame is None:
                if grabber.stopped:
                    log.error("Camera %s: grabber died", self.camera_id)
                    break
                time.sleep(0.05)
                continue

            if not first_frame:
                first_frame = True
                log.info("Camera %s: first frame (%dx%d)",
                         self.camera_id, frame.shape[1], frame.shape[0])

            t0 = time.time()
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # 1. YOLO body detection
            bodies = self._detect_bodies(frame)
            self.bodies_detected = len(bodies)

            # 2. Update tracker
            tracked = self._tracker.update(bodies)

            # 3. Check line crossings
            overlay_events = []
            for track_id, info in tracked.items():
                centroid = info["centroid"]
                prev_centroid = info["prev_centroid"]
                bbox = info["bbox"]

                # Always add body to overlay
                overlay_events.append({
                    "type": "body",
                    "bbox": {
                        "x": round(bbox[0], 4),
                        "y": round(bbox[1], 4),
                        "w": round(bbox[2] - bbox[0], 4),
                        "h": round(bbox[3] - bbox[1], 4),
                    },
                    "trackId": track_id,
                    "crossed": False,
                    "name": None,
                    "confidence": 0.0,
                })

                # Check if this body crossed the line
                if not _crossed_line(prev_centroid, centroid, self.tripwire):
                    continue

                self.crossings_detected += 1
                log.info("Camera %s: body #%d crossed line! prev=(%.2f,%.2f) curr=(%.2f,%.2f)",
                         self.camera_id, track_id,
                         prev_centroid[0], prev_centroid[1],
                         centroid[0], centroid[1])

                # 4. Face recognition in body region
                result = self.face_recognizer.recognize_in_region(
                    rgb, bbox, h, w
                )

                if result:
                    emp_id = result["employee_id"]
                    emp_name = result["name"]
                    confidence = result["confidence"]

                    # Update overlay
                    overlay_events[-1]["crossed"] = True
                    overlay_events[-1]["name"] = emp_name
                    overlay_events[-1]["confidence"] = round(confidence, 4)

                    if result.get("face_bbox"):
                        fb = result["face_bbox"]
                        overlay_events.append({
                            "type": "face",
                            "bbox": {
                                "x": round(fb[0], 4),
                                "y": round(fb[1], 4),
                                "w": round(fb[2] - fb[0], 4),
                                "h": round(fb[3] - fb[1], 4),
                            },
                            "name": emp_name,
                            "confidence": round(confidence, 4),
                        })

                    if self._check_cooldown(emp_id):
                        self.faces_recognized += 1
                        self._report_attendance(emp_id, emp_name, confidence, frame)
                    else:
                        log.debug("Camera %s: %s in cooldown, skipping", self.camera_id, emp_name)
                else:
                    log.info("Camera %s: body crossed line but no face match", self.camera_id)
                    overlay_events[-1]["crossed"] = True

            # Push overlay events
            with self._events_lock:
                self._crossing_events = overlay_events
            if overlay_events:
                self._push_overlay_events(overlay_events)
            elif hasattr(self, '_had_events') and self._had_events:
                self._push_overlay_events([])
            self._had_events = bool(overlay_events)

            elapsed = time.time() - t0
            self.fps = 1.0 / max(elapsed + POLL_INTERVAL, 0.001)

            sleep_time = max(0, POLL_INTERVAL - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        grabber.stop()
        grabber.join(timeout=3)
        log.info("LineCrossingDetector stopped for camera %s", self.camera_id)
