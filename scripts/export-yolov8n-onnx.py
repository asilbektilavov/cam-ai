#!/usr/bin/env python3
"""Export YOLOv8n to ONNX format for browser-side inference via ONNX Runtime Web."""

import sys
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("Install ultralytics: pip install ultralytics")
    sys.exit(1)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)

model = YOLO("yolov8n.pt")
model.export(
    format="onnx",
    imgsz=640,
    simplify=True,
    opset=17,
    dynamic=False,
)

# ultralytics saves next to .pt — move to public/models/
src = Path("yolov8n.onnx")
dst = OUT_DIR / "yolov8n.onnx"
if src.exists():
    src.rename(dst)
    print(f"Saved: {dst}  ({dst.stat().st_size / 1024 / 1024:.1f} MB)")
else:
    print("ERROR: yolov8n.onnx not found after export")
    sys.exit(1)
