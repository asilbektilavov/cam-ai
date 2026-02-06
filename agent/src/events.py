import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_BUFFER_SIZE = 10_000


@dataclass
class AgentEvent:
    id: str
    camera_name: str
    camera_location: str
    type: str
    severity: str
    description: str
    timestamp: str
    metadata: Optional[str] = None

    def to_sync_dict(self) -> dict:
        return {
            "id": self.id,
            "cameraName": self.camera_name,
            "cameraLocation": self.camera_location,
            "type": self.type,
            "severity": self.severity,
            "description": self.description,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }


class EventBuffer:
    """Thread-safe event buffer with cooldown deduplication."""

    def __init__(self, cooldown_seconds: int = 60):
        self._events: List[AgentEvent] = []
        self._lock = threading.Lock()
        self._cooldowns: Dict[str, float] = {}
        self._cooldown_seconds = cooldown_seconds

    def _cooldown_key(self, camera_id: str, event_type: str) -> str:
        return f"{camera_id}:{event_type}"

    def should_emit(self, camera_id: str, event_type: str) -> bool:
        key = self._cooldown_key(camera_id, event_type)
        now = time.monotonic()
        last = self._cooldowns.get(key, 0.0)
        return (now - last) >= self._cooldown_seconds

    def add(
        self,
        camera_id: str,
        camera_name: str,
        camera_location: str,
        event_type: str,
        severity: str,
        description: str,
        metadata: Optional[dict] = None,
    ) -> bool:
        """Add event if cooldown allows. Returns True if added."""
        if not self.should_emit(camera_id, event_type):
            return False

        key = self._cooldown_key(camera_id, event_type)

        event = AgentEvent(
            id=str(uuid.uuid4()),
            camera_name=camera_name,
            camera_location=camera_location,
            type=event_type,
            severity=severity,
            description=description,
            timestamp=datetime.now(timezone.utc).isoformat(),
            metadata=json.dumps(metadata) if metadata else None,
        )

        with self._lock:
            if len(self._events) >= MAX_BUFFER_SIZE:
                dropped = len(self._events) - MAX_BUFFER_SIZE + 1
                self._events = self._events[dropped:]
                logger.warning("Buffer overflow: dropped %d oldest events", dropped)
            self._events.append(event)
            self._cooldowns[key] = time.monotonic()

        logger.info("Event buffered: %s for %s", event_type, camera_name)
        return True

    def drain(self) -> List[AgentEvent]:
        """Atomically drain all buffered events."""
        with self._lock:
            events = self._events.copy()
            self._events.clear()
        return events

    def rebuffer(self, events: List[AgentEvent]) -> None:
        """Put events back into buffer (for retry on sync failure)."""
        with self._lock:
            self._events = events + self._events
            if len(self._events) > MAX_BUFFER_SIZE:
                self._events = self._events[:MAX_BUFFER_SIZE]

    def pending_count(self) -> int:
        with self._lock:
            return len(self._events)
