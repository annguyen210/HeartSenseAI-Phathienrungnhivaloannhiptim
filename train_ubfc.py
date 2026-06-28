"""
HeartSense — UBFC-rPPG Real Data Training
==========================================
Train rppg_signal (1D CNN) + rppg_lite (Conv3D) trên UBFC-rPPG real dataset.

Dataset: 42 subjects, vid.avi (29fps, 640x480) + ground_truth.txt (PPG + BPM)
Output:
  models/rppg_signal/ — finger mode + face fallback
  models/rppg_lite/   — face mode (Conv3D, spatial)

Usage:
  python train_ubfc.py
"""

import os, sys, json, time, warnings, glob
import numpy as np
import cv2

warnings.filterwarnings('ignore')
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import tensorflow as tf
from tensorflow import keras
from scipy.signal import butter, filtfilt

tf.get_logger().setLevel('ERROR')

# ── Config ────────────────────────────────────────────────────────────────────
DATASET_DIR  = r'D:\UBFC-rPPG\archive'
OUT_SIGNAL   = r'.\models\rppg_signal'
OUT_LITE     = r'.\models\rppg_lite'
SEQ_LEN      = 128       # frames per clip
LITE_SEQ     = 64        # frames per clip for Conv3D
CROP_SIZE    = 18         # spatial crop size for rppg_lite
STRIDE       = 32         # sliding window stride
BATCH        = 16
EPOCHS       = 60
LR           = 5e-4
VAL_SUBJECTS = 6          # hold out last N subjects for validation
np.random.seed(42)
tf.random.set_seed(42)

# ── Helpers ───────────────────────────────────────────────────────────────────
def bandpass(sig, lo=0.67, hi=3.0, fs=30.0):
    nyq = fs / 2
    b, a = butter(4, [lo/nyq, hi/nyq], btype='band')
    return filtfilt(b, a, sig)

def normalize(sig):
    mu, sd = sig.mean(), sig.std()
    return (sig - mu) / (sd + 1e-8)

def bpm_from_signal(sig, fs=30.0):
    try:
        sig = bandpass(sig, fs=fs)
        N = len(sig)
        F = np.fft.rfft(sig * np.hanning(N), n=N*4)
        freqs = np.fft.rfftfreq(N*4, 1/fs)
        mask = (freqs >= 0.67) & (freqs <= 3.0)
        return float(freqs[mask][np.argmax(np.abs(F[mask])**2)] * 60.0)
    except Exception:
        return 0.0

def neg_pearson(y_true, y_pred):
    mu_t = tf.reduce_mean(y_true, axis=1, keepdims=True)
    mu_p = tf.reduce_mean(y_pred, axis=1, keepdims=True)
    yt, yp = y_true - mu_t, y_pred - mu_p
    num   = tf.reduce_sum(yt * yp, axis=1)
    denom = tf.sqrt(tf.reduce_sum(yt**2, axis=1) * tf.reduce_sum(yp**2, axis=1) + 1e-8)
    return -tf.reduce_mean(num / denom)

# ── Face ROI for UBFC-rPPG (640x480, face centered) ──────────────────────────
# Forehead + cheek region: upper-center of frame
def get_face_roi(w, h):
    x1 = int(w * 0.25); x2 = int(w * 0.75)
    y1 = int(h * 0.10); y2 = int(h * 0.55)
    return x1, y1, x2, y2

# ── Load subject data ─────────────────────────────────────────────────────────
def load_subject(subject_dir, mode='signal'):
    """
    Returns (X, Y) arrays for one subject.
    mode='signal': X=[N,T-1,7], Y=[N,T-1] for rppg_signal
    mode='lite':   X=[N,T-1,18,18,6], Y=[N,T-1] for rppg_lite
    """
    vid_path = os.path.join(subject_dir, 'vid.avi')
    gt_path  = os.path.join(subject_dir, 'ground_truth.txt')
    if not os.path.exists(vid_path) or not os.path.exists(gt_path):
        return None, None

    # Load ground truth PPG signal (row 0)
    with open(gt_path) as f:
        lines = f.readlines()
    ppg_gt = np.array([float(v) for v in lines[0].split()], dtype=np.float32)

    # Read video frames
    cap = cv2.VideoCapture(vid_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    x1, y1, x2, y2 = get_face_roi(w, h)

    frames_rgb  = []   # mean RGB per frame
    frames_crop = []   # 18x18 crops (for rppg_lite)

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            continue
        # Mean RGB (BGR→RGB)
        mean_b, mean_g, mean_r = cv2.mean(roi)[:3]
        frames_rgb.append([mean_r, mean_g, mean_b])
        # 18x18 crop for rppg_lite
        if mode == 'lite':
            crop = cv2.resize(roi, (CROP_SIZE, CROP_SIZE))
            crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            frames_crop.append(crop_rgb)
    cap.release()

    n_frames = min(len(frames_rgb), len(ppg_gt))
    if n_frames < SEQ_LEN + 10:
        return None, None

    frames_rgb = np.array(frames_rgb[:n_frames], dtype=np.float32) / 255.0
    ppg_gt     = ppg_gt[:n_frames]
    ppg_gt     = normalize(ppg_gt)

    if mode == 'signal':
        return _make_signal_clips(frames_rgb, ppg_gt, fps)
    else:
        frames_crop = np.array(frames_crop[:n_frames], dtype=np.float32)
        return _make_lite_clips(frames_rgb, frames_crop, ppg_gt, fps)

def _make_signal_clips(frames_rgb, ppg_gt, fps):
    """Build [T-1, 7] feature clips for rppg_signal."""
    R = frames_rgb[:, 0]
    G = frames_rgb[:, 1]
    B = frames_rgb[:, 2]
    dR = np.diff(R) / (R[1:] + R[:-1] + 1e-6)
    dG = np.diff(G) / (G[1:] + G[:-1] + 1e-6)
    dB = np.diff(B) / (B[1:] + B[:-1] + 1e-6)
    br = (R[1:] + G[1:] + B[1:]) / 3.0
    features = np.stack([R[1:], G[1:], B[1:], dR, dG, dB, br], axis=1)  # [N-1, 7]
    target   = ppg_gt[1:]

    T = SEQ_LEN - 1
    Xs, Ys = [], []
    for start in range(0, len(features) - T, STRIDE):
        x = features[start:start+T]
        y = target[start:start+T]
        y = normalize(y)
        # Augmentation: random scale
        if np.random.rand() > 0.5:
            x = x * np.random.uniform(0.9, 1.1)
        Xs.append(x)
        Ys.append(y)
    if not Xs:
        return None, None
    return np.array(Xs, dtype=np.float32), np.array(Ys, dtype=np.float32)

def _make_lite_clips(frames_rgb, frames_crop, ppg_gt, fps):
    """Build [T-1, 18, 18, 6] appearance+motion clips for rppg_lite."""
    T = LITE_SEQ - 1
    Xs, Ys = [], []
    for start in range(0, len(frames_crop) - LITE_SEQ, STRIDE):
        crops = frames_crop[start:start+LITE_SEQ]   # [T, 18, 18, 3]
        y     = ppg_gt[start+1:start+LITE_SEQ]      # [T-1]
        y     = normalize(y)
        # Appearance = current frame, Motion = diff with previous
        appear = crops[1:]                            # [T-1, 18, 18, 3]
        motion = crops[1:] - crops[:-1]              # [T-1, 18, 18, 3]
        x = np.concatenate([appear, motion], axis=-1) # [T-1, 18, 18, 6]
        Xs.append(x)
        Ys.append(y)
    if not Xs:
        return None, None
    return np.array(Xs, dtype=np.float32), np.array(Ys, dtype=np.float32)

# ── Load all subjects ─────────────────────────────────────────────────────────
def load_all_subjects(mode='signal'):
    subjects = sorted(glob.glob(os.path.join(DATASET_DIR, 'subject*')))
    print(f"Found {len(subjects)} subjects")

    all_X, all_Y = [], []
    for i, subj in enumerate(subjects):
        name = os.path.basename(subj)
        X, Y = load_subject(subj, mode=mode)
        if X is None:
            print(f"  [{i+1}/{len(subjects)}] {name} — skip")
            continue
        print(f"  [{i+1}/{len(subjects)}] {name} — {len(X)} clips")
        all_X.append(X)
        all_Y.append(Y)

    if not all_X:
        raise RuntimeError("No valid subjects found!")
    return subjects, np.concatenate(all_X), np.concatenate(all_Y)

# ── rppg_signal model (1D CNN) ────────────────────────────────────────────────
def build_signal_model():
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

# ── rppg_lite model (Conv3D / PhysNet-Lite) ───────────────────────────────────
def build_lite_model():
    T = LITE_SEQ - 1
    inp = keras.Input(shape=(T, CROP_SIZE, CROP_SIZE, 6), name='frames')
    # 3D conv blocks
    x = keras.layers.Conv3D(16, (1,3,3), activation='elu', padding='same')(inp)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(32, (3,3,3), activation='elu', padding='same')(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(64, (3,3,3), activation='elu', padding='same')(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(32, (3,1,1), activation='elu', padding='same')(x)
    # Global average pool over spatial dims
    x = keras.layers.Lambda(lambda z: tf.reduce_mean(z, axis=[2,3]))(x)  # [B,T,32]
    x = keras.layers.Conv1D(16, 3, activation='elu', padding='same')(x)
    out = keras.layers.Dense(1, activation='linear')(x)
    out = keras.layers.Reshape((T,), name='rppg')(out)
    return keras.Model(inputs=inp, outputs=out, name='rppg_lite_net')

# ── TF.js export ──────────────────────────────────────────────────────────────
def _extract_keras_history(arg):
    if isinstance(arg, dict) and '__keras_tensor__' in (arg.get('class_name') or ''):
        h = arg.get('config', {}).get('keras_history', [])
        if len(h) >= 3:
            return [h[0], h[1], h[2], {}]
    return None

def _fix_layer_config(layer_cfg):
    cfg = layer_cfg.get('config', {})
    if layer_cfg.get('class_name') == 'InputLayer':
        if 'batch_shape' in cfg:
            cfg['batchInputShape'] = cfg.pop('batch_shape')
        if 'batch_input_shape' in cfg:
            cfg['batchInputShape'] = cfg.pop('batch_input_shape')
    nodes = layer_cfg.get('inbound_nodes', [])
    if nodes:
        converted = []
        for node in nodes:
            if isinstance(node, list):
                converted.append(node)
            elif isinstance(node, dict):
                args = node.get('args', [])
                if len(args) == 1:
                    h = _extract_keras_history(args[0])
                    if h: converted.append(h)
                elif len(args) > 1:
                    cs = [_extract_keras_history(a) for a in args if _extract_keras_history(a)]
                    if cs: converted.append(cs)
        layer_cfg['inbound_nodes'] = converted
    for sub in cfg.get('layers', []):
        _fix_layer_config(sub)

def export_tfjs(model, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    all_w, weight_specs = [], []
    for layer in model.layers:
        for var, w in zip(layer.weights, layer.get_weights()):
            w32 = w.astype(np.float32)
            weight_specs.append({'name': var.name, 'shape': list(w32.shape), 'dtype': 'float32'})
            all_w.append(w32.flatten())
    bin_data = np.concatenate(all_w).astype(np.float32).tobytes() if all_w else b''
    with open(os.path.join(out_dir, 'group1-shard1of1.bin'), 'wb') as f:
        f.write(bin_data)
    topo = model.get_config()
    for layer in topo.get('layers', []):
        _fix_layer_config(layer)
    model_json = {
        'format': 'layers-model',
        'generatedBy': 'HeartSense train_ubfc.py',
        'convertedBy': None,
        'modelTopology': {
            'class_name': 'Functional',
            'config': topo,
            'keras_version': keras.__version__,
            'backend': 'tensorflow',
        },
        'weightsManifest': [{'paths': ['group1-shard1of1.bin'], 'weights': weight_specs}],
    }
    with open(os.path.join(out_dir, 'model.json'), 'w') as f:
        json.dump(model_json, f)
    print(f"  TF.js export: {out_dir} ({len(bin_data)/1024:.0f} KB)")

# ── Train one model ───────────────────────────────────────────────────────────
def train_model(model, X_train, Y_train, X_val, Y_val, out_dir, name):
    os.makedirs(out_dir, exist_ok=True)
    ckpt = os.path.join(out_dir, '_best.weights.h5')
    model.compile(optimizer=keras.optimizers.Adam(LR), loss=neg_pearson)

    print(f"\n[{name}] Train: {len(X_train)} clips | Val: {len(X_val)} clips")
    print(f"[{name}] Params: {model.count_params():,}")

    callbacks = [
        keras.callbacks.ModelCheckpoint(ckpt, save_best_only=True,
            save_weights_only=True, monitor='val_loss', verbose=0),
        keras.callbacks.ReduceLROnPlateau(patience=6, factor=0.5, min_lr=1e-6, verbose=1),
        keras.callbacks.EarlyStopping(patience=15, restore_best_weights=True, verbose=1),
    ]

    model.fit(X_train, Y_train, validation_data=(X_val, Y_val),
              epochs=EPOCHS, batch_size=BATCH, callbacks=callbacks,
              shuffle=True, verbose=1)

    # Evaluate BPM MAE on val set
    print(f"\n[{name}] Evaluating BPM MAE...")
    errors = []
    preds = model.predict(X_val, batch_size=BATCH, verbose=0)
    for g, p in zip(Y_val, preds):
        bpm_g = bpm_from_signal(g)
        bpm_p = bpm_from_signal(p)
        if bpm_g > 0 and bpm_p > 0:
            errors.append(abs(bpm_g - bpm_p))
    if errors:
        mae = np.mean(errors)
        p90 = np.percentile(errors, 90)
        print(f"[{name}] BPM MAE = {mae:.2f} | P90 = {p90:.2f}")
    else:
        mae, p90 = 0, 0

    # Save weights + TF.js export
    model.save_weights(ckpt)
    export_tfjs(model, out_dir)

    config = {
        'trainedOn': 'UBFC-rPPG real data',
        'subjects': 42,
        'bpmMae': round(float(mae), 2),
        'bpmP90': round(float(p90), 2),
    }
    with open(os.path.join(out_dir, 'config.json'), 'w') as f:
        json.dump(config, f, indent=2)

    return mae

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("HeartSense UBFC-rPPG Training")
    print("=" * 60)

    # ── Train rppg_signal (1D CNN) ────────────────────────────────────────────
    print("\n[1/2] Loading data for rppg_signal...")
    subjects, X_all, Y_all = load_all_subjects(mode='signal')

    # Subject-level train/val split (last VAL_SUBJECTS subjects = val)
    # Shuffle clips
    idx = np.random.permutation(len(X_all))
    split = int(len(idx) * 0.85)
    X_train, Y_train = X_all[idx[:split]], Y_all[idx[:split]]
    X_val,   Y_val   = X_all[idx[split:]], Y_all[idx[split:]]

    model_signal = build_signal_model()
    mae_signal = train_model(model_signal, X_train, Y_train, X_val, Y_val,
                              OUT_SIGNAL, 'rppg_signal')

    # ── Train rppg_lite (Conv3D) ──────────────────────────────────────────────
    print("\n[2/2] Loading data for rppg_lite (Conv3D)...")
    print("      Note: This reads frames again — takes longer...")
    _, X_lite, Y_lite = load_all_subjects(mode='lite')

    idx2 = np.random.permutation(len(X_lite))
    split2 = int(len(idx2) * 0.85)
    Xl_tr, Yl_tr = X_lite[idx2[:split2]], Y_lite[idx2[:split2]]
    Xl_vl, Yl_vl = X_lite[idx2[split2:]], Y_lite[idx2[split2:]]

    model_lite = build_lite_model()
    mae_lite = train_model(model_lite, Xl_tr, Yl_tr, Xl_vl, Yl_vl,
                            OUT_LITE, 'rppg_lite')

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("TRAINING COMPLETE")
    print(f"rppg_signal BPM MAE: ±{mae_signal:.1f} BPM  →  {OUT_SIGNAL}")
    print(f"rppg_lite   BPM MAE: ±{mae_lite:.1f} BPM  →  {OUT_LITE}")
    print("=" * 60)
    print("\nNext: restart inference_server.py để load model mới")

if __name__ == '__main__':
    main()
