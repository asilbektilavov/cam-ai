import os
import socket
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import List
from urllib.parse import urlparse

from .version import __version__

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CameraConfig:
    id: str
    url: str
    name: str
    location: str


@dataclass(frozen=True)
class AgentConfig:
    api_url: str
    api_key: str
    agent_name: str
    version: str
    cameras: List[CameraConfig]
    sync_interval: int
    capture_interval: int
    motion_threshold: float
    detection_cooldown: int
    log_level: str
    yolo_model: str
    yolo_confidence: float


def _derive_camera_name(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "unknown"
        port = parsed.port
        if port:
            return f"{host}:{port}"
        return host
    except Exception:
        return "camera"


def _parse_cameras(raw: str) -> List[CameraConfig]:
    cameras = []
    for url in raw.split(","):
        url = url.strip()
        if not url:
            continue
        cam_id = hashlib.sha256(url.encode()).hexdigest()[:8]
        name = _derive_camera_name(url)
        cameras.append(CameraConfig(
            id=cam_id,
            url=url,
            name=name,
            location="auto-discovered",
        ))
    return cameras


def load_config() -> AgentConfig:
    api_url = os.environ.get("API_URL", "").rstrip("/")
    api_key = os.environ.get("API_KEY", "")

    if not api_url:
        raise SystemExit("ERROR: API_URL environment variable is required")
    if not api_key:
        raise SystemExit("ERROR: API_KEY environment variable is required")
    if not re.match(r"^cam_[a-f0-9]{48}$", api_key):
        logger.warning("API_KEY does not match expected format cam_<48hex>")

    raw_urls = os.environ.get("CAMERA_URLS", "")
    cameras = _parse_cameras(raw_urls)

    return AgentConfig(
        api_url=api_url,
        api_key=api_key,
        agent_name=os.environ.get("AGENT_NAME", socket.gethostname()),
        version=__version__,
        cameras=cameras,
        sync_interval=int(os.environ.get("SYNC_INTERVAL", "30")),
        capture_interval=int(os.environ.get("CAPTURE_INTERVAL", "2")),
        motion_threshold=float(os.environ.get("MOTION_THRESHOLD", "5.0")),
        detection_cooldown=int(os.environ.get("DETECTION_COOLDOWN", "60")),
        log_level=os.environ.get("LOG_LEVEL", "INFO"),
        yolo_model=os.environ.get("YOLO_MODEL", "/app/models/yolov8n.pt"),
        yolo_confidence=float(os.environ.get("YOLO_CONFIDENCE", "0.4")),
    )
