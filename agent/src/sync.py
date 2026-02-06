import logging
import threading
from typing import Dict, List

import requests

from .config import AgentConfig
from .events import EventBuffer

logger = logging.getLogger(__name__)

MAX_BACKOFF = 300  # 5 minutes


class SyncClient:
    """Periodically syncs camera status and events to the CamAI cloud."""

    def __init__(self, config: AgentConfig, event_buffer: EventBuffer):
        self._config = config
        self._buffer = event_buffer
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "User-Agent": f"CamAI-Agent/{config.version}",
        })
        self._stop_event = threading.Event()
        self._thread: threading.Thread = None
        self._camera_status: Dict[str, str] = {}
        self._consecutive_failures = 0

    def update_camera_status(self, cam_id: str, online: bool) -> None:
        self._camera_status[cam_id] = "online" if online else "offline"

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._run, name="sync-thread", daemon=True
        )
        self._thread.start()
        logger.info("Sync thread started (interval=%ds)", self._config.sync_interval)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10)
        logger.info("Sync thread stopped")

    def _run(self) -> None:
        self._do_sync()

        while not self._stop_event.is_set():
            wait_time = self._config.sync_interval
            if self._consecutive_failures > 0:
                backoff = min(5 * (2 ** self._consecutive_failures), MAX_BACKOFF)
                wait_time = max(wait_time, backoff)
                logger.debug("Backoff: waiting %ds before next sync", wait_time)

            self._stop_event.wait(timeout=wait_time)
            if self._stop_event.is_set():
                break

            self._do_sync()

        # Final sync on shutdown
        self._do_sync()

    def _do_sync(self) -> None:
        events = self._buffer.drain()
        cameras = self._build_camera_list()

        payload = {
            "agentName": self._config.agent_name,
            "version": self._config.version,
            "cameras": cameras,
            "events": [e.to_sync_dict() for e in events],
        }

        url = f"{self._config.api_url}/api/agent/sync"

        try:
            resp = self._session.post(url, json=payload, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            if data.get("ok"):
                accepted = data.get("accepted", {})
                logger.info(
                    "Sync OK: agent=%s, cameras=%d, events=%d",
                    data.get("agentId", "?"),
                    accepted.get("cameras", 0),
                    accepted.get("events", 0),
                )
                self._consecutive_failures = 0
            else:
                logger.warning("Sync response not ok: %s", data)
                self._consecutive_failures += 1
                self._buffer.rebuffer(events)
        except requests.RequestException as e:
            logger.error("Sync failed: %s", e)
            self._consecutive_failures += 1
            self._buffer.rebuffer(events)

    def _build_camera_list(self) -> List[dict]:
        result = []
        for cam in self._config.cameras:
            result.append({
                "id": cam.id,
                "name": cam.name,
                "location": cam.location,
                "status": self._camera_status.get(cam.id, "offline"),
                "isMonitoring": True,
            })
        return result
