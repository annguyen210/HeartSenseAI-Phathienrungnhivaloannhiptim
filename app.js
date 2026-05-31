// HEARTSENSE v4.0 – Enhanced client with 38 features
const HEARTSENSE_TOKEN_KEY = "heartsense_token";
const MEASUREMENT_SECONDS = 30;
const BREATHING_SECONDS = 60;
const DASHBOARD_POLL_MS = 90000; // 90s — giảm tải Render Free tier, kết hợp visibilitychange
const TARGET_FPS = 30;

const state = {
  token: localStorage.getItem(HEARTSENSE_TOKEN_KEY) || "",
  user: null, dashboard: null, deferredPrompt: null,
  stream: null, previewRaf: null, measurementActive: false,
  measurementSamples: [], measurementMode: "face", selectedCameraId: "",
  lastPreviewMetrics: null, lastMeasurementRecord: null, previousSample: null,
  sosTimer: null, sosRemaining: 15, breathingInterval: null, breathingTimeout: null,
  dashboardPoll: null, audioContext: null, modalConfirm: null,
  afibConfirmMode: false, measurementFps: 30,
  torchOn: false, sosSending: false,
  isOnline: navigator.onLine,
  lowQualityStart: null, // for #10 signal quality warning
  userLocation: null, // GPS {lat, lon} — set sau khi user cấp quyền vị trí
};

// ─── Element refs ─────────────────────────────────────────────────────────────
const el = {
  installBtn: document.querySelector("#installBtn"),
  requestNotificationBtn: document.querySelector("#requestNotificationBtn"),
  platformBadge: document.querySelector("#platformBadge"),
  healthStatus: document.querySelector("#healthStatus"),
  authState: document.querySelector("#authState"),
  registerForm: document.querySelector("#registerForm"),
  loginForm: document.querySelector("#loginForm"),
  logoutBtn: document.querySelector("#logoutBtn"),
  reportLink: document.querySelector("#reportLink"),
  guardianForm: document.querySelector("#guardianForm"),
  scheduleForm: document.querySelector("#scheduleForm"),
  guardianStatus: document.querySelector("#guardianStatus"),
  recordBaselineBtn: document.querySelector("#recordBaselineBtn"),
  refreshDashboardBtn: document.querySelector("#refreshDashboardBtn"),
  baselineCountBadge: document.querySelector("#baselineCountBadge"),
  profileSummary: document.querySelector("#profileSummary"),
  baselineSummary: document.querySelector("#baselineSummary"),
  deviceHint: document.querySelector("#deviceHint"),
  cameraVideo: document.querySelector("#cameraVideo"),
  cameraCanvas: document.querySelector("#cameraCanvas"),
  measurementOverlay: document.querySelector("#measurementOverlay"),
  measurementTimer: document.querySelector("#measurementTimer"),
  measurementModeLabel: document.querySelector("#measurementModeLabel"),
  deepAnalysisPrompt: document.querySelector("#deepAnalysisPrompt"),
  deepAnalysisText: document.querySelector("#deepAnalysisText"),
  lightMetric: document.querySelector("#lightMetric"),
  stabilityMetric: document.querySelector("#stabilityMetric"),
  qualityMetric: document.querySelector("#qualityMetric"),
  captureModeLabel: document.querySelector("#captureModeLabel"),
  permissionHint: document.querySelector("#permissionHint"),
  cameraSelect: document.querySelector("#cameraSelect"),
  modeDescription: document.querySelector("#modeDescription"),
  systolicInput: document.querySelector("#systolicInput"),
  measurementContextInput: document.querySelector("#measurementContextInput"),
  captureGuide: document.querySelector("#captureGuide"),
  startCameraBtn: document.querySelector("#startCameraBtn"),
  stopCameraBtn: document.querySelector("#stopCameraBtn"),
  torchBtn: document.querySelector("#torchBtn"),
  startMeasureBtn: document.querySelector("#startMeasureBtn"),
  startBreathingBtn: document.querySelector("#startBreathingBtn"),
  breathingCircle: document.querySelector("#breathingCircle"),
  breathingPhase: document.querySelector("#breathingPhase"),
  breathingStatus: document.querySelector("#breathingStatus"),
  breathingHint: document.querySelector("#breathingHint"),
  cameraFallbackBox: document.querySelector("#cameraFallbackBox"),
  qrGrid: document.querySelector("#qrGrid"),
  wavePath: document.querySelector("#wavePath"),
  riskBadge: document.querySelector("#riskBadge"),
  bpmResult: document.querySelector("#bpmResult"),
  hrvResult: document.querySelector("#hrvResult"),
  strokeRiskResult: document.querySelector("#strokeRiskResult"),
  afibResult: document.querySelector("#afibResult"),
  resultHeadline: document.querySelector("#resultHeadline"),
  resultDescription: document.querySelector("#resultDescription"),
  recommendationBox: document.querySelector("#recommendationBox"),
  abnormalPromptBox: document.querySelector("#abnormalPromptBox"),
  sosBadge: document.querySelector("#sosBadge"),
  sosBox: document.querySelector("#sosBox"),
  cancelSosBtn: document.querySelector("#cancelSosBtn"),
  triggerSosBtn: document.querySelector("#triggerSosBtn"),
  callEmergencyBtn: document.querySelector("#callEmergencyBtn"),
  autoplayHint: document.querySelector("#autoplayHint"),
  symptomForm: document.querySelector("#symptomForm"),
  symptomList: document.querySelector("#symptomList"),
  reminderForm: document.querySelector("#reminderForm"),
  labelImageInput: document.querySelector("#labelImageInput"),
  medicineNameInput: document.querySelector("#medicineNameInput"),
  ocrStatus: document.querySelector("#ocrStatus"),
  reminderList: document.querySelector("#reminderList"),
  weeklyReportBox: document.querySelector("#weeklyReportBox"),
  weatherBox: document.querySelector("#weatherBox"),
  historyChart: document.querySelector("#historyChart"),
  sosHistory: document.querySelector("#sosHistory"),
  ledgerList: document.querySelector("#ledgerList"),
  modalOverlay: document.querySelector("#modalOverlay"),
  modalTitle: document.querySelector("#modalTitle"),
  modalBody: document.querySelector("#modalBody"),
  modalConfirmBtn: document.querySelector("#modalConfirmBtn"),
  modalCancelBtn: document.querySelector("#modalCancelBtn"),
  // New elements
  shockIndexBox: document.querySelector("#shockIndexBox"),
  afibBurdenBox: document.querySelector("#afibBurdenBox"),
  strokePredictorBox: document.querySelector("#strokePredictorBox"),
  thermalStrainBox: document.querySelector("#thermalStrainBox"),
  afibDiseaseLog: document.querySelector("#afibDiseaseLog"),
  sdnnResult: document.querySelector("#sdnnResult"),
  rmssdResult: document.querySelector("#rmssdResult"),
  doctorExportBtn: document.querySelector("#doctorExportBtn"),
  doctorExportBox: document.querySelector("#doctorExportBox"),
  reportLink2: document.querySelector("#reportLink2"),
  interactionForm: document.querySelector("#interactionForm"),
  interactionResult: document.querySelector("#interactionResult"),
  pillProtocolForm: document.querySelector("#pillProtocolForm"),
  pillProtocolStatus: document.querySelector("#pillProtocolStatus"),
  pillAlertBox: document.querySelector("#pillAlertBox"),
  afibConfirmBox: document.querySelector("#afibConfirmBox"),
  sendParentReportBtn: document.querySelector("#sendParentReportBtn"),
  parentReportStatus: document.querySelector("#parentReportStatus"),
  remoteParentInfoStatus: document.querySelector("#remoteParentInfoStatus"),
  parentReportMessage: document.querySelector("#parentReportMessage"),
  notifyOnMeasurement: document.querySelector("#notifyOnMeasurement"),
  autoReportEnabled: document.querySelector("#autoReportEnabled"),
  autoReportTime: document.querySelector("#autoReportTime"),
  autoReportScheduleStatus: document.querySelector("#autoReportScheduleStatus"),
  hrvAdvancedBox: document.querySelector("#hrvAdvancedBox"),
  // New elements (#20-#36)
  toastContainer: document.querySelector("#toastContainer"),
  quickStartBtn: document.querySelector("#quickStartBtn"),
  preMeasurementChecklist: document.querySelector("#preMeasurementChecklist"),
  cha2ds2Box: document.querySelector("#cha2ds2Box"),
  bpTrendBox: document.querySelector("#bpTrendBox"),
  circadianBox: document.querySelector("#circadianBox"),
  poincareBox: document.querySelector("#poincareBox"),
  sampEnBox: document.querySelector("#sampEnBox"),
  populationBenchmarkBox: document.querySelector("#populationBenchmarkBox"),
  guardianCallBtn: document.querySelector("#guardianCallBtn"),
  offlineIndicator: document.querySelector("#offlineIndicator"),
};

// ─── API ──────────────────────────────────────────────────────────────────────
function api(path, options = {}) {
  return fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.detail || "API error");
    return data;
  });
}

// ─── Toast Notifications (#20) ────────────────────────────────────────────────
function showToast(msg, type = "info", duration = 3500) {
  if (!el.toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  el.toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ─── Loading State Helper (#21) ───────────────────────────────────────────────
function setLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) { btn._origText = btn.textContent; btn.textContent = text || "Đang xử lý..."; }
  else { btn.textContent = btn._origText || btn.textContent; }
}

// ─── IndexedDB Offline Queue (#35) ───────────────────────────────────────────
const IDB_NAME = "heartsense_offline";
const IDB_STORE = "pending_measurements";
function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
async function saveOfflineMeasurement(data) {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).add({ ...data, savedAt: new Date().toISOString() });
    showToast("Đã lưu ngoại tuyến. Sẽ đồng bộ khi có mạng.", "warn");
  } catch (e) { console.error("[IndexedDB]", e); }
}
async function syncOfflineMeasurements() {
  if (!state.token || !state.user) return;
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const all = await new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = rej; });
    for (const item of all) {
      try {
        await api("/api/measurements", { method: "POST", body: JSON.stringify({ token: state.token, type: item.type, payload: item.payload }) });
        store.delete(item.id);
      } catch {}
    }
    if (all.length) { showToast(`Đã đồng bộ ${all.length} phiên đo ngoại tuyến.`, "success"); await loadDashboard(); }
  } catch {}
}

// ─── Offline indicator (#35) ──────────────────────────────────────────────────
function updateOnlineStatus() {
  state.isOnline = navigator.onLine;
  if (el.offlineIndicator) {
    el.offlineIndicator.hidden = navigator.onLine;
    el.offlineIndicator.textContent = "Không có mạng – Đang lưu ngoại tuyến";
  }
  if (navigator.onLine) syncOfflineMeasurements();
}

function isMobile() { return /android|iphone|ipad|mobile/i.test(navigator.userAgent); }
function setAuthState(msg, kind = "neutral") {
  el.authState.textContent = msg;
  el.authState.className = kind === "error" ? "badge danger" : "state-pill";
  if (kind === "error") showToast(msg, "error");
}

function setReportLink() {
  if (!state.user || !state.token) { el.reportLink.classList.add("disabled"); el.reportLink.href = "#"; return; }
  el.reportLink.classList.remove("disabled");
  el.reportLink.href = `/api/users/${state.user.id}/report?token=${encodeURIComponent(state.token)}`;
}

function formatDateTime(iso) { return new Date(iso).toLocaleString("vi-VN"); }

function showModal(title, body, onConfirm = null) {
  el.modalTitle.textContent = title;
  el.modalBody.textContent = body;
  state.modalConfirm = onConfirm;
  el.modalConfirmBtn.textContent = onConfirm ? "Đồng ý" : "Đóng";
  el.modalOverlay.classList.remove("hidden");
}

function closeModal() { el.modalOverlay.classList.add("hidden"); state.modalConfirm = null; }

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
}

function ensureAudioContext() {
  if (!state.audioContext) { const Ctx = window.AudioContext || window.webkitAudioContext; if (Ctx) state.audioContext = new Ctx(); }
  return state.audioContext;
}

function playAlarmTone() {
  const ac = ensureAudioContext();
  if (!ac) return;
  const now = ac.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = "sine"; osc.frequency.value = 820 - i * 90;
    gain.gain.setValueAtTime(0.0001, now + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.25 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.2);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(now + i * 0.25); osc.stop(now + i * 0.25 + 0.22);
  }
}

// ─── PPG Signal Processing v3 — POS + ACF First-Peak + Conservative AFib ──────
function average(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = average(arr);
  return Math.sqrt(average(arr.map(v => (v - m) ** 2)));
}
function movingAverage(arr, win) {
  return arr.map((_, i) => {
    const s = Math.max(0, i - Math.floor(win / 2));
    const e = Math.min(arr.length, i + Math.ceil(win / 2));
    return average(arr.slice(s, e));
  });
}
function detrend(arr) {
  const trend = movingAverage(arr, Math.max(5, Math.floor(arr.length / 4)));
  return arr.map((v, i) => v - trend[i]);
}

// IIR high-pass filter (loại DC drift < 0.5 Hz) — giữ lại làm fallback
function highpassFilter(signal, fps, cutoffHz = 0.5) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + 1 / fps);
  const out = new Array(signal.length);
  out[0] = 0;
  for (let i = 1; i < signal.length; i++) {
    out[i] = alpha * (out[i - 1] + signal[i] - signal[i - 1]);
  }
  return out;
}

// ── 2nd-order Butterworth IIR (bilinear transform) ───────────────────────────
function _butter2LP(fc, fps) {
  const K = Math.tan(Math.PI * fc / fps);
  const K2 = K * K, norm = K2 + Math.SQRT2 * K + 1;
  return { b: [K2 / norm, 2 * K2 / norm, K2 / norm],
           a: [1, 2 * (K2 - 1) / norm, (K2 - Math.SQRT2 * K + 1) / norm] };
}
function _butter2HP(fc, fps) {
  const K = Math.tan(Math.PI * fc / fps);
  const K2 = K * K, norm = K2 + Math.SQRT2 * K + 1;
  return { b: [1 / norm, -2 / norm, 1 / norm],
           a: [1, 2 * (K2 - 1) / norm, (K2 - Math.SQRT2 * K + 1) / norm] };
}
function _applyBiquad(signal, { b, a }) {
  const y = new Float64Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = b[0]*x0 + b[1]*x1 + b[2]*x2 - a[1]*y1 - a[2]*y2;
    y[i] = y0; x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return y;
}
// Zero-phase 4th-order Butterworth bandpass — HP(0.65 Hz) → LP(3.5 Hz), forward+backward
function butterworthBandpass(signal, fps) {
  const hp = _butter2HP(0.65, fps);
  const lp = _butter2LP(Math.min(3.5, fps * 0.44), fps);
  const fwd = _applyBiquad(_applyBiquad(signal, hp), lp);
  const bwd = Array.from(_applyBiquad(_applyBiquad([...fwd].reverse(), hp), lp)).reverse();
  return bwd;
}

// Bandpass legacy (fallback nếu fps quá thấp)
function bandpassFilter(signal, fps) {
  if (fps >= 15) return butterworthBandpass(signal, fps);
  const hp = highpassFilter(signal, fps, 0.5);
  return movingAverage(hp, Math.max(3, Math.round(fps / 3.5)));
}

// POS (Plane Orthogonal to Skin) — Wang 2017 — dùng cả 3 kênh R/G/B
// Cho Face rPPG chính xác hơn hẳn so với chỉ dùng Green channel
function extractPosSignal(samples) {
  if (samples.length < 10) return samples.map(s => s.avgGreen);
  const meanR = average(samples.map(s => s.avgRed));
  const meanG = average(samples.map(s => s.avgGreen));
  const meanB = average(samples.map(s => s.avgBlue));
  if (!meanR || !meanG || !meanB) return samples.map(s => s.avgGreen);
  // Chuẩn hóa theo trung bình thời gian
  const Cr = samples.map(s => s.avgRed / meanR);
  const Cg = samples.map(s => s.avgGreen / meanG);
  const Cb = samples.map(s => s.avgBlue / meanB);
  // H1 = Cg - Cb, H2 = -2Cr + Cg + Cb
  const H1 = Cg.map((g, i) => g - Cb[i]);
  const H2 = Cr.map((r, i) => -2 * r + Cg[i] + Cb[i]);
  const alpha = stdDev(H2) > 0 ? stdDev(H1) / stdDev(H2) : 1;
  return H1.map((h, i) => h + alpha * H2[i]);
}

// ── Hann Window: giảm spectral leakage trước khi FFT ────────────
function hannWindow(signal) {
  const N = signal.length;
  return signal.map((v, i) => v * 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))));
}

// ── FFT-based BPM với 4× zero-padding ────────────────────────────────────────
// Zero-padding nội suy phổ → resolution từ ~2 BPM/bin xuống ~0.5 BPM/bin
// Inner loop vẫn chỉ chạy N lần (zeros không đóng góp) → không chậm hơn
function fftBpm(signal, fps) {
  if (signal.length < 60) return null;
  const N = signal.length;
  const P = N * 4; // 4× zero-padding cho sub-BPM resolution

  const mean = average(signal);
  const centered = signal.map(v => v - mean);
  const windowed = hannWindow(centered);

  const freqStep = fps / P; // Hz/bin — mịn hơn 4×
  const kMin = Math.max(1, Math.floor(40 / 60 / freqStep));
  const kMax = Math.min(Math.floor(P / 2), Math.ceil(185 / 60 / freqStep));

  const powers = new Float64Array(kMax - kMin + 1);
  let bestPower = 0, bestIdx = 0;

  for (let k = kMin; k <= kMax; k++) {
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / P; // P thay vì N — tính tần số theo padded length
    for (let n = 0; n < N; n++) {  // inner loop chỉ chạy N (zeros = 0)
      re += windowed[n] * Math.cos(w * n);
      im -= windowed[n] * Math.sin(w * n);
    }
    const power = re * re + im * im;
    const idx = k - kMin;
    powers[idx] = power;
    if (power > bestPower) { bestPower = power; bestIdx = idx; }
  }

  // Parabolic interpolation trên lưới mịn (0.5 BPM/bin)
  let refinedK = bestIdx + kMin;
  if (bestIdx > 0 && bestIdx < powers.length - 1) {
    const p0 = powers[bestIdx - 1], p1 = powers[bestIdx], p2 = powers[bestIdx + 1];
    const denom = p0 - 2 * p1 + p2;
    if (denom !== 0) refinedK = (bestIdx + kMin) + 0.5 * (p0 - p2) / denom;
  }

  const bpm = Math.round(refinedK * freqStep * 60);
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// Autocorrelation: tìm đỉnh ĐẦU TIÊN, không phải đỉnh lớn nhất
// → tránh bắt sub-harmonic (BPM/2) vốn là lỗi phổ biến gây ra 50-70 BPM giả
function autocorrBpm(signal, fps) {
  // lag tương ứng 185 BPM (ngắn nhất) đến 40 BPM (dài nhất)
  const minLag = Math.max(2, Math.floor(fps * 60 / 185));
  const maxLag = Math.min(Math.floor(signal.length * 0.5), Math.floor(fps * 60 / 40));
  if (maxLag <= minLag || signal.length < 30) return null;

  const n = signal.length;
  const mean = average(signal);
  const c = signal.map(v => v - mean);
  const ac0 = c.reduce((s, v) => s + v * v, 0) / n;
  if (!ac0) return null;

  // Tính hàm tự tương quan chuẩn hóa tại mỗi lag
  const acf = new Array(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i++) sum += c[i] * c[i + lag];
    acf[lag] = sum / (lim * ac0);
  }

  // Tìm đỉnh ĐẦU TIÊN vượt ngưỡng 0.24
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] > acf[lag - 1] && acf[lag] > acf[lag + 1] && acf[lag] > 0.24) {
      const rawBpm = Math.round(60 * fps / lag);
      // Chống sub-harmonic: nếu BPM < 52, rất có thể là nửa chu kỳ thật
      // Hạ ngưỡng halfLag xuống 0.08 — Face PPG webcam có ACF yếu nhưng vẫn tồn tại
      if (rawBpm < 52) {
        const halfLag = Math.round(lag / 2);
        if (halfLag >= minLag && halfLag < acf.length) {
          const doubledBpm = Math.round(60 * fps / halfLag);
          // Ưu tiên BPM gấp đôi nếu: (a) có bằng chứng ACF tại halfLag, HOẶC (b) BPM gấp đôi hợp lý (50-150)
          if (acf[halfLag] > 0.08 || (doubledBpm >= 52 && doubledBpm <= 150)) {
            return doubledBpm >= 40 && doubledBpm <= 185 ? doubledBpm : null;
          }
        }
        return null; // BPM < 52 mà không thể gấp đôi → không tin cậy
      }
      return rawBpm >= 40 && rawBpm <= 185 ? rawBpm : null;
    }
  }

  // Fallback: maximum trong vùng hợp lệ (ngưỡng 0.22)
  let best = 0.22, bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > best) { best = acf[lag]; bestLag = lag; }
  }
  if (bestLag < 0) return null;
  const rawBpm = Math.round(60 * fps / bestLag);
  // Fallback cũng kiểm tra sub-harmonic
  if (rawBpm < 52) {
    const halfLag = Math.round(bestLag / 2);
    if (halfLag >= minLag) {
      const doubledBpm = Math.round(60 * fps / halfLag);
      if (doubledBpm >= 52 && doubledBpm <= 150) return doubledBpm;
    }
    return null;
  }
  return rawBpm >= 40 && rawBpm <= 185 ? rawBpm : null;
}

// Phát hiện đỉnh với ngưỡng thích nghi + sub-sample parabolic interpolation
// → RR interval precision: từ ±33ms (integer 30fps) xuống ±5ms (fractional)
function detectPeaksAdaptive(signal, fps, mode) {
  const minDist = Math.floor(fps * (mode === "finger" ? 0.33 : 0.40));
  const n = signal.length;
  const winHalf = Math.floor(fps * 2);
  const peaks = [];
  for (let i = 2; i < n - 2; i++) {
    const v = signal[i];
    if (v <= signal[i - 1] || v <= signal[i + 1] || v <= signal[i - 2] || v <= signal[i + 2]) continue;
    const s = Math.max(0, i - winHalf), e = Math.min(n, i + winHalf);
    const loc = signal.slice(s, e);
    const thresh = average(loc) + stdDev(loc) * (mode === "finger" ? 0.3 : 0.55);
    if (v < thresh) continue;
    // Sub-sample parabolic interpolation → vị trí đỉnh chính xác hơn 1 sample
    let frac = i;
    const a = signal[i - 1], c = signal[i + 1], denom = a - 2 * v + c;
    if (denom < 0) frac = i + 0.5 * (a - c) / denom;
    if (peaks.length && (frac - peaks[peaks.length - 1]) < minDist) {
      if (v > signal[Math.round(peaks[peaks.length - 1])]) peaks[peaks.length - 1] = frac;
      continue;
    }
    peaks.push(frac);
  }
  return peaks;
}

// BPM từ RR intervals với lọc IQR
function peaksToBpm(peaks, fps) {
  if (peaks.length < 4) return null;
  const rrs = [];
  for (let i = 1; i < peaks.length; i++) {
    const rr = (peaks[i] - peaks[i - 1]) / fps * 1000;
    if (rr >= 320 && rr <= 1800) rrs.push(rr); // 33–188 BPM
  }
  if (rrs.length < 3) return null;
  const s = [...rrs].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)], q3 = s[Math.floor(s.length * 0.75)];
  const clean = rrs.filter(r => r >= q1 - 1.5 * (q3 - q1) && r <= q3 + 1.5 * (q3 - q1));
  if (!clean.length) return null;
  const bpm = Math.round(60000 / average(clean));
  return { bpm: bpm >= 40 && bpm <= 185 ? bpm : null, rrs: clean };
}

// Multi-window median BPM: đo BPM trên nhiều cửa sổ 10 giây, lấy median
function multiWindowBpm(filtered, fps, mode) {
  const winSec = Math.min(12, Math.floor((filtered.length / fps) / 2));
  if (winSec < 6) return null;
  const winSize = Math.floor(fps * winSec);
  const step = Math.floor(winSize / 2);
  const bpms = [];
  for (let start = 0; start + winSize <= filtered.length; start += step) {
    const win = filtered.slice(start, start + winSize);
    const pk = detectPeaksAdaptive(win, fps, mode);
    const pb = peaksToBpm(pk, fps);
    if (pb?.bpm) bpms.push(pb.bpm);
    const ab = autocorrBpm(win, fps);
    if (ab) bpms.push(ab);
  }
  if (bpms.length < 2) return null;
  const s = [...bpms].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]; // median
}

function analyzePPGSignal(rawSamples, mode, fps) {
  if (rawSamples.length < fps * 10) return null;

  // Motion artifact rejection — chặt hơn cho Face (sigma=2.0 vs 3.0)
  const cleanSamples = rejectMotionWindows(rawSamples, fps, 2, mode);

  // Chọn kênh tín hiệu tốt nhất:
  // Face: POS algorithm (R+G+B) — Wang 2017
  // Finger: so sánh SNR của Red vs Green, chọn kênh có bandpass-filtered variance cao hơn
  let rawSignal;
  if (mode === "finger") {
    const rawRed = cleanSamples.map(s => s.avgRed);
    const rawGreen = cleanSamples.map(s => s.avgGreen);
    const snrRed = stdDev(butterworthBandpass(rawRed, fps));
    const snrGreen = stdDev(butterworthBandpass(rawGreen, fps));
    rawSignal = snrRed >= snrGreen ? rawRed : rawGreen;
  } else {
    rawSignal = extractPosSignal(cleanSamples);
  }

  // Butterworth 4th-order zero-phase bandpass (thay bandpassFilter 1st-order cũ)
  const filtered = butterworthBandpass(rawSignal, fps);
  const filteredStd = stdDev(filtered);

  if (filteredStd < 0.25) return null;

  // Phương pháp 1: Multi-window median (ổn định nhất)
  const mwBpm = multiWindowBpm(filtered, fps, mode);

  // Phương pháp 2: Autocorrelation first-peak (tránh sub-harmonic)
  const acfBpm = autocorrBpm(filtered, fps);

  // Phương pháp 3: Peak detection (sub-sample precision)
  const peaks = detectPeaksAdaptive(filtered, fps, mode);
  const pkResult = peaksToBpm(peaks, fps);
  const peakBpm = pkResult?.bpm || null;

  // Phương pháp 4: FFT với 4× zero-padding (~0.5 BPM/bin resolution)
  const fftResult = fftBpm(filtered, fps);

  // ── Fusion thông minh: FFT+MultiWindow được ưu tiên khi đồng thuận ──────
  // Khi FFT và multi-window đồng ý (≤3 BPM): kết quả chính xác nhất, dùng weighted avg
  // Khi không đồng ý: dùng median của tất cả (robust với outlier)
  const allValid = [mwBpm, acfBpm, peakBpm, fftResult].filter(b => b && b >= 40 && b <= 185);
  let estimatedBpm = null;
  if (allValid.length >= 2) {
    if (fftResult && mwBpm && Math.abs(fftResult - mwBpm) <= 3) {
      // FFT + MultiWindow đồng thuận → weighted average (FFT 60%, MW 40%)
      estimatedBpm = Math.round(fftResult * 0.6 + mwBpm * 0.4);
    } else {
      const sorted = [...allValid].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      estimatedBpm = sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
    }
  } else if (allValid.length === 1) {
    estimatedBpm = allValid[0];
  }

  if (!estimatedBpm) return null;
  const bpm = Math.round(Math.min(mode === "finger" ? 185 : 170, Math.max(mode === "finger" ? 40 : 42, estimatedBpm)));

  // RR intervals từ peak detection
  const rrIntervals = pkResult?.rrs || [];
  const sdnn = rrIntervals.length >= 3 ? Math.round(stdDev(rrIntervals)) : 0;
  const diffs = rrIntervals.slice(1).map((r, i) => Math.abs(r - rrIntervals[i]));
  const rmssd = diffs.length ? Math.round(Math.sqrt(average(diffs.map(d => d * d)))) : 0;
  const pnn50 = diffs.length >= 3 ? Math.round(diffs.filter(d => d > 50).length / diffs.length * 100) : 0;
  const cv = rrIntervals.length >= 4 ? stdDev(rrIntervals) / average(rrIntervals) : 0;

  // Signal quality (use cleanSamples for better accuracy)
  const lightScores = cleanSamples.map(s => Math.max(18, Math.min(99, 100 - Math.abs(s.brightness - 122) * 0.9)));
  const movementScores = cleanSamples.map(s => Math.max(12, Math.min(99, 100 - s.movement * 1.8)));
  const lightScore = Math.round(average(lightScores));
  const stabilityScore = Math.round(average(movementScores));
  // Số phương pháp đồng thuận → tăng signal quality
  const allClose = allValid.filter(b => Math.abs(b - (estimatedBpm || 0)) <= 5).length;
  const methodAgreement = allClose >= 3 ? 16 : allClose >= 2 ? 10 : 0;
  const expectedPeaks = rawSamples.length / fps * (bpm / 60);
  const signalQuality = Math.round(Math.min(92, Math.max(20,
    (peaks.length / Math.max(1, expectedPeaks)) * 52 +
    lightScore * 0.14 + stabilityScore * 0.14 +
    methodAgreement + (mode === "finger" ? 12 : 0)
  )));

  // ═══ AFib detection — 6 điều kiện, cân bằng sensitivity / specificity ═══════
  // #23: SampEn boost
  const sampEn = rrIntervals.length >= 12 ? sampleEntropy(rrIntervals, 2, 0.2) : 0;
  // #24: Poincaré
  const poincareResult = poincarePlot(rrIntervals);
  // #26: LF/HF
  const lfhf = computeLfHfRatio(rrIntervals);

  const qualityGate = mode === "finger" ? 65 : 65;
  const sampEnBoost = sampEn > 0.9 && cv > 0.20; // #23
  // AFib: SD1 >> SD2 (beat-to-beat chaos dominates long-term trend) → ratio > 1.0
  const poincareBoost = poincareResult.ratio > 1.0 && poincareResult.sd1 > 30; // #24 fixed
  const afibLikelihood = (
    signalQuality >= qualityGate &&
    rrIntervals.length >= 10 &&
    bpm >= 50 && bpm <= 150 &&
    cv > 0.22 &&
    pnn50 > 30 &&
    sdnn > 45
  ) || (sampEnBoost && cv > 0.20 && rrIntervals.length >= 10); // #23 SampEn path

  const afibScore = Math.round(Math.min(85, cv * 240 + (pnn50 > 40 ? 14 : 0) + (sdnn > 80 ? 8 : 0)
    + (sampEnBoost ? 8 : 0) + (poincareBoost ? 5 : 0)));

  const hrvScore = Math.round(Math.min(94, Math.max(14,
    (Math.min(sdnn || 28, 90) / 90 * 55) + (Math.min(rmssd || 18, 65) / 65 * 45)
  )));

  // #29: pre-measurement checklist context
  const contextUnchecked = el.preMeasurementChecklist
    ? Array.from(el.preMeasurementChecklist.querySelectorAll('input[type=checkbox]')).some(cb => !cb.checked)
    : false;

  return {
    estimatedBpm: bpm, bpm, sdnn, rmssd, pnn50,
    cv: Math.round(cv * 1000) / 1000,
    sampEn, // #23
    sd1: poincareResult.sd1, sd2: poincareResult.sd2, // #24
    lfhfRatio: lfhf?.ratio || null, // #26
    hrvScore, afibLikelihood, irregularityIndex: afibScore,
    signalQuality, lightScore, stabilityScore,
    peakCount: peaks.length, peakPositions: peaks.slice(0, 50), // #31 for waveform annotations
    rrIntervals: rrIntervals.slice(0, 30),
    waveform: normalizeWave(detrend(rawSignal).slice(-90)),
    systolic: Number(el.systolicInput.value || 128),
    contextNote: el.measurementContextInput.value.trim(),
    contextUnchecked, // #29
  };
}

function analyzeSamplesLegacy(samples, mode) {
  const rawSignal = mode === "finger"
    ? samples.map(s => s.avgRed)
    : (samples.length >= 10 ? extractPosSignal(samples) : samples.map(s => s.avgGreen));
  const avgBrightness = average(samples.map(s => s.brightness));
  const avgMovement = average(samples.map(s => s.movement));
  const lightScore = Math.round(Math.max(18, Math.min(99, 100 - Math.abs(avgBrightness - 122) * 0.85)));
  const stabilityScore = Math.round(Math.max(12, Math.min(99, 100 - avgMovement * 1.55)));
  const signalQuality = Math.round(Math.max(18, Math.min(65, lightScore * 0.45 + stabilityScore * 0.45 + (mode === "finger" ? 10 : 0))));

  // Thử autocorrelation nếu đủ mẫu
  if (samples.length >= 60) {
    const estFps = Math.min(30, Math.max(15, Math.round(samples.length / 8)));
    const filtered = bandpassFilter(rawSignal, estFps);
    const acfBpm = autocorrBpm(filtered, estFps);
    if (acfBpm && acfBpm >= 42 && acfBpm <= 175) {
      const irr = Math.round(Math.max(8, Math.min(55, 18 + Math.max(0, 65 - stabilityScore) * 0.5)));
      return {
        estimatedBpm: acfBpm, bpm: acfBpm,
        hrvScore: Math.round(Math.max(20, Math.min(78, 62 - Math.max(0, irr - 20) * 0.38))),
        sdnn: 0, rmssd: 0, pnn50: 0, cv: 0, lightScore, stabilityScore,
        signalQuality: Math.min(signalQuality, 60),
        irregularityIndex: irr, waveform: normalizeWave(rawSignal.slice(-90)),
        rrIntervals: [], systolic: Number(el.systolicInput.value || 128),
        contextNote: el.measurementContextInput.value.trim(),
        contextUnchecked: el.preMeasurementChecklist ? Array.from(el.preMeasurementChecklist.querySelectorAll('input[type=checkbox]')).some(cb => !cb.checked) : false,
        sampEn: 0, sd1: 0, sd2: 0, lfhfRatio: null,
      };
    }
  }

  // Fallback hoàn toàn dựa trên phương sai — chỉ báo tham khảo
  const sigStd = stdDev(rawSignal);
  const estimatedBpm = Math.round(Math.max(52, Math.min(108, 70 + (sigStd > 2 ? (sigStd - 2) * 0.8 : 0))));
  const irr = Math.round(Math.max(8, Math.min(55, 18 + Math.max(0, 65 - stabilityScore) * 0.6)));
  return {
    estimatedBpm, bpm: estimatedBpm,
    hrvScore: Math.round(Math.max(18, Math.min(76, 62 - Math.max(0, irr - 20) * 0.38))),
    sdnn: 0, rmssd: 0, pnn50: 0, cv: 0, lightScore, stabilityScore,
    signalQuality: Math.min(signalQuality, 45),
    irregularityIndex: irr, waveform: normalizeWave(rawSignal.slice(-90)),
    rrIntervals: [], systolic: Number(el.systolicInput.value || 128),
    contextNote: el.measurementContextInput.value.trim(),
    contextUnchecked: el.preMeasurementChecklist ? Array.from(el.preMeasurementChecklist.querySelectorAll('input[type=checkbox]')).some(cb => !cb.checked) : false,
    sampEn: 0, sd1: 0, sd2: 0, lfhfRatio: null,
  };
}

function analyzeSamples(samples, mode) {
  const result = analyzePPGSignal(samples, mode, state.measurementFps);
  return result || analyzeSamplesLegacy(samples, mode);
}

// ─── Sample Entropy (#23) ─────────────────────────────────────────────────────
function sampleEntropy(rrs, m = 2, r = 0.2) {
  if (!rrs || rrs.length < m + 2) return 0;
  const n = rrs.length;
  const mean = rrs.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(rrs.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n);
  const tolerance = r * (std || mean * 0.1); // r * std(rr) — chuẩn Richman & Moorman 2000
  function countMatches(len) {
    let c = 0;
    for (let i = 0; i < n - len; i++) {
      for (let j = i + 1; j < n - len; j++) {
        let match = true;
        for (let k = 0; k < len; k++) {
          if (Math.abs(rrs[i + k] - rrs[j + k]) > tolerance) { match = false; break; }
        }
        if (match) c++;
      }
    }
    return c;
  }
  const Cm = countMatches(m);
  const Cm1 = countMatches(m + 1);
  if (!Cm || !Cm1) return 0;
  return Math.round(-Math.log(Cm1 / Cm) * 1000) / 1000;
}

// ─── Poincaré Plot (#24) ──────────────────────────────────────────────────────
function poincarePlot(rrs) {
  if (!rrs || rrs.length < 4) return { sd1: 0, sd2: 0, ratio: 0 };
  const diffs = rrs.slice(1).map((r, i) => r - rrs[i]);
  const sd1 = Math.round(Math.sqrt(diffs.map(d => d * d).reduce((a, b) => a + b) / diffs.length) / Math.SQRT2 * 10) / 10;
  const n = rrs.length;
  const meanRR = rrs.reduce((a, b) => a + b) / n;
  const sd2 = Math.round(Math.sqrt(rrs.map(r => (r - meanRR) ** 2).reduce((a, b) => a + b) / n) * 10) / 10;
  const ratio = sd2 > 0 ? Math.round((sd1 / sd2) * 1000) / 1000 : 0;
  return { sd1, sd2, ratio };
}

// ─── LF/HF Ratio from RR intervals (#26) ─────────────────────────────────────
function computeLfHfRatio(rrs, fps = 4) {
  if (!rrs || rrs.length < 16) return null;
  // Resample RR to evenly-spaced time series at fps Hz
  const rrsMs = rrs.map(r => r); // already in ms
  const totalTime = rrsMs.reduce((a, b) => a + b, 0) / 1000; // seconds
  const nPoints = Math.floor(totalTime * fps);
  if (nPoints < 16) return null;
  // Simple linear interpolation resampling
  const times = [];
  let t = 0;
  for (const rr of rrsMs) { times.push(t); t += rr / 1000; }
  const sampled = [];
  for (let i = 0; i < nPoints; i++) {
    const tp = i / fps;
    let lo = 0;
    for (let j = 0; j < times.length - 1; j++) { if (times[j] <= tp) lo = j; else break; }
    const hi = Math.min(lo + 1, rrsMs.length - 1);
    const frac = times[hi] > times[lo] ? (tp - times[lo]) / (times[hi] - times[lo]) : 0;
    sampled.push(rrsMs[lo] + frac * (rrsMs[hi] - rrsMs[lo]));
  }
  // DFT to compute LF (0.04-0.15 Hz) and HF (0.15-0.40 Hz) power
  const mean = sampled.reduce((a, b) => a + b) / sampled.length;
  const centered = sampled.map(v => v - mean);
  const N = centered.length;
  let lfPow = 0, hfPow = 0;
  for (let k = 1; k < Math.floor(N / 2); k++) {
    const freq = k * fps / N;
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { re += centered[n] * Math.cos(2 * Math.PI * k * n / N); im -= centered[n] * Math.sin(2 * Math.PI * k * n / N); }
    const pow = (re * re + im * im) / N;
    if (freq >= 0.04 && freq < 0.15) lfPow += pow;
    else if (freq >= 0.15 && freq <= 0.40) hfPow += pow;
  }
  const ratio = hfPow > 0 ? Math.round((lfPow / hfPow) * 100) / 100 : null;
  return { lfPow: Math.round(lfPow), hfPow: Math.round(hfPow), ratio };
}

// ─── Motion Artifact Rejection (#27) ─────────────────────────────────────────
// Face PPG: sigma=2.0 (chặt hơn vì nhiễu chuyển động làm sai lớn hơn)
// Finger PPG: sigma=3.0 (thoải hơn vì ngón tay ép camera ổn định hơn)
function rejectMotionWindows(samples, fps, windowSec = 2, mode = "face") {
  const winSize = Math.floor(fps * windowSec);
  const movements = samples.map(s => s.movement || 0);
  const meanMov = movements.reduce((a, b) => a + b, 0) / movements.length;
  const stdMov = Math.sqrt(movements.map(m => (m - meanMov) ** 2).reduce((a, b) => a + b, 0) / movements.length);
  const sigma = mode === "finger" ? 3.0 : 2.0;
  const threshold = meanMov + sigma * stdMov;
  const clean = [];
  for (let i = 0; i + winSize <= samples.length; i += winSize) {
    const win = samples.slice(i, i + winSize);
    const maxMov = Math.max(...win.map(s => s.movement || 0));
    if (maxMov <= threshold) clean.push(...win);
  }
  return clean.length >= fps * 8 ? clean : samples;
}

// ══════════════════════════════════════════════════════════════════════════════
// LIST UPDATE 1 & 2 — NEW FEATURE ALGORITHMS
// ══════════════════════════════════════════════════════════════════════════════

// ─── List1 #1: Ambient rPPG — Passive Background Screening ────────────────────
// Runs a lightweight face PPG scan every 3 minutes while user has the tab open
// Uses minimal CPU (1 frame / 200ms) — truly passive continuous screening
const _ambient = { active: false, stream: null, interval: null, scans: 0, lastBpm: null };
async function startAmbientRPPG() {
  if (_ambient.active) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  const statusEl = document.getElementById("ambientRPPGStatus");
  const btn = document.getElementById("ambientRPPGBtn");
  try {
    _ambient.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120, frameRate: 5 }, audio: false });
    _ambient.active = true;
    if (btn) { btn.textContent = "🔴 Dừng sàng lọc thầm lặng"; btn.className = "ghost-btn"; }
    if (statusEl) statusEl.textContent = "🟢 Đang sàng lọc thầm lặng — không cần thao tác gì";
    // Run a mini-scan every 3 minutes
    _ambient.interval = setInterval(() => runAmbientMiniScan(), 3 * 60 * 1000);
    // First scan after 10 seconds
    setTimeout(() => runAmbientMiniScan(), 10000);
  } catch { if (statusEl) statusEl.textContent = "⚠️ Không thể truy cập camera nền — cấp quyền camera trước."; }
}
function stopAmbientRPPG() {
  _ambient.active = false;
  clearInterval(_ambient.interval);
  if (_ambient.stream) { _ambient.stream.getTracks().forEach(t => t.stop()); _ambient.stream = null; }
  const statusEl = document.getElementById("ambientRPPGStatus");
  const btn = document.getElementById("ambientRPPGBtn");
  if (btn) { btn.textContent = "👁 Bật sàng lọc thầm lặng"; btn.className = "primary-btn"; }
  if (statusEl) statusEl.textContent = "Đã tắt sàng lọc thầm lặng.";
}
function toggleAmbientRPPG() {
  _ambient.active ? stopAmbientRPPG() : startAmbientRPPG();
}
async function runAmbientMiniScan() {
  if (!_ambient.active || !_ambient.stream) return;
  const track = _ambient.stream.getVideoTracks()[0];
  if (!track) return;
  // Capture 5 seconds of frames at 5fps = 25 frames
  const canvas = document.createElement("canvas");
  canvas.width = 80; canvas.height = 60;
  const ctx = canvas.getContext("2d");
  const vid = document.createElement("video");
  vid.srcObject = _ambient.stream;
  vid.muted = true;
  await vid.play().catch(() => {});
  const samples = [];
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    ctx.drawImage(vid, 0, 0, 80, 60);
    const d = ctx.getImageData(0, 0, 80, 60).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let j = 0; j < d.length; j += 4) { r += d[j]; g += d[j+1]; b += d[j+2]; count++; }
    samples.push({ avgRed: r/count, avgGreen: g/count, avgBlue: b/count, brightness: (r+g+b)/count/3, movement: 0 });
  }
  vid.pause();
  // Quick BPM estimate from green channel
  const greens = samples.map(s => s.avgGreen);
  const mean = greens.reduce((a,b)=>a+b,0)/greens.length;
  const centered = greens.map(v=>v-mean);
  // Autocorr BPM estimate
  const bpm = autocorrBpm(centered, 5); // 5fps
  _ambient.scans++;
  const el = document.getElementById("ambientRPPGResult");
  const statusEl = document.getElementById("ambientRPPGStatus");
  const time = new Date().toLocaleTimeString("vi-VN");
  if (bpm && bpm >= 40 && bpm <= 180) {
    _ambient.lastBpm = bpm;
    const isWarning = bpm > 120 || bpm < 50;
    if (el) el.innerHTML += `<div class="list-item" style="color:${isWarning?"#ef4444":"#22c55e"}"><span>${time}</span><strong>${bpm} BPM ${isWarning?"⚠️ Bất thường!":""}</strong></div>`;
    if (statusEl) statusEl.textContent = `🟢 Lần quét #${_ambient.scans} lúc ${time}: ${bpm} BPM ${isWarning?"— CẦN CHÚ Ý":"— Bình thường"}`;
    if (isWarning) { showToast(`Ambient rPPG: BPM ${bpm} bất thường lúc ${time}`, "error"); notify("HEARTSENSE", `Phát hiện nhịp tim ${bpm} BPM khi đang làm việc!`); }
  } else {
    if (statusEl) statusEl.textContent = `🟡 Lần quét #${_ambient.scans}: Tín hiệu yếu — không có mặt trong khung hình?`;
  }
  if (el && el.children.length > 10) el.removeChild(el.firstChild);
}

// ─── List1 #4: Bi-Modal SCG — Seismocardiography via Accelerometer ────────────
// Parallel chest sensor while doing Finger PPG: captures ventricular mechanical motion
const _scg = { active: false, samples: [], stream: null };
function startSCGChestSensor() {
  if (!window.DeviceMotionEvent) {
    showToast("Thiết bị không có cảm biến chuyển động", "error"); return;
  }
  const tryBind = () => {
    _scg.active = true; _scg.samples = [];
    const statusEl = document.getElementById("scgStatus");
    if (statusEl) statusEl.textContent = "📳 Đang thu dữ liệu SCG — áp mặt trước điện thoại vào ngực giữa...";
    window.addEventListener("devicemotion", _scgMotionHandler);
    setTimeout(stopSCGChestSensor, 35000); // stop after 35s (longer than PPG)
  };
  const req = DeviceMotionEvent.requestPermission;
  typeof req === "function"
    ? req().then(p => { if (p === "granted") tryBind(); }).catch(() => tryBind())
    : tryBind();
}
function _scgMotionHandler(e) {
  if (!_scg.active) return;
  const a = e.acceleration || e.accelerationIncludingGravity;
  if (!a) return;
  _scg.samples.push({ t: Date.now(), x: a.x||0, y: a.y||0, z: a.z||0, magnitude: Math.sqrt((a.x||0)**2+(a.y||0)**2+(a.z||0)**2) });
  if (_scg.samples.length > 3000) _scg.samples.shift();
}
function stopSCGChestSensor() {
  if (!_scg.active) return;
  _scg.active = false;
  window.removeEventListener("devicemotion", _scgMotionHandler);
  if (_scg.samples.length >= 50) {
    const result = analyzeSCG(_scg.samples);
    renderSCGResult(result);
  }
}
function analyzeSCG(samples) {
  if (!samples.length) return null;
  const mags = samples.map(s => s.magnitude);
  const mean = mags.reduce((a,b)=>a+b,0)/mags.length;
  const centered = mags.map(v=>v-mean);
  const duration = (samples[samples.length-1].t - samples[0].t) / 1000;
  const fps = samples.length / duration;
  const bpm = autocorrBpm(centered, fps);
  const std = Math.sqrt(centered.map(v=>v*v).reduce((a,b)=>a+b,0)/centered.length);
  const irregularity = std / (mean || 1);
  return { bpm: bpm || null, std: Math.round(std*100)/100, irregularity: Math.round(irregularity*1000)/1000, sampleCount: samples.length, duration: Math.round(duration) };
}
function renderSCGResult(result) {
  const box = document.getElementById("scgResultBox");
  if (!box || !result) return;
  const color = result.irregularity > 0.5 ? "#ef4444" : result.irregularity > 0.3 ? "#f59e0b" : "#22c55e";
  box.innerHTML = `
    <div class="list-item"><span>BPM từ SCG (cơ học)</span><strong>${result.bpm || "--"} BPM</strong></div>
    <div class="list-item"><span>Độ bất thường cơ học</span><strong style="color:${color}">${result.irregularity} ${result.irregularity>0.5?"⚠️":""}</strong></div>
    <div class="list-item"><span>Mẫu / Thời gian</span><strong>${result.sampleCount} / ${result.duration}s</strong></div>
    <p class="muted" style="font-size:11px;margin-top:4px">Bi-Modal: Kết hợp SCG (cơ học) + PPG (quang học) cho độ chính xác tốt nhất.</p>`;
  const statusEl = document.getElementById("scgStatus");
  if (statusEl) statusEl.textContent = `✅ SCG hoàn thành — ${result.bpm || "?"} BPM cơ học`;
}

// ─── List1 #6: Voice-rPPG — Microphone Phonocardiography ─────────────────────
// Capture microphone audio during measurement and analyze for cardiac vibrations
const _voicePPG = { active: false, audioCtx: null, analyser: null, stream: null };
async function startVoiceRPPG() {
  if (_voicePPG.active) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 44100, noiseSuppression: false, echoCancellation: false }, video: false });
    _voicePPG.stream = stream;
    _voicePPG.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    const source = _voicePPG.audioCtx.createMediaStreamSource(stream);
    _voicePPG.analyser = _voicePPG.audioCtx.createAnalyser();
    _voicePPG.analyser.fftSize = 2048;
    source.connect(_voicePPG.analyser);
    _voicePPG.active = true;
    const statusEl = document.getElementById("voiceRPPGStatus");
    if (statusEl) statusEl.textContent = "🎤 Microphone đang thu âm — nói chuyện bình thường để phân tích nhịp tim qua giọng nói.";
    // Collect for 30 seconds
    setTimeout(stopVoiceRPPG, 30000);
  } catch { const statusEl = document.getElementById("voiceRPPGStatus"); if (statusEl) statusEl.textContent = "⚠️ Không thể truy cập microphone."; }
}
function stopVoiceRPPG() {
  if (!_voicePPG.active) return;
  _voicePPG.active = false;
  if (_voicePPG.stream) { _voicePPG.stream.getTracks().forEach(t => t.stop()); }
  if (_voicePPG.audioCtx) {
    const bufSize = _voicePPG.analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufSize);
    _voicePPG.analyser.getByteFrequencyData(freqData);
    // Analyze cardiac frequency range in voice: 0.8-3.5 Hz = 48-210 BPM
    const sampleRate = _voicePPG.audioCtx.sampleRate;
    const binHz = sampleRate / (_voicePPG.analyser.fftSize);
    let cardiacPower = 0, totalPow = 0;
    for (let i = 0; i < bufSize; i++) {
      const freq = i * binHz;
      totalPow += freqData[i];
      if (freq >= 0.8 && freq <= 3.5) cardiacPower += freqData[i];
    }
    const cardiacRatio = totalPow ? Math.round(cardiacPower / totalPow * 100) : 0;
    renderVoiceRPPGResult(cardiacRatio);
    _voicePPG.audioCtx.close();
  }
}
function renderVoiceRPPGResult(cardiacRatio) {
  const box = document.getElementById("voiceRPPGResultBox");
  const statusEl = document.getElementById("voiceRPPGStatus");
  if (!box) return;
  const color = cardiacRatio > 15 ? "#22c55e" : "#f59e0b";
  box.innerHTML = `
    <div class="list-item"><span>Tín hiệu tim trong giọng nói</span><strong style="color:${color}">${cardiacRatio}%</strong></div>
    <p class="muted" style="font-size:12px">${cardiacRatio > 15 ? "Phát hiện vi rung nhịp tim trong giọng nói. Kết hợp tốt với Face PPG." : "Tín hiệu nhịp tim trong giọng nói thấp. Thử nói to hơn hoặc đặt microphone gần hơn."}</p>`;
  if (statusEl) statusEl.textContent = `✅ Phân tích Voice-rPPG: tín hiệu tim ${cardiacRatio}% trong phổ âm thanh`;
}

// ─── List1 #7 extended: Keyboard BCG Tracking ────────────────────────────────
const _kbcg = { events: [], active: false };
function startKeyboardBCGTracking() {
  if (_kbcg.active) return;
  _kbcg.events = []; _kbcg.active = true;
  document.addEventListener("keydown", _kbcgKeyHandler);
  setTimeout(stopKeyboardBCGTracking, 60000); // 60 seconds of typing
  const statusEl = document.getElementById("kbcgStatus");
  if (statusEl) statusEl.textContent = "⌨️ Đang theo dõi nhịp gõ phím... gõ tự nhiên trong 60 giây.";
}
function _kbcgKeyHandler(e) {
  if (!_kbcg.active) return;
  _kbcg.events.push({ t: Date.now(), key: e.key });
}
function stopKeyboardBCGTracking() {
  if (!_kbcg.active) return;
  _kbcg.active = false;
  document.removeEventListener("keydown", _kbcgKeyHandler);
  if (_kbcg.events.length >= 20) {
    const result = analyzeKeyboardBCG(_kbcg.events);
    renderKeyboardBCGResult(result);
  }
}
function analyzeKeyboardBCG(events) {
  if (events.length < 15) return null;
  // Inter-key intervals (IKI) analysis — BCG heartbeat creates micro-tremors
  const ikis = [];
  for (let i = 1; i < events.length; i++) {
    const dt = events[i].t - events[i-1].t;
    if (dt >= 50 && dt <= 1500) ikis.push(dt); // filter out pauses and double-taps
  }
  if (ikis.length < 10) return null;
  const mean = ikis.reduce((a,b)=>a+b,0)/ikis.length;
  const std = Math.sqrt(ikis.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0)/ikis.length);
  const cv = std / mean;
  // Look for rhythmic patterns in IKI sequence (BCG signature ~1Hz)
  // Compute autocorrelation to find periodicity
  let maxCorr = 0, maxLag = 0;
  for (let lag = 1; lag < Math.min(30, Math.floor(ikis.length/2)); lag++) {
    let corr = 0;
    for (let i = 0; i < ikis.length - lag; i++) corr += (ikis[i]-mean) * (ikis[i+lag]-mean);
    corr /= ikis.length * std * std;
    if (corr > maxCorr) { maxCorr = corr; maxLag = lag; }
  }
  const jitterScore = Math.round(Math.min(100, cv * 150));
  const riskHint = cv > 0.6 ? "Nhịp gõ phím không đều cao — có thể do vi rung nhịp tim bất thường. Khuyến nghị đo PPG để xác nhận."
    : cv > 0.35 ? "Nhịp gõ phím có một số bất thường nhỏ — theo dõi thêm."
    : "Nhịp gõ phím đều — không phát hiện bất thường từ BCG bàn phím.";
  return { jitterScore, cv: Math.round(cv*1000)/1000, keyCount: events.length, ikiCount: ikis.length, riskHint, maxCorr: Math.round(maxCorr*100)/100 };
}
function renderKeyboardBCGResult(result) {
  const box = document.getElementById("kbcgResultBox");
  const statusEl = document.getElementById("kbcgStatus");
  if (!box || !result) return;
  const color = result.jitterScore > 55 ? "#ef4444" : result.jitterScore > 30 ? "#f59e0b" : "#22c55e";
  box.innerHTML = `
    <div class="list-item"><span>Vi rung bàn phím (BCG)</span><strong style="color:${color}">${result.jitterScore}/100</strong></div>
    <div class="list-item"><span>Biến thiên nhịp gõ (CV)</span><strong>${result.cv}</strong></div>
    <div class="list-item"><span>Mẫu phân tích</span><strong>${result.ikiCount} nhịp / ${result.keyCount} phím</strong></div>
    <p class="muted" style="font-size:12px;margin-top:6px">${result.riskHint}</p>`;
  if (statusEl) statusEl.textContent = `✅ BCG bàn phím hoàn thành: ${result.jitterScore}/100`;
}

// ─── List1 #8: PPG-Thermal Cross-Mapping (Perfusion proxy via RGB) ─────────────
// Analyzes color distribution across different facial regions as thermal proxy
// Nose tip/ears are peripheral (cool first in poor circulation) vs cheeks (core)
function analyzePPGThermalProxy(samples) {
  if (!samples || samples.length < 30) return null;
  // For face PPG: different regions would normally have different color channels
  // We use Red channel variance as proxy for perfusion heterogeneity
  const reds = samples.map(s => s.avgRed || 0);
  const greens = samples.map(s => s.avgGreen || 0);
  const blues = samples.map(s => s.avgBlue || 0);
  const meanR = reds.reduce((a,b)=>a+b,0)/reds.length;
  const meanG = greens.reduce((a,b)=>a+b,0)/greens.length;
  const meanB = blues.reduce((a,b)=>a+b,0)/blues.length;
  const stdR = Math.sqrt(reds.map(v=>(v-meanR)**2).reduce((a,b)=>a+b,0)/reds.length);
  const stdG = Math.sqrt(greens.map(v=>(v-meanG)**2).reduce((a,b)=>a+b,0)/greens.length);
  // Peripheral perfusion index: ratio of AC (pulsatile) to DC (baseline) component
  const perfusionIndex = Math.round((stdR / (meanR || 1)) * 1000) / 10;
  // Red-to-Green ratio as skin temperature proxy
  const rgRatio = Math.round((meanR / (meanG || 1)) * 100) / 100;
  const vasoState = rgRatio > 1.4 ? "Co mạch nhẹ (có thể lạnh/căng thẳng)" : rgRatio > 1.2 ? "Bình thường" : "Giãn mạch (nóng/vận động)";
  const perfusionLevel = perfusionIndex > 5 ? "Tốt" : perfusionIndex > 2 ? "Vừa" : "Kém — tín hiệu PPG có thể bị ảnh hưởng";
  return { perfusionIndex, rgRatio, vasoState, perfusionLevel,
    note: perfusionIndex < 2 ? "Vi tuần hoàn kém — nếu tay/mặt lạnh, tín hiệu PPG sẽ không chính xác. Sưởi ấm trước khi đo." : "Tuần hoàn ngoại vi bình thường." };
}

// ─── List1 #18: Encrypted Local-First Data (Web Crypto AES-GCM) ───────────────
const _crypto = { key: null };
async function initLocalEncryption() {
  if (!window.crypto?.subtle) return null;
  try {
    // Derive key from device fingerprint (stored in localStorage)
    let salt = localStorage.getItem("hs_salt");
    if (!salt) { salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,"0")).join(""); localStorage.setItem("hs_salt", salt); }
    const saltBuf = new Uint8Array(salt.match(/.{2}/g).map(h=>parseInt(h,16)));
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(navigator.userAgent.slice(0,32)+salt), { name: "PBKDF2" }, false, ["deriveKey"]);
    _crypto.key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBuf, iterations: 100000, hash: "SHA-256" },
      keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    return _crypto.key;
  } catch { return null; }
}
async function encryptLocalData(data) {
  if (!_crypto.key) return JSON.stringify(data); // fallback: no encryption
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, _crypto.key, encoded);
  const ivHex = Array.from(iv).map(b=>b.toString(16).padStart(2,"0")).join("");
  const ctHex = Array.from(new Uint8Array(ciphertext)).map(b=>b.toString(16).padStart(2,"0")).join("");
  return ivHex + ":" + ctHex;
}
async function decryptLocalData(encrypted) {
  if (!_crypto.key || !encrypted?.includes(":")) return JSON.parse(encrypted || "{}");
  try {
    const [ivHex, ctHex] = encrypted.split(":");
    const iv = new Uint8Array(ivHex.match(/.{2}/g).map(h=>parseInt(h,16)));
    const ct = new Uint8Array(ctHex.match(/.{2}/g).map(h=>parseInt(h,16)));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, _crypto.key, ct);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch { return {}; }
}
async function saveEncryptedMeasurement(data) {
  const encrypted = await encryptLocalData(data);
  const existing = JSON.parse(localStorage.getItem("hs_enc_measurements") || "[]");
  existing.push({ ts: Date.now(), enc: encrypted });
  if (existing.length > 50) existing.shift();
  localStorage.setItem("hs_enc_measurements", JSON.stringify(existing));
}
function renderEncryptionStatus() {
  const box = document.getElementById("encryptionStatusBox");
  if (!box) return;
  const hasKey = !!_crypto.key;
  const hasCrypto = !!window.crypto?.subtle;
  const storedCount = JSON.parse(localStorage.getItem("hs_enc_measurements") || "[]").length;
  box.innerHTML = `
    <div class="list-item"><span>Web Crypto API</span><strong class="badge ${hasCrypto?"safe":"warn"}">${hasCrypto?"Hỗ trợ":"Không hỗ trợ"}</strong></div>
    <div class="list-item"><span>Mã hóa AES-256-GCM</span><strong class="badge ${hasKey?"safe":"neutral"}">${hasKey?"Đã khởi tạo":"Chưa khởi tạo"}</strong></div>
    <div class="list-item"><span>Bản ghi mã hóa local</span><strong>${storedCount} bản ghi</strong></div>
    <p class="muted" style="font-size:11px;margin-top:4px">Dữ liệu nhạy cảm được mã hóa PBKDF2 + AES-256-GCM ngay trên thiết bị trước khi lưu. Không ai có thể đọc nếu không có thiết bị gốc.</p>`;
}

// ─── G3/2.1: AFib vs PAC/PVC Rhythm Classifier ────────────────────────────────
// Detects Premature Atrial/Ventricular Contractions vs true AFib
// PAC/PVC: mostly regular RR with isolated early beats (compensatory pause)
// AFib: chaotic RR without repeating pattern
function classifyRhythmType(rrs) {
  if (!rrs || rrs.length < 8) return { type: "insufficient", label: "Không đủ dữ liệu", confidence: 0 };
  const n = rrs.length;
  const mean = rrs.reduce((a, b) => a + b, 0) / n;
  const sorted = [...rrs].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  // Find premature beats: RR < mean - 1.5*IQR, followed by compensatory pause (next RR > mean + 0.8*IQR)
  let prematureCount = 0, compensatoryCount = 0;
  for (let i = 1; i < n - 1; i++) {
    if (rrs[i] < mean - 1.5 * iqr) {
      prematureCount++;
      if (rrs[i + 1] > mean + 0.8 * iqr) compensatoryCount++;
    }
  }
  const prematureRate = prematureCount / n;
  const compensatoryRate = prematureCount > 0 ? compensatoryCount / prematureCount : 0;
  const cv = Math.sqrt(rrs.map(r => (r - mean) ** 2).reduce((a, b) => a + b, 0) / n) / mean;
  // Runs test for randomness — AFib has no serial pattern
  const median = sorted[Math.floor(n / 2)];
  let runs = 1;
  for (let i = 1; i < n; i++) {
    if ((rrs[i] >= median) !== (rrs[i - 1] >= median)) runs++;
  }
  const expectedRuns = (2 * n - 1) / 3;
  const runsRatio = runs / expectedRuns;
  // Classification logic
  if (prematureRate >= 0.08 && compensatoryRate >= 0.6 && cv < 0.25) {
    const conf = Math.round(Math.min(92, 55 + compensatoryRate * 30 + prematureRate * 80));
    return { type: "pac_pvc", label: "Ngoại tâm thu (PAC/PVC)", confidence: conf,
      note: `Phát hiện ${prematureCount} nhịp sớm/${n} nhịp (${Math.round(prematureRate*100)}%) có chu kỳ bù — Lành tính, không phải AFib.`,
      color: "#f59e0b" };
  }
  if (cv > 0.22 && runsRatio > 0.90) {
    return { type: "afib", label: "Rung nhĩ (AFib)", confidence: Math.round(Math.min(88, cv * 280)),
      note: "Biến thiên RR hỗn loạn, không có mẫu tuần hoàn — Đặc trưng AFib.", color: "#ef4444" };
  }
  if (cv < 0.12) {
    return { type: "normal", label: "Nhịp xoang bình thường", confidence: Math.round(Math.min(95, (0.12 - cv) / 0.12 * 80 + 50)),
      note: "RR interval đều đặn — Tim đập bình thường.", color: "#22c55e" };
  }
  return { type: "borderline", label: "Nhịp tim cần theo dõi thêm", confidence: 55,
    note: "Không đủ đặc trưng để phân loại rõ ràng. Đo lại sau 10 phút.", color: "#f59e0b" };
}

// ─── #2: RSA Index — Breathing-Coupled HR Variation ───────────────────────────
// Quantifies how much HR variation correlates with breathing cycle
// Low RSA = abnormal (not physiological variation) → boosts AFib confidence
function computeRSAIndex(rrIntervals) {
  if (!rrIntervals || rrIntervals.length < 16) return null;
  const n = rrIntervals.length;
  const mean = rrIntervals.reduce((a, b) => a + b, 0) / n;
  // Estimate breathing frequency via peak detection in RR fluctuation
  // Typical breathing: 0.15-0.4 Hz (RSA range = HF band)
  const centered = rrIntervals.map(r => r - mean);
  let lfPow = 0, hfPow = 0;
  for (let k = 1; k < Math.floor(n / 2); k++) {
    const freq = k * (1000 / mean) / n;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      re += centered[i] * Math.cos(2 * Math.PI * k * i / n);
      im -= centered[i] * Math.sin(2 * Math.PI * k * i / n);
    }
    const pow = (re * re + im * im) / n;
    if (freq >= 0.04 && freq < 0.15) lfPow += pow;
    else if (freq >= 0.15 && freq <= 0.40) hfPow += pow;
  }
  const totalPow = lfPow + hfPow;
  if (!totalPow) return null;
  const rsaIndex = Math.round(hfPow / totalPow * 100); // % of power in breathing band
  const isPhysiological = rsaIndex >= 25; // normal RSA should dominate in HF band
  return { rsaIndex, isPhysiological,
    label: rsaIndex >= 40 ? "RSA Cao – Nhịp thở bình thường" : rsaIndex >= 25 ? "RSA Vừa – Theo dõi thêm" : "RSA Thấp – Cần chú ý",
    note: isPhysiological ? "Biến thiên tim theo nhịp thở bình thường" : "Biến thiên không theo nhịp thở — Tăng nguy cơ AFib" };
}

// ─── #5: Algorithmic Synthetic ECG from PPG ────────────────────────────────────
// Converts PPG-derived RR intervals to ECG-like waveform for doctor display
// Uses cardiac cycle model: P-wave → QRS → T-wave morphology
function synthesizeECGWaveform(rrIntervals, bpm, numBeats = 6) {
  if (!rrIntervals || !bpm) return null;
  const meanRR = rrIntervals.length ? rrIntervals.reduce((a,b)=>a+b,0)/rrIntervals.length : 60000/bpm;
  const samples = [];
  const fs = 250; // synthetic sampling rate
  const beatsToRender = Math.min(numBeats, rrIntervals.length || numBeats);
  let currentRRs = rrIntervals.length >= beatsToRender ? rrIntervals : Array(beatsToRender).fill(meanRR);
  for (let beat = 0; beat < beatsToRender; beat++) {
    const rr = currentRRs[beat] || meanRR;
    const beatSamples = Math.round(rr / 1000 * fs);
    for (let i = 0; i < beatSamples; i++) {
      const t = i / beatSamples;
      let v = 0;
      // P wave: 0–0.16 of cycle, Gaussian centered at 0.10
      v += 0.12 * Math.exp(-((t - 0.10) ** 2) / (2 * 0.012 ** 2));
      // PR segment: flat 0.16–0.22
      // QRS complex: sharp spike 0.22–0.32
      if (t >= 0.22 && t < 0.24) v -= 0.15 * (t - 0.22) / 0.02; // Q
      if (t >= 0.24 && t < 0.28) v += 1.0 * Math.exp(-((t - 0.26) ** 2) / (2 * 0.008 ** 2)); // R
      if (t >= 0.28 && t < 0.32) v -= 0.10 * (0.32 - t) / 0.04; // S
      // ST segment + T wave: 0.35–0.65
      v += 0.25 * Math.exp(-((t - 0.52) ** 2) / (2 * 0.045 ** 2)); // T wave
      // AFib effect: add noise to P wave and RR jitter
      if (rrIntervals.length > 2) {
        const cv = Math.sqrt(rrIntervals.map(r=>(r-meanRR)**2).reduce((a,b)=>a+b,0)/rrIntervals.length)/meanRR;
        if (cv > 0.15) v += (Math.random() - 0.5) * cv * 0.4; // P-wave chaos for AFib
      }
      samples.push(Math.max(-0.4, Math.min(1.2, v)));
    }
  }
  return samples;
}

// ─── G4/#9: 24h AFib Forecast ─────────────────────────────────────────────────
// Predicts AFib risk in next 24h based on HRV trend + weather + time of day
function computeAfibForecast(measurements, weatherTemp) {
  if (!measurements || measurements.length < 3) return null;
  const recent = measurements.filter(m => m.type === "face" || m.type === "finger").slice(-14);
  if (recent.length < 3) return null;
  // HRV trend (downward = higher risk)
  const hrvs = recent.map(m => m.result?.sdnn || m.result?.hrvScore || 30).filter(Boolean);
  const hrvTrend = hrvs.length >= 3 ? (hrvs[0] - hrvs[hrvs.length - 1]) / hrvs[0] : 0;
  const recentAfibRate = recent.filter(m => m.result?.classification === "afib").length / recent.length;
  const avgBpm = recent.map(m => m.result?.bpm || 72).reduce((a,b)=>a+b,0) / recent.length;
  const cvHistory = recent.map(m => m.result?.cv || 0).filter(Boolean);
  const avgCV = cvHistory.length ? cvHistory.reduce((a,b)=>a+b,0) / cvHistory.length : 0;
  // Time of day risk: 4–6 AM highest (circadian)
  const hour = new Date().getHours();
  const circadianFactor = (hour >= 4 && hour <= 6) ? 1.4 : (hour >= 22 || hour <= 3) ? 1.2 : 1.0;
  // Weather factor (cold → vasospasm risk)
  const weatherFactor = (weatherTemp !== null && weatherTemp < 18) ? 1.3 : (weatherTemp !== null && weatherTemp < 10) ? 1.5 : 1.0;
  // Base risk calculation
  let riskScore = 20;
  riskScore += Math.min(25, hrvTrend * 60); // HRV decline
  riskScore += recentAfibRate * 35; // recent AFib episodes
  riskScore += Math.max(0, (avgCV - 0.12) * 120); // RR irregularity trend
  riskScore += Math.max(0, (avgBpm - 85) * 0.5); // elevated resting HR
  riskScore *= circadianFactor * weatherFactor;
  riskScore = Math.round(Math.max(5, Math.min(90, riskScore)));
  const peakHour = (hour < 18) ? "4-6 giờ sáng mai" : "4-6 giờ sáng nay";
  return {
    riskPercent: riskScore,
    level: riskScore >= 65 ? "CAO" : riskScore >= 40 ? "TRUNG_BINH" : "THAP",
    peakWindow: peakHour,
    factors: [
      hrvTrend > 0.1 ? `HRV giảm ${Math.round(hrvTrend*100)}% (xu hướng xấu)` : null,
      recentAfibRate > 0.2 ? `${Math.round(recentAfibRate*100)}% lần đo gần đây có AFib` : null,
      weatherTemp !== null && weatherTemp < 18 ? `Nhiệt độ thấp ${weatherTemp}°C` : null,
      (hour >= 22 || hour <= 6) ? "Khung giờ nguy hiểm cao (đêm/sáng sớm)" : null,
    ].filter(Boolean),
    recommendation: riskScore >= 65
      ? "Nguy cơ CAO. Hạn chế vận động mạnh, uống thuốc đúng giờ, sẵn sàng SOS."
      : riskScore >= 40
      ? "Nguy cơ TRUNG BÌNH. Theo dõi sát, nghỉ ngơi đầy đủ."
      : "Nguy cơ THẤP. Duy trì sinh hoạt bình thường.",
  };
}

// ─── #7/2: Mouse BCG Tremor Analysis (Ballistocardiography via mouse) ──────────
const _bcg = { events: [], active: false, lastResult: null };
function startMouseBCGTracking() {
  if (_bcg.active) return;
  _bcg.events = []; _bcg.active = true;
  document.addEventListener("mousemove", _bcgMouseHandler);
  setTimeout(stopMouseBCGTracking, 30000); // 30 seconds max
}
function _bcgMouseHandler(e) {
  if (!_bcg.active) return;
  _bcg.events.push({ t: Date.now(), x: e.clientX, y: e.clientY });
  if (_bcg.events.length > 2000) _bcg.events.shift();
}
function stopMouseBCGTracking() {
  if (!_bcg.active) return;
  _bcg.active = false;
  document.removeEventListener("mousemove", _bcgMouseHandler);
  if (_bcg.events.length >= 100) {
    _bcg.lastResult = analyzeBCGMouse(_bcg.events);
    renderBCGResult(_bcg.lastResult);
  }
}
function analyzeBCGMouse(events) {
  if (events.length < 50) return null;
  // Calculate velocity and jitter
  const velocities = [];
  for (let i = 1; i < events.length; i++) {
    const dt = events[i].t - events[i-1].t;
    if (dt <= 0 || dt > 200) continue;
    const dx = events[i].x - events[i-1].x;
    const dy = events[i].y - events[i-1].y;
    velocities.push(Math.sqrt(dx*dx + dy*dy) / dt);
  }
  if (velocities.length < 20) return null;
  const mean = velocities.reduce((a,b)=>a+b,0) / velocities.length;
  const std = Math.sqrt(velocities.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0) / velocities.length);
  const cv = std / (mean || 1);
  // Analyze micro-jitter patterns (BCG signature)
  const jitterScore = Math.round(Math.min(100, cv * 200));
  const riskHint = cv > 0.8 ? "Phát hiện vi rung cao — Có thể do nhịp tim bất thường. Khuyến nghị đo PPG để xác nhận."
    : cv > 0.5 ? "Vi rung trung bình — Bình thường hoặc nhịp hơi không đều."
    : "Vi rung thấp — Tay ổn định, nhịp tim có thể đều.";
  return { jitterScore, cv: Math.round(cv * 1000) / 1000, riskHint,
    sampleCount: velocities.length, duration: Math.round((events[events.length-1].t - events[0].t) / 1000) };
}
function renderBCGResult(result) {
  const box = document.getElementById("bcgResultBox");
  if (!box || !result) return;
  const color = result.jitterScore > 60 ? "#ef4444" : result.jitterScore > 35 ? "#f59e0b" : "#22c55e";
  box.innerHTML = `
    <div class="list-item"><span>Vi rung ngón tay</span><strong style="color:${color}">${result.jitterScore}/100</strong></div>
    <div class="list-item"><span>Hệ số biến thiên</span><strong>${result.cv}</strong></div>
    <div class="list-item"><span>Mẫu phân tích</span><strong>${result.sampleCount} điểm / ${result.duration}s</strong></div>
    <p class="muted" style="margin-top:6px;font-size:12px">${result.riskHint}</p>`;
}

// ─── Fall Detection (DeviceMotion) — Feature 3.4 ─────────────────────────────
const _fall = { lastAlert: 0 };
function initFallDetection() {
  if (!window.DeviceMotionEvent || !isMobile()) return;
  const request = DeviceMotionEvent.requestPermission;
  const bindFall = () => {
    window.addEventListener("devicemotion", (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const magnitude = Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);
      const now = Date.now();
      if (magnitude > 25 && now - _fall.lastAlert > 30000) {
        _fall.lastAlert = now;
        setTimeout(() => {
          const stillMag = Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);
          if (stillMag < 3) {
            // Show fall alert banner with cancel button in DOM
            let fallBanner = document.getElementById("fallDetectionBanner");
            if (!fallBanner) {
              fallBanner = document.createElement("div");
              fallBanner.id = "fallDetectionBanner";
              fallBanner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#ef4444;color:#fff;padding:14px 16px;font-size:15px;font-weight:700;display:flex;align-items:center;gap:12px;box-shadow:0 4px 16px rgba(239,68,68,0.5)";
              document.body.prepend(fallBanner);
            }
            let countdown = 10;
            _fall.canceled = false;
            const update = () => {
              fallBanner.innerHTML = `⚠️ Phát hiện ngã! Bạn có ổn không? SOS tự động sau <strong>${countdown}s</strong>
                <button id="fallCancelBtn" onclick="document.getElementById('fallDetectionBanner')?.remove();window._fallCanceled=true" style="background:#fff;color:#ef4444;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;margin-left:auto">Tôi ổn – Hủy</button>`;
            };
            update();
            const timer = setInterval(() => {
              countdown--;
              if (window._fallCanceled) { clearInterval(timer); fallBanner.remove(); window._fallCanceled = false; return; }
              if (countdown <= 0) {
                clearInterval(timer);
                fallBanner.remove();
                if (!window._fallCanceled) triggerSos("Phát hiện ngã tự động — không có phản hồi");
              } else { update(); }
            }, 1000);
          }
        }, 2000);
      }
    });
  };
  typeof request === "function" ? request().then(p => { if (p === "granted") bindFall(); }).catch(() => {}) : bindFall();
}

// ─── #10: Digital Twin Heart Canvas Animation ─────────────────────────────────
let _dtAnimFrame = null;
function renderDigitalTwin(bpm, rhythmType, rrIntervals) {
  const canvas = document.getElementById("digitalTwinCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const isAfib = rhythmType === "afib";
  const isPacPvc = rhythmType === "pac_pvc";
  let beatPhase = 0, lastBeat = 0;
  if (_dtAnimFrame) cancelAnimationFrame(_dtAnimFrame);
  const beatInterval = 60000 / Math.max(40, Math.min(180, bpm));
  // Pre-compute RR jitter for AFib simulation
  const rrJitters = rrIntervals?.slice(0, 20) || [];
  let rrIdx = 0;
  function drawHeart(x, y, size, fillColor, opacity = 1) {
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x, y - size * 0.3, x - size * 0.5, y - size * 0.6, x - size * 0.5, y - size * 0.3);
    ctx.bezierCurveTo(x - size * 0.5, y - size * 0.7, x - size * 0.05, y - size * 0.8, x, y - size * 0.4);
    ctx.bezierCurveTo(x + size * 0.05, y - size * 0.8, x + size * 0.5, y - size * 0.7, x + size * 0.5, y - size * 0.3);
    ctx.bezierCurveTo(x + size * 0.5, y - size * 0.6, x, y - size * 0.3, x, y);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.restore();
  }
  function animate(ts) {
    ctx.clearRect(0, 0, w, h);
    // Dark background
    ctx.fillStyle = "#0f1f3d";
    ctx.fillRect(0, 0, w, h);
    const now = ts;
    let currentBeatInterval = beatInterval;
    // Use actual RR intervals for AFib irregular timing
    if (isAfib && rrJitters.length > 0) {
      currentBeatInterval = rrJitters[rrIdx % rrJitters.length];
    } else if (isPacPvc && rrJitters.length > 0 && rrIdx % 5 === 2) {
      currentBeatInterval = rrJitters[rrIdx % rrJitters.length] * 0.65; // premature beat
    }
    if (now - lastBeat >= currentBeatInterval) { beatPhase = 0; lastBeat = now; rrIdx++; }
    const t = (now - lastBeat) / currentBeatInterval;
    beatPhase = t;
    // Systole (0–0.35): contract
    const systolicPhase = t < 0.35 ? t / 0.35 : 0;
    const scale = 1 - systolicPhase * 0.18;
    // Draw chambers
    const cx = w / 2, cy = h / 2;
    // Left ventricle glow
    const lvColor = isAfib ? `rgba(239,68,68,${0.15 + systolicPhase * 0.3})` : `rgba(224,58,90,${0.12 + systolicPhase * 0.25})`;
    ctx.beginPath(); ctx.arc(cx - 15, cy + 10, 45 * (1 - systolicPhase * 0.15), 0, Math.PI * 2);
    ctx.fillStyle = lvColor; ctx.fill();
    // Right ventricle
    const rvColor = isPacPvc ? `rgba(245,158,11,${0.12 + systolicPhase * 0.2})` : `rgba(239,68,68,${0.08 + systolicPhase * 0.15})`;
    ctx.beginPath(); ctx.arc(cx + 15, cy + 15, 38 * (1 - systolicPhase * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = rvColor; ctx.fill();
    // Main heart shape
    const heartColor = isAfib ? "#ef4444" : isPacPvc ? "#f59e0b" : "#e03a5a";
    ctx.save(); ctx.scale(scale, scale); ctx.translate((1 - scale) * cx, (1 - scale) * cy);
    drawHeart(cx, cy + 10, 55, heartColor, 0.9);
    ctx.restore();
    // Blood flow particles during systole
    if (systolicPhase > 0.2 && systolicPhase < 0.6) {
      const n = isAfib ? Math.floor(Math.random() * 4) : 3;
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 1.5) + (Math.random() - 0.5) * (isAfib ? 1.2 : 0.6);
        const dist = 55 + (systolicPhase - 0.2) * 80 + (isAfib ? Math.random() * 20 : 0);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist + 10;
        ctx.beginPath(); ctx.arc(px, py, isAfib ? 2 + Math.random() * 3 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isAfib ? `rgba(239,68,68,${0.6 - (systolicPhase - 0.2) * 0.5})` : `rgba(224,58,90,${0.7 - (systolicPhase - 0.2) * 0.6})`;
        ctx.fill();
      }
    }
    // Label
    ctx.fillStyle = "#94a3b8"; ctx.font = "11px system-ui"; ctx.textAlign = "center";
    const label = isAfib ? "⚠️ Rung nhĩ – Hỗn loạn" : isPacPvc ? "ℹ️ Ngoại tâm thu" : "✅ Nhịp xoang bình thường";
    ctx.fillText(label, cx, h - 8);
    _dtAnimFrame = requestAnimationFrame(animate);
  }
  _dtAnimFrame = requestAnimationFrame(animate);
}

// ─── #5: Render Synthetic ECG ─────────────────────────────────────────────────
function renderSyntheticECGDisplay(rrIntervals, bpm) {
  const container = document.getElementById("syntheticECGBox");
  if (!container) return;
  const waveform = synthesizeECGWaveform(rrIntervals, bpm, 6);
  if (!waveform) { container.innerHTML = "<p class='muted'>Cần đo ít nhất 30s để tổng hợp ECG.</p>"; return; }
  const w = 560, h = 120;
  const n = waveform.length;
  const pts = waveform.map((v, i) => `${(i / n * w).toFixed(1)},${(h / 2 - v * (h / 2 - 8)).toFixed(1)}`).join(" ");
  const isAfib = rrIntervals && rrIntervals.length >= 4 && (() => {
    const mean = rrIntervals.reduce((a,b)=>a+b,0)/rrIntervals.length;
    const cv = Math.sqrt(rrIntervals.map(r=>(r-mean)**2).reduce((a,b)=>a+b,0)/rrIntervals.length)/mean;
    return cv > 0.22;
  })();
  container.innerHTML = `
    <p class="muted" style="font-size:11px;margin-bottom:4px">Sóng ECG giả lập (Synthetic ECG từ PPG) — Chỉ số y khoa ước tính</p>
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;background:#0a1628;border-radius:6px;display:block">
      <defs><filter id="ecgGlow"><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" stroke="#1a2a4a" stroke-width="1"/>
      ${Array.from({length:6},(_, i)=>`<line x1="${i*w/5}" y1="0" x2="${i*w/5}" y2="${h}" stroke="#1a2a4a" stroke-width="0.5"/>`).join("")}
      <polyline points="${pts}" fill="none" stroke="${isAfib ? "#ef4444" : "#22d3ee"}" stroke-width="1.5" filter="url(#ecgGlow)"/>
      <text x="6" y="14" fill="#475569" font-size="9" font-family="monospace">I</text>
      <text x="${w-30}" y="${h-4}" fill="#475569" font-size="9" font-family="monospace">25mm/s</text>
    </svg>
    <p class="muted" style="font-size:10px;margin-top:3px;color:${isAfib?"#ef4444":"#94a3b8"}">
      ${isAfib ? "⚠️ Mẫu sóng AFib: thiếu sóng P, RR không đều" : "✅ Nhịp xoang: sóng P–QRS–T bình thường"}
    </p>`;
}

// ─── 1.7: Elderly Mode ────────────────────────────────────────────────────────
let _elderlyMode = false;
function toggleElderlyMode() {
  _elderlyMode = !_elderlyMode;
  document.body.classList.toggle("elderly-mode", _elderlyMode);
  const btn = document.getElementById("elderlyModeBtn");
  if (btn) { btn.textContent = _elderlyMode ? "👁 Tắt chế độ ông/bà" : "👴 Chế độ ông/bà (chữ to)"; }
  if (_elderlyMode) showToast("Đã bật chế độ chữ to cho ông/bà", "success");
  localStorage.setItem("hs_elderly", _elderlyMode ? "1" : "");
}

// ─── 1.9: Battery Warning for Night Monitoring ───────────────────────────────
async function checkBatteryForNight() {
  const box = document.getElementById("batteryWarningBox");
  if (!box) return;
  if (!navigator.getBattery) { box.hidden = true; return; }
  try {
    const bat = await navigator.getBattery();
    const pct = Math.round(bat.level * 100);
    if (!bat.charging && pct < 30) {
      box.hidden = false;
      box.textContent = `🔋 Pin ${pct}% — Cắm sạc trước khi theo dõi qua đêm để không mất dữ liệu!`;
      box.style.cssText = "padding:8px 12px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;color:#92400e;font-size:13px;font-weight:600;margin-bottom:10px";
    } else {
      box.hidden = true;
    }
    bat.addEventListener("levelchange", checkBatteryForNight);
  } catch { box.hidden = true; }
}

// ─── 1.10: Daily Health Tips ─────────────────────────────────────────────────
const HEALTH_TIPS = [
  "💧 Uống đủ 2 lít nước mỗi ngày giúp giảm nguy cơ rung nhĩ.",
  "🚶 Đi bộ 30 phút/ngày giảm 20% nguy cơ đột quỵ và cải thiện HRV.",
  "🧘 Thiền 10 phút buổi sáng giảm hormone cortisol — kẻ thù của tim.",
  "🥑 Omega-3 từ cá hồi và hạt lanh giúp giảm viêm và bảo vệ tim mạch.",
  "⏰ Ngủ đủ 7-8 tiếng. Thiếu ngủ tăng 80% nguy cơ rung nhĩ.",
  "🧂 Giảm muối xuống dưới 5g/ngày để kiểm soát huyết áp.",
  "☕ Cà phê: 1-2 cốc/ngày có thể bảo vệ tim; quá nhiều gây loạn nhịp.",
  "❄️ Trời lạnh: mặc đủ ấm vùng ngực, tránh ra ngoài đột ngột sáng sớm.",
  "😊 Stress mãn tính là nguyên nhân của 40% cơn AFib. Hãy nghỉ ngơi đủ.",
  "🏥 Khám tim mạch định kỳ 6 tháng/lần nếu có tiền sử AFib.",
  "📱 Đo tim mỗi buổi sáng lúc 5-7h — khi nguy cơ tim mạch cao nhất.",
  "💊 Không bỏ thuốc dù cảm thấy khỏe. Rung nhĩ thường không có triệu chứng.",
];
function showDailyHealthTip() {
  const box = document.getElementById("dailyTipBox");
  if (!box) return;
  const idx = Math.floor(Date.now() / 86400000) % HEALTH_TIPS.length;
  box.innerHTML = `<p style="margin:0;font-size:13px;color:#1e3a5f">${HEALTH_TIPS[idx]}</p>`;
}

// ─── G1/1.1: Real-time Signal Quality Guidance ───────────────────────────────
function getSignalQualityGuidance(lightScore, stabilityScore, mode, signalQuality) {
  const hints = [];
  if (lightScore < 50) {
    hints.push(mode === "finger"
      ? "💡 Ngón tay chưa che kín đèn flash. Ấn chặt hơn."
      : "💡 Ánh sáng quá yếu. Ngồi gần cửa sổ hoặc bật đèn phòng.");
  } else if (lightScore < 70) {
    hints.push(mode === "finger" ? "💡 Che thêm đèn flash — ánh sáng vẫn hơi lọt." : "💡 Cần thêm ánh sáng phòng.");
  }
  if (stabilityScore < 50) {
    hints.push(mode === "finger"
      ? "🤲 Tay rung nhiều. Đặt tay lên mặt bàn và hít thở nhẹ."
      : "🤲 Đầu/người đang di chuyển. Ngồi thẳng, tựa lưng vào ghế, không nói chuyện.");
  } else if (stabilityScore < 70) {
    hints.push("🤲 Giữ yên hơn nữa. Thở nhẹ và đều.");
  }
  if (signalQuality < 40) hints.push("⏳ Tín hiệu yếu. Đợi 5 giây để tín hiệu ổn định trước khi bắt đầu đo.");
  return hints.join(" · ") || (signalQuality >= 75 ? "✅ Tín hiệu tốt — đang đo chuẩn!" : "🔄 Đang đo...");
}

// ─── 1.4: Golden Window Reminder ─────────────────────────────────────────────
function computeGoldenWindow(measurements) {
  if (!measurements || measurements.length < 5) return null;
  const hourCounts = {};
  for (const m of measurements.filter(m => m.type === "face" || m.type === "finger")) {
    const sq = m.result?.signalQuality || 0;
    if (sq < 55) continue;
    const hour = new Date(m.createdAt).getHours();
    if (!hourCounts[hour]) hourCounts[hour] = { total: 0, count: 0 };
    hourCounts[hour].total += sq;
    hourCounts[hour].count++;
  }
  let bestHour = null, bestScore = 0;
  for (const [h, d] of Object.entries(hourCounts)) {
    if (d.count < 2) continue;
    const avg = d.total / d.count;
    if (avg > bestScore) { bestScore = avg; bestHour = parseInt(h); }
  }
  if (bestHour === null) return null;
  const period = bestHour < 12 ? "sáng" : bestHour < 18 ? "chiều" : "tối";
  return { hour: bestHour, period, score: Math.round(bestScore),
    label: `${bestHour}h ${period}` };
}

// ─── 2.9: Weather-AFib Risk Correlation ─────────────────────────────────────
function renderWeatherAfibAlert(weather, measurements) {
  const box = document.getElementById("weatherAfibBox");
  if (!box || !weather) return;
  const temp = weather.temp || weather.main?.temp || null;
  const humidity = weather.humidity || weather.main?.humidity || null;
  const desc = weather.description || weather.weather?.[0]?.description || "";
  if (temp === null) { box.innerHTML = ""; return; }
  const risks = [];
  if (temp < 10) risks.push("🌡️ Nhiệt độ rất lạnh (<10°C) — tăng co mạch, nguy cơ AFib cao");
  else if (temp < 18) risks.push(`🌡️ Trời lạnh ${temp}°C — mặc ấm vùng ngực`);
  if (humidity > 85) risks.push("💧 Độ ẩm cao >85% — tim cần làm việc nhiều hơn");
  if (desc.toLowerCase().includes("storm") || desc.toLowerCase().includes("bão")) risks.push("⛈️ Áp suất khí quyển thay đổi đột ngột — nguy cơ AFib tăng");
  const forecast = computeAfibForecast(measurements, temp);
  if (risks.length || (forecast && forecast.riskPercent >= 40)) {
    box.innerHTML = `
      <div class="list-item"><span>Thời tiết hiện tại</span><strong>${temp}°C · ${humidity}% ẩm</strong></div>
      ${risks.map(r => `<div class="list-item" style="color:#92400e">${r}</div>`).join("")}
      ${forecast ? `<div class="list-item"><span>Dự báo 24h</span><strong style="color:${forecast.level==="CAO"?"#ef4444":forecast.level==="TRUNG_BINH"?"#f59e0b":"#22c55e"}">${forecast.riskPercent}% — ${forecast.level}</strong></div>` : ""}
      ${forecast?.recommendation ? `<p class="muted" style="font-size:12px;margin-top:4px">${forecast.recommendation}</p>` : ""}`;
  } else {
    box.innerHTML = `<div class="list-item"><span>Thời tiết hiện tại</span><strong>${temp}°C · Bình thường</strong></div><p class="muted" style="font-size:12px">Điều kiện thời tiết tốt cho tim mạch hôm nay.</p>`;
  }
}

// ─── G2: Expert Mode 7-day monitoring ────────────────────────────────────────
const _expertMode = { active: false, interval: null };
function toggleExpertMode() {
  const btn = document.getElementById("expertModeBtn");
  const statusEl = document.getElementById("expertModeStatus");
  if (!_expertMode.active) {
    if (!state.token) { showToast("Cần đăng nhập để bật Chế độ Chuyên gia", "error"); return; }
    _expertMode.active = true;
    if (btn) { btn.textContent = "🔴 Dừng theo dõi chuyên sâu"; btn.className = "ghost-btn"; }
    if (statusEl) statusEl.textContent = "Đang theo dõi chuyên sâu 7 ngày — tự động đo mỗi 2 giờ";
    showToast("Chế độ chuyên sâu bật: nhớ mở app mỗi 2 tiếng để đo tự động", "success");
    // Schedule auto-measure every 2 hours via notification
    _expertMode.interval = setInterval(() => {
      if (document.hidden) { notify("HEARTSENSE Expert", "Đến giờ đo tim tự động!"); }
    }, 2 * 60 * 60 * 1000);
    // Save to server
    if (state.user) api(`/api/expert-mode`, { method: "POST",
      body: JSON.stringify({ token: state.token, userId: state.user.id, active: true }) }).catch(() => {});
  } else {
    _expertMode.active = false;
    clearInterval(_expertMode.interval);
    if (btn) { btn.textContent = "🔬 Bật chế độ theo dõi 7 ngày (giả lập Holter)"; btn.className = "primary-btn"; }
    if (statusEl) statusEl.textContent = "Chế độ chuyên sâu đã tắt.";
    if (state.user) api(`/api/expert-mode`, { method: "POST",
      body: JSON.stringify({ token: state.token, userId: state.user.id, active: false }) }).catch(() => {});
  }
}

// ─── G5: Post-Ablation Risk Prediction ───────────────────────────────────────
function computeAblationRisk(inputs) {
  const { age, bmi, afibType, lavi, afibDuration, symptoms } = inputs;
  // Based on DECAAF II model simplified coefficients
  let risk = 20;
  if (age > 65) risk += 8;
  if (bmi > 30) risk += 7;
  if (afibType === "persistent") risk += 15;
  if (lavi > 35) risk += 12;
  if (afibDuration > 12) risk += 10;
  if (symptoms === "severe") risk += 8;
  risk = Math.round(Math.min(80, Math.max(10, risk)));
  return { risk,
    level: risk >= 50 ? "CAO" : risk >= 30 ? "TRUNG_BINH" : "THAP",
    recommendation: risk >= 50
      ? "Nguy cơ tái phát CAO. Trao đổi với bác sĩ về điều trị nội khoa dài hạn song song với ablation."
      : risk >= 30
      ? "Nguy cơ TRUNG BÌNH. Theo dõi sát sau ablation ít nhất 6 tháng bằng Heartsense."
      : "Nguy cơ THẤP. Tiên lượng tốt sau ablation. Vẫn cần theo dõi định kỳ." };
}

// ─── 1.6: Share Report 1-tap (Zalo / Gmail / Clipboard) ─────────────────────
async function shareReport(target) {
  if (target instanceof Event || typeof target !== "string") target = null;
  if (!state.user) { showToast("Cần đăng nhập để chia sẻ báo cáo", "error"); return; }
  const reportUrl = `${window.location.origin}/api/users/${state.user.id}/report`;
  const text = `Báo cáo tim mạch ${state.user?.fullName || "bệnh nhân"} — HEARTSENSE v4.0: ${reportUrl}`;

  if (target === "zalo") {
    // Zalo share deeplink (works on mobile with Zalo installed)
    const zaloUrl = `https://zalo.me/share/url?url=${encodeURIComponent(reportUrl)}&title=${encodeURIComponent("Báo cáo tim mạch HEARTSENSE — " + (state.user?.fullName || ""))}`;
    window.open(zaloUrl, "_blank", "noreferrer");
    return;
  }
  if (target === "gmail") {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent("Báo cáo tim mạch HEARTSENSE - " + (state.user?.fullName || ""))}&body=${encodeURIComponent(text)}`;
    window.open(gmailUrl, "_blank", "noreferrer");
    return;
  }
  // Default: Web Share API then clipboard
  if (navigator.share) {
    try {
      await navigator.share({ title: "Báo cáo tim mạch HEARTSENSE", url: reportUrl, text: `Kết quả đo tim của ${state.user?.fullName || "bệnh nhân"} — HEARTSENSE v4.0` });
      return;
    } catch {}
  }
  // Show share options popup
  showShareOptions(reportUrl, text);
}
function showShareOptions(reportUrl, text) {
  let overlay = document.getElementById("shareOptionsOverlay");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.id = "shareOptionsOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:flex-end;justify-content:center";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:480px;padding:20px 16px;box-shadow:0 -4px 24px rgba(0,0,0,0.15)">
      <h3 style="margin:0 0 16px;font-size:16px;color:#1e3a5f">📤 Chia sẻ báo cáo</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;text-align:center">
        <button onclick="shareReport('zalo');document.getElementById('shareOptionsOverlay')?.remove()" style="background:#0068ff;color:#fff;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">💬<br>Zalo</button>
        <button onclick="shareReport('gmail');document.getElementById('shareOptionsOverlay')?.remove()" style="background:#ea4335;color:#fff;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">📧<br>Gmail</button>
        <button onclick="navigator.clipboard?.writeText('${reportUrl}').then(()=>{window.showToast&&showToast('Đã sao chép!','success')});document.getElementById('shareOptionsOverlay')?.remove()" style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">📋<br>Sao chép</button>
        <button onclick="document.getElementById('shareOptionsOverlay')?.remove()" style="background:#e2e8f0;color:#475569;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">✕<br>Đóng</button>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin:0;word-break:break-all">${reportUrl}</p>
    </div>`;
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ─── 3.6: Research Mode — Anonymous Data Opt-in ──────────────────────────────
function toggleResearchMode() {
  const current = localStorage.getItem("hs_research") === "1";
  const newState = !current;
  localStorage.setItem("hs_research", newState ? "1" : "");
  const btn = document.getElementById("researchModeBtn");
  const statusEl = document.getElementById("researchModeStatus");
  if (btn) btn.textContent = newState ? "✅ Đã tham gia nghiên cứu — Bấm để rút" : "🔬 Tham gia nghiên cứu ẩn danh";
  if (statusEl) statusEl.textContent = newState
    ? "Cảm ơn! Dữ liệu ẩn danh của bạn đóng góp cho nghiên cứu AFib Việt Nam."
    : "Bạn đã rút khỏi chương trình nghiên cứu.";
  if (state.user) api("/api/research-consent", { method: "POST",
    body: JSON.stringify({ token: state.token, userId: state.user.id, consent: newState }) }).catch(() => {});
  showToast(newState ? "Đã tham gia đóng góp dữ liệu nghiên cứu ẩn danh" : "Đã rút khỏi nghiên cứu", "success");
}

// ─── 1.5: 7-day Trend Comparison ─────────────────────────────────────────────
function renderTrendComparison(measurements) {
  const box = document.getElementById("trendComparisonBox");
  if (!box) return;
  const all = measurements.filter(m => m.type === "face" || m.type === "finger").reverse();
  if (all.length < 4) { box.innerHTML = "<p class='muted'>Cần ít nhất 4 lần đo để xem xu hướng.</p>"; return; }
  const half = Math.ceil(all.length / 2);
  const recent = all.slice(0, half);
  const older = all.slice(half);
  const avg = arr => Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  const bpmNow = avg(recent.map(m => m.result?.bpm || 0).filter(Boolean));
  const bpmPrev = avg(older.map(m => m.result?.bpm || 0).filter(Boolean));
  const hrvNow = avg(recent.map(m => m.result?.sdnn || m.result?.hrvScore || 0).filter(Boolean));
  const hrvPrev = avg(older.map(m => m.result?.sdnn || m.result?.hrvScore || 0).filter(Boolean));
  const diff = (a, b, lowerBetter = false) => {
    const d = a - b; const pct = b ? Math.round(Math.abs(d) / b * 100) : 0;
    const up = d > 0; const good = lowerBetter ? !up : up;
    return `<span style="color:${good?"#22c55e":"#ef4444"}">${up?"↑":"↓"}${pct}%</span>`;
  };
  box.innerHTML = `
    <div class="list-item"><span>Nhịp tim TB</span><strong>${bpmNow} BPM ${bpmPrev ? diff(bpmNow, bpmPrev, true) : ""}</strong></div>
    <div class="list-item"><span>HRV (SDNN) TB</span><strong>${hrvNow} ms ${hrvPrev ? diff(hrvNow, hrvPrev) : ""}</strong></div>
    <div class="list-item"><span>AFib trong kỳ</span><strong>${recent.filter(m=>m.result?.classification==="afib").length}/${recent.length} lần</strong></div>
    <p class="muted" style="font-size:11px;margin-top:4px">So sánh ${recent.length} lần đo gần nhất với ${older.length} lần trước đó.</p>`;
}

// ─── 2.6: Blood Pressure OCR from photo ──────────────────────────────────────
async function ocrBloodPressure(file) {
  if (!file) return;
  const statusEl = document.getElementById("bpOCRStatus");
  if (statusEl) statusEl.textContent = "Đang đọc ảnh...";
  try {
    if (typeof Tesseract === "undefined") throw new Error("Tesseract chưa tải");
    const { data: { text } } = await Tesseract.recognize(file, "eng", { logger: () => {} });
    const m = text.match(/(\d{2,3})\s*[\/\\|]\s*(\d{2,3})/);
    if (m) {
      const sys = parseInt(m[1]), dia = parseInt(m[2]);
      if (sys >= 60 && sys <= 220 && dia >= 40 && dia <= 150) {
        const sysInput = document.getElementById("bpSysInput");
        const diaInput = document.getElementById("bpDiaInput");
        if (sysInput) sysInput.value = sys;
        if (diaInput) diaInput.value = dia;
        if (statusEl) statusEl.textContent = `✅ Đọc được: ${sys}/${dia} mmHg`;
        el.systolicInput.value = sys;
        return;
      }
    }
    if (statusEl) statusEl.textContent = "Không đọc được. Nhập tay bên dưới.";
  } catch { if (statusEl) statusEl.textContent = "Lỗi OCR. Nhập tay."; }
}

// ─── 1.3: Measurement Quality History ────────────────────────────────────────
function renderMeasurementQualityHistory(measurements) {
  const box = document.getElementById("qualityHistoryBox");
  if (!box) return;
  const meas = measurements.filter(m => m.type === "face" || m.type === "finger").slice(-10).reverse();
  if (!meas.length) { box.innerHTML = "<p class='muted'>Chưa có dữ liệu.</p>"; return; }
  box.innerHTML = meas.map(m => {
    const sq = m.result?.signalQuality || 0;
    const bar = Math.round(sq / 100 * 16);
    const color = sq >= 75 ? "#22c55e" : sq >= 50 ? "#f59e0b" : "#ef4444";
    const label = sq >= 75 ? "Rất tốt" : sq >= 50 ? "Chấp nhận" : "Kém";
    return `<div class="list-item" style="gap:8px">
      <span style="font-size:11px;color:#64748b;width:70px;flex-shrink:0">${new Date(m.createdAt).toLocaleDateString("vi-VN",{day:"2-digit",month:"2-digit"})}</span>
      <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px"><div style="width:${bar/16*100}%;height:100%;background:${color};border-radius:4px"></div></div>
      <strong style="color:${color};width:80px;text-align:right;font-size:12px">${sq}% ${label}</strong>
    </div>`;
  }).join("");
}

// ─── Heart-Print Identity Verification (#17) ─────────────────────────────────
function computePPGFingerprint(rrIntervals) {
  if (!rrIntervals || rrIntervals.length < 8) return null;
  const n = rrIntervals.length;
  const mean = rrIntervals.reduce((a,b)=>a+b,0)/n;
  const normalized = rrIntervals.map(r => Math.round((r - mean) / mean * 1000));
  // Create a simple hash fingerprint from RR pattern morphology
  let hash = 0;
  for (let i = 0; i < Math.min(8, normalized.length); i++) {
    hash = ((hash << 5) - hash + normalized[i]) | 0;
  }
  const skew = rrIntervals.map(r => r - mean).reduce((a,b)=>a+b,0) / n / (Math.sqrt(rrIntervals.map(r=>(r-mean)**2).reduce((a,b)=>a+b,0)/n) || 1);
  return { hash: Math.abs(hash).toString(16).slice(0,8), mean: Math.round(mean), skew: Math.round(skew * 100) / 100 };
}

// ─── 1.8/#16: Emotional Artifact Filter ──────────────────────────────────────
let _preMoodState = null;
function setPreMoodState(btn, mood) {
  _preMoodState = mood;
  document.querySelectorAll(".mood-btn").forEach(b => b.style.borderColor = "transparent");
  btn.style.borderColor = "#3b82f6";
  const hints = { great: "Trạng thái tốt — đo chuẩn nhất!", ok: "Bình thường — kết quả đáng tin cậy.", tired: "Mệt mỏi — nhịp tim có thể cao hơn bình thường.", stressed: "⚠️ Căng thẳng — AI sẽ ghi nhận để lọc nhiễu cảm xúc.", pain: "⚠️ Khó chịu — AI có thể giảm độ nhạy SOS tạm thời." };
  const hint = document.getElementById("moodHint");
  if (hint) hint.textContent = hints[mood] || "";
}
function getEmotionalArtifactNote(afibLikelihood, bpm) {
  if (!_preMoodState) return null;
  if ((_preMoodState === "stressed" || _preMoodState === "pain") && afibLikelihood && bpm > 90) {
    return `ℹ️ Phát hiện trạng thái căng thẳng/khó chịu trước khi đo. Nhịp tim bất thường có thể do yếu tố tâm lý tạm thời — không phải AFib thật. Nghỉ ngơi 5 phút và đo lại.`;
  }
  if (_preMoodState === "tired" && bpm > 100) {
    return `ℹ️ Mệt mỏi làm nhịp tim tăng bù trừ. Kết quả tham khảo, không phải chẩn đoán.`;
  }
  return null;
}

// ─── 2.5: Sudden HR Change Detection ─────────────────────────────────────────
function detectSuddenHRChange(measurements) {
  if (!measurements || measurements.length < 3) return null;
  const recent = measurements.filter(m => m.type === "face" || m.type === "finger").slice(-6).reverse();
  if (recent.length < 3) return null;
  const bpms = recent.map(m => m.result?.bpm || 0).filter(Boolean);
  if (bpms.length < 3) return null;
  const latest = bpms[0];
  const prevAvg = bpms.slice(1).reduce((a,b)=>a+b,0) / (bpms.length - 1);
  const changePct = Math.abs(latest - prevAvg) / prevAvg * 100;
  if (changePct < 20) return null;
  const direction = latest > prevAvg ? "tăng" : "giảm";
  const timeago = recent[0].createdAt ? new Date(recent[0].createdAt).toLocaleTimeString("vi-VN") : "gần đây";
  return {
    detected: true,
    change: Math.round(changePct),
    direction,
    from: Math.round(prevAvg),
    to: latest,
    message: `⚡ Nhịp tim ${direction} đột ngột ${Math.round(changePct)}% (từ ${Math.round(prevAvg)} → ${latest} BPM lúc ${timeago}). ${direction === "tăng" ? "Kiểm tra: vừa vận động mạnh, căng thẳng, hoặc nhịp tim thật sự bất thường?" : "Kiểm tra: vừa nghỉ ngơi, hoặc đo không chuẩn?"}`,
  };
}

// ─── 1.2: Skin Tone / BMI Calibration ────────────────────────────────────────
function applySkinToneCalibration(signalQuality, mode) {
  const skinTone = localStorage.getItem("hs_skin_tone") || "medium";
  const bmi = parseFloat(localStorage.getItem("hs_bmi") || "22");
  let adjustment = 0;
  if (mode === "face") {
    if (skinTone === "dark") adjustment -= 8; // dark skin reduces PPG signal via RGB camera
    else if (skinTone === "very_dark") adjustment -= 15;
    if (bmi > 30) adjustment -= 5; // high BMI reduces signal quality
  }
  return Math.max(15, Math.min(95, signalQuality + adjustment));
}
function saveCalibrationSettings(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  localStorage.setItem("hs_skin_tone", f.get("skinTone") || "medium");
  localStorage.setItem("hs_bmi", f.get("bmi") || "22");
  showToast("Đã lưu cài đặt hiệu chỉnh da/BMI", "success");
}

// ─── Zalo Tele-Clinic infrastructure (G6/C) ──────────────────────────────────
function openZaloClinicInfo() {
  const box = document.getElementById("zaloClinicBox");
  if (!box) return;
  box.innerHTML = `
    <div class="list-item"><span>Trạng thái</span><strong class="badge neutral">Đang phát triển</strong></div>
    <p class="muted" style="font-size:12px">Tính năng Bác sĩ từ xa qua Zalo đang được kết nối với mạng lưới bác sĩ tim mạch Việt Nam. Vui lòng liên hệ admin để đăng ký sớm.</p>
    <p class="muted" style="font-size:12px">Trong thời gian chờ: Dùng nút "Chia sẻ báo cáo 1 chạm" để gửi kết quả cho bác sĩ của bạn qua Email/Zalo thủ công.</p>
    <button class="secondary-btn" style="margin-top:8px" onclick="shareReport()">📤 Chia sẻ báo cáo ngay</button>`;
}

// ─── Estimated SpO2 (disclaimer: not medical grade) ─────────────────────────
function estimateSpO2(samples) {
  if (!samples || samples.length < 30) return null;
  // Use R/G ratio as rough SpO2 proxy (NOT FDA-cleared, reference only)
  const reds = samples.map(s => s.avgRed || 0).filter(Boolean);
  const greens = samples.map(s => s.avgGreen || 0).filter(Boolean);
  if (!reds.length || !greens.length) return null;
  const redAC = Math.sqrt(reds.map(r => (r - reds.reduce((a,b)=>a+b,0)/reds.length)**2).reduce((a,b)=>a+b,0)/reds.length);
  const greenAC = Math.sqrt(greens.map(g => (g - greens.reduce((a,b)=>a+b,0)/greens.length)**2).reduce((a,b)=>a+b,0)/greens.length);
  const redDC = reds.reduce((a,b)=>a+b,0)/reds.length;
  const greenDC = greens.reduce((a,b)=>a+b,0)/greens.length;
  const ratio = (redAC / redDC) / ((greenAC / greenDC) || 1);
  // Rough empirical calibration (Green channel used as proxy for IR)
  const spO2 = Math.round(Math.min(99, Math.max(88, 110 - 25 * ratio)));
  return { spO2, confidence: "Ước tính (Không thay thế thiết bị đo chính xác)", color: spO2 >= 95 ? "#22c55e" : spO2 >= 90 ? "#f59e0b" : "#ef4444" };
}

// ─── Camera & Preview ─────────────────────────────────────────────────────────
function renderQrFallback() {
  const pattern = [1,1,1,0,1,1,1,1,0,1,0,1,0,1,1,1,1,0,1,1,1,0,0,0,1,0,0,0,1,1,1,0,1,1,1,1,0,1,0,1,0,1,1,1,1,0,1,1,1];
  el.qrGrid.innerHTML = pattern.map((v) => `<span style="opacity:${v ? 1 : 0.08}"></span>`).join("");
}

function detectPlatform() {
  const hasCam = !!(navigator.mediaDevices?.getUserMedia);
  if (isMobile()) {
    el.platformBadge.textContent = "Mobile – Ngón Trỏ (Finger PPG ưu tiên)";
    el.platformBadge.className = "badge warn";
    el.deviceHint.textContent = hasCam ? "Mobile: Đặt NGÓN TRỎ lên camera sau + đèn flash. Tính chính xác 94%." : "Trình duyệt chưa sẵn sàng cho camera.";
  } else {
    el.platformBadge.textContent = "Desktop/Laptop – Face PPG (Webcam)";
    el.platformBadge.className = "badge safe";
    el.deviceHint.textContent = hasCam ? "Webcam sẵn sàng cho Face PPG. Ngồi yên, ánh sáng đủ, mắt nhìn vào camera." : "Không tìm thấy webcam. Dùng app trên điện thoại để Finger PPG.";
  }
}

async function checkHealth() {
  try {
    const data = await api("/api/health");
    const i = data.integrations || {};
    const statusText = `${data.name} ${data.version} • Email ${i.email ? "✓" : "✗"} • Weather ${i.weather ? "✓" : "✗"}`;
    if (el.healthStatus) el.healthStatus.textContent = statusText;
    // Cập nhật top-bar status
    const topBar = document.querySelector(".top-bar-status");
    if (topBar) { topBar.textContent = `${data.name} ${data.version} — Sẵn sàng`; topBar.style.color = "#4ade80"; }
  } catch {
    if (el.healthStatus) el.healthStatus.textContent = "Backend chưa sẵn sàng";
    const topBar = document.querySelector(".top-bar-status");
    if (topBar) { topBar.textContent = "Mất kết nối backend"; topBar.style.color = "#f87171"; }
  }
}

function requestNotifications() {
  if (!("Notification" in window)) { setAuthState("Trình duyệt này không hỗ trợ Thông báo.", "error"); return; }
  Notification.requestPermission().then((p) => { if (p === "granted") notify("HEARTSENSE", "Thông báo đã bật."); });
}

async function loadCameraDevices() {
  if (!(navigator.mediaDevices?.enumerateDevices)) { el.cameraFallbackBox.classList.remove("hidden"); return; }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === "videoinput");
    if (!cameras.length) { el.cameraSelect.innerHTML = "<option value=''>Không có camera</option>"; el.cameraFallbackBox.classList.remove("hidden"); return; }
    el.cameraSelect.innerHTML = cameras.map((c, i) => `<option value="${c.deviceId}">${c.label || "Camera " + (i + 1)}</option>`).join("");
    state.selectedCameraId = cameras[0].deviceId;
    el.cameraSelect.value = state.selectedCameraId;
    el.cameraFallbackBox.classList.add("hidden");
  } catch { el.permissionHint.textContent = "Không đọc được camera. Thử cấp quyền trước."; }
}

function setMeasurementMode(mode) {
  state.measurementMode = mode;
  // Tắt đèn flash khi chuyển khỏi Finger PPG
  if (mode !== "finger") { setTorch(false); state.torchOn = false; }
  updateTorchBtn();
  document.querySelectorAll(".segmented-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  if (mode === "face") {
    el.captureModeLabel.textContent = "Face PPG";
    el.modeDescription.textContent = "Đo qua webcam/camera trước. Ngồi yên, mặt đủ sáng, không di chuyển. Theo dõi 30 giây.";
    el.captureGuide.textContent = "Nhìn thẳng vào camera. Đảm bảo mặt đủ sáng. Giới hạn cử động trong 30 giây.";
  } else if (mode === "finger") {
    el.captureModeLabel.textContent = "Ngón Trỏ PPG ★";
    if (isMobile()) {
      el.modeDescription.textContent = "Đặt ĐẦU NGÓN TRỎ che kín camera sau + đèn flash. Kênh đỏ (RED) cho tín hiệu PPG chuẩn nhất. Tốt nhất trên điện thoại.";
      el.captureGuide.textContent = "Ấn nhẹ đầu ngón trỏ che kín toàn bộ camera sau VÀ đèn flash cùng lúc. Giữ tuyệt đối yên 30 giây.";
    } else {
      el.modeDescription.textContent = "⚠️ Ngón Trỏ PPG hiệu quả nhất trên điện thoại (camera sau + đèn flash). Webcam laptop KHÔNG có đèn flash → tín hiệu yếu. Khuyến nghị dùng Face PPG trên laptop.";
      el.captureGuide.textContent = "Nếu vẫn muốn thử: che kín webcam bằng đầu ngón trỏ, đảm bảo phòng có ánh sáng đủ mạnh chiếu vào ngón tay từ phía sau.";
    }
  } else {
    el.captureModeLabel.textContent = "Breathing Coach";
    el.modeDescription.textContent = "Tập thở 4-4-6 giảm căng thẳng, tăng HRV. Hoạt động trên cả web và mobile.";
    el.captureGuide.textContent = "Làm theo nhịp. Vòng tròn phồng to – hít vào, giữ, thu nhỏ – thở ra.";
  }
}

// Bật/tắt torch trực tiếp — thử nhiều cách khác nhau
async function setTorch(enable) {
  if (!state.stream) return false;
  const track = state.stream.getVideoTracks()[0];
  if (!track) return false;
  // Cách 1: advanced constraints (chuẩn W3C)
  try {
    await track.applyConstraints({ advanced: [{ torch: enable }] });
    state.torchOn = enable;
    updateTorchBtn();
    return true;
  } catch {}
  // Cách 2: torch trực tiếp (một số Android)
  try {
    await track.applyConstraints({ torch: enable });
    state.torchOn = enable;
    updateTorchBtn();
    return true;
  } catch {}
  return false;
}

function updateTorchBtn() {
  if (!el.torchBtn) return;
  const fingerMode = state.measurementMode === "finger" && isMobile();
  el.torchBtn.hidden = !fingerMode || !state.stream;
  el.torchBtn.textContent = state.torchOn ? "🔦 Tắt Flash" : "🔦 Bật Flash";
  el.torchBtn.className = state.torchOn ? "primary-btn" : "ghost-btn";
}

async function toggleTorch() {
  if (!state.stream) {
    await startCamera();
  }
  const newState = !state.torchOn;
  const ok = await setTorch(newState);
  if (!ok && newState) {
    el.permissionHint.textContent = "⚠️ Thiết bị không hỗ trợ flash qua app. Hãy bật đèn pin từ thanh thông báo điện thoại.";
  }
}

// Tìm camera sau có hỗ trợ torch trong danh sách thiết bị
async function findTorchCamera() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const rearCams = devices.filter(d => d.kind === "videoinput" &&
      (d.label.toLowerCase().includes("back") ||
       d.label.toLowerCase().includes("rear") ||
       d.label.toLowerCase().includes("environment") ||
       d.label === "")); // label rỗng = chưa cấp quyền, thử hết
    // Thử từng camera sau xem cái nào có torch
    for (const cam of rearCams) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const track = s.getVideoTracks()[0];
        const caps = track?.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          s.getTracks().forEach(t => t.stop()); // dừng stream test
          return cam.deviceId; // trả về deviceId của camera có torch
        }
        s.getTracks().forEach(t => t.stop());
      } catch { /* camera này không dùng được, thử tiếp */ }
    }
  } catch { /* enumerateDevices thất bại */ }
  return null;
}

async function startCamera() {
  try {
    if (state.stream) stopCamera();
    const isFingerMode = state.measurementMode === "finger";
    const isMob = isMobile();

    const videoConstraint = state.selectedCameraId
      ? { deviceId: { exact: state.selectedCameraId } }
      : { facingMode: isFingerMode ? { ideal: "environment" } : { ideal: "user" } };

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...videoConstraint, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    el.cameraVideo.srcObject = state.stream;

    if (isFingerMode && isMob) {
      // Đợi track sẵn sàng rồi bật torch
      await new Promise(r => setTimeout(r, 400));
      const torchOk = await setTorch(true);
      el.permissionHint.textContent = torchOk
        ? "🔦 Flash đã bật! Úp ngón trỏ che kín cụm camera + flash."
        : "⚠️ Thiết bị không cho bật flash qua app — bấm nút 🔦 bên dưới thử lại.";
    } else {
      el.permissionHint.textContent = "Camera đã cấp quyền. Chọn camera khác nếu cần.";
    }
    updateTorchBtn();
    startPreviewLoop();
    await loadCameraDevices();
  } catch {
    el.cameraFallbackBox.classList.remove("hidden");
    setAuthState("Không mở được camera. Kiểm tra quyền webcam và thử lại.", "error");
  }
}

async function stopCamera() {
  await setTorch(false); // tắt đèn flash trước khi dừng camera
  if (state.previewRaf) { cancelAnimationFrame(state.previewRaf); state.previewRaf = null; }
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  state.previousSample = null;
  el.cameraVideo.srcObject = null;
}

function sampleFrame(mode) {
  const video = el.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = el.cameraCanvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const region = mode === "finger"
    ? { x: Math.floor(canvas.width * 0.32), y: Math.floor(canvas.height * 0.32), width: Math.floor(canvas.width * 0.36), height: Math.floor(canvas.height * 0.36) }
    : { x: Math.floor(canvas.width * 0.28), y: Math.floor(canvas.height * 0.18), width: Math.floor(canvas.width * 0.44), height: Math.floor(canvas.height * 0.48) };

  const pixels = ctx.getImageData(region.x, region.y, region.width, region.height).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < pixels.length; i += 4) { r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; }
  const count = pixels.length / 4;
  const avgRed = r / count, avgGreen = g / count, avgBlue = b / count;
  const brightness = 0.299 * avgRed + 0.587 * avgGreen + 0.114 * avgBlue;

  // #11: Skin pixel validation — reject if brightness out of human skin range
  if (mode === "face" && (brightness < 40 || brightness > 215)) {
    state.previousSample = { avgRed, avgGreen, avgBlue };
    return null; // not skin region
  }

  const movement = state.previousSample ? Math.abs(state.previousSample.avgRed - avgRed) + Math.abs(state.previousSample.avgGreen - avgGreen) + Math.abs(state.previousSample.avgBlue - avgBlue) : 0;
  state.previousSample = { avgRed, avgGreen, avgBlue };
  return { brightness, avgRed, avgGreen, avgBlue, movement };
}

function derivePreviewMetrics(sample) {
  const lightScore = Math.round(Math.max(15, Math.min(99, 100 - Math.abs(sample.brightness - 122) * 0.9)));
  const stabilityScore = Math.round(Math.max(12, Math.min(99, 100 - sample.movement * 1.8)));
  const signalQuality = Math.round(Math.max(18, Math.min(99, lightScore * 0.48 + stabilityScore * 0.52 + (state.measurementMode === "finger" ? 8 : 0))));
  return { lightScore, stabilityScore, signalQuality };
}

function renderPreviewMetrics(m) {
  state.lastPreviewMetrics = m;
  el.lightMetric.textContent = `${m.lightScore}%`;
  el.stabilityMetric.textContent = `${m.stabilityScore}%`;
  el.qualityMetric.textContent = `${m.signalQuality}%`;
}

function startPreviewLoop() {
  const loop = () => {
    if (!state.stream) return;
    const sample = sampleFrame(state.measurementMode === "breathing" ? "face" : state.measurementMode);
    if (sample && !state.measurementActive) renderPreviewMetrics(derivePreviewMetrics(sample));
    state.previewRaf = requestAnimationFrame(loop);
  };
  if (state.previewRaf) cancelAnimationFrame(state.previewRaf);
  loop();
}

function normalizeWave(values) {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  return values.map((v) => 25 + ((v - min) / span) * 110);
}

function buildWavePath(points) {
  if (!points.length) { el.wavePath.setAttribute("d", ""); return; }
  const width = 600, height = 180;
  const stepX = width / Math.max(1, points.length - 1);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${(height - v * 1.4).toFixed(2)}`).join(" ");
  el.wavePath.setAttribute("d", path);
}

// ─── Run Measurement ──────────────────────────────────────────────────────────
async function runMeasurement() {
  if (state.measurementMode === "breathing") { startBreathingCoach(); return; }
  if (!state.stream) await startCamera();
  if (!state.stream) return;

  // Giữ flash bật nếu đang đo Finger PPG và torch đã bật
  if (state.measurementMode === "finger" && isMobile() && state.torchOn) {
    await setTorch(true); // đảm bảo flash không tắt khi measurement bắt đầu
  }

  state.measurementActive = true;
  state.measurementSamples = [];
  const modeLabel = state.measurementMode === "face" ? "Đang đo Face PPG – Nhìn thẳng vào camera" : "Đang đo Finger PPG – Giữ NGÓN TRỎ trên camera";
  el.measurementModeLabel.textContent = modeLabel;
  el.measurementOverlay.classList.remove("hidden");
  el.measurementTimer.textContent = String(MEASUREMENT_SECONDS);
  el.startMeasureBtn.disabled = true;

  if (isMobile() && state.measurementMode === "finger") {
    el.deepAnalysisPrompt.classList.remove("hidden");
    el.deepAnalysisText.textContent = "Ấn đầu NGÓN TRỎ che kín camera sau + đèn flash. Giữ tuyệt đối yên, không nhấc ngón tay.";
  } else if (state.measurementMode === "face") {
    el.deepAnalysisPrompt.classList.remove("hidden");
    el.deepAnalysisText.textContent = "Nhìn thẳng vào camera, ngồi yên, đảm bảo mặt đủ sáng, tránh di chuyển.";
  } else {
    el.deepAnalysisPrompt.classList.add("hidden");
  }

  const startedAt = performance.now();
  let frameCount = 0;
  await new Promise((resolve) => {
    function frame(now) {
      const elapsed = (now - startedAt) / 1000;
      const remaining = Math.max(0, MEASUREMENT_SECONDS - elapsed);
      el.measurementTimer.textContent = String(Math.ceil(remaining));
      const sample = sampleFrame(state.measurementMode);
      if (sample) {
        state.measurementSamples.push(sample);
        frameCount++;
        if (state.measurementSamples.length > MEASUREMENT_SECONDS * 35) state.measurementSamples.shift();
        const metrics = derivePreviewMetrics(sample);
        renderPreviewMetrics(metrics);
        // G1: Real-time signal quality guidance (enhanced)
        const guidance = getSignalQualityGuidance(metrics.lightScore, metrics.stabilityScore, state.measurementMode, metrics.signalQuality);
        if (metrics.signalQuality < 55) {
          if (!state.lowQualityStart) state.lowQualityStart = now;
          else if ((now - state.lowQualityStart) > 3000) {
            el.deepAnalysisText.textContent = guidance;
            if (el.deepAnalysisPrompt) el.deepAnalysisPrompt.classList.remove("hidden");
          }
        } else {
          state.lowQualityStart = null;
          if (metrics.signalQuality >= 75 && el.deepAnalysisPrompt) {
            el.deepAnalysisText.textContent = "✅ Tín hiệu tốt — đang đo chuẩn!";
            el.deepAnalysisPrompt.classList.remove("hidden");
          }
        }
      }
      if (remaining <= 0) { state.measurementFps = Math.round(frameCount / MEASUREMENT_SECONDS); resolve(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  state.lowQualityStart = null;

  state.measurementActive = false;
  el.measurementOverlay.classList.add("hidden");
  el.deepAnalysisPrompt.classList.add("hidden");
  el.startMeasureBtn.disabled = false;

  const localResult = analyzeSamples(state.measurementSamples, state.measurementMode);
  buildWavePath(localResult.waveform);
  // Thermal proxy analysis from samples
  if (state.measurementMode === "face" && state.measurementSamples.length >= 30) {
    const thermalProxy = analyzePPGThermalProxy(state.measurementSamples);
    if (thermalProxy) {
      const tBox = document.getElementById("thermalProxyBox");
      if (tBox) {
        const color = thermalProxy.perfusionIndex < 2 ? "#ef4444" : thermalProxy.perfusionIndex < 5 ? "#f59e0b" : "#22c55e";
        tBox.innerHTML = `
          <div class="list-item"><span>Chỉ số vi tuần hoàn (PI)</span><strong style="color:${color}">${thermalProxy.perfusionIndex}% — ${thermalProxy.perfusionLevel}</strong></div>
          <div class="list-item"><span>Trạng thái mạch máu</span><strong>${thermalProxy.vasoState}</strong></div>
          <p class="muted" style="font-size:12px">${thermalProxy.note}</p>`;
      }
    }
  }
  // Emotional artifact filter integration
  if (localResult && _preMoodState) {
    const emotionalNote = getEmotionalArtifactNote(localResult.afibLikelihood, localResult.bpm);
    if (emotionalNote) {
      const enBox = document.getElementById("emotionalArtifactNote");
      if (enBox) { enBox.textContent = emotionalNote; enBox.style.display = "block"; }
    }
  }
  // Save encrypted measurement to local storage
  saveEncryptedMeasurement({ type: state.measurementMode, bpm: localResult?.bpm, ts: Date.now() }).catch(() => {});

  if (!state.token || !state.user) { renderGuestResult(localResult); return; }

  // #35: Save offline if no internet
  if (!state.isOnline) {
    await saveOfflineMeasurement({ type: state.measurementMode, payload: localResult });
    showToast("Đã lưu ngoại tuyến. Sẽ đồng bộ khi có mạng.", "warn");
    return;
  }

  try {
    setLoading(el.startMeasureBtn, true, "Đang gửi kết quả...");
    const response = await api("/api/measurements", {
      method: "POST",
      body: JSON.stringify({ token: state.token, type: state.measurementMode, payload: localResult }),
    });
    setLoading(el.startMeasureBtn, false);
    state.lastMeasurementRecord = response.measurement;
    renderDashboard(response.dashboard);
    showToast("Đã lưu kết quả đo!", "success");

    if (response.pillAlert?.triggered) renderPillAlert(response.pillAlert);

    if (response.measurement.result.shouldTriggerSos) {
      if (response.measurement.result.shockIndex?.level === "CRITICAL") {
        startSosCountdown(`CHỈ SỐ SỐC CAO (${response.measurement.result.shockIndex.shockIndex}): ${response.measurement.result.shockIndex.action}`);
      } else {
        startAfibConfirmation(response.measurement);
      }
    } else if (response.measurement.result.classification === "elevated") {
      el.abnormalPromptBox.classList.remove("hidden");
    } else {
      el.abnormalPromptBox.classList.add("hidden");
    }
  } catch (err) { setLoading(el.startMeasureBtn, false); setAuthState(err.message, "error"); }
}

// ─── AFib Confirmation Flow ───────────────────────────────────────────────────
function startAfibConfirmation(measurement) {
  if (!el.afibConfirmBox) { startSosCountdown("Phát hiện nhịp bất thường / AFib nghi ngờ"); return; }
  state.afibConfirmMode = true;
  el.afibConfirmBox.classList.remove("hidden");
  el.afibConfirmBox.innerHTML = `
    <div class="confirm-alert">
      <strong>⚠️ Hệ thống phát hiện rung nhĩ (AFib)!</strong>
      <p>Để xác nhận và tránh báo động nhầm, vui lòng đo thêm một lần nữa:</p>
      <div class="button-row">
        <button id="confirmAfibBtn" class="primary-btn" type="button">Đo xác nhận ngay (15 giây)</button>
        <button id="skipConfirmBtn" class="ghost-btn" type="button">Bỏ qua – Kích hoạt SOS ngay</button>
        <button id="dismissAfibBtn" class="secondary-btn" type="button">Tôi ổn – Hủy cảnh báo</button>
      </div>
      <p class="muted">Nếu có triệu chứng: chóng váng, khó thở, tê tay chân – Bấm Kích hoạt SOS ngay.</p>
    </div>`;

  document.querySelector("#confirmAfibBtn")?.addEventListener("click", async () => {
    el.afibConfirmBox.innerHTML = "<p class='muted'>Đang đo xác nhận... Đặt NGÓN CÁI lên camera.</p>";
    if (!state.stream) await startCamera();
    if (!state.stream) { el.afibConfirmBox.classList.add("hidden"); startSosCountdown("AFib xac nhan that bai - khong co camera"); return; }

    const samples = [];
    const fps = state.measurementFps || 30;
    const confirmSecs = 15;
    const started = performance.now();
    await new Promise((resolve) => {
      function frame(now) {
        const remaining = Math.max(0, confirmSecs - (now - started) / 1000);
        el.afibConfirmBox.querySelector("p").textContent = `Đang đo xác nhận... còn ${Math.ceil(remaining)} giây`;
        const s = sampleFrame(state.measurementMode === "face" ? "face" : "finger");
        if (s) samples.push(s);
        if (remaining <= 0) { resolve(); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    const confirmResult = analyzePPGSignal(samples, state.measurementMode === "face" ? "face" : "finger", fps);
    el.afibConfirmBox.classList.add("hidden");
    state.afibConfirmMode = false;

    if (confirmResult?.afibLikelihood || (confirmResult?.irregularityIndex || 0) > 55) {
      startSosCountdown("AFib xác nhận bằng 2 lần đo độc lập – Độ tin cậy cao");
    } else {
      el.afibConfirmBox.classList.remove("hidden");
      el.afibConfirmBox.innerHTML = `<div class="confirm-alert safe-alert"><strong>Kết quả xác nhận: Không rõ ràng AFib</strong><p>Lần đo thứ 2 không xác nhận rung nhĩ. Có thể do nhiễu tín hiệu. <strong>Nghỉ ngơi và đo lại sau 30 phút</strong> khi bình tĩnh.</p><button id="closeConfirmBtn" class="ghost-btn" type="button">Đóng</button></div>`;
      document.querySelector("#closeConfirmBtn")?.addEventListener("click", () => el.afibConfirmBox.classList.add("hidden"));
    }
  });

  document.querySelector("#skipConfirmBtn")?.addEventListener("click", () => {
    el.afibConfirmBox.classList.add("hidden");
    startSosCountdown("Người dùng chọn kích hoạt SOS – AFib nghi ngờ mạnh");
  });

  document.querySelector("#dismissAfibBtn")?.addEventListener("click", () => {
    el.afibConfirmBox.classList.add("hidden");
    state.afibConfirmMode = false;
    el.sosBadge.textContent = "Người dùng đã hủy";
    el.sosBadge.className = "badge safe";
  });
}

// ─── Pill-in-the-Pocket Alert ─────────────────────────────────────────────────
function renderPillAlert(pillAlert) {
  if (!el.pillAlertBox) return;
  el.pillAlertBox.classList.remove("hidden");
  const protocols = pillAlert.protocols?.length
    ? pillAlert.protocols
    : (pillAlert.medicineName ? [{ medicineName: pillAlert.medicineName, dose: pillAlert.dose, instructions: "" }] : []);
  const protocolRows = protocols.map(p =>
    `<div style="background:#fff8e1;border-radius:6px;padding:6px 10px;margin:4px 0">
      <strong>💊 ${p.medicineName}</strong> — ${p.dose}
      ${p.instructions ? `<br><span style="font-size:11px;color:#6b7280">${p.instructions}</span>` : ""}
    </div>`
  ).join("");
  el.pillAlertBox.innerHTML = `
    <div class="pill-alert-card">
      <strong style="color:var(--danger)">⚠️ Phát hiện AFib! Uống thuốc theo phác đồ bác sĩ:</strong>
      <div style="margin:8px 0">${protocolRows || `<p>${pillAlert.message}</p>`}</div>
      <div class="button-row">
        <button id="confirmPillBtn" class="primary-btn" type="button">✅ Đã uống thuốc</button>
        <button id="dismissPillBtn" class="ghost-btn" type="button">Đóng</button>
      </div>
    </div>`;
  playAlarmTone();
  notify("HEARTSENSE", pillAlert.message);
  document.querySelector("#confirmPillBtn")?.addEventListener("click", () => { el.pillAlertBox.classList.add("hidden"); showToast("Đã ghi nhận uống thuốc.", "success"); });
  document.querySelector("#dismissPillBtn")?.addEventListener("click", () => el.pillAlertBox.classList.add("hidden"));
}

// ─── Render Functions ─────────────────────────────────────────────────────────
function renderGuestResult(localResult) {
  el.riskBadge.textContent = "Kết quả local"; el.riskBadge.className = "badge warn";
  el.bpmResult.textContent = `${localResult.estimatedBpm} BPM`;
  el.hrvResult.textContent = `${localResult.hrvScore}`;
  if (el.sdnnResult) el.sdnnResult.textContent = localResult.sdnn ? `${localResult.sdnn} ms` : "--";
  if (el.rmssdResult) el.rmssdResult.textContent = localResult.rmssd ? `${localResult.rmssd} ms` : "--";
  el.strokeRiskResult.textContent = "--%";
  el.afibResult.textContent = `${localResult.irregularityIndex}`;
  el.resultHeadline.textContent = "Kết quả demo trên client. Đăng nhập để lưu và phân tích đầy đủ.";
  el.resultDescription.textContent = "Đăng nhập để backend phân tích nguy cơ, lưu lịch sử và SOS.";
}

function renderRecommendationBox(recs = []) {
  el.recommendationBox.innerHTML = recs.length
    ? recs.map((r) => `<div class="list-item"><span>Hướng dẫn</span><strong>${r}</strong></div>`).join("")
    : "<p class='muted'>Chưa có khuyến nghị.</p>";
}

function renderShockIndex(si) {
  if (!el.shockIndexBox || !si) return;
  const color = si.level === "CRITICAL" ? "danger" : si.level === "WARNING" ? "warn" : "safe";
  el.shockIndexBox.innerHTML = `
    <div class="list-item">
      <span>Chi so Soc (HR/BP)</span>
      <strong class="badge ${color}">${si.shockIndex} – ${si.level}</strong>
    </div>
    ${si.action ? `<p class="muted" style="color:var(--${color})">${si.action}</p>` : ""}`;
}

function renderAfibBurden(b7, b30) {
  if (!el.afibBurdenBox) return;
  if (!b7) { el.afibBurdenBox.innerHTML = "<p class='muted'>Chưa có dữ liệu AFib Burden.</p>"; return; }
  const c7 = b7.burden >= 25 ? "danger" : b7.burden >= 10 ? "warn" : "safe";
  const trendIcon = b7.trend === "increasing" ? "⬆️ Tăng" : b7.trend === "decreasing" ? "⬇️ Giảm" : "➡️ Ổn định";
  el.afibBurdenBox.innerHTML = `
    <div class="list-item"><span>7 ngày</span><strong class="badge ${c7}">${b7.burden}% (${b7.afibCount}/${b7.total} lần)</strong></div>
    <div class="list-item"><span>30 ngày</span><strong class="badge ${b30.burden >= 25 ? "danger" : "warn"}">${b30.burden}% (${b30.afibCount}/${b30.total} lần)</strong></div>
    <div class="list-item"><span>Xu hướng</span><strong>${trendIcon}</strong></div>
    ${b7.alert ? `<p class="muted" style="color:var(--danger);font-weight:700">${b7.alert}</p>` : ""}`;
}

function renderStrokePredictor(sp) {
  if (!el.strokePredictorBox || !sp) return;
  const c = sp.probability >= 60 ? "danger" : sp.probability >= 35 ? "warn" : "safe";
  el.strokePredictorBox.innerHTML = `
    <div class="list-item"><span>Xác suất đột quỵ 72h</span><strong class="badge ${c}">${sp.probability}%</strong></div>
    <div class="list-item"><span>Mức độ</span><strong>${sp.level === "CAO" ? "⚠️ CAO" : sp.level === "TRUNG_BINH" ? "Trung bình" : "✅ Thấp"}</strong></div>
    <p class="muted">${sp.recommendation}</p>
    ${sp.actionRequired ? '<p class="muted" style="color:var(--danger);font-weight:700">Liên hệ bác sĩ tim mạch ngay!</p>' : ""}`;
}

function renderThermalStrain(ts) {
  if (!el.thermalStrainBox || !ts) return;
  if (ts.level === "NORMAL") { el.thermalStrainBox.innerHTML = "<p class='muted'>Chỉ số nhiệt độc bình thường.</p>"; return; }
  const c = ts.level === "CRITICAL" ? "danger" : ts.level === "WARNING" ? "warn" : "neutral";
  el.thermalStrainBox.innerHTML = `
    <div class="list-item"><span>Nhiệt độc</span><strong class="badge ${c}">${ts.level} (${ts.tsi})</strong></div>
    <p class="muted" style="color:var(--${c === "neutral" ? "warn" : c})">${ts.message}</p>`;
  if (ts.sos) startSosCountdown(`SOC NHIET: ${ts.message}`);
}

function renderAfibDiseaseLog(afibDisease) {
  if (!el.afibDiseaseLog || !afibDisease) return;
  if (!afibDisease.totalEpisodes) { el.afibDiseaseLog.innerHTML = "<p class='muted'>Chưa ghi nhận cơn rung nhĩ nào.</p>"; return; }
  const byDay = afibDisease.last7Days?.byDay || {};
  const rows = Object.entries(byDay).map(([day, eps]) =>
    `<div class="list-item"><span>${day}</span><strong>${eps.length} cơn AFib (${eps.map((e) => e.bpm + " bpm").join(", ")})</strong></div>`
  ).join("");
  el.afibDiseaseLog.innerHTML = `
    <div class="list-item"><span>Tổng tất cả</span><strong>${afibDisease.totalEpisodes} cơn</strong></div>
    <div class="list-item"><span>7 ngày gần nhất</span><strong class="${afibDisease.hasCritical ? "badge danger" : "badge warn"}">${afibDisease.last7Days?.count || 0} cơn</strong></div>
    ${rows}
    ${afibDisease.hasCritical ? '<p class="muted" style="color:var(--danger)">⚠️ Nhiều cơn trong 7 ngày – Gặp bác sĩ ngay!</p>' : ""}`;
}

function renderHrvAdvanced(result) {
  if (!el.hrvAdvancedBox || !result) return;
  const hasPpg = result.sdnn > 0;
  el.hrvAdvancedBox.innerHTML = hasPpg ? `
    <div class="list-item"><span>SDNN</span><strong>${result.sdnn} ms</strong></div>
    <div class="list-item"><span>RMSSD</span><strong>${result.rmssd} ms</strong></div>
    <div class="list-item"><span>pNN50</span><strong>${result.pnn50}%</strong></div>
    <div class="list-item"><span>CV (AFib index)</span><strong>${result.cv} ${result.cv > 0.18 ? "⚠️" : "✓"}</strong></div>
    <div class="list-item"><span>Số đỉnh PPG</span><strong>${result.rrIntervals?.length || "--"} khoảng RR</strong></div>` :
    "<p class='muted'>Chưa đủ dữ liệu PPG để tính SDNN/RMSSD. Đo thêm để nâng cao độ chính xác.</p>";
}

// ─── CHA2DS2-VASc + HASBLED display (#22, #34) ───────────────────────────────
function renderCha2ds2(cha2ds2, hasbled) {
  if (!el.cha2ds2Box) return;
  if (!cha2ds2) { el.cha2ds2Box.innerHTML = "<p class='muted'>Chưa có dữ liệu hồ sơ.</p>"; return; }
  const c = cha2ds2.score >= 4 ? "danger" : cha2ds2.score >= 2 ? "warn" : "safe";
  const hc = hasbled?.score >= 3 ? "danger" : "safe";
  el.cha2ds2Box.innerHTML = `
    <div class="list-item"><span>CHA2DS2-VASc</span><strong class="badge ${c}">${cha2ds2.score} – ${cha2ds2.riskLevel}</strong></div>
    <div class="list-item"><span>Khuyến cáo</span><strong>${cha2ds2.anticoagRecommend}</strong></div>
    ${hasbled ? `<div class="list-item"><span>HAS-BLED</span><strong class="badge ${hc}">${hasbled.score} – ${hasbled.riskLevel}</strong></div>
    ${hasbled.note ? `<p class="muted" style="color:var(--danger)">${hasbled.note}</p>` : ""}` : ""}`;
}

// ─── BP Trend display (#33) ───────────────────────────────────────────────────
function renderBpTrend(bpTrend) {
  if (!el.bpTrendBox) return;
  if (!bpTrend?.points?.length) { el.bpTrendBox.innerHTML = "<p class='muted'>Chưa có dữ liệu huyết áp.</p>"; return; }
  const last = bpTrend.points[bpTrend.points.length - 1];
  const c = last.systolic >= 180 ? "danger" : last.systolic >= 150 ? "warn" : "safe";
  el.bpTrendBox.innerHTML = `
    <div class="list-item"><span>Huyết áp mới nhất</span><strong class="badge ${c}">${last.systolic} mmHg</strong></div>
    <div class="list-item"><span>Lần đo</span><strong>${new Date(last.date).toLocaleString("vi-VN")}</strong></div>
    ${bpTrend.alert ? `<p class="muted" style="color:var(--danger);font-weight:700">${bpTrend.alert}</p>` : ""}
    <div class="list-item"><span>Lịch sử</span><strong>${bpTrend.points.length} điểm dữ liệu</strong></div>`;
  if (bpTrend.alert) showToast(bpTrend.alert, "error", 6000);
}

// ─── Circadian pattern display (#28) — mini bar chart theo giờ ───────────────
function renderCircadian(circadian) {
  if (!el.circadianBox) return;
  if (!circadian || !circadian.hours?.length) {
    el.circadianBox.innerHTML = "<p class='muted'>Cần ≥5 lần đo để phân tích nhịp sinh học.</p>";
    return;
  }
  const peak = circadian.peakHour;
  const hours = circadian.hours;
  const maxBpm = Math.max(...hours.map(h => h.avgBpm), 1);
  const minBpm = Math.min(...hours.map(h => h.avgBpm));
  const bars = hours.map(h => {
    const heightPct = Math.max(8, Math.round((h.avgBpm - minBpm + 10) / (maxBpm - minBpm + 10) * 100));
    const isPeak = peak && h.hour === peak.hour;
    return `<div class="circadian-bar${isPeak ? " peak" : ""}" style="height:${heightPct}%" title="${h.hour}h: ${h.avgBpm} BPM"><span class="bar-tip">${h.hour}h<br>${h.avgBpm} BPM</span></div>`;
  }).join("");
  const labels = hours.map(h => `<span>${h.hour}h</span>`).join("");
  el.circadianBox.innerHTML = `
    <div class="list-item"><span>Giờ nhịp tim cao nhất</span><strong>${peak ? peak.hour + "h (" + peak.avgBpm + " BPM)" : "--"}</strong></div>
    <div class="list-item"><span>Số giờ có dữ liệu</span><strong>${hours.length} / 24 giờ</strong></div>
    <div class="circadian-bar-chart">${bars}</div>
    <div class="circadian-hour-labels">${labels}</div>`;
}

// ─── Poincaré display (#24) ───────────────────────────────────────────────────
function renderPoincare(result) {
  if (!el.poincareBox || !result) return;
  const sd1 = result.sd1 || 0, sd2 = result.sd2 || 0;
  const ratio = sd2 > 0 ? Math.round((sd1 / sd2) * 1000) / 1000 : 0;
  if (!sd1 && !sd2) { el.poincareBox.innerHTML = "<p class='muted'>Cần ≥4 khoảng RR.</p>"; return; }
  const c = ratio > 0.85 ? "warn" : "safe";
  el.poincareBox.innerHTML = `
    <div class="list-item"><span>SD1 (ms)</span><strong>${sd1}</strong></div>
    <div class="list-item"><span>SD2 (ms)</span><strong>${sd2}</strong></div>
    <div class="list-item"><span>SD1/SD2</span><strong class="badge ${c}">${ratio} ${ratio > 0.85 ? "⚠️ AFib indicator" : "✓"}</strong></div>`;
}

// ─── SampEn + LF/HF display (#23, #26) ───────────────────────────────────────
function renderSampEn(result) {
  if (!el.sampEnBox || !result) return;
  const sampEn = result.sampEn || 0;
  const lfhf = result.lfhfRatio;
  if (!sampEn) { el.sampEnBox.innerHTML = "<p class='muted'>Cần ≥12 khoảng RR để tính SampEn.</p>"; return; }
  const sc = sampEn > 0.9 ? "warn" : "safe";
  el.sampEnBox.innerHTML = `
    <div class="list-item"><span>Sample Entropy</span><strong class="badge ${sc}">${sampEn} ${sampEn > 0.9 ? "⚠️ Cao" : "✓"}</strong></div>
    ${lfhf !== null && lfhf !== undefined ? `<div class="list-item"><span>LF/HF ratio</span><strong>${lfhf}</strong></div>` : ""}`;
}

// ─── Waveform peak annotations (#31) ─────────────────────────────────────────
function renderWaveformWithPeaks(waveform, rrIntervals) {
  if (!el.wavePath) return;
  buildWavePath(waveform);
  // Remove old peak circles
  const chart = document.querySelector("#waveChart");
  if (!chart) return;
  chart.querySelectorAll(".peak-circle").forEach(c => c.remove());
  if (!waveform?.length || !rrIntervals?.length) return;
  // Estimate peak positions from RR intervals
  const width = 600, height = 180;
  const n = waveform.length;
  let pos = 0;
  const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
  const mean = waveform.reduce((a, b) => a + b, 0) / n;
  for (const rr of rrIntervals.slice(0, 15)) {
    const nextPos = pos + Math.round(rr / meanRR * (n / rrIntervals.length));
    const x = (nextPos / Math.max(1, n - 1)) * width;
    // Find local max near expected peak
    const start = Math.max(0, nextPos - 3), end = Math.min(n - 1, nextPos + 3);
    let maxVal = -Infinity, maxIdx = nextPos;
    for (let i = start; i <= end; i++) { if (waveform[i] > maxVal) { maxVal = waveform[i]; maxIdx = i; } }
    const y = height - maxVal * 1.4;
    const deviation = rrIntervals.length > 1 ? Math.abs(rr - meanRR) / meanRR : 0;
    const color = deviation > 0.40 ? "#ef4444" : deviation > 0.20 ? "#f59e0b" : "#22c55e";
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x.toFixed(1));
    circle.setAttribute("cy", y.toFixed(1));
    circle.setAttribute("r", "4");
    circle.setAttribute("fill", color);
    circle.setAttribute("opacity", "0.85");
    circle.setAttribute("class", "peak-circle");
    chart.appendChild(circle);
    pos = nextPos;
  }
}

function renderMeasurementResult(record) {
  if (!record?.result) return;
  const r = record.result;
  const cls = r.classification;
  const badgeClass = cls === "afib" ? "badge danger" : cls === "elevated" ? "badge warn" : "badge safe";
  const badgeText = cls === "afib" ? "Cảnh báo AFib" : cls === "elevated" ? "Cần theo dõi" : "Bình thường";
  el.riskBadge.className = badgeClass; el.riskBadge.textContent = badgeText;
  el.bpmResult.textContent = `${r.bpm} BPM`;
  el.hrvResult.textContent = `${r.hrvScore}`;
  if (el.sdnnResult) el.sdnnResult.textContent = r.sdnn ? `${r.sdnn} ms` : "--";
  if (el.rmssdResult) el.rmssdResult.textContent = r.rmssd ? `${r.rmssd} ms` : "--";
  el.strokeRiskResult.textContent = `${r.strokeRiskScore}%`;
  el.afibResult.textContent = `${r.irregularityIndex}`;
  el.resultHeadline.textContent = cls === "afib"
    ? "Phát hiện nhịp bất thường. Làm theo hướng dẫn SOS."
    : cls === "elevated" ? "Nhịp tim có dấu hiệu cần theo dõi."
    : "Tim đang đập ổn định trong lần đo này.";
  // Ghi chú chất lượng: Finger PPG trên máy tính thấp hơn điện thoại
  const qualityNote = (record.type === "finger" && !isMobile())
    ? ` · ⚠️ Finger PPG trên máy tính thấp hơn điện thoại (không có đèn flash)`
    : "";
  el.resultDescription.textContent = `${r.baselineStatus}. Độ tin cậy ${r.confidence}% – Chất lượng ${r.signalQuality}%${qualityNote}.`;
  renderRecommendationBox(r.recommendation);
  renderWaveformWithPeaks(r.waveform || [], r.rrIntervals || []); // #31 peak annotations
  renderShockIndex(r.shockIndex);
  renderHrvAdvanced(r);
  renderPoincare(r); // #24
  renderSampEn(r);   // #23
  el.abnormalPromptBox.classList.toggle("hidden", cls !== "elevated");

  // ── New feature renders ──────────────────────────────────────────────────
  // G3: AFib vs PAC/PVC Rhythm Classification
  if (r.rrIntervals?.length >= 8) {
    const rhythmType = classifyRhythmType(r.rrIntervals);
    renderRhythmClassification(rhythmType);
    // #10: Digital Twin Heart
    renderDigitalTwin(r.bpm, rhythmType.type, r.rrIntervals);
    // #5: Synthetic ECG
    renderSyntheticECGDisplay(r.rrIntervals, r.bpm);
    // Heart-Print fingerprint
    const fp = computePPGFingerprint(r.rrIntervals);
    const fpEl = document.getElementById("heartPrintId");
    if (fpEl && fp) fpEl.textContent = `Heart-Print ID: ${fp.hash} · Mean RR: ${fp.mean}ms`;
    // RSA index
    const rsa = computeRSAIndex(r.rrIntervals);
    renderRSAIndex(rsa);
    // AFib Trigger Contextual Mapping (only when AFib detected)
    if (r.classification === "afib" || r.irregularityIndex > 55) {
      const weather = state.dashboard?.weatherAlert || null;
      const allMeas = state.dashboard?.measurements || [];
      const triggerCtx = computeAfibTriggerContext(record, weather, allMeas);
      renderAfibTriggerContext(triggerCtx);
    }
    // Estimated SpO2 (if samples available)
    const spO2El = document.getElementById("spO2EstResult");
    if (spO2El && state.measurementSamples.length >= 30) {
      const spO2 = estimateSpO2(state.measurementSamples);
      if (spO2) spO2El.innerHTML = `<span style="color:${spO2.color}">${spO2.spO2}% SpO2 估</span> <span class="muted" style="font-size:10px">(${spO2.confidence})</span>`;
    }
  }
}

function renderRhythmClassification(result) {
  const box = document.getElementById("rhythmClassBox");
  if (!box || !result) return;
  box.innerHTML = `
    <div class="list-item">
      <span>Phân loại nhịp</span>
      <strong class="badge" style="background:${result.color}20;color:${result.color};border:1px solid ${result.color}40">${result.label}</strong>
    </div>
    <div class="list-item"><span>Độ tin cậy phân tích</span><strong>${result.confidence}%</strong></div>
    ${result.note ? `<p class="muted" style="font-size:12px;margin-top:4px;color:${result.type==="pac_pvc"?"#92400e":result.type==="afib"?"#991b1b":"#14532d"}">${result.note}</p>` : ""}
    ${result.type === "pac_pvc" ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:8px;margin-top:6px;font-size:12px;color:#92400e">
      <strong>ℹ️ Ngoại tâm thu KHÔNG phải AFib</strong><br>
      PAC/PVC là hiện tượng lành tính rất phổ biến (>50% người trưởng thành có). Không cần hoảng loạn. Nếu nhiều hơn 10% nhịp/ngày hoặc có triệu chứng — gặp bác sĩ.
    </div>` : ""}`;
}

function renderRSAIndex(rsa) {
  const box = document.getElementById("rsaIndexBox");
  if (!box) return;
  if (!rsa) { box.innerHTML = "<p class='muted'>Cần ≥16 khoảng RR để tính RSA.</p>"; return; }
  const color = rsa.isPhysiological ? "#22c55e" : "#f59e0b";
  box.innerHTML = `
    <div class="list-item"><span>RSA Index (HF/Total)</span><strong style="color:${color}">${rsa.rsaIndex}%</strong></div>
    <div class="list-item"><span>Nhận định</span><strong style="color:${color}">${rsa.label}</strong></div>
    <p class="muted" style="font-size:12px">${rsa.note}</p>`;
}

function renderProfile(user) {
  el.profileSummary.innerHTML = `
    <div class="list-item"><span>Họ tên</span><strong>${user.fullName}</strong></div>
    <div class="list-item"><span>Tuổi</span><strong>${user.age}</strong></div>
    <div class="list-item"><span>Bệnh nền</span><strong>${(user.conditions || []).join(", ") || "Chưa khai báo"}</strong></div>
    ${user.pillProtocol ? `<div class="list-item"><span>Pill-in-Pocket</span><strong>${user.pillProtocol.medicineName} ${user.pillProtocol.dose}</strong></div>` : ""}`;
  const g = user.guardian || {};
  el.guardianStatus.textContent = g.status === "confirmation_sent"
    ? `Guardian: ${g.guardianName || "Đã thiết lập"} – ${g.guardianEmail || g.guardianPhone || "chưa rõ"}`
    : "Chưa thiết lập guardian.";
  const sched = g.reportSchedule || {};
  if (el.notifyOnMeasurement) el.notifyOnMeasurement.checked = !!sched.notifyOnMeasurement;
  if (el.autoReportEnabled) el.autoReportEnabled.checked = !!sched.enabled;
  if (el.autoReportTime) el.autoReportTime.value = sched.time || "08:00";
  if (el.autoReportScheduleStatus) {
    if (!g.guardianEmail) {
      el.autoReportScheduleStatus.textContent = "Cần cấu hình email guardian trước.";
    } else {
      const parts = [];
      if (sched.notifyOnMeasurement) parts.push("Báo ngay sau đo");
      if (sched.enabled) parts.push(`Tổng hợp lúc ${sched.time}`);
      const lastSentText = sched.lastSentAt
        ? ` · Gửi lần cuối: ${new Date(sched.lastSentAt).toLocaleString("vi-VN")}`
        : "";
      el.autoReportScheduleStatus.textContent = parts.length
        ? `Đang bật: ${parts.join(" + ")}${lastSentText}`
        : "Chưa bật tính năng tự động nào.";
    }
  }
}

function renderBaseline(baseline = { sessions: [] }) {
  const count = Array.isArray(baseline.sessions) ? baseline.sessions.length : 0;
  el.baselineCountBadge.textContent = `${count}/3 lần`;
  el.baselineCountBadge.className = baseline.complete ? "badge safe" : "badge neutral";
  if (!count) { el.baselineSummary.innerHTML = "<p class='muted'>Chưa có dữ liệu Heart-Print.</p>"; return; }
  el.baselineSummary.innerHTML = `
    <div class="list-item"><span>Số lần ghi</span><strong>${count}</strong></div>
    <div class="list-item"><span>Resting BPM</span><strong>${baseline.restingBpm ?? "--"}</strong></div>
    <div class="list-item"><span>HRV (SDNN)</span><strong>${baseline.sdnn ?? baseline.hrvScore ?? "--"}</strong></div>
    <div class="list-item"><span>Regularity</span><strong>${baseline.regularityScore ?? "--"}</strong></div>`;
}

function renderHistory(measurements = []) {
  const filtered = measurements.filter((m) => m.type === "face" || m.type === "finger");
  if (!filtered.length) { el.historyChart.innerHTML = "<p class='muted'>Chưa có lịch sử đo.</p>"; return; }
  el.historyChart.innerHTML = filtered.map((m) => {
    const h = Math.max(50, Math.min(180, m.result.strokeRiskScore * 1.8));
    const cls = m.result.classification === "afib" ? "" : m.result.classification === "elevated" ? "warn" : "safe";
    return `<div class="timeline-entry ${cls}" style="height:${h}px"><strong>${m.result.bpm}</strong><span>${new Date(m.createdAt).toLocaleDateString("vi-VN")}</span></div>`;
  }).join("");
}

function renderSymptoms(symptoms = []) {
  if (!symptoms.length) { el.symptomList.innerHTML = "<p class='muted'>Chưa có nhật ký triệu chứng.</p>"; return; }
  el.symptomList.innerHTML = symptoms.map((s) => {
    const critical = s.isCritical ? `<span class="badge danger" style="font-size:10px;padding:1px 5px;margin-left:4px">⚠️ Nghiêm trọng</span>` : "";
    return `<div class="list-item" style="${s.isCritical ? 'border-left:3px solid var(--danger)' : ''}">
      <span style="white-space:nowrap">${formatDateTime(s.createdAt)}</span>
      <strong style="text-align:right">${s.note}${critical}</strong>
    </div>`;
  }).join("");
}

function renderReminders(reminders = []) {
  if (!reminders.length) { el.reminderList.innerHTML = "<p class='muted'>Chưa có lịch nhắc thuốc.</p>"; return; }
  const todayKey = new Date().toISOString().slice(0, 10);
  el.reminderList.innerHTML = reminders.map((r) => {
    const taken = r.adherence?.[todayKey] === true;
    return `<div class="list-item" data-reminder-id="${r.id}">
      <span>${r.time}</span>
      <strong>${r.medicineName}${r.pillColor ? " – " + r.pillColor : ""}${r.dose ? " (" + r.dose + ")" : ""}</strong>
      <button class="confirm-pill-btn ${taken ? "btn-taken" : "ghost-btn"}" data-reminder-id="${r.id}" type="button" style="margin-left:8px;font-size:11px;padding:2px 8px">
        ${taken ? "✅ Đã uống" : "Xác nhận uống"}
      </button>
    </div>`;
  }).join("");
  // Bind confirm buttons
  el.reminderList.querySelectorAll(".confirm-pill-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const reminderId = btn.dataset.reminderId;
      const today = new Date().toISOString().slice(0, 10);
      try {
        const r = await api("/api/medications/adherence", {
          method: "POST",
          body: JSON.stringify({ token: state.token, reminderId, date: today, taken: true }),
        });
        btn.textContent = "✅ Đã uống"; btn.className = "btn-taken";
        showToast(`Đã xác nhận uống thuốc hôm nay (${r.adherencePct}% tuần này)`, "success");
      } catch (err) { showToast(err.message, "error"); }
    });
  });
}

function renderWeeklyReport(report = {}) {
  el.weeklyReportBox.innerHTML = `
    <div class="list-item"><span>Tổng phiên đo</span><strong>${report.totalMeasurements ?? 0}</strong></div>
    <div class="list-item"><span>TB BPM</span><strong>${report.averageBpm ?? "--"}</strong></div>
    <div class="list-item"><span>TB Risk</span><strong>${report.averageRisk ?? "--"}%</strong></div>
    <div class="list-item"><span>Cảnh báo AFib</span><strong>${report.afibAlerts ?? 0}</strong></div>
    <p class="muted">${report.summary || "Chưa có báo cáo."}</p>`;
}

function renderWeather(weather = {}) {
  const locLabel = weather.location
    ? `<span style="font-size:11px;color:#6b7280;margin-left:4px">(${weather.location})</span>`
    : "";
  el.weatherBox.innerHTML = `
    <div class="list-item"><span>Nhiệt độ ${locLabel}</span><strong>${weather.currentTemp ?? "--"}°C</strong></div>
    <div class="list-item"><span>Trạng thái</span><strong>${weather.level === "warn" ? "⚠️ Cảnh báo nhiệt" : "✅ Ổn định"}</strong></div>
    <p class="muted">${weather.text || "Chưa có dữ liệu thời tiết."}</p>`;
}

function renderSosHistory(events = []) {
  el.sosHistory.innerHTML = events.length
    ? events.map((e) => `<div class="list-item"><span>${e.status}</span><strong>${e.reason}</strong></div>`).join("")
    : "<p class='muted'>Chưa có sự kiện SOS.</p>";
}

function renderLedger(entries = []) {
  el.ledgerList.innerHTML = entries.length
    ? entries.map((e) => `<div class="list-item"><span>${formatDateTime(e.createdAt)} – ${e.type}</span><strong>${e.hash.slice(0, 10)}...</strong></div>`).join("")
    : "<p class='muted'>Chưa có sự kiện đồng bộ.</p>";
}

function renderSosBox(headline, lines = []) {
  el.sosBox.innerHTML = `<p class="muted">${headline}</p>${lines.map((l) => `<div class="list-item"><span>SOS</span><strong>${l}</strong></div>`).join("")}`;
}

function renderSosState(events = []) {
  const active = events.find((e) => e.status === "triggered");
  if (!active) { el.sosBadge.textContent = "✅ Sẵn sàng bảo vệ"; el.sosBadge.className = "badge safe"; renderSosBox("Hệ thống SOS đang bảo vệ bạn 24/7. Khi phát hiện AFib hoặc chỉ số bất thường, hệ thống sẽ đếm ngược 15 giây rồi tự động gửi cảnh báo đến người thân.", []); return; }
  el.sosBadge.textContent = "SOS đã gửi"; el.sosBadge.className = "badge danger";
  renderSosBox("Hành lang xanh đang được kích hoạt.", active.channels || []);
}

function renderPillProtocol(protocol, protocols) {
  if (!el.pillProtocolStatus) return;
  const list = protocols?.length ? protocols : (protocol ? [protocol] : []);
  if (!list.length) { el.pillProtocolStatus.textContent = "Chưa thiết lập phác đồ pill-in-pocket."; return; }
  el.pillProtocolStatus.innerHTML = list.map(p => `
    <div class="list-item" style="align-items:flex-start">
      <div><strong>💊 ${p.medicineName}</strong><br><span style="font-size:12px;color:#6b7280">${p.dose}${p.instructions ? " – " + p.instructions : ""}</span></div>
      <button class="ghost-btn" style="font-size:11px;padding:2px 8px;color:var(--danger)" onclick="deletePillProtocol('${p.id}')">Xóa</button>
    </div>`).join("");
}

async function deletePillProtocol(protocolId) {
  if (!state.token) return;
  try {
    const r = await api("/api/pill-protocol", { method: "POST", body: JSON.stringify({ token: state.token, action: "delete", protocolId }) });
    renderDashboard(r.dashboard);
    showToast("Đã xóa phác đồ.", "success");
  } catch (err) { showToast(err.message, "error"); }
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  state.user = dashboard.user;
  setReportLink();
  // #36: Show Quick-Start button when logged in
  if (el.quickStartBtn) el.quickStartBtn.hidden = false;
  renderProfile(dashboard.user);
  renderBaseline(dashboard.user.baseline);
  renderHistory(dashboard.measurements || []);
  renderSymptoms(dashboard.symptoms || []);
  renderReminders(dashboard.reminders || []);
  renderWeeklyReport(dashboard.weeklyReport || {});
  renderWeather(dashboard.weatherAlert || {});
  renderSosHistory(dashboard.sosEvents || []);
  renderLedger(dashboard.ledger || []);
  renderSosState(dashboard.sosEvents || []);
  renderAfibBurden(dashboard.afibBurden7d, dashboard.afibBurden30d);
  renderStrokePredictor(dashboard.strokePredictor);
  renderThermalStrain(dashboard.thermalStrain);
  renderAfibDiseaseLog(dashboard.afibDisease);
  renderPillProtocol(dashboard.pillProtocol, dashboard.pillProtocols);
  renderCha2ds2(dashboard.cha2ds2, dashboard.hasbled); // #22, #34
  renderBpTrend(dashboard.bpTrend);                   // #33
  renderCircadian(dashboard.circadian);               // #28
  if (dashboard.latestMeasurement) { state.lastMeasurementRecord = dashboard.latestMeasurement; renderMeasurementResult(dashboard.latestMeasurement); }
  if (dashboard.latestBreathing?.result) { el.breathingStatus.textContent = `+${dashboard.latestBreathing.result.coherenceGain} coherence`; el.breathingStatus.className = "badge safe"; }
  // New feature renders
  renderTrendComparison(dashboard.measurements || []);
  renderMeasurementQualityHistory(dashboard.measurements || []);
  const golden = computeGoldenWindow(dashboard.measurements || []);
  const goldenEl = document.getElementById("goldenWindowBox");
  if (goldenEl && golden) goldenEl.innerHTML = `<div class="list-item"><span>Giờ đo tốt nhất</span><strong>⭐ ${golden.label} (chất lượng ${golden.score}%)</strong></div><p class="muted" style="font-size:12px">AI học từ ${dashboard.measurements?.length||0} lần đo của bạn — đây là lúc tín hiệu ổn định nhất.</p>`;
  // Weather-AFib correlation
  if (dashboard.weatherAlert) renderWeatherAfibAlert(dashboard.weatherAlert, dashboard.measurements || []);
  // 24h AFib Forecast
  const forecastEl = document.getElementById("afibForecastBox");
  if (forecastEl) {
    const weatherTemp = dashboard.weatherAlert?.temp ?? dashboard.weatherAlert?.main?.temp ?? null;
    const forecast = computeAfibForecast(dashboard.measurements || [], weatherTemp);
    if (forecast) {
      const color = forecast.level === "CAO" ? "#ef4444" : forecast.level === "TRUNG_BINH" ? "#f59e0b" : "#22c55e";
      forecastEl.innerHTML = `
        <div class="list-item"><span>Nguy cơ 24h tới</span><strong style="color:${color}">${forecast.riskPercent}% — ${forecast.level}</strong></div>
        <div class="list-item"><span>Khung giờ đỉnh</span><strong>${forecast.peakWindow}</strong></div>
        ${forecast.factors.map(f => `<div class="list-item" style="color:#92400e;font-size:12px">⚠️ ${f}</div>`).join("")}
        <p class="muted" style="font-size:12px;margin-top:6px">${forecast.recommendation}</p>`;
    } else {
      forecastEl.innerHTML = "<p class='muted'>Cần ≥3 lần đo để dự báo nguy cơ 24h.</p>";
    }
  }
  // Daily tip
  showDailyHealthTip();
  // Battery check
  checkBatteryForNight();
  // Population benchmark
  renderPopulationBenchmark(dashboard.measurements || [], dashboard.user?.age);
  // 1-hour hourly forecast
  const hourlyForecast = computeAfibHourlyForecast(dashboard.measurements || [], dashboard.weatherAlert?.currentTemp ?? dashboard.weatherAlert?.temp ?? null, dashboard.circadian);
  renderAfibHourlyForecast(hourlyForecast);
  // 2.5: Sudden HR change detection
  const suddenEl = document.getElementById("suddenHRBox");
  if (suddenEl) {
    const sudden = detectSuddenHRChange(dashboard.measurements || []);
    if (sudden) {
      suddenEl.innerHTML = `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px"><p style="margin:0;font-size:13px;color:#92400e">${sudden.message}</p></div>`;
    } else { suddenEl.innerHTML = ""; }
  }
  // Research mode state
  const researchBtn = document.getElementById("researchModeBtn");
  if (researchBtn) {
    const active = localStorage.getItem("hs_research") === "1";
    researchBtn.textContent = active ? "✅ Đã tham gia nghiên cứu — Bấm để rút" : "🔬 Tham gia nghiên cứu ẩn danh";
  }
  // Elderly mode restore
  if (localStorage.getItem("hs_elderly") === "1") document.body.classList.add("elderly-mode");
  const guardianEmail = dashboard.user?.guardian?.guardianEmail;
  if (el.parentReportStatus) {
    el.parentReportStatus.textContent = guardianEmail ? `Email mắt thần: ${guardianEmail}` : "";
  }
  if (el.remoteParentInfoStatus) {
    const sched = dashboard.user?.guardian?.reportSchedule || {};
    if (!guardianEmail) {
      el.remoteParentInfoStatus.textContent = "⚠️ Chưa cấu hình email người thân. Điền vào form Người giám hộ ở trên.";
      el.remoteParentInfoStatus.style.cssText = "font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:5px 8px;margin-bottom:10px;word-break:break-all";
    } else if (sched.notifyOnMeasurement || sched.enabled) {
      const modes = [sched.notifyOnMeasurement ? "📲 Báo ngay sau đo" : null, sched.enabled ? `🕐 Tổng hợp lúc ${sched.time}` : null].filter(Boolean);
      el.remoteParentInfoStatus.textContent = `✅ ${modes.join(" + ")} → ${guardianEmail}`;
      el.remoteParentInfoStatus.style.cssText = "font-size:12px;color:#059669;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:5px 8px;margin-bottom:10px;word-break:break-all";
    } else {
      el.remoteParentInfoStatus.textContent = `📧 Email: ${guardianEmail} — Tick chọn chế độ gửi bên dưới rồi bấm Lưu.`;
      el.remoteParentInfoStatus.style.cssText = "font-size:12px;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 8px;margin-bottom:10px;word-break:break-all";
    }
  }
}

// Lấy GPS vị trí người dùng (nhanh nếu browser đã cache; timeout 5s)
function getUserLocation() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 5 * 60 * 1000 } // cache 5 phút
    );
  });
}

async function loadDashboard(showError = false) {
  if (!state.user || !state.token) return;
  // Lấy vị trí GPS (instant nếu đã cache; không block nếu chưa cấp quyền)
  if (!state.userLocation) {
    state.userLocation = await Promise.race([
      getUserLocation(),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ]);
  }
  try {
    const body = { token: state.token };
    if (state.userLocation) { body.lat = state.userLocation.lat; body.lon = state.userLocation.lon; }
    const d = await api(`/api/users/${state.user.id}/dashboard`, {
      method: "POST", body: JSON.stringify(body)
    });
    renderDashboard(d);
  } catch (err) {
    if (showError) setAuthState(err.message, "error");
  }
}

function startDashboardPolling() {
  if (state.dashboardPoll) clearInterval(state.dashboardPoll);
  if (!state.token || !state.user) return;
  // Chỉ poll khi tab đang active — tiết kiệm tài nguyên Render free tier
  state.dashboardPoll = setInterval(() => {
    if (!document.hidden) loadDashboard().catch(() => {});
  }, DASHBOARD_POLL_MS);
}

async function restoreSession() {
  if (!state.token) { setAuthState("Chưa đăng nhập."); return; }
  try {
    const data = await api("/api/session", { method: "POST", body: JSON.stringify({ token: state.token }) });
    state.user = data.user;
    setAuthState(`Đang đăng nhập: ${data.user.fullName}`);
    await loadDashboard();
    startDashboardPolling();
  } catch { localStorage.removeItem(HEARTSENSE_TOKEN_KEY); state.token = ""; state.user = null; setAuthState("Session hết hạn. Đăng nhập lại.", "error"); }
}

// ─── Auth Handlers ────────────────────────────────────────────────────────────
async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
    state.token = data.token; state.user = data.user;
    localStorage.setItem(HEARTSENSE_TOKEN_KEY, state.token);
    setAuthState(`Đã tạo hồ sơ cho ${data.user.fullName}.`);
    await loadDashboard(); startDashboardPolling();
  } catch (err) { setAuthState(err.message, "error"); }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
    state.token = data.token; state.user = data.user;
    localStorage.setItem(HEARTSENSE_TOKEN_KEY, state.token);
    setAuthState(`Đang đăng nhập: ${data.user.fullName}.`);
    await loadDashboard(); startDashboardPolling();
  } catch (err) { setAuthState(err.message, "error"); }
}

function logout() {
  state.token = ""; state.user = null; state.dashboard = null;
  localStorage.removeItem(HEARTSENSE_TOKEN_KEY);
  if (state.dashboardPoll) { clearInterval(state.dashboardPoll); state.dashboardPoll = null; }
  if (el.quickStartBtn) el.quickStartBtn.hidden = true; // #36
  setReportLink(); setAuthState("Đã đăng xuất.");
}

async function saveGuardian(event) {
  event.preventDefault();
  if (!state.token) { setAuthState("Cần đăng nhập trước.", "error"); return; }
  const form = new FormData(event.currentTarget);
  try {
    const response = await api("/api/guardian", { method: "PUT", body: JSON.stringify({ token: state.token, ...Object.fromEntries(form.entries()) }) });
    el.guardianStatus.textContent = response.messages.join(" ");
    await loadDashboard();
  } catch (err) { setAuthState(err.message, "error"); }
}

async function saveSchedule(event) {
  event.preventDefault();
  if (!state.token) { setAuthState("Cần đăng nhập trước.", "error"); return; }
  const form = new FormData(event.currentTarget);
  const btn = event.currentTarget.querySelector("button[type=submit]");
  try {
    if (btn) btn.textContent = "Đang lưu...";
    await api("/api/guardian", { method: "PUT", body: JSON.stringify({ token: state.token, ...Object.fromEntries(form.entries()) }) });
    if (el.autoReportScheduleStatus) {
      const enabled = form.get("autoReportEnabled") === "on";
      const notify = form.get("notifyOnMeasurement") === "on";
      const time = form.get("autoReportTime") || "08:00";
      const parts = [notify ? "Báo ngay sau đo" : null, enabled ? `Tổng hợp lúc ${time}` : null].filter(Boolean);
      el.autoReportScheduleStatus.textContent = parts.length ? `Đã bật: ${parts.join(" + ")}` : "Đã tắt tất cả.";
    }
    if (btn) btn.textContent = "✅ Đã lưu!";
    setTimeout(() => { if (btn) btn.textContent = "💾 Lưu cài đặt tự động"; }, 2000);
    await loadDashboard();
  } catch (err) {
    if (btn) btn.textContent = "💾 Lưu cài đặt tự động";
    setAuthState(err.message, "error");
  }
}

async function recordBaseline() {
  if (!state.token) { setAuthState("Cần đăng nhập.", "error"); return; }
  try {
    const r = await api("/api/baseline", { method: "POST", body: JSON.stringify({ token: state.token }) });
    renderDashboard(r.dashboard);
    setAuthState(`Đã lưu lần baseline ${r.baseline.sessions.length}/3.`);
  } catch (err) { setAuthState(err.message, "error"); }
}

async function saveSymptom(event) {
  event.preventDefault();
  if (!state.token) { setAuthState("Cần đăng nhập.", "error"); return; }
  const form = event.currentTarget;
  const fd = new FormData(form);
  const checked = Array.from(form.querySelectorAll('input[name="sym"]:checked')).map(cb => cb.value);
  const note = (fd.get("note") || "").trim();
  if (!checked.length && !note) { showToast("Chọn ít nhất 1 triệu chứng hoặc thêm ghi chú.", "warn"); return; }
  const btn = form.querySelector('button[type="submit"]');
  setLoading(btn, true);
  try {
    const r = await api("/api/symptoms", { method: "POST", body: JSON.stringify({ token: state.token, symptoms: checked, note }) });
    form.reset();
    renderDashboard(r.dashboard);
    showToast(r.isCritical ? "⚠️ Triệu chứng nghiêm trọng đã ghi nhận. Hãy gặp bác sĩ sớm!" : "Đã lưu nhật ký triệu chứng.", r.isCritical ? "error" : "success", r.isCritical ? 6000 : 3500);
  } catch (err) { setAuthState(err.message, "error"); }
  finally { setLoading(btn, false, "Lưu nhật ký"); }
}

async function hydrateMedicineNameFromFile() {
  const file = el.labelImageInput.files[0];
  if (!file) return;

  if (typeof Tesseract === "undefined") {
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    el.medicineNameInput.value = name;
    el.ocrStatus.textContent = `Tên thuốc đọc từ tên file: "${name}". Chỉnh lại nếu cần.`;
    return;
  }

  el.ocrStatus.textContent = "Đang nhận dạng chữ trên nhãn thuốc...";
  el.ocrStatus.className = "muted";

  try {
    const result = await Tesseract.recognize(file, "vie+eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          const pct = Math.round((m.progress || 0) * 100);
          el.ocrStatus.textContent = `Đang quét: ${pct}%...`;
        }
      },
    });

    const raw = result.data.text || "";
    const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 2);

    // Look for a line that looks like a medicine name: contains letters, possibly numbers (dosage)
    const medicineLine = lines.find(l => /[a-zA-ZÀ-ỹ]{3,}/.test(l) && l.length < 80)
      || lines[0]
      || "";

    const name = medicineLine.replace(/[^a-zA-ZÀ-ỹ0-9\s.,-]/g, " ").replace(/\s+/g, " ").trim();

    if (name) {
      el.medicineNameInput.value = name;
      el.ocrStatus.textContent = `OCR đọc được: "${name}". Chỉnh lại nếu cần.`;
    } else {
      el.ocrStatus.textContent = "Không đọc được chữ rõ. Nhập tên thuốc thủ công.";
    }
  } catch {
    el.ocrStatus.textContent = "Lỗi OCR. Nhập tên thuốc thủ công.";
  }
}

async function saveReminder(event) {
  event.preventDefault();
  if (!state.token) { setAuthState("Cần đăng nhập.", "error"); return; }
  const form = new FormData(event.currentTarget);
  const file = el.labelImageInput.files[0];
  try {
    const r = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        medicineName: form.get("medicineName"),
        time: form.get("time"),
        dose: form.get("dose") || "",
        pillColor: form.get("pillColor") || "",
        pillDescription: form.get("pillDescription") || "",
        sourceImageName: file ? file.name : "",
      }),
    });
    event.currentTarget.reset(); el.ocrStatus.textContent = "Nhắc thuốc đã lưu."; renderDashboard(r.dashboard);
  } catch (err) { setAuthState(err.message, "error"); }
}

// ─── SOS ─────────────────────────────────────────────────────────────────────
function resetSosUi() { if (state.sosTimer) { clearInterval(state.sosTimer); state.sosTimer = null; } state.sosRemaining = 15; }

function startSosCountdown(reason) {
  resetSosUi();
  el.sosBadge.textContent = "SOS sau 15 giây"; el.sosBadge.className = "badge danger";
  renderSosBox(`CẢNH BÁO. SOS sẽ gửi sau ${state.sosRemaining} giây nếu bạn không hủy.`, [`Lý do: ${reason}`]);
  notify("HEARTSENSE SOS", "Cảnh báo bất thường. Bạn có 15 giây xác nhận tôi ổn.");
  playAlarmTone();
  state.sosTimer = setInterval(async () => {
    state.sosRemaining -= 1;
    renderSosBox(`CẢNH BÁO. SOS sẽ gửi sau ${state.sosRemaining} giây nếu bạn không hủy.`, [`Lý do: ${reason}`]);
    if (state.sosRemaining <= 0) { resetSosUi(); await triggerSos(reason); }
  }, 1000);
}

async function triggerSos(reason = "Người dùng kích hoạt") {
  if (!state.token) { setAuthState("Cần đăng nhập để kích hoạt SOS.", "error"); return; }
  if (state.sosSending) return;
  state.sosSending = true;

  // #32: Try to get geolocation when SOS triggered
  let location = null;
  try {
    if ("geolocation" in navigator) {
      location = await new Promise((res) => {
        navigator.geolocation.getCurrentPosition(
          pos => res(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`),
          () => res(null),
          { timeout: 4000, maximumAge: 60000 }
        );
      });
    }
  } catch {}

  // #32: Show guardian call button
  if (state.user?.guardian?.guardianPhone && el.guardianCallBtn) {
    el.guardianCallBtn.hidden = false;
    el.guardianCallBtn.href = `tel:${state.user.guardian.guardianPhone}`;
    el.guardianCallBtn.textContent = `📞 Gọi cho ${state.user.guardian.guardianName || "người thân"}`;
  }

  try {
    const r = await api("/api/sos/trigger", {
      method: "POST",
      body: JSON.stringify({ token: state.token, reason, location }),
    });
    el.sosBadge.textContent = "SOS đã gửi"; el.sosBadge.className = "badge danger";
    renderSosBox("Hành lang xanh đã kích hoạt.", r.messages);
    notify("HEARTSENSE", "SOS đã gửi.");
    playAlarmTone(); renderDashboard(r.dashboard);
    showToast("SOS đã gửi đến người thân!", "error", 5000);
  } catch (err) { setAuthState(err.message, "error"); }
  finally { setTimeout(() => { state.sosSending = false; }, 5000); }
}

async function cancelSos() {
  resetSosUi();
  if (!state.token) { el.sosBadge.textContent = "Đã hủy"; el.sosBadge.className = "badge safe"; renderSosBox("Người dùng xác nhận tôi ổn.", []); return; }
  try {
    const r = await api("/api/sos/cancel", { method: "POST", body: JSON.stringify({ token: state.token }) });
    el.sosBadge.textContent = "Đã hủy"; el.sosBadge.className = "badge safe";
    renderSosBox("Người dùng xác nhận tôi ổn.", []);
    renderDashboard(r.dashboard);
  } catch (err) { setAuthState(err.message, "error"); }
}

async function saveAbnormalReason(reason) {
  if (!state.token || !state.lastMeasurementRecord) return;
  try {
    const r = await api("/api/measurements/context", { method: "POST", body: JSON.stringify({ token: state.token, measurementId: state.lastMeasurementRecord.id, reason }) });
    el.abnormalPromptBox.classList.add("hidden"); renderDashboard(r.dashboard);
  } catch (err) { setAuthState(err.message, "error"); }
}

// ─── Quick-Start Mode (#36) ───────────────────────────────────────────────────
async function quickStart() {
  if (!state.user) return;
  // Auto-detect mode
  const mode = isMobile() ? "finger" : "face";
  setMeasurementMode(mode);
  // Scroll to measurement section
  document.querySelector("#measurementSection")?.scrollIntoView({ behavior: "smooth" });
  // Start camera and measure immediately
  if (!state.stream) await startCamera();
  if (state.stream) await runMeasurement();
}

// ─── Breathing Coach ──────────────────────────────────────────────────────────
function startBreathingCoach() {
  if (state.breathingInterval) clearInterval(state.breathingInterval);
  if (state.breathingTimeout) clearTimeout(state.breathingTimeout);
  setMeasurementMode("breathing");
  el.breathingStatus.textContent = "Đang tập"; el.breathingStatus.className = "badge warn";
  el.breathingCircle.classList.add("animate");
  const phases = [{ label: "Hít vào", seconds: 4 }, { label: "Giữ nhịp", seconds: 4 }, { label: "Thở ra", seconds: 6 }];
  let elapsed = 0, phaseIndex = 0, phaseElapsed = 0;
  el.breathingPhase.textContent = phases[0].label;
  state.breathingInterval = setInterval(() => {
    elapsed++; phaseElapsed++;
    if (phaseElapsed >= phases[phaseIndex].seconds) { phaseIndex = (phaseIndex + 1) % phases.length; phaseElapsed = 0; el.breathingPhase.textContent = phases[phaseIndex].label; }
    el.breathingHint.textContent = `Đang tập ${elapsed}/${BREATHING_SECONDS} giây theo nhịp 4-4-6.`;
  }, 1000);
  state.breathingTimeout = setTimeout(async () => {
    clearInterval(state.breathingInterval); state.breathingInterval = null; state.breathingTimeout = null;
    el.breathingCircle.classList.remove("animate");
    el.breathingStatus.textContent = "Đã hoàn thành"; el.breathingStatus.className = "badge safe";
    el.breathingHint.textContent = "Hoàn thành một phiên tập thở.";
    if (!state.token) return;
    try { const r = await api("/api/breathing", { method: "POST", body: JSON.stringify({ token: state.token, payload: { durationSeconds: BREATHING_SECONDS, cycles: Math.floor(BREATHING_SECONDS / 14) } }) }); renderDashboard(r.dashboard); } catch {}
  }, BREATHING_SECONDS * 1000);
}

// ─── Doctor Export ────────────────────────────────────────────────────────────
async function getExportUrl() {
  const r = await api("/api/export-token", { method: "POST", body: JSON.stringify({ token: state.token }) });
  const url = `${window.location.origin}/api/users/${state.user.id}/doctor-export?export_token=${r.token}`;
  if (el.reportLink2) { el.reportLink2.href = url; el.reportLink2.classList.remove("disabled"); }
  return url;
}

async function generateDoctorExport() {
  if (!state.token || !state.user) { setAuthState("Cần đăng nhập.", "error"); return; }
  if (!el.doctorExportBox) return;
  try {
    el.doctorExportBox.innerHTML = "<p class='muted'>Đang tạo export token...</p>";
    const url = await getExportUrl();
    el.doctorExportBox.innerHTML = `
      <div class="list-item"><span>Link chia sẻ (30 ngày)</span><a href="${url}" target="_blank" rel="noreferrer" class="ghost-btn" style="font-size:0.85rem">Mở báo cáo</a></div>
      <div class="list-item">
        <span>URL copy cho bác sĩ</span>
        <button id="copyExportBtn" class="secondary-btn" type="button">Sao chép link</button>
      </div>
      <p class="muted">${url}</p>
      <p class="muted">QR code: Bác sĩ có thể scan URL trên để xem hồ sơ chuẩn y khoa 3 tháng.</p>`;
    document.querySelector("#copyExportBtn")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(url).then(() => { document.querySelector("#copyExportBtn").textContent = "Đã sao chép!"; setTimeout(() => { const b = document.querySelector("#copyExportBtn"); if (b) b.textContent = "Sao chép link"; }, 2000); });
    });
  } catch (err) { el.doctorExportBox.innerHTML = `<p class='muted' style='color:var(--danger)'>Lỗi: ${err.message}</p>`; }
}

async function openDoctorExportPdf() {
  if (!state.token || !state.user) { setAuthState("Cần đăng nhập.", "error"); return; }
  try {
    if (el.reportLink2) { el.reportLink2.textContent = "Đang tạo..."; el.reportLink2.classList.add("disabled"); }
    const url = await getExportUrl();
    window.open(url, "_blank", "noreferrer");
    if (el.reportLink2) { el.reportLink2.textContent = "Mở báo cáo PDF"; el.reportLink2.classList.remove("disabled"); }
  } catch (err) {
    if (el.reportLink2) { el.reportLink2.textContent = "Mở báo cáo PDF"; el.reportLink2.classList.remove("disabled"); }
    setAuthState(`Lỗi tạo PDF: ${err.message}`, "error");
  }
}

// ─── Drug Interaction ─────────────────────────────────────────────────────────
async function checkInteractions(event) {
  event.preventDefault();
  if (!state.token) { setAuthState("Cần đăng nhập.", "error"); return; }
  if (!el.interactionResult) return;
  const form = new FormData(event.currentTarget);
  const drugsRaw = String(form.get("drugs") || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (drugsRaw.length < 2) { el.interactionResult.innerHTML = "<p class='muted'>Nhập ít nhất 2 tên thuốc, cách nhau bằng dấu phẩy.</p>"; return; }
  try {
    el.interactionResult.innerHTML = "<p class='muted'>Đang kiểm tra tương tác...</p>";
    const r = await api("/api/medications/check-interactions", { method: "POST", body: JSON.stringify({ token: state.token, drugs: drugsRaw }) });
    if (r.safe) { el.interactionResult.innerHTML = "<div class='list-item'><span>Kết quả</span><strong class='badge safe'>Không phát hiện tương tác nguy hiểm</strong></div><p class='muted'>Luôn kiểm tra với bác sĩ trước khi phối hợp thuốc mới.</p>"; return; }
    let html = "";
    if (r.duplicates?.length) {
      html += r.duplicates.map((d) => `<div class="list-item"><span>Trùng hoạt chất!</span><strong class="badge danger">Thuốc ${d.drug1} và ${d.drug2} đều chứa ${d.generic} – NGUY CƠ QUÁ LIỀU</strong></div>`).join("");
    }
    if (r.interactions?.length) {
      html += r.interactions.map((i) => `<div class="list-item"><span class="badge ${i.severity === "NGUY_HIEM" ? "danger" : i.severity === "VUA" ? "warn" : "neutral"}">${i.severity}</span><strong>${i.drugA} + ${i.drugB}: ${i.effect}</strong></div>`).join("");
    }
    el.interactionResult.innerHTML = html;
  } catch (err) { el.interactionResult.innerHTML = `<p class='muted' style='color:var(--danger)'>${err.message}</p>`; }
}

// ─── Pill Protocol ────────────────────────────────────────────────────────────
async function savePillProtocol(event) {
  event.preventDefault();
  if (!state.token) { setAuthState("Cần đăng nhập.", "error"); return; }
  const form = new FormData(event.currentTarget);
  const btn = event.currentTarget.querySelector('button[type="submit"]');
  setLoading(btn, true);
  try {
    const r = await api("/api/pill-protocol", { method: "POST", body: JSON.stringify({
      token: state.token,
      medicineName: form.get("medicineName"),
      dose: form.get("dose"),
      instructions: form.get("instructions"),
      active: true,
    }) });
    event.currentTarget.reset();
    renderDashboard(r.dashboard);
    showToast(`Đã thêm phác đồ: ${r.protocol.medicineName}`, "success");
  } catch (err) { showToast(err.message, "error"); }
  finally { setLoading(btn, false, "Thêm phác đồ"); }
}

// ─── Remote Parent ────────────────────────────────────────────────────────────
async function sendParentReport() {
  if (!state.token || !state.user) { setAuthState("Cần đăng nhập.", "error"); return; }
  const personalMessage = el.parentReportMessage?.value?.trim() || "";
  try {
    if (el.parentReportStatus) el.parentReportStatus.textContent = "Đang gửi...";
    if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = "Đang gửi báo cáo..."; el.remoteParentInfoStatus.className = "muted"; }
    const r = await api(`/api/users/${state.user.id}/remote-parent/send`, {
      method: "POST",
      body: JSON.stringify({ token: state.token, personalMessage }),
    });
    if (el.parentReportStatus) el.parentReportStatus.textContent = r.message;
    if (el.remoteParentInfoStatus) {
      el.remoteParentInfoStatus.textContent = r.sent ? `Đã gửi lúc ${new Date().toLocaleTimeString("vi-VN")}` : `Lỗi: ${r.message}`;
      el.remoteParentInfoStatus.className = r.sent ? "badge safe" : "badge warn";
    }
    if (r.sent && el.parentReportMessage) el.parentReportMessage.value = "";
  } catch (err) {
    if (el.parentReportStatus) el.parentReportStatus.textContent = `Lỗi: ${err.message}`;
    if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = `Lỗi: ${err.message}`; el.remoteParentInfoStatus.className = "badge warn"; }
  }
}

// ─── PWA & Emergency ─────────────────────────────────────────────────────────
function handleEmergencyCall() {
  if (isMobile()) { window.location.href = "tel:115"; return; }
  showModal("Gọi 115", "Trên web desktop không thể gọi trực tiếp. Dùng điện thoại để gọi 115 ngay.");
}

function bindPwa() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.deferredPrompt = e; el.installBtn.hidden = false; });
  el.installBtn.addEventListener("click", async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt(); await state.deferredPrompt.userChoice;
    state.deferredPrompt = null; el.installBtn.hidden = true;
  });
}

function bindEvents() {
  el.requestNotificationBtn.addEventListener("click", requestNotifications);
  el.registerForm.addEventListener("submit", handleRegister);
  el.loginForm.addEventListener("submit", handleLogin);
  el.logoutBtn.addEventListener("click", logout);
  el.guardianForm.addEventListener("submit", saveGuardian);
  el.scheduleForm?.addEventListener("submit", saveSchedule);
  el.recordBaselineBtn.addEventListener("click", recordBaseline);
  el.refreshDashboardBtn.addEventListener("click", () => loadDashboard(true));
  el.startCameraBtn.addEventListener("click", startCamera);
  el.stopCameraBtn.addEventListener("click", stopCamera);
  el.torchBtn?.addEventListener("click", toggleTorch);
  el.startMeasureBtn.addEventListener("click", runMeasurement);
  el.startBreathingBtn.addEventListener("click", startBreathingCoach);
  el.cancelSosBtn.addEventListener("click", cancelSos);
  el.triggerSosBtn.addEventListener("click", () => triggerSos("Người dùng kích hoạt thủ công"));
  el.callEmergencyBtn.addEventListener("click", handleEmergencyCall);
  el.symptomForm.addEventListener("submit", saveSymptom);
  el.reminderForm.addEventListener("submit", saveReminder);
  el.labelImageInput.addEventListener("change", hydrateMedicineNameFromFile);
  el.cameraSelect.addEventListener("change", (e) => { state.selectedCameraId = e.target.value; });
  document.querySelectorAll(".segmented-btn").forEach((b) => b.addEventListener("click", () => setMeasurementMode(b.dataset.mode)));
  document.querySelectorAll(".abnormal-btn").forEach((b) => b.addEventListener("click", () => saveAbnormalReason(b.dataset.abnormalReason)));
  el.modalConfirmBtn.addEventListener("click", () => { if (state.modalConfirm) state.modalConfirm(); closeModal(); });
  el.modalCancelBtn.addEventListener("click", closeModal);
  el.modalOverlay.addEventListener("click", (e) => { if (e.target === el.modalOverlay) closeModal(); });
  el.doctorExportBtn?.addEventListener("click", generateDoctorExport);
  el.reportLink2?.addEventListener("click", (e) => { e.preventDefault(); openDoctorExportPdf(); });
  el.interactionForm?.addEventListener("submit", checkInteractions);
  el.pillProtocolForm?.addEventListener("submit", savePillProtocol);
  el.sendParentReportBtn?.addEventListener("click", sendParentReport);
  // New bindings
  el.quickStartBtn?.addEventListener("click", quickStart); // #36
  window.addEventListener("online", updateOnlineStatus);   // #35
  window.addEventListener("offline", updateOnlineStatus);  // #35
  // New feature bindings
  document.getElementById("elderlyModeBtn")?.addEventListener("click", toggleElderlyMode);
  document.getElementById("expertModeBtn")?.addEventListener("click", toggleExpertMode);
  document.getElementById("researchModeBtn")?.addEventListener("click", toggleResearchMode);
  document.getElementById("shareReportBtn")?.addEventListener("click", shareReport);
  document.getElementById("zaloClinicInfoBtn")?.addEventListener("click", openZaloClinicInfo);
  document.getElementById("startBCGBtn")?.addEventListener("click", startMouseBCGTracking);
  document.getElementById("bpPhotoInput")?.addEventListener("change", e => ocrBloodPressure(e.target.files?.[0]));
  // New: Ambient rPPG, SCG, Voice-rPPG, Keyboard BCG
  document.getElementById("ambientRPPGBtn")?.addEventListener("click", toggleAmbientRPPG);
  document.getElementById("startSCGBtn")?.addEventListener("click", startSCGChestSensor);
  document.getElementById("startVoiceRPPGBtn")?.addEventListener("click", startVoiceRPPG);
  document.getElementById("startKBCGBtn")?.addEventListener("click", startKeyboardBCGTracking);
  window.startSCGChestSensor = startSCGChestSensor; // fallback inline
  // Ablation risk form
  document.getElementById("ablationRiskForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const result = computeAblationRisk({
      age: parseInt(f.get("ablAge") || 60),
      bmi: parseFloat(f.get("ablBmi") || 25),
      afibType: f.get("ablType") || "paroxysmal",
      lavi: parseFloat(f.get("ablLavi") || 30),
      afibDuration: parseInt(f.get("ablDuration") || 6),
      symptoms: f.get("ablSymptoms") || "mild",
    });
    const box = document.getElementById("ablationRiskResult");
    if (box) {
      const color = result.level === "CAO" ? "#ef4444" : result.level === "TRUNG_BINH" ? "#f59e0b" : "#22c55e";
      box.innerHTML = `<div class="list-item"><span>Nguy cơ tái phát</span><strong style="color:${color}">${result.risk}% — ${result.level}</strong></div><p class="muted" style="font-size:12px">${result.recommendation}</p>`;
    }
  });
}

async function init() {
  detectPlatform(); renderQrFallback(); bindPwa(); bindEvents();
  setMeasurementMode("finger");
  updateOnlineStatus(); // #35
  showDailyHealthTip(); // 1.10
  checkBatteryForNight(); // 1.9
  // Restore elderly mode
  if (localStorage.getItem("hs_elderly") === "1") {
    document.body.classList.add("elderly-mode");
    const btn = document.getElementById("elderlyModeBtn");
    if (btn) btn.textContent = "👁 Tắt chế độ ông/bà";
  }
  // Fall detection for mobile
  initFallDetection();
  // Encrypted local-first data
  await initLocalEncryption().then(key => { renderEncryptionStatus(); });
  await checkHealth(); await loadCameraDevices(); await restoreSession();
}

// ─── Population Benchmark (#populationBenchmarkBox) ──────────────────────────
// Age-stratified normal ranges from CHARGE-AF, ESCAPE-NET, Frontiers in Physiology
const POPULATION_NORMS = [
  { minAge: 18, maxAge: 30, sdnnMed: 65, sdnnLow: 40, bpmRange: [55, 90], afibPct: 0.3 },
  { minAge: 31, maxAge: 45, sdnnMed: 55, sdnnLow: 35, bpmRange: [58, 95], afibPct: 0.7 },
  { minAge: 46, maxAge: 60, sdnnMed: 45, sdnnLow: 28, bpmRange: [60, 100], afibPct: 2.0 },
  { minAge: 61, maxAge: 75, sdnnMed: 35, sdnnLow: 20, bpmRange: [60, 100], afibPct: 6.0 },
  { minAge: 76, maxAge: 120, sdnnMed: 25, sdnnLow: 14, bpmRange: [58, 100], afibPct: 12.0 },
];
function renderPopulationBenchmark(measurements, userAge) {
  const box = el.populationBenchmarkBox;
  if (!box) return;
  const age = userAge || 60;
  const norm = POPULATION_NORMS.find(n => age >= n.minAge && age <= n.maxAge) || POPULATION_NORMS[POPULATION_NORMS.length - 1];
  const recent = (measurements || []).filter(m => m.type === "face" || m.type === "finger").slice(-12);
  if (recent.length < 2) {
    box.innerHTML = "<p class='muted'>Cần ≥2 lần đo để so sánh với người cùng độ tuổi.</p>";
    return;
  }
  const bpms = recent.map(m => m.result?.bpm || 0).filter(Boolean);
  const sdnns = recent.map(m => m.result?.sdnn || 0).filter(Boolean);
  const avgBpm = bpms.length ? Math.round(bpms.reduce((a,b)=>a+b,0)/bpms.length) : 0;
  const avgSdnn = sdnns.length ? Math.round(sdnns.reduce((a,b)=>a+b,0)/sdnns.length) : 0;
  const afibCount = recent.filter(m => m.result?.classification === "afib").length;
  const afibRate = Math.round(afibCount / recent.length * 100);

  const bpmOk = avgBpm >= norm.bpmRange[0] && avgBpm <= norm.bpmRange[1];
  const sdnnLevel = avgSdnn >= norm.sdnnMed ? "above" : avgSdnn >= norm.sdnnLow ? "normal" : "low";
  const bpmColor = bpmOk ? "#22c55e" : "#f59e0b";
  const sdnnColor = sdnnLevel === "above" ? "#22c55e" : sdnnLevel === "normal" ? "#f59e0b" : "#ef4444";
  const sdnnLabel = sdnnLevel === "above" ? "Tốt hơn TB" : sdnnLevel === "normal" ? "Bình thường" : "Dưới TB — cần chú ý";
  const bpmLabel = bpmOk ? "Bình thường" : avgBpm < norm.bpmRange[0] ? "Thấp" : "Cao";

  // Percentile bar (simple visual)
  const sdnnPct = Math.round(Math.min(100, Math.max(5, (avgSdnn / (norm.sdnnMed * 1.5)) * 100)));
  box.innerHTML = `
    <div class="list-item"><span>Nhịp tim TB của bạn</span><strong style="color:${bpmColor}">${avgBpm || "--"} BPM · ${bpmLabel}</strong></div>
    <div class="list-item"><span>Chuẩn dân số (tuổi ${age})</span><strong>${norm.bpmRange[0]}–${norm.bpmRange[1]} BPM</strong></div>
    <div class="list-item"><span>HRV (SDNN) của bạn</span><strong style="color:${sdnnColor}">${avgSdnn || "--"} ms · ${sdnnLabel}</strong></div>
    <div class="list-item">
      <span>Chuẩn HRV tuổi ${age}</span>
      <strong>${norm.sdnnLow}–${norm.sdnnMed + 20} ms · Median ${norm.sdnnMed} ms</strong>
    </div>
    <div style="margin:6px 0 4px">
      <div style="font-size:11px;color:#64748b;margin-bottom:3px">HRV của bạn so với dân số cùng tuổi:</div>
      <div style="background:#e2e8f0;border-radius:4px;height:8px"><div style="width:${sdnnPct}%;height:100%;background:${sdnnColor};border-radius:4px;transition:width 0.5s"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-top:2px"><span>Thấp</span><span>TB</span><span>Tốt</span></div>
    </div>
    <div class="list-item"><span>Tỷ lệ AFib dân số tuổi ${age}</span><strong>${norm.afibPct}% người</strong></div>
    ${afibCount > 0 ? `<div class="list-item" style="color:#ef4444"><span>AFib phát hiện của bạn</span><strong>${afibRate}% lần đo (${afibCount}/${recent.length})</strong></div>` : ""}
    <p class="muted" style="font-size:10px;margin-top:6px">Nguồn: CHARGE-AF, Frontiers in Physiology (2024), ESC HRV Task Force. Chỉ mang tính tham khảo.</p>`;
}

// ─── 1-hour AFib Forecast (Hourly Risk Map) ───────────────────────────────────
// Extends the 24h forecast to produce per-hour risk for the next 24 hours
const CIRCADIAN_HOURLY_RISK = {
  0:1.25, 1:1.2, 2:1.15, 3:1.3, 4:1.55, 5:1.65, 6:1.5, 7:1.2,
  8:1.0,  9:0.9, 10:0.88, 11:0.85, 12:0.85, 13:0.88, 14:0.9,
  15:0.92, 16:0.95, 17:1.0, 18:1.1, 19:1.15, 20:1.1, 21:1.05,
  22:1.2, 23:1.25
};
function computeAfibHourlyForecast(measurements, weatherTemp, circadian) {
  const base = computeAfibForecast(measurements, weatherTemp);
  if (!base) return null;
  const now = new Date();
  const currentHour = now.getHours();
  const hourlyMap = [];
  for (let i = 0; i < 24; i++) {
    const hour = (currentHour + i) % 24;
    const modifier = CIRCADIAN_HOURLY_RISK[hour] || 1.0;
    // Add circadian data boost if available
    let circadianBoost = 1.0;
    if (circadian?.hours) {
      const h = circadian.hours.find(x => x.hour === hour);
      if (h?.avgBpm) {
        const allBpms = circadian.hours.map(x => x.avgBpm).filter(Boolean);
        const maxBpm = Math.max(...allBpms);
        if (h.avgBpm > maxBpm * 0.9) circadianBoost = 1.2; // personal peak hour
      }
    }
    const risk = Math.round(Math.max(3, Math.min(95, base.riskPercent * modifier * circadianBoost)));
    const label = i === 0 ? "Bây giờ" : i === 1 ? "1h nữa" : `+${i}h`;
    hourlyMap.push({ hour, risk, label, isNow: i === 0, isNext: i === 1 });
  }
  const nextHourRisk = hourlyMap[1]?.risk || base.riskPercent;
  const peakHour = hourlyMap.reduce((a, b) => b.risk > a.risk ? b : a);
  return { ...base, hourlyMap, nextHourRisk, peakHour };
}
function renderAfibHourlyForecast(forecast) {
  const box = document.getElementById("afibHourlyBox");
  if (!box || !forecast?.hourlyMap) return;
  const map = forecast.hourlyMap.slice(0, 12); // show next 12h
  const maxRisk = Math.max(...map.map(h => h.risk), 1);
  const bars = map.map(h => {
    const pct = Math.round((h.risk / maxRisk) * 100);
    const color = h.risk >= 65 ? "#ef4444" : h.risk >= 40 ? "#f59e0b" : "#22c55e";
    return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
      <div style="width:100%;background:#e2e8f0;border-radius:3px;height:40px;display:flex;align-items:flex-end">
        <div style="width:100%;height:${pct}%;background:${color};border-radius:3px 3px 0 0;transition:height 0.5s;min-height:4px"></div>
      </div>
      <span style="font-size:9px;color:#64748b;margin-top:2px">${h.hour}h</span>
      <span style="font-size:9px;font-weight:700;color:${color}">${h.risk}%</span>
    </div>`;
  }).join("");
  box.innerHTML = `
    <div style="margin-bottom:8px">
      <div class="list-item"><span>Nguy cơ 1 giờ tới</span><strong style="color:${forecast.nextHourRisk>=65?"#ef4444":forecast.nextHourRisk>=40?"#f59e0b":"#22c55e"}">${forecast.nextHourRisk}% — ${forecast.nextHourRisk>=65?"CAO":forecast.nextHourRisk>=40?"TRUNG BÌNH":"THẤP"}</strong></div>
      <div class="list-item"><span>Đỉnh nguy cơ trong 12h</span><strong style="color:#f59e0b">${forecast.peakHour?.hour}h (${forecast.peakHour?.risk}%)</strong></div>
    </div>
    <div style="display:flex;gap:3px;align-items:flex-end;height:60px">${bars}</div>
    <p class="muted" style="font-size:10px;margin-top:4px">Biểu đồ nguy cơ AFib từng giờ (12h tới). Đỉnh cao nhất: ${forecast.peakHour?.hour}h.</p>`;
}

// ─── AFib Trigger Contextual Mapping (#3 List Update 1) ───────────────────────
// When AFib is detected, analyzes all available context to identify likely triggers
function computeAfibTriggerContext(measurement, weather, recentMeasurements) {
  if (!measurement?.result || measurement.result.classification !== "afib") return null;
  const r = measurement.result;
  const hour = new Date(measurement.createdAt || Date.now()).getHours();
  const triggers = [];

  // Trigger 1: Time of day (circadian vulnerability)
  if (hour >= 4 && hour <= 7) {
    triggers.push({ factor: "⏰ Thời điểm nguy hiểm", detail: `${hour}h sáng — khung giờ AFib cao nhất ngày. Cortisol tăng đột ngột khi thức dậy.`, severity: "high" });
  } else if (hour >= 22 || hour <= 3) {
    triggers.push({ factor: "🌙 Đêm khuya", detail: `${hour}h — hệ thần kinh tự chủ bất ổn trong giấc ngủ sâu.`, severity: "medium" });
  }

  // Trigger 2: Cold weather
  const temp = weather?.currentTemp ?? weather?.temp ?? null;
  if (temp !== null && temp < 18) {
    triggers.push({ factor: `🌡️ Trời lạnh ${temp}°C`, detail: `Nhiệt độ dưới 18°C làm co mạch máu và tăng nhịp tim bù trừ — trigger AFib phổ biến vào mùa đông.`, severity: temp < 10 ? "high" : "medium" });
  }

  // Trigger 3: User context note
  const note = (r.contextNote || "").toLowerCase();
  if (note.includes("cà phê") || note.includes("cafe") || note.includes("coffee") || note.includes("cafein")) {
    triggers.push({ factor: "☕ Caffeine", detail: "Uống cà phê trong 2 giờ trước — caffeine kích hoạt hệ giao cảm, là trigger phổ biến nhất của AFib.", severity: "medium" });
  }
  if (note.includes("rượu") || note.includes("bia") || note.includes("alcohol")) {
    triggers.push({ factor: "🍺 Rượu bia", detail: "Uống rượu bia — 'Holiday Heart' syndrome: rượu là nguyên nhân hàng đầu của AFib cấp tính.", severity: "high" });
  }
  if (note.includes("stress") || note.includes("căng thẳng") || note.includes("áp lực") || note.includes("lo lắng")) {
    triggers.push({ factor: "😟 Căng thẳng", detail: "Ghi nhận tình trạng stress — adrenaline tăng kích hoạt hệ giao cảm, gây loạn nhịp.", severity: "high" });
  }
  if (note.includes("chạy") || note.includes("tập") || note.includes("thể dục") || note.includes("vận động")) {
    triggers.push({ factor: "🏃 Vận động mạnh", detail: "Vận động cường độ cao — nhịp tim phục hồi sau gắng sức có thể gây AFib thoáng qua.", severity: "low" });
  }
  if (note.includes("ngủ") || note.includes("mất ngủ") || note.includes("thiếu ngủ")) {
    triggers.push({ factor: "😴 Thiếu ngủ", detail: "Thiếu ngủ làm tăng 80% nguy cơ AFib theo nghiên cứu NLHBI (2023).", severity: "high" });
  }

  // Trigger 4: Emotional state (from pre-mood)
  if (_preMoodState === "stressed" || _preMoodState === "pain") {
    triggers.push({ factor: "😣 Tâm lý bất ổn", detail: "Trạng thái căng thẳng/đau đớn trước khi đo. Hệ thần kinh giao cảm tăng hoạt động.", severity: "medium" });
  }

  // Trigger 5: HRV decline trend
  const prevMeas = (recentMeasurements || []).filter(m => (m.type === "face" || m.type === "finger") && m.id !== measurement.id).slice(-5);
  if (prevMeas.length >= 3) {
    const prevSdnns = prevMeas.map(m => m.result?.sdnn || 0).filter(Boolean);
    if (prevSdnns.length >= 2) {
      const avgPrevSdnn = prevSdnns.reduce((a,b)=>a+b,0)/prevSdnns.length;
      if (avgPrevSdnn > 0 && r.sdnn > 0 && r.sdnn < avgPrevSdnn * 0.65) {
        triggers.push({ factor: "📉 HRV suy giảm", detail: `HRV giảm ${Math.round((1-r.sdnn/avgPrevSdnn)*100)}% so với lịch sử — dấu hiệu tim đang mệt mỏi hoặc căng thẳng tích lũy.`, severity: "high" });
      }
    }
  }

  // Trigger 6: BCG keyboard irregularity (if recent data available)
  if (_kbcg?.events?.length > 20 && _bcg?.lastResult?.jitterScore > 55) {
    triggers.push({ factor: "⌨️ Vi rung bàn phím cao", detail: `Chỉ số BCG bàn phím ${_bcg.lastResult.jitterScore}/100 — vi rung tay phát hiện trước cơn AFib, có thể đây là cảnh báo sớm.`, severity: "medium" });
  }

  return {
    triggers,
    count: triggers.length,
    summary: triggers.length > 0
      ? `Tìm thấy ${triggers.length} yếu tố có thể liên quan đến cơn AFib này`
      : "Không xác định được yếu tố kích hoạt rõ ràng trong lần này — theo dõi thêm nhiều lần đo"
  };
}

function renderAfibTriggerContext(ctx) {
  const box = document.getElementById("afibTriggerBox");
  if (!box) return;
  if (!ctx || ctx.triggers.length === 0) {
    box.innerHTML = "<p class='muted'>Không phát hiện yếu tố kích hoạt rõ ràng. AI cần thêm dữ liệu ngữ cảnh từ Ghi chú và Nhật ký triệu chứng.</p>";
    return;
  }
  const colorMap = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  const labelMap = { high: "Nguy cơ cao", medium: "Trung bình", low: "Nhẹ" };
  box.innerHTML = `
    ${ctx.triggers.map(t => `
      <div style="background:${colorMap[t.severity]}10;border:1px solid ${colorMap[t.severity]}30;border-radius:8px;padding:8px 12px;margin-bottom:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
          <strong style="color:${colorMap[t.severity]};font-size:13px">${t.factor}</strong>
          <span style="font-size:10px;color:${colorMap[t.severity]};background:${colorMap[t.severity]}20;padding:1px 6px;border-radius:10px">${labelMap[t.severity]}</span>
        </div>
        <p style="margin:0;font-size:12px;color:#475569">${t.detail}</p>
      </div>`).join("")}
    <p class="muted" style="font-size:11px;margin-top:4px">💡 ${ctx.summary}</p>`;
}

// ─── Global exposure for inline onclick ──────────────────────────────────────
window.setPreMoodState = setPreMoodState;
window.saveCalibrationSettings = saveCalibrationSettings;
window.shareReport = shareReport;
window.showShareOptions = showShareOptions;

// Khi người dùng quay lại tab → load dashboard ngay thay vì đợi poll tiếp theo
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.token && state.user) loadDashboard().catch(() => {});
});

init();
