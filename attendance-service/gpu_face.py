"""Drop-in for the four face_recognition functions main.py uses.

Two backends are available:
- "insightface" (default) — RetinaFace + ArcFace via onnxruntime-gpu, runs
  on the host GPU. Catches small/profile faces, ~80 ms per call, heavy GPU.
- "dlib" — classic face_recognition (HOG + ResNet 128-D), CPU only. Misses
  side profiles and faces under ~80 px on the substream-sized frame, but
  trivial on GPU (zero usage) and matches the line-crossing service's
  behaviour from before the InsightFace migration.

Switch with FACE_BACKEND=dlib|insightface env. No code changes elsewhere —
main.py keeps doing `import gpu_face as face_recognition`.
"""
from __future__ import annotations

import os
import logging
import threading
import numpy as np

log = logging.getLogger("gpu_face")

_BACKEND = os.getenv("FACE_BACKEND", "insightface").strip().lower()
log.info("Face backend selected: %s", _BACKEND)

_app = None
_app_lock = threading.Lock()

_FaceTuple = tuple[int, int, int, int]  # top, right, bottom, left


def _get_app():
    global _app
    if _app is not None:
        return _app
    with _app_lock:
        if _app is not None:
            return _app
        from insightface.app import FaceAnalysis

        det_size = int(os.getenv("INSIGHTFACE_DET_SIZE", "640"))
        model_name = os.getenv("INSIGHTFACE_MODEL", "buffalo_s")
        providers_env = os.getenv("INSIGHTFACE_PROVIDERS", "CUDAExecutionProvider,CPUExecutionProvider")
        provider_names = [p.strip() for p in providers_env.split(",") if p.strip()]

        # Cap CUDA memory at ~2 GiB and switch the arena to "same-as-requested"
        # so onnxruntime stops doubling its arena every time a bigger frame
        # comes through. On a 4 GiB GTX 1650 the default kNextPowerOfTwo
        # strategy was creeping to 3.7 GiB and leaving no headroom — peak
        # frames with many faces were tripping CUDA OOM.
        gpu_mem_limit = int(os.getenv("INSIGHTFACE_GPU_MEM_LIMIT_MB", "2048")) * 1024 * 1024
        cuda_options = {
            "device_id": 0,
            "arena_extend_strategy": "kSameAsRequested",
            "gpu_mem_limit": gpu_mem_limit,
            "cudnn_conv_algo_search": "DEFAULT",
            "cudnn_conv_use_max_workspace": "0",
            "do_copy_in_default_stream": "1",
        }
        providers: list = []
        for name in provider_names:
            if name == "CUDAExecutionProvider":
                providers.append((name, cuda_options))
            else:
                providers.append(name)

        app = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection", "recognition"],
            providers=providers,
        )
        app.prepare(ctx_id=0, det_size=(det_size, det_size))
        _app = app
        log.info(
            "InsightFace ready: model=%s det_size=%d providers=%s gpu_mem_cap=%dMiB",
            model_name, det_size, [p if isinstance(p, str) else p[0] for p in providers],
            gpu_mem_limit // 1024 // 1024,
        )
        return _app


# Global inference lock: onnxruntime-gpu under heavy multi-threading
# occasionally blocked indefinitely on CUDA context contention, hanging
# watchers until the whole service was restarted. Serialising inference
# costs us multi-thread throughput but the GTX 1650 only has one CUDA
# context anyway — 14 watchers were waiting on each other under the hood
# already, only without a deadline. With a single lock, ~80 ms per call
# × 14 cameras = ~1.1 s per round, well under the 0.5 s POLL_INTERVAL.
_inference_lock = threading.Lock()


def _detect(image_rgb: np.ndarray) -> list:
    bgr = image_rgb[:, :, ::-1] if image_rgb.shape[-1] == 3 else image_rgb
    with _inference_lock:
        return _get_app().get(bgr)


def face_locations(
    image: np.ndarray,
    number_of_times_to_upsample: int = 1,
    model: str = "hog",
) -> list[_FaceTuple]:
    """Drop-in for face_recognition.face_locations.

    Returns list of (top, right, bottom, left) tuples like dlib.
    """
    if _BACKEND == "dlib":
        import face_recognition as _fr  # type: ignore
        return _fr.face_locations(image, number_of_times_to_upsample, model)
    faces = _detect(image)
    return [
        (int(f.bbox[1]), int(f.bbox[2]), int(f.bbox[3]), int(f.bbox[0]))
        for f in faces
    ]


def face_encodings(
    image: np.ndarray,
    known_face_locations: list[_FaceTuple] | None = None,
    num_jitters: int = 1,
    model: str = "small",
) -> list[np.ndarray]:
    """Drop-in for face_recognition.face_encodings.

    Caller already detected — use the supplied bboxes verbatim instead of
    re-detecting. Re-detection on a different image (rgb vs enc_small) was
    losing faces that the previous tier's face_locations had found, leaving
    the visitor counter empty even when the camera was full of people.
    Returns L2-normalised 512-D ArcFace vectors (insightface) or
    128-D dlib encodings, one per location.
    """
    if _BACKEND == "dlib":
        import face_recognition as _fr  # type: ignore
        return _fr.face_encodings(image, known_face_locations, num_jitters, model)
    if not known_face_locations:
        # Detection-driven path — caller wants embeddings for whatever
        # InsightFace finds on this image (used by sync helpers).
        faces = _detect(image)
        return [f.normed_embedding for f in faces]

    bgr = image[:, :, ::-1] if image.shape[-1] == 3 else image
    h, w = bgr.shape[:2]
    rec_model = _get_app().models.get("recognition")
    if rec_model is None:
        return []

    out: list[np.ndarray] = []
    for top, right, bottom, left in known_face_locations:
        # Clamp to image bounds, expand a few pixels so the recognition
        # network sees a bit of context (it expects an aligned 112x112
        # crop with hair/chin showing).
        pad = max(0, int(0.15 * (right - left)))
        t = max(0, top - pad)
        b = min(h, bottom + pad)
        l = max(0, left - pad)
        r = min(w, right + pad)
        if b <= t or r <= l:
            out.append(np.zeros(512, dtype=np.float32))
            continue
        crop = bgr[t:b, l:r]
        # Aligned 112x112 — recognition model crops + normalises internally
        # via get_feat which accepts an arbitrary BGR face crop.
        try:
            with _inference_lock:
                emb = rec_model.get_feat(crop).flatten()
            n = np.linalg.norm(emb)
            if n > 0:
                emb = emb / n
            out.append(emb.astype(np.float32))
        except Exception:
            out.append(np.zeros(512, dtype=np.float32))
    return out


def face_distance(known_encodings: list[np.ndarray], encoding_to_check: np.ndarray) -> np.ndarray:
    """Cosine distance (1 - cosine_similarity).

    Both InsightFace's normed_embedding and dlib's encodings are L2-normalised
    so cosine distance is just (1 - dot). The numeric range matches dlib's
    L2 distance closely enough that the existing 0.45-0.55 thresholds in main.py
    keep their meaning (same person <0.4, different >0.5).

    Mixed-dim guard: the database may still hold 128-D dlib encodings from
    the pre-InsightFace days. Anything that doesn't match the live 512-D
    ArcFace shape is reported as max distance (1.0) so the matcher skips it
    instead of crashing the watcher thread on a matmul shape mismatch.
    """
    if _BACKEND == "dlib":
        import face_recognition as _fr  # type: ignore
        return _fr.face_distance(known_encodings, encoding_to_check)
    if not known_encodings:
        return np.array([], dtype=np.float32)
    target = np.asarray(encoding_to_check, dtype=np.float32)
    target_dim = target.shape[0]

    # Drop any encodings that aren't the same dim as the live one. Returning
    # max distance for them keeps the indexing aligned with the caller's
    # `known_encodings` list and `argmin` will simply skip them.
    distances = np.empty(len(known_encodings), dtype=np.float32)
    for i, enc in enumerate(known_encodings):
        arr = np.asarray(enc, dtype=np.float32)
        if arr.shape != target.shape:
            distances[i] = 1.0
            continue
        distances[i] = 1.0 - float(arr @ target)
    return distances
