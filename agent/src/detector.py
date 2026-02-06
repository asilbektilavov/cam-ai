import logging
import threading
from dataclasses import dataclass, field
from typing import List

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class Detection:
    class_id: int
    class_name: str
    confidence: float
    bbox: tuple  # (x1, y1, x2, y2)


@dataclass
class DetectionResult:
    people_count: int = 0
    detections: List[Detection] = field(default_factory=list)


class Detector:
    """YOLOv8n wrapper with thread-safe inference."""

    def __init__(self, model_path: str, confidence: float = 0.4):
        logger.info("Loading YOLO model from %s", model_path)
        from ultralytics import YOLO
        self.model = YOLO(model_path)
        self.confidence = confidence
        self._lock = threading.Lock()
        logger.info("YOLO model loaded successfully")

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """Run detection on a BGR frame. Thread-safe."""
        with self._lock:
            results = self.model(frame, conf=self.confidence, verbose=False)

        detections = []
        people_count = 0

        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                cls_name = result.names[cls_id]
                conf = float(box.conf[0])
                bbox = tuple(box.xyxy[0].tolist())

                detections.append(Detection(
                    class_id=cls_id,
                    class_name=cls_name,
                    confidence=conf,
                    bbox=bbox,
                ))

                if cls_id == 0:  # 'person' in COCO
                    people_count += 1

        return DetectionResult(people_count=people_count, detections=detections)
