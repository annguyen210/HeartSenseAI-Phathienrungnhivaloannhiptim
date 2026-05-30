require("dotenv").config();
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8010;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const RESEND_API_BASE_URL = process.env.RESEND_API_BASE_URL || "https://api.resend.com/emails";
const WEATHER_DEFAULT_QUERY = process.env.WEATHER_DEFAULT_QUERY || "Bac Ninh,VN";
const EMAIL_FROM = process.env.EMAIL_FROM || "HEARTSENSE <onboarding@resend.dev>";
if (!process.env.RESEND_API_KEY) console.warn("[WARN] RESEND_API_KEY chưa được set — email sẽ không gửi được.");

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
  afibEpisodes: path.join(DATA_DIR, "afib_episodes.json"),
  pillProtocols: path.join(DATA_DIR, "pill_protocols.json"),
  exportTokens: path.join(DATA_DIR, "export_tokens.json"),
};

const DEFAULTS = {
  users: [],
  sessions: [],
  measurements: [],
  ledger: [],
  sync: { version: 4, totalEvents: 0, lastUpdatedAt: null, activeUsers: 0 },
  reminders: [],
  symptoms: [],
  sos: [],
  afibEpisodes: [],
  pillProtocols: [],
  exportTokens: [],
};

// ─── Vietnamese Diacritics Normalizer (BUG#2 fix) ────────────────────────────
function normalizeVi(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── HTML Sanitizer (improvement #18) ────────────────────────────────────────
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Drug Interaction Database ────────────────────────────────────────────────
const DRUG_GENERIC_MAP = {
  warfarin: "warfarin", coumadin: "warfarin",
  aspirin: "aspirin", "aspirin 81mg": "aspirin", "aspirin 100mg": "aspirin",
  amlodipine: "amlodipine", norvasc: "amlodipine", amlor: "amlodipine",
  metoprolol: "metoprolol", lopressor: "metoprolol", betaloc: "metoprolol",
  atenolol: "atenolol", tenormin: "atenolol",
  verapamil: "verapamil", isoptin: "verapamil",
  diltiazem: "diltiazem", cardizem: "diltiazem",
  digoxin: "digoxin", lanoxin: "digoxin",
  amiodarone: "amiodarone", cordarone: "amiodarone", pacerone: "amiodarone",
  rivaroxaban: "rivaroxaban", xarelto: "rivaroxaban",
  apixaban: "apixaban", eliquis: "apixaban",
  dabigatran: "dabigatran", pradaxa: "dabigatran",
  lisinopril: "lisinopril", zestril: "lisinopril", prinivil: "lisinopril",
  losartan: "losartan", cozaar: "losartan",
  valsartan: "valsartan", diovan: "valsartan",
  spironolactone: "spironolactone", aldactone: "spironolactone",
  furosemide: "furosemide", lasix: "furosemide",
  simvastatin: "simvastatin", zocor: "simvastatin",
  atorvastatin: "atorvastatin", lipitor: "atorvastatin",
  rosuvastatin: "rosuvastatin", crestor: "rosuvastatin",
  clopidogrel: "clopidogrel", plavix: "clopidogrel",
  bisoprolol: "bisoprolol", concor: "bisoprolol",
  carvedilol: "carvedilol", coreg: "carvedilol",
  // Vietnamese/herbal medicines
  "ginkgo biloba": "ginkgo", "bach qua": "ginkgo", "bạch quả": "ginkgo", ginkgo: "ginkgo",
  "dan sam": "danshen", "đan sâm": "danshen", danshen: "danshen",
  "toi": "garlic", "tỏi": "garlic", "garlic extract": "garlic", garlic: "garlic",
  "gung": "ginger", "gừng": "ginger", ginger: "ginger",
  "coq10": "coq10", "coenzyme q10": "coq10",
  "ha thu o": "heshouwu", "hà thủ ô": "heshouwu",
};

const INTERACTION_PAIRS = [
  { a: "warfarin", b: "aspirin", sev: "NGUY_HIEM", fx: "Nguy cơ chảy máu nội tạng nghiêm trọng. Uống cách nhau ít nhất 4h và hỏi bác sĩ." },
  { a: "warfarin", b: "amiodarone", sev: "NGUY_HIEM", fx: "Amiodarone làm tăng tác dụng của warfarin, nguy cơ chảy máu cao - cần giảm liều warfarin." },
  { a: "warfarin", b: "clopidogrel", sev: "NGUY_HIEM", fx: "Tăng nguy cơ chảy máu nghiêm trọng. Chỉ dùng kết hợp khi có chỉ định rõ ràng của bác sĩ." },
  { a: "metoprolol", b: "verapamil", sev: "NGUY_HIEM", fx: "Kết hợp này gây chậm nhịp tim nặng và tụt huyết áp. Tránh phối hợp này." },
  { a: "metoprolol", b: "diltiazem", sev: "NGUY_HIEM", fx: "Chậm nhịp tim nặng và block nhĩ thất. Tránh phối hợp." },
  { a: "bisoprolol", b: "verapamil", sev: "NGUY_HIEM", fx: "Nguy cơ chậm nhịp và tụt huyết áp nghiêm trọng." },
  { a: "atenolol", b: "verapamil", sev: "NGUY_HIEM", fx: "Chậm nhịp tim và block nhĩ thất nghiêm trọng." },
  { a: "digoxin", b: "amiodarone", sev: "NGUY_HIEM", fx: "Amiodarone tăng nồng độ digoxin, nguy cơ ngộ độc tim. Cần giảm liều digoxin 50%." },
  { a: "digoxin", b: "furosemide", sev: "VUA", fx: "Furosemide hạ kali máu làm tăng độc tính digoxin. Cần theo dõi kali và nồng độ digoxin." },
  { a: "amlodipine", b: "simvastatin", sev: "VUA", fx: "Amlodipine tăng nồng độ simvastatin, nguy cơ đau cơ. Giảm liều simvastatin xuống tối đa 20mg/ngày." },
  { a: "lisinopril", b: "spironolactone", sev: "VUA", fx: "Tăng kali máu (hyperkalemia). Theo dõi xét nghiệm kali định kỳ." },
  { a: "losartan", b: "spironolactone", sev: "VUA", fx: "Tăng kali máu. Theo dõi kali và chức năng thận." },
  { a: "valsartan", b: "spironolactone", sev: "VUA", fx: "Tăng kali máu. Cần theo dõi." },
  { a: "rivaroxaban", b: "aspirin", sev: "VUA", fx: "Tăng nguy cơ chảy máu kết hợp. Hỏi bác sĩ về liều lượng phù hợp." },
  { a: "apixaban", b: "aspirin", sev: "VUA", fx: "Tăng nguy cơ chảy máu. Chỉ dùng kết hợp theo chỉ định bác sĩ." },
  { a: "dabigatran", b: "aspirin", sev: "VUA", fx: "Tăng nguy cơ chảy máu tiêu hóa." },
  { a: "amiodarone", b: "metoprolol", sev: "NGUY_HIEM", fx: "Chậm nhịp và tụt huyết áp nghiêm trọng khi phối hợp." },
  { a: "amiodarone", b: "bisoprolol", sev: "NGUY_HIEM", fx: "Chậm nhịp nghiêm trọng. Theo dõi ECG liên tục nếu cần dùng." },
  { a: "amlodipine", b: "atorvastatin", sev: "NHE", fx: "Có thể tăng nhẹ nồng độ atorvastatin. Thông thường an toàn, theo dõi nếu có đau cơ." },
  // Vietnamese herbal medicine interactions (#17, #37)
  { a: "warfarin", b: "ginkgo", sev: "NGUY_HIEM", fx: "Bạch quả (Ginkgo biloba) tăng nguy cơ chảy máu nghiêm trọng khi dùng với warfarin. Tránh kết hợp." },
  { a: "warfarin", b: "danshen", sev: "NGUY_HIEM", fx: "Đan sâm làm tăng tác dụng chống đông của warfarin. Nguy cơ chảy máu cao. Không kết hợp." },
  { a: "warfarin", b: "garlic", sev: "VUA", fx: "Tỏi/Garlic extract tăng nhẹ tác dụng chống đông. Theo dõi INR nếu dùng liều cao." },
  { a: "warfarin", b: "ginger", sev: "VUA", fx: "Gừng liều cao có thể tăng tác dụng chống đông warfarin. Hỏi bác sĩ." },
  { a: "aspirin", b: "ginkgo", sev: "VUA", fx: "Bạch quả tăng nguy cơ chảy máu khi kết hợp với aspirin." },
  { a: "aspirin", b: "garlic", sev: "NHE", fx: "Tỏi liều cao có thể tăng nhẹ tác dụng chống kết tập tiểu cầu của aspirin." },
  { a: "warfarin", b: "coq10", sev: "VUA", fx: "CoQ10 có thể làm giảm hiệu quả của warfarin. Cần theo dõi INR chặt chẽ." },
  { a: "clopidogrel", b: "ginkgo", sev: "VUA", fx: "Bạch quả + clopidogrel tăng nguy cơ chảy máu. Tránh kết hợp." },
  { a: "metoprolol", b: "danshen", sev: "VUA", fx: "Đan sâm có thể tăng tác dụng hạ huyết áp và làm chậm nhịp tim." },
  { a: "digoxin", b: "danshen", sev: "NGUY_HIEM", fx: "Đan sâm tăng nồng độ digoxin trong máu, nguy cơ ngộ độc tim." },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cloneDefault(key) { return JSON.parse(JSON.stringify(DEFAULTS[key])); }

// ─── Rate Limiting (#19) ──────────────────────────────────────────────────────
const _loginAttempts = new Map(); // email -> { count, firstAt }
function checkLoginRateLimit(email) {
  const now = Date.now();
  const entry = _loginAttempts.get(email);
  if (!entry) return true;
  if (now - entry.firstAt > 15 * 60 * 1000) { _loginAttempts.delete(email); return true; }
  return entry.count < 5;
}
function recordLoginFailure(email) {
  const now = Date.now();
  const entry = _loginAttempts.get(email);
  if (!entry || now - entry.firstAt > 15 * 60 * 1000) {
    _loginAttempts.set(email, { count: 1, firstAt: now });
  } else {
    entry.count++;
  }
}
function clearLoginAttempts(email) { _loginAttempts.delete(email); }

// ─── Session TTL constants (#8) ────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 86400 * 1000; // 30 days
function isSessionValid(session) {
  if (!session) return false;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return false;
  return true;
}
function cleanupExpiredSessions() {
  const sessions = readJson("sessions");
  const now = Date.now();
  const valid = sessions.filter(s => !s.expiresAt || new Date(s.expiresAt).getTime() > now);
  if (valid.length !== sessions.length) writeJson("sessions", valid);
}

// ─── Supabase Storage Layer ───────────────────────────────────────────────────
// Khi SUPABASE_URL + SUPABASE_SERVICE_KEY được set → dùng Supabase (persistent)
// Khi không có → fallback về file JSON local (development)
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

// In-memory cache: mọi read từ cache → nhanh; write vào cache + Supabase đồng thời
const _db = {};

async function sbGet(key) {
  const url = `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`;
  try {
    const rows = await requestJson(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    return Array.isArray(rows) && rows.length ? rows[0].value : null;
  } catch (e) { console.error(`[Supabase GET ${key}]`, e.message); return null; }
}

async function sbSet(key, value) {
  const payload = JSON.stringify({ key, value, updated_at: new Date().toISOString() });
  try {
    await requestJson(`${SUPABASE_URL}/rest/v1/kv_store`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: payload,
    });
  } catch (e) { console.error(`[Supabase SET ${key}]`, e.message); }
}

function readJson(key) {
  // Luôn đọc từ cache (đã load từ Supabase lúc khởi động)
  if (_db[key] !== undefined) return JSON.parse(JSON.stringify(_db[key]));
  // Fallback file cho local dev
  try {
    const value = JSON.parse(fs.readFileSync(DATA_FILES[key], "utf8"));
    if (Array.isArray(DEFAULTS[key])) return Array.isArray(value) ? value : cloneDefault(key);
    if (key === "sync") return { ...cloneDefault("sync"), ...(value || {}), totalEvents: Number(value?.totalEvents || 0), activeUsers: Number(value?.activeUsers || 0) };
    return value && typeof value === "object" ? { ...cloneDefault(key), ...value } : cloneDefault(key);
  } catch { return cloneDefault(key); }
}

function writeJson(key, value) {
  _db[key] = JSON.parse(JSON.stringify(value)); // cập nhật cache ngay lập tức
  if (USE_SUPABASE) {
    sbSet(key, value); // async fire-and-forget — không block response
  } else {
    // Atomic write: write to .tmp then rename (#14)
    try {
      const filePath = DATA_FILES[key];
      const tmpPath = filePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
      fs.renameSync(tmpPath, filePath);
    } catch {}
  }
}

async function initDataStore() {
  if (USE_SUPABASE) {
    console.log("[Supabase] Đang tải dữ liệu từ cloud...");
    for (const key of Object.keys(DEFAULTS)) {
      const data = await sbGet(key);
      if (data !== null) {
        _db[key] = data;
        const count = Array.isArray(data) ? `${data.length} records` : "loaded";
        console.log(`  ✓ ${key}: ${count}`);
      } else {
        _db[key] = cloneDefault(key);
        await sbSet(key, _db[key]); // tạo row rỗng lần đầu
        console.log(`  ✓ ${key}: khởi tạo mới`);
      }
    }
    console.log(`[Supabase] Sẵn sàng ☁️ — ${Object.keys(_db).length} bảng đã tải.`);
  } else {
    // Local dev: đọc từ file vào cache
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const [key, filePath] of Object.entries(DATA_FILES)) {
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(cloneDefault(key), null, 2));
      try { _db[key] = JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch { _db[key] = cloneDefault(key); }
    }
    console.log("[Local] File storage sẵn sàng 📁");
  }
}
function sendJson(res, status, payload) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function sendText(res, status, body, contentType = "text/plain; charset=utf-8") { res.writeHead(status, { "Content-Type": contentType }); res.end(body); }

function requestJson(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const request = https.request(target, { method: options.method || "GET", headers: options.headers || {} }, (response) => {
      let buffer = "";
      response.on("data", (chunk) => { buffer += chunk.toString(); });
      response.on("end", () => {
        let parsed = {};
        try { parsed = buffer ? JSON.parse(buffer) : {}; } catch { parsed = {}; }
        if (response.statusCode >= 400) { reject(new Error(parsed.message || `HTTP ${response.statusCode}`)); return; }
        resolve(parsed);
      });
    });
    request.setTimeout(6000, () => { request.destroy(); reject(new Error("Request timeout")); });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); if (body.length > 10 * 1024 * 1024) reject(new Error("Payload too large")); });
    req.on("end", () => { if (!body) { resolve({}); return; } try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  });
}

function average(values) { if (!values.length) return 0; return values.reduce((s, v) => s + v, 0) / values.length; }
function clamp(min, value, max) { return Math.min(max, Math.max(min, value)); }

function parseConditions(conditions) {
  if (Array.isArray(conditions)) return conditions.map((item) => String(item).trim()).filter(Boolean);
  return String(conditions || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  return crypto.scryptSync(password, record.salt, 64).toString("hex") === record.hash;
}

function summarizeUser(user) {
  return {
    id: user.id, fullName: user.fullName, email: user.email,
    age: user.age, gender: user.gender, conditions: user.conditions || [],
    guardian: user.guardian || {}, baseline: user.baseline || { sessions: [], complete: false },
    pillProtocol: user.pillProtocol || null, remoteParent: user.remoteParent || null,
    createdAt: user.createdAt,
  };
}

function getSessionFromRequest(urlObject, body = {}) {
  const token = body.token || urlObject.searchParams.get("token");
  if (!token) return null;
  const session = readJson("sessions").find((item) => item.token === token) || null;
  return isSessionValid(session) ? session : null;
}

function getUserBySession(session) {
  if (!session) return null;
  return readJson("users").find((item) => item.id === session.userId) || null;
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
  const entry = { id: crypto.randomUUID(), userId, type, summary, detail, createdAt, previousHash, hash };
  ledger.push(entry);
  writeJson("ledger", ledger);
  updateSyncStats();
  return entry;
}

function getProviderStatus() {
  return { email: Boolean(process.env.RESEND_API_KEY), weather: true };
}

// ─── Email ────────────────────────────────────────────────────────────────────
async function sendResendEmailWithRetry(opts, maxRetries = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendResendEmail(opts);
      if (result.sent) return { ...result, attempts: attempt };
      lastErr = result.reason;
    } catch (e) {
      lastErr = e.message;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
  }
  return { sent: false, provider: "resend", reason: lastErr, attempts: maxRetries };
}

async function sendResendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !to) {
    return { sent: false, provider: "resend", reason: !process.env.RESEND_API_KEY ? "missing_api_key" : "missing_recipient" };
  }
  const payload = JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html });
  const response = await requestJson(RESEND_API_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Length": Buffer.byteLength(payload) },
    body: payload,
  });
  return { sent: true, provider: "resend", id: response.id || null };
}

function buildReportEmailHtml(user, latest, status, dashboard, personalMessage = "") {
  const r = latest?.result;
  const isAfib = r?.classification === "afib";
  const isElevated = r?.classification === "elevated";
  const bannerColor = isAfib ? "#cc2244" : isElevated ? "#d97706" : "#059669";
  const bannerLabel = isAfib ? "⚠️ PHÁT HIỆN AFIB – CẦN CHÚ Ý NGAY" : isElevated ? "⚡ CHỈ SỐ CAO – NÊN THEO DÕI THÊM" : "✅ SỨC KHOẺ BÌNH THƯỜNG";
  const safetyMsg = isAfib
    ? `Phát hiện rung nhĩ (AFib). Đây là tình trạng cần theo dõi y tế. Hãy liên hệ ngay với ${user.fullName} để xác nhận tình trạng và cân nhắc gặp bác sĩ.`
    : isElevated
    ? `Nhịp tim hoặc chỉ số nguy cơ cao hơn bình thường. Không khẩn cấp nhưng nên nhắc ${user.fullName} nghỉ ngơi và đo lại sau 30 phút.`
    : `Tất cả chỉ số trong giới hạn an toàn. ${user.fullName} đang có sức khoẻ tim mạch ổn định.`;
  const riskColor = (r?.strokeRiskScore || 0) >= 70 ? "#cc2244" : (r?.strokeRiskScore || 0) >= 40 ? "#d97706" : "#059669";
  const weekly = dashboard.weeklyReport || {};
  return `<div style="font-family:Arial,sans-serif;padding:24px;max-width:520px;background:#fff">
    <div style="background:${bannerColor};color:#fff;padding:14px 18px;border-radius:10px;text-align:center;font-size:16px;font-weight:bold;margin-bottom:18px">
      ${bannerLabel}
    </div>
    <h3 style="color:#10233f;margin:0 0 4px">HEARTSENSE – Báo cáo sức khoẻ</h3>
    <p style="color:#555;margin:0 0 16px;font-size:13px">Người được giám sát: <strong>${user.fullName}</strong> (${user.age} tuổi) &nbsp;·&nbsp; ${new Date().toLocaleString("vi-VN")}</p>
    ${r ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:#f0f9ff;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold;color:#10233f">${r.bpm}</div>
        <div style="font-size:12px;color:#666">Nhịp tim (BPM)</div>
      </div>
      <div style="background:#f0f9ff;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold;color:${riskColor}">${r.strokeRiskScore}%</div>
        <div style="font-size:12px;color:#666">Nguy cơ đột quỵ</div>
      </div>
      <div style="background:#f8fafc;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:bold;color:#10233f">${r.sdnn || r.hrvScore || "--"}</div>
        <div style="font-size:12px;color:#666">HRV (SDNN)</div>
      </div>
      <div style="background:#f8fafc;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:bold;color:#10233f">${r.confidence ? Math.round(r.confidence * 100) + "%" : "--"}</div>
        <div style="font-size:12px;color:#666">Độ tin cậy AI</div>
      </div>
    </div>
    <div style="background:#fffbeb;border-left:4px solid ${bannerColor};padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:14px;color:#333">
      ${safetyMsg}
    </div>
    <p style="font-size:12px;color:#888;margin:0 0 16px">⏱ Lần đo gần nhất: ${new Date(latest.createdAt).toLocaleString("vi-VN")}</p>
    ` : `<p style="color:#888;margin-bottom:16px">Chưa có lần đo nào hôm nay. Hãy nhắc <strong>${user.fullName}</strong> đo tim!</p>`}
    ${weekly.totalMeasurements > 0 ? `
    <div style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px">
      <strong style="display:block;margin-bottom:6px;color:#10233f">📊 Tóm tắt 7 ngày qua</strong>
      <span style="margin-right:16px">📋 ${weekly.totalMeasurements} lần đo</span>
      <span style="margin-right:16px">💓 TB ${weekly.averageBpm} BPM</span>
      <span style="color:${(weekly.afibAlerts || 0) > 0 ? "#cc2244" : "#059669"}">⚡ ${weekly.afibAlerts || 0} cảnh báo AFib</span>
      ${weekly.summary ? `<p style="margin:6px 0 0;color:#555">${weekly.summary}</p>` : ""}
    </div>` : ""}
    ${personalMessage ? `
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px">
      <p style="margin:0 0 4px;font-size:12px;color:#92400e;font-weight:600">💬 Lời nhắn từ ${user.fullName}</p>
      <p style="margin:0;font-size:14px;color:#333;white-space:pre-wrap">${personalMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
    </div>` : ""}
    <p style="color:#999;font-size:11px;margin:0;text-align:center">HEARTSENSE – Mắt thần cho con xa.</p>
  </div>`;
}

function buildMeasurementEmailHtml(user, record, dashboard) {
  const r = record.result;
  const cls = r.classification;
  const isAfib = cls === "afib";
  const isElevated = cls === "elevated";
  const statusColor = isAfib ? "#cc2244" : isElevated ? "#d97706" : "#059669";
  const statusLabel = isAfib ? "⚠️ PHÁT HIỆN AFIB – CẦN CHÚ Ý" : isElevated ? "⚡ CHỈ SỐ CAO – THEO DÕI" : "✅ BÌNH THƯỜNG";
  const safetyMsg = isAfib
    ? `Phát hiện rung nhĩ (AFib). Đây là tình trạng cần được theo dõi y tế. Hãy liên hệ ngay với ${user.fullName} để xác nhận tình trạng sức khỏe.`
    : isElevated
    ? `Nhịp tim hoặc chỉ số nguy cơ hơi cao so với bình thường. Không phải khẩn cấp nhưng nên theo dõi thêm.`
    : `Kết quả đo trong giới hạn bình thường. ${user.fullName} đang ổn.`;
  const riskColor = r.strokeRiskScore >= 70 ? "#cc2244" : r.strokeRiskScore >= 40 ? "#d97706" : "#059669";
  const weekly = dashboard.weeklyReport || {};
  return `<div style="font-family:Arial,sans-serif;padding:24px;max-width:520px;background:#fff">
    <div style="background:${statusColor};color:#fff;padding:14px 18px;border-radius:10px;text-align:center;font-size:16px;font-weight:bold;margin-bottom:18px">
      ${statusLabel}
    </div>
    <h3 style="color:#10233f;margin:0 0 4px">HEARTSENSE – Kết quả đo vừa xong</h3>
    <p style="color:#555;margin:0 0 16px;font-size:13px">Người được giám sát: <strong>${user.fullName}</strong> (${user.age} tuổi) &nbsp;·&nbsp; ${new Date(record.createdAt).toLocaleString("vi-VN")}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:#f0f9ff;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold;color:#10233f">${r.bpm}</div>
        <div style="font-size:12px;color:#666">Nhịp tim (BPM)</div>
      </div>
      <div style="background:#f0f9ff;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold;color:${riskColor}">${r.strokeRiskScore}%</div>
        <div style="font-size:12px;color:#666">Nguy cơ đột quỵ</div>
      </div>
      <div style="background:#f8fafc;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:bold;color:#10233f">${r.sdnn || r.hrvScore || "--"}</div>
        <div style="font-size:12px;color:#666">HRV (SDNN)</div>
      </div>
      <div style="background:#f8fafc;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:22px;font-weight:bold;color:#10233f">${r.confidence ? Math.round(r.confidence * 100) + "%" : "--"}</div>
        <div style="font-size:12px;color:#666">Độ tin cậy AI</div>
      </div>
    </div>
    <div style="background:#fffbeb;border-left:4px solid ${statusColor};padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:14px;color:#333">
      ${safetyMsg}
    </div>
    ${weekly.totalMeasurements > 0 ? `
    <div style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:12px;font-size:13px">
      <strong style="display:block;margin-bottom:6px;color:#10233f">Tóm tắt 7 ngày qua</strong>
      <span style="margin-right:16px">📊 ${weekly.totalMeasurements} lần đo</span>
      <span style="margin-right:16px">💓 TB ${weekly.averageBpm} BPM</span>
      <span style="color:${weekly.afibAlerts > 0 ? "#cc2244" : "#059669"}">⚡ ${weekly.afibAlerts} cảnh báo AFib</span>
    </div>` : ""}
    <p style="color:#999;font-size:11px;margin:0;text-align:center">HEARTSENSE Mắt thần – Email này được gửi tự động ngay sau khi ${user.fullName} hoàn tất đo.</p>
  </div>`;
}

async function sendGuardianMeasurementNotification(user, record, dashboard) {
  const guardian = user.guardian || {};
  if (!guardian.guardianEmail || !guardian.reportSchedule?.notifyOnMeasurement) return;
  try {
    await sendResendEmail({
      to: guardian.guardianEmail,
      subject: `HEARTSENSE – ${user.fullName} vừa đo: ${record.result.classification === "afib" ? "⚠️ CÓ CẢNH BÁO" : record.result.classification === "elevated" ? "⚡ Chỉ số cao" : "✅ Bình thường"} – ${new Date().toLocaleTimeString("vi-VN")}`,
      html: buildMeasurementEmailHtml(user, record, dashboard),
    });
    appendLedgerEntry(user.id, "remote_parent.notify_sent", "Gui thong bao sau do", { classification: record.result.classification });
  } catch (err) {
    console.error(`[Notify] Loi gui email: ${err.message}`);
  }
}

// ─── Weather (Open-Meteo – no API key required) ───────────────────────────────
function getWeatherDescription(code) {
  if (code === 0) return "trời quang";
  if (code <= 3) return "ít mây";
  if (code <= 48) return "sương mù";
  if (code <= 55) return "mưa phùn";
  if (code <= 65) return "có mưa";
  if (code <= 75) return "có tuyết";
  if (code <= 82) return "mưa rào";
  if (code <= 99) return "có dông";
  return "không xác định";
}

const _weatherCache = { data: null, fetchedAt: 0, query: "" };
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 phút

// query: string "CityName,VN" HOẶC object {lat, lon} từ GPS người dùng
async function fetchOpenMeteoWeather(query) {
  const now = Date.now();
  const isCoords = query && typeof query === "object" && query.lat != null && query.lon != null;
  const cacheKey = isCoords
    ? `${Number(query.lat).toFixed(3)},${Number(query.lon).toFixed(3)}`
    : String(query);

  if (_weatherCache.data && _weatherCache.query === cacheKey && now - _weatherCache.fetchedAt < WEATHER_CACHE_TTL) {
    return _weatherCache.data;
  }

  let latitude, longitude, locationName;

  if (isCoords) {
    // GPS coordinates → gọi thẳng Open-Meteo, không cần geocoding
    latitude = Number(query.lat);
    longitude = Number(query.lon);
    locationName = null; // lấy từ timezone trong response
  } else {
    const cityName = String(query).split(",")[0].trim();
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=vi&format=json`;
    const geoData = await requestJson(geoUrl);
    if (!geoData?.results?.length) return null;
    const r = geoData.results[0];
    latitude = r.latitude; longitude = r.longitude;
    locationName = `${r.name}, ${r.country}`;
  }

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const weatherData = await requestJson(weatherUrl);
  if (!weatherData?.current) return null;

  if (!locationName && weatherData.timezone) {
    // "Asia/Ho_Chi_Minh" → "Ho Chi Minh"
    locationName = weatherData.timezone.split("/").pop().replace(/_/g, " ");
  }
  locationName = locationName || cacheKey;

  const result = { name: locationName, temp: weatherData.current.temperature_2m, weatherCode: weatherData.current.weather_code };
  _weatherCache.data = result;
  _weatherCache.fetchedAt = now;
  _weatherCache.query = cacheKey;
  return result;
}

function pseudoWeather(user) {
  const ageSeed = Number(user.age || 60);
  const daySeed = new Date().getDate();
  const currentTemp = 28 + ((ageSeed + daySeed) % 5);
  const nextTemp = currentTemp - ((daySeed % 4) + 2);
  const delta = currentTemp - nextTemp;
  return {
    source: "prototype", location: WEATHER_DEFAULT_QUERY,
    currentTemp, nextTemp, delta,
    level: delta > 5 ? "warn" : "safe",
    text: delta > 5
      ? `Nhiệt độ mô phỏng có thể giảm ${delta}°C trong 24h tới. Người cao tuổi nên giữ ấm.`
      : "Môi trường ổn định, chưa có cảnh báo.",
  };
}

// coordsOverride: {lat, lon} từ GPS người dùng; null → dùng WEATHER_DEFAULT_QUERY
async function getWeatherAlert(user, coordsOverride) {
  const locationQuery = coordsOverride || WEATHER_DEFAULT_QUERY;
  try {
    const weather = await fetchOpenMeteoWeather(locationQuery);
    if (!weather) return pseudoWeather(user);
    const currentTemp = Math.round(weather.temp);
    const nextTemp = currentTemp - 3;
    const delta = currentTemp - nextTemp;
    const desc = getWeatherDescription(weather.weatherCode);
    return {
      source: "open-meteo", location: weather.name,
      currentTemp, nextTemp, delta,
      level: currentTemp >= 35 || delta > 5 ? "warn" : "safe",
      text: currentTemp >= 35
        ? `Cảnh báo nhiệt: ${weather.name} ${currentTemp}°C. Người có bệnh tim mạch cần đặc biệt chú ý.`
        : `Thời tiết ${weather.name}: ${desc}, ${currentTemp}°C.`,
    };
  } catch {
    return { ...pseudoWeather(user), source: "fallback", location: WEATHER_DEFAULT_QUERY };
  }
}

// ─── Thermal Strain Index ─────────────────────────────────────────────────────
function calculateThermalStrain(temp, bpm, baselineBpm) {
  const t = Number(temp || 28);
  const hr = Number(bpm || 72);
  const baseline = Number(baselineBpm || 72);
  const hrElevation = baseline > 0 ? ((hr - baseline) / baseline * 100) : 0;

  if (t >= 39 && hrElevation > 25) {
    return { level: "CRITICAL", tsi: Math.round(t + hrElevation * 0.3), sos: true, message: "NGUY CƠ SỐC NHIỆT - CẦN LÀM MÁT NGAY! Gọi người thân và 115." };
  }
  if (t >= 35 && hrElevation > 20) {
    return { level: "WARNING", tsi: Math.round(t + hrElevation * 0.2), sos: false, message: `Trời nóng ${Math.round(t)}°C, tim đang đập nhanh hơn ${Math.round(hrElevation)}%. Vào phòng điều hòa và uống nước ngay!` };
  }
  if (t >= 32 && hrElevation > 10) {
    return { level: "CAUTION", tsi: Math.round(t + hrElevation * 0.1), sos: false, message: `Nhiệt độ cao ${Math.round(t)}°C. Uống đủ nước, tránh vận động mạnh.` };
  }
  return { level: "NORMAL", tsi: Math.round(t), sos: false, message: "" };
}

// ─── AFib Burden ──────────────────────────────────────────────────────────────
function calculateAfibBurden(userId, days) {
  const cutoff = Date.now() - days * 86400000;
  const measurements = readJson("measurements").filter(
    (m) => m.userId === userId && (m.type === "face" || m.type === "finger") && new Date(m.createdAt).getTime() >= cutoff
  );
  if (!measurements.length) return { burden: 0, total: 0, afibCount: 0, trend: "stable", days };

  const afibCount = measurements.filter((m) => m.result.classification === "afib").length;
  const burden = Math.round((afibCount / measurements.length) * 100);

  const mid = Math.floor(measurements.length / 2);
  const firstHalf = measurements.slice(0, mid);
  const secondHalf = measurements.slice(mid);
  const fb = firstHalf.filter((m) => m.result.classification === "afib").length / Math.max(1, firstHalf.length);
  const sb = secondHalf.filter((m) => m.result.classification === "afib").length / Math.max(1, secondHalf.length);
  const trend = sb > fb * 1.5 ? "increasing" : sb < fb * 0.5 ? "decreasing" : "stable";

  let alert = null;
  if (burden >= 25) alert = `CẢNH BÁO ĐỎ: AFib Burden tăng lên ${burden}% - nguy cơ cao hình thành cục máu đông. Gặp bác sĩ ngay!`;
  else if (burden >= 10) alert = `Lưu ý: AFib Burden ${burden}%. Theo dõi sát và gặp bác sĩ.`;

  return { burden, total: measurements.length, afibCount, trend, days, alert };
}

// ─── Stroke Predictor 72h ─────────────────────────────────────────────────────
function predictStroke72h(user, measurements) {
  const conditions = normalizeVi((user.conditions || []).join(" "));
  const age = Number(user.age || 60);

  let score = 0;
  if (age >= 75) score += 22;
  else if (age >= 65) score += 14;
  else if (age >= 55) score += 7;

  if (/cao huyet ap|huyet ap cao|tang huyet ap/.test(conditions)) score += 14;
  if (/tieu duong|dai thao duong/.test(conditions)) score += 10;
  if (/dot quy|stroke/.test(conditions)) score += 22;
  if (/afib|rung nhi|loai nhip/.test(conditions)) score += 18;
  if (/suy tim/.test(conditions)) score += 12;

  const ppgMeasurements = measurements.filter((m) => m.type === "face" || m.type === "finger");
  const last7Days = ppgMeasurements.filter((m) => Date.now() - new Date(m.createdAt).getTime() <= 7 * 86400000).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (last7Days.length >= 2) {
    const recentAfib = last7Days.slice(0, 5).filter((m) => m.result.classification === "afib").length;
    if (recentAfib >= 3) score += 24;
    else if (recentAfib >= 1) score += 12;

    const avgBpm = average(last7Days.slice(0, 5).map((m) => m.result.bpm || 72));
    if (avgBpm > 105) score += 10;
    if (avgBpm < 48) score += 8;

    const avgRisk = average(last7Days.slice(0, 5).map((m) => m.result.strokeRiskScore || 20));
    if (avgRisk > 70) score += 15;
    else if (avgRisk > 50) score += 8;

    // Trend: compare last 2 vs previous
    if (last7Days.length >= 4) {
      const recentAvg = average(last7Days.slice(0, 2).map((m) => m.result.strokeRiskScore || 20));
      const olderAvg = average(last7Days.slice(2, 4).map((m) => m.result.strokeRiskScore || 20));
      if (recentAvg > olderAvg * 1.4) score += 10;
    }
  }

  const probability = Math.round(clamp(2, score * 0.8, 92));
  let level = "THAP";
  let recommendation = "Tiếp tục duy trì lịch đo hàng ngày. Uống đủ nước và giữ giờ ngủ đều đặn.";
  let actionRequired = false;

  if (probability >= 60) {
    level = "CAO";
    recommendation = "Nguy cơ cao trong 72h tới. Liên hệ bác sĩ tim mạch ngay hôm nay. Không vận động mạnh, uống đủ nước, tránh thức khuya và stress. Nếu có triệu chứng: chóng mặt, tê tay chân, nói khó - gọi 115 ngay.";
    actionRequired = true;
  } else if (probability >= 35) {
    level = "TRUNG_BINH";
    recommendation = "Cần theo dõi sát. Đo lại sau 4-6 tiếng. Nếu có bất kỳ triệu chứng lạ: chóng mặt, tê mặt/tay/chân, nói lắp bắp - gọi cấp cứu ngay.";
  }

  return { probability, level, recommendation, actionRequired, calculatedAt: new Date().toISOString() };
}

// ─── Shock Index ──────────────────────────────────────────────────────────────
function evaluateShockIndex(bpm, systolic) {
  const si = Number(bpm || 72) / Math.max(60, Number(systolic || 120));
  const siRounded = Math.round(si * 100) / 100;
  let level = "NORMAL";
  let action = "";
  let sos = false;

  if (si >= 1.0) {
    level = "CRITICAL";
    action = "NẰM XUỐNG, KÊ CAO CHÂN. Kích hoạt SOS ngay. Có thể suy tim cấp hoặc sốc giảm thể tích.";
    sos = true;
  } else if (si >= 0.8) {
    level = "WARNING";
    action = "Nằm nghỉ, kê cao chân. Theo dõi liên tục. Chuẩn bị kích hoạt SOS nếu chuyển biến xấu.";
  }

  return { shockIndex: siRounded, level, action, sos };
}

// ─── Drug Interaction Checker ─────────────────────────────────────────────────
function normalizeDrugName(name) {
  const lower = String(name || "").toLowerCase().trim();
  return DRUG_GENERIC_MAP[lower] || lower;
}

function checkDrugInteractions(drugs) {
  const normalized = drugs.map(normalizeDrugName).filter(Boolean);
  const interactions = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      const pair = INTERACTION_PAIRS.find(
        (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)
      );
      if (pair) {
        interactions.push({
          drugA: drugs[i], drugB: drugs[j],
          genericA: a, genericB: b,
          severity: pair.sev, effect: pair.fx,
        });
      }
    }
  }

  const duplicates = [];
  const seen = {};
  normalized.forEach((g, idx) => {
    if (seen[g] !== undefined) {
      duplicates.push({ index1: seen[g], index2: idx, drug1: drugs[seen[g]], drug2: drugs[idx], generic: g });
    } else {
      seen[g] = idx;
    }
  });

  return { interactions, duplicates, safe: !interactions.length && !duplicates.length };
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
function generateRecommendations(classification, extras = {}) {
  const recs = [];
  if (classification === "normal") recs.push("Nhịp đang ổn định. Tiếp tục duy trì lịch đo và breathing coach hàng ngày.");
  if (classification === "elevated") {
    recs.push("Nhịp tim có dấu hiệu cần theo dõi. Nghỉ ngơi 5 phút và đo lại trong điều kiện yên tĩnh.");
    recs.push("Nếu vừa uống cà phê, stress hoặc vận động, hãy ghi lại vào nhật ký triệu chứng.");
  }
  if (classification === "afib") {
    recs.push("CẢNH BÁO: Phát hiện nhịp bất thường nghi ngờ AFib. Nếu có chóng váng, khó thở, mê tay chân - gọi 115.");
    recs.push("Xác nhận lại bằng lần đo thứ 2 hoặc tính năng 'Xác nhận AFib'. Gặp người thân và bác sĩ.");
  }
  if (extras.signalQuality < 60) recs.push("Chất lượng tín hiệu chưa cao. Kết quả này chỉ là cảnh báo sớm, cần xác nhận lại.");
  if (!extras.baselineComplete) recs.push("Hoàn thành 3 lần baseline Heart-Print sáng sớm để tăng độ chính xác.");
  if (extras.shockIndex?.level === "WARNING") recs.push("Chỉ số sốc cao. Nằm nghỉ và kê chân cao.");
  if (extras.shockIndex?.level === "CRITICAL") recs.push("KHẨN CẤP: Chỉ số sốc cực cao. Kích hoạt SOS ngay!");
  return recs;
}

function analyzeMeasurement({ user, type, payload }) {
  const baseline = user.baseline || { sessions: [] };
  const conditions = normalizeVi((user.conditions || []).join(" ")); // BUG#2 fix
  const age = Number(user.age || 60);
  const systolic = clamp(90, Number(payload.systolic || 128), 220);
  const signalQuality = clamp(18, Math.round(Number(payload.signalQuality || 60)), 99);
  const lightScore = clamp(18, Math.round(Number(payload.lightScore || 64)), 99);
  const stabilityScore = clamp(18, Math.round(Number(payload.stabilityScore || 61)), 99);
  const estimatedBpm = clamp(38, Math.round(Number(payload.estimatedBpm || payload.bpm || 72)), 185);
  const irregularityIndex = clamp(0, Math.round(Number(payload.irregularityIndex || 24)), 100);
  const hrvScore = clamp(10, Math.round(Number(payload.hrvScore || 42)), 96);
  const sdnn = Number(payload.sdnn || 0);
  const rmssd = Number(payload.rmssd || 0);
  const pnn50 = Number(payload.pnn50 || 0);
  const cv = Number(payload.cv || 0);
  const sampEn = Number(payload.sampEn || 0); // #23 SampEn from client
  const sd1 = Number(payload.sd1 || 0);       // #24 Poincaré SD1
  const sd2 = Number(payload.sd2 || 0);       // #24 Poincaré SD2
  const contextNote = String(payload.contextNote || "").trim();
  const waveform = Array.isArray(payload.waveform) ? payload.waveform.slice(0, 120) : [];
  const rrIntervals = Array.isArray(payload.rrIntervals) ? payload.rrIntervals.slice(0, 30) : [];
  const contextUnchecked = Boolean(payload.contextUnchecked); // #29 pre-measurement checklist

  const riskFromConditions =
    (/cao huyet ap|tang huyet ap/.test(conditions) ? 16 : 0) +
    (/tieu duong|dai thao duong/.test(conditions) ? 11 : 0) +
    (/dot quy|stroke/.test(conditions) ? 20 : 0) +
    (/afib|rung nhi/.test(conditions) ? 22 : 0) +
    (/suy tim/.test(conditions) ? 14 : 0);
  const ageRisk = Math.max(0, age - 45) * 0.72;
  const systolicRisk = Math.max(0, systolic - 120) * 0.42;
  const rhythmRisk = irregularityIndex * 0.64 + Math.max(0, estimatedBpm - 95) * 0.58 + Math.max(0, 54 - estimatedBpm) * 0.9;
  const qualityPenalty = Math.max(0, 65 - signalQuality) * 0.36;
  const baselineBpm = Number(baseline.restingBpm || 72);
  const baselineHrv = Number(baseline.hrvScore || 42);
  const bpmDelta = Math.abs(estimatedBpm - baselineBpm);
  const hrvDelta = baseline.complete ? Math.abs(hrvScore - baselineHrv) : 0;
  const contextPenalty = (/(stress|ca phe|coffee|met|mat ngu)/i.test(contextNote) ? 4 : 0)
    + (contextUnchecked ? 3 : 0); // #29 adjust for unchecked pre-measurement checklist
  const cvBonus = cv > 0.26 ? cv * 24 : 0;

  const strokeRiskScore = Math.round(clamp(8,
    riskFromConditions + ageRisk + systolicRisk + rhythmRisk + qualityPenalty +
    bpmDelta * 0.44 + hrvDelta * 0.36 + contextPenalty + cvBonus + (type === "face" ? 3 : -2),
    99));

  // ═══ Phân loại nhịp tim — bảo thủ, tránh false positive ══════════════════
  const clientAfibFlag = Boolean(payload.afibLikelihood);
  const qualityForAfib = signalQuality >= 65;

  // Adaptive thresholds (#25): use baseline CV std if available
  const baselineCv = Number(baseline.cvMean || 0);
  const baselineCvStd = Number(baseline.cvStd || 0);
  const adaptiveCvThreshold = baseline.complete && baselineCv > 0
    ? Math.min(0.30, baselineCv + 2 * (baselineCvStd || 0.03))
    : 0.28;
  const adaptiveCvModerate = baseline.complete && baselineCv > 0
    ? Math.min(0.26, baselineCv + 1.5 * (baselineCvStd || 0.03))
    : 0.22;

  // SampEn + Poincaré boost for AFib confidence (#23, #24)
  const sampEnBoost = sampEn > 0.9 && cv > 0.20;
  const poincareBoost = sd2 > 0 && sd1 / sd2 > 0.85;

  const strongAfib = qualityForAfib && cv > adaptiveCvThreshold && pnn50 > 40 && irregularityIndex >= 65
    && estimatedBpm >= 50 && estimatedBpm <= 150;
  const moderateAfib = qualityForAfib && clientAfibFlag && cv > adaptiveCvModerate && pnn50 > 30
    && irregularityIndex >= 58 && estimatedBpm >= 50 && estimatedBpm <= 150;
  // Extra: SampEn + Poincaré can push moderate to confirmed (#23, #24)
  const boostedAfib = qualityForAfib && clientAfibFlag && (sampEnBoost || poincareBoost)
    && cv > 0.20 && irregularityIndex >= 52 && estimatedBpm >= 50 && estimatedBpm <= 150;

  let classification = "normal";
  if (strongAfib || moderateAfib || boostedAfib) {
    classification = "afib";
  } else {
    const bpmOutOfRange = estimatedBpm < 46 || estimatedBpm > 118;
    const bpVeryHigh = systolic >= 150;
    const rhythmSignificant = irregularityIndex >= 62 && signalQuality >= 55;
    const riskVeryHigh = strokeRiskScore >= 68;
    // Elevate threshold when checklist unchecked (#29)
    const elevatedThreshold = contextUnchecked ? 72 : 68;
    if (bpmOutOfRange || bpVeryHigh || rhythmSignificant || strokeRiskScore >= elevatedThreshold) {
      classification = "elevated";
    }
  }
  if (classification === "normal" && signalQuality < 38) classification = "elevated";

  // BUG#1 FIX: Shock Index handled separately — does NOT force AFib classification
  const shockIndex = evaluateShockIndex(estimatedBpm, systolic);
  // If shock SOS, keep classification as-is but mark shouldTriggerSos=true

  // BUG#3 FIX: tách signalQuality và classificationConfidence
  const signalQualityScore = Math.round(clamp(18, signalQuality, 99));
  const methodsAgreed = [clientAfibFlag, strongAfib, sampEnBoost, poincareBoost].filter(Boolean).length;
  const classificationConfidence = Math.round(clamp(40,
    signalQuality * 0.50 + lightScore * 0.18 + stabilityScore * 0.20
    + (rrIntervals.length > 5 ? 6 : 0) + methodsAgreed * 4, 97));

  const baselineStatus = baseline.complete
    ? `Lệch ${bpmDelta} BPM và ${hrvDelta} điểm HRV so với baseline`
    : "Chưa hoàn thành 3 lần baseline Heart-Print";

  const recommendation = generateRecommendations(classification, { signalQuality, baselineComplete: baseline.complete, shockIndex });

  return {
    type, bpm: estimatedBpm, hrvScore, sdnn, rmssd, pnn50, cv,
    sampEn, sd1, sd2,
    strokeRiskScore, irregularityIndex, lightScore, stabilityScore,
    signalQuality: signalQualityScore,
    confidence: classificationConfidence, // BUG#3: classificationConfidence
    classificationConfidence,
    classification, baselineStatus,
    contextNote, recommendation, waveform, rrIntervals, shockIndex,
    shouldTriggerSos: classification === "afib" || shockIndex.sos,
    generatedAt: new Date().toISOString(),
  };
}

// ─── AFib Episode Tracking ────────────────────────────────────────────────────
// BUG#1 fix: only log REAL AFib (classification === "afib"), not shock index
// #38: estimate episode duration by checking prior measurements
function logAfibEpisode(userId, measurementId, bpm, classification, allMeasurements = []) {
  if (classification !== "afib") return null; // BUG#1: strict guard

  const episodes = readJson("afibEpisodes");
  const now = new Date();

  // #38: check previous measurements within 24h for duration estimation
  const sortedMeasurements = [...allMeasurements]
    .filter(m => m.userId === userId && (m.type === "face" || m.type === "finger"))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  let episodeType = "isolated";
  let durationHours = null;
  let firstAfibAt = now.toISOString();

  // Find consecutive prior AFib measurements within 24h
  const prior = sortedMeasurements.filter(m =>
    m.result?.classification === "afib" &&
    now - new Date(m.createdAt) <= 24 * 3600000
  );
  if (prior.length > 0) {
    const oldest = prior[prior.length - 1];
    firstAfibAt = oldest.createdAt;
    durationHours = Math.round((now - new Date(oldest.createdAt)) / 3600000 * 10) / 10;
  }

  // Classify episode type (#38)
  const allAfibEpisodes = episodes.filter(e => e.userId === userId);
  const daySpan = allAfibEpisodes.length > 0
    ? (now - new Date(allAfibEpisodes[0].detectedAt)) / 86400000
    : 0;
  if (durationHours !== null) {
    if (durationHours < 0.5) episodeType = "paroxysmal_short";
    else if (daySpan < 7) episodeType = "paroxysmal";
    else if (daySpan < 30) episodeType = "persistent";
    else episodeType = "long_standing_persistent";
  }

  const episode = {
    id: crypto.randomUUID(),
    userId, measurementId, bpm,
    detectedAt: now.toISOString(),
    firstAfibAt,
    durationHours,
    episodeType,
    status: "detected",
  };
  episodes.push(episode);
  writeJson("afibEpisodes", episodes);
  return episode;
}

function buildAfibDiseaseSummary(userId) {
  const now = Date.now();
  const episodes = readJson("afibEpisodes").filter((e) => e.userId === userId);
  const last7 = episodes.filter((e) => now - new Date(e.detectedAt).getTime() <= 7 * 86400000);
  const last30 = episodes.filter((e) => now - new Date(e.detectedAt).getTime() <= 30 * 86400000);

  const groupByDay = (eps) => {
    const byDay = {};
    eps.forEach((e) => {
      const day = new Date(e.detectedAt).toLocaleDateString("vi-VN");
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(e);
    });
    return byDay;
  };

  const recentByDay = groupByDay(last7);

  return {
    totalEpisodes: episodes.length,
    last7Days: { count: last7.length, byDay: recentByDay },
    last30Days: { count: last30.length },
    latestEpisode: episodes.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt))[0] || null,
    hasCritical: last7.length >= 3,
  };
}

// ─── Weekly Report ────────────────────────────────────────────────────────────
// BUG#4 fix: accept pre-loaded measurements as parameter instead of re-reading
function buildWeeklyReport(userId, allMeasurements) {
  const measurements = (allMeasurements || readJson("measurements"))
    .filter((m) => m.userId === userId && (m.type === "face" || m.type === "finger"))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const last7 = measurements.filter((m) => Date.now() - new Date(m.createdAt).getTime() <= 7 * 86400000);
  if (!last7.length) return { summary: "Tuần này chưa có dữ liệu đo tim.", averageBpm: null, averageRisk: null, afibAlerts: 0, totalMeasurements: 0, chartPoints: [] };

  return {
    summary: `Tuần này có ${last7.length} phiên đo. Nên giữ lịch đo cùng khung giờ mỗi sáng.`,
    averageBpm: Math.round(average(last7.map((m) => m.result.bpm || 0))),
    averageRisk: Math.round(average(last7.map((m) => m.result.strokeRiskScore || 0))),
    afibAlerts: last7.filter((m) => m.result.classification === "afib").length,
    totalMeasurements: last7.length,
    chartPoints: last7.map((m) => ({ date: m.createdAt, bpm: m.result.bpm, risk: m.result.strokeRiskScore })),
  };
}

// ─── CHA2DS2-VASc Score (#22) ─────────────────────────────────────────────────
function calculateCha2ds2Vasc(user) {
  const age = Number(user.age || 60);
  const gender = user.gender || "other";
  const conditions = normalizeVi((user.conditions || []).join(" "));
  let score = 0;
  if (age >= 75) score += 2;
  else if (age >= 65) score += 1;
  if (gender === "female") score += 1;
  if (/suy tim/.test(conditions)) score += 1;
  if (/cao huyet ap|tang huyet ap/.test(conditions)) score += 1;
  if (/tieu duong|dai thao duong/.test(conditions)) score += 1;
  if (/dot quy|stroke|tia mau nao/.test(conditions)) score += 2;
  if (/benh mach mau|xo vu dong mach|nhoimauco/.test(conditions)) score += 1;
  const riskLevel = score >= 4 ? "CAO" : score >= 2 ? "TRUNG_BINH" : score === 1 ? "THAP" : "RAT_THAP";
  const anticoagRecommend = score >= 2 && gender !== "female"
    ? "Nên dùng thuốc chống đông (hỏi bác sĩ)"
    : score >= 3 && gender === "female"
    ? "Nên dùng thuốc chống đông (hỏi bác sĩ)"
    : "Không bắt buộc chống đông thường quy";
  return { score, riskLevel, anticoagRecommend };
}

// ─── HASBLED Score (#34) ──────────────────────────────────────────────────────
function calculateHasbled(user) {
  const conditions = normalizeVi((user.conditions || []).join(" "));
  const age = Number(user.age || 60);
  let score = 0;
  if (/cao huyet ap|tang huyet ap/.test(conditions)) score += 1;
  if (/suy than|suy gan/.test(conditions)) score += 1;
  if (/dot quy|stroke/.test(conditions)) score += 1;
  if (/chay mau|xuat huyet/.test(conditions)) score += 1;
  if (age >= 65) score += 1;
  const riskLevel = score >= 3 ? "CAO" : score >= 2 ? "TRUNG_BINH" : "THAP";
  return { score, riskLevel, note: score >= 3 ? "Nguy cơ chảy máu cao — cần cân nhắc kỹ trước khi dùng thuốc chống đông" : "" };
}

// ─── Circadian Pattern (#28) ──────────────────────────────────────────────────
function buildCircadianPattern(userId, allMeasurements) {
  const ppg = allMeasurements.filter(m => m.userId === userId && (m.type === "face" || m.type === "finger"));
  if (ppg.length < 5) return null;
  const hourMap = {};
  for (const m of ppg) {
    const h = new Date(m.createdAt).getHours();
    if (!hourMap[h]) hourMap[h] = [];
    hourMap[h].push(m.result?.bpm || 0);
  }
  const hours = Object.entries(hourMap).map(([h, bpms]) => ({
    hour: Number(h),
    avgBpm: Math.round(average(bpms)),
    count: bpms.length,
  })).sort((a, b) => a.hour - b.hour);
  const peakHour = hours.reduce((best, h) => h.avgBpm > (best?.avgBpm || 0) ? h : best, null);
  return { hours, peakHour };
}

// ─── BP Trend (#33) ───────────────────────────────────────────────────────────
function buildBpTrend(userId, allMeasurements) {
  const ppg = allMeasurements
    .filter(m => m.userId === userId && (m.type === "face" || m.type === "finger") && m.result?.systolic)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-20);
  if (!ppg.length) return null;
  const points = ppg.map(m => ({ date: m.createdAt, systolic: m.result.systolic, bpm: m.result.bpm }));
  const latest = points[points.length - 1];
  const alert = latest?.systolic >= 180 ? `CẢNH BÁO: Huyết áp ${latest.systolic} mmHg rất cao!` : null;
  return { points, alert };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
// opts.coords = {lat, lon} từ GPS người dùng (tùy chọn)
async function buildDashboard(userId, opts = {}) {
  const users = readJson("users");
  const user = users.find((u) => u.id === userId);
  if (!user) return null;

  const allMeasurements = readJson("measurements");
  const measurements = allMeasurements.filter((m) => m.userId === userId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const symptoms = readJson("symptoms").filter((m) => m.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const reminders = readJson("reminders").filter((m) => m.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const sosEvents = readJson("sos").filter((m) => m.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const ledger = readJson("ledger").filter((m) => m.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);

  const latestMeasurement = measurements.filter((m) => m.type === "face" || m.type === "finger").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  const latestBreathing = measurements.filter((m) => m.type === "breathing").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;

  const afibBurden7d = calculateAfibBurden(userId, 7);
  const afibBurden30d = calculateAfibBurden(userId, 30);
  const strokePredictor = predictStroke72h(user, measurements);
  const afibDisease = buildAfibDiseaseSummary(userId);
  const weatherAlert = await getWeatherAlert(user, opts.coords || null);

  const baselineBpm = user.baseline?.restingBpm || 72;
  const latestBpm = latestMeasurement?.result?.bpm || baselineBpm;
  const thermalStrain = calculateThermalStrain(weatherAlert?.currentTemp, latestBpm, baselineBpm);

  const pillProtocols = readJson("pillProtocols").filter((p) => p.userId === userId && p.active);
  const pillProtocol = pillProtocols[0] || null; // backward compat field

  // New analytics
  const cha2ds2 = calculateCha2ds2Vasc(user);
  const hasbled = calculateHasbled(user);
  const circadian = buildCircadianPattern(userId, allMeasurements);
  const bpTrend = buildBpTrend(userId, allMeasurements);

  return {
    user: summarizeUser(user),
    measurements: measurements.slice(-8),
    latestMeasurement,
    latestBreathing,
    symptoms: symptoms.slice(0, 8),
    reminders: reminders.slice(0, 8),
    sosEvents: sosEvents.slice(0, 8),
    ledger,
    weeklyReport: buildWeeklyReport(userId, allMeasurements), // BUG#4 fix: pass measurements
    weatherAlert,
    thermalStrain,
    afibBurden7d,
    afibBurden30d,
    strokePredictor,
    afibDisease,
    pillProtocol,
    pillProtocols,
    cha2ds2,
    hasbled,
    circadian,
    bpTrend,
    sync: readJson("sync"),
  };
}

// ─── Doctor Export ────────────────────────────────────────────────────────────
function generateExportToken(userId) {
  const tokens = readJson("exportTokens");
  const token = crypto.randomBytes(18).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  tokens.push({ token, userId, createdAt: new Date().toISOString(), expiresAt });
  writeJson("exportTokens", tokens);
  return token;
}

// ─── ECG-Style Report ─────────────────────────────────────────────────────────
function buildEcgSvg(waveform) {
  if (!waveform?.length) return "<p>Khong co du lieu song</p>";
  const W = 780, H = 160, pad = 10;
  const lines = [];
  for (let x = 0; x < W; x += 20) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#f5c6c6" stroke-width="0.5"/>`);
  for (let y = 0; y < H; y += 20) lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#f5c6c6" stroke-width="0.5"/>`);
  for (let x = 0; x < W; x += 100) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#e8a0a0" stroke-width="1"/>`);
  for (let y = 0; y < H; y += 80) lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#e8a0a0" stroke-width="1"/>`);

  const step = (W - pad * 2) / Math.max(1, waveform.length - 1);
  const minV = Math.min(...waveform), maxV = Math.max(...waveform);
  const span = Math.max(1, maxV - minV);
  const pts = waveform.map((v, i) => {
    const x = (pad + i * step).toFixed(1);
    const y = (H - pad - ((v - minV) / span) * (H - pad * 2)).toFixed(1);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:#fff8f0;border:1px solid #e0c0c0;border-radius:6px;display:block">${lines.join("")}<path d="${pts}" fill="none" stroke="#cc2244" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function buildDoctorExportHtml(dashboard, exportToken) {
  const { user, latestMeasurement, weeklyReport, reminders, symptoms, sosEvents,
    afibBurden7d, afibBurden30d, strokePredictor, afibDisease,
    cha2ds2, hasbled } = dashboard;

  // ── Tính toán thống kê từ toàn bộ lịch sử đo ─────────────────────────────
  const allMeasurements = (dashboard.measurements || [])
    .filter(m => m.type === "face" || m.type === "finger")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const totalMeasurements = allMeasurements.length;
  const afibSessions = allMeasurements.filter(m => m.result?.classification === "afib").length;
  const avgBpm = totalMeasurements
    ? Math.round(allMeasurements.reduce((s, m) => s + (m.result?.bpm || 0), 0) / totalMeasurements)
    : null;
  const rmssdVals = allMeasurements.map(m => m.result?.rmssd || 0).filter(v => v > 0);
  const avgRmssd = rmssdVals.length
    ? Math.round(rmssdVals.reduce((s, v) => s + v, 0) / rmssdVals.length)
    : null;

  // Khoảng thời gian theo dõi
  const firstDate = allMeasurements.length ? new Date(allMeasurements[0].createdAt).toLocaleDateString("vi-VN") : "--";
  const lastDate  = allMeasurements.length ? new Date(allMeasurements[allMeasurements.length - 1].createdAt).toLocaleDateString("vi-VN") : "--";
  const periodStr = totalMeasurements ? `${firstDate} – ${lastDate}` : "Chưa có dữ liệu";

  // Phiên có biến động mạnh nhất (irregularityIndex cao nhất) → dùng cho biểu đồ
  const mostVolatile = allMeasurements.reduce((best, m) =>
    (m.result?.irregularityIndex || 0) > (best?.result?.irregularityIndex || 0) ? m : best,
    allMeasurements[0] || latestMeasurement
  );
  const chartWaveform = mostVolatile?.result?.waveform || latestMeasurement?.result?.waveform || [];
  const chartSqi      = mostVolatile?.result?.signalQuality || latestMeasurement?.result?.signalQuality || "--";
  const chartBpm      = mostVolatile?.result?.bpm || "--";
  const chartDate     = mostVolatile ? new Date(mostVolatile.createdAt).toLocaleDateString("vi-VN") : "--";
  const ecgSvg = buildEcgSvg(chartWaveform);

  // Trạng thái tổng quan
  const hasAfib = afibSessions > 0;
  const overallBadgeClass = hasAfib ? "badge-red" : afibBurden7d?.burden >= 10 ? "badge-orange" : "badge-green";
  const overallStatus = hasAfib
    ? `Phát hiện <strong>${afibSessions}</strong> phiên có dấu hiệu nghi ngờ Rung nhĩ / Loạn nhịp`
    : afibBurden7d?.burden >= 10
      ? `Gánh nặng AFib ở mức cần theo dõi (${afibBurden7d.burden}%)`
      : "Không phát hiện dấu hiệu rung nhĩ trong các phiên đo";

  // Nhật ký triệu chứng
  const symptomRows = symptoms.slice(0, 12).map(s =>
    `<tr><td>${new Date(s.createdAt).toLocaleDateString("vi-VN")}</td>
     <td>${new Date(s.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</td>
     <td>${s.note}</td></tr>`
  ).join("");

  // Lịch sử đo chi tiết
  const historyRows = allMeasurements.slice(-20).reverse().map(m => {
    const cls = m.result?.classification;
    const badge = cls === "afib" ? "badge-red" : cls === "elevated" ? "badge-orange" : "badge-green";
    const label = cls === "afib" ? "AFib" : cls === "elevated" ? "Cần theo dõi" : "Bình thường";
    return `<tr>
      <td>${new Date(m.createdAt).toLocaleDateString("vi-VN")} ${new Date(m.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</td>
      <td>${m.type === "face" ? "Khuôn mặt" : "Ngón Trỏ"}</td>
      <td>${m.result?.bpm || "--"}</td>
      <td>${m.result?.sdnn || m.result?.hrvScore || "--"}</td>
      <td>${m.result?.rmssd || "--"}</td>
      <td><span class="${badge}">${label}</span></td>
    </tr>`;
  }).join("");

  const gender = user.gender === "male" ? "Nam" : user.gender === "female" ? "Nữ" : "Khác";

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"/>
<title>HEARTSENSE – Hồ sơ y khoa – ${user.fullName}</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;color:#18314d;margin:0;padding:28px 36px;font-size:13.5px;line-height:1.5}
/* ── Header ── */
.rpt-header{border-bottom:4px solid #cc2244;margin-bottom:22px;padding-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start}
.rpt-header h1{margin:0 0 6px;color:#cc2244;font-size:20px;font-weight:700}
.rpt-header .meta{font-size:12.5px;color:#444;line-height:1.7}
.rpt-header .logo{text-align:right;font-size:12px;color:#888}
/* ── Cards ── */
.card{border:1px solid #d1dde8;border-radius:10px;padding:16px 18px;margin-bottom:16px;page-break-inside:avoid}
.card-red{border-left:5px solid #cc2244;background:#fffafa}
.card-blue{border-left:5px solid #2a6ec8;background:#f7fbff}
.card-green{border-left:5px solid #1a9e78;background:#f4fdf9}
.card-gray{border-left:5px solid #8899aa;background:#f8fafc}
.card h2{margin:0 0 12px;font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:8px}
.section-num{display:inline-block;background:#cc2244;color:#fff;border-radius:50%;width:22px;height:22px;line-height:22px;text-align:center;font-size:11px;font-weight:700;flex-shrink:0}
.section-num.blue{background:#2a6ec8}
.section-num.green{background:#1a9e78}
.section-num.gray{background:#8899aa}
/* ── Badges ── */
.badge-green{background:#d4f5ea;color:#0a7050;border-radius:4px;padding:2px 9px;font-size:12px;font-weight:600}
.badge-red{background:#fde8ec;color:#cc2244;border-radius:4px;padding:2px 9px;font-size:12px;font-weight:600}
.badge-orange{background:#fef3cd;color:#b06000;border-radius:4px;padding:2px 9px;font-size:12px;font-weight:600}
/* ── Metric grid ── */
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.metric{background:#f8fafc;border-radius:8px;padding:12px;text-align:center;border:1px solid #e4ecf4}
.metric .val{font-size:22px;font-weight:700;color:#cc2244;display:block}
.metric .lbl{font-size:11px;color:#889;margin-top:2px;display:block}
/* ── Table ── */
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12.5px}
th{background:#f0f4fa;font-weight:600;padding:7px 8px;border-bottom:2px solid #d1dde8;text-align:left}
td{padding:6px 8px;border-bottom:1px solid #eaeef4}
tr:last-child td{border-bottom:none}
/* ── Overall status box ── */
.status-box{padding:14px 18px;border-radius:8px;margin-bottom:10px}
.status-box.alert{background:#fde8ec;border:1.5px solid #e8a0a8}
.status-box.warn{background:#fef3cd;border:1.5px solid #e8d090}
.status-box.ok{background:#d4f5ea;border:1.5px solid #88d8b8}
.status-box p{margin:4px 0;font-size:13px}
/* ── Disclaimer ── */
.disclaimer{background:#f4f7fb;border:1px dashed #bbc8d8;border-radius:8px;padding:14px 18px;margin-top:20px;font-size:11.5px;color:#556;line-height:1.7}
.disclaimer strong{display:block;margin-bottom:4px;color:#334;font-size:12px}
.note{font-size:11px;color:#889;margin-top:8px;font-style:italic}
@media print{body{margin:0;padding:20px 28px}.card{page-break-inside:avoid}}
</style></head><body>

<!-- ══ HEADER ════════════════════════════════════════════════════════════════ -->
<div class="rpt-header">
  <div>
    <h1>❤️ HEARTSENSE – Hồ sơ theo dõi tim mạch</h1>
    <div class="meta">
      <strong>Họ tên:</strong> ${user.fullName} &nbsp;|&nbsp;
      <strong>Tuổi / Giới tính:</strong> ${user.age} tuổi / ${gender}<br>
      <strong>Bệnh lý nền:</strong> ${(user.conditions || []).join(", ") || "Chưa khai báo"}<br>
      <strong>Khoảng thời gian:</strong> ${periodStr}<br>
      <strong>Ngày xuất báo cáo:</strong> ${new Date().toLocaleDateString("vi-VN")}
    </div>
  </div>
  <div class="logo">
    HEARTSENSE v4.0<br>
    <span style="font-size:10px">Token: ${exportToken || "direct"}</span>
  </div>
</div>

<!-- ══ SECTION 1: ĐÁNH GIÁ TỔNG QUAN ═══════════════════════════════════════ -->
<div class="card card-red">
  <h2><span class="section-num">1</span> Đánh giá tổng quan <small style="font-size:11px;color:#889;font-weight:400">(Phần quan trọng nhất)</small></h2>
  <div class="status-box ${hasAfib ? "alert" : afibBurden7d?.burden >= 10 ? "warn" : "ok"}">
    <p><strong>● Trạng thái:</strong> ${overallStatus}</p>
    <p><strong>● Khuyến cáo:</strong> Bản báo cáo này có giá trị sàng lọc ban đầu.
      ${hasAfib
        ? "<strong>Vui lòng mang đến gặp bác sĩ chuyên khoa tim mạch để được thăm khám và xác nhận chẩn đoán.</strong>"
        : "Tiếp tục theo dõi định kỳ và gặp bác sĩ nếu có triệu chứng bất thường."}</p>
  </div>
  <div class="grid4" style="margin-top:12px;margin-bottom:0">
    <div class="metric"><span class="val">${totalMeasurements}</span><span class="lbl">Tổng số lần đo</span></div>
    <div class="metric"><span class="val" style="color:${hasAfib?"#cc2244":"#1a9e78"}">${afibSessions}</span><span class="lbl">Phiên nghi ngờ AFib</span></div>
    <div class="metric"><span class="val">${afibBurden7d?.burden || 0}%</span><span class="lbl">AFib Burden (7 ngày)</span></div>
    <div class="metric"><span class="val">${strokePredictor?.probability || "--"}%</span><span class="lbl">Nguy cơ đột quỵ 72h</span></div>
  </div>
</div>

<!-- ══ SECTION 2: BIỂU ĐỒ SÓNG PPG ═════════════════════════════════════════ -->
<div class="card card-blue">
  <h2><span class="section-num blue">2</span> Biểu đồ xung đại diện & Biến thiên nhịp tim</h2>
  <p class="note" style="margin-bottom:8px">
    Phiên có biến động mạnh nhất — Ngày đo: <strong>${chartDate}</strong> &nbsp;|&nbsp;
    Nhịp tim: <strong>${chartBpm} BPM</strong> &nbsp;|&nbsp;
    Độ tin cậy tín hiệu (SQI): <strong>${chartSqi}%</strong>
  </p>
  ${ecgSvg}
  <p class="note">Dữ liệu sóng mạch (rPPG) thu thập qua camera, xử lý bằng thuật toán lọc tín hiệu số POS (Plane Orthogonal to Skin) + Bandpass 0.5–3.5 Hz. Kênh xanh lá cho Face PPG, kênh đỏ cho Finger PPG. Chỉ số HRV tính theo chuẩn SDNN/RMSSD.</p>
</div>

<!-- ══ SECTION 3: BẢNG TÓM TẮT CHỈ SỐ ══════════════════════════════════════ -->
<div class="card card-green">
  <h2><span class="section-num green">3</span> Bảng tóm tắt chỉ số chi tiết</h2>
  <div class="grid4" style="margin-bottom:14px">
    <div class="metric"><span class="val">${avgBpm || "--"}</span><span class="lbl">Nhịp tim TB (BPM)</span></div>
    <div class="metric"><span class="val">${avgRmssd || "--"}</span><span class="lbl">HRV rMSSD TB (ms)</span></div>
    <div class="metric"><span class="val">${afibBurden30d?.burden || 0}%</span><span class="lbl">AFib Burden (30 ngày)</span></div>
    <div class="metric"><span class="val">${latestMeasurement?.result?.strokeRiskScore || "--"}</span><span class="lbl">Stroke Risk Score</span></div>
  </div>
  <table>
    <thead><tr><th>Ngày &amp; Giờ</th><th>Phương pháp</th><th>BPM</th><th>SDNN (ms)</th><th>rMSSD (ms)</th><th>Kết quả</th></tr></thead>
    <tbody>${historyRows || "<tr><td colspan='6' style='text-align:center;color:#889'>Chưa có dữ liệu đo</td></tr>"}</tbody>
  </table>
  <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div>
      <strong style="font-size:12.5px">Gánh nặng Rung nhĩ (AFib Burden)</strong>
      <p style="margin:4px 0">7 ngày: <span class="${afibBurden7d?.burden >= 25 ? "badge-red" : afibBurden7d?.burden >= 10 ? "badge-orange" : "badge-green"}">${afibBurden7d?.burden || 0}% (${afibBurden7d?.afibCount || 0}/${afibBurden7d?.total || 0} lần)</span></p>
      <p style="margin:4px 0">30 ngày: <span class="${afibBurden30d?.burden >= 25 ? "badge-red" : "badge-orange"}">${afibBurden30d?.burden || 0}% (${afibBurden30d?.afibCount || 0}/${afibBurden30d?.total || 0} lần)</span></p>
      <p style="margin:4px 0">Xu hướng: ${afibBurden7d?.trend === "increasing" ? "⬆️ Tăng — Cần gặp bác sĩ" : afibBurden7d?.trend === "decreasing" ? "⬇️ Giảm (tiến triển tốt)" : "➡️ Ổn định"}</p>
    </div>
    <div>
      <strong style="font-size:12.5px">Dự báo nguy cơ đột quỵ 72h</strong>
      <p style="margin:4px 0">Xác suất: <span class="${strokePredictor?.probability >= 60 ? "badge-red" : strokePredictor?.probability >= 35 ? "badge-orange" : "badge-green"}">${strokePredictor?.probability || "--"}%</span> — Mức: ${strokePredictor?.level === "CAO" ? "⚠️ CAO" : strokePredictor?.level === "TRUNG_BINH" ? "Trung bình" : "✅ Thấp"}</p>
      <p style="margin:4px 0;font-size:12px;color:#556">${strokePredictor?.recommendation || ""}</p>
    </div>
  </div>
</div>

<!-- ══ SECTION 4: NHẬT KÝ TRIỆU CHỨNG ══════════════════════════════════════ -->
<div class="card card-gray">
  <h2><span class="section-num gray">4</span> Nhật ký triệu chứng người dùng</h2>
  ${symptoms.length ? `
  <table>
    <thead><tr><th>Ngày</th><th>Giờ</th><th>Triệu chứng ghi nhận</th></tr></thead>
    <tbody>${symptomRows}</tbody>
  </table>` : `<p style="color:#889;margin:0">Chưa có nhật ký triệu chứng. Người dùng có thể ghi chú trực tiếp trong ứng dụng.</p>`}
  ${reminders.length ? `
  <div style="margin-top:14px">
    <strong style="font-size:12.5px">Lịch nhắc thuốc</strong>
    <ul style="margin:6px 0;padding-left:18px;font-size:12.5px">
      ${reminders.map(r => `<li>${r.medicineName} – ${r.time}${r.dose ? " – " + r.dose : ""}${r.pillColor ? " – <strong>" + r.pillColor + "</strong>" : ""}</li>`).join("")}
    </ul>
  </div>` : ""}
</div>

<!-- ══ SECTION 5: CHA2DS2-VASc + HASBLED ═════════════════════════════════════ -->
${cha2ds2 ? `
<div class="card card-gray">
  <h2><span class="section-num gray">5</span> Điểm nguy cơ CHA2DS2-VASc &amp; HAS-BLED</h2>
  <div class="grid4" style="margin-bottom:12px">
    <div class="metric"><span class="val" style="color:${cha2ds2.score>=4?"#cc2244":cha2ds2.score>=2?"#d97706":"#059669"}">${cha2ds2.score}</span><span class="lbl">CHA2DS2-VASc</span></div>
    <div class="metric"><span class="val">${cha2ds2.riskLevel}</span><span class="lbl">Mức nguy cơ đột quỵ</span></div>
    ${hasbled ? `<div class="metric"><span class="val" style="color:${hasbled.score>=3?"#cc2244":"#059669"}">${hasbled.score}</span><span class="lbl">HAS-BLED</span></div>
    <div class="metric"><span class="val">${hasbled.riskLevel}</span><span class="lbl">Nguy cơ chảy máu</span></div>` : ""}
  </div>
  <p style="font-size:12.5px;margin:4px 0"><strong>Khuyến cáo chống đông:</strong> ${cha2ds2.anticoagRecommend}</p>
  ${hasbled?.note ? `<p style="font-size:12px;color:#cc2244;margin:4px 0">${hasbled.note}</p>` : ""}
  <p class="note">CHA2DS2-VASc và HAS-BLED là công cụ sàng lọc ban đầu. Quyết định điều trị cần bác sĩ tim mạch.</p>
</div>` : ""}

<!-- ══ TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM Y TẾ ══════════════════════════════════ -->
<div class="disclaimer">
  <strong>⚕️ Tuyên bố miễn trừ trách nhiệm y tế (Bắt buộc đọc)</strong>
  Báo cáo này được tạo tự động bởi hệ thống HEARTSENSE v4.0 dựa trên dữ liệu đo lường từ camera (PPG/rPPG — Photoplethysmography).
  <strong>Đây KHÔNG phải là chẩn đoán y tế.</strong> Kết quả chỉ mang tính chất sàng lọc tham khảo ban đầu và cần được xác nhận bởi bác sĩ chuyên khoa tim mạch thông qua các phương tiện y tế được chứng nhận (Holter ECG, siêu âm tim...).
  Không sử dụng báo cáo này để tự điều trị hoặc thay thế lời khuyên của bác sĩ. Trong trường hợp khẩn cấp, hãy gọi 115 hoặc đến cơ sở y tế gần nhất.
  <br><br>
  <span style="font-size:11px">HEARTSENSE v4.0 &nbsp;|&nbsp; Xuất ngày: ${new Date().toLocaleString("vi-VN")} &nbsp;|&nbsp; Token: ${exportToken || "direct"}</span>
</div>

</body></html>`;
}

// ─── Printable Report ─────────────────────────────────────────────────────────
function buildPrintableReport(dashboard) {
  const token = generateExportToken(dashboard.user.id);
  return buildDoctorExportHtml(dashboard, token);
}

// ─── Request Handlers ─────────────────────────────────────────────────────────
function handleRegister(body, res) {
  const users = readJson("users");
  if (users.find((u) => u.email === body.email)) { sendJson(res, 409, { error: "Email đã tồn tại." }); return; }
  const user = {
    id: crypto.randomUUID(),
    fullName: body.fullName || "Nguoi dung HEARTSENSE",
    email: body.email || "",
    age: Number(body.age || 60),
    gender: body.gender || "other",
    conditions: parseConditions(body.conditions),
    guardian: { guardianName: "", guardianPhone: "", guardianEmail: "", status: "not_configured", channels: [] },
    weatherQuery: WEATHER_DEFAULT_QUERY,
    baseline: { sessions: [], restingBpm: null, hrvScore: null, regularityScore: null, complete: false },
    pillProtocol: null,
    password: hashPassword(body.password || ""),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeJson("users", users);
  const sessions = readJson("sessions");
  const token = crypto.randomBytes(24).toString("hex");
  // #8: session TTL
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  writeJson("sessions", sessions);
  appendLedgerEntry(user.id, "auth.register", "Khoi tao tai khoan", { email: user.email });
  sendJson(res, 201, { token, user: summarizeUser(user) });
}

function handleLogin(body, res) {
  const email = body.email || "";
  // #19: rate limiting
  if (!checkLoginRateLimit(email)) {
    sendJson(res, 429, { error: "Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút." });
    return;
  }
  const users = readJson("users");
  const user = users.find((u) => u.email === email);
  if (!user || !verifyPassword(body.password || "", user.password)) {
    recordLoginFailure(email);
    sendJson(res, 401, { error: "Thông tin đăng nhập không đúng." });
    return;
  }
  clearLoginAttempts(email);
  const sessions = readJson("sessions");
  const token = crypto.randomBytes(24).toString("hex");
  // #8: session TTL
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  writeJson("sessions", sessions);
  appendLedgerEntry(user.id, "auth.login", "Dang nhap thanh cong");
  sendJson(res, 200, { token, user: summarizeUser(user) });
}

function handleSession(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Session không hợp lệ." }); return; }
  sendJson(res, 200, { user: summarizeUser(user) });
}

function handleGuardian(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const users = readJson("users");
  const user = users.find((u) => u.id === session?.userId);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const guardianPhone = String(body.guardianPhone || "").trim();
  const guardianEmail = String(body.guardianEmail || "").trim();
  const existingSchedule = user.guardian?.reportSchedule || {};
  user.guardian = {
    guardianName: String(body.guardianName || "").trim(),
    guardianPhone, guardianEmail,
    status: guardianPhone || guardianEmail ? "confirmation_sent" : "not_configured",
    channels: [guardianPhone ? "sms" : null, guardianEmail ? "email" : null].filter(Boolean),
    updatedAt: new Date().toISOString(),
    reportSchedule: {
      enabled: body.autoReportEnabled === true || body.autoReportEnabled === "on" || body.autoReportEnabled === "true",
      time: /^\d{2}:\d{2}$/.test(String(body.autoReportTime || "")) ? body.autoReportTime : existingSchedule.time || "08:00",
      notifyOnMeasurement: body.notifyOnMeasurement === true || body.notifyOnMeasurement === "on" || body.notifyOnMeasurement === "true",
      lastSentDate: existingSchedule.lastSentDate || null,
      lastSentAt: existingSchedule.lastSentAt || null,
    },
  };
  writeJson("users", users);
  appendLedgerEntry(user.id, "guardian.update", "Cap nhat guardian", user.guardian);
  sendJson(res, 200, {
    guardian: user.guardian,
    messages: [
      guardianEmail ? `Email guardian da luu: ${guardianEmail}.` : null,
      guardianPhone ? `So dien thoai guardian da luu: ${guardianPhone}.` : null,
    ].filter(Boolean),
  });
}

async function handleCreateMeasurement(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }

  const type = body.type === "finger" ? "finger" : "face";
  const result = analyzeMeasurement({ user, type, payload: body.payload || {} });
  let measurements = readJson("measurements");
  const record = { id: crypto.randomUUID(), userId: user.id, type, payload: body.payload || {}, result, notes: [], createdAt: new Date().toISOString() };
  measurements.push(record);

  // #15: Prune to 1000 records, archive older ones
  const userMeasurements = measurements.filter(m => m.userId === user.id);
  if (userMeasurements.length > 1000) {
    const toArchive = userMeasurements.slice(0, userMeasurements.length - 1000);
    const toKeep = userMeasurements.slice(userMeasurements.length - 1000);
    const otherMeasurements = measurements.filter(m => m.userId !== user.id);
    measurements = [...otherMeasurements, ...toKeep];
    // Archive
    try {
      const archivePath = require("path").join(__dirname, "data", "measurements_archive.json");
      let archive = [];
      try { archive = JSON.parse(require("fs").readFileSync(archivePath, "utf8")); } catch {}
      archive.push(...toArchive);
      require("fs").writeFileSync(archivePath, JSON.stringify(archive));
    } catch {}
  }
  writeJson("measurements", measurements);

  // BUG#1 fix: only log AFib episodes for real AFib (not shock index)
  if (result.classification === "afib") {
    logAfibEpisode(user.id, record.id, result.bpm, result.classification, measurements);
  }

  appendLedgerEntry(user.id, "measurement.created", `Luu phien do ${type}`, { classification: result.classification, strokeRiskScore: result.strokeRiskScore });

  const dashboard = await buildDashboard(user.id);

  // Check pill-in-pocket trigger — all active protocols
  let pillAlert = null;
  if (result.classification === "afib") {
    const activeProtocols = readJson("pillProtocols").filter(p => p.userId === user.id && p.active);
    if (activeProtocols.length > 0) {
      const names = activeProtocols.map(p => p.medicineName).join(", ");
      pillAlert = {
        triggered: true,
        protocols: activeProtocols.map(p => ({ medicineName: p.medicineName, dose: p.dose, instructions: p.instructions })),
        message: activeProtocols.length === 1
          ? `Phát hiện AFib! Uống thuốc: ${activeProtocols[0].medicineName} ${activeProtocols[0].dose}`
          : `Phát hiện AFib! ${activeProtocols.length} thuốc theo phác đồ: ${names}`,
      };
    }
  }

  sendJson(res, 201, { measurement: record, dashboard, pillAlert });

  // Gửi email thông báo ngay cho người thân (fire-and-forget, không block response)
  sendGuardianMeasurementNotification(user, record, dashboard).catch(() => {});
}

async function handleMeasurementContext(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const measurements = readJson("measurements");
  const record = measurements.find((m) => m.id === body.measurementId && m.userId === user.id);
  if (!record) { sendJson(res, 404, { error: "Không tìm thấy phiên đo." }); return; }
  record.notes = Array.isArray(record.notes) ? record.notes : [];
  record.notes.push({ reason: String(body.reason || "none"), createdAt: new Date().toISOString() });
  writeJson("measurements", measurements);
  const symptoms = readJson("symptoms");
  symptoms.push({ id: crypto.randomUUID(), userId: user.id, note: `Note: ${body.reason || "none"}`, createdAt: new Date().toISOString() });
  writeJson("symptoms", symptoms);
  appendLedgerEntry(user.id, "measurement.context", "Luu ly do bat thuong", { reason: body.reason });
  sendJson(res, 200, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleRecordBaseline(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const users = readJson("users");
  const user = users.find((u) => u.id === session?.userId);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const latest = readJson("measurements").filter((m) => m.userId === user.id && (m.type === "face" || m.type === "finger")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!latest) { sendJson(res, 400, { error: "Cần có ít nhất một phiên đo trước khi ghi baseline." }); return; }

  // #13: only allow if latest measurement is within 10 minutes
  const measuredAgo = Date.now() - new Date(latest.createdAt).getTime();
  if (measuredAgo > 10 * 60 * 1000) {
    sendJson(res, 400, { error: "Lần đo gần nhất đã quá 10 phút. Vui lòng đo lại trước khi ghi baseline." });
    return;
  }

  const sessions = Array.isArray(user.baseline?.sessions) ? user.baseline.sessions.slice(-2) : [];
  const bs = {
    measurementId: latest.id, bpm: latest.result.bpm, hrvScore: latest.result.hrvScore,
    sdnn: latest.result.sdnn || 0, rmssd: latest.result.rmssd || 0,
    cv: latest.result.cv || 0, // #25: store CV for adaptive thresholds
    irregularityIndex: latest.result.irregularityIndex, createdAt: new Date().toISOString()
  };
  sessions.push(bs);

  // #25: compute CV mean and std for adaptive thresholds
  const cvValues = sessions.map(s => s.cv || 0).filter(v => v > 0);
  const cvMean = cvValues.length ? cvValues.reduce((a, b) => a + b, 0) / cvValues.length : 0;
  const cvStd = cvValues.length > 1
    ? Math.sqrt(cvValues.map(v => (v - cvMean) ** 2).reduce((a, b) => a + b, 0) / cvValues.length)
    : 0.03;

  user.baseline = {
    sessions,
    restingBpm: sessions.length >= 3 ? Math.round(average(sessions.map((s) => s.bpm))) : null,
    hrvScore: sessions.length >= 3 ? Math.round(average(sessions.map((s) => s.hrvScore))) : null,
    sdnn: sessions.length >= 3 ? Math.round(average(sessions.map((s) => s.sdnn || 0))) : null,
    regularityScore: sessions.length >= 3 ? 100 - Math.round(average(sessions.map((s) => s.irregularityIndex))) : null,
    cvMean: Math.round(cvMean * 1000) / 1000, // #25
    cvStd: Math.round(cvStd * 1000) / 1000,   // #25
    complete: sessions.length >= 3,
    updatedAt: new Date().toISOString(),
  };
  writeJson("users", users);
  appendLedgerEntry(user.id, "baseline.recorded", "Luu lan Heart-Print", { count: sessions.length });
  sendJson(res, 200, { baseline: user.baseline, dashboard: await buildDashboard(user.id) });
}

async function handleCreateBreathing(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const durationSeconds = clamp(30, Number(body.payload?.durationSeconds || 60), 600);
  const cycles = clamp(1, Number(body.payload?.cycles || 4), 60);
  const coherenceGain = clamp(4, Math.round(durationSeconds / 12 + cycles * 2), 38);
  const measurements = readJson("measurements");
  measurements.push({ id: crypto.randomUUID(), userId: user.id, type: "breathing", payload: body.payload || {}, result: { durationSeconds, cycles, coherenceGain, recommendation: "Duy tri 1-2 lan/ngay de giam cang thang va cai thien HRV." }, createdAt: new Date().toISOString() });
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "breathing.completed", "Hoan thanh breathing coach", { durationSeconds });
  sendJson(res, 201, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleSymptom(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }

  const SYMPTOM_LABELS = {
    hoi_hop: "Hồi hộp/tim đập nhanh",
    kho_tho: "Khó thở",
    chong_mat: "Chóng mặt/choáng",
    tuc_nguc: "Tức ngực/đau ngực",
    met_moi: "Mệt mỏi bất thường",
    te_tay: "Tê tay/tê chân",
    dau_dau: "Đau đầu dữ dội",
    ngat_xiu: "Gần ngất/ngất xỉu",
  };
  const CRITICAL_SYMPTOMS = new Set(["tuc_nguc", "ngat_xiu", "kho_tho"]);

  const rawSymptoms = Array.isArray(body.symptoms)
    ? body.symptoms.filter(s => SYMPTOM_LABELS[s])
    : [];
  const note = String(body.note || "").trim().slice(0, 300);
  const isCritical = rawSymptoms.some(s => CRITICAL_SYMPTOMS.has(s));
  const labels = rawSymptoms.map(s => SYMPTOM_LABELS[s]);
  const displayNote = [...labels, ...(note ? [note] : [])].join(" | ") || "Ghi chú tự do";

  const symptoms = readJson("symptoms");
  const entry = {
    id: crypto.randomUUID(), userId: user.id,
    symptoms: rawSymptoms, note: displayNote, isCritical,
    createdAt: new Date().toISOString(),
  };
  symptoms.push(entry);
  writeJson("symptoms", symptoms);
  appendLedgerEntry(user.id, "symptom.created", "Them nhat ky trieu chung", { symptoms: rawSymptoms, isCritical });
  sendJson(res, 201, { ok: true, isCritical, dashboard: await buildDashboard(user.id) });
}

async function handleReminder(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const reminders = readJson("reminders");
  const medicineName = String(body.medicineName || body.sourceImageName || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Thuoc khong ro ten";
  reminders.push({
    id: crypto.randomUUID(), userId: user.id, medicineName,
    time: body.time || "08:00",
    dose: body.dose || "",
    pillColor: body.pillColor || "",
    pillDescription: body.pillDescription || "",
    sourceImageName: body.sourceImageName || "",
    channel: "email-notification",
    createdAt: new Date().toISOString(),
  });
  writeJson("reminders", reminders);
  appendLedgerEntry(user.id, "reminder.created", "Tao lich nhac thuoc", { medicineName, time: body.time });
  sendJson(res, 201, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleTriggerSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }

  // Chống double-trigger: nếu đã có SOS trong vòng 30 giây thì không gửi lại
  const sosEvents = readJson("sos");
  const recentSos = sosEvents.find(e => e.userId === user.id && e.status === "triggered"
    && Date.now() - new Date(e.createdAt).getTime() < 30000);
  if (recentSos) {
    sendJson(res, 200, { sos: recentSos, messages: ["SOS đã được gửi trước đó (trong vòng 30 giây)."], dashboard: await buildDashboard(user.id) });
    return;
  }

  const guardian = user.guardian || {};
  const channelSet = new Set();
  if (guardian.guardianPhone) { channelSet.add("sms"); channelSet.add("zalo"); }
  if (guardian.guardianEmail) channelSet.add("email");
  channelSet.add("web-notification");
  const locationInfo = body.location
    ? `<p><strong>Vị trí:</strong> <a href="https://maps.google.com/?q=${encodeURIComponent(body.location)}">${escHtml(body.location)}</a></p>`
    : "";
  const emailResult = await sendResendEmailWithRetry({ // #6: retry
    to: guardian.guardianEmail,
    subject: `🚨 HEARTSENSE SOS KHẨN CẤP – ${escHtml(user.fullName)}`,
    html: `<div style="font-family:Arial;padding:20px;border:3px solid #cc2244;border-radius:10px;max-width:500px">
      <h2 style="color:#cc2244">⚠️ HEARTSENSE – CẢNH BÁO KHẨN CẤP</h2>
      <p><strong>Bệnh nhân:</strong> ${escHtml(user.fullName)} (${escHtml(String(user.age))} tuổi)</p>
      <p><strong>Lý do:</strong> ${escHtml(body.reason || "Phát hiện AFib / nguy cơ cao")}</p>
      <p><strong>Thời gian:</strong> ${new Date().toLocaleString("vi-VN")}</p>
      ${locationInfo}
      <p style="background:#fde8ec;padding:12px;border-radius:6px"><strong>Hành động:</strong> Vui lòng liên hệ ngay với người dùng. Nếu không liên lạc được, gọi cấp cứu 115.</p>
      <p style="color:#666;font-size:12px">HEARTSENSE – Hệ thống giám sát tim mạch chủ động</p>
    </div>`,
  });

  const record = {
    id: crypto.randomUUID(), userId: user.id,
    reason: body.reason || "Cảnh báo AFib / nguy cơ cao",
    status: "triggered",
    channels: [...channelSet],
    delivery: { email: emailResult },
    createdAt: new Date().toISOString(),
  };
  sosEvents.push(record);
  writeJson("sos", sosEvents);
  appendLedgerEntry(user.id, "sos.triggered", "Kich hoat hanh lang xanh", record);

  sendJson(res, 201, {
    sos: record,
    messages: [
      guardian.guardianEmail ? (emailResult.sent ? `Email SOS đã gửi đến ${guardian.guardianEmail}.` : `Chưa gửi email (${emailResult.reason}).`) : "Chưa có email guardian.",
      "Thông báo web đã tạo.",
    ],
    dashboard: await buildDashboard(user.id),
  });
}

async function handleCancelSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const sosEvents = readJson("sos");
  const latest = [...sosEvents].reverse().find((e) => e.userId === user.id && e.status === "triggered");
  if (latest) { latest.status = "cancelled"; latest.cancelledAt = new Date().toISOString(); writeJson("sos", sosEvents); }
  appendLedgerEntry(user.id, "sos.cancelled", "Nguoi dung xac nhan toi on");
  sendJson(res, 200, { ok: true, dashboard: await buildDashboard(user.id) });
}

async function handleDashboard(urlObject, body, res, userId) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session || session.userId !== userId) { sendJson(res, 401, { error: "Khong du quyen." }); return; }
  // Nhận tọa độ GPS từ frontend (nếu người dùng đã cấp quyền vị trí)
  const lat = parseFloat(body.lat);
  const lon = parseFloat(body.lon);
  const coords = (!isNaN(lat) && !isNaN(lon)) ? { lat, lon } : null;
  const dashboard = await buildDashboard(userId, { coords });
  if (!dashboard) { sendJson(res, 404, { error: "Khong tim thay nguoi dung." }); return; }
  sendJson(res, 200, dashboard);
}

async function handleReport(urlObject, res, userId) {
  const session = getSessionFromRequest(urlObject);
  if (!session || session.userId !== userId) { sendText(res, 401, "Unauthorized"); return; }
  const dashboard = await buildDashboard(userId);
  if (!dashboard) { sendText(res, 404, "Not found"); return; }
  sendText(res, 200, buildPrintableReport(dashboard), "text/html; charset=utf-8");
}

async function handleDoctorExport(urlObject, res, userId) {
  const tokenParam = urlObject.searchParams.get("token");
  const exportTokenParam = urlObject.searchParams.get("export_token");
  let authorized = false;

  if (exportTokenParam) {
    const tokens = readJson("exportTokens");
    const found = tokens.find((t) => t.token === exportTokenParam && t.userId === userId && new Date(t.expiresAt) > new Date());
    authorized = Boolean(found);
  } else if (tokenParam) {
    const session = getSessionFromRequest(urlObject);
    authorized = session?.userId === userId;
  }

  if (!authorized) { sendText(res, 401, "Unauthorized"); return; }
  const dashboard = await buildDashboard(userId);
  if (!dashboard) { sendText(res, 404, "Not found"); return; }
  const token = exportTokenParam || generateExportToken(userId);
  sendText(res, 200, buildDoctorExportHtml(dashboard, token), "text/html; charset=utf-8");
}

async function handleGenerateExportToken(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const token = generateExportToken(user.id);
  const exportUrl = `${urlObject.origin || ""}/api/users/${user.id}/doctor-export?export_token=${token}`;
  appendLedgerEntry(user.id, "export.generated", "Tao export token");
  sendJson(res, 201, { token, exportUrl, expiresInDays: 30 });
}

async function handleCheckInteractions(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const drugs = Array.isArray(body.drugs) ? body.drugs : [body.drugs].filter(Boolean);
  if (!drugs.length) { sendJson(res, 400, { error: "Cần cung cấp danh sách thuốc." }); return; }
  const result = checkDrugInteractions(drugs);
  sendJson(res, 200, result);
}

async function handleSavePillProtocol(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const users = readJson("users");
  const user = users.find((u) => u.id === session?.userId);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }

  const allProtocols = readJson("pillProtocols");

  // Delete action
  if (body.action === "delete" && body.protocolId) {
    const updated = allProtocols.filter(p => !(p.userId === user.id && p.id === body.protocolId));
    writeJson("pillProtocols", updated);
    const remaining = updated.filter(p => p.userId === user.id && p.active);
    user.pillProtocol = remaining[0] || null;
    writeJson("users", users);
    sendJson(res, 200, { ok: true, dashboard: await buildDashboard(user.id) });
    return;
  }

  // Add new protocol (keep existing ones — supports multiple)
  const medicineName = String(body.medicineName || "").trim();
  if (!medicineName) { sendJson(res, 400, { error: "Tên thuốc không được để trống." }); return; }
  const protocol = {
    id: crypto.randomUUID(), userId: user.id,
    medicineName,
    dose: String(body.dose || "").trim(),
    instructions: String(body.instructions || "").trim(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  allProtocols.push(protocol);
  writeJson("pillProtocols", allProtocols);
  const userProtocols = allProtocols.filter(p => p.userId === user.id && p.active);
  user.pillProtocol = userProtocols[0] || null; // backward compat
  writeJson("users", users);
  appendLedgerEntry(user.id, "pill_protocol.saved", "Luu phac do pill-in-pocket", { medicineName: protocol.medicineName, total: userProtocols.length });
  sendJson(res, 201, { protocol, dashboard: await buildDashboard(user.id) });
}

async function handleSendRemoteParentReport(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const guardian = user.guardian || {};
  if (!guardian.guardianEmail) { sendJson(res, 400, { error: "Chưa cấu hình email guardian." }); return; }

  const dashboard = await buildDashboard(user.id);
  const latest = dashboard.latestMeasurement;
  const status = latest?.result?.classification === "afib" ? "⚠️ CÓ CẢNH BÁO" : latest?.result?.classification === "elevated" ? "Theo dõi" : "Bình thường";
  const personalMessage = String(body.personalMessage || "").trim().slice(0, 500);

  const emailResult = await sendResendEmail({
    to: guardian.guardianEmail,
    subject: `HEARTSENSE – Báo cáo hàng ngày: ${user.fullName} – ${new Date().toLocaleDateString("vi-VN")}`,
    html: buildReportEmailHtml(user, latest, status, dashboard, personalMessage),
  });

  appendLedgerEntry(user.id, "remote_parent.sent", "Gửi báo cáo đến guardian", { hasMessage: Boolean(personalMessage) });
  sendJson(res, 200, { sent: emailResult.sent, message: emailResult.sent ? `Báo cáo đã gửi đến ${guardian.guardianEmail}` : `Chưa gửi được (${emailResult.reason})` });
}

// ─── Cron Scheduler (#7, #16, #Fix-E) ────────────────────────────────────────
// Extracted so it can be called both by setInterval AND by /api/cron (external ping)
async function runSchedulerCheck() {
  const nowUTC = new Date();
  const vnNow = new Date(nowUTC.getTime() + 7 * 3600000); // UTC+7
  const vnHour = vnNow.getUTCHours();
  const vnMinute = vnNow.getUTCMinutes();
  const vnDateStr = vnNow.toISOString().slice(0, 10);
  const vnTimeStr = `${String(vnHour).padStart(2, "0")}:${String(vnMinute).padStart(2, "0")}`;
  const vnTotalMin = vnHour * 60 + vnMinute;

  const users = readJson("users");

  // ── Auto daily report ──────────────────────────────────────────────────────
  for (const user of users) {
    const schedule = user.guardian?.reportSchedule;
    if (!schedule?.enabled || !user.guardian?.guardianEmail) continue;
    if (schedule.lastSentDate === vnDateStr) continue; // already sent today

    const schedTime = schedule.time || "08:00";
    const [sh, sm] = schedTime.split(":").map(Number);
    const schedTotalMin = sh * 60 + sm;

    // Send at exact minute OR catch up if server was asleep (up to 23h55 window)
    const isOnTime = vnTimeStr === schedTime;
    const isMissed = vnTotalMin > schedTotalMin; // past scheduled time, not yet sent
    if (!isOnTime && !isMissed) continue;

    try {
      const dashboard = await buildDashboard(user.id);
      const latest = dashboard.latestMeasurement;
      const status = latest?.result?.classification === "afib" ? "⚠️ CÓ CẢNH BÁO"
        : latest?.result?.classification === "elevated" ? "Theo dõi" : "Bình thường";
      const emailResult = await sendResendEmailWithRetry({
        to: user.guardian.guardianEmail,
        subject: `HEARTSENSE – Báo cáo tự động: ${escHtml(user.fullName)} – ${vnNow.toLocaleDateString("vi-VN")}`,
        html: buildReportEmailHtml(user, latest, status, dashboard),
      });
      if (emailResult.sent) {
        const allUsers = readJson("users");
        const u = allUsers.find((x) => x.id === user.id);
        if (u?.guardian?.reportSchedule) {
          u.guardian.reportSchedule.lastSentDate = vnDateStr;
          u.guardian.reportSchedule.lastSentAt = nowUTC.toISOString();
          writeJson("users", allUsers);
        }
        appendLedgerEntry(user.id, "remote_parent.auto_sent", "Tu dong gui bao cao theo lich", { email: user.guardian.guardianEmail, scheduledTime: schedTime, catchUp: isMissed });
        console.log(`[AutoReport] ${isMissed ? "[catch-up]" : ""} Gui den ${user.guardian.guardianEmail} cho ${user.fullName}`);
      }
    } catch (err) {
      console.error(`[AutoReport] Loi user ${user.id}: ${err.message}`);
    }
  }

  // ── Medication reminders ─────────────────────────────────────────────────────
  const reminders = readJson("reminders");
  for (const reminder of reminders) {
    if (!reminder.time) continue;
    const user = users.find(u => u.id === reminder.userId);
    if (!user) continue;
    const [rh, rm] = reminder.time.split(":").map(Number);
    const remTotalMin = rh * 60 + rm;
    const isOnTime = vnTimeStr === reminder.time;
    const isMissed = vnTotalMin > remTotalMin && reminder.lastReminderDate !== vnDateStr;
    if (!isOnTime && !isMissed) continue;
    if (reminder.lastReminderDate === vnDateStr) continue;

    try {
      const guardianEmail = user.guardian?.guardianEmail;
      if (guardianEmail) {
        await sendResendEmailWithRetry({
          to: guardianEmail,
          subject: `HEARTSENSE – Nhắc thuốc: ${escHtml(reminder.medicineName)} – ${user.fullName}`,
          html: `<div style="font-family:Arial;padding:20px;max-width:500px">
            <h3 style="color:#0f766e">💊 Nhắc uống thuốc</h3>
            <p><strong>Bệnh nhân:</strong> ${escHtml(user.fullName)}</p>
            <p><strong>Thuốc:</strong> ${escHtml(reminder.medicineName)}</p>
            <p><strong>Liều:</strong> ${escHtml(reminder.dose || "Theo chỉ định")}</p>
            <p><strong>Giờ:</strong> ${escHtml(reminder.time)}</p>
            ${reminder.pillColor ? `<p><strong>Màu viên:</strong> ${escHtml(reminder.pillColor)}</p>` : ""}
            <p style="color:#999;font-size:11px">HEARTSENSE – Nhắc thuốc tự động</p>
          </div>`,
        });
      }
      reminder.lastReminderDate = vnDateStr;
    } catch (err) {
      console.error(`[MedReminder] Loi reminder ${reminder.id}: ${err.message}`);
    }
  }
  writeJson("reminders", reminders);
}

function startAutoReportScheduler() {
  setInterval(() => runSchedulerCheck().catch(err => console.error("[Cron]", err.message)), 60000);
  console.log("[Cron] Scheduler khởi động – kiểm tra mỗi phút. Cũng nhận ping từ /api/cron.");
}

// ─── External cron ping endpoint (#Fix-E) ─────────────────────────────────────
// Dùng cron-job.org hoặc UptimeRobot để ping /api/cron?secret=<CRON_SECRET> mỗi 5–10 phút
// → giữ server thức + chạy bù báo cáo nếu server vừa ngủ dậy
async function handleCronPing(urlObject, res) {
  const secret = urlObject.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    sendJson(res, 403, { error: "Forbidden" }); return;
  }
  await runSchedulerCheck();
  sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
}

// ─── Medication Adherence (#30) ───────────────────────────────────────────────
async function handleMedicationAdherence(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const reminders = readJson("reminders");
  const reminder = reminders.find(r => r.id === body.reminderId && r.userId === user.id);
  if (!reminder) { sendJson(res, 404, { error: "Không tìm thấy nhắc thuốc." }); return; }
  if (!reminder.adherence) reminder.adherence = {};
  const dateKey = String(body.date || new Date().toISOString().slice(0, 10));
  reminder.adherence[dateKey] = Boolean(body.taken);
  writeJson("reminders", reminders);
  const totalDays = Object.keys(reminder.adherence).length;
  const takenDays = Object.values(reminder.adherence).filter(Boolean).length;
  const adherencePct = totalDays ? Math.round((takenDays / totalDays) * 100) : 0;
  appendLedgerEntry(user.id, "medication.adherence", "Xac nhan uong thuoc", { reminderId: body.reminderId, taken: body.taken, date: dateKey });
  sendJson(res, 200, { ok: true, adherencePct, takenDays, totalDays });
}

// ─── Delete Measurement (#new) ────────────────────────────────────────────────
async function handleDeleteMeasurement(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const measurements = readJson("measurements");
  const idx = measurements.findIndex(m => m.id === body.measurementId && m.userId === user.id);
  if (idx === -1) { sendJson(res, 404, { error: "Không tìm thấy phiên đo." }); return; }
  measurements.splice(idx, 1);
  writeJson("measurements", measurements);
  appendLedgerEntry(user.id, "measurement.deleted", "Xoa phien do", { measurementId: body.measurementId });
  sendJson(res, 200, { ok: true });
}

// ─── Circadian endpoint (#28) ─────────────────────────────────────────────────
async function handleGetCircadian(urlObject, body, res, userId) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session || session.userId !== userId) { sendJson(res, 401, { error: "Khong du quyen." }); return; }
  const allMeasurements = readJson("measurements");
  const circadian = buildCircadianPattern(userId, allMeasurements);
  sendJson(res, 200, { circadian });
}

// ─── Population Stats (#new) ──────────────────────────────────────────────────
function handlePopulationStats(res) {
  const measurements = readJson("measurements").filter(m => m.type === "face" || m.type === "finger");
  if (!measurements.length) { sendJson(res, 200, { avgBpm: 72, avgHrv: 42, afibRate: 0, totalSessions: 0 }); return; }
  const avgBpm = Math.round(average(measurements.map(m => m.result?.bpm || 0).filter(Boolean)));
  const avgHrv = Math.round(average(measurements.map(m => m.result?.hrvScore || 0).filter(Boolean)));
  const afibRate = Math.round(measurements.filter(m => m.result?.classification === "afib").length / measurements.length * 100);
  sendJson(res, 200, { avgBpm, avgHrv, afibRate, totalSessions: measurements.length });
}

// ─── Static ───────────────────────────────────────────────────────────────────
function serveStatic(urlObject, res) {
  const requestPath = urlObject.pathname === "/" ? "/index.html" : urlObject.pathname;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { sendText(res, 404, "Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    // Không cache CSS/JS/HTML — đảm bảo browser luôn nhận code mới nhất
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    res.end(data);
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const urlObject = new URL(req.url, `http://${req.headers.host}`);
  const p = urlObject.pathname;

  if (req.method === "GET" && p === "/api/health") {
    sendJson(res, 200, { ok: true, name: "HEARTSENSE", version: "4.0.0", timestamp: new Date().toISOString(), integrations: getProviderStatus() });
    return;
  }
  if (req.method === "POST" && p === "/api/auth/register") { handleRegister(await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/auth/login") { handleLogin(await parseBody(req), res); return; }
  if (p === "/api/session" && (req.method === "GET" || req.method === "POST")) { handleSession(urlObject, req.method === "POST" ? await parseBody(req) : {}, res); return; }
  if (req.method === "PUT" && p === "/api/guardian") { handleGuardian(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/measurements") { await handleCreateMeasurement(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/measurements/context") { await handleMeasurementContext(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/baseline") { await handleRecordBaseline(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/breathing") { await handleCreateBreathing(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/symptoms") { await handleSymptom(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/reminders") { await handleReminder(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/sos/trigger") { await handleTriggerSos(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/sos/cancel") { await handleCancelSos(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/medications/check-interactions") { await handleCheckInteractions(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/pill-protocol") { await handleSavePillProtocol(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/export-token") { await handleGenerateExportToken(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/medications/adherence") { await handleMedicationAdherence(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/measurements/delete") { await handleDeleteMeasurement(urlObject, await parseBody(req), res); return; }
  if (req.method === "GET" && p === "/api/population-stats") { handlePopulationStats(res); return; }
  if (req.method === "GET" && p === "/api/cron") { await handleCronPing(urlObject, res); return; }

  if ((req.method === "GET" || req.method === "POST") && p.startsWith("/api/users/") && p.endsWith("/dashboard")) { const b = req.method === "POST" ? await parseBody(req) : {}; await handleDashboard(urlObject, b, res, p.split("/")[3]); return; }
  if (req.method === "GET" && p.startsWith("/api/users/") && p.endsWith("/report")) { await handleReport(urlObject, res, p.split("/")[3]); return; }
  if (req.method === "GET" && p.startsWith("/api/users/") && p.endsWith("/doctor-export")) { await handleDoctorExport(urlObject, res, p.split("/")[3]); return; }
  if (req.method === "POST" && p.startsWith("/api/users/") && p.endsWith("/remote-parent/send")) { await handleSendRemoteParentReport(urlObject, await parseBody(req), res); return; }
  if ((req.method === "GET" || req.method === "POST") && p.match(/^\/api\/users\/[^/]+\/circadian$/)) { const b = req.method === "POST" ? await parseBody(req) : {}; await handleGetCircadian(urlObject, b, res, p.split("/")[3]); return; }

  serveStatic(urlObject, res);
}

initDataStore().then(() => {
  updateSyncStats();
  cleanupExpiredSessions(); // #8: remove expired sessions on startup
  startAutoReportScheduler();
  http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      sendJson(res, 500, { error: "Server error", detail: err.message });
    });
  }).listen(PORT, () => {
    const { networkInterfaces } = require("os");
    const nets = networkInterfaces();
    const localIp = Object.values(nets).flat().find(n => n.family === "IPv4" && !n.internal)?.address || "unknown";
    console.log(`HEARTSENSE v4.0 running at http://localhost:${PORT}`);
    console.log(`Local network:             http://${localIp}:${PORT}`);
    console.log(`Storage: ${USE_SUPABASE ? "Supabase ☁️ (persistent)" : "Local files 📁 (ephemeral)"}`);
  });
});
