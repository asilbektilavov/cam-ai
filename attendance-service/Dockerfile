FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

WORKDIR /app

# Python 3.11 + OpenCV/InsightFace runtime deps. The CUDA + cuDNN libs are
# already in the base image at /usr/local/cuda — onnxruntime-gpu finds them
# via LD_LIBRARY_PATH that nvidia/cuda sets up automatically.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3.11-dev \
        build-essential \
        libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
        ca-certificates \
        && rm -rf /var/lib/apt/lists/*

# venv sidesteps the PEP 668 lockdown on the system Python without needing
# --break-system-packages (which is unavailable on the apt pip shipped here).
RUN python3.11 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download buffalo_l ONNX models so first request doesn't pay the
# download cost (and so the container works in air-gapped deployments).
RUN python -c "from insightface.app import FaceAnalysis; \
    app = FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition'], providers=['CPUExecutionProvider']); \
    app.prepare(ctx_id=-1, det_size=(640, 640))"

COPY main.py gpu_face.py ./

ENV POLL_INTERVAL=0.5
ENV MATCH_TOLERANCE=0.45
ENV COOLDOWN_SECONDS=300

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
