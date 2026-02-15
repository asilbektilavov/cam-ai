"""
Lightweight YOLOv8n person detector using OpenCV DNN.
No extra dependencies — uses cv2.dnn.readNetFromONNX().

Used as zoom trigger: detect person in frame → zoom camera → then dlib does face recognition.
~30-50ms per frame at 320x320 on CPU.
"""

import os
import time
import logging
import numpy as np
import cv2

log = logging.getLogger("attendance")

# YOLOv8n ONNX model path
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "yolov8n.onnx")

# COCO class 0 = person
PERSON_CLASS = 0
CONFIDENCE_THRESHOLD = 0.15
INPUT_SIZE = 320


class PersonDetector:
    """
    Detect persons in frame using YOLOv8n ONNX via OpenCV DNN.
    Returns bounding boxes in (top, right, bottom, left) format
    (same as face_recognition for compatibility with auto_zoom).
    """

    def __init__(self):
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"YOLO model not found: {MODEL_PATH}")

        log.info("PersonDetector: loading YOLOv8n ONNX from %s", MODEL_PATH)
        self._net = cv2.dnn.readNetFromONNX(MODEL_PATH)
        # Prefer CPU backend (CoreML/OpenCL can cause issues)
        self._net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self._net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        log.info("PersonDetector: ready (input=%dx%d, conf=%.2f)",
                 INPUT_SIZE, INPUT_SIZE, CONFIDENCE_THRESHOLD)

    def detect(self, frame_bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
        """
        Detect persons in a BGR frame.

        Args:
            frame_bgr: OpenCV BGR image (any size, will be resized)

        Returns:
            List of (top, right, bottom, left) tuples in original frame coords.
            Only returns persons (COCO class 0).
        """
        h, w = frame_bgr.shape[:2]

        # Preprocess: resize to 320x320, normalize to [0, 1]
        blob = cv2.dnn.blobFromImage(
            frame_bgr, 1.0 / 255.0, (INPUT_SIZE, INPUT_SIZE),
            swapRB=True, crop=False
        )
        self._net.setInput(blob)

        # Forward pass
        outputs = self._net.forward()

        # YOLOv8 output: (1, 84, N) where 84 = 4 bbox + 80 classes
        # Transpose to (N, 84)
        output = outputs[0]  # shape: (1, 84, N) or (84, N)
        if output.ndim == 3:
            output = output[0]  # (84, N)
        output = output.T  # (N, 84)

        # Extract boxes and class scores
        boxes = output[:, :4]       # cx, cy, w, h (normalized to INPUT_SIZE)
        scores = output[:, 4:]      # 80 class scores

        # Filter: only person class (0) with sufficient confidence
        person_scores = scores[:, PERSON_CLASS]
        mask = person_scores > CONFIDENCE_THRESHOLD

        if not np.any(mask):
            return []

        filtered_boxes = boxes[mask]
        filtered_scores = person_scores[mask]

        # Convert from cx, cy, w, h to x1, y1, x2, y2 (in INPUT_SIZE coords)
        cx = filtered_boxes[:, 0]
        cy = filtered_boxes[:, 1]
        bw = filtered_boxes[:, 2]
        bh = filtered_boxes[:, 3]

        x1 = cx - bw / 2
        y1 = cy - bh / 2
        x2 = cx + bw / 2
        y2 = cy + bh / 2

        # NMS to remove duplicates
        indices = cv2.dnn.NMSBoxes(
            bboxes=list(zip(x1.tolist(), y1.tolist(), bw.tolist(), bh.tolist())),
            scores=filtered_scores.tolist(),
            score_threshold=CONFIDENCE_THRESHOLD,
            nms_threshold=0.45,
        )

        if len(indices) == 0:
            return []

        # Flatten indices (NMSBoxes returns different shapes in different OpenCV versions)
        indices = np.array(indices).flatten()

        # Scale back to original frame coordinates
        scale_x = w / INPUT_SIZE
        scale_y = h / INPUT_SIZE

        results = []
        for i in indices:
            top = int(y1[i] * scale_y)
            right = int(x2[i] * scale_x)
            bottom = int(y2[i] * scale_y)
            left = int(x1[i] * scale_x)

            # Clamp to frame bounds
            top = max(0, top)
            left = max(0, left)
            bottom = min(h, bottom)
            right = min(w, right)

            results.append((top, right, bottom, left))

        return results

    def detect_for_zoom(
        self, frame_bgr: np.ndarray, frame_h: int, frame_w: int
    ) -> list[tuple[int, int, int, int]]:
        """
        Detect persons and return estimated face regions for zoom triggering.
        Converts person bbox to upper-body/head region that auto_zoom can use.

        Returns face-like (top, right, bottom, left) tuples at the downscaled resolution
        that auto_zoom expects (matching small_h, small_w).
        """
        # Detect persons on original frame
        persons = self.detect(frame_bgr)
        if not persons:
            return []

        # Convert person bbox to estimated head region
        # Head is approximately upper 1/5 of person, centered horizontally
        face_regions = []
        for top, right, bottom, left in persons:
            person_h = bottom - top
            person_w = right - left

            # Estimate head: upper 1/5 of person, center 60% width
            head_h = person_h // 5
            head_w = person_w * 3 // 5
            head_cx = (left + right) // 2

            head_top = top
            head_bottom = top + head_h
            head_left = head_cx - head_w // 2
            head_right = head_cx + head_w // 2

            # Scale to downscaled coordinates (frame_h, frame_w)
            orig_h, orig_w = frame_bgr.shape[:2]
            sy = frame_h / orig_h
            sx = frame_w / orig_w

            face_regions.append((
                int(head_top * sy),
                int(head_right * sx),
                int(head_bottom * sy),
                int(head_left * sx),
            ))

        return face_regions
