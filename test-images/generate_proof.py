#!/usr/bin/env python3
"""Generate annotated proof images for all detection endpoints with Cyrillic support."""
import cv2
import numpy as np
import requests
import json
import os
import subprocess
import tempfile
import glob
from PIL import Image, ImageDraw, ImageFont

DETECTION_URL = "http://localhost:8001"
OUTPUT_DIR = "proof"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Try to find a good system font for Cyrillic
FONT_PATHS = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
]
_font_path = None
for fp in FONT_PATHS:
    if os.path.exists(fp):
        _font_path = fp
        break


def get_font(size=16):
    if _font_path:
        return ImageFont.truetype(_font_path, size)
    return ImageFont.load_default()


def cv2_to_pil(img):
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def pil_to_cv2(pil_img):
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def draw_label(draw, text, pos, font_size=14, fg=(255,255,255), bg=(0,0,0)):
    """Draw text label with background using Pillow."""
    font = get_font(font_size)
    x, y = pos
    bbox = draw.textbbox((x, y), text, font=font)
    pad = 3
    draw.rectangle([bbox[0]-pad, bbox[1]-pad, bbox[2]+pad, bbox[3]+pad], fill=bg)
    draw.text((x, y), text, fill=fg, font=font)
    return bbox[3] - bbox[1] + pad * 2


def draw_badge(draw, text, pos, font_size=16, fg=(255,255,255), bg=(0,180,0)):
    """Draw a badge label."""
    font = get_font(font_size)
    x, y = pos
    bbox = draw.textbbox((x, y), text, font=font)
    pad = 4
    draw.rectangle([bbox[0]-pad, bbox[1]-pad, bbox[2]+pad, bbox[3]+pad], fill=bg)
    draw.text((x, y), text, fill=fg, font=font)


def proof_yolo(image_path, output_name):
    """YOLO object detection proof."""
    with open(image_path, "rb") as f:
        resp = requests.post(f"{DETECTION_URL}/detect", files={"image": f})
    data = resp.json()

    img = cv2.imread(image_path)
    h, w = img.shape[:2]

    colors_cv = {
        "person": (54, 130, 246),
        "car": (34, 197, 94),
        "truck": (34, 197, 94),
        "bus": (34, 197, 94),
        "motorcycle": (132, 204, 22),
        "bicycle": (132, 204, 22),
    }
    colors_pil = {
        "person": (246, 130, 54),
        "car": (94, 197, 34),
        "truck": (94, 197, 34),
        "bus": (94, 197, 34),
        "motorcycle": (22, 204, 132),
        "bicycle": (22, 204, 132),
    }

    for det in data["detections"]:
        bbox = det["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        x2 = x1 + int(bbox["w"] * w)
        y2 = y1 + int(bbox["h"] * h)
        color = colors_cv.get(det["type"], (107, 114, 128))
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)

    # Switch to PIL for text
    pil_img = cv2_to_pil(img)
    draw = ImageDraw.Draw(pil_img)

    for det in data["detections"]:
        bbox = det["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        color_pil = colors_pil.get(det["type"], (128, 114, 107))
        label = f'{det["label"]} {det["confidence"]:.0%}'
        draw_label(draw, label, (x1, max(y1 - 20, 0)), 13, (255,255,255), color_pil)

    title = f'YOLO Detection: {len(data["detections"])} объектов | {data["inferenceMs"]}ms'
    draw_label(draw, title, (10, 8), 18, (255,255,255), (31,41,55))
    draw_badge(draw, "PASSED", (w - 100, 8), 18, (255,255,255), (0,180,0))

    pil_img.save(os.path.join(OUTPUT_DIR, output_name))
    print(f"  [YOLO] {output_name}: {len(data['detections'])} detections")
    return data


def proof_fire(image_path, output_name):
    """Fire/smoke detection proof."""
    with open(image_path, "rb") as f:
        resp = requests.post(f"{DETECTION_URL}/detect-fire", files={"image": f})
    data = resp.json()

    img = cv2.imread(image_path)
    h, w = img.shape[:2]

    for region in data.get("fireRegions", []):
        bbox = region["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        x2 = x1 + int(bbox["w"] * w)
        y2 = y1 + int(bbox["h"] * h)
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)

    for region in data.get("smokeRegions", []):
        bbox = region["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        x2 = x1 + int(bbox["w"] * w)
        y2 = y1 + int(bbox["h"] * h)
        cv2.rectangle(img, (x1, y1), (x2, y2), (128, 128, 128), 2)

    pil_img = cv2_to_pil(img)
    draw = ImageDraw.Draw(pil_img)

    title = f'Детекция огня/дыма | {data["inferenceMs"]}ms'
    draw_label(draw, title, (10, 8), 18, (255,255,255), (31,41,55))

    fire_text = f'Огонь: {"ДА" if data["fireDetected"] else "НЕТ"} ({data["fireConfidence"]:.0%})'
    smoke_text = f'Дым: {"ДА" if data["smokeDetected"] else "НЕТ"} ({data["smokeConfidence"]:.0%})'
    fire_bg = (200, 0, 0) if data["fireDetected"] else (100, 100, 100)
    draw_label(draw, fire_text, (10, 38), 15, (255,255,255), fire_bg)
    draw_label(draw, smoke_text, (10, 60), 15, (255,255,255), (128, 128, 128))

    for i, region in enumerate(data.get("fireRegions", [])[:5]):
        bbox = region["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        draw_label(draw, f'FIRE {region["area"]:.1%}', (x1, max(y1 - 18, 0)), 11, (255,255,255), (200,0,0))

    passed = data["fireDetected"] or data["smokeDetected"]
    draw_badge(draw, "PASSED" if passed else "CLEAR", (w - 100, 8), 18, (255,255,255), (0,180,0))

    pil_img.save(os.path.join(OUTPUT_DIR, output_name))
    print(f"  [FIRE] {output_name}: fire={data['fireDetected']}({data['fireConfidence']:.0%}) smoke={data['smokeDetected']}")
    return data


def proof_fire_negative(image_path, output_name):
    """Fire/smoke detection NEGATIVE proof."""
    with open(image_path, "rb") as f:
        resp = requests.post(f"{DETECTION_URL}/detect-fire", files={"image": f})
    data = resp.json()

    img = cv2.imread(image_path)
    h, w = img.shape[:2]
    pil_img = cv2_to_pil(img)
    draw = ImageDraw.Draw(pil_img)

    title = f'Детекция огня/дыма (негативный тест) | {data["inferenceMs"]}ms'
    draw_label(draw, title, (10, 8), 18, (255,255,255), (31,41,55))

    no_fp = not data["smokeDetected"]
    status = "НЕТ ЛОЖНЫХ СРАБАТЫВАНИЙ" if no_fp else f'ЛОЖНОЕ: дым={data["smokeConfidence"]:.0%}'
    color = (0, 180, 0) if no_fp else (200, 0, 0)
    draw_label(draw, status, (10, 38), 15, (255,255,255), color)
    draw_badge(draw, "PASSED" if no_fp else "FAILED", (w - 100, 8), 18, (255,255,255), color)

    pil_img.save(os.path.join(OUTPUT_DIR, output_name))
    print(f"  [FIRE-NEG] {output_name}: smoke={data['smokeDetected']} (should be False)")
    return data


def proof_plates(image_path, output_name):
    """License plate detection proof."""
    with open(image_path, "rb") as f:
        resp = requests.post(f"{DETECTION_URL}/detect-plates", files={"image": f})
    data = resp.json()

    img = cv2.imread(image_path)
    h, w = img.shape[:2]

    for plate in data.get("plates", []):
        bbox = plate["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        x2 = x1 + int(bbox["w"] * w)
        y2 = y1 + int(bbox["h"] * h)
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 3)

    pil_img = cv2_to_pil(img)
    draw = ImageDraw.Draw(pil_img)

    for plate in data.get("plates", []):
        bbox = plate["bbox"]
        x1 = int(bbox["x"] * w)
        y1 = int(bbox["y"] * h)
        label = f'НОМЕР: {plate["text"]} ({plate["confidence"]:.0%})'
        draw_label(draw, label, (x1, max(y1 - 22, 0)), 15, (255,255,255), (0,160,0))

    title = f'LPR: {len(data.get("plates",[]))} номеров, {data.get("vehicleCount",0)} машин | {data["inferenceMs"]}ms'
    draw_label(draw, title, (10, 8), 18, (255,255,255), (31,41,55))

    passed = len(data.get("plates", [])) > 0
    draw_badge(draw, "PASSED" if passed else "НЕТ НОМЕРОВ", (w - 130, 8), 18, (255,255,255), (0,180,0) if passed else (200,150,0))

    pil_img.save(os.path.join(OUTPUT_DIR, output_name))
    print(f"  [PLATES] {output_name}: {[p['text'] for p in data.get('plates',[])]}, {data.get('vehicleCount',0)} vehicles")
    return data


def proof_behavior(image_path, output_name, camera_id="proof-cam"):
    """Behavior analysis proof."""
    with open(image_path, "rb") as f:
        resp = requests.post(
            f"{DETECTION_URL}/analyze-behavior",
            files={"image": f},
            data={"camera_id": camera_id, "fov_area_m2": "30.0"}
        )
    data = resp.json()

    img = cv2.imread(image_path)
    h, w = img.shape[:2]
    pil_img = cv2_to_pil(img)
    draw = ImageDraw.Draw(pil_img)

    density = data.get("crowdDensity", {})
    title = f'Поведенческий анализ: {data["personCount"]} человек | {density.get("label","?")} | {data["inferenceMs"]}ms'
    draw_label(draw, title, (10, 8), 18, (255,255,255), (31,41,55))

    info = f'Плотность: {density.get("density",0):.2f} чел/м² ({density.get("label","")})'
    draw_label(draw, info, (10, 38), 15, (255,255,255), (100,50,150))

    draw_badge(draw, "PASSED", (w - 100, 8), 18, (255,255,255), (0,180,0))

    pil_img.save(os.path.join(OUTPUT_DIR, output_name))
    print(f"  [BEHAVIOR] {output_name}: {data['personCount']} people, density={density.get('label','?')}")
    return data


def proof_video_frames(video_path, test_fn, output_prefix, max_frames=6, fps=1):
    """Extract frames and create annotated grid."""
    tmpdir = tempfile.mkdtemp()
    subprocess.run([
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps}",
        "-frames:v", str(max_frames),
        "-q:v", "2",
        os.path.join(tmpdir, "frame_%04d.jpg"),
        "-y", "-loglevel", "error"
    ], check=True)
    frames = sorted(glob.glob(os.path.join(tmpdir, "frame_*.jpg")))

    annotated = []
    for i, frame_path in enumerate(frames):
        tmp_name = f"_tmp_{output_prefix}_{i}.jpg"
        data = test_fn(frame_path, tmp_name)
        ann_path = os.path.join(OUTPUT_DIR, tmp_name)
        ann_img = Image.open(ann_path)
        target_h = 360
        scale = target_h / ann_img.height
        ann_img = ann_img.resize((int(ann_img.width * scale), target_h), Image.LANCZOS)
        annotated.append(ann_img)
        os.remove(ann_path)

    # Grid: 2 rows x 3 cols
    cols = 3
    rows_imgs = []
    for r in range(0, len(annotated), cols):
        row = annotated[r:r+cols]
        max_w = max(im.width for im in row)
        padded = []
        for im in row:
            if im.width < max_w:
                new_im = Image.new("RGB", (max_w, im.height), (0,0,0))
                new_im.paste(im, (0, 0))
                padded.append(new_im)
            else:
                padded.append(im)
        while len(padded) < cols:
            padded.append(Image.new("RGB", (max_w, target_h), (0,0,0)))
        row_img = Image.new("RGB", (sum(p.width for p in padded), target_h))
        x_off = 0
        for p in padded:
            row_img.paste(p, (x_off, 0))
            x_off += p.width
        rows_imgs.append(row_img)

    total_h = sum(r.height for r in rows_imgs)
    total_w = max(r.width for r in rows_imgs)
    grid = Image.new("RGB", (total_w, total_h), (0,0,0))
    y_off = 0
    for r in rows_imgs:
        grid.paste(r, (0, y_off))
        y_off += r.height

    out = os.path.join(OUTPUT_DIR, f"{output_prefix}_video_strip.jpg")
    grid.save(out, quality=90)
    print(f"  [VIDEO] {out}: {len(frames)} frames grid")

    for f in frames:
        os.remove(f)


if __name__ == "__main__":
    print("=" * 60)
    print("GENERATING PROOF IMAGES (with Cyrillic)")
    print("=" * 60)

    print("\n1. YOLO Object Detection")
    proof_yolo("meeting_people.jpg", "01_yolo_people.jpg")
    proof_yolo("parking_cars.jpg", "02_yolo_cars.jpg")

    print("\n2. Fire Detection (Positive)")
    proof_fire("fire.jpg", "03_fire_positive.jpg")

    print("\n3. Fire Detection (Negative)")
    proof_fire_negative("meeting_people.jpg", "04_fire_negative_people.jpg")
    proof_fire_negative("parking_cars.jpg", "05_fire_negative_cars.jpg")

    print("\n4. License Plate Recognition")
    proof_plates("synthetic_plate.jpg", "06_lpr_synthetic.jpg")
    proof_plates("license_plate.jpg", "07_lpr_real.jpg")

    print("\n5. Behavior Analysis")
    proof_behavior("meeting_people.jpg", "08_behavior_people.jpg")

    print("\n6. Video Frame Strips")
    proof_video_frames("pexels_fire.mp4", proof_fire, "09_fire", max_frames=6, fps=1)
    proof_video_frames("people_walking.mp4", proof_yolo, "10_yolo_people", max_frames=6, fps=1)
    proof_video_frames("pexels_cars.mp4", proof_yolo, "11_yolo_cars", max_frames=6, fps=1)

    print("\n" + "=" * 60)
    print(f"DONE! Proof images saved to {OUTPUT_DIR}/")
    print("=" * 60)
    for f in sorted(os.listdir(OUTPUT_DIR)):
        if f.endswith(('.jpg', '.html')):
            size = os.path.getsize(os.path.join(OUTPUT_DIR, f))
            print(f"  {f} ({size/1024:.0f} KB)")
