FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

WORKDIR /app

# Python 3.11 + OpenCV/InsightFace runtime deps. The CUDA libraries the
# nvidia-container-runtime injects from the host take care of the rest.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip \
        libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
        ca-certificates \
        && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/local/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/local/bin/python3

COPY requirements.txt .

# Install with --break-system-packages because Ubuntu 22.04 ships PEP 668
# and we control this image. CPython 3.11 is the only python here.
RUN pip install --no-cache-dir --break-system-packages --upgrade pip && \
    pip install --no-cache-dir --break-system-packages -r requirements.txt

# Pre-download the buffalo_l model so the first request doesn't pay the
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
