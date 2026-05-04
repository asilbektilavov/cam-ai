FROM python:3.11-slim AS builder

WORKDIR /app

# OpenCV/InsightFace runtime deps + build tools for any wheel that needs them.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake \
        libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
        && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# onnxruntime-gpu wheels ship their own CUDA + cuDNN, so the slim base is
# fine — we only need the host's NVIDIA driver injected by
# nvidia-container-runtime (handled by docker compose `gpus: all`).
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the buffalo_l ONNX models so first request is instant
# and the container works in air-gapped deployments.
RUN python -c "from insightface.app import FaceAnalysis; \
    app = FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition'], providers=['CPUExecutionProvider']); \
    app.prepare(ctx_id=-1, det_size=(640, 640))"


FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
        ca-certificates \
        && rm -rf /var/lib/apt/lists/*

# Bring over installed wheels and the pre-downloaded buffalo_l model.
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /root/.insightface /root/.insightface

COPY main.py gpu_face.py ./

ENV POLL_INTERVAL=0.5
ENV MATCH_TOLERANCE=0.45
ENV COOLDOWN_SECONDS=300

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
