const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

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

  const sync = readJson("sync");
  sync.totalEvents += 1;
  sync.lastUpdatedAt = createdAt;
  sync.activeUsers = new Set(ledger.map((item) => item.userId)).size;
  writeJson("sync", sync);

  return entry;
}

function buildWaveSeed(waveform = []) {
  if (!waveform.length) {
    return 0;
  }
  return waveform.reduce((sum, value) => sum + value, 0) / waveform.length;
}

function analyzeMeasurement({ user, type, payload }) {
  const baseline = user.baseline || { sessions: [] };
  const conditions = (user.conditions || []).join(" ").toLowerCase();
  const age = Number(user.age || 60);
  const bpm = clamp(42, Math.round(Number(payload.estimatedBpm || payload.bpm || 72)), 150);
  const hrvScore = clamp(8, Math.round(Number(payload.hrvScore || 38)), 96);
  const lightScore = clamp(20, Math.round(Number(payload.lightScore || 62)), 99);
  const stabilityScore = clamp(20, Math.round(Number(payload.stabilityScore || 60)), 99);
  const signalQuality = clamp(18, Math.round(Number(payload.signalQuality || 58)), 99);
  const irregularityIndex = clamp(0, Math.round(Number(payload.irregularityIndex || 24)), 100);
  const baselineBpm = Number(baseline.restingBpm || 72);
  const baselineHrv = Number(baseline.hrvScore || 42);
  const bpmDelta = Math.abs(bpm - baselineBpm);
  const hrvDelta = baseline.complete ? Math.abs(hrvScore - baselineHrv) : 0;
  const waveform = Array.isArray(payload.waveform) ? payload.waveform.slice(0, 120) : [];
  const waveformSeed = buildWaveSeed(waveform);

  const riskFromConditions =
    (conditions.includes("cao huyet ap") ? 16 : 0) +
    (conditions.includes("tieu duong") ? 11 : 0) +
    (conditions.includes("dot quy") ? 18 : 0) +
    (conditions.includes("afib") ? 20 : 0);

  const qualityPenalty = Math.max(0, 65 - signalQuality) * 0.38;
  const rhythmRisk = irregularityIndex * 0.62 + Math.max(0, bpmDelta - 8) * 0.75 + hrvDelta * 0.45;
  const ageRisk = Math.max(0, age - 45) * 0.75;
  const waveformRisk = Math.max(0, Math.abs(waveformSeed - 50) * 0.08);

  let strokeRiskScore = Math.round(
    clamp(
      8,
      ageRisk + riskFromConditions + rhythmRisk + waveformRisk + qualityPenalty + (type === "finger" ? -4 : 2),
      98,
    ),
  );

  let classification = "normal";
  if ((irregularityIndex >= 58 && signalQuality >= 55) || strokeRiskScore >= 76) {
    classification = "afib";
  } else if (strokeRiskScore >= 44 || bpm < 52 || bpm > 110) {
    classification = "elevated";
  }

  if (classification === "normal" && signalQuality < 45) {
    classification = "elevated";
  }

  const confidence = Math.round(clamp(42, signalQuality * 0.56 + lightScore * 0.24 + stabilityScore * 0.2, 97));
  const baselineStatus = baseline.complete
    ? `Lech ${bpmDelta} BPM so voi baseline ${baselineBpm} BPM`
    : "Chua hoan thanh 3 lan baseline Heart-Print";

  const recommendation = [];
  if (classification === "normal") {
    recommendation.push("Nhip dang on dinh, tiep tuc theo doi dinh ky va tap tho 2-5 phut.");
  }
  if (classification === "elevated") {
    recommendation.push("Nghi ngo 5 phut, bo sung nuoc, do lai trong dieu kien yen tinh hon.");
  }
  if (classification === "afib") {
    recommendation.push("Nghiem tuc: can theo doi sat. Neu co choang vang, kho tho, yeu tay chan hoac noi lap bap, can lien he cap cuu.");
  }
  if (signalQuality < 60) {
    recommendation.push("Chat luong tin hieu chua cao, canh bao nay chi mang tinh tham khao.");
  }
  if (!baseline.complete) {
    recommendation.push("Nen hoan thanh du 3 lan baseline de AI hoc Heart-Print ca nhan.");
  }

  return {
    type,
    bpm,
    hrvScore,
    strokeRiskScore,
    irregularityIndex,
    lightScore,
    stabilityScore,
    signalQuality,
    confidence,
    classification,
    baselineStatus,
    recommendation,
    waveform,
    shouldTriggerSos: classification === "afib",
    generatedAt: new Date().toISOString(),
  };
}

function buildWeeklyReport(userId) {
  const measurements = readJson("measurements")
    .filter((item) => item.userId === userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const lastSevenDays = measurements.filter(
    (item) =>
      (item.type === "face" || item.type === "finger") &&
      Date.now() - new Date(item.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000,
  );

  if (!lastSevenDays.length) {
    return {
      summary: "Tuan nay chua co du lieu do tim.",
      averageBpm: null,
      averageRisk: null,
      afibAlerts: 0,
      totalMeasurements: 0,
    };
  }

  return {
    summary: `Tuan nay co ${lastSevenDays.length} phien do. Nen duy tri lich do cung khung gio moi sang de baseline on dinh hon.`,
    averageBpm: Math.round(average(lastSevenDays.map((item) => item.result.bpm || 0))),
    averageRisk: Math.round(average(lastSevenDays.map((item) => item.result.strokeRiskScore || 0))),
    afibAlerts: lastSevenDays.filter((item) => item.result.classification === "afib").length,
    totalMeasurements: lastSevenDays.length,
  };
}

function buildWeatherAlert(user) {
  const seed = Number(user.age || 60) + new Date().getDate();
  const todayTemp = 31 - (seed % 6);
  const tomorrowTemp = todayTemp - ((seed % 3) + 3);
  const delta = todayTemp - tomorrowTemp;

  if (delta > 5) {
    return {
      level: "warn",
      text: `Nhiet do mo phong co the giam ${delta}°C. Neu ban lon tuoi hoac co benh nen, hay giu am, tranh ra ngoai som khuya.`,
    };
  }

  return {
    level: "safe",
    text: "Moi truong hom nay on dinh, chua co canh bao thay doi nhiet do dang ke.",
  };
}

function buildDashboard(userId) {
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
  const weeklyReport = buildWeeklyReport(userId);
  const weatherAlert = buildWeatherAlert(user);

  return {
    user: summarizeUser(user),
    measurements: measurements.slice(-8),
    latestMeasurement,
    latestBreathing,
    symptoms: symptoms.slice(0, 8),
    reminders: reminders.slice(0, 8),
    sosEvents: sosEvents.slice(0, 8),
    ledger,
    weeklyReport,
    weatherAlert,
    sync: readJson("sync"),
  };
}

function buildPrintableReport(dashboard) {
  const { user, latestMeasurement, weeklyReport, reminders, symptoms, sosEvents } = dashboard;
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
              <p><strong>Phan loai:</strong> ${latestMeasurement.result.classification}</p>
            </div>
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
    },
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
    sendJson(res, 401, { error: "Can dang nhap de thiet lap guardian." });
    return;
  }

  user.guardian = {
    guardianName: body.guardianName || "",
    guardianPhone: body.guardianPhone || "",
    guardianEmail: body.guardianEmail || "",
    status: body.guardianPhone || body.guardianEmail ? "confirmation_sent" : "not_configured",
    updatedAt: new Date().toISOString(),
  };
  writeJson("users", users);

  appendLedgerEntry(user.id, "guardian.update", "Cap nhat guardian", user.guardian);
  sendJson(res, 200, {
    guardian: user.guardian,
    messages: [
      user.guardian.guardianPhone ? `SMS xac nhan da duoc tao cho ${user.guardian.guardianPhone}.` : null,
      user.guardian.guardianEmail ? `Email xac nhan da duoc tao cho ${user.guardian.guardianEmail}.` : null,
    ].filter(Boolean),
  });
}

function handleCreateMeasurement(urlObject, body, res) {
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
    createdAt: new Date().toISOString(),
  };

  measurements.push(record);
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "measurement.created", `Luu phien do ${type}`, {
    classification: result.classification,
    strokeRiskScore: result.strokeRiskScore,
  });

  sendJson(res, 201, { measurement: record, dashboard: buildDashboard(user.id) });
}

function handleRecordBaseline(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const users = readJson("users");
  const user = users.find((item) => item.id === session?.userId);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu baseline." });
    return;
  }

  const measurements = readJson("measurements")
    .filter((item) => item.userId === user.id && (item.type === "face" || item.type === "finger"))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const latest = measurements[measurements.length - 1];

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
  appendLedgerEntry(user.id, "baseline.recorded", "Luu mot phien Heart-Print baseline", {
    count: sessions.length,
  });
  sendJson(res, 200, { baseline: user.baseline, dashboard: buildDashboard(user.id) });
}

function handleCreateBreathing(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu breathing session." });
    return;
  }

  const durationSeconds = clamp(30, Number(body.payload?.durationSeconds || 60), 600);
  const cycles = clamp(1, Number(body.payload?.cycles || 4), 60);
  const coherenceGain = clamp(4, Math.round(durationSeconds / 12 + cycles * 2), 38);
  const record = {
    id: crypto.randomUUID(),
    userId: user.id,
    type: "breathing",
    payload: body.payload || {},
    result: {
      durationSeconds,
      cycles,
      coherenceGain,
      recommendation: "Duy tri 1-2 lan/ngay de giam cang thang va cai thien su deu nhip.",
    },
    createdAt: new Date().toISOString(),
  };

  const measurements = readJson("measurements");
  measurements.push(record);
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "breathing.completed", "Hoan thanh breathing coach", {
    durationSeconds,
    cycles,
  });
  sendJson(res, 201, { breathing: record, dashboard: buildDashboard(user.id) });
}

function handleSymptom(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de luu nhat ky." });
    return;
  }

  const symptoms = readJson("symptoms");
  const record = {
    id: crypto.randomUUID(),
    userId: user.id,
    note: String(body.note || "").trim(),
    createdAt: new Date().toISOString(),
  };
  symptoms.push(record);
  writeJson("symptoms", symptoms);
  appendLedgerEntry(user.id, "symptom.created", "Them nhat ky trieu chung", {
    note: record.note,
  });
  sendJson(res, 201, { symptom: record, dashboard: buildDashboard(user.id) });
}

function handleReminder(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de tao nhac thuoc." });
    return;
  }

  const reminders = readJson("reminders");
  const record = {
    id: crypto.randomUUID(),
    userId: user.id,
    medicineName: String(body.medicineName || "").trim(),
    time: body.time || "08:00",
    sourceImageName: body.sourceImageName || "",
    createdAt: new Date().toISOString(),
  };
  reminders.push(record);
  writeJson("reminders", reminders);
  appendLedgerEntry(user.id, "reminder.created", "Tao lich nhac thuoc", {
    medicineName: record.medicineName,
    time: record.time,
  });
  sendJson(res, 201, { reminder: record, dashboard: buildDashboard(user.id) });
}

function handleTriggerSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de kich hoat SOS." });
    return;
  }

  const guardian = user.guardian || {};
  const sos = readJson("sos");
  const record = {
    id: crypto.randomUUID(),
    userId: user.id,
    reason: body.reason || "Canh bao AFib / nguy co cao",
    status: "triggered",
    channels: [
      guardian.guardianPhone ? "sms" : null,
      guardian.guardianEmail ? "email" : null,
      "web-notification",
    ].filter(Boolean),
    createdAt: new Date().toISOString(),
  };
  sos.push(record);
  writeJson("sos", sos);
  appendLedgerEntry(user.id, "sos.triggered", "Kich hoat hanh lang xanh", {
    reason: record.reason,
    channels: record.channels,
  });

  sendJson(res, 201, {
    sos: record,
    messages: [
      guardian.guardianPhone ? `Da tao SMS canh bao den ${guardian.guardianPhone}.` : "Chua co so guardian de gui SMS.",
      guardian.guardianEmail ? `Da tao email canh bao den ${guardian.guardianEmail}.` : "Chua co email guardian de gui.",
      "Thong bao web da duoc tao cho phien hien tai.",
    ],
    dashboard: buildDashboard(user.id),
  });
}

function handleCancelSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) {
    sendJson(res, 401, { error: "Can dang nhap de huy SOS." });
    return;
  }

  const sos = readJson("sos");
  const latest = [...sos].reverse().find((item) => item.userId === user.id && item.status === "triggered");
  if (latest) {
    latest.status = "cancelled";
    latest.cancelledAt = new Date().toISOString();
    writeJson("sos", sos);
  }

  appendLedgerEntry(user.id, "sos.cancelled", "Nguoi dung xac nhan toi on");
  sendJson(res, 200, { ok: true, dashboard: buildDashboard(user.id) });
}

function handleDashboard(urlObject, res, userId) {
  const session = getSessionFromRequest(urlObject);
  if (!session || session.userId !== userId) {
    sendJson(res, 401, { error: "Khong du quyen xem dashboard." });
    return;
  }

  const dashboard = buildDashboard(userId);
  if (!dashboard) {
    sendJson(res, 404, { error: "Khong tim thay nguoi dung." });
    return;
  }
  sendJson(res, 200, dashboard);
}

function handleReport(urlObject, res, userId) {
  const session = getSessionFromRequest(urlObject);
  if (!session || session.userId !== userId) {
    sendText(res, 401, "Unauthorized");
    return;
  }

  const dashboard = buildDashboard(userId);
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
    sendJson(res, 200, { ok: true, name: "HEARTSENSE", version: "3.0.0", timestamp: new Date().toISOString() });
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
    handleCreateMeasurement(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/baseline") {
    handleRecordBaseline(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/breathing") {
    handleCreateBreathing(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/symptoms") {
    handleSymptom(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/reminders") {
    handleReminder(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/sos/trigger") {
    handleTriggerSos(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "POST" && urlObject.pathname === "/api/sos/cancel") {
    handleCancelSos(urlObject, await parseBody(req), res);
    return;
  }

  if (req.method === "GET" && urlObject.pathname.startsWith("/api/users/") && urlObject.pathname.endsWith("/dashboard")) {
    handleDashboard(urlObject, res, urlObject.pathname.split("/")[3]);
    return;
  }

  if (req.method === "GET" && urlObject.pathname.startsWith("/api/users/") && urlObject.pathname.endsWith("/report")) {
    handleReport(urlObject, res, urlObject.pathname.split("/")[3]);
    return;
  }

  serveStatic(urlObject, res);
}

ensureDataStore();

http
  .createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, { error: "Server error", detail: error.message });
    });
  })
  .listen(PORT, () => {
    console.log(`HEARTSENSE running at http://localhost:${PORT}`);
  });
