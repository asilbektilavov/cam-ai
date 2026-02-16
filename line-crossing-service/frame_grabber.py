"""
Frame grabber — background thread that reads RTSP/HTTP streams and keeps only the latest frame.
Copied from attendance-service with minimal changes for independence.
"""

from __future__ import annotations

import os
import time
import logging
import threading
from typing import Optional

import cv2
import numpy as np
import httpx

log = logging.getLogger("line-crossing")


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

                time.sleep(0.3)
            except Exception as e:
                retry_count += 1
                self._connected = False
                if retry_count >= max_retries:
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
                    log.error("Grabber %s: max retries reached", self.camera_id)
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
                    time.sleep(5)
                    continue
                retry_count = 0
                self._connected = True
                log.info("Grabber %s: connected to %s", self.camera_id, self.stream_url)

            ret, frame = cap.read()
            if not ret or frame is None:
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
