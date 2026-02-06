import logging
import signal
import threading
from typing import List, Optional

import numpy as np

from .camera import capture_frame
from .config import AgentConfig, CameraConfig, load_config
from .detector import Detector
from .events import EventBuffer
from .motion import compute_motion
from .sync import SyncClient

logger = logging.getLogger("camai-agent")


class CameraWorker:
    """Capture loop for a single camera. Runs in its own thread."""

    def __init__(
        self,
        cam: CameraConfig,
        config: AgentConfig,
        detector: Detector,
        event_buffer: EventBuffer,
        sync_client: SyncClient,
    ):
        self._cam = cam
        self._config = config
        self._detector = detector
        self._buffer = event_buffer
        self._sync = sync_client
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._last_frame: Optional[np.ndarray] = None

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._run, name=f"cam-{self._cam.id}", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)

    def _run(self) -> None:
        logger.info("Camera worker started: %s (%s)", self._cam.name, self._cam.url)

        while not self._stop.is_set():
            try:
                frame = capture_frame(self._cam.url)

                if frame is None:
                    self._sync.update_camera_status(self._cam.id, False)
                    self._stop.wait(timeout=self._config.capture_interval)
                    continue

                self._sync.update_camera_status(self._cam.id, True)

                # Motion detection
                if self._last_frame is not None:
                    motion_pct = compute_motion(self._last_frame, frame)
                    if motion_pct > self._config.motion_threshold:
                        self._buffer.add(
                            camera_id=self._cam.id,
                            camera_name=self._cam.name,
                            camera_location=self._cam.location,
                            event_type="motion_detected",
                            severity="info",
                            description=f"Motion detected ({motion_pct:.1f}%)",
                            metadata={"motionPercent": round(motion_pct, 1)},
                        )

                self._last_frame = frame

                # AI detection
                result = self._detector.detect(frame)

                if result.people_count > 0:
                    self._buffer.add(
                        camera_id=self._cam.id,
                        camera_name=self._cam.name,
                        camera_location=self._cam.location,
                        event_type="people_count",
                        severity="info",
                        description=f"People detected: {result.people_count}",
                        metadata={
                            "peopleCount": result.people_count,
                            "detections": [
                                {
                                    "class": d.class_name,
                                    "confidence": round(d.confidence, 2),
                                }
                                for d in result.detections
                                if d.class_id == 0
                            ],
                        },
                    )

            except Exception as e:
                logger.error("Camera %s error: %s", self._cam.id, e)

            self._stop.wait(timeout=self._config.capture_interval)

        logger.info("Camera worker stopped: %s", self._cam.name)


def main() -> None:
    config = load_config()

    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    logger.info("CamAI Edge Agent v%s starting", config.version)
    logger.info("Agent name: %s", config.agent_name)
    logger.info("Cloud API: %s", config.api_url)
    logger.info("Cameras: %d configured", len(config.cameras))
    logger.info(
        "Sync interval: %ds, Capture interval: %ds",
        config.sync_interval,
        config.capture_interval,
    )

    if not config.cameras:
        logger.warning("No cameras configured. Set CAMERA_URLS environment variable.")

    # Initialize components
    event_buffer = EventBuffer(cooldown_seconds=config.detection_cooldown)
    detector = Detector(
        model_path=config.yolo_model, confidence=config.yolo_confidence
    )
    sync_client = SyncClient(config, event_buffer)

    # Start sync thread
    sync_client.start()

    # Start camera workers
    workers: List[CameraWorker] = []
    for cam in config.cameras:
        worker = CameraWorker(cam, config, detector, event_buffer, sync_client)
        worker.start()
        workers.append(worker)

    # Graceful shutdown
    shutdown_event = threading.Event()

    def handle_signal(signum, _frame):
        logger.info("Received signal %d, shutting down...", signum)
        shutdown_event.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    logger.info("Agent running. Press Ctrl+C to stop.")
    shutdown_event.wait()

    logger.info("Stopping camera workers...")
    for worker in workers:
        worker.stop()

    logger.info("Stopping sync client (final sync)...")
    sync_client.stop()

    logger.info("Agent stopped cleanly.")


if __name__ == "__main__":
    main()
