const HEARTSENSE_TOKEN_KEY = "heartsense_token";
const MEASUREMENT_SECONDS = 60;
const BREATHING_SECONDS = 60;

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
  lastPreviewMetrics: null,
  lastMeasurementRecord: null,
  previousSample: null,
  sosTimer: null,
  sosRemaining: 15,
  breathingInterval: null,
  breathingTimeout: null,
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
  lightMetric: document.querySelector("#lightMetric"),
  stabilityMetric: document.querySelector("#stabilityMetric"),
  qualityMetric: document.querySelector("#qualityMetric"),
  captureModeLabel: document.querySelector("#captureModeLabel"),
  modeDescription: document.querySelector("#modeDescription"),
  captureGuide: document.querySelector("#captureGuide"),
  startCameraBtn: document.querySelector("#startCameraBtn"),
  stopCameraBtn: document.querySelector("#stopCameraBtn"),
  startMeasureBtn: document.querySelector("#startMeasureBtn"),
  startBreathingBtn: document.querySelector("#startBreathingBtn"),
  breathingCircle: document.querySelector("#breathingCircle"),
  breathingPhase: document.querySelector("#breathingPhase"),
  breathingStatus: document.querySelector("#breathingStatus"),
  breathingHint: document.querySelector("#breathingHint"),
  wavePath: document.querySelector("#wavePath"),
  riskBadge: document.querySelector("#riskBadge"),
  bpmResult: document.querySelector("#bpmResult"),
  hrvResult: document.querySelector("#hrvResult"),
  strokeRiskResult: document.querySelector("#strokeRiskResult"),
  afibResult: document.querySelector("#afibResult"),
  resultHeadline: document.querySelector("#resultHeadline"),
  resultDescription: document.querySelector("#resultDescription"),
  recommendationBox: document.querySelector("#recommendationBox"),
  sosBadge: document.querySelector("#sosBadge"),
  sosBox: document.querySelector("#sosBox"),
  cancelSosBtn: document.querySelector("#cancelSosBtn"),
  triggerSosBtn: document.querySelector("#triggerSosBtn"),
  symptomForm: document.querySelector("#symptomForm"),
  symptomList: document.querySelector("#symptomList"),
  reminderForm: document.querySelector("#reminderForm"),
  labelImageInput: document.querySelector("#labelImageInput"),
  medicineNameInput: document.querySelector("#medicineNameInput"),
  reminderList: document.querySelector("#reminderList"),
  weeklyReportBox: document.querySelector("#weeklyReportBox"),
  weatherBox: document.querySelector("#weatherBox"),
  historyChart: document.querySelector("#historyChart"),
  sosHistory: document.querySelector("#sosHistory"),
  ledgerList: document.querySelector("#ledgerList"),
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

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString("vi-VN");
}

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function setAuthState(message, kind = "neutral") {
  el.authState.textContent = message;
  el.authState.className = `state-pill ${kind === "error" ? "badge danger" : "state-pill"}`;
}

function setReportLink() {
  if (!state.user || !state.token) {
    el.reportLink.classList.add("disabled");
    el.reportLink.href = "#";
    return;
  }

  el.reportLink.href = `/api/users/${state.user.id}/report?token=${encodeURIComponent(state.token)}`;
  el.reportLink.classList.remove("disabled");
}

function detectPlatform() {
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile = /android|iphone|ipad|mobile/.test(userAgent);
  const hasCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  if (isMobile) {
    el.platformBadge.textContent = "Mobile/PWA duoc uu tien";
    el.platformBadge.className = "badge warn";
    el.deviceHint.textContent = hasCamera
      ? "Mobile co the dung Face PPG ngay. Native app sau nay co the them Finger PPG + flash."
      : "Trinh duyet mobile nay chua san sang cho camera.";
    return;
  }

  el.platformBadge.textContent = "Desktop/Laptop web mode";
  el.platformBadge.className = "badge safe";
  el.deviceHint.textContent = hasCamera
    ? "Webcam san sang cho Face PPG va breathing coach."
    : "Khong tim thay webcam. Ban van co the xem lich su va dung breathing coach.";
}

async function checkHealth() {
  try {
    const data = await api("/api/health");
    el.healthStatus.textContent = `${data.name} online`;
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

function setMeasurementMode(mode) {
  state.measurementMode = mode;
  document.querySelectorAll(".segmented-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  if (mode === "face") {
    el.captureModeLabel.textContent = "Face PPG";
    el.modeDescription.textContent =
      "Do khong cham bang webcam/camera truoc. Tot nhat trong phong du sang, ngoi yen va nhin thang vao camera.";
    el.captureGuide.textContent =
      "Giữ đầu và vai ổn định trong 60 giây. Nếu ánh sáng yếu, HEARTSENSE sẽ khuyên bạn đo lại.";
  } else if (mode === "finger") {
    el.captureModeLabel.textContent = "Finger PPG demo";
    el.modeDescription.textContent =
      "Tren web tinh nang nay chi la demo. Tren mobile app sau nay co the dung camera sau + flash de chinh xac hon.";
    el.captureGuide.textContent =
      "Dat ngon tro che phan lon ong kinh. Neu khong co flash, ket qua web mang tinh trinh dien va tham khao.";
  } else {
    el.captureModeLabel.textContent = "Breathing Coach";
    el.modeDescription.textContent =
      "Che do tap tho khong can tin hieu PPG chinh xac. Phu hop ca khi may khong co webcam.";
    el.captureGuide.textContent =
      "Bat dau nhip 4-4-6. Muc tieu la giam cang thang va cai thien nhip deu tam thoi.";
  }
}

async function startCamera() {
  try {
    if (state.stream) {
      stopCamera();
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: state.measurementMode === "finger" ? { ideal: "environment" } : { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.cameraVideo.srcObject = state.stream;
    startPreviewLoop();
    setAuthState("Camera da san sang.");
  } catch (error) {
    setAuthState("Khong mo duoc camera. Hay kiem tra quyen webcam/https hoac thu thiet bi khac.", "error");
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
          y: Math.floor(canvas.height * 0.2),
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
  return {
    brightness,
    avgRed,
    avgGreen,
    avgBlue,
    movement,
  };
}

function derivePreviewMetrics(sample) {
  const lightScore = Math.round(Math.max(15, Math.min(99, 100 - Math.abs(sample.brightness - 122) * 0.9)));
  const stabilityScore = Math.round(Math.max(10, Math.min(99, 100 - sample.movement * 1.8)));
  const modeBias = state.measurementMode === "finger" ? 8 : 0;
  const signalQuality = Math.round(Math.max(18, Math.min(99, lightScore * 0.48 + stabilityScore * 0.52 + modeBias)));
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

function normalizeWave(values) {
  if (!values.length) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return values.map((value) => 25 + ((value - min) / span) * 110);
}

function analyseSamples(samples, mode) {
  const values = samples.map((item) => (mode === "finger" ? item.avgRed : item.avgGreen));
  const brightnessValues = samples.map((item) => item.brightness);
  const movementValues = samples.map((item) => item.movement);
  const avgBrightness = brightnessValues.reduce((sum, value) => sum + value, 0) / brightnessValues.length;
  const avgMovement = movementValues.reduce((sum, value) => sum + value, 0) / movementValues.length;
  const variance =
    values.reduce((sum, value) => sum + (value - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) /
    values.length;

  const lightScore = Math.round(Math.max(18, Math.min(99, 100 - Math.abs(avgBrightness - 122) * 0.85)));
  const stabilityScore = Math.round(Math.max(12, Math.min(99, 100 - avgMovement * 1.5)));
  const signalQuality = Math.round(
    Math.max(20, Math.min(99, lightScore * 0.45 + stabilityScore * 0.45 + (mode === "finger" ? 10 : 0))),
  );

  const pseudoSeed = Math.round(avgBrightness + variance + (mode === "finger" ? 7 : 13));
  const estimatedBpm = Math.round(
    Math.max(54, Math.min(118, 70 + ((pseudoSeed % 19) - 9) + (stabilityScore < 55 ? 7 : 0))),
  );
  const irregularityIndex = Math.round(
    Math.max(8, Math.min(92, 18 + Math.max(0, 65 - stabilityScore) * 0.9 + Math.sqrt(variance) * 0.65)),
  );
  const hrvScore = Math.round(
    Math.max(16, Math.min(88, 62 - Math.max(0, irregularityIndex - 22) * 0.42 + (mode === "breathing" ? 12 : 0))),
  );
  const waveform = normalizeWave(values.slice(-90));

  return {
    estimatedBpm,
    hrvScore,
    lightScore,
    stabilityScore,
    signalQuality,
    irregularityIndex,
    waveform,
  };
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

  const localResult = analyseSamples(state.measurementSamples, state.measurementMode);
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
  el.resultDescription.textContent = "Dang nhap de luu ket qua, xay baseline va mo khoa SOS/report.";
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
        ? "Nen nghi ngo va do lai trong dieu kien tot hon."
        : "Nhip tim hien tai dang trong vung on dinh.";
  el.resultDescription.textContent = `${result.baselineStatus}. Do tin cay ${result.confidence}% voi chat luong ${result.signalQuality}%.`;
  renderRecommendationBox(result.recommendation);
  buildWavePath(result.waveform || []);
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
      ? `Guardian: ${guardian.guardianName || "Da thiet lap"} - dang cho xac nhan.`
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
  if (!measurements.length) {
    el.historyChart.innerHTML = "<p class='muted'>Chua co lich su do.</p>";
    return;
  }

  el.historyChart.innerHTML = measurements
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
  const levelClass = weather.level === "warn" ? "badge warn" : "badge safe";
  el.weatherBox.innerHTML = `
    <div class="list-item">
      <span>Moi truong</span>
      <strong class="${levelClass.replace("badge ", "")}">${weather.level === "warn" ? "Canh bao" : "On dinh"}</strong>
    </div>
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

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  state.user = dashboard.user;
  setReportLink();
  renderProfile(dashboard.user);
  renderBaseline(dashboard.user.baseline);
  renderHistory(dashboard.measurements);
  renderSymptoms(dashboard.symptoms);
  renderReminders(dashboard.reminders);
  renderWeeklyReport(dashboard.weeklyReport);
  renderWeather(dashboard.weatherAlert);
  renderSosHistory(dashboard.sosEvents);
  renderLedger(dashboard.ledger);
  if (dashboard.latestMeasurement && dashboard.latestMeasurement.type !== "breathing") {
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
  } catch (error) {
    setAuthState(error.message, "error");
  }
}

function logout() {
  state.token = "";
  state.user = null;
  state.dashboard = null;
  localStorage.removeItem(HEARTSENSE_TOKEN_KEY);
  setReportLink();
  setAuthState("Da dang xuat.");
}

async function saveGuardian(event) {
  event.preventDefault();
  if (!state.token) {
    setAuthState("Can dang nhap truoc khi thiet lap guardian.", "error");
    return;
  }

  const form = new FormData(event.currentTarget);
  try {
    const response = await api("/api/guardian", {
      method: "PUT",
      body: JSON.stringify({
        token: state.token,
        ...Object.fromEntries(form.entries()),
      }),
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
      body: JSON.stringify({
        token: state.token,
        note: form.get("note"),
      }),
    });
    event.currentTarget.reset();
    renderDashboard(response.dashboard);
  } catch (error) {
    setAuthState(error.message, "error");
  }
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

  const inferred = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  el.medicineNameInput.value = inferred;
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
  notify("HEARTSENSE SOS", "Canh bao bat thuong. Ban co 15 giay de xac nhan toi on.");
  renderSosBox(`Phat hien nguy co cao. SOS se gui sau ${state.sosRemaining} giay neu ban khong huy.`, [
    `Ly do: ${reason}`,
  ]);

  state.sosTimer = setInterval(async () => {
    state.sosRemaining -= 1;
    renderSosBox(`Phat hien nguy co cao. SOS se gui sau ${state.sosRemaining} giay neu ban khong huy.`, [
      `Ly do: ${reason}`,
    ]);
    if (state.sosRemaining <= 0) {
      resetSosUi();
      await triggerSos(reason);
    }
  }, 1000);
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

async function triggerSos(reason = "Nguoi dung yeu cau kich hoat khan cap") {
  if (!state.token) {
    setAuthState("Can dang nhap de kich hoat SOS.", "error");
    return;
  }

  try {
    const response = await api("/api/sos/trigger", {
      method: "POST",
      body: JSON.stringify({
        token: state.token,
        reason,
      }),
    });
    el.sosBadge.textContent = "SOS da gui";
    el.sosBadge.className = "badge danger";
    renderSosBox("Hanh lang xanh da duoc kich hoat.", response.messages);
    notify("HEARTSENSE", "SOS da duoc kich hoat.");
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
  el.symptomForm.addEventListener("submit", saveSymptom);
  el.reminderForm.addEventListener("submit", saveReminder);
  el.labelImageInput.addEventListener("change", hydrateMedicineNameFromFile);

  document.querySelectorAll(".segmented-btn").forEach((button) => {
    button.addEventListener("click", () => setMeasurementMode(button.dataset.mode));
  });
}

async function init() {
  detectPlatform();
  bindPwa();
  bindEvents();
  setMeasurementMode("face");
  await checkHealth();
  await restoreSession();
}

init();
