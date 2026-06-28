"""
HeartSense rPPG — Synthetic Training (không cần dataset ngoài)
==============================================================
Tạo synthetic face video clips có embedded BVP signal, train PhysNet-Lite,
export sang TF.js. Chạy được ngay, không cần UBFC/COHFACE.

Cách hoạt động:
  - Tạo face patches có màu da thực tế (36x36, 160 frames @ 30fps)
  - Nhúng BVP signal vào kênh R và G (amplitude ~1-3%, đúng như sinh học)
  - Thêm nhiễu: motion drift, ánh sáng thay đổi, shot noise
  - Train model học trích xuất BVP từ temporal changes
  - Export model.json + bin → đặt vào models/rppg_lite/

Usage:
  python train_synthetic.py
  # Sau ~5-15 phút → models/rppg_lite/model.json
"""

import os, json, sys
import numpy as np
# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
import tensorflow as tf
from tensorflow import keras
from scipy.signal import butter, filtfilt

os.makedirs('./models/rppg_lite', exist_ok=True)
tf.get_logger().setLevel('ERROR')
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

# ─── Hyperparams ───────────────────────────────────────────────────────────────
N_CLIPS   = 2000    # số clip synthetic mỗi epoch
SEQ_LEN   = 64      # frames/clip (2s @ 30fps — đủ detect BPM 45-180)
FACE_SIZE = 18      # pixel — 4x ít ops hơn 36px (18²=324 vs 36²=1296)
FPS       = 30.0
BATCH     = 32
EPOCHS    = 50
LR        = 8e-4
OUT_DIR   = './models/rppg_lite'
SEED      = 42
np.random.seed(SEED)
tf.random.set_seed(SEED)


# ─── Synthetic clip generator ─────────────────────────────────────────────────
def make_ppg_waveform(bpm, n_frames, fps, noise_level=0.15):
    """Tạo BVP waveform thực tế: fundamental + harmonics + noise."""
    t = np.arange(n_frames) / fps
    f0 = bpm / 60.0
    # Dạng sóng PPG thực tế: fundamental + harmonics với amplitude decay
    sig  = np.sin(2 * np.pi * f0 * t)
    sig += 0.35 * np.sin(2 * np.pi * 2 * f0 * t - 0.3)   # 2nd harmonic
    sig += 0.15 * np.sin(2 * np.pi * 3 * f0 * t - 0.6)   # 3rd harmonic
    # Biến thiên nhịp tim nhẹ (HRV thực tế ±2-5%)
    hrv_drift = np.cumsum(np.random.randn(n_frames) * 0.003)
    sig_hrv = np.sin(2 * np.pi * f0 * (t + hrv_drift))
    sig = sig * 0.7 + sig_hrv * 0.3
    # Noise sinh lý
    sig += np.random.randn(n_frames) * noise_level
    # Normalize
    sig = (sig - sig.mean()) / (sig.std() + 1e-8)
    return sig.astype(np.float32)


def make_skin_base(face_h, face_w, skin_tone=None):
    """Tạo base frame màu da (giá trị 0-1)."""
    if skin_tone is None:
        # Random skin tone: từ sáng đến tối
        skin_type = np.random.choice(['light', 'medium', 'dark', 'asian'], p=[0.25, 0.35, 0.2, 0.2])
    else:
        skin_type = skin_tone
    palettes = {
        'light':  (np.array([0.88, 0.72, 0.60]), 0.04),
        'medium': (np.array([0.72, 0.52, 0.38]), 0.04),
        'dark':   (np.array([0.42, 0.28, 0.20]), 0.03),
        'asian':  (np.array([0.82, 0.64, 0.50]), 0.04),
    }
    base_color, var = palettes[skin_type]
    # Tạo spatial texture (da không đồng nhất)
    patch = np.zeros((face_h, face_w, 3), dtype=np.float32)
    for c in range(3):
        noise = np.random.randn(face_h, face_w) * var
        patch[:, :, c] = np.clip(base_color[c] + noise, 0.05, 0.98)
    return patch


def make_clip(bpm, fps=FPS, seq_len=SEQ_LEN, face_h=FACE_SIZE, face_w=FACE_SIZE):
    """Tạo 1 synthetic clip (seq_len frames, face_h x face_w x 3) + ground truth signal."""
    ppg = make_ppg_waveform(bpm, seq_len, fps, noise_level=np.random.uniform(0.05, 0.2))
    base = make_skin_base(face_h, face_w)

    frames = np.zeros((seq_len, face_h, face_w, 3), dtype=np.float32)

    # PPG modulation amplitude (thực tế: 0.5-2% intensity change)
    ppg_amp_R = np.random.uniform(0.008, 0.022)
    ppg_amp_G = np.random.uniform(0.006, 0.018)  # G channel lớn hơn R
    ppg_amp_B = np.random.uniform(0.001, 0.005)  # B channel nhỏ nhất

    # Illumination drift (ánh sáng thay đổi chậm)
    illum_drift = np.cumsum(np.random.randn(seq_len) * 0.0008)
    illum_drift -= illum_drift.mean()

    # Motion artifacts (đầu lắc nhẹ → spatial shift)
    motion_x = np.cumsum(np.random.randn(seq_len) * 0.3).clip(-2, 2)
    motion_y = np.cumsum(np.random.randn(seq_len) * 0.3).clip(-2, 2)

    for i in range(seq_len):
        frame = base.copy()
        # Nhúng PPG vào các kênh màu
        frame[:, :, 0] += ppg[i] * ppg_amp_R  # Red
        frame[:, :, 1] += ppg[i] * ppg_amp_G  # Green
        frame[:, :, 2] += ppg[i] * ppg_amp_B  # Blue
        # Ánh sáng toàn cục drift
        frame += illum_drift[i]
        # Shot noise (camera noise)
        frame += np.random.randn(face_h, face_w, 3) * 0.004
        # Motion: spatial shift (đơn giản hóa bằng cách thêm gradient noise)
        mx, my = motion_x[i], motion_y[i]
        frame += np.outer(np.linspace(-1, 1, face_h), np.ones(face_w))[:, :, None] * mx * 0.002
        frame += np.outer(np.ones(face_h), np.linspace(-1, 1, face_w))[:, :, None] * my * 0.002
        frames[i] = np.clip(frame, 0.0, 1.0)

    return frames, ppg


# ─── tf.data generator (sinh on-the-fly, không load hết vào RAM) ───────────────
def _clip_generator(n_clips, seq_len, face_h, face_w, fps):
    """Yield (X, Y) từng clip một — không cần RAM lớn."""
    T = seq_len - 1
    for _ in range(n_clips):
        bpm = np.random.uniform(45, 165)
        frames, ppg = make_clip(bpm, fps, seq_len, face_h, face_w)
        diff = (frames[1:] - frames[:-1]) / (frames[1:] + frames[:-1] + 1e-6)
        app  = frames[1:]
        inp  = np.concatenate([app, diff], axis=-1).astype(np.float32)
        # Augmentation
        if np.random.rand() > 0.5:
            inp = inp[:, :, ::-1, :]
        if np.random.rand() > 0.5:
            inp = inp[:, ::-1, :, :]
        inp = np.clip(inp * np.random.uniform(0.85, 1.15), -1.0, 1.0)
        gt  = ppg[1:].astype(np.float32)
        yield inp, gt

def make_dataset(n_clips, seq_len, face_h, face_w, fps, batch_size, repeat=False):
    T = seq_len - 1
    ds = tf.data.Dataset.from_generator(
        lambda: _clip_generator(n_clips, seq_len, face_h, face_w, fps),
        output_signature=(
            tf.TensorSpec(shape=(T, face_h, face_w, 6), dtype=tf.float32),
            tf.TensorSpec(shape=(T,),                   dtype=tf.float32),
        )
    )
    if repeat:
        ds = ds.repeat()   # infinite repeat for training
    return ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)


# ─── PhysNet-Lite (3D-CNN, TF.js-compatible) ──────────────────────────────────
def build_model(seq_len, face_h, face_w):
    """
    PhysNet-Lite Fast: tối ưu cho CPU training.
    Input 18x18 (4x nhanh hơn 36x36), 1 Conv3D block spatial + 1D temporal.
    ~50K params, train ~30 phút CPU, TF.js-safe.
    """
    T = seq_len - 1   # 63 frames
    inp = keras.Input(shape=(T, face_h, face_w, 6), name='frames')

    # Spatial: 1 Conv3D block, pool xuống 1×1 ngay
    x = keras.layers.Conv3D(32, (1, 3, 3), padding='same', activation='elu')(inp)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv3D(64, (1, 3, 3), padding='same', activation='elu')(x)
    # Pool toàn bộ spatial dim: 18×18 → 1×1
    x = keras.layers.MaxPool3D((1, face_h, face_w), padding='same')(x)   # [B,T,1,1,64]
    x = keras.layers.BatchNormalization()(x)

    # Squeeze spatial → [B, T, 64]
    x = keras.layers.Reshape((T, 64))(x)

    # Temporal modeling: 3 lớp 1D Conv
    x = keras.layers.Conv1D(64, 5, padding='same', activation='elu')(x)
    x = keras.layers.Conv1D(32, 3, padding='same', activation='elu')(x)
    x = keras.layers.Conv1D(16, 3, padding='same', activation='elu')(x)

    # Output signal
    out = keras.layers.Dense(1, activation='linear')(x)
    out = keras.layers.Reshape((T,), name='rppg')(out)

    return keras.Model(inputs=inp, outputs=out, name='physnet_lite')


# ─── Negative Pearson loss ────────────────────────────────────────────────────
def neg_pearson(y_true, y_pred):
    mu_t = tf.reduce_mean(y_true, axis=1, keepdims=True)
    mu_p = tf.reduce_mean(y_pred, axis=1, keepdims=True)
    yt, yp = y_true - mu_t, y_pred - mu_p
    num   = tf.reduce_sum(yt * yp, axis=1)
    denom = tf.sqrt(tf.reduce_sum(yt**2, axis=1) * tf.reduce_sum(yp**2, axis=1) + 1e-8)
    return -tf.reduce_mean(num / denom)


# ─── BPM từ signal ────────────────────────────────────────────────────────────
def bpm_from_signal(sig, fs=FPS):
    b, a = butter(4, [0.67 / (fs/2), 3.0 / (fs/2)], btype='band')
    sig = filtfilt(b, a, sig)
    N = len(sig)
    F = np.fft.rfft(sig * np.hanning(N), n=N * 4)
    freqs = np.fft.rfftfreq(N * 4, 1 / fs)
    mask  = (freqs >= 0.67) & (freqs <= 3.0)
    peak  = freqs[mask][np.argmax(np.abs(F[mask])**2)]
    return peak * 60.0


# ─── Manual TF.js export (không cần tensorflowjs Python package) ──────────────
def _keras_dtype_to_tfjs(dtype):
    return {'float32': 'float32', 'float16': 'float16',
            'int32': 'int32', 'uint8': 'uint8'}.get(str(dtype), 'float32')

def _layer_to_tfjs_config(layer):
    """Chuyển Keras layer config sang TF.js format."""
    cfg = layer.get_config()
    cls = layer.__class__.__name__
    # Map Keras class names → TF.js class names
    cls_map = {
        'Conv3D': 'Conv3D', 'MaxPooling3D': 'MaxPooling3D',
        'BatchNormalization': 'BatchNormalization',
        'Reshape': 'Reshape', 'Dense': 'Dense',
        'Conv1D': 'Conv1D', 'Dropout': 'Dropout',
        'InputLayer': 'InputLayer',
    }
    return {'class_name': cls_map.get(cls, cls), 'config': cfg, 'name': layer.name,
            'inbound_nodes': []}

def _extract_keras_history(arg):
    if isinstance(arg, dict) and '__keras_tensor__' in (arg.get('class_name') or ''):
        h = arg.get('config', {}).get('keras_history', [])
        if len(h) >= 3:
            return [h[0], h[1], h[2], {}]
    return None

def _fix_layer_config(layer_cfg):
    """Convert Keras3 topology format → TF.js (Keras2) format."""
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

def export_tfjs_manual(model, out_dir):
    """
    Xuất Keras model sang TF.js format (model.json + group1-shard1of1.bin).
    Hoạt động độc lập, không cần tensorflowjs Python package.
    """
    os.makedirs(out_dir, exist_ok=True)

    # Thu thập tất cả weights
    all_weights = []
    weight_manifest = []
    offset = 0

    for layer in model.layers:
        weights = layer.get_weights()
        if not weights:
            continue
        variables = layer.weights
        weight_specs = []
        for var, w in zip(variables, weights):
            w32 = w.astype(np.float32)
            nbytes = w32.nbytes
            weight_specs.append({
                'name': var.name,
                'shape': list(w32.shape),
                'dtype': 'float32',
                'quantization': None,
            })
            all_weights.append(w32.flatten())
            offset += nbytes
        if weight_specs:
            weight_manifest.append({'weights': weight_specs, 'paths': ['group1-shard1of1.bin']})

    # Ghi binary weight file
    if all_weights:
        bin_data = np.concatenate(all_weights).astype(np.float32).tobytes()
    else:
        bin_data = b''
    bin_path = os.path.join(out_dir, 'group1-shard1of1.bin')
    with open(bin_path, 'wb') as f:
        f.write(bin_data)

    # Xây dựng model topology JSON (TF.js LayersModel format)
    topo_config = model.get_config()
    for layer in topo_config.get('layers', []):
        _fix_layer_config(layer)
    topology = {
        'class_name': 'Sequential' if isinstance(model, keras.Sequential) else 'Functional',
        'config': topo_config,
        'keras_version': keras.__version__,
        'backend': 'tensorflow',
    }

    model_json = {
        'format': 'layers-model',
        'generatedBy': 'HeartSense train_synthetic.py',
        'convertedBy': None,
        'modelTopology': topology,
        'weightsManifest': [{'paths': ['group1-shard1of1.bin'], 'weights':
            [s for group in weight_manifest for s in group['weights']]}],
        'trainingConfig': None,
    }

    json_path = os.path.join(out_dir, 'model.json')
    with open(json_path, 'w') as f:
        json.dump(model_json, f)

    size_mb = len(bin_data) / 1024 / 1024
    print(f"  → {json_path} ({len(model.layers)} layers)")
    print(f"  → {bin_path} ({size_mb:.1f} MB, {len(all_weights)} weight tensors)")
    return json_path, bin_path


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("HeartSense PhysNet-Lite — Synthetic Training")
    print("=" * 60)

    # Tạo tf.data datasets (sinh on-the-fly, không dùng RAM)
    n_train = int(N_CLIPS * 0.85)
    n_val   = N_CLIPS - n_train
    steps_per_epoch = n_train // BATCH
    val_steps       = n_val   // BATCH
    print(f"Dataset: {n_train} train, {n_val} val | {steps_per_epoch} steps/epoch (on-the-fly)")
    ds_train = make_dataset(n_train, SEQ_LEN, FACE_SIZE, FACE_SIZE, FPS, BATCH, repeat=True)
    ds_val   = make_dataset(n_val,   SEQ_LEN, FACE_SIZE, FACE_SIZE, FPS, BATCH, repeat=True)

    # Build model
    model = build_model(SEQ_LEN, FACE_SIZE, FACE_SIZE)
    model.summary()
    print(f"Parameters: {model.count_params():,}")

    # Compile
    model.compile(optimizer=keras.optimizers.Adam(LR), loss=neg_pearson)

    # Callbacks
    ckpt = os.path.join(OUT_DIR, '_best.weights.h5')
    callbacks = [
        keras.callbacks.ModelCheckpoint(ckpt, save_best_only=True,
                                        save_weights_only=True, monitor='val_loss', verbose=0),
        keras.callbacks.ReduceLROnPlateau(patience=5, factor=0.5, min_lr=1e-5, verbose=1),
        keras.callbacks.EarlyStopping(patience=12, restore_best_weights=True, verbose=1),
    ]

    print(f"\n[Train] {EPOCHS} epochs, batch={BATCH} (on-the-fly generation)...")
    history = model.fit(
        ds_train,
        validation_data=ds_val,
        epochs=EPOCHS,
        steps_per_epoch=steps_per_epoch,
        validation_steps=val_steps,
        callbacks=callbacks,
        verbose=1,
    )

    # Evaluate BPM MAE trên val set mới
    print("\n[Eval] Computing BPM MAE on fresh val set...")
    ds_eval = make_dataset(300, SEQ_LEN, FACE_SIZE, FACE_SIZE, FPS, BATCH)
    all_gt, all_pr = [], []
    for xb, yb in ds_eval:
        pb = model.predict(xb, verbose=0)
        for gt, pr in zip(yb.numpy(), pb):
            all_gt.append(gt); all_pr.append(pr)
    errors = [abs(bpm_from_signal(g) - bpm_from_signal(p)) for g, p in zip(all_gt, all_pr)]
    mae = np.mean(errors)
    p90 = np.percentile(errors, 90)
    print(f"\n[Result] Validation BPM MAE = {mae:.2f} BPM, P90 = {p90:.2f} BPM")

    # ── Export TF.js (manual, không cần tensorflowjs package) ──────────────────
    print("\n[Export] Saving TF.js model (manual format)...")
    export_tfjs_manual(model, OUT_DIR)

    # ── Config cho app.js ───────────────────────────────────────────────────────
    config = {
        "inputType": "appearance_motion_diff",
        "seqLen": SEQ_LEN,
        "frameH": FACE_SIZE,
        "frameW": FACE_SIZE,
        "inputChannels": 6,
        "fps": FPS,
        "snrBias": 1.12,
        "type": "layers",
        "architecture": "physnet_lite_gru",
        "trainedOn": "synthetic",
        "validationBpmMae": round(float(mae), 2),
        "validationBpmP90": round(float(p90), 2),
    }
    with open(os.path.join(OUT_DIR, 'config.json'), 'w') as f:
        json.dump(config, f, indent=2)

    print(f"\n{'='*60}")
    print(f"DONE — Validation MAE: ±{mae:.1f} BPM")
    print(f"\nCopy models/rppg_lite/ vào thư mục HeartSense,")
    print(f"set trong app.js (dòng ~17):")
    print(f"  RPPG_MODEL_URL = './models/rppg_lite/model.json'")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
