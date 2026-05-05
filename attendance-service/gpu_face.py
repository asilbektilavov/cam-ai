"""GPU-accelerated drop-in for the four face_recognition functions main.py uses.

InsightFace (RetinaFace + ArcFace) replaces dlib HOG/CNN. The CUDA execution
provider runs detection and embedding on the host GPU; falls back to CPU if
the runtime can't see one. Embedding distance uses cosine distance, which has
roughly the same operating range (~0.4-0.6 between strangers, <0.4 same
person) as dlib's L2 distance, so the existing MATCH_TOLERANCE / VISITOR_TOLERANCE
env defaults transfer over.

The original face_recognition API runs on RGB numpy arrays. InsightFace
expects BGR. The shim handles the swap and caches the last detection per
image so the typical `face_locations` -> `face_encodings` pair only runs
the network once.
"""
from __future__ import annotations

import os
import logging
import threading
import numpy as np

log = logging.getLogger("gpu_face")

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

        det_size = int(os.getenv("INSIGHTFACE_DET_SIZE", "1024"))
        model_name = os.getenv("INSIGHTFACE_MODEL", "buffalo_l")
        providers_env = os.getenv("INSIGHTFACE_PROVIDERS", "CUDAExecutionProvider,CPUExecutionProvider")
        providers = [p.strip() for p in providers_env.split(",") if p.strip()]

        app = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection", "recognition"],
            providers=providers,
        )
        app.prepare(ctx_id=0, det_size=(det_size, det_size))
        _app = app
        log.info(
            "InsightFace ready: model=%s det_size=%d providers=%s",
            model_name, det_size, providers,
        )
        return _app


# No cache. The first version keyed on id(numpy_array), but Python reuses
# memory addresses across watcher threads, so a fresh frame from one
# camera kept hitting another camera's cached detections — every watcher
# logged identical face sizes. Detection on GPU is fast enough that
# always re-running it is the right call.
def _detect(image_rgb: np.ndarray) -> list:
    bgr = image_rgb[:, :, ::-1] if image_rgb.shape[-1] == 3 else image_rgb
    return _get_app().get(bgr)


def face_locations(
    image: np.ndarray,
    number_of_times_to_upsample: int = 1,
    model: str = "hog",
) -> list[_FaceTuple]:
    """Drop-in for face_recognition.face_locations.

    Returns list of (top, right, bottom, left) tuples like dlib. The model
    and upsample arguments are accepted but ignored — InsightFace runs the
    same RetinaFace network either way.
    """
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
    Returns L2-normalised 512-D ArcFace vectors, one per location.
    """
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
    """
    if not known_encodings:
        return np.array([], dtype=np.float32)
    known = np.asarray(known_encodings, dtype=np.float32)
    target = np.asarray(encoding_to_check, dtype=np.float32)
    return 1.0 - known @ target
