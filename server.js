const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const RESEND_API_BASE_URL = process.env.RESEND_API_BASE_URL || "https://api.resend.com/emails";
const OPENWEATHER_CURRENT_URL =
  process.env.OPENWEATHER_CURRENT_URL || "https://api.openweathermap.org/data/2.5/weather";
const WEATHER_DEFAULT_QUERY = process.env.WEATHER_DEFAULT_QUERY || "Ha Noi,VN";
const EMAIL_FROM = process.env.EMAIL_FROM || "HEARTSENSE <onboarding@resend.dev>";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const DATA_FILES = {
  users: path.join(DATA_DIR, "users.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  measurements: path.join(DATA_DIR, "screenings.json"),
  ledger: path.join(DATA_DIR, "ledger.json"),
  sync: path.join(DATA_DIR, "federated.json"),
  reminders: path.join(DATA_DIR, "reminders.json"),
  symptoms: path.join(DATA_DIR, "symptoms.json"),
  sos: path.join(DATA_DIR, "sos.json"),
};

const DEFAULTS = {
  users: [],
  sessions: [],
  measurements: [],
  ledger: [],
  sync: {
    version: 3,
    totalEvents: 0,
    lastUpdatedAt: null,
    activeUsers: 0,
  },
  reminders: [],
  symptoms: [],
  sos: [],
};

function cloneDefault(key) {
  return JSON.parse(JSON.stringify(DEFAULTS[key]));
}

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  Object.entries(DATA_FILES).forEach(([key, filePath]) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(cloneDefault(key), null, 2));
      return;
    }

    try {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      fs.writeFileSync(filePath, JSON.stringify(cloneDefault(key), null, 2));
    }
  });
}

function readJson(key) {
  try {
    const value = JSON.parse(fs.readFileSync(DATA_FILES[key], "utf8"));
    if (Array.isArray(DEFAULTS[key])) {
      return Array.isArray(value) ? value : cloneDefault(key);
    }

    if (key === "sync") {
      return {
        ...cloneDefault("sync"),
        ...(value && typeof value === "object" ? value : {}),
        totalEvents: Number(value?.totalEvents || 0),
        activeUsers: Number(value?.activeUsers || 0),
      };
    }

    return value && typeof value === "object" ? { ...cloneDefault(key), ...value } : cloneDefault(key);
  } catch (error) {
    return cloneDefault(key);
  }
}

function writeJson(key, value) {
  fs.writeFileSync(DATA_FILES[key], JSON.stringify(value, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function requestJson(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const request = https.request(
      target,
      {
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (response) => {
        let buffer = "";
        response.on("data", (chunk) => {
          buffer += chunk.toString();
        });
        response.on("end", () => {
          const parsed = buffer ? JSON.parse(buffer) : {};
          if (response.statusCode >= 400) {
            reject(new Error(parsed.message || parsed.error || `HTTP ${response.statusCode}`));
            return;
          }
          resolve(parsed);
        });
      },
    );

    request.on("error", reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function parseConditions(conditions) {
  if (Array.isArray(conditions)) {
    return conditions.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(conditions || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) {
    return false;
  }
  const hash = crypto.scryptSync(password, record.salt, 64).toString("hex");
  return hash === record.hash;
}

function summarizeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    age: user.age,
    gender: user.gender,
    conditions: user.conditions || [],
    guardian: user.guardian || {},
    baseline: user.baseline || { sessions: [], complete: false },
    createdAt: user.createdAt,
  };
}

function getSessionFromRequest(urlObject, body = {}) {
  const token = body.token || urlObject.searchParams.get("token");
  if (!token) {
    return null;
  }
  const sessions = readJson("sessions");
  return sessions.find((item) => item.token === token) || null;
}

function getUserBySession(session) {
  if (!session) {
    return null;
  }
  const users = readJson("users");
  return users.find((item) => item.id === session.userId) || null;
}

function updateSyncStats() {
  const ledger = readJson("ledger");
  const sync = readJson("sync");
  sync.totalEvents = ledger.length;
  sync.lastUpdatedAt = ledger.length ? ledger[ledger.length - 1].createdAt : null;
  sync.activeUsers = new Set(ledger.map((item) => item.userId)).size;
  writeJson("sync", sync);
  return sync;
}

function appendLedgerEntry(userId, type, summary, detail = {}) {
  const ledger = readJson("ledger");
  const previousHash = ledger.length ? ledger[ledger.length - 1].hash : "GENESIS";
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify({ userId, type, summary, detail, previousHash, createdAt });
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  const entry = {
    id: crypto.randomUUID(),
    userId,
    type,
    summary,
    detail,
    createdAt,
    previousHash,
    hash,
  };
  ledger.push(entry);
  writeJson("ledger", ledger);
  updateSyncStats();
  return entry;
}

function getProviderStatus() {
  return {
    email: Boolean(process.env.RESEND_API_KEY),
    weather: Boolean(process.env.OPENWEATHER_API_KEY),
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID),
    push: Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY),
  };
}

async function sendResendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !to) {
    return {
      sent: false,
      provider: "resend",
      reason: !process.env.RESEND_API_KEY ? "missing_resend_api_key" : "missing_recipient",
    };
  }

  const payload = JSON.stringify({
    from: EMAIL_FROM,
    to: [to],
    subject,
    html,
  });

  const response = await requestJson(RESEND_API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Length": Buffer.byteLength(payload),
    },
    body: payload,
  });

  return {
    sent: true,
    provider: "resend",
    id: response.id || null,
  };
}

async function fetchOpenWeather(query) {
  if (!process.env.OPENWEATHER_API_KEY) {
    return null;
  }

  const url = `${OPENWEATHER_CURRENT_URL}?q=${encodeURIComponent(query)}&appid=${encodeURIComponent(
    process.env.OPENWEATHER_API_KEY,
  )}&units=metric&lang=vi`;
  return requestJson(url);
}

function pseudoWeather(user) {
  const ageSeed = Number(user.age || 60);
  const daySeed = new Date().getDate();
  const currentTemp = 28 + ((ageSeed + daySeed) % 5);
  const nextTemp = currentTemp - ((daySeed % 4) + 2);
  const delta = currentTemp - nextTemp;

  return {
    currentTemp,
    nextTemp,
    delta,
    level: delta > 5 ? "warn" : "safe",
    text:
      delta > 5
        ? `Nhiet do mo phong co the giam ${delta}°C trong 24h toi. Nguoi cao tuoi nen giu am, tranh ra ngoai som khuya.`
        : "Moi truong hom nay on dinh, chua co canh bao giam nhiet do dot ngot.",
  };
}

async function getWeatherAlert(user) {
  const locationQuery = user.weatherQuery || WEATHER_DEFAULT_QUERY;
  try {
    const current = await fetchOpenWeather(locationQuery);
    if (!current || !current.main) {
      return pseudoWeather(user);
    }

    const currentTemp = Number(current.main.temp ?? 0);
    const nextTemp = currentTemp - 3;
    const delta = currentTemp - nextTemp;
    return {
      source: "openweather",
      location: current.name || locationQuery,
      currentTemp: Math.round(currentTemp),
      nextTemp: Math.round(nextTemp),
      delta,
      level: delta > 5 ? "warn" : "safe",
      text:
        delta > 5
          ? `Canh bao thoi tiet that cho ${current.name || locationQuery}: nhiet do co the giam tren 5°C, hay giu am va tranh ra ngoai som khuya.`
          : `Thoi tiet hien tai tai ${current.name || locationQuery}: ${current.weather?.[0]?.description || "on dinh"}, ${Math.round(
              currentTemp,
            )}°C.`,
    };
  } catch (error) {
    return {
      ...pseudoWeather(user),
      source: "fallback",
      location: locationQuery,
      error: error.message,
    };
  }
}

function generateRecommendations(classification, extras = {}) {
  const recommendations = [];
  if (classification === "normal") {
    recommendations.push("Nhip dang on dinh. Tiep tuc duy tri lich do va breathing coach.");
  }
  if (classification === "elevated") {
    recommendations.push("Can theo doi. Nen nghi ngo 5 phut va do lai trong dieu kien yen tinh hon.");
    recommendations.push("Neu ban vua uong ca phe, stress hoac vua van dong, hay luu ly do vao nhat ky.");
  }
  if (classification === "afib") {
    recommendations.push("Canh bao bat thuong nghiem trong. Neu co choang vang, kho tho, met lu, yeu tay chan hoac noi lap bap, can lien he cap cuu.");
  }
  if (extras.signalQuality < 60) {
    recommendations.push("Chat luong tin hieu chua cao, ket qua nay nen duoc xem la canh bao som va tham khao.");
  }
  if (!extras.baselineComplete) {
    recommendations.push("Nen hoan thanh 3 lan baseline Heart-Print de he thong so sanh ca nhan chinh xac hon.");
  }
  return recommendations;
}

function analyzeMeasurement({ user, type, payload }) {
  const baseline = user.baseline || { sessions: [] };
  const conditions = (user.conditions || []).join(" ").toLowerCase();
  const age = Number(user.age || 60);
  const systolic = clamp(90, Number(payload.systolic || 128), 220);
  const signalQuality = clamp(18, Math.round(Number(payload.signalQuality || 60)), 99);
  const lightScore = clamp(18, Math.round(Number(payload.lightScore || 64)), 99);
  const stabilityScore = clamp(18, Math.round(Number(payload.stabilityScore || 61)), 99);
  const estimatedBpm = clamp(42, Math.round(Number(payload.estimatedBpm || payload.bpm || 72)), 150);
  const irregularityIndex = clamp(0, Math.round(Number(payload.irregularityIndex || 24)), 100);
  const hrvScore = clamp(10, Math.round(Number(payload.hrvScore || 42)), 96);
  const contextNote = String(payload.contextNote || "").trim();
  const waveform = Array.isArray(payload.waveform) ? payload.waveform.slice(0, 120) : [];

  const riskFromConditions =
    (conditions.includes("cao huyet ap") ? 16 : 0) +
    (conditions.includes("tieu duong") ? 11 : 0) +
    (conditions.includes("dot quy") ? 20 : 0) +
    (conditions.includes("afib") ? 22 : 0);
  const ageRisk = Math.max(0, age - 45) * 0.72;
  const systolicRisk = Math.max(0, systolic - 120) * 0.42;
  const rhythmRisk = irregularityIndex * 0.64 + Math.max(0, estimatedBpm - 95) * 0.58 + Math.max(0, 54 - estimatedBpm) * 0.9;
  const qualityPenalty = Math.max(0, 65 - signalQuality) * 0.36;
  const baselineBpm = Number(baseline.restingBpm || 72);
  const baselineHrv = Number(baseline.hrvScore || 42);
  const bpmDelta = Math.abs(estimatedBpm - baselineBpm);
  const hrvDelta = baseline.complete ? Math.abs(hrvScore - baselineHrv) : 0;
  const contextPenalty = /(stress|ca phe|coffee|met|mat ngu)/i.test(contextNote) ? 4 : 0;

  const strokeRiskScore = Math.round(
    clamp(
      8,
      riskFromConditions +
        ageRisk +
        systolicRisk +
        rhythmRisk +
        qualityPenalty +
        bpmDelta * 0.44 +
        hrvDelta * 0.36 +
        contextPenalty +
        (type === "face" ? 3 : -2),
      99,
    ),
  );

  let classification = "normal";
  if ((irregularityIndex >= 58 && signalQuality >= 52) || strokeRiskScore >= 76) {
    classification = "afib";
  } else if (strokeRiskScore >= 42 || estimatedBpm < 52 || estimatedBpm > 110 || systolic >= 145) {
    classification = "elevated";
  }
  if (classification === "normal" && signalQuality < 45) {
    classification = "elevated";
  }

  const confidence = Math.round(clamp(40, signalQuality * 0.56 + lightScore * 0.2 + stabilityScore * 0.24, 97));
  const baselineStatus = baseline.complete
    ? `Lech ${bpmDelta} BPM va ${hrvDelta} diem HRV so voi baseline`
    : "Chua hoan thanh 3 lan baseline Heart-Print";
  const recommendation = generateRecommendations(classification, {
    signalQuality,
    baselineComplete: baseline.complete,
  });

  return {
    type,
    bpm: estimatedBpm,
    hrvScore,
    strokeRiskScore,
    irregularityIndex,
    lightScore,
    stabilityScore,
    signalQuality,
    systolic,
    confidence,
    classification,
    baselineStatus,
    contextNote,
    recommendation,
    waveform,
    shouldTriggerSos: classification === "afib",
    generatedAt: new Date().toISOString(),
  };
}

function buildWeeklyReport(userId) {
  const measurements = readJson("measurements")
    .filter((item) => item.userId === userId && (item.type === "face" || item.type === "finger"))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const lastSevenDays = measurements.filter(
    (item) => Date.now() - new Date(item.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000,
  );

  if (!lastSevenDays.length) {
    return {
      summary: "Tuan nay chua co du lieu do tim.",
      averageBpm: null,
      averageRisk: null,
      afibAlerts: 0,
      totalMeasurements: 0,
      chartPoints: [],
    };
  }

  return {
    summary: `Tuan nay co ${lastSevenDays.length} phien do. Nen giu lich do cung khung gio moi sang hoac khi nghi ngo.`,
    averageBpm: Math.round(average(lastSevenDays.map((item) => item.result.bpm || 0))),
    averageRisk: Math.round(average(lastSevenDays.map((item) => item.result.strokeRiskScore || 0))),
    afibAlerts: lastSevenDays.filter((item) => item.result.classification === "afib").length,
    totalMeasurements: lastSevenDays.length,
    chartPoints: lastSevenDays.map((item) => ({
      date: item.createdAt,
      bpm: item.result.bpm,
      risk: item.result.strokeRiskScore,
    })),
  };
}

async function buildDashboard(userId) {
  const users = readJson("users");
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return null;
  }

  const measurements = readJson("measurements")
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const symptoms = readJson("symptoms")
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const reminders = readJson("reminders")
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const sosEvents = readJson("sos")
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const ledger = readJson("ledger")
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

  const latestMeasurement =
    measurements
      .filter((item) => item.type === "face" || item.type === "finger")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const latestBreathing =
    measurements
      .filter((item) => item.type === "breathing")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;

  return {
    user: summarizeUser(user),
    measurements: measurements.slice(-8),
    latestMeasurement,
    latestBreathing,
    symptoms: symptoms.slice(0, 8),
    reminders: reminders.slice(0, 8),
    sosEvents: sosEvents.slice(0, 8),
    ledger,
    weeklyReport: buildWeeklyReport(userId),
    weatherAlert: await getWeatherAlert(user),
    sync: readJson("sync"),
  };
}

function buildPrintableReport(dashboard) {
  const { user, latestMeasurement, weeklyReport, reminders, symptoms, sosEvents } = dashboard;
  const chartRows = weeklyReport.chartPoints
    .map(
      (point) => `
      <tr>
        <td>${new Date(point.date).toLocaleDateString("vi-VN")}</td>
        <td>${point.bpm}</td>
        <td>${point.risk}%</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>HEARTSENSE Weekly Report</title>
    <style>
      body { font-family: Arial, sans-serif; color: #18314d; margin: 36px; }
      .card { border: 1px solid #d1dde8; border-radius: 14px; padding: 18px; margin-bottom: 16px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      h1, h2 { margin-bottom: 8px; }
      p { line-height: 1.5; }
      ul { margin: 0; padding-left: 18px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border-bottom: 1px solid #e1e8ef; padding: 8px; text-align: left; }
    </style>
  </head>
  <body>
    <h1>HEARTSENSE Report</h1>
    <p>Ban co the in trang nay thanh PDF de mang di kham.</p>
    <div class="card">
      <h2>Thong tin nguoi dung</h2>
      <p><strong>Ho ten:</strong> ${user.fullName}</p>
      <p><strong>Email:</strong> ${user.email}</p>
      <p><strong>Tuoi:</strong> ${user.age}</p>
      <p><strong>Benh ly nen:</strong> ${(user.conditions || []).join(", ") || "Chua khai bao"}</p>
    </div>
    <div class="card">
      <h2>Ket qua moi nhat</h2>
      ${
        latestMeasurement
          ? `<div class="grid">
              <p><strong>Loai:</strong> ${latestMeasurement.type}</p>
              <p><strong>BPM:</strong> ${latestMeasurement.result.bpm}</p>
              <p><strong>HRV:</strong> ${latestMeasurement.result.hrvScore}</p>
              <p><strong>Stroke risk:</strong> ${latestMeasurement.result.strokeRiskScore}%</p>
              <p><strong>AFib index:</strong> ${latestMeasurement.result.irregularityIndex}</p>
              <p><strong>Huyet ap tam thu:</strong> ${latestMeasurement.result.systolic}</p>
            </div>
            <p><strong>Phan loai:</strong> ${latestMeasurement.result.classification}</p>
            <p><strong>Baseline:</strong> ${latestMeasurement.result.baselineStatus}</p>
            <p><strong>Khuyen nghi:</strong> ${latestMeasurement.result.recommendation.join(" ")}</p>`
          : "<p>Chua co du lieu do.</p>"
      }
    </div>
    <div class="card">
      <h2>Bao cao tuan</h2>
      <p>${weeklyReport.summary}</p>
      <p><strong>So phien do:</strong> ${weeklyReport.totalMeasurements}</p>
      <p><strong>Trung binh BPM:</strong> ${weeklyReport.averageBpm ?? "--"}</p>
      <p><strong>Trung binh nguy co:</strong> ${weeklyReport.averageRisk ?? "--"}%</p>
      <p><strong>So canh bao AFib:</strong> ${weeklyReport.afibAlerts}</p>
      <table>
        <thead>
          <tr><th>Ngay</th><th>BPM</th><th>Risk</th></tr>
        </thead>
        <tbody>
          ${chartRows || "<tr><td colspan='3'>Chua co du lieu</td></tr>"}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>Nhac thuoc & nhat ky</h2>
      <ul>
        ${reminders.map((item) => `<li>${item.medicineName} luc ${item.time}</li>`).join("") || "<li>Chua co lich nhac.</li>"}
      </ul>
      <ul style="margin-top: 12px;">
        ${symptoms.map((item) => `<li>${item.note}</li>`).join("") || "<li>Chua co nhat ky trieu chung.</li>"}
      </ul>
    </div>
    <div class="card">
      <h2>SOS</h2>
      <ul>
        ${sosEvents.map((item) => `<li>${item.status} - ${item.reason}</li>`).join("") || "<li>Chua co su kien SOS.</li>"}
      </ul>
    </div>
  </body>
</html>`;
}

function handleRegister(body, res) {
  const users = readJson("users");
  const existing = users.find((item) => item.email === body.email);
  if (existing) {
    sendJson(res, 409, { error: "Email da ton tai." });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    fullName: body.fullName || "Nguoi dung HEARTSENSE",
    email: body.email || "",
    age: Number(body.age || 60),
    gender: body.gender || "other",
    conditions: parseConditions(body.conditions),
    guardian: {
      guardianName: "",
      guardianPhone: "",
      guardianEmail: "",
      status: "not_configured",
      channels: [],
    },
    weatherQuery: WEATHER_DEFAULT_QUERY,
    baseline: {
      sessions: [],
      restingBpm: null,
      hrvScore: null,
      regularityScore: null,
      complete: false,
    },
    password: hashPassword(body.password || ""),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeJson("users", users);

  const sessions = readJson("sessions");
  const token = crypto.randomBytes(24).toString("hex");
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  writeJson("sessions", sessions);

  appendLedgerEntry(user.id, "auth.register", "Khoi tao tai khoan HEARTSENSE", {
    email: user.email,
  });
  sendJson(res, 201, { token, user: summarizeUser(user) });
}

function handleLogin(body, res) {
  const users = readJson("users");
  const user = users.find((item) => item.email === body.email);
  if (!user || !verifyPassword(body.password || "", user.password)) {
    sendJson(res, 401, { error: "Thong tin dang nhap khong dung." });
    return;
  }

  const sessions = readJson("sessions");
  const token = crypto.randomBytes(24).toString("hex");
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  writeJson("sessions", sessions);

  appendLedgerEntry(user.id, "auth.login", "Dang nhap thanh cong");
  sendJson(res, 200, { token, user: summarizeUser(user) });
}

function handleSession(urlObject, res) {
  const session = getSessionFromRequest(urlObject);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Session khong hop le." });
    return;
  }
  sendJson(res, 200, { user: summarizeUser(user) });
}

function handleGuardian(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const users = readJson("users");
  const user = users.find((item) => item.id === session?.userId);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de cap nhat guardian." });
    return;
  }

  const guardianPhone = String(body.guardianPhone || "").trim();
  const guardianEmail = String(body.guardianEmail || "").trim();
  user.guardian = {
    guardianName: String(body.guardianName || "").trim(),
    guardianPhone,
    guardianEmail,
    status: guardianPhone || guardianEmail ? "confirmation_sent" : "not_configured",
    channels: [guardianPhone ? "sms" : null, guardianEmail ? "email" : null, guardianPhone ? "zalo" : null].filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  writeJson("users", users);

  appendLedgerEntry(user.id, "guardian.update", "Cap nhat guardian", user.guardian);
  sendJson(res, 200, {
    guardian: user.guardian,
    messages: [
      guardianPhone ? `SMS/Zalo xac nhan da duoc tao cho ${guardianPhone}.` : null,
      guardianEmail ? `Email xac nhan da duoc tao cho ${guardianEmail}.` : null,
    ].filter(Boolean),
  });
}

async function handleCreateMeasurement(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu phien do." });
    return;
  }

  const type = body.type === "finger" ? "finger" : "face";
  const result = analyzeMeasurement({ user, type, payload: body.payload || {} });
  const measurements = readJson("measurements");
  const record = {
    id: crypto.randomUUID(),
    userId: user.id,
    type,
    payload: body.payload || {},
    result,
    notes: [],
    createdAt: new Date().toISOString(),
  };

  measurements.push(record);
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "measurement.created", `Luu phien do ${type}`, {
    classification: result.classification,
    strokeRiskScore: result.strokeRiskScore,
  });

  sendJson(res, 201, { measurement: record, dashboard: await buildDashboard(user.id) });
}

async function handleMeasurementContext(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu nguyen nhan." });
    return;
  }

  const measurements = readJson("measurements");
  const record = measurements.find((item) => item.id === body.measurementId && item.userId === user.id);
  if (!record) {
    sendJson(res, 404, { error: "Khong tim thay phien do." });
    return;
  }

  const note = {
    reason: String(body.reason || "none"),
    createdAt: new Date().toISOString(),
  };
  record.notes = Array.isArray(record.notes) ? record.notes : [];
  record.notes.push(note);
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "measurement.context", "Luu ly do bat thuong nhe", note);

  const symptoms = readJson("symptoms");
  symptoms.push({
    id: crypto.randomUUID(),
    userId: user.id,
    note: `Measurement note: ${note.reason}`,
    createdAt: new Date().toISOString(),
  });
  writeJson("symptoms", symptoms);

  sendJson(res, 200, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleRecordBaseline(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const users = readJson("users");
  const user = users.find((item) => item.id === session?.userId);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu baseline." });
    return;
  }

  const latest = readJson("measurements")
    .filter((item) => item.userId === user.id && (item.type === "face" || item.type === "finger"))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-1)[0];

  if (!latest) {
    sendJson(res, 400, { error: "Can co it nhat mot phien do truoc khi ghi baseline." });
    return;
  }

  const sessions = Array.isArray(user.baseline?.sessions) ? user.baseline.sessions.slice(-2) : [];
  const baselineSession = {
    measurementId: latest.id,
    bpm: latest.result.bpm,
    hrvScore: latest.result.hrvScore,
    irregularityIndex: latest.result.irregularityIndex,
    createdAt: new Date().toISOString(),
  };
  sessions.push(baselineSession);
  user.baseline = {
    sessions,
    restingBpm: sessions.length >= 3 ? Math.round(average(sessions.map((item) => item.bpm))) : null,
    hrvScore: sessions.length >= 3 ? Math.round(average(sessions.map((item) => item.hrvScore))) : null,
    regularityScore: sessions.length >= 3 ? 100 - Math.round(average(sessions.map((item) => item.irregularityIndex))) : null,
    complete: sessions.length >= 3,
    updatedAt: new Date().toISOString(),
  };
  writeJson("users", users);
  appendLedgerEntry(user.id, "baseline.recorded", "Luu mot lan Heart-Print baseline", {
    count: sessions.length,
  });

  sendJson(res, 200, { baseline: user.baseline, dashboard: await buildDashboard(user.id) });
}

async function handleCreateBreathing(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu breathing session." });
    return;
  }

  const durationSeconds = clamp(30, Number(body.payload?.durationSeconds || 60), 600);
  const cycles = clamp(1, Number(body.payload?.cycles || 4), 60);
  const coherenceGain = clamp(4, Math.round(durationSeconds / 12 + cycles * 2), 38);

  const measurements = readJson("measurements");
  measurements.push({
    id: crypto.randomUUID(),
    userId: user.id,
    type: "breathing",
    payload: body.payload || {},
    result: {
      durationSeconds,
      cycles,
      coherenceGain,
      recommendation: "Duy tri 1-2 lan/ngay de giam cang thang va cai thien nhip deu tam thoi.",
    },
    createdAt: new Date().toISOString(),
  });
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "breathing.completed", "Hoan thanh breathing coach", {
    durationSeconds,
    cycles,
  });

  sendJson(res, 201, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleSymptom(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu nhat ky." });
    return;
  }

  const symptoms = readJson("symptoms");
  symptoms.push({
    id: crypto.randomUUID(),
    userId: user.id,
    note: String(body.note || "").trim(),
    createdAt: new Date().toISOString(),
  });
  writeJson("symptoms", symptoms);
  appendLedgerEntry(user.id, "symptom.created", "Them nhat ky trieu chung", {
    note: String(body.note || "").trim(),
  });
  sendJson(res, 201, { ok: true, dashboard: await buildDashboard(user.id) });
}

function inferMedicineName(body) {
  const raw = String(body.sourceImageName || body.medicineName || "").trim();
  return raw
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

async function handleReminder(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de tao nhac thuoc." });
    return;
  }

  const reminders = readJson("reminders");
  reminders.push({
    id: crypto.randomUUID(),
    userId: user.id,
    medicineName: inferMedicineName(body) || "Thuoc khong ro ten",
    time: body.time || "08:00",
    sourceImageName: body.sourceImageName || "",
    channel: body.channel || "email-notification",
    createdAt: new Date().toISOString(),
  });
  writeJson("reminders", reminders);
  appendLedgerEntry(user.id, "reminder.created", "Tao lich nhac thuoc", {
    medicineName: inferMedicineName(body),
    time: body.time || "08:00",
  });
  sendJson(res, 201, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleTriggerSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de kich hoat SOS." });
    return;
  }

  const guardian = user.guardian || {};
  const channelSet = new Set();
  if (guardian.guardianPhone) {
    channelSet.add("sms");
    channelSet.add("zalo");
  }
  if (guardian.guardianEmail) {
    channelSet.add("email");
  }
  channelSet.add("web-notification");

  const sosEvents = readJson("sos");
  const emailResult = await sendResendEmail({
    to: guardian.guardianEmail,
    subject: "HEARTSENSE SOS Alert",
    html: `
      <h2>HEARTSENSE SOS</h2>
      <p>Phat hien canh bao tim mach bat thuong.</p>
      <p><strong>Nguoi dung:</strong> ${user.fullName}</p>
      <p><strong>Ly do:</strong> ${body.reason || "Canh bao AFib / nguy co cao"}</p>
      <p><strong>Thoi gian:</strong> ${new Date().toLocaleString("vi-VN")}</p>
      <p>Vui long lien he nguoi dung va ho tro goi cap cuu neu can.</p>
    `,
  });
  const record = {
    id: crypto.randomUUID(),
    userId: user.id,
    reason: body.reason || "Canh bao AFib / nguy co cao",
    status: "triggered",
    channels: [...channelSet],
    delivery: {
      email: emailResult,
    },
    createdAt: new Date().toISOString(),
  };
  sosEvents.push(record);
  writeJson("sos", sosEvents);
  appendLedgerEntry(user.id, "sos.triggered", "Kich hoat hanh lang xanh", record);

  sendJson(res, 201, {
    sos: record,
    messages: [
      guardian.guardianPhone ? `Da tao SMS cho ${guardian.guardianPhone}.` : "Chua co so guardian de gui SMS.",
      guardian.guardianPhone ? `Da tao thong diep Zalo cho ${guardian.guardianPhone}.` : "Chua co so guardian de gui Zalo.",
      guardian.guardianEmail
        ? emailResult.sent
          ? `Da gui email that qua Resend den ${guardian.guardianEmail}.`
          : `Chua gui duoc email that (${emailResult.reason || "unknown"}).`
        : "Chua co email guardian de gui.",
      "Thong bao web da duoc tao cho phien hien tai.",
    ],
    dashboard: await buildDashboard(user.id),
  });
}

async function handleCancelSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de huy SOS." });
    return;
  }

  const sosEvents = readJson("sos");
  const latest = [...sosEvents].reverse().find((item) => item.userId === user.id && item.status === "triggered");
  if (latest) {
    latest.status = "cancelled";
    latest.cancelledAt = new Date().toISOString();
    writeJson("sos", sosEvents);
  }
  appendLedgerEntry(user.id, "sos.cancelled", "Nguoi dung xac nhan toi on");
  sendJson(res, 200, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleDashboard(urlObject, res, userId) {
  const session = getSessionFromRequest(urlObject);
  if (!session || session.userId !== userId) {
    sendJson(res, 401, { error: "Khong du quyen xem dashboard." });
    return;
  }
  const dashboard = await buildDashboard(userId);
  if (!dashboard) {
    sendJson(res, 404, { error: "Khong tim thay nguoi dung." });
    return;
  }
  sendJson(res, 200, dashboard);
}

async function handleReport(urlObject, res, userId) {
  const session = getSessionFromRequest(urlObject);
  if (!session || session.userId !== userId) {
    sendText(res, 401, "Unauthorized");
    return;
  }
  const dashboard = await buildDashboard(userId);
  if (!dashboard) {
    sendText(res, 404, "Not found");
    return;
  }
  sendText(res, 200, buildPrintableReport(dashboard), "text/html; charset=utf-8");
}

function serveStatic(urlObject, res) {
  const requestPath = urlObject.pathname === "/" ? "/index.html" : urlObject.pathname;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    sendText(res, 200, data, MIME_TYPES[ext] || "application/octet-stream");
  });
}

async function handleRequest(req, res) {
  const urlObject = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && urlObject.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      name: "HEARTSENSE",
      version: "3.0.0",
      timestamp: new Date().toISOString(),
      integrations: getProviderStatus(),
      emailProvider: "Resend",
      weatherProvider: "OpenWeather",
      emailApiBaseUrl: RESEND_API_BASE_URL,
      weatherApiBaseUrl: OPENWEATHER_CURRENT_URL,
    });
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/auth/register") {
    handleRegister(await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/auth/login") {
    handleLogin(await parseBody(req), res);
    return;
  }

  if (req.method === "GET" && urlObject.pathname === "/api/session") {
    handleSession(urlObject, res);
    return;
  }

  if (req.method === "PUT" && urlObject.pathname === "/api/guardian") {
    handleGuardian(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/measurements") {
    await handleCreateMeasurement(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/measurements/context") {
    await handleMeasurementContext(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/baseline") {
    await handleRecordBaseline(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/breathing") {
    await handleCreateBreathing(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/symptoms") {
    await handleSymptom(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/reminders") {
    await handleReminder(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/sos/trigger") {
    await handleTriggerSos(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/sos/cancel") {
    await handleCancelSos(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "GET" && urlObject.pathname.startsWith("/api/users/") && urlObject.pathname.endsWith("/dashboard")) {
    await handleDashboard(urlObject, res, urlObject.pathname.split("/")[3]);
    return;
  }

  if (req.method === "GET" && urlObject.pathname.startsWith("/api/users/") && urlObject.pathname.endsWith("/report")) {
    await handleReport(urlObject, res, urlObject.pathname.split("/")[3]);
    return;
  }

  serveStatic(urlObject, res);
}

ensureDataStore();
updateSyncStats();

http
  .createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, { error: "Server error", detail: error.message });
    });
  })
  .listen(PORT, () => {
    console.log(`HEARTSENSE running at http://localhost:${PORT}`);
  });
