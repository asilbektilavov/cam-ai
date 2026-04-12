ARG BASE_IMAGE=python:3.11-slim

FROM ${BASE_IMAGE} AS builder

WORKDIR /app

# Install system deps for dlib/face_recognition + OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install PyTorch with CUDA support (works on CPU too, auto-detects GPU at runtime)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir -r requirements.txt

FROM ${BASE_IMAGE}

WORKDIR /app

# Runtime deps for OpenCV + dlib
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY main.py .
COPY line_detector.py .
COPY body_tracker.py .
COPY face_recognizer.py .
COPY frame_grabber.py .
COPY yolov8n.pt .

ENV POLL_INTERVAL=0.3
ENV MATCH_TOLERANCE=0.55
ENV COOLDOWN_SECONDS=120

EXPOSE 8004

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
