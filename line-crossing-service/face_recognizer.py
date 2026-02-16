"""
Face recognizer module for line-crossing service.

Handles face detection + encoding + matching against known employees.
Reuses the same dlib-based approach as attendance-service.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

import cv2
import numpy as np
import face_recognition

log = logging.getLogger("line-crossing")

MATCH_TOLERANCE = 0.55


def distance_to_confidence(distance: float) -> float:
    """Convert face_recognition distance to confidence (0-1).

    Maps [0, MATCH_TOLERANCE] -> [1.0, 0.65] with power curve.
    """
    if distance <= 0:
        return 1.0
    if distance >= MATCH_TOLERANCE:
        return max(0.5, 1.0 - distance)
    ratio = distance / MATCH_TOLERANCE
    return 1.0 - (ratio ** 1.5) * 0.35


class FaceRecognizer:
    """Thread-safe face recognition against known employees."""

    def __init__(self):
        self._employees: list[dict] = []  # [{id, name, encoding}]
        self._lock = threading.Lock()

    def update_employees(self, employees: list[dict]):
        """Update known employees list. Thread-safe."""
        with self._lock:
            self._employees = list(employees)
            log.info("FaceRecognizer: loaded %d employees", len(employees))

    def recognize_in_region(self, frame_rgb: np.ndarray,
                            body_bbox: tuple,
                            frame_h: int, frame_w: int) -> Optional[dict]:
        """Try to detect and recognize a face within a body bounding box region.

        Args:
            frame_rgb: Full frame in RGB format.
            body_bbox: (x1, y1, x2, y2) normalized coordinates of the body.
            frame_h, frame_w: Original frame dimensions.

        Returns:
            Dict with {employee_id, name, confidence, face_bbox} or None.
        """
        x1, y1, x2, y2 = body_bbox
        # Convert normalized to pixel coords with padding
        pad = 0.02
        px1 = max(0, int((x1 - pad) * frame_w))
        py1 = max(0, int((y1 - pad) * frame_h))
        px2 = min(frame_w, int((x2 + pad) * frame_w))
        py2 = min(frame_h, int((y2 + pad) * frame_h))

        crop = frame_rgb[py1:py2, px1:px2]
        if crop.size == 0:
            return None

        # Resize crop for faster face detection (max 500px wide)
        ch, cw = crop.shape[:2]
        max_w = 500
        if cw > max_w:
            scale = max_w / cw
            crop_small = cv2.resize(crop, (max_w, int(ch * scale)))
        else:
            scale = 1.0
            crop_small = crop

        # Detect faces in body region
        face_locs = face_recognition.face_locations(crop_small, model="hog")
        if not face_locs:
            return None

        # Use the largest face
        largest = max(face_locs, key=lambda loc: (loc[2] - loc[0]) * (loc[1] - loc[3]))
        top_s, right_s, bottom_s, left_s = largest

        # Scale back to crop coordinates
        if scale != 1.0:
            top_c = int(top_s / scale)
            right_c = int(right_s / scale)
            bottom_c = int(bottom_s / scale)
            left_c = int(left_s / scale)
        else:
            top_c, right_c, bottom_c, left_c = top_s, right_s, bottom_s, left_s

        # Get encoding from the crop at original resolution
        face_loc_orig = [(top_c, right_c, bottom_c, left_c)]
        encodings = face_recognition.face_encodings(crop, face_loc_orig)
        if not encodings:
            return None

        encoding = encodings[0]

        # Match against known employees
        with self._lock:
            if not self._employees:
                return None

            emp_encodings = [e["encoding"] for e in self._employees]
            distances = face_recognition.face_distance(emp_encodings, encoding)
            best_idx = int(np.argmin(distances))
            best_dist = distances[best_idx]

            if best_dist > MATCH_TOLERANCE:
                return None

            emp = self._employees[best_idx]

            # Compute face bbox in normalized frame coordinates
            face_x1 = (px1 + left_c) / frame_w
            face_y1 = (py1 + top_c) / frame_h
            face_x2 = (px1 + right_c) / frame_w
            face_y2 = (py1 + bottom_c) / frame_h

            return {
                "employee_id": emp["id"],
                "name": emp["name"],
                "confidence": distance_to_confidence(best_dist),
                "face_bbox": (face_x1, face_y1, face_x2, face_y2),
            }
