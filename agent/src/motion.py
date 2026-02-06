import cv2
import numpy as np

COMPARE_SIZE = 64


def compute_motion(frame1: np.ndarray, frame2: np.ndarray) -> float:
    """Compare two BGR frames and return motion percentage (0-100).

    Resizes both frames to 64x64 grayscale and computes the average
    absolute pixel difference as a percentage. This mirrors the
    compareFrames() algorithm from motion-detector.ts.
    """
    gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
    gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)

    small1 = cv2.resize(gray1, (COMPARE_SIZE, COMPARE_SIZE))
    small2 = cv2.resize(gray2, (COMPARE_SIZE, COMPARE_SIZE))

    diff = np.abs(small1.astype(np.float32) - small2.astype(np.float32))
    pixel_count = COMPARE_SIZE * COMPARE_SIZE
    total_diff = float(np.sum(diff))

    return (total_diff / (pixel_count * 255.0)) * 100.0
