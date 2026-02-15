"""
Hardware Auto-Zoom for face recognition cameras.

Controls physical camera zoom (optical) via HTTP PTZ API.
Uses face detection feedback loop to automatically zoom in on distant faces
and zoom out when faces are lost or move to frame edges.

Camera HTTP API (Digital Security Systems / Chinese IP cameras):
  PUT /PTZ/1/ZoomIn  body: Param1=1&Param2=speed (start), Param1=0&Param2=0 (stop)
  PUT /PTZ/1/ZoomOut body: same
  Auth: HTTP Basic Auth (admin with empty password by default)

State machine:
  IDLE → ZOOMING_IN → TRACKING ⇄ ZOOMING_IN / ZOOMING_OUT
                         ↓
                     RETURNING → IDLE
"""

from __future__ import annotations

import time
import logging
import threading
from enum import Enum

import requests

log = logging.getLogger("auto_zoom")

# ---------------------------------------------------------------------------
# Constants (face sizes in DOWNSCALED frame, ~500px width)
# ---------------------------------------------------------------------------

# Calibrated for 5MP camera (2880x1620) downscaled to 700px.
# Camera has limited optical zoom (~1.6x), so targets must be realistic.
FACE_SMALL_PX = 80       # face < 80px → far, need zoom in
FACE_TARGET_PX = 80      # stop zooming when face reaches 80px (achievable by zoom)
FACE_LARGE_PX = 180      # face > 180px → too close, zoom out

# Timing
PERSIST_SECONDS = 1.0     # face must be visible 1s before zoom starts
NO_FACE_TIMEOUT = 5.0     # return to wide angle after 5s without any face/person
MAX_ZOOM_IN_TIME = 12.0   # safety: max continuous zoom-in time (seconds)
MAX_RETURN_TIME = 15.0    # safety: max time for full zoom-out return
SPEED_UPDATE_INTERVAL = 1.5  # seconds between speed adjustments while zooming
FOCUS_SETTLE_TIME = 2.0      # seconds to wait for autofocus after zoom stops

# Edge safety: don't zoom if faces are near frame edges
EDGE_MARGIN = 0.08  # 8% from each edge is "danger zone"


class HwZoomState(Enum):
    IDLE = "idle"
    ZOOMING_IN = "zooming_in"
    TRACKING = "tracking"
    ZOOMING_OUT = "zooming_out"
    RETURNING = "returning"


class HardwareZoomManager:
    """
    Controls physical camera zoom based on face detection feedback.

    Usage:
        zoom = HardwareZoomManager("http://192.168.1.55")
        zoom.start()  # resets camera to wide angle

        # In detection loop (~1fps):
        zoom.update(face_locations, frame_h, frame_w)

        # On shutdown:
        zoom.reset()
    """

    def __init__(
        self,
        camera_http_url: str,
        ptz_user: str = "admin",
        ptz_pass: str = "",
        ptz_channel: int = 1,
    ):
        self._base_url = camera_http_url.rstrip("/")
        self._channel = ptz_channel
        self._session = requests.Session()
        self._session.auth = (ptz_user, ptz_pass)

        self._state = HwZoomState.IDLE
        self._lock = threading.Lock()

        # Face tracking
        self._last_face_time = 0.0
        self._persist_start = 0.0     # when far face was first seen continuously
        self._last_face_sizes: list[int] = []

        # Zoom motor state
        self._is_moving = False
        self._move_direction = ""     # "in" or "out"
        self._zoom_start_time = 0.0
        self._last_cmd_time = 0.0
        self._current_speed = 0

        # Focus settle after zoom stops
        self._zoom_stopped_time = 0.0  # when zoom motor was last stopped

        # Zoom plateau detection: if face doesn't grow, camera hit max zoom
        self._zoom_start_face_size = 0   # face size when zoom started
        self._zoom_plateau_count = 0     # consecutive zoom cycles without growth

        # Connectivity
        self._connected = False
        self._last_error = ""

    # ------------------------------------------------------------------
    # PTZ HTTP commands
    # ------------------------------------------------------------------

    def _ptz_cmd(self, action: str, start: bool, speed: int = 3) -> bool:
        """Send PTZ command. Returns True on success."""
        try:
            p1 = 1 if start else 0
            p2 = speed if start else 0
            resp = self._session.put(
                f"{self._base_url}/PTZ/{self._channel}/{action}",
                data=f"Param1={p1}&Param2={p2}",
                headers={"If-Modified-Since": "0"},
                timeout=3,
            )
            ok = resp.status_code == 200
            if ok and not self._connected:
                self._connected = True
                log.info("PTZ connected to %s", self._base_url)
            if not ok:
                self._last_error = f"HTTP {resp.status_code}"
                log.warning("PTZ %s failed: HTTP %s", action, resp.status_code)
            return ok
        except Exception as e:
            self._connected = False
            self._last_error = str(e)
            log.warning("PTZ %s error: %s", action, e)
            return False

    def _start_zoom_in(self, speed: int):
        if self._ptz_cmd("ZoomIn", True, speed):
            self._is_moving = True
            self._move_direction = "in"
            self._current_speed = speed
            self._last_cmd_time = time.time()

    def _start_zoom_out(self, speed: int):
        if self._ptz_cmd("ZoomOut", True, speed):
            self._is_moving = True
            self._move_direction = "out"
            self._current_speed = speed
            self._last_cmd_time = time.time()

    def _stop(self):
        """Stop any zoom movement."""
        if self._is_moving:
            if self._move_direction == "in":
                self._ptz_cmd("ZoomIn", False)
            else:
                self._ptz_cmd("ZoomOut", False)
            self._is_moving = False
            self._move_direction = ""
            self._current_speed = 0
            self._zoom_stopped_time = time.time()  # track for focus settle

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self):
        """Initialize: zoom out fully to start from wide angle."""
        log.info("HardwareZoom: initializing, zooming out to wide angle...")
        self._start_zoom_out(7)
        time.sleep(5)  # wait for motor to reach minimum zoom
        self._stop()
        self._state = HwZoomState.IDLE
        log.info("HardwareZoom: ready (wide angle)")

    def update(
        self,
        face_locations: list[tuple[int, int, int, int]],
        frame_h: int,
        frame_w: int,
        recognized_faces: dict[int, str] | None = None,
    ) -> dict:
        """
        Update zoom based on current face detections.
        Called from detection loop (~1fps).

        face_locations: list of (top, right, bottom, left) in downscaled coords
        frame_h, frame_w: downscaled frame dimensions

        Returns dict with current state info (for health endpoint).
        """
        now = time.time()

        face_sizes = [(bottom - top) for top, _, bottom, _ in face_locations]
        face_positions = []
        for top, right, bottom, left in face_locations:
            cx = (left + right) / 2.0 / frame_w
            cy = (top + bottom) / 2.0 / frame_h
            face_positions.append((cx, cy))

        if face_locations:
            self._last_face_time = now
            self._last_face_sizes = face_sizes

        with self._lock:
            if self._state == HwZoomState.IDLE:
                self._idle_logic(now, face_sizes, face_positions)
            elif self._state == HwZoomState.ZOOMING_IN:
                self._zooming_in_logic(now, face_sizes, face_positions)
            elif self._state == HwZoomState.TRACKING:
                self._tracking_logic(now, face_sizes, face_positions)
            elif self._state == HwZoomState.ZOOMING_OUT:
                self._zooming_out_logic(now, face_sizes)
            elif self._state == HwZoomState.RETURNING:
                self._returning_logic(now, face_sizes)

            return {
                "state": self._state.value,
                "is_moving": self._is_moving,
                "direction": self._move_direction,
                "speed": self._current_speed,
                "connected": self._connected,
            }

    def reset(self):
        """Stop zoom and return to wide angle. Call on shutdown."""
        log.info("HardwareZoom: resetting to wide angle")
        self._stop()
        # Zoom out for a few seconds to ensure wide angle
        self._start_zoom_out(7)
        time.sleep(3)
        self._stop()
        with self._lock:
            self._state = HwZoomState.IDLE

    # ------------------------------------------------------------------
    # State machine logic
    # ------------------------------------------------------------------

    def _idle_logic(self, now: float, face_sizes: list[int],
                    face_positions: list[tuple[float, float]]):
        """IDLE: watch for far faces that need zoom."""
        if not face_sizes:
            self._persist_start = 0.0
            return

        smallest = min(face_sizes)
        is_small = smallest < FACE_SMALL_PX

        # Zoom if face is small (no edge check — camera only has zoom, no pan)
        if is_small:
            if self._persist_start == 0.0:
                self._persist_start = now
            elif now - self._persist_start >= PERSIST_SECONDS:
                # Check plateau: if we've zoomed before and face didn't grow, don't retry
                if self._zoom_plateau_count >= 2:
                    log.debug("IDLE: skipping zoom — plateau detected (face=%dpx)", smallest)
                    return
                speed = self._calc_zoom_in_speed(smallest)
                self._start_zoom_in(speed)
                self._zoom_start_time = now
                self._zoom_start_face_size = smallest
                self._state = HwZoomState.ZOOMING_IN
                log.info("IDLE → ZOOMING_IN (face=%dpx, speed=%d)", smallest, speed)
        else:
            self._persist_start = 0.0

    def _zooming_in_logic(self, now: float, face_sizes: list[int],
                          face_positions: list[tuple[float, float]]):
        """ZOOMING_IN: actively zooming, monitor face size growth."""
        # Lost all faces
        if now - self._last_face_time > NO_FACE_TIMEOUT:
            self._stop()
            self._start_zoom_out(6)
            self._zoom_start_time = now
            self._state = HwZoomState.RETURNING
            log.info("ZOOMING_IN → RETURNING (faces lost)")
            return

        # Safety timeout
        if now - self._zoom_start_time > MAX_ZOOM_IN_TIME:
            self._stop()
            # Check plateau: did face actually grow during this zoom cycle?
            current_max = max(face_sizes) if face_sizes else 0
            if self._zoom_start_face_size > 0 and current_max <= self._zoom_start_face_size * 1.3:
                self._zoom_plateau_count += 1
                log.info("ZOOMING_IN → TRACKING (safety timeout, plateau=%d, start=%d→now=%d)",
                         self._zoom_plateau_count, self._zoom_start_face_size, current_max)
            else:
                self._zoom_plateau_count = 0
                log.info("ZOOMING_IN → TRACKING (safety timeout, face grew %d→%d)",
                         self._zoom_start_face_size, current_max)
            self._state = HwZoomState.TRACKING
            return

        if not face_sizes:
            return  # no detection this frame, keep zooming

        smallest = min(face_sizes)

        # Face too large → overshoot, zoom out (check before target-reached)
        if max(face_sizes) > FACE_LARGE_PX:
            self._stop()
            self._start_zoom_out(2)
            self._zoom_start_time = now
            self._state = HwZoomState.ZOOMING_OUT
            log.info("ZOOMING_IN → ZOOMING_OUT (overshoot, face=%dpx)", max(face_sizes))
            return

        # Face reached target → stop
        if smallest >= FACE_TARGET_PX:
            self._stop()
            self._state = HwZoomState.TRACKING
            log.info("ZOOMING_IN → TRACKING (target reached, face=%dpx)", smallest)
            return

        # Adjust speed dynamically
        if now - self._last_cmd_time > SPEED_UPDATE_INTERVAL:
            new_speed = self._calc_zoom_in_speed(smallest)
            if new_speed != self._current_speed:
                self._stop()
                self._start_zoom_in(new_speed)
                log.debug("Zoom speed adjusted: %d → %d (face=%dpx)",
                          self._current_speed, new_speed, smallest)

    def _tracking_logic(self, now: float, face_sizes: list[int],
                        face_positions: list[tuple[float, float]]):
        """TRACKING: at target zoom level, make fine adjustments."""
        # Lost all faces → return to wide
        if now - self._last_face_time > NO_FACE_TIMEOUT:
            self._start_zoom_out(5)
            self._zoom_start_time = now
            self._state = HwZoomState.RETURNING
            log.info("TRACKING → RETURNING (faces lost)")
            return

        if not face_sizes:
            return

        smallest = min(face_sizes)
        largest = max(face_sizes)

        # Face too small again → zoom in more (unless plateau reached)
        if smallest < FACE_SMALL_PX and self._zoom_plateau_count < 2:
            speed = self._calc_zoom_in_speed(smallest)
            self._start_zoom_in(speed)
            self._zoom_start_time = now
            self._zoom_start_face_size = smallest
            self._state = HwZoomState.ZOOMING_IN
            log.info("TRACKING → ZOOMING_IN (face shrunk to %dpx)", smallest)
            return

        # Face too large → zoom out a bit
        if largest > FACE_LARGE_PX:
            self._start_zoom_out(2)
            self._zoom_start_time = now
            self._state = HwZoomState.ZOOMING_OUT
            log.info("TRACKING → ZOOMING_OUT (face too large %dpx)", largest)
            return

    def _zooming_out_logic(self, now: float, face_sizes: list[int]):
        """ZOOMING_OUT: zooming out to fit faces. Transition to TRACKING when ok."""
        if not face_sizes:
            if now - self._last_face_time > NO_FACE_TIMEOUT:
                self._state = HwZoomState.RETURNING
                log.info("ZOOMING_OUT → RETURNING (faces lost)")
            return

        largest = max(face_sizes)
        smallest = min(face_sizes)

        # Face is good size now → stop
        if largest <= FACE_TARGET_PX + 20 and smallest >= FACE_SMALL_PX // 2:
            self._stop()
            self._state = HwZoomState.TRACKING
            log.info("ZOOMING_OUT → TRACKING (face=%dpx)", largest)
            return

        # Safety: don't zoom out forever
        if now - self._zoom_start_time > 8.0:
            self._stop()
            self._state = HwZoomState.TRACKING
            log.info("ZOOMING_OUT → TRACKING (timeout)")

    def _returning_logic(self, now: float, face_sizes: list[int]):
        """RETURNING: zooming out fully to wide angle."""
        # If new faces appeared during return, check if we should re-zoom
        if face_sizes:
            smallest = min(face_sizes)
            self._stop()
            if smallest < FACE_SMALL_PX:
                speed = self._calc_zoom_in_speed(smallest)
                self._start_zoom_in(speed)
                self._zoom_start_time = now
                self._state = HwZoomState.ZOOMING_IN
                log.info("RETURNING → ZOOMING_IN (new face %dpx)", smallest)
            else:
                self._state = HwZoomState.TRACKING
                log.info("RETURNING → TRACKING (face appeared %dpx)", smallest)
            return

        # Safety: max return time
        if now - self._zoom_start_time > MAX_RETURN_TIME:
            self._stop()
            self._state = HwZoomState.IDLE
            self._zoom_plateau_count = 0  # reset plateau on full return
            log.info("RETURNING → IDLE (timeout)")
            return

        # If no faces for a long time, assume we've returned to wide
        if now - self._last_face_time > NO_FACE_TIMEOUT + MAX_RETURN_TIME:
            self._stop()
            self._state = HwZoomState.IDLE
            self._zoom_plateau_count = 0  # reset plateau on full return
            log.info("RETURNING → IDLE (long timeout)")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _calc_zoom_in_speed(self, face_px: int) -> int:
        """Calculate zoom-in speed (1-7) based on how small the face is."""
        if face_px < 30:
            return 7     # very far → max speed
        elif face_px < 50:
            return 6
        elif face_px < 80:
            return 5
        elif face_px < 100:
            return 4
        elif face_px < FACE_SMALL_PX:
            return 3     # getting close to target → medium
        return 1         # fine adjustment

    def _faces_safe_for_zoom(self, face_positions: list[tuple[float, float]]) -> bool:
        """Check if all faces are safely within the frame (not near edges)."""
        if not face_positions:
            return False
        for cx, cy in face_positions:
            if (cx < EDGE_MARGIN or cx > 1.0 - EDGE_MARGIN or
                    cy < EDGE_MARGIN or cy > 1.0 - EDGE_MARGIN):
                return False
        return True

    @property
    def state(self) -> str:
        return self._state.value

    @property
    def is_zoomed(self) -> bool:
        return self._state in (HwZoomState.ZOOMING_IN, HwZoomState.TRACKING,
                               HwZoomState.ZOOMING_OUT)

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def is_focusing(self) -> bool:
        """True while camera autofocus is settling after zoom motor stopped."""
        if self._is_moving or self._zoom_stopped_time == 0.0:
            return False
        return (time.time() - self._zoom_stopped_time) < FOCUS_SETTLE_TIME


def test_ptz_connection(
    camera_http_url: str,
    user: str = "admin",
    password: str = "",
) -> bool:
    """
    Test if PTZ commands work with given credentials.
    Tries ZoomIn start/stop quickly.
    """
    try:
        session = requests.Session()
        session.auth = (user, password)
        resp = session.put(
            f"{camera_http_url.rstrip('/')}/PTZ/1/ZoomIn",
            data="Param1=1&Param2=1",
            headers={"If-Modified-Since": "0"},
            timeout=5,
        )
        if resp.status_code == 200:
            # Stop immediately
            session.put(
                f"{camera_http_url.rstrip('/')}/PTZ/1/ZoomIn",
                data="Param1=0&Param2=0",
                headers={"If-Modified-Since": "0"},
                timeout=3,
            )
            return True
        return False
    except Exception:
        return False
