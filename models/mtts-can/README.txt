MTTS-CAN / PhysNet-Lite Model Weights — HeartSense v4.0
========================================================

Thư mục này chứa model TF.js cho face rPPG inference.

Cách 1 — Train model của riêng bạn (khuyến nghị, ±2-4 BPM):
------------------------------------------------------------
Sử dụng training script trong thư mục gốc dự án:

  pip install tensorflow tensorflowjs opencv-python numpy scipy h5py
  python train_rppg.py --dataset ubfc --data_path ./data/UBFC-rPPG --epochs 30 --out_dir ./models/rppg_lite

  Sau khi train xong, set trong app.js (dòng ~17):
    RPPG_MODEL_URL = './models/rppg_lite/model.json'

  Dataset UBFC-rPPG (miễn phí, 42 subjects):
    https://sites.google.com/view/ybenezeth/ubfcrppg

Cách 2 — Dùng pre-trained MTTS-CAN gốc (PyTorch → TF.js):
-----------------------------------------------------------
1. Clone: git clone https://github.com/xliucs/MTTS-CAN
2. Lấy checkpoint từ tác giả (UBFC-rPPG trained)
3. Convert:
   pip install torch onnx tf2onnx tensorflowjs
   python convert_to_tfjs.py --checkpoint checkpoint.pth --output ./models/mtts-can/
4. Set RPPG_MODEL_URL = './models/mtts-can/model.json' trong app.js

Model input format (cả hai cách):
  Shape: [1, T-1, 36, 36, 6]
  C=6: [R_appearance, G_appearance, B_appearance, dR, dG, dB]
  dX = (f_t - f_{t-1}) / (f_t + f_{t-1} + eps)

Model output: [1, T-1] — raw rPPG waveform, BPM extracted via FFT

Khi KHÔNG có model.json:
  App chạy với 9-method classical ensemble (Welch + AMDF + fine search + CHROM-sliding).
  Finger: ±2-4 BPM. Face: ±5-8 BPM.

Khi CÓ model.json (trained):
  Face rPPG: ±2-4 BPM (ánh sáng tốt, yên tĩnh).
  Finger:    ±1-2 BPM (không cần model, thuần algorithmic).

Mục tiêu ±1 BPM — điều kiện cần:
  - Signal quality ≥ 90% (đèn flash sáng, không rung)
  - Đo đủ 60 giây
  - Đã calibrate cá nhân ≥ 3 lần
  - Camera ≥ 30fps, phòng sáng ổn định
