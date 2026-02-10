"""CamAI Detection Service Extensions — Phase 2/3 Features

New endpoints:
- POST /detect-ppe            — PPE violation detection (hard hat, safety vest)
- POST /detect-shelf-fullness — Retail shelf fullness analysis
- POST /extract-features      — Person ReID feature extraction
- POST /match-persons         — Cross-camera person matching
- POST /dewarp                — Fisheye lens dewarping
- POST /analyze-audio         — Audio event classification (gunshot, scream, glass, alarm)
"""
from __future__ import annotations

import io
import json
import math
import time
import wave

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter()


def _get_model():
    from main import get_model
    return get_model()


def _get_confidence():
    from main import CONFIDENCE
    return CONFIDENCE


def _decode_image(contents: bytes):
    from main import decode_image
    return decode_image(contents)


# ═══════════════════════════════════════════════════════════════════════
#  1. PPE Detection (Hard Hat + Safety Vest via HSV color analysis)
# ═══════════════════════════════════════════════════════════════════════

PPE_HARDHAT_HSV_RANGES = [
    (np.array([20, 100, 150]), np.array([35, 255, 255])),   # Yellow
    (np.array([0, 0, 200]), np.array([180, 30, 255])),      # White
    (np.array([10, 150, 150]), np.array([25, 255, 255])),   # Orange
    (np.array([0, 120, 150]), np.array([10, 255, 255])),    # Red
]

PPE_VEST_HSV_RANGES = [
    (np.array([20, 100, 150]), np.array([85, 255, 255])),   # Yellow/green hi-vis
    (np.array([10, 150, 150]), np.array([25, 255, 255])),   # Orange hi-vis
]

PPE_MIN_COVERAGE = 0.12  # 12 % of region must match PPE colour


def detect_ppe_in_frame(
    img: np.ndarray, person_boxes: list[dict],
) -> list[dict]:
    """Check each detected person for hard hat and safety vest."""
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    results: list[dict] = []

    for i, pbox in enumerate(person_boxes):
        px = max(0, int(pbox["x"] * w))
        py = max(0, int(pbox["y"] * h))
        pw = max(1, min(int(pbox["w"] * w), w - px))
        ph = max(1, min(int(pbox["h"] * h), h - py))

        rec: dict = {
            "personIndex": i,
            "bbox": pbox,
            "hardHat": False,
            "hardHatConfidence": 0.0,
            "safetyVest": False,
            "safetyVestConfidence": 0.0,
            "violations": [],
        }

        # --- head region (top 25 %) ---
        head_h = max(1, int(ph * 0.25))
        head_roi = hsv[py : py + head_h, px : px + pw]
        if head_roi.size > 0:
            head_px = head_roi.shape[0] * head_roi.shape[1]
            best = 0.0
            for lo, hi in PPE_HARDHAT_HSV_RANGES:
                mask = cv2.inRange(head_roi, lo, hi)
                best = max(best, float(np.count_nonzero(mask)) / head_px)
            if best >= PPE_MIN_COVERAGE:
                rec["hardHat"] = True
                rec["hardHatConfidence"] = round(min(best * 3, 0.95), 3)
            else:
                rec["violations"].append("no_hard_hat")

        # --- torso region (25-60 %) ---
        torso_y = py + int(ph * 0.25)
        torso_h = max(1, int(ph * 0.35))
        torso_roi = hsv[torso_y : torso_y + torso_h, px : px + pw]
        if torso_roi.size > 0:
            torso_px = torso_roi.shape[0] * torso_roi.shape[1]
            best = 0.0
            for lo, hi in PPE_VEST_HSV_RANGES:
                mask = cv2.inRange(torso_roi, lo, hi)
                best = max(best, float(np.count_nonzero(mask)) / torso_px)
            if best >= PPE_MIN_COVERAGE:
                rec["safetyVest"] = True
                rec["safetyVestConfidence"] = round(min(best * 3, 0.95), 3)
            else:
                rec["violations"].append("no_safety_vest")

        results.append(rec)

    return results


@router.post("/detect-ppe")
async def detect_ppe_endpoint(image: UploadFile = File(...)):
    """Detect PPE violations (hard hat, safety vest) for all persons."""
    start = time.monotonic()
    contents = await image.read()
    img = _decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    h, w = img.shape[:2]
    model = _get_model()
    results = model(img, conf=_get_confidence(), verbose=False)

    person_boxes: list[dict] = []
    for result in results:
        for box in result.boxes:
            if int(box.cls[0]) == 0:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                person_boxes.append({
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "w": round((x2 - x1) / w, 4),
                    "h": round((y2 - y1) / h, 4),
                })

    ppe = detect_ppe_in_frame(img, person_boxes)
    total_v = sum(len(r["violations"]) for r in ppe)

    return {
        "persons": ppe,
        "personCount": len(person_boxes),
        "totalViolations": total_v,
        "inferenceMs": round((time.monotonic() - start) * 1000),
    }


# ═══════════════════════════════════════════════════════════════════════
#  2. Shelf Fullness Analysis (edge density + colour variance)
# ═══════════════════════════════════════════════════════════════════════


def analyze_shelf_fullness(
    img: np.ndarray,
    roi: dict | None = None,
) -> dict:
    """Estimate shelf fill percentage using edge density, colour variance
    and Laplacian texture analysis."""
    h, w = img.shape[:2]

    if roi:
        rx = max(0, int(roi.get("x", 0) * w))
        ry = max(0, int(roi.get("y", 0) * h))
        rw = max(1, min(int(roi.get("w", 1) * w), w - rx))
        rh = max(1, min(int(roi.get("h", 1) * h), h - ry))
        region = img[ry : ry + rh, rx : rx + rw]
    else:
        region = img

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)

    # Edge density (Canny)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.count_nonzero(edges)) / max(gray.size, 1)

    # Colour variance (HSV channels)
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    h_std = float(np.std(hsv[:, :, 0]))
    s_std = float(np.std(hsv[:, :, 1]))
    v_std = float(np.std(hsv[:, :, 2]))
    colour_var = (h_std + s_std + v_std) / 3.0

    # Texture (Laplacian variance)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # Combined score (0-100 %)
    edge_score = min(edge_density / 0.15, 1.0)
    colour_score = min(colour_var / 40.0, 1.0)
    texture_score = min(lap_var / 500.0, 1.0)
    fullness = round(
        (edge_score * 0.4 + colour_score * 0.3 + texture_score * 0.3) * 100, 1,
    )
    fullness = min(fullness, 100.0)

    if fullness >= 80:
        status, label = "full", "Полная"
    elif fullness >= 50:
        status, label = "partial", "Частично заполнена"
    elif fullness >= 20:
        status, label = "low", "Мало товара"
    else:
        status, label = "empty", "Пустая"

    return {
        "fullnessPercent": fullness,
        "status": status,
        "label": label,
        "metrics": {
            "edgeDensity": round(edge_density, 4),
            "colorVariance": round(colour_var, 2),
            "textureVariance": round(lap_var, 2),
        },
    }


@router.post("/detect-shelf-fullness")
async def detect_shelf_fullness_endpoint(
    image: UploadFile = File(...),
    roi_x: float = Form(default=0.0),
    roi_y: float = Form(default=0.0),
    roi_w: float = Form(default=1.0),
    roi_h: float = Form(default=1.0),
):
    """Analyse shelf fullness within an optional ROI."""
    start = time.monotonic()
    contents = await image.read()
    img = _decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    roi = {"x": roi_x, "y": roi_y, "w": roi_w, "h": roi_h}
    result = analyze_shelf_fullness(img, roi)
    result["inferenceMs"] = round((time.monotonic() - start) * 1000)
    return result


# ═══════════════════════════════════════════════════════════════════════
#  3. Person Re-Identification (colour histogram + HOG features)
# ═══════════════════════════════════════════════════════════════════════


def extract_person_features(img: np.ndarray, bbox: dict) -> np.ndarray:
    """Extract an appearance feature vector from a person crop.

    Features: upper/lower body HSV histograms + simplified HOG.
    """
    h, w = img.shape[:2]
    px = max(0, int(bbox["x"] * w))
    py = max(0, int(bbox["y"] * h))
    pw = max(1, min(int(bbox["w"] * w), w - px))
    ph = max(1, min(int(bbox["h"] * h), h - py))

    crop = img[py : py + ph, px : px + pw]
    if crop.size == 0:
        return np.zeros(192, dtype=np.float32)

    crop = cv2.resize(crop, (64, 128))

    upper = crop[:64, :]
    lower = crop[64:, :]

    feats: list[float] = []
    for part in [upper, lower]:
        hsv_part = cv2.cvtColor(part, cv2.COLOR_BGR2HSV)
        h_hist = cv2.calcHist([hsv_part], [0], None, [16], [0, 180])
        s_hist = cv2.calcHist([hsv_part], [1], None, [8], [0, 256])
        v_hist = cv2.calcHist([hsv_part], [2], None, [8], [0, 256])
        cv2.normalize(h_hist, h_hist)
        cv2.normalize(s_hist, s_hist)
        cv2.normalize(v_hist, v_hist)
        feats.extend(h_hist.flatten().tolist())
        feats.extend(s_hist.flatten().tolist())
        feats.extend(v_hist.flatten().tolist())

    # Simplified HOG (gradient orientation histograms on 4x4 grid)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.sqrt(gx ** 2 + gy ** 2)
    ang = np.arctan2(gy, gx) * 180.0 / np.pi + 180.0  # 0–360

    cell_h, cell_w = 32, 16
    for cy in range(0, 128, cell_h):
        for cx in range(0, 64, cell_w):
            cm = mag[cy : cy + cell_h, cx : cx + cell_w]
            ca = ang[cy : cy + cell_h, cx : cx + cell_w]
            hist, _ = np.histogram(ca, bins=8, range=(0, 360), weights=cm)
            s = hist.sum()
            if s > 0:
                hist = hist / s
            feats.extend(hist.tolist())

    return np.array(feats, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


@router.post("/extract-features")
async def extract_features_endpoint(
    image: UploadFile = File(...),
    camera_id: str = Form(default="default"),
):
    """Extract ReID feature vectors for every person in frame."""
    start = time.monotonic()
    contents = await image.read()
    img = _decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    h, w = img.shape[:2]
    model = _get_model()
    results = model(img, conf=_get_confidence(), verbose=False)

    persons: list[dict] = []
    for result in results:
        for box in result.boxes:
            if int(box.cls[0]) == 0:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                bbox = {
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "w": round((x2 - x1) / w, 4),
                    "h": round((y2 - y1) / h, 4),
                }
                fv = extract_person_features(img, bbox)
                persons.append({
                    "bbox": bbox,
                    "features": fv.tolist(),
                    "featureDim": len(fv),
                })

    return {
        "persons": persons,
        "cameraId": camera_id,
        "personCount": len(persons),
        "inferenceMs": round((time.monotonic() - start) * 1000),
    }


@router.post("/match-persons")
async def match_persons_endpoint(
    features_a: str = Form(..., description="JSON array of feature vectors from camera A"),
    features_b: str = Form(..., description="JSON array of feature vectors from camera B"),
    threshold: float = Form(default=0.70),
):
    """Match persons across two cameras using cosine similarity."""
    start = time.monotonic()

    try:
        feats_a = json.loads(features_a)
        feats_b = json.loads(features_b)
    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})

    matches: list[dict] = []
    used_b: set[int] = set()
    for i, fa in enumerate(feats_a):
        va = np.array(fa, dtype=np.float32)
        best_j = -1
        best_sim = threshold
        for j, fb in enumerate(feats_b):
            if j in used_b:
                continue
            vb = np.array(fb, dtype=np.float32)
            sim = cosine_similarity(va, vb)
            if sim > best_sim:
                best_sim = sim
                best_j = j
        if best_j >= 0:
            used_b.add(best_j)
            matches.append({
                "personA": i,
                "personB": best_j,
                "similarity": round(best_sim, 4),
            })

    return {
        "matches": matches,
        "totalA": len(feats_a),
        "totalB": len(feats_b),
        "matchCount": len(matches),
        "threshold": threshold,
        "inferenceMs": round((time.monotonic() - start) * 1000),
    }


# ═══════════════════════════════════════════════════════════════════════
#  4. Fisheye Dewarping (equirectangular projection via OpenCV remap)
# ═══════════════════════════════════════════════════════════════════════

_dewarp_cache: dict[tuple, tuple[np.ndarray, np.ndarray]] = {}


def dewarp_fisheye(
    img: np.ndarray,
    fov: float = 180.0,
    cx_ratio: float = 0.5,
    cy_ratio: float = 0.5,
) -> np.ndarray:
    """Remove fisheye distortion using equirectangular re-projection."""
    h, w = img.shape[:2]
    cache_key = (h, w, fov, cx_ratio, cy_ratio)

    if cache_key in _dewarp_cache:
        map_x, map_y = _dewarp_cache[cache_key]
    else:
        cx = w * cx_ratio
        cy = h * cy_ratio
        fov_rad = fov * np.pi / 180.0
        f = min(w, h) / (2.0 * np.tan(fov_rad / 2.0 + 1e-6))

        xs, ys = np.meshgrid(np.arange(w, dtype=np.float32),
                             np.arange(h, dtype=np.float32))
        nx = (xs - cx) / f
        ny = (ys - cy) / f
        r = np.sqrt(nx ** 2 + ny ** 2)
        r = np.maximum(r, 1e-8)
        theta = np.arctan(r)
        rc = f * theta

        map_x = (cx + rc * nx / r).astype(np.float32)
        map_y = (cy + rc * ny / r).astype(np.float32)

        # Keep small cache (max 8 entries)
        if len(_dewarp_cache) >= 8:
            _dewarp_cache.pop(next(iter(_dewarp_cache)))
        _dewarp_cache[cache_key] = (map_x, map_y)

    return cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT)


@router.post("/dewarp")
async def dewarp_endpoint(
    image: UploadFile = File(...),
    fov: float = Form(default=180.0),
    cx: float = Form(default=0.5),
    cy: float = Form(default=0.5),
):
    """Dewarp a fisheye image and return corrected JPEG."""
    start = time.monotonic()
    contents = await image.read()
    img = _decode_image(contents)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    dewarped = dewarp_fisheye(img, fov, cx, cy)
    _, jpeg = cv2.imencode(".jpg", dewarped, [cv2.IMWRITE_JPEG_QUALITY, 90])

    return StreamingResponse(
        io.BytesIO(jpeg.tobytes()),
        media_type="image/jpeg",
        headers={
            "X-Inference-Ms": str(round((time.monotonic() - start) * 1000)),
        },
    )


# ═══════════════════════════════════════════════════════════════════════
#  5. Audio Analytics (spectral analysis — gunshot / scream / glass / alarm)
# ═══════════════════════════════════════════════════════════════════════


def _band_energy(
    magnitudes: np.ndarray, freqs: np.ndarray, f_lo: float, f_hi: float,
) -> float:
    mask = (freqs >= f_lo) & (freqs < f_hi)
    return float(np.sum(magnitudes[mask] ** 2))


def analyze_audio_data(audio_bytes: bytes, sample_rate: int = 16000) -> dict:
    """Classify audio events using FFT spectral analysis."""
    # --- decode ---
    try:
        buf = io.BytesIO(audio_bytes)
        with wave.open(buf, "rb") as wf:
            n_ch = wf.getnchannels()
            sw = wf.getsampwidth()
            sample_rate = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
            if sw == 2:
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
            elif sw == 4:
                samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32)
            else:
                samples = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128
            if n_ch > 1:
                samples = samples[::n_ch]
    except Exception:
        samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)

    if len(samples) == 0:
        return {"events": [], "rmsDb": -100, "peakDb": -100}

    mx = max(abs(float(samples.max())), abs(float(samples.min())), 1.0)
    samples = samples / mx

    rms = float(np.sqrt(np.mean(samples ** 2)))
    peak = float(np.max(np.abs(samples)))
    rms_db = round(20 * np.log10(rms + 1e-10), 1)
    peak_db = round(20 * np.log10(peak + 1e-10), 1)

    # --- FFT ---
    fft = np.fft.rfft(samples)
    freqs = np.fft.rfftfreq(len(samples), d=1.0 / sample_rate)
    mags = np.abs(fft) / max(len(samples), 1)

    low_e = _band_energy(mags, freqs, 20, 300)
    mid_e = _band_energy(mags, freqs, 300, 2000)
    high_e = _band_energy(mags, freqs, 2000, 8000)
    total_e = low_e + mid_e + high_e + 1e-10

    spectral_centroid = 0.0
    mag_sum = mags.sum()
    if mag_sum > 0:
        spectral_centroid = float(np.sum(freqs * mags) / mag_sum)

    events: list[dict] = []

    # --- gunshot: broadband impulsive ---
    if peak_db > -6 and low_e / total_e > 0.25 and high_e / total_e > 0.15:
        crest = peak / (rms + 1e-10)
        if crest > 4.0:
            events.append({
                "type": "gunshot",
                "label": "Выстрел",
                "confidence": round(min(crest / 10.0, 0.95), 3),
                "severity": "critical",
            })

    # --- scream: sustained high-frequency ---
    if spectral_centroid > 1000 and high_e / total_e > 0.35 and rms_db > -20:
        events.append({
            "type": "scream",
            "label": "Крик",
            "confidence": round(min(high_e / total_e, 0.90), 3),
            "severity": "warning",
        })

    # --- glass breaking: very high freq + impulsive ---
    if high_e / total_e > 0.45 and spectral_centroid > 3000 and peak_db > -10:
        events.append({
            "type": "glass_breaking",
            "label": "Разбитие стекла",
            "confidence": round(min(high_e / total_e * 1.5, 0.90), 3),
            "severity": "warning",
        })

    # --- alarm / siren: dominant tonal frequency + harmonics ---
    if rms_db > -15 and len(mags) > 2:
        dom_idx = int(np.argmax(mags[1:])) + 1
        dom_freq = float(freqs[dom_idx])
        dom_mag = float(mags[dom_idx])
        if 500 < dom_freq < 4000:
            harm_idx = int(np.argmin(np.abs(freqs - dom_freq * 2)))
            harm_mag = float(mags[harm_idx])
            if harm_mag > dom_mag * 0.3:
                mean_mag = float(mags.mean()) + 1e-10
                events.append({
                    "type": "alarm",
                    "label": "Сирена / Сигнализация",
                    "confidence": round(min(dom_mag / mean_mag / 50.0, 0.90), 3),
                    "severity": "info",
                    "frequency": round(dom_freq, 1),
                })

    # --- generic loud sound ---
    if not events and rms_db > -10:
        events.append({
            "type": "loud_sound",
            "label": "Громкий звук",
            "confidence": round(min((rms_db + 10) / 10.0, 0.80), 3),
            "severity": "info",
        })

    return {
        "events": events,
        "rmsDb": rms_db,
        "peakDb": peak_db,
        "spectralCentroid": round(spectral_centroid, 1),
        "bandEnergy": {
            "low": round(low_e, 6),
            "mid": round(mid_e, 6),
            "high": round(high_e, 6),
        },
    }


@router.post("/analyze-audio")
async def analyze_audio_endpoint(
    audio: UploadFile = File(...),
    sample_rate: int = Form(default=16000),
):
    """Classify audio events (gunshot, scream, glass breaking, alarm)."""
    start = time.monotonic()
    contents = await audio.read()
    if len(contents) == 0:
        return JSONResponse(status_code=400, content={"error": "Empty audio"})

    result = analyze_audio_data(contents, sample_rate)
    result["inferenceMs"] = round((time.monotonic() - start) * 1000)
    result["durationMs"] = round(len(contents) / max(sample_rate * 2, 1) * 1000)
    return result
