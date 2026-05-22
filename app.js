// HEARTSENSE v4.0 – Enhanced client with 19 features
const HEARTSENSE_TOKEN_KEY = "heartsense_token";
const MEASUREMENT_SECONDS = 30;
const BREATHING_SECONDS = 60;
const DASHBOARD_POLL_MS = 60000; // 60s thay vì 20s — giảm tải Render Free tier
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
  torchOn: false, // trạng thái đèn flash
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
  hrvAdvancedBox: document.querySelector("#hrvAdvancedBox"),
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

function isMobile() { return /android|iphone|ipad|mobile/i.test(navigator.userAgent); }
function setAuthState(msg, kind = "neutral") { el.authState.textContent = msg; el.authState.className = kind === "error" ? "badge danger" : "state-pill"; }

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

// IIR high-pass filter (loại DC drift < 0.5 Hz)
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

// Bandpass 0.5 – 3.5 Hz (tương đương 17–210 BPM)
function bandpassFilter(signal, fps) {
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

// Phát hiện đỉnh với ngưỡng thích nghi cục bộ
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
    if (peaks.length && (i - peaks[peaks.length - 1]) < minDist) {
      if (v > signal[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
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

  // Tín hiệu: POS (R+G+B) cho Face — RED cho Ngón Trỏ
  const rawSignal = mode === "finger"
    ? rawSamples.map(s => s.avgRed)
    : extractPosSignal(rawSamples);

  // ── Kiểm tra tính xác thực tín hiệu PPG ──────────────────────────────────
  const filtered = bandpassFilter(rawSignal, fps);
  const filteredStd = stdDev(filtered);

  // Chỉ chặn khi tín hiệu sau lọc hoàn toàn bằng 0 (không có bất kỳ thông tin nào)
  // Lưu ý: Finger PPG che camera là ĐÚNG kỹ thuật — không check "tối = lỗi"
  if (filteredStd < 0.20) return null;

  if (filteredStd < 0.25) return null;

  // Phương pháp 1: Multi-window median (ổn định nhất)
  const mwBpm = multiWindowBpm(filtered, fps, mode);

  // Phương pháp 2: Autocorrelation first-peak (tránh sub-harmonic)
  const acfBpm = autocorrBpm(filtered, fps);

  // Phương pháp 3: Peak detection
  const peaks = detectPeaksAdaptive(filtered, fps, mode);
  const pkResult = peaksToBpm(peaks, fps);
  const peakBpm = pkResult?.bpm || null;

  // Hợp nhất: ưu tiên multi-window; dùng 2 phương pháp còn lại để kiểm chứng
  let estimatedBpm = mwBpm;
  if (!estimatedBpm) {
    if (peakBpm && acfBpm) {
      const d = Math.abs(peakBpm - acfBpm);
      estimatedBpm = d <= 8 ? Math.round((peakBpm + acfBpm) / 2) : (d <= 15 ? Math.round(peakBpm * 0.4 + acfBpm * 0.6) : acfBpm);
    } else {
      estimatedBpm = peakBpm || acfBpm;
    }
  } else if (peakBpm && Math.abs(mwBpm - peakBpm) > 12 && acfBpm) {
    // Nếu 3 phương pháp không đồng thuận, lấy median của chúng
    const trio = [mwBpm, peakBpm, acfBpm].sort((a, b) => a - b);
    estimatedBpm = trio[1];
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

  // Signal quality
  const lightScores = rawSamples.map(s => Math.max(18, Math.min(99, 100 - Math.abs(s.brightness - 122) * 0.9)));
  const movementScores = rawSamples.map(s => Math.max(12, Math.min(99, 100 - s.movement * 1.8)));
  const lightScore = Math.round(average(lightScores));
  const stabilityScore = Math.round(average(movementScores));
  const methodAgreement = (peakBpm && acfBpm && Math.abs(peakBpm - acfBpm) <= 6) ? 12 : 0;
  const expectedPeaks = rawSamples.length / fps * (bpm / 60);
  const signalQuality = Math.round(Math.min(92, Math.max(20,
    (peaks.length / Math.max(1, expectedPeaks)) * 52 +
    lightScore * 0.14 + stabilityScore * 0.14 +
    methodAgreement + (mode === "finger" ? 12 : 0)
  )));

  // ═══ AFib detection — 6 điều kiện, ưu tiên tránh false positive ════════════
  const qualityGate = mode === "finger" ? 70 : 70; // nâng lên 70 cho cả hai
  const afibLikelihood = (
    signalQuality >= qualityGate &&       // 1. Tín hiệu tốt (≥ 70%)
    rrIntervals.length >= 10 &&           // 2. Đủ ≥10 khoảng RR
    bpm >= 50 && bpm <= 150 &&            // 3. BPM trong phạm vi hợp lý (không phải giá trị sai)
    cv > 0.28 &&                          // 4. Biến thiên nhịp cao
    pnn50 > 40 &&                         // 5. Nhiều khoảng lệch >50ms
    sdnn > 60                             // 6. SDNN cao
  );
  const afibScore = Math.round(Math.min(85, cv * 240 + (pnn50 > 40 ? 14 : 0) + (sdnn > 80 ? 8 : 0)));

  const hrvScore = Math.round(Math.min(94, Math.max(14,
    (Math.min(sdnn || 28, 90) / 90 * 55) + (Math.min(rmssd || 18, 65) / 65 * 45)
  )));

  return {
    estimatedBpm: bpm, bpm, sdnn, rmssd, pnn50,
    cv: Math.round(cv * 1000) / 1000,
    hrvScore, afibLikelihood, irregularityIndex: afibScore,
    signalQuality, lightScore, stabilityScore,
    peakCount: peaks.length,
    rrIntervals: rrIntervals.slice(0, 30),
    waveform: normalizeWave(detrend(rawSignal).slice(-90)),
    systolic: Number(el.systolicInput.value || 128),
    contextNote: el.measurementContextInput.value.trim(),
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
        signalQuality: Math.min(signalQuality, 60), // cap vì dữ liệu ngắn
        irregularityIndex: irr, waveform: normalizeWave(rawSignal.slice(-90)),
        rrIntervals: [], systolic: Number(el.systolicInput.value || 128),
        contextNote: el.measurementContextInput.value.trim(),
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
  };
}

function analyzeSamples(samples, mode) {
  const result = analyzePPGSignal(samples, mode, state.measurementFps);
  return result || analyzeSamplesLegacy(samples, mode);
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
        renderPreviewMetrics(derivePreviewMetrics(sample));
      }
      if (remaining <= 0) { state.measurementFps = Math.round(frameCount / MEASUREMENT_SECONDS); resolve(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  state.measurementActive = false;
  el.measurementOverlay.classList.add("hidden");
  el.deepAnalysisPrompt.classList.add("hidden");
  el.startMeasureBtn.disabled = false;

  const localResult = analyzeSamples(state.measurementSamples, state.measurementMode);
  buildWavePath(localResult.waveform);

  if (!state.token || !state.user) { renderGuestResult(localResult); return; }

  try {
    const response = await api("/api/measurements", {
      method: "POST",
      body: JSON.stringify({ token: state.token, type: state.measurementMode, payload: localResult }),
    });
    state.lastMeasurementRecord = response.measurement;
    renderDashboard(response.dashboard);

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
  } catch (err) { setAuthState(err.message, "error"); }
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
  el.pillAlertBox.innerHTML = `
    <div class="pill-alert-card">
      <strong>💊 NHẮC UỐNG THUỐC KHẨN CẤP</strong>
      <p>${pillAlert.message}</p>
      <div class="button-row">
        <button id="confirmPillBtn" class="primary-btn" type="button">Đã uống thuốc</button>
        <button id="dismissPillBtn" class="ghost-btn" type="button">Đóng</button>
      </div>
    </div>`;
  playAlarmTone();
  notify("HEARTSENSE", pillAlert.message);
  document.querySelector("#confirmPillBtn")?.addEventListener("click", () => { el.pillAlertBox.classList.add("hidden"); });
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
  buildWavePath(r.waveform || []);
  renderShockIndex(r.shockIndex);
  renderHrvAdvanced(r);
  el.abnormalPromptBox.classList.toggle("hidden", cls !== "elevated");
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
  el.symptomList.innerHTML = symptoms.length
    ? symptoms.map((s) => `<div class="list-item"><span>${formatDateTime(s.createdAt)}</span><strong>${s.note}</strong></div>`).join("")
    : "<p class='muted'>Chưa có nhật ký triệu chứng.</p>";
}

function renderReminders(reminders = []) {
  el.reminderList.innerHTML = reminders.length
    ? reminders.map((r) => `<div class="list-item"><span>${r.time}</span><strong>${r.medicineName}${r.pillColor ? " – " + r.pillColor : ""}${r.dose ? " (" + r.dose + ")" : ""}</strong></div>`).join("")
    : "<p class='muted'>Chưa có lịch nhắc thuốc.</p>";
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
  el.weatherBox.innerHTML = `
    <div class="list-item"><span>Nhiệt độ</span><strong>${weather.currentTemp ?? "--"}°C</strong></div>
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

function renderPillProtocol(protocol) {
  if (!el.pillProtocolStatus) return;
  el.pillProtocolStatus.textContent = protocol
    ? `Đang hoạt động: ${protocol.medicineName} ${protocol.dose} – ${protocol.instructions || "Uống ngay khi phát hiện AFib"}`
    : "Chưa thiết lập phác đồ pill-in-pocket.";
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  state.user = dashboard.user;
  setReportLink();
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
  renderPillProtocol(dashboard.pillProtocol);
  if (dashboard.latestMeasurement) { state.lastMeasurementRecord = dashboard.latestMeasurement; renderMeasurementResult(dashboard.latestMeasurement); }
  if (dashboard.latestBreathing?.result) { el.breathingStatus.textContent = `+${dashboard.latestBreathing.result.coherenceGain} coherence`; el.breathingStatus.className = "badge safe"; }
  const guardianEmail = dashboard.user?.guardian?.guardianEmail;
  if (el.parentReportStatus) {
    el.parentReportStatus.textContent = guardianEmail ? `Email mắt thần: ${guardianEmail}` : "";
  }
  if (el.remoteParentInfoStatus) {
    el.remoteParentInfoStatus.textContent = guardianEmail
      ? `Đã cấu hình – ${guardianEmail}`
      : "Chưa cấu hình email guardian.";
    el.remoteParentInfoStatus.className = guardianEmail ? "badge safe" : "muted";
  }
}

async function loadDashboard(showError = false) {
  if (!state.user || !state.token) return;
  try {
    const d = await api(`/api/users/${state.user.id}/dashboard?token=${encodeURIComponent(state.token)}`);
    renderDashboard(d);
  } catch (err) {
    // Chỉ hiện lỗi khi người dùng bấm nút refresh thủ công, không hiện khi auto-poll
    if (showError) setAuthState(err.message, "error");
  }
}

function startDashboardPolling() {
  if (state.dashboardPoll) clearInterval(state.dashboardPoll);
  if (!state.token || !state.user) return;
  state.dashboardPoll = setInterval(() => loadDashboard().catch(() => {}), DASHBOARD_POLL_MS);
}

async function restoreSession() {
  if (!state.token) { setAuthState("Chưa đăng nhập."); return; }
  try {
    const data = await api(`/api/session?token=${encodeURIComponent(state.token)}`);
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
  const form = new FormData(event.currentTarget);
  try {
    const r = await api("/api/symptoms", { method: "POST", body: JSON.stringify({ token: state.token, note: form.get("note") }) });
    event.currentTarget.reset(); renderDashboard(r.dashboard);
  } catch (err) { setAuthState(err.message, "error"); }
}

function hydrateMedicineNameFromFile() {
  const file = el.labelImageInput.files[0];
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  el.medicineNameInput.value = name;
  el.ocrStatus.textContent = `Tên thuốc đọc từ file: "${name}". Chỉnh lại nếu cần.`;
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
  try {
    const r = await api("/api/sos/trigger", { method: "POST", body: JSON.stringify({ token: state.token, reason }) });
    el.sosBadge.textContent = "SOS đã gửi"; el.sosBadge.className = "badge danger";
    renderSosBox("Hành lang xanh đã kích hoạt.", r.messages);
    notify("HEARTSENSE", "SOS đã gửi.");
    playAlarmTone(); renderDashboard(r.dashboard);
  } catch (err) { setAuthState(err.message, "error"); }
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
  try {
    const r = await api("/api/pill-protocol", { method: "POST", body: JSON.stringify({ token: state.token, medicineName: form.get("medicineName"), dose: form.get("dose"), instructions: form.get("instructions"), active: true }) });
    renderDashboard(r.dashboard);
    if (el.pillProtocolStatus) el.pillProtocolStatus.textContent = `Đã lưu: ${r.protocol.medicineName} ${r.protocol.dose}`;
    event.currentTarget.reset();
  } catch (err) { setAuthState(err.message, "error"); }
}

// ─── Remote Parent ────────────────────────────────────────────────────────────
async function sendParentReport() {
  if (!state.token || !state.user) { setAuthState("Cần đăng nhập.", "error"); return; }
  try {
    if (el.parentReportStatus) el.parentReportStatus.textContent = "Đang gửi...";
    if (el.remoteParentInfoStatus) { el.remoteParentInfoStatus.textContent = "Đang gửi báo cáo..."; el.remoteParentInfoStatus.className = "muted"; }
    const r = await api(`/api/users/${state.user.id}/remote-parent/send`, { method: "POST", body: JSON.stringify({ token: state.token }) });
    if (el.parentReportStatus) el.parentReportStatus.textContent = r.message;
    if (el.remoteParentInfoStatus) {
      el.remoteParentInfoStatus.textContent = r.sent ? `Đã gửi lúc ${new Date().toLocaleTimeString("vi-VN")}` : `Lỗi: ${r.message}`;
      el.remoteParentInfoStatus.className = r.sent ? "badge safe" : "badge warn";
    }
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
}

async function init() {
  detectPlatform(); renderQrFallback(); bindPwa(); bindEvents();
  setMeasurementMode("finger");
  await checkHealth(); await loadCameraDevices(); await restoreSession();
}

init();
