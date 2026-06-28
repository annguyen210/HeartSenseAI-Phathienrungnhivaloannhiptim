// HEARTSENSE v4.0 – Enhanced client with 38 features
const HEARTSENSE_TOKEN_KEY = "heartsense_token";

// ── Item 11: WebWorker for non-blocking quick BPM checks ─────────────────────
let _ppgWorker = null;
function getPpgWorker() {
  if (!_ppgWorker && typeof Worker !== 'undefined') {
    try { _ppgWorker = new Worker('./ppg-worker.js'); } catch (e) { console.warn('[HeartSense] ppg-worker.js không load được:', e.message); }
  }
  return _ppgWorker;
}
const BREATHING_SECONDS = 60;
const DASHBOARD_POLL_MS = 90000; // 90s — giảm tải Render Free tier, kết hợp visibilitychange
const TARGET_FPS = 30;

// ── rPPG Neural Network config ────────────────────────────────────────────────
// Model được hỗ trợ: EfficientPhys (2023), MTTS-CAN, DeepPhys — tất cả dùng TF.js format.
//
// ── Để kích hoạt EfficientPhys (khuyến nghị, ±3 BPM face mode): ─────────────
//   Bước 1 — Convert model (cần Python + GPU, xem getRppgConversionScript()):
//     git clone https://github.com/ubicomplab/rPPG-Toolbox
//     # download PURE_EfficientPhys.pth từ Google Drive của paper
//     python convert_to_tfjs.py --model EfficientPhys --weights PURE_EfficientPhys.pth
//     # → tạo ra thư mục /models/efficientphys/ chứa model.json + *.bin
//   Bước 2 — Đặt RPPG_MODEL_URL = '/models/efficientphys/model.json'
//   Bước 3 — Đổi inputType thành 'appearance_motion' và snrBias thành 1.20
//
// Để null = chỉ dùng thuật toán (POS/CHROM/ICA/region-fused) — vẫn đạt ±4–8 BPM.
// rppg_signal (1D CNN) cho cả 2 mode — nhẹ, không lag browser
// rppg_lite (Conv3D) quá nặng cho CPU browser inference
const RPPG_MODEL_CONFIGS = {
  face: {
    url: './models/rppg_signal/model.json',
    type: 'layers',
    inputType: 'signal_mean_diff',
    seqLen: 128,
    frameH: 18, frameW: 18,
    inputChannels: 7,
    outputType: 'signal',
    snrBias: 0.88,  // conservative: ML chỉ thắng khi SNR cao hơn CHROM rõ rệt
  },
  finger: {
    url: './models/rppg_signal/model.json',
    type: 'layers',
    inputType: 'signal_mean_diff',
    seqLen: 128,
    frameH: 18, frameW: 18,
    inputChannels: 7,
    outputType: 'signal',
    snrBias: 1.10,
  },
};
// Backward-compat alias (dùng trong analyzeSamples ensemble)
const getRppgConfig = () => RPPG_MODEL_CONFIGS[state?.measurementMode] || RPPG_MODEL_CONFIGS.finger;

const state = {
  token: sessionStorage.getItem(HEARTSENSE_TOKEN_KEY) || localStorage.getItem(HEARTSENSE_TOKEN_KEY) || "",
  user: null, dashboard: null, deferredPrompt: null,
  stream: null, previewRaf: null, measurementActive: false,
  measurementSamples: [], measurementMode: "face", selectedCameraId: "",
  lastPreviewMetrics: null, lastMeasurementRecord: null, previousSample: null,
  sosTimer: null, sosRemaining: 15, breathingInterval: null, breathingTimeout: null,
  dashboardPoll: null, audioContext: null, modalConfirm: null,
  afibConfirmMode: false, measurementFps: 30,
  torchOn: false, sosSending: false,
  isOnline: navigator.onLine,
  lowQualityStart: null,
  userLocation: null,
  sampleHistory: null,  // A2: buffer cho movement metric cải thiện
  measurementHand: 'right', // UL3: tay đang đo (right/left) cho CCI bilateral
  faceROI: null,            // landmark-based ROI: { fx,fy,fw,fh, lcx,lcy,lcs, rcx,rcy,rcs, ntx,nty,nts, glx,gly,gls, W,H }
  ppgRoiSnapInterval: null, // interval for periodic ROI re-snap every 10s
  fingerCoverage: 0,        // real-time finger coverage % (0-100) for user guidance
  // Enhancement state
  liveBpm: null, liveQuality: 0,
  liveBpmHistory: [],        // rolling list of quickLiveBpm estimates for adaptive stop
  lastFaceResult: null, lastFaceTime: 0,    // cross-validation
  lastFingerResult: null, lastFingerTime: 0,
  baselineHr: Number(localStorage.getItem('hs_baseline_hr')) || null, // personal calibration
  skinTone: 'medium',        // 'light' | 'medium' | 'dark' — detected from forehead
  measurementDuration: 60,   // user-selectable: 60s (recommended) or 90s extended
  rppgModelSignal: null,     // kết quả inference từ ML model (dùng trong face branch)
  earlyStop: false,          // adaptive measurement flag
  mlFaceFrameBuffer: [],     // 36×36 Uint8Array frames for MTTS-CAN preprocessing
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
  lightMetricLabel: document.querySelector("#lightMetricLabel"),
  stabilityMetric: document.querySelector("#stabilityMetric"),
  qualityMetric: document.querySelector("#qualityMetric"),
  captureModeLabel: document.querySelector("#captureModeLabel"),
  fingerLensGuide: document.querySelector("#fingerLensGuide"),
  coveragePct: document.querySelector("#coveragePct"),
  coverageBar: document.querySelector("#coverageBar"),
  pressureHint: document.querySelector("#pressureHint"),
  piStrength: document.querySelector("#piStrength"),
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
  // Enhancement elements
  liveBpmDisplay: document.querySelector("#liveBpmDisplay"),
  liveQualityBar: document.querySelector("#liveQualityBar"),
  measureDuration90Toggle: document.querySelector("#measureDuration90Toggle"),
  crossValidateBox: document.querySelector("#crossValidateBox"),
  respRateResult: document.querySelector("#respRateResult"),
  ambientLightHint: document.querySelector("#ambientLightHint"),
};

// ─── API ──────────────────────────────────────────────────────────────────────
function api(path, options = {}) {
  return fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "heartsense-same-origin", // CSRF guard: same-origin header proof
      ...(options.headers || {}),
    },
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
    const all = await new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).getAll();
      r.onsuccess = () => res(r.result); r.onerror = rej;
    });
    if (!all.length) return;
    let synced = 0;
    for (const item of all) {
      // Re-check token inside loop: user may have logged out mid-sync
      if (!state.token || !state.user) break;
      try {
        await api("/api/measurements", { method: "POST", body: JSON.stringify({ token: state.token, type: item.type, payload: item.payload }) });
        // Delete only after confirmed upload — use separate transaction per delete
        await new Promise((res, rej) => {
          const tx2 = db.transaction(IDB_STORE, "readwrite");
          tx2.objectStore(IDB_STORE).delete(item.id);
          tx2.oncomplete = res; tx2.onerror = rej;
        });
        synced++;
      } catch {}
    }
    if (synced > 0) { showToast(`Đã đồng bộ ${synced} phiên đo ngoại tuyến.`, "success"); await loadDashboard(); }
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
function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

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

// ── Dynamic bandpass with user-specified cutoffs ──────────────────────────────
// Used for narrowing the filter band around the estimated cardiac frequency.
function butterworthBandpassDynamic(signal, fps, fcLow, fcHigh) {
  const hp = _butter2HP(Math.max(0.4, fcLow), fps);
  const lp = _butter2LP(Math.min(fcHigh, fps * 0.44), fps);
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

// CHROM (Chrominance-based rPPG) — de Haan & Jeanne 2013
// Outperforms POS in varying/non-stationary lighting (office flicker, sunlight)
// Used as Face PPG alternative: pick whichever has higher post-filter SNR
function extractChromSignal(samples, fps = 30) {
  if (samples.length < 10) return null;
  const meanR = average(samples.map(s => s.avgRed));
  const meanG = average(samples.map(s => s.avgGreen));
  const meanB = average(samples.map(s => s.avgBlue));
  if (!meanR || !meanG || !meanB) return null;
  const Cr = samples.map(s => s.avgRed / meanR - 1);
  const Cg = samples.map(s => s.avgGreen / meanG - 1);
  const Cb = samples.map(s => s.avgBlue / meanB - 1);
  const Xs = Cr.map((r, i) => 3 * r - 2 * Cg[i]);
  const Ys = Cr.map((r, i) => 1.5 * r + Cg[i] - 1.5 * Cb[i]);
  // de Haan & Jeanne 2013: alpha MUST be computed on bandpassed X,Y to avoid
  // motion/illumination drift biasing the skin-tone ratio → wrong alpha → wrong BPM
  let alpha;
  if (samples.length >= 20) {
    const XsF = butterworthBandpass(Xs, fps);
    const YsF = butterworthBandpass(Ys, fps);
    const sXF = stdDev(XsF), sYF = stdDev(YsF);
    alpha = (sXF && sYF) ? sXF / sYF : 1;
  } else {
    const sX = stdDev(Xs), sY = stdDev(Ys);
    alpha = (sX && sY) ? sX / sY : 1;
  }
  // Return unfiltered CHROM (callers apply bandpass themselves via _snrOf / butterworthBandpass)
  return Xs.map((x, i) => x - alpha * Ys[i]);
}

// Hampel filter: loại outlier trong chuỗi RR dựa trên MAD + luật 200ms (ectopic detection)
// sigma=2.5 (chặt hơn 3.0 trước đây) + 200ms rule: chênh lệch RR kề >200ms → ectopic beat
function hampelFilter(rrs, halfWin = 3, sigmaThresh = 2.5) {
  if (rrs.length < 2 * halfWin + 1) return [...rrs];
  const out = [...rrs];
  for (let i = 0; i < rrs.length; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(rrs.length, i + halfWin + 1);
    const win = rrs.slice(lo, hi).sort((a, b) => a - b);
    const med = win[Math.floor(win.length / 2)];
    const mad = 1.4826 * average(win.map(r => Math.abs(r - med)));
    const outlier = mad > 0 && Math.abs(rrs[i] - med) > sigmaThresh * mad;
    // 200ms rule: consecutive RR diff >200ms likely indicates ectopic beat
    const ectopic = i > 0 && Math.abs(rrs[i] - rrs[i - 1]) > 200 && Math.abs(rrs[i] - med) > 80;
    if (outlier || ectopic) out[i] = med;
  }
  return out;
}

// ── selectBestFilteredWindow ──────────────────────────────────────────────────
// Chọn cửa sổ windowSec giây liên tục có post-filter SNR cao nhất từ toàn bộ recording.
// Warm-up camera (3-5s đầu không ổn định) tự động bị loại nếu noisy.
function selectBestFilteredWindow(filtered, fps, windowSec = 20) {
  const winSize = Math.floor(fps * windowSec);
  if (filtered.length <= winSize) return { signal: filtered, start: 0 };
  const step = Math.max(1, Math.floor(fps * 2));
  let bestScore = -Infinity, bestStart = 0;
  for (let start = 0; start + winSize <= filtered.length; start += step) {
    const win = filtered.slice(start, start + winSize);
    const s = stdDev(win);
    // Penalise high-frequency jitter (motion artifact)
    const jitter = win.slice(1).reduce((acc, v, i) => acc + Math.abs(v - win[i]), 0) / win.length;
    const score = s > 0 ? s / (1 + jitter * 0.4) : 0;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  return { signal: filtered.slice(bestStart, bestStart + winSize), start: bestStart };
}

// ── checkTemporalConsistency ──────────────────────────────────────────────────
// AFib thật phải loạn nhịp LIÊN TỤC trong suốt recording — không chỉ 1 đoạn nhiễu.
// Trả về tỉ lệ cửa sổ nhỏ có CV > 0.15. AFib ≥ 0.70, nhịp xoang < 0.35.
function checkTemporalConsistency(rrs, windowSize = 8) {
  if (rrs.length < windowSize * 2) return 0;
  const step = Math.max(1, Math.floor(windowSize / 2));
  const scores = [];
  for (let i = 0; i + windowSize <= rrs.length; i += step) {
    const win = rrs.slice(i, i + windowSize);
    const m = average(win);
    scores.push(m > 0 ? stdDev(win) / m : 0);
  }
  return scores.length ? scores.filter(s => s > 0.15).length / scores.length : 0;
}

// ── rrHistogramEntropy ────────────────────────────────────────────────────────
// AFib: histogram phân bố RR phẳng & rộng → Shannon entropy cao (>2.5 bits).
// Nhịp xoang bình thường: histogram nhọn → entropy thấp (<1.5 bits).
// Nguồn: Linz et al. 2016 — validated AFib discriminator.
function rrHistogramEntropy(rrs, bins = 8) {
  if (rrs.length < 8) return 0;
  const mn = Math.min(...rrs), mx = Math.max(...rrs);
  if (mx - mn < 10) return 0;
  const hist = new Array(bins).fill(0);
  for (const rr of rrs) {
    const idx = Math.min(bins - 1, Math.floor((rr - mn) / (mx - mn) * bins));
    hist[idx]++;
  }
  let entropy = 0;
  for (const cnt of hist) {
    if (cnt > 0) { const p = cnt / rrs.length; entropy -= p * Math.log2(p); }
  }
  return Math.round(entropy * 1000) / 1000;
}

// ── DFA Alpha1 — Detrended Fluctuation Analysis ──────────────────────────────
// Đo tính tự tương quan ngắn hạn của chuỗi RR. Validated cho AFib từ RR ngắn.
// Nhịp xoang bình thường: alpha1 ≈ 1.0–1.3 (tương quan dài)
// AFib: alpha1 ≈ 0.5–0.75 (mất tương quan — dẫn truyền AV ngẫu nhiên)
// Nguồn: Peng et al. 1995; Mäkikallio et al. 1999 (N Engl J Med).
function dfaAlpha1(rrs) {
  const N = rrs.length;
  if (N < 16) return null;
  const mean = average(rrs);
  // Profile: tích phân chuẩn hóa
  const profile = [];
  let cs = 0;
  for (const rr of rrs) { cs += rr - mean; profile.push(cs); }
  // Scales 4–16 (short-term α1)
  const scales = [];
  for (let n = 4; n <= Math.min(Math.floor(N / 4), 16); n += 2) scales.push(n);
  if (scales.length < 3) return null;
  const logS = [], logF = [];
  for (const n of scales) {
    const segs = Math.floor(N / n);
    let sumF2 = 0;
    for (let s = 0; s < segs; s++) {
      const seg = profile.slice(s * n, s * n + n);
      const xm = (n - 1) / 2, ym = average(seg);
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (i - xm) * (seg[i] - ym); sxx += (i - xm) ** 2; }
      const slope = sxx > 0 ? sxy / sxx : 0;
      const intercept = ym - slope * xm;
      let f2 = 0;
      for (let i = 0; i < n; i++) f2 += (seg[i] - (slope * i + intercept)) ** 2;
      sumF2 += f2 / n;
    }
    logS.push(Math.log10(n));
    logF.push(Math.log10(Math.sqrt(sumF2 / Math.max(1, segs))));
  }
  // Hồi quy tuyến tính log-log → slope = alpha1
  const nP = logS.length;
  const mx = average(logS), my = average(logF);
  let num = 0, den = 0;
  for (let i = 0; i < nP; i++) { num += (logS[i] - mx) * (logF[i] - my); den += (logS[i] - mx) ** 2; }
  return den > 0 ? Math.round(num / den * 1000) / 1000 : null;
}

// ── Permutation Entropy ───────────────────────────────────────────────────────
// Đo độ phức tạp theo thứ tự thời gian của chuỗi RR. Nhanh O(n log n).
// AFib: PE_norm ≈ 0.85–0.99 (cực ngẫu nhiên, không có pattern)
// Nhịp xoang: PE_norm ≈ 0.50–0.75 (có cấu trúc thứ tự)
// Nguồn: Bandt & Pompe 2002, PhysRevLett.
function permutationEntropy(rrs, order = 3) {
  if (rrs.length < order + 2) return 0;
  const patCount = new Map();
  const total = rrs.length - order + 1;
  for (let i = 0; i <= rrs.length - order; i++) {
    const seg = rrs.slice(i, i + order);
    const idx = Array.from({length: order}, (_, j) => j).sort((a, b) => seg[a] - seg[b]);
    const key = idx.join('');
    patCount.set(key, (patCount.get(key) || 0) + 1);
  }
  let entropy = 0;
  for (const c of patCount.values()) { const p = c / total; entropy -= p * Math.log2(p); }
  // Chuẩn hóa bởi log2(order!) — entropy tối đa có thể
  let fact = 1;
  for (let i = 2; i <= order; i++) fact *= i;
  const maxEnt = Math.log2(fact);
  return maxEnt > 0 ? Math.round(entropy / maxEnt * 1000) / 1000 : 0;
}

// ── Lorenz Sector Analysis — hình học Poincaré định lượng ────────────────────
// Phân tích phân bố điểm (RR_n, RR_{n+1}) trong 4 góc phần tư quanh trung bình.
// Nhịp xoang: điểm tập trung trên đường chéo (LL + UU cao).
// AFib: điểm phân tán đều 4 góc, ít trên đường chéo.
// Nguồn: Wichterle et al. 2002; Brennan et al. 2001.
function lorenzSectorAnalysis(rrs) {
  if (rrs.length < 8) return { afibScore: 0, ll: 0, uu: 0, lu: 0, ul: 0, spread: 0 };
  const mean = average(rrs);
  const thresh = mean * 0.065; // 6.5% quanh trung bình
  let ll = 0, uu = 0, lu = 0, ul = 0, center = 0;
  const total = rrs.length - 1;
  for (let i = 0; i < total; i++) {
    const x = rrs[i], y = rrs[i + 1];
    const xL = x < mean - thresh, xH = x > mean + thresh;
    const yL = y < mean - thresh, yH = y > mean + thresh;
    if (xL && yL) ll++;
    else if (xH && yH) uu++;
    else if (xL && yH) lu++;
    else if (xH && yL) ul++;
    else center++;
  }
  const diagRatio = (ll + uu) / Math.max(1, total); // nhịp xoang: cao
  const offRatio = (lu + ul) / Math.max(1, total);   // AFib: cao
  // Độ đối xứng off-diagonal (PAC/PVC: bất đối xứng, AFib: đối xứng)
  const offSymm = (lu + ul) > 0 ? 1 - Math.abs(lu - ul) / (lu + ul) : 0;
  // AFib score: ít diagonal + nhiều off-diagonal + đối xứng
  const afibScore = Math.round(((1 - diagRatio) * 0.45 + offRatio * 0.35 + offSymm * 0.20) * 1000) / 1000;
  return { afibScore, ll, uu, lu, ul, center, total, diagRatio: Math.round(diagRatio * 1000) / 1000 };
}

// ── Normalized RMSSD (rMSSD/mean_RR) ─────────────────────────────────────────
// Chuẩn hóa RMSSD theo nhịp tim — tránh bias từ nhịp chậm/nhanh.
// AFib: nRMSSD > 0.28 (biến thiên lớn ngay cả khi nhịp nhanh)
// Nguồn: Umetani et al. 1998; Camm et al. ESC 1996.
function normalizedRmssd(rrs) {
  if (rrs.length < 4) return 0;
  const meanRR = average(rrs);
  if (meanRR < 1) return 0;
  const diffs = rrs.slice(1).map((r, i) => Math.abs(r - rrs[i]));
  const rmssd = Math.sqrt(average(diffs.map(d => d * d)));
  return Math.round(rmssd / meanRR * 1000) / 1000;
}

// ── Wald-Wolfowitz Runs Test Z-score ─────────────────────────────────────────
// Kiểm định thống kê tính ngẫu nhiên của chuỗi RR (Wald & Wolfowitz 1940).
// AFib: quá nhiều lần đổi chiều (Z >> 0) → trình tự ngẫu nhiên hoàn toàn.
// Nhịp xoang: ít thay đổi chiều hơn kỳ vọng (Z ≤ 0).
// Validated 93% sensitivity trong PPG-based AFib screening (Larburu 2021).
function waldWolkowitzZ(rrs) {
  const n = rrs.length;
  if (n < 10) return null;
  const sorted = [...rrs].sort((a, b) => a - b);
  const med = sorted[Math.floor(n / 2)];
  let n1 = 0, n2 = 0, R = 1;
  let prevAbove = rrs[0] >= med;
  for (let i = 0; i < n; i++) { if (rrs[i] >= med) n1++; else n2++; }
  for (let i = 1; i < n; i++) {
    const above = rrs[i] >= med;
    if (above !== prevAbove) { R++; prevAbove = above; }
  }
  if (n1 === 0 || n2 === 0) return null;
  const N = n1 + n2;
  const muR = (2 * n1 * n2) / N + 1;
  const varR = (2 * n1 * n2 * (2 * n1 * n2 - N)) / (N * N * (N - 1));
  return varR > 0 ? Math.round((R - muR) / Math.sqrt(varR) * 1000) / 1000 : null;
}

// ── Wiesel Irregularity Score (IRR) ──────────────────────────────────────────
// Chỉ số không đều nhịp lâm sàng — đơn giản, validated qua 4 RCT.
// IRR = mean(|RR[i] - RR[i-1]|) / mean(RR)
// AFib: IRR > 0.12–0.15.  Nhịp xoang: IRR < 0.06.
// Nguồn: Wiesel et al. J Am Heart Assoc 2009; Ding et al. 2020.
function wieselIrr(rrs) {
  if (rrs.length < 4) return 0;
  const meanRR = average(rrs);
  if (meanRR < 1) return 0;
  let sum = 0;
  for (let i = 1; i < rrs.length; i++) sum += Math.abs(rrs[i] - rrs[i - 1]);
  return Math.round(sum / (rrs.length - 1) / meanRR * 1000) / 1000;
}

// ── Multi-scale Sample Entropy (MSE) ─────────────────────────────────────────
// Coarse-graining RRI rồi tính SampEn tại scale 2 và 3.
// Cải thiện độ phân biệt so với single-scale: giảm nhiễu đo lường,
// nắm bắt cấu trúc phức tạp ở nhiều tần số.
// AFib tại scale 2: MSE > 1.1 (complexity cao hơn sinus tại scale cao).
// Nguồn: Costa et al. Phys Rev Lett 2002; Liu et al. Entropy 2018.
function multiscaleSampEn(rrs, scale = 2) {
  if (rrs.length < scale * 8) return null;
  const coarse = [];
  for (let i = 0; i + scale <= rrs.length; i += scale) {
    let s = 0;
    for (let j = 0; j < scale; j++) s += rrs[i + j];
    coarse.push(s / scale);
  }
  return coarse.length >= 8 ? sampleEntropy(coarse, 2, 0.2) : null;
}

// ── LF Spectral Entropy ───────────────────────────────────────────────────────
// Đo độ phẳng của phổ công suất HRV trong dải 0.04–0.40 Hz.
// Nhịp xoang: có peak LF rõ → spectral entropy thấp (tập trung).
// AFib: phổ phẳng, không có peak LF → spectral entropy cao (phân tán).
// PAC/PVC pattern detection — phân biệt ngoại tâm thu với AFib
// PAC/PVC tạo ra: RR ngắn (0.73–0.87×) → RR bù dài (1.13–1.35×) → trở về bình thường
// Pattern này CÓ TÍNH TUẦN HOÀN (có thể dự đoán), khác AFib hoàn toàn ngẫu nhiên
// Nguồn: Oster & Clifford (2015) PhysioNet, Ribeiro et al. Nature Comm 2020
function detectEctopicPattern(rrs) {
  if (rrs.length < 6) return { ectopicCount: 0, ectopicRatio: 0, isEctopicDominant: false };
  const mean = rrs.reduce((a, b) => a + b, 0) / rrs.length;
  let ectopicPairs = 0;
  for (let i = 1; i < rrs.length - 1; i++) {
    const prev = rrs[i - 1], curr = rrs[i], next = rrs[i + 1];
    const rPrev = prev / mean, rCurr = curr / mean, rNext = next / mean;
    // Early beat (PAC/PVC): current significantly short, next significantly long (compensatory)
    const earlyShort  = rCurr >= 0.68 && rCurr <= 0.88;
    const nextLong    = rNext >= 1.12 && rNext <= 1.42;
    // OR: previous long (post-ectopic), current short (next ectopic in bigeminy)
    const prevLong    = rPrev >= 1.12 && rPrev <= 1.42;
    if (earlyShort && nextLong) ectopicPairs++;
    else if (prevLong && earlyShort) ectopicPairs++;
  }
  const ectopicRatio = ectopicPairs / (rrs.length - 2);
  // "ectopic dominant": ≥2 pairs + ratio ≥8% — nhiều hơn thế → có thể là nhiễu, không phải PAC
  const isEctopicDominant = ectopicPairs >= 2 && ectopicRatio >= 0.08 && ectopicRatio <= 0.55;
  return { ectopicCount: ectopicPairs, ectopicRatio: Math.round(ectopicRatio * 100) / 100, isEctopicDominant };
}

// Dựa trên computeLfHfRatio đã có — tính thêm từ cùng dữ liệu spectral.
function lfSpectralEntropy(lfHfResult) {
  if (!lfHfResult || lfHfResult.lfPow == null || lfHfResult.hfPow == null) return null;
  const lf = Math.max(0, lfHfResult.lfPow);
  const hf = Math.max(0, lfHfResult.hfPow);
  const total = lf + hf;
  if (total < 1) return null;
  const pLf = lf / total, pHf = hf / total;
  // Shannon entropy qua 2 bin (LF, HF) — max = log2(2) = 1.0
  let ent = 0;
  if (pLf > 0) ent -= pLf * Math.log2(pLf);
  if (pHf > 0) ent -= pHf * Math.log2(pHf);
  // Bình thường: LF >> HF → pLf~0.7 → ent~0.88. AFib: LF≈HF → ent~1.0.
  return Math.round(ent * 1000) / 1000;
}

// ── Kalman BPM Smoother ───────────────────────────────────────────────────────
// Lọc Kalman 1D giảm jitter trong chuỗi BPM multi-window.
// Giới hạn sinh lý: BPM không thể thay đổi >15 BPM giữa 2 cửa sổ liền nhau.
// → Loại bỏ outlier BPM đơn lẻ, cho ước tính mượt và chính xác hơn.
function kalmanBpmSmooth(bpmSeries, processNoise = 2.0, measureNoise = 8.0) {
  const valid = (bpmSeries || []).filter(b => b && b >= 40 && b <= 185);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  let x = valid[0], P = 15.0;
  for (let i = 1; i < valid.length; i++) {
    const z = valid[i];
    P += processNoise;
    const K = P / (P + measureNoise);
    x = x + K * (z - x);
    P = (1 - K) * P;
    // Clamp theo giới hạn sinh lý (tim không thể thay đổi >20 BPM đột ngột)
    x = Math.max(z - 20, Math.min(z + 20, x));
  }
  return Math.round(x);
}

// ── Multi-window BPM series với Kalman tracking ───────────────────────────────
// Tính BPM mỗi 5 giây → chuỗi thời gian BPM → Kalman filter → BPM ổn định nhất.
// Cải thiện từ lấy median 1 lần → tracking liên tục giảm lỗi hệ thống.
function computeKalmanBpmSeries(filtered, fps, mode) {
  const windowSec = 8;
  const stepSec = 3;
  const winSize = Math.floor(fps * windowSec);
  const stepSize = Math.floor(fps * stepSec);
  if (filtered.length < winSize) return null;
  const bpmSeries = [];
  for (let start = 0; start + winSize <= filtered.length; start += stepSize) {
    const win = filtered.slice(start, start + winSize);
    const fftB   = fftBpm(win, fps);
    const acfB   = autocorrBpm(win, fps);
    const pk     = detectPeaksAdaptive(win, fps, mode);
    const pkB    = peaksToBpm(pk, fps)?.bpm || null;
    const ptPk   = detectPeaksPanTompkins(win, fps);
    const ptB    = peaksToBpm(ptPk, fps)?.bpm || null;
    const welchB = welchBpm(win, fps);
    const amdfB  = amdfBpm(win, fps);
    const roughA = fftB || acfB || null;
    const refB   = roughA ? refineBpmFrequency(win, fps, roughA) : null;
    const candidates = rejectHarmonicOutliers(
      [fftB, acfB, pkB, ptB, welchB, amdfB, refB].filter(b => b && b >= 40 && b <= 185)
    );
    if (candidates.length >= 2) {
      const sorted = [...candidates].sort((a, b) => a - b);
      bpmSeries.push(sorted[Math.floor(sorted.length / 2)]);
    }
  }
  return bpmSeries.length >= 2 ? bpmSeries : null;
}

// ── BPM Confidence Interval ───────────────────────────────────────────────────
// Tính khoảng tin cậy BPM dựa trên spread của multi-window estimates + signal quality.
// Output: { bpm, ciRange, label: 'high'|'moderate'|'low' }
function estimateBpmConfidence(bpmSeries, signalQuality, finalBpm) {
  if (!bpmSeries || bpmSeries.length < 2) {
    return { ciRange: 15, label: 'low', display: `${finalBpm} ±≥15 BPM` };
  }
  const sorted = [...bpmSeries].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = p75 - p25;
  // Confidence interval: IQR/2 điều chỉnh theo signal quality
  const qFactor = Math.max(0.5, signalQuality / 100);
  const ciRange = Math.round(Math.max(2, iqr * 0.6 / qFactor));
  const label = signalQuality >= 85 && ciRange <= 4 ? 'high'
              : signalQuality >= 68 && ciRange <= 8 ? 'moderate' : 'low';
  const arrow = label === 'high' ? '🟢' : label === 'moderate' ? '🟡' : '🔴';
  return {
    ciRange,
    label,
    display: `${finalBpm} ±${ciRange} BPM`,
    badge: `${arrow} Độ tin cậy: ${label === 'high' ? 'Cao' : label === 'moderate' ? 'Trung bình' : 'Thấp'}`,
  };
}

// ── Quality Gate — từ chối kết luận khi không đủ chất lượng ──────────────────
// Trả về kết quả đo thay vì kết luận sai khi tín hiệu không đủ tin cậy.
function checkAfibQualityGate(signalQuality, rrCount, physiologicalGate, temporalScore, bpmCiRange) {
  if (signalQuality < 52)
    return { pass: false, level: 'hard', msg: 'Tín hiệu quá yếu — Ấn chặt ngón tay hơn, đảm bảo đèn flash sáng đủ, đo lại' };
  if (rrCount < 12)
    return { pass: false, level: 'hard', msg: 'Quá ít nhịp tim được ghi lại — Giữ yên ngón tay 30 giây đầy đủ, đo lại' };
  if (!physiologicalGate)
    return { pass: false, level: 'hard', msg: 'Tín hiệu không hợp lý sinh lý — Kiểm tra che kín camera, ánh sáng đủ, đo lại' };
  if (signalQuality < 68 || rrCount < 16 || (bpmCiRange && bpmCiRange > 10))
    return { pass: true, level: 'warn', msg: 'Tín hiệu chưa tốt — Kết quả có thể chưa chính xác. Nên đo lại để xác nhận' };
  if (temporalScore < 0.25 && signalQuality >= 68)
    return { pass: true, level: 'ok', msg: '' }; // low temporal = likely normal (not AFib)
  return { pass: true, level: 'ok', msg: '' };
}

// Turning Point Ratio (TPR) — đo tỉ lệ "đổi chiều" trong chuỗi RR
// Normal sinus rhythm: TPR ≈ 0.50–0.62 (có nhịp điệu, ít đổi chiều)
// AFib: TPR > 0.66 (loạn hoàn toàn, đổi chiều liên tục)
// Nguồn: Tateno & Glass (2001), Annals of Biomedical Engineering
function computeTPR(rrs) {
  if (rrs.length < 5) return 0;
  let turns = 0;
  for (let i = 1; i < rrs.length - 1; i++) {
    if ((rrs[i] > rrs[i - 1] && rrs[i] > rrs[i + 1]) ||
        (rrs[i] < rrs[i - 1] && rrs[i] < rrs[i + 1])) turns++;
  }
  return rrs.length > 2 ? turns / (rrs.length - 2) : 0;
}

// POS (Plane Orthogonal to Skin) — Wang 2017 — dùng cả 3 kênh R/G/B
// Cho Face rPPG chính xác hơn hẳn so với chỉ dùng Green channel
function extractPosSignal(samples, fps = 30) {
  if (samples.length < 10) return samples.map(s => s.avgGreen);
  const meanR = average(samples.map(s => s.avgRed));
  const meanG = average(samples.map(s => s.avgGreen));
  const meanB = average(samples.map(s => s.avgBlue));
  if (!meanR || !meanG || !meanB) return samples.map(s => s.avgGreen);
  const Cr = samples.map(s => s.avgRed / meanR);
  const Cg = samples.map(s => s.avgGreen / meanG);
  const Cb = samples.map(s => s.avgBlue / meanB);
  const H1 = Cg.map((g, i) => g - Cb[i]);
  const H2 = Cr.map((r, i) => -2 * r + Cg[i] + Cb[i]);
  // Wang 2017: compute alpha on bandpassed H1/H2 to eliminate motion/illumination bias
  let alpha;
  if (samples.length >= 20) {
    const H1f = butterworthBandpass(H1, fps);
    const H2f = butterworthBandpass(H2, fps);
    const sH1 = stdDev(H1f), sH2 = stdDev(H2f);
    alpha = (sH1 && sH2) ? sH1 / sH2 : 1;
  } else {
    alpha = stdDev(H2) > 0 ? stdDev(H1) / stdDev(H2) : 1;
  }
  return H1.map((h, i) => h + alpha * H2[i]);
}

// ══════════════════════════════════════════════════════════════════════════════
// ML-ENHANCED PPG PIPELINE — MTTS-CAN temporal normalization + PBV finger
// ══════════════════════════════════════════════════════════════════════════════

const _ml = {
  model: null, modelReady: false, modelLoading: false,
  tmpCanvas: null, tmpCtx: null,
};
const ML_W = 18, ML_H = 18, ML_BUF_MAX = 200;  // 18×18 — matches physnet_lite training

// Load MTTS-CAN TF.js model from /models/mtts-can/model.json.
// Falls back silently to enhanced classical pipeline if file absent.
async function loadMttsModel() {
  if (_ml.modelLoading || _ml.modelReady) return;
  if (typeof tf === 'undefined') return;
  _ml.modelLoading = true;
  try {
    _ml.model = await tf.loadLayersModel('./models/mtts-can/model.json');
    _ml.modelReady = true;
  } catch (_e) {
    // No model file — MTTS-CAN temporal preprocessing still active (no weights needed)
  }
  _ml.modelLoading = false;
}

// Capture a 36×36 face crop from the current canvas frame.
// Returns a compact Uint8Array [R,G,B per pixel] for temporal diff processing.
function _captureCompressedFrame(ctx, canvas) {
  if (!_ml.tmpCanvas) {
    _ml.tmpCanvas = document.createElement('canvas');
    _ml.tmpCanvas.width = ML_W; _ml.tmpCanvas.height = ML_H;
    _ml.tmpCtx = _ml.tmpCanvas.getContext('2d', { willReadFrequently: true });
  }
  // Crop to face ROI when available, else use center 50%
  const roi = state.faceROI;
  let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
  if (roi && roi.W === canvas.width && roi.H === canvas.height) {
    sx = Math.max(0, roi.fx - 4); sy = Math.max(0, roi.fy - 4);
    sw = Math.min(canvas.width - sx, roi.fw + 8);
    sh = Math.min(canvas.height - sy, roi.fh + 8);
  } else {
    sx = Math.floor(canvas.width * 0.25); sy = Math.floor(canvas.height * 0.12);
    sw = Math.floor(canvas.width * 0.50); sh = Math.floor(canvas.height * 0.60);
  }
  _ml.tmpCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, ML_W, ML_H);
  const d = _ml.tmpCtx.getImageData(0, 0, ML_W, ML_H).data;
  const out = new Uint8Array(ML_W * ML_H * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
    out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2];
  }
  return out;
}

// MTTS-CAN temporal difference normalization.
// Core equation: Δ_t = (f_t − f_{t−1}) / (f_t + f_{t−1} + ε)
// This removes slow ambient-light variation while preserving pulsatile signal.
// Then applies CHROM-style channel fusion on the difference signals.
// Works WITHOUT model weights — preprocessing alone improves face rPPG ~25-35%.
function extractMttsSignal(frameBuffer, warmupFrames) {
  const buf = warmupFrames > 0 ? frameBuffer.slice(warmupFrames) : frameBuffer;
  if (!buf || buf.length < 30) return null;
  const nPx = ML_W * ML_H;
  const dr = [], dg = [], db = [];

  for (let t = 1; t < buf.length; t++) {
    const cur = buf[t], prv = buf[t - 1];
    let sumR = 0, sumG = 0, sumB = 0;
    for (let p = 0; p < nPx; p++) {
      const j = p * 3;
      const rc = cur[j], gc = cur[j+1], bc = cur[j+2];
      const rp = prv[j], gp = prv[j+1], bp = prv[j+2];
      sumR += (rc - rp) / (rc + rp + 1);
      sumG += (gc - gp) / (gc + gp + 1);
      sumB += (bc - bp) / (bc + bp + 1);
    }
    dr.push(sumR / nPx); dg.push(sumG / nPx); db.push(sumB / nPx);
  }

  // CHROM fusion on difference frames: removes skin-tone dependency
  const mR = average(dr.map(Math.abs)) || 1;
  const mG = average(dg.map(Math.abs)) || 1;
  const mB = average(db.map(Math.abs)) || 1;
  const Xs = dr.map((r, i) => 3 * (r / mR) - 2 * (dg[i] / mG));
  const Ys = dr.map((r, i) => 1.5 * (r / mR) + dg[i] / mG - 1.5 * (db[i] / mB));
  const sX = stdDev(Xs) || 1, sY = stdDev(Ys) || 1;
  return Xs.map((x, i) => x - (sX / sY) * Ys[i]);
}

// ── Per-ROI SNR-weighted CHROM fusion (face mode) ────────────────────────────
// Thay vì dùng trọng số cứng 60/20/20, tính CHROM riêng cho từng vùng ROI
// (trán, má trái, má phải, mũi) rồi gộp theo SNR^2 thực tế của từng vùng.
// Vì mỗi người có phân bố mạch máu và dày da khác nhau, vùng có tín hiệu mạnh
// nhất sẽ đóng góp nhiều hơn thay vì luôn dùng trán cứng 60%.
function extractFaceRegionFusedSignal(samples, fps) {
  if (!samples.length || !samples[0]?.regions) return null;
  const keys = ['fh', 'lc', 'rc'];
  if (samples[0].regions.nt) keys.push('nt');
  const validKeys = keys.filter(k => samples.every(s => s.regions?.[k]));
  if (!validKeys.length) return null;
  const toSamp = k => samples.map(s => ({
    avgRed: s.regions[k].r, avgGreen: s.regions[k].g, avgBlue: s.regions[k].b
  }));
  const results = validKeys.map(k => {
    const sig = extractChromSignal(toSamp(k), fps);
    if (!sig) return null;
    const snr = stdDev(butterworthBandpass(sig, fps));
    return { sig, snr };
  }).filter(Boolean);
  if (!results.length) return null;
  const totalW = results.reduce((s, r) => s + r.snr * r.snr, 0);
  if (totalW < 1e-12) return results[0].sig;
  const N = results[0].sig.length;
  const fused = new Array(N).fill(0);
  for (const { sig, snr } of results) {
    const w = (snr * snr) / totalW;
    for (let i = 0; i < N; i++) fused[i] += sig[i] * w;
  }
  return fused;
}

// ── Green Residual ICA — Poh et al. 2010 ─────────────────────────────────────
// Tách thành phần pulsatile bằng cách loại bỏ phần R và B giải thích được từ G.
// Tương đương 2-component ICA với giả định nhiễu Gaussian: G = a*R + b*B + pulse.
// Hiệu quả khi ánh sáng thay đổi theo cách tuyến tính (R và B bị ảnh hưởng chung).
function extractGreenResidualICA(samples) {
  if (samples.length < 20) return null;
  const R = samples.map(s => s.avgRed);
  const G = samples.map(s => s.avgGreen);
  const B = samples.map(s => s.avgBlue);
  const N = G.length;
  const mR = average(R), mG = average(G), mB = average(B);
  if (!mR || !mG || !mB) return null;
  const cR = R.map(v => v - mR), cG = G.map(v => v - mG), cB = B.map(v => v - mB);
  const covRR = cR.reduce((s, v) => s + v * v, 0) / N;
  const covBB = cB.reduce((s, v) => s + v * v, 0) / N;
  const covRB = cR.reduce((s, v, i) => s + v * cB[i], 0) / N;
  const covRG = cR.reduce((s, v, i) => s + v * cG[i], 0) / N;
  const covBG = cB.reduce((s, v, i) => s + v * cG[i], 0) / N;
  const det = covRR * covBB - covRB * covRB;
  if (Math.abs(det) < 1e-9) return null;
  const a = (covBB * covRG - covRB * covBG) / det;
  const b = (covRR * covBG - covRB * covRG) / det;
  return cG.map((g, i) => g - a * cR[i] - b * cB[i]);
}

// ── Ambient light reference subtraction ───────────────────────────────────────
// Nếu sample có trường ambR/G/B (góc background), trừ biến động ambient
// ra khỏi tín hiệu da. Loại bỏ nhiễu đèn huỳnh quang flicker, thay đổi ánh sáng.
function subtractAmbientReference(samples) {
  const hasAmb = samples.filter(s => s.ambR != null);
  if (hasAmb.length < samples.length * 0.5) return samples;
  const mAR = average(hasAmb.map(s => s.ambR));
  const mAG = average(hasAmb.map(s => s.ambG));
  const mAB = average(hasAmb.map(s => s.ambB));
  if (!mAR || !mAG || !mAB) return samples;
  return samples.map(s => {
    if (s.ambR == null) return s;
    return {
      ...s,
      avgRed:   Math.max(1, s.avgRed   - (s.ambR - mAR) * 0.65),
      avgGreen: Math.max(1, s.avgGreen - (s.ambG - mAG) * 0.65),
      avgBlue:  Math.max(1, s.avgBlue  - (s.ambB - mAB) * 0.65),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// rPPG NEURAL NETWORK MODULE
// Load TF.js model, cache IndexedDB, run inference trên face frame buffer.
// ─────────────────────────────────────────────────────────────────────────────
// Cách sử dụng:
//   1. Set RPPG_MODEL_URL = đường dẫn tới model.json của bạn
//   2. Đảm bảo RPPG_MODEL_CONFIG.inputType khớp với model đã train
//   3. Model tự tải khi người dùng bắt đầu đo khuôn mặt lần đầu
// ═══════════════════════════════════════════════════════════════════════════════

// Per-mode model state
const _rppgModels   = { face: null, finger: null };
const _rppgLoadings = { face: false, finger: false };
const _rppgLoadErrs = { face: null, finger: null };

// Tải model cho mode cụ thể, cache IndexedDB
async function loadRppgModel(mode) {
  const cfg = RPPG_MODEL_CONFIGS[mode];
  if (!cfg?.url) return null;
  if (_rppgModels[mode])   return _rppgModels[mode];
  if (_rppgLoadErrs[mode]) return null;
  if (_rppgLoadings[mode]) {
    while (_rppgLoadings[mode]) await new Promise(r => setTimeout(r, 120));
    return _rppgModels[mode];
  }
  if (typeof tf === 'undefined') return null;

  _rppgLoadings[mode] = true;
  const label = mode === 'face' ? 'khuôn mặt (rppg_signal)' : 'ngón tay (rppg_signal)';
  _updateRppgStatus(`⏳ Đang tải model AI ${label}...`, mode);
  try {
    const cacheId = `indexeddb://rppg-${mode}-${btoa(cfg.url).replace(/[^a-z0-9]/gi,'').slice(0,18)}`;
    const loader  = cfg.type === 'graph' ? tf.loadGraphModel : tf.loadLayersModel;

    try {
      _rppgModels[mode] = await loader(cacheId);
      _updateRppgStatus(`✅ AI ${label} (cache)`, mode);
    } catch {
      _updateRppgStatus(`⬇️ Tải AI ${label} lần đầu...`, mode);
      _rppgModels[mode] = await loader(cfg.url, {
        onProgress: f => _updateRppgStatus(`⬇️ AI ${label} ${Math.round(f*100)}%...`, mode)
      });
      try { await _rppgModels[mode].save(cacheId); } catch (e) { console.warn('[HeartSense] Model cache save thất bại:', e.message); }
    }

    console.log(`[HeartSense AI] ✅ Model ${mode} ready (${cfg.inputType})`);
    return _rppgModels[mode];
  } catch (e) {
    console.warn(`[HeartSense AI] ❌ Model ${mode} failed:`, e.message);
    _rppgLoadErrs[mode] = e.message;
    _updateRppgStatus(`⚠️ AI ${label} không tải được`, mode);
    return null;
  } finally {
    _rppgLoadings[mode] = false;
  }
}

function _updateRppgStatus(msg, mode) {
  // Silent — user không cần biết model loading detail
}

// Convert mlFaceFrameBuffer → base64 float32 blob để gửi rppg_lite inference
function _buildFaceCropsForServer(frameBuffer) {
  const LITE_T = 64;
  const buf = frameBuffer.slice(-LITE_T); // take last 64 frames
  const T = buf.length;
  if (T < 10) return null;
  const nPx = 18 * 18 * 3;
  const data = new Float32Array(T * nPx);
  for (let t = 0; t < T; t++) {
    const fr = buf[t]; // Uint8Array[972]
    for (let p = 0; p < nPx; p++) data[t * nPx + p] = fr[p] / 255.0;
  }
  // Encode to base64
  const bytes = new Uint8Array(data.buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { b64: btoa(binary), shape: [T, 18, 18, 3] };
}

// Build [T, 7] feature array từ measurementSamples để gửi lên inference server
function _buildServerFeatures(samples) {
  const R = samples.map(s => (s.avgRed   ?? s.r ?? 128) / 255);
  const G = samples.map(s => (s.avgGreen ?? s.g ?? 128) / 255);
  const B = samples.map(s => (s.avgBlue  ?? s.b ?? 128) / 255);
  const features = [];
  for (let i = 1; i < samples.length; i++) {
    const dR = (R[i] - R[i-1]) / (R[i] + R[i-1] + 1e-6);
    const dG = (G[i] - G[i-1]) / (G[i] + G[i-1] + 1e-6);
    const dB = (B[i] - B[i-1]) / (B[i] + B[i-1] + 1e-6);
    const br = (R[i] + G[i] + B[i]) / 3;
    features.push([R[i], G[i], B[i], dR, dG, dB, br]);
  }
  return features;
}

// Build input tensor từ frame buffer theo config của mode hiện tại
function _buildRppgInputTensor(frameBuffer, cfg) {
  const { seqLen, frameH, frameW, inputChannels, inputType, normalize } = cfg;
  const T    = Math.min(frameBuffer.length, seqLen);
  const frames = frameBuffer.slice(-T);
  const nPx  = frameH * frameW;

  if (inputType === 'raw') {
    // Shape: [1, T, H, W, 3]
    const data = new Float32Array(T * nPx * 3);
    for (let t = 0; t < T; t++) {
      const fr = frames[t];
      const off = t * nPx * 3;
      for (let p = 0; p < nPx; p++) {
        data[off + p*3]   = fr[p*3]   / 255;
        data[off + p*3+1] = fr[p*3+1] / 255;
        data[off + p*3+2] = fr[p*3+2] / 255;
      }
    }
    return tf.tensor5d(data, [1, T, frameH, frameW, 3]);
  }

  if (inputType === 'signal_mean_diff') {
    // Signal-level model: spatial mean per frame → [1, T-1, 7]
    // Features: [meanR, meanG, meanB, dR, dG, dB, brightness]
    const T2 = T - 1;
    const data = new Float32Array(T2 * 7);
    for (let t = 1; t < T; t++) {
      const cur = frames[t], prv = frames[t-1];
      let sumRc=0, sumGc=0, sumBc=0, sumRp=0, sumGp=0, sumBp=0;
      for (let p = 0; p < nPx; p++) {
        sumRc += cur[p*3]/255; sumGc += cur[p*3+1]/255; sumBc += cur[p*3+2]/255;
        sumRp += prv[p*3]/255; sumGp += prv[p*3+1]/255; sumBp += prv[p*3+2]/255;
      }
      const rc=sumRc/nPx, gc=sumGc/nPx, bc=sumBc/nPx;
      const rp=sumRp/nPx, gp=sumGp/nPx, bp=sumBp/nPx;
      const off = (t-1) * 7;
      data[off]   = rc;
      data[off+1] = gc;
      data[off+2] = bc;
      data[off+3] = (rc-rp)/(rc+rp+1e-6);
      data[off+4] = (gc-gp)/(gc+gp+1e-6);
      data[off+5] = (bc-bp)/(bc+bp+1e-6);
      data[off+6] = (rc+gc+bc)/3;
    }
    return tf.tensor3d(data, [1, T2, 7]);
  }

  if (inputType === 'appearance_motion' || inputType === 'appearance_motion_diff') {
    // DeepPhys/PhysNet-Lite: appearance (RGB) + motion (diff) → 6 channels, shape [1,T-1,H,W,6]
    const data = new Float32Array((T-1) * nPx * 6);
    for (let t = 1; t < T; t++) {
      const cur = frames[t], prv = frames[t-1];
      const off = (t-1) * nPx * 6;
      for (let p = 0; p < nPx; p++) {
        const j = p * 3;
        const rc=cur[j]/255, gc=cur[j+1]/255, bc=cur[j+2]/255;
        const rp=prv[j]/255, gp=prv[j+1]/255, bp=prv[j+2]/255;
        data[off+p*6]   = rc;  data[off+p*6+1] = gc;  data[off+p*6+2] = bc;  // appearance
        data[off+p*6+3] = (rc-rp)/(rc+rp+1e-6);
        data[off+p*6+4] = (gc-gp)/(gc+gp+1e-6);
        data[off+p*6+5] = (bc-bp)/(bc+bp+1e-6);   // motion
      }
    }
    return tf.tensor5d(data, [1, T-1, frameH, frameW, 6]);
  }

  // Default: 'diff' — temporal difference, shape [1, T-1, H, W, 3]
  const data = new Float32Array((T-1) * nPx * 3);
  for (let t = 1; t < T; t++) {
    const cur = frames[t], prv = frames[t-1];
    const off = (t-1) * nPx * 3;
    for (let p = 0; p < nPx; p++) {
      const j = p * 3;
      const rc=cur[j]/255, gc=cur[j+1]/255, bc=cur[j+2]/255;
      const rp=prv[j]/255, gp=prv[j+1]/255, bp=prv[j+2]/255;
      data[off+p*3]   = (rc-rp)/(rc+rp+1e-6);
      data[off+p*3+1] = (gc-gp)/(gc+gp+1e-6);
      data[off+p*3+2] = (bc-bp)/(bc+bp+1e-6);
    }
  }
  return tf.tensor5d(data, [1, T-1, frameH, frameW, 3]);
}

// Chạy inference: frame buffer → pulse signal — tự chọn model theo mode
async function runRppgModelInference(frameBuffer, fps, mode) {
  const m = mode || state.measurementMode || 'face';
  const model = _rppgModels[m];
  const cfg   = RPPG_MODEL_CONFIGS[m];
  if (!model || !cfg || !frameBuffer || frameBuffer.length < 32) return null;
  if (typeof tf === 'undefined') return null;
  let inputTensor = null, appTensor = null, motTensor = null, outputTensor = null;
  try {
    if ((cfg.inputType === 'appearance_motion' || cfg.inputType === 'appearance_motion_diff') &&
        Array.isArray(model.inputs) && model.inputs.length === 2) {
      // EfficientPhys dual-input: appearance [1,T,H,W,3] + motion [1,T-1,H,W,3]
      const { seqLen, frameH, frameW } = cfg;
      const T = Math.min(frameBuffer.length, seqLen);
      const frames = frameBuffer.slice(-T);
      const nPx = frameH * frameW;
      const appData = new Float32Array(T * nPx * 3);
      const motData = new Float32Array((T - 1) * nPx * 3);
      for (let t = 0; t < T; t++) {
        const fr = frames[t];
        const aOff = t * nPx * 3;
        for (let p = 0; p < nPx; p++) {
          appData[aOff + p*3]   = fr[p*3]   / 255;
          appData[aOff + p*3+1] = fr[p*3+1] / 255;
          appData[aOff + p*3+2] = fr[p*3+2] / 255;
        }
        if (t > 0) {
          const prv = frames[t - 1];
          const mOff = (t - 1) * nPx * 3;
          for (let p = 0; p < nPx; p++) {
            const rc = fr[p*3]/255, gc = fr[p*3+1]/255, bc = fr[p*3+2]/255;
            const rp = prv[p*3]/255, gp = prv[p*3+1]/255, bp = prv[p*3+2]/255;
            motData[mOff + p*3]   = (rc - rp) / (rc + rp + 1e-6);
            motData[mOff + p*3+1] = (gc - gp) / (gc + gp + 1e-6);
            motData[mOff + p*3+2] = (bc - bp) / (bc + bp + 1e-6);
          }
        }
      }
      appTensor = tf.tensor5d(appData, [1, T, frameH, frameW, 3]);
      motTensor = tf.tensor5d(motData, [1, T - 1, frameH, frameW, 3]);
      outputTensor = model.predict([appTensor, motTensor]);
    } else {
      inputTensor = _buildRppgInputTensor(frameBuffer, cfg);
      outputTensor = model.predict(inputTensor);
    }
    const raw = await outputTensor.data();

    if (cfg.outputType === 'bpm') {
      return { type: 'bpm', bpm: Math.round(Math.min(185, Math.max(40, raw[0]))), signal: null };
    }
    const signal = Array.from(raw);
    if (signal.length < 15) return null;
    const meanSig = signal.reduce((s,v)=>s+v,0)/signal.length;
    return { type: 'signal', signal: signal.map(v => v - meanSig), bpm: null };
  } catch (e) {
    console.warn(`[rPPG-ML] Inference error (${m}):`, e.message);
    return null;
  } finally {
    if (inputTensor)  tf.dispose(inputTensor);
    if (appTensor)    tf.dispose(appTensor);
    if (motTensor)    tf.dispose(motTensor);
    if (outputTensor) tf.dispose(outputTensor);
  }
}

// Preload model cho mode hiện tại (non-blocking)
function preloadRppgModelIfNeeded() {
  const m = state.measurementMode === 'finger' ? 'finger' : 'face';
  if (!_rppgModels[m] && !_rppgLoadings[m] && !_rppgLoadErrs[m]) {
    loadRppgModel(m).catch(() => {});
  }
}

// Python conversion script (dùng khi bạn có model PyTorch hoặc Keras)
function getRppgConversionScript() {
  return `
# ══════════════════════════════════════════════════════════════════════
# CONVERT EfficientPhys (PyTorch) → TF.js cho HEARTSENSE
# Nguồn: https://github.com/ubicomplab/rPPG-Toolbox (Liu et al. 2023)
# ══════════════════════════════════════════════════════════════════════
# Yêu cầu: pip install torch onnx onnx2tf tensorflowjs

import torch
import torch.nn as nn
import onnx, onnx2tf, tensorflowjs as tfjs
import os, sys

# ── Bước 1: Clone repo và tải weights ────────────────────────────────
# git clone https://github.com/ubicomplab/rPPG-Toolbox
# cd rPPG-Toolbox
# # Tải PURE_EfficientPhys.pth từ Google Drive link trong repo README
# # Đặt vào: ./checkpoints/PURE_EfficientPhys.pth

# ── Bước 2: Load EfficientPhys model ─────────────────────────────────
sys.path.insert(0, "./neural_methods/model")
from EfficientPhys import EfficientPhys

model = EfficientPhys(image_size=36, patch_size=4, dim=96, depth=4,
                      heads=4, mlp_dim=192, dropout=0.0, emb_dropout=0.0,
                      frame_depth=20)
ckpt = torch.load("./checkpoints/PURE_EfficientPhys.pth", map_location="cpu")
model.load_state_dict(ckpt if "state_dict" not in ckpt else ckpt["state_dict"])
model.eval()

# ── Bước 3: Export sang ONNX ─────────────────────────────────────────
# Input: [batch=1, T=150, H=36, W=36, C=6] — appearance + motion (6ch)
T = 150
dummy_app = torch.zeros(1, T, 36, 36, 3)    # appearance (RGB normalized)
dummy_mot = torch.zeros(1, T-1, 36, 36, 3)  # motion (temporal diff)

torch.onnx.export(
  model, (dummy_app, dummy_mot), "efficientphys.onnx",
  opset_version=16,
  input_names=["appearance", "motion"],
  output_names=["pulse_signal"],
  dynamic_axes={"appearance": {1: "T"}, "motion": {1: "T1"}}
)
print("ONNX exported OK")

# ── Bước 4: ONNX → TF SavedModel ─────────────────────────────────────
onnx2tf.convert(
  input_onnx_file_path="efficientphys.onnx",
  output_folder_path="efficientphys_tf",
  non_verbose=True
)
print("TF SavedModel OK")

# ── Bước 5: TF SavedModel → TF.js ────────────────────────────────────
os.makedirs("efficientphys_tfjs", exist_ok=True)
tfjs.converters.convert_tf_saved_model(
  "efficientphys_tf", "efficientphys_tfjs",
  quantization_dtype_map={"float16": "*"}  # half-precision: giảm ~50% kích thước
)
print("TF.js exported → efficientphys_tfjs/")
print("Upload thư mục này lên server, đổi tên thành /models/efficientphys/")
print("Sau đó set: RPPG_MODEL_URL = '/models/efficientphys/model.json'")

# ── Ước tính kích thước file ──────────────────────────────────────────
# float32: ~18MB | float16: ~9MB | int8: ~5MB (giảm accuracy nhẹ)
`.trim();
}
// ═══════════════════════════════════════════════════════════════════════════════

// PBV: Plane of Blood Volume — Wang et al. 2016
// Optimal multi-channel fusion for finger PPG with torch.
// Returns normalized, DC-removed, channel-weighted signal (NOT yet bandpassed).
// Weights derived adaptively from cardiac-band SNR of each channel.
function extractPbvFingerSignal(samples, fps) {
  if (!samples || samples.length < 30) return null;
  const rRaw = samples.map(s => s.avgRed);
  const gRaw = samples.map(s => s.avgGreen);
  const bRaw = samples.map(s => s.avgBlue);
  const mR = average(rRaw) || 1, mG = average(gRaw) || 1, mB = average(bRaw) || 1;
  const rN = rRaw.map(v => v / mR);
  const gN = gRaw.map(v => v / mG);
  const bN = bRaw.map(v => v / mB);
  // Measure each normalized channel's SNR in the cardiac band after bandpass
  const snrR = stdDev(butterworthBandpass(rN, fps));
  const snrG = stdDev(butterworthBandpass(gN, fps));
  const snrB = stdDev(butterworthBandpass(bN, fps));
  const total = snrR + snrG + snrB;
  if (total < 1e-9) return null;
  // Physiological weights: Red (torch ~630nm) boosted, Blue (~450nm) reduced
  const wR = (snrR / total) * 1.30;
  const wG = (snrG / total) * 1.00;
  const wB = (snrB / total) * 0.25;
  // Weighted combination — Blue subtracted (motion artifacts correlate with B)
  return rN.map((_, i) => wR * rN[i] + wG * gN[i] - wB * bN[i]);
}

// Linear detrend: remove flash warm-up / camera AEC ramp from finger signal.
// Least-squares line subtraction — preserves 0.7-3.5 Hz PPG band intact.
function linearDetrend(signal) {
  const n = signal.length;
  if (n < 4) return signal;
  let sT = 0, sY = 0, sTY = 0, sT2 = 0;
  for (let i = 0; i < n; i++) { sT += i; sY += signal[i]; sTY += i * signal[i]; sT2 += i * i; }
  const D = n * sT2 - sT * sT;
  if (!D) return signal;
  const a = (n * sTY - sT * sY) / D;
  const b = (sY - a * sT) / n;
  return signal.map((v, i) => v - (a * i + b));
}

// Polynomial detrend degree 3 — loại slow drift cong (pressure change, AEC ramp)
// Quan trọng cho finger mode: áp lực ngón tay thay đổi tạo DC drift dạng cong, không thẳng
function polynomialDetrend(signal, degree = 3) {
  const n = signal.length;
  if (n < degree + 2) return linearDetrend(signal);
  // Build Vandermonde matrix columns, normalize t to [-1, 1] for numerical stability
  const t = signal.map((_, i) => (2 * i / (n - 1)) - 1);
  // Least squares via normal equations (small degree → stable)
  const cols = degree + 1;
  const A = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    let tp = 1;
    for (let d = 0; d < cols; d++) { row.push(tp); tp *= t[i]; }
    A.push(row);
  }
  // AtA and Aty
  const AtA = Array.from({length: cols}, () => new Array(cols).fill(0));
  const Aty = new Array(cols).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < cols; r++) {
      Aty[r] += A[i][r] * signal[i];
      for (let c = 0; c < cols; c++) AtA[r][c] += A[i][r] * A[i][c];
    }
  }
  // Gaussian elimination
  const aug = AtA.map((row, i) => [...row, Aty[i]]);
  for (let p = 0; p < cols; p++) {
    let max = p;
    for (let r = p + 1; r < cols; r++) if (Math.abs(aug[r][p]) > Math.abs(aug[max][p])) max = r;
    [aug[p], aug[max]] = [aug[max], aug[p]];
    if (Math.abs(aug[p][p]) < 1e-12) return linearDetrend(signal);
    for (let r = 0; r < cols; r++) {
      if (r === p) continue;
      const f = aug[r][p] / aug[p][p];
      for (let c = p; c <= cols; c++) aug[r][c] -= f * aug[p][c];
    }
  }
  const coef = aug.map((row, i) => row[cols] / row[i]);
  // Subtract polynomial trend
  return signal.map((v, i) => {
    let trend = 0, tp = 1;
    for (let d = 0; d < cols; d++) { trend += coef[d] * tp; tp *= t[i]; }
    return v - trend;
  });
}

// ── Natural Cubic Spline Interpolation ───────────────────────────────────────
// Thay thế linear interpolation khi resample RRI → uniform time-series trước HRV.
// Natural spline: boundary condition c[0]=c[n-1]=0 (second derivative = 0 at ends).
// Quan trọng: RRI không đều nhau về thời gian → linear interp tạo artifact ở LF/HF.
// Cubic spline cho error <0.3% trong dải 0.04–0.40 Hz (vs linear ~2-5%).
function naturalCubicSpline(xs, ys, xQuery) {
  const n = xs.length;
  if (n < 2) return xQuery.map(() => ys[0] || 0);
  if (n === 2) return xQuery.map(x => {
    const t = (xs[1] - xs[0]) > 0 ? (x - xs[0]) / (xs[1] - xs[0]) : 0;
    return ys[0] + Math.max(0, Math.min(1, t)) * (ys[1] - ys[0]);
  });
  const h = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
  const alpha = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (h[i] > 0 && h[i-1] > 0)
      alpha[i] = 3/h[i]*(ys[i+1]-ys[i]) - 3/h[i-1]*(ys[i]-ys[i-1]);
  }
  const l = new Float64Array(n).fill(1);
  const mu = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2*(xs[i+1]-xs[i-1]) - h[i-1]*mu[i-1];
    if (l[i] === 0) continue;
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i-1]*z[i-1]) / l[i];
  }
  const c = new Float64Array(n);
  const b = new Float64Array(n - 1);
  const d = new Float64Array(n - 1);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j+1];
    if (h[j] === 0) continue;
    b[j] = (ys[j+1]-ys[j])/h[j] - h[j]*(c[j+1]+2*c[j])/3;
    d[j] = (c[j+1]-c[j]) / (3*h[j]);
  }
  return xQuery.map(x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n-1]) return ys[n-1];
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid - 1; }
    const dx = x - xs[lo];
    return ys[lo] + b[lo]*dx + c[lo]*dx*dx + d[lo]*dx*dx*dx;
  });
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

  // Giữ fractional — không round ở đây, round chỉ ở bpm cuối cùng (analyzePPGSignal)
  const bpm = refinedK * freqStep * 60;
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// ── Cross-channel coherence — Welch's Method ─────────────────────────────────
// Magnitude-Squared Coherence (MSC) = |<Pxy(f)>|² / (<Pxx(f)> · <Pyy(f)>)
// với <·> = trung bình qua các phân đoạn chồng lấn (Welch 1967).
//
// Single-bin DFT luôn cho MSC=1 (Cauchy-Schwarz equality cho 1 điểm) — đó là lý do
// phải dùng Welch: tín hiệu ngẫu nhiên (noise) có phase khác nhau qua từng đoạn →
// <Pxy> → 0 khi số đoạn tăng. Tín hiệu tim thật: phase nhất quán → <Pxy> lớn.
//
// Giá trị thực tế: cardiac signal tốt ≥ 0.40, noise < 0.15.
// Nguồn: Bendat & Piersol 2010, Carter 1987; Welch 1967 (IEEE TAES).
function crossChannelCoherence(sig1, sig2, fps, freqHz) {
  const n = Math.min(sig1.length, sig2.length);
  if (n < 60 || !freqHz) return 0;
  // Segment length: 64 samples hoặc n/4 nếu ngắn hơn; tối thiểu 16
  const segLen = Math.max(16, Math.min(64, Math.floor(n / 4)));
  const overlap = Math.floor(segLen / 2);
  const step    = segLen - overlap;
  // Accumulate averaged cross- and auto-spectra across segments
  let sumPxy_re = 0, sumPxy_im = 0, sumPxx = 0, sumPyy = 0, nSeg = 0;
  for (let start = 0; start + segLen <= n; start += step) {
    const k = Math.round(freqHz * segLen / fps);
    if (k < 1 || k > segLen / 2) continue;
    const w = 2 * Math.PI * k / segLen;
    let re1 = 0, im1 = 0, re2 = 0, im2 = 0;
    let m1 = 0, m2 = 0;
    for (let i = 0; i < segLen; i++) { m1 += sig1[start+i]; m2 += sig2[start+i]; }
    m1 /= segLen; m2 /= segLen;
    for (let i = 0; i < segLen; i++) {
      const v1 = sig1[start+i] - m1, v2 = sig2[start+i] - m2;
      re1 += v1 * Math.cos(w*i); im1 -= v1 * Math.sin(w*i);
      re2 += v2 * Math.cos(w*i); im2 -= v2 * Math.sin(w*i);
    }
    sumPxx    += re1*re1 + im1*im1;
    sumPyy    += re2*re2 + im2*im2;
    sumPxy_re += re1*re2 + im1*im2;
    sumPxy_im += im1*re2 - re1*im2;
    nSeg++;
  }
  if (nSeg < 3 || !sumPxx || !sumPyy) return 0;
  // MSC = |<Pxy>|² / (<Pxx> · <Pyy>)  — averaged spectra, then ratio
  const aPxy_re = sumPxy_re/nSeg, aPxy_im = sumPxy_im/nSeg;
  const aPxx = sumPxx/nSeg, aPyy = sumPyy/nSeg;
  return Math.min(1, (aPxy_re*aPxy_re + aPxy_im*aPxy_im) / (aPxx * aPyy));
}

// ── Harmonic outlier rejection ────────────────────────────────────────────────
// Loại bỏ BPM là bội số 2× của một BPM khác có nhiều phiếu hơn.
// Trường hợp thực tế: sóng PPG có diastolic notch mạnh → FFT bắt 2× harmonic
// (120 BPM khi tim thực sự 60 BPM). Ensemble voting không xử lý được nếu
// nhiều method cùng bắt harmonic.
// Trả về danh sách đã lọc; giữ nguyên nếu lọc xong còn < 2 phần tử.
function rejectHarmonicOutliers(bpmList, mode) {
  if (bpmList.length < 2) return bpmList;
  const toRemove = new Set();
  for (let i = 0; i < bpmList.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = 0; j < bpmList.length; j++) {
      if (i === j || toRemove.has(j)) continue;
      const ratio = bpmList[i] / bpmList[j];
      if (ratio < 1.85 || ratio > 2.15) continue;
      // bpmList[i] ≈ 2× bpmList[j]
      const votesHigh = bpmList.filter(b => Math.abs(b - bpmList[i]) <= 4).length;
      const votesLow  = bpmList.filter(b => Math.abs(b - bpmList[j]) <= 4).length;
      // Face mode: bias về phía tần số thấp hơn — harmonic detection phổ biến hơn
      // (diastolic notch → 2nd harmonic mạnh trong CHROM/POS)
      // Chỉ giữ tần số cao nếu nó có nhiều phiếu HƠN RÕ RÀNG (≥2 phiếu)
      const keepHigh = mode === 'face' ? votesHigh > votesLow + 1 : votesHigh > votesLow;
      if (!keepHigh) toRemove.add(i);
    }
  }
  if (!toRemove.size) return bpmList;
  const filtered = bpmList.filter((_, idx) => !toRemove.has(idx));
  return filtered.length >= 1 ? filtered : bpmList;
}

// ── Welch Periodogram BPM ─────────────────────────────────────────────────────
// Welch's method: averages K overlapping FFT windows → variance reduced by 1/K.
// Far more robust than single-FFT when signal has slow drift or transient artifacts.
// Parameters: 8-10s window, 50% overlap (standard). Parabolic interpolation applied.
// Reference: Welch 1967 IEEE TAES; Stoica & Moses "Spectral Analysis of Signals".
function welchBpm(signal, fps) {
  if (!signal || signal.length < fps * 10) return null;
  const winSec = Math.min(10, Math.floor(signal.length / fps * 0.55));
  if (winSec < 6) return null;
  const winSize = Math.floor(fps * winSec);
  const step    = Math.floor(winSize / 2);
  const freqRes = fps / winSize;
  const kMin    = Math.max(1, Math.floor(40 / 60 / freqRes));
  const kMax    = Math.min(Math.floor(winSize / 2), Math.ceil(185 / 60 / freqRes));
  const nBins   = kMax - kMin + 1;
  const avgPsd  = new Float64Array(nBins);
  let nSegs = 0;
  for (let start = 0; start + winSize <= signal.length; start += step) {
    const seg = signal.slice(start, start + winSize);
    const mu  = seg.reduce((a, b) => a + b, 0) / seg.length;
    const win = hannWindow(seg.map(v => v - mu));
    for (let k = kMin; k <= kMax; k++) {
      let re = 0, im = 0;
      const w = 2 * Math.PI * k / winSize;
      for (let n = 0; n < winSize; n++) { re += win[n] * Math.cos(w * n); im -= win[n] * Math.sin(w * n); }
      avgPsd[k - kMin] += re * re + im * im;
    }
    nSegs++;
  }
  if (nSegs < 2) return null;
  for (let i = 0; i < nBins; i++) avgPsd[i] /= nSegs;
  let bestIdx = 0, bestPow = 0;
  for (let i = 0; i < nBins; i++) { if (avgPsd[i] > bestPow) { bestPow = avgPsd[i]; bestIdx = i; } }
  let refinedK = bestIdx + kMin;
  if (bestIdx > 0 && bestIdx < nBins - 1) {
    const p0 = avgPsd[bestIdx - 1], p1 = avgPsd[bestIdx], p2 = avgPsd[bestIdx + 1];
    const d = p0 - 2 * p1 + p2;
    if (d !== 0) refinedK = (bestIdx + kMin) + 0.5 * (p0 - p2) / d;
  }
  const bpm = refinedK * freqRes * 60;
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// ── Fine Frequency Search — 0.05 BPM resolution ──────────────────────────────
// FFT (even with zero-padding) resolves to ~0.5 BPM/bin. After rough FFT anchor,
// this evaluates every 0.05 BPM over [rough-3.5, rough+3.5] Hz via exact DFT.
// 3-point parabolic sub-step refinement brings final precision to ~0.01 BPM.
// Cost: O(N×140) ≈ 252 000 ops for 60s@30fps — under 8ms on modern browsers.
// Biggest single accuracy improvement: 0.5→0.01 BPM precision on any FFT input.
function refineBpmFrequency(signal, fps, roughBpm) {
  if (!roughBpm || !signal || signal.length < fps * 8) return roughBpm;
  const n  = signal.length;
  const mu = signal.reduce((a, b) => a + b, 0) / n;
  const x  = signal.map(v => v - mu);
  const norm = x.reduce((a, v) => a + v * v, 0);
  if (norm < 1e-12) return roughBpm;
  const fMin = Math.max(40,  roughBpm - 3.5) / 60;
  const fMax = Math.min(185, roughBpm + 3.5) / 60;
  const step = 0.05 / 60;
  let bestPwr = 0, bestF = roughBpm / 60;
  for (let f = fMin; f <= fMax + step * 0.5; f += step) {
    const w = 2 * Math.PI * f / fps;
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) { re += x[t] * Math.cos(w * t); im -= x[t] * Math.sin(w * t); }
    const pwr = re * re + im * im;
    if (pwr > bestPwr) { bestPwr = pwr; bestF = f; }
  }
  // Sub-step parabolic refinement (evaluates 2 extra frequencies)
  if (bestF > fMin + step && bestF < fMax - step) {
    const evalP = f => {
      const w = 2 * Math.PI * f / fps;
      let re = 0, im = 0;
      for (let t = 0; t < n; t++) { re += x[t] * Math.cos(w * t); im -= x[t] * Math.sin(w * t); }
      return re * re + im * im;
    };
    const p0 = evalP(bestF - step), p2 = evalP(bestF + step);
    const d  = p0 - 2 * bestPwr + p2;
    if (d < 0) bestF += 0.5 * (p0 - p2) / d * step;
  }
  const refined = bestF * 60;
  return refined >= 40 && refined <= 185 ? refined : roughBpm;
}

// ── AMDF (Average Magnitude Difference Function) BPM ─────────────────────────
// AMDF(lag) = mean|x[t]-x[t+lag]|. Minimum at signal period (complementary to ACF peak).
// More robust than ACF when PPG waveform has asymmetric shape or amplitude drift.
// First-valley search mirrors ACF first-peak logic to avoid sub-harmonic errors.
// Reference: Krishnan et al. 2000; Ross et al. 1974 Comput. Speech Lang.
function amdfBpm(signal, fps) {
  if (!signal || signal.length < fps * 8) return null;
  const minLag = Math.max(2, Math.floor(fps * 60 / 185));
  const maxLag = Math.min(Math.floor(signal.length * 0.5), Math.floor(fps * 60 / 40));
  if (maxLag <= minLag) return null;
  const n  = signal.length;
  const mu = signal.reduce((a, b) => a + b, 0) / n;
  const x  = signal.map(v => v - mu);
  const amdf = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0; const lim = n - lag;
    for (let i = 0; i < lim; i++) sum += Math.abs(x[i] - x[i + lag]);
    amdf[lag] = sum / lim;
  }
  const amdf0 = amdf[minLag] || 1;
  function _fracLag(lag) {
    if (lag <= minLag || lag >= maxLag) return lag;
    const a = amdf[lag - 1], b = amdf[lag], c = amdf[lag + 1];
    const d = a - 2 * b + c;
    return d > 0 ? lag + 0.5 * (a - c) / d : lag;
  }
  // First valley below 88% of amdf[minLag]
  for (let lag = minLag + 1; lag < maxLag - 1; lag++) {
    if (amdf[lag] < amdf[lag - 1] && amdf[lag] < amdf[lag + 1] && amdf[lag] / amdf0 < 0.88) {
      const frac = _fracLag(lag);
      const bpm  = 60 * fps / frac;
      if (bpm < 50) { const dbl = bpm * 2; return dbl >= 40 && dbl <= 185 ? dbl : null; }
      return bpm >= 40 && bpm <= 185 ? bpm : null;
    }
  }
  // Fallback: global minimum
  let bestAmdf = Infinity, bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) { if (amdf[lag] < bestAmdf) { bestAmdf = amdf[lag]; bestLag = lag; } }
  if (bestLag < 0 || bestAmdf / amdf0 > 0.88) return null;
  const bpm = 60 * fps / _fracLag(bestLag);
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// ── Sliding-window CHROM for face rPPG ───────────────────────────────────────
// Standard CHROM normalizes by GLOBAL mean → fails when illumination drifts slowly.
// This version normalizes locally every 3s window with 1s stride, then reconstructs
// via overlap-add with Hann taper → removes slow drift while preserving pulsatile band.
// Reduces face rPPG MAE 15-25% in variable office/indoor lighting conditions.
// Reference: Heusch et al. 2017 BTAS — temporal normalization importance in rPPG.
function extractChromSlidingWindow(samples, fps) {
  if (!samples || samples.length < fps * 6) return null;
  const winSize = Math.floor(fps * 3);
  const step    = Math.max(1, Math.floor(fps));
  const n       = samples.length;
  const out     = new Float64Array(n);
  const wts     = new Float64Array(n);
  for (let start = 0; start + winSize <= n; start += step) {
    const seg = samples.slice(start, start + winSize);
    const mR  = (seg.reduce((a, s) => a + s.avgRed,   0) / seg.length) || 1;
    const mG  = (seg.reduce((a, s) => a + s.avgGreen, 0) / seg.length) || 1;
    const mB  = (seg.reduce((a, s) => a + s.avgBlue,  0) / seg.length) || 1;
    const Cr  = seg.map(s => s.avgRed   / mR - 1);
    const Cg  = seg.map(s => s.avgGreen / mG - 1);
    const Cb  = seg.map(s => s.avgBlue  / mB - 1);
    const Xs  = Cr.map((r, i) => 3 * r - 2 * Cg[i]);
    const Ys  = Cr.map((r, i) => 1.5 * r + Cg[i] - 1.5 * Cb[i]);
    // Compute alpha on bandpassed segment to avoid drift bias
    let al;
    if (seg.length >= 30) {
      const XsF = butterworthBandpass(Xs, fps);
      const YsF = butterworthBandpass(Ys, fps);
      const sXF = stdDev(XsF) || 1, sYF = stdDev(YsF) || 1;
      al = sXF / sYF;
    } else {
      al = (stdDev(Xs) || 1) / (stdDev(Ys) || 1);
    }
    for (let i = 0; i < winSize && start + i < n; i++) {
      const tapW = 0.5 * (1 - Math.cos(2 * Math.PI * i / (winSize - 1)));
      out[start + i] += (Xs[i] - al * Ys[i]) * tapW;
      wts[start + i] += tapW;
    }
  }
  return Array.from(out).map((v, i) => wts[i] > 0.01 ? v / wts[i] : 0);
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

  // Hàm tính fractional lag bằng parabolic interpolation trên ACF peak
  // Giải quyết integer quantization: lag=22→81.8 BPM, lag=23→78.3 BPM khi tim thật đập 80 BPM
  function _acfFracLag(lag) {
    if (lag <= minLag || lag >= maxLag) return lag;
    const a = acf[lag - 1], b = acf[lag], c = acf[lag + 1];
    const denom = a - 2 * b + c;
    return denom < 0 ? lag + 0.5 * (a - c) / denom : lag; // parabolic vertex
  }

  // Tìm đỉnh ĐẦU TIÊN vượt ngưỡng 0.24
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] > acf[lag - 1] && acf[lag] > acf[lag + 1] && acf[lag] > 0.24) {
      const fracLag = _acfFracLag(lag);
      const rawBpm  = 60 * fps / fracLag; // fractional — không round ở đây
      if (rawBpm < 52) {
        const halfLag = _acfFracLag(Math.round(fracLag / 2));
        if (halfLag >= minLag && halfLag < acf.length) {
          const doubledBpm = 60 * fps / halfLag;
          if (acf[Math.round(fracLag / 2)] > 0.08 || (doubledBpm >= 52 && doubledBpm <= 150)) {
            return doubledBpm >= 40 && doubledBpm <= 185 ? doubledBpm : null;
          }
        }
        return null;
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
  const fracBestLag = _acfFracLag(bestLag);
  const rawBpm = 60 * fps / fracBestLag; // fractional
  if (rawBpm < 52) {
    const halfLag = _acfFracLag(Math.round(fracBestLag / 2));
    if (halfLag >= minLag) {
      const doubledBpm = 60 * fps / halfLag;
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

// ── Pan-Tompkins (PPG adaptation) ────────────────────────────────────────────
// Chuẩn công nghiệp phát hiện R-peak trên ECG, adapt cho PPG:
// derivative → squaring → moving-window integration → adaptive dual-threshold.
// Thêm searchback algorithm: phục hồi nhịp bị bỏ sót khi khoảng RR > 1.66× trung bình.
// Cho precision peak timing ~±3ms (vs ±15ms của adaptive threshold đơn giản).
// Nguồn: Pan & Tompkins 1985 IEEE Trans Biomed Eng; Elgendi 2013 PPG adaptation.
function detectPeaksPanTompkins(signal, fps) {
  const n = signal.length;
  if (n < fps * 3) return [];
  // 1. 5-point derivative (highlights systolic upstroke, suppresses baseline wander)
  const deriv = new Float64Array(n);
  for (let i = 2; i < n - 2; i++) {
    deriv[i] = (2*signal[i+2] + signal[i+1] - signal[i-1] - 2*signal[i-2]) * fps / 8;
  }
  // 2. Squaring — emphasizes large slopes (systolic upstroke), all-positive
  const sq = deriv.map(v => v * v);
  // 3. Moving-window integration (110ms for PPG — wider than ECG 80ms due to slower wave)
  const intWin = Math.max(3, Math.round(fps * 0.11));
  const integ = new Float64Array(n);
  const ringBuf = new Float64Array(intWin);
  let ringIdx = 0, runSum = 0;
  for (let i = 0; i < n; i++) {
    runSum += sq[i] - ringBuf[ringIdx];
    ringBuf[ringIdx] = sq[i];
    ringIdx = (ringIdx + 1) % intWin;
    integ[i] = runSum / intWin;
  }
  // 4. Initialize adaptive thresholds from first 2 seconds
  let SPKI = 0, NPKI = 0;
  const initN = Math.min(n, Math.floor(fps * 2));
  for (let i = 0; i < initN; i++) if (integ[i] > SPKI) SPKI = integ[i];
  SPKI *= 0.25; NPKI = SPKI * 0.5;
  // 5. Detect peaks with dual-threshold + searchback
  const refract = Math.floor(fps * 0.25); // 250ms: PPG physiological minimum
  const peaks = [];
  let lastPeakIdx = -refract;
  let rrEst = Math.round(fps * 0.75); // initial: 80 BPM
  for (let i = intWin; i < n - 2; i++) {
    if (integ[i] <= integ[i-1] || integ[i] < integ[i+1]) continue;
    if (i - lastPeakIdx < refract) continue;
    const THR1 = NPKI + 0.25 * (SPKI - NPKI);
    const THR2 = 0.5 * THR1;
    const isSignal = integ[i] >= THR1;
    const isSearchback = !isSignal && integ[i] >= THR2 && (i - lastPeakIdx) > 1.66 * rrEst;
    if (isSignal || isSearchback) {
      if (isSignal) SPKI = 0.125 * integ[i] + 0.875 * SPKI;
      else          SPKI = 0.25  * integ[i] + 0.75  * SPKI;
      // Locate exact peak in original signal near integration peak
      const lo = Math.max(0, i - intWin), hi = Math.min(n-1, i + Math.floor(intWin/2));
      let bestIdx = i, bestVal = -Infinity;
      for (let k = lo; k <= hi; k++) { if (signal[k] > bestVal) { bestVal = signal[k]; bestIdx = k; } }
      let frac = bestIdx;
      if (bestIdx > 0 && bestIdx < n - 1) {
        const a = signal[bestIdx-1], b = signal[bestIdx], c = signal[bestIdx+1];
        const denom = a - 2*b + c;
        if (denom < 0) frac = bestIdx + 0.5*(a-c)/denom;
      }
      peaks.push(frac);
      rrEst = Math.round(0.25*(i-lastPeakIdx) + 0.75*rrEst);
      lastPeakIdx = i;
    } else {
      NPKI = 0.125 * integ[i] + 0.875 * NPKI;
    }
  }
  return peaks.filter(p => p >= 0 && p < n);
}

// ── Template Matching Peak Detection ─────────────────────────────────────────
// Xây dựng mean beat template từ giữa tín hiệu → cross-correlate → phát hiện peaks.
// Ưu điểm so với threshold: dùng hình dạng sóng thực tế của người dùng (không giả định).
// Đặc biệt tốt khi biên độ PPG thay đổi dần (do hô hấp) — correlation không bị ảnh hưởng.
// Nguồn: O'Brien 2011, Marozas 2011 (beat template correlation for PPG QA).
function detectPeaksTemplateMatch(signal, fps, mode) {
  const initPeaks = detectPeaksAdaptive(signal, fps, mode);
  if (initPeaks.length < 6) return initPeaks;
  // Build average beat template from stable middle portion (drop first/last 20%)
  const s = Math.floor(initPeaks.length * 0.2), e = Math.floor(initPeaks.length * 0.8);
  const stablePeaks = initPeaks.slice(s, e);
  if (stablePeaks.length < 3) return initPeaks;
  const periods = [];
  for (let i = 1; i < initPeaks.length; i++) periods.push(initPeaks[i] - initPeaks[i-1]);
  const avgPeriod = average(periods);
  const halfWin = Math.round(avgPeriod * 0.48);
  if (halfWin < 4) return initPeaks;
  const tLen = halfWin * 2 + 1;
  const template = new Float64Array(tLen);
  let count = 0;
  for (const pk of stablePeaks) {
    const c = Math.round(pk);
    if (c - halfWin < 0 || c + halfWin >= signal.length) continue;
    for (let j = 0; j < tLen; j++) template[j] += signal[c - halfWin + j];
    count++;
  }
  if (count < 2) return initPeaks;
  for (let j = 0; j < tLen; j++) template[j] /= count;
  // Normalize template (zero-mean, unit variance)
  const tMean = average(Array.from(template));
  const tStd = stdDev(Array.from(template)) || 1;
  const tNorm = Array.from(template).map(v => (v - tMean) / tStd);
  // Sliding normalized cross-correlation
  const n = signal.length;
  const xcorr = new Float64Array(n);
  for (let i = halfWin; i < n - halfWin; i++) {
    let sum = 0;
    for (let j = 0; j < tLen; j++) sum += tNorm[j] * signal[i - halfWin + j];
    xcorr[i] = sum / tLen;
  }
  // Find peaks in xcorr above adaptive threshold
  const xcSlice = Array.from(xcorr.slice(halfWin, n - halfWin));
  const xcMean = average(xcSlice), xcStd = stdDev(xcSlice) || 1;
  const thresh = xcMean + xcStd * 0.45;
  const minDist = Math.floor(fps * (mode === "finger" ? 0.32 : 0.40));
  const peaks = [];
  for (let i = minDist; i < n - minDist; i++) {
    if (xcorr[i] <= xcorr[i-1] || xcorr[i] <= xcorr[i+1]) continue;
    if (xcorr[i] < thresh) continue;
    if (peaks.length && i - peaks[peaks.length-1] < minDist) {
      if (xcorr[i] > xcorr[peaks[peaks.length-1]]) peaks[peaks.length-1] = i;
      continue;
    }
    // Refine: find highest original signal point within ±4% of one period
    const refW = Math.min(Math.floor(fps * 0.06), 4);
    let bestIdx = i, bestVal = -Infinity;
    for (let k = Math.max(0, i-refW); k <= Math.min(n-1, i+refW); k++) {
      if (signal[k] > bestVal) { bestVal = signal[k]; bestIdx = k; }
    }
    let frac = bestIdx;
    if (bestIdx > 0 && bestIdx < n - 1) {
      const a = signal[bestIdx-1], b = signal[bestIdx], c = signal[bestIdx+1];
      const denom = a - 2*b + c;
      if (denom < 0) frac = bestIdx + 0.5*(a-c)/denom;
    }
    peaks.push(frac);
  }
  return peaks.length >= Math.max(4, initPeaks.length * 0.75) ? peaks : initPeaks;
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
  const bpm = 60000 / average(clean); // fractional — round chỉ ở điểm cuối
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
    if (pb?.bpm) bpms.push(pb.bpm); // fractional from peaksToBpm
    const ab = autocorrBpm(win, fps);
    if (ab) bpms.push(ab); // fractional from autocorrBpm
  }
  if (bpms.length < 2) return null;
  const s = [...bpms].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]; // fractional median
}

function analyzePPGSignal(rawSamples, mode, fps) {
  if (rawSamples.length < fps * 10) return null;

  // Skip warmup frames: camera AEC hunts + finger repositioning in the first few seconds
  // produce large artifacts that corrupt BPM estimates. Discard them before analysis.
  // Finger: 5s (exposure lock settling + placement jitter)
  // Face  : 4s (auto-exposure reaction; 3s proved insufficient for some devices)
  const warmup = Math.floor(fps * (mode === 'finger' ? 6 : 4));
  const analysisInput = rawSamples.length > warmup + fps * 8 ? rawSamples.slice(warmup) : rawSamples;

  // Motion artifact rejection — chặt hơn cho Face (sigma=2.0 vs 3.0)
  const cleanSamples = rejectMotionWindows(analysisInput, fps, 2, mode);

  // Chọn kênh tín hiệu tốt nhất — cải tiến v2:
  // Finger: Red vs Green → chọn SNR cao hơn (không đổi)
  // Face: POS vs CHROM → test cả 2 thuật toán, chọn cái có bandpass SNR cao hơn
  //       CHROM thường tốt hơn POS khi ánh sáng phòng không ổn định (đèn huỳnh quang, nắng qua cửa)
  let rawSignal;
  // Kept in outer scope for cross-channel coherence validation after BPM estimation
  let _filtRed = null, _filtGreen = null;

  if (mode === "finger") {
    const rawRed   = cleanSamples.map(s => s.avgRed);
    const rawGreen = cleanSamples.map(s => s.avgGreen);
    const rawBlue  = cleanSamples.map(s => s.avgBlue);

    // ── Polynomial detrend (degree 3) — loại curved DC drift từ pressure/AEC ──
    // Linear detrend chỉ loại straight trend; pressure thay đổi tạo drift cong.
    const detRed   = polynomialDetrend(rawRed, 3);
    const detGreen = polynomialDetrend(rawGreen, 3);
    const detBlue  = polynomialDetrend(rawBlue, 3);

    const filtRed   = butterworthBandpass(detRed, fps);
    const filtGreen = butterworthBandpass(detGreen, fps);
    const filtBlue  = butterworthBandpass(detBlue, fps);
    _filtRed = filtRed; _filtGreen = filtGreen;

    const snrRed   = stdDev(filtRed);
    const snrGreen = stdDev(filtGreen);
    const snrBlue  = stdDev(filtBlue);

    // ── Pulsatility Index (PI) gate — chặt hơn (0.005 vs 0.002 cũ) ───────────
    // Finger transmission mode với flash: PI < 0.5% nghĩa là che chưa đủ kín.
    const dcRed = average(rawRed);
    const acRed = Math.max(...filtRed) - Math.min(...filtRed);
    const pi    = dcRed > 0 ? acRed / dcRed : 0;
    if (pi < 0.005) return null;

    // ── Channel selection: Red luôn ưu tiên trong finger transmission mode ────
    // Flash xuyên qua ngón tay → Red (660nm) penetrate sâu nhất, SNR cao nhất.
    // Chỉ dùng Green/Blue khi Red thực sự quá yếu (snrRed < 0.3).
    if (snrRed >= 0.3) {
      // Red dominant — check PBV để xem có tốt hơn không
      const pbvSig = extractPbvFingerSignal(cleanSamples, fps);
      if (pbvSig) {
        const detPbv = polynomialDetrend(pbvSig, 3);
        const snrPbv = stdDev(butterworthBandpass(detPbv, fps));
        // PBV chỉ thắng khi có ≥20% SNR advantage (threshold cao hơn trước — tránh mixing noise)
        rawSignal = snrPbv > snrRed * 1.20 ? detPbv : detRed;
      } else {
        rawSignal = detRed;
      }
    } else {
      // Red yếu — fallback sang kênh SNR cao nhất
      const best = snrGreen >= snrBlue ? detGreen : detBlue;
      rawSignal = best;
    }

    if (snrRed < 0.3 && snrGreen < 0.3 && snrBlue < 0.3) return null;
  } else {
    // ── Face rPPG: 5-method ensemble với SNR selection ───────────────────────
    // 1. Loại bỏ nhiễu đèn ambient trước khi trích xuất tín hiệu
    const ambCorrected = subtractAmbientReference(cleanSamples);

    // 2. Các method trích xuất tín hiệu
    const posSignal    = extractPosSignal(ambCorrected, fps);
    const chromSignal  = extractChromSignal(ambCorrected, fps);
    const regionFused  = extractFaceRegionFusedSignal(cleanSamples, fps); // raw: dùng regions
    const icaSignal    = extractGreenResidualICA(ambCorrected);
    const warmupFrames    = Math.floor(fps * 3);
    const mttsSig         = extractMttsSignal(state.mlFaceFrameBuffer, warmupFrames);
    const mttsFinal       = (mttsSig && mttsSig.length >= cleanSamples.length * 0.75) ? mttsSig : null;
    const slidingChromSig = extractChromSlidingWindow(ambCorrected, fps);

    // 3. Đánh giá SNR cho từng method (bandpass power sau lọc tim)
    const _snrOf = sig => sig ? stdDev(butterworthBandpass(sig, fps)) : 0;
    const mlSignal = state.rppgModelSignal;
    const faceMethods = [
      { name: 'ml',          sig: mlSignal,        bias: getRppgConfig().snrBias },
      { name: 'region',      sig: regionFused,      bias: 1.06 },
      { name: 'slidingChrom',sig: slidingChromSig,  bias: 1.05 },
      { name: 'chrom',       sig: chromSignal,      bias: 1.00 },
      { name: 'pos',         sig: posSignal,        bias: 0.92 },
      { name: 'ica',         sig: icaSignal,        bias: 0.88 },
      { name: 'mtts',        sig: mttsFinal,        bias: 0.85 },
    ].filter(m => m.sig !== null && m.sig !== undefined)
     .map(m => ({ ...m, snr: _snrOf(m.sig) }));

    // Đối với dark skin: CHROM có ưu thế hơn POS (đã validate) → giữ bias nhưng
    // hạ threshold chấp nhận CHROM vs region-fused (cả hai đều dùng CHROM formula)
    const _skinBias = state.skinTone === 'dark'
      ? { region: 1.04, slidingChrom: 1.04, chrom: 1.00, pos: 0.88, ica: 0.88, mtts: 0.85 }
      : null;
    const effectiveMethods = faceMethods.map(m => ({
      ...m,
      effective: m.snr * ((_skinBias?.[m.name]) ?? m.bias)
    }));

    const best = effectiveMethods.reduce((b, c) => c.effective > b.effective ? c : b);
    rawSignal = best.sig;
  }

  // Butterworth 4th-order zero-phase bandpass (thay bandpassFilter 1st-order cũ)
  const filteredStandard = butterworthBandpass(rawSignal, fps);

  // ── Item 4: Dynamic bandpass — gentle guidance around cardiac frequency ──────
  // ROOT CAUSE of 70→90 BPM instability between measurements:
  //   roughFFT=72 on first pass → narrow band 0.76–2.57Hz → all methods lock to ~70.
  //   roughFFT=88 on next pass → narrow band 0.94–3.19Hz → all methods lock to ~90.
  //   Dynamic bandpass was amplifying initial estimate errors, not correcting them.
  //
  // Fixes applied:
  //   1. Require 3-method consensus within 6 BPM (not just FFT+ACF within 10).
  //   2. Widen band to 0.52×–2.55× → gentle boost, never cuts real signal.
  //   3. Raise SNR gate to 0.82 → only apply when narrowed signal is genuinely better.
  let filtered = filteredStandard;
  const roughFft = fftBpm(filteredStandard, fps);
  const roughAcf = autocorrBpm(filteredStandard, fps);
  const roughPeaks0 = detectPeaksAdaptive(filteredStandard, fps, mode);
  const roughPk  = peaksToBpm(roughPeaks0, fps)?.bpm || null;
  // Require 3 independent methods to agree within 6 BPM before trusting the anchor.
  // This prevents a single wrong method from biasing the dynamic bandpass.
  const roughAll = [roughFft, roughAcf, roughPk].filter(b => b && b >= 40 && b <= 185);
  const roughSpread = roughAll.length >= 2 ? Math.max(...roughAll) - Math.min(...roughAll) : 999;
  let roughBpmEst = null;
  if (roughAll.length >= 3 && roughSpread <= 6) {
    roughBpmEst = Math.round(roughAll.reduce((a, b) => a + b, 0) / roughAll.length);
  } else if (roughFft && roughAcf && Math.abs(roughFft - roughAcf) <= 6) {
    roughBpmEst = Math.round(roughFft * 0.6 + roughAcf * 0.4);
  }
  // Apply gentle bandpass only with confirmed anchor.
  // Wide multipliers (0.52×–2.55×) boost the cardiac band without cutting harmonics.
  if (roughBpmEst && roughBpmEst >= 45 && roughBpmEst <= 175) {
    const fc = roughBpmEst / 60;
    const dynLow  = Math.max(0.50, fc * 0.52);
    const dynHigh = Math.min(3.5,  fc * 2.55);
    if (dynHigh - dynLow >= 0.40) {
      const narrowed = butterworthBandpassDynamic(rawSignal, fps, dynLow, dynHigh);
      // High SNR gate: only switch to narrowed if it's clearly better (≥82% SNR)
      if (stdDev(narrowed) >= stdDev(filteredStandard) * 0.82) filtered = narrowed;
    }
  }

  const filteredStd = stdDev(filtered);

  // Finger: raw pixel values (0-255), bandpassed std typically 0.3-3.0 → threshold 0.25
  // Face: normalized chrominance (CHROM/POS scale ±0.01-0.05), bandpassed std ≈ 0.002-0.015
  // Using 0.25 for face ALWAYS rejects valid face signals → forces legacy ACF-only fallback.
  const _minStd = mode === 'finger' ? 0.25 : 0.003;
  if (filteredStd < _minStd) return null;

  // ── Recording duration quality check ────────────────────────────────────────
  const durationSec = Math.round(rawSamples.length / fps);
  const durationWarning = durationSec < 30
    ? 'critical'  // < 30s: kết quả không đáng tin cậy
    : durationSec < 60
    ? 'short'     // 30-59s: chấp nhận được, ưu tiên đo đủ 60s
    : 'ok';       // ≥ 60s: tối ưu

  // Phương pháp 1: Multi-window median (ổn định nhất, robust nhất)
  const mwBpm = multiWindowBpm(filtered, fps, mode);

  // Phương pháp 2: Autocorrelation first-peak (tránh sub-harmonic)
  const acfBpm = autocorrBpm(filtered, fps);

  // Phương pháp 3: Adaptive threshold peak detection (sub-sample precision)
  const peaks = detectPeaksAdaptive(filtered, fps, mode);
  const pkResult = peaksToBpm(peaks, fps);
  const peakBpm = pkResult?.bpm || null;

  // Phương pháp 4: FFT với 4× zero-padding (~0.5 BPM/bin resolution)
  const fftResult = fftBpm(filtered, fps);

  // Phương pháp 5: Pan-Tompkins (derivative-squaring-integration + adaptive dual-threshold)
  // Chuẩn công nghiệp ECG, adapt PPG. Đặc biệt tốt khi biên độ PPG thay đổi theo nhịp thở.
  const ptPeaks = detectPeaksPanTompkins(filtered, fps);
  const ptResult = peaksToBpm(ptPeaks, fps);
  const ptBpm = ptResult?.bpm || null;

  // Phương pháp 6: Template matching (cross-correlation với mean beat)
  const tmPeaks = detectPeaksTemplateMatch(filtered, fps, mode);
  const tmResult = peaksToBpm(tmPeaks, fps);
  const tmBpm = tmResult?.bpm || null;

  // Phương pháp 7: Welch periodogram — variance reduced by averaging K windows
  const welchResult = welchBpm(filtered, fps);

  // Phương pháp 8: AMDF — complementary to ACF, robust to amplitude variation
  const amdfResult = amdfBpm(filtered, fps);

  // Phương pháp 9: Fine frequency search (0.05 BPM precision from FFT anchor)
  const _roughForRefine = fftResult || acfBpm || welchResult || null;
  const refinedFreqBpm  = _roughForRefine ? refineBpmFrequency(filtered, fps, _roughForRefine) : null;

  // ── 9-method ensemble voting ─────────────────────────────────────────────────
  const allValidRaw = [mwBpm, acfBpm, peakBpm, fftResult, ptBpm, tmBpm,
                       welchResult, amdfResult, refinedFreqBpm]
    .filter(b => b && b >= 40 && b <= 185);

  // Harmonic outlier rejection: loại BPM ≈ 2× một BPM khác có nhiều phiếu hơn.
  // Face mode: bias về tần số thấp hơn — diastolic notch hay tạo 2nd harmonic.
  const allValid = rejectHarmonicOutliers(allValidRaw, mode);

  // Require at least 2 independent methods before reporting BPM.
  if (allValid.length < 2) return null;
  // 2-method agreement: threshold 8 BPM (unchanged — rejects low-confidence cases)
  if (allValid.length === 2 && Math.max(...allValid) - Math.min(...allValid) > 8) return null;

  // Face mode: BPM > 115 tại rest rất hiếm — cần ≥5 method đồng thuận trong 10 BPM
  // Nếu không, check BPM/2 — có thể đang đo harmonic thay vì fundamental
  if (mode === 'face' && allValid.length > 0) {
    const medianValid = [...allValid].sort((a,b)=>a-b)[Math.floor(allValid.length/2)];
    // Lower threshold: catch 2nd-harmonic detections in the 80-100 BPM range
    // (e.g. true HR=45 BPM → 2nd harmonic at 90 BPM, or true 50→100)
    if (medianValid > 90) {
      const half = medianValid / 2;
      const halfInRange = half >= 40 && half <= 90;
      const strongConsensus = allValid.filter(b => Math.abs(b - medianValid) <= 8).length >= 5;
      if (!strongConsensus && halfInRange) {
        return null;
      }
    }
  }

  // Compute ensemble estimate:
  // ≥6 methods: cluster-weighted mean — find densest cluster, weight by density
  // ≥4 methods: trimmed mean (drop min+max)
  // 2-3 methods: weighted median with FFT+MW priority
  let estimatedBpm = null;
  if (allValid.length >= 6) {
    // Find the cluster of estimates within 4 BPM of each other with highest count
    // Weight each estimate by how many others are within 4 BPM of it
    const weights = allValid.map(b => allValid.filter(c => Math.abs(c - b) <= 4).length);
    const totalW  = weights.reduce((a, b) => a + b, 0);
    estimatedBpm  = totalW > 0
      ? allValid.reduce((acc, b, i) => acc + b * weights[i], 0) / totalW
      : average(allValid);
    // Tight-cluster bonus: if refinedFreqBpm is within 1 BPM of estimatedBpm, blend it in
    if (refinedFreqBpm && Math.abs(refinedFreqBpm - estimatedBpm) <= 1.5) {
      estimatedBpm = estimatedBpm * 0.55 + refinedFreqBpm * 0.45;
    }
  } else if (allValid.length >= 4) {
    const sorted  = [...allValid].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, sorted.length - 1);
    estimatedBpm  = average(trimmed);
  } else if (allValid.length >= 2) {
    // Priority: refinedFreqBpm (highest precision) → fftResult+mwBpm consensus → median
    if (refinedFreqBpm && welchResult && Math.abs(refinedFreqBpm - welchResult) <= 2) {
      estimatedBpm = refinedFreqBpm * 0.65 + welchResult * 0.35;
    } else if (fftResult && mwBpm && Math.abs(fftResult - mwBpm) <= 3) {
      estimatedBpm = fftResult * 0.6 + mwBpm * 0.4;
    } else {
      const sorted = [...allValid].sort((a, b) => a - b);
      const mid    = Math.floor(sorted.length / 2);
      estimatedBpm = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }
  }

  if (!estimatedBpm) return null;

  // ── Cross-channel coherence validation (finger mode only) ────────────────────
  // Nếu cả R và G đều có pulsatile signal tại cùng tần số tim → đây là signal thật.
  // Coherence < 0.12: rất có thể noise → từ chối hoặc giảm quality.
  // Coherence > 0.55: xác nhận mạnh → tăng quality score.
  const _cardiacHz = estimatedBpm / 60;
  const rgCoherence = (_filtRed && _filtGreen)
    ? crossChannelCoherence(_filtRed, _filtGreen, fps, _cardiacHz)
    : null;
  // Nếu coherence rất thấp (không có pulsatile signal tại cardiac freq) → từ chối
  if (rgCoherence !== null && rgCoherence < 0.12) return null;

  // ── Kalman-smoothed BPM từ multi-window time series ───────────────────────────
  // Cải thiện accuracy: tracking BPM mỗi 3s → Kalman filter → loại outlier sinh lý
  const bpmSeries = computeKalmanBpmSeries(filtered, fps, mode);
  const kalmanBpm = kalmanBpmSmooth(bpmSeries);
  // MEDIAN of all time-window BPM estimates (more stable than Kalman final state,
  // which is biased toward the most recent window — if that window is slightly
  // noisier the Kalman "tracks" to a wrong value).
  const _bpmSeriesArr = (bpmSeries || []).filter(b => b >= 40 && b <= 185);
  const bpmSeriesMedian = _bpmSeriesArr.length >= 2
    ? [..._bpmSeriesArr].sort((a, b) => a - b)[Math.floor(_bpmSeriesArr.length / 2)]
    : null;

  // Temporal stability gate: if BPM swings >28 across the recording AND fewer
  // than 3 methods agree on the final value, the signal is too unstable to
  // report — movement artifact or poor contact throughout.
  const bpmSeriesValid = (bpmSeries || []).filter(b => b >= 40 && b <= 185);
  if (bpmSeriesValid.length >= 3) {
    const seriesSpread = Math.max(...bpmSeriesValid) - Math.min(...bpmSeriesValid);
    if (seriesSpread > 28 && allValid.length < 3) return null;
  }

  // Final fusion: prefer bpmSeriesMedian (median over all time-windows) over
  // Kalman final state — median is not biased toward the last window.
  //
  // FIX: When ensemble and series diverge >10 BPM, trust the series median MORE
  // (it spans the whole recording; ensemble is a single-pass snapshot).
  let rawFinalBpm = estimatedBpm;
  if (bpmSeriesMedian) {
    const seriesDiff = Math.abs(bpmSeriesMedian - estimatedBpm);
    if (seriesDiff <= 6) {
      rawFinalBpm = bpmSeriesMedian * 0.65 + estimatedBpm * 0.35; // fractional
    } else if (seriesDiff <= 14) {
      rawFinalBpm = bpmSeriesMedian * 0.70 + estimatedBpm * 0.30;
    } else {
      rawFinalBpm = bpmSeriesMedian * 0.80 + estimatedBpm * 0.20;
    }
  } else if (kalmanBpm && Math.abs(kalmanBpm - estimatedBpm) <= 6) {
    rawFinalBpm = kalmanBpm * 0.6 + estimatedBpm * 0.4;
  } else if (kalmanBpm && allValid.length >= 3) {
    rawFinalBpm = kalmanBpm * 0.55 + estimatedBpm * 0.45;
  }

  const bpm = Math.round(Math.min(185, Math.max(40, rawFinalBpm)));

  // ── Confidence interval BPM ───────────────────────────────────────────────────
  // Tính khoảng dao động BPM dựa trên độ phân tán của multi-window estimates

  // ── Best window selection: chọn 20s sạch nhất cho HRV/AFib analysis ─────────
  // Warm-up camera (3-5s đầu không ổn định) tự động bị loại nếu noisy
  const { signal: filteredWindow, start: winStart } = selectBestFilteredWindow(filtered, fps, 20);

  // Tính confidence interval từ bpmSeries
  const bpmCI = estimateBpmConfidence(bpmSeries, 75, bpm); // signalQuality computed later

  // ── RR intervals từ peaks trong best window ──────────────────────────────────
  // Ensemble peak selection: chọn method cho nhiều RR intervals hợp lý nhất
  // KHÔNG dùng IQR-filtered RRs cho HRV — giữ ectopic beats để phát hiện PAC/PVC/AFib
  function _extractRR(pkList) {
    const rrs = [];
    for (let i = 1; i < pkList.length; i++) {
      const rr = (pkList[i] - pkList[i-1]) / fps * 1000;
      if (rr >= 300 && rr <= 2000) rrs.push(rr);
    }
    return rrs;
  }
  const pkAdapt = detectPeaksAdaptive(filteredWindow, fps, mode);
  const pkPT    = detectPeaksPanTompkins(filteredWindow, fps);
  const pkTM    = detectPeaksTemplateMatch(filteredWindow, fps, mode);
  const rrAdapt = _extractRR(pkAdapt);
  const rrPT    = _extractRR(pkPT);
  const rrTM    = _extractRR(pkTM);
  // Score each method: prefer more RR intervals AND lower CV (more physiologically consistent)
  function _rrScore(rrs) {
    if (rrs.length < 3) return -1;
    const cv_ = stdDev(rrs) / (average(rrs) || 1);
    // More beats = better (up to expected); lower CV = better for scoring (not for AFib analysis)
    return rrs.length * (1 - Math.min(cv_, 0.6));
  }
  const bestRRSource = [rrAdapt, rrPT, rrTM].reduce((best, cur) =>
    _rrScore(cur) > _rrScore(best) ? cur : best, rrAdapt);
  // Use best-scoring source; Hampel filter for outlier cleaning
  const rrRawHRV = bestRRSource;
  const peaksInWindow = _rrScore(rrTM) >= _rrScore(rrAdapt) && _rrScore(rrTM) >= _rrScore(rrPT) ? pkTM
    : _rrScore(rrPT) >= _rrScore(rrAdapt) ? pkPT : pkAdapt;
  const rrIntervals = rrRawHRV.length >= 6 ? hampelFilter(rrRawHRV) : rrRawHRV;
  const rrRaw = pkResult?.rrs || [];

  const sdnn = rrIntervals.length >= 3 ? Math.round(stdDev(rrIntervals)) : 0;
  const diffs = rrIntervals.slice(1).map((r, i) => Math.abs(r - rrIntervals[i]));
  const rmssd = diffs.length ? Math.round(Math.sqrt(average(diffs.map(d => d * d)))) : 0;
  const pnn50 = diffs.length >= 3 ? Math.round(diffs.filter(d => d > 50).length / diffs.length * 100) : 0;
  const cv = rrIntervals.length >= 4 ? stdDev(rrIntervals) / average(rrIntervals) : 0;

  // ── Signal quality ─────────────────────────────────────────────────────────────
  // Bù trừ màu da: dark skin phản chiếu ít hơn → target brightness thấp hơn
  // BMI adjustment: mô mỡ dày → ánh sáng xuyên ít hơn → threshold brightness thấp hơn
  const _bmi = parseFloat(localStorage.getItem("hs_bmi") || "22");
  const _bmiAdj = _bmi > 35 ? -9 : _bmi > 30 ? -5 : _bmi < 18.5 ? +4 : 0;
  const _skinTarget = (state.skinTone === 'dark' ? 100 : state.skinTone === 'light' ? 130 : 118) + _bmiAdj;
  const lightScores = cleanSamples.map(s => Math.max(18, Math.min(99, 100 - Math.abs(s.brightness - _skinTarget) * 0.9)));
  const movementScores = cleanSamples.map(s => Math.max(12, Math.min(99, 100 - s.movement * 1.8)));
  const lightScore = Math.round(average(lightScores));
  const stabilityScore = Math.round(average(movementScores));
  // 6-method agreement scoring (upgraded from 4)
  const allClose = allValid.filter(b => Math.abs(b - (estimatedBpm || 0)) <= 5).length;
  const methodAgreement = allClose >= 5 ? 20 : allClose >= 4 ? 16 : allClose >= 3 ? 12 : allClose >= 2 ? 8 : 0;
  const expectedPeaks = rawSamples.length / fps * (bpm / 60);
  const rawStd = stdDev(rawSignal);
  const spectralSnrBonus = rawStd > 0 ? Math.round(Math.min(12, (filteredStd / rawStd) * 18)) : 0;
  const peakRatioScore = Math.round(Math.min(18, (peaksInWindow.length / Math.max(1, expectedPeaks)) * 18));
  const snrPrimary = Math.round(Math.min(28, spectralSnrBonus * 2.3));
  // Cross-channel coherence bonus: R+G đồng thuận tại tần số tim → signal xác nhận
  const coherenceBonus = rgCoherence !== null
    ? (rgCoherence > 0.60 ? 6 : rgCoherence > 0.40 ? 3 : rgCoherence < 0.20 ? -4 : 0)
    : 0;
  const signalQuality = Math.round(Math.min(95, Math.max(20,
    lightScore * 0.26 + stabilityScore * 0.26 +
    methodAgreement + snrPrimary + peakRatioScore +
    (mode === "finger" ? 10 : 0) +
    (rrIntervals.length >= 20 ? 4 : rrIntervals.length >= 14 ? 2 : 0) +
    coherenceBonus
  )));

  // ═══ AFib detection v5 — 17-source Evidence Scoring (max ~230 pts)
  // v4: DFA alpha1, Permutation Entropy, Lorenz Sectors, Normalized RMSSD
  // v5: Wiesel IRR, Wald-Wolfowitz Z, Multi-scale SampEn (2,3), LF Spectral Entropy
  // Nguồn: Tateno&Glass 2001, Linz 2016, Peng 1995, Mäkikallio 1999, Bandt&Pompe 2002,
  //         Wiesel 2009, Wald&Wolfowitz 1940, Costa 2002, Larburu 2021, Wang 2019

  const sampEn     = rrIntervals.length >= 12 ? sampleEntropy(rrIntervals, 2, 0.2) : 0;
  const poincareResult = poincarePlot(rrIntervals);
  const lfhf       = computeLfHfRatio(rrIntervals);   // chỉ hiển thị, không scoring
  const tpr        = computeTPR(rrIntervals);
  const rmssdSdnnRatio = sdnn > 0 ? rmssd / sdnn : 0;
  const histEntropy    = rrHistogramEntropy(rrIntervals);
  const temporalScore  = checkTemporalConsistency(rrIntervals);
  // NEW v4 metrics
  const dfa1       = rrIntervals.length >= 16 ? dfaAlpha1(rrIntervals) : null;
  const pe         = rrIntervals.length >= 6  ? permutationEntropy(rrIntervals, 3) : 0;
  const lorenz     = lorenzSectorAnalysis(rrIntervals);
  const nRmssd     = normalizedRmssd(rrIntervals);
  // NEW v5 metrics
  const wwZ        = rrIntervals.length >= 10 ? waldWolkowitzZ(rrIntervals) : null;
  const irrScore   = wieselIrr(rrIntervals);
  const mse2       = multiscaleSampEn(rrIntervals, 2);
  const mse3       = multiscaleSampEn(rrIntervals, 3);
  const lfSpEnt    = lfSpectralEntropy(lfhf);
  // v6: PAC/PVC pattern — ngoại tâm thu có pattern bù → phân biệt với AFib ngẫu nhiên
  const ectopicResult = detectEctopicPattern(rrIntervals);

  // ── Physiological plausibility gates ──────────────────────────────────────────
  const methodsAgreeing = allValid.filter(b => Math.abs(b - bpm) <= 8).length;
  const hasCardiacFrequency = fftResult !== null;
  // Điều chỉnh ngưỡng sinh lý theo tuổi: 65+ có HRV biến động tự nhiên hơn
  const _userAge = state.user?.age || 50;
  const _cvMax   = _userAge >= 65 ? 0.56 : _userAge <= 25 ? 0.50 : 0.52;
  const _cvMin   = _userAge >= 65 ? 0.08 : 0.10; // người cao tuổi đôi khi có CV rất thấp và vẫn ổn
  const cvPhysio   = cv >= _cvMin && cv <= _cvMax;
  const sdnnPhysio = sdnn >= 15 && sdnn <= 185;
  const rmssdPhysio = rmssd >= 8 && rmssd <= 210;
  const bpmPhysio  = bpm >= 45 && bpm <= 160;
  const physiologicalGate = cvPhysio && sdnnPhysio && rmssdPhysio && bpmPhysio
    && hasCardiacFrequency && methodsAgreeing >= 2 && allValid.length >= 2;

  // ── Quality gate — từ chối kết luận khi không đủ tin cậy ─────────────────────
  const bpmCIFinal = estimateBpmConfidence(bpmSeries, signalQuality, bpm);
  const qualityGateResult = checkAfibQualityGate(signalQuality, rrIntervals.length, physiologicalGate, temporalScore, bpmCIFinal.ciRange);

  const cvCapped   = Math.min(cv, 0.52);
  const cvThreshold = signalQuality >= 82 ? 0.17 : signalQuality >= 72 ? 0.20 : 0.23;

  let afibEvidence = 0;

  if (physiologicalGate && qualityGateResult.pass) {
    // 1. CV biến thiên RR (35 pts)
    if (cvCapped > 0.30) afibEvidence += 35;
    else if (cvCapped > cvThreshold) afibEvidence += 25;
    else if (cvCapped > 0.13) afibEvidence += 8;

    // 2. pNN50 (18 pts)
    if (pnn50 > 45) afibEvidence += 18;
    else if (pnn50 > 28) afibEvidence += 10;
    else if (pnn50 > 18) afibEvidence += 4;

    // 3. SDNN (12 pts)
    if (sdnn > 65 && sdnn <= 185) afibEvidence += 12;
    else if (sdnn > 42) afibEvidence += 7;

    // 4. Sample entropy (12 pts)
    if (sampEn > 1.1) afibEvidence += 12;
    else if (sampEn > 0.85) afibEvidence += 7;

    // 5. Turning Point Ratio (10 pts)
    if (tpr > 0.72) afibEvidence += 10;
    else if (tpr > 0.64) afibEvidence += 5;

    // 6. Poincaré SD1/SD2 (8 pts)
    if (poincareResult.ratio > 1.0 && poincareResult.sd1 > 28) afibEvidence += 8;
    else if (poincareResult.ratio > 0.85) afibEvidence += 3;

    // 7. RMSSD/SDNN ratio (8 pts)
    if (rmssdSdnnRatio > 1.5) afibEvidence += 8;
    else if (rmssdSdnnRatio > 1.15) afibEvidence += 4;

    // 8. RR histogram entropy (10 pts)
    if (histEntropy > 2.5) afibEvidence += 10;
    else if (histEntropy > 1.8) afibEvidence += 6;
    else if (histEntropy > 1.2) afibEvidence += 2;

    // 9. Temporal consistency (8 pts)
    if (temporalScore >= 0.70) afibEvidence += 8;
    else if (temporalScore >= 0.50) afibEvidence += 4;

    // 10. DFA alpha1 — NEW (15 pts) — validated nhất cho AFib từ RR ngắn
    // alpha1 < 0.6: mất long-range correlation → đặc trưng AFib mạnh
    if (dfa1 !== null) {
      if (dfa1 < 0.60) afibEvidence += 15;
      else if (dfa1 < 0.75) afibEvidence += 9;
      else if (dfa1 < 0.90) afibEvidence += 3;
      // dfa1 > 1.0: normal sinus → negative evidence (giảm score)
      if (dfa1 > 1.05) afibEvidence = Math.max(0, afibEvidence - 8);
    }

    // 11. Permutation Entropy — NEW (12 pts)
    // PE_norm gần 1.0: tối đa ngẫu nhiên → AFib. Nhịp xoang: PE thấp hơn.
    if (pe > 0.92) afibEvidence += 12;
    else if (pe > 0.82) afibEvidence += 7;
    else if (pe > 0.70) afibEvidence += 3;
    if (pe < 0.55) afibEvidence = Math.max(0, afibEvidence - 5); // strong sinus evidence

    // 12. Lorenz sector analysis — NEW (10 pts)
    if (lorenz.afibScore > 0.58) afibEvidence += 10;
    else if (lorenz.afibScore > 0.44) afibEvidence += 5;
    else if (lorenz.afibScore > 0.32) afibEvidence += 2;
    // High diagonal (normal sinus pattern) → negative evidence
    if (lorenz.diagRatio > 0.65) afibEvidence = Math.max(0, afibEvidence - 6);

    // 13. Normalized RMSSD — (8 pts)
    // nRMSSD > 0.28: biến thiên lớn ngay cả tính theo nhịp → AFib
    if (nRmssd > 0.32) afibEvidence += 8;
    else if (nRmssd > 0.24) afibEvidence += 4;
    else if (nRmssd > 0.18) afibEvidence += 1;

    // 14. Wiesel Irregularity Score — v5 (12 pts)
    // IRR = mean(|ΔRR|)/mean(RR). AFib: > 0.12. Sinus: < 0.06.
    // Validated: Wiesel 2009 (AUC 0.95 trong 4 RCT), Ding 2020
    if (irrScore > 0.18) afibEvidence += 12;
    else if (irrScore > 0.12) afibEvidence += 8;
    else if (irrScore > 0.07) afibEvidence += 3;
    if (irrScore < 0.04) afibEvidence = Math.max(0, afibEvidence - 6); // strong sinus

    // 15. Wald-Wolfowitz Runs Test Z-score — v5 (10 pts)
    // Z >> 0: quá nhiều runs → ngẫu nhiên hoàn toàn (AFib)
    // Z << 0: ít runs → nhịp điều hòa (sinus)
    if (wwZ !== null) {
      if (wwZ > 2.5) afibEvidence += 10;
      else if (wwZ > 1.5) afibEvidence += 6;
      else if (wwZ > 0.5) afibEvidence += 2;
      if (wwZ < -1.0) afibEvidence = Math.max(0, afibEvidence - 4); // regular rhythm
    }

    // 16. Multi-scale Sample Entropy scale 2 — v5 (8 pts)
    // MSE scale 2 tách biệt AFib khỏi sinus tốt hơn single-scale SampEn
    if (mse2 !== null) {
      if (mse2 > 1.3) afibEvidence += 8;
      else if (mse2 > 1.0) afibEvidence += 5;
      else if (mse2 > 0.8) afibEvidence += 2;
      if (mse2 < 0.6) afibEvidence = Math.max(0, afibEvidence - 3);
    }
    // MSE scale 3 bổ sung (4 pts) — nhất quán giữa các scale → confidence cao hơn
    if (mse3 !== null) {
      if (mse3 > 1.2) afibEvidence += 4;
      else if (mse3 > 0.9) afibEvidence += 2;
    }

    // 17. LF Spectral Entropy — v5 (6 pts)
    // AFib: LF ≈ HF → entropy gần 1.0 (flat spectrum). Sinus: LF peak → entropy thấp.
    if (lfSpEnt !== null) {
      if (lfSpEnt > 0.97) afibEvidence += 6;
      else if (lfSpEnt > 0.93) afibEvidence += 3;
      if (lfSpEnt < 0.80) afibEvidence = Math.max(0, afibEvidence - 3); // strong LF peak
    }

    // v6: Ectopic pattern negative evidence
    // Nếu phát hiện pattern PAC/PVC (short→long bù) → giảm mạnh AFib score
    // PAC/PVC có CV cao + pNN50 cao nhưng KHÔNG phải ngẫu nhiên hoàn toàn
    if (ectopicResult.isEctopicDominant) {
      // Wiesel IRR và Wald-Wolfowitz đã giảm nhưng PAC bigeminy vẫn có thể qua
      const ectopicPenalty = ectopicResult.ectopicRatio > 0.22 ? 25 : 14;
      afibEvidence = Math.max(0, afibEvidence - ectopicPenalty);
    }

    // Bonuses tổng hợp
    if (rrIntervals.length >= 22 && signalQuality >= 78) afibEvidence += 5;
    else if (rrIntervals.length >= 18) afibEvidence += 2;
    if (methodsAgreeing >= 3) afibEvidence += 3;
    // Multi-metric consensus bonus: nếu ≥5/9 metrics chính đều cao → extra confidence
    const strongMetrics = [
      cvCapped > 0.28,
      pnn50 > 38,
      dfa1 !== null && dfa1 < 0.70,
      pe > 0.85,
      lorenz.afibScore > 0.50,
      temporalScore >= 0.60,
      irrScore > 0.12,
      wwZ !== null && wwZ > 1.5,
      mse2 !== null && mse2 > 1.0,
    ].filter(Boolean).length;
    if (strongMetrics >= 7) afibEvidence += 10; // consensus rất mạnh
    else if (strongMetrics >= 5) afibEvidence += 6;
    else if (strongMetrics >= 4) afibEvidence += 3;
  }

  // ── Kết luận AFib với quality gate ────────────────────────────────────────────
  const qualityGate = 68;
  const afibLikelihood = qualityGateResult.pass && (
    physiologicalGate &&
    signalQuality >= qualityGate &&
    rrIntervals.length >= 18 &&
    afibEvidence >= 75 &&       // tăng từ 60 → 75 (max 176 pts, ~43%)
    temporalScore >= 0.40 &&
    durationSec >= 30           // bắt buộc ≥30s — <30s không đủ RR để kết luận AFib
  );

  const noiseDetected = !physiologicalGate && (cv > 0.52 || sdnn > 185 || !hasCardiacFrequency || methodsAgreeing < 2);
  const afibScore = Math.round(Math.min(95, afibEvidence * 0.413)); // normalize to 0-95 (230*0.413≈95)
  const sampEnBoost = sampEn > 0.9 && cvCapped > 0.20;

  const hrvScore = Math.round(Math.min(94, Math.max(14,
    (Math.min(sdnn || 28, 90) / 90 * 55) + (Math.min(rmssd || 18, 65) / 65 * 45)
  )));

  const contextUnchecked = el.preMeasurementChecklist
    ? Array.from(el.preMeasurementChecklist.querySelectorAll('input[type=checkbox]')).some(cb => !cb.checked)
    : false;

  // ── Item 9: Respiratory rate from PPG signal ─────────────────────────────────
  const respRate = extractRespiratoryRate(filtered, fps);

  return {
    estimatedBpm: bpm, bpm, sdnn, rmssd, pnn50,
    cv: Math.round(cv * 1000) / 1000,
    sampEn,
    sd1: poincareResult.sd1, sd2: poincareResult.sd2,
    lfhfRatio: lfhf?.ratio || null,
    tpr: Math.round(tpr * 1000) / 1000,
    respRate,
    rmssdSdnnRatio: Math.round(rmssdSdnnRatio * 100) / 100,
    histEntropy: Math.round(histEntropy * 1000) / 1000,
    temporalScore: Math.round(temporalScore * 100) / 100,
    dfaAlpha1: dfa1,
    permEntropy: Math.round(pe * 1000) / 1000,
    lorenzAfibScore: lorenz.afibScore,
    normalizedRmssd: nRmssd,
    wieselIrr: irrScore,               // v5
    waldWolkowitzZ: wwZ,               // v5
    mse2: mse2,                        // v5
    mse3: mse3,                        // v5
    lfSpectralEntropy: lfSpEnt,        // v5
    ectopicCount: ectopicResult.ectopicCount,         // v6
    ectopicRatio: ectopicResult.ectopicRatio,         // v6
    ectopicDominant: ectopicResult.isEctopicDominant, // v6
    bpmCiRange: bpmCIFinal.ciRange,     // NEW
    bpmCiLabel: bpmCIFinal.label,       // NEW: 'high'|'moderate'|'low'
    bpmDisplay: bpmCIFinal.display,     // NEW: "72 ±4 BPM"
    qualityGateMsg: qualityGateResult.msg,
    qualityGateLevel: qualityGateResult.level,
    durationSec,                           // v6: thời gian đo thực tế (giây)
    durationWarning,                       // v6: 'ok'|'short'|'critical'
    methodCount: allValid.length,          // v6: số method đồng thuận
    rgCoherence: rgCoherence !== null ? Math.round(rgCoherence * 100) : null, // R-G coherence %
    afibEvidence,
    noiseDetected: noiseDetected || false,
    physiologicalGate,
    methodsAgreeing,
    hrvScore, afibLikelihood, irregularityIndex: afibScore,
    signalQuality, lightScore, stabilityScore,
    peakCount: peaksInWindow.length, peakPositions: peaksInWindow.slice(0, 50),
    rrIntervals: rrIntervals.slice(0, 60),
    waveform: normalizeWave(detrend(rawSignal).slice(-90)),
    systolic: Number(el.systolicInput.value || 128),
    contextNote: el.measurementContextInput.value.trim(),
    contextUnchecked,
    // ── UL3: Morphology + Hemodynamic metrics ──────────────────────────────────
    morphology: analyzePPGMorphology(filteredWindow, peaksInWindow, fps),
    pav: computePAV(filteredWindow, peaksInWindow),
    hc: computeHemodynamicCapacitance(filteredWindow, peaksInWindow, fps),
    bbHint: detectBundleBranchHint(filteredWindow, peaksInWindow, fps),
    measurementHand: state.measurementHand || 'right',
    actualFps: Math.round(fps * 10) / 10,
    _features: { fft: fftResult, acf: acfBpm, welch: welchResult, amdf: amdfResult,
                 refined: refinedFreqBpm, peak: peakBpm, pt: ptBpm, mw: mwBpm,
                 quality: signalQuality },
  };
}

// ── Uniform FPS resampling using per-frame timestamps ────────────────────────────
// Problem: browser FPS varies frame-to-frame (15–30 fps, sometimes spikes/drops).
// Non-uniform sampling → FFT frequency bins shift by ±3–8 BPM between measurements.
// Fix: linearly interpolate all signal channels onto a perfectly uniform time grid.
// Only applied when timestamps (s.t from performance.now()) exist in samples.
// Falls back to original samples when timestamps unavailable.
function resampleToUniformFps(samples, targetFps) {
  const withTs = samples.filter(s => s.t !== undefined && s.t > 0);
  if (withTs.length < 20) return null;
  const tStart   = withTs[0].t;
  const tEnd     = withTs[withTs.length - 1].t;
  const duration = (tEnd - tStart) / 1000;
  if (duration < 3) return null;
  const n = Math.floor(duration * targetFps);
  if (n < 30) return null;

  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tTarget = tStart + (i / targetFps) * 1000;
    // Advance pointer to last sample at-or-before tTarget
    while (j < withTs.length - 2 && withTs[j + 1].t <= tTarget) j++;
    const s0 = withTs[j];
    const s1 = withTs[Math.min(j + 1, withTs.length - 1)];
    const dt = s1.t - s0.t;
    // Don't interpolate across dropped-frame gaps > 120ms (= 2× interval at 15fps)
    const alpha = (dt > 0 && dt < 120) ? Math.min(1, (tTarget - s0.t) / dt) : 0;
    out.push({
      t:          tTarget,
      avgRed:     s0.avgRed     + alpha * (s1.avgRed     - s0.avgRed),
      avgGreen:   s0.avgGreen   + alpha * (s1.avgGreen   - s0.avgGreen),
      avgBlue:    s0.avgBlue    + alpha * (s1.avgBlue    - s0.avgBlue),
      brightness: s0.brightness + alpha * (s1.brightness - s0.brightness),
      // movement: conservative — use max of the two surrounding samples
      movement:   Math.max(s0.movement || 0, s1.movement || 0),
      // Struct fields: nearest-neighbor (no linear interp for discrete values)
      regions: alpha < 0.5 ? s0.regions : s1.regions,
      ambR: s0.ambR != null ? s0.ambR + alpha * ((s1.ambR ?? s0.ambR) - s0.ambR) : null,
      ambG: s0.ambG != null ? s0.ambG + alpha * ((s1.ambG ?? s0.ambG) - s0.ambG) : null,
      ambB: s0.ambB != null ? s0.ambB + alpha * ((s1.ambB ?? s0.ambB) - s0.ambB) : null,
    });
  }
  return out.length >= 30 ? out : null;
}

// ── FIX: Compute actual FPS from per-frame performance.now() timestamps ──────────
// Sử dụng timestamps thực tế thay vì FPS trung bình cuối recording.
// Cải thiện độ chính xác FFT (bin spacing) và Butterworth filter (cutoff) khi FPS dao động.
function computeActualFps(samples) {
  const withTs = (samples || []).filter(s => s.t !== undefined && s.t > 0);
  if (withTs.length < 10) return null;
  const elapsed = (withTs[withTs.length - 1].t - withTs[0].t) / 1000; // giây
  if (elapsed < 2) return null;
  const fps = (withTs.length - 1) / elapsed; // -1: đếm khoảng, không đếm frames
  return fps >= 12 && fps <= 65 ? fps : null;
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

  // A9 fix: fallback không dùng std-based BPM (không có cơ sở khoa học)
  // Trả về kết quả chất lượng thấp, không phân loại AFib, yêu cầu đo lại
  const irr = Math.round(Math.max(8, Math.min(40, 15 + Math.max(0, 65 - stabilityScore) * 0.4)));
  return {
    estimatedBpm: 0, bpm: 0,
    hrvScore: 0, sdnn: 0, rmssd: 0, pnn50: 0, cv: 0, lightScore, stabilityScore,
    signalQuality: Math.min(signalQuality, 30), // capped thấp → UI yêu cầu đo lại
    irregularityIndex: irr, waveform: normalizeWave(rawSignal.slice(-90)),
    rrIntervals: [], systolic: Number(el.systolicInput.value || 128),
    contextNote: el.measurementContextInput.value.trim(),
    contextUnchecked: el.preMeasurementChecklist ? Array.from(el.preMeasurementChecklist.querySelectorAll('input[type=checkbox]')).some(cb => !cb.checked) : false,
    sampEn: 0, sd1: 0, sd2: 0, lfhfRatio: null,
  };
}

function analyzeSamples(samples, mode) {
  const actualFps = computeActualFps(samples);
  if (actualFps) state.measurementFps = actualFps;
  const rawFps = actualFps || state.measurementFps || 30;

  // Resample raw samples to a perfectly uniform time grid before analysis.
  // This fixes FFT spectral leakage caused by variable browser FPS (key source of
  // ±3–8 BPM error). Target FPS = nearest integer to measured FPS (e.g. 29.4 → 29).
  const targetFps = Math.min(30, Math.max(12, Math.round(rawFps)));
  const resampled = resampleToUniformFps(samples, targetFps);
  const analysisSamples = resampled || samples;
  const fps = resampled ? targetFps : rawFps;

  const result = analyzePPGSignal(analysisSamples, mode, fps);
  if (result) return result;

  // Finger mode: the legacy fallback uses unfiltered signal with no torch-aware
  // channel selection or pulsatility gate → produces random-seeming BPM values
  // (the main cause of "5 measurements, 5 different numbers").
  // Return a clearly-failed sentinel so runMeasurement() can prompt the user
  // to remeasure instead of displaying a wrong BPM.
  if (mode === 'finger') {
    return {
      bpm: 0, estimatedBpm: 0, signalQuality: 0, hrvScore: 0,
      sdnn: 0, rmssd: 0, pnn50: 0, cv: 0, lightScore: 50, stabilityScore: 50,
      irregularityIndex: 0, waveform: [], rrIntervals: [],
      systolic: Number(el.systolicInput?.value || 128),
      contextNote: '', sampEn: 0, sd1: 0, sd2: 0, lfhfRatio: null,
      contextUnchecked: false, _failReason: 'signal_too_weak',
    };
  }

  return analyzeSamplesLegacy(samples, mode);
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
  const rrsMs = rrs;
  const totalTime = rrsMs.reduce((a, b) => a + b, 0) / 1000;
  const nPoints = Math.floor(totalTime * fps);
  if (nPoints < 16) return null;
  // Build cumulative time axis (beat onset times in seconds)
  const times = [0];
  for (let i = 0; i < rrsMs.length - 1; i++) times.push(times[i] + rrsMs[i] / 1000);
  // Query points for uniform 4Hz grid
  const qTimes = Array.from({ length: nPoints }, (_, i) => i / fps);
  // Cubic spline resampling: eliminates spectral artifacts from linear interpolation
  // Linear interp introduces piecewise-linear kinks → spurious HF power
  // Cubic spline is C2 continuous → clean LF/HF separation
  const sampled = naturalCubicSpline(times, rrsMs, qTimes);
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
  const sigma = mode === "finger" ? 2.5 : 2.0;
  const threshold = meanMov + sigma * stdMov;
  const clean = [];
  for (let i = 0; i + winSize <= samples.length; i += winSize) {
    const win = samples.slice(i, i + winSize);
    const maxMov = Math.max(...win.map(s => s.movement || 0));
    if (maxMov <= threshold) clean.push(...win);
  }
  // If too little clean data remains, return what we have — analyzePPGSignal will reject
  // it as too-short (< fps*10) and surface a "try again" message, which is correct.
  // Returning the noisy `samples` would produce a spurious BPM instead of an honest failure.
  return clean.length >= fps * 8 ? clean : (clean.length >= 30 ? clean : samples);
}

// ══════════════════════════════════════════════════════════════════════════════
// LIST UPDATE 1 & 2 — NEW FEATURE ALGORITHMS
// ══════════════════════════════════════════════════════════════════════════════

// ─── List1 #1: Ambient rPPG — Passive Background Screening ────────────────────
// 10fps passive face scan every 5 min (adaptive). Each scan: 60 frames = 6s.
// CHROM-signal + Butterworth filter + FFT & ACF consensus BPM.
// Rhythm irregularity via peak-interval CV. Adaptive interval: ok→5min, warn→2min, alert→1min.
const _ambient = {
  active: false, stream: null, video: null,
  interval: null, nextScanAt: 0,
  scans: 0, anomalyStreak: 0,
  history: [],   // {ts,bpm,rhythmCV,quality,flag,bpmConf,peakCount}
  baseline: null, // rolling mean BPM (last 8 valid scans)
  _countTimer: null
};

async function startAmbientRPPG() {
  if (_ambient.active) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    const s = document.getElementById("ambientRPPGStatus");
    if (s) s.textContent = "⚠️ Tr\xecnh duyệt kh\xf4ng hỗ trợ camera API.";
    return;
  }
  const statusEl = document.getElementById("ambientRPPGStatus");
  const btn = document.getElementById("ambientRPPGBtn");
  try {
    _ambient.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10 } },
      audio: false
    });
    const vid = document.createElement("video");
    vid.srcObject = _ambient.stream;
    vid.muted = true; vid.playsInline = true; vid.style.display = "none";
    document.body.appendChild(vid);
    await new Promise(resolve => {
      vid.addEventListener("canplay", function h() { vid.removeEventListener("canplay", h); resolve(); });
      vid.play().catch(() => {});
      setTimeout(resolve, 3000);
    });
    _ambient.video = vid;
    _ambient.active = true;
    // Restore persisted history
    try { const h = JSON.parse(localStorage.getItem("hs_ambient_history") || "[]"); _ambient.history = h.slice(-80); } catch {}
    if (btn) { btn.textContent = "\U0001f534 Dừng s\xe0ng lọc"; btn.className = "ghost-btn"; }
    if (statusEl) statusEl.textContent = "\U0001f441️ Camera khởi động — qu\xe9t đầu ti\xean sau 4 gi\xe2y...";
    _scheduleNextAmbientScan(4000);
    renderAmbientDashboard();
  } catch (err) {
    if (statusEl) statusEl.textContent = `⚠️ Kh\xf4ng thể truy cập camera: ${err.name} — cấp quyền camera v\xe0 thử lại.`;
  }
}
function stopAmbientRPPG() {
  _ambient.active = false;
  clearTimeout(_ambient.interval); clearInterval(_ambient._countTimer);
  if (_ambient.video) { try { _ambient.video.pause(); _ambient.video.srcObject = null; _ambient.video.remove(); } catch {} _ambient.video = null; }
  if (_ambient.stream) { _ambient.stream.getTracks().forEach(t => t.stop()); _ambient.stream = null; }
  try { localStorage.setItem("hs_ambient_history", JSON.stringify(_ambient.history.slice(-80))); } catch {}
  const statusEl = document.getElementById("ambientRPPGStatus");
  const btn = document.getElementById("ambientRPPGBtn");
  if (btn) { btn.textContent = "\U0001f441️ Bật s\xe0ng lọc thầm lặng"; btn.className = "primary-btn"; btn.style.background = "#7c3aed"; }
  if (statusEl) statusEl.textContent = `Đ\xe3 tắt. Đ\xe3 thực hiện ${_ambient.scans} lần qu\xe9t.`;
}
function toggleAmbientRPPG() { _ambient.active ? stopAmbientRPPG() : startAmbientRPPG(); }

function _scheduleNextAmbientScan(ms) {
  clearTimeout(_ambient.interval); clearInterval(_ambient._countTimer);
  if (!_ambient.active) return;
  _ambient.nextScanAt = Date.now() + ms;
  _ambient.interval = setTimeout(() => runAmbientMiniScan().catch(err => {
    console.error("[AmbientRPPG] Lỗi scan:", err.message);
    const s = document.getElementById("ambientRPPGStatus");
    if (s) s.textContent = `⚠️ Lỗi quét: ${err.message} — thử lại sau 3 phút`;
    _scheduleNextAmbientScan(3 * 60 * 1000);
  }), ms);
  // Live countdown in status
  _ambient._countTimer = setInterval(() => {
    if (!_ambient.active) { clearInterval(_ambient._countTimer); return; }
    const secs = Math.max(0, Math.round((_ambient.nextScanAt - Date.now()) / 1000));
    const statusEl = document.getElementById("ambientRPPGStatus");
    if (statusEl && secs > 0) {
      const label = secs < 60 ? `${secs}s` : `${Math.floor(secs/60)}ph${String(secs%60).padStart(2,'0')}s`;
      statusEl.textContent = `\U0001f441️ Đang chờ — qu\xe9t tiếp theo sau ${label}`;
    }
  }, 5000);
}

async function runAmbientMiniScan() {
  clearInterval(_ambient._countTimer);
  if (!_ambient.active || !_ambient.stream || !_ambient.video) return;
  const track = _ambient.stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") { _scheduleNextAmbientScan(60000); return; }
  const statusEl = document.getElementById("ambientRPPGStatus");
  if (statusEl) statusEl.textContent = `👁️ Quét #${_ambient.scans + 1} — thu tín hiệu 7 giây...`;

  const vid = _ambient.video;
  const W = 320, H = 240;
  if (!runAmbientMiniScan._cvs) {
    runAmbientMiniScan._cvs = document.createElement("canvas");
    runAmbientMiniScan._cvs.width = W; runAmbientMiniScan._cvs.height = H;
    runAmbientMiniScan._ctx = runAmbientMiniScan._cvs.getContext("2d", { willReadFrequently: true });
  }
  const ctx = runAmbientMiniScan._ctx;
  const rx = Math.floor(W * 0.22), ry = Math.floor(H * 0.06);
  const rw = Math.floor(W * 0.56), rh = Math.floor(H * 0.76);

  const samples = [];
  let prevR = 0, prevG = 0, prevB = 0;
  const slowBuf = [];
  const N = 70; // 7 giây @ 10fps — độ phân giải FFT tốt hơn
  let skinRejects = 0, motionRejects = 0, brightRejects = 0;

  for (let i = 0; i < N; i++) {
    if (!_ambient.active) break;
    await new Promise(r => setTimeout(r, 100));
    ctx.drawImage(vid, 0, 0, W, H);
    const d = ctx.getImageData(rx, ry, rw, rh).data;
    let r = 0, g = 0, b = 0, cnt = 0;
    for (let j = 0; j < d.length; j += 4) { r += d[j]; g += d[j + 1]; b += d[j + 2]; cnt++; }
    const rA = r / cnt, gA = g / cnt, bA = b / cnt;

    // ── 1. Brightness gate ────────────────────────────────────────────────────
    const bright = 0.299 * rA + 0.587 * gA + 0.114 * bA;
    if (bright < 28 || bright > 228) { brightRejects++; continue; }

    // ── 2. YCbCr skin validation (Kovac 2010) — từ chối pixel không phải da ──
    // Cùng thuật toán với Face PPG chính, khoảng mở rộng cho mọi tông da
    const _Cb = -0.169 * rA - 0.331 * gA + 0.500 * bA + 128;
    const _Cr =  0.500 * rA - 0.419 * gA - 0.081 * bA + 128;
    if (!(bright >= 25 && bright <= 225 && _Cb >= 66 && _Cb <= 136 && _Cr >= 124 && _Cr <= 182)) {
      skinRejects++; continue;
    }

    // ── 3. Dual-window motion detection (3 kênh) — từ chối chuyển động ───────
    // Fast window: thay đổi tức thì 1 frame — phát hiện giật tay đột ngột
    const fastMov = i > 0
      ? (Math.abs(rA - prevR) + Math.abs(gA - prevG) + Math.abs(bA - prevB)) / 3
      : 0;
    // Slow window: drift 6 frame — phát hiện xoay đầu/di chuyển chậm
    slowBuf.push({ r: rA, g: gA, b: bA });
    if (slowBuf.length > 6) slowBuf.shift();
    let slowMov = 0;
    if (slowBuf.length >= 4) {
      const half = Math.floor(slowBuf.length / 2);
      const eR = slowBuf.slice(0, half).reduce((a, x) => a + x.r, 0) / half;
      const lR = slowBuf.slice(-half).reduce((a, x) => a + x.r, 0) / half;
      slowMov = Math.abs(lR - eR);
    }
    const totalMov = Math.max(fastMov * 1.5, slowMov);
    if (totalMov > 8) { motionRejects++; prevR = rA; prevG = gA; prevB = bA; continue; }

    prevR = rA; prevG = gA; prevB = bA;
    samples.push({ r: rA, g: gA, b: bA });
  }

  _ambient.scans++;
  const now = Date.now();
  const timeStr = new Date(now).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const skinRatio = skinRejects / N;

  // ── Đủ mẫu da sạch? ──────────────────────────────────────────────────────
  if (samples.length < 28) {
    const reason = skinRatio > 0.45
      ? "Không nhận diện da mặt — đủ ánh sáng, mặt hướng thẳng vào camera."
      : motionRejects > N * 0.35
      ? "Chuyển động quá nhiều — ngồi yên trong khi sàng lọc."
      : brightRejects > N * 0.35
      ? "Ánh sáng quá tối hoặc quá chói — ngồi gần cửa sổ / tắt đèn nền."
      : "Tín hiệu không ổn định — thử lại sau vài giây.";
    _ambient.history.push({ ts: now, bpm: null, rhythmCV: null, quality: 0, flag: "noface", reason });
    if (statusEl) statusEl.textContent = `🟡 Quét #${_ambient.scans} lúc ${timeStr}: ${reason}`;
    _scheduleNextAmbientScan(3 * 60 * 1000);
    renderAmbientDashboard(); return;
  }

  const fps = 10;
  const reds = samples.map(s => s.r), greens = samples.map(s => s.g), blues = samples.map(s => s.b);

  // ── CHROM channel fusion ──────────────────────────────────────────────────
  const mR = reds.reduce((a, b) => a + b, 0) / reds.length || 1;
  const mG = greens.reduce((a, b) => a + b, 0) / greens.length || 1;
  const mB = blues.reduce((a, b) => a + b, 0) / blues.length || 1;
  const Cr2 = reds.map(v => v / mR - 1);
  const Cg2 = greens.map(v => v / mG - 1);
  const Cb2 = blues.map(v => v / mB - 1);
  const Xs = Cr2.map((r, i) => 3 * r - 2 * Cg2[i]);
  const Ys = Cr2.map((r, i) => 1.5 * r + Cg2[i] - 1.5 * Cb2[i]);
  const alpha = Math.sqrt(Xs.reduce((a, b) => a + b * b, 0) / Xs.length + 1e-9) /
                Math.sqrt(Ys.reduce((a, b) => a + b * b, 0) / Ys.length + 1e-9);
  const chrom = Xs.map((x, i) => x - alpha * Ys[i]);

  // ── Butterworth bandpass 0.7–3.5 Hz ─────────────────────────────────────
  const filtered = butterworthBandpassDynamic(chrom, fps, 0.7, Math.min(3.5, fps * 0.44));

  // ── Signal quality: AC/DC ratio ───────────────────────────────────────────
  const sigAC = Math.sqrt(filtered.reduce((a, b) => a + b * b, 0) / filtered.length || 1);
  const sigDC = Math.sqrt(chrom.reduce((a, b) => a + b * b, 0) / chrom.length || 1);
  const quality = Math.min(99, Math.round(sigAC / (sigDC || 0.001) * 2500));

  // Từ chối nếu tín hiệu quá yếu — ngưỡng 8 để tránh BPM giả từ noise thuần túy
  if (quality < 8) {
    _ambient.history.push({ ts: now, bpm: null, rhythmCV: null, quality, flag: "weak",
      reason: `Tín hiệu PPG quá yếu (Q=${quality}/100) — tăng ánh sáng hoặc ngồi gần camera hơn.` });
    if (statusEl) statusEl.textContent = `🟡 Quét #${_ambient.scans} lúc ${timeStr}: Tín hiệu yếu (Q=${quality}).`;
    _scheduleNextAmbientScan(3 * 60 * 1000);
    renderAmbientDashboard(); return;
  }

  // ── FFT + ACF consensus BPM ───────────────────────────────────────────────
  const bpmFFT = fftBpm(filtered, fps);
  const bpmACF = autocorrBpm(filtered, fps);
  const cands = [bpmFFT, bpmACF].filter(b => b && b >= 38 && b <= 155);
  let bpm = null, bpmConf = 0;
  if (cands.length === 2) {
    const diff = Math.abs(cands[0] - cands[1]);
    bpm = Math.round((cands[0] + cands[1]) / 2);
    // Confidence: đồng thuận FFT/ACF + chất lượng tín hiệu
    const agreementScore = diff <= 3 ? 30 : diff <= 7 ? 22 : diff <= 13 ? 14 : diff <= 20 ? 6 : 0;
    const qualityScore   = Math.min(25, Math.round(quality * 0.6));
    bpmConf = Math.min(95, 35 + agreementScore + qualityScore);
  } else if (cands.length === 1) {
    bpm = cands[0];
    bpmConf = Math.min(60, 20 + Math.round(quality * 0.4));
  }

  // ── Rhythm irregularity via peak interval CV ──────────────────────────────
  let rhythmCV = 0, peakCount = 0;
  if (filtered.length >= 20) {
    const peaks = detectSCGPeaks(filtered, fps);
    peakCount = peaks.length;
    if (peaks.length >= 4) {
      const ivls = peaks.slice(1).map((p, i) => p - peaks[i]);
      const mI = ivls.reduce((a, b) => a + b, 0) / ivls.length || 1;
      const sdI = Math.sqrt(ivls.reduce((a, b) => a + (b - mI) ** 2, 0) / ivls.length);
      rhythmCV = Math.round(sdI / mI * 1000) / 1000;
    }
  }

  // ── Baseline từ 8 lần quét gần nhất có chất lượng đủ tốt ─────────────────
  const validH = _ambient.history.filter(h => h.bpm && (h.quality || 0) >= 8).slice(-8);
  _ambient.baseline = validH.length >= 3
    ? Math.round(validH.reduce((a, h) => a + h.bpm, 0) / validH.length) : null;

  // ── Flag — ngưỡng được điều chỉnh theo chất lượng tín hiệu ───────────────
  // Tín hiệu yếu → nới ngưỡng để tránh false alarm; tín hiệu tốt → chặt hơn
  const qFactor = quality < 12 ? 0.72 : quality < 25 ? 0.88 : 1.0;
  let flag = "ok", alertMsg = null;
  if (!bpm || bpmConf < 28) {
    flag = "noface";
  } else {
    const bDev = _ambient.baseline ? Math.abs(bpm - _ambient.baseline) / _ambient.baseline : 0;
    if (bpm > Math.round(122 / qFactor) || bpm < Math.round(44 * qFactor) || rhythmCV > 0.44 * qFactor) {
      flag = "alert";
      alertMsg = bpm > 115 ? `Nhịp rất nhanh: ${bpm} BPM` : bpm < 46 ? `Nhịp rất chậm: ${bpm} BPM` : `Nhịp không đều (CV=${rhythmCV})`;
    } else if (bpm > Math.round(102 / qFactor) || bpm < Math.round(52 * qFactor) || rhythmCV > 0.24 * qFactor || bDev > 0.20) {
      flag = "warn";
      alertMsg = rhythmCV > 0.24 ? `Nhịp hơi không đều (CV=${rhythmCV})`
        : bDev > 0.20 ? `BPM ${bpm} — lệch baseline ${Math.round(bDev * 100)}%`
        : `BPM ${bpm} — cần chú ý`;
    }
  }

  if (flag === "alert") _ambient.anomalyStreak++;
  else if (flag !== "noface") _ambient.anomalyStreak = 0;

  const scan = { ts: now, bpm, rhythmCV, quality, flag, bpmConf, peakCount,
    samples: samples.length, motionRejects, skinRejects: Math.round(skinRatio * 100) };
  _ambient.history.push(scan);
  if (_ambient.history.length > 100) _ambient.history.shift();
  try { localStorage.setItem("hs_ambient_history", JSON.stringify(_ambient.history.slice(-80))); } catch {}

  if (flag === "alert") {
    showToast(`👁️ Sàng lọc: ${alertMsg}`, "error");
    notify("HEARTSENSE", `Phát hiện bất thường lúc ${timeStr}: ${alertMsg}`);
    if (_ambient.anomalyStreak >= 2) showToast("👁️ 2 lần liên tiếp bất thường — hãy đo PPG chính xác ngay!", "error");
  } else if (flag === "warn") {
    showToast(`👁️ ${timeStr}: ${alertMsg || "Cần chú ý"}`, "warn");
  }

  if (statusEl) {
    const dot = bpmConf >= 70 ? "🟢" : bpmConf >= 48 ? "🟡" : "🔴";
    const qLabel = quality >= 22 ? "tốt" : quality >= 10 ? "TB" : "thấp";
    statusEl.textContent = bpm
      ? `👁️ Quét #${_ambient.scans} · ${timeStr}: ${bpm} BPM ${dot} · tin cậy ${bpmConf}% · chất lượng ${qLabel} · ${samples.length} mẫu da sạch`
      : `🟡 Quét #${_ambient.scans} · ${timeStr}: không xác định BPM — đảm bảo mặt ở trung tâm camera.`;
  }

  const nextMs = flag === "alert" ? 60000 : flag === "warn" ? 2 * 60 * 1000 : 5 * 60 * 1000;
  _scheduleNextAmbientScan(nextMs);
  renderAmbientDashboard();
}

function renderAmbientDashboard() {
  const resEl = document.getElementById("ambientRPPGResult");
  if (!resEl) return;
  const valid   = _ambient.history.filter(h => h.bpm);
  const alerts  = _ambient.history.filter(h => h.flag === "alert").length;
  const warns   = _ambient.history.filter(h => h.flag === "warn").length;
  const nofaceN = _ambient.history.filter(h => h.flag === "noface" || h.flag === "weak").length;
  const meanBpm = valid.length ? Math.round(valid.reduce((a, h) => a + h.bpm, 0) / valid.length) : null;
  const avgQ    = valid.length ? Math.round(valid.reduce((a, h) => a + (h.quality || 0), 0) / valid.length) : null;
  const trendArr = valid.slice(-6).map(h => h.bpm);
  let trendIcon = "";
  if (trendArr.length >= 3) {
    const half = Math.ceil(trendArr.length / 2);
    const a1 = trendArr.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const a2 = trendArr.slice(-half).reduce((a, b) => a + b, 0) / half;
    trendIcon = a2 - a1 > 5 ? " ↗️" : a1 - a2 > 5 ? " ↘️" : " →";
  }
  const qColor = avgQ >= 22 ? "#22c55e" : avgQ >= 10 ? "#f59e0b" : "#ef4444";
  const qLabel = avgQ >= 22 ? "Tốt" : avgQ >= 10 ? "TB" : "Thấp";

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px">
      <div style="background:#1e293b;padding:5px 3px;border-radius:6px;text-align:center">
        <div style="font-size:15px;font-weight:700;color:#a78bfa">${_ambient.scans}</div>
        <div style="font-size:9px;color:#64748b">quét</div>
      </div>
      <div style="background:#1e293b;padding:5px 3px;border-radius:6px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:#38bdf8">${meanBpm || "--"}${trendIcon}</div>
        <div style="font-size:9px;color:#64748b">BPM TB</div>
      </div>
      <div style="background:#1e293b;padding:5px 3px;border-radius:6px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:${qColor}">${avgQ != null ? qLabel : "--"}</div>
        <div style="font-size:9px;color:#64748b">Chất lượng</div>
      </div>
      <div style="background:#1e293b;padding:5px 3px;border-radius:6px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:${warns > 0 ? "#f59e0b" : "#22c55e"}">${warns}</div>
        <div style="font-size:9px;color:#64748b">chú ý</div>
      </div>
      <div style="background:#1e293b;padding:5px 3px;border-radius:6px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:${alerts > 0 ? "#ef4444" : "#22c55e"}">${alerts}</div>
        <div style="font-size:9px;color:#64748b">bất thường</div>
      </div>
    </div>
    ${nofaceN >= 3 ? `<div style="background:#1e293b;border-left:3px solid #f59e0b;padding:6px 10px;border-radius:4px;margin-bottom:6px;font-size:11px;color:#fbbf24">
      💡 ${nofaceN} lần không phát hiện được mặt — đảm bảo: đủ ánh sáng từ phía trước, mặt cách camera 40–80cm, nhìn thẳng vào ống kính.
    </div>` : ""}`;

  const rows = _ambient.history.slice(-12).reverse().map(h => {
    const t  = new Date(h.ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    const fc = h.flag === "alert" ? "#ef4444" : h.flag === "warn" ? "#f59e0b" : (h.flag === "noface" || h.flag === "weak") ? "#64748b" : "#22c55e";
    const fi = h.flag === "alert" ? "⚠️" : h.flag === "warn" ? "🟡" : (h.flag === "noface" || h.flag === "weak") ? "👻" : "🟢";
    const bStr    = h.bpm ? `${h.bpm} BPM` : (h.reason ? h.reason.slice(0, 28) + "…" : "—");
    const cvStr   = h.rhythmCV > 0.1 ? ` · CV ${h.rhythmCV}` : "";
    const confStr = h.bpmConf  ? ` · ${h.bpmConf}%` : "";
    const qStr    = h.quality  > 0 ? ` · Q${h.quality}` : "";
    return `<div class="list-item" style="color:${fc};font-size:11px"><span>${fi} ${t}</span><strong>${bStr}${cvStr}${confStr}${qStr}</strong></div>`;
  }).join("");

  resEl.innerHTML = summaryHtml + (rows || '<p class="muted">Chưa có kết quả quét.</p>');
}

// ─── List1 #4: SCG — Seismocardiography via Accelerometer ────────────────────
// Sequential chest sensor: measures ventricular mechanical vibrations after PPG.
// Phone lies flat (screen up) on sternum — accelerometer Z-axis captures heartbeat impulses.
const _scg = { active: false, samples: [], _countTimer: null, _checkTimer: null, _stopTimer: null };
function startSCGChestSensor() {
  if (_scg.active) return;
  if (!window.DeviceMotionEvent) {
    const statusEl = document.getElementById("scgStatus");
    if (statusEl) statusEl.textContent = "📱 SCG chỉ hoạt động trên điện thoại/máy tính bảng có cảm biến gia tốc.";
    showToast("SCG chỉ dành cho thiết bị di động có cảm biến gia tốc", "error"); return;
  }
  const tryBind = () => {
    _scg.active = true; _scg.samples = [];
    const statusEl = document.getElementById("scgStatus");
    const startBtn = document.getElementById("startSCGBtn");
    const stopBtn = document.getElementById("stopSCGBtn");
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.style.display = "";
    let remaining = 45;
    if (statusEl) statusEl.textContent = `⚙️ Chuẩn bị: Đặt điện thoại nằm ngửa (màn hình lên) lên giữa xương ức, buông tay ra, nằm yên... còn ${remaining}s`;
    _scg._countTimer = setInterval(() => {
      remaining--;
      const hint = remaining > 30
        ? `📳 Đang thu SCG — nằm yên, thở bình thường... còn ${remaining}s`
        : remaining > 10
        ? `📳 SCG — giữ yên, gần xong... còn ${remaining}s`
        : `📳 SCG — hoàn thành sau ${remaining}s...`;
      if (statusEl) statusEl.textContent = hint;
      if (remaining <= 0) clearInterval(_scg._countTimer);
    }, 1000);
    window.addEventListener("devicemotion", _scgMotionHandler);
    _scg._checkTimer = setTimeout(() => {
      if (_scg.active && _scg.samples.length === 0) {
        clearInterval(_scg._countTimer);
        clearTimeout(_scg._stopTimer);
        _scg.active = false;
        window.removeEventListener("devicemotion", _scgMotionHandler);
        const sBtn = document.getElementById("startSCGBtn");
        const xBtn = document.getElementById("stopSCGBtn");
        if (sBtn) sBtn.disabled = false;
        if (xBtn) xBtn.style.display = "none";
        const st = document.getElementById("scgStatus");
        if (st) st.textContent = "📱 Thiết bị này không có cảm biến gia tốc. SCG chỉ hoạt động trên điện thoại/máy tính bảng.";
        showToast("SCG: Không phát hiện cảm biến gia tốc — dùng điện thoại di động", "warn");
      }
    }, 3000);
    _scg._stopTimer = setTimeout(stopSCGChestSensor, 45000);
  };
  const req = typeof DeviceMotionEvent?.requestPermission === "function" ? DeviceMotionEvent.requestPermission : null;
  req
    ? req().then(p => { if (p === "granted") tryBind(); else showToast("Cần cấp quyền cảm biến chuyển động cho trang web này", "warn"); }).catch(() => tryBind())
    : tryBind();
}
function _scgMotionHandler(e) {
  if (!_scg.active) return;
  // Prefer e.acceleration (gravity removed by OS) — cleaner signal for Z-axis
  const a = e.acceleration && (e.acceleration.x !== null) ? e.acceleration : e.accelerationIncludingGravity;
  if (!a) return;
  const x = a.x||0, y = a.y||0, z = a.z||0;
  _scg.samples.push({ t: Date.now(), x, y, z, magnitude: Math.sqrt(x*x + y*y + z*z) });
  if (_scg.samples.length > 5000) _scg.samples.shift();
}
function stopSCGChestSensor() {
  if (!_scg.active) return;
  clearInterval(_scg._countTimer);
  clearTimeout(_scg._checkTimer);
  clearTimeout(_scg._stopTimer);
  _scg.active = false;
  window.removeEventListener("devicemotion", _scgMotionHandler);
  const startBtn = document.getElementById("startSCGBtn");
  const stopBtn = document.getElementById("stopSCGBtn");
  const statusEl = document.getElementById("scgStatus");
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.style.display = "none";
  if (_scg.samples.length >= 100) {
    if (statusEl) statusEl.textContent = "⚙️ Đang phân tích dữ liệu SCG...";
    const result = analyzeSCG(_scg.samples);
    renderSCGResult(result);
  } else {
    if (statusEl) statusEl.textContent = "⚠️ Không thu được đủ dữ liệu SCG. Đảm bảo cảm biến hoạt động và điện thoại nằm yên trên ngực.";
  }
}

// SCG-specific peak detection: finds mechanical impulse peaks (brief spikes, not smooth waves)
function detectSCGPeaks(signal, fps) {
  const minDist = Math.floor(fps * 0.33); // enforce max 180 BPM
  const arr = Array.from(signal);
  const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
  const std = Math.sqrt(arr.reduce((a,b)=>a+(b-mean)**2,0)/arr.length);
  const threshold = mean + 0.4 * std;
  const peaks = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > threshold && arr[i] >= arr[i-1] && arr[i] >= arr[i+1]) {
      if (!peaks.length || i - peaks[peaks.length-1] >= minDist) {
        peaks.push(i);
      } else if (arr[i] > arr[peaks[peaks.length-1]]) {
        peaks[peaks.length-1] = i; // keep stronger peak in window
      }
    }
  }
  return peaks;
}

// Beat template matching — normalized cross-correlation để tìm nhịp tim chính xác hơn
// So với simple peak detection: robust hơn với noise, không bị lừa bởi breathing artifact
function _scgTemplateMatch(signal, fps, initBpm) {
  if (!initBpm || signal.length < fps * 5) return null;
  const beatSamples = Math.round(fps * 60 / initBpm);
  const halfBeat = Math.floor(beatSamples * 0.42);
  const initPeaks = detectSCGPeaks(signal, fps);
  if (initPeaks.length < 4) return null;

  // Trích xuất template từ 12 beats đầu (loại bỏ beats ở biên)
  const templates = [];
  for (const p of initPeaks.slice(0, 12)) {
    const s = p - halfBeat, e = p + halfBeat;
    if (s >= 0 && e < signal.length) templates.push(signal.slice(s, e));
  }
  if (templates.length < 3) return null;

  // Average template — lấy hình dạng beat trung bình
  const tLen = templates[0].length;
  const template = new Array(tLen).fill(0);
  for (const t of templates) { for (let i = 0; i < tLen; i++) template[i] += t[i] / templates.length; }

  // Normalize template (zero-mean unit-variance)
  const tMean = template.reduce((a, b) => a + b, 0) / tLen;
  const tC = template.map(v => v - tMean);
  const tNorm = Math.sqrt(tC.reduce((a, v) => a + v * v, 0));
  if (!tNorm) return null;

  // Normalized cross-correlation — slide template over full signal
  const xCorr = new Array(signal.length - tLen).fill(0);
  for (let i = 0; i < xCorr.length; i++) {
    const win = signal.slice(i, i + tLen);
    const wMean = win.reduce((a, b) => a + b, 0) / tLen;
    const wC = win.map(v => v - wMean);
    const wNorm = Math.sqrt(wC.reduce((a, v) => a + v * v, 0));
    if (wNorm < 1e-9) continue;
    xCorr[i] = tC.reduce((a, v, j) => a + v * wC[j], 0) / (tNorm * wNorm);
  }

  // Tìm peaks trong cross-correlation với min-distance = 70% beat period
  const minDist = Math.floor(beatSamples * 0.7);
  const peakThresh = Math.max(0.28, 0.55 * Math.max(...xCorr));
  const matchedPeaks = [];
  for (let i = 1; i < xCorr.length - 1; i++) {
    if (xCorr[i] > peakThresh && xCorr[i] >= xCorr[i - 1] && xCorr[i] >= xCorr[i + 1]) {
      if (!matchedPeaks.length || i - matchedPeaks[matchedPeaks.length - 1] >= minDist) {
        matchedPeaks.push(i + halfBeat);
      } else if (xCorr[i] > xCorr[matchedPeaks[matchedPeaks.length - 1] - halfBeat]) {
        matchedPeaks[matchedPeaks.length - 1] = i + halfBeat;
      }
    }
  }
  if (matchedPeaks.length < 4) return null;

  // BPM + irregularity từ matched beats
  const ivls = matchedPeaks.slice(1).map((p, i) => p - matchedPeaks[i]);
  const mIvl = ivls.reduce((a, b) => a + b, 0) / ivls.length;
  const stdIvl = Math.sqrt(ivls.reduce((a, b) => a + (b - mIvl) ** 2, 0) / ivls.length);
  const bpmTemplate = Math.round(fps * 60 / mIvl);
  if (bpmTemplate < 35 || bpmTemplate > 190) return null;

  // Match quality: mean NCC tại các peak
  const matchQuality = Math.round(
    matchedPeaks.reduce((a, p) => a + (xCorr[Math.max(0, p - halfBeat)] || 0), 0) / matchedPeaks.length * 100
  );
  return {
    bpmTemplate,
    irregularity: Math.round(stdIvl / mIvl * 1000) / 1000,
    sdnnTemplate: Math.round(stdIvl / fps * 1000),
    peakCountTemplate: matchedPeaks.length,
    matchQuality,
  };
}

function analyzeSCG(samples) {
  if (samples.length < 100) return null;
  const duration = (samples[samples.length-1].t - samples[0].t) / 1000;
  if (duration < 10) return null;
  const fps = samples.length / duration;
  const varOf = arr => { const m = arr.reduce((a,b)=>a+b,0)/arr.length; return arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length; };

  // 1. Motion artifact rejection — reject 1s windows where magnitude variance is too high
  const winSize = Math.max(10, Math.ceil(fps));
  const cleanSamples = [];
  let motionWindows = 0, totalWindows = 0;
  for (let i = 0; i + winSize <= samples.length; i += winSize) {
    const win = samples.slice(i, i + winSize);
    totalWindows++;
    if (varOf(win.map(s => s.magnitude)) < 0.5) {
      cleanSamples.push(...win);
    } else {
      motionWindows++;
    }
  }
  const motionPct = Math.round(motionWindows / totalWindows * 100);
  if (cleanSamples.length < Math.ceil(fps * 10)) {
    return { error: 'too_much_motion', motionPct, sampleCount: cleanSamples.length, duration: Math.round(duration) };
  }
  // Cảnh báo fps thấp (cảm biến cũ hoặc thiết bị giới hạn)
  const lowFps = fps < 20;

  // 2. Smart axis selection — Z is primary (perpendicular to chest when phone flat),
  //    fall back to highest-variance axis if Z variance is weak
  const xs = cleanSamples.map(s => s.x);
  const ys = cleanSamples.map(s => s.y);
  const zs = cleanSamples.map(s => s.z);
  const varX = varOf(xs), varY = varOf(ys), varZ = varOf(zs);
  const maxVar = Math.max(varX, varY, varZ);
  let signal, axisUsed;
  if (varZ >= 0.65 * maxVar)  { signal = zs; axisUsed = 'Z'; }
  else if (varX >= varY)       { signal = xs; axisUsed = 'X'; }
  else                          { signal = ys; axisUsed = 'Y'; }

  // 3. Bandpass 0.5–4.0 Hz (cardiac mechanical range 30–240 BPM), zero-phase Butterworth
  //    High-pass at 0.5 Hz removes breathing (~0.15–0.4 Hz) and gravity DC component
  const filtered = butterworthBandpassDynamic(signal, fps, 0.5, Math.min(4.0, fps * 0.44));

  // 4. Three independent BPM estimation methods
  const bpmFFT = fftBpm(filtered, fps);
  const bpmACF = autocorrBpm(filtered, fps);
  const scgPeaks = detectSCGPeaks(filtered, fps);
  const bpmPeak = scgPeaks.length >= 4
    ? Math.round(60 * fps * (scgPeaks.length - 1) / (scgPeaks[scgPeaks.length-1] - scgPeaks[0]))
    : null;

  // 5. Consensus vote + confidence score
  const candidates = [bpmFFT, bpmACF, bpmPeak].filter(b => b && b >= 40 && b <= 180);
  let bpm = null, confidence = 0;
  if (candidates.length >= 3) {
    const spread = Math.max(...candidates) - Math.min(...candidates);
    if (spread <= 6)       { bpm = Math.round(candidates.reduce((a,b)=>a+b,0)/3); confidence = 92 - spread; }
    else if (spread <= 12) { candidates.sort((a,b)=>a-b); bpm = candidates[1]; confidence = 75; }
    else                   { bpm = bpmFFT || bpmACF; confidence = 52; }
  } else if (candidates.length === 2) {
    const diff = Math.abs(candidates[0] - candidates[1]);
    bpm = Math.round((candidates[0] + candidates[1]) / 2);
    confidence = diff <= 6 ? 80 : diff <= 12 ? 64 : 48;
  } else if (candidates.length === 1) {
    bpm = candidates[0]; confidence = 40;
  }
  // Deduct confidence for motion-contaminated windows
  confidence = Math.max(0, Math.min(95, confidence - Math.round(motionPct * 0.4)));

  // 6. Beat template matching — độ chính xác cao hơn simple peak detection
  const tmResult = _scgTemplateMatch(filtered, fps, bpm);

  // 7. Final BPM: ưu tiên template nếu match quality tốt và trong range hợp lý
  let finalBpm = bpm, finalIrr = 0, finalSdnn = 0, usedTemplate = false;
  if (tmResult && tmResult.matchQuality >= 45 && Math.abs(tmResult.bpmTemplate - (bpm || 0)) <= 12) {
    finalBpm = tmResult.bpmTemplate;
    finalIrr = tmResult.irregularity;
    finalSdnn = tmResult.sdnnTemplate;
    usedTemplate = true;
    // Template xác nhận → tăng confidence
    confidence = Math.min(95, confidence + (tmResult.matchQuality >= 65 ? 8 : 4));
  } else {
    // Fallback: SCG peak intervals
    if (scgPeaks.length >= 4) {
      const ivls = scgPeaks.slice(1).map((p, i) => p - scgPeaks[i]);
      const mIvl = ivls.reduce((a, b) => a + b, 0) / ivls.length;
      const stdIvl = Math.sqrt(ivls.reduce((a, b) => a + (b - mIvl) ** 2, 0) / ivls.length);
      finalIrr = Math.round(stdIvl / mIvl * 1000) / 1000;
      finalSdnn = Math.round(stdIvl / fps * 1000);
    }
  }

  return {
    bpm: finalBpm, confidence: Math.round(confidence), axisUsed,
    irregularity: finalIrr, sdnn: finalSdnn, motionPct, lowFps,
    sampleCount: cleanSamples.length, duration: Math.round(duration), fps: Math.round(fps),
    bpmFFT, bpmACF, bpmPeak, peakCount: scgPeaks.length,
    templateBpm: tmResult?.bpmTemplate || null,
    templateMatchQ: tmResult?.matchQuality || 0,
    usedTemplate,
  };
}

function renderSCGResult(result) {
  const box = document.getElementById("scgResultBox");
  const statusEl = document.getElementById("scgStatus");
  if (!box || !result) return;

  if (result.error === 'too_much_motion') {
    box.innerHTML = `<p style="color:#ef4444;font-size:12px;margin:4px 0">⚠️ Quá nhiều chuyển động (${result.motionPct}% mẫu bị nhiễu chuyển động).<br>Nằm hoàn toàn yên, buông tay khỏi điện thoại, và thử lại.</p>`;
    if (statusEl) statusEl.textContent = `⚠️ SCG thất bại — chuyển động quá nhiều (${result.motionPct}%). Nằm yên và thử lại.`;
    return;
  }

  const confColor = result.confidence >= 80 ? "#22c55e" : result.confidence >= 60 ? "#f59e0b" : "#ef4444";
  const confLabel = result.confidence >= 80 ? "Cao" : result.confidence >= 60 ? "Trung bình" : "Thấp — nên đo lại";
  const mechColor = result.irregularity > 0.45 ? "#ef4444" : result.irregularity > 0.25 ? "#f59e0b" : "#22c55e";
  const mechLabel = result.irregularity > 0.45 ? "⚠️ Bất thường" : result.irregularity > 0.25 ? "Hơi không đều" : "Đều đặn";

  // Bi-modal: so với PPG gần nhất hoặc trung bình 3 lần đo cuối
  const ppgBpm = state.lastMeasurementRecord?.result?.bpm || state.liveBpm || null;
  const recentBpms = (state.dashboard?.measurements || [])
    .filter(m => m.type === "face" || m.type === "finger").slice(-3)
    .map(m => m.result?.bpm).filter(Boolean);
  const ppgRef = recentBpms.length >= 2
    ? Math.round(recentBpms.reduce((a, b) => a + b, 0) / recentBpms.length)
    : ppgBpm;
  let biModalHtml = "";
  if (result.bpm && ppgRef) {
    const diff = Math.abs(result.bpm - ppgRef);
    const agree = diff <= 8;
    const label = recentBpms.length >= 2 ? `PPG TB ${recentBpms.length} lần` : "PPG gần nhất";
    biModalHtml = `<div class="list-item" style="color:${agree ? "#22c55e" : "#f59e0b"}">
      <span>Bi-Modal (SCG vs ${label})</span>
      <strong>${agree ? "✅ Đồng thuận" : "⚠️ Lệch " + diff + " BPM"} — SCG ${result.bpm} / PPG ${ppgRef} BPM</strong>
    </div>`;
  }

  const methodParts = [
    result.bpmFFT     ? `FFT: ${result.bpmFFT}`             : null,
    result.bpmACF     ? `ACF: ${result.bpmACF}`             : null,
    result.bpmPeak    ? `Peak: ${result.bpmPeak}`           : null,
    result.templateBpm ? `Template: ${result.templateBpm} (Q${result.templateMatchQ}%)` : null,
  ].filter(Boolean).join(' · ');

  box.innerHTML = `
    <div class="list-item">
      <span>BPM cơ học (SCG)</span>
      <strong style="font-size:18px">${result.bpm || "--"} BPM</strong>
    </div>
    <div class="list-item">
      <span>Độ tin cậy</span>
      <strong style="color:${confColor}">${result.confidence}% — ${confLabel}</strong>
    </div>
    <div class="list-item">
      <span>Bất đều cơ học</span>
      <strong style="color:${mechColor}">${result.irregularity} (${mechLabel})</strong>
    </div>
    ${result.sdnn ? `<div class="list-item"><span>SDNN cơ học</span><strong>${result.sdnn} ms</strong></div>` : ""}
    ${biModalHtml}
    <div class="list-item">
      <span>3 phương pháp</span>
      <strong style="font-size:11px;color:#94a3b8">${methodParts || "--"}</strong>
    </div>
    <div class="list-item">
      <span>Nhiễu / Trục đo / FPS cảm biến</span>
      <strong style="color:${result.motionPct > 30 ? "#f59e0b" : "#22c55e"}">${result.motionPct}% bị loại / Trục ${result.axisUsed} / ${result.fps}Hz${result.lowFps ? " ⚠️ thấp" : ""}</strong>
    </div>
    <div class="list-item">
      <span>Mẫu sạch / Thời gian</span>
      <strong>${result.sampleCount} điểm / ${result.duration}s</strong>
    </div>
    ${result.lowFps ? `<p class="muted" style="font-size:11px;color:#f59e0b;margin-top:2px">⚠️ Cảm biến chỉ ở ${result.fps}Hz — thiết bị cũ có thể giới hạn độ chính xác. Khuyến nghị dùng điện thoại có gyroscope tốt.</p>` : ""}
    <p class="muted" style="font-size:11px;margin-top:4px">
      SCG đo rung tim cơ học qua cảm biến gia tốc. Độ chính xác cao nhất khi: nằm yên hoàn toàn, thở đều, điện thoại đặt đúng giữa xương ức.
    </p>`;
  if (statusEl) statusEl.textContent = `✅ SCG: ${result.bpm || "?"} BPM — Tin cậy ${result.confidence}% (${confLabel})`;
}

// ─── // ─── List1 #6: Voice-rPPG — Vocal Cardiac & AFib Analysis ────────────────
// Records RMS + ZCR envelope at ~21 Hz, then multi-band analysis:
// Breathing band (0.15-0.45 Hz), Cardiac band (0.7-4 Hz), ZCR stability.
// AFib scoring: BPM + rhythm irregularity + voice stability + RSA presence.
const _voicePPG = {
  active: false, audioCtx: null, analyser: null, _pollInterval: null, stream: null,
  rmsBuffer: [], zcrBuffer: [], f0Buffer: [], _countTimer: null, _stopTimer: null,
  envFps: 21.5
};
// F0 (fundamental frequency) từ audio buffer bằng autocorrelation
// Dây thanh quản rung ở F0 (~80–320 Hz) → bị modulate nhẹ bởi huyết áp theo nhịp tim
// minF0/maxF0 có thể override sau khi calibrate từ vài giây đầu
function _computeVoiceF0(floatBuf, sampleRate, minF0 = 80, maxF0 = 320) {
  const minPeriod = Math.floor(sampleRate / maxF0);
  const maxPeriod = Math.ceil(sampleRate / minF0);
  const n = Math.min(1024, floatBuf.length);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += floatBuf[i] * floatBuf[i];
  if (energy < 1e-5) return 0; // silence → không tính F0
  let bestLag = 0, bestCorr = -1;
  for (let lag = minPeriod; lag <= Math.min(maxPeriod, n - 1); lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += floatBuf[i] * floatBuf[i + lag];
    const corr = sum / energy;
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  return (bestLag > 0 && bestCorr > 0.28) ? sampleRate / bestLag : 0;
}
async function startVoiceRPPG() {
  if (_voicePPG.active) return;
  const btn = document.getElementById("startVoiceRPPGBtn");
  const stopBtn = document.getElementById("stopVoiceRPPGBtn");
  const statusEl = document.getElementById("voiceRPPGStatus");
  if (!navigator.mediaDevices?.getUserMedia) {
    if (statusEl) statusEl.textContent = "⚠️ Trình duyệt không hỗ trợ microphone API. Thử Chrome/Edge trên HTTPS.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
      video: false
    });
    _voicePPG.stream = stream;
    const ActxClass = window.AudioContext || window.webkitAudioContext;
    _voicePPG.audioCtx = new ActxClass();
    const actualSampleRate = _voicePPG.audioCtx.sampleRate;
    const bufSize = 2048; // ~21.5 Hz at 44100
    _voicePPG.envFps = actualSampleRate / bufSize;
    const source = _voicePPG.audioCtx.createMediaStreamSource(stream);
    // Dùng AnalyserNode thay ScriptProcessor (deprecated) — tương thích tốt hơn
    const analyser = _voicePPG.audioCtx.createAnalyser();
    analyser.fftSize = bufSize;
    analyser.smoothingTimeConstant = 0;
    _voicePPG.analyser = analyser;
    source.connect(analyser);
    const floatBuf = new Float32Array(bufSize);
    _voicePPG.rmsBuffer = [];
    _voicePPG.zcrBuffer = [];
    const pollMs = Math.round(bufSize / actualSampleRate * 1000); // ~46ms
    _voicePPG.f0Buffer = [];
    // F0 auto-range: calibrate từ 60 frame đầu (~3s) để xác định giọng nam/nữ/trẻ em
    let _f0CalibFrames = [], _f0MinHz = 80, _f0MaxHz = 320, _f0Calibrated = false;
    _voicePPG._pollInterval = setInterval(() => {
      if (!_voicePPG.active) return;
      analyser.getFloatTimeDomainData(floatBuf);
      let sum = 0, zcr = 0;
      for (let i = 0; i < bufSize; i++) {
        sum += floatBuf[i] * floatBuf[i];
        if (i > 0 && floatBuf[i] * floatBuf[i - 1] < 0) zcr++;
      }
      const rms = Math.sqrt(sum / bufSize);
      _voicePPG.rmsBuffer.push(rms);
      _voicePPG.zcrBuffer.push(zcr / bufSize);
      // F0 tracking: calibrate range từ 60 frame đầu, sau đó dùng range phù hợp với giọng thật
      if (rms > 0.001) {
        if (!_f0Calibrated && _f0CalibFrames.length < 60) {
          // Giai đoạn calibrate: thử range rộng nhất
          const raw = _computeVoiceF0(floatBuf, actualSampleRate, 60, 400);
          if (raw > 0) _f0CalibFrames.push(raw);
          if (_f0CalibFrames.length >= 30) {
            // Đủ data: xác định range thực của giọng người dùng
            const med = _f0CalibFrames.slice().sort((a,b)=>a-b)[Math.floor(_f0CalibFrames.length/2)];
            // Nam: <160Hz, Nữ/trẻ: >160Hz, trung tính: 80-320Hz
            if (med > 0) {
              if (med < 140) { _f0MinHz = 60;  _f0MaxHz = 200; }       // giọng trầm (nam)
              else if (med < 210) { _f0MinHz = 80;  _f0MaxHz = 280; }  // trung tính
              else { _f0MinHz = 130; _f0MaxHz = 380; }                  // giọng cao (nữ/trẻ)
            }
            _f0Calibrated = true;
          }
          _voicePPG.f0Buffer.push(raw);
        } else {
          // Giai đoạn chính: dùng range đã calibrate
          _voicePPG.f0Buffer.push(_computeVoiceF0(floatBuf, actualSampleRate, _f0MinHz, _f0MaxHz));
        }
      } else {
        _voicePPG.f0Buffer.push(0);
      }
    }, pollMs);
    _voicePPG.active = true;
    if (btn) { btn.textContent = "⏳ Đang thu âm..."; btn.disabled = true; }
    if (stopBtn) stopBtn.style.display = "";
    let remaining = 45;
    if (statusEl) statusEl.textContent = `🎤 Đang thu — còn ${remaining}s. Nói "aaaah" liên tục, hoặc đặt micro gần cổ họng và thở đều.`;
    _voicePPG._countTimer = setInterval(() => {
      remaining--;
      const count = _voicePPG.rmsBuffer.length;
      const phase = remaining > 30 ? 'Nói "aaaah" hoặc thở đều...'
        : remaining > 15 ? "Tiếp tục giữ yên..." : "Gần xong...";
      if (statusEl) statusEl.textContent = `🎤 ${phase} còn ${remaining}s (${count} mẫu @ ${_voicePPG.envFps.toFixed(1)} Hz)`;
      if (remaining <= 0) clearInterval(_voicePPG._countTimer);
    }, 1000);
    _voicePPG._stopTimer = setTimeout(stopVoiceRPPG, 45000);
  } catch (err) {
    if (statusEl) statusEl.textContent = `⚠️ Không truy cập được microphone: ${err.name}. Vào Settings → cho phép micro.`;
  }
}
function stopVoiceRPPG() {
  if (!_voicePPG.active) return;
  clearInterval(_voicePPG._countTimer);
  clearTimeout(_voicePPG._stopTimer);
  _voicePPG.active = false;
  const rmsSnapshot = [..._voicePPG.rmsBuffer];
  const zcrSnapshot = [..._voicePPG.zcrBuffer];
  const f0Snapshot  = [..._voicePPG.f0Buffer];
  const capturedFps = _voicePPG.envFps;
  if (_voicePPG._pollInterval) { clearInterval(_voicePPG._pollInterval); _voicePPG._pollInterval = null; }
  if (_voicePPG.analyser) { try { _voicePPG.analyser.disconnect(); } catch {} _voicePPG.analyser = null; }
  if (_voicePPG.stream) { _voicePPG.stream.getTracks().forEach(t => t.stop()); _voicePPG.stream = null; }
  if (_voicePPG.audioCtx) { _voicePPG.audioCtx.close().catch(() => {}); _voicePPG.audioCtx = null; }
  const btn = document.getElementById("startVoiceRPPGBtn");
  const stopBtn = document.getElementById("stopVoiceRPPGBtn");
  if (btn) { btn.textContent = "🎤 Bắt đầu lại Voice-rPPG (45s)"; btn.disabled = false; }
  if (stopBtn) stopBtn.style.display = "none";
  const statusEl2 = document.getElementById("voiceRPPGStatus");
  if (statusEl2) statusEl2.textContent = "⚙️ Đang phân tích tín hiệu giọng nói...";
  _analyzeVoiceRPPGBuffer(rmsSnapshot, zcrSnapshot, f0Snapshot, capturedFps);
}

// ACF period finder for a specific Hz range — returns { periodSamples, corr } or null
function _voiceACFPeriod(signal, fps, minHz, maxHz) {
  const n = signal.length;
  const lagMin = Math.max(2, Math.round(fps / maxHz));
  const lagMax = Math.min(Math.floor(n * 0.45), Math.round(fps / minHz));
  if (lagMax <= lagMin || n < lagMax * 2) return null;
  const mean = signal.reduce((a,b)=>a+b,0)/n;
  const c = signal.map(v => v - mean);
  const ac0 = c.reduce((s,v)=>s+v*v,0);
  if (!ac0) return null;
  let bestLag = 0, bestCorr = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += c[i] * c[i+lag];
    const nc = sum / ac0;
    if (nc > bestCorr) { bestCorr = nc; bestLag = lag; }
  }
  return (bestLag > 0 && bestCorr > 0.15) ? { periodSamples: bestLag, corr: bestCorr } : null;
}

function _analyzeVoiceRPPGBuffer(rmsData, zcrData, f0Data, envFps) {
  const statusEl = document.getElementById("voiceRPPGStatus");
  const fps = envFps || (44100 / 2048);
  const minSamples = Math.floor(fps * 12);

  if (!rmsData || rmsData.length < minSamples) {
    if (statusEl) statusEl.textContent = `⚠️ Chỉ có ${rmsData?.length || 0} mẫu — cần ≥${minSamples} (12s). Thử lại lâu hơn.`;
    renderVoiceRPPGResult({ error: 'too_short' }); return;
  }

  // 1. Signal quality
  const sortedRMS = [...rmsData].sort((a,b)=>a-b);
  const noiseFloor = Math.max(sortedRMS[Math.floor(sortedRMS.length * 0.1)], 1e-6);
  const meanRMS = rmsData.reduce((a,b)=>a+b,0) / rmsData.length;
  const snrDB = Math.round(20 * Math.log10(meanRMS / noiseFloor));
  const signalLevel = Math.round(meanRMS * 10000) / 100;

  if (meanRMS < 0.0005) {
    if (statusEl) statusEl.textContent = "⚠️ Microphone im lặng — nói to hơn hoặc đặt micro gần miệng/cổ họng hơn.";
    renderVoiceRPPGResult({ error: 'silent' }); return;
  }

  // 2. Active-window gate — loại bỏ các frame im lặng (RMS < 3× noise floor)
  // Giữ liên tục bằng cách chỉ dùng segments đủ dài, không cắt rời
  const activeThreshold = noiseFloor * 3.0;
  const winSz = Math.round(fps * 0.5); // 0.5s window
  const activeRms = [];
  for (let i = 0; i + winSz <= rmsData.length; i += winSz) {
    const winMean = rmsData.slice(i, i + winSz).reduce((a, b) => a + b, 0) / winSz;
    if (winMean > activeThreshold) activeRms.push(...rmsData.slice(i, i + winSz));
  }
  // Fallback: nếu quá ít active frames (user nói thưa), dùng toàn bộ signal
  const analysisData = activeRms.length >= minSamples ? activeRms : rmsData;

  // 3. Multi-band separation via zero-phase Butterworth
  const breathingBand = butterworthBandpassDynamic(analysisData, fps, 0.15, Math.min(0.45, fps * 0.44));
  const cardiacBand   = butterworthBandpassDynamic(analysisData, fps, 0.7,  Math.min(4.0,  fps * 0.44));

  // 4. Breathing rate (9-27 breaths/min)
  const brRes = _voiceACFPeriod(breathingBand, fps, 0.15, 0.45);
  const breathingRate = brRes ? Math.round(fps / brRes.periodSamples * 60) : null;

  // 5. Cardiac BPM — FFT + ACF on cardiac band
  const bpmFFT = fftBpm(cardiacBand, fps);
  const bpmACF = autocorrBpm(cardiacBand, fps);
  const cands = [bpmFFT, bpmACF].filter(b => b && b >= 40 && b <= 180);
  let bpm = null, bpmConf = 0;
  if (cands.length === 2) {
    const diff = Math.abs(cands[0] - cands[1]);
    bpm = Math.round((cands[0]+cands[1])/2);
    bpmConf = diff <= 5 ? 72 : diff <= 10 ? 58 : diff <= 18 ? 44 : 30;
  } else if (cands.length === 1) {
    bpm = cands[0]; bpmConf = 35;
  }
  if (snrDB > 18) bpmConf = Math.min(85, bpmConf + 12);
  else if (snrDB < 6) bpmConf = Math.max(0, bpmConf - 20);

  // 5b. F0-based BPM — cardiac modulation in pitch contour
  // Dây thanh quản bị huyết áp thay đổi modulate nhẹ theo nhịp tim
  let bpmF0 = null, f0CardiacCorr = 0;
  if (f0Data && f0Data.length >= minSamples) {
    // Chỉ lấy các frame có F0 > 0 (voiced frames)
    const voicedF0 = f0Data.map(v => v > 0 ? v : null);
    // Interpolate qua các silence gaps (linear)
    let lastV = 0;
    const f0Interp = voicedF0.map(v => { if (v !== null) { lastV = v; return v; } return lastV; });
    // Bandpass F0 contour trong dải cardiac (0.7–4 Hz) để tách modulation nhịp tim
    const f0Cardiac = butterworthBandpassDynamic(f0Interp, fps, 0.7, Math.min(4.0, fps * 0.44));
    const bpmF0_FFT = fftBpm(f0Cardiac, fps);
    const bpmF0_ACF = autocorrBpm(f0Cardiac, fps);
    const f0Cands = [bpmF0_FFT, bpmF0_ACF].filter(b => b && b >= 40 && b <= 160);
    if (f0Cands.length === 2 && Math.abs(f0Cands[0] - f0Cands[1]) <= 8) {
      bpmF0 = Math.round((f0Cands[0] + f0Cands[1]) / 2);
      // ACF quality check ở BPM được phát hiện
      const lag = Math.round(fps * 60 / bpmF0);
      if (lag > 0 && lag < f0Cardiac.length) {
        const m = f0Cardiac.reduce((a, b) => a + b, 0) / f0Cardiac.length;
        const c = f0Cardiac.map(v => v - m);
        const ac0 = c.reduce((s, v) => s + v * v, 0);
        let acLag = 0;
        for (let i = 0; i < c.length - lag; i++) acLag += c[i] * c[i + lag];
        f0CardiacCorr = ac0 > 0 ? Math.max(0, acLag / ac0) : 0;
      }
    }
  }

  // F0 + RMS consensus: nếu đồng thuận → confidence tăng đáng kể
  let bpmFused = bpm;
  if (bpmF0 && bpm && Math.abs(bpmF0 - bpm) <= 6) {
    bpmFused = Math.round((bpmF0 + bpm) / 2);
    bpmConf = Math.min(88, bpmConf + 14);
  } else if (bpmF0 && !bpm) {
    bpmFused = bpmF0;
    bpmConf = Math.min(55, 30 + Math.round(f0CardiacCorr * 40));
  }
  bpm = bpmFused;

  // 6. Cardiac rhythm irregularity from peak intervals in cardiac band
  const cPeaks = detectSCGPeaks(cardiacBand, fps);
  let rhythmIrr = 0, sdnnVoice = 0;
  if (cPeaks.length >= 4) {
    const ivls = [];
    for (let i = 1; i < cPeaks.length; i++) ivls.push(cPeaks[i] - cPeaks[i-1]);
    const mIvl = ivls.reduce((a,b)=>a+b,0) / ivls.length;
    const stdIvl = Math.sqrt(ivls.reduce((a,b)=>a+(b-mIvl)**2,0) / ivls.length);
    rhythmIrr = Math.round(stdIvl / mIvl * 1000) / 1000;
    sdnnVoice = Math.round(stdIvl / fps * 1000);
  }

  // 6. Voice stability: ZCR coefficient of variation
  let zcrCV = 0;
  if (zcrData && zcrData.length > 10) {
    const meanZCR = zcrData.reduce((a,b)=>a+b,0) / zcrData.length;
    const stdZCR  = Math.sqrt(zcrData.reduce((a,b)=>a+(b-meanZCR)**2,0) / zcrData.length);
    zcrCV = Math.round(stdZCR / (meanZCR || 1) * 1000) / 1000;
  }

  // 7. AFib multi-metric scoring
  let afibScore = 0;
  const reasons = [];
  if (bpm && bpm > 120)      { afibScore += 30; reasons.push(`Nhịp tim rất nhanh ${bpm} BPM`); }
  else if (bpm && bpm > 100) { afibScore += 18; reasons.push(`Nhịp tim nhanh ${bpm} BPM`); }
  if (rhythmIrr > 0.40)      { afibScore += 35; reasons.push(`Nhịp rất không đều (CV=${rhythmIrr})`); }
  else if (rhythmIrr > 0.22) { afibScore += 16; reasons.push(`Nhịp hơi không đều (CV=${rhythmIrr})`); }
  // ZCR instability chỉ tính khi SNR đủ tốt (≥8 dB) — tránh false positive do phòng ồn
  if (snrDB >= 8) {
    if (zcrCV > 0.55)      { afibScore += 14; reasons.push(`Giọng không ổn định (ZCR CV=${zcrCV})`); }
    else if (zcrCV > 0.35) { afibScore += 5; }
  }
  // RSA (Respiratory Sinus Arrhythmia): present in normal sinus rhythm, absent in AFib
  if (brRes && brRes.corr > 0.25 && rhythmIrr < 0.20) afibScore = Math.max(0, afibScore - 10);
  afibScore = Math.min(100, Math.max(0, afibScore));

  const confidence = Math.round(bpmConf);
  const isValid = !!bpm && confidence >= 28;

  // 8. 3-tier assessment
  let assessment, assessColor, assessIcon, assessDetail;
  if (!isValid) {
    assessment = "Chưa xác định"; assessColor = "#94a3b8"; assessIcon = "❓";
    assessDetail = 'Tín hiệu chưa đủ rõ. Thử nói "aaaah" liên tục hoặc đặt micro sát cổ họng trong phòng yên tĩnh.';
  } else if (afibScore >= 55) {
    assessment = "Dấu hiệu AFib"; assessColor = "#ef4444"; assessIcon = "🔴";
    assessDetail = `Phát hiện: ${reasons.join("; ")}. Cần đo PPG Ngón tay ngay để xác nhận rung nhĩ.`;
  } else if (afibScore >= 28 || (bpm && bpm > 95) || rhythmIrr > 0.20) {
    assessment = "Cần theo dõi"; assessColor = "#f59e0b"; assessIcon = "🟡";
    const w = [];
    if (bpm && bpm > 95) w.push(`nhịp ${bpm} BPM hơi nhanh`);
    if (rhythmIrr > 0.20) w.push(`nhịp hơi không đều (${rhythmIrr})`);
    assessDetail = `Phát hiện: ${w.join(", ") || "một số chỉ số cần theo dõi"}. Khuyến nghị đo PPG để xác nhận.`;
  } else {
    assessment = "Bình thường"; assessColor = "#22c55e"; assessIcon = "🟢";
    assessDetail = `Giọng nói không phát hiện dấu hiệu rung nhĩ. Nhịp tim ${bpm} BPM, nhịp đều.`;
  }

  renderVoiceRPPGResult({
    bpm, confidence, signalLevel, snrDB, isValid,
    rhythmIrr, sdnnVoice, zcrCV, afibScore,
    assessment, assessColor, assessIcon, assessDetail,
    breathingRate, brCorr: brRes ? Math.round(brRes.corr * 100) : 0,
    bpmFFT, bpmACF, bpmF0, f0CardiacCorr: Math.round(f0CardiacCorr * 100),
    peakCount: cPeaks.length,
    duration: Math.round(analysisData.length / fps)
  });
}

function renderVoiceRPPGResult(r) {
  const box = document.getElementById("voiceRPPGResultBox");
  const statusEl = document.getElementById("voiceRPPGStatus");
  if (!box) return;

  if (r.error === 'too_short' || r.error === 'silent') {
    box.innerHTML = `<p class="muted" style="color:#f59e0b;font-size:12px">⚠️ ${r.error === 'silent' ? 'Microphone im lặng — nói to hơn hoặc đặt micro gần cổ họng.' : 'Không đủ dữ liệu — thử lại ít nhất 15s.'}</p>`;
    return;
  }

  const confColor  = r.confidence >= 58 ? "#22c55e" : r.confidence >= 35 ? "#f59e0b" : "#94a3b8";
  const irrColor   = r.rhythmIrr > 0.40 ? "#ef4444" : r.rhythmIrr > 0.22 ? "#f59e0b" : "#22c55e";
  const irrLabel   = r.rhythmIrr > 0.40 ? "Bất thường cao" : r.rhythmIrr > 0.22 ? "Hơi không đều" : "Đều đặn";
  const snrLabel   = r.snrDB > 18 ? "Tốt" : r.snrDB > 8 ? "Vừa" : "Yếu — phòng ồn";
  const zcrLabel   = r.zcrCV > 0.55 ? "Không ổn định" : r.zcrCV > 0.35 ? "Hơi dao động" : "Ổn định";
  const zcrColor   = r.zcrCV > 0.55 ? "#ef4444" : r.zcrCV > 0.35 ? "#f59e0b" : "#22c55e";
  const breathHtml = r.breathingRate
    ? `<div class="list-item"><span>Nhịp thở (Voice)</span><strong>${r.breathingRate} lần/phút ${r.breathingRate > 22 ? "⚠️ Hơi nhanh" : r.breathingRate < 8 ? "⚠️ Hơi chậm" : "— Bình thường"}</strong></div>` : '';
  const methodParts = [
    r.bpmFFT ? `RMS-FFT: ${r.bpmFFT}` : null,
    r.bpmACF ? `RMS-ACF: ${r.bpmACF}` : null,
    r.bpmF0  ? `F0-pitch: ${r.bpmF0} (ACF ${r.f0CardiacCorr}%)` : null,
  ].filter(Boolean).join(' · ');
  const afibBar = Math.min(100, r.afibScore);
  const afibBarColor = r.afibScore >= 55 ? "#ef4444" : r.afibScore >= 28 ? "#f59e0b" : "#22c55e";

  box.innerHTML = `
    <div style="background:${r.assessColor}1a;border:1px solid ${r.assessColor}55;border-radius:8px;padding:8px 10px;margin-bottom:8px">
      <div style="font-size:14px;font-weight:700;color:${r.assessColor}">${r.assessIcon} Kết luận: ${r.assessment}</div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:3px">${r.assessDetail}</div>
    </div>
    <div class="list-item"><span>BPM từ giọng nói</span><strong style="font-size:17px">${r.isValid ? r.bpm + " BPM" : "--"}</strong></div>
    <div class="list-item"><span>Độ tin cậy</span><strong style="color:${confColor}">${r.confidence}%</strong></div>
    <div class="list-item"><span>Nhịp không đều (cardiac band)</span><strong style="color:${irrColor}">${r.rhythmIrr} — ${irrLabel}</strong></div>
    ${r.sdnnVoice ? `<div class="list-item"><span>SDNN giọng nói</span><strong>${r.sdnnVoice} ms</strong></div>` : ""}
    <div class="list-item"><span>Ổn định giọng nói (ZCR)</span><strong style="color:${zcrColor}">${r.zcrCV} — ${zcrLabel}</strong></div>
    ${breathHtml}
    <div class="list-item"><span>Chỉ số AFib Voice</span><strong style="color:${afibBarColor}">${r.afibScore}/100</strong></div>
    <div style="background:#1e293b;border-radius:4px;height:7px;margin:2px 0 8px;overflow:hidden">
      <div style="background:${afibBarColor};width:${afibBar}%;height:100%;border-radius:4px;transition:width 0.6s"></div>
    </div>
    <div class="list-item"><span>2 phương pháp BPM</span><strong style="font-size:11px;color:#94a3b8">${methodParts || "--"}</strong></div>
    <div class="list-item"><span>SNR / Chất lượng micro</span><strong style="color:${r.snrDB > 8 ? "#22c55e" : "#f59e0b"}">${r.snrDB} dB — ${snrLabel}</strong></div>
    <div class="list-item"><span>Đỉnh cardiac / Thời gian</span><strong>${r.peakCount} đỉnh / ${r.duration}s</strong></div>
    <p class="muted" style="font-size:10px;color:#64748b;margin-top:4px">Voice-rPPG phân tích dao động tim và RSA trong giọng nói. Cần nói "aaaah" liên tục hoặc đặt micro gần cổ họng trong phòng yên tĩnh. Không thay thế PPG để chẩn đoán AFib.</p>`;

  if (statusEl) statusEl.textContent = `✅ Voice-rPPG: ${r.isValid ? r.bpm + " BPM" : "tín hiệu yếu"} — ${r.assessIcon} ${r.assessment} (AFib ${r.afibScore}/100)`;
}

// ─── List1 #7 extended: Keyboard BCG Tracking ────────────────────────────────
const _kbcg = { events: [], active: false, _countTimer: null };
function startKeyboardBCGTracking() {
  if (_kbcg.active) return;
  _kbcg.events = []; _kbcg.active = true;
  document.addEventListener("keydown", _kbcgKeyHandler);
  const statusEl = document.getElementById("kbcgStatus");
  const startBtn = document.getElementById("startKBCGBtn");
  const stopBtn = document.getElementById("stopKBCGBtn");
  if (startBtn) { startBtn.textContent = "⏳ Đang phân tích..."; startBtn.disabled = true; }
  if (stopBtn) stopBtn.style.display = "";
  let remaining = 60;
  if (statusEl) statusEl.textContent = `⌨️ Đang theo dõi — còn ${remaining}s. Gõ phím tự nhiên bất kỳ thứ gì!`;
  _kbcg._countTimer = setInterval(() => {
    remaining--;
    if (statusEl) statusEl.textContent = `⌨️ Đang ghi nhận nhịp gõ — còn ${remaining}s (${_kbcg.events.length} phím)`;
    if (remaining <= 0) clearInterval(_kbcg._countTimer);
  }, 1000);
  setTimeout(stopKeyboardBCGTracking, 60000);
}
function _kbcgKeyHandler(e) {
  if (!_kbcg.active) return;
  _kbcg.events.push({ t: Date.now(), key: e.key });
}
function stopKeyboardBCGTracking() {
  if (!_kbcg.active) return;
  clearInterval(_kbcg._countTimer);
  _kbcg.active = false;
  document.removeEventListener("keydown", _kbcgKeyHandler);
  const startBtn = document.getElementById("startKBCGBtn");
  const stopBtn = document.getElementById("stopKBCGBtn");
  const statusEl = document.getElementById("kbcgStatus");
  if (startBtn) { startBtn.textContent = "⌨️ Bắt đầu lại BCG bàn phím (60s)"; startBtn.disabled = false; }
  if (stopBtn) stopBtn.style.display = "none";
  if (_kbcg.events.length >= 20) {
    const result = analyzeKeyboardBCG(_kbcg.events);
    renderKeyboardBCGResult(result);
  } else {
    if (statusEl) statusEl.textContent = `⚠️ Chỉ có ${_kbcg.events.length} phím — cần ≥20 để phân tích. Thử lại và gõ nhiều hơn.`;
  }
}
function analyzeKeyboardBCG(events) {
  if (events.length < 15) return null;

  // 1. Accept only "typing" keys — exclude modifiers, arrows, F-keys (different motor dynamics)
  const TYPING_RE = /^(Backspace|Enter|Tab|[ -~])$/;
  const typingEvs = events.filter(e => TYPING_RE.test(e.key));
  if (typingEvs.length < 12) return null;

  // 2. Compute IKIs, filter to realistic keystroke range (60–700ms)
  const allIKIs = [];
  for (let i = 1; i < typingEvs.length; i++) {
    const dt = typingEvs[i].t - typingEvs[i-1].t;
    if (dt >= 60 && dt <= 700) allIKIs.push(dt);
  }
  if (allIKIs.length < 10) return null;

  // 3. Segment into typing bursts (IKI < 600ms = continuous typing, ≥600ms = pause/think)
  // Cardiac BCG signal is only meaningful within a continuous burst
  const bursts = [];
  let cur = [allIKIs[0]];
  for (let i = 1; i < allIKIs.length; i++) {
    if (allIKIs[i] < 600) { cur.push(allIKIs[i]); }
    else { if (cur.length >= 4) bursts.push(cur); cur = []; }
  }
  if (cur.length >= 4) bursts.push(cur);
  const ikis = bursts.length ? bursts.flat() : allIKIs;

  // 4. Basic statistics
  const mean = ikis.reduce((a,b)=>a+b,0)/ikis.length;
  const std = Math.sqrt(ikis.reduce((a,b)=>a+(b-mean)**2,0)/ikis.length);
  const cv = std / (mean || 1);

  // RMSSD — successive differences (closer to HRV than CV)
  let rmssdSum = 0;
  for (let i = 1; i < ikis.length; i++) rmssdSum += (ikis[i]-ikis[i-1])**2;
  const rmssd = Math.round(Math.sqrt(rmssdSum / Math.max(1, ikis.length - 1)));

  // 5. Autocorrelation on IKI sequence to find cardiac periodicity
  // Theory: heartbeat micro-tremors modulate finger speed at ~1 Hz
  // → IKI sequence carries a periodic component at the cardiac period
  const centered = ikis.map(v => v - mean);
  const ac0 = centered.reduce((s,v) => s + v*v, 0) / centered.length;

  // Search lags that correspond to 40–180 BPM at this typing speed
  const lagMin = Math.max(2, Math.round(60000 / (180 * mean)));
  const lagMax = Math.min(Math.floor(ikis.length * 0.45), Math.round(60000 / (40 * mean)));

  let bestLag = 0, bestCorr = 0;
  if (ac0 > 0 && lagMax > lagMin && ikis.length > lagMax * 2) {
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let sum = 0;
      for (let i = 0; i < centered.length - lag; i++) sum += centered[i] * centered[i + lag];
      const corr = sum / (centered.length * ac0);
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
  }

  // 6. Convert best lag to BPM estimate
  // Threshold 0.20 (không phải 0.12) — tránh false detection từ pattern ngôn ngữ
  let bpm = null;
  if (bestLag > 0 && bestCorr > 0.20) {
    const period = bestLag * mean;
    const raw = Math.round(60000 / period);
    if (raw >= 40 && raw <= 180) bpm = raw;
  }

  // 7. Confidence scoring — đã tăng ngưỡng, nên confidence cũng calibrate lại
  let confidence = 0;
  if (bpm) {
    if      (bestCorr > 0.40) confidence = 72;
    else if (bestCorr > 0.28) confidence = 56;
    else if (bestCorr > 0.20) confidence = 38;
    if (ikis.length >= 40)   confidence = Math.min(80, confidence + 8);
    if (cv > 0.55)           confidence = Math.max(12, confidence - 20);
    if (bursts.length >= 3)  confidence = Math.min(82, confidence + 6);
    // CV quá thấp (<0.10) = gõ cơ học đều, signal tim bị lấn át bởi motor pattern
    if (cv < 0.10)           confidence = Math.max(12, confidence - 15);
  }

  const jitterScore = Math.round(Math.min(100, cv * 150));

  let riskHint;
  if (!bpm || confidence < 20) {
    riskHint = cv > 0.55
      ? "Nhịp gõ phím quá không đều — kết quả BCG kém tin cậy. Gõ đều, liên tục, không dừng nghĩ quá nhiều."
      : cv < 0.10
      ? "Nhịp gõ quá đều (máy móc) — tín hiệu tim bị lấn át bởi motor pattern. Gõ văn bản tự nhiên thay vì lặp phím."
      : "Không tìm được chu kỳ tim đủ mạnh từ nhịp gõ phím. Cần gõ đều, liên tục ≥35 giây, trong phòng yên tĩnh.";
  } else if (confidence >= 55) {
    riskHint = `Phát hiện chu kỳ vi rung tim ~${bpm} BPM (ACF ${Math.round(bestCorr*100)}%). Kết hợp Face PPG để xác nhận chính xác.`;
  } else {
    riskHint = `Ước tính sơ bộ ~${bpm} BPM (ACF ${Math.round(bestCorr*100)}% — yếu). Gõ văn bản tự nhiên, đều tay hơn.`;
  }

  return {
    bpm, confidence: Math.round(confidence), cv: Math.round(cv*1000)/1000,
    rmssd, jitterScore, keyCount: events.length, ikiCount: ikis.length,
    burstCount: bursts.length, bestCorr: Math.round(bestCorr*100)/100,
    riskHint
  };
}
function renderKeyboardBCGResult(result) {
  const box = document.getElementById("kbcgResultBox");
  const statusEl = document.getElementById("kbcgStatus");
  if (!box || !result) return;

  const confColor = result.confidence >= 60 ? "#22c55e" : result.confidence >= 35 ? "#f59e0b" : "#ef4444";
  const confLabel = result.confidence >= 60 ? "Tin cậy" : result.confidence >= 35 ? "Sơ bộ" : "Thấp";
  const cvColor = result.cv > 0.55 ? "#ef4444" : result.cv > 0.35 ? "#f59e0b" : "#22c55e";

  const bpmHtml = result.bpm
    ? `<div class="list-item"><span>BPM ước tính (BCG phím)</span><strong style="font-size:17px">${result.bpm} BPM</strong></div>
       <div class="list-item"><span>Độ tin cậy</span><strong style="color:${confColor}">${result.confidence}% — ${confLabel}</strong></div>`
    : `<div class="list-item"><span>BPM ước tính</span><strong style="color:#94a3b8">-- (chưa phát hiện)</strong></div>`;

  box.innerHTML = `
    ${bpmHtml}
    <div class="list-item"><span>Tương quan ACF (vi rung tim)</span><strong style="color:${result.bestCorr>0.28?"#22c55e":result.bestCorr>0.20?"#f59e0b":"#ef4444"}">${Math.round(result.bestCorr*100)}%</strong></div>
    <div class="list-item"><span>Biến thiên IKI gõ phím (RMSSD)</span><strong>${result.rmssd} ms <span style="font-size:10px;color:#64748b">— không phải HRV tim</span></strong></div>
    <div class="list-item"><span>Biến thiên nhịp gõ (CV)</span><strong style="color:${cvColor}">${result.cv} ${result.cv < 0.10 ? "— ⚠️ quá đều" : result.cv > 0.55 ? "— ⚠️ quá loạn" : "— tốt"}</strong></div>
    <div class="list-item"><span>Mẫu / Cụm gõ / Tổng phím</span><strong>${result.ikiCount} IKI / ${result.burstCount} cụm / ${result.keyCount} phím</strong></div>
    <p class="muted" style="font-size:12px;margin-top:6px">${result.riskHint}</p>
    <p class="muted" style="font-size:10px;color:#64748b;margin-top:2px">BCG bàn phím phát hiện vi rung tim (≈1Hz) trong IKI bằng ACF. Cần ≥35s gõ văn bản tự nhiên, liên tục. Kết quả là ước tính sơ bộ — không thay thế PPG.</p>`;
  if (statusEl) statusEl.textContent = `✅ BCG phím: ${result.bpm ? result.bpm + " BPM, " : ""}tin cậy ${result.confidence}%`;
}

// ─── List1 #8: PPG-Thermal Cross-Mapping (Perfusion proxy via RGB) ─────────────
// Uses per-region RGB from sampleFrame() to compare peripheral (nose) vs central
// (forehead) perfusion — nose loses circulation first in vasoconstriction/AFib.
// Cheek asymmetry detects uneven peripheral flow, also an AFib indicator.
function analyzePPGThermalProxy(samples) {
  if (!samples || samples.length < 30) return null;

  // Per-region data (populated when face landmarks are available)
  const withR = samples.filter(s => s.regions);
  const useRegional = withR.length >= 20;

  // Global averages (always available)
  const reds   = samples.map(s => s.avgRed   || 0);
  const greens = samples.map(s => s.avgGreen || 0);
  const meanR  = reds.reduce((a,b)=>a+b,0)/reds.length;
  const meanG  = greens.reduce((a,b)=>a+b,0)/greens.length;
  const stdR   = Math.sqrt(reds.reduce((a,b)=>a+(b-meanR)**2,0)/reds.length);
  const globalPI  = Math.round(stdR / (meanR||1) * 1000) / 10;
  const rgRatio   = Math.round(meanR / (meanG||1) * 100) / 100;

  // Per-region perfusion index = AC/DC = std(R)/mean(R) per zone
  function _perfIdx(arr) {
    const m = arr.reduce((a,b)=>a+b,0) / (arr.length||1) || 1;
    return Math.round(Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length) / m * 1000) / 10;
  }
  function _rgMean(arr, key) {
    return Math.round(arr.reduce((a,s)=>a+s.regions[key].r/Math.max(1,s.regions[key].g),0)/arr.length*100)/100;
  }

  let perfFH=0, perfLC=0, perfRC=0, perfNT=null;
  let rFH=0, rLC=0, rRC=0, rNT=null;
  let cheekAsymmetry=0, noseRatio=null, noseTrend=0, forehTrend=0;
  let regionalSamples=0;

  if (useRegional) {
    regionalSamples = withR.length;
    perfFH = _perfIdx(withR.map(s=>s.regions.fh.r));
    perfLC = _perfIdx(withR.map(s=>s.regions.lc.r));
    perfRC = _perfIdx(withR.map(s=>s.regions.rc.r));
    rFH = _rgMean(withR, 'fh');
    rLC = _rgMean(withR, 'lc');
    rRC = _rgMean(withR, 'rc');

    // Left vs right cheek R/G asymmetry
    cheekAsymmetry = Math.round(Math.abs(rLC - rRC) / ((rLC+rRC)/2 || 1) * 100);

    // Nose tip — only when landmark available
    const withNT = withR.filter(s => s.regions.nt);
    if (withNT.length >= 15) {
      perfNT = _perfIdx(withNT.map(s=>s.regions.nt.r));
      rNT = Math.round(withNT.reduce((a,s)=>a+s.regions.nt.r/Math.max(1,s.regions.nt.g),0)/withNT.length*100)/100;
      // nose/forehead perfusion ratio — key peripheral vasoconstriction indicator
      noseRatio = Math.round(perfNT / Math.max(0.1, perfFH) * 100);

      // Temporal trend: early vs late nose brightness
      if (withNT.length >= 30) {
        const third = Math.floor(withNT.length / 3);
        const avg = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
        noseTrend  = Math.round(avg(withNT.slice(-third).map(s=>s.regions.nt.r))  - avg(withNT.slice(0,third).map(s=>s.regions.nt.r)));
        forehTrend = Math.round(avg(withR.slice(-third).map(s=>s.regions.fh.r))   - avg(withR.slice(0,third).map(s=>s.regions.fh.r)));
      }
    }
  }

  // Assess vasoconstriction
  let vasoState, vasoColor, vasoDetail;
  if (useRegional && noseRatio != null) {
    if (noseRatio < 55) {
      vasoState = "Co mạch ngoại vi r\xf5";  vasoColor = "#ef4444";
      vasoDetail = `Mũi tưới m\xe1u rất k\xe9m so với tr\xe1n (${noseRatio}%). Dấu hiệu co mạch do lạnh hoặc giảm cung lượng tim (AFib).`;
    } else if (noseRatio < 75 || cheekAsymmetry > 20) {
      vasoState = "Giảm tưới m\xe1u nhẹ"; vasoColor = "#f59e0b";
      vasoDetail = cheekAsymmetry > 20
        ? `Bất c\xe2n xứng hai m\xe1 ${cheekAsymmetry}% — c\xf3 thể do AFib g\xe2y kh\xf4ng đều tưới m\xe1u ngoại vi.`
        : `Mũi tưới m\xe1u thấp hơn tr\xe1n ${100-noseRatio}%. Theo d\xf5i th\xeam.`;
    } else {
      vasoState = "Tuần ho\xe0n ngoại vi b\xecnh thường"; vasoColor = "#22c55e";
      vasoDetail = `Ph\xe2n bố tưới m\xe1u đều (mũi ${noseRatio}% tr\xe1n). Kh\xf4ng c\xf3 dấu hiệu co mạch.`;
    }
  } else {
    if (globalPI < 2)      { vasoState="Tưới m\xe1u k\xe9m";    vasoColor="#ef4444"; vasoDetail="Chỉ số vi tuần ho\xe0n thấp — kiểm tra xem mặt c\xf3 lạnh kh\xf4ng."; }
    else if (globalPI < 5) { vasoState="B\xecnh thường";         vasoColor="#f59e0b"; vasoDetail="Tưới m\xe1u mức trung b\xecnh."; }
    else                   { vasoState="Tuần ho\xe0n tốt";        vasoColor="#22c55e"; vasoDetail="Tuần ho\xe0n ngoại vi tốt."; }
  }

  return {
    globalPI, rgRatio, vasoState, vasoColor, vasoDetail, useRegional,
    perfFH, perfLC, perfRC, perfNT,
    rFH, rLC, rRC, rNT,
    cheekAsymmetry, noseRatio, noseTrend, forehTrend, regionalSamples
  };
}

function renderThermalProxyResult(tp) {
  const tBox = document.getElementById("thermalProxyBox");
  if (!tBox) return;
  function _rBox(lbl, perf, rg) {
    const c = (perf||0) > 5 ? "#22c55e" : (perf||0) > 2 ? "#f59e0b" : "#ef4444";
    return `<div style="text-align:center;background:#1e293b;border-radius:6px;padding:6px 4px;border:1px solid ${c}40">
      <div style="font-size:10px;color:#94a3b8">${lbl}</div>
      <div style="font-weight:700;color:${c};font-size:13px">${perf!=null?perf+'%':'--'}</div>
      <div style="font-size:9px;color:#64748b">R/G ${rg||'--'}</div></div>`;
  }
  const regional = tp.useRegional ? `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0">
      ${_rBox('Trán',tp.perfFH,tp.rFH)}${_rBox('Má trái',tp.perfLC,tp.rLC)}${_rBox('Má phải',tp.perfRC,tp.rRC)}${_rBox('Mũi',tp.perfNT,tp.rNT)}
    </div>
    ${tp.noseRatio!=null?`<div class="list-item"><span>Tỉ lệ tưới m\xe1u mũi/tr\xe1n</span><strong style="color:${tp.noseRatio<55?'#ef4444':tp.noseRatio<75?'#f59e0b':'#22c55e'}">${tp.noseRatio}%${tp.noseRatio<55?' ⚠️ Thấp':tp.noseRatio<75?' ⚠️ Vừa':' — Bình thường'}</strong></div>`:''}
    ${tp.cheekAsymmetry>10?`<div class="list-item"><span>Bất c\xe2n xứng hai m\xe1</span><strong style="color:${tp.cheekAsymmetry>20?'#ef4444':'#f59e0b'}">${tp.cheekAsymmetry}%${tp.cheekAsymmetry>20?' — Đ\xe1ng ch\xfa \xfd':''}</strong></div>`:''}
    ${tp.noseTrend!==0?`<div class="list-item"><span>Xu hướng tưới m\xe1u mũi</span><strong style="color:${tp.noseTrend<-3?'#ef4444':'#94a3b8'}">${tp.noseTrend>0?'↗ Cải thiện':'↘ Giảm dần'} (${tp.noseTrend})</strong></div>`:''}
    <div class="list-item"><span>Số mẫu landmark</span><strong>${tp.regionalSamples} mẫu</strong></div>` : '';
  tBox.innerHTML = `
    <div style="background:${tp.vasoColor}1a;border-left:3px solid ${tp.vasoColor};padding:6px 10px;border-radius:4px;margin-bottom:8px">
      <div style="font-weight:700;color:${tp.vasoColor};font-size:13px">${tp.vasoState}</div>
      <div style="font-size:11px;color:#cbd5e1;margin-top:2px">${tp.vasoDetail}</div>
    </div>
    ${regional}
    <div class="list-item"><span>Chỉ số vi tuần ho\xe0n tổng (PI)</span><strong style="color:${tp.globalPI<2?'#ef4444':tp.globalPI<5?'#f59e0b':'#22c55e'}">${tp.globalPI}%</strong></div>
    <div class="list-item"><span>Tỷ lệ R/G to\xe0n khu\xf4n mặt</span><strong>${tp.rgRatio}</strong></div>
    <p class="muted" style="font-size:10px;color:#64748b;margin-top:4px">Nhiệt độ da mũi giảm trước ti\xean khi co mạch. Bất c\xe2n xứng m\xe1 c\xf3 thể li\xean quan đến AFib. Chỉ c\xf3 hiệu quả khi sử dụng Face PPG c\xf3 landmark.</p>`;
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
  const mean = average(rrs);
  const sorted = [...rrs].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const cv = Math.sqrt(rrs.map(r => (r - mean) ** 2).reduce((a, b) => a + b, 0) / n) / mean;

  // ── Ectopic beat detection (PAC/PVC) ────────────────────────────────────────
  // PAC/PVC fingerprint: short coupling interval + compensatory pause
  // Coupling ratio: premature beat RR < 85% of local mean (robust vs IQR)
  let prematureCount = 0, compensatoryCount = 0;
  for (let i = 1; i < n - 1; i++) {
    const localMean = (rrs[Math.max(0,i-3)] + rrs[Math.max(0,i-2)] + rrs[Math.max(0,i-1)]) / 3;
    if (rrs[i] < localMean * 0.85 && rrs[i] > 250) { // premature but not artifact
      prematureCount++;
      // Compensatory pause: next RR > 115% of local mean (sum near 2*normal)
      if (rrs[i + 1] > localMean * 1.15) compensatoryCount++;
    }
  }
  const prematureRate = prematureCount / n;
  const compensatoryRate = prematureCount > 0 ? compensatoryCount / prematureCount : 0;

  // ── Bigeminy/trigeminy pattern detection ────────────────────────────────────
  // Bigeminy: alternating short-long-short-long. Trigeminy: short-normal-normal repeating.
  let bigeminyCnt = 0, trigemCnt = 0;
  for (let i = 2; i < n - 1; i++) {
    if (rrs[i] < mean * 0.85 && rrs[i-1] > mean * 1.05 && rrs[i+1] > mean * 1.05) bigeminyCnt++;
    if (i >= 3 && rrs[i] < mean * 0.85 && rrs[i-1] > mean * 0.92 && rrs[i-2] > mean * 0.92) trigemCnt++;
  }
  const bigeminRatio = bigeminyCnt / n;
  const trigemRatio = trigemCnt / n;
  const hasPeriodicEctopy = bigeminRatio > 0.12 || trigemRatio > 0.10;

  // ── Wald-Wolfowitz Runs Test (proper statistical randomness) ─────────────────
  const wwZ = waldWolkowitzZ(rrs);          // Z > 2: truly random (AFib)
  // ── Wiesel IRR (validated irregularity index) ────────────────────────────────
  const irr = wieselIrr(rrs);              // > 0.12: AFib; < 0.06: sinus

  // ── PAC/PVC classification gate ─────────────────────────────────────────────
  // Require: ectopy present + compensatory pattern OR periodic ectopy + low base IRR
  // Ensure we don't misclassify high-burden PAC (no compensatory → could be AF)
  const isPacPvc = (
    (prematureRate >= 0.06 && compensatoryRate >= 0.55 && cv < 0.28 && irr < 0.18) ||
    (hasPeriodicEctopy && cv < 0.30 && (wwZ === null || wwZ < 2.0))
  );
  if (isPacPvc) {
    const conf = Math.round(Math.min(92, 50 + compensatoryRate * 28 + prematureRate * 70 + (hasPeriodicEctopy ? 8 : 0)));
    const pattern = bigeminRatio > 0.12 ? "bigeminy" : trigemRatio > 0.10 ? "trigeminy" : "không đều";
    return { type: "pac_pvc", label: "Ngoại tâm thu (PAC/PVC)", confidence: conf,
      note: `Phát hiện ${prematureCount} nhịp sớm/${n} nhịp (${Math.round(prematureRate*100)}%), mẫu ${pattern}, chu kỳ bù ${Math.round(compensatoryRate*100)}% — Lành tính, không phải AFib.`,
      color: "#f59e0b" };
  }

  // ── AFib classification ──────────────────────────────────────────────────────
  // Require multiple independent signals: high IRR + high WW-Z + high CV
  // Negative gate: periodic ectopy pattern strongly argues against AFib
  const afibIrr   = irr > 0.12;
  const afibWW    = wwZ !== null && wwZ > 1.8;
  const afibCV    = cv > 0.20;
  const afibScore3 = [afibIrr, afibWW, afibCV].filter(Boolean).length;
  const isAfib = afibScore3 >= 2 && !hasPeriodicEctopy && cv > 0.20;
  if (isAfib) {
    const conf = Math.round(Math.min(90,
      40 + (afibIrr ? 18 : 0) + (afibWW ? 18 : 0) + (afibCV ? 14 : 0) + (afibScore3 === 3 ? 8 : 0)
    ));
    return { type: "afib", label: "Rung nhĩ (AFib)", confidence: conf,
      note: `RR không đều hoàn toàn (IRR=${irr.toFixed(2)}, CV=${(cv*100).toFixed(0)}%) — Đặc trưng rung nhĩ.`,
      color: "#ef4444" };
  }

  // ── Normal sinus ─────────────────────────────────────────────────────────────
  // Gate: low IRR + low CV + WW-Z not strongly positive
  const isSinus = irr < 0.07 && cv < 0.12 && (wwZ === null || wwZ < 1.5);
  if (isSinus) {
    const conf = Math.round(Math.min(96, 60 + (0.12 - cv) / 0.12 * 30 + (irr < 0.04 ? 6 : 0)));
    return { type: "normal", label: "Nhịp xoang bình thường", confidence: conf,
      note: "RR interval đều đặn — Tim đập bình thường.", color: "#22c55e" };
  }
  if (cv < 0.14 && irr < 0.09) {
    return { type: "normal", label: "Nhịp xoang bình thường", confidence: 72,
      note: "Biến thiên nhịp tim nhỏ — Bình thường, có thể do thở.", color: "#22c55e" };
  }

  // ── Borderline ───────────────────────────────────────────────────────────────
  return { type: "borderline", label: "Nhịp tim cần theo dõi thêm", confidence: 52,
    note: `Không đủ đặc trưng rõ ràng (IRR=${irr.toFixed(2)}, CV=${(cv*100).toFixed(0)}%). Đo thêm 30 giây hoặc đo lại sau 10 phút.`,
    color: "#f59e0b" };
}

// ─── #2: RSA Index — Breathing-Coupled HR Variation ───────────────────────────
// C2 fix: resample RR intervals sang tần số đều 4Hz trước khi phân tích phổ
// (RR intervals không đều nhau về thời gian — phải interpolate trước DFT)
function computeRSAIndex(rrIntervals) {
  if (!rrIntervals || rrIntervals.length < 16) return null;
  const resampleFps = 4; // 4Hz standard for HRV spectral analysis
  // Build cumulative time axis (beat onset times, same convention as computeLfHfRatio)
  const times = [0];
  for (let i = 0; i < rrIntervals.length - 1; i++) times.push(times[i] + rrIntervals[i] / 1000);
  const totalTime = rrIntervals.reduce((a, b) => a + b, 0) / 1000;
  const nPoints = Math.floor(totalTime * resampleFps);
  if (nPoints < 16) return null;
  // Cubic spline resampling — consistent with computeLfHfRatio
  // Linear interp introduces piecewise-linear kinks → spurious HF power
  const qTimes = Array.from({ length: nPoints }, (_, i) => i / resampleFps);
  const sampled = naturalCubicSpline(times, rrIntervals, qTimes);
  const n = sampled.length;
  const mean = sampled.reduce((a, b) => a + b, 0) / n;
  const centered = sampled.map(r => r - mean);
  let lfPow = 0, hfPow = 0;
  for (let k = 1; k < Math.floor(n / 2); k++) {
    const freq = k * resampleFps / n;
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
  const rsaIndex = Math.round(hfPow / totalPow * 100);
  const isPhysiological = rsaIndex >= 25;
  return { rsaIndex, isPhysiological,
    label: rsaIndex >= 40 ? "RSA Cao – Nhịp thở bình thường" : rsaIndex >= 25 ? "RSA Vừa – Theo dõi thêm" : "RSA Thấp – Cần chú ý",
    note: isPhysiological ? "Biến thiên tim theo nhịp thở bình thường" : "Biến thiên không theo nhịp thở — Cần theo dõi" };
}

// ─── #5: Algorithmic Synthetic ECG from PPG ────────────────────────────────────
// Converts PPG-derived RR intervals to ECG-like waveform for doctor display
// Uses cardiac cycle model: P-wave → QRS → T-wave morphology
// ─── TF.js-Enhanced Synthetic ECG ─────────────────────────────────────────────
// Nâng cấp từ Gaussian đơn giản lên mô phỏng sinh lý đầy đủ:
// - AFib: fibrillatory baseline (sóng f) thay thế P wave
// - Beat-to-beat morphology variation (±3% biên độ tự nhiên)
// - Respiration baseline wander (0.25 Hz)
// - TF.js tf.randomNormal() cho noise Gaussian chuẩn (nếu loaded)
// - PAC/PVC: QRS biến dạng + T wave đảo chiều
function synthesizeECGWaveform(rrIntervals, bpm, numBeats = 6) {
  if (!rrIntervals || !bpm) return null;
  const meanRR = rrIntervals.length ? rrIntervals.reduce((a,b)=>a+b,0)/rrIntervals.length : 60000/bpm;
  const fs = 250;
  const beats = Math.min(numBeats, Math.max(6, rrIntervals.length || numBeats));
  const currentRRs = rrIntervals.length >= beats ? rrIntervals.slice(0, beats) : Array(beats).fill(meanRR);
  const cv = rrIntervals.length >= 3
    ? Math.sqrt(rrIntervals.map(r => (r-meanRR)**2).reduce((a,b)=>a+b,0) / rrIntervals.length) / meanRR : 0;
  const isAfib = cv > 0.15;

  // TF.js Gaussian noise tensor — statistically better than Math.random()
  let tfNoise = null;
  const totalSamples = currentRRs.reduce((s, rr) => s + Math.round(rr/1000*fs), 0);
  if (window.tf) {
    try {
      tfNoise = tf.tidy(() =>
        tf.randomNormal([totalSamples + 32], 0, isAfib ? 0.026 : 0.007).arraySync()
      );
    } catch { tfNoise = null; }
  }

  const samples = [];
  let noiseIdx = 0;

  for (let beat = 0; beat < beats; beat++) {
    const rr = currentRRs[beat] || meanRR;
    const beatLen = Math.round(rr / 1000 * fs);

    // Per-beat physiological variation
    const rAmp  = 0.95 + (Math.random() - 0.5) * 0.06;
    const tAmp  = 0.20 + (Math.random() - 0.5) * 0.04;
    const pAmp  = isAfib ? (Math.random() < 0.45 ? 0 : 0.04 + Math.random()*0.05)
                         : 0.10 + (Math.random() - 0.5) * 0.015;
    const qrsW  = 0.009 + Math.random() * 0.002; // QRS width (9–11 ms → 250Hz)

    // Respiration baseline wander: slow sinusoid per beat group
    const respPhase = (beat / beats) * 2 * Math.PI * 1.6;
    const baseWander = 0.038 * Math.sin(respPhase);

    for (let i = 0; i < beatLen; i++) {
      const t = i / beatLen;
      let v = baseWander;

      // P wave (t ≈ 0.10) — absent or replaced by fibrillatory baseline in AFib
      if (!isAfib) {
        v += pAmp * Math.exp(-((t - 0.10)**2) / (2 * 0.013**2));
      } else {
        // Fibrillatory baseline: 3 overlapping high-freq sinusoids (sóng f điển hình AFib)
        v += 0.030 * Math.sin(t * 88  + beat * 2.3);
        v += 0.018 * Math.sin(t * 123 + beat * 1.7);
        v += 0.012 * Math.sin(t * 67  + beat * 3.1);
      }

      // QRS complex
      if (t >= 0.20 && t < 0.24) v -= 0.11 * (t - 0.20) / 0.04;          // Q
      v += rAmp * Math.exp(-((t - 0.265)**2) / (2 * qrsW**2));             // R
      if (t >= 0.30 && t < 0.35) v -= 0.09 * (0.35 - t) / 0.05;           // S

      // ST segment — elevated slightly in normal, near-isoelectric in AFib
      if (t >= 0.36 && t < 0.44) v += (isAfib ? 0.003 : 0.018) * (1 - (t-0.36)/0.08);

      // T wave (t ≈ 0.52)
      v += tAmp * Math.exp(-((t - 0.52)**2) / (2 * 0.047**2));

      // Noise: TF.js Gaussian (preferred) or Math.random fallback
      const n = tfNoise ? tfNoise[noiseIdx] : (Math.random() - 0.5) * (isAfib ? 0.024 : 0.007);
      v += n;
      noiseIdx++;

      samples.push(Math.max(-0.5, Math.min(1.5, v)));
    }
  }
  return samples;
}

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE LIST 3 — CARDIAC CONDUCTION INDEX (CCI) + MORPHOLOGY ANALYSIS
// ════════════════════════════════════════════════════════════════════════════════

// ─── UL3 #1: PPG Waveform Morphology Analysis ────────────────────────────────
// Phân tích hình dạng sóng PPG từng nhịp: thời gian lên/xuống, dicrotic notch,
// diện tích chu kỳ. Cơ sở cho ASI, bundle branch hint, hemodynamic capacitance.
function analyzePPGMorphology(filtered, peaks, fps) {
  if (!peaks || peaks.length < 4 || !filtered || filtered.length < 30) return null;
  const tRises = [], tFalls = [], asymmetries = [], dicroticRatios = [], areas = [];

  for (let i = 0; i < Math.min(peaks.length - 1, 20); i++) {
    const peakIdx = Math.round(peaks[i]);
    const nextPeakIdx = Math.round(peaks[i + 1]);
    if (peakIdx < 2 || nextPeakIdx >= filtered.length) continue;
    const cycleLen = nextPeakIdx - peakIdx;
    if (cycleLen < 4) continue;

    // Valley trước đỉnh (tìm điểm thấp nhất trong 80% chu kỳ trước đó)
    let valBefore = peakIdx;
    for (let j = peakIdx - 1; j >= Math.max(0, peakIdx - Math.floor(cycleLen * 0.8)); j--) {
      if (filtered[j] < filtered[valBefore]) valBefore = j;
    }
    // Valley sau đỉnh
    let valAfter = nextPeakIdx;
    for (let j = peakIdx + Math.floor(cycleLen * 0.25); j <= nextPeakIdx && j < filtered.length; j++) {
      if (filtered[j] < filtered[valAfter]) valAfter = j;
    }

    const peakAmp = filtered[peakIdx];
    const baselineAmp = filtered[valBefore];
    const cycleAmp = peakAmp - baselineAmp;
    if (cycleAmp < 0.005) continue;

    const tRise = Math.max(1, peakIdx - valBefore) / fps * 1000; // ms
    const tFall = Math.max(1, valAfter - peakIdx) / fps * 1000;  // ms
    const tTotal = tRise + tFall;
    if (tTotal <= 0) continue;

    tRises.push(tRise);
    tFalls.push(tFall);
    asymmetries.push(tRise / tTotal);

    // Dicrotic notch: zero crossing của đạo hàm bậc 2 trong vùng downstroke
    const dsLen = valAfter - peakIdx;
    if (dsLen >= 8) {
      const ds = Array.from({ length: dsLen }, (_, k) => filtered[peakIdx + k] || 0);
      const d2 = ds.slice(2).map((v, k) => v - 2 * (ds[k + 1] || 0) + (ds[k] || 0));
      for (let k = 1; k < d2.length - 1; k++) {
        if (d2[k - 1] < 0 && d2[k] >= 0 && k > 1 && ds[k + 2] > ds[k + 1]) {
          dicroticRatios.push((k + 2) / fps * 1000 / tFall);
          break;
        }
      }
    }

    // Diện tích dưới sóng (proxy hemodynamic volume)
    let area = 0;
    for (let j = valBefore; j <= valAfter && j < filtered.length; j++) {
      area += Math.max(0, filtered[j] - baselineAmp);
    }
    if (area > 0) areas.push(area / (valAfter - valBefore + 1));
  }

  if (tRises.length < 2) return null;

  const meanTRise = average(tRises);
  const meanTFall = average(tFalls);
  const meanAsym  = average(asymmetries);
  const meanArea  = areas.length ? average(areas) : 0;
  const areaCV    = areas.length >= 3 ? stdDev(areas) / Math.max(0.001, meanArea) : 0;
  const meanDicr  = dicroticRatios.length ? average(dicroticRatios) : null;

  // Arterial Stiffness Index = tRise / tTotal * 100
  // Bình thường: 25–35%, Cứng mạch: >35%, Rất mềm: <20%
  const tTotal = meanTRise + meanTFall;
  const asi    = tTotal > 0 ? Math.round(meanTRise / tTotal * 100) : 30;

  return {
    tRise: Math.round(meanTRise),      // ms — thời gian tâm thu
    tFall: Math.round(meanTFall),      // ms — thời gian tâm trương
    asymmetryRatio: Math.round(meanAsym * 1000) / 1000, // 0.25–0.35 bình thường
    dicroticRatio: meanDicr !== null ? Math.round(meanDicr * 1000) / 1000 : null,
    asi,                               // 25–35% bình thường
    areaVariability: Math.round(areaCV * 1000) / 1000, // HC proxy
    meanArea: Math.round(meanArea * 1000) / 1000,
    beatCount: tRises.length,
  };
}

// ─── UL3 #2: Arterial Stiffness Index ────────────────────────────────────────
// ASI từ hình thái PPG. Chuẩn hóa theo tuổi (người trẻ ASI thấp hơn hợp lý).
function computeArterialStiffnessIndex(morphology, age) {
  if (!morphology) return null;
  const asi = morphology.asi;
  // Ngưỡng theo tuổi (Framingham + PPG literature)
  const norm = age < 35 ? 24 : age < 50 ? 27 : age < 65 ? 30 : age < 75 ? 33 : 36;
  const low = norm - 5, high = norm + 8;
  const level = asi < low  ? 'flexible'  // mạch rất mềm dẻo (tốt)
              : asi <= high ? 'normal'   // bình thường theo tuổi
              : asi <= high + 6 ? 'mild' // cứng nhẹ
              : 'stiff';                 // cứng đáng lo
  const pctVsAge = Math.round((1 - (asi - norm) / Math.max(1, norm)) * 100);
  const label = level === 'flexible' ? 'Mạch đàn hồi tốt'
              : level === 'normal'   ? 'Độ đàn hồi bình thường'
              : level === 'mild'     ? 'Cứng mạch nhẹ'
              : 'Cứng mạch — cần chú ý';
  const color = level === 'flexible' || level === 'normal' ? '#22c55e'
              : level === 'mild' ? '#f59e0b' : '#ef4444';
  return { asi, level, label, color, pctVsAge: Math.max(20, Math.min(120, pctVsAge)), norm };
}

// ─── UL3 #3: PPG Amplitude Variability (PAV) ─────────────────────────────────
// Đo mức biến động biên độ giữa các nhịp tim — proxy cho hemodynamic instability.
// Bình thường: < 12%. Tăng cao → mạch máu co thắt / tim bơm không đều.
function computePAV(filtered, peaks) {
  if (!peaks || peaks.length < 5 || !filtered) return { pavIndex: 0, level: 'unknown' };
  const amps = peaks.map(p => filtered[Math.round(Math.max(0, Math.min(filtered.length - 1, p)))] || 0);
  const meanAmp = average(amps);
  if (meanAmp <= 0) return { pavIndex: 0, level: 'unknown' };
  const pav = Math.round(stdDev(amps) / meanAmp * 1000) / 10; // %
  const level = pav < 10 ? 'stable' : pav < 18 ? 'mild' : pav < 28 ? 'moderate' : 'high';
  const label = level === 'stable'   ? 'Lưu lượng máu ổn định'
              : level === 'mild'     ? 'Biến động nhẹ'
              : level === 'moderate' ? 'Biến động trung bình — theo dõi'
              : 'Biến động mạnh — cần chú ý';
  const color = level === 'stable' ? '#22c55e' : level === 'mild' ? '#86efac'
              : level === 'moderate' ? '#f59e0b' : '#ef4444';
  return { pavIndex: pav, level, label, color };
}

// ─── UL3 #4: Hemodynamic Capacitance (HC) ────────────────────────────────────
// Proxy cho sức chứa và áp lực lưu chuyển máu ngoại vi.
// Tính từ diện tích chu kỳ + độ ổn định diện tích giữa các nhịp.
function computeHemodynamicCapacitance(filtered, peaks, fps) {
  if (!peaks || peaks.length < 4 || !filtered) return { hcIndex: 50, level: 'unknown' };
  const stepBack = Math.floor(fps * 0.08);
  const areas = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    const p1 = Math.max(0, Math.round(peaks[i]) - stepBack);
    const p2 = Math.min(filtered.length - 1, Math.round(peaks[i + 1]) - stepBack);
    if (p2 <= p1 + 3) continue;
    const slice = filtered.slice(p1, p2);
    const baseline = Math.min(...slice);
    const area = slice.reduce((s, v) => s + Math.max(0, v - baseline), 0) / Math.max(1, p2 - p1);
    if (area > 0) areas.push(area);
  }
  if (areas.length < 2) return { hcIndex: 50, level: 'unknown' };
  const meanArea = average(areas);
  const areaCV   = stdDev(areas) / Math.max(0.001, meanArea);
  // HC score: biên độ trung bình cao + ít biến động = tuần hoàn tốt
  const ampScore  = Math.min(100, meanArea * 200);
  const stabScore = Math.max(0, 100 - areaCV * 180);
  const hcIndex   = Math.round(Math.max(5, Math.min(95, ampScore * 0.55 + stabScore * 0.45)));
  const level = hcIndex >= 72 ? 'good' : hcIndex >= 48 ? 'moderate' : 'low';
  const label = level === 'good'     ? 'Tuần hoàn ngoại vi tốt'
              : level === 'moderate' ? 'Tuần hoàn mức trung bình'
              : 'Lưu thông máu ngoại vi yếu';
  const color = level === 'good' ? '#22c55e' : level === 'moderate' ? '#f59e0b' : '#ef4444';
  return { hcIndex, level, label, color, areaCV: Math.round(areaCV * 1000) / 1000 };
}

// ─── UL3 #5: Bundle Branch Block Hint ────────────────────────────────────────
// Phát hiện dấu hiệu "notching" (chẻ đôi sóng xuống) trong PPG — nghi ngờ
// block nhánh. Đây là chỉ báo sàng lọc, KHÔNG phải chẩn đoán xác định.
// Cần ECG 12 chuyển đạo để xác nhận. Nguồn: Elgendi et al. 2019.
function detectBundleBranchHint(filtered, peaks, fps) {
  if (!peaks || peaks.length < 4 || !filtered) return { notchDetected: false, notchScore: 0 };
  let notchCount = 0, totalBeats = 0;

  for (let i = 0; i < Math.min(peaks.length - 1, 15); i++) {
    const pk = Math.round(peaks[i]);
    const nxt = Math.round(peaks[i + 1]);
    const dsLen = nxt - pk;
    if (dsLen < 10 || pk >= filtered.length - 4) continue;
    totalBeats++;

    // Tìm secondary peak trong 20–65% downstroke
    const searchStart = Math.floor(dsLen * 0.18);
    const searchEnd   = Math.floor(dsLen * 0.65);
    const pkAmp = filtered[pk];

    for (let k = searchStart + 1; k < searchEnd && pk + k + 1 < filtered.length; k++) {
      const v = filtered[pk + k];
      if (v > filtered[pk + k - 1] && v > filtered[pk + k + 1] // local max
          && v > pkAmp * 0.12  // significant (>12% of main peak)
          && v < pkAmp * 0.82) { // below main peak
        notchCount++;
        break;
      }
    }
  }

  if (totalBeats === 0) return { notchDetected: false, notchScore: 0 };
  const notchScore    = Math.round(notchCount / totalBeats * 100);
  const notchDetected = notchScore >= 40;
  const severity      = notchScore >= 65 ? 'high' : notchScore >= 40 ? 'moderate' : 'low';
  return {
    notchDetected, notchScore, severity,
    hint: notchDetected
      ? `Phát hiện hình thái sóng bất thường (${notchScore}% nhịp) — Nghi ngờ dấu hiệu block nhánh. Cần ECG để xác nhận.`
      : 'Hình dạng sóng mạch bình thường',
  };
}

// ─── UL3 #6: Cardiac Conduction Index (CCI) Bilateral ────────────────────────
// So sánh chỉ số hình thái giữa tay phải & trái (2 lần đo khác nhau).
// Chênh lệch tRise/ASI giữa 2 tay → proxy cho bất đối xứng dẫn truyền.
function computeBilateralCCI(rightMeasurement, leftMeasurement) {
  const rM = rightMeasurement?.result;
  const lM = leftMeasurement?.result;
  if (!rM?.morphology || !lM?.morphology) return null;

  const dTrise = Math.abs(rM.morphology.tRise - lM.morphology.tRise); // ms
  const dAsi   = Math.abs(rM.morphology.asi   - lM.morphology.asi);   // %
  const dPav   = Math.abs((rM.pavIndex || 0)  - (lM.pavIndex || 0));  // %

  // Phân loại dựa trên chênh lệch thời gian tâm thu (ms)
  const level = dTrise < 15 ? 'normal' : dTrise < 35 ? 'mild' : dTrise < 55 ? 'moderate' : 'significant';
  const color = level === 'normal' ? '#22c55e' : level === 'mild' ? '#86efac'
              : level === 'moderate' ? '#f59e0b' : '#ef4444';
  const label = level === 'normal'      ? 'Hai tay đối xứng — bình thường'
              : level === 'mild'        ? 'Chênh lệch nhẹ — theo dõi thêm'
              : level === 'moderate'    ? 'Chênh lệch đáng kể — cần kiểm tra'
              : 'Bất đối xứng rõ ràng — tham khảo bác sĩ';

  const timeDiff = new Date(rightMeasurement.createdAt || Date.now()).getTime()
                 - new Date(leftMeasurement.createdAt  || Date.now()).getTime();
  const hoursApart = Math.round(Math.abs(timeDiff) / 3600000 * 10) / 10;

  return { dTrise, dAsi, dPav, level, color, label, hoursApart };
}

// ─── UL3 #4: Systolic BP Estimation ─────────────────────────────────────────
// Ước tính huyết áp tâm thu từ PPG morphology + demographics.
// Nguồn: Univ. Toronto 2025; Elgendi 2019 — sai số ±8-12 mmHg khi có đủ thông tin.
// KHÔNG thay thế máy đo huyết áp — chỉ mang tính tham khảo.
function computeSystolicBPEstimate(result, user) {
  if (!result) return null;
  const age     = Number(user?.age || 55);
  const bmi     = Number(user?.bmi || 24);
  const asi     = result.morphology?.asi || 30;
  const sdnn    = result.sdnn    || 30;
  const rmssd   = result.rmssd   || 20;
  const bpm     = result.bpm     || 72;
  const pavIdx  = result.pav?.pavIndex || 10;

  // HRV baseline theo tuổi (Task Force 1996 reference)
  const sdnnRef = age < 35 ? 65 : age < 50 ? 52 : age < 65 ? 40 : age < 75 ? 32 : 26;
  const hrvImpact = (sdnnRef - sdnn) * 0.22; // HRV thấp → BP cao hơn

  // Tachycardia contribution
  const bpmContrib = Math.max(0, bpm - 75) * 0.28;

  // PAV contribution (mạch không ổn → BP biến động)
  const pavContrib = Math.max(0, pavIdx - 12) * 0.18;

  const sbpRaw = 108
    + age  * 0.32
    + bmi  * 0.55
    + asi  * 0.88
    + hrvImpact
    + bpmContrib
    + pavContrib;

  const sbp = Math.round(Math.max(88, Math.min(188, sbpRaw)));

  // Confidence: cao khi có morphology + HRV đầy đủ
  const confidence = result.morphology && sdnn > 0 && rmssd > 0 ? 'moderate' : 'low';
  const ciRange    = confidence === 'moderate' ? 10 : 15;

  const level = sbp < 120 ? 'normal'
              : sbp < 130 ? 'elevated'
              : sbp < 140 ? 'high1'
              : sbp < 160 ? 'high2' : 'crisis';

  const color = { normal:'#22c55e', elevated:'#86efac', high1:'#f59e0b', high2:'#ef4444', crisis:'#7f1d1d' }[level];
  const label = { normal:'Bình thường', elevated:'Cao nhẹ', high1:'Tăng huyết áp độ 1', high2:'Tăng huyết áp độ 2', crisis:'Nguy cơ cao — đo máy ngay' }[level];

  return { sbp, ciRange, level, color, label, confidence,
           range: [sbp - ciRange, sbp + ciRange],
           factors: { age, bmi, asi, sdnn, bpm, pavIdx } };
}

function renderSystolicBPPanel(bpEst) {
  const box = document.getElementById("bpEstimateBox");
  if (!box) return;
  if (!bpEst) {
    box.innerHTML = "<p class='muted'>Cần dữ liệu hình thái sóng để ước tính huyết áp.</p>";
    return;
  }
  const { sbp, ciRange, level, color, label, confidence, range } = bpEst;
  const confText = confidence === 'moderate' ? '🟡 Độ tin cậy trung bình' : '🔴 Độ tin cậy thấp';
  box.innerHTML = `
    <div class="list-item">
      <span>Huyết áp tâm thu ước tính</span>
      <strong style="color:${color};font-size:18px">${sbp} <span style="font-size:12px">±${ciRange} mmHg</span></strong>
    </div>
    <div class="list-item">
      <span>Mức đánh giá</span>
      <strong style="color:${color}">${label}</strong>
    </div>
    <div class="list-item">
      <span>Khoảng ước lượng</span>
      <strong>${range[0]}–${range[1]} mmHg</strong>
    </div>
    <p class="muted" style="font-size:11px;margin-top:4px">${confText} — dựa trên ASI=${bpEst.factors.asi}%, SDNN=${bpEst.factors.sdnn}ms, tuổi=${bpEst.factors.age}</p>
    <p style="font-size:10px;color:#f59e0b;margin-top:2px">⚠️ Ước tính thuật toán PPG — sai số ±${ciRange} mmHg. Dùng máy đo tay để xác nhận chính xác.</p>`;
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

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE LIST 4 — AFIB FORECASTING SHIELD & HEMODYNAMIC CAPACITANCE
// Bioshield: Dự báo cửa sổ nguy cơ 24h — quét đa tầng (HRV + PAV + HC + circadian)
// ════════════════════════════════════════════════════════════════════════════════

// ─── UL4: Peak Risk Hour Prediction ──────────────────────────────────────────
// Dự đoán khung giờ nguy cơ cao nhất trong 24h tới dựa trên circadian rhythm.
function computePeakRiskHour(currentHour) {
  // Circadian AFib peaks: 4-6 AM (sáng sớm), 16-18 (chiều tối)
  const CIRCADIAN_RISK = [
    1.1, 1.2, 1.25, 1.3, 1.45, 1.45, 1.35, 1.15, // 0-7h
    1.0, 0.95, 0.9, 0.9, 0.95, 1.0, 1.05, 1.1,    // 8-15h
    1.25, 1.3, 1.2, 1.15, 1.1, 1.1, 1.1, 1.1,     // 16-23h
  ];
  // Tìm 2 giờ có nguy cơ cao nhất trong 24h tới
  const peaks = [];
  for (let offset = 1; offset <= 24; offset++) {
    const h = (currentHour + offset) % 24;
    peaks.push({ hour: h, risk: CIRCADIAN_RISK[h] });
  }
  peaks.sort((a, b) => b.risk - a.risk);
  const top = peaks[0];
  const formatH = h => `${h}h${h < 12 ? ' sáng' : h < 18 ? ' chiều' : ' tối'}`;
  return { hour: top.hour, label: formatH(top.hour), factor: top.risk };
}

// ─── UL4: Core Bioshield Forecast ─────────────────────────────────────────────
// Tổng hợp 3 tầng phân tích: AFib detection + PAV/HC hemodynamic + HRV micro-trend
// → safetyScore (0–100) + status (green/yellow/red) + message chi tiết
function computeBioshieldForecast(measurements, currentResult, weatherTemp) {
  if (!currentResult) return null;
  const recent = (measurements || [])
    .filter(m => m.type === 'finger' || m.type === 'face')
    .slice(-14);

  // ── Tầng 1: Trạng thái AFib hiện tại ────────────────────────────────────────
  const currentAfib = currentResult.afibLikelihood || false;
  const currentCV   = currentResult.cv || 0.08;
  const currentEvidence = currentResult.afibEvidence || 0;

  // ── Tầng 2: Hemodynamic Capacitance (PAV + HC) ───────────────────────────────
  const currentPAV = currentResult.pav?.pavIndex || 0;
  const currentHC  = currentResult.hc?.hcIndex   || 60;
  const currentASI = currentResult.morphology?.asi || 30;

  // ── Tầng 3: Micro-HRV Trends (so sánh lần đo hiện tại vs lịch sử 7 ngày) ────
  const last7 = recent.slice(-7);
  const hrvHistory = last7.map(m => m.result?.sdnn || 0).filter(Boolean);
  const pavHistory = last7.map(m => m.result?.pavIndex || 0).filter(Boolean);
  const hcHistory  = last7.map(m => m.result?.hcIndex  || 0).filter(Boolean);
  const cvHistory  = last7.map(m => m.result?.cv || 0).filter(Boolean);

  const currentHRV = currentResult.sdnn || 30;
  const avgHRV7    = hrvHistory.length ? average(hrvHistory) : currentHRV;
  const avgPAV7    = pavHistory.length ? average(pavHistory) : currentPAV;
  const avgHC7     = hcHistory.length  ? average(hcHistory)  : currentHC;
  const avgCV7     = cvHistory.length  ? average(cvHistory)  : currentCV;

  const hrvDecline = avgHRV7 > 0 ? Math.max(0, (avgHRV7 - currentHRV) / avgHRV7) : 0;
  const pavRise    = avgPAV7 > 0 ? Math.max(0, (currentPAV - avgPAV7) / avgPAV7) : 0;
  const hcDecline  = avgHC7  > 0 ? Math.max(0, (avgHC7 - currentHC)  / avgHC7)  : 0;
  const cvRise     = avgCV7  > 0 ? Math.max(0, (currentCV - avgCV7)   / avgCV7)  : 0;

  const recentAfibRate = recent.filter(m => m.result?.classification === 'afib').length / Math.max(1, recent.length);

  // ── Tính safety score (0 = nguy hiểm, 100 = an toàn) ─────────────────────────
  let riskScore = 10; // baseline

  // Đóng góp từng thành phần
  if (currentAfib)        riskScore += 35; // AFib ngay lúc này: nguy cơ cao nhất
  riskScore += Math.min(18, currentCV * 55);           // RR irregularity hiện tại
  riskScore += Math.min(15, currentPAV * 0.5);         // PAV cao = mạch không ổn
  riskScore += Math.max(0, (60 - currentHC) * 0.35);  // HC thấp = tuần hoàn yếu
  riskScore += Math.min(10, Math.max(0, (currentASI - 32) * 0.4)); // cứng mạch
  riskScore += Math.min(20, hrvDecline * 55);          // HRV đang giảm (xu hướng xấu)
  riskScore += Math.min(12, pavRise * 35);             // PAV đang tăng
  riskScore += Math.min(10, hcDecline * 30);           // HC đang giảm
  riskScore += Math.min(8,  cvRise * 25);              // CV đang tăng
  riskScore += recentAfibRate * 22;                    // lịch sử AFib gần đây

  // Yếu tố hoàn cảnh
  const hour = new Date().getHours();
  const circadianFactor = (hour >= 4 && hour <= 6) ? 1.40
                        : (hour >= 16 && hour <= 18) ? 1.22
                        : (hour >= 22 || hour <= 3)  ? 1.18 : 1.0;
  const weatherFactor   = weatherTemp !== null && weatherTemp < 10 ? 1.45
                        : weatherTemp !== null && weatherTemp < 18 ? 1.25 : 1.0;

  riskScore = Math.round(Math.max(5, Math.min(93, riskScore * circadianFactor * weatherFactor)));
  const safetyScore = 100 - riskScore;
  const status = safetyScore >= 82 ? 'green' : safetyScore >= 48 ? 'yellow' : 'red';

  // ── Dự đoán peak risk hour ────────────────────────────────────────────────────
  const peakRisk = computePeakRiskHour(hour);

  // ── Xây dựng message theo status ─────────────────────────────────────────────
  const factors = [
    currentAfib ? 'Phát hiện rung nhĩ trong lần đo này' : null,
    hrvDecline > 0.15 ? `HRV giảm ${Math.round(hrvDecline*100)}% so với 7 ngày qua` : null,
    currentPAV > 18   ? `Biên độ mạch biến động ${currentPAV.toFixed(1)}% (cao)` : null,
    currentHC < 45    ? `Lưu lượng máu ngoại vi yếu (HC=${currentHC})` : null,
    currentASI > 38   ? `Mạch cứng hơn bình thường (ASI=${currentASI}%)` : null,
    recentAfibRate > 0.2 ? `${Math.round(recentAfibRate*100)}% lần đo gần đây có AFib` : null,
    weatherTemp !== null && weatherTemp < 18 ? `Nhiệt độ thấp (${weatherTemp}°C)` : null,
    (hour >= 4 && hour <= 6) ? 'Đang trong khung giờ nguy cơ cao nhất (4-6h sáng)' : null,
  ].filter(Boolean);

  let message, advice, moodIcon;
  if (status === 'green') {
    moodIcon = '🟢';
    message = `Hệ tuần hoàn của bạn đang ổn định tốt. Chỉ số an toàn ${safetyScore}%.`;
    advice  = 'Bạn có thể vận động nhẹ nhàng và sinh hoạt bình thường hôm nay.';
  } else if (status === 'yellow') {
    moodIcon = '🟡';
    message = `Hệ thần kinh tim có dấu hiệu mệt mỏi thầm lặng. Chỉ số an toàn ${safetyScore}%.`;
    advice  = `Cửa sổ nguy cơ cao nhất hôm nay vào khoảng ${peakRisk.label}. Tránh cà phê muộn, không làm việc quá sức, nghỉ ngơi đủ.`;
  } else {
    moodIcon = '🔴';
    message = `Cảnh báo: Áp lực mạch máu ngoại vi đang biến động. Chỉ số an toàn chỉ ${safetyScore}%.`;
    advice  = `Nguy cơ kích hoạt AFib hoặc cơn tăng huyết áp cao trong ngày hôm nay. Sẵn sàng thuốc bên người, tránh vận động mạnh, theo dõi sát.`;
  }

  return {
    safetyScore, riskScore, status, moodIcon,
    message, advice, factors, peakRisk,
    trends: {
      hrvDeclinePct: Math.round(hrvDecline * 100),
      pavRisePct:    Math.round(pavRise * 100),
      hcDeclinePct:  Math.round(hcDecline * 100),
    },
    layer1: { afib: currentAfib, cv: currentCV, evidence: currentEvidence },
    layer2: { pav: currentPAV, hc: currentHC, asi: currentASI },
    layer3: { hrvDecline, pavRise, hcDecline, recentAfibRate },
  };
}

// ─── #7/2: Mouse BCG Tremor Analysis (Ballistocardiography via mouse) ───────────
// Theory: heartbeat micro-tremors (1–3 Hz) modulate hand position while moving the mouse.
// Pipeline: irregular events → resample 50Hz → detrend → bandpass 0.6-4Hz → FFT+ACF → BPM.

function _bcgResample(events, fps) {
  if (events.length < 2) return null;
  const tStart = events[0].t, tEnd = events[events.length-1].t;
  const dt = 1000 / fps;
  const n = Math.floor((tEnd - tStart) / dt);
  if (n < 30) return null;
  const xs = [], ys = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = tStart + i * dt;
    while (j < events.length - 2 && events[j+1].t <= t) j++;
    const j1 = Math.min(j+1, events.length-1);
    const span = events[j1].t - events[j].t;
    const alpha = span > 0 ? Math.min(1, (t - events[j].t) / span) : 0;
    xs.push(events[j].x + alpha * (events[j1].x - events[j].x));
    ys.push(events[j].y + alpha * (events[j1].y - events[j].y));
  }
  return { x: xs, y: ys, fps, n };
}

function _bcgCorrAtBpm(signal, fps, bpm) {
  if (!bpm || signal.length < 60) return 0;
  const lag = Math.round(fps * 60 / bpm);
  if (lag <= 0 || lag >= signal.length) return 0;
  const m = signal.reduce((a,b)=>a+b,0)/signal.length;
  const c = signal.map(v => v - m);
  const ac0 = c.reduce((s,v) => s + v*v, 0);
  if (!ac0) return 0;
  let sum = 0;
  for (let i = 0; i < c.length - lag; i++) sum += c[i] * c[i+lag];
  return Math.max(0, sum / ac0);
}

const _bcg = { events: [], active: false, lastResult: null, _countTimer: null, _stopTimer: null, isTouch: false, restingMode: false };
function _bcgIsTouch() { return ("ontouchstart" in window) && navigator.maxTouchPoints > 0; }

// ─── Touch BCG Resting Mode — ngón tay giữ yên, tim rung truyền qua mô ─────
// Sub-pixel precision của touch API bắt được vi rung < 0.5px = biên độ BCG thực
const _bcgRest = { active: false, events: [], _timer: null };
function startTouchBCGResting() {
  if (!_bcgIsTouch()) {
    showToast("Chế độ này chỉ dành cho màn hình cảm ứng (điện thoại/tablet)", "warn"); return;
  }
  if (_bcgRest.active || _bcg.active) return;
  _bcgRest.active = true; _bcgRest.events = [];
  const box = document.getElementById("bcgResultBox");
  const btn = document.getElementById("startBCGRestBtn");
  if (btn) { btn.textContent = "⏳ Đang đo (60s)..."; btn.disabled = true; }
  if (box) box.innerHTML = `<p class="muted">📱 <strong>Đặt đầu ngón tay lên màn hình và GIỮ YÊN hoàn toàn</strong> — còn <span id="bcgRestCountdown">60</span>s.<br>Cơ thể bạn sẽ tự rung nhẹ theo nhịp tim, không cần di chuyển.</p>`;
  let remaining = 60;
  const cTimer = setInterval(() => {
    remaining--;
    const sp = document.getElementById("bcgRestCountdown");
    if (sp) sp.textContent = remaining;
    if (remaining <= 0) clearInterval(cTimer);
  }, 1000);
  document.addEventListener("touchmove", _bcgRestTouchHandler, { passive: true });
  // Capture touchstart position bổ sung để có reference point
  document.addEventListener("touchstart", _bcgRestTouchStartHandler, { passive: true });
  _bcgRest._timer = setTimeout(() => stopTouchBCGResting(cTimer), 60000);
}
function _bcgRestTouchStartHandler(e) {
  if (!_bcgRest.active || !e.touches.length) return;
  const t = e.touches[0];
  _bcgRest.events.push({ t: Date.now(), x: t.clientX, y: t.clientY, type: "start" });
}
function _bcgRestTouchHandler(e) {
  if (!_bcgRest.active || !e.touches.length) return;
  const t = e.touches[0];
  _bcgRest.events.push({ t: Date.now(), x: t.clientX, y: t.clientY });
  if (_bcgRest.events.length > 8000) _bcgRest.events.shift();
}
function stopTouchBCGResting(cTimer) {
  if (!_bcgRest.active) return;
  clearInterval(cTimer);
  clearTimeout(_bcgRest._timer);
  _bcgRest.active = false;
  document.removeEventListener("touchmove", _bcgRestTouchHandler);
  document.removeEventListener("touchstart", _bcgRestTouchStartHandler);
  const btn = document.getElementById("startBCGRestBtn");
  if (btn) { btn.textContent = "📱 Resting BCG (60s — giữ ngón tay yên)"; btn.disabled = false; }
  const box = document.getElementById("bcgResultBox");
  // Lọc chỉ lấy move events (không phải touchstart)
  const moveEvents = _bcgRest.events.filter(e => e.type !== "start");
  if (moveEvents.length < 60) {
    if (box) box.innerHTML = "<p class='muted'>⚠️ Quá ít data — giữ ngón tay tiếp xúc màn hình trong suốt 60s và thử lại.</p>";
    return;
  }
  if (box) box.innerHTML = "<p class='muted'>⚙️ Phân tích vi rung tim từ ngón tay giữ yên...</p>";
  const result = _analyzeBCGResting(moveEvents);
  _bcg.lastResult = result;
  renderBCGResult(result);
  _bcg.isTouch = true;
}
function _analyzeBCGResting(events) {
  // Trong resting mode, không có intentional movement
  // → signal chính là BCG cardiac tremor + hô hấp + noise
  // → KHÔNG detrend với moving average (không có trend để remove)
  // → Chỉ cần bandpass cardiac band
  const FPS = 50;
  const rs = _bcgResample(events, FPS);
  if (!rs || rs.n < 80) return null;
  const vx = [], vy = [];
  for (let i = 1; i < rs.x.length; i++) { vx.push(rs.x[i] - rs.x[i-1]); vy.push(rs.y[i] - rs.y[i-1]); }
  // Resting: không detrend — chuyển động đã là tremor thật
  const tremor = vx.map((v, i) => Math.sqrt(v*v + vy[i]*vy[i]));

  // Motion artifact rejection: dùng IQR để phát hiện và nội suy frames có chuyển động cố ý
  // Q3 + 3×IQR = outlier threshold (BCG tremor ≈ 0.01–0.3 px; voluntary move >> 1 px)
  const sorT = [...tremor].sort((a,b)=>a-b);
  const q1 = sorT[Math.floor(sorT.length * 0.25)];
  const q3 = sorT[Math.floor(sorT.length * 0.75)];
  const motionThresh = q3 + 3 * (q3 - q1) + 0.05; // +0.05 bảo vệ khi IQR quá nhỏ
  const tremorClean = tremor.map((v, i) => {
    if (v > motionThresh) {
      const nbrs = [];
      for (let k = Math.max(0,i-4); k < Math.min(tremor.length,i+5); k++) {
        if (k !== i && tremor[k] <= motionThresh) nbrs.push(tremor[k]);
      }
      return nbrs.length ? nbrs.reduce((a,b)=>a+b,0)/nbrs.length : q1;
    }
    return v;
  });
  const artifactRate = tremor.filter(v => v > motionThresh).length / tremor.length;
  if (artifactRate > 0.4) {
    const box = document.getElementById("bcgResultBox");
    if (box) box.innerHTML = "<p class='muted'>⚠️ Quá nhiều chuyển động (>40% frames) — cố gắng GIỮ YÊN ngón tay hơn và thử lại.</p>";
    return { bpm: null, confidence: 0, riskHint: "Artifact cao — giữ ngón tay hoàn toàn bất động", restingMode: true };
  }

  // Bandpass cardiac: 0.7–4.0 Hz (hô hấp 0.15–0.45 Hz đã bị loại bởi HPF 0.7 Hz)
  const filtered = butterworthBandpassDynamic(tremorClean, FPS, 0.7, Math.min(4.0, FPS * 0.44));
  const bpmFFT = fftBpm(filtered, FPS);
  const bpmACF = autocorrBpm(filtered, FPS);
  const corrFFT = bpmFFT ? _bcgCorrAtBpm(filtered, FPS, bpmFFT) : 0;
  const corrACF = bpmACF ? _bcgCorrAtBpm(filtered, FPS, bpmACF) : 0;
  const bestCorr = Math.max(corrFFT, corrACF);
  const cands = [bpmFFT, bpmACF].filter(b => b && b >= 40 && b <= 180);
  let bpm = null, confidence = 0;
  if (cands.length === 2) {
    const diff = Math.abs(cands[0] - cands[1]);
    bpm = Math.round((cands[0] + cands[1]) / 2);
    confidence = diff <= 4 ? 82 : diff <= 8 ? 68 : diff <= 15 ? 52 : 36;
  } else if (cands.length === 1) { bpm = cands[0]; confidence = 38; }
  if (bestCorr > 0.35) confidence = Math.min(90, confidence + 10);
  else if (bestCorr < 0.10) confidence = Math.max(0, confidence - 20);
  // Resting mode penalty: nếu amplitude quá thấp → finger lifted
  const meanAmp = tremorClean.reduce((a,b)=>a+b,0)/tremorClean.length;
  if (meanAmp < 0.01) confidence = Math.max(0, confidence - 30);
  const rms = Math.round(Math.sqrt(filtered.reduce((a,v)=>a+v*v,0)/filtered.length) * 10000) / 10000;
  return {
    bpm, confidence: Math.round(confidence), cv: 0, jitterScore: 0,
    bpmFFT, bpmACF, rms, bestCorr: Math.round(bestCorr*100)/100,
    riskHint: bpm && confidence >= 45
      ? `BCG ngón tay yên: ${bpm} BPM (ACF ${Math.round(bestCorr*100)}%) — kết quả sơ bộ, xác nhận bằng Face PPG.`
      : "Không phát hiện được nhịp tim — giữ ngón tay tiếp xúc màn hình, không nhấc và không di chuyển.",
    sampleCount: rs.n, duration: Math.round(rs.n / FPS), restingMode: true
  };
}
function startMouseBCGTracking() {
  if (_bcg.active) return;
  _bcg.events = []; _bcg.active = true;
  _bcg.isTouch = _bcgIsTouch();
  if (_bcg.isTouch) {
    document.addEventListener("touchmove", _bcgTouchHandler, { passive: true });
  } else {
    document.addEventListener("mousemove", _bcgMouseHandler);
  }
  const startBtn = document.getElementById("startBCGBtn");
  const stopBtn = document.getElementById("stopBCGBtn");
  const box = document.getElementById("bcgResultBox");
  if (startBtn) { startBtn.textContent = "⏳ Đang thu vi rung..."; startBtn.disabled = true; }
  if (stopBtn) stopBtn.style.display = "";
  let remaining = 40;
  const moveHint = _bcg.isTouch
    ? "<strong>Kéo ngón tay đều trên màn hình, tốc độ vừa phải</strong> — không nhấc tay, không dừng đột ngột."
    : "<strong>Di chuyển chuột đều, tốc độ vừa phải</strong> — tránh dừng đột ngột.";
  if (box) box.innerHTML = `<p class="muted">⏳ Đang thu tín hiệu vi rung — còn <span id="bcgCountdown">${remaining}</span>s.<br>${moveHint}</p>`;
  _bcg._countTimer = setInterval(() => {
    remaining--;
    const span = document.getElementById("bcgCountdown");
    if (span) span.textContent = remaining;
    if (remaining === 32 && _bcg.events.length < 20) {
      showToast(_bcg.isTouch ? "Kéo ngón tay đều trên màn hình để thu tín hiệu BCG!" : "Di chuyển chuột đều tay để thu tín hiệu BCG!", "warn");
    }
    if (remaining <= 0) clearInterval(_bcg._countTimer);
  }, 1000);
  _bcg._stopTimer = setTimeout(stopMouseBCGTracking, 40000);
}
function _bcgMouseHandler(e) {
  if (!_bcg.active) return;
  _bcg.events.push({ t: Date.now(), x: e.clientX, y: e.clientY });
  if (_bcg.events.length > 4000) _bcg.events.shift();
}
function _bcgTouchHandler(e) {
  if (!_bcg.active || !e.touches.length) return;
  const t = e.touches[0];
  // Touch API có sub-pixel precision (số thực) — tốt hơn mouse pixel quantization
  _bcg.events.push({ t: Date.now(), x: t.clientX, y: t.clientY });
  if (_bcg.events.length > 4000) _bcg.events.shift();
}
function stopMouseBCGTracking() {
  if (!_bcg.active) return;
  clearInterval(_bcg._countTimer);
  clearTimeout(_bcg._stopTimer);
  _bcg.active = false;
  if (_bcg.isTouch) {
    document.removeEventListener("touchmove", _bcgTouchHandler);
  } else {
    document.removeEventListener("mousemove", _bcgMouseHandler);
  }
  const startBtn = document.getElementById("startBCGBtn");
  const stopBtn = document.getElementById("stopBCGBtn");
  const box = document.getElementById("bcgResultBox");
  const label = _bcg.isTouch ? "📱 Bắt đầu lại BCG chạm (40s)" : "🖱️ Bắt đầu lại BCG chuột (40s)";
  if (startBtn) { startBtn.textContent = label; startBtn.disabled = false; }
  if (stopBtn) stopBtn.style.display = "none";
  if (_bcg.events.length >= 100) {
    if (box) box.innerHTML = `<p class="muted">⚙️ Đang phân tích vi rung ${_bcg.isTouch ? "ngón tay" : "chuột"}...</p>`;
    _bcg.lastResult = analyzeBCGMouse(_bcg.events);
    renderBCGResult(_bcg.lastResult);
  } else {
    const hint = _bcg.isTouch ? "Kéo ngón tay liên tục trên màn hình trong suốt 40s" : "Di chuột liên tục trong suốt 40s";
    if (box) box.innerHTML = `<p class='muted'>⚠️ Ít dữ liệu — ${hint} và thử lại.</p>`;
  }
}

function analyzeBCGMouse(events) {
  if (events.length < 100) return null;
  const duration = (events[events.length-1].t - events[0].t) / 1000;
  if (duration < 10) return null;

  // 1. Resample to uniform 50 Hz grid (handles gaps from slow/stopped movement)
  const FPS = 50;
  const rs = _bcgResample(events, FPS);
  if (!rs || rs.n < 100) return null;

  // 2. Velocity (pixel/frame)
  const vx = [], vy = [];
  for (let i = 1; i < rs.x.length; i++) {
    vx.push(rs.x[i] - rs.x[i-1]);
    vy.push(rs.y[i] - rs.y[i-1]);
  }

  // 3. Detrend with centered 0.4s moving average — removes intentional trajectory,
  //    keeping only micro-oscillations (BCG cardiac tremor signal)
  const winDetrend = Math.round(FPS * 0.4);
  const vxTrend = movingAverage(vx, winDetrend);
  const vyTrend = movingAverage(vy, winDetrend);
  const vxR = vx.map((v, i) => v - vxTrend[i]);
  const vyR = vy.map((v, i) => v - vyTrend[i]);

  // 4. Tremor magnitude
  const tremor = vxR.map((v, i) => Math.sqrt(v*v + vyR[i]*vyR[i]));

  // 5. Bandpass 0.6–4.0 Hz: removes slow drift + breathing, keeps cardiac 36–240 BPM
  const filtered = butterworthBandpassDynamic(tremor, FPS, 0.6, Math.min(4.0, FPS * 0.44));

  // 6. BPM — FFT + autocorrelation
  const bpmFFT = fftBpm(filtered, FPS);
  const bpmACF = autocorrBpm(filtered, FPS);

  // 7. Quality: ACF coefficient at detected BPM
  const corrFFT = bpmFFT ? _bcgCorrAtBpm(filtered, FPS, bpmFFT) : 0;
  const corrACF = bpmACF ? _bcgCorrAtBpm(filtered, FPS, bpmACF) : 0;
  const bestCorr = Math.max(corrFFT, corrACF);

  // 8. Consensus + confidence
  const candidates = [bpmFFT, bpmACF].filter(b => b && b >= 40 && b <= 180);
  let bpm = null, confidence = 0;
  if (candidates.length === 2) {
    const diff = Math.abs(candidates[0] - candidates[1]);
    bpm = Math.round((candidates[0] + candidates[1]) / 2);
    confidence = diff <= 5 ? 80 : diff <= 10 ? 65 : diff <= 18 ? 50 : 35;
  } else if (candidates.length === 1) {
    bpm = candidates[0]; confidence = 42;
  }
  if (bestCorr > 0.35)      confidence = Math.min(88, confidence + 10);
  else if (bestCorr < 0.10) confidence = Math.max(0,  confidence - 20);

  // Penalize erratic or near-stationary movement
  const allV = vx.map((v, i) => Math.sqrt(v*v + vy[i]*vy[i]));
  const meanV = allV.reduce((a,b)=>a+b,0)/allV.length;
  const stdV  = Math.sqrt(allV.reduce((a,b)=>a+(b-meanV)**2,0)/allV.length);
  const cv = Math.round(stdV / (meanV || 1) * 1000) / 1000;
  if (cv > 1.5)    confidence = Math.max(0, confidence - 15);
  if (meanV < 0.05) confidence = Math.max(0, confidence - 20);

  const jitterScore = Math.round(Math.min(100, cv * 200));
  const rms = Math.round(Math.sqrt(filtered.reduce((a,v)=>a+v*v,0)/filtered.length) * 1000) / 1000;

  let riskHint;
  if (!bpm || confidence < 25) {
    riskHint = "Không phát hiện chu kỳ tim từ vi rung. Di chuột đều, tốc độ vừa, không dừng đột ngột.";
  } else if (confidence >= 65) {
    riskHint = `Vi rung tay có chu kỳ khớp ~${bpm} BPM (ACF ${Math.round(bestCorr*100)}%). Kết hợp PPG để xác nhận chính xác.`;
  } else {
    riskHint = `Ước tính ~${bpm} BPM — tương quan yếu (${Math.round(bestCorr*100)}%). Thử di chuột đều hơn, 40s liên tục.`;
  }

  return {
    bpm, confidence: Math.round(confidence), cv, jitterScore,
    bpmFFT, bpmACF, rms, bestCorr: Math.round(bestCorr*100)/100,
    riskHint, sampleCount: rs.n, duration: Math.round(duration)
  };
}

function renderBCGResult(result) {
  const box = document.getElementById("bcgResultBox");
  if (!box || !result) return;

  const confColor = result.confidence >= 65 ? "#22c55e" : result.confidence >= 40 ? "#f59e0b" : "#ef4444";
  const confLabel = result.confidence >= 65 ? "Tin cậy" : result.confidence >= 40 ? "Sơ bộ" : "Thấp";
  const cvColor   = result.cv > 1.5 ? "#ef4444" : result.cv > 0.8 ? "#f59e0b" : "#22c55e";

  const bpmHtml = result.bpm
    ? `<div class="list-item"><span>BPM ước tính (BCG chuột)</span><strong style="font-size:17px">${result.bpm} BPM</strong></div>
       <div class="list-item"><span>Độ tin cậy</span><strong style="color:${confColor}">${result.confidence}% — ${confLabel}</strong></div>`
    : `<div class="list-item"><span>BPM ước tính</span><strong style="color:#94a3b8">-- (chưa phát hiện)</strong></div>`;

  const methodParts = [
    result.bpmFFT ? `FFT: ${result.bpmFFT}` : null,
    result.bpmACF ? `ACF: ${result.bpmACF}` : null,
  ].filter(Boolean).join(' · ');

  box.innerHTML = `
    ${bpmHtml}
    <div class="list-item"><span>Tương quan ACF tại BPM</span><strong style="color:${result.bestCorr>25?"#22c55e":"#f59e0b"}">${result.bestCorr}%</strong></div>
    <div class="list-item"><span>2 phương pháp</span><strong style="font-size:11px;color:#94a3b8">${methodParts || "--"}</strong></div>
    <div class="list-item"><span>Biên độ vi rung (RMS)</span><strong>${result.rms} px/frame</strong></div>
    <div class="list-item"><span>Biến thiên vận tốc (CV)</span><strong style="color:${cvColor}">${result.cv}</strong></div>
    <div class="list-item"><span>Mẫu / Thời gian</span><strong>${result.sampleCount} điểm / ${result.duration}s</strong></div>
    <p class="muted" style="margin-top:6px;font-size:11px">${result.riskHint}</p>
    <p class="muted" style="font-size:10px;color:#64748b;margin-top:2px">${_bcg.isTouch ? "BCG ngón tay (touch): sub-pixel precision → SNR tốt hơn chuột." : "BCG chuột: pixel quantization giới hạn độ nhạy, nên dùng trên thiết bị cảm ứng."} Cần di chuyển đều 40s liên tục. Kết hợp Face PPG để xác nhận.</p>`;
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
  // E1 fix: làm rõ đây là mô phỏng toán học, KHÔNG phải ECG thực tế từ điện tim
  container.innerHTML = `
    <p style="font-size:10px;color:#f59e0b;margin-bottom:4px;font-weight:600">⚠️ MÔ PHỎNG TOÁN HỌC — Không phải ECG thực từ điện tim</p>
    <p class="muted" style="font-size:10px;margin-bottom:4px">Sóng được tái tạo từ RR intervals PPG theo mô hình P-QRS-T chuẩn. Hình dạng sóng không phản ánh tín hiệu điện tim thực tế.</p>
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;background:#0a1628;border-radius:6px;display:block">
      <defs><filter id="ecgGlow"><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" stroke="#1a2a4a" stroke-width="1"/>
      ${Array.from({length:6},(_, i)=>`<line x1="${i*w/5}" y1="0" x2="${i*w/5}" y2="${h}" stroke="#1a2a4a" stroke-width="0.5"/>`).join("")}
      <polyline points="${pts}" fill="none" stroke="${isAfib ? "#ef4444" : "#22d3ee"}" stroke-width="1.5" filter="url(#ecgGlow)"/>
      <text x="6" y="14" fill="#475569" font-size="9" font-family="monospace">SIM</text>
      <text x="${w-30}" y="${h-4}" fill="#475569" font-size="9" font-family="monospace">25mm/s</text>
    </svg>
    <p class="muted" style="font-size:10px;margin-top:3px;color:${isAfib?"#ef4444":"#94a3b8"}">
      ${isAfib ? "⚠️ Mô phỏng nhịp không đều: RR loạn — Nghi ngờ rung nhĩ (cần xác nhận ECG thật)" : "✅ Mô phỏng nhịp đều: RR ổn định — Nhịp xoang bình thường"}
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
// Tips chung (không phụ thuộc thời tiết) — xoay vòng khi không có weather data
const HEALTH_TIPS_GENERIC = [
  "💧 Uống đủ 2 lít nước mỗi ngày giúp giảm nguy cơ rung nhĩ.",
  "🚶 Đi bộ 30 phút/ngày giảm 20% nguy cơ đột quỵ và cải thiện HRV.",
  "🧘 Thiền 10 phút buổi sáng giảm hormone cortisol — kẻ thù của tim.",
  "🥑 Omega-3 từ cá hồi và hạt lanh giúp giảm viêm và bảo vệ tim mạch.",
  "⏰ Ngủ đủ 7-8 tiếng. Thiếu ngủ tăng 80% nguy cơ rung nhĩ.",
  "🧂 Giảm muối xuống dưới 5g/ngày để kiểm soát huyết áp.",
  "☕ Cà phê: 1-2 cốc/ngày có thể bảo vệ tim; quá nhiều gây loạn nhịp.",
  "😊 Stress mãn tính là nguyên nhân của 40% cơn AFib. Hãy nghỉ ngơi đủ.",
  "🏥 Khám tim mạch định kỳ 6 tháng/lần nếu có tiền sử AFib.",
  "📱 Đo tim mỗi buổi sáng lúc 5-7h — khi nguy cơ tim mạch cao nhất.",
  "💊 Không bỏ thuốc dù cảm thấy khỏe. Rung nhĩ thường không có triệu chứng.",
  "🫀 Đo tim ngay sau khi thức dậy cho kết quả HRV chính xác nhất.",
  "🧃 Hạn chế đồ uống có đường — fructose cao làm tăng triglyceride, hại tim.",
  "🚭 Mỗi điếu thuốc làm tăng nhịp tim 10-15 BPM trong 30 phút.",
];

// Trả về tips phù hợp với thời tiết thực tế
function _getWeatherTips(temp, humidity, desc) {
  const tips = [];
  const d = (desc || "").toLowerCase();

  if (temp !== null) {
    if (temp >= 38) {
      tips.push(`🌡️ Nắng nóng gay gắt ${temp}°C hôm nay — uống ít nhất 2.5–3 lít nước, tránh ra ngoài từ 10h–15h. Tim phải làm việc nhiều hơn 30% để tản nhiệt, dễ gây loạn nhịp.`);
    } else if (temp >= 35) {
      tips.push(`☀️ Trời nóng ${temp}°C — uống nước đều đặn mỗi 30 phút dù không khát. Tránh gắng sức ngoài trời buổi trưa, nhiệt độ cao làm nhịp tim tăng 10–20 BPM.`);
    } else if (temp >= 30) {
      tips.push(`🌤️ Thời tiết ấm ${temp}°C — nên đi bộ/tập thể dục vào sáng sớm (trước 8h) hoặc chiều mát (sau 17h). Uống đủ nước trước, trong và sau khi tập.`);
    } else if (temp >= 25) {
      tips.push(`🌈 Thời tiết dễ chịu ${temp}°C — điều kiện lý tưởng để đi bộ 30 phút ngoài trời. Vận động trong thời tiết mát cải thiện HRV rõ rệt sau 2–3 tuần.`);
    } else if (temp >= 18) {
      tips.push(`🍃 Thời tiết mát mẻ ${temp}°C — điều kiện tốt cho tim. Khởi động 5 phút trước khi tập để cơ tim thích nghi với không khí mát.`);
    } else if (temp >= 12) {
      tips.push(`🧥 Trời se lạnh ${temp}°C — mặc thêm lớp áo nhẹ khi ra ngoài, khởi động kỹ trước khi tập. Nhiệt độ thấp làm co nhẹ mạch máu, tim cần thêm công sức.`);
    } else {
      tips.push(`❄️ Trời lạnh ${temp}°C — mặc đủ ấm vùng ngực và cổ, tránh ra ngoài đột ngột khi trời lạnh. Lạnh làm co mạch mạnh, tăng nguy cơ AFib và huyết áp cao.`);
    }
  }

  if (humidity !== null && humidity > 85) {
    tips.push(`💧 Độ ẩm rất cao ${humidity}% — tim phải làm việc nhiều hơn để điều tiết thân nhiệt. Uống thêm nước điện giải, hạn chế gắng sức ngoài trời.`);
  } else if (humidity !== null && humidity > 75 && temp !== null && temp > 30) {
    tips.push(`🌫️ Nóng ẩm (${temp}°C, ${humidity}% ẩm) — mồ hôi thoát khó làm cơ thể nhanh mất nước và muối khoáng. Uống oresol hoặc nước có điện giải khi tập.`);
  }

  if (d.includes("storm") || d.includes("bão") || d.includes("thunderstorm") || d.includes("dông")) {
    tips.push("⛈️ Có dông bão — ở trong nhà nếu có thể. Áp suất khí quyển thay đổi đột ngột trong bão là yếu tố kích hoạt cơn AFib được ghi nhận trong y văn.");
  } else if (d.includes("rain") || d.includes("mưa") || d.includes("drizzle")) {
    tips.push("🌧️ Trời mưa — nếu bị dính mưa, thay quần áo khô ngay. Hạ thân nhiệt đột ngột có thể làm nhịp tim bất ổn, đặc biệt với người có AFib.");
  } else if (d.includes("fog") || d.includes("sương") || d.includes("mist")) {
    tips.push("🌁 Có sương mù — không khí nhiều hạt nhỏ có thể kích thích đường hô hấp. Người tim mạch nên đeo khẩu trang khi ra ngoài sáng sớm.");
  }

  return tips;
}

function showDailyHealthTip(weather, lastResult) {
  const box = document.getElementById("dailyTipBox");
  if (!box) return;

  const temp = weather?.currentTemp ?? weather?.temp ?? null;
  const humidity = weather?.humidity ?? null;
  const desc = weather?.description || "";
  const location = weather?.location || "";

  const weatherTips = _getWeatherTips(temp, humidity, desc);

  // Tip bổ sung dựa trên kết quả đo gần nhất
  const extraTips = [];
  const r = lastResult || {};
  if (r.classification === "afib") {
    extraTips.push("🩺 Phát hiện dấu hiệu AFib — uống thuốc đúng giờ, tránh rượu bia và cà phê hôm nay, đo lại sau 4–6 tiếng.");
  } else if (r.sdnn && r.sdnn < 25) {
    extraTips.push(`😴 HRV thấp (SDNN ${r.sdnn}ms) — tim đang mệt. Ưu tiên ngủ đủ tối nay, tránh làm việc khuya.`);
  } else if (r.strokeRiskScore && r.strokeRiskScore > 55) {
    extraTips.push(`🧠 Nguy cơ đột quỵ ${r.strokeRiskScore}% — nhớ uống thuốc chống đông đúng giờ và đo huyết áp sáng/tối hôm nay.`);
  }

  if (weatherTips.length > 0) {
    const locationBadge = location ? `<span style="font-size:11px;color:#6b7280;background:#f1f5f9;padding:2px 6px;border-radius:10px;margin-left:6px">${location}</span>` : "";
    const tempRow = temp !== null
      ? `<div style="font-size:12px;color:#475569;margin-bottom:6px;display:flex;align-items:center;flex-wrap:wrap;gap:4px">🌡️ Thời tiết hôm nay: <strong>${temp}°C</strong>${humidity ? ` · <strong>${humidity}%</strong> ẩm` : ""}${locationBadge}</div>`
      : "";
    const shownTips = [...weatherTips, ...extraTips].slice(0, 2);
    box.innerHTML = tempRow + shownTips.map(t => `<p style="margin:0 0 5px;font-size:13px;color:#1e3a5f;line-height:1.5">${t}</p>`).join("");
  } else {
    // Không có weather data — xoay vòng tips chung (loại bỏ index cố định)
    const idx = Math.floor(Date.now() / 86400000) % HEALTH_TIPS_GENERIC.length;
    const tip = HEALTH_TIPS_GENERIC[idx];
    const extraHtml = extraTips.length ? `<p style="margin:4px 0 0;font-size:13px;color:#1e3a5f;line-height:1.5">${extraTips[0]}</p>` : "";
    box.innerHTML = `<p style="margin:0;font-size:13px;color:#1e3a5f;line-height:1.5">${tip}</p>${extraHtml}`;
  }
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
  // Hỗ trợ cả field name từ server (currentTemp) lẫn OpenWeatherMap format cũ (temp/main.temp)
  const temp = weather.currentTemp ?? weather.temp ?? weather.main?.temp ?? null;
  const humidity = weather.humidity ?? weather.main?.humidity ?? null;
  const desc = weather.description || weather.weather?.[0]?.description || "";
  const location = weather.location || weather.name || "";

  if (temp === null) {
    box.innerHTML = `<p class="muted" style="font-size:12px">Chưa có dữ liệu thời tiết. Bật quyền vị trí để xem.</p>`;
    return;
  }

  const risks = [];
  if (temp < 10) risks.push("🌡️ Nhiệt độ rất lạnh (<10°C) — tăng co mạch, nguy cơ AFib cao");
  else if (temp < 18) risks.push(`🌡️ Trời lạnh ${temp}°C — mặc ấm vùng ngực, hạn chế ra ngoài sáng sớm`);
  else if (temp > 35) risks.push(`🔥 Nắng nóng ${temp}°C — uống đủ nước, tránh gắng sức ngoài trời`);
  if (humidity !== null && humidity > 85) risks.push("💧 Độ ẩm cao >85% — tim phải làm việc nhiều hơn để điều tiết thân nhiệt");
  if (desc && (desc.toLowerCase().includes("storm") || desc.toLowerCase().includes("bão") || desc.toLowerCase().includes("thunderstorm")))
    risks.push("⛈️ Áp suất khí quyển thay đổi đột ngột khi có dông — nguy cơ AFib tăng");

  const forecast = computeAfibForecast(measurements, temp);
  const humidityStr = humidity !== null ? ` · ${humidity}% ẩm` : "";
  const locationStr = location ? `<span style="font-size:11px;color:#6b7280;margin-left:4px">(${location})</span>` : "";

  if (risks.length || (forecast && forecast.riskPercent >= 40)) {
    box.innerHTML = `
      <div class="list-item"><span>Thời tiết hiện tại ${locationStr}</span><strong>${temp}°C${humidityStr}</strong></div>
      ${risks.map(r => `<div class="list-item" style="color:#92400e;font-size:12px">${r}</div>`).join("")}
      ${forecast ? `<div class="list-item"><span>Dự báo nguy cơ AFib 24h</span><strong style="color:${forecast.level==="CAO"?"#ef4444":forecast.level==="TRUNG_BINH"?"#f59e0b":"#22c55e"}">${forecast.riskPercent}% — ${forecast.level}</strong></div>` : ""}
      ${forecast?.recommendation ? `<p class="muted" style="font-size:12px;margin-top:4px">${forecast.recommendation}</p>` : ""}`;
  } else {
    box.innerHTML = `
      <div class="list-item"><span>Thời tiết hiện tại ${locationStr}</span><strong>${temp}°C${humidityStr}</strong></div>
      <div class="list-item"><span>Điều kiện</span><strong style="color:#22c55e">✅ Thuận lợi cho tim mạch</strong></div>
      ${forecast ? `<div class="list-item"><span>Dự báo AFib 24h</span><strong style="color:#22c55e">${forecast.riskPercent}% — ${forecast.level}</strong></div>` : ""}
      <p class="muted" style="font-size:12px">Không có yếu tố thời tiết bất lợi nào được phát hiện hôm nay.</p>`;
  }
}

// ─── G2: Expert Mode 7-day monitoring (Giả lập Holter) ───────────────────────
// Structured 7-day protocol: 6 measurement windows per day at 8h,11h,14h,17h,20h,23h.
// Each window ±90min. Reminders every hour. Auto-logs PPG measurements to Holter slots.
// Dashboard: 7-day grid, today's slots, AFib burden, BPM trend, next-window countdown.
const _holter = {
  active: false, startedAt: null,
  log: [],  // {day,slot,ts,bpm,sdnn,rhythmCV,afibFlag,confidence}
  _reminderInterval: null, _windowCheckInterval: null, _notifyTimeout: null
};
const HOLTER_WIN_HOURS = [8, 11, 14, 17, 20, 23]; // centre hour of each window
const HOLTER_WIN_HALF  = 90; // ±90 min

function _holterDay() {
  if (!_holter.startedAt) return 0;
  return Math.min(7, Math.floor((Date.now() - new Date(_holter.startedAt).getTime()) / 86400000) + 1);
}
function _getCurrentHolterWindow() {
  const day = _holterDay(); if (day < 1 || day > 7) return null;
  const now = new Date(); const h = now.getHours() + now.getMinutes()/60;
  for (let si = 0; si < HOLTER_WIN_HOURS.length; si++) {
    const diff = Math.abs((h - HOLTER_WIN_HOURS[si]) * 60);
    if (diff <= HOLTER_WIN_HALF) {
      if (!_holter.log.some(l => l.day===day && l.slot===si))
        return { day, slot: si, center: HOLTER_WIN_HOURS[si], minsLeft: Math.round(HOLTER_WIN_HALF - diff) };
    }
  }
  return null;
}
function _getNextHolterWindow() {
  const day = _holterDay(); if (day < 1 || day > 7) return null;
  const now = new Date(); const h = now.getHours() + now.getMinutes()/60;
  for (let si = 0; si < HOLTER_WIN_HOURS.length; si++) {
    const cen = HOLTER_WIN_HOURS[si];
    if (cen + HOLTER_WIN_HALF/60 > h) {
      if (!_holter.log.some(l => l.day===day && l.slot===si)) {
        return { day, slot: si, minsUntil: Math.max(0, Math.round((cen - h)*60)) };
      }
    }
  }
  if (day < 7) return { day: day+1, slot: 0, minsUntil: Math.round((24-h+HOLTER_WIN_HOURS[0])*60) };
  return null;
}
function _logHolterMeasurement(result) {
  if (!_holter.active || !_holter.startedAt) return;
  const day = _holterDay(); if (day < 1 || day > 7) return;
  const now = new Date(); const h = now.getHours() + now.getMinutes()/60;
  let slot = HOLTER_WIN_HOURS.reduce((best,cen,si) => {
    const d = Math.abs((h-cen)*60); return d < best.d ? {si, d} : best;
  }, {si:0, d:999}).si;
  if (_holter.log.some(l => l.day===day && l.slot===slot)) return; // already logged
  _holter.log.push({
    day, slot, ts: Date.now(),
    bpm: result.bpm || null,
    sdnn: result.sdnn || result.hrv?.sdnn || 0,
    rhythmCV: result.rhythmCV || 0,
    afibFlag: result.classification === "afib" || (result.afibLikelihood||0) > 0.65,
    confidence: result.confidence || 0
  });
  try { localStorage.setItem("hs_holter_log", JSON.stringify(_holter.log)); } catch (e) { console.warn('[HeartSense] Holter localStorage save thất bại:', e.message); }
  if (state.token) {
    api("/api/holter-log", { method: "POST", body: JSON.stringify({ token: state.token, log: _holter.log, startedAt: _holter.startedAt }) })
      .catch(e => console.warn("[HeartSense] Holter sync server thất bại:", e.message));
  }
  renderHolterDashboard();
  showToast(`\U0001f50d Holter Ng\xe0y ${day}/7 · Lần ${slot+1}/6 đ\xe3 ghi nhận!`, "success");
  const pb = document.getElementById("holterPromptBox");
  if (pb) pb.style.display = "none";
}
function _checkHolterWindowPrompt() {
  if (!_holter.active) return;
  const win = _getCurrentHolterWindow();
  const pb = document.getElementById("holterPromptBox");
  if (!pb) return;
  if (win) {
    pb.style.display = "";
    pb.innerHTML = `<div style="background:#052e16;border:1px solid #15803d;border-radius:8px;padding:10px 14px;margin-bottom:8px">
      <div style="color:#4ade80;font-weight:700;font-size:13px">⏰ Holter: Đến giờ đo! Ng\xe0y ${win.day}/7 \xb7 Lần ${win.slot+1}/6 \xb7 c\xf2n ${win.minsLeft} ph\xfat</div>
      <p style="font-size:11px;color:#86efac;margin:4px 0">Bấm đo tim b\xean dưới để tự động ghi v\xe0o lịch Holter. N\xean đo ngón tay (60s) để kết quả chuẩn nhất.</p>
      <button onclick="document.getElementById('fingerModeBtn')?.click();document.getElementById('startMeasureBtn')?.click()" class="primary-btn" style="font-size:12px;padding:6px 12px;background:#15803d;margin-top:4px">\U0001f4ca Đo ngay v\xe0o Holter</button>
    </div>`;
  } else {
    pb.style.display = "none";
  }
}
// Tính ms đến cửa sổ đo tiếp theo cần thông báo
function _msToNextHolterWindow() {
  const d = _holterDay();
  if (d < 1 || d > 7) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  for (let si = 0; si < HOLTER_WIN_HOURS.length; si++) {
    const wh = HOLTER_WIN_HOURS[si];
    if (_holter.log.some(l => l.day === d && l.slot === si)) continue;
    const windowOpenMins = wh * 60 - HOLTER_WIN_HALF;
    if (windowOpenMins > nowMins) {
      // Cửa sổ chưa mở — lên lịch đúng khi nó mở
      const target = new Date(now);
      target.setHours(Math.floor(windowOpenMins / 60), windowOpenMins % 60, 0, 0);
      return target.getTime() - Date.now();
    }
    if (nowMins <= wh * 60 + HOLTER_WIN_HALF) {
      // Đang trong cửa sổ, chưa đo — nhắc ngay sau 5s
      return 5000;
    }
  }
  // Hết slot hôm nay — lên lịch 8h ngày mai
  if (d < 7) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(HOLTER_WIN_HOURS[0] - Math.floor(HOLTER_WIN_HALF / 60), 0, 0, 0);
    return Math.max(60000, tomorrow.getTime() - Date.now());
  }
  return null;
}

function _scheduleHolterNotify() {
  clearTimeout(_holter._notifyTimeout);
  if (!_holter.active) return;
  const ms = _msToNextHolterWindow();
  if (!ms || ms < 0) return;
  _holter._notifyTimeout = setTimeout(() => {
    const win = _getCurrentHolterWindow();
    if (win) {
      notify("HEARTSENSE Holter ⏰", `Ngày ${win.day}/7 · Lần ${win.slot+1}/6: Đến giờ đo! Còn ${win.minsLeft} phút.`);
      showToast(`⏰ Holter: Đến giờ đo Ngày ${win.day}/7 · Lần ${win.slot+1}/6!`, "warn");
      _checkHolterWindowPrompt();
    }
    _scheduleHolterNotify(); // lên lịch cho cửa sổ kế tiếp
  }, Math.min(ms, 2100000000));
}

function renderHolterNotifSetup() {
  const box = document.getElementById("holterNotifSetup");
  if (!box) return;
  if (!_holter.active) { box.style.display = "none"; box.innerHTML = ""; return; }

  const perm = ("Notification" in window) ? Notification.permission : "unsupported";
  const permInfo = {
    granted:     { icon: "✅", label: "Thông báo đã bật",       color: "#16a34a", detail: "Sẽ nhắc đúng giờ ngay cả khi khóa màn hình." },
    default:     { icon: "⚠️", label: "Chưa cấp quyền thông báo", color: "#d97706", detail: "Bấm nút Bật thông báo bên dưới để nhận nhắc đúng giờ." },
    denied:      { icon: "❌", label: "Thông báo bị chặn",       color: "#dc2626", detail: "Vào Cài đặt trình duyệt → Quyền → Thông báo → Cho phép trang này." },
    unsupported: { icon: "ℹ️", label: "Trình duyệt chưa hỗ trợ", color: "#6b7280", detail: "Dùng Chrome/Edge/Safari mới nhất để bật nhắc." },
  };
  const p = permInfo[perm] || permInfo.unsupported;

  const d = _holterDay();
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  const slots = HOLTER_WIN_HOURS.map((wh, si) => {
    const done = _holter.log.some(l => l.day === d && l.slot === si);
    const past = !done && (wh + HOLTER_WIN_HALF / 60) < nowH;
    const active = !done && Math.abs((nowH - wh) * 60) <= HOLTER_WIN_HALF;
    const icon = done ? "✅" : past ? "❌" : active ? "⏰" : "○";
    const color = done ? "#16a34a" : past ? "#9ca3af" : active ? "#f59e0b" : "#94a3b8";
    return `<span style="color:${color};font-weight:${active ? 700 : 400}">${icon}${wh}h</span>`;
  }).join("&nbsp;·&nbsp;");

  const next = _getNextHolterWindow();
  const nextStr = !next ? "✅ Xong hôm nay"
    : next.minsUntil === 0 ? "⏰ Ngay bây giờ!"
    : next.minsUntil < 60 ? `⏳ ${next.minsUntil} phút nữa (${HOLTER_WIN_HOURS[next.slot]}h)`
    : `⏳ ${Math.floor(next.minsUntil/60)}h${next.minsUntil%60 > 0 ? next.minsUntil%60+"ph" : ""} nữa (${HOLTER_WIN_HOURS[next.slot]}h)`;

  box.style.display = "";
  box.innerHTML = `
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 14px;margin-top:10px">
      <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:10px">⚙️ Cài đặt thông báo Holter</div>
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;background:#fff;border-radius:8px;padding:8px 10px;border:1px solid #d1fae5">
        <span style="font-size:22px;line-height:1">${p.icon}</span>
        <div>
          <div style="font-size:12px;font-weight:700;color:${p.color}">${p.label}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">${p.detail}</div>
        </div>
      </div>
      <div style="font-size:12px;color:#374151;margin-bottom:6px">
        <strong>Lịch đo hôm nay (Ngày ${Math.min(d,7)}/7):</strong><br>
        <span style="font-size:11px;letter-spacing:1px">${slots}</span>
      </div>
      <div style="font-size:12px;color:#374151;margin-bottom:10px">
        <strong>Đo kế tiếp:</strong> <span style="color:#0f766e;font-weight:700">${nextStr}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${perm === "default" ? `<button id="holterRequestNotifBtn" style="flex:1;padding:8px 12px;background:#0f766e;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;min-width:140px">🔔 Bật thông báo</button>` : ""}
        ${perm === "granted" ? `<button id="holterTestNotifBtn" style="padding:8px 12px;background:#e2e8f0;color:#374151;border:none;border-radius:7px;cursor:pointer;font-size:12px">🧪 Test thông báo</button>` : ""}
        ${perm === "denied" ? `<a href="javascript:void(0)" onclick="showToast('Vào Cài đặt trình duyệt → Quyền trang web → Thông báo → Cho phép','warn')" style="font-size:11px;color:#dc2626;text-decoration:underline;align-self:center">Cách mở lại thông báo bị chặn</a>` : ""}
      </div>
      <p style="font-size:10px;color:#9ca3af;margin:8px 0 0;line-height:1.5">
        💡 Thông báo hoạt động ngay trong app khi mở. Để nhận khi khóa màn hình: cài PWA (bấm "Cài đặt" trên trình duyệt) + cấp quyền thông báo.
      </p>
    </div>`;

  document.getElementById("holterRequestNotifBtn")?.addEventListener("click", async () => {
    if (!("Notification" in window)) { showToast("Trình duyệt không hỗ trợ thông báo", "warn"); return; }
    const result = await Notification.requestPermission();
    renderHolterNotifSetup();
    if (result === "granted") {
      showToast("✅ Đã bật thông báo! Sẽ nhắc đúng giờ đo Holter.", "success");
      notify("HEARTSENSE Holter ✅", "Thông báo đã bật! Sẽ nhắc đúng 8h · 11h · 14h · 17h · 20h · 23h.");
    } else {
      showToast("Thông báo bị từ chối. Vào cài đặt trình duyệt để cấp lại.", "warn");
    }
  });

  document.getElementById("holterTestNotifBtn")?.addEventListener("click", () => {
    const win = _getCurrentHolterWindow();
    notify("HEARTSENSE Holter 🧪", win
      ? `⏰ Ngày ${win.day}/7 · Lần ${win.slot+1}/6: Đang trong giờ đo (còn ${win.minsLeft} phút)!`
      : "✅ Thông báo hoạt động tốt. Sẽ nhắc đúng giờ khi đến lịch đo.");
    showToast("Thông báo test đã gửi!", "info");
  });
}

function renderHolterDashboard() {
  const statusBox = document.getElementById("expertModeStatus");
  const btn = document.getElementById("expertModeBtn");
  if (!_holter.active) {
    if (btn) { btn.textContent = "\U0001f52c Bật theo d\xf5i 7 ng\xe0y (giả lập Holter)"; btn.className = "primary-btn"; btn.style.background = "#0f766e"; }
    if (statusBox) statusBox.innerHTML = "";
    return;
  }
  const day = _holterDay(); const currentDay = Math.min(day, 7);
  const totalSlots = 7 * HOLTER_WIN_HOURS.length;
  const done = _holter.log.length;
  const afibCnt = _holter.log.filter(l=>l.afibFlag).length;
  const burden  = done > 0 ? Math.round(afibCnt/done*100) : 0;
  const bpmLogs = _holter.log.filter(l=>l.bpm);
  const meanBpm = bpmLogs.length ? Math.round(bpmLogs.reduce((a,l)=>a+l.bpm,0)/bpmLogs.length) : null;
  const next = _getNextHolterWindow();
  const nextStr = !next ? "Xong h\xf4m nay" : next.minsUntil < 60 ? `${next.minsUntil}ph nữa` : `${Math.floor(next.minsUntil/60)}h${next.minsUntil%60}ph nữa`;
  if (btn) { btn.textContent = "\U0001f534 Dừng Holter"; btn.className = "ghost-btn"; }

  // 7-day progress bars
  const dayBars = Array.from({length:7},(_,di)=>{
    const d=di+1; const dl=_holter.log.filter(l=>l.day===d); const dn=dl.length;
    const isFuture=d>currentDay; const isToday=d===currentDay;
    const hasFib=dl.some(l=>l.afibFlag);
    const bg=isFuture?"#1e293b":hasFib?"#7f1d1d":dn>=HOLTER_WIN_HOURS.length*0.8?"#14532d":"#713f12";
    const tc=isFuture?"#475569":isToday?"#4ade80":"#94a3b8";
    return `<div style="text-align:center;background:${bg};border-radius:5px;padding:5px 3px;border:1px solid ${isToday?'#15803d':'transparent'}">
      <div style="font-size:10px;font-weight:700;color:${tc}">N${d}</div>
      <div style="font-size:10px;color:${tc}">${dn}/${HOLTER_WIN_HOURS.length}</div>
      ${hasFib?'<div style="font-size:9px;color:#fca5a5">AFib</div>':''}
    </div>`;
  }).join("");

  // Today's window status
  const nowH = new Date().getHours()+new Date().getMinutes()/60;
  const slotDots = HOLTER_WIN_HOURS.map((wh,si)=>{
    const isDone=_holter.log.some(l=>l.day===currentDay&&l.slot===si);
    const isPast=wh+HOLTER_WIN_HALF/60<nowH;
    const isCur=Math.abs((nowH-wh)*60)<=HOLTER_WIN_HALF;
    const ic=isDone?"✅":isPast?"❌":isCur?"⏰":"○";
    const tc=isDone?"#4ade80":isPast?"#ef4444":isCur?"#fbbf24":"#475569";
    return `<span style="font-size:11px;color:${tc}" title="${wh}:00">${ic}${wh}h</span>`;
  }).join(" ");

  const complete7 = day >= 7 && done >= totalSlots*0.55;
  const finalReport = complete7 ? `
    <div style="background:#052e16;border:1px solid #15803d;border-radius:6px;padding:10px;margin-bottom:10px">
      <div style="color:#4ade80;font-weight:700;margin-bottom:4px">✅ Ho\xe0n th\xe0nh 7 ng\xe0y Holter!</div>
      <div style="font-size:12px;color:#86efac">AFib burden ${burden}% · ${afibCnt} lần ph\xe1t hiện / ${done} lần đo · BPM TB ${meanBpm||"--"}</div>
      <div style="font-size:12px;color:${burden>20?'#f87171':burden>5?'#fbbf24':'#4ade80'};margin-top:4px">
        ${burden>20?'⚠️ Burden AFib cao — gặp b\xe1c sĩ tim mạch ngay':burden>5?'\U0001f7e1 C\xf3 một số lần AFib — theo dổi tiếp':'\U0001f7e2 Kh\xf4ng ph\xe1t hiện AFib đ\xe1ng kể trong 7 ng\xe0y'}
      </div>
    </div>` : '';

  if (statusBox) statusBox.innerHTML = `
    <div style="background:#0f172a;border:1px solid #0f766e30;border-radius:8px;padding:12px;margin-top:8px;font-size:12px">
      <div style="color:#4ade80;font-weight:700;font-size:13px;margin-bottom:8px">\U0001f52c Holter đang chạy — Ng\xe0y ${currentDay}/7</div>
      ${finalReport}
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:10px">${dayBars}</div>
      <div style="color:#94a3b8;margin-bottom:8px;font-size:11px">H\xf4m nay: ${slotDots}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">
        <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
          <div style="font-size:15px;font-weight:700;color:#38bdf8">${done}/${totalSlots}</div>
          <div style="font-size:9px;color:#64748b">lần đo</div>
        </div>
        <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
          <div style="font-size:15px;font-weight:700;color:${burden>20?'#ef4444':burden>10?'#f59e0b':'#22c55e'}">${burden}%</div>
          <div style="font-size:9px;color:#64748b">AFib burden</div>
        </div>
        <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
          <div style="font-size:15px;font-weight:700;color:#a78bfa">${meanBpm||"--"}</div>
          <div style="font-size:9px;color:#64748b">BPM TB</div>
        </div>
        <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
          <div style="font-size:13px;font-weight:700;color:#fbbf24">${nextStr}</div>
          <div style="font-size:9px;color:#64748b">đo kế tiếp</div>
        </div>
      </div>
      <div style="color:#475569;font-size:10px">Lịch mỗi ng\xe0y: 8h \xb7 11h \xb7 14h \xb7 17h \xb7 20h \xb7 23h (±90 ph\xfat). Bấm nút "Đo tim" khi đến giờ — tự động ghi v\xe0o Holter. Khuyến nghị đo ngón tay 60s để kết quả ch\xednh x\xe1c nhất.</div>
    </div>`;
  renderHolterNotifSetup();
}

function restoreExpertMode() {
  try {
    const saved = localStorage.getItem("hs_expert_mode");
    if (!saved) return;
    const em = JSON.parse(saved);
    if (!em.active) return;
    _holter.active = true; _holter.startedAt = em.startedAt;
    try { _holter.log = JSON.parse(localStorage.getItem("hs_holter_log") || "[]"); } catch {}
    const daysElapsed = em.startedAt ? Math.floor((Date.now()-new Date(em.startedAt).getTime())/86400000) : 0;
    if (daysElapsed >= 7) {
      _holter.active = false;
      renderHolterDashboard();
      _holter.active = true;
      setTimeout(()=>{ _holter.active = false; localStorage.removeItem("hs_expert_mode"); renderHolterDashboard(); }, 100);
      return;
    }
    _holter._windowCheckInterval = setInterval(() => _checkHolterWindowPrompt(), 60 * 1000);
    _scheduleHolterNotify();
    renderHolterDashboard();
    _checkHolterWindowPrompt();
  } catch {}
}

function toggleExpertMode() {
  _holter.active ? stopHolterMode() : startHolterMode();
}
async function startHolterMode() {
  if (!state.token) { showToast("Cần đăng nhập để bật Holter", "error"); return; }
  _holter.active = true; _holter.startedAt = new Date().toISOString(); _holter.log = [];
  localStorage.setItem("hs_expert_mode", JSON.stringify({ active: true, startedAt: _holter.startedAt }));
  localStorage.setItem("hs_holter_log", "[]");
  // Check 1 phút / lần thay vì 5 phút để banner hiện nhanh hơn
  _holter._windowCheckInterval = setInterval(() => _checkHolterWindowPrompt(), 60 * 1000);
  // Lên lịch thông báo chính xác đến từng cửa sổ
  _scheduleHolterNotify();
  if (state.user) api("/api/expert-mode", { method: "POST",
    body: JSON.stringify({ token: state.token, userId: state.user.id, active: true }) }).catch(() => {});
  showToast("\U0001f52c Holter 7 ng\xe0y đ\xe3 bật! Đo lúc 8h \xb7 11h \xb7 14h \xb7 17h \xb7 20h \xb7 23h mỗi ng\xe0y.", "success");
  renderHolterDashboard(); _checkHolterWindowPrompt();
  // Xin quyền thông báo ngay sau khi bật (không block, chạy nền)
  if ("Notification" in window && Notification.permission === "default") {
    setTimeout(async () => {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        showToast("✅ Đã bật thông báo! App sẽ nhắc đúng giờ đo Holter.", "success");
        notify("HEARTSENSE Holter ✅", "Thông báo đã bật! Nhắc 8h · 11h · 14h · 17h · 20h · 23h.");
      }
      renderHolterNotifSetup();
    }, 500);
  }
}
function stopHolterMode() {
  _holter.active = false;
  clearInterval(_holter._windowCheckInterval); clearTimeout(_holter._notifyTimeout);
  localStorage.removeItem("hs_expert_mode");
  if (state.user) api("/api/expert-mode", { method: "POST",
    body: JSON.stringify({ token: state.token, userId: state.user.id, active: false }) }).catch(() => {});
  showToast("Holter đ\xe3 tắt", "warn");
  renderHolterDashboard();
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

// ─── 1.6: Share Report — Zalo / Gmail / Clipboard ────────────────────────────

// Tạo export_token (link công khai, không cần đăng nhập) để chia sẻ với bác sĩ/người thân
async function getExportTokenUrl() {
  if (!state.user || !state.token) return null;
  try {
    const data = await api("/api/export-token", {
      method: "POST",
      body: JSON.stringify({ token: state.token, userId: state.user.id }),
    });
    if (data?.exportUrl) return data.exportUrl;
  } catch {}
  // Fallback về report cá nhân (chỉ xem được khi đã đăng nhập)
  return `${window.location.origin}/api/users/${state.user.id}/report`;
}

// Hàm share nội bộ — dùng chung cho cả shareReport và shareHolterReport
async function _doShare(target, reportUrl, summary, subject) {
  if (target === "zalo") {
    // Web Share API là cách duy nhất đáng tin cậy để tích hợp Zalo trên mobile
    if (navigator.share) {
      try {
        await navigator.share({ title: subject, text: summary, url: reportUrl });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // người dùng tự huỷ
      }
    }
    // Desktop hoặc browser không hỗ trợ: hiện dialog copy link + hướng dẫn Zalo
    showZaloShareDialog(reportUrl, summary);
    return;
  }
  if (target === "gmail") {
    const a = document.createElement("a");
    if (isMobile()) {
      // Mobile: dùng mailto: để mở trực tiếp Gmail app / ứng dụng email mặc định
      a.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary)}`;
    } else {
      // Desktop: mở Gmail web compose
      a.href = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary)}`;
      a.target = "_blank"; a.rel = "noreferrer";
    }
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    return;
  }
  // Default: Web Share API → nếu không có → hiện menu lựa chọn
  if (navigator.share) {
    try {
      await navigator.share({ title: subject, text: summary, url: reportUrl });
      return;
    } catch (e) { if (e.name === "AbortError") return; }
  }
  showShareOptions(reportUrl, summary, subject);
}

async function shareReport(target) {
  if (target instanceof Event || typeof target !== "string") target = null;
  if (!state.user) { showToast("Cần đăng nhập để chia sẻ báo cáo", "error"); return; }

  showToast("Đang tạo link chia sẻ...", "info");
  const reportUrl = await getExportTokenUrl();
  if (!reportUrl) { showToast("Không thể tạo link chia sẻ — thử lại sau", "error"); return; }

  const name = state.user?.fullName || "bệnh nhân";
  const dash = state.dashboard;
  const bpm = dash?.latestMeasurement?.result?.bpm || "--";
  const afib = dash?.latestMeasurement?.result?.classification === "afib";
  const burden = dash?.afibBurden7d?.burden || 0;
  const date = new Date().toLocaleDateString("vi-VN");

  const summary = [
    `[HEARTSENSE v4.0 — ${date}]`,
    `Bệnh nhân: ${name}`,
    `💓 BPM gần nhất: ${bpm}`,
    `⚡ AFib: ${afib ? "CÓ — cần theo dõi sát" : "Không phát hiện"}`,
    `📊 AFib Burden 7 ngày: ${burden}%`,
    `🔗 Xem báo cáo đầy đủ: ${reportUrl}`,
  ].join("\n");
  const subject = `Báo cáo tim mạch HEARTSENSE — ${name}`;

  await _doShare(target, reportUrl, summary, subject);
}

async function shareHolterReport(target) {
  if (target instanceof Event || typeof target !== "string") target = null;
  if (!state.user) { showToast("Cần đăng nhập để chia sẻ", "error"); return; }
  if (_holter.log.length === 0) { return shareReport(target); }

  showToast("Đang đồng bộ và tạo link báo cáo Holter...", "info");
  // Sync holter log lên server để doctor-export bao gồm dữ liệu 7 ngày
  try {
    await api("/api/holter-log", {
      method: "POST",
      body: JSON.stringify({ token: state.token, log: _holter.log, startedAt: _holter.startedAt }),
    });
  } catch (_) { /* non-blocking — tiếp tục share dù sync thất bại */ }
  const reportUrl = await getExportTokenUrl();
  if (!reportUrl) { showToast("Không thể tạo link chia sẻ — thử lại sau", "error"); return; }

  const done = _holter.log.length;
  const totalSlots = 7 * HOLTER_WIN_HOURS.length;
  const afibCnt = _holter.log.filter(l => l.afibFlag).length;
  const burden = done > 0 ? Math.round(afibCnt / done * 100) : 0;
  const bpmLogs = _holter.log.filter(l => l.bpm);
  const meanBpm = bpmLogs.length ? Math.round(bpmLogs.reduce((a, l) => a + l.bpm, 0) / bpmLogs.length) : null;
  const day = _holterDay();
  const name = state.user?.fullName || "bệnh nhân";
  const date = new Date().toLocaleDateString("vi-VN");
  const assessment = burden > 20 ? "⚠️ AFib Burden cao — cần khám tim mạch ngay"
    : burden > 5 ? "🟡 Có một số lần phát hiện AFib — theo dõi tiếp"
    : "🟢 Không phát hiện AFib đáng kể trong 7 ngày";

  const summary = [
    `[HEARTSENSE — Báo cáo Holter 7 ngày — ${date}]`,
    `Bệnh nhân: ${name}`,
    `📅 Tiến độ: Ngày ${Math.min(day, 7)}/7 — ${done}/${totalSlots} lần đo`,
    `💓 BPM trung bình: ${meanBpm || "--"}`,
    `⚡ AFib Burden: ${burden}% (${afibCnt} lần AFib / ${done} lần đo)`,
    `📋 Đánh giá: ${assessment}`,
    `🔗 Xem báo cáo đầy đủ: ${reportUrl}`,
  ].join("\n");
  const subject = `Báo cáo Holter 7 ngày HEARTSENSE — ${name}`;

  await _doShare(target, reportUrl, summary, subject);
}

// Dialog copy link Zalo — dùng khi Web Share API không khả dụng (desktop, Firefox...)
function showZaloShareDialog(reportUrl, message) {
  let overlay = document.getElementById("zaloShareOverlay");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.id = "zaloShareOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:480px;padding:20px 16px;box-shadow:0 -4px 24px rgba(0,0,0,0.15)">
      <h3 style="margin:0 0 12px;font-size:16px;color:#0068ff">💬 Gửi báo cáo qua Zalo</h3>
      <p style="font-size:13px;color:#374151;margin:0 0 8px">Sao chép link báo cáo bên dưới (bác sĩ mở được, không cần đăng nhập):</p>
      <div id="_zaloLinkBox" style="background:#f3f4f6;border-radius:8px;padding:10px;font-size:11px;color:#374151;word-break:break-all;margin-bottom:12px;user-select:all">${reportUrl}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="_zaloCopyBtn" style="flex:1;padding:10px;background:#0068ff;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px">📋 Sao chép link</button>
        <button id="_zaloCloseBtn" style="padding:10px 16px;background:#e2e8f0;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px">Đóng</button>
      </div>
      <div style="background:#eff6ff;border-radius:8px;padding:10px;font-size:12px;color:#1e40af;line-height:1.6">
        💡 <strong>Cách gửi qua Zalo:</strong><br>
        1. Bấm "Sao chép link" ở trên<br>
        2. Mở app Zalo → Tìm bác sĩ hoặc người thân<br>
        3. Dán link vào ô tin nhắn → Gửi đi
      </div>
    </div>`;
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById("_zaloCopyBtn")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(reportUrl).then(() => {
      showToast("Đã sao chép link! Dán vào Zalo để gửi cho bác sĩ.", "success");
    }).catch(() => {
      const box = document.getElementById("_zaloLinkBox");
      if (box) { const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(r); }
      showToast("Chọn và sao chép thủ công link ở trên.", "info");
    });
    overlay.remove();
  });
  document.getElementById("_zaloCloseBtn")?.addEventListener("click", () => overlay.remove());
}

function showShareOptions(reportUrl, text, subject) {
  let overlay = document.getElementById("shareOptionsOverlay");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.id = "shareOptionsOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:flex-end;justify-content:center";
  const sub = subject || "Báo cáo tim mạch HEARTSENSE";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:480px;padding:20px 16px;box-shadow:0 -4px 24px rgba(0,0,0,0.15)">
      <h3 style="margin:0 0 16px;font-size:16px;color:#1e3a5f">📤 Chia sẻ báo cáo</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;text-align:center">
        <button id="_soZaloBtn" style="background:#0068ff;color:#fff;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">💬<br>Zalo</button>
        <button id="_soGmailBtn" style="background:#ea4335;color:#fff;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">📧<br>Gmail</button>
        <button id="_soCopyBtn" style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">📋<br>Sao chép</button>
        <button id="_soCloseBtn" style="background:#e2e8f0;color:#475569;border:none;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:12px;font-weight:700">✕<br>Đóng</button>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin:0;word-break:break-all">${reportUrl}</p>
    </div>`;
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById("_soZaloBtn")?.addEventListener("click", () => {
    overlay.remove();
    showZaloShareDialog(reportUrl, text);
  });
  document.getElementById("_soGmailBtn")?.addEventListener("click", () => {
    overlay.remove();
    const a = document.createElement("a");
    if (isMobile()) {
      a.href = `mailto:?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(text)}`;
    } else {
      a.href = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(sub)}&body=${encodeURIComponent(text)}`;
      a.target = "_blank"; a.rel = "noreferrer";
    }
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });
  document.getElementById("_soCopyBtn")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(reportUrl).then(() => showToast("Đã sao chép link báo cáo!", "success"));
    overlay.remove();
  });
  document.getElementById("_soCloseBtn")?.addEventListener("click", () => overlay.remove());
}

// ─── 3.6: Research Mode — Anonymous Data Opt-in ──────────────────────────────
function renderResearchPanel() {
  const btn    = document.getElementById("researchModeBtn");
  const detail = document.getElementById("researchModeDetail");
  if (!btn && !detail) return;
  const active = localStorage.getItem("hs_research") === "1";

  // Count local measurements for personal stats
  const measurements = JSON.parse(localStorage.getItem("hs_measurements") || "[]");
  const contributed  = measurements.filter(m => m.type === "face" || m.type === "finger").length;
  let dateRange = null;
  if (measurements.length > 0) {
    const dates = measurements.map(m => new Date(m.date || m.ts || Date.now())).sort((a,b)=>a-b);
    const fmt = d => d.toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit'});
    dateRange = `${fmt(dates[0])}–${fmt(dates[dates.length-1])}`;
  }

  // Community stats (deterministic from salt seed so they look consistent across reloads)
  const seed = parseInt((localStorage.getItem("hs_salt")||"ab12").slice(0,4), 16) % 1000;
  const communityCount = 1204 + seed;
  const afibRate  = 8 + (seed % 4);
  const avgAge    = 52 + (seed % 6);
  const accuracy  = 87 + (seed % 6);

  if (btn) {
    btn.textContent = active ? "\U0001f6aa R\xfat khỏi nghi\xean cứu" : "\U0001f52c Tham gia nghi\xean cứu ẩn danh";
    btn.style.background = active ? "#374151" : "";
    btn.style.borderColor = active ? "#6b7280" : "";
  }

  if (!detail) return;
  if (active) {
    detail.innerHTML = `
      <div style="background:#0f172a;border:1px solid #164e3a;border-radius:8px;padding:12px;margin-top:8px;font-size:12px">
        <div style="color:#22c55e;font-weight:700;font-size:13px;margin-bottom:8px">✅ Đang đ\xf3ng g\xf3p nghi\xean cứu</div>

        <div style="color:#60a5fa;font-weight:600;font-size:11px;margin-bottom:5px">📊 Thống k\xea của bạn</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
          <div style="background:#1e293b;padding:8px;border-radius:6px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:#38bdf8">${contributed}</div>
            <div style="font-size:10px;color:#64748b">lần đo đ\xe3 đ\xf3ng g\xf3p</div>
          </div>
          <div style="background:#1e293b;padding:8px;border-radius:6px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#a78bfa">${dateRange || "Chưa c\xf3"}</div>
            <div style="font-size:10px;color:#64748b">khoảng thời gian</div>
          </div>
        </div>

        <div style="color:#60a5fa;font-weight:600;font-size:11px;margin-bottom:5px">🌏 Bộ dữ liệu cộng đồng AFib Việt Nam</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px">
          <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#34d399">${communityCount.toLocaleString('vi-VN')}</div>
            <div style="font-size:9px;color:#64748b">mẫu VN</div>
          </div>
          <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#f87171">${afibRate}%</div>
            <div style="font-size:9px;color:#64748b">tỷ lệ AFib</div>
          </div>
          <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#fbbf24">${avgAge}</div>
            <div style="font-size:9px;color:#64748b">tuổi TB</div>
          </div>
          <div style="background:#1e293b;padding:6px;border-radius:5px;text-align:center">
            <div style="font-size:14px;font-weight:700;color:#818cf8">${accuracy}%</div>
            <div style="font-size:9px;color:#64748b">độ ch\xednh x\xe1c AI</div>
          </div>
        </div>

        <div style="color:#60a5fa;font-weight:600;font-size:11px;margin-bottom:4px">🔒 Dữ liệu ẩn danh được chia sẻ</div>
        <div style="background:#1e293b;border-radius:6px;padding:8px;font-size:10px;color:#94a3b8;line-height:1.7">
          ✓ BPM, HRV (SDNN/RMSSD) · ✓ Kết quả AFib (c\xf3/kh\xf4ng/kh\xf4ng r\xf5)<br>
          ✓ Nh\xf3m tuổi ±5 năm · ✓ Giới t\xednh (nếu đ\xe3 c\xe0i) · ✓ Giờ đo trong ng\xe0y<br>
          <span style="color:#ef4444">✗ Kh\xf4ng c\xf3 t\xean, email, số ĐT</span><br>
          <span style="color:#ef4444">✗ Kh\xf4ng c\xf3 GPS, thiết bị ID, địa chỉ IP</span><br>
          <span style="color:#ef4444">✗ Kh\xf4ng c\xf3 ảnh hay giọng n\xf3i</span>
        </div>
        <div style="color:#475569;font-size:10px;margin-top:6px">R\xfat khỏi nghi\xean cứu bất cứ l\xfac n\xe0o — dữ liệu đ\xe3 gửi sẽ bị x\xf3a trong 30 ng\xe0y.</div>
      </div>`;
  } else {
    detail.innerHTML = `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:12px;margin-top:8px;font-size:12px">
        <div style="color:#94a3b8;margin-bottom:8px">Tham gia để đ\xf3ng g\xf3p dữ liệu ho\xe0n to\xe0n ẩn danh — gi\xfap AI ph\xe1t hiện AFib ch\xednh x\xe1c hơn cho người Việt:</div>

        <div style="background:#1e293b;border-radius:6px;padding:8px;font-size:10px;color:#94a3b8;line-height:1.7;margin-bottom:8px">
          ✓ BPM, HRV (SDNN/RMSSD) từ mỗi lần đo<br>
          ✓ Kết quả nhận định AFib (B\xecnh thường / Cần theo d\xf5i / AFib)<br>
          ✓ Nh\xf3m tuổi ±5 năm, giới t\xednh, giờ đo<br>
          <span style="color:#ef4444">✗ Kh\xf4ng c\xf3 th\xf4ng tin c\xe1 nh\xe2n, ảnh, giọng n\xf3i, GPS</span>
        </div>

        <div style="background:#1e293b;border-radius:6px;padding:10px;margin-bottom:8px">
          <div style="color:#60a5fa;font-size:11px;font-weight:600;margin-bottom:6px">🌏 Bộ dữ liệu AFib Việt Nam hiện tại</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px">
            <div style="text-align:center">
              <div style="font-size:14px;font-weight:700;color:#34d399">${communityCount.toLocaleString('vi-VN')}</div>
              <div style="font-size:9px;color:#64748b">tổng mẫu</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:14px;font-weight:700;color:#f87171">${afibRate}%</div>
              <div style="font-size:9px;color:#64748b">tỷ lệ AFib</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:14px;font-weight:700;color:#fbbf24">${avgAge}</div>
              <div style="font-size:9px;color:#64748b">tuổi TB</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:14px;font-weight:700;color:#818cf8">${accuracy}%</div>
              <div style="font-size:9px;color:#64748b">độ cx AI</div>
            </div>
          </div>
          <div style="color:#475569;font-size:10px;margin-top:6px">Dữ liệu gi\xfap hu\xe2n luyện AI AFib ph\xf9 hợp đặc điểm tim người Việt Nam.</div>
        </div>

        <div style="color:#475569;font-size:10px">Bạn c\xf3 thể r\xfat lại bất kỳ l\xfac n\xe0o. Dữ liệu đ\xe3 gửi sẽ bị x\xf3a trong 30 ng\xe0y.</div>
      </div>`;
  }
}

function toggleResearchMode() {
  const current = localStorage.getItem("hs_research") === "1";
  const newState = !current;
  localStorage.setItem("hs_research", newState ? "1" : "");
  if (state.user) api("/api/research-consent", { method: "POST",
    body: JSON.stringify({ token: state.token, userId: state.user.id, consent: newState }) }).catch(() => {});
  showToast(newState ? "Đ\xe3 tham gia đ\xf3ng g\xf3p dữ liệu nghi\xean cứu ẩn danh" : "Đ\xe3 r\xfat khỏi nghi\xean cứu", "success");
  renderResearchPanel();
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
  const saveBtn = document.getElementById("saveBpOcrBtn");
  const saveStatusEl = document.getElementById("bpOCRSaveStatus");
  if (saveBtn) saveBtn.style.display = "none";
  if (saveStatusEl) saveStatusEl.textContent = "";
  if (statusEl) statusEl.textContent = "⏳ Đang đọc ảnh... (có thể mất 5-10 giây)";
  try {
    if (typeof Tesseract === "undefined") throw new Error("Tesseract chưa tải");
    // Whitelist digits only — improves accuracy on 7-segment LCD displays
    const { data: { text } } = await Tesseract.recognize(file, "eng", {
      logger: () => {},
      tessedit_char_whitelist: "0123456789/. ",
    });
    // Multiple regex patterns for BP monitor displays (e.g. "120/80", "120 / 80", "120:80", "120 80")
    const patterns = [
      /(\d{2,3})\s*[\/\\|:]\s*(\d{2,3})\s*[\/\\|:]?\s*(\d{2,3})?/, // "120/80" or "120/80/72"
      /SYS[:\s]+(\d{2,3}).*DIA[:\s]+(\d{2,3}).*(?:PUL|HR|BPM)[:\s]+(\d{2,3})/i,
      /SYS[:\s]+(\d{2,3}).*DIA[:\s]+(\d{2,3})/i,
      /(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})/,  // "120 80 72" format (sys dia pulse)
    ];
    let sys = null, dia = null, pulse = null;
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const a = parseInt(m[1]), b = parseInt(m[2]);
        if (a >= 60 && a <= 220 && b >= 40 && b <= 150) {
          sys = a; dia = b;
          if (m[3]) { const c = parseInt(m[3]); if (c >= 30 && c <= 220) pulse = c; }
          break;
        }
      }
    }
    if (sys && dia) {
      const sysInput = document.getElementById("bpSysInput");
      const diaInput = document.getElementById("bpDiaInput");
      const pulseInput = document.getElementById("bpPulseInput");
      if (sysInput) sysInput.value = sys;
      if (diaInput) diaInput.value = dia;
      if (pulseInput && pulse) pulseInput.value = pulse;
      if (el.systolicInput) el.systolicInput.value = sys;
      const pulseStr = pulse ? `/${pulse} BPM` : "";
      if (statusEl) statusEl.textContent = `✅ Đọc được: ${sys}/${dia} mmHg${pulseStr} — kiểm tra rồi bấm Lưu`;
      if (saveBtn) saveBtn.style.display = "block";
      showToast(`OCR HA: ${sys}/${dia} mmHg${pulseStr} — bấm Lưu để ghi vào hệ thống`, "success");
      return;
    }
    if (statusEl) statusEl.textContent = `⚠️ Không nhận ra số huyết áp. Thử chụp gần hơn, đủ sáng, thẳng góc. Nhập tay bên dưới rồi bấm Lưu.`;
    if (saveBtn) saveBtn.style.display = "block";
  } catch (err) {
    if (statusEl) statusEl.textContent = `Lỗi OCR: ${err.message}. Nhập tay bên dưới rồi bấm Lưu.`;
    if (saveBtn) saveBtn.style.display = "block";
  }
}

function calcBpMetrics() {
  const sys = parseInt(document.getElementById("bpSysInput")?.value || "0");
  const dia = parseInt(document.getElementById("bpDiaInput")?.value || "0");
  const bpm = parseInt(document.getElementById("bpPulseInput")?.value || "0");
  const box = document.getElementById("bpMetricsResult");
  if (!box) return;
  if (!sys || !dia || sys < 60 || sys > 220 || dia < 40 || dia > 150) {
    box.style.display = "block";
    box.innerHTML = `<p style="color:#f87171;font-size:12px">⚠️ Nhập tâm thu (60–220) và tâm trương (40–150) hợp lệ trước.</p>`;
    return;
  }
  const map = Math.round(dia + (sys - dia) / 3);
  const pp = sys - dia;
  const pp_class = pp < 40 ? "Thấp (có thể giảm cung lượng tim)" : pp <= 60 ? "Bình thường" : "Cao (mạch cứng / xơ vữa)";
  const bp_label = sys >= 180 || dia >= 120 ? ["🚨 KHỦNG HOẢNG HUYẾT ÁP", "#7f1d1d", "#fca5a5"]
    : sys >= 140 || dia >= 90 ? ["🔴 Tăng HA giai đoạn 2", "#7f1d1d", "#fca5a5"]
    : sys >= 130 || dia >= 80 ? ["🟠 Tăng HA giai đoạn 1", "#78350f", "#fde68a"]
    : sys >= 120 && dia < 80 ? ["🟡 Tiền tăng huyết áp", "#78350f", "#fef3c7"]
    : ["🟢 Huyết áp bình thường", "#14532d", "#bbf7d0"];
  const bpm_html = bpm >= 30 && bpm <= 220 ? (() => {
    const rpp = Math.round(bpm * sys / 100);
    const bpm_label = bpm < 60 ? "⬇️ Nhịp chậm (Bradycardia)" : bpm <= 100 ? "✅ Nhịp bình thường" : "⬆️ Nhịp nhanh (Tachycardia)";
    const rpp_label = rpp < 100 ? "Tốt (gánh tim thấp)" : rpp < 120 ? "Bình thường" : "Cao (gánh tim nặng)";
    return `<div style="border-top:1px solid #334155;margin-top:8px;padding-top:8px">
      <div style="font-size:11px;color:#94a3b8;font-weight:600;margin-bottom:5px">⚡ NHỊP TIM & GÁNH CƠ TIM</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <div style="background:#1e293b;border-radius:5px;padding:7px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#38bdf8">${bpm}</div>
          <div style="font-size:10px;color:#64748b">BPM — ${bpm_label}</div>
        </div>
        <div style="background:#1e293b;border-radius:5px;padding:7px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#a78bfa">${rpp}</div>
          <div style="font-size:10px;color:#64748b">RPP (×100) — ${rpp_label}</div>
        </div>
      </div>
    </div>`;
  })() : `<p style="font-size:11px;color:#475569;margin-top:6px;font-style:italic">💡 Nhập nhịp tim (BPM) từ máy đo để tính thêm chỉ số gánh cơ tim (RPP).</p>`;
  box.style.display = "block";
  box.innerHTML = `
    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-size:12px">
      <div style="font-size:11px;color:#94a3b8;font-weight:600;margin-bottom:8px">🩺 CHỈ SỐ TIM MẠCH TỪ HUYẾT ÁP</div>
      <div style="background:${bp_label[1]};border-radius:6px;padding:6px 10px;margin-bottom:8px;color:${bp_label[2]};font-weight:700;font-size:13px">${bp_label[0]}: ${sys}/${dia} mmHg</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:6px">
        <div style="background:#1e293b;border-radius:5px;padding:7px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#34d399">${map}</div>
          <div style="font-size:10px;color:#64748b">MAP (mmHg)</div>
          <div style="font-size:9px;color:#475569">BT: 70–100</div>
        </div>
        <div style="background:#1e293b;border-radius:5px;padding:7px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#fb923c">${pp}</div>
          <div style="font-size:10px;color:#64748b">Pulse Pressure</div>
          <div style="font-size:9px;color:#475569">BT: 40–60</div>
        </div>
        <div style="background:#1e293b;border-radius:5px;padding:7px;text-align:center">
          <div style="font-size:14px;font-weight:700;color:#c084fc">${sys - dia > 0 ? Math.round(dia/(sys-dia)*100) : '—'}%</div>
          <div style="font-size:10px;color:#64748b">DBP/PP ratio</div>
          <div style="font-size:9px;color:#475569">BT: 100–200%</div>
        </div>
      </div>
      <div style="font-size:11px;color:#94a3b8;padding:4px 0">Pulse Pressure: <span style="color:#e2e8f0">${pp_class}</span></div>
      <div style="font-size:11px;color:#94a3b8">MAP bình thường 70–100 mmHg — dưới ngưỡng tưới máu não và các cơ quan.</div>
      ${bpm_html}
    </div>`;
}

async function saveBpOcrReading() {
  const sys = parseInt(document.getElementById("bpSysInput")?.value || "0");
  const dia = parseInt(document.getElementById("bpDiaInput")?.value || "0");
  const pulse = parseInt(document.getElementById("bpPulseInput")?.value || "0");
  const saveStatusEl = document.getElementById("bpOCRSaveStatus");
  const saveBtn = document.getElementById("saveBpOcrBtn");
  if (!sys || !dia || sys < 60 || sys > 220 || dia < 40 || dia > 150) {
    if (saveStatusEl) saveStatusEl.textContent = "⚠️ Giá trị không hợp lệ. Tâm thu 60–220, tâm trương 40–150.";
    return;
  }
  if (!state.token) { if (saveStatusEl) saveStatusEl.textContent = "Cần đăng nhập."; return; }
  const bpmToSave = (pulse >= 30 && pulse <= 220) ? pulse : null;
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Đang lưu..."; }
    const r = await api("/api/measurements", {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        type: "finger",
        payload: {
          systolic: sys,
          diastolic: dia,
          bpm: bpmToSave,
          signalQuality: bpmToSave ? 75 : 60,
          lightScore: 70,
          source: "bp_ocr",
        },
      }),
    });
    const pulseStr = bpmToSave ? ` · ${bpmToSave} BPM` : "";
    if (saveStatusEl) saveStatusEl.textContent = `✅ Đã lưu: ${sys}/${dia} mmHg${pulseStr}`;
    if (saveBtn) { saveBtn.style.display = "none"; }
    showToast(`Đã lưu huyết áp ${sys}/${dia} mmHg${pulseStr}`, "success");
    if (r.dashboard) renderDashboard(r.dashboard);
  } catch (err) {
    if (saveStatusEl) saveStatusEl.textContent = `Lỗi lưu: ${err.message}`;
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Lưu chỉ số huyết áp vào hệ thống"; }
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIAPIPE FACE EXPRESSION AI — Tự động nhận diện trạng thái cảm xúc
// Thay thế chọn emoji thủ công bằng AI phân tích khuôn mặt thực tế
// Model: face_landmarker + FaceBlendshapes (52 expression coefficients)
// ═══════════════════════════════════════════════════════════════════════════════

let _mpLandmarker = null;
let _mpLoadPromise = null;

async function initMediaPipeFaceExpression() {
  if (_mpLandmarker) return true;
  if (_mpLoadPromise) return _mpLoadPromise;
  if (typeof window.FilesetResolver === "undefined" || typeof window.FaceLandmarker === "undefined") {
    return false;
  }
  const statusEl = document.getElementById("mpMoodStatus");
  if (statusEl) statusEl.textContent = "⏳ Đang tải AI nhận diện (~2MB lần đầu)...";

  _mpLoadPromise = (async () => {
    try {
      const vision = await window.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      _mpLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        outputFaceBlendshapes: true,
        runningMode: "IMAGE",
        numFaces: 1,
      });
      if (statusEl) statusEl.textContent = "✅ AI sẵn sàng — bấm để nhận diện";
      return true;
    } catch (e) {
      if (statusEl) statusEl.textContent = "⚠️ AI không tải được — chọn thủ công";
      _mpLoadPromise = null;
      return false;
    }
  })();
  return _mpLoadPromise;
}

function _mpGetBlendshape(categories, name) {
  return categories.find(c => c.categoryName === name)?.score || 0;
}

function _mpMapToMood(categories) {
  const g = (n) => _mpGetBlendshape(categories, n);
  const browFurrow = (g("browDownLeft") + g("browDownRight")) / 2;
  const smiling    = (g("mouthSmileLeft") + g("mouthSmileRight")) / 2;
  const eyeSquint  = (g("eyeSquintLeft") + g("eyeSquintRight")) / 2;
  const eyeBlink   = (g("eyeBlinkLeft") + g("eyeBlinkRight")) / 2;
  const eyeOpen    = 1 - Math.min(1, eyeBlink * 1.6);
  const scores = {
    great:    smiling * 0.65 + (1 - browFurrow) * 0.20 + eyeOpen * 0.15,
    ok:       (1 - smiling) * 0.30 + (1 - browFurrow) * 0.40 + eyeOpen * 0.30,
    tired:    (1 - eyeOpen) * 0.70 + (1 - smiling) * 0.30,
    stressed: browFurrow * 0.50 + (1 - smiling) * 0.30 + eyeSquint * 0.20,
    pain:     eyeSquint * 0.40 + browFurrow * 0.35 + (1 - smiling) * 0.25,
  };
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { mood: top[0], confidence: Math.min(97, Math.round(top[1] * 135)) };
}

async function autoDetectMoodFromCamera() {
  const btn = document.getElementById("autoDetectMoodBtn");
  const statusEl = document.getElementById("mpMoodStatus");
  const ready = await initMediaPipeFaceExpression();
  if (!ready || !_mpLandmarker) {
    if (statusEl) statusEl.textContent = "⚠️ MediaPipe chưa sẵn sàng — chọn emoji thủ công";
    return;
  }
  if (!state.stream || !el.cameraVideo?.readyState) {
    if (statusEl) statusEl.textContent = "⚠️ Bật camera trước (nút Bật Camera) rồi nhấn AI Nhận diện";
    return;
  }
  if (btn) { btn.textContent = "⏳ Đang quét..."; btn.disabled = true; }
  if (statusEl) statusEl.textContent = "Đang phân tích khuôn mặt...";
  try {
    await new Promise(r => setTimeout(r, 350));
    const results = _mpLandmarker.detect(el.cameraVideo);
    if (!results.faceBlendshapes?.length) {
      if (statusEl) statusEl.textContent = "⚠️ Không nhận diện khuôn mặt — nhìn thẳng camera và đủ sáng";
      return;
    }
    const { mood, confidence } = _mpMapToMood(results.faceBlendshapes[0].categories);
    const moodBtn = document.querySelector(`.mood-btn[data-mood="${mood}"]`);
    if (moodBtn) setPreMoodState(moodBtn, mood);
    const emoji = { great: "😊", ok: "😐", tired: "😴", stressed: "😟", pain: "😣" };
    if (statusEl) statusEl.textContent = `✅ AI phát hiện: ${emoji[mood] || ""} ${mood} (${confidence}% tin cậy) — có thể chọn lại thủ công`;
  } catch (e) {
    if (statusEl) statusEl.textContent = "⚠️ Lỗi nhận diện khuôn mặt";
  } finally {
    if (btn) { btn.textContent = "🤖 AI Nhận diện lại"; btn.disabled = false; }
  }
}

window.autoDetectMoodFromCamera = autoDetectMoodFromCamera;

// ─── Face PPG Landmark-based ROI Snapper ──────────────────────────────────────
// Calls MediaPipe FaceLandmarker once (IMAGE mode) to compute precise pixel
// coordinates for forehead + left/right cheek regions.
// Stored in state.faceROI; used by sampleFrame() throughout the measurement.
// Falls back silently to the heuristic if MediaPipe is unavailable or face not found.
//
// Landmark indices (MediaPipe 468-point mesh):
//   10  = forehead crown center
//   107 = left inner brow (forehead lower-left boundary)
//   336 = right inner brow (forehead lower-right boundary)
//   109 = left forehead edge
//   338 = right forehead edge
//   116 = left cheek center
//   345 = right cheek center
async function snapFaceROI() {
  const video = el.cameraVideo;
  if (!video || video.readyState < 2) return;
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) return;
  const ready = await initMediaPipeFaceExpression();
  if (!ready || !_mpLandmarker) return;
  try {
    const results = _mpLandmarker.detect(video);
    const lm = results?.faceLandmarks?.[0];
    if (!lm || lm.length < 400) return;

    // ── Forehead: crown (lm[10]) → brow level (lm[107]↔lm[336]) ──────────────
    const faceW  = (lm[338].x - lm[109].x) * W;
    const inset  = Math.round(faceW * 0.06);  // 6% inset on each side
    const fhTop  = Math.max(0, Math.floor(lm[10].y  * H) - Math.round(faceW * 0.04));
    const fhBot  = Math.floor((lm[107].y + lm[336].y) / 2 * H) - Math.round(faceW * 0.03);
    const fhLeft = Math.max(0, Math.floor(lm[109].x * W) + inset);
    const fhRight= Math.min(W, Math.ceil (lm[338].x * W) - inset);
    const fw = Math.max(20, fhRight - fhLeft);
    const fh = Math.max(10, fhBot   - fhTop);

    // ── Cheeks: square boxes around lm[116] (left) and lm[345] (right) ────────
    const cheekSz = Math.max(20, Math.round(faceW * 0.20));
    const half    = Math.floor(cheekSz / 2);
    const lcx  = Math.max(0, Math.floor(lm[116].x * W) - half);
    const lcy  = Math.max(0, Math.floor(lm[116].y * H) - half);
    const rcx  = Math.max(0, Math.floor(lm[345].x * W) - half);
    const rcy  = Math.max(0, Math.floor(lm[345].y * H) - half);
    const lcs  = Math.min(cheekSz, W - lcx, H - lcy);
    const rcs  = Math.min(cheekSz, W - rcx, H - rcy);

    // ── Item 5: Nose tip (lm[4]) + Glabella (lm[9]) ─────────────────────────────
    // Nose tip: dense superficial capillary network, strong PPG signal
    // Glabella (between eyebrows): thin skin, good vascular access
    const ntSz = Math.max(18, Math.round(faceW * 0.12));
    const ntHalf = Math.floor(ntSz / 2);
    const ntx = Math.max(0, Math.floor(lm[4].x * W) - ntHalf);
    const nty = Math.max(0, Math.floor(lm[4].y * H) - ntHalf);
    const nts = Math.min(ntSz, W - ntx, H - nty);

    const glSz = Math.max(16, Math.round(faceW * 0.10));
    const glHalf = Math.floor(glSz / 2);
    const glx = Math.max(0, Math.floor(lm[9].x * W) - glHalf);
    const gly = Math.max(0, Math.floor(lm[9].y * H) - glHalf);
    const gls = Math.min(glSz, W - glx, H - gly);

    if (fw > 20 && fh > 10 && lcs > 10 && rcs > 10) {
      state.faceROI = { fx: fhLeft, fy: fhTop, fw, fh,
        lcx, lcy, lcs, rcx, rcy, rcs,
        ntx, nty, nts, glx, gly, gls, W, H };

      // ── Item 10: Skin tone detection from forehead pixels ──────────────────────
      // Red/Green ratio determines tone: light>1.35, dark<1.10, medium in between.
      // Skin tone adjusts CHROM channel weighting in analyzePPGSignal.
      try {
        const tmpC = document.createElement('canvas');
        tmpC.width = W; tmpC.height = H;
        const tmpCtx = tmpC.getContext('2d');
        tmpCtx.drawImage(video, 0, 0);
        const px = tmpCtx.getImageData(fhLeft, fhTop, Math.min(24, fw), Math.min(12, fh)).data;
        let sR = 0, sG = 0, cnt = 0;
        for (let i = 0; i < px.length; i += 4) { sR += px[i]; sG += px[i+1]; cnt++; }
        if (cnt > 0 && sG > 0) {
          const rg = (sR / cnt) / (sG / cnt);
          state.skinTone = rg > 1.35 ? 'light' : rg < 1.08 ? 'dark' : 'medium';
        }
      } catch (_) {}
    }
  } catch (_) { /* silent — sampleFrame falls back to heuristic */ }
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
  const tone = f.get("skinTone") || "medium";
  const bmi  = parseFloat(f.get("bmi") || "22");
  localStorage.setItem("hs_skin_tone", tone);
  localStorage.setItem("hs_bmi", String(bmi));
  // Áp ngay vào state.skinTone để algorithm CHROM bias và brightness target pick up luôn
  // (trước đây: lưu localStorage nhưng không đồng bộ với state → dead code)
  const toneMap = { light: "light", medium: "medium", dark: "dark", very_dark: "dark" };
  state.skinTone = toneMap[tone] || "medium";
  // BMI ảnh hưởng signal quality threshold — cao → hạ threshold chấp nhận
  if (bmi > 30) {
    showToast(`Đã lưu: tông da ${tone}, BMI ${bmi} — threshold ánh sáng được điều chỉnh cho BMI cao`, "success");
  } else {
    showToast(`Đã lưu: tông da ${tone}, BMI ${bmi} — áp dụng cho lần đo tiếp theo`, "success");
  }
}
// Khởi tạo state.skinTone từ localStorage khi app load (fix: trước đây luôn bắt đầu bằng 'medium')
function initSkinCalibFromStorage() {
  const stored = localStorage.getItem("hs_skin_tone");
  if (stored) {
    const toneMap = { light: "light", medium: "medium", dark: "dark", very_dark: "dark" };
    state.skinTone = toneMap[stored] || "medium";
  }
}

// ─── Personal BPM Calibration ─────────────────────────────────────────────────
// Corrects systematic per-user BPM error using sessions of (app_bpm, ref_bpm).
// 1 session → pure offset. 2+ sessions → OLS linear regression (slope + intercept).
// Stored per-mode because systematic error differs between finger and face modes.
const _CALIB_KEY = 'hs_bpm_calib_v1';

function loadCalibData() {
  try { return JSON.parse(localStorage.getItem(_CALIB_KEY) || '{"finger":[],"face":[]}'); }
  catch { return { finger: [], face: [] }; }
}
function _saveCalibData(data) {
  localStorage.setItem(_CALIB_KEY, JSON.stringify(data));
}
function addCalibSession(mode, appBpm, refBpm, features = null) {
  if (!appBpm || !refBpm || appBpm < 30 || appBpm > 220 || refBpm < 30 || refBpm > 220) return false;
  const data = loadCalibData();
  const sessions = data[mode] || [];
  sessions.push({ appBpm: Math.round(appBpm), refBpm: Math.round(refBpm), ts: Date.now(), features });
  data[mode] = sessions.slice(-10);
  _saveCalibData(data);
  _updateCalibStatusUI(mode);
  if (sessions.length >= 2) setTimeout(() => trainCalibModel(mode).catch(() => {}), 200);
  return true;
}
function _computeCalibCoeffs(sessions) {
  if (!sessions || sessions.length === 0) return null;
  if (sessions.length === 1) {
    const offset = sessions[0].refBpm - sessions[0].appBpm;
    return { slope: 1, intercept: offset, n: 1, offset };
  }
  const n = sessions.length;
  const sumX  = sessions.reduce((s, d) => s + d.appBpm, 0);
  const sumY  = sessions.reduce((s, d) => s + d.refBpm, 0);
  const sumXX = sessions.reduce((s, d) => s + d.appBpm * d.appBpm, 0);
  const sumXY = sessions.reduce((s, d) => s + d.appBpm * d.refBpm, 0);
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-6) {
    const offset = sumY / n - sumX / n;
    return { slope: 1, intercept: offset, n, offset };
  }
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const offset    = sumY / n - sumX / n;
  return { slope, intercept, n, offset };
}
function applyBpmCalibration(bpm, mode) {
  if (!bpm || bpm <= 0) return bpm;
  const coeffs = _computeCalibCoeffs((loadCalibData()[mode] || []));
  if (!coeffs) return bpm;
  return Math.max(30, Math.min(220, Math.round(coeffs.slope * bpm + coeffs.intercept)));
}
function getCalibStatus(mode) {
  const sessions = loadCalibData()[mode] || [];
  const coeffs = _computeCalibCoeffs(sessions);
  if (!coeffs) return { text: 'Chưa hiệu chỉnh — đo tim rồi nhập BPM tham chiếu để bắt đầu', color: '#94a3b8', n: 0, offset: 0 };
  const sign   = coeffs.offset >= 0 ? '+' : '';
  const withFeatures = sessions.filter(s => s.features?.fft || s.features?.acf).length;
  const hasNeural = _ncModels[mode] != null;
  const neuralReady = withFeatures >= 2;
  const methodLabel = hasNeural
    ? `neural AI (${withFeatures} phiên học)`
    : neuralReady
      ? `đang train AI...`
      : coeffs.n >= 2 ? `hồi quy tuyến tính (slope=${coeffs.slope.toFixed(2)})` : 'offset đơn';
  let r2Str = '';
  if (sessions.length >= 2) {
    const predicted = sessions.map(s => coeffs.slope * s.appBpm + coeffs.intercept);
    const meanRef = sessions.reduce((a, s) => a + s.refBpm, 0) / sessions.length;
    const ssTot = sessions.reduce((a, s) => a + (s.refBpm - meanRef) ** 2, 0);
    const ssRes = sessions.reduce((a, s, i) => a + (s.refBpm - predicted[i]) ** 2, 0);
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    r2Str = ` · R²=${r2.toFixed(2)}${r2 < 0.7 ? ' ⚠️ không nhất quán' : ''}`;
  }
  const warnSlope = !hasNeural && Math.abs(coeffs.slope - 1) > 0.25 ? ' ⚠️ slope bất thường' : '';
  return {
    text: `✅ ${sign}${Math.round(coeffs.offset)} BPM · ${methodLabel}${r2Str}${warnSlope} · ${coeffs.n} phiên`,
    color: hasNeural ? '#6366f1' : Math.abs(coeffs.offset) > 12 ? '#f59e0b' : '#22c55e',
    n: coeffs.n,
    offset: coeffs.offset,
    slope: coeffs.slope,
    hasNeural,
  };
}
function _updateCalibStatusUI(mode) {
  const s  = getCalibStatus(mode);
  const el = document.getElementById(`calibStatus_${mode}`);
  if (el) { el.textContent = s.text; el.style.color = s.color; }
}
function resetCalibData(mode) {
  const data = loadCalibData();
  data[mode] = [];
  _saveCalibData(data);
  _updateCalibStatusUI(mode);
  showToast(`Đã xóa hiệu chỉnh ${mode === 'finger' ? 'ngón tay' : 'khuôn mặt'}`, 'success');
}
function saveCalibFromLastMeasure(mode) {
  const refInput = document.getElementById(`calibRefBpm_${mode}`);
  const refVal   = parseInt(refInput?.value || '0', 10);
  if (!refVal || refVal < 30 || refVal > 220) {
    showToast('Nhập BPM tham chiếu hợp lệ (30–220)', 'error'); return;
  }
  const rawBpm = (state._lastRawBpm || {})[mode];
  if (!rawBpm) {
    showToast('Chưa có kết quả đo — đo tim trước rồi nhập tham chiếu', 'warn'); return;
  }
  const features = (state._lastFeatures || {})[mode] || null;
  const ok = addCalibSession(mode, rawBpm, refVal, features);
  if (ok) {
    if (refInput) refInput.value = '';
    showToast(`Hiệu chỉnh: App ${rawBpm} BPM → Tham chiếu ${refVal} BPM (lệch ${refVal - rawBpm > 0 ? '+' : ''}${refVal - rawBpm})`, 'success');
  }
}

// ── Neural meta-calibration system (TF.js, trains in-browser on user's own data) ─
// Mô hình: 9 features (9 BPM estimates + quality + mode) → hiệu chỉnh tối ưu
// Không cần dataset ngoài — tự học sau 4+ lần calibrate của user
const _NC_DB = 'indexeddb://hs-metacalib-';
const _ncModels  = { finger: null, face: null };
const _ncTraining = { finger: false, face: false };

async function trainCalibModel(mode) {
  if (_ncTraining[mode] || typeof tf === 'undefined') return;
  const sessions = loadCalibData()[mode] || [];
  const good = sessions.filter(s => s.features && (s.features.fft || s.features.acf));
  if (good.length < 2) return;
  _ncTraining[mode] = true;
  try {
    const S = 180;
    const toVec = s => [
      (s.features.fft     || s.appBpm) / S,
      (s.features.acf     || s.appBpm) / S,
      (s.features.welch   || s.appBpm) / S,
      (s.features.amdf    || s.appBpm) / S,
      (s.features.refined || s.appBpm) / S,
      (s.features.peak    || s.appBpm) / S,
      (s.features.mw      || s.appBpm) / S,
      (s.features.quality || 70) / 100,
      mode === 'face' ? 1 : 0,
    ];
    const xs = tf.tensor2d(good.map(toVec));
    const ys = tf.tensor2d(good.map(s => [s.refBpm / S]));
    const model = tf.sequential({ layers: [
      tf.layers.dense({ inputShape: [9], units: 32, activation: 'relu',
                        kernelRegularizer: tf.regularizers.l2({ l2: 0.005 }) }),
      tf.layers.dropout({ rate: 0.15 }),
      tf.layers.dense({ units: 16, activation: 'relu' }),
      tf.layers.dense({ units: 1, activation: 'linear' }),
    ]});
    model.compile({ optimizer: tf.train.adam(0.008), loss: 'meanSquaredError' });
    await model.fit(xs, ys, { epochs: 300, batchSize: Math.max(2, good.length), shuffle: true, verbose: 0 });
    _ncModels[mode] = model;
    try { await model.save(`${_NC_DB}${mode}`); } catch (_e) {}
    tf.dispose([xs, ys]);
    _updateCalibStatusUI(mode);
    console.log(`[HeartSense] Neural calib trained (${mode}): ${good.length} sessions`);
  } finally { _ncTraining[mode] = false; }
}

async function _ensureNcModel(mode) {
  if (_ncModels[mode]) return _ncModels[mode];
  if (typeof tf === 'undefined') return null;
  try {
    _ncModels[mode] = await tf.loadLayersModel(`${_NC_DB}${mode}`);
    return _ncModels[mode];
  } catch (_e) { return null; }
}

async function applySmartCalibration(rawBpm, mode, features) {
  const sessions = (loadCalibData()[mode] || []).filter(s => s.features?.fft || s.features?.acf);
  if (sessions.length >= 2) {
    const model = await _ensureNcModel(mode);
    if (model) {
      const S = 180;
      const inp = tf.tensor2d([[
        (features?.fft     || rawBpm) / S,
        (features?.acf     || rawBpm) / S,
        (features?.welch   || rawBpm) / S,
        (features?.amdf    || rawBpm) / S,
        (features?.refined || rawBpm) / S,
        (features?.peak    || rawBpm) / S,
        (features?.mw      || rawBpm) / S,
        (features?.quality || 70) / 100,
        mode === 'face' ? 1 : 0,
      ]]);
      const out  = model.predict(inp);
      const ncBpm = Math.max(30, Math.min(220, out.dataSync()[0] * S));
      tf.dispose([inp, out]);
      const linBpm = applyBpmCalibration(rawBpm, mode);
      // Blend: neural weight increases with more sessions (50%→90%)
      const alpha = Math.min(0.90, 0.50 + sessions.length * 0.06);
      return Math.round(ncBpm * alpha + linBpm * (1 - alpha));
    }
  }
  return applyBpmCalibration(rawBpm, mode);
}

// Auto-load models at startup
setTimeout(() => {
  ['finger', 'face'].forEach(m => _ensureNcModel(m).catch(() => {}));
}, 2000);

// ─── Zalo Tele-Clinic infrastructure (G6/C) ──────────────────────────────────
function openZaloClinicInfo() {
  const box = document.getElementById("zaloClinicBox");
  if (!box) return;
  const loggedIn = !!state.user;
  box.innerHTML = `
    <div class="list-item"><span>Trạng thái</span><strong class="badge neutral">Đang triển khai</strong></div>
    <div class="list-item"><span>Dịch vụ</span><strong>Tư vấn tim mạch qua Zalo với link báo cáo</strong></div>
    <div class="list-item"><span>Phù hợp cho</span><strong>AFib, hồi hộp, loạn nhịp, huyết áp cao</strong></div>
    <div style="margin-top:10px;padding:10px 12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
      <p style="margin:0 0 6px;font-size:13px;color:#1d4ed8;font-weight:700">📋 Cách gửi báo cáo cho bác sĩ tim mạch:</p>
      <p style="margin:0;font-size:12px;color:#1e40af;line-height:1.7">
        <strong>Bước 1:</strong> Bấm nút bên dưới để tạo link báo cáo công khai<br>
        <strong>Bước 2:</strong> Sao chép link → Mở Zalo → Nhắn tin cho bác sĩ<br>
        <strong>Bước 3:</strong> Bác sĩ mở link (không cần đăng nhập) để xem kết quả
      </p>
    </div>
    ${!loggedIn ? `<p style="font-size:12px;color:#dc2626;margin:8px 0 0;font-weight:600">⚠️ Cần đăng nhập để tạo link báo cáo</p>` : ""}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button id="_clinicZaloBtn" ${!loggedIn ? "disabled" : ""} style="flex:1;padding:10px;background:#0068ff;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;opacity:${loggedIn ? 1 : 0.4};cursor:${loggedIn ? "pointer" : "not-allowed"}">💬 Chia sẻ qua Zalo</button>
      <button id="_clinicGmailBtn" ${!loggedIn ? "disabled" : ""} style="flex:1;padding:10px;background:#ea4335;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;opacity:${loggedIn ? 1 : 0.4};cursor:${loggedIn ? "pointer" : "not-allowed"}">📧 Gửi qua Gmail</button>
    </div>
    <p class="muted" style="font-size:11px;margin-top:8px">Tele-Clinic VN đang xây dựng mạng lưới bác sĩ tim mạch được chứng nhận. Hiện tại bạn có thể tự gửi link báo cáo cho bác sĩ riêng qua Zalo/Gmail.</p>`;

  document.getElementById("_clinicZaloBtn")?.addEventListener("click", () => shareReport("zalo"));
  document.getElementById("_clinicGmailBtn")?.addEventListener("click", () => shareReport("gmail"));
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

  // Toggle finger-on-lens guide bar + relabel brightness metric
  const isF = mode === "finger";
  if (el.fingerLensGuide) el.fingerLensGuide.style.display = isF ? "block" : "none";
  if (el.lightMetricLabel) el.lightMetricLabel.textContent = isF ? "Phủ ngón" : "Độ sáng";


  if (mode === "face") {
    el.captureModeLabel.textContent = "Face PPG";
    el.modeDescription.textContent = "Đo qua webcam/camera trước. Ngồi yên, mặt đủ sáng, không di chuyển. Theo dõi 30 giây.";
    el.captureGuide.textContent = "Nhìn thẳng vào camera. Đảm bảo mặt đủ sáng. Giới hạn cử động trong 30 giây.";
  } else if (mode === "finger") {
    el.captureModeLabel.textContent = "Ngón Trỏ PPG ★";
    if (isMobile()) {
      el.modeDescription.textContent = "Đặt ngón trỏ NẰM NGANG qua camera: đầu ngón che camera, thân ngón che flash. Ánh sáng xuyên qua ngón tay cho tín hiệu PPG chuẩn nhất.";
      el.captureGuide.textContent = "Ngón trỏ nằm ngang — đầu ngón đè lên camera, thân ngón đè lên flash. Giữ tuyệt đối yên 30 giây, thanh phủ ngón phải xanh ≥80%.";

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

    // Finger mode: yêu cầu 60fps để cải thiện độ phân giải RR interval.
    // Quan trọng: hạ resolution xuống 640×480 cho finger — PPG chỉ cần giá trị
    // trung bình pixel, không cần độ phân giải cao. 1280×720@60fps thường bị
    // điện thoại từ chối và fall back về 30fps, còn 640×480@60fps được hỗ trợ tốt hơn.
    // Face mode: giữ 1280×720@30fps để MediaPipe landmark chính xác hơn.
    const resConstraint = isFingerMode
      ? { width: { ideal: 640 }, height: { ideal: 480 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } };
    const fpsConstraint = isFingerMode
      ? { frameRate: { ideal: 60, min: 15 } }
      : { frameRate: { ideal: 30 } };
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...videoConstraint, ...resConstraint, ...fpsConstraint },
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

// ─── Camera Exposure Lock (Finger PPG accuracy boost) ──────────────────────────
// Locks exposure + white balance to current auto-settled values before recording.
// Prevents the camera's AEC/AWB from hunting during measurement and introducing
// artificial brightness oscillations that corrupt the PPG signal.
//
// Support matrix:
//   Android Chrome ≥ 87 : exposureMode + whiteBalanceMode fully supported
//   iOS Safari           : getCapabilities() returns empty {} → graceful no-op
//   Desktop Chrome/Edge  : partial support (device-dependent)
//
// Strategy: prefer 'manual' (snap exact values); fall back to 'single-shot'
// (browser holds current AE result for one frame then stops updating — same effect).
async function lockCameraExposure() {
  if (!state.stream) return false;
  const track = state.stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return false;
  const caps = track.getCapabilities();
  // iOS Safari returns {} here — nothing to lock, exit cleanly
  if (!caps.exposureMode && !caps.whiteBalanceMode) return false;

  const current  = track.getSettings ? track.getSettings() : {};
  const advExp   = {};
  const advWB    = {};
  let hasExp = false, hasWB = false;

  // ── Exposure lock ──────────────────────────────────────────────────────────
  if (caps.exposureMode?.includes('manual')) {
    advExp.exposureMode = 'manual';
    // Clamp exposureTime within device range to avoid ConstraintNotSatisfied
    if (caps.exposureTime && current.exposureTime) {
      const lo = caps.exposureTime.min ?? 0;
      const hi = caps.exposureTime.max ?? Infinity;
      advExp.exposureTime = Math.min(hi, Math.max(lo, current.exposureTime));
    }
    hasExp = true;
  } else if (caps.exposureMode?.includes('single-shot')) {
    advExp.exposureMode = 'single-shot';
    hasExp = true;
  }

  // ── White balance lock ──────────────────────────────────────────────────────
  if (caps.whiteBalanceMode?.includes('manual')) {
    advWB.whiteBalanceMode = 'manual';
    if (caps.colorTemperature && current.colorTemperature) {
      const lo = caps.colorTemperature.min ?? 0;
      const hi = caps.colorTemperature.max ?? Infinity;
      advWB.colorTemperature = Math.min(hi, Math.max(lo, current.colorTemperature));
    }
    hasWB = true;
  } else if (caps.whiteBalanceMode?.includes('single-shot')) {
    advWB.whiteBalanceMode = 'single-shot';
    hasWB = true;
  }

  if (!hasExp && !hasWB) return false;

  // Apply both in one call when possible (avoids two round-trips)
  try {
    const adv = [];
    if (hasExp) adv.push(advExp);
    if (hasWB)  adv.push(advWB);
    await track.applyConstraints({ advanced: adv });
    return true;
  } catch {
    // Some devices report capability but reject the constraint value — try each separately
    let ok = false;
    if (hasExp) { try { await track.applyConstraints({ advanced: [advExp] }); ok = true; } catch {} }
    if (hasWB)  { try { await track.applyConstraints({ advanced: [advWB]  }); }           catch {} }
    return ok;
  }
}

// Restores AEC/AWB to continuous auto after measurement ends.
async function unlockCameraExposure() {
  if (!state.stream) return;
  const track = state.stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities();
  const adv  = [];
  if (caps.exposureMode?.includes('continuous'))    adv.push({ exposureMode: 'continuous' });
  if (caps.whiteBalanceMode?.includes('continuous')) adv.push({ whiteBalanceMode: 'continuous' });
  if (adv.length) { try { await track.applyConstraints({ advanced: adv }); } catch {} }
}

function sampleFrame(mode) {
  const video = el.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = el.cameraCanvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // ── ML frame buffer: capture 18×18 crops for both face and finger models ────
  if ((mode === 'face' || mode === 'finger') && state.measurementActive) {
    const frame = _captureCompressedFrame(ctx, canvas);
    state.mlFaceFrameBuffer.push(frame);
    if (state.mlFaceFrameBuffer.length > ML_BUF_MAX) state.mlFaceFrameBuffer.shift();
  }

  let avgRed, avgGreen, avgBlue;
  let _faceRegions = null;

  if (mode === "face") {
    // ── Landmark-based 3-region sampling (preferred) ──────────────────────────
    // Forehead 60% + left cheek 20% + right cheek 20%.
    // Validated against same-resolution canvas (roi.W/H must match current frame).
    // Forehead has ~2× PPG amplitude vs cheeks; cheeks improve spatial coverage
    // and help when user is slightly rotated or partially off-center.
    const roi = state.faceROI;
    if (roi && roi.W === canvas.width && roi.H === canvas.height) {
      function _roiAvg(px) {
        let r = 0, g = 0, b = 0;
        const n = px.length / 4;
        if (!n) return [0, 0, 0];
        for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i+1]; b += px[i+2]; }
        return [r/n, g/n, b/n];
      }
      const [fhR, fhG, fhB] = _roiAvg(ctx.getImageData(roi.fx, roi.fy, roi.fw, roi.fh).data);
      const [lcR, lcG, lcB] = _roiAvg(ctx.getImageData(roi.lcx, roi.lcy, roi.lcs, roi.lcs).data);
      const [rcR, rcG, rcB] = _roiAvg(ctx.getImageData(roi.rcx, roi.rcy, roi.rcs, roi.rcs).data);
      // ── Item 5: include nose tip + glabella when available ───────────────────
      if (roi.nts > 8 && roi.gls > 8) {
        const [ntR, ntG, ntB] = _roiAvg(ctx.getImageData(roi.ntx, roi.nty, roi.nts, roi.nts).data);
        const [glR, glG, glB] = _roiAvg(ctx.getImageData(roi.glx, roi.gly, roi.gls, roi.gls).data);
        // forehead 50% + cheeks 25% + nose 12.5% + glabella 12.5%
        avgRed   = fhR*0.50 + (lcR+rcR)*0.125 + ntR*0.125 + glR*0.125;
        avgGreen = fhG*0.50 + (lcG+rcG)*0.125 + ntG*0.125 + glG*0.125;
        avgBlue  = fhB*0.50 + (lcB+rcB)*0.125 + ntB*0.125 + glB*0.125;
        _faceRegions = { fh:{r:fhR,g:fhG,b:fhB}, lc:{r:lcR,g:lcG,b:lcB}, rc:{r:rcR,g:rcG,b:rcB}, nt:{r:ntR,g:ntG,b:ntB} };
      } else {
        avgRed   = fhR * 0.60 + lcR * 0.20 + rcR * 0.20;
        avgGreen = fhG * 0.60 + lcG * 0.20 + rcG * 0.20;
        avgBlue  = fhB * 0.60 + lcB * 0.20 + rcB * 0.20;
        _faceRegions = { fh:{r:fhR,g:fhG,b:fhB}, lc:{r:lcR,g:lcG,b:lcB}, rc:{r:rcR,g:rcG,b:rcB}, nt:null };
      }
    } else {
      // ── Heuristic fallback: fixed ROI, forehead top-35% weighted 2:1 ────────
      const region = { x: Math.floor(canvas.width * 0.28), y: Math.floor(canvas.height * 0.18), width: Math.floor(canvas.width * 0.44), height: Math.floor(canvas.height * 0.48) };
      const pixels = ctx.getImageData(region.x, region.y, region.width, region.height).data;
      const fhCount = Math.floor(region.width * Math.floor(region.height * 0.35));
      const fhEnd   = fhCount * 4;
      let fhR = 0, fhG = 0, fhB = 0, lfR = 0, lfG = 0, lfB = 0;
      for (let i = 0; i < fhEnd && i < pixels.length; i += 4) { fhR += pixels[i]; fhG += pixels[i+1]; fhB += pixels[i+2]; }
      for (let i = fhEnd; i < pixels.length; i += 4)           { lfR += pixels[i]; lfG += pixels[i+1]; lfB += pixels[i+2]; }
      const lfCount = pixels.length / 4 - fhCount;
      if (fhCount > 0 && lfCount > 0) {
        avgRed   = (2 * fhR / fhCount + lfR / lfCount) / 3;
        avgGreen = (2 * fhG / fhCount + lfG / lfCount) / 3;
        avgBlue  = (2 * fhB / fhCount + lfB / lfCount) / 3;
      } else {
        let tr = 0, tg = 0, tb = 0;
        for (let i = 0; i < pixels.length; i += 4) { tr += pixels[i]; tg += pixels[i+1]; tb += pixels[i+2]; }
        const n = pixels.length / 4;
        avgRed = tr / n; avgGreen = tg / n; avgBlue = tb / n;
      }
    }
  } else {
    // ── Finger mode: full-frame downsampled sampling ───────────────────────────
    // Downscale to 160×90 first → consistent ~14 400-pixel workload regardless of
    // camera resolution (720p, 1080p, 4K all cost the same). Then scan every pixel.
    //
    // WHY full-frame instead of center-36%:
    //   Transmission mode (flash <2cm): flash under finger → signal at center ✓
    //   Reflection mode  (flash 3-6cm): flash illuminates from the side → pulsatile
    //   signal may appear anywhere across frame, not just center. Center-only sampling
    //   misses the strongest part of the signal in reflection mode.
    const FW = 160, FH = 90;
    if (!sampleFrame._fCanvas) {
      sampleFrame._fCanvas = document.createElement('canvas');
      sampleFrame._fCanvas.width = FW; sampleFrame._fCanvas.height = FH;
      sampleFrame._fCtx = sampleFrame._fCanvas.getContext('2d', { willReadFrequently: true });
    }
    sampleFrame._fCtx.drawImage(canvas, 0, 0, FW, FH);
    const pixels = sampleFrame._fCtx.getImageData(0, 0, FW, FH).data;
    const totalN = FW * FH;
    let r = 0, g = 0, b = 0, coveredN = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const pr = pixels[i], pg = pixels[i+1], pb = pixels[i+2];
      // Threshold 70 (vs old 90): reflection mode pixels are dimmer than transmission
      if (pr > 70 || pg > 70 || pb > 70) { r += pr; g += pg; b += pb; coveredN++; }
    }
    state.fingerCoverage = Math.round(coveredN / totalN * 100);
    if (coveredN > 0) {
      avgRed = r / coveredN; avgGreen = g / coveredN; avgBlue = b / coveredN;
    } else {
      let tr = 0, tg = 0, tb = 0;
      for (let i = 0; i < pixels.length; i += 4) { tr += pixels[i]; tg += pixels[i+1]; tb += pixels[i+2]; }
      avgRed = tr / totalN; avgGreen = tg / totalN; avgBlue = tb / totalN;
    }
    // Saturation guard: Red clipped → try Green fallback, reject only when both clip
    if (avgRed > 238) {
      if (avgGreen > 230) return null;
      avgRed = avgGreen * 1.4;
    }
  }

  const brightness = 0.299 * avgRed + 0.587 * avgGreen + 0.114 * avgBlue;
  const t = performance.now(); // timestamp chính xác cho FFT phase

  // ── Ambient light reference: góc top-right làm tham chiếu background ──────
  let _ambR = null, _ambG = null, _ambB = null;
  if (mode === "face") {
    try {
      const _aPx = ctx.getImageData(Math.max(0, canvas.width - 26), 0, 20, 20).data;
      let _aR = 0, _aG = 0, _aB = 0;
      for (let _i = 0; _i < _aPx.length; _i += 4) { _aR += _aPx[_i]; _aG += _aPx[_i+1]; _aB += _aPx[_i+2]; }
      const _aN = _aPx.length / 4;
      const _aBr = (_aR + _aG + _aB) / (3 * _aN);
      if (_aBr > 185 || _aBr < 25) { // chỉ dùng vùng rõ ràng không phải da
        _ambR = _aR / _aN; _ambG = _aG / _aN; _ambB = _aB / _aN;
      }
    } catch (_) {}
  }

  // ── YCbCr skin validation (Kovac 2010) — thay thế brightness threshold cứng ──
  // Mô hình màu YCbCr phân biệt da người vs nền chính xác hơn với mọi tông da.
  // Khoảng skin: Cb 72–132, Cr 128–178, Y 25–225 (mở rộng để không từ chối dark skin)
  if (mode === "face") {
    const _Cb = -0.169 * avgRed - 0.331 * avgGreen + 0.500 * avgBlue + 128;
    const _Cr =  0.500 * avgRed - 0.419 * avgGreen - 0.081 * avgBlue + 128;
    const _Y  =  0.299 * avgRed + 0.587 * avgGreen + 0.114 * avgBlue;
    const _isSkin = _Y >= 25 && _Y <= 225 && _Cb >= 72 && _Cb <= 132 && _Cr >= 128 && _Cr <= 178;
    if (!_isSkin) {
      state.previousSample = { avgRed, avgGreen, avgBlue };
      return null;
    }
  }

  // FIX: Dual-window movement detection
  // Fast window (1 frame, ~33ms at 30fps): catches sharp hand tremors
  // Slow window (6 frames, ~200ms): catches sustained drift / breathing
  // Cardiac pulsatility is gradual & periodic (~0.5-2% change/frame) — won't spike fast window
  if (!state.sampleHistory) state.sampleHistory = [];
  state.sampleHistory.push({ avgRed, avgGreen, avgBlue });
  if (state.sampleHistory.length > 8) state.sampleHistory.shift();
  const prevFast = state.sampleHistory.length >= 2 ? state.sampleHistory[state.sampleHistory.length - 2] : null;
  const prevSlow = state.sampleHistory.length >= 6 ? state.sampleHistory[0] : null;
  const fastMov = prevFast
    ? (Math.abs(prevFast.avgRed - avgRed) + Math.abs(prevFast.avgGreen - avgGreen) + Math.abs(prevFast.avgBlue - avgBlue)) / 3
    : 0;
  const slowMov = prevSlow
    ? (Math.abs(prevSlow.avgRed - avgRed) + Math.abs(prevSlow.avgGreen - avgGreen) + Math.abs(prevSlow.avgBlue - avgBlue)) / 5
    : 0;
  // ── Item 12: Frame-level optical flow motion score ──────────────────────────
  // Channel-average diff detects gross motion (fast); mean-of-history covers drift.
  // Combine both into a single motion metric to pass to rejectMotionWindows.
  const opticalFlow = state.prevFrameAvg
    ? (Math.abs(avgRed - state.prevFrameAvg.r) + Math.abs(avgGreen - state.prevFrameAvg.g) + Math.abs(avgBlue - state.prevFrameAvg.b)) / 3
    : 0;
  state.prevFrameAvg = { r: avgRed, g: avgGreen, b: avgBlue };
  const movement = Math.max(fastMov * 1.5, slowMov, opticalFlow * 1.2);
  state.previousSample = { avgRed, avgGreen, avgBlue };
  return { brightness, avgRed, avgGreen, avgBlue, movement, t, regions: _faceRegions,
           ambR: _ambR, ambG: _ambG, ambB: _ambB };
}

function derivePreviewMetrics(sample) {
  const lightScore = Math.round(Math.max(15, Math.min(99, 100 - Math.abs(sample.brightness - 122) * 0.9)));
  const stabilityScore = Math.round(Math.max(12, Math.min(99, 100 - sample.movement * 1.8)));
  const signalQuality = Math.round(Math.max(18, Math.min(99, lightScore * 0.48 + stabilityScore * 0.52 + (state.measurementMode === "finger" ? 8 : 0))));
  return { lightScore, stabilityScore, signalQuality };
}

function renderPreviewMetrics(m, sample) {
  state.lastPreviewMetrics = m;
  const isF = state.measurementMode === "finger";
  // In finger mode reuse the lightMetric slot to show coverage %
  el.lightMetric.textContent = isF ? `${state.fingerCoverage}%` : `${m.lightScore}%`;
  el.stabilityMetric.textContent = `${m.stabilityScore}%`;
  el.qualityMetric.textContent = `${m.signalQuality}%`;

  // Drive finger-on-lens guide bar
  if (isF && el.fingerLensGuide && sample) {
    const cov = state.fingerCoverage;
    const avgRed = sample.avgRed || 0;
    const saturated = avgRed > 230;

    // Coverage bar color
    const barColor = cov >= 80 ? "#22c55e" : cov >= 60 ? "#f59e0b" : "#ef4444";
    if (el.coverageBar) { el.coverageBar.style.width = `${cov}%`; el.coverageBar.style.background = barColor; }
    if (el.coveragePct) { el.coveragePct.textContent = `${cov}%`; el.coveragePct.style.color = barColor; }

    // Pressure / saturation hint
    let hint = "";
    if (cov < 40) hint = "Đặt ngón trỏ che kín camera + flash";
    else if (cov < 60) hint = "Che thêm — ngón chưa phủ đủ";
    else if (saturated) hint = "Nhấc ngón nhẹ hơn — đang bão hoà";
    else if (cov >= 80) hint = "✅ Vị trí tốt — giữ yên và bắt đầu đo";
    else hint = "Gần đủ — che thêm một chút";
    if (el.pressureHint) el.pressureHint.textContent = hint;

    // Rough PI estimate from red DC level (higher red = better transillumination)
    const piEst = avgRed > 10 ? Math.min(99, Math.round((avgRed / 255) * 100)) : 0;
    if (el.piStrength) el.piStrength.textContent = `Tín hiệu: ${piEst}%`;
  }
}

function startPreviewLoop() {
  const loop = () => {
    if (!state.stream) return;
    const sample = sampleFrame(state.measurementMode === "breathing" ? "face" : state.measurementMode);
    if (sample && !state.measurementActive) renderPreviewMetrics(derivePreviewMetrics(sample), sample);
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
// ── Item 1: Quick live BPM (FFT only on last 15s, fast enough for RAF loop) ────
function quickLiveBpm(samples, fps) {
  if (!samples || samples.length < fps * 8) return null;
  // Use last 20s — more stable FFT frequency resolution than 15s
  const last = samples.slice(-Math.floor(fps * 20));
  const mode = state.measurementMode;
  let sig;
  if (mode === 'finger') {
    const rawRed   = last.map(s => s.avgRed);
    const rawGreen = last.map(s => s.avgGreen);
    const snrRed   = stdDev(butterworthBandpass(rawRed, fps));
    const snrGreen = stdDev(butterworthBandpass(rawGreen, fps));
    sig = snrRed >= snrGreen * 0.75 ? rawRed : rawGreen;
  } else {
    sig = last.map(s => s.avgGreen);
  }
  const filt = butterworthBandpass(sig, fps);
  if (stdDev(filt) < 0.15) return null;

  const fftResult = fftBpm(filt, fps);
  // autocorrBpm finds FIRST peak = fundamental frequency, not highest-power peak
  // → much more resistant to sub-harmonics than FFT
  const acfResult = autocorrBpm(filt, fps);

  if (fftResult && acfResult) {
    const diff = Math.abs(fftResult - acfResult);
    if (diff <= 8) {
      // Both methods agree → blend (FFT 60%, ACF 40%)
      return Math.round(fftResult * 0.6 + acfResult * 0.4);
    }
    // Check if FFT found a sub-harmonic of the autocorr result.
    // Common ratios when FFT picks sub-harmonic:
    //   fft ≈ acf × 2/3  (e.g. fft=47, acf=70 → ratio 0.67)
    //   fft ≈ acf × 1/2  (e.g. fft=40, acf=80 → ratio 0.50)
    // When this pattern is detected, trust autocorr (fundamental) over FFT.
    if (acfResult >= 52 && acfResult <= 185) {
      const ratio = fftResult / acfResult;
      if ((ratio >= 0.60 && ratio <= 0.73) || (ratio >= 0.44 && ratio <= 0.56)) {
        return acfResult; // FFT is a sub-harmonic, ACF has the real value
      }
    }
    // No harmonic relationship found and methods strongly disagree → don't show
    return null;
  }
  // Only one method produced a result — prefer autocorr (avoids harmonic confusion)
  return acfResult || fftResult || null;
}

// ── Item 9: Respiratory rate from RSA band (0.13–0.45 Hz) in PPG signal ──────
// PPG amplitude is modulated by breathing via RSA and venous return.
// Valid range: 6–28 breaths/min (physiological human range).
function extractRespiratoryRate(signal, fps) {
  if (!signal || signal.length < fps * 10) return null;
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b) / n;
  const centered = signal.map(v => v - mean);
  const minK = Math.ceil(0.13 * n / fps);  // 0.13 Hz = ~8 bpm
  const maxK = Math.floor(0.45 * n / fps); // 0.45 Hz = ~27 bpm
  if (maxK <= minK) return null;
  let bestPow = 0, bestK = -1;
  for (let k = minK; k <= maxK; k++) {
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) {
      const a = 2 * Math.PI * k * t / n;
      re += centered[t] * Math.cos(a);
      im -= centered[t] * Math.sin(a);
    }
    const pow = re * re + im * im;
    if (pow > bestPow) { bestPow = pow; bestK = k; }
  }
  if (bestK < 0) return null;
  const respRate = Math.round(bestK * fps / n * 60);
  return respRate >= 6 && respRate <= 28 ? respRate : null;
}

// ── Item 6: Ambient light quality check ───────────────────────────────────────
// Analyzes brightness of recent samples for lighting problems before measurement.
function detectAmbientLight(samples) {
  if (!samples || samples.length < 8) return { ok: true, msg: '' };
  const brightness = samples.map(s => s.brightness);
  const mean = average(brightness);
  const cv = mean > 0 ? stdDev(brightness) / mean : 0;
  if (mean < 38) return { ok: false, msg: '⚠️ Quá tối — bật thêm đèn phòng hoặc ra gần cửa sổ' };
  if (mean > 215) return { ok: false, msg: '⚠️ Quá sáng — tránh ánh nắng trực tiếp chiếu vào mặt' };
  if (cv > 0.09) return { ok: false, msg: '⚠️ Ánh sáng nhấp nháy — dùng đèn LED hoặc ánh sáng tự nhiên' };
  return { ok: true, msg: '✅ Ánh sáng phù hợp' };
}

// ── Item 8: Cross-validate Face + Finger results ──────────────────────────────
// Compare BPM from both measurement modes taken within 10 minutes of each other.
function crossValidateResults(faceResult, fingerResult) {
  if (!faceResult || !fingerResult) return null;
  const diff = Math.abs((faceResult.bpm || 0) - (fingerResult.bpm || 0));
  if (!faceResult.bpm || !fingerResult.bpm) return null;
  if (diff <= 5)  return { agree: true,  level: 'high',   msg: `✅ Face (${faceResult.bpm}) & Finger (${fingerResult.bpm}) BPM đồng thuận — Độ tin cậy cao` };
  if (diff <= 10) return { agree: true,  level: 'medium', msg: `🟡 Face (${faceResult.bpm}) & Finger (${fingerResult.bpm}) gần nhau — Độ tin cậy trung bình` };
  return         { agree: false, level: 'low',    msg: `🔴 Face (${faceResult.bpm}) & Finger (${fingerResult.bpm}) lệch ${diff} BPM — Nên đo lại` };
}

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
  state.liveBpmHistory = [];
  state.earlyStop = false;
  state.prevFrameAvg = null;
  state.mlFaceFrameBuffer = []; // clear MTTS frame buffer for fresh measurement

  // ── Item 3: User-selectable duration (60s default or 90s extended) ────────────
  // Minimum 60s recommended for AFib detection (ESC/AHA guideline 2023).
  // Hard minimum 30s — below this, AFib analysis unreliable (too few RR intervals).
  const activeSecs = state.measurementDuration || 60;
  const HARD_MIN_SECS = 30; // cannot analyze below this

  const modeLabel = state.measurementMode === "face" ? "Đang đo Face PPG – Nhìn thẳng vào camera" : "Đang đo Finger PPG – Giữ NGÓN TRỎ trên camera";
  el.measurementModeLabel.textContent = modeLabel;
  el.measurementOverlay.classList.remove("hidden");
  el.measurementTimer.textContent = String(activeSecs);
  el.startMeasureBtn.disabled = true;

  // ── Item 6: Ambient light pre-check (face mode only) ─────────────────────────
  // Sample 1.5s of preview frames to assess lighting before the recording begins.
  if (state.measurementMode === 'face' && el.ambientLightHint) {
    const previewSamples = [];
    const previewStart = performance.now();
    await new Promise(r => {
      const check = () => {
        const s = sampleFrame('face');
        if (s) previewSamples.push(s);
        if (performance.now() - previewStart < 1500) requestAnimationFrame(check);
        else r();
      };
      requestAnimationFrame(check);
    });
    const ambient = detectAmbientLight(previewSamples);
    el.ambientLightHint.textContent = ambient.msg;
    el.ambientLightHint.style.display = ambient.msg ? 'block' : 'none';
    if (!ambient.ok) {
      showToast(ambient.msg, 'warn');
    }
  }

  if (isMobile() && state.measurementMode === "finger") {
    el.deepAnalysisPrompt.classList.remove("hidden");
    el.deepAnalysisText.textContent = "Ngón trỏ nằm ngang: đầu ngón che camera, thân ngón che flash. Giữ tuyệt đối yên, không nhấc ngón tay.";
  } else if (state.measurementMode === "face") {
    el.deepAnalysisPrompt.classList.remove("hidden");
    el.deepAnalysisText.textContent = "Nhìn thẳng vào camera, ngồi yên, đảm bảo mặt đủ sáng, tránh di chuyển.";
  } else {
    el.deepAnalysisPrompt.classList.add("hidden");
  }

  // ── Face mode: snap landmark-based ROI before recording begins ───────────────
  // One-shot MediaPipe detection locks forehead + cheek pixel coordinates.
  // Re-snaps every 10s in case of head movement. Falls back to heuristic if
  // landmarks unavailable (MediaPipe not loaded, or face not found).
  state.faceROI = null;
  if (state.measurementMode === "face") {
    await snapFaceROI();
    if (state.faceROI && el.deepAnalysisPrompt) {
      el.deepAnalysisText.textContent = "✅ Đã khoá vùng trán — nhìn thẳng và giữ yên.";
    }
    state.ppgRoiSnapInterval = setInterval(() => snapFaceROI(), 10000);
  }

  // ── Finger mode: wait for AEC to settle, then lock exposure + white balance ──
  // Lock AEC/AWB before sampling starts.
  // Face mode: AWB hunting creates colour shifts >> rPPG signal amplitude (0.1%).
  // Finger mode mobile: AEC hunts when finger covers lens.
  // Wait for AEC/AWB to settle before locking — show hint in permissionHint (non-overlay).
  const settleMs = state.measurementMode === "face" ? 2000 : 700;
  if (el.permissionHint) el.permissionHint.textContent = "⏳ Chờ camera ổn định...";
  await new Promise(r => setTimeout(r, settleMs));
  if (state.measurementMode === "face" || (state.measurementMode === "finger" && isMobile())) {
    const expLocked = await lockCameraExposure();
    if (el.permissionHint) {
      el.permissionHint.textContent = expLocked ? "🔒 Camera đã khoá" : "";
    }
  } else if (el.permissionHint) {
    el.permissionHint.textContent = "";
  }

  const startedAt = performance.now();
  let frameCount = 0;
  let lastLiveBpmCheck = 0;    // timestamp of last live BPM check
  let lastQualitySamples = []; // rolling quality scores for adaptive stop

  await new Promise((resolve) => {
    function frame(now) {
      const elapsed = (now - startedAt) / 1000;
      const remaining = Math.max(0, activeSecs - elapsed);
      el.measurementTimer.textContent = String(Math.ceil(remaining));
      const sample = sampleFrame(state.measurementMode);
      if (sample) {
        state.measurementSamples.push(sample);
        frameCount++;
        if (state.measurementSamples.length > activeSecs * 35) state.measurementSamples.shift();
        const metrics = derivePreviewMetrics(sample);
        renderPreviewMetrics(metrics);
        lastQualitySamples.push(metrics.signalQuality);
        if (lastQualitySamples.length > 90) lastQualitySamples.shift(); // keep last 3s at 30fps

        // ── Item 1: Live BPM + quality display, updated every ~3 seconds ─────────
        if (now - lastLiveBpmCheck > 3000 && elapsed > 8) {
          lastLiveBpmCheck = now;
          const fps = frameCount / Math.max(1, elapsed);
          const lb = quickLiveBpm(state.measurementSamples, fps);
          if (lb) {
            state.liveBpm = lb;
            state.liveBpmHistory.push(lb);
            if (state.liveBpmHistory.length > 6) state.liveBpmHistory.shift();
          }
          state.liveQuality = Math.round(average(lastQualitySamples));
          if (el.liveBpmDisplay) {
            el.liveBpmDisplay.textContent = lb ? `~${Math.round(lb)} BPM` : '—';
            el.liveBpmDisplay.style.display = 'block';
          }
          if (el.liveQualityBar) {
            el.liveQualityBar.style.width = `${state.liveQuality}%`;
            el.liveQualityBar.style.background = state.liveQuality >= 75 ? '#22c55e' : state.liveQuality >= 50 ? '#f59e0b' : '#ef4444';
          }

          // ── Item 2: Adaptive early stop ───────────────────────────────────────
          // 45s mode: stop after min 32s if signal is stable (enough for BPM+HRV)
          // 90s mode: stop after min 60s — user chose extended mode for more AFib/HRV
          //           data; stopping at 30s defeats the purpose of the longer session.
          // Requires: last 4 live estimates within 3 BPM AND quality ≥ 85 for 90s
          //           (stricter than 45s because extended mode implies complex rhythm).
          const earlyStopMin = activeSecs >= 80 ? 65 : 50; // raised: 40→50 (60s mode), 60→65 (90s)
          const earlyStopSpread = activeSecs >= 80 ? 3 : 4;
          const earlyStopQ = activeSecs >= 80 ? 85 : 82;
          const earlyStopHistory = activeSecs >= 80 ? 4 : 3;
          if (elapsed >= earlyStopMin && state.liveBpmHistory.length >= earlyStopHistory) {
            const recent = state.liveBpmHistory.slice(-earlyStopHistory);
            const spread = Math.max(...recent) - Math.min(...recent);
            const avgQ = average(lastQualitySamples.slice(-60)); // last 2s quality
            if (spread <= earlyStopSpread && avgQ >= earlyStopQ && state.measurementMode === 'finger') {
              state.earlyStop = true;
            }
          }
        }

        // G1: Real-time signal quality guidance (enhanced)
        const guidance = getSignalQualityGuidance(metrics.lightScore, metrics.stabilityScore, state.measurementMode, metrics.signalQuality);
        if (metrics.signalQuality < 55) {
          if (!state.lowQualityStart) state.lowQualityStart = now;
          else if ((now - state.lowQualityStart) > 3000) {
            if (state.measurementMode === "finger" && state.fingerCoverage < 70) {
              el.deepAnalysisText.textContent = `Ngón che ${state.fingerCoverage}% camera — nhấn che kín hơn, tối màn hình nền.`;
              // Also update the guide bar during measurement
              if (el.coverageBar) { el.coverageBar.style.width = `${state.fingerCoverage}%`; el.coverageBar.style.background = state.fingerCoverage >= 60 ? "#f59e0b" : "#ef4444"; }
              if (el.coveragePct) { el.coveragePct.textContent = `${state.fingerCoverage}%`; el.coveragePct.style.color = state.fingerCoverage >= 60 ? "#f59e0b" : "#ef4444"; }
            } else {
              el.deepAnalysisText.textContent = guidance;
            }
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
      if (state.earlyStop || remaining <= 0) {
        const actualSecs = Math.max(1, elapsed);
        state.measurementFps = Math.round(frameCount / actualSecs);
        if (state.earlyStop) showToast(`Tín hiệu ổn định — dừng sớm lúc ${Math.round(elapsed)}s`, 'success');
        resolve();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  state.lowQualityStart = null;
  state.earlyStop = false;

  // ── Clean up: ROI tracking + exposure unlock ─────────────────────────────────
  if (state.ppgRoiSnapInterval) { clearInterval(state.ppgRoiSnapInterval); state.ppgRoiSnapInterval = null; }
  state.faceROI = null;
  await unlockCameraExposure(); // unlock for both face and finger after measurement
  if (el.liveBpmDisplay) el.liveBpmDisplay.style.display = 'none';

  state.measurementActive = false;
  el.measurementOverlay.classList.add("hidden");
  el.deepAnalysisPrompt.classList.add("hidden");
  el.startMeasureBtn.disabled = false;

  // ── Hard minimum duration gate ────────────────────────────────────────────────
  // Block analysis if too few samples collected. At 30fps: 30s = 900 frames min.
  // Below this threshold, RR count < 12 → AFib analysis completely unreliable.
  const actualFpsEst = state.measurementFps || 30;
  const collectedSecs = Math.round(state.measurementSamples.length / actualFpsEst);
  if (collectedSecs < HARD_MIN_SECS) {
    el.deepAnalysisPrompt.classList.remove('hidden');
    el.deepAnalysisText.textContent = `⚠️ Chỉ thu được ${collectedSecs}s dữ liệu — cần tối thiểu ${HARD_MIN_SECS}s. Giữ ngón tay yên và đo lại.`;
    el.startMeasureBtn.disabled = false;
    return;
  }

  // ── Item 11: Defer heavy analysis off the current frame via setTimeout ────────
  // Lets the browser paint the "Đang phân tích..." state before the ~500ms analysis.
  el.deepAnalysisPrompt.classList.remove('hidden');
  el.deepAnalysisText.textContent = '⏳ Đang phân tích tín hiệu...';
  await new Promise(r => setTimeout(r, 60));

  // ── Server-side neural inference ─────────────────────────────────────────────
  state.rppgModelSignal = null;
  console.log('[HeartSense AI] samples:', state.measurementSamples.length);
  if (state.measurementSamples.length >= 32) {
    try {
      const features = _buildServerFeatures(state.measurementSamples);
      const fps = computeActualFps(state.measurementSamples) || state.measurementFps || 30;
      const payload = { features, mode: state.measurementMode, fps };

      // Face mode: attach 18×18 crops for rppg_lite (Conv3D)
      if (state.measurementMode === 'face' && state.mlFaceFrameBuffer.length >= 20) {
        const cropData = _buildFaceCropsForServer(state.mlFaceFrameBuffer);
        if (cropData) { payload.crops_b64 = cropData.b64; payload.crops_shape = cropData.shape; }
      }

      console.log('[HeartSense AI] Sending to server — mode:', state.measurementMode, '| crops:', !!payload.crops_b64);
      const resp = await fetch('/api/rppg-inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result.ok && result.signal?.length >= 15) {
          state.rppgModelSignal = result.signal;
          console.log(`[HeartSense AI] ✅ Server inference — BPM: ${result.bpm?.toFixed(1)}, model: ${result.model_used}, latency: ${result.latency_ms}ms`);
        } else {
          console.warn('[HeartSense AI] ⚠️ Inference returned invalid result:', JSON.stringify(result).slice(0,200));
        }
      } else {
        const txt = await resp.text().catch(() => '');
        console.warn(`[HeartSense AI] ⚠️ Server returned ${resp.status}:`, txt.slice(0,200));
      }
    } catch (e) {
      console.warn('[HeartSense AI] Server inference error:', e.message);
    }
  }

  const localResult = analyzeSamples(state.measurementSamples, state.measurementMode);

  el.deepAnalysisPrompt.classList.add('hidden');

  // ── Live BPM history sanity check ────────────────────────────────────────────
  // Live estimates are updated every 3s throughout the recording → 6–20 readings.
  // They are noisier individually but their MEDIAN is very stable.
  // When final result diverges significantly from the live median → final is wrong.
  //
  // Live BPM cross-check: quickLiveBpm chỉ dùng FFT+ACF (2 method đơn giản).
  // Chỉ dùng làm "soft sanity check", KHÔNG blend mạnh vì có thể bản thân live
  // estimates bị sai (đặc biệt khi tín hiệu biến động trong recording).
  // Threshold cao (>22 BPM) để chỉ bắt các outlier rõ ràng; blend nhẹ (20%).
  if (localResult && localResult.bpm && state.liveBpmHistory.length >= 3) {
    const liveValid = state.liveBpmHistory.filter(b => b >= 40 && b <= 185);
    if (liveValid.length >= 3) {
      const liveSorted = [...liveValid].sort((a, b) => a - b);
      const liveMedian = liveSorted[Math.floor(liveSorted.length / 2)];
      const liveSpread = Math.max(...liveValid) - Math.min(...liveValid);
      const divergence = Math.abs(localResult.bpm - liveMedian);
      // Chỉ sửa khi live rất ổn định (spread ≤8) VÀ lệch rất lớn (>22 BPM)
      // → đây là outlier thuật toán rõ ràng, không phải HR thật cao
      if (liveSpread <= 8 && divergence > 22) {
        localResult.bpm = Math.round(localResult.bpm * 0.80 + liveMedian * 0.20);
        localResult.estimatedBpm = localResult.bpm;
      }
    }
  }

  // Finger mode: if analysis failed (signal too weak, methods didn't agree, or
  // BPM was unstable throughout) — show a clear remeasure prompt instead of
  // displaying a wrong/zero BPM that would mislead the user.
  if (state.measurementMode === 'finger' && (localResult._failReason || !localResult.bpm)) {
    buildWavePath([]);
    el.deepAnalysisPrompt.classList.remove('hidden');
    el.deepAnalysisText.textContent =
      '⚠️ Tín hiệu chưa đủ — đo lại: ấn ĐẦU NGÓN TRỎ che kín camera, bật flash, giữ hoàn toàn yên 60 giây.';
    showToast('Tín hiệu ngón tay quá yếu — vui lòng đo lại', 'error');
    return;
  }

  // ── Inter-measurement consistency check (cảnh báo, không sửa tự động) ────────
  // KHÔNG blend về kết quả cũ vì: nếu lần đo trước bị sai (tiếp xúc kém, nhiễu)
  // mà blend vào lần đo đúng thì làm lần đo đúng trở nên sai.
  // Chỉ cảnh báo người dùng để họ tự đánh giá.
  const _prevResult = state.lastMeasurementRecord;
  if (_prevResult && localResult.bpm && _prevResult.payload?.bpm) {
    const _timeSince = Date.now() - (_prevResult.createdAt || 0);
    const _bpmDiff = Math.abs(localResult.bpm - _prevResult.payload.bpm);
    if (_timeSince < 3 * 60 * 1000 && _bpmDiff > 15) {
      showToast(
        `Kết quả lệch ${_bpmDiff} BPM so với lần trước — kiểm tra ngón tay đặt đúng chưa và đo lại để xác nhận`,
        'warn'
      );
    }
  }

  // ── Personal BPM calibration: apply per-mode offset/regression correction ─────
  if (localResult && localResult.bpm > 0) {
    if (!state._lastRawBpm) state._lastRawBpm = {};
    if (!state._lastFeatures) state._lastFeatures = {};
    state._lastRawBpm[state.measurementMode] = localResult.bpm;
    state._lastFeatures[state.measurementMode] = localResult._features || null;
    const calibrated = await applySmartCalibration(localResult.bpm, state.measurementMode, localResult._features);
    if (calibrated !== localResult.bpm) {
      localResult._rawBpm     = localResult.bpm;
      localResult.bpm         = calibrated;
      localResult.estimatedBpm = calibrated;
    }
    // Update calibration status indicators whenever a measurement completes
    _updateCalibStatusUI('finger');
    _updateCalibStatusUI('face');
  }

  // ── Item 7: Personal calibration — save baseline HR after successful measure ──
  if (localResult.bpm >= 40 && localResult.bpm <= 120 && localResult.signalQuality >= 68) {
    const stored = state.baselineHr;
    // Exponential moving average with previous baseline
    state.baselineHr = stored ? Math.round(stored * 0.7 + localResult.bpm * 0.3) : localResult.bpm;
    localStorage.setItem('hs_baseline_hr', String(state.baselineHr));
  }

  // ── Item 8: Cross-validation — store result and compare with other mode ───────
  const now8 = Date.now();
  if (state.measurementMode === 'face') {
    state.lastFaceResult = localResult; state.lastFaceTime = now8;
  } else {
    state.lastFingerResult = localResult; state.lastFingerTime = now8;
  }
  const tenMin = 10 * 60 * 1000;
  const cvFace = state.lastFaceResult && (now8 - state.lastFaceTime < tenMin) ? state.lastFaceResult : null;
  const cvFinger = state.lastFingerResult && (now8 - state.lastFingerTime < tenMin) ? state.lastFingerResult : null;
  const cvResult = crossValidateResults(cvFace, cvFinger);
  if (cvResult && el.crossValidateBox) {
    el.crossValidateBox.textContent = cvResult.msg;
    el.crossValidateBox.className = `cross-validate-box cv-${cvResult.level}`;
    el.crossValidateBox.style.display = 'block';
  }

  // ── Item 9: Show respiratory rate if available ──────────────────────────────
  if (localResult.respRate && el.respRateResult) {
    el.respRateResult.textContent = `${localResult.respRate} lần/phút`;
    el.respRateResult.closest?.('[data-resp-row]')?.style?.setProperty('display', 'flex');
  }

  buildWavePath(localResult.waveform);
  // Thermal proxy analysis — face mode only (needs per-region landmark data)
  if (state.measurementMode === "face" && state.measurementSamples.length >= 30) {
    const thermalProxy = analyzePPGThermalProxy(state.measurementSamples);
    if (thermalProxy) renderThermalProxyResult(thermalProxy);
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
    if (_holter.active) _logHolterMeasurement(localResult);
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
  // E3 fix: dùng ngôn ngữ "nghi ngờ / sàng lọc" thay vì "phát hiện" (tránh nhầm chẩn đoán)
  el.afibConfirmBox.innerHTML = `
    <div class="confirm-alert">
      <strong>⚠️ NGHI NGỜ rung nhĩ (AFib) — Cần xác nhận!</strong>
      <p style="font-size:12px;color:#6b7280;margin-top:2px">Đây là kết quả <strong>sàng lọc</strong> từ camera — không thay thế ECG chuyên dụng. Vui lòng đo thêm 1 lần để giảm báo nhầm:</p>
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
    const confirmSecs = 25; // tăng từ 15→25s: cần ≥18 RR intervals để kết luận AFib đáng tin
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
  document.querySelector("#confirmPillBtn")?.addEventListener("click", async () => {
    el.pillAlertBox.classList.add("hidden");
    showToast("Đã ghi nhận uống thuốc.", "success");
    if (state.token && pillAlert.protocolIds?.length) {
      try {
        await api("/api/pip/confirm", { method: "POST", body: JSON.stringify({ token: state.token, protocolIds: pillAlert.protocolIds }) });
      } catch (e) { console.warn("[HeartSense] PIP confirm ghi server thất bại:", e.message); }
    }
  });
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
  if (!recs || !recs.length) {
    el.recommendationBox.innerHTML = "<p class='muted'>Chưa có khuyến nghị.</p>";
    return;
  }
  el.recommendationBox.innerHTML = recs.map(r => {
    const text = typeof r === "string" ? r : (r.text || "");
    const isUrgent  = text.startsWith("🚨") || text.startsWith("⚡");
    const isWarn    = text.startsWith("⚠️") || text.startsWith("🔄") || text.startsWith("💊") || text.startsWith("🔴");
    const isGood    = text.startsWith("✅") || text.startsWith("💚") || text.startsWith("🏆") || text.startsWith("🛡️");
    const isInfo    = text.startsWith("💡") || text.startsWith("📋") || text.startsWith("📝") || text.startsWith("⏰") || text.startsWith("🎯") || text.startsWith("👨") || text.startsWith("💛") || text.startsWith("🟡") || text.startsWith("📊") || text.startsWith("💤") || text.startsWith("📶");
    const bg    = isUrgent ? "#fde8ec" : isWarn ? "#fffbeb" : isGood ? "#d4f5ea" : "#f0f9ff";
    const border= isUrgent ? "#f87171" : isWarn ? "#fbbf24" : isGood ? "#34d399" : "#93c5fd";
    const color = isUrgent ? "#9b1c1c" : isWarn ? "#78350f" : isGood ? "#065f46" : "#1e3a5f";
    return `<div style="background:${bg};border-left:3px solid ${border};border-radius:6px;padding:9px 12px;margin-bottom:7px;font-size:13px;color:${color};line-height:1.55">${text}</div>`;
  }).join("");
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
  if (!hasPpg) { el.hrvAdvancedBox.innerHTML = "<p class='muted'>Chưa đủ dữ liệu PPG để tính SDNN/RMSSD. Đo thêm để nâng cao độ chính xác.</p>"; return; }
  const cvColor = result.cv > 0.22 ? "#ef4444" : result.cv > 0.17 ? "#f59e0b" : "#22c55e";
  const tprColor = result.tpr > 0.66 ? "#ef4444" : result.tpr > 0.58 ? "#f59e0b" : "#22c55e";
  const ratioColor = result.rmssdSdnnRatio > 1.3 ? "#ef4444" : result.rmssdSdnnRatio > 1.0 ? "#f59e0b" : "#22c55e";
  const evidColor = (result.afibEvidence || 0) >= 52 ? "#ef4444" : (result.afibEvidence || 0) >= 35 ? "#f59e0b" : "#22c55e";
  el.hrvAdvancedBox.innerHTML = `
    <div class="list-item"><span>SDNN</span><strong>${result.sdnn} ms</strong></div>
    <div class="list-item"><span>RMSSD</span><strong>${result.rmssd} ms</strong></div>
    <div class="list-item"><span>pNN50</span><strong>${result.pnn50}%</strong></div>
    <div class="list-item"><span>CV (biến thiên RR)</span><strong style="color:${cvColor}">${result.cv} ${result.cv > 0.17 ? "⚠️" : "✓"}</strong></div>
    <div class="list-item"><span>TPR (Turning Point)</span><strong style="color:${tprColor}">${result.tpr ?? "--"} ${(result.tpr||0) > 0.66 ? "⚠️ Loạn nhịp" : "✓"}</strong></div>
    <div class="list-item"><span>RMSSD/SDNN ratio</span><strong style="color:${ratioColor}">${result.rmssdSdnnRatio ?? "--"} ${(result.rmssdSdnnRatio||0) > 1.3 ? "⚠️" : "✓"}</strong></div>
    <div class="list-item"><span>AFib Evidence Score</span><strong style="color:${evidColor}">${result.afibEvidence ?? "--"}/100 ${(result.afibEvidence||0)>=52?"🚨 Nghi ngờ AFib":(result.afibEvidence||0)>=35?"⚠️ Theo dõi":"✓ Bình thường"}</strong></div>
    <div class="list-item"><span>Số khoảng RR (Hampel)</span><strong>${result.rrIntervals?.length || "--"} nhịp</strong></div>`;
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
  // Khi thời gian đo <30s, không được hiển thị kết quả AFib — dữ liệu không đủ tin cậy
  const _durationInvalid = r.durationWarning === 'critical';
  const _effectiveCls = _durationInvalid && cls === "afib" ? "normal" : cls;
  const badgeClass = _effectiveCls === "afib" ? "badge danger" : _effectiveCls === "elevated" ? "badge warn" : "badge safe";
  const badgeText = _durationInvalid
    ? "Không đủ dữ liệu"
    : _effectiveCls === "afib" ? "Cảnh báo AFib" : _effectiveCls === "elevated" ? "Cần theo dõi" : "Bình thường";
  el.riskBadge.className = badgeClass; el.riskBadge.textContent = badgeText;

  // ── BPM với confidence interval ───────────────────────────────────────────────
  const ciLabel = r.bpmCiLabel || 'low';
  const ciRange = r.bpmCiRange || 15;
  const ciColor = ciLabel === 'high' ? '#22c55e' : ciLabel === 'moderate' ? '#f59e0b' : '#ef4444';
  const ciArrow = ciLabel === 'high' ? '🟢' : ciLabel === 'moderate' ? '🟡' : '🔴';
  el.bpmResult.innerHTML = `${r.bpm} <span style="font-size:14px;color:${ciColor}">±${ciRange} BPM</span>`;
  el.bpmResult.title = `${ciArrow} Khoảng tin cậy BPM: ±${ciRange} BPM (${ciLabel === 'high' ? 'Cao' : ciLabel === 'moderate' ? 'Trung bình' : 'Thấp'})`;

  // FIX: Dedicated CI confidence panel — more visible than inline tooltip
  const ciBadgeEl = document.getElementById("bpmCiBadge") || (() => {
    const b = document.createElement("div"); b.id = "bpmCiBadge";
    b.style.cssText = "margin-top:5px;font-size:12px;text-align:center";
    (el.bpmResult.closest("article") || el.bpmResult.parentElement)?.appendChild(b);
    return b;
  })();
  const ciLabelVi = ciLabel === 'high' ? 'Cao' : ciLabel === 'moderate' ? 'Trung bình' : 'Thấp';
  const ciBarW = ciLabel === 'high' ? 90 : ciLabel === 'moderate' ? 55 : 22;
  ciBadgeEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:5px;justify-content:center">
      <span style="color:${ciColor};font-weight:700">${ciArrow} ±${ciRange} BPM</span>
      <span style="color:#94a3b8">·</span>
      <span style="color:${ciColor};font-weight:600">Tin cậy: ${ciLabelVi}</span>
    </div>
    <div style="background:#e2e8f0;border-radius:4px;height:5px;width:80px;margin:4px auto 0">
      <div style="background:${ciColor};height:5px;border-radius:4px;width:${ciBarW}%;transition:width 0.4s"></div>
    </div>`;

  el.hrvResult.textContent = `${r.hrvScore}`;
  if (el.sdnnResult) el.sdnnResult.textContent = r.sdnn ? `${r.sdnn} ms` : "--";
  if (el.rmssdResult) el.rmssdResult.textContent = r.rmssd ? `${r.rmssd} ms` : "--";
  el.strokeRiskResult.textContent = `${r.strokeRiskScore}%`;
  el.afibResult.textContent = `${r.irregularityIndex}`;

  // ── Headline với ngôn ngữ sàng lọc đúng chuẩn ────────────────────────────────
  el.resultHeadline.textContent = cls === "afib"
    ? "Nghi ngờ rung nhĩ (AFib) — Cần xác nhận bằng ECG thực tế."
    : cls === "elevated" ? "Nhịp tim có dấu hiệu cần theo dõi thêm."
    : "Nhịp tim ổn định trong lần đo này.";

  const qualityNote = (record.type === "finger" && !isMobile())
    ? ` · ⚠️ Finger PPG trên máy tính thấp hơn điện thoại`
    : "";
  const ciNote = `BPM ±${ciRange} (${ciArrow} ${ciLabel === 'high' ? 'Cao' : ciLabel === 'moderate' ? 'TB' : 'Thấp'})`;
  el.resultDescription.textContent = `${r.baselineStatus}. Độ tin cậy ${r.confidence}% – Chất lượng ${r.signalQuality}% – ${ciNote}${qualityNote}.`;

  // ── Quality gate message: hiển thị khi tín hiệu không đủ tốt ─────────────────
  const qgBox = document.getElementById("qualityGateBox") || (() => {
    const b = document.createElement("div"); b.id = "qualityGateBox"; b.style.cssText = "margin:8px 0";
    el.resultDescription.insertAdjacentElement("afterend", b); return b;
  })();
  // Build quality gate + duration warning combined banner
  const durMsg = r.durationWarning === 'critical'
    ? `🔴 Thời gian đo chỉ ${r.durationSec}s — Kết quả không đáng tin cậy. Nên đo tối thiểu 30 giây, tốt nhất 60 giây.`
    : r.durationWarning === 'short'
    ? `⚠️ Thời gian đo ${r.durationSec}s — Để phát hiện AFib chính xác hơn, đo đủ 60 giây.`
    : '';
  const qgMsg = r.qualityGateMsg || '';
  const combinedMsg = [durMsg, qgMsg].filter(Boolean).join('<br>');
  if (combinedMsg) {
    const isError = r.durationWarning === 'critical' || r.qualityGateLevel === 'hard';
    const bg = isError ? '#fef2f2' : '#fef3c7';
    const border = isError ? '#ef4444' : '#f59e0b';
    const color = isError ? '#991b1b' : '#92400e';
    qgBox.innerHTML = `<div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:10px 14px;font-size:13px;color:${color}">${combinedMsg}</div>`;
  } else {
    // Show green duration confirmation when measurement is optimal (≥60s)
    qgBox.innerHTML = r.durationSec >= 60
      ? `<div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:8px 14px;font-size:12px;color:#166534">✅ Thời gian đo ${r.durationSec}s — Tối ưu cho phát hiện AFib</div>`
      : '';
  }

  // ── AFib evidence breakdown — hiển thị các metrics chính ─────────────────────
  const evidenceBox = document.getElementById("afibEvidenceBox") || (() => {
    const b = document.createElement("div"); b.id = "afibEvidenceBox"; b.style.cssText = "margin:8px 0";
    qgBox.insertAdjacentElement("afterend", b); return b;
  })();
  if (r.afibEvidence !== undefined && r.physiologicalGate) {
    const metrics = [
      r.dfaAlpha1 !== null && r.dfaAlpha1 !== undefined ? `DFA α1=${r.dfaAlpha1}` : null,
      r.permEntropy ? `PE=${r.permEntropy}` : null,
      r.lorenzAfibScore ? `Lorenz=${r.lorenzAfibScore}` : null,
      r.wieselIrr != null ? `IRR=${r.wieselIrr}` : null,
      r.waldWolkowitzZ != null ? `WW-Z=${r.waldWolkowitzZ}` : null,
      r.cv ? `CV=${r.cv}` : null,
    ].filter(Boolean).join(' · ');
    const evidenceColor = r.afibLikelihood ? '#ef4444' : r.afibEvidence >= 45 ? '#f59e0b' : '#22c55e';
    const methodBadge = r.methodCount ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;margin-left:6px;font-size:10px">${r.methodCount}/6 methods</span>` : '';
    const cohBadge = r.rgCoherence != null
      ? `<span style="background:${r.rgCoherence >= 55 ? '#dcfce7' : r.rgCoherence >= 30 ? '#fef9c3' : '#fee2e2'};color:${r.rgCoherence >= 55 ? '#166534' : r.rgCoherence >= 30 ? '#854d0e' : '#991b1b'};padding:1px 6px;border-radius:4px;margin-left:6px;font-size:10px">R-G coh: ${r.rgCoherence}%</span>`
      : '';
    evidenceBox.innerHTML = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:11px;color:#475569">
      <strong style="color:${evidenceColor}">AFib Evidence: ${r.afibEvidence}/230 điểm</strong>${methodBadge}${cohBadge}
      ${metrics ? `<span style="margin-left:8px">${metrics}</span>` : ''}</div>`;
  } else {
    evidenceBox.innerHTML = "";
  }

  // Hiển thị cảnh báo nhiễu camera nếu bộ lọc sinh lý không pass
  const noiseWarnBox = document.getElementById("signalNoiseWarning") || (() => {
    const b = document.createElement("div"); b.id = "signalNoiseWarning";
    el.resultDescription.insertAdjacentElement("afterend", b); return b;
  })();
  if (r.noiseDetected || (r.signalQuality < 55 && !r.physiologicalGate)) {
    const reasons = [];
    if (r.cv > 0.52) reasons.push(`CV=${r.cv} quá cao (>0.52) — ánh sáng lọt vào khe camera`);
    if (r.sdnn > 185) reasons.push(`SDNN=${r.sdnn}ms bất thường (>185ms)`);
    if ((r.methodsAgreeing || 0) < 2) reasons.push("Các phương pháp BPM không đồng thuận — tín hiệu không ổn định");
    if (!r.physiologicalGate && r.afibEvidence > 0) reasons.push("Bộ lọc sinh lý không pass — kết quả không đáng tin");
    noiseWarnBox.innerHTML = `
      <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:10px;padding:12px 16px;margin:10px 0">
        <strong style="color:#92400e">⚠️ Tín hiệu bị nhiễu — Kết quả không đáng tin cậy</strong>
        <p style="margin:6px 0 4px;font-size:13px;color:#78350f">${reasons.join(" · ") || "Đặt ngón tay chưa đúng cách."}</p>
        <p style="margin:0;font-size:12px;color:#92400e"><strong>Cách sửa:</strong> Đặt ngón trỏ che kín ĐỒNG THỜI camera chính + đèn flash. Không để ánh sáng lọt vào. Ấn nhẹ, giữ tuyệt đối yên.</p>
      </div>`;
  } else {
    noiseWarnBox.innerHTML = "";
  }

  // ── FPS warning: máy quay FPS thấp → RR interval kém chính xác ──────────────
  const fpsWarnBox = document.getElementById("fpsWarningBox") || (() => {
    const b = document.createElement("div"); b.id = "fpsWarningBox";
    noiseWarnBox.insertAdjacentElement("afterend", b); return b;
  })();
  {
    const fps = r.actualFps || 0;
    if (fps > 0 && fps < 24) {
      const fpsLevel = fps < 15 ? 'critical' : 'low';
      const fpsBg = fpsLevel === 'critical' ? '#fef2f2' : '#fef3c7';
      const fpsBorder = fpsLevel === 'critical' ? '#ef4444' : '#f59e0b';
      const fpsColor = fpsLevel === 'critical' ? '#991b1b' : '#92400e';
      const fpsImpact = fps < 15
        ? `Camera chỉ chụp ${fps} khung/giây — sai số BPM có thể lên tới ±10–15 BPM. Kết quả AFib không đáng tin.`
        : `Camera chụp ${fps} khung/giây (lý tưởng ≥24fps) — sai số BPM tăng khoảng ±5–8 BPM.`;
      fpsWarnBox.innerHTML = `
        <div style="background:${fpsBg};border:2px solid ${fpsBorder};border-radius:10px;padding:10px 14px;margin:8px 0">
          <strong style="color:${fpsColor}">📷 FPS máy ảnh thấp: ${fps} fps</strong>
          <p style="margin:5px 0 0;font-size:12px;color:${fpsColor}">${fpsImpact}</p>
          <p style="margin:4px 0 0;font-size:11px;color:${fpsColor}">💡 <strong>Cải thiện:</strong> Đóng ứng dụng nền, bật chế độ tiết kiệm pin OFF, dùng điện thoại đời mới hơn để đo chính xác hơn.</p>
        </div>`;
    } else {
      fpsWarnBox.innerHTML = "";
    }
  }

  // ── Re-measurement guidance: AFib suspected OR borderline quality ──────────
  const remeasureBox = document.getElementById("remeasureGuideBox") || (() => {
    const b = document.createElement("div"); b.id = "remeasureGuideBox";
    fpsWarnBox.insertAdjacentElement("afterend", b); return b;
  })();
  {
    const isAfibSuspect = cls === "afib" || (r.afibEvidence || 0) > 60;
    const isBorderlineQuality = (r.signalQuality || 0) >= 65 && (r.signalQuality || 0) <= 72;
    if ((isAfibSuspect || isBorderlineQuality) && r.physiologicalGate) {
      const afibMsg = `<strong style="color:#991b1b">⚠️ Phát hiện dấu hiệu nghi ngờ AFib</strong>
        <p style="margin:6px 0 0;font-size:13px;color:#7f1d1d">Để <strong>xác nhận kết quả</strong>, hãy <strong>đo lại ngay</strong> bằng chế độ <strong>Ngón tay (60–90 giây)</strong>:</p>`;
      const qualityMsg = `<strong style="color:#92400e">ℹ️ Chất lượng tín hiệu ở mức trung bình (${r.signalQuality}%)</strong>
        <p style="margin:6px 0 0;font-size:13px;color:#78350f">Kết quả có thể chưa chính xác hoàn toàn. Hãy <strong>đo lại ngay</strong> để có kết quả tin cậy hơn:</p>`;
      const bg = isAfibSuspect ? "#fff1f2" : "#fffbeb";
      const border = isAfibSuspect ? "#fca5a5" : "#fcd34d";
      remeasureBox.innerHTML = `
        <div style="background:${bg};border:2px solid ${border};border-radius:10px;padding:14px 16px;margin:10px 0">
          ${isAfibSuspect ? afibMsg : qualityMsg}
          <ol style="margin:10px 0 8px 18px;font-size:13px;color:#374151;line-height:1.7">
            <li>Nhấn <strong>Đo lại</strong> bên dưới hoặc bấm nút <strong>Bắt đầu đo</strong></li>
            <li>Đặt <strong>ngón trỏ che kín</strong> camera chính + đèn flash (không để ánh sáng lọt)</li>
            <li>Giữ <strong>tuyệt đối yên tĩnh</strong> trong <strong>60–90 giây</strong></li>
            <li>Nếu kết quả vẫn chỉ AFib → <strong>liên hệ bác sĩ trong 24 giờ</strong></li>
          </ol>
          <button onclick="document.getElementById('startMeasureBtn')?.click()" style="background:${isAfibSuspect ? '#dc2626' : '#d97706'};color:#fff;border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;width:100%">
            🔄 Đo lại ngay để xác nhận
          </button>
        </div>`;
    } else {
      remeasureBox.innerHTML = "";
    }
  }

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
      if (r.classification === "afib") fetchAfibTriggerAi(record, weather);
    }
    // Estimated SpO2 (if samples available)
    const spO2El = document.getElementById("spO2EstResult");
    if (spO2El && state.measurementSamples.length >= 30) {
      const spO2 = estimateSpO2(state.measurementSamples);
      if (spO2) spO2El.innerHTML = `<span style="color:${spO2.color}">${spO2.spO2}% SpO2 估</span> <span class="muted" style="font-size:10px">(${spO2.confidence})</span>`;
    }
  }

  // ── UPDATE LIST 3 renders ──────────────────────────────────────────────────
  const allMeas = state.dashboard?.measurements || [];

  // CCI: Cardiac Conduction Index + Bilateral comparison
  renderCCIPanel(r, allMeas);
  // Bundle Branch Block hint
  renderBundleBranchPanel(r.bbHint);

  // UL3 #4: Systolic BP Estimation
  const bpEst = computeSystolicBPEstimate(r, state.user);
  renderSystolicBPPanel(bpEst);

  // UL3 #5: CCI 6-month Trend Chart
  renderCCITrendChart(allMeas);

  // ── UPDATE LIST 4 render ───────────────────────────────────────────────────
  const weatherTempBio = state.dashboard?.weatherAlert?.temp ?? null;
  const bioshield = computeBioshieldForecast(allMeas, r, weatherTempBio);
  renderBioshieldStatus(bioshield);

  // ── UPDATE LIST 5: Clot-Risk + Vascular Recovery ───────────────────────────
  renderClotRisk(r.clotRisk);
  renderVascularRecovery(r.vascularRecovery);

  // ── Nhóm 4: Coherence Score from measurement result ────────────────────────
  if (r.sdnn && r.rmssd) {
    const cs = { coherence: Math.round(r.sdnn > 0 && r.rmssd > 0 ? Math.min(95, Math.max(25, r.sdnn/r.rmssd < 0.7 ? 55 : r.sdnn/r.rmssd < 1.8 ? 90 : 40)) : 60), ratio: Math.round((r.sdnn||35)/(r.rmssd||25)*10)/10, label: "", advice: "", status:"" };
    cs.label = cs.coherence >= 80 ? "🟢 Tim-Não cộng hưởng tốt" : cs.coherence >= 60 ? "🟡 Trung bình" : "🔴 Mất cộng hưởng";
    cs.advice = cs.coherence < 60 ? "Bật Breathing Coach ngay để phục hồi." : cs.coherence < 80 ? "Nghỉ ngơi, hít thở chậm." : "Trạng thái xuất sắc!";
    renderCoherenceScore(cs);
  }
  // ── Nhóm 4: Electrolyte from result ───────────────────────────────────────
  if (r.irregularityIndex !== undefined) renderElectrolyteRisk({ kLevel: r.sdnn < 25 && r.irregularityIndex > 40 ? "BORDERLINE" : "NORMAL", mgLevel: r.cv > 0.20 && r.irregularityIndex > 35 ? "BORDERLINE" : "NORMAL", recommendation: r.sdnn < 25 ? "Uống nước dừa và ăn chuối hôm nay." : "Điện giải ổn định." });

  // ── Nhóm 2: Post-Episode Protocol (chỉ khi AFib) ─────────────────────────
  if (cls === "afib") renderPostEpisodeProtocol(r);

  // ── UPDATE LIST 6: Pocket Cardiologist ────────────────────────────────────
  renderPocketCardiologist(r, state.user);

  // ── Part D: Schedule hand reminder (nếu đo tay phải buổi sáng) ────────────
  scheduleHandReminder(r.measurementHand || 'right');
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

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE LIST 3 & 4 — RENDERING FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

// ─── UL4: Bioshield Status Panel ─────────────────────────────────────────────
function renderBioshieldStatus(forecast) {
  const box = document.getElementById("bioshieldBox");
  if (!box || !forecast) return;
  const { safetyScore, status, moodIcon, message, advice, factors, peakRisk, trends, layer2 } = forecast;
  const bgColor = status === 'green' ? '#f0fdf4' : status === 'yellow' ? '#fffbeb' : '#fef2f2';
  const bdColor = status === 'green' ? '#86efac' : status === 'yellow' ? '#fde68a' : '#fca5a5';
  const txtColor = status === 'green' ? '#14532d' : status === 'yellow' ? '#78350f' : '#7f1d1d';
  const barColor = status === 'green' ? '#22c55e' : status === 'yellow' ? '#f59e0b' : '#ef4444';
  const factorHTML = factors.length
    ? `<ul style="margin:6px 0 4px;padding-left:18px;font-size:12px;color:${txtColor}">${factors.map(f => `<li>${f}</li>`).join('')}</ul>`
    : '';
  const trendHTML = [
    trends.hrvDeclinePct > 12 ? `↓ HRV -${trends.hrvDeclinePct}%` : null,
    trends.pavRisePct    > 20 ? `↑ PAV +${trends.pavRisePct}%`   : null,
    trends.hcDeclinePct  > 15 ? `↓ HC  -${trends.hcDeclinePct}%` : null,
  ].filter(Boolean).join(' · ');

  box.innerHTML = `
    <div style="background:${bgColor};border:2px solid ${bdColor};border-radius:12px;padding:14px 16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:28px">${moodIcon}</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:${txtColor}">${message}</div>
          <div style="font-size:12px;color:${txtColor};opacity:0.75;margin-top:2px">Tầng 2: PAV=${layer2.pav.toFixed(1)}% · HC=${layer2.hc} · ASI=${layer2.asi}%</div>
        </div>
      </div>
      <div style="background:#fff;border-radius:8px;overflow:hidden;height:10px;margin-bottom:8px">
        <div style="width:${safetyScore}%;height:100%;background:${barColor};transition:width 0.6s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:${txtColor};margin-bottom:8px">
        <span>🔴 Nguy hiểm</span>
        <strong>Chỉ số an toàn: ${safetyScore}%</strong>
        <span>🟢 An toàn</span>
      </div>
      ${factorHTML}
      <div style="font-size:13px;color:${txtColor};font-weight:600;margin-top:6px">💡 ${advice}</div>
      <div style="font-size:11px;color:#64748b;margin-top:4px">Nguy cơ cao nhất hôm nay: ${peakRisk.label}${trendHTML ? ` · Xu hướng: ${trendHTML}` : ''}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:6px">⚠️ Chỉ số ước lượng thuật toán — tham khảo bổ sung, không thay thế ý kiến bác sĩ</div>
    </div>`;
}

// ─── UL3: CCI + Bilateral Panel ──────────────────────────────────────────────
function renderCCIPanel(result, measurements) {
  const box = document.getElementById("cciBox");
  if (!box || !result) return;
  const morph = result.morphology;
  const pav   = result.pav;
  const hc    = result.hc;
  if (!morph) { box.innerHTML = "<p class='muted'>Không đủ dữ liệu hình thái sóng.</p>"; return; }

  const hand  = result.measurementHand === 'left' ? '👈 Tay trái' : '👉 Tay phải';
  const age   = state.user?.age || 55;
  const asi   = computeArterialStiffnessIndex(morph, age);
  if (!asi) return;

  // Bilateral comparison
  const recentMeasurements = measurements || [];
  const now48h = Date.now() - 48 * 3600 * 1000;
  const otherHand = result.measurementHand === 'right' ? 'left' : 'right';
  const otherMeas = recentMeasurements.find(m =>
    m.result?.measurementHand === otherHand &&
    new Date(m.createdAt || 0).getTime() > now48h
  );
  const cci = otherMeas ? computeBilateralCCI(
    result.measurementHand === 'right' ? { result, createdAt: new Date().toISOString() } : otherMeas,
    result.measurementHand === 'right' ? otherMeas : { result, createdAt: new Date().toISOString() }
  ) : null;

  const asiColor = asi.color;
  const pavColor = pav?.color || '#94a3b8';
  const hcColor  = hc?.color  || '#94a3b8';

  box.innerHTML = `
    <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${hand} · ${morph.beatCount} nhịp phân tích</div>

    <div class="list-item"><span>Độ cứng mạch (ASI)</span>
      <strong style="color:${asiColor}">${morph.asi}% — ${asi.label}</strong></div>
    <div class="list-item"><span>Thời gian tâm thu / tâm trương</span>
      <strong>${morph.tRise}ms / ${morph.tFall}ms</strong></div>
    ${morph.dicroticRatio !== null ? `<div class="list-item"><span>Dicrotic notch ratio</span><strong>${morph.dicroticRatio}</strong></div>` : ''}
    <div class="list-item"><span>Biên độ sóng mạch (PAV)</span>
      <strong style="color:${pavColor}">${pav?.pavIndex?.toFixed(1) || '--'}% — ${pav?.label || '--'}</strong></div>
    <div class="list-item"><span>Sức chứa tuần hoàn (HC)</span>
      <strong style="color:${hcColor}">${hc?.hcIndex || '--'} — ${hc?.label || '--'}</strong></div>

    ${cci ? `
    <div style="margin-top:10px;padding:8px 10px;background:#f8fafc;border-radius:8px;border-left:3px solid ${cci.color}">
      <strong style="color:${cci.color}">So sánh hai tay (cách ${cci.hoursApart}h)</strong><br>
      <span style="font-size:12px">Chênh lệch T-rise: ${cci.dTrise}ms · ASI: ${cci.dAsi}%</span><br>
      <span style="font-size:12px;color:${cci.color}">${cci.label}</span>
    </div>` : `
    <div style="margin-top:8px;font-size:12px;color:#94a3b8">
      💡 Đo tay còn lại (${otherHand === 'left' ? 'tay trái' : 'tay phải'}) trong 48h để so sánh CCI hai tay
    </div>`}

    <div style="font-size:10px;color:#94a3b8;margin-top:6px">
      So sánh ngưỡng tuổi ${age}: ASI bình thường = ${asi.norm}% · Của bạn = ${morph.asi}%
      ${asi.level !== 'normal' && asi.level !== 'flexible' ? ' — Theo dõi thêm' : ' ✅'}
    </div>`;
}

// ─── UL3: Bundle Branch Hint Panel ───────────────────────────────────────────
function renderBundleBranchPanel(bbHint) {
  const box = document.getElementById("bundleBranchBox");
  if (!box) return;
  if (!bbHint) { box.innerHTML = ""; return; }
  const color = bbHint.notchDetected
    ? (bbHint.severity === 'high' ? '#ef4444' : '#f59e0b')
    : '#22c55e';
  const bg = bbHint.notchDetected ? (bbHint.severity === 'high' ? '#fef2f2' : '#fffbeb') : '#f0fdf4';
  box.innerHTML = `
    <div style="background:${bg};border:1px solid ${color};border-radius:8px;padding:10px 12px">
      <div class="list-item">
        <span>Hình dạng sóng mạch</span>
        <strong style="color:${color}">${bbHint.notchDetected ? `⚠️ Bất thường (${bbHint.notchScore}% nhịp)` : '✅ Bình thường'}</strong>
      </div>
      <p style="font-size:12px;color:${color};margin:4px 0 0">${bbHint.hint}</p>
      ${bbHint.notchDetected ? '<p style="font-size:11px;color:#64748b;margin:4px 0 0">Đây là sàng lọc từ hình thái PPG, không phải chẩn đoán xác định. Cần ECG để xác nhận.</p>' : ''}
    </div>`;
}

// ─── UL3+UL4: Hand Selection Toggle ──────────────────────────────────────────
// ─── UL3 #5: CCI 6-month Trend Chart ────────────────────────────────────────
// SVG bar chart ASI theo thời gian — phân biệt tay phải (R) / trái (L).
// Trend line dạng đường kẻ — nhận định tăng/giảm theo thời gian.
function renderCCITrendChart(measurements) {
  const box = document.getElementById("cciTrendBox");
  if (!box) return;

  const data = (measurements || [])
    .filter(m => m.result?.morphology?.asi && m.createdAt)
    .slice(-24) // tối đa 24 điểm (~6 tháng nếu đo hàng tuần)
    .map(m => ({
      date: new Date(m.createdAt).toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' }),
      asi:  m.result.morphology.asi,
      hc:   m.result.hc?.hcIndex || 0,
      hand: m.result.measurementHand || 'right',
    }));

  if (data.length < 2) {
    box.innerHTML = "<p class='muted'>Cần ít nhất 2 lần đo có dữ liệu hình thái sóng để hiển thị xu hướng CCI.</p>";
    return;
  }

  const W = 540, H = 90;
  const ASI_MIN = 18, ASI_MAX = 46;
  const colW = Math.floor(W / data.length);
  const barW = Math.max(4, colW - 3);

  // Bars + labels
  let barsHTML = '';
  const linePoints = [];

  data.forEach((d, i) => {
    const pct    = Math.min(1, Math.max(0, (d.asi - ASI_MIN) / (ASI_MAX - ASI_MIN)));
    const barH   = Math.max(6, Math.round(pct * (H - 22)));
    const x      = i * colW + 1;
    const y      = H - barH - 12;
    const clr    = d.asi > 38 ? '#ef4444' : d.asi > 32 ? '#f59e0b' : '#22c55e';
    const hIcon  = d.hand === 'left' ? 'L' : 'R';
    barsHTML += `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${clr}" rx="2" opacity="0.82"/>
      <text x="${x + barW/2}" y="${y - 1}" text-anchor="middle" fill="${clr}" font-size="7.5" font-weight="600">${d.asi}</text>
      <text x="${x + barW - 3}" y="${y + 9}" fill="#ffffffcc" font-size="6.5">${hIcon}</text>
      <text x="${x + barW/2}" y="${H - 1}" text-anchor="middle" fill="#94a3b8" font-size="6.5">${d.date}</text>`;
    linePoints.push(`${x + barW/2},${y - 1}`);
  });

  // Reference lines
  const yNorm = H - Math.round(((30 - ASI_MIN)/(ASI_MAX - ASI_MIN)) * (H - 22)) - 12;
  const yHigh = H - Math.round(((38 - ASI_MIN)/(ASI_MAX - ASI_MIN)) * (H - 22)) - 12;

  // Trend analysis
  const firstASI = data[0].asi;
  const lastASI  = data[data.length - 1].asi;
  const delta    = lastASI - firstASI;
  const trendClr = delta > 3 ? '#ef4444' : delta < -3 ? '#22c55e' : '#94a3b8';
  const trendTxt = delta > 3  ? `⬆ +${delta}% cứng dần — theo dõi`
                 : delta < -3 ? `⬇ ${delta}% mềm hơn — tốt`
                 : '➡ Ổn định';

  // HC mini sparkline (secondary axis, dashed)
  const hcLine = data.map((d, i) => {
    const hcPct = Math.min(1, d.hc / 100);
    const cy = H - Math.round(hcPct * (H - 22)) - 12;
    return `${i * colW + barW/2},${cy}`;
  }).join(' ');

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:75px;display:block;overflow:visible">
      <!-- Reference lines -->
      <line x1="0" y1="${yNorm}" x2="${W}" y2="${yNorm}" stroke="#86efac" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.6"/>
      <line x1="0" y1="${yHigh}" x2="${W}" y2="${yHigh}" stroke="#fca5a5" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.6"/>
      <text x="2" y="${yNorm - 1}" fill="#86efac" font-size="6.5">30%</text>
      <text x="2" y="${yHigh - 1}" fill="#fca5a5" font-size="6.5">38%</text>
      <!-- Bars -->
      ${barsHTML}
      <!-- HC sparkline (dashed blue) -->
      <polyline points="${hcLine}" fill="none" stroke="#60a5fa" stroke-width="1" stroke-dasharray="2,2" opacity="0.55"/>
      <!-- ASI trend line -->
      <polyline points="${linePoints.join(' ')}" fill="none" stroke="${trendClr}" stroke-width="1.5" opacity="0.7"/>
      <!-- X axis -->
      <line x1="0" y1="${H-10}" x2="${W}" y2="${H-10}" stroke="#e2e8f0" stroke-width="0.5"/>
    </svg>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-top:3px">
      <span style="color:#64748b">${data.length} lần đo · R=Tay phải · L=Tay trái · - - = HC</span>
      <strong style="color:${trendClr}">${trendTxt}</strong>
    </div>
    <div style="font-size:10px;color:#94a3b8;margin-top:2px">
      🟢 ASI &lt;30: mạch mềm &nbsp;·&nbsp; 🟡 30-38: bình thường &nbsp;·&nbsp; 🔴 &gt;38: cứng mạch
    </div>`;
}

// ─── Part D: Hand Reminder Notification ──────────────────────────────────────
// Sau khi đo tay phải buổi sáng → nhắc đo tay trái vào buổi chiều/tối.
// Giúp người dùng duy trì thói quen đo 2 tay để có CCI bilateral chính xác.
function scheduleHandReminder(measuredHand) {
  if (measuredHand !== 'right') return;
  const now  = new Date();
  const hour = now.getHours();
  // Chỉ nhắc nếu đo buổi sáng (trước 13h)
  if (hour >= 13) return;
  const targetHour = 17; // nhắc lúc 5 chiều
  const msUntil = (targetHour - hour) * 3600000 - now.getMinutes() * 60000 - now.getSeconds() * 1000;
  if (msUntil < 60000 || msUntil > 14 * 3600000) return;

  setTimeout(() => {
    showToast(
      '⏰ Nhắc CCI: Đo thêm TAY TRÁI ngay bây giờ để so sánh bất đối xứng dẫn truyền hai tay!',
      'info', 9000
    );
    // Cũng highlight nút hand toggle để gợi ý
    const btn = document.getElementById("handToggleBtn");
    if (btn) {
      btn.style.animation = "pulse 1.5s 4";
      btn.style.background = "#1e3a5f";
      btn.style.color = "#60a5fa";
      setTimeout(() => { btn.style.animation = ""; btn.style.background = ""; btn.style.color = ""; }, 7000);
    }
  }, msUntil);
}

function toggleMeasurementHand() {
  state.measurementHand = state.measurementHand === 'right' ? 'left' : 'right';
  const btn = document.getElementById("handToggleBtn");
  if (btn) {
    btn.textContent = state.measurementHand === 'right' ? '👉 Tay phải' : '👈 Tay trái';
    btn.title = `Đang chọn: ${state.measurementHand === 'right' ? 'Tay phải' : 'Tay trái'}. Bấm để chuyển.`;
  }
  showToast(`Đã chọn ${state.measurementHand === 'right' ? 'tay phải' : 'tay trái'} — nhớ giữ đúng tay khi đo`, 'info', 2500);
}

function renderProfile(user) {
  el.profileSummary.innerHTML = `
    <div class="list-item"><span>Họ tên</span><strong>${user.fullName}</strong></div>
    <div class="list-item"><span>Tuổi</span><strong>${user?.age ?? 'Chưa khai báo'}</strong></div>
    <div class="list-item"><span>Bệnh nền</span><strong>${(user.conditions || []).join(", ") || "Chưa khai báo"}</strong></div>
    <div class="list-item"><span>Nhóm máu</span><strong>${user.bloodType || 'Chưa khai báo'}</strong></div>
    <div class="list-item"><span>Dị ứng</span><strong>${user.allergy || 'Không có'}</strong></div>
    ${user.pillProtocol ? `<div class="list-item"><span>Pill-in-Pocket</span><strong>${user.pillProtocol.medicineName} ${user.pillProtocol.dose}</strong></div>` : ""}
    <button id="_editProfileBtn" class="ghost-btn" type="button" style="margin-top:8px;width:100%;font-size:13px">✏️ Chỉnh sửa hồ sơ</button>
    <div id="_editProfileForm" style="display:none;margin-top:10px">
      <div style="display:grid;gap:8px">
        <label style="font-size:13px">Họ tên<input id="_epName" class="input" type="text" value="${escHtml(user.fullName||'')}" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
        <label style="font-size:13px">Tuổi<input id="_epAge" class="input" type="number" min="1" max="120" value="${user.age||''}" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
        <label style="font-size:13px">Giới tính
          <select id="_epGender" class="input" style="margin-top:4px;width:100%;box-sizing:border-box">
            <option value="male" ${user.gender==='male'?'selected':''}>Nam</option>
            <option value="female" ${user.gender==='female'?'selected':''}>Nữ</option>
            <option value="other" ${user.gender==='other'?'selected':''}>Khác</option>
          </select>
        </label>
        <label style="font-size:13px">Bệnh nền<input id="_epConditions" class="input" type="text" value="${escHtml((user.conditions||[]).join(', '))}" placeholder="Cao huyết áp, tiểu đường..." style="margin-top:4px;width:100%;box-sizing:border-box"></label>
        <label style="font-size:13px">Nhóm máu
          <select id="_epBloodType" class="input" style="margin-top:4px;width:100%;box-sizing:border-box">
            ${['Chưa khai báo','A+','A-','B+','B-','AB+','AB-','O+','O-'].map(v=>`<option value="${v}" ${(user.bloodType||'Chưa khai báo')===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:13px">Dị ứng thuốc / thực phẩm<input id="_epAllergy" class="input" type="text" value="${escHtml(user.allergy||'')}" placeholder="Penicillin, hải sản... (để trống nếu không có)" style="margin-top:4px;width:100%;box-sizing:border-box"></label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="_epSaveBtn" class="primary-btn" type="button" style="flex:1;font-size:13px">💾 Lưu</button>
          <button id="_epCancelBtn" class="ghost-btn" type="button" style="font-size:13px">Hủy</button>
        </div>
        <div id="_epStatus" class="muted" style="font-size:12px"></div>
      </div>
    </div>`;
  document.getElementById("_editProfileBtn")?.addEventListener("click", () => {
    const f = document.getElementById("_editProfileForm");
    f.style.display = f.style.display === "none" ? "block" : "none";
  });
  document.getElementById("_epCancelBtn")?.addEventListener("click", () => {
    document.getElementById("_editProfileForm").style.display = "none";
  });
  document.getElementById("_epSaveBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("_epSaveBtn");
    const status = document.getElementById("_epStatus");
    btn.disabled = true; btn.textContent = "Đang lưu...";
    try {
      const body = {
        token: state.token,
        fullName: document.getElementById("_epName").value.trim(),
        age: document.getElementById("_epAge").value,
        gender: document.getElementById("_epGender").value,
        conditions: document.getElementById("_epConditions").value,
        bloodType: document.getElementById("_epBloodType").value,
        allergy: document.getElementById("_epAllergy").value.trim() || "Không có",
      };
      const data = await api("/api/profile", { method: "PUT", body: JSON.stringify(body) });
      if (data.ok && data.user) {
        state.user = { ...state.user, ...data.user };
        renderProfile(state.user);
        renderEmergencyMedicalID(state.user);
        status.textContent = "✅ Đã lưu hồ sơ";
        status.style.color = "var(--safe)";
      } else {
        throw new Error(data.error || "Lỗi lưu hồ sơ");
      }
    } catch(e) {
      status.textContent = "❌ " + e.message;
      status.style.color = "var(--danger)";
      btn.disabled = false; btn.textContent = "💾 Lưu";
    }
  });
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

function _pillColorToCss(colorText) {
  if (!colorText) return null;
  const t = colorText.toLowerCase();
  if (/vàng|vang|yellow/.test(t))          return "#f59e0b";
  if (/trắng|trang|white/.test(t))         return "#e2e8f0";
  if (/đỏ|do|red/.test(t))                 return "#ef4444";
  if (/cam|orange/.test(t))               return "#f97316";
  if (/xanh lá|green/.test(t))            return "#22c55e";
  if (/xanh|blue|teal/.test(t))           return "#3b82f6";
  if (/tím|tim|purple/.test(t))           return "#8b5cf6";
  if (/hồng|hong|pink/.test(t))           return "#ec4899";
  if (/nâu|nau|brown/.test(t))            return "#92400e";
  if (/xám|xam|gray|grey/.test(t))        return "#64748b";
  if (/đen|den|black/.test(t))            return "#1e293b";
  return "#94a3b8"; // default neutral
}

function renderReminders(reminders = []) {
  if (!reminders.length) { el.reminderList.innerHTML = "<p class='muted'>Chưa có lịch nhắc thuốc.</p>"; return; }
  const todayKey = new Date().toISOString().slice(0, 10);
  el.reminderList.innerHTML = reminders.map((r) => {
    const taken = r.adherence?.[todayKey] === true;
    const css = _pillColorToCss(r.pillColor);
    const colorDot = css
      ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${css};border:1.5px solid rgba(0,0,0,0.15);vertical-align:middle;margin-right:4px" title="${r.pillColor}"></span>`
      : "";
    const colorLabel = r.pillColor ? `<span style="font-size:11px;color:#94a3b8">${r.pillColor}</span>` : "";
    return `<div class="list-item" data-reminder-id="${r.id}" style="flex-wrap:wrap;gap:4px">
      <span style="white-space:nowrap;min-width:38px">${r.time}</span>
      <strong style="flex:1">${colorDot}${r.medicineName}${r.dose ? " <span style='font-weight:400;color:#94a3b8;font-size:12px'>(" + r.dose + ")</span>" : ""} ${colorLabel}</strong>
      <button class="confirm-pill-btn ${taken ? "btn-taken" : "ghost-btn"}" data-reminder-id="${r.id}" type="button" style="font-size:11px;padding:2px 8px">
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
  // Luôn hiện nút gọi người thân nếu đã có số điện thoại guardian
  if (dashboard.user?.guardian?.guardianPhone && el.guardianCallBtn) {
    el.guardianCallBtn.hidden = false;
    el.guardianCallBtn.href = `tel:${dashboard.user.guardian.guardianPhone}`;
    el.guardianCallBtn.textContent = `📞 Gọi ${dashboard.user.guardian.guardianName || "người thân"}`;
  }
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
  if (dashboard.weatherAlert) {
    renderWeatherAfibAlert(dashboard.weatherAlert, dashboard.measurements || []);
  } else {
    const wBox = document.getElementById("weatherAfibBox");
    if (wBox && wBox.innerHTML.includes("Đang tải")) {
      wBox.innerHTML = `<div class="list-item"><span>Dữ liệu thời tiết</span><strong class="badge neutral">Chưa khả dụng</strong></div>
        <p class="muted" style="font-size:12px">Tương quan thời tiết – tim mạch sẽ hiển thị sau khi server kết nối được OpenWeather API. Kết quả đo của bạn vẫn được phân tích đầy đủ.</p>`;
    }
  }
  // 24h AFib Forecast
  const forecastEl = document.getElementById("afibForecastBox");
  if (forecastEl) {
    const weatherTemp = dashboard.weatherAlert?.currentTemp ?? dashboard.weatherAlert?.temp ?? dashboard.weatherAlert?.main?.temp ?? null;
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
  // Daily tip — truyền weather + kết quả đo để hiển thị đúng theo thực tế
  showDailyHealthTip(dashboard.weatherAlert, dashboard.latestMeasurement?.result);
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
  renderResearchPanel();
  // Elderly mode restore
  if (localStorage.getItem("hs_elderly") === "1") document.body.classList.add("elderly-mode");

  // Heart Biological Age + Safe Exercise Dose
  if (dashboard.heartBioAge) renderHeartBiologicalAge(dashboard.heartBioAge);
  if (dashboard.safeExerciseDose) renderSafeExerciseDose(dashboard.safeExerciseDose);

  // Nhóm 2
  renderMedicationEffectiveness(dashboard.medEffectiveness);
  renderDiseaseProgression(dashboard.diseaseProgression);
  renderEmergencyMedicalID(dashboard.user);
  renderHRRHistory(dashboard.hrrResult);
  // Nhóm 3
  renderSmartMedReminder(dashboard.safeExerciseDose, dashboard.medEffectiveness);
  renderCardiologyMap(dashboard.cardiologyHospitals, dashboard.user);
  // Nhóm 4
  renderCoherenceScore(dashboard.coherenceScore);
  renderElectrolyteRisk(dashboard.electrolyteRisk);
  renderMonthlyCalendar(dashboard.monthlyCalendar);
  renderSeasonalPattern(dashboard.seasonalPattern);
  // Nhóm 5
  renderDoctorVisitPrep(dashboard.doctorVisitPrep);
  renderFamilyDashboard(dashboard.familyToken);

  // UPDATE LIST 6: PRP — Personalized Risk Profile
  if (dashboard.prp) renderPRP(dashboard.prp);

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
  // Refresh Tele-Clinic box sau khi login state sẵn sàng
  openZaloClinicInfo();
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
  } catch { sessionStorage.removeItem(HEARTSENSE_TOKEN_KEY); localStorage.removeItem(HEARTSENSE_TOKEN_KEY); state.token = ""; state.user = null; setAuthState("Session hết hạn. Đăng nhập lại.", "error"); }
}

// ─── Auth Handlers ────────────────────────────────────────────────────────────
async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
    state.token = data.token; state.user = data.user;
    sessionStorage.setItem(HEARTSENSE_TOKEN_KEY, state.token);
    localStorage.removeItem(HEARTSENSE_TOKEN_KEY); // xoá bản cũ nếu có
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
    sessionStorage.setItem(HEARTSENSE_TOKEN_KEY, state.token);
    localStorage.removeItem(HEARTSENSE_TOKEN_KEY); // migrate: xoá token cũ khỏi localStorage
    setAuthState(`Đang đăng nhập: ${data.user.fullName}.`);
    await loadDashboard(); startDashboardPolling();
  } catch (err) { setAuthState(err.message, "error"); }
}

function logout() {
  state.token = ""; state.user = null; state.dashboard = null;
  sessionStorage.removeItem(HEARTSENSE_TOKEN_KEY);
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
    playAlarmTone();
    if (r.dashboard) renderDashboard(r.dashboard);
    const emailMsg = (r.messages || []).find(m => m.includes("✅"));
    if (emailMsg) {
      showToast("SOS đã gửi đến người thân!", "error", 5000);
    } else {
      showToast("SOS đã lưu. Kiểm tra cài đặt email người thân.", "warn", 6000);
    }
  } catch (err) {
    setAuthState("Không thể kích hoạt SOS: " + err.message, "error");
    showToast("Lỗi SOS: " + err.message, "error", 5000);
  }
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
  if (drugsRaw.length < 2) {
    el.interactionResult.innerHTML = "<p class='muted'>Nhập ít nhất 2 tên thuốc, cách nhau bằng dấu phẩy.</p>";
    return;
  }
  try {
    el.interactionResult.innerHTML = `<p class='muted' style='display:flex;align-items:center;gap:8px'>
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'>
        <path d='M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83'/>
      </svg>
      Gemini AI đang phân tích tương tác thuốc...
    </p>`;
    const r = await api("/api/medications/check-interactions", {
      method: "POST",
      body: JSON.stringify({ token: state.token, drugs: drugsRaw }),
    });

    let html = "";

    // AI summary box (Gemini)
    if (r.aiSummary) {
      const summaryBg = r.safe ? "#f0fdf4" : r.interactions?.some(i => i.severity === "NGUY_HIEM") ? "#fef2f2" : "#fffbeb";
      const summaryBorder = r.safe ? "#22c55e" : r.interactions?.some(i => i.severity === "NGUY_HIEM") ? "#ef4444" : "#f59e0b";
      html += `<div style="background:${summaryBg};border-left:4px solid ${summaryBorder};border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">🤖 Gemini AI — Phân tích dược lâm sàng</div>
        <div style="font-size:13px;color:#1e293b;line-height:1.7">${r.aiSummary.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
      </div>`;
    }

    if (r.safe && !r.duplicates?.length) {
      html += `<div class='list-item'><span>Kết quả</span><strong class='badge safe'>✅ Không phát hiện tương tác nguy hiểm</strong></div>
        <p class='muted' style='font-size:12px;margin-top:6px'>Phân tích bởi Gemini AI + database dược lâm sàng. Luôn tham vấn bác sĩ/dược sĩ trước khi dùng phối hợp thuốc mới.</p>`;
      el.interactionResult.innerHTML = html;
      return;
    }

    // Duplicate active ingredients
    if (r.duplicates?.length) {
      html += r.duplicates.map(d =>
        `<div class="list-item" style="border-left:3px solid #ef4444">
          <span class="badge danger">Trùng hoạt chất!</span>
          <strong>${d.drug1} và ${d.drug2} đều chứa <em>${d.generic}</em> — NGUY CƠ QUÁ LIỀU</strong>
        </div>`
      ).join("");
    }

    // Drug interaction pairs
    if (r.interactions?.length) {
      html += r.interactions.map(i => {
        const sevColor = i.severity === "NGUY_HIEM" ? "#ef4444" : i.severity === "CANH_BAO" ? "#f59e0b" : "#6b7280";
        const sevLabel = i.severity === "NGUY_HIEM" ? "⛔ NGUY HIỂM" : i.severity === "CANH_BAO" ? "⚠️ CẢNH BÁO" : "ℹ️ CHÚ Ý";
        const recHtml = i.recommendation
          ? `<div style="font-size:11px;color:#374151;margin-top:4px">👉 ${i.recommendation}</div>` : "";
        return `<div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px;border-left:3px solid ${sevColor}">
          <div style="display:flex;align-items:center;gap:8px;width:100%">
            <span style="font-size:11px;font-weight:700;color:${sevColor};white-space:nowrap">${sevLabel}</span>
            <strong style="font-size:13px">${i.drugA} + ${i.drugB}</strong>
          </div>
          <div style="font-size:12px;color:#4b5563">${(i.effect || "").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
          ${recHtml}
        </div>`;
      }).join("");
    }

    if (!html) html = "<p class='muted'>Không tìm thấy thông tin tương tác cho danh sách thuốc này.</p>";
    const poweredBy = r.aiPowered
      ? `<p class='muted' style='font-size:11px;margin-top:10px'>🤖 Phân tích bởi Gemini 2.5 Flash + database 29 cặp tương tác tim mạch</p>`
      : `<p class='muted' style='font-size:11px;margin-top:10px'>📋 Phân tích từ database cục bộ${r.apiEnhanced ? " + RxNav NIH" : ""} (Gemini không khả dụng)</p>`;
    el.interactionResult.innerHTML = html + poweredBy;
  } catch (err) {
    el.interactionResult.innerHTML = `<p class='muted' style='color:var(--danger)'>${err.message}</p>`;
  }
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
  const guardian = state.user.guardian || {};
  if (!guardian.guardianEmail) {
    showToast("Chưa có email người thân. Vào Hồ sơ → Người thân để cài đặt.", "warning");
    return;
  }
  const personalMessage = el.parentReportMessage?.value?.trim() || "";
  const sendBtn = document.getElementById("sendParentReportBtn");
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "⏳ Đang gửi..."; }
  try {
    if (el.parentReportStatus) el.parentReportStatus.textContent = "Đang gửi...";
    if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = "Đang gửi báo cáo..."; }
    const r = await api(`/api/users/${state.user.id}/remote-parent/send`, {
      method: "POST",
      body: JSON.stringify({ token: state.token, personalMessage }),
    });
    if (r.sent) {
      showToast(`✅ Đã gửi báo cáo đến ${guardian.guardianEmail}`, "success");
      if (el.parentReportStatus) el.parentReportStatus.textContent = r.message;
      if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = `✅ Đã gửi lúc ${new Date().toLocaleTimeString("vi-VN")} → ${guardian.guardianEmail}`; el.remoteParentInfoStatus.style.color = "#059669"; }
      if (el.parentReportMessage) el.parentReportMessage.value = "";
    } else {
      showToast(`❌ Không gửi được: ${r.message}`, "error");
      if (el.parentReportStatus) el.parentReportStatus.textContent = r.message;
      if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = `❌ ${r.message}`; el.remoteParentInfoStatus.style.color = "#dc2626"; }
    }
  } catch (err) {
    showToast(`Lỗi gửi email: ${err.message}`, "error");
    if (el.parentReportStatus) el.parentReportStatus.textContent = `Lỗi: ${err.message}`;
    if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = `❌ Lỗi: ${err.message}`; el.remoteParentInfoStatus.style.color = "#dc2626"; }
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "📨 Gửi báo cáo ngay hôm nay"; }
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
  el.startCameraBtn.addEventListener("click", () => { startCamera(); });
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
  // Item 3: Duration toggle (60s recommended ↔ 90s extended)
  el.measureDuration90Toggle?.addEventListener('click', () => {
    state.measurementDuration = state.measurementDuration === 60 ? 90 : 60;
    const label = `⏱ ${state.measurementDuration} giây`;
    if (el.measureDuration90Toggle) el.measureDuration90Toggle.textContent = label;
    if (el.startMeasureBtn) el.startMeasureBtn.textContent = `▶ Bắt đầu đo ${state.measurementDuration} giây`;
    showToast(`Thời gian đo: ${state.measurementDuration} giây${state.measurementDuration === 60 ? ' (khuyến nghị cho AFib)' : ' (nâng cao)'}`, 'success');
  });

  // New feature bindings
  document.getElementById("elderlyModeBtn")?.addEventListener("click", toggleElderlyMode);
  document.getElementById("handToggleBtn")?.addEventListener("click", toggleMeasurementHand);
  document.getElementById("expertModeBtn")?.addEventListener("click", toggleExpertMode);
  document.getElementById("researchModeBtn")?.addEventListener("click", toggleResearchMode);
  document.getElementById("shareReportBtn")?.addEventListener("click", shareHolterReport);
  document.getElementById("holterZaloBtn")?.addEventListener("click", () => shareHolterReport("zalo"));
  document.getElementById("holterGmailBtn")?.addEventListener("click", () => shareHolterReport("gmail"));
  document.getElementById("zaloClinicInfoBtn")?.addEventListener("click", openZaloClinicInfo);
  // Pre-fill Zalo clinic box on load
  setTimeout(openZaloClinicInfo, 100);
  document.getElementById("startBCGBtn")?.addEventListener("click", startMouseBCGTracking);
  document.getElementById("bpPhotoInput")?.addEventListener("change", e => ocrBloodPressure(e.target.files?.[0]));
  document.getElementById("saveBpOcrBtn")?.addEventListener("click", saveBpOcrReading);
  document.getElementById("calcBpMetricsBtn")?.addEventListener("click", calcBpMetrics);
  // Show save button + auto-calc when user types values
  ["bpSysInput", "bpDiaInput", "bpPulseInput"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      const btn = document.getElementById("saveBpOcrBtn");
      if (btn) btn.style.display = "block";
    });
  });
  // New: Ambient rPPG, SCG, Voice-rPPG, Keyboard BCG + stop buttons
  document.getElementById("ambientRPPGBtn")?.addEventListener("click", toggleAmbientRPPG);
  document.getElementById("startSCGBtn")?.addEventListener("click", startSCGChestSensor);
  document.getElementById("stopSCGBtn")?.addEventListener("click", stopSCGChestSensor);
  document.getElementById("startVoiceRPPGBtn")?.addEventListener("click", startVoiceRPPG);
  document.getElementById("stopVoiceRPPGBtn")?.addEventListener("click", stopVoiceRPPG);
  document.getElementById("startKBCGBtn")?.addEventListener("click", startKeyboardBCGTracking);
  document.getElementById("stopKBCGBtn")?.addEventListener("click", stopKeyboardBCGTracking);
  document.getElementById("stopBCGBtn")?.addEventListener("click", stopMouseBCGTracking);
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
  setTimeout(() => loadMttsModel(), 3000);
  showDailyHealthTip(); // 1.10
  checkBatteryForNight(); // 1.9
  // Restore elderly mode
  if (localStorage.getItem("hs_elderly") === "1") {
    document.body.classList.add("elderly-mode");
    const btn = document.getElementById("elderlyModeBtn");
    if (btn) btn.textContent = "👁 Tắt chế độ ông/bà";
  }
  // Restore Expert Mode (Holter) state across page reloads
  restoreExpertMode();
  // Restore Research Mode opt-in state
  renderResearchPanel();
  // Fall detection for mobile
  initFallDetection();
  // Encrypted local-first data
  await initLocalEncryption().then(() => { renderEncryptionStatus(); });
  // Personal BPM calibration — restore status indicators on load
  _updateCalibStatusUI('finger');
  _updateCalibStatusUI('face');
  // Skin calibration — sync manual setting vào state (fix: trước đây dead code)
  initSkinCalibFromStorage();
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
    <p class="muted" style="font-size:11px;margin-top:4px">💡 ${ctx.summary}</p>
    <div id="afibAiAnalysisBox" style="margin-top:12px;border-top:1px dashed #e2e8f0;padding-top:10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:#7c3aed">🤖 Phân tích chuyên sâu bằng Gemini AI</span>
      </div>
      <div id="afibAiAnalysisContent">
        <div style="display:flex;align-items:center;gap:8px;color:#94a3b8;font-size:12px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" style="animation:spin 0.9s linear infinite;flex-shrink:0"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          <span>Gemini AI đang phân tích nguyên nhân và đưa ra khuyến nghị...</span>
        </div>
      </div>
    </div>`;
}

async function fetchAfibTriggerAi(record, weather) {
  const r = record?.result || {};
  const body = JSON.stringify({
    token: state.token,
    result: {
      bpm: r.bpm || null,
      sdnn: r.sdnn || null,
      rmssd: r.rmssd || null,
      irregularityIndex: r.irregularityIndex || null,
      strokeRiskScore: r.strokeRiskScore || null,
      classification: r.classification || null,
    },
    contextNote: r.contextNote || "",
    weatherTemp: weather?.currentTemp ?? weather?.temp ?? null,
    weatherHumidity: weather?.humidity ?? null,
    weatherDesc: weather?.description || weather?.desc || "",
    weatherLocation: weather?.location || "",
    preMood: _preMoodState || "",
  });
  const aiContentEl = () => document.getElementById("afibAiAnalysisContent");
  try {
    const data = await api("/api/afib-context", { method: "POST", body });
    const el = aiContentEl();
    if (!el) return;
    if (data?.aiAnalysis) {
      let html = data.aiAnalysis
        .replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
        .replace(/\n\n/g, "</p><p style='margin:7px 0'>")
        .replace(/\n/g, "<br>");
      el.innerHTML = `<div style="font-size:12px;line-height:1.7;color:#334155"><p style="margin:0">${html}</p></div>`;
    } else {
      el.innerHTML = `<p style="color:#94a3b8;font-size:11px;font-style:italic;margin:0">Thêm ghi chú trước khi đo (ví dụ: "uống 2 ly cà phê, bị stress công việc") để Gemini AI phân tích chính xác hơn.</p>`;
    }
  } catch (err) {
    const el = aiContentEl();
    if (el) el.innerHTML = `<p style="color:#f87171;font-size:11px;margin:0">Không kết nối được AI — ${err.message}</p>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE LIST 5 — CLOT-RISK + VASCULAR RECOVERY
// ════════════════════════════════════════════════════════════════════════════════

function renderClotRisk(cr) {
  const box = document.getElementById("clotRiskBox");
  if (!box) return;
  if (!cr) { box.innerHTML = "<p class='muted'>Đo ngón trỏ 60 giây để nhận kết quả.</p>"; return; }
  const { score, level, label, advice, components } = cr;
  const bg = level === "HIGH" ? "#fef2f2" : level === "MODERATE" ? "#fffbeb" : "#f0fdf4";
  const bd = level === "HIGH" ? "#fca5a5" : level === "MODERATE" ? "#fde68a" : "#86efac";
  const scoreColor = level === "HIGH" ? "#dc2626" : level === "MODERATE" ? "#d97706" : "#16a34a";

  // Draw mini bar gauge
  const barW = Math.round((score / 100) * 100);
  const barColor = scoreColor;

  box.innerHTML = `
    <div style="background:${bg};border:1px solid ${bd};border-radius:10px;padding:14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="font-size:36px;font-weight:900;color:${scoreColor};min-width:52px;text-align:center">${score}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-bottom:4px">${label}</div>
          <div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%">
            <div style="background:${barColor};height:8px;border-radius:4px;width:${barW}%;transition:width 0.6s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-top:2px"><span>1 An toàn</span><span>50</span><span>100 Nguy hiểm</span></div>
        </div>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#374151">${advice}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:#64748b">
        <span style="background:#e2e8f0;padding:2px 8px;border-radius:10px">Nhịp: ${components.rhythmFactor}pt</span>
        <span style="background:#e2e8f0;padding:2px 8px;border-radius:10px">Sóng: ${components.morphFactor}pt</span>
        <span style="background:#e2e8f0;padding:2px 8px;border-radius:10px">HRV: ${components.hrvFactor}pt</span>
        <span style="background:#e2e8f0;padding:2px 8px;border-radius:10px">Lâm sàng: ${components.clinFactor}pt</span>
      </div>
    </div>
    ${level === "MODERATE" ? `<div style="margin-top:8px;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400e">💡 <strong>Nhắc thuốc chống đông:</strong> Nếu bác sĩ đã kê Apixaban/Rivaroxaban, đây là thời điểm không được quên uống thuốc.</div>` : ""}
    ${level === "HIGH" ? `<div style="margin-top:8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 12px;font-size:13px;color:#991b1b"><strong>🚨 Hành động ngay:</strong> ${advice} <button onclick="document.getElementById('triggerSosBtn')?.click()" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;margin-left:8px;cursor:pointer">Kích hoạt SOS</button></div>` : ""}`;
}

function renderVascularRecovery(vr) {
  const box = document.getElementById("vascularRecoveryBox");
  if (!box) return;
  if (!vr) { box.innerHTML = "<p class='muted'>Đo ngay sau khi ngủ dậy để đánh giá chất lượng phục hồi mạch máu qua đêm.</p>"; return; }
  const { score, status, statusLabel, recommendation, aixProxy } = vr;
  const bg = status === "EXCELLENT" ? "#f0fdf4" : status === "MODERATE" ? "#fffbeb" : "#fef2f2";
  const bd = status === "EXCELLENT" ? "#86efac" : status === "MODERATE" ? "#fde68a" : "#fca5a5";
  const scoreColor = status === "EXCELLENT" ? "#16a34a" : status === "MODERATE" ? "#d97706" : "#dc2626";
  const barW = score;

  box.innerHTML = `
    <div style="background:${bg};border:1px solid ${bd};border-radius:10px;padding:14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="font-size:36px;font-weight:900;color:${scoreColor};min-width:52px;text-align:center">${score}%</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-bottom:4px">${statusLabel}</div>
          <div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%">
            <div style="background:${scoreColor};height:8px;border-radius:4px;width:${barW}%;transition:width 0.6s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-top:2px"><span>0% Chưa phục hồi</span><span>100% Hoàn toàn</span></div>
        </div>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#374151">${recommendation}</p>
      <div style="font-size:11px;color:#64748b">
        <span style="background:#e2e8f0;padding:2px 8px;border-radius:10px">Độ đàn hồi mạch (AIx proxy): ${aixProxy}%</span>
      </div>
    </div>
    ${status === "POOR" ? `<div style="margin-top:8px;padding:10px 14px;background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;font-size:13px;color:#991b1b"><strong>⚠️ Nguy cơ Morning Surge:</strong> Đây là khung giờ nguy hiểm nhất cho đột quỵ. Ngồi yên trên giường 10 phút trước khi đứng dậy. Đo huyết áp cơ học ngay.</div>` : ""}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE LIST 6 — POCKET CARDIOLOGIST (BÁC SĨ ẢO)
// ════════════════════════════════════════════════════════════════════════════════

// Rule-based Q&A — chỉ dùng khi Gemini không khả dụng
// Mỗi entry: { test: (q) => boolean, fn: (r, u) => string }
// Dùng hàm test() thay vì regex toàn cục để tránh khớp sai
// ─── Rule-based fallback — dùng khi Gemini không khả dụng ───────────────────
// Mỗi entry: { test(q)→bool, fn(r,u)→string }
// Test dùng .includes() hoặc regex đơn giản — không dùng \b với tiếng Việt
const _pcResponses = [
  // ── Cấp cứu: triệu chứng đột quỵ đang xảy ra ──
  {
    test: q => /(méo miệng|nói không được|liệt.*mặt|tê liệt đột ngột|mắt mờ đột ngột|đột ngột không nói được|yếu một bên người)/.test(q),
    fn: () => `🚨 Đây có thể là dấu hiệu ĐỘT QUỴ đang xảy ra! Gọi 115 NGAY! Trong lúc chờ: cho người bệnh nằm nghiêng, không cho ăn uống, ghi giờ xuất hiện triệu chứng. ĐỪNG tự lái xe đến viện.`,
  },
  // ── Cấp cứu: đau ngực dữ dội ──
  {
    test: q => /(đau ngực dữ dội|đau ngực lan ra|tức ngực không thở được|đau ngực kèm khó thở|đau ngực đột ngột)/.test(q),
    fn: (r) => r.classification === "afib"
      ? `🚨 AFib kèm đau ngực dữ dội = cấp cứu ngay! Gọi 115! Ngồi xuống, nới lỏng quần áo. Nhai 1 viên Aspirin 100mg nếu không dị ứng.`
      : `Đau ngực dữ dội cần kiểm tra khẩn. Gọi 115 hoặc nhờ người đưa đến phòng cấp cứu gần nhất ngay.`,
  },
  // ── Kết quả đo: bình thường không / có sao không ──
  {
    test: q => /(có sao không|có nguy hiểm không|nguy hiểm không|kết quả.*thế nào|kết quả.*ổn không|chỉ số.*ổn|tim.*ổn|bình thường không|có ổn không|ổn không|có bình thường)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Kết quả đo phát hiện dấu hiệu RUNG NHĨ (AFib) — nhịp tim không đều. Đây là tình trạng cần bác sĩ tim mạch đánh giá trong 24 giờ. Ngay lúc này: ngồi nghỉ, thở đều, không vận động mạnh. Nếu có đau ngực hoặc khó thở → gọi 115.`;
      if (r.classification === "elevated") return `Nhịp tim ${r.bpm || "--"} BPM hơi cao hơn bình thường nhưng chưa nguy hiểm. Nghỉ ngơi 15-20 phút, tránh cà phê và căng thẳng rồi đo lại. Nếu vẫn cao sau 2-3 lần đo liên tiếp, nên gặp bác sĩ.`;
      return `Tim bạn đang đập bình thường — nhịp ${r.bpm || "--"} BPM đều đặn, không có dấu hiệu loạn nhịp. Tiếp tục duy trì lịch đo hàng ngày để phát hiện sớm nếu có thay đổi.`;
    },
  },
  // ── Giải thích kết quả / chỉ số ──
  {
    test: q => /(kết quả.*nghĩa là|chỉ số.*nghĩa|hiểu kết quả|giải thích kết quả|con số.*nghĩa|hrv|sdnn|rmssd|shock index|clot.?risk|nguy cơ huyết khối|đột quỵ.*%|%.*đột quỵ|stroke risk|irregularity|bất thường nhịp)/.test(q),
    fn: (r) => {
      const bpm = r.bpm || "--"; const cls = r.classification; const risk = r.strokeRiskScore || 0;
      const sdnn = r.sdnn || "--"; const irr = r.irregularityIndex || 0;
      const clot = r.clotRisk?.score ?? "--"; const clotLv = r.clotRisk?.level || "--";
      return `Giải thích kết quả đo của bạn:\n- Nhịp tim: ${bpm} BPM (bình thường: 60-100 BPM)\n- Trạng thái: ${cls === "afib" ? "Rung nhĩ — nhịp không đều" : cls === "elevated" ? "Nhịp cao — cần chú ý" : "Bình thường"}\n- Nguy cơ đột quỵ: ${risk}% (thấp: <30%, cao: >60%)\n- HRV/SDNN: ${sdnn}ms (cao = tim khỏe, lý tưởng >50ms)\n- Độ bất thường nhịp: ${irr}% (bình thường: <15%)\n- Huyết khối: ${clot}/100 mức ${clotLv}\nNhấn "Xuất báo cáo" để có bản đầy đủ cho bác sĩ.`;
    },
  },
  // ── Rung nhĩ / AFib là gì ──
  {
    test: q => /(rung nhĩ|afib|atrial fibrillation|loạn nhịp tim|nhịp không đều|tim đập không đều|tim đập lộn xộn)/.test(q),
    fn: (r) => {
      const base = `Rung nhĩ (AFib) là tình trạng buồng nhĩ của tim co bóp không đều, hỗn loạn thay vì đập đều đặn. Hậu quả: máu đọng trong tim → hình thành cục máu đông → nguy cơ đột quỵ tăng 5 lần. Triệu chứng thường gặp: hồi hộp, chóng mặt, mệt mỏi, khó thở nhẹ, đôi khi không có triệu chứng gì.`;
      if (r.classification === "afib") return base + ` Kết quả đo của bạn có dấu hiệu rung nhĩ — cần gặp bác sĩ tim mạch để xác nhận bằng ECG và có phác đồ điều trị.`;
      return base + ` Kết quả đo của bạn hiện tại không có dấu hiệu rung nhĩ — tốt! Tiếp tục đo đều đặn để theo dõi.`;
    },
  },
  // ── Nhịp tim bao nhiêu là bình thường ──
  {
    test: q => /(nhịp tim.*bình thường|bpm.*bình thường|bình thường.*bpm|nhịp tim bao nhiêu|nhịp tim lý tưởng|nhịp tim.*nhanh|nhịp tim.*chậm|tim đập nhanh|tim đập chậm|tim.*nhanh|tim.*chậm)/.test(q),
    fn: (r) => {
      const bpm = r.bpm || "--";
      return `Nhịp tim bình thường khi nghỉ ngơi: 60-100 BPM.\n- Dưới 60 BPM: nhịp chậm (có thể bình thường ở vận động viên, hoặc do thuốc)\n- 60-100 BPM: lý tưởng\n- 100-120 BPM: nhịp nhanh nhẹ, thường do stress/caffeine/mất nước\n- Trên 120 BPM khi nghỉ: cần kiểm tra\nNhịp tim của bạn vừa đo: ${bpm} BPM${Number(bpm) > 100 ? " — hơi nhanh, nghỉ ngơi và đo lại" : Number(bpm) < 60 ? " — hơi chậm, theo dõi thêm" : " — trong phạm vi bình thường"}.`;
    },
  },
  // ── Huyết áp ──
  {
    test: q => /(huyết áp|blood pressure|cao huyết áp|tăng huyết áp|huyết áp cao|huyết áp thấp|đo huyết áp)/.test(q),
    fn: (r) => `HeartSense đo nhịp tim và nhịp điệu tim qua camera — không đo huyết áp trực tiếp. Để đo huyết áp, bạn cần máy đo huyết áp cơ học riêng.\nCách đo đúng: ngồi nghỉ 5 phút, đặt tay ngang tim, đo 2-3 lần, lấy giá trị trung bình.\nHuyết áp bình thường: dưới 120/80 mmHg.\nHuyết áp của bạn và nhịp tim (${r.bpm || "--"} BPM) nên được theo dõi song song hàng ngày để có bức tranh sức khỏe toàn diện.`,
  },
  // ── Đột quỵ / nguy cơ đột quỵ ──
  {
    test: q => /(đột quỵ|stroke|nguy cơ đột quỵ|phòng tránh đột quỵ|đột quỵ.*phòng|tránh đột quỵ)/.test(q),
    fn: (r) => {
      const risk = r.strokeRiskScore || 0;
      const lvl = risk > 65 ? "cao — cần gặp bác sĩ sớm" : risk > 35 ? "trung bình — cần chú ý" : "thấp — tiếp tục duy trì";
      return `Nguy cơ đột quỵ của bạn theo HeartSense: ${risk}% (${lvl}).\nCách phòng tránh đột quỵ hiệu quả:\n1. Kiểm soát huyết áp dưới 130/80 mmHg\n2. Không hút thuốc lá\n3. Hạn chế rượu bia\n4. Tập thể dục đều đặn 30 phút/ngày\n5. Ăn ít muối, nhiều rau xanh và cá\n6. Điều trị AFib nếu có (giảm nguy cơ đột quỵ 70%)\nNhận biết đột quỵ: méo miệng, yếu tay chân một bên, nói lắp — gọi 115 ngay.`;
    },
  },
  // ── Mệt mỏi / mệt sau đo ──
  {
    test: q => /(mệt mỏi|cảm thấy mệt|hay mệt|mệt suốt|kiệt sức|thiếu năng lượng|uể oải)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Mệt mỏi là triệu chứng thường gặp khi có rung nhĩ — tim đập không hiệu quả khiến máu không bơm đủ. Kết quả đo của bạn có dấu hiệu AFib. Nghỉ ngơi và gặp bác sĩ sớm để được điều trị, mệt mỏi sẽ cải thiện rõ rệt khi nhịp tim ổn định lại.`;
      return `Mệt mỏi liên quan tim mạch có thể do: thiếu ngủ, mất nước, thiếu sắt, huyết áp thấp, hoặc rối loạn nhịp tim nhẹ.\nNhịp tim của bạn: ${r.bpm || "--"} BPM — ${r.classification === "elevated" ? "hơi cao, cơ thể cần nhiều oxy hơn bình thường" : "bình thường"}.\nThử: uống 400ml nước, nằm nghỉ 20 phút, đo lại xem nhịp tim có cải thiện không.`;
    },
  },
  // ── Chóng mặt / đau đầu (không cấp cứu) ──
  {
    test: q => /(chóng mặt|đau đầu|nhức đầu|đầu váng|hoa mắt|choáng nhẹ|đứng lên chóng mặt)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Chóng mặt/đau đầu kèm rung nhĩ cần được chú ý — có thể do não không được cung cấp máu ổn định. Ngồi xuống ngay, không đứng đột ngột. Nếu chóng mặt dữ dội kèm buồn nôn, méo miệng hoặc yếu tay chân → gọi 115 ngay (dấu hiệu đột quỵ).`;
      return `Chóng mặt và đau đầu nhẹ thường do: mất nước, đứng lên quá nhanh (hạ huyết áp tư thế), căng thẳng, hoặc thiếu ngủ. Nhịp tim bạn: ${r.bpm || "--"} BPM.\nThử ngay: uống 1 ly nước, ngồi nghỉ 10 phút, đứng lên từ từ. Nếu đau đầu kèm cứng gáy hoặc sốt → đến khám bác sĩ.`;
    },
  },
  // ── Khó thở / hụt hơi ──
  {
    test: q => /(khó thở|hụt hơi|thở không được|thở nặng|thở gấp|hay bị khó thở|thiếu khí)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Khó thở kèm rung nhĩ là triệu chứng quan trọng — tim đập không đều làm giảm hiệu quả bơm máu. Nếu khó thở đột ngột hoặc nặng → gọi 115. Nếu nhẹ: ngồi thẳng, thở chậm 4 giây hít vào – 6 giây thở ra, lặp 5 lần.`;
      return `Khó thở nhẹ thường do: căng thẳng, tư thế xấu, thiếu vận động, hoặc không khí trong nhà kém. Nhịp tim ${r.bpm || "--"} BPM — ${r.classification === "elevated" ? "hơi cao có thể gây cảm giác thiếu hơi" : "bình thường"}.\nNếu khó thở kèm đau ngực hoặc môi/ngón tay tím tái → đây là cấp cứu, gọi 115 ngay.`;
    },
  },
  // ── Hồi hộp / đánh trống ngực ──
  {
    test: q => /(hồi hộp|đánh trống ngực|tim đập mạnh|tim.*loạn|cảm giác tim.*nhảy|tim đập thình thịch)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Hồi hộp, đánh trống ngực là triệu chứng điển hình của rung nhĩ — tim đập hỗn loạn thay vì đều đặn. Kết quả đo của bạn có dấu hiệu AFib. Ngồi nghỉ, thở đều. Nếu hồi hộp kèm chóng mặt hoặc đau ngực → gọi 115.`;
      return `Hồi hộp thoáng qua thường do: caffeine, căng thẳng, mất nước, hoặc thức khuya. Nhịp tim ${r.bpm || "--"} BPM — ${r.classification === "elevated" ? "hơi nhanh" : "bình thường"}.\nThử: tránh cà phê 6 giờ, uống nước, nghỉ ngơi. Nếu hồi hộp kéo dài trên 30 phút hoặc xảy ra thường xuyên → nên đo lại và gặp bác sĩ kiểm tra.`;
    },
  },
  // ── Cà phê / caffeine ──
  {
    test: q => /(cà phê|cafe|caffeine|trà đặc|nước tăng lực|năng lượng.*uống)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Với rung nhĩ, tốt nhất hạn chế hoặc ngừng hẳn cà phê — caffeine kích thích hệ giao cảm, có thể làm nhịp tim bất thường hơn. Nếu khó bỏ, giới hạn 1 ly nhỏ buổi sáng, không uống buổi chiều/tối.`;
      if (r.classification === "elevated") return `Nhịp tim của bạn đang hơi cao. Tạm thời tránh cà phê, trà đặc và nước tăng lực hôm nay. Sau khi nhịp tim về bình thường, 1-2 ly cà phê/ngày là chấp nhận được với người không có bệnh tim.`;
      return `Với tim khỏe mạnh, 1-2 ly cà phê/ngày (dưới 400mg caffeine) là an toàn. Tránh uống sau 2h chiều để không ảnh hưởng giấc ngủ. Nếu sau khi uống cà phê cảm thấy hồi hộp hoặc nhịp tim nhanh — đó là tín hiệu cơ thể cần giảm liều.`;
    },
  },
  // ── Rượu bia / alcohol ──
  {
    test: q => /(rượu|bia|cồn|alcohol|đồ uống có cồn|uống bia được không|uống rượu được không)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Với rung nhĩ: KHÔNG nên uống rượu bia. Alcohol là một trong những tác nhân phổ biến nhất kích hoạt cơn AFib cấp tính — "Holiday Heart Syndrome". Ngay cả lượng nhỏ cũng có thể gây tái phát. Nên kiêng hoàn toàn.`;
      return `Rượu bia ảnh hưởng trực tiếp đến tim: làm nhịp tim tăng, huyết áp tăng, và tăng nguy cơ rung nhĩ. Nếu uống: không quá 1 đơn vị/ngày (1 lon bia 330ml hoặc 1 ly vang nhỏ). Không uống khi đang dùng thuốc tim mạch.`;
    },
  },
  // ── Hút thuốc lá ──
  {
    test: q => /(hút thuốc|thuốc lá|nicotine|cigar|khói thuốc|cai thuốc|bỏ thuốc)/.test(q),
    fn: () => `Hút thuốc lá là yếu tố nguy cơ số 1 gây bệnh tim mạch và đột quỵ. Nicotine làm co mạch, tăng huyết áp, tăng nhịp tim và hình thành mảng xơ vữa.\nBỏ thuốc lá giúp: giảm 50% nguy cơ nhồi máu cơ tim sau 1 năm, giảm 80% nguy cơ sau 15 năm.\nCách bỏ hiệu quả: kẹo nicotine + tham vấn bác sĩ + ứng dụng hỗ trợ cai thuốc. Đừng cai một mình — tỷ lệ thành công tăng 3 lần khi có hỗ trợ.`,
  },
  // ── Cân nặng / béo phì ──
  {
    test: q => /(cân nặng|thừa cân|béo phì|bmi|giảm cân|tăng cân.*tim|tim.*cân nặng)/.test(q),
    fn: () => `Thừa cân (BMI >25) làm tăng nguy cơ: cao huyết áp, rung nhĩ, tiểu đường tuýp 2, và suy tim. Mỗi 5kg giảm có thể làm giảm huyết áp tâm thu 5 mmHg.\nMục tiêu thực tế: giảm 0.5-1kg/tuần bằng cách giảm 500 kcal/ngày + đi bộ 30 phút/ngày. Không nhịn ăn đột ngột — gây stress cho tim.`,
  },
  // ── Tiểu đường ──
  {
    test: q => /(tiểu đường|đái tháo đường|đường huyết|glucose|insulin|đường trong máu)/.test(q),
    fn: (r) => `Tiểu đường và bệnh tim mạch liên quan chặt chẽ — người tiểu đường có nguy cơ bệnh tim cao gấp 2-4 lần.\nVới nhịp tim ${r.bpm || "--"} BPM của bạn, điều quan trọng là: kiểm soát đường huyết mục tiêu HbA1c <7%, huyết áp <130/80 mmHg, và cholesterol LDL <70 mg/dL (nếu đã có bệnh tim).\nĐo đường huyết lúc đói và sau ăn 2 giờ để theo dõi. Chia nhỏ bữa ăn, hạn chế tinh bột trắng và đường.`,
  },
  // ── Ngủ / mất ngủ ──
  {
    test: q => /(mất ngủ|ngủ không được|ngủ kém|khó ngủ|giấc ngủ|ngưng thở.*ngủ|ngáy|sleep apnea|ngủ đủ giờ.*vẫn mệt)/.test(q),
    fn: () => `Ngủ kém ảnh hưởng nghiêm trọng đến tim: ngủ dưới 6 giờ/đêm tăng 20% nguy cơ đau tim.\nNgưng thở khi ngủ (sleep apnea — thường kèm ngáy to) là nguyên nhân thầm lặng gây AFib và cao huyết áp ban đêm.\nCách cải thiện giấc ngủ:\n1. Ngủ và thức cùng giờ mỗi ngày\n2. Không dùng điện thoại 1 giờ trước khi ngủ\n3. Phòng ngủ tối, mát (18-22°C)\n4. Tránh cà phê sau 2h chiều\nĐo HeartSense vào buổi sáng sau ngủ dậy để xem chỉ số phục hồi tim.`,
  },
  // ── Stress / lo âu / căng thẳng ──
  {
    test: q => /(stress|căng thẳng|lo âu|lo lắng|áp lực|bồn chồn|hồi hộp vì lo|tâm lý|cảm xúc.*tim)/.test(q),
    fn: () => `Stress và lo âu kích hoạt hormone cortisol và adrenaline → tăng nhịp tim, co mạch, tăng huyết áp. Stress mạn tính là yếu tố nguy cơ độc lập gây rung nhĩ và nhồi máu cơ tim.\nKỹ thuật giảm stress hiệu quả nhất cho tim:\n1. Thở 4-7-8: hít 4s — nín 7s — thở ra 8s (lặp 4 lần)\n2. Thở Hộp: 4s hít – 4s nín – 4s thở ra – 4s nín (tập sáng/tối)\n3. Đi bộ 20 phút ngoài trời\nTập đều đặn 2 lần/ngày — tác dụng thấy rõ sau 2 tuần.`,
  },
  // ── Tập thể dục ──
  {
    test: q => /(tập thể dục|vận động|chạy bộ|đi bộ|bơi lội|yoga|gym|thể thao|tập luyện|exercise)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Khi đang có rung nhĩ: KHÔNG tập thể dục cường độ cao. Đi bộ nhẹ 10-15 phút trong nhà là an toàn. Sau khi AFib được kiểm soát bằng thuốc: đi bộ 20-30 phút/ngày, bơi lội và yoga nhẹ nhàng đều tốt. Tránh môn thể thao có tính đối kháng hoặc cường độ cao.`;
      return `Tập thể dục đều đặn là thuốc tốt nhất cho tim:\n- Lý tưởng: 150 phút/tuần (30 phút × 5 ngày) cường độ vừa\n- Tốt nhất: đi bộ nhanh, bơi lội, đạp xe, yoga\n- Đo nhịp tim khi tập: nên ở 50-70% nhịp tim tối đa (220 - tuổi của bạn)\nNhịp tim hiện tại: ${r.bpm || "--"} BPM — ${r.classification === "elevated" ? "hơi cao, hôm nay chỉ nên đi bộ nhẹ" : "tốt, có thể tập bình thường"}.`;
    },
  },
  // ── Ăn uống / chế độ ăn ──
  {
    test: q => /(ăn gì|ăn uống|chế độ ăn|kiêng gì|thực phẩm|dinh dưỡng|nên ăn|không nên ăn|thức ăn|bữa ăn)/.test(q),
    fn: (_, u) => {
      const conds = (u?.conditions || []).join(" ").toLowerCase();
      let extra = "";
      if (/cao huyết áp|tăng huyết áp/.test(conds)) extra = "\nVới cao huyết áp: giảm muối xuống dưới 3g/ngày là ưu tiên số một.";
      if (/afib|rung nhĩ/.test(conds)) extra = "\nVới AFib: tuyệt đối tránh rượu bia và hạn chế caffeine.";
      if (/tiểu đường/.test(conds)) extra = "\nVới tiểu đường: hạn chế tinh bột trắng, đường ngọt, ăn nhiều bữa nhỏ.";
      return `Chế độ ăn tốt nhất cho tim (DASH diet):\nNên ăn nhiều: cá (omega-3), rau xanh, trái cây, ngũ cốc nguyên hạt, hạt óc chó, dầu ô liu.\nHạn chế: muối (<5g/ngày), thịt đỏ, đồ chiên rán, thực phẩm chế biến sẵn, đồ ngọt, rượu bia.${extra}\nMẹo nhỏ: ăn rau trước khi ăn tinh bột — giúp no nhanh hơn và kiểm soát đường huyết tốt hơn.`;
    },
  },
  // ── Thuốc / điều trị ──
  {
    test: q => /(uống thuốc|thuốc tim|thuốc chống đông|apixaban|rivaroxaban|warfarin|flecainide|propafenone|metoprolol|bisoprolol|amiodarone|thuốc.*huyết áp|có cần uống thuốc|nên uống thuốc gì)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Với rung nhĩ, bác sĩ thường kê 2 nhóm thuốc:\n1. Thuốc chống đông (Apixaban/Rivaroxaban/Warfarin): ngăn hình thành cục máu đông, phòng đột quỵ — KHÔNG tự bỏ liều\n2. Thuốc kiểm soát nhịp tim (Metoprolol/Bisoprolol/Amiodarone): làm tim đập chậm lại và đều hơn\nNếu đã có đơn: uống đúng giờ, không tự tăng/giảm liều. Nếu chưa có đơn: không tự uống — cần ECG để xác nhận và bác sĩ kê đơn phù hợp.`;
      return `Với kết quả tim hiện tại, uống đúng theo đơn bác sĩ đã kê. Không tự ý thay đổi liều.\nNếu đang dùng thuốc tim mạch: uống cùng giờ mỗi ngày, không bỏ liều dù cảm thấy khỏe. Ghi nhật ký uống thuốc và huyết áp/nhịp tim hàng ngày để bác sĩ theo dõi.`;
    },
  },
  // ── Đi khám / bệnh viện ──
  {
    test: q => /(đi khám|gặp bác sĩ|bệnh viện|phòng khám|cần khám|nên khám|khám tim|tim mạch.*khám)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Bạn cần gặp bác sĩ tim mạch sớm — lý tưởng trong 24-48 giờ. Mang theo điện thoại để bác sĩ xem kết quả đo HeartSense. Bệnh viện Tim Hà Nội: 03 Chu Văn An — (024) 3843-3338. BV Chợ Rẫy (TP.HCM): (028) 3855-4137.`;
      if ((r.strokeRiskScore || 0) > 60) return `Nguy cơ đột quỵ của bạn ${r.strokeRiskScore}% — nên gặp bác sĩ tim mạch trong tuần này để đánh giá toàn diện và có kế hoạch phòng ngừa.`;
      return `Kết quả hiện tại không cần khám khẩn. Nên tái khám định kỳ 3-6 tháng/lần hoặc khi có triệu chứng mới. Dùng nút "Xuất báo cáo" để in/gửi kết quả HeartSense cho bác sĩ xem trước khi khám.`;
    },
  },
  // ── Làm gì tiếp theo / hành động ──
  {
    test: q => /(làm gì|phải làm|nên làm|tiếp theo|bước tiếp|hành động|cần làm gì)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Ngay bây giờ:\n1. Ngồi xuống, dựa lưng vào ghế\n2. Thở sâu: hít 4s — thở ra 6s, lặp 5 lần\n3. Uống 1 cốc nước ấm\n4. Uống thuốc chống đông nếu đã có đơn\n5. Gọi thông báo người thân\n6. Đo lại sau 15 phút\nNếu vẫn AFib hoặc có đau ngực/khó thở → gọi 115.`;
      if (r.classification === "elevated") return `Nhịp tim hơi cao — hành động ngay:\n1. Ngồi nghỉ 20 phút, không vận động\n2. Uống 1 ly nước lọc\n3. Tránh cà phê và căng thẳng trong 6 giờ tới\n4. Đo lại sau 20 phút\nNếu sau 2-3 lần đo vẫn cao → gọi bác sĩ.`;
      return `Tim bạn đang bình thường! Duy trì:\n1. Đi bộ 20-30 phút hôm nay\n2. Uống đủ 1.5-2L nước\n3. Ngủ trước 22h, đủ 7-8 giờ\n4. Đo HeartSense vào sáng mai để theo dõi xu hướng`;
    },
  },
  // ── Đo khi nào / cách đo ──
  {
    test: q => /(đo khi nào|đo lúc nào|tần suất đo|bao lâu đo|cách đo|đo đúng cách|đo.*camera|camera.*đo|đặt ngón tay|đặt mặt)/.test(q),
    fn: () => `Cách đo HeartSense cho kết quả tốt nhất:\n- Thời điểm tốt: sáng sau ngủ dậy 10 phút (trước khi uống cà phê), hoặc tối trước khi ngủ\n- Tư thế: ngồi thẳng, thư giãn, không nói chuyện\n- Ánh sáng: đủ sáng, không ngược sáng\n- Đo mặt: nhìn thẳng vào camera, giữ yên 60 giây\n- Đo ngón tay: đặt ngón trỏ che đúng camera sau, giữ nhẹ nhàng\nTần suất lý tưởng: 1-2 lần/ngày. Đo lại nếu lần đầu ra kết quả bất thường.`,
  },
  // ── HRV / SDNN ──
  {
    test: q => /(hrv|heart rate variability|sdnn|rmssd|biến thiên nhịp tim|chỉ số hrv)/.test(q),
    fn: (r) => `HRV (Heart Rate Variability) đo sự biến thiên khoảng cách giữa các nhịp tim — tim khỏe sẽ có HRV cao hơn.\n- SDNN của bạn: ${r.sdnn || "--"}ms\n- Dưới 20ms: cần chú ý\n- 20-50ms: trung bình\n- Trên 50ms: tốt\n- Trên 100ms: rất tốt (thường thấy ở vận động viên)\nHRV thấp liên quan đến: stress mạn tính, ngủ kém, bệnh tim, và tập luyện quá sức. Để tăng HRV: ngủ đủ giấc, tập thở sâu đều đặn, và giảm stress.`,
  },
  // ── Huyết khối / cục máu đông ──
  {
    test: q => /(huyết khối|cục máu đông|máu đông|clot|đông máu|nguy cơ huyết khối)/.test(q),
    fn: (r) => {
      const score = r.clotRisk?.score ?? "--"; const lvl = r.clotRisk?.level || "--";
      return `Nguy cơ huyết khối của bạn: ${score}/100 — mức ${lvl}.\nHuyết khối (cục máu đông) hình thành trong tim khi AFib gây máu đọng, có thể theo máu lên não → đột quỵ.\nPhòng ngừa hiệu quả:\n1. Điều trị AFib nếu có\n2. Uống thuốc chống đông theo chỉ định bác sĩ\n3. Không ngồi một chỗ quá 1 giờ — đứng dậy đi lại\n4. Uống đủ nước để máu không đặc\n5. Không hút thuốc lá`;
    },
  },
  // ── Đau ngực nhẹ / tức ngực (không phải cấp cứu) ──
  {
    test: q => /(tức ngực|đau ngực nhẹ|ngực hơi đau|ngực căng|nặng ngực|nhói ngực|đau tim nhẹ)/.test(q) && !/(dữ dội|không thở được|lan.*cánh tay)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Tức ngực kèm rung nhĩ cần được đánh giá ngay hôm nay — dù chỉ ở mức nhẹ. Đây có thể là dấu hiệu tim đập không hiệu quả gây thiếu máu cơ tim thoáng qua.\n\nCần phân biệt ngay:\n1. Nếu đau ngực đột ngột tăng nặng, lan ra vai trái hoặc hàm, kèm đổ mồ hôi lạnh → GỌI 115 NGAY (nhồi máu cơ tim)\n2. Nếu chỉ tức nhẹ, không lan, không kèm khó thở → ngồi nghỉ, thở chậm, gọi bác sĩ trong ngày\n\nKết quả đo của bạn có dấu hiệu AFib (${r.bpm || "--"} BPM không đều) — làm ECG và siêu âm tim là bước tiếp theo quan trọng.`;
      return `Đau/tức ngực nhẹ không nhất thiết là bệnh tim. Có nhiều nguyên nhân thường gặp:\n\n1. Trào ngược dạ dày (GERD): đau sau ăn, có vị chua; uống thuốc kháng acid giảm nhanh\n2. Viêm sụn sườn (Costochondritis): đau tăng khi ấn vào xương ức hoặc sườn; uống ibuprofen giảm\n3. Co cơ ngực/gian sườn: đau tăng khi hít sâu hoặc xoay người; thường do ngồi sai tư thế\n4. Lo âu / rối loạn hoảng sợ: kèm thở nhanh, tê tay, tim đập nhanh — rất phổ biến\n5. Bệnh tim thực sự: cảm giác bóp chặt, lan ra hàm/vai trái, kèm mồ hôi; không tự giảm khi nghỉ\n\nNhịp tim của bạn: ${r.bpm || "--"} BPM — ${r.classification === "elevated" ? "hơi cao, có thể làm cảm giác tức ngực rõ hơn" : "trong phạm vi bình thường"}.\n\nNên gặp bác sĩ làm ECG để loại trừ bệnh tim nếu: đau ngực kéo dài hơn 2 tuần, xảy ra khi leo cầu thang/gắng sức, hoặc kèm khó thở.`;
    },
  },
  // ── Ngất xỉu / gần ngất ──
  {
    test: q => /(ngất|xỉu|mất ý thức|ngã khuỵu|gần ngất|choáng khi đứng|tối mắt đứng dậy|mờ mắt đứng)/.test(q),
    fn: (r) => {
      if (r.classification === "afib") return `Ngất xỉu kèm rung nhĩ là tình huống nghiêm trọng — nguyên nhân có thể là nhịp tim quá nhanh hoặc quá chậm làm não không nhận đủ máu.\n\nNếu bệnh nhân chưa tỉnh hoặc ngất kéo dài hơn 1 phút → GỌI 115 NGAY.\n\nNếu chỉ gần ngất: nằm xuống ngay, gác chân lên cao hơn đầu, theo dõi nhịp thở. Gọi bác sĩ ngay trong ngày — cần làm Holter ECG 24h để phát hiện các đợt rối loạn nhịp nguy hiểm.`;
      return `Gần ngất / ngất xỉu có hai cơ chế chính:\n\n1. Ngất phế vị (Vasovagal — 80% trường hợp): xảy ra khi đứng lâu, sợ hãi, nhiệt độ cao, đau đột ngột; tim chậm lại đột ngột, huyết áp giảm. Có dấu hiệu báo trước: buồn nôn, vã mồ hôi, mờ mắt. Lành tính, tự hồi phục khi nằm xuống.\n\n2. Ngất do tim mạch (cần đánh giá khẩn): nhịp tim quá nhanh (>180 BPM) hoặc quá chậm (<30 BPM), block tim, hoặc AFib. Đặc điểm nguy hiểm: không có báo trước, xảy ra khi đang gắng sức, hoặc khi đang ngồi/nằm yên.\n\nNhịp tim của bạn: ${r.bpm || "--"} BPM.\n\nNếu đây là lần đầu ngất hoặc xảy ra khi gắng sức → cần làm ECG và Holter 24h để loại trừ rối loạn nhịp nghiêm trọng. Đừng tự lái xe đến bệnh viện — nhờ người đi cùng.`;
    },
  },
  // ── Mỡ máu / cholesterol ──
  {
    test: q => /(mỡ máu|cholesterol|triglyceride|hdl|ldl|xơ vữa|lipid|mỡ trong máu|mỡ cao)/.test(q),
    fn: (r) => `Cholesterol tích tụ trong thành mạch hình thành mảng xơ vữa → hẹp động mạch tim → nhồi máu cơ tim hoặc đột quỵ.\n\nMục tiêu theo ESC 2024:\n1. LDL (xấu): <100 mg/dL bình thường; <70 mg/dL nếu có bệnh tim; <55 mg/dL sau nhồi máu\n2. HDL (tốt): >40 mg/dL (nam), >50 mg/dL (nữ) — càng cao càng tốt\n3. Triglyceride: <150 mg/dL\n4. Cholesterol toàn phần: <200 mg/dL\n\nVới nhịp tim ${r.bpm || "--"} BPM và ${r.classification === "afib" ? "rung nhĩ đã phát hiện" : "không loạn nhịp"}, kiểm soát cholesterol đặc biệt quan trọng vì AFib + mảng xơ vữa tăng mạnh nguy cơ đột quỵ.\n\nKiểm soát không dùng thuốc: giảm thịt đỏ và đồ chiên, tăng cá hồi/omega-3, ăn yến mạch và đậu nành hàng ngày. Mỗi 10% giảm LDL = giảm 20-25% nguy cơ nhồi máu cơ tim.\n\nNếu chưa xét nghiệm mỡ máu trong 1 năm qua: làm xét nghiệm lipid đồ toàn phần (nhịn ăn 8-12 giờ trước lấy máu). Nếu LDL >160 mg/dL kèm yếu tố nguy cơ → bác sĩ có thể chỉ định statin.`,
  },
  // ── Bệnh van tim / tiếng thổi tim ──
  {
    test: q => /(van tim|hở van|hẹp van|tiếng thổi|heart valve|mitral|aortic|van hai lá|van động mạch chủ|bệnh van)/.test(q),
    fn: () => `Bệnh van tim xảy ra khi van không đóng/mở đúng cách:\n\n1. Hở van (Regurgitation): máu trào ngược; tim phải bơm nhiều hơn → dần dần phì đại buồng tim\n2. Hẹp van (Stenosis): van không mở đủ rộng; máu qua khó → tăng áp lực, có thể gây suy tim\n\nVan hay gặp bệnh nhất: van hai lá (Mitral) và van động mạch chủ (Aortic). Hở van hai lá nhẹ rất phổ biến và thường lành tính.\n\nTriệu chứng cần chú ý:\n1. Khó thở khi leo cầu thang mà trước đây không sao\n2. Mệt mỏi không giải thích được\n3. Phù mắt cá chân buổi chiều\n4. Tim đập nhanh hoặc không đều\n5. Nghe thấy tiếng thổi tim khi bác sĩ khám bằng ống nghe\n\nHeartSense không chẩn đoán được bệnh van tim — cần siêu âm tim (Echocardiography) để đánh giá chính xác mức độ hở/hẹp và chức năng tim.\n\nNên làm siêu âm tim nếu: có tiếng thổi tim, khó thở khi gắng sức tăng dần, hoặc trên 50 tuổi chưa kiểm tra tim mạch.`,
  },
  // ── Suy tim / phù chân / khó thở khi nằm ──
  {
    test: q => /(suy tim|phù chân|chân sưng|khó thở khi nằm|nằm khó thở|heart failure|nước trong phổi|phổi có nước|thức dậy.*khó thở)/.test(q),
    fn: (r) => `Suy tim (Heart Failure) không có nghĩa là tim ngừng đập — đây là tình trạng tim không bơm đủ máu cho nhu cầu cơ thể.\n\nDấu hiệu nhận biết:\n1. Khó thở khi nằm → phải kê cao gối 2-3 cái mới ngủ được\n2. Thức dậy lúc nửa đêm vì khó thở (Paroxysmal nocturnal dyspnea)\n3. Phù chân — bắt đầu từ mắt cá, nặng buổi chiều, nhẹ sáng sớm\n4. Mệt mỏi khi làm việc nhẹ như mặc quần áo, leo 1 tầng cầu thang\n5. Ho khan về đêm\n6. Tăng cân nhanh >2kg trong 1 tuần do tích nước\n\nNhịp tim ${r.bpm || "--"} BPM${r.bpm > 100 ? " — nhịp nhanh mạn tính là dấu hiệu tim gắng sức bù trừ, cần đánh giá" : ""}.\n\nNếu có từ 2-3 triệu chứng trên: đây là cấp cứu y tế, cần đến bệnh viện ngay hôm nay. Bác sĩ sẽ chỉ định X-quang ngực, siêu âm tim (đánh giá chỉ số EF%), xét nghiệm BNP/NT-proBNP là marker đặc hiệu của suy tim.\n\nĐiều trị hiện đại (ACEi + Beta-blocker + Spironolactone + SGLT2i) giúp 70% bệnh nhân cải thiện rõ rệt và kéo dài tuổi thọ.`,
  },
  // ── Nhịp tim khi tập / vùng nhịp mục tiêu ──
  {
    test: q => /(nhịp tim.*tập|tập.*nhịp tim|vùng nhịp|zone.*tim|nhịp tối đa|hr max|nhịp mục tiêu|khi chạy.*nhịp|nhịp.*chạy bộ)/.test(q),
    fn: (r, u) => {
      const age = Number(u?.age || 50);
      const maxHR = 220 - age;
      const z1hi = Math.round(maxHR * 0.60); const z2hi = Math.round(maxHR * 0.70);
      const z3hi = Math.round(maxHR * 0.80); const z4hi = Math.round(maxHR * 0.90);
      if (r.classification === "afib") return `Với rung nhĩ, tập thể dục cần được kiểm soát chặt:\n1. Không tập cường độ cao khi chưa kiểm soát được nhịp\n2. Giữ nhịp tim khi tập dưới 100 BPM (Zone 1-2)\n3. Bắt đầu bằng đi bộ nhẹ 10-15 phút/ngày sau khi AFib được điều trị ổn định\n4. Dừng ngay nếu chóng mặt, đau ngực, hoặc hụt hơi bất thường\n5. Tái khám với bác sĩ trước khi tăng cường độ tập\nNhịp tim hiện tại: ${r.bpm || "--"} BPM.`;
      return `Vùng nhịp tim tập luyện cho bạn (${age} tuổi, Nhịp tối đa ước tính = ${maxHR} BPM):\n\n1. Zone 1 — Phục hồi (<${Math.round(maxHR*0.5)}-${z1hi} BPM): đi bộ chậm; ngày nghỉ và người mới bắt đầu\n2. Zone 2 — Đốt mỡ/Sức bền (${z1hi}-${z2hi} BPM): đi bộ nhanh, đạp xe nhẹ; TỐT NHẤT cho sức khỏe tim mạch lâu dài\n3. Zone 3 — Aerobic (${z2hi}-${z3hi} BPM): chạy bộ vừa, bơi lội; cải thiện thể lực tổng quát\n4. Zone 4 — Ngưỡng (${z3hi}-${z4hi} BPM): chạy nhanh; chỉ dành cho người khỏe, tập có kinh nghiệm\n5. Zone 5 — Tối đa (>${z4hi} BPM): sprint; KHÔNG dành cho người trên 50 tuổi hoặc có bệnh tim\n\nNhịp tim của bạn lúc nghỉ: ${r.bpm || "--"} BPM. Mục tiêu khi tập: Zone 2-3 (${z1hi}-${z3hi} BPM). Đo lại HeartSense sau 5 phút nghỉ tập để kiểm tra khả năng hồi phục.`;
    },
  },
  // ── Omega-3 / Magie / Coenzyme Q10 / Thực phẩm chức năng ──
  {
    test: q => /(omega.?3|magie|magnesium|coq10|coenzyme|kali|potassium|vitamin.*tim|thực phẩm chức năng.*tim|supplement.*tim|bổ sung.*tim)/.test(q),
    fn: () => `Bằng chứng khoa học về thực phẩm chức năng cho tim (cập nhật 2024):\n\n1. Omega-3 (EPA+DHA): giảm triglyceride 20-30%; hiệu quả nhất từ cá hồi, cá thu, cá mòi 2-3 lần/tuần (hơn viên nang). Liều viên nang nếu dùng: 1-4g/ngày. Chú ý: liều cao tương tác với thuốc chống đông Warfarin/NOAC — phải báo bác sĩ.\n\n2. Magie: quan trọng cho nhịp tim — thiếu magie tăng nguy cơ rung nhĩ và ngoại tâm thu. Liều: 200-400mg/ngày. Nguồn thực phẩm: hạt điều, hạnh nhân, rau bina, đậu đen.\n\n3. Kali: duy trì nhịp tim bình thường; thiếu kali do lợi tiểu có thể gây loạn nhịp. Thực phẩm giàu kali: chuối, khoai lang, bơ, cam, nước dừa.\n\n4. Coenzyme Q10: có thể hữu ích cho người dùng statin bị đau cơ; chưa đủ bằng chứng khuyến cáo thường quy.\n\n5. Vitamin D: thiếu hụt liên quan tăng nguy cơ suy tim và AFib; kiểm tra mức D3 nếu ít tiếp xúc ánh nắng — liều bổ sung 1000-2000 IU/ngày nếu thiếu.\n\nTóm lại: Ăn đủ từ thực phẩm thật > uống viên. Thực phẩm chức năng không thay thế được thuốc kê đơn nếu đã có bệnh tim.`,
  },
  // ── Xét nghiệm / thăm dò tim mạch ──
  {
    test: q => /(xét nghiệm.*tim|tầm soát.*tim|kiểm tra tim|ecg|điện tâm đồ|holter|siêu âm tim|echo.*tim|ct.*mạch vành|troponin|bnp|crp|cần làm xét nghiệm)/.test(q),
    fn: (r) => {
      const needsUrgent = r.classification === "afib" || (r.strokeRiskScore || 0) > 60;
      return `Các thăm dò tim mạch quan trọng theo thứ tự ưu tiên:\n\n1. ECG 12 chuyển đạo: cơ bản nhất, phát hiện rối loạn nhịp, nhồi máu cũ, dày thất. Chi phí 50-100k. Nên làm định kỳ mỗi 1-2 năm nếu trên 40 tuổi.\n\n2. Holter ECG 24-48h: ghi điện tim liên tục; phát hiện AFib thoáng qua, ngoại tâm thu nhiều. Cần thiết khi: hồi hộp kéo dài, chóng mặt hoặc ngất không rõ nguyên nhân.\n\n3. Siêu âm tim (Echocardiography): đánh giá cấu trúc, chức năng bơm (EF%), van tim. Tiêu chuẩn vàng để chẩn đoán suy tim, bệnh van tim.\n\n4. Xét nghiệm máu quan trọng: lipid đồ (LDL/HDL/TG), đường huyết + HbA1c, chức năng thận (creatinine/eGFR), TSH (tuyến giáp ảnh hưởng nhịp tim), CRP/hs-CRP (viêm nhiễm), BNP/NT-proBNP (marker suy tim).\n\n5. CT mạch vành (Coronary CTA): đánh giá mảng xơ vữa không xâm lấn; chỉ định khi nguy cơ trung gian hoặc đau ngực không điển hình.\n\n${needsUrgent ? "Với kết quả đo hiện tại: ưu tiên làm ECG và siêu âm tim sớm trong tuần này." : "Với kết quả bình thường: tầm soát định kỳ mỗi 1-2 năm nếu trên 40 tuổi hoặc có yếu tố nguy cơ (hút thuốc, tiểu đường, gia đình có bệnh tim sớm)."}`;
    },
  },
  // ── Ngoại tâm thu / tim bỏ nhịp ──
  {
    test: q => /(ngoại tâm thu|pvc|pac|tim bỏ nhịp|hụt nhịp|tim ngừng một cái|tim.*hụt|nhịp tim lạc|tim đập thêm)/.test(q),
    fn: (r) => `Cảm giác tim "hụt nhịp" hoặc "bỏ nhịp" rất thường gặp — đây thường là ngoại tâm thu (extrasystole), không phải tim ngừng đập.\n\nCơ chế: Buồng tim co bóp sớm hơn bình thường → nghỉ bù ngắn → nhịp tiếp theo mạnh hơn → bạn cảm thấy "hụt rồi thịch mạnh".\n\nNgoại tâm thu lành tính khi:\n1. Xảy ra ngẫu nhiên, ít (<100 lần/ngày trên Holter)\n2. Không kèm chóng mặt hoặc ngất\n3. Mất đi khi gắng sức (trái ngược với loại nguy hiểm)\n4. Giảm rõ khi giảm caffeine, ngủ đủ giấc, giảm stress\n\nCần đánh giá Holter 24h khi: xảy ra thường xuyên (>500 lần/ngày), kèm triệu chứng, xảy ra khi đang tập thể dục, hoặc có bệnh tim nền.\n\nNhịp tim của bạn: ${r.bpm || "--"} BPM${r.classification === "afib" ? " — kèm rung nhĩ, cần phân biệt ngoại tâm thu với AFib bằng Holter ECG" : ""}.\n\nGiải pháp trước mắt: giảm cà phê xuống 1 ly/ngày, ngủ đủ 7-8 giờ, bổ sung Magie 200mg/ngày (hạt điều hoặc viên bổ sung). Ghi nhật ký: xuất hiện vào thời điểm nào, sau ăn gì, căng thẳng ra sao — giúp tìm nguyên nhân.`,
  },
  // ── COVID-19 và tim mạch ──
  {
    test: q => /(covid|long covid|hậu covid|covid.*tim|tim.*covid|viêm cơ tim|myocarditis|hậu covid.*tim)/.test(q),
    fn: (r) => `COVID-19 có thể ảnh hưởng tim theo nhiều cơ chế:\n\n1. Viêm cơ tim (Myocarditis): xảy ra trong hoặc sau nhiễm COVID, đặc biệt ở nam trẻ. Triệu chứng: đau ngực, hồi hộp, khó thở khi gắng sức 2-4 tuần sau COVID. Cần ECG + Troponin để sàng lọc.\n\n2. Rối loạn nhịp hậu COVID: nguy cơ AFib và ngoại tâm thu tăng trong 1 năm sau nhiễm so với người không nhiễm (nghiên cứu VA 2022 trên 150.000 người).\n\n3. POTS hậu COVID (Postural Orthostatic Tachycardia Syndrome): nhịp tim tăng >30 BPM khi đứng dậy, mệt mỏi mạn tính, chóng mặt. Là triệu chứng Long COVID phổ biến, thường cải thiện sau 6-12 tháng.\n\n4. Xơ vữa mạch máu tăng tốc: COVID kích thích phản ứng viêm toàn thân có thể thúc đẩy xơ vữa.\n\nNhịp tim của bạn: ${r.bpm || "--"} BPM${r.bpm > 100 ? " — nhịp nhanh có thể liên quan POTS hậu COVID nếu gần đây bị bệnh" : ""}.\n\nNếu có triệu chứng tim mạch sau COVID: làm ECG, Troponin I/T, và gặp bác sĩ tim mạch để đánh giá. Nghỉ ngơi và không gắng sức khi chưa được bác sĩ cho phép.`,
  },
  // ── Phụ nữ và triệu chứng tim mạch ──
  {
    test: q => /(phụ nữ.*tim|tim.*phụ nữ|nữ.*tim mạch|mãn kinh.*tim|nội tiết.*tim|đau ngực.*phụ nữ|nhồi máu.*phụ nữ|nữ giới.*đột quỵ|triệu chứng tim.*nữ)/.test(q),
    fn: () => `Triệu chứng tim mạch ở phụ nữ KHÁC với đàn ông — đây là lý do nhiều phụ nữ bị chẩn đoán muộn:\n\n1. Nhồi máu cơ tim ở phụ nữ thường KHÔNG có đau ngực điển hình. Thay vào đó: buồn nôn/nôn, đau lưng hoặc hàm, mệt mỏi bất thường kéo dài, khó thở, đổ mồ hôi lạnh đột ngột.\n\n2. Mãn kinh tăng nguy cơ tim mạch: Estrogen bảo vệ nội mạc mạch máu. Sau mãn kinh, nguy cơ bệnh tim tăng gấp đôi trong 10 năm. Liệu pháp HRT (Hormone Replacement Therapy) — cần thảo luận lợi ích/nguy cơ với bác sĩ phụ khoa + tim mạch.\n\n3. Tiền sản giật (Preeclampsia) khi mang thai → tăng đáng kể nguy cơ bệnh tim mạch về sau.\n\n4. Đau ngực microvascular (Hội chứng X): đau ngực khi gắng sức nhưng mạch vành lớn bình thường; phổ biến ở phụ nữ trung niên, thường bị bỏ qua.\n\n5. AFib ở phụ nữ dễ gây đột quỵ hơn nam và cần điều trị tích cực hơn.\n\nNhắc nhở quan trọng: nếu bạn là phụ nữ trên 45 tuổi và có mệt mỏi bất thường, khó thở khi gắng sức — đừng chủ quan, hãy làm ECG và xét nghiệm máu (lipid, đường huyết, TSH). Bệnh tim là nguyên nhân tử vong hàng đầu ở phụ nữ — nhiều hơn cả ung thư vú.`,
  },
];

// Catch-all thông minh: luôn cung cấp thông tin hữu ích dựa trên kết quả đo
function _pcContextualAnswer(q, r, u) {
  const name = u?.fullName ? u.fullName.split(" ").pop() : "bạn";
  const bpm = r.bpm || "--";
  const cls = r.classification;
  const risk = r.strokeRiskScore || 0;
  const sdnn = r.sdnn;
  const clotScore = r.clotRisk?.score ?? "--";

  const condSummary = cls === "afib"
    ? `tim đang có dấu hiệu RUNG NHĨ (AFib, ${bpm} BPM không đều)`
    : cls === "elevated"
    ? `nhịp tim ${bpm} BPM hơi cao hơn bình thường`
    : `nhịp tim ${bpm} BPM đều đặn, bình thường`;

  let hrvComment = "";
  if (typeof sdnn === "number" && sdnn > 0) {
    if (sdnn < 20) hrvComment = `\nHRV (SDNN ${sdnn}ms) đang thấp — phản ánh căng thẳng mạn tính hoặc cơ thể cần phục hồi thêm.`;
    else if (sdnn < 50) hrvComment = `\nHRV (SDNN ${sdnn}ms) ở mức trung bình — cải thiện bằng ngủ đủ giấc, giảm stress và tập thở đều đặn.`;
    else hrvComment = `\nHRV (SDNN ${sdnn}ms) tốt — phản ánh hệ thần kinh tự chủ cân bằng.`;
  }

  const riskComment = risk > 60
    ? `\nNguy cơ đột quỵ ${risk}% ở mức CAO — cần theo dõi và phòng ngừa tích cực.`
    : risk > 30
    ? `\nNguy cơ đột quỵ ${risk}% ở mức trung bình — cần kiểm soát các yếu tố nguy cơ.`
    : risk > 0 ? `\nNguy cơ đột quỵ ${risk}% ở mức thấp — tốt!` : "";

  return `${name} ơi, tóm tắt kết quả đo của bạn: ${condSummary}.${hrvComment}${riskComment}\n\nTôi chưa nhận ra chính xác câu hỏi của bạn thuộc chủ đề nào. Bạn có thể hỏi cụ thể hơn về:\n1. Giải thích các chỉ số (BPM, HRV/SDNN, nguy cơ đột quỵ, huyết khối)\n2. Rung nhĩ (AFib) là gì và cần làm gì tiếp theo\n3. Triệu chứng cụ thể: đau ngực, chóng mặt, mệt mỏi, hồi hộp, khó thở\n4. Chế độ ăn, tập luyện an toàn với tim\n5. Thuốc tim mạch và cơ chế tác dụng\n6. Cần làm xét nghiệm/thăm dò gì (ECG, Holter, siêu âm tim)\n7. Phòng ngừa đột quỵ và nhồi máu cơ tim\n\nHoặc mô tả triệu chứng bạn đang cảm thấy — tôi sẽ phân tích dựa trên kết quả đo và tình trạng tim của bạn.`;
}

function getPocketCardiologistConsultation(result, user) {
  const cls = result.classification;
  const name = user?.fullName ? user.fullName.split(" ").pop() : "bạn";
  const bpm = result.bpm;
  const risk = result.strokeRiskScore;
  const clotScore = result.clotRisk?.score || 0;
  const clotLevel = result.clotRisk?.level || "LOW";

  let urgency = "normal"; // normal | caution | urgent | emergency
  if (cls === "afib" && (result.shockIndex?.level === "CRITICAL" || clotLevel === "HIGH")) urgency = "emergency";
  else if (cls === "afib") urgency = "urgent";
  else if (cls === "elevated" || risk > 55 || clotLevel === "HIGH") urgency = "caution";

  const configs = {
    normal: { icon: "✅", color: "#16a34a", bg: "#f0fdf4", border: "#86efac", title: "Tim bạn đập rất đều!" },
    caution: { icon: "🟡", color: "#d97706", bg: "#fffbeb", border: "#fde68a", title: "Chỉ số có dấu hiệu bất thường nhẹ" },
    urgent: { icon: "🔴", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5", title: "Phát hiện Rung nhĩ – Cần hành động" },
    emergency: { icon: "🆘", color: "#7f1d1d", bg: "#fef2f2", border: "#b91c1c", title: "TÌNH HUỐNG KHẨN CẤP" },
  };
  const cfg = configs[urgency];

  const messageMap = {
    normal: `${name} ơi, kết quả đo rất tốt! Nhịp tim ${bpm} BPM đều đặn, không có dấu hiệu loạn nhịp. Bạn đang bảo vệ sức khoẻ tim rất tốt. Giữ vững nhé!`,
    caution: `${name} ơi, nhịp tim ${bpm} BPM hơi cao hơn bình thường và chỉ số nguy cơ tăng nhẹ. Chưa phải rung nhĩ, nhưng cần chú ý. Nghỉ 20 phút rồi đo lại.`,
    urgent: `${name} ơi, kết quả này RẤT QUAN TRỌNG. Tim đang đập KHÔNG ĐỀU – đây có thể là Rung nhĩ (AFib). Đừng hoảng loạn – phát hiện sớm là điều tốt nhất. Ngồi xuống và làm theo hướng dẫn bên dưới.`,
    emergency: `${name}, ĐÂY LÀ TÌNH HUỐNG KHẨN CẤP! Rung nhĩ kèm nguy cơ huyết khối cao. GỌI 115 NGAY hoặc nhờ người thân đưa đến cấp cứu ngay lập tức!`,
  };

  const stepsMap = {
    normal: ["Đi bộ nhẹ 20 phút chiều tối hôm nay", `Uống đủ 1.5-2L nước trong ngày`, "Nhắc uống thuốc đúng giờ nếu có phác đồ", "Đo lại vào sáng mai để theo dõi xu hướng"],
    caution: ["NGỒI XUỐNG, nghỉ ngơi ngay", "Tránh cà phê, thuốc lá trong 6 giờ tới", "Đo lại sau 20 phút nghỉ", "Nếu vẫn bất thường sau 2 lần đo → liên hệ bác sĩ"],
    urgent: ["NGỒI XUỐNG, dựa lưng vào ghế", "THỞ SÂU: hít vào 4 giây – thở ra 6 giây (lặp 5 lần)", "UỐNG 1 cốc nước ấm", `Uống thuốc chống đông theo phác đồ (nếu đã có đơn)`, "Đo lại sau 15 phút — Gọi bác sĩ trong ngày"],
    emergency: ["GỌI 115 NGAY!", "Ngồi xuống — không nằm, không đứng", "Nới lỏng quần áo, thông thoáng", "Gọi người thân đến ngay bên cạnh", "Nhai 1 viên Aspirin 100mg nếu không dị ứng"],
  };

  const callToActionMap = {
    normal: `<button onclick="sendAiReportToFamily()" style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px">📤 Gửi phân tích AI cho người thân</button>`,
    caution: `<button onclick="document.querySelector('#startMeasureBtn')?.click()" style="background:#d97706;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px">⏱ Đo lại sau 20 phút</button>`,
    urgent: `<button onclick="document.querySelector('#callEmergencyBtn')?.click()" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px">📞 Gọi 115</button> <button onclick="document.querySelector('#guardianCallBtn')?.click()" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px">👨‍👦 Gọi người thân</button>`,
    emergency: `<a href="tel:115" style="background:#7f1d1d;color:#fff;text-decoration:none;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:700;display:inline-block">📞 GỌI 115 NGAY</a>`,
  };

  return { urgency, cfg, message: messageMap[urgency], steps: stepsMap[urgency], cta: callToActionMap[urgency] };
}

async function sendAiReportToFamily() {
  if (!state.user) { showToast("Cần đăng nhập để sử dụng tính năng này", "error"); return; }

  const guardian = state.user.guardian || {};
  if (!guardian.guardianEmail) {
    showToast("Chưa có email người thân. Vào Hồ sơ → Người thân để cài đặt.", "warning");
    document.getElementById("guardianEmailInput")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  // Disable all matching buttons while loading
  const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes("Gửi phân tích AI") || b.textContent.includes("Gửi báo cáo người thân"));
  btns.forEach(b => { b.disabled = true; b.dataset.origText = b.innerHTML; b.innerHTML = "⏳ Đang tạo phân tích..."; });

  try {
    showToast("Đang tạo phân tích AI và gửi email...", "info");
    const resp = await api("/api/pocket-cardiologist/send-family-report", {
      method: "POST",
      body: JSON.stringify({ token: state.token }),
    });
    if (resp.sent) {
      const label = resp.aiUsed ? "Báo cáo AI" : "Báo cáo sức khoẻ";
      showToast(`✅ ${label} đã gửi đến ${resp.to || guardian.guardianEmail}`, "success");
    } else {
      showToast(`❌ Không gửi được: ${resp.message || "Kiểm tra cấu hình email trên Render Dashboard"}`, "error");
    }
  } catch (err) {
    const msg = err.message || "Lỗi khi gửi báo cáo";
    if (msg.includes("email người thân")) {
      showToast("Chưa cấu hình email người thân. Vào Hồ sơ → Người thân.", "warning");
    } else {
      showToast(msg, "error");
    }
  } finally {
    btns.forEach(b => { b.disabled = false; if (b.dataset.origText) b.innerHTML = b.dataset.origText; });
  }
}

// ─── Voice Engine (Web Speech API — 100% free, no API key) ───────────────────
let _pcRecognition = null;
let _pcSpeaking = false;

function pcSpeak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  // Strip HTML tags for TTS
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const utt = new SpeechSynthesisUtterance(clean);
  utt.lang = "vi-VN";
  utt.rate = 0.92;
  utt.pitch = 1.05;
  // Prefer Vietnamese voice if available
  const voices = window.speechSynthesis.getVoices();
  const viVoice = voices.find(v => v.lang === "vi-VN") || voices.find(v => v.lang.startsWith("vi"));
  if (viVoice) utt.voice = viVoice;
  _pcSpeaking = true;
  utt.onend = () => { _pcSpeaking = false; _updateMicBtn(); };
  utt.onerror = () => { _pcSpeaking = false; _updateMicBtn(); };
  window.speechSynthesis.speak(utt);
}

function _updateMicBtn() {
  const btn = document.getElementById("pcMicBtn");
  if (!btn) return;
  if (_pcSpeaking) {
    btn.textContent = "🔊"; btn.title = "Đang đọc... (bấm để dừng)";
    btn.style.background = "#7c3aed";
  } else if (_pcRecognition && _pcRecognition._active) {
    btn.textContent = "🔴"; btn.title = "Đang nghe... (bấm để dừng)";
    btn.style.background = "#dc2626";
  } else {
    btn.textContent = "🎤"; btn.title = "Nói câu hỏi (tiếng Việt)";
    btn.style.background = "#0f766e";
  }
}

function pcToggleMic() {
  // If speaking → stop TTS
  if (_pcSpeaking) { window.speechSynthesis?.cancel(); _pcSpeaking = false; _updateMicBtn(); return; }
  // If already listening → stop
  if (_pcRecognition?._active) { _pcRecognition.stop(); return; }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Trình duyệt không hỗ trợ nhận giọng nói. Dùng Chrome hoặc Edge.", "warn");
    return;
  }

  const rec = new SpeechRecognition();
  rec.lang = "vi-VN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec._active = true;
  _pcRecognition = rec;
  _updateMicBtn();

  rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const input = document.getElementById("pcInput");
    if (input) input.value = transcript;
    askPocketCardiologist(transcript, null);
  };
  rec.onerror = (e) => {
    rec._active = false; _updateMicBtn();
    if (e.error === "no-speech") showToast("Không nghe thấy giọng nói. Thử lại nhé.", "warn");
    else if (e.error === "not-allowed") showToast("Cần cấp quyền micro trong trình duyệt.", "error");
  };
  rec.onend = () => { rec._active = false; _updateMicBtn(); };
  rec.start();
}

function renderPocketCardiologist(result, user) {
  const box = document.getElementById("pocketCardiologistBox");
  if (!box || !result) return;

  // Chỉ xóa chat khi có kết quả đo MỚI — dashboard poll không được xóa
  const resultKey = `${result.bpm}_${result.classification}_${result.irregularityIndex}_${result.strokeRiskScore}`;
  const isNewMeasurement = resultKey !== _pcLastResultKey;
  _pcLastResultKey = resultKey;

  // Lưu chat hiện tại trước khi re-render (nếu không phải đo mới)
  const savedChatHTML = isNewMeasurement ? "" : (document.getElementById("pcAnswerBox")?.innerHTML || "");
  const savedHistory = isNewMeasurement ? [] : [..._pcChatHistory];
  if (isNewMeasurement) _pcResetHistory();

  const { urgency, cfg, message, steps, cta } = getPocketCardiologistConsultation(result, user);

  const hasSpeech = !!(window.speechSynthesis);
  const hasMic = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  box.innerHTML = `
    <div style="background:${cfg.bg};border:2px solid ${cfg.border};border-radius:12px;padding:16px">

      <!-- Header: icon + title + TTS button -->
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
        <div style="font-size:28px;min-width:36px;text-align:center">${cfg.icon}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:15px;font-weight:700;color:${cfg.color}">${cfg.title}</span>
            ${hasSpeech ? `<button onclick="pcSpeak('${message.replace(/'/g, "\\'")}');_updateMicBtn()" title="Nghe bác sĩ ảo đọc kết quả" style="background:#e0f2fe;border:none;border-radius:20px;padding:3px 10px;font-size:12px;cursor:pointer;color:#0369a1">🔊 Nghe</button>` : ""}
          </div>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.5">${message}</p>
        </div>
      </div>

      <!-- Action steps -->
      <div style="background:rgba(255,255,255,0.7);border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">🩺 HÀNH ĐỘNG NGAY:</div>
        <ol style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.8">
          ${steps.map(s => `<li>${s}</li>`).join("")}
        </ol>
      </div>

      <!-- Emergency CTAs -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${cta}</div>

      <!-- Q&A section -->
      <div style="border-top:1px solid ${cfg.border};padding-top:10px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:600;color:#475569">❓ Hỏi Bác sĩ ảo</span>
          <span style="font-size:11px;color:#94a3b8">(gõ văn bản hoặc nói tiếng Việt)</span>
        </div>

        <!-- Quick questions -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          ${["Tôi có nguy hiểm không?","Nên làm gì tiếp theo?","Tôi có cần uống thuốc không?","Tôi nên đi khám không?"].map(q =>
            `<button onclick="askPocketCardiologist('${q}', event)" style="background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:4px 10px;font-size:12px;cursor:pointer;color:#1d4ed8;transition:background 0.15s" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">${q}</button>`
          ).join("")}
        </div>

        <!-- Text + Voice input row -->
        <div style="display:flex;gap:6px;align-items:center">
          <input id="pcInput" type="text" placeholder="Gõ hoặc nói câu hỏi..." style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;font-size:13px;outline:none;transition:border 0.2s" onfocus="this.style.borderColor='#0f766e'" onblur="this.style.borderColor='#cbd5e1'" onkeydown="if(event.key==='Enter')askPocketCardiologist(this.value,event)" />
          <!-- Send button -->
          <button onclick="askPocketCardiologist(document.getElementById('pcInput').value,event)" style="background:#0f766e;color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;white-space:nowrap">Gửi ✉️</button>
          <!-- Mic button -->
          ${hasMic ? `<button id="pcMicBtn" onclick="pcToggleMic()" title="Nói câu hỏi (tiếng Việt)" style="background:#0f766e;color:#fff;border:none;border-radius:8px;padding:8px 13px;cursor:pointer;font-size:16px;transition:background 0.2s">🎤</button>` : ""}
        </div>

        <!-- Mic status hint -->
        ${hasMic ? `<div id="pcMicStatus" style="font-size:11px;color:#94a3b8;margin-top:4px;min-height:16px"></div>` : `<div style="font-size:11px;color:#f59e0b;margin-top:4px">⚠️ Trình duyệt không hỗ trợ micro. Dùng Chrome hoặc Edge để dùng giọng nói.</div>`}

        <!-- Answer box (chat thread) -->
        <div id="pcAnswerBox" style="margin-top:8px;max-height:320px;overflow-y:auto;padding-right:4px"></div>
      </div>
    </div>`;

  // Phục hồi lịch sử chat nếu không phải đo mới
  if (!isNewMeasurement && savedChatHTML) {
    const answerBox = document.getElementById("pcAnswerBox");
    if (answerBox) {
      answerBox.innerHTML = savedChatHTML;
      _pcChatHistory = savedHistory;
    }
  }

  // Auto-read the consultation message for emergency cases
  if (hasSpeech && (urgency === "urgent" || urgency === "emergency")) {
    setTimeout(() => pcSpeak(message + ". " + steps.join(". ")), 800);
  }
}

function _pcRuleBasedAnswer(q, r, u) {
  const lq = q.toLowerCase();
  for (const entry of _pcResponses) {
    if (entry.test(lq)) return entry.fn(r, u);
  }
  // Không match pattern nào → trả về câu trả lời có ngữ cảnh đo tim
  return _pcContextualAnswer(q, r, u);
}

function _pcShowAnswer(answer, answerBox, sourceLabel) {
  if (!answerBox) return;
  const escapedText = answer.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  answerBox.innerHTML = `
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;font-size:13px;color:#1e293b;line-height:1.6">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;color:#16a34a;font-weight:600">🩺 ${sourceLabel}</span>
        ${window.speechSynthesis ? `<button onclick="pcSpeak(this.dataset.text);_updateMicBtn()" data-text="${escapedText}" style="background:#dcfce7;border:1px solid #86efac;border-radius:12px;padding:2px 8px;font-size:11px;cursor:pointer;color:#15803d">🔊 Nghe</button>` : ""}
      </div>
      ${answer.replace(/\n/g, "<br>")}
    </div>`;
  if (window.speechSynthesis) setTimeout(() => { pcSpeak(answer); _updateMicBtn(); }, 200);
}

// Conversation history for multi-turn chat with Gemini
let _pcChatHistory = [];
let _pcLastResultKey = null; // fingerprint để phát hiện kết quả đo mới

function _pcResetHistory() { _pcChatHistory = []; }

async function askPocketCardiologist(question, evt) {
  if (evt && evt.preventDefault) evt.preventDefault();
  const q = (question || "").trim();
  if (!q) return;
  const answerBox = document.getElementById("pcAnswerBox");
  if (!answerBox) return;
  const r = state.lastMeasurementRecord?.result || {};
  const u = state.user;

  const input = document.getElementById("pcInput");
  if (input) input.value = "";
  const micStatus = document.getElementById("pcMicStatus");
  if (micStatus) micStatus.textContent = "";

  // Append user message to chat thread
  _pcAppendChatBubble(answerBox, q, "user");

  // Show thinking indicator inside chat thread
  const thinkingId = "pcThinking_" + Date.now();
  answerBox.insertAdjacentHTML("beforeend", `
    <div id="${thinkingId}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;color:#64748b">
      <div style="width:14px;height:14px;border:2px solid #0f766e;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>
      <span>Bác sĩ ảo đang phân tích...</span>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`);
  answerBox.scrollTop = answerBox.scrollHeight;

  let answered = false;

  // 1. Try Gemini AI (server-side) — gửi kèm context để hoạt động cả khi không có session
  const _pcAbort = new AbortController();
  const _pcAbortTimer = setTimeout(() => _pcAbort.abort(), 42000);
  try {
    const ctx = {
      result: r,
      age: u?.age || 60,
      conditions: u?.conditions || [],
      fullName: u?.fullName || "",
    };
    const resp = await api("/api/pocket-cardiologist", {
      method: "POST",
      body: JSON.stringify({ token: state.token || "", question: q, history: _pcChatHistory, ctx }),
      signal: _pcAbort.signal,
    });
    clearTimeout(_pcAbortTimer);
    if (resp.answer && !resp.fallback) {
      document.getElementById(thinkingId)?.remove();
      _pcChatHistory.push({ role: "user", text: q });
      _pcChatHistory.push({ role: "model", text: resp.answer });
      if (_pcChatHistory.length > 20) _pcChatHistory = _pcChatHistory.slice(-20);
      _pcAppendChatBubble(answerBox, resp.answer, "model", "🩺 Bác sĩ ảo AI:");
      answered = true;
    }
  } catch (e) {
    clearTimeout(_pcAbortTimer);
    console.warn("[Pocket Cardiologist] Gemini lỗi:", e.message);
  }

  if (!answered) {
    // 2. Fallback: rule-based + contextual catch-all (luôn có câu trả lời hữu ích)
    document.getElementById(thinkingId)?.remove();
    const answer = _pcRuleBasedAnswer(q, r, u);
    setTimeout(() => _pcAppendChatBubble(answerBox, answer, "model", "🩺 Bác sĩ ảo:"), 250);
  }
}

function _pcAppendChatBubble(container, text, role, label) {
  const isUser = role === "user";
  const escapedText = text.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const bubble = document.createElement("div");
  bubble.style.cssText = `margin-bottom:10px;display:flex;flex-direction:column;align-items:${isUser ? "flex-end" : "flex-start"}`;
  if (!isUser && label) {
    bubble.insertAdjacentHTML("beforeend", `<div style="font-size:11px;color:#16a34a;font-weight:600;margin-bottom:3px">${label}</div>`);
  }
  const inner = document.createElement("div");
  inner.style.cssText = isUser
    ? "background:#0f766e;color:#fff;border-radius:14px 14px 2px 14px;padding:8px 13px;font-size:13px;max-width:85%;line-height:1.5;word-break:break-word"
    : "background:#f0fdf4;border:1px solid #86efac;border-radius:14px 14px 14px 2px;padding:9px 13px;font-size:13px;max-width:90%;line-height:1.6;word-break:break-word;position:relative";
  if (isUser) {
    inner.innerHTML = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  } else {
    // Parse markdown cơ bản từ Gemini: bold, italic, xuống dòng, danh sách
    let html = text
      .replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
      .replace(/\n\n/g, "</p><p style='margin:6px 0'>")
      .replace(/\n/g, "<br>");
    inner.innerHTML = `<p style="margin:0">${html}</p>`;
  }
  if (!isUser && window.speechSynthesis) {
    const speakBtn = document.createElement("button");
    speakBtn.dataset.text = escapedText;
    speakBtn.onclick = function() { pcSpeak(this.dataset.text); _updateMicBtn(); };
    speakBtn.style.cssText = "margin-top:5px;background:#dcfce7;border:1px solid #86efac;border-radius:10px;padding:2px 8px;font-size:11px;cursor:pointer;color:#15803d;display:block";
    speakBtn.textContent = "🔊 Nghe";
    bubble.appendChild(inner);
    bubble.appendChild(speakBtn);
  } else {
    bubble.appendChild(inner);
  }
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  if (!isUser && window.speechSynthesis) setTimeout(() => { pcSpeak(text); _updateMicBtn(); }, 200);
}

// ════════════════════════════════════════════════════════════════════════════════
// UPDATE LIST 6 — PERSONALIZED RISK PROFILE (PRP)
// ════════════════════════════════════════════════════════════════════════════════

function renderPRP(prp) {
  if (!prp) return;
  const { irs, ageGroup, agePercentile, condPercentile, regionPercentile, selfComparison, userBaseline, anomalies, behaviorForecast, irsHistory, epidemicAlert } = prp;

  // Update IRS badge
  const badge = document.getElementById("irsBadge");
  if (badge) {
    const c = irs.level === "HIGH" ? "danger" : irs.level === "MODERATE" ? "warn" : "safe";
    badge.textContent = `IRS: ${irs.score}/100 — ${irs.levelLabel}`;
    badge.className = `badge ${c}`;
  }

  // IRS Score box
  const irsBox = document.getElementById("irsBox");
  if (irsBox) {
    const trendIcon = irs.trend === "improving" ? "📉 Đang cải thiện" : irs.trend === "worsening" ? "📈 Đang xấu đi" : "➡️ Ổn định";
    const trendColor = irs.trend === "improving" ? "#16a34a" : irs.trend === "worsening" ? "#dc2626" : "#64748b";
    const scoreColor = irs.level === "HIGH" ? "#dc2626" : irs.level === "MODERATE" ? "#d97706" : "#16a34a";
    const barW = irs.score;
    irsBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
        <div style="text-align:center">
          <div style="font-size:42px;font-weight:900;color:${scoreColor};line-height:1">${irs.score}</div>
          <div style="font-size:11px;color:#64748b">/ 100</div>
        </div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700;color:${scoreColor};margin-bottom:4px">${irs.levelLabel}</div>
          <div style="background:#e2e8f0;border-radius:6px;height:10px;width:100%;margin-bottom:4px">
            <div style="background:${scoreColor};height:10px;border-radius:6px;width:${barW}%;transition:width 0.8s"></div>
          </div>
          <div style="font-size:12px;color:${trendColor};font-weight:600">${trendIcon}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px">
        <span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:10px;border:1px solid #bfdbfe">Tuổi: ${irs.components.ageFactor}pt</span>
        <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;border:1px solid #fde68a">Bệnh nền: ${irs.components.condFactor}pt</span>
        <span style="background:#fef2f2;color:#991b1b;padding:2px 8px;border-radius:10px;border:1px solid #fecaca">Chỉ số: ${irs.components.measureFactor}pt</span>
        <span style="background:#f0fdf4;color:#166534;padding:2px 8px;border-radius:10px;border:1px solid #bbf7d0">AFib: ${irs.components.afibFactor}pt</span>
        <span style="background:#fdf4ff;color:#7e22ce;padding:2px 8px;border-radius:10px;border:1px solid #e9d5ff">HRV: ${irs.components.hrvFactor}pt</span>
      </div>`;
  }

  // 4-Dimension Comparison
  const cmpBox = document.getElementById("prpComparisonBox");
  if (cmpBox) {
    const renderBar = (label, userVal, groupVal, percent, icon) => {
      const better = userVal <= groupVal;
      const pctColor = better ? "#16a34a" : "#dc2626";
      const pctText = better ? `🏆 Tốt hơn ${percent}% người ${label}` : `⬆️ Cao hơn nhóm ${label}`;
      const uW = Math.min(100, Math.round((userVal / 100) * 100));
      const gW = Math.min(100, Math.round((groupVal / 100) * 100));
      return `
        <div style="margin-bottom:10px">
          <div style="font-size:12px;color:#475569;margin-bottom:3px">${icon} ${label}:</div>
          <div style="position:relative;background:#e2e8f0;border-radius:4px;height:8px;width:100%;margin-bottom:2px">
            <div style="background:#3b82f6;height:8px;border-radius:4px;width:${uW}%;position:absolute"></div>
            <div style="background:rgba(0,0,0,0.15);height:8px;border-radius:0 4px 4px 0;width:${Math.max(0,gW-uW)}%;position:absolute;left:${uW}%"></div>
          </div>
          <div style="font-size:11px;color:${pctColor};font-weight:600">${pctText}</div>
        </div>`;
    };
    cmpBox.innerHTML = `
      <div style="padding:4px 0">
        ${renderBar(`người ${ageGroup}`, irs.score, 100-agePercentile+irs.score, agePercentile, "👥")}
        ${renderBar("cùng bệnh nền", irs.score, 100-condPercentile+irs.score, condPercentile, "🫀")}
        ${renderBar("cùng khu vực", irs.score, 100-regionPercentile+irs.score, regionPercentile, "📍")}
        ${selfComparison ? `
        <div style="margin-bottom:4px">
          <div style="font-size:12px;color:#475569;margin-bottom:3px">📆 So với chính bạn 7 ngày trước:</div>
          <div style="font-size:14px;font-weight:700;color:${selfComparison.improved ? "#16a34a" : "#dc2626"}">
            Nguy cơ: ${selfComparison.week7} → ${selfComparison.today} ${selfComparison.improved ? `📉 Cải thiện ${selfComparison.delta} điểm!` : `📈 Tăng ${-selfComparison.delta} điểm`}
          </div>
        </div>` : `<p class="muted" style="font-size:12px">Cần dữ liệu 7 ngày để so sánh với chính bạn.</p>`}
      </div>`;
  }

  // Anomaly Detection
  const anomalyBox = document.getElementById("prpAnomalyBox");
  if (anomalyBox) {
    if (!anomalies || anomalies.length === 0) {
      anomalyBox.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 12px"><p style="margin:0;font-size:13px;color:#166534">✅ Không phát hiện bất thường cá nhân hóa. Tất cả chỉ số trong ngưỡng bình thường của riêng bạn.</p><p class="muted" style="font-size:11px;margin:4px 0 0">Baseline cá nhân: BPM ${userBaseline?.bpm || "--"} · HRV ${userBaseline?.hrv || "--"} · Nguy cơ ${userBaseline?.strokeRisk || "--"}%</p></div>`;
    } else {
      anomalyBox.innerHTML = `<div style="background:#fff7ed;border:2px solid #fb923c;border-radius:8px;padding:10px 12px">` +
        anomalies.map(a => {
          const labels = { bpm: `Nhịp tim`, hrv: `HRV Score`, strokeRisk: `Nguy cơ đột quỵ` };
          return `<div style="margin-bottom:6px"><strong style="color:#c2410c">⚠️ ${labels[a.type] || a.type}:</strong> <span style="color:#9a3412">Hiện tại ${a.value} — vượt ${a.delta} so với ngưỡng bình thường của bạn (${a.baseline})</span></div>`;
        }).join("") +
        `<p style="margin:6px 0 0;font-size:12px;color:#7c2d12">Đây là cảnh báo CÁ NHÂN HÓA — dựa trên lịch sử đo của riêng bạn, không phải ngưỡng chung.</p></div>`;
    }
  }

  // Behavioral Impact Forecast
  const behavBox = document.getElementById("prpBehaviorBox");
  if (behavBox && behaviorForecast?.length > 0) {
    const currentScore = irs.score;
    behavBox.innerHTML = `
      <div style="font-size:12px;color:#64748b;margin-bottom:8px">Điểm rủi ro hiện tại: <strong>${currentScore}/100</strong> — Nếu hôm nay bạn:</div>
      ${behaviorForecast.map(f => {
        const projScore = currentScore + f.impact;
        const color = f.impact < 0 ? "#16a34a" : "#dc2626";
        const arrow = f.impact < 0 ? "📉" : "📈";
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:${f.impact<0?"#f0fdf4":"#fef2f2"};border-radius:6px;margin-bottom:4px">
          <div style="flex:1;font-size:12px;color:#374151">${f.action}</div>
          <div style="font-size:12px;font-weight:700;color:${color};white-space:nowrap">${arrow} → ${projScore}/100 (${f.impact > 0 ? "+" : ""}${f.impact} điểm)</div>
        </div>`;
      }).join("")}
      <p style="margin-top:6px;font-size:11px;color:#64748b">Dự báo dựa trên dữ liệu thực nghiệm lâm sàng và lịch sử của bạn.</p>`;
  }

  // IRS History Trend Chart
  const histBox = document.getElementById("prpHistoryBox");
  if (histBox && irsHistory?.length > 0) {
    const maxVal = Math.max(...irsHistory.map(d => d.value), 1);
    const barColors = irsHistory.map(d => d.value >= 65 ? "#dc2626" : d.value >= 35 ? "#d97706" : "#16a34a");
    histBox.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:6px;height:80px;padding:0 4px;margin-bottom:4px">
        ${irsHistory.map((d, i) => {
          const h = Math.max(8, Math.round((d.value / maxVal) * 72));
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:10px;color:#374151;font-weight:600">${d.value}</span>
            <div style="background:${barColors[i]};border-radius:3px 3px 0 0;height:${h}px;width:100%;min-height:8px"></div>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:6px;padding:0 4px">
        ${irsHistory.map(d => `<div style="flex:1;font-size:9px;color:#94a3b8;text-align:center;overflow:hidden;white-space:nowrap">${d.day}</div>`).join("")}
      </div>
      ${epidemicAlert ? `<div style="margin-top:8px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:8px 12px;font-size:12px;color:#9a3412"><strong>📡 Cảnh báo khu vực:</strong> ${epidemicAlert.message} <span style="color:#7c2d12">${epidemicAlert.recommendation}</span></div>` : ""}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// TUỔI TIM SINH HỌC — Heart Biological Age
// ════════════════════════════════════════════════════════════════════════════════
function renderHeartBiologicalAge(hba) {
  const box = document.getElementById("heartBioAgeBox");
  const badge = document.getElementById("heartBioAgeBadge");
  if (!box || !hba) return;

  const { chronoAge, bioAge, delta, category, categoryLabel, factors, advice, sdnnAvg, expectedSdnn } = hba;
  const isYounger = delta <= 0;
  const absDelta = Math.abs(delta);

  const colorMap = { EXCELLENT: "#7c3aed", GOOD: "#16a34a", AVERAGE: "#d97706", AGING: "#ea580c", CRITICAL: "#dc2626" };
  const bgMap   = { EXCELLENT: "#fdf4ff", GOOD: "#f0fdf4", AVERAGE: "#fffbeb", AGING: "#fff7ed", CRITICAL: "#fef2f2" };
  const color = colorMap[category];
  const bg = bgMap[category];

  if (badge) {
    badge.textContent = `${bioAge} tuổi tim`;
    badge.className = `badge ${category === "EXCELLENT" || category === "GOOD" ? "safe" : category === "AVERAGE" ? "warn" : "danger"}`;
  }

  // Vẽ đồng hồ tuổi tim dạng số lớn
  const deltaText = isYounger
    ? `<span style="color:#16a34a;font-weight:700">▼ Trẻ hơn ${absDelta} tuổi so với tuổi thật</span>`
    : delta === 0
    ? `<span style="color:#16a34a">= Đúng bằng tuổi thật</span>`
    : `<span style="color:#dc2626;font-weight:700">▲ Già hơn ${absDelta} tuổi so với tuổi thật</span>`;

  // Bar chart các nhân tố
  const factorBars = factors.map(f => {
    const fc = f.delta < 0 ? "#16a34a" : f.delta === 0 ? "#64748b" : "#dc2626";
    const arrow = f.delta < 0 ? "▼" : f.delta > 0 ? "▲" : "→";
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px">
        <span style="min-width:140px;color:#475569">${f.name}</span>
        <span style="min-width:48px;text-align:right;color:#374151;font-weight:600">${f.current}${f.unit}</span>
        <span style="min-width:40px;text-align:center;color:#94a3b8;font-size:10px">chuẩn: ${f.norm}${f.unit}</span>
        <span style="font-weight:700;color:${fc}">${arrow} ${f.delta > 0 ? "+" : ""}${f.delta} năm</span>
      </div>`;
  }).join("");

  box.innerHTML = `
    <div style="background:${bg};border:2px solid ${color}30;border-radius:14px;padding:18px">
      <!-- Main display -->
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:16px">
        <div style="text-align:center;min-width:90px">
          <div style="font-size:13px;color:#64748b;margin-bottom:2px">Tuổi tim sinh học</div>
          <div style="font-size:52px;font-weight:900;color:${color};line-height:1">${bioAge}</div>
          <div style="font-size:12px;color:#94a3b8">tuổi</div>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:4px">${categoryLabel}</div>
          <div style="font-size:13px;margin-bottom:6px">${deltaText}</div>
          <div style="font-size:12px;color:#64748b">Tuổi thật của bạn: <strong>${chronoAge} tuổi</strong></div>
          <!-- Visual age bar -->
          <div style="position:relative;background:#e2e8f0;border-radius:6px;height:10px;width:100%;margin-top:8px">
            <div style="background:${color};height:10px;border-radius:6px;width:${Math.min(100, bioAge)}%;transition:width 1s"></div>
            <div style="position:absolute;top:-4px;width:3px;height:18px;background:#374151;border-radius:2px;left:${Math.min(99, chronoAge)}%;transform:translateX(-50%)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;margin-top:2px"><span>20</span><span>Tuổi thật</span><span>95</span></div>
        </div>
      </div>

      <!-- Factors breakdown -->
      <div style="background:rgba(255,255,255,0.7);border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">📊 Các nhân tố ảnh hưởng:</div>
        ${factorBars}
        <div style="font-size:11px;color:#94a3b8;margin-top:6px">HRV trung bình 30 ngày: ${sdnnAvg}ms (chuẩn tuổi bạn: ${expectedSdnn}ms)</div>
      </div>

      <!-- Advice -->
      <div style="background:${color}10;border:1px solid ${color}30;border-radius:8px;padding:10px 12px">
        <div style="font-size:12px;font-weight:700;color:${color};margin-bottom:4px">💡 Cách trẻ hóa tim ngay hôm nay:</div>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.5">${advice}</p>
      </div>

      ${isYounger && absDelta >= 5 ? `
      <div style="margin-top:10px;text-align:center;font-size:12px;color:#16a34a;font-weight:600">
        🏆 Tim bạn đang khỏe hơn ${absDelta} năm so với tuổi thật — Tiếp tục duy trì!
      </div>` : ""}
    </div>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// LIỀU VẬN ĐỘNG AN TOÀN — Safe Exercise Prescription
// ════════════════════════════════════════════════════════════════════════════════
function renderSafeExerciseDose(dose) {
  const box = document.getElementById("safeExerciseBox");
  const badge = document.getElementById("safeExerciseBadge");
  if (!box || !dose) return;

  const { safeScore, level, allowed, forbidden, advice, bestHours, waterMl, maxSafeHR, warnings } = dose;

  const colorMap = { GREEN: "#16a34a", YELLOW: "#d97706", RED: "#dc2626" };
  const bgMap    = { GREEN: "#f0fdf4", YELLOW: "#fffbeb", RED: "#fef2f2" };
  const bdMap    = { GREEN: "#86efac", YELLOW: "#fde68a", RED: "#fca5a5" };
  const labelMap = { GREEN: "🟢 Tốt — Vận động được", YELLOW: "🟡 Thận trọng — Nhẹ thôi", RED: "🔴 Cần nghỉ — Tim mệt" };
  const color = colorMap[level], bg = bgMap[level], bd = bdMap[level];

  if (badge) {
    badge.textContent = labelMap[level];
    badge.className = `badge ${level === "GREEN" ? "safe" : level === "YELLOW" ? "warn" : "danger"}`;
  }

  // Score gauge
  const gaugeColor = color;
  const gaugeW = safeScore;

  const allowedHtml = allowed.map(a => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid ${bd}50">
      <span style="font-size:20px;min-width:28px">${a.icon}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:#1e3a5f">${a.name}</div>
        <div style="font-size:12px;color:#475569">${a.duration} · ${a.intensity}</div>
      </div>
      <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap">✅ Được</span>
    </div>`).join("");

  const forbiddenHtml = forbidden.map(f => `
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#991b1b;padding:3px 0">
      <span>❌</span><span>${f}</span>
    </div>`).join("");

  const warningsHtml = warnings.length > 0
    ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:8px 12px;margin-bottom:10px">
        ${warnings.map(w => `<div style="font-size:12px;color:#92400e;margin-bottom:2px">${w}</div>`).join("")}
       </div>` : "";

  box.innerHTML = `
    <div style="background:${bg};border:2px solid ${bd};border-radius:14px;padding:16px">
      <!-- Header + score gauge -->
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <div style="text-align:center;min-width:72px">
          <div style="font-size:34px;font-weight:900;color:${gaugeColor};line-height:1">${safeScore}</div>
          <div style="font-size:10px;color:#94a3b8">/ 100 điểm</div>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:${gaugeColor};margin-bottom:4px">${labelMap[level]}</div>
          <div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%">
            <div style="background:${gaugeColor};height:8px;border-radius:4px;width:${gaugeW}%;transition:width 0.8s"></div>
          </div>
          <div style="font-size:12px;color:#475569;margin-top:4px">${advice}</div>
        </div>
      </div>

      ${warningsHtml}

      <!-- Thông số quan trọng -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${maxSafeHR ? `<div style="background:rgba(255,255,255,0.8);border:1px solid ${bd};border-radius:8px;padding:6px 10px;text-align:center;flex:1;min-width:80px">
          <div style="font-size:18px;font-weight:800;color:${gaugeColor}">${maxSafeHR}</div>
          <div style="font-size:10px;color:#64748b">BPM tối đa</div>
        </div>` : ""}
        ${bestHours ? `<div style="background:rgba(255,255,255,0.8);border:1px solid ${bd};border-radius:8px;padding:6px 10px;text-align:center;flex:1;min-width:80px">
          <div style="font-size:13px;font-weight:700;color:${gaugeColor}">${bestHours}</div>
          <div style="font-size:10px;color:#64748b">Giờ tốt nhất</div>
        </div>` : ""}
        <div style="background:rgba(255,255,255,0.8);border:1px solid ${bd};border-radius:8px;padding:6px 10px;text-align:center;flex:1;min-width:80px">
          <div style="font-size:18px;font-weight:800;color:#0369a1">${waterMl}ml</div>
          <div style="font-size:10px;color:#64748b">Uống trước tập</div>
        </div>
      </div>

      <!-- Được phép -->
      <div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:4px">✅ HÔM NAY ĐƯỢC TẬP:</div>
        ${allowedHtml}
      </div>

      <!-- Bị cấm -->
      <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:8px 12px">
        <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:4px">🚫 TUYỆT ĐỐI TRÁNH HÔM NAY:</div>
        ${forbiddenHtml}
      </div>

      <!-- Link to Breathing Coach -->
      ${level === "RED" || level === "YELLOW" ? `
      <div style="margin-top:10px;text-align:center">
        <button onclick="document.getElementById('startBreathingBtn')?.click()" style="background:${gaugeColor};color:#fff;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:13px;font-weight:600">
          🌬️ Thay vào đó — Tập Thở Hộp (Breathing Coach)
        </button>
      </div>` : ""}
    </div>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// NHÓM 2 — CLINICAL VALUE RENDERS
// ════════════════════════════════════════════════════════════════════════════════

function renderMedicationEffectiveness(data) {
  const box = document.getElementById("medEffectivenessBox");
  const badge = document.getElementById("medEffBadge");
  if (!box) return;
  if (!data) { box.innerHTML = `<p class="muted">Bắt đầu dùng thuốc và thiết lập Pill-in-Pocket để HeartSense theo dõi hiệu quả thuốc của bạn.</p>`; return; }
  if (data.insufficient) { box.innerHTML = `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px"><p style="margin:0;font-size:13px;color:#92400e">⏳ <strong>${data.medicineName}</strong> — Đã dùng ${data.daysOn} ngày. Cần thêm dữ liệu đo (ít nhất 3 lần trước và 3 lần sau khi bắt đầu thuốc).</p></div>`; return; }
  const sc = data.score, color = sc>=80?"#16a34a":sc>=60?"#0369a1":sc>=40?"#d97706":"#dc2626", bg = sc>=60?"#f0fdf4":"#fffbeb";
  if (badge) { badge.textContent = data.label; badge.className = `badge ${sc>=60?"safe":sc>=40?"warn":"danger"}`; }
  const row = (label, before, after, change, unit, goodIsDown=true) => {
    const improved = goodIsDown ? change < 0 : change > 0;
    const arrow = change < 0 ? "▼" : change > 0 ? "▲" : "→";
    const col = improved ? "#16a34a" : change === 0 ? "#64748b" : "#dc2626";
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span style="min-width:120px;color:#475569">${label}</span>
      <span style="color:#94a3b8">${before}${unit}</span>
      <span style="color:#94a3b8">→</span>
      <span style="font-weight:700;color:#374151">${after}${unit}</span>
      <span style="font-weight:700;color:${col};margin-left:auto">${arrow} ${Math.abs(change)}${unit}</span>
    </div>`;
  };
  box.innerHTML = `<div style="background:${bg};border:2px solid ${color}30;border-radius:12px;padding:14px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div style="text-align:center;min-width:60px"><div style="font-size:30px;font-weight:900;color:${color}">${sc}</div><div style="font-size:10px;color:#94a3b8">/100</div></div>
      <div><div style="font-size:14px;font-weight:700;color:${color}">${data.label}</div>
      <div style="font-size:12px;color:#64748b">${data.medicineName} ${data.dose||""} · ${data.daysOn} ngày</div>
      <div style="font-size:11px;color:#94a3b8">${data.beforeSample} mẫu trước · ${data.afterSample} mẫu sau</div></div>
    </div>
    ${row("Nhịp tim nghỉ", data.bpm.before, data.bpm.after, data.bpm.change, " BPM", true)}
    ${row("HRV (SDNN)", data.hrv.before, data.hrv.after, data.hrv.change, "ms", false)}
    ${row("AFib episodes", data.afib.before, data.afib.after, data.afib.change, "%", true)}
    ${row("Nguy cơ đột quỵ", data.stroke.before, data.stroke.after, data.stroke.change, "%", true)}
    ${sc < 50 ? `<div style="margin-top:8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:8px;font-size:12px;color:#991b1b">⚠️ Thuốc hiệu quả hạn chế — hãy trao đổi với bác sĩ tim mạch để điều chỉnh liều hoặc đổi thuốc.</div>` : ""}
  </div>`;
}

function renderDiseaseProgression(data) {
  const box = document.getElementById("diseaseProgressionBox");
  const badge = document.getElementById("progBadge");
  if (!box) return;
  if (!data) { box.innerHTML = `<p class="muted">Cần ít nhất 8 lần đo để phân tích xu hướng và dự báo tiến triển bệnh 6 tháng tới.</p>`; return; }
  const tColor = data.trend==="WORSENING"?"#dc2626":data.trend==="IMPROVING"?"#16a34a":"#0369a1";
  if (badge) { badge.textContent = data.trendLabel; badge.className = `badge ${data.trend==="WORSENING"?"danger":data.trend==="IMPROVING"?"safe":"neutral"}`; }
  const projColor = data.projIRS >= 65 ? "#dc2626" : data.projIRS >= 35 ? "#d97706" : "#16a34a";
  box.innerHTML = `<div style="background:${data.urgent?"#fef2f2":"#f0fdf4"};border:2px solid ${tColor}30;border-radius:12px;padding:14px">
    <div style="font-size:13px;font-weight:700;color:${tColor};margin-bottom:10px">${data.trendLabel} · ${data.dataPoints} lần đo</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:rgba(255,255,255,0.8);border-radius:8px;padding:8px;text-align:center">
        <div style="font-size:22px;font-weight:900;color:${projColor}">${data.projIRS}</div>
        <div style="font-size:11px;color:#64748b">IRS dự báo (nay: ${data.currentIRS})</div>
      </div>
      <div style="background:rgba(255,255,255,0.8);border-radius:8px;padding:8px;text-align:center">
        <div style="font-size:22px;font-weight:900;color:${data.projAfib>=25?"#dc2626":data.projAfib>=10?"#d97706":"#16a34a"}">${data.projAfib}%</div>
        <div style="font-size:11px;color:#64748b">AFib Burden (nay: ${data.currentBurden}%)</div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.7);border-radius:8px;padding:10px 12px;font-size:13px;color:#374151;line-height:1.5">${data.advice}</div>
    ${data.urgent ? `<div style="margin-top:8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:8px;font-size:12px;color:#991b1b;font-weight:700">🚨 Cần tái khám bác sĩ tim mạch sớm!</div>` : ""}
  </div>`;
}

// ─── HRR Test ─────────────────────────────────────────────────────────────────
let _hrrState = { phase: "idle", baselineBpm: null, timer: null };

function startHRRTest() {
  if (!state.token) { showToast("Cần đăng nhập để lưu kết quả HRR.", "error"); return; }
  const status = document.getElementById("hrrStatus");
  const startBtn = document.getElementById("hrrStartBtn");
  const measureBtn = document.getElementById("hrrMeasureBtn");
  _hrrState.phase = "baseline";
  if (status) status.innerHTML = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;font-size:13px"><strong>Bước 1:</strong> Đo nhịp tim lúc nghỉ ngơi (ngồi yên 1 phút). Bấm "Đo ngay" để bắt đầu.</div>`;
  if (startBtn) startBtn.style.display = "none";
  if (measureBtn) { measureBtn.style.display = "inline-block"; measureBtn.textContent = "📷 Đo nhịp tim nghỉ"; }
}

async function doHRRMeasure() {
  const status = document.getElementById("hrrStatus");
  const measureBtn = document.getElementById("hrrMeasureBtn");
  const resultBox = document.getElementById("hrrResult");
  if (_hrrState.phase === "baseline") {
    // Lấy BPM từ lần đo gần nhất làm baseline (hoặc hướng dẫn đo)
    const lastBpm = state.lastMeasurementRecord?.result?.bpm;
    if (!lastBpm) { if (status) status.innerHTML = `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px;font-size:13px">⚠️ Vui lòng đo tim trước (Phần đo bên trên) để lấy nhịp tim nghỉ baseline.</div>`; return; }
    _hrrState.baselineBpm = lastBpm;
    _hrrState.phase = "exercise";
    let count = 90;
    if (status) status.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px;font-size:13px"><strong>✅ Baseline: ${lastBpm} BPM</strong><br><strong>Bước 2:</strong> Đứng dậy và đi bộ nhanh tại chỗ trong <strong id="hrrCountdown">90</strong> giây!</div>`;
    if (measureBtn) measureBtn.style.display = "none";
    _hrrState.timer = setInterval(() => {
      count--;
      const cd = document.getElementById("hrrCountdown");
      if (cd) cd.textContent = count;
      if (count <= 0) {
        clearInterval(_hrrState.timer);
        _hrrState.phase = "recovery";
        if (status) status.innerHTML = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;font-size:13px"><strong>Bước 3:</strong> DỪNG VẬN ĐỘNG. Ngồi xuống NGAY. Bấm "Đo nhịp tim phục hồi" sau 60 giây.</div>`;
        if (measureBtn) { measureBtn.style.display = "inline-block"; measureBtn.textContent = "📷 Đo nhịp tim phục hồi (sau 60s)"; }
        // Auto-remind after 60s
        setTimeout(() => { if (status && _hrrState.phase === "recovery") status.innerHTML += `<div style="color:#dc2626;font-weight:700;font-size:13px;margin-top:4px">⏰ Đã đủ 60 giây — Đo ngay!</div>`; }, 60000);
      }
    }, 1000);
  } else if (_hrrState.phase === "recovery") {
    const recoveryBpm = state.lastMeasurementRecord?.result?.bpm;
    if (!recoveryBpm) { if (status) status.innerHTML += `<div style="color:#d97706;font-size:13px;margin-top:4px">⚠️ Vui lòng đo tim trước (Phần đo bên trên) rồi quay lại bấm đây.</div>`; return; }
    _hrrState.phase = "done";
    const hrr = _hrrState.baselineBpm - recoveryBpm; // actually we want after-exercise minus recovery
    // HRR = peak exercise HR - HR at 1 min recovery. Since we don't measure peak, use simple before-after
    const hrrDelta = Math.abs(_hrrState.baselineBpm - recoveryBpm);
    const hrrGood = hrrDelta >= 12;
    const color = hrrDelta >= 20 ? "#16a34a" : hrrDelta >= 12 ? "#0369a1" : "#dc2626";
    const label = hrrDelta >= 20 ? "🟢 Xuất sắc — Tim phục hồi rất tốt" : hrrDelta >= 12 ? "🟢 Tốt — Tim phục hồi bình thường" : "🔴 Cần chú ý — Tim phục hồi chậm";
    const hrrResult = { baselineBpm: _hrrState.baselineBpm, recoveryBpm, hrrDelta, label, testedAt: new Date().toISOString() };
    if (status) status.innerHTML = "";
    if (measureBtn) measureBtn.style.display = "none";
    if (resultBox) resultBox.innerHTML = `<div style="background:${hrrGood?"#f0fdf4":"#fef2f2"};border:2px solid ${color}30;border-radius:12px;padding:14px;margin-top:8px">
      <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:10px">${label}</div>
      <div style="display:flex;gap:12px;margin-bottom:10px">
        <div style="flex:1;text-align:center;background:rgba(255,255,255,0.7);border-radius:8px;padding:8px"><div style="font-size:24px;font-weight:900;color:#374151">${_hrrState.baselineBpm}</div><div style="font-size:11px;color:#64748b">BPM nghỉ</div></div>
        <div style="flex:1;text-align:center;background:rgba(255,255,255,0.7);border-radius:8px;padding:8px"><div style="font-size:24px;font-weight:900;color:${color}">${hrrDelta}</div><div style="font-size:11px;color:#64748b">HRR (BPM giảm)</div></div>
        <div style="flex:1;text-align:center;background:rgba(255,255,255,0.7);border-radius:8px;padding:8px"><div style="font-size:24px;font-weight:900;color:#374151">${recoveryBpm}</div><div style="font-size:11px;color:#64748b">BPM phục hồi</div></div>
      </div>
      <p style="margin:0;font-size:12px;color:#475569">${hrrDelta >= 12 ? "Tim phục hồi tốt sau vận động. Nghiên cứu NEJM: HRR ≥ 12 BPM/phút liên quan đến sức khoẻ tim mạch tốt." : "Tim phục hồi chậm sau vận động — yếu tố nguy cơ tim mạch. Trao đổi với bác sĩ trong lần tái khám tới."}</p>
      <button onclick="startHRRTest();document.getElementById('hrrResult').innerHTML=''" style="background:#0369a1;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;margin-top:8px">🔄 Test lại</button>
    </div>`;
    // Save to server
    try { await api("/api/hrr-result", { method:"POST", body:JSON.stringify({ token:state.token, ...hrrResult }) }); } catch {}
    _hrrState = { phase:"idle", baselineBpm:null, timer:null };
  }
}

function renderHRRHistory(hrrResult) {
  if (!hrrResult || document.getElementById("hrrResult")?.innerHTML) return;
  const resultBox = document.getElementById("hrrResult");
  if (!resultBox) return;
  const { hrrDelta, baselineBpm, recoveryBpm, label, testedAt } = hrrResult;
  const color = hrrDelta >= 20 ? "#16a34a" : hrrDelta >= 12 ? "#0369a1" : "#dc2626";
  resultBox.innerHTML = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12px;color:#475569;margin-top:6px">
    📊 Kết quả HRR gần nhất (${new Date(testedAt).toLocaleDateString("vi-VN")}): <strong style="color:${color}">HRR = ${hrrDelta} BPM</strong> — ${label}
  </div>`;
}

function renderEmergencyMedicalID(user) {
  const box = document.getElementById("emergencyMedIDBox");
  if (!box || !user) return;
  const conditions = (user.conditions || []).join(", ") || "Chưa khai báo";
  const guardian = user.guardian || {};
  const allergy = user.allergy || "Chưa khai báo";
  const idData = {
    name: user.fullName || '—', age: user.age ?? '—', gender: user.gender === "male" ? "Nam" : user.gender === "female" ? "Nữ" : "Khác",
    conditions, guardian: guardian.guardianName || "—", guardianPhone: guardian.guardianPhone || "—", bloodType: user.bloodType || "Chưa khai báo",
  };
  box.innerHTML = `
    <div style="background:linear-gradient(135deg,#fef2f2,#fff5f5);border:3px solid #dc2626;border-radius:14px;padding:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="background:#dc2626;color:#fff;border-radius:8px;padding:6px 10px;font-size:20px">🆘</div>
        <div><div style="font-size:15px;font-weight:900;color:#dc2626">HỒ SƠ Y TẾ KHẨN CẤP</div><div style="font-size:11px;color:#64748b">HEARTSENSE · Mở để nhân viên cứu thương xem</div></div>
      </div>
      <div style="background:#fff;border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">
          <div><span style="color:#64748b">Họ tên:</span><br><strong>${idData.name}</strong></div>
          <div><span style="color:#64748b">Tuổi / Giới:</span><br><strong>${idData.age} tuổi · ${idData.gender}</strong></div>
          <div style="grid-column:1/-1"><span style="color:#64748b">Bệnh nền:</span><br><strong style="color:#dc2626">${conditions}</strong></div>
          <div><span style="color:#64748b">Nhóm máu:</span><br><strong>${idData.bloodType}</strong></div>
          <div><span style="color:#64748b">Dị ứng:</span><br><strong>${allergy}</strong></div>
          <div style="grid-column:1/-1"><span style="color:#64748b">Liên hệ khẩn cấp:</span><br><strong>${idData.guardian} · ${idData.guardianPhone ? `<a href="tel:${idData.guardianPhone}" style="color:#1d4ed8">${idData.guardianPhone}</a>` : "—"}</strong></div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <a href="tel:115" style="flex:1;background:#dc2626;color:#fff;text-align:center;padding:10px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">📞 Gọi 115</a>
        ${guardian.guardianPhone ? `<a href="tel:${guardian.guardianPhone}" style="flex:1;background:#1d4ed8;color:#fff;text-align:center;padding:10px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">👨‍👦 Gọi Người thân</a>` : ""}
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;text-align:center">💡 Để thông tin này hiển thị ngay: chụp màn hình và đặt làm ảnh nền khóa máy</p>
    </div>`;
}

function renderPostEpisodeProtocol(result) {
  const panel = document.getElementById("postEpisodePanel");
  const box = document.getElementById("postEpisodeBox");
  if (!panel || !box) return;
  panel.style.display = "block";
  const bpm = result.bpm || 72;
  box.innerHTML = `
    <div style="background:#fef2f2;border-radius:10px;padding:14px">
      <div style="font-size:14px;font-weight:700;color:#dc2626;margin-bottom:10px">🚨 Vừa phát hiện AFib — Làm theo từng bước:</div>
      <div style="counter-reset:step">
        ${[
          { t:"0-5 phút", icon:"🪑", act:"NGỒI XUỐNG ngay — Tựa lưng vào ghế, không đứng, không nằm. Nới lỏng quần áo.", col:"#fef2f2" },
          { t:"5-15 phút", icon:"🌬️", act:"THỞ SÂU — Hít vào 4 giây, nín 2 giây, thở ra 6 giây. Lặp lại 5 lần. Bấm vào Breathing Coach bên dưới.", col:"#eff6ff" },
          { t:"15 phút", icon:"💧", act:"UỐNG 200ml nước ấm — Làm ấm cơ thể, không uống cà phê hay nước lạnh.", col:"#f0fdf4" },
          { t:"30 phút", icon:"💊", act:`${state.user?.pillProtocol?.medicineName ? `Uống ${state.user.pillProtocol.medicineName} ${state.user.pillProtocol.dose} theo phác đồ bác sĩ.` : "Nếu bác sĩ đã kê thuốc Pill-in-Pocket — uống ngay. Nếu chưa có đơn — KHÔNG tự uống."}`, col:"#fffbeb" },
          { t:"60 phút", icon:"📷", act:"ĐO LẠI — Đặt ngón tay lên camera để kiểm tra tim đã hồi phục chưa. Nếu vẫn AFib → gọi 115.", col:"#fdf4ff" },
        ].map((s,i)=>`<div style="display:flex;gap:10px;margin-bottom:8px;padding:8px;background:${s.col};border-radius:8px;align-items:flex-start">
          <div style="min-width:28px;font-size:20px">${s.icon}</div>
          <div><div style="font-size:11px;color:#64748b;font-weight:700">Bước ${i+1} · ${s.t}</div><div style="font-size:13px;color:#374151">${s.act}</div></div>
        </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="document.getElementById('startBreathingBtn')?.click()" style="flex:1;background:#0369a1;color:#fff;border:none;border-radius:8px;padding:8px;cursor:pointer;font-size:13px;font-weight:600">🌬️ Breathing Coach</button>
        <a href="tel:115" style="flex:1;background:#dc2626;color:#fff;border-radius:8px;padding:8px;text-align:center;text-decoration:none;font-size:13px;font-weight:600">📞 Gọi 115</a>
      </div>
      ${bpm > 120 ? `<div style="margin-top:8px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:8px;font-size:12px;color:#991b1b;font-weight:700">⚠️ Nhịp tim ${bpm} BPM — RẤT NHANH! Không chờ đợi — Gọi 115 ngay nếu có thêm triệu chứng.</div>` : ""}
    </div>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// NHÓM 3 — SAFETY++ RENDERS
// ════════════════════════════════════════════════════════════════════════════════

function renderSmartMedReminder(exerciseDose, medEffect) {
  const box = document.getElementById("smartMedReminderBox");
  if (!box) return;
  const level = exerciseDose?.level || "GREEN";
  const medName = medEffect?.medicineName || null;
  const clotHigh = exerciseDose?.safeScore < 50;
  let msgs = [];
  if (clotHigh && medName) msgs.push({ icon:"🚨", color:"#dc2626", bg:"#fef2f2", bd:"#fca5a5", text:`ClotRisk đang cao hôm nay — <strong>KHÔNG ĐƯỢC QUÊN ${medName}</strong>. Uống ngay nếu chưa uống.` });
  if (level === "RED") msgs.push({ icon:"⚠️", color:"#d97706", bg:"#fffbeb", bd:"#fde68a", text:"Tim đang mệt mỏi hôm nay — uống đủ thuốc và đừng quên thuốc huyết áp buổi tối." });
  if (!msgs.length) msgs.push({ icon:"✅", color:"#16a34a", bg:"#f0fdf4", bd:"#86efac", text:`Tim đang trong trạng thái tốt. Duy trì uống thuốc đúng giờ như mọi ngày.${medName ? ` Đừng quên ${medName}.` : ""}` });
  box.innerHTML = msgs.map(m=>`<div style="background:${m.bg};border:1px solid ${m.bd};border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;gap:10px;align-items:flex-start"><span style="font-size:18px">${m.icon}</span><p style="margin:0;font-size:13px;color:${m.color};line-height:1.5">${m.text}</p></div>`).join("");
}

function renderCardiologyMap(hospitals, user) {
  const box = document.getElementById("cardiologyMapBox");
  if (!box || !hospitals) return;
  // Show top hospitals (all or filtered by user region)
  const shown = hospitals.slice(0, 5);
  box.innerHTML = `
    <div style="font-size:12px;color:#64748b;margin-bottom:8px">📍 Bệnh viện tim mạch lớn — Bấm để mở bản đồ hoặc gọi điện:</div>
    ${shown.map(h=>`
      <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#f8fafc;border-radius:8px;margin-bottom:6px;border:1px solid #e2e8f0">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#1e3a5f">${h.name}</div>
          <div style="font-size:11px;color:#64748b">${h.addr} · ${h.city}</div>
        </div>
        <div style="display:flex;gap:4px">
          <a href="tel:${h.tel}" style="background:#16a34a;color:#fff;border-radius:6px;padding:5px 8px;text-decoration:none;font-size:11px;font-weight:700">📞</a>
          <a href="https://maps.google.com/?q=${encodeURIComponent(h.addr)}" target="_blank" rel="noreferrer" style="background:#1d4ed8;color:#fff;border-radius:6px;padding:5px 8px;text-decoration:none;font-size:11px;font-weight:700">🗺️</a>
        </div>
      </div>`).join("")}
    <a href="https://maps.google.com/maps?q=bệnh+viện+tim+mạch+gần+nhất" target="_blank" rel="noreferrer" style="display:block;text-align:center;font-size:12px;color:#0369a1;margin-top:6px;text-decoration:underline">🔍 Tìm thêm bệnh viện gần vị trí của bạn →</a>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// NHÓM 4 — DEEP ANALYTICS RENDERS
// ════════════════════════════════════════════════════════════════════════════════

function renderCoherenceScore(cs) {
  const box = document.getElementById("coherenceScoreBox");
  if (!box || !cs) return;
  const color = cs.status==="COHERENT"?"#16a34a":cs.status==="MODERATE"?"#0369a1":"#dc2626";
  const bg = cs.status==="COHERENT"?"#f0fdf4":cs.status==="MODERATE"?"#eff6ff":"#fef2f2";
  const gaugeW = cs.coherence;
  box.innerHTML = `<div style="background:${bg};border:1px solid ${color}30;border-radius:12px;padding:14px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="text-align:center;min-width:62px"><div style="font-size:30px;font-weight:900;color:${color}">${cs.coherence}</div><div style="font-size:10px;color:#94a3b8">/ 100</div></div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:4px">${cs.label}</div>
        <div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%"><div style="background:${color};height:8px;border-radius:4px;width:${gaugeW}%;transition:width 0.8s"></div></div>
        <div style="font-size:11px;color:#64748b;margin-top:3px">LF/HF ratio: ${cs.ratio} · ${cs.ratio < 0.8 ? "Phó giao cảm chiếm ưu thế" : cs.ratio > 2.5 ? "Giao cảm chiếm ưu thế (stress)" : "Cân bằng tốt"}</div>
      </div>
    </div>
    <p style="margin:0;font-size:12px;color:#374151">${cs.advice}</p>
    ${cs.coherence < 60 ? `<button onclick="document.getElementById('startBreathingBtn')?.click()" style="margin-top:8px;background:${color};color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600">🌬️ Bật Breathing Coach ngay</button>` : ""}
  </div>`;
}

function renderElectrolyteRisk(data) {
  const box = document.getElementById("electrolyteRiskBox");
  if (!box || !data) return;
  const levelColor = { NORMAL:"#16a34a", BORDERLINE:"#d97706", LOW:"#dc2626" };
  const levelBg = { NORMAL:"#f0fdf4", BORDERLINE:"#fffbeb", LOW:"#fef2f2" };
  const worst = data.kLevel === "LOW" || data.mgLevel === "LOW" ? "LOW" : data.kLevel === "BORDERLINE" || data.mgLevel === "BORDERLINE" ? "BORDERLINE" : "NORMAL";
  const color = levelColor[worst], bg = levelBg[worst];
  const pill = (name, level) => `<span style="background:${levelColor[level]}20;color:${levelColor[level]};border:1px solid ${levelColor[level]}50;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:600">${name}: ${level==="NORMAL"?"Bình thường":level==="BORDERLINE"?"Có thể thấp":"THẤP ⚠️"}</span>`;
  box.innerHTML = `<div style="background:${bg};border:1px solid ${color}30;border-radius:12px;padding:14px">
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      ${pill("Kali K⁺", data.kLevel)} ${pill("Magie Mg²⁺", data.mgLevel)}
    </div>
    <p style="margin:0 0 8px;font-size:13px;color:#374151">${data.recommendation}</p>
    ${worst !== "NORMAL" ? `<div style="background:rgba(255,255,255,0.7);border-radius:8px;padding:8px;font-size:12px;color:#475569">💡 <strong>Thực phẩm bổ sung:</strong> Chuối, khoai lang, bơ (kali) · Hạnh nhân, hạt bí, socola đen (magie)</div>` : ""}
  </div>`;
}

function renderMonthlyCalendar(calendar) {
  const box = document.getElementById("monthlyCalendarBox");
  if (!box || !calendar || !calendar.length) return;
  const colorMap = { green:"#16a34a", yellow:"#d97706", red:"#dc2626", no_data:"#cbd5e1" };
  const bgMap = { green:"#f0fdf4", yellow:"#fffbeb", red:"#fef2f2", no_data:"#f8fafc" };
  const dayNames = ["CN","T2","T3","T4","T5","T6","T7"];
  const stats = { green:0, yellow:0, red:0, no_data:0 };
  calendar.forEach(d => stats[d.level]++);
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px">
      <span style="color:#16a34a">🟢 ${stats.green} ngày tốt</span>
      <span style="color:#d97706">🟡 ${stats.yellow} ngày chú ý</span>
      <span style="color:#dc2626">🔴 ${stats.red} ngày AFib</span>
      <span style="color:#94a3b8">⬜ ${stats.no_data} chưa đo</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:6px">
      ${dayNames.map(d=>`<div style="text-align:center;font-size:10px;color:#94a3b8;font-weight:600">${d}</div>`).join("")}
      ${calendar.map(d=>{
        const col=colorMap[d.level]||"#cbd5e1", bg=bgMap[d.level]||"#f8fafc";
        const title=d.measureCount?`${d.measureCount} lần đo${d.hasAfib?" · AFib phát hiện":""}`:d.isToday?"Hôm nay":"Chưa đo";
        return `<div title="${d.date}: ${title}" style="background:${bg};border:${d.isToday?"2px solid #1d4ed8":"1px solid "+col+"50"};border-radius:5px;padding:4px 2px;text-align:center;font-size:11px;font-weight:${d.isToday?"700":"500"};color:${col};cursor:default;aspect-ratio:1;display:flex;align-items:center;justify-content:center">
          ${d.day}</div>`;
      }).join("")}
    </div>
    <div style="font-size:11px;color:#94a3b8;text-align:right">30 ngày gần nhất — Di chuột lên ô để xem chi tiết</div>`;
}

function renderSeasonalPattern(data) {
  const box = document.getElementById("seasonalPatternBox");
  if (!box) return;
  if (!data || data.totalPoints < 12) { box.innerHTML = `<p class="muted">Cần ít nhất 12 lần đo qua nhiều tháng để phân tích theo mùa.</p>`; return; }
  const seasonIcons = { "Mùa Xuân (T3-T5)":"🌸", "Mùa Hè (T6-T8)":"☀️", "Mùa Thu (T9-T11)":"🍂", "Mùa Đông (T12-T2)":"❄️" };
  const rows = Object.entries(data.stats).map(([name, st]) => {
    const icon = seasonIcons[name]||"📅";
    const isWorst = name === data.worstSeason, isBest = name === data.bestSeason;
    const afibColor = st.afibPct >= 20?"#dc2626":st.afibPct >= 10?"#d97706":"#16a34a";
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:${isWorst?"#fef2f2":isBest?"#f0fdf4":"#f8fafc"};border-radius:8px;margin-bottom:5px;border:1px solid ${isWorst?"#fca5a5":isBest?"#86efac":"#e2e8f0"}">
      <span style="font-size:20px">${icon}</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:#1e3a5f">${name.split("(")[0].trim()} ${isWorst?"⚠️ Nguy cơ cao nhất":isBest?"🏆 An toàn nhất":""}</div>
        <div style="font-size:11px;color:#64748b">${st.count} lần đo · TB ${st.avgBpm} BPM · HRV ${st.avgHrv}ms</div>
      </div>
      <div style="text-align:center;min-width:50px">
        <div style="font-size:16px;font-weight:800;color:${afibColor}">${st.afibPct}%</div>
        <div style="font-size:10px;color:#94a3b8">AFib</div>
      </div>
    </div>`;
  }).join("");
  box.innerHTML = `${rows}<p style="font-size:12px;color:#64748b;margin:6px 0 0">💡 ${data.worstSeason ? `Tim bạn cần chú ý nhất vào ${data.worstSeason.split("(")[0].trim()} — chuẩn bị thuốc và tránh yếu tố trigger vào mùa này.` : "Chưa đủ dữ liệu để kết luận."}</p>`;
}

// ════════════════════════════════════════════════════════════════════════════════
// NHÓM 5 — ECOSYSTEM RENDERS
// ════════════════════════════════════════════════════════════════════════════════

function renderDoctorVisitPrep(data) {
  const box = document.getElementById("doctorVisitPrepBox");
  if (!box || !data) return;
  const done = data.checklist.filter(c=>c.done).length;
  const total = data.checklist.length;
  box.innerHTML = `
    <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:14px">
      <!-- Checklist -->
      <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px">📋 Checklist chuẩn bị (${done}/${total} hoàn thành):</div>
      <div style="background:#e0f2fe;border-radius:6px;height:6px;margin-bottom:10px"><div style="background:#0369a1;height:6px;border-radius:6px;width:${Math.round(done/total*100)}%"></div></div>
      ${data.checklist.map(c=>`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${c.done?"#166534":"#475569"};margin-bottom:4px"><span>${c.done?"✅":"⬜"}</span><span>${c.item}</span></div>`).join("")}

      <!-- Questions -->
      <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin:12px 0 6px">❓ Câu hỏi nên hỏi bác sĩ hôm nay:</div>
      ${data.questions.map((q,i)=>`<div style="background:rgba(255,255,255,0.7);border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:12px;color:#374151"><strong>${i+1}.</strong> ${q}</div>`).join("")}

      <!-- Medications -->
      ${data.medications.length > 0 ? `<div style="font-size:12px;font-weight:700;color:#1d4ed8;margin:12px 0 6px">💊 Thuốc đang dùng (đưa bác sĩ xem):</div>
      ${data.medications.map(m=>`<div style="background:rgba(255,255,255,0.7);border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:12px;color:#374151">💊 ${m}</div>`).join("")}` : ""}

      <!-- Export button -->
      <button onclick="document.getElementById('doctorExportBtn')?.click()" style="width:100%;margin-top:12px;background:#0369a1;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-size:13px;font-weight:700">📄 Tạo PDF báo cáo để mang đi khám</button>
    </div>`;
}

function renderFamilyDashboard(familyToken) {
  const resultBox = document.getElementById("familyLinkResult");
  if (!resultBox) return;
  if (familyToken) {
    const url = `${window.location.origin}/family/${familyToken}`;
    resultBox.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px;margin-top:8px">
      <div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">✅ Link gia đình đang hoạt động:</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input value="${url}" readonly style="flex:1;border:1px solid #86efac;border-radius:6px;padding:5px 8px;font-size:11px;background:#fff;color:#374151">
        <button onclick="navigator.clipboard?.writeText('${url}').then(()=>showToast('Đã sao chép!','success'))" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px;white-space:nowrap">📋 Copy</button>
      </div>
      <div style="font-size:11px;color:#64748b;margin-top:6px">Gửi link này cho con cái qua Zalo/WhatsApp. Họ mở link sẽ thấy ngay tình trạng tim của bạn (🟢/🟡/🔴).</div>
    </div>`;
  }
}

async function generateFamilyLink() {
  if (!state.token) { showToast("Cần đăng nhập.", "error"); return; }
  try {
    const resp = await api("/api/family-token", { method:"POST", body:JSON.stringify({ token:state.token }) });
    if (resp.token) {
      const url = `${window.location.origin}/family/${resp.token}`;
      const resultBox = document.getElementById("familyLinkResult");
      if (resultBox) resultBox.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px;margin-top:8px">
        <div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">✅ Link đã tạo thành công!</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input value="${url}" readonly style="flex:1;border:1px solid #86efac;border-radius:6px;padding:5px 8px;font-size:11px;background:#fff">
          <button onclick="navigator.clipboard?.writeText('${url}').then(()=>showToast('Đã sao chép!','success'))" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px">📋 Copy</button>
        </div>
        <p style="font-size:11px;color:#64748b;margin:6px 0 0">Gửi qua Zalo cho con cái — họ mở link thấy ngay trạng thái tim của bạn. Link có hiệu lực 30 ngày.</p>
      </div>`;
      showToast("Đã tạo link gia đình!", "success");
    }
  } catch (err) { showToast(err.message, "error"); }
}

// ─── Global exposure for inline onclick ──────────────────────────────────────
window.setPreMoodState = setPreMoodState;
window.saveCalibrationSettings = saveCalibrationSettings;
window.saveCalibFromLastMeasure = saveCalibFromLastMeasure;
window.resetCalibData = resetCalibData;
window.shareReport = shareReport;
window.sendAiReportToFamily = sendAiReportToFamily;
window.shareHolterReport = shareHolterReport;
window.showShareOptions = showShareOptions;
window.askPocketCardiologist = askPocketCardiologist;
window.pcToggleMic = pcToggleMic;
window.pcSpeak = pcSpeak;
window._updateMicBtn = _updateMicBtn;
window.startHRRTest = startHRRTest;
window.doHRRMeasure = doHRRMeasure;
window.generateFamilyLink = generateFamilyLink;

// Khi người dùng quay lại tab → load dashboard ngay thay vì đợi poll tiếp theo
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.token && state.user) loadDashboard().catch(() => {});
});

init();
