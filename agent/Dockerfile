# ---- Builder ----
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libglib2.0-0 libsm6 libxext6 libxrender-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Pre-download YOLOv8n model
RUN PYTHONPATH=/install/lib/python3.11/site-packages \
    python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" \
    && mkdir -p /models \
    && find / -name "yolov8n.pt" -exec cp {} /models/yolov8n.pt \; 2>/dev/null || true

# ---- Runner ----
FROM python:3.11-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender1 libgl1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages
COPY --from=builder /install /usr/local

# Copy pre-downloaded model
COPY --from=builder /models/yolov8n.pt /app/models/yolov8n.pt

# Copy source
COPY src/ /app/src/

# Non-root user
RUN useradd --create-home agent
USER agent

ENV PYTHONUNBUFFERED=1
ENV YOLO_MODEL=/app/models/yolov8n.pt
ENV OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp

ENTRYPOINT ["python", "-m", "src.main"]
