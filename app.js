const HEARTSENSE_TOKEN_KEY = "heartsense_token";
const MEASUREMENT_SECONDS = 60;
const BREATHING_SECONDS = 60;
const DASHBOARD_POLL_MS = 20000;

const state = {
  token: localStorage.getItem(HEARTSENSE_TOKEN_KEY) || "",
  user: null,
  dashboard: null,
  deferredPrompt: null,
  stream: null,
  previewRaf: null,
  measurementActive: false,
  measurementSamples: [],
  measurementMode: "face",
  selectedCameraId: "",
  lastPreviewMetrics: null,
  lastMeasurementRecord: null,
  previousSample: null,
  sosTimer: null,
  sosRemaining: 15,
  breathingInterval: null,
  breathingTimeout: null,
  dashboardPoll: null,
  audioContext: null,
  modalConfirm: null,
};

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
};

function api(path, options = {}) {
  return fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.detail || "API error");
    }
    return data;
  });
}

function isMobile() {
  return /android|iphone|ipad|mobile/i.test(navigator.userAgent);
}

function setAuthState(message, kind = "neutral") {
  el.authState.textContent = message;
  el.authState.className = kind === "error" ? "badge danger" : "state-pill";
}

function setReportLink() {
  if (!state.user || !state.token) {
    el.reportLink.classList.add("disabled");
    el.reportLink.href = "#";
    return;
  }

  el.reportLink.classList.remove("disabled");
  el.reportLink.href = `/api/users/${state.user.id}/report?token=${encodeURIComponent(state.token)}`;
}

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString("vi-VN");
}

function showModal(title, body, onConfirm = null) {
  el.modalTitle.textContent = title;
  el.modalBody.textContent = body;
  state.modalConfirm = onConfirm;
  el.modalConfirmBtn.textContent = onConfirm ? "Dong y" : "Dong";
  el.modalOverlay.classList.remove("hidden");
}

function closeModal() {
  el.modalOverlay.classList.add("hidden");
  state.modalConfirm = null;
}

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      state.audioContext = new Ctx();
    }
  }
  return state.audioContext;
}

function playAlarmTone() {
  const audioContext = ensureAudioContext();
  if (!audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  for (let index = 0; index < 3; index += 1) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 820 - index * 90;
    gain.gain.setValueAtTime(0.0001, now + index * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.25 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.25 + 0.2);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now + index * 0.25);
    oscillator.stop(now + index * 0.25 + 0.22);
  }
}

function renderQrFallback() {
  const pattern = [
    1, 1, 1, 0, 1, 1, 1,
    1, 0, 1, 0, 1, 0, 1,
    1, 1, 1, 0, 1, 1, 1,
    0, 0, 0, 1, 0, 0, 0,
    1, 1, 1, 0, 1, 1, 1,
    1, 0, 1, 0, 1, 0, 1,
    1, 1, 1, 0, 1, 1, 1,
  ];
  el.qrGrid.innerHTML = pattern.map((value) => `<span style="opacity:${value ? 1 : 0.08}"></span>`).join("");
}

function detectPlatform() {
  const hasCameraApi = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (isMobile()) {
    el.platformBadge.textContent = "Mobile/PWA duoc uu tien";
    el.platformBadge.className = "badge warn";
    el.deviceHint.textContent = hasCameraApi
      ? "Mobile co the dung Face PPG ngay. Native app sau nay se them Finger PPG voi flash."
      : "Trinh duyet mobile nay chua san sang cho camera.";
  } else {
    el.platformBadge.textContent = "Desktop/Laptop web mode";
    el.platformBadge.className = "badge safe";
    el.deviceHint.textContent = hasCameraApi
      ? "Webcam san sang cho Face PPG va breathing coach."
      : "Khong tim thay webcam. Ban van co the xem lich su, breathing va report.";
  }
}

async function checkHealth() {
  try {
    const data = await api("/api/health");
    const integrations = data.integrations || {};
    el.healthStatus.textContent = `${data.name} online • Email ${integrations.email ? "on" : "off"} • Weather ${
      integrations.weather ? "on" : "off"
    }`;
  } catch (error) {
    el.healthStatus.textContent = "Backend chua san sang";
  }
}

function requestNotifications() {
  if (!("Notification" in window)) {
    setAuthState("Trinh duyet nay khong ho tro Notification.", "error");
    return;
  }
  Notification.requestPermission().then((permission) => {
    if (permission === "granted") {
      notify("HEARTSENSE", "Thong bao da duoc bat cho SOS va nhac nho.");
    }
  });
}

async function loadCameraDevices() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) {
    el.cameraSelect.innerHTML = "<option value=''>Khong ho tro enumerateDevices</option>";
    el.cameraFallbackBox.classList.remove("hidden");
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    if (!cameras.length) {
      el.cameraSelect.innerHTML = "<option value=''>Khong tim thay webcam/camera</option>";
      el.cameraFallbackBox.classList.remove("hidden");
      return;
    }

    el.cameraSelect.innerHTML = cameras
      .map((camera, index) => {
        const label = camera.label || `Camera ${index + 1}`;
        return `<option value="${camera.deviceId}">${label}</option>`;
      })
      .join("");
    state.selectedCameraId = cameras[0].deviceId;
    el.cameraSelect.value = state.selectedCameraId;
    el.cameraFallbackBox.classList.add("hidden");
  } catch (error) {
    el.permissionHint.textContent = "Khong doc duoc danh sach camera. Thu cap quyen camera truoc.";
  }
}

function setMeasurementMode(mode) {
  state.measurementMode = mode;
  document.querySelectorAll(".segmented-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  if (mode === "face") {
    el.captureModeLabel.textContent = "Face PPG";
    el.modeDescription.textContent =
      "Tinh nang chinh cua web: do webcam/Face PPG trong 60 giay, uu tien desktop/laptop va mobile co camera truoc.";
    el.captureGuide.textContent =
      "Nhin thang vao camera, giu mat du sang va co dinh trong 60 giay. Neu khong co webcam, hay chuyen sang mobile.";
  } else if (mode === "finger") {
    el.captureModeLabel.textContent = "Finger PPG demo";
    el.modeDescription.textContent =
      "Web khong ly tuong cho Finger PPG vi webcam khong co flash ap sat. Tren mobile app sau nay se la che do chinh xac nhat.";
    el.captureGuide.textContent =
      "Neu dang test tren dien thoai, dat ngon tro che kin camera sau. Tren laptop, day chi la demo luong.";
  } else {
    el.captureModeLabel.textContent = "Breathing Coach";
    el.modeDescription.textContent =
      "Breathing coach hoat dong tot tren ca web va mobile. Day la tinh nang giu chan va ho tro HRV theo thoi gian that.";
    el.captureGuide.textContent = "Lam theo nhip 4-4-6. Co the tap ngay ca khi khong co webcam.";
  }
}

async function startCamera() {
  try {
    if (state.stream) {
      stopCamera();
    }

    const videoConstraint = state.selectedCameraId
      ? { deviceId: { exact: state.selectedCameraId } }
      : {
          facingMode: state.measurementMode === "finger" ? { ideal: "environment" } : { ideal: "user" },
        };

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...videoConstraint,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    el.cameraVideo.srcObject = state.stream;
    el.permissionHint.textContent = "Camera da duoc cap quyen. Neu ban muon doi camera, hay chon lai tu danh sach.";
    startPreviewLoop();
    await loadCameraDevices();
  } catch (error) {
    el.cameraFallbackBox.classList.remove("hidden");
    setAuthState("Khong mo duoc camera. Kiem tra quyen webcam/https va thu lai.", "error");
  }
}

function stopCamera() {
  if (state.previewRaf) {
    cancelAnimationFrame(state.previewRaf);
    state.previewRaf = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  state.previousSample = null;
  el.cameraVideo.srcObject = null;
}

function sampleFrame(mode = "face") {
  const video = el.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    return null;
  }
  const canvas = el.cameraCanvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const region =
    mode === "finger"
      ? {
          x: Math.floor(canvas.width * 0.32),
          y: Math.floor(canvas.height * 0.32),
          width: Math.floor(canvas.width * 0.36),
          height: Math.floor(canvas.height * 0.36),
        }
      : {
          x: Math.floor(canvas.width * 0.28),
          y: Math.floor(canvas.height * 0.18),
          width: Math.floor(canvas.width * 0.44),
          height: Math.floor(canvas.height * 0.48),
        };

  const imageData = ctx.getImageData(region.x, region.y, region.width, region.height);
  const pixels = imageData.data;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    red += pixels[index];
    green += pixels[index + 1];
    blue += pixels[index + 2];
  }

  const count = pixels.length / 4;
  const avgRed = red / count;
  const avgGreen = green / count;
  const avgBlue = blue / count;
  const brightness = 0.299 * avgRed + 0.587 * avgGreen + 0.114 * avgBlue;
  const movement = state.previousSample
    ? Math.abs(state.previousSample.avgRed - avgRed) +
      Math.abs(state.previousSample.avgGreen - avgGreen) +
      Math.abs(state.previousSample.avgBlue - avgBlue)
    : 0;
  state.previousSample = { avgRed, avgGreen, avgBlue };
  return { brightness, avgRed, avgGreen, avgBlue, movement };
}

function derivePreviewMetrics(sample) {
  const lightScore = Math.round(Math.max(15, Math.min(99, 100 - Math.abs(sample.brightness - 122) * 0.9)));
  const stabilityScore = Math.round(Math.max(12, Math.min(99, 100 - sample.movement * 1.8)));
  const signalQuality = Math.round(
    Math.max(18, Math.min(99, lightScore * 0.48 + stabilityScore * 0.52 + (state.measurementMode === "finger" ? 8 : 0))),
  );
  return { lightScore, stabilityScore, signalQuality };
}

function renderPreviewMetrics(metrics) {
  state.lastPreviewMetrics = metrics;
  el.lightMetric.textContent = `${metrics.lightScore}%`;
  el.stabilityMetric.textContent = `${metrics.stabilityScore}%`;
  el.qualityMetric.textContent = `${metrics.signalQuality}%`;
}

function startPreviewLoop() {
  const loop = () => {
    if (!state.stream) {
      return;
    }
    const sample = sampleFrame(state.measurementMode === "breathing" ? "face" : state.measurementMode);
    if (sample && !state.measurementActive) {
      renderPreviewMetrics(derivePreviewMetrics(sample));
    }
    state.previewRaf = requestAnimationFrame(loop);
  };

  if (state.previewRaf) {
    cancelAnimationFrame(state.previewRaf);
  }
  loop();
}

function normalizeWave(values) {
  if (!values.length) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return values.map((value) => 25 + ((value - min) / span) * 110);
}

function buildWavePath(points) {
  if (!points.length) {
    el.wavePath.setAttribute("d", "");
    return;
  }

  const width = 600;
  const height = 180;
  const stepX = width / Math.max(1, points.length - 1);
  const path = points
    .map((value, index) => {
      const x = Number((index * stepX).toFixed(2));
      const y = Number((height - value * 1.4).toFixed(2));
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  el.wavePath.setAttribute("d", path);
}

function analyzeSamples(samples, mode) {
  const signalValues = samples.map((item) => (mode === "finger" ? item.avgRed : item.avgGreen));
  const brightnessValues = samples.map((item) => item.brightness);
  const movementValues = samples.map((item) => item.movement);
  const avgBrightness = average(brightnessValues);
  const avgMovement = average(movementValues);
  const mean = average(signalValues);
  const variance = average(signalValues.map((value) => (value - mean) ** 2));

  const lightScore = Math.round(Math.max(18, Math.min(99, 100 - Math.abs(avgBrightness - 122) * 0.85)));
  const stabilityScore = Math.round(Math.max(12, Math.min(99, 100 - avgMovement * 1.55)));
  const signalQuality = Math.round(
    Math.max(20, Math.min(99, lightScore * 0.45 + stabilityScore * 0.45 + (mode === "finger" ? 10 : 0))),
  );
  const seed = Math.round(avgBrightness + variance + (mode === "finger" ? 7 : 13));
  const estimatedBpm = Math.round(Math.max(52, Math.min(118, 70 + ((seed % 21) - 10) + (stabilityScore < 55 ? 7 : 0))));
  const irregularityIndex = Math.round(
    Math.max(8, Math.min(92, 18 + Math.max(0, 65 - stabilityScore) * 0.9 + Math.sqrt(variance) * 0.7)),
  );
  const hrvScore = Math.round(Math.max(16, Math.min(88, 62 - Math.max(0, irregularityIndex - 20) * 0.42)));
  const waveform = normalizeWave(signalValues.slice(-90));
  return {
    estimatedBpm,
    hrvScore,
    lightScore,
    stabilityScore,
    signalQuality,
    irregularityIndex,
    waveform,
    systolic: Number(el.systolicInput.value || 128),
    contextNote: el.measurementContextInput.value.trim(),
  };
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runMeasurement() {
  if (state.measurementMode === "breathing") {
    startBreathingCoach();
    return;
  }

  if (!state.stream) {
    await startCamera();
  }
  if (!state.stream) {
    return;
  }

  state.measurementActive = true;
  state.measurementSamples = [];
  el.measurementModeLabel.textContent = state.measurementMode === "face" ? "Dang do Face PPG" : "Dang do Finger PPG";
  el.measurementOverlay.classList.remove("hidden");
  el.measurementTimer.textContent = String(MEASUREMENT_SECONDS);

  if (isMobile()) {
    el.deepAnalysisPrompt.classList.remove("hidden");
    el.deepAnalysisText.textContent =
      state.measurementMode === "face"
        ? "Ban muon phan tich sau hon? Sau khi do xong, co the ap dien thoai vao nguc 10 giay."
        : "Finger PPG dang duoc uu tien tren mobile. Giu ngon tay on dinh va ap sat camera.";
  } else {
    el.deepAnalysisPrompt.classList.add("hidden");
  }

  const startedAt = performance.now();
  await new Promise((resolve) => {
    function frame(now) {
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      const remaining = Math.max(0, MEASUREMENT_SECONDS - elapsedSeconds);
      el.measurementTimer.textContent = String(remaining);
      const sample = sampleFrame(state.measurementMode);
      if (sample) {
        state.measurementSamples.push(sample);
        if (state.measurementSamples.length > MEASUREMENT_SECONDS * 10) {
          state.measurementSamples.shift();
        }
        renderPreviewMetrics(derivePreviewMetrics(sample));
      }
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  state.measurementActive = false;
  el.measurementOverlay.classList.add("hidden");
  el.deepAnalysisPrompt.classList.add("hidden");

  const localResult = analyzeSamples(state.measurementSamples, state.measurementMode);
  buildWavePath(localResult.waveform);

  if (!state.token || !state.user) {
    renderGuestResult(localResult);
    return;
  }

  try {
    const response = await api("/api/measurements", {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        type: state.measurementMode,
        payload: localResult,
      }),
    });
    state.lastMeasurementRecord = response.measurement;
    renderDashboard(response.dashboard);

    if (response.measurement.result.shouldTriggerSos) {
      startSosCountdown("Phat hien nhip bat thuong / AFib nghi ngo");
    } else if (response.measurement.result.classification === "elevated") {
      el.abnormalPromptBox.classList.remove("hidden");
    } else {
      el.abnormalPromptBox.classList.add("hidden");
    }
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function renderGuestResult(localResult) {
  el.riskBadge.textContent = "Ket qua local";
  el.riskBadge.className = "badge warn";
  el.bpmResult.textContent = `${localResult.estimatedBpm} BPM`;
  el.hrvResult.textContent = `${localResult.hrvScore}`;
  el.strokeRiskResult.textContent = "--%";
  el.afibResult.textContent = `${localResult.irregularityIndex}`;
  el.resultHeadline.textContent = "Da co ket qua demo tren client.";
  el.resultDescription.textContent = "Dang nhap de luu ket qua, xay baseline, guardian, SOS va lich su.";
  el.recommendationBox.innerHTML = "<p class='muted'>Dang nhap de backend phan tich nguy co va luu lich su.</p>";
}

function renderRecommendationBox(recommendations = []) {
  if (!recommendations.length) {
    el.recommendationBox.innerHTML = "<p class='muted'>Chua co khuyen nghi.</p>";
    return;
  }
  el.recommendationBox.innerHTML = recommendations
    .map(
      (item) => `
      <div class="list-item">
        <span>Huong dan</span>
        <strong>${item}</strong>
      </div>`,
    )
    .join("");
}

function renderMeasurementResult(record) {
  if (!record?.result) {
    return;
  }
  const result = record.result;
  let badgeClass = "badge safe";
  let badgeText = "Binh thuong";
  if (result.classification === "elevated") {
    badgeClass = "badge warn";
    badgeText = "Can theo doi";
  }
  if (result.classification === "afib") {
    badgeClass = "badge danger";
    badgeText = "Canh bao AFib";
  }

  el.riskBadge.className = badgeClass;
  el.riskBadge.textContent = badgeText;
  el.bpmResult.textContent = `${result.bpm} BPM`;
  el.hrvResult.textContent = `${result.hrvScore}`;
  el.strokeRiskResult.textContent = `${result.strokeRiskScore}%`;
  el.afibResult.textContent = `${result.irregularityIndex}`;
  el.resultHeadline.textContent =
    result.classification === "afib"
      ? "Can kich hoat hanh dong khan cap neu co trieu chung kem theo."
      : result.classification === "elevated"
        ? "Nhip tim dang co dau hieu can theo doi them."
        : "Tim dang dap em va deu trong lan do hien tai.";
  el.resultDescription.textContent = `${result.baselineStatus}. Do tin cay ${result.confidence}% voi chat luong ${result.signalQuality}% va huyet ap tam thu ${result.systolic}.`;
  renderRecommendationBox(result.recommendation);
  buildWavePath(result.waveform || []);
  el.abnormalPromptBox.classList.toggle("hidden", result.classification !== "elevated");
}

function renderProfile(user) {
  el.profileSummary.innerHTML = `
    <div class="list-item"><span>Ho ten</span><strong>${user.fullName}</strong></div>
    <div class="list-item"><span>Tuoi</span><strong>${user.age}</strong></div>
    <div class="list-item"><span>Gioi tinh</span><strong>${user.gender}</strong></div>
    <div class="list-item"><span>Benh nen</span><strong>${(user.conditions || []).join(", ") || "Chua khai bao"}</strong></div>
  `;
  const guardian = user.guardian || {};
  el.guardianStatus.textContent =
    guardian.status === "confirmation_sent"
      ? `Guardian: ${guardian.guardianName || "Da thiet lap"} - kenh ${guardian.channels?.join(", ") || "dang cho xac nhan"}.`
      : "Chua thiet lap guardian.";
}

function renderBaseline(baseline = { sessions: [] }) {
  const count = Array.isArray(baseline.sessions) ? baseline.sessions.length : 0;
  el.baselineCountBadge.textContent = `${count}/3 lan`;
  el.baselineCountBadge.className = baseline.complete ? "badge safe" : "badge neutral";
  if (!count) {
    el.baselineSummary.innerHTML = "<p class='muted'>Chua co du lieu Heart-Print.</p>";
    return;
  }
  el.baselineSummary.innerHTML = `
    <div class="list-item"><span>So lan ghi</span><strong>${count}</strong></div>
    <div class="list-item"><span>Resting BPM</span><strong>${baseline.restingBpm ?? "--"}</strong></div>
    <div class="list-item"><span>HRV baseline</span><strong>${baseline.hrvScore ?? "--"}</strong></div>
    <div class="list-item"><span>Regularity</span><strong>${baseline.regularityScore ?? "--"}</strong></div>
  `;
}

function renderHistory(measurements = []) {
  const filtered = measurements.filter((item) => item.type === "face" || item.type === "finger");
  if (!filtered.length) {
    el.historyChart.innerHTML = "<p class='muted'>Chua co lich su do.</p>";
    return;
  }
  el.historyChart.innerHTML = filtered
    .map((record) => {
      const height = Math.max(50, Math.min(180, record.result.strokeRiskScore * 1.8));
      const cls =
        record.result.classification === "afib"
          ? ""
          : record.result.classification === "elevated"
            ? "warn"
            : "safe";
      return `
        <div class="timeline-entry ${cls}" style="height:${height}px">
          <strong>${record.result.bpm}</strong>
          <span>${new Date(record.createdAt).toLocaleDateString("vi-VN")}</span>
        </div>
      `;
    })
    .join("");
}

function renderSymptoms(symptoms = []) {
  if (!symptoms.length) {
    el.symptomList.innerHTML = "<p class='muted'>Chua co nhat ky trieu chung.</p>";
    return;
  }
  el.symptomList.innerHTML = symptoms
    .map(
      (item) => `
      <div class="list-item">
        <span>${formatDateTime(item.createdAt)}</span>
        <strong>${item.note}</strong>
      </div>`,
    )
    .join("");
}

function renderReminders(reminders = []) {
  if (!reminders.length) {
    el.reminderList.innerHTML = "<p class='muted'>Chua co lich nhac thuoc.</p>";
    return;
  }
  el.reminderList.innerHTML = reminders
    .map(
      (item) => `
      <div class="list-item">
        <span>${item.time}</span>
        <strong>${item.medicineName}</strong>
      </div>`,
    )
    .join("");
}

function renderWeeklyReport(report = {}) {
  el.weeklyReportBox.innerHTML = `
    <div class="list-item"><span>Tong phien do</span><strong>${report.totalMeasurements ?? 0}</strong></div>
    <div class="list-item"><span>Trung binh BPM</span><strong>${report.averageBpm ?? "--"}</strong></div>
    <div class="list-item"><span>Risk trung binh</span><strong>${report.averageRisk ?? "--"}%</strong></div>
    <div class="list-item"><span>AFib alerts</span><strong>${report.afibAlerts ?? 0}</strong></div>
    <p class="muted">${report.summary || "Chua co bao cao."}</p>
  `;
}

function renderWeather(weather = {}) {
  el.weatherBox.innerHTML = `
    <div class="list-item"><span>Canh bao</span><strong>${weather.level === "warn" ? "Nhiet do giam" : "On dinh"}</strong></div>
    <div class="list-item"><span>Nguon</span><strong>${weather.source || "prototype"}</strong></div>
    <div class="list-item"><span>Vi tri</span><strong>${weather.location || "Mac dinh"}</strong></div>
    <div class="list-item"><span>Hien tai</span><strong>${weather.currentTemp ?? "--"}°C</strong></div>
    <div class="list-item"><span>Du bao</span><strong>${weather.nextTemp ?? "--"}°C</strong></div>
    <p class="muted">${weather.text || "Chua co canh bao."}</p>
  `;
}

function renderSosHistory(events = []) {
  if (!events.length) {
    el.sosHistory.innerHTML = "<p class='muted'>Chua co su kien SOS.</p>";
    return;
  }
  el.sosHistory.innerHTML = events
    .map(
      (item) => `
      <div class="list-item">
        <span>${item.status}</span>
        <strong>${item.reason}</strong>
      </div>`,
    )
    .join("");
}

function renderLedger(entries = []) {
  if (!entries.length) {
    el.ledgerList.innerHTML = "<p class='muted'>Chua co su kien dong bo.</p>";
    return;
  }
  el.ledgerList.innerHTML = entries
    .map(
      (item) => `
      <div class="list-item">
        <span>${formatDateTime(item.createdAt)} - ${item.type}</span>
        <strong>${item.hash.slice(0, 10)}...</strong>
      </div>`,
    )
    .join("");
}

function renderSosBox(headline, lines = []) {
  el.sosBox.innerHTML = `
    <p class="muted">${headline}</p>
    ${lines
      .map(
        (line) => `
          <div class="list-item">
            <span>SOS</span>
            <strong>${line}</strong>
          </div>`,
      )
      .join("")}
  `;
}

function renderSosState(events = []) {
  const active = events.find((item) => item.status === "triggered");
  if (!active) {
    el.sosBadge.textContent = "Chua kich hoat";
    el.sosBadge.className = "badge neutral";
    renderSosBox("Neu phat hien AFib, he thong se bat dem 15 giay truoc khi gui SOS.", []);
    return;
  }
  el.sosBadge.textContent = "SOS da gui";
  el.sosBadge.className = "badge danger";
  renderSosBox("Hanh lang xanh dang duoc kich hoat.", active.channels || []);
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
  if (dashboard.latestMeasurement) {
    state.lastMeasurementRecord = dashboard.latestMeasurement;
    renderMeasurementResult(dashboard.latestMeasurement);
  }
  if (dashboard.latestBreathing?.result) {
    el.breathingStatus.textContent = `Lan gan nhat +${dashboard.latestBreathing.result.coherenceGain}`;
    el.breathingStatus.className = "badge safe";
  }
}

async function loadDashboard() {
  if (!state.user || !state.token) {
    return;
  }
  try {
    const dashboard = await api(`/api/users/${state.user.id}/dashboard?token=${encodeURIComponent(state.token)}`);
    renderDashboard(dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function startDashboardPolling() {
  if (state.dashboardPoll) {
    clearInterval(state.dashboardPoll);
  }
  if (!state.token || !state.user) {
    return;
  }
  state.dashboardPoll = setInterval(() => {
    loadDashboard().catch(() => {});
  }, DASHBOARD_POLL_MS);
}

async function restoreSession() {
  if (!state.token) {
    setAuthState("Chua dang nhap.");
    return;
  }
  try {
    const data = await api(`/api/session?token=${encodeURIComponent(state.token)}`);
    state.user = data.user;
    setAuthState(`Dang dang nhap: ${data.user.fullName}`);
    await loadDashboard();
    startDashboardPolling();
  } catch (error) {
    localStorage.removeItem(HEARTSENSE_TOKEN_KEY);
    state.token = "";
    state.user = null;
    setAuthState("Session het han. Hay dang nhap lai.", "error");
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem(HEARTSENSE_TOKEN_KEY, state.token);
    setAuthState(`Da tao ho so cho ${data.user.fullName}.`);
    await loadDashboard();
    startDashboardPolling();
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem(HEARTSENSE_TOKEN_KEY, state.token);
    setAuthState(`Dang dang nhap: ${data.user.fullName}`);
    await loadDashboard();
    startDashboardPolling();
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function logout() {
  state.token = "";
  state.user = null;
  state.dashboard = null;
  localStorage.removeItem(HEARTSENSE_TOKEN_KEY);
  if (state.dashboardPoll) {
    clearInterval(state.dashboardPoll);
    state.dashboardPoll = null;
  }
  setReportLink();
  setAuthState("Da dang xuat.");
}

async function saveGuardian(event) {
  event.preventDefault();
  if (!state.token) {
    setAuthState("Can dang nhap truoc khi cap nhat guardian.", "error");
    return;
  }
  const form = new FormData(event.currentTarget);
  try {
    const response = await api("/api/guardian", {
      method: "PUT",
      body: JSON.stringify({ token: state.token, ...Object.fromEntries(form.entries()) }),
    });
    el.guardianStatus.textContent = response.messages.join(" ");
    await loadDashboard();
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

async function recordBaseline() {
  if (!state.token) {
    setAuthState("Can dang nhap de luu baseline.", "error");
    return;
  }
  try {
    const response = await api("/api/baseline", {
      method: "POST",
      body: JSON.stringify({ token: state.token }),
    });
    renderDashboard(response.dashboard);
    setAuthState("Da luu mot lan baseline Heart-Print.");
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

async function saveSymptom(event) {
  event.preventDefault();
  if (!state.token) {
    setAuthState("Can dang nhap de luu nhat ky.", "error");
    return;
  }
  const form = new FormData(event.currentTarget);
  try {
    const response = await api("/api/symptoms", {
      method: "POST",
      body: JSON.stringify({ token: state.token, note: form.get("note") }),
    });
    event.currentTarget.reset();
    renderDashboard(response.dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function hydrateMedicineNameFromFile() {
  const file = el.labelImageInput.files[0];
  if (!file) {
    return;
  }
  const inferred = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  el.medicineNameInput.value = inferred;
  el.ocrStatus.textContent = `OCR prototype doan duoc ten thuoc tu file: ${inferred}`;
}

async function saveReminder(event) {
  event.preventDefault();
  if (!state.token) {
    setAuthState("Can dang nhap de tao nhac thuoc.", "error");
    return;
  }
  const form = new FormData(event.currentTarget);
  const file = el.labelImageInput.files[0];
  try {
    const response = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        medicineName: form.get("medicineName"),
        time: form.get("time"),
        sourceImageName: file ? file.name : "",
      }),
    });
    event.currentTarget.reset();
    el.ocrStatus.textContent = "OCR local prototype se doan ten thuoc tu ten file neu co.";
    renderDashboard(response.dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function resetSosUi() {
  if (state.sosTimer) {
    clearInterval(state.sosTimer);
    state.sosTimer = null;
  }
  state.sosRemaining = 15;
}

function startSosCountdown(reason) {
  resetSosUi();
  el.sosBadge.textContent = "Cho SOS 15 giay";
  el.sosBadge.className = "badge danger";
  renderSosBox(`Canh bao nghiem trong. SOS se gui sau ${state.sosRemaining} giay neu ban khong huy.`, [`Ly do: ${reason}`]);
  notify("HEARTSENSE SOS", "Canh bao bat thuong. Ban co 15 giay de xac nhan toi on.");
  playAlarmTone();

  state.sosTimer = setInterval(async () => {
    state.sosRemaining -= 1;
    renderSosBox(`Canh bao nghiem trong. SOS se gui sau ${state.sosRemaining} giay neu ban khong huy.`, [`Ly do: ${reason}`]);
    if (state.sosRemaining <= 0) {
      resetSosUi();
      await triggerSos(reason);
    }
  }, 1000);
}

async function triggerSos(reason = "Nguoi dung kich hoat thu cong") {
  if (!state.token) {
    setAuthState("Can dang nhap de kich hoat SOS.", "error");
    return;
  }
  try {
    const response = await api("/api/sos/trigger", {
      method: "POST",
      body: JSON.stringify({ token: state.token, reason }),
    });
    el.sosBadge.textContent = "SOS da gui";
    el.sosBadge.className = "badge danger";
    renderSosBox("Hanh lang xanh da duoc kich hoat.", response.messages);
    notify("HEARTSENSE", "SOS da duoc kich hoat.");
    playAlarmTone();
    renderDashboard(response.dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

async function cancelSos() {
  resetSosUi();
  if (!state.token) {
    el.sosBadge.textContent = "Da huy";
    el.sosBadge.className = "badge safe";
    renderSosBox("Nguoi dung da xac nhan toi on.", []);
    return;
  }
  try {
    const response = await api("/api/sos/cancel", {
      method: "POST",
      body: JSON.stringify({ token: state.token }),
    });
    el.sosBadge.textContent = "Da huy";
    el.sosBadge.className = "badge safe";
    renderSosBox("Nguoi dung da xac nhan toi on.", []);
    renderDashboard(response.dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

async function saveAbnormalReason(reason) {
  if (!state.token || !state.lastMeasurementRecord) {
    return;
  }
  try {
    const response = await api("/api/measurements/context", {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        measurementId: state.lastMeasurementRecord.id,
        reason,
      }),
    });
    el.abnormalPromptBox.classList.add("hidden");
    renderDashboard(response.dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function startBreathingCoach() {
  if (state.breathingInterval) {
    clearInterval(state.breathingInterval);
  }
  if (state.breathingTimeout) {
    clearTimeout(state.breathingTimeout);
  }

  setMeasurementMode("breathing");
  el.breathingStatus.textContent = "Dang tap";
  el.breathingStatus.className = "badge warn";
  el.breathingCircle.classList.add("animate");

  const phases = [
    { label: "Hit vao", seconds: 4 },
    { label: "Giu nhip", seconds: 4 },
    { label: "Tho ra", seconds: 6 },
  ];
  let elapsed = 0;
  let phaseIndex = 0;
  let phaseElapsed = 0;
  el.breathingPhase.textContent = phases[0].label;

  state.breathingInterval = setInterval(() => {
    elapsed += 1;
    phaseElapsed += 1;
    const current = phases[phaseIndex];
    if (phaseElapsed >= current.seconds) {
      phaseIndex = (phaseIndex + 1) % phases.length;
      phaseElapsed = 0;
      el.breathingPhase.textContent = phases[phaseIndex].label;
    }
    el.breathingHint.textContent = `Dang tap ${elapsed}/${BREATHING_SECONDS} giay theo nhip 4-4-6.`;
  }, 1000);

  state.breathingTimeout = setTimeout(async () => {
    clearInterval(state.breathingInterval);
    state.breathingInterval = null;
    state.breathingTimeout = null;
    el.breathingCircle.classList.remove("animate");
    el.breathingStatus.textContent = "Da hoan thanh";
    el.breathingStatus.className = "badge safe";
    el.breathingHint.textContent = "Da ket thuc mot phien tap tho.";
    if (!state.token) {
      return;
    }
    try {
      const response = await api("/api/breathing", {
        method: "POST",
        body: JSON.stringify({
          token: state.token,
          payload: {
            durationSeconds: BREATHING_SECONDS,
            cycles: Math.floor(BREATHING_SECONDS / 14),
          },
        }),
      });
      renderDashboard(response.dashboard);
    } catch (error) {
      setAuthState(error.message, "error");
    }
  }, BREATHING_SECONDS * 1000);
}

function handleEmergencyCall() {
  if (isMobile()) {
    window.location.href = "tel:115";
    return;
  }
  showModal("Goi 115", "Tren web desktop khong the goi truc tiep. Vui long su dung dien thoai de goi 115 ngay.");
}

function bindPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    el.installBtn.hidden = false;
  });

  el.installBtn.addEventListener("click", async () => {
    if (!state.deferredPrompt) {
      return;
    }
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    el.installBtn.hidden = true;
  });
}

function bindEvents() {
  el.requestNotificationBtn.addEventListener("click", requestNotifications);
  el.registerForm.addEventListener("submit", handleRegister);
  el.loginForm.addEventListener("submit", handleLogin);
  el.logoutBtn.addEventListener("click", logout);
  el.guardianForm.addEventListener("submit", saveGuardian);
  el.recordBaselineBtn.addEventListener("click", recordBaseline);
  el.refreshDashboardBtn.addEventListener("click", loadDashboard);
  el.startCameraBtn.addEventListener("click", startCamera);
  el.stopCameraBtn.addEventListener("click", stopCamera);
  el.startMeasureBtn.addEventListener("click", runMeasurement);
  el.startBreathingBtn.addEventListener("click", startBreathingCoach);
  el.cancelSosBtn.addEventListener("click", cancelSos);
  el.triggerSosBtn.addEventListener("click", () => triggerSos("Nguoi dung kich hoat thu cong"));
  el.callEmergencyBtn.addEventListener("click", handleEmergencyCall);
  el.symptomForm.addEventListener("submit", saveSymptom);
  el.reminderForm.addEventListener("submit", saveReminder);
  el.labelImageInput.addEventListener("change", hydrateMedicineNameFromFile);
  el.cameraSelect.addEventListener("change", (event) => {
    state.selectedCameraId = event.target.value;
  });

  document.querySelectorAll(".segmented-btn").forEach((button) => {
    button.addEventListener("click", () => setMeasurementMode(button.dataset.mode));
  });

  document.querySelectorAll(".abnormal-btn").forEach((button) => {
    button.addEventListener("click", () => saveAbnormalReason(button.dataset.abnormalReason));
  });

  el.modalConfirmBtn.addEventListener("click", () => {
    if (state.modalConfirm) {
      state.modalConfirm();
    }
    closeModal();
  });
  el.modalCancelBtn.addEventListener("click", closeModal);
  el.modalOverlay.addEventListener("click", (event) => {
    if (event.target === el.modalOverlay) {
      closeModal();
    }
  });
}

async function init() {
  detectPlatform();
  renderQrFallback();
  bindPwa();
  bindEvents();
  setMeasurementMode("face");
  await checkHealth();
  await loadCameraDevices();
  await restoreSession();
}

init();
