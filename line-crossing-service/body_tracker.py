"""
Simple centroid-based multi-object tracker.

Tracks body detections across frames by matching centroids with minimum distance.
Designed for 1-2 cameras with moderate traffic (5-15 people).
"""

from __future__ import annotations

import logging
from collections import OrderedDict

import numpy as np
from scipy.spatial.distance import cdist

log = logging.getLogger("line-crossing")


class CentroidTracker:
    """Track objects across frames using centroid distance matching.

    Args:
        max_disappeared: Number of consecutive frames an object can be missing
                         before being deregistered.
        max_distance: Maximum distance (normalized 0-1) to match centroids.
    """

    def __init__(self, max_disappeared: int = 15, max_distance: float = 0.15):
        self.next_id = 0
        self.objects: OrderedDict[int, np.ndarray] = OrderedDict()     # id -> centroid [cx, cy]
        self.prev_objects: OrderedDict[int, np.ndarray] = OrderedDict()  # id -> previous centroid
        self.bboxes: dict[int, tuple] = {}                               # id -> (x1, y1, x2, y2) normalized
        self.disappeared: OrderedDict[int, int] = OrderedDict()
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    def _register(self, centroid: np.ndarray, bbox: tuple):
        obj_id = self.next_id
        self.objects[obj_id] = centroid
        self.prev_objects[obj_id] = centroid.copy()
        self.bboxes[obj_id] = bbox
        self.disappeared[obj_id] = 0
        self.next_id += 1
        return obj_id

    def _deregister(self, obj_id: int):
        del self.objects[obj_id]
        self.prev_objects.pop(obj_id, None)
        self.bboxes.pop(obj_id, None)
        del self.disappeared[obj_id]

    def update(self, detections: list[tuple]) -> dict[int, dict]:
        """Update tracker with new detections.

        Args:
            detections: List of (x1, y1, x2, y2) bounding boxes in normalized coords (0-1).

        Returns:
            Dict of {track_id: {"centroid": [cx, cy], "prev_centroid": [cx, cy], "bbox": (x1,y1,x2,y2)}}
            Only includes objects that existed in the previous frame (have prev_centroid).
        """
        if len(detections) == 0:
            for obj_id in list(self.disappeared.keys()):
                self.disappeared[obj_id] += 1
                if self.disappeared[obj_id] > self.max_disappeared:
                    self._deregister(obj_id)
            return {}

        # Compute centroids for new detections
        new_centroids = np.array([
            [(d[0] + d[2]) / 2, (d[1] + d[3]) / 2] for d in detections
        ])

        if len(self.objects) == 0:
            for i, centroid in enumerate(new_centroids):
                self._register(centroid, detections[i])
            return {}

        # Match existing objects to new detections
        obj_ids = list(self.objects.keys())
        obj_centroids = np.array(list(self.objects.values()))

        D = cdist(obj_centroids, new_centroids)

        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows = set()
        used_cols = set()

        results = {}

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
            if D[row, col] > self.max_distance:
                continue

            obj_id = obj_ids[row]
            # Save previous centroid before updating
            self.prev_objects[obj_id] = self.objects[obj_id].copy()
            self.objects[obj_id] = new_centroids[col]
            self.bboxes[obj_id] = detections[col]
            self.disappeared[obj_id] = 0

            results[obj_id] = {
                "centroid": new_centroids[col].tolist(),
                "prev_centroid": self.prev_objects[obj_id].tolist(),
                "bbox": detections[col],
            }

            used_rows.add(row)
            used_cols.add(col)

        # Handle disappeared objects
        for row in range(len(obj_ids)):
            if row not in used_rows:
                obj_id = obj_ids[row]
                self.disappeared[obj_id] += 1
                if self.disappeared[obj_id] > self.max_disappeared:
                    self._deregister(obj_id)

        # Register new objects
        for col in range(len(new_centroids)):
            if col not in used_cols:
                self._register(new_centroids[col], detections[col])

        return results
