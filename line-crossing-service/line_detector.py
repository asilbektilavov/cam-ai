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
        self._tracker = CentroidTracker(max_disappeared=30, max_distance=0.35)
        self._yolo = None  # lazy init
        self._cooldowns: dict[tuple[str, str], float] = {}

        # Stats
        self.fps = 0.0
        self.bodies_detected = 0
        self.crossings_detected = 0
        self.faces_recognized = 0
        self._crossing_events: list[dict] = []  # recent events for overlay
        self._events_lock = threading.Lock()

        # Cache recognized faces per track_id for overlay persistence (5 seconds)
        self._recognized_cache: dict[int, dict] = {}  # track_id -> {name, confidence, face_bbox, ts}
        self._RECOGNITION_DISPLAY_SECONDS = 5

        # Initial-side tracking: remember which side of the line each track started on
        # Much more robust than frame-to-frame crossing detection
        self._track_initial_side: dict[int, float] = {}  # track_id -> initial cross product sign
        self._CROSS_THRESHOLD = 0.005  # min cross product to register/trigger (avoid jitter)

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
                           confidence: float, frame: np.ndarray,
                           body_bbox: tuple = None, face_bbox: tuple = None):
        """Report attendance event to CamAI API with annotated snapshot."""
        import httpx
        import base64

        self._set_cooldown(employee_id)

        # Create annotated snapshot with green bboxes and name
        h, w = frame.shape[:2]
        annotated = frame.copy()
        green = (0, 200, 0)  # BGR green

        if body_bbox:
            bx1 = int(body_bbox[0] * w)
            by1 = int(body_bbox[1] * h)
            bx2 = int(body_bbox[2] * w)
            by2 = int(body_bbox[3] * h)
            cv2.rectangle(annotated, (bx1, by1), (bx2, by2), green, 3)

        if face_bbox:
            fx1 = int(face_bbox[0] * w)
            fy1 = int(face_bbox[1] * h)
            fx2 = int(face_bbox[2] * w)
            fy2 = int(face_bbox[3] * h)
            cv2.rectangle(annotated, (fx1, fy1), (fx2, fy2), green, 2)
            # Name label above face
            label = f"{employee_name} {round(confidence * 100)}%"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = max(0.6, min(h, w) / 1500)
            thickness = max(1, int(font_scale * 2))
            (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)
            cv2.rectangle(annotated, (fx1, fy1 - th - 8), (fx1 + tw + 4, fy1), green, -1)
            cv2.putText(annotated, label, (fx1 + 2, fy1 - 4), font, font_scale, (0, 0, 0), thickness)

        scale = min(640 / max(h, w), 1.0)
        if scale < 1.0:
            small = cv2.resize(annotated, (int(w * scale), int(h * scale)))
        else:
            small = annotated
        _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
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

            # 3. Check line crossings using initial-side approach
            # Instead of frame-to-frame crossing detection, we remember which side
            # of the line each track started on, and detect when it ends up on the other side.
            # This is much more robust — survives tracking jitter and slow movement.
            line_type = self.tripwire.get("lineType", "free")
            cross_dir = self.tripwire.get("crossDirection", "forward")
            lx1, ly1 = self.tripwire["x1"], self.tripwire["y1"]
            lx2, ly2 = self.tripwire["x2"], self.tripwire["y2"]
            dx_line = lx2 - lx1
            dy_line = ly2 - ly1

            # Clean up stale track IDs from initial-side cache
            active_ids = set(self._tracker.objects.keys())
            for tid in list(self._track_initial_side.keys()):
                if tid not in active_ids:
                    del self._track_initial_side[tid]

            overlay_events = []
            for track_id, info in tracked.items():
                bbox = info["bbox"]

                # Check recognition cache for this track
                now = time.time()
                cached = self._recognized_cache.get(track_id)
                if cached and (now - cached["ts"]) > self._RECOGNITION_DISPLAY_SECONDS:
                    del self._recognized_cache[track_id]
                    cached = None

                # Add body to overlay (with cached recognition if available)
                body_event = {
                    "type": "body",
                    "bbox": {
                        "x": round(bbox[0], 4),
                        "y": round(bbox[1], 4),
                        "w": round(bbox[2] - bbox[0], 4),
                        "h": round(bbox[3] - bbox[1], 4),
                    },
                    "trackId": track_id,
                    "crossed": cached is not None,
                    "name": cached["name"] if cached else None,
                    "confidence": cached["confidence"] if cached else 0.0,
                }
                overlay_events.append(body_event)

                # Add cached face bbox if available
                if cached and cached.get("face_bbox"):
                    fb = cached["face_bbox"]
                    overlay_events.append({
                        "type": "face",
                        "bbox": fb,
                        "crossed": True,
                        "name": cached["name"],
                        "confidence": cached["confidence"],
                    })

                # Compute check point based on line type
                if line_type == "vertical":
                    bbox_cy = (bbox[1] + bbox[3]) / 2
                    if cross_dir == "forward":
                        check_curr = [bbox[0], bbox_cy]  # left edge
                    else:
                        check_curr = [bbox[2], bbox_cy]  # right edge
                else:
                    # Free line: use bottom-center of bbox (feet level)
                    # Bbox center (torso) stays at y≈0.5 and never reaches
                    # a horizontal line drawn at the floor level (y≈0.8+).
                    # Feet position actually crosses the line as person walks.
                    check_curr = [(bbox[0] + bbox[2]) / 2, bbox[3]]

                # Cross product: which side of the line is the check point on?
                s_curr = dx_line * (check_curr[1] - ly1) - dy_line * (check_curr[0] - lx1)

                # Store initial side or check for crossing
                if track_id not in self._track_initial_side:
                    if abs(s_curr) > self._CROSS_THRESHOLD:
                        self._track_initial_side[track_id] = s_curr
                        log.debug("Camera %s: track#%d initial side=%.4f point=(%.3f,%.3f)",
                                  self.camera_id, track_id, s_curr, check_curr[0], check_curr[1])
                    continue

                s_init = self._track_initial_side[track_id]

                # Log position every frame to track movement
                log.debug("Camera %s: track#%d s_init=%.4f s_curr=%.4f point=(%.3f,%.3f)",
                          self.camera_id, track_id, s_init, s_curr, check_curr[0], check_curr[1])

                # Still on the same side? Skip.
                if (s_init > 0 and s_curr > 0) or (s_init < 0 and s_curr < 0):
                    continue
                # Too close to line? Skip (avoid jitter).
                if abs(s_curr) < self._CROSS_THRESHOLD:
                    continue

                # Sign changed — line was crossed! Check direction.
                crossed = False
                if cross_dir == "backward":
                    crossed = (s_init < 0 and s_curr > 0)
                else:  # forward
                    crossed = (s_init > 0 and s_curr < 0)

                if not crossed:
                    # Crossed in wrong direction — update initial side
                    log.debug("Camera %s: track#%d crossed WRONG direction (s_init=%.4f s_curr=%.4f), updating initial side",
                              self.camera_id, track_id, s_init, s_curr)
                    self._track_initial_side[track_id] = s_curr
                    continue

                # Remove from initial side dict to prevent re-triggering
                del self._track_initial_side[track_id]

                log.info("Camera %s: track#%d CROSSED LINE (s_init=%.4f → s_curr=%.4f) point=(%.3f,%.3f)",
                         self.camera_id, track_id, s_init, s_curr,
                         check_curr[0], check_curr[1])

                self.crossings_detected += 1

                # 4. Face recognition in body region
                result = self.face_recognizer.recognize_in_region(
                    rgb, bbox, h, w
                )

                if result:
                    emp_id = result["employee_id"]
                    emp_name = result["name"]
                    confidence = result["confidence"]

                    face_bbox_overlay = None
                    if result.get("face_bbox"):
                        fb = result["face_bbox"]
                        face_bbox_overlay = {
                            "x": round(fb[0], 4),
                            "y": round(fb[1], 4),
                            "w": round(fb[2] - fb[0], 4),
                            "h": round(fb[3] - fb[1], 4),
                        }

                    # Cache recognition for overlay persistence
                    self._recognized_cache[track_id] = {
                        "name": emp_name,
                        "confidence": round(confidence, 4),
                        "face_bbox": face_bbox_overlay,
                        "ts": time.time(),
                    }

                    # Update current frame overlay
                    body_event["crossed"] = True
                    body_event["name"] = emp_name
                    body_event["confidence"] = round(confidence, 4)

                    if face_bbox_overlay:
                        overlay_events.append({
                            "type": "face",
                            "bbox": face_bbox_overlay,
                            "crossed": True,
                            "name": emp_name,
                            "confidence": round(confidence, 4),
                        })

                    if self._check_cooldown(emp_id):
                        self.faces_recognized += 1
                        self._report_attendance(
                            emp_id, emp_name, confidence, frame,
                            body_bbox=bbox, face_bbox=result.get("face_bbox"),
                        )
                    else:
                        log.debug("Camera %s: %s in cooldown, skipping", self.camera_id, emp_name)
                else:
                    log.info("Camera %s: body crossed line but no face match", self.camera_id)
                    # Cache "crossed but unknown" for display
                    self._recognized_cache[track_id] = {
                        "name": None,
                        "confidence": 0.0,
                        "face_bbox": None,
                        "ts": time.time(),
                    }
                    body_event["crossed"] = True

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
