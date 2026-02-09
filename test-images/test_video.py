#!/usr/bin/env python3
"""
Video functional test for CamAI detection-service.
Extracts frames from a video and sends them to detection endpoints.
Tests: YOLO detect, fire/smoke, plates, behavior analysis.
"""

import sys
import os
import time
import json
import subprocess
import tempfile
import glob
import requests

DETECTION_URL = "http://localhost:8001"

def extract_frames(video_path: str, fps: int = 2, max_frames: int = 20) -> list:
    """Extract frames from video using ffmpeg."""
    tmpdir = tempfile.mkdtemp(prefix="camai_test_")
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps}",
        "-frames:v", str(max_frames),
        "-q:v", "2",
        os.path.join(tmpdir, "frame_%04d.jpg"),
        "-y", "-loglevel", "error"
    ]
    subprocess.run(cmd, check=True)
    frames = sorted(glob.glob(os.path.join(tmpdir, "frame_*.jpg")))
    print(f"  Extracted {len(frames)} frames from {os.path.basename(video_path)}")
    return frames


def test_yolo(frames: list) -> dict:
    """Test /detect endpoint with video frames."""
    print("\n=== YOLO Object Detection ===")
    total_detections = 0
    detection_types = {}
    times = []

    for i, frame in enumerate(frames):
        with open(frame, "rb") as f:
            resp = requests.post(f"{DETECTION_URL}/detect", files={"image": f})
        data = resp.json()
        dets = data.get("detections", [])
        ms = data.get("inferenceMs", 0)
        times.append(ms)
        total_detections += len(dets)

        for d in dets:
            t = d["label"]
            detection_types[t] = detection_types.get(t, 0) + 1

        if dets:
            labels = ", ".join(f'{d["label"]} ({d["confidence"]:.0%})' for d in dets[:5])
            print(f"  Frame {i+1}: {len(dets)} objects [{labels}] ({ms}ms)")
        else:
            print(f"  Frame {i+1}: no detections ({ms}ms)")

    avg_ms = sum(times) / len(times) if times else 0
    print(f"\n  ИТОГО: {total_detections} детекций за {len(frames)} кадров")
    print(f"  Среднее время: {avg_ms:.0f}ms")
    print(f"  Типы: {detection_types}")

    return {"total": total_detections, "types": detection_types, "avgMs": avg_ms}


def test_fire(frames: list) -> dict:
    """Test /detect-fire endpoint with video frames."""
    print("\n=== Fire/Smoke Detection ===")
    fire_count = 0
    smoke_count = 0
    times = []

    for i, frame in enumerate(frames):
        with open(frame, "rb") as f:
            resp = requests.post(f"{DETECTION_URL}/detect-fire", files={"image": f})
        data = resp.json()
        ms = data.get("inferenceMs", 0)
        times.append(ms)

        fire = data.get("fireDetected", False)
        smoke = data.get("smokeDetected", False)
        fc = data.get("fireConfidence", 0)
        sc = data.get("smokeConfidence", 0)

        if fire:
            fire_count += 1
        if smoke:
            smoke_count += 1

        status = []
        if fire:
            status.append(f"FIRE({fc:.0%})")
        if smoke:
            status.append(f"SMOKE({sc:.0%})")

        indicator = " | ".join(status) if status else "clear"
        print(f"  Frame {i+1}: {indicator} ({ms}ms)")

    avg_ms = sum(times) / len(times) if times else 0
    print(f"\n  ИТОГО: Огонь в {fire_count}/{len(frames)} кадрах, Дым в {smoke_count}/{len(frames)} кадрах")
    print(f"  Среднее время: {avg_ms:.0f}ms")

    return {"fireFrames": fire_count, "smokeFrames": smoke_count, "avgMs": avg_ms}


def test_plates(frames: list) -> dict:
    """Test /detect-plates endpoint with video frames."""
    print("\n=== License Plate Recognition ===")
    all_plates = set()
    times = []

    for i, frame in enumerate(frames):
        with open(frame, "rb") as f:
            resp = requests.post(f"{DETECTION_URL}/detect-plates", files={"image": f})
        data = resp.json()
        ms = data.get("inferenceMs", 0)
        times.append(ms)

        plates = data.get("plates", [])
        vehicles = data.get("vehicleCount", 0)

        if plates:
            for p in plates:
                all_plates.add(p["text"])
                print(f'  Frame {i+1}: PLATE "{p["text"]}" ({p["confidence"]:.0%}) | {vehicles} vehicles ({ms}ms)')
        else:
            print(f"  Frame {i+1}: no plates | {vehicles} vehicles ({ms}ms)")

    avg_ms = sum(times) / len(times) if times else 0
    print(f"\n  ИТОГО: Найдено {len(all_plates)} уникальных номеров: {all_plates}")
    print(f"  Среднее время: {avg_ms:.0f}ms")

    return {"uniquePlates": list(all_plates), "avgMs": avg_ms}


def test_behavior(frames: list, camera_id: str = "test-video") -> dict:
    """Test /analyze-behavior endpoint with sequential frames."""
    print("\n=== Behavior Analysis ===")
    all_behaviors = []
    max_people = 0
    density_levels = {}
    times = []

    for i, frame in enumerate(frames):
        with open(frame, "rb") as f:
            resp = requests.post(
                f"{DETECTION_URL}/analyze-behavior",
                files={"image": f},
                data={"camera_id": camera_id, "fov_area_m2": "30.0"}
            )
        data = resp.json()
        ms = data.get("inferenceMs", 0)
        times.append(ms)

        person_count = data.get("personCount", 0)
        behaviors = data.get("behaviors", [])
        speeds = data.get("speeds", [])
        density = data.get("crowdDensity", {})

        if person_count > max_people:
            max_people = person_count

        level = density.get("label", "?")
        density_levels[level] = density_levels.get(level, 0) + 1

        parts = [f"{person_count} people, density={level}"]
        if behaviors:
            all_behaviors.extend(behaviors)
            bnames = [f'{b["label"]}({b["confidence"]:.0%})' for b in behaviors]
            parts.append(f"behaviors: {', '.join(bnames)}")
        if speeds:
            svals = [f'{s["speedKmh"]}km/h' for s in speeds]
            parts.append(f"speeds: {', '.join(svals)}")

        print(f"  Frame {i+1}: {' | '.join(parts)} ({ms}ms)")

    avg_ms = sum(times) / len(times) if times else 0
    unique_behaviors = set(b["behavior"] for b in all_behaviors)
    print(f"\n  ИТОГО: Макс. людей: {max_people}")
    print(f"  Поведения: {unique_behaviors if unique_behaviors else 'нет'}")
    print(f"  Плотность: {density_levels}")
    print(f"  Среднее время: {avg_ms:.0f}ms")

    return {
        "maxPeople": max_people,
        "behaviors": list(unique_behaviors),
        "densityLevels": density_levels,
        "avgMs": avg_ms,
    }


def run_all_tests(video_path: str, test_type: str = "all"):
    """Run all detection tests on a video."""
    print(f"\n{'='*60}")
    print(f"FUNCTIONAL TEST: {os.path.basename(video_path)}")
    print(f"Type: {test_type}")
    print(f"{'='*60}")

    frames = extract_frames(video_path, fps=2, max_frames=15)
    if not frames:
        print("ERROR: No frames extracted!")
        return

    results = {}

    if test_type in ("all", "yolo"):
        results["yolo"] = test_yolo(frames)

    if test_type in ("all", "fire"):
        results["fire"] = test_fire(frames)

    if test_type in ("all", "plates"):
        results["plates"] = test_plates(frames)

    if test_type in ("all", "behavior"):
        results["behavior"] = test_behavior(frames)

    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    print(json.dumps(results, indent=2, ensure_ascii=False))

    # Cleanup frames
    for f in frames:
        os.remove(f)

    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_video.py <video_path> [test_type]")
        print("  test_type: all|yolo|fire|plates|behavior")
        sys.exit(1)

    video = sys.argv[1]
    ttype = sys.argv[2] if len(sys.argv) > 2 else "all"
    run_all_tests(video, ttype)
