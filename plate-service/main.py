"""
CamAI Plate Service — standalone license plate recognition.

Architecture (inspired by github.com/Alexander-Zadorozhnyy/Licence-Plate-Recognition):
  1. YOLOv8 detects license plate bounding boxes (~23ms, ~96% accuracy)
  2. EasyOCR reads text from cropped plate region (much more accurate than full-frame)
  3. Results pushed to CamAI API for browser overlay + DB records
"""

from __future__ import annotations

import io
import os
import re
import sys
import time
import base64
import logging
import threading
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CAM_AI_API_URL = os.getenv("CAM_AI_API_URL", "http://localhost:3000")
API_KEY = os.getenv("PLATE_API_KEY", "")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "2.0"))  # seconds between frames
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "120"))  # 2 min per (plate, camera)
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
MIN_PLATE_CONFIDENCE = float(os.getenv("MIN_PLATE_CONFIDENCE", "0.4"))  # YOLO plate detection
MIN_OCR_CONFIDENCE = float(os.getenv("MIN_OCR_CONFIDENCE", "0.3"))  # EasyOCR text reading
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH",
                             os.path.join(os.path.dirname(__file__), "models", "license_plate_detector.pt"))
USE_GPU = os.getenv("USE_GPU", "auto").lower()  # "true", "false", or "auto" (detect)

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("plate-service")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="CamAI Plate Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Cyrillic ↔ Latin normalization for Russian plates
# ---------------------------------------------------------------------------

CYR_TO_LAT = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")

# Valid Russian plate characters (from Alexander-Zadorozhnyy repo)
PLATE_SYMBOLS = set("0123456789ABEKMHOPCTYX")


def normalize_plate(text: str) -> str:
    """Normalize plate number: uppercase, Cyrillic→Latin, strip non-plate chars."""
    text = text.upper().strip()
    text = text.translate(CYR_TO_LAT)
    text = re.sub(r'[^A-Z0-9]', '', text)
    return text


def looks_like_plate(text: str) -> bool:
    """Check if normalized text looks like a license plate."""
    n = normalize_plate(text)
    if len(n) < 6 or len(n) > 10:
        return False
    has_letter = any(c.isalpha() for c in n)
    has_digit = any(c.isdigit() for c in n)
    return has_letter and has_digit


# ---------------------------------------------------------------------------
# Fuzzy plate deduplication
# ---------------------------------------------------------------------------

def _levenshtein(a: str, b: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if len(a) < len(b):
        return _levenshtein(b, a)
    if len(b) == 0:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost))
        prev = curr
    return prev[-1]


def _bbox_iou(a: dict, b: dict) -> float:
    """Compute IoU (Intersection over Union) of two bboxes {x,y,w,h} (0..1)."""
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = ax1 + a["w"], ay1 + a["h"]
    bx1, by1 = b["x"], b["y"]
    bx2, by2 = bx1 + b["w"], by1 + b["h"]

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


# Per-camera buffer of recently detected plates for deduplication.
# Key: camera_id → list of {number, bbox, confidence, time, reported}
_recent_plates: dict[str, list[dict]] = {}
_recent_plates_lock = threading.Lock()

# How long to keep a plate in the recent buffer (seconds)
RECENT_PLATE_TTL = 30.0
# Max Levenshtein distance to consider two readings as the same plate
MAX_EDIT_DISTANCE = 3
# Min bbox IoU to consider two bboxes as the same region (0 = only use text similarity)
MIN_BBOX_IOU = 0.15


def _find_similar_recent(camera_id: str, plate_number: str, bbox: dict) -> dict | None:
    """Find a similar plate in recent buffer for this camera.
    Returns the existing entry or None."""
    now = time.time()
    with _recent_plates_lock:
        entries = _recent_plates.get(camera_id, [])
        # Clean expired entries
        entries = [e for e in entries if now - e["time"] < RECENT_PLATE_TTL]
        _recent_plates[camera_id] = entries

        for entry in entries:
            # Check text similarity
            dist = _levenshtein(plate_number, entry["number"])
            if dist <= MAX_EDIT_DISTANCE:
                # Similar text — check if bboxes overlap (same physical plate)
                iou = _bbox_iou(bbox, entry["bbox"])
                if iou >= MIN_BBOX_IOU:
                    return entry

            # Also check pure bbox overlap with high IoU (OCR might be very different)
            iou = _bbox_iou(bbox, entry["bbox"])
            if iou >= 0.5:
                return entry

    return None


def _update_recent(camera_id: str, plate_number: str, bbox: dict,
                   confidence: float, reported: bool = False) -> None:
    """Add or update a plate in the recent buffer."""
    now = time.time()
    with _recent_plates_lock:
        entries = _recent_plates.get(camera_id, [])
        # Clean expired
        entries = [e for e in entries if now - e["time"] < RECENT_PLATE_TTL]

        # Update existing or add new
        found = False
        for entry in entries:
            dist = _levenshtein(plate_number, entry["number"])
            iou = _bbox_iou(bbox, entry["bbox"])
            if (dist <= MAX_EDIT_DISTANCE and iou >= MIN_BBOX_IOU) or iou >= 0.5:
                # Same plate — update with higher confidence reading
                if confidence > entry["confidence"]:
                    entry["number"] = plate_number
                    entry["confidence"] = confidence
                entry["bbox"] = bbox
                entry["time"] = now
                if reported:
                    entry["reported"] = True
                found = True
                break

        if not found:
            entries.append({
                "number": plate_number,
                "bbox": bbox,
                "confidence": confidence,
                "time": now,
                "reported": reported,
            })

        _recent_plates[camera_id] = entries


# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_known_plates: list[dict] = []
_known_plates_lock = threading.Lock()

_watchers: dict[str, "PlateWatcher"] = {}
_watchers_lock = threading.Lock()

# GPU detection
_gpu_available = False
_gpu_name: str | None = None


def _detect_gpu() -> tuple[bool, str | None]:
    """Check if CUDA GPU is available for PyTorch."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            return True, name
    except ImportError:
        pass
    return False, None


def _should_use_gpu() -> bool:
    """Determine if GPU should be used based on USE_GPU setting."""
    global _gpu_available, _gpu_name
    _gpu_available, _gpu_name = _detect_gpu()

    if USE_GPU == "true":
        if not _gpu_available:
            log.warning("USE_GPU=true but no CUDA GPU found — falling back to CPU")
            return False
        return True
    elif USE_GPU == "false":
        return False
    else:  # "auto"
        return _gpu_available


_use_gpu = False  # set on startup

# YOLO model — lazy init
_yolo_model = None
_yolo_lock = threading.Lock()

# EasyOCR reader — lazy init
_reader = None
_reader_lock = threading.Lock()


def _get_yolo():
    """Lazy-initialize YOLOv8 plate detection model."""
    global _yolo_model
    if _yolo_model is None:
        with _yolo_lock:
            if _yolo_model is None:
                from ultralytics import YOLO
                device = "0" if _use_gpu else "cpu"
                log.info("Loading YOLOv8 plate detector from %s (device=%s)...",
                         YOLO_MODEL_PATH, device)
                _yolo_model = YOLO(YOLO_MODEL_PATH)
                # YOLO auto-detects CUDA; we pass device per-call in yolo(frame, device=...)
                log.info("YOLOv8 plate detector ready (GPU=%s)", _use_gpu)
    return _yolo_model


def _get_reader():
    """Lazy-initialize EasyOCR reader for plate text recognition."""
    global _reader
    if _reader is None:
        with _reader_lock:
            if _reader is None:
                import easyocr
                log.info("Initializing EasyOCR reader (gpu=%s)...", _use_gpu)
                _reader = easyocr.Reader(['en', 'ru'], gpu=_use_gpu)
                log.info("EasyOCR reader ready")
    return _reader


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _frame_to_b64_jpeg(frame: np.ndarray, max_side: int = 640) -> str:
    """Encode a frame to base64 JPEG."""
    h, w = frame.shape[:2]
    scale = min(max_side / max(h, w), 1.0)
    if scale < 1.0:
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
    return base64.b64encode(buf.tobytes()).decode()


def _draw_plate_overlay(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int,
                        plate_text: str, confidence: float, is_known: bool) -> np.ndarray:
    """Draw overlay with plate bounding box and label using Pillow."""
    from PIL import Image, ImageDraw, ImageFont

    snapshot = frame.copy()
    pil_img = Image.fromarray(cv2.cvtColor(snapshot, cv2.COLOR_BGR2RGB)).convert("RGBA")
    overlay = Image.new("RGBA", pil_img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    color = (0, 200, 0) if is_known else (50, 130, 255)
    alpha = 200

    draw.rectangle([(x1, y1), (x2, y2)], outline=(*color, alpha), width=3)
    draw.rectangle([(x1 + 1, y1 + 1), (x2 - 1, y2 - 1)], fill=(*color, 30))

    font_size = max(16, int((y2 - y1) * 0.6))
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except OSError:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except OSError:
            font = ImageFont.load_default()

    label = f"{plate_text} ({round(confidence * 100)}%)"
    text_bbox = draw.textbbox((0, 0), label, font=font)
    tw, th = text_bbox[2] - text_bbox[0], text_bbox[3] - text_bbox[1]
    label_y = max(0, y1 - th - 8)
    draw.rectangle([(x1, label_y), (x1 + tw + 8, label_y + th + 6)], fill=(0, 0, 0, 160))
    draw.text((x1 + 4, label_y + 2), label, fill=(*color, 255), font=font)

    pil_img = Image.alpha_composite(pil_img, overlay).convert("RGB")
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def _report_detection(camera_id: str, plate_number: str, confidence: float,
                      bbox: dict, snapshot_b64: str | None = None):
    """Send plate detection event to the CamAI API (non-blocking).

    Uses fuzzy deduplication: if a similar plate (by edit distance + bbox overlap)
    was recently reported for this camera, skip it. This prevents the same physical
    plate from generating dozens of DB records due to inconsistent OCR readings.
    """
    # Check if a similar plate was already reported recently
    similar = _find_similar_recent(camera_id, plate_number, bbox)
    if similar and similar.get("reported"):
        # Already reported — just update the buffer with better reading
        _update_recent(camera_id, plate_number, bbox, confidence)
        return

    # Mark as reported and update buffer
    _update_recent(camera_id, plate_number, bbox, confidence, reported=True)

    # Use the best reading from the buffer (might have been updated by _update_recent)
    best = _find_similar_recent(camera_id, plate_number, bbox)
    best_number = best["number"] if best else plate_number
    best_confidence = best["confidence"] if best else confidence

    event = {
        "cameraId": camera_id,
        "plateNumber": best_number,
        "confidence": round(best_confidence, 4),
        "snapshot": snapshot_b64,
    }

    def _push():
        try:
            resp = httpx.post(
                f"{CAM_AI_API_URL}/api/lpr/detection-event",
                json=event,
                headers={
                    "x-plate-sync": "true",
                    **({"x-api-key": API_KEY} if API_KEY else {}),
                },
                timeout=10,
            )
            if resp.status_code >= 400:
                log.warning("API returned %s: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            log.warning("Failed to push detection: %s", e)

    threading.Thread(target=_push, daemon=True).start()
    log.info("PLATE REPORTED: %s via camera %s (conf=%.2f)", best_number, camera_id, best_confidence)


# ---------------------------------------------------------------------------
# Camera — frame grabber + plate watcher
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
        with self._frame_lock:
            frame = self._frame
            self._frame = None
            return frame

    def _grab_ipwebcam(self):
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
                    log.info("Grabber %s: connected (%dx%d)", self.camera_id, frame.shape[1], frame.shape[0])

                with self._frame_lock:
                    self._frame = frame
                time.sleep(1.0)  # 1fps grab — reduce load on camera

            except Exception as e:
                retry_count += 1
                self._connected = False
                if retry_count >= max_retries:
                    log.error("Grabber %s: max retries (%s)", self.camera_id, e)
                    break
                time.sleep(5)

        self._connected = False

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
                    log.error("Grabber %s: max retries, stopping", self.camera_id)
                    break
                cap = cv2.VideoCapture(self.stream_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if self.stream_url.startswith("rtsp://"):
                    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                        "rtsp_transport;tcp|analyzeduration;2000000|fflags;nobuffer"
                    )
                if not cap.isOpened():
                    retry_count += 1
                    self._connected = False
                    log.warning("Grabber %s: cannot open, retry %d/%d",
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

            with self._frame_lock:
                self._frame = frame

        if cap is not None:
            cap.release()
        self._connected = False
        log.info("Grabber stopped for camera %s", self.camera_id)


class PlateWatcher(threading.Thread):
    """
    Continuously reads frames from a camera and detects license plates.

    Pipeline (per frame):
      1. YOLOv8 → plate bounding boxes  (~23ms)
      2. Crop each plate region
      3. EasyOCR on grayscale crop → plate text  (~25ms)
      4. Normalize text, check against known plates
      5. Push bbox events for browser overlay
      6. Report to DB (with cooldown + screenshot if conf >= 90%)
    """

    def __init__(self, camera_id: str, stream_url: str):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.stream_url = stream_url
        self._stop_event = threading.Event()
        self.fps = 0.0
        self.last_frame_time = 0.0
        self.plates_detected = 0
        self.known_matches = 0

    def stop(self):
        self._stop_event.set()

    @property
    def stopped(self) -> bool:
        return self._stop_event.is_set()

    def _push_plate_events(self, plates: list[dict]):
        """Send plate detection events to CamAI API for browser overlay rendering."""
        try:
            resp = httpx.post(
                f"{CAM_AI_API_URL}/api/lpr/plate-events",
                json={"cameraId": self.camera_id, "plates": plates},
                headers={"x-plate-sync": "true"},
                timeout=5,
            )
            if resp.status_code >= 400:
                log.warning("Push plate events failed: HTTP %s — %s",
                            resp.status_code, resp.text[:200])
        except Exception as e:
            log.warning("Failed to push plate events: %s", e)

    def run(self):
        log.info("Starting plate watcher for camera %s (%s)", self.camera_id, self.stream_url)

        grabber = FrameGrabber(self.stream_url, self.camera_id)
        grabber.start()
        first_frame_logged = False
        last_plate_time = 0.0
        last_plate_events: list[dict] = []

        # Lazy-init models in watcher thread
        yolo = _get_yolo()
        reader = _get_reader()

        while not self.stopped:
            frame = grabber.get_latest_frame()
            if frame is None:
                if grabber.stopped:
                    log.error("Camera %s: grabber died, stopping watcher", self.camera_id)
                    break
                time.sleep(0.05)
                continue

            if not first_frame_logged:
                first_frame_logged = True
                log.info("Camera %s: first frame received (%dx%d)",
                         self.camera_id, frame.shape[1], frame.shape[0])

            t0 = time.time()
            h, w = frame.shape[:2]

            # Step 1: YOLOv8 plate detection
            try:
                results = yolo(frame, imgsz=320, conf=MIN_PLATE_CONFIDENCE,
                              device="0" if _use_gpu else "cpu", verbose=False)
            except Exception as e:
                log.warning("Camera %s: YOLO error: %s", self.camera_id, e)
                time.sleep(POLL_INTERVAL)
                continue

            plate_events: list[dict] = []

            # Step 2: Process each detected plate
            for result in results:
                boxes = result.boxes
                if boxes is None:
                    continue

                for box in boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                    det_conf = float(box.conf[0])

                    # Clamp to frame bounds
                    x1 = max(0, x1)
                    y1 = max(0, y1)
                    x2 = min(w, x2)
                    y2 = min(h, y2)

                    if x2 - x1 < 10 or y2 - y1 < 5:
                        continue

                    # Step 3: Crop plate region and run OCR
                    plate_crop = frame[y1:y2, x1:x2]
                    plate_gray = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY)

                    try:
                        ocr_results = reader.readtext(plate_gray)
                    except Exception as e:
                        log.debug("OCR error on crop: %s", e)
                        continue

                    # Combine all OCR text from the crop
                    texts = []
                    total_conf = 0.0
                    count = 0
                    for (_bbox, text, conf) in ocr_results:
                        if conf >= MIN_OCR_CONFIDENCE:
                            texts.append(text)
                            total_conf += conf
                            count += 1

                    if not texts:
                        continue

                    raw_text = " ".join(texts)
                    normalized = normalize_plate(raw_text)

                    if not looks_like_plate(raw_text):
                        continue

                    avg_ocr_conf = total_conf / count if count else 0
                    # Use YOLO confidence as main detection confidence
                    # (how certain we are a plate exists in this bbox).
                    # OCR confidence is about text reading quality, not detection.
                    # Averaging gives a balanced score that doesn't collapse like multiplication.
                    plate_conf = (det_conf + avg_ocr_conf) / 2

                    self.plates_detected += 1
                    log.info("Camera %s: plate '%s' (norm: %s, yolo=%.2f, ocr=%.2f, conf=%.2f)",
                             self.camera_id, raw_text.strip(), normalized,
                             det_conf, avg_ocr_conf, plate_conf)

                    # Check if known plate
                    is_known = False
                    with _known_plates_lock:
                        for kp in _known_plates:
                            if kp["number"] == normalized:
                                is_known = True
                                break

                    if is_known:
                        self.known_matches += 1

                    # Normalized bbox (0-1) for overlay and deduplication
                    norm_bbox = {
                        "x": round(x1 / w, 4),
                        "y": round(y1 / h, 4),
                        "w": round((x2 - x1) / w, 4),
                        "h": round((y2 - y1) / h, 4),
                    }

                    # Use best reading from recent buffer for overlay label
                    similar = _find_similar_recent(self.camera_id, normalized, norm_bbox)
                    overlay_number = similar["number"] if similar and similar["confidence"] > plate_conf else normalized

                    # Normalized bbox (0-1) for browser overlay
                    plate_events.append({
                        "bbox": norm_bbox,
                        "number": overlay_number,
                        "confidence": round(plate_conf, 4),
                        "isKnown": is_known,
                    })

                    # Screenshot for DB (save when confidence is decent)
                    snapshot_b64 = None
                    if plate_conf >= 0.55:
                        annotated = _draw_plate_overlay(
                            frame, x1, y1, x2, y2,
                            normalized, plate_conf, is_known
                        )
                        snapshot_b64 = _frame_to_b64_jpeg(annotated)

                    # Report to DB (with fuzzy deduplication)
                    _report_detection(self.camera_id, normalized, plate_conf,
                                      norm_bbox, snapshot_b64)

            # Push plate events for browser overlay
            if plate_events:
                last_plate_time = time.time()
                last_plate_events = plate_events
                self._push_plate_events(plate_events)
            elif last_plate_events:
                if time.time() - last_plate_time < 8.0:
                    self._push_plate_events(last_plate_events)
                else:
                    self._push_plate_events([])
                    last_plate_events = []

            elapsed = time.time() - t0
            self.fps = 1.0 / max(elapsed + POLL_INTERVAL, 0.001)
            self.last_frame_time = time.time()

            sleep_time = max(0, POLL_INTERVAL - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

        grabber.stop()
        grabber.join(timeout=3)
        log.info("Plate watcher stopped for camera %s", self.camera_id)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    with _watchers_lock:
        cams = {cid: {
            "alive": w.is_alive(),
            "fps": round(w.fps, 1),
            "plates_detected": w.plates_detected,
            "known_matches": w.known_matches,
        } for cid, w in _watchers.items()}

    return {
        "status": "ok",
        "service": "plate-service",
        "known_plates": len(_known_plates),
        "cameras": cams,
        "gpu": {
            "available": _gpu_available,
            "name": _gpu_name,
            "enabled": _use_gpu,
            "setting": USE_GPU,
        },
        "config": {
            "poll_interval": POLL_INTERVAL,
            "cooldown_seconds": COOLDOWN_SECONDS,
            "min_plate_confidence": MIN_PLATE_CONFIDENCE,
            "min_ocr_confidence": MIN_OCR_CONFIDENCE,
        },
    }


class CameraStartRequest(BaseModel):
    camera_id: str
    stream_url: str


@app.post("/cameras/start")
async def start_camera(req: CameraStartRequest):
    """Start watching a camera for plate recognition."""
    with _watchers_lock:
        if req.camera_id in _watchers and _watchers[req.camera_id].is_alive():
            return {"status": "already_running", "camera_id": req.camera_id}

        watcher = PlateWatcher(req.camera_id, req.stream_url)
        watcher.start()
        _watchers[req.camera_id] = watcher

    return {"status": "started", "camera_id": req.camera_id}


class CameraStopRequest(BaseModel):
    camera_id: str


@app.post("/cameras/stop")
async def stop_camera(req: CameraStopRequest):
    """Stop watching a camera."""
    with _watchers_lock:
        watcher = _watchers.pop(req.camera_id, None)

    if watcher is None:
        raise HTTPException(status_code=404, detail="Camera watcher not found")

    watcher.stop()
    watcher.join(timeout=5)
    return {"status": "stopped", "camera_id": req.camera_id}


@app.get("/cameras")
def list_cameras():
    """List active camera watchers."""
    with _watchers_lock:
        return [{
            "camera_id": cid,
            "alive": w.is_alive(),
            "fps": round(w.fps, 1),
            "plates_detected": w.plates_detected,
        } for cid, w in _watchers.items()]


@app.post("/plates/sync")
async def sync_plates(plates: list[dict]):
    """Receive plate list from CamAI API. Each item: {number, type}"""
    loaded = []
    for p in plates:
        number = p.get("number", "")
        if not number:
            continue
        loaded.append({
            "number": normalize_plate(number),
            "type": p.get("type", "neutral"),
        })

    with _known_plates_lock:
        _known_plates.clear()
        _known_plates.extend(loaded)

    log.info("Synced %d known plates", len(loaded))
    return {"loaded": len(loaded)}


# ---------------------------------------------------------------------------
# Startup: auto-sync from CamAI API
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def _startup():
    global _use_gpu
    _use_gpu = _should_use_gpu()

    log.info("Plate service starting...")
    log.info("  CAM_AI_API_URL = %s", CAM_AI_API_URL)
    log.info("  POLL_INTERVAL  = %s", POLL_INTERVAL)
    log.info("  COOLDOWN_SECONDS = %s", COOLDOWN_SECONDS)
    log.info("  MIN_PLATE_CONFIDENCE = %s", MIN_PLATE_CONFIDENCE)
    log.info("  MIN_OCR_CONFIDENCE = %s", MIN_OCR_CONFIDENCE)
    log.info("  YOLO_MODEL = %s", YOLO_MODEL_PATH)
    log.info("  USE_GPU = %s (available=%s, name=%s)",
             USE_GPU, _gpu_available, _gpu_name or "none")
    if _use_gpu:
        log.info("  >>> GPU ENABLED — YOLO + EasyOCR will use CUDA")
    else:
        log.info("  >>> CPU mode — set USE_GPU=true for GPU acceleration")

    def _initial_sync():
        time.sleep(3)
        try:
            headers = {"x-plate-sync": "true"}
            if API_KEY:
                headers["x-api-key"] = API_KEY

            # 1) Sync known plates
            resp = httpx.get(
                f"{CAM_AI_API_URL}/api/lpr/plates-sync",
                headers=headers, timeout=15,
            )
            if resp.status_code == 200:
                plates = resp.json()
                loaded = []
                for p in plates:
                    number = p.get("number", "")
                    if number:
                        loaded.append({
                            "number": normalize_plate(number),
                            "type": p.get("type", "neutral"),
                        })
                with _known_plates_lock:
                    _known_plates.clear()
                    _known_plates.extend(loaded)
                log.info("Initial sync: loaded %d known plates", len(loaded))
            else:
                log.warning("Plates sync failed: HTTP %s", resp.status_code)

            # 2) Recover active LPR cameras
            resp = httpx.get(
                f"{CAM_AI_API_URL}/api/lpr/cameras",
                headers=headers, timeout=15,
            )
            if resp.status_code == 200:
                cameras = resp.json()
                for cam in cameras:
                    cam_id = cam["id"]
                    stream_url = cam["streamUrl"]
                    with _watchers_lock:
                        if cam_id in _watchers and _watchers[cam_id].is_alive():
                            continue
                        watcher = PlateWatcher(cam_id, stream_url)
                        watcher.start()
                        _watchers[cam_id] = watcher
                    log.info("Recovered camera: %s (%s)", cam.get("name", "?"), cam_id)
                if cameras:
                    log.info("Camera recovery: restored %d cameras", len(cameras))
            else:
                log.warning("Camera recovery failed: HTTP %s", resp.status_code)

        except Exception as e:
            log.warning("Initial sync failed: %s", e)

    threading.Thread(target=_initial_sync, daemon=True).start()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
