"""
HeartSense rPPG Inference Server
=================================
FastAPI server chạy inference neural model phía server — không lag browser.
Port: 4001

Endpoints:
  POST /infer   { features, mode, fps, crops_b64?, crops_shape? }
              → { signal, bpm, ok, latency_ms, model_used }
  GET  /health → { ok, signal_loaded, lite_loaded }
"""

import sys, os, base64, json, time, warnings
import numpy as np

warnings.filterwarnings('ignore')

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_signal_model()
    load_lite_model()
    yield

app = FastAPI(title="HeartSense Inference Server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST","GET"], allow_headers=["*"])

# ── Model state ────────────────────────────────────────────────────────────────
_model_signal      = None
_model_lite        = None
_signal_loaded     = False
_lite_loaded       = False
_load_error        = None

SEQ_LEN   = 128   # rppg_signal: 127 frames
LITE_SEQ  = 64    # rppg_lite:   63 frames
CROP_SIZE = 18
FPS       = 30.0

# ── rppg_signal (1D CNN) — finger + face fallback ─────────────────────────────
def _build_signal():
    import tensorflow as tf
    from tensorflow import keras
    T = SEQ_LEN - 1
    inp = keras.Input(shape=(T, 7), name='signals')
    x = keras.layers.Conv1D(32, 1, activation='elu', padding='same')(inp)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv1D(64, 7, activation='elu', padding='same')(x)
    x = keras.layers.Conv1D(64, 5, activation='elu', padding='same')(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv1D(32, 5, activation='elu', padding='same')(x)
    x = keras.layers.Conv1D(16, 3, activation='elu', padding='same')(x)
    x = keras.layers.BatchNormalization()(x)
    out = keras.layers.Dense(1, activation='linear')(x)
    out = keras.layers.Reshape((T,), name='rppg')(out)
    return keras.Model(inputs=inp, outputs=out, name='rppg_signal_net')

def load_signal_model():
    global _model_signal, _signal_loaded, _load_error
    try:
        import tensorflow as tf
        tf.get_logger().setLevel('ERROR')
        m = _build_signal()
        m.load_weights('./models/rppg_signal/_best.weights.h5')
        _model_signal = m
        _signal_loaded = True
        print(f"[Inference] ✅ rppg_signal loaded — {m.count_params():,} params (UBFC-trained)")
    except Exception as e:
        _load_error = str(e)
        print(f"[Inference] ❌ rppg_signal load failed: {e}")

# ── rppg_lite (Conv3D) — face mode ────────────────────────────────────────────
def _build_lite():
    import tensorflow as tf
    from tensorflow import keras
    T = LITE_SEQ - 1  # 63
    inp = keras.Input(shape=(T, CROP_SIZE, CROP_SIZE, 6), name='frames')
    x = keras.layers.Conv3D(16, (1,3,3), activation='elu', padding='same')(inp)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(32, (3,3,3), activation='elu', padding='same')(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(64, (3,3,3), activation='elu', padding='same')(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(32, (3,1,1), activation='elu', padding='same')(x)
    x = keras.layers.Lambda(lambda z: tf.reduce_mean(z, axis=[2,3]))(x)
    x = keras.layers.Conv1D(16, 3, activation='elu', padding='same')(x)
    out = keras.layers.Dense(1, activation='linear')(x)
    out = keras.layers.Reshape((T,), name='rppg')(out)
    return keras.Model(inputs=inp, outputs=out, name='rppg_lite_net')

def load_lite_model():
    global _model_lite, _lite_loaded
    weights_path = './models/rppg_lite/_best.weights.h5'
    if not os.path.exists(weights_path):
        print("[Inference] ⚠️  rppg_lite weights không tìm thấy — face dùng rppg_signal fallback")
        return
    try:
        import tensorflow as tf
        tf.get_logger().setLevel('ERROR')
        m = _build_lite()
        m.load_weights(weights_path)
        _model_lite = m
        _lite_loaded = True
        print(f"[Inference] ✅ rppg_lite loaded — {m.count_params():,} params (UBFC Conv3D face)")
    except Exception as e:
        print(f"[Inference] ⚠️  rppg_lite load failed ({e}) — face dùng rppg_signal fallback")

# ── Signal processing ──────────────────────────────────────────────────────────
def bandpass(sig, lo=0.67, hi=3.0, fs=FPS):
    from scipy.signal import butter, filtfilt
    nyq = fs / 2
    b, a = butter(4, [lo/nyq, hi/nyq], btype='band')
    return filtfilt(b, a, sig)

def bpm_from_signal(sig, fs=FPS):
    """Extract BPM from raw (unfiltered) signal — applies bandpass internally."""
    try:
        sig = bandpass(sig, fs=fs)
        N = len(sig)
        F = np.fft.rfft(sig * np.hanning(N), n=N*4)
        freqs = np.fft.rfftfreq(N*4, 1/fs)
        mask = (freqs >= 0.67) & (freqs <= 3.0)
        if not mask.any(): return None
        return float(freqs[mask][np.argmax(np.abs(F[mask])**2)] * 60.0)
    except Exception:
        return None

def bpm_from_filtered(sig, fs=FPS):
    """Extract BPM from already-bandpassed signal — no re-filtering to avoid double-bandpass distortion."""
    try:
        N = len(sig)
        F = np.fft.rfft(sig * np.hanning(N), n=N*4)
        freqs = np.fft.rfftfreq(N*4, 1/fs)
        mask = (freqs >= 0.67) & (freqs <= 3.0)
        if not mask.any(): return None
        return float(freqs[mask][np.argmax(np.abs(F[mask])**2)] * 60.0)
    except Exception:
        return None

def normalize(sig):
    mu = np.mean(sig); sd = np.std(sig)
    return (sig - mu) / (sd + 1e-8)

def chrom_from_features(features: np.ndarray, fs: float = FPS):
    """CHROM rPPG từ [T, 7] features. Returns (chrom_signal_raw, chrom_signal_filtered) or (None, None)."""
    R = features[:, 0]; G = features[:, 1]; B = features[:, 2]
    mR, mG, mB = np.mean(R), np.mean(G), np.mean(B)
    if mR < 1e-6 or mG < 1e-6 or mB < 1e-6:
        return None, None
    Cr = R / mR - 1; Cg = G / mG - 1; Cb = B / mB - 1
    X = 3*Cr - 2*Cg
    Y = 1.5*Cr + Cg - 1.5*Cb
    try:
        # Compute alpha on bandpassed X,Y (de Haan & Jeanne 2013) to avoid drift bias
        Xf = bandpass(X, fs=fs); Yf = bandpass(Y, fs=fs)
        alpha = np.std(Xf) / (np.std(Yf) + 1e-8)
        raw = X - alpha * Y             # unfiltered CHROM (correct alpha)
        filtered = Xf - alpha * Yf      # filtered version for BPM extraction
        return raw, filtered
    except Exception:
        return None, None

# ── Decode base64 face crops ───────────────────────────────────────────────────
def decode_crops(b64: str, shape: list) -> np.ndarray:
    """Decode base64 Float32 blob → numpy [T, H, W, 3] float32."""
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.float32)
    T, H, W, C = shape
    return arr.reshape(T, H, W, C)

def build_lite_input(crops: np.ndarray) -> np.ndarray:
    """[T, 18, 18, 3] → [1, T-1, 18, 18, 6] appearance+motion."""
    T = LITE_SEQ
    # Take last T frames
    if len(crops) >= T:
        crops = crops[-T:]
    elif len(crops) < 10:
        return None
    appear = crops[1:].astype(np.float32)          # [T-1, 18, 18, 3]
    motion = (crops[1:] - crops[:-1]).astype(np.float32)
    x = np.concatenate([appear, motion], axis=-1)  # [T-1, 18, 18, 6]
    return x[np.newaxis, ...]                       # [1, T-1, 18, 18, 6]

# ── Schemas ────────────────────────────────────────────────────────────────────
class InferRequest(BaseModel):
    features: List[List[float]]          # [T, 7] — always provided
    mode: Optional[str] = "finger"
    fps: Optional[float] = 30.0
    crops_b64: Optional[str] = None      # base64 float32 face crops
    crops_shape: Optional[List[int]] = None  # [T, 18, 18, 3]

class InferResponse(BaseModel):
    ok: bool
    signal: Optional[List[float]] = None
    bpm: Optional[float] = None
    error: Optional[str] = None
    latency_ms: Optional[float] = None
    model_used: Optional[str] = None

# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "signal_loaded": _signal_loaded, "lite_loaded": _lite_loaded, "error": _load_error}

@app.post("/infer", response_model=InferResponse)
def infer(req: InferRequest):
    if not _signal_loaded and not _lite_loaded:
        return InferResponse(ok=False, error="No model loaded")

    t0 = time.perf_counter()
    fps = req.fps or FPS

    features_arr = np.array(req.features, dtype=np.float32)

    # ── Classical CHROM baseline — used for cross-validation ─────────────────────
    # chrom_raw: unfiltered CHROM (correct alpha)
    # chrom_filt: filtered version ready for FFT BPM extraction
    chrom_raw, chrom_filt = chrom_from_features(features_arr, fs=fps)
    # Use bpm_from_filtered to avoid double-bandpass on already-filtered CHROM
    chrom_bpm = bpm_from_filtered(chrom_filt, fs=fps) if chrom_filt is not None else None

    def _cross_validate(model_signal, model_bpm, model_name):
        """Return model signal if BPM agrees with CHROM within 20 BPM, else fall back to CHROM."""
        if chrom_bpm is None or model_bpm is None:
            return model_signal, model_bpm, model_name
        if abs(model_bpm - chrom_bpm) > 20:
            print(f"[Inference] {model_name} BPM={model_bpm:.1f} vs CHROM={chrom_bpm:.1f} → CHROM fallback")
            chrom_n = normalize(chrom_raw).tolist()
            return chrom_n, chrom_bpm, f"{model_name}_chrom_fallback"
        return model_signal, model_bpm, model_name

    # ── Face mode: use rppg_lite if crops provided and model available ──────────
    if req.mode == "face" and req.crops_b64 and req.crops_shape and _lite_loaded:
        try:
            crops = decode_crops(req.crops_b64, req.crops_shape)
            x = build_lite_input(crops)
            if x is None:
                raise ValueError("Không đủ frames cho rppg_lite")
            pred = _model_lite.predict(x, verbose=0)  # [1, T-1]
            signal = normalize(pred[0]).tolist()
            bpm = bpm_from_signal(np.array(signal), fs=fps)
            signal, bpm, model_used = _cross_validate(signal, bpm, "rppg_lite")
            latency = (time.perf_counter() - t0) * 1000
            return InferResponse(ok=True, signal=signal, bpm=bpm,
                                 latency_ms=round(latency,1), model_used=model_used)
        except Exception as e:
            print(f"[Inference] rppg_lite error: {e} — fallback to rppg_signal")

    # ── Finger mode (+ face fallback): rppg_signal with sliding windows ─────────
    if not _signal_loaded or _model_signal is None:
        if chrom_raw is not None:
            return InferResponse(ok=True, signal=normalize(chrom_raw).tolist(),
                                 bpm=chrom_bpm, latency_ms=round((time.perf_counter()-t0)*1000,1),
                                 model_used="chrom_only")
        return InferResponse(ok=False, error="rppg_signal not loaded")

    try:
        T = features_arr.shape[0]
        if T < 30:
            return InferResponse(ok=False, error=f"Too few frames: {T}")

        target_T = SEQ_LEN - 1  # 127 frames

        # Use sliding windows over the full recording instead of only the last 127 frames
        # This uses 93% more data and reduces sensitivity to motion in the last few seconds
        if T <= target_T:
            pad = np.zeros((target_T - T, 7), dtype=np.float32)
            windows = [np.vstack([pad, features_arr])]
        else:
            stride = max(target_T // 3, 30)
            starts = list(range(0, T - target_T + 1, stride))
            if (T - target_T) not in starts:
                starts.append(T - target_T)
            windows = [features_arr[s:s + target_T] for s in starts[:8]]

        # Run inference on each window, pick candidate with BPM closest to CHROM
        best_sig, best_bpm, best_dist = None, None, float('inf')
        for win in windows:
            p = _model_signal.predict(win[np.newaxis], verbose=0)
            sig_n = normalize(p[0])
            b = bpm_from_signal(np.array(sig_n), fs=fps)
            if b is None:
                continue
            dist = abs(b - chrom_bpm) if chrom_bpm else 0
            if best_bpm is None or dist < best_dist:
                best_sig, best_bpm, best_dist = sig_n.tolist(), b, dist

        if best_sig is None:
            # All windows failed — return CHROM
            if chrom_raw is not None:
                return InferResponse(ok=True, signal=normalize(chrom_raw).tolist(),
                                     bpm=chrom_bpm, latency_ms=round((time.perf_counter()-t0)*1000,1),
                                     model_used="chrom_only")
            return InferResponse(ok=False, error="Inference failed on all windows")

        base_name = "rppg_signal_ubfc" if req.mode == "finger" else "rppg_signal_ubfc_fallback"
        best_sig, best_bpm, model_used = _cross_validate(best_sig, best_bpm, base_name)
        latency = (time.perf_counter() - t0) * 1000
        return InferResponse(ok=True, signal=best_sig, bpm=best_bpm,
                             latency_ms=round(latency, 1), model_used=model_used)

    except Exception as e:
        return InferResponse(ok=False, error=str(e))


if __name__ == "__main__":
    print("=" * 50)
    print("HeartSense Inference Server — port 4001")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=4001, log_level="warning")
