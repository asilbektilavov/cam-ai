import io
import os
import time

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
import numpy as np

app = FastAPI(title="CamAI YOLO Detection Service")

# Lazy-load model on first request
_model = None
CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.75"))

# YOLO COCO class mapping to our detection types
CLASS_TYPE_MAP: dict[int, tuple[str, str, str]] = {
    # classId -> (type, label_ru, color)
    0: ("person", "Человек", "#3B82F6"),
    1: ("bicycle", "Велосипед", "#84CC16"),
    2: ("car", "Автомобиль", "#22C55E"),
    3: ("motorcycle", "Мотоцикл", "#84CC16"),
    5: ("bus", "Автобус", "#22C55E"),
    7: ("truck", "Грузовик", "#22C55E"),
    15: ("cat", "Кошка", "#8B5CF6"),
    16: ("dog", "Собака", "#8B5CF6"),
}

# Broader categories
VEHICLE_CLASSES = {2, 3, 5, 7}
PERSON_CLASSES = {0}
ANIMAL_CLASSES = {15, 16}
BIKE_CLASSES = {1, 3}


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO("yolov8n.pt")
    return _model


def classify_detection(class_id: int, class_name: str):
    if class_id in CLASS_TYPE_MAP:
        det_type, label, color = CLASS_TYPE_MAP[class_id]
        return det_type, label, color

    # Fallback for other classes
    return "object", class_name.capitalize(), "#6B7280"


@app.post("/detect")
async def detect(image: UploadFile = File(...)):
    start = time.monotonic()

    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)

    import cv2
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return JSONResponse(
            status_code=400,
            content={"error": "Invalid image"},
        )

    h, w = img.shape[:2]
    model = get_model()
    results = model(img, conf=CONFIDENCE, verbose=False)

    detections = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            cls_name = model.names.get(cls_id, "unknown")

            det_type, label, color = classify_detection(cls_id, cls_name)

            detections.append({
                "type": det_type,
                "label": label,
                "confidence": round(conf, 2),
                "bbox": {
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "w": round((x2 - x1) / w, 4),
                    "h": round((y2 - y1) / h, 4),
                },
                "classId": cls_id,
                "color": color,
            })

    elapsed_ms = round((time.monotonic() - start) * 1000)

    return {
        "detections": detections,
        "inferenceMs": elapsed_ms,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "model": "yolov8n"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
