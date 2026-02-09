from __future__ import annotations

import io
import os
import time
import math
import asyncio
import threading
from collections import defaultdict
from typing import Optional

from fastapi import FastAPI, File, UploadFile, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2
import httpx

app = FastAPI(title="CamAI YOLO Detection Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy-load model on first request
_model = None
CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.40"))

# YOLO COCO class mapping to our detection types
CLASS_TYPE_MAP: dict[int, tuple[str, str, str]] = {
    # classId -> (type, label_ru, color)
    0: ("person", "Человек", "#3B82F6"),
    1: ("bicycle", "Велосипед", "#84CC16"),
    2: ("car", "Автомобиль", "#22C55E"),
    3: ("motorcycle", "Мотоцикл", "#84CC16"),
    5: ("bus", "Автобус", "#22C55E"),
    7: ("truck", "Грузовик", "#22C55E"),
    15: ("cat", "Кошка", "#8B5CF6"),
    16: ("dog", "Собака", "#8B5CF6"),
}

# Broader categories
VEHICLE_CLASSES = {2, 3, 5, 7}
PERSON_CLASSES = {0}
ANIMAL_CLASSES = {15, 16}
BIKE_CLASSES = {1, 3}


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO("yolov8n.pt")
    return _model


def classify_detection(class_id: int, class_name: str):
    if class_id in CLASS_TYPE_MAP:
        det_type, label, color = CLASS_TYPE_MAP[class_id]
        return det_type, label, color

    # Fallback for other classes
    return "object", class_name.capitalize(), "#6B7280"


def decode_image(contents: bytes):
    """Decode image bytes to OpenCV format."""
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return img


# ─── Fire / Smoke Detection (OpenCV HSV) ──────────────────────────────

# HSV ranges for fire colors
FIRE_LOWER_1 = np.array([0, 80, 180])
FIRE_UPPER_1 = np.array([25, 255, 255])
FIRE_LOWER_2 = np.array([160, 80, 180])
FIRE_UPPER_2 = np.array([180, 255, 255])

# Smoke: gray tones with low saturation, narrower range to reduce false positives
SMOKE_LOWER = np.array([0, 0, 140])
SMOKE_UPPER = np.array([180, 40, 210])

FIRE_MIN_AREA_RATIO = 0.002  # min 0.2% of frame
SMOKE_MIN_AREA_RATIO = 0.05  # min 5% of frame (raised to reduce false positives on gray surfaces)


def detect_fire_smoke(img: np.ndarray) -> dict:
    """Detect fire and smoke using HSV color analysis."""
    h, w = img.shape[:2]
    total_pixels = h * w

    # Blur to reduce noise
    blurred = cv2.GaussianBlur(img, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)

    # Fire detection - combine two red-orange ranges
    mask_fire1 = cv2.inRange(hsv, FIRE_LOWER_1, FIRE_UPPER_1)
    mask_fire2 = cv2.inRange(hsv, FIRE_LOWER_2, FIRE_UPPER_2)
    mask_fire = cv2.bitwise_or(mask_fire1, mask_fire2)

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask_fire = cv2.morphologyEx(mask_fire, cv2.MORPH_OPEN, kernel)
    mask_fire = cv2.morphologyEx(mask_fire, cv2.MORPH_CLOSE, kernel)

    # Smoke detection
    mask_smoke = cv2.inRange(hsv, SMOKE_LOWER, SMOKE_UPPER)
    mask_smoke = cv2.morphologyEx(mask_smoke, cv2.MORPH_OPEN, kernel)

    # Find fire contours
    fire_regions = []
    contours_fire, _ = cv2.findContours(mask_fire, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fire_area_total = 0
    for cnt in contours_fire:
        area = cv2.contourArea(cnt)
        if area / total_pixels >= FIRE_MIN_AREA_RATIO:
            x, y, cw, ch = cv2.boundingRect(cnt)
            fire_regions.append({
                "bbox": {
                    "x": round(x / w, 4),
                    "y": round(y / h, 4),
                    "w": round(cw / w, 4),
                    "h": round(ch / h, 4),
                },
                "area": round(area / total_pixels, 4),
            })
            fire_area_total += area

    # Check for flickering (fire characteristic) via brightness variance in fire regions
    fire_confidence = 0.0
    if fire_regions:
        # Higher confidence if fire area is large and regions have high brightness
        fire_pct = fire_area_total / total_pixels
        # Check brightness in fire regions (fire is bright)
        fire_mask_bool = mask_fire > 0
        if fire_mask_bool.any():
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            mean_brightness = float(np.mean(gray[fire_mask_bool]))
            # Fire should be bright (>150)
            brightness_factor = min(mean_brightness / 200.0, 1.0)
            fire_confidence = min(fire_pct * 20 * brightness_factor, 0.99)
        else:
            fire_confidence = min(fire_pct * 10, 0.5)

    # Find smoke contours
    smoke_regions = []
    contours_smoke, _ = cv2.findContours(mask_smoke, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    smoke_area_total = 0
    for cnt in contours_smoke:
        area = cv2.contourArea(cnt)
        if area / total_pixels >= SMOKE_MIN_AREA_RATIO:
            x, y, cw, ch = cv2.boundingRect(cnt)
            smoke_regions.append({
                "bbox": {
                    "x": round(x / w, 4),
                    "y": round(y / h, 4),
                    "w": round(cw / w, 4),
                    "h": round(ch / h, 4),
                },
                "area": round(area / total_pixels, 4),
            })
            smoke_area_total += area

    smoke_confidence = 0.0
    if smoke_regions:
        smoke_pct = smoke_area_total / total_pixels
        # Check texture variance: real smoke has uneven brightness, gray surfaces are uniform
        smoke_mask_bool = mask_smoke > 0
        if smoke_mask_bool.any():
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            smoke_pixels = gray[smoke_mask_bool]
            brightness_std = float(np.std(smoke_pixels))
            # Uniform surfaces (asphalt, concrete, buildings) have low std (<25), smoke has higher (>30)
            if brightness_std < 25:
                smoke_regions = []  # reject — too uniform, likely not smoke
                smoke_confidence = 0.0
            else:
                texture_factor = min(brightness_std / 30.0, 1.0)
                smoke_confidence = min(smoke_pct * 5 * texture_factor, 0.95)
        else:
            smoke_confidence = min(smoke_pct * 5, 0.95)

    return {
        "fireDetected": len(fire_regions) > 0 and fire_confidence > 0.3,
        "fireConfidence": round(fire_confidence, 3),
        "fireRegions": fire_regions[:5],
        "smokeDetected": len(smoke_regions) > 0 and smoke_confidence > 0.3,
        "smokeConfidence": round(smoke_confidence, 3),
        "smokeRegions": smoke_regions[:3],
    }


# ─── License Plate Recognition (EasyOCR) ──────────────────────────────

_ocr_reader = None


def get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        _ocr_reader = easyocr.Reader(
            ["en"],
            gpu=False,
            verbose=False,
        )
    return _ocr_reader


# Plate character filter — alphanumeric, min 3 chars total
import re
PLATE_PATTERN = re.compile(r"[A-Z0-9]{3,}")


def detect_plates(img: np.ndarray, vehicle_boxes: list[dict] | None = None) -> list[dict]:
    """Detect license plates using YOLO vehicle detection + EasyOCR."""
    h, w = img.shape[:2]
    reader = get_ocr_reader()

    plates = []

    # If vehicle boxes provided, crop each vehicle and OCR
    if vehicle_boxes:
        for vbox in vehicle_boxes:
            vx = int(vbox["x"] * w)
            vy = int(vbox["y"] * h)
            vw = int(vbox["w"] * w)
            vh = int(vbox["h"] * h)

            # Focus on lower 60% of vehicle (where plate usually is)
            plate_y = vy + int(vh * 0.4)
            plate_h = vh - int(vh * 0.4)
            crop = img[plate_y:vy + vh, vx:vx + vw]

            if crop.size == 0:
                continue

            # Preprocess for better OCR
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            gray = cv2.bilateralFilter(gray, 11, 17, 17)

            results = reader.readtext(gray, detail=1, paragraph=False)

            for bbox_pts, text, conf in results:
                clean = text.upper().replace(" ", "").replace("-", "")
                # Filter: at least 4 alphanumeric chars, confidence > 0.3
                if len(clean) >= 3 and conf > 0.2 and PLATE_PATTERN.search(clean):
                    # Convert local crop coords to normalized frame coords
                    pts = np.array(bbox_pts)
                    px_min, py_min = pts.min(axis=0)
                    px_max, py_max = pts.max(axis=0)

                    plates.append({
                        "text": clean,
                        "confidence": round(float(conf), 3),
                        "bbox": {
                            "x": round((vx + px_min) / w, 4),
                            "y": round((plate_y + py_min) / h, 4),
                            "w": round((px_max - px_min) / w, 4),
                            "h": round((py_max - py_min) / h, 4),
                        },
                    })
    else:
        # Full frame OCR if no vehicle boxes
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        results = reader.readtext(gray, detail=1, paragraph=False)

        for bbox_pts, text, conf in results:
            clean = text.upper().replace(" ", "").replace("-", "")
            # Stricter filtering for full-frame: higher confidence, plate-like shape
            if len(clean) < 4 or len(clean) > 10 or conf < 0.3:
                continue
            if not PLATE_PATTERN.search(clean):
                continue
            pts = np.array(bbox_pts)
            px_min, py_min = pts.min(axis=0)
            px_max, py_max = pts.max(axis=0)
            box_w = float(px_max - px_min)
            box_h = float(py_max - py_min)
            # Plates are wider than tall (aspect ratio 1.5-7)
            if box_h > 0 and not (1.5 <= box_w / box_h <= 7.0):
                continue

            plates.append({
                "text": clean,
                "confidence": round(float(conf), 3),
                "bbox": {
                    "x": round(float(px_min) / w, 4),
                    "y": round(float(py_min) / h, 4),
                    "w": round(box_w / w, 4),
                    "h": round(box_h / h, 4),
                },
            })

    # Deduplicate by text
    seen = set()
    unique = []
    for p in plates:
        if p["text"] not in seen:
            seen.add(p["text"])
            unique.append(p)

    return unique


# ─── Behavior Analytics (Optical Flow) ──────────────────────────────

_prev_frames: dict[str, np.ndarray] = {}  # camera_id -> previous gray frame


def analyze_behavior(
    img: np.ndarray,
    camera_id: str,
    person_boxes: list[dict],
) -> list[dict]:
    """Detect abnormal behavior using optical flow analysis."""
    global _prev_frames

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    h, w = img.shape[:2]

    behaviors = []

    prev_gray = _prev_frames.get(camera_id)
    if prev_gray is None or prev_gray.shape != gray.shape:
        _prev_frames[camera_id] = gray
        return behaviors

    # Calculate dense optical flow
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray, gray, None,
        pyr_scale=0.5, levels=3, winsize=15,
        iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
    )

    _prev_frames[camera_id] = gray

    # Analyze motion for each person
    for i, pbox in enumerate(person_boxes):
        px = int(pbox["x"] * w)
        py = int(pbox["y"] * h)
        pw = int(pbox["w"] * w)
        ph = int(pbox["h"] * h)

        # Clamp to image bounds
        px = max(0, min(px, w - 1))
        py = max(0, min(py, h - 1))
        pw = max(1, min(pw, w - px))
        ph = max(1, min(ph, h - py))

        roi_flow = flow[py:py + ph, px:px + pw]
        if roi_flow.size == 0:
            continue

        magnitude = np.sqrt(roi_flow[..., 0] ** 2 + roi_flow[..., 1] ** 2)
        avg_motion = float(np.mean(magnitude))
        max_motion = float(np.max(magnitude))
        vertical_flow = float(np.mean(roi_flow[..., 1]))

        # Running detection: high average motion
        if avg_motion > 8.0:
            behaviors.append({
                "personIndex": i,
                "behavior": "running",
                "label": "Бег",
                "confidence": round(min(avg_motion / 20.0, 0.99), 3),
                "motionMagnitude": round(avg_motion, 2),
                "bbox": pbox,
            })

        # Sudden fall: strong downward motion
        if vertical_flow > 12.0 and avg_motion > 5.0:
            behaviors.append({
                "personIndex": i,
                "behavior": "falling",
                "label": "Падение",
                "confidence": round(min(vertical_flow / 25.0, 0.95), 3),
                "motionMagnitude": round(avg_motion, 2),
                "bbox": pbox,
            })

    # Fighting detection: two people close together with high motion
    for i in range(len(person_boxes)):
        for j in range(i + 1, len(person_boxes)):
            p1 = person_boxes[i]
            p2 = person_boxes[j]

            # Calculate center distance (normalized)
            cx1 = p1["x"] + p1["w"] / 2
            cy1 = p1["y"] + p1["h"] / 2
            cx2 = p2["x"] + p2["w"] / 2
            cy2 = p2["y"] + p2["h"] / 2

            dist = math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)

            # Close proximity (< 15% of frame diagonal)
            if dist < 0.15:
                # Check motion in overlap region
                ox = int(min(cx1, cx2) * w)
                oy = int(min(cy1, cy2) * h)
                ow = int(abs(cx1 - cx2) * w) + int(max(p1["w"], p2["w"]) * w)
                oh = int(abs(cy1 - cy2) * h) + int(max(p1["h"], p2["h"]) * h)

                ox = max(0, min(ox, w - 1))
                oy = max(0, min(oy, h - 1))
                ow = max(1, min(ow, w - ox))
                oh = max(1, min(oh, h - oy))

                roi_flow = flow[oy:oy + oh, ox:ox + ow]
                if roi_flow.size > 0:
                    magnitude = np.sqrt(roi_flow[..., 0] ** 2 + roi_flow[..., 1] ** 2)
                    avg = float(np.mean(magnitude))

                    if avg > 6.0:
                        behaviors.append({
                            "personIndex": -1,
                            "behavior": "fighting",
                            "label": "Потасовка",
                            "confidence": round(min(avg / 15.0, 0.95), 3),
                            "motionMagnitude": round(avg, 2),
                            "persons": [i, j],
                            "bbox": {
                                "x": round(min(p1["x"], p2["x"]), 4),
                                "y": round(min(p1["y"], p2["y"]), 4),
                                "w": round(max(p1["x"] + p1["w"], p2["x"] + p2["w"]) - min(p1["x"], p2["x"]), 4),
                                "h": round(max(p1["y"] + p1["h"], p2["y"] + p2["h"]) - min(p1["y"], p2["y"]), 4),
                            },
                        })

    return behaviors


# ─── Speed Estimation ──────────────────────────────────────────────

_prev_centroids: dict[str, dict[int, tuple[float, float, float]]] = {}  # cam_id -> {track_idx -> (cx, cy, timestamp)}


def estimate_speeds(
    camera_id: str,
    person_boxes: list[dict],
    pixels_per_meter: float = 50.0,
    fps: float = 4.0,
) -> list[dict]:
    """Estimate speed of tracked persons using centroid displacement."""
    global _prev_centroids

    if camera_id not in _prev_centroids:
        _prev_centroids[camera_id] = {}

    prev = _prev_centroids[camera_id]
    now = time.monotonic()
    speeds = []

    current_centroids: dict[int, tuple[float, float, float]] = {}

    for i, pbox in enumerate(person_boxes):
        cx = pbox["x"] + pbox["w"] / 2
        cy = pbox["y"] + pbox["h"] / 2

        # Match to closest previous centroid
        best_match = -1
        best_dist = 0.15  # max matching distance (15% of frame)

        for pidx, (pcx, pcy, pt) in prev.items():
            d = math.sqrt((cx - pcx) ** 2 + (cy - pcy) ** 2)
            if d < best_dist:
                best_dist = d
                best_match = pidx

        if best_match >= 0:
            pcx, pcy, pt = prev[best_match]
            time_diff = now - pt

            if time_diff > 0.05:  # at least 50ms
                # Displacement in normalized coords
                pixel_dist = math.sqrt((cx - pcx) ** 2 + (cy - pcy) ** 2)
                # Convert to real-world distance (approximate)
                meters = pixel_dist * pixels_per_meter
                speed_mps = meters / time_diff
                speed_kmh = speed_mps * 3.6

                if speed_kmh > 1.0:  # filter noise
                    speeds.append({
                        "personIndex": i,
                        "speedMps": round(speed_mps, 2),
                        "speedKmh": round(speed_kmh, 1),
                        "bbox": pbox,
                    })

            current_centroids[i] = (cx, cy, now)
        else:
            current_centroids[i] = (cx, cy, now)

    _prev_centroids[camera_id] = current_centroids
    return speeds


# ─── Crowd Density Estimation ──────────────────────────────────────

def estimate_crowd_density(
    person_count: int,
    fov_area_m2: float = 50.0,
) -> dict:
    """Estimate crowd density from person count and camera field-of-view area."""
    density = person_count / fov_area_m2 if fov_area_m2 > 0 else 0

    if density < 0.3:
        level = "empty"
        label = "Пусто"
    elif density < 0.8:
        level = "sparse"
        label = "Свободно"
    elif density < 1.5:
        level = "moderate"
        label = "Умеренно"
    elif density < 3.0:
        level = "crowded"
        label = "Многолюдно"
    else:
        level = "very_crowded"
        label = "Очень многолюдно"

    return {
        "personCount": person_count,
        "density": round(density, 3),
        "level": level,
        "label": label,
        "fovAreaM2": fov_area_m2,
    }


# ─── API Endpoints ─────────────────────────────────────────────────

@app.post("/detect")
async def detect(image: UploadFile = File(...)):
    start = time.monotonic()

    contents = await image.read()
    img = decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    h, w = img.shape[:2]
    model = get_model()
    results = model(img, conf=CONFIDENCE, verbose=False)

    detections = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            cls_name = model.names.get(cls_id, "unknown")

            det_type, label, color = classify_detection(cls_id, cls_name)

            detections.append({
                "type": det_type,
                "label": label,
                "confidence": round(conf, 2),
                "bbox": {
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "w": round((x2 - x1) / w, 4),
                    "h": round((y2 - y1) / h, 4),
                },
                "classId": cls_id,
                "color": color,
            })

    elapsed_ms = round((time.monotonic() - start) * 1000)

    return {
        "detections": detections,
        "inferenceMs": elapsed_ms,
    }


@app.post("/detect-fire")
async def detect_fire_endpoint(image: UploadFile = File(...)):
    """Detect fire and smoke using OpenCV HSV color analysis."""
    start = time.monotonic()

    contents = await image.read()
    img = decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    result = detect_fire_smoke(img)
    result["inferenceMs"] = round((time.monotonic() - start) * 1000)
    return result


@app.post("/detect-plates")
async def detect_plates_endpoint(image: UploadFile = File(...)):
    """Detect license plates using YOLO + EasyOCR."""
    start = time.monotonic()

    contents = await image.read()
    img = decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    h, w = img.shape[:2]
    model = get_model()
    results = model(img, conf=0.5, verbose=False)

    # Get vehicle bounding boxes
    vehicle_boxes = []
    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            if cls_id in VEHICLE_CLASSES:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                vehicle_boxes.append({
                    "x": x1 / w,
                    "y": y1 / h,
                    "w": (x2 - x1) / w,
                    "h": (y2 - y1) / h,
                })

    plates = detect_plates(img, vehicle_boxes if vehicle_boxes else None)

    return {
        "plates": plates,
        "vehicleCount": len(vehicle_boxes),
        "inferenceMs": round((time.monotonic() - start) * 1000),
    }


@app.post("/analyze-behavior")
async def analyze_behavior_endpoint(
    image: UploadFile = File(...),
    camera_id: str = Form(default="default"),
    pixels_per_meter: float = Form(default=50.0),
    fov_area_m2: float = Form(default=50.0),
):
    """Analyze behavior, speed, and crowd density from frame."""
    start = time.monotonic()

    contents = await image.read()
    img = decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    h, w = img.shape[:2]
    model = get_model()
    results = model(img, conf=CONFIDENCE, verbose=False)

    # Extract person bounding boxes
    person_boxes = []
    for result in results:
        for box in result.boxes:
            cls_id = int(box.cls[0])
            if cls_id == 0:  # person
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                person_boxes.append({
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "w": round((x2 - x1) / w, 4),
                    "h": round((y2 - y1) / h, 4),
                })

    # Behavior analysis
    behaviors = analyze_behavior(img, camera_id, person_boxes)

    # Speed estimation
    speeds = estimate_speeds(camera_id, person_boxes, pixels_per_meter)

    # Crowd density
    density = estimate_crowd_density(len(person_boxes), fov_area_m2)

    return {
        "behaviors": behaviors,
        "speeds": speeds,
        "crowdDensity": density,
        "personCount": len(person_boxes),
        "inferenceMs": round((time.monotonic() - start) * 1000),
    }


# ─── MJPEG Streaming with Server-Side Bounding Boxes ─────────────

from PIL import Image, ImageDraw, ImageFont

# Pillow font for Cyrillic labels
_pil_font = None


def get_pil_font(size: int = 14) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    global _pil_font
    if _pil_font is None:
        for path in [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]:
            try:
                _pil_font = ImageFont.truetype(path, size)
                break
            except (OSError, IOError):
                continue
        if _pil_font is None:
            _pil_font = ImageFont.load_default()
    return _pil_font


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def hex_to_bgr(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color to BGR tuple for OpenCV."""
    r, g, b = hex_to_rgb(hex_color)
    return (b, g, r)


# Pre-rendered Cyrillic label cache: (text, color_rgb) -> BGR numpy array
_label_img_cache: dict[tuple[str, tuple], np.ndarray] = {}


def _render_label(text: str, color_rgb: tuple[int, int, int]) -> np.ndarray:
    """Render Cyrillic text label as a small BGR numpy array (cached)."""
    key = (text, color_rgb)
    if key in _label_img_cache:
        return _label_img_cache[key]

    font = get_pil_font(14)
    # Measure text size
    tmp = Image.new("RGB", (1, 1))
    draw = ImageDraw.Draw(tmp)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Render small label image
    label_img = Image.new("RGB", (tw + 8, th + 4), color_rgb)
    draw = ImageDraw.Draw(label_img)
    draw.text((4, 1), text, fill=(255, 255, 255), font=font)

    result = cv2.cvtColor(np.array(label_img), cv2.COLOR_RGB2BGR)
    _label_img_cache[key] = result
    return result


def draw_detections(img: np.ndarray, detections: list[dict]) -> np.ndarray:
    """Draw bounding boxes and labels. Boxes via OpenCV, Cyrillic via cached Pillow labels."""
    h, w = img.shape[:2]

    for det in detections:
        bbox = det["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        x2 = x1 + int(bbox["w"] * w)
        y2 = y1 + int(bbox["h"] * h)
        color_bgr = hex_to_bgr(det.get("color", "#3B82F6"))
        color_rgb = hex_to_rgb(det.get("color", "#3B82F6"))
        conf = det.get("confidence", 0)
        label = det.get("label", "")

        # Main rectangle
        cv2.rectangle(img, (x1, y1), (x2, y2), color_bgr, 2)

        # Corner accents
        cl = min(14, (x2 - x1) // 3, (y2 - y1) // 3)
        cv2.line(img, (x1, y1), (x1 + cl, y1), color_bgr, 3)
        cv2.line(img, (x1, y1), (x1, y1 + cl), color_bgr, 3)
        cv2.line(img, (x2, y1), (x2 - cl, y1), color_bgr, 3)
        cv2.line(img, (x2, y1), (x2, y1 + cl), color_bgr, 3)
        cv2.line(img, (x1, y2), (x1 + cl, y2), color_bgr, 3)
        cv2.line(img, (x1, y2), (x1, y2 - cl), color_bgr, 3)
        cv2.line(img, (x2, y2), (x2 - cl, y2), color_bgr, 3)
        cv2.line(img, (x2, y2), (x2, y2 - cl), color_bgr, 3)

        # Label: pre-rendered Cyrillic text (small numpy paste, no full-frame PIL)
        text = f"{label} {int(conf * 100)}%"
        label_img = _render_label(text, color_rgb)
        lh, lw = label_img.shape[:2]
        ly = max(y1 - lh - 2, 0)
        lx = max(x1, 0)
        # Clip to image bounds
        paste_w = min(lw, w - lx)
        paste_h = min(lh, h - ly)
        if paste_w > 0 and paste_h > 0:
            img[ly:ly + paste_h, lx:lx + paste_w] = label_img[:paste_h, :paste_w]

    return img


# ─── MJPEG Stream: dual-thread pipeline for 30fps output ─────────

TARGET_FPS = 30
FRAME_INTERVAL = 1.0 / TARGET_FPS  # ~33ms


class MjpegStream:
    """Dual-thread MJPEG stream: YOLO runs in background, output at 30fps."""

    def __init__(self, camera_url: str):
        self.camera_url = camera_url
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.latest_jpeg: bytes | None = None
        self.yolo_fps: float = 0.0
        self._worker: threading.Thread | None = None

    def start(self):
        self._worker = threading.Thread(target=self._yolo_loop, daemon=True)
        self._worker.start()

    def stop(self):
        self.stop_event.set()
        if self._worker:
            self._worker.join(timeout=3)

    def _yolo_loop(self):
        """Background thread: fetch frames → YOLO → draw → cache JPEG."""
        model = get_model()

        # Try cv2.VideoCapture with MJPEG stream (faster than HTTP polling)
        cap = None
        use_http = False
        base = self.camera_url.rstrip("/")

        # Try MJPEG stream endpoints (IP Webcam app, RTSP, etc.)
        for stream_path in ["/video", "/mjpegfeed", ""]:
            try_url = base + stream_path
            if "rtsp://" in try_url or "mjpg" in try_url or "mjpeg" in try_url or stream_path == "/video":
                test_cap = cv2.VideoCapture(try_url)
                if test_cap.isOpened():
                    ret, _ = test_cap.read()
                    if ret:
                        cap = test_cap
                        break
                    test_cap.release()

        if cap is None:
            use_http = True
        stream_url = base + "/shot.jpg"

        http_client = httpx.Client() if use_http else None
        fps_counter = 0
        fps_timer = time.monotonic()

        try:
            while not self.stop_event.is_set():
                # ── Grab frame ──
                img = None
                if cap and cap.isOpened():
                    ret, img = cap.read()
                    if not ret:
                        img = None
                elif http_client:
                    try:
                        resp = http_client.get(stream_url, timeout=2.0)
                        if resp.status_code == 200:
                            nparr = np.frombuffer(resp.content, np.uint8)
                            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    except Exception:
                        pass

                if img is None:
                    time.sleep(0.03)
                    continue

                h, w = img.shape[:2]

                # ── YOLO inference ──
                results = model(img, conf=CONFIDENCE, verbose=False)

                detections = []
                for result in results:
                    for box in result.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        conf_val = float(box.conf[0])
                        cls_id = int(box.cls[0])
                        cls_name = model.names.get(cls_id, "unknown")
                        det_type, label, color = classify_detection(cls_id, cls_name)
                        detections.append({
                            "type": det_type,
                            "label": label,
                            "confidence": conf_val,
                            "bbox": {
                                "x": x1 / w, "y": y1 / h,
                                "w": (x2 - x1) / w, "h": (y2 - y1) / h,
                            },
                            "color": color,
                        })

                # ── Draw + encode ──
                annotated = draw_detections(img, detections)
                _, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])

                with self.lock:
                    self.latest_jpeg = jpeg.tobytes()

                # FPS tracking
                fps_counter += 1
                now = time.monotonic()
                if now - fps_timer >= 1.0:
                    self.yolo_fps = fps_counter / (now - fps_timer)
                    fps_counter = 0
                    fps_timer = now

        finally:
            if cap:
                cap.release()
            if http_client:
                http_client.close()

    async def generate(self):
        """Async generator: output latest JPEG at 30fps."""
        while not self.stop_event.is_set():
            with self.lock:
                jpeg_bytes = self.latest_jpeg

            if jpeg_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(jpeg_bytes)).encode() + b"\r\n"
                    b"\r\n" + jpeg_bytes + b"\r\n"
                )

            await asyncio.sleep(FRAME_INTERVAL)


# Active streams registry
_active_streams: dict[str, MjpegStream] = {}


@app.get("/stream/mjpeg")
async def stream_mjpeg(camera_url: str = Query(..., description="Camera base URL")):
    """Stream MJPEG with YOLO detections at 30fps."""
    # Stop existing stream for this camera
    if camera_url in _active_streams:
        _active_streams[camera_url].stop()

    stream = MjpegStream(camera_url)
    _active_streams[camera_url] = stream
    stream.start()

    return StreamingResponse(
        stream.generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok", "model": "yolov8n"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
