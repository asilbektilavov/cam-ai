import logging
from typing import Optional
from urllib.parse import urlparse

import cv2
import numpy as np
import requests

logger = logging.getLogger(__name__)


def _is_rtsp(url: str) -> bool:
    return url.lower().startswith("rtsp://")


def _is_ip_webcam(url: str) -> bool:
    """Detect IP Webcam style URLs (matching motion-detector.ts logic)."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        path = parsed.path.lower()
        image_exts = (".jpg", ".jpeg", ".png", ".cgi", ".bmp")
        if any(path.endswith(ext) for ext in image_exts):
            return False
        if "/onvif" in path:
            return False
        return True
    except Exception:
        return False


def capture_frame(url: str) -> Optional[np.ndarray]:
    """Capture a single frame from a camera URL.

    Returns a BGR numpy array or None on failure.
    Supports RTSP (via OpenCV/ffmpeg) and HTTP (direct or IP Webcam).
    """
    try:
        if _is_rtsp(url):
            return _capture_rtsp(url)
        return _capture_http(url)
    except Exception as e:
        logger.warning("Frame capture failed for %s: %s", url, e)
        return None


def _capture_rtsp(url: str) -> Optional[np.ndarray]:
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    try:
        ret, frame = cap.read()
        if not ret or frame is None:
            return None
        return frame
    finally:
        cap.release()


def _capture_http(url: str) -> Optional[np.ndarray]:
    effective_url = url
    if _is_ip_webcam(url):
        effective_url = url.rstrip("/") + "/shot.jpg"

    resp = requests.get(effective_url, timeout=5)
    resp.raise_for_status()

    if len(resp.content) < 100:
        logger.warning("HTTP response too small (%d bytes): %s", len(resp.content), url)
        return None

    arr = np.frombuffer(resp.content, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return frame
