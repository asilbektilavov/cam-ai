"""Tests for hardware auto-zoom state machine.
Run: ./venv/bin/python test_auto_zoom.py
"""

import time
from unittest.mock import MagicMock, patch
from auto_zoom import HardwareZoomManager, HwZoomState, FACE_SMALL_PX, FACE_TARGET_PX, FACE_LARGE_PX


def make_mgr():
    """Create a HardwareZoomManager with mocked HTTP requests."""
    with patch('auto_zoom.requests') as mock_req:
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_session.put.return_value = mock_resp
        mock_req.Session.return_value = mock_session

        mgr = HardwareZoomManager("http://192.168.1.55", "admin", "")
        mgr._session = mock_session
        mgr._connected = True
        return mgr, mock_session


def test_idle_to_zooming_in():
    """Far face persisting should trigger IDLE -> ZOOMING_IN."""
    mgr, session = make_mgr()
    assert mgr._state == HwZoomState.IDLE

    # Frame 1: far face appears (40px, center of frame)
    face = (130, 290, 170, 250)  # top, right, bottom, left -> 40px height
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.IDLE  # not yet, need persistence

    # Fake persistence (face visible for 2+ seconds)
    mgr._persist_start = time.time() - 2.0

    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.ZOOMING_IN
    # Should have called ZoomIn start
    session.put.assert_called()
    last_call_args = str(session.put.call_args)
    assert "ZoomIn" in last_call_args


def test_zooming_in_to_tracking():
    """Face reaching target size should stop zoom."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.ZOOMING_IN
    mgr._is_moving = True
    mgr._move_direction = "in"
    mgr._zoom_start_time = time.time()
    mgr._last_face_time = time.time()

    # Face reached target size (FACE_TARGET_PX=80, face=90px > target)
    face = (105, 295, 195, 205)  # 90px height, center of frame
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.TRACKING


def test_tracking_to_returning():
    """Faces lost should trigger TRACKING -> RETURNING."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.TRACKING
    mgr._last_face_time = time.time() - 6.0  # faces lost 6s ago (> NO_FACE_TIMEOUT=5)

    mgr.update([], 300, 500)
    assert mgr._state == HwZoomState.RETURNING
    # Should have started ZoomOut
    session.put.assert_called()


def test_large_face_no_zoom():
    """Large face (close) should not trigger zoom in."""
    mgr, session = make_mgr()
    assert mgr._state == HwZoomState.IDLE

    # Large face (100px > FACE_SMALL_PX=80)
    face = (100, 300, 200, 200)  # 100px height, center of frame
    mgr._persist_start = time.time() - 2.0  # force persistence
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.IDLE


def test_returning_to_idle():
    """Return timeout should bring back to IDLE."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.RETURNING
    mgr._is_moving = True
    mgr._move_direction = "out"
    mgr._zoom_start_time = time.time() - 20.0  # exceeded MAX_RETURN_TIME
    mgr._last_face_time = time.time() - 20.0

    mgr.update([], 300, 500)
    assert mgr._state == HwZoomState.IDLE
    assert mgr._zoom_plateau_count == 0  # plateau reset on return


def test_tracking_face_too_large():
    """Face too large in TRACKING should trigger zoom out."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.TRACKING
    mgr._last_face_time = time.time()

    # Very large face (200px > FACE_LARGE_PX=180)
    face = (50, 350, 250, 150)  # 200px height, center of frame
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.ZOOMING_OUT


def test_zooming_in_overshoot():
    """Face becoming too large while zooming in should switch to ZOOMING_OUT."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.ZOOMING_IN
    mgr._is_moving = True
    mgr._move_direction = "in"
    mgr._zoom_start_time = time.time()
    mgr._last_face_time = time.time()

    # Face overshot target (200px > FACE_LARGE_PX=180)
    face = (50, 350, 250, 150)  # 200px height, center of frame
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.ZOOMING_OUT


def test_returning_interrupted_by_face():
    """New face during return should re-zoom."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.RETURNING
    mgr._is_moving = True
    mgr._move_direction = "out"
    mgr._zoom_start_time = time.time()
    mgr._last_face_time = time.time() - 1.0

    # Small face appears
    face = (130, 290, 170, 250)  # 40px height, center
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.ZOOMING_IN


def test_plateau_stops_rezooming():
    """After 2 zoom cycles without growth, should stop trying to zoom."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.IDLE
    mgr._zoom_plateau_count = 2  # already hit plateau

    # Small face with persistence
    face = (130, 290, 170, 250)  # 40px height
    mgr._persist_start = time.time() - 2.0
    mgr.update([face], 300, 500)
    assert mgr._state == HwZoomState.IDLE  # should NOT zoom due to plateau


def test_plateau_resets_on_return():
    """Plateau count should reset when camera returns to IDLE."""
    mgr, session = make_mgr()
    mgr._state = HwZoomState.RETURNING
    mgr._is_moving = True
    mgr._move_direction = "out"
    mgr._zoom_start_time = time.time() - 20.0
    mgr._last_face_time = time.time() - 20.0
    mgr._zoom_plateau_count = 2

    mgr.update([], 300, 500)
    assert mgr._state == HwZoomState.IDLE
    assert mgr._zoom_plateau_count == 0


if __name__ == "__main__":
    tests = [
        test_idle_to_zooming_in,
        test_zooming_in_to_tracking,
        test_tracking_to_returning,
        test_large_face_no_zoom,
        test_returning_to_idle,
        test_tracking_face_too_large,
        test_zooming_in_overshoot,
        test_returning_interrupted_by_face,
        test_plateau_stops_rezooming,
        test_plateau_resets_on_return,
    ]

    for t in tests:
        t()
        print(f"PASS: {t.__name__}")

    print(f"\nAll {len(tests)} tests passed!")
