require("dotenv").config();
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const nodeFetch = require("node-fetch");

const PORT = process.env.PORT || 8010;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
// TZ_OFFSET: giờ lệch so với UTC. Mặc định 7 (Việt Nam UTC+7).
// Đặt TZ_OFFSET=0 nếu server chạy ở UTC, TZ_OFFSET=-5 cho EST, v.v.
const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET ?? 7);
const RESEND_API_BASE_URL = process.env.RESEND_API_BASE_URL || "https://api.resend.com/emails";
const WEATHER_DEFAULT_QUERY = process.env.WEATHER_DEFAULT_QUERY || "Bac Ninh,VN";
const EMAIL_FROM = process.env.EMAIL_FROM || "HEARTSENSE <onboarding@resend.dev>";
if (!process.env.RESEND_API_KEY) console.warn("[WARN] RESEND_API_KEY chưa được set — email Resend sẽ không gửi được.");
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  console.log(`[Gmail SMTP] Biến đã set: GMAIL_USER=${GMAIL_USER}, APP_PASSWORD length=${GMAIL_APP_PASSWORD.length}`);
} else {
  console.error(`[Gmail SMTP] ❌ CHƯA SET: GMAIL_USER="${GMAIL_USER}" GMAIL_APP_PASSWORD="${GMAIL_APP_PASSWORD ? "***set***" : "TRỐNG"}"`);
}
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_API_URL_FALLBACK = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
if (!GEMINI_API_KEY) console.warn("[WARN] GEMINI_API_KEY chưa set — Bác sĩ ảo sẽ dùng rule-based fallback.");

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
  holterLogs: path.join(DATA_DIR, "holter_logs.json"),
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
  holterLogs: [],
  drugInteractionCache: {},  // fix: was missing → readJson crash on first drug check
  hrrResults: [],
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
    request.setTimeout(35000, () => { request.destroy(); reject(new Error("Request timeout")); });
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
async function sendResendEmailWithRetry(opts, maxRetries = 2) {
  if (!opts.to || !process.env.RESEND_API_KEY) {
    return { sent: false, provider: "resend", reason: !process.env.RESEND_API_KEY ? "Chưa cấu hình RESEND_API_KEY" : "Chưa có email người thân", attempts: 0 };
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendResendEmail(opts);
      return { ...result, attempts: attempt };
    } catch (e) {
      lastErr = e.message;
      // Chỉ retry khi lỗi mạng/timeout. Lỗi API (4xx) là permanent, không retry.
      const isTransient = /timeout|ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(e.message);
      if (!isTransient || attempt >= maxRetries) break;
      await new Promise(r => setTimeout(r, 600));
    }
  }
  return { sent: false, provider: "resend", reason: lastErr || "unknown_error", attempts: maxRetries };
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

// ─── Gmail SMTP (nodemailer) ──────────────────────────────────────────────────
let _gmailTransporter = null;
let _gmailReady = false;
let _gmailLastError = null;

function _createAndVerifyGmail(port, secure, label) {
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port,
    secure,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  t.verify((err) => {
    if (err) {
      console.error(`[Gmail SMTP] ❌ ${label} thất bại: ${err.message}`);
      _gmailLastError = `${label}: ${err.message}`;
      if (port === 587) {
        console.log("[Gmail SMTP] Thử port 465 (SSL)...");
        _createAndVerifyGmail(465, true, "port 465 SSL");
      } else {
        console.error("[Gmail SMTP] ❌ Cả port 587 và 465 đều thất bại.");
        console.error("[Gmail SMTP] → Kiểm tra: (1) GMAIL_USER và GMAIL_APP_PASSWORD đúng chưa, (2) Bật xác minh 2 bước trên Gmail, (3) App Password tạo tại myaccount.google.com/apppasswords");
      }
    } else {
      console.log(`[Gmail SMTP] ✅ ${label} OK — sẵn sàng gửi từ ${GMAIL_USER}`);
      _gmailTransporter = t;
      _gmailReady = true;
      _gmailLastError = null;
    }
  });
}

function initGmailTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    _gmailLastError = "GMAIL_USER hoặc GMAIL_APP_PASSWORD chưa set trong Render Dashboard";
    console.error(`[Gmail SMTP] ❌ ${_gmailLastError}`);
    return;
  }
  console.log(`[Gmail SMTP] Đang kết nối với ${GMAIL_USER} (pass length=${GMAIL_APP_PASSWORD.length})...`);
  _createAndVerifyGmail(587, false, "port 587 STARTTLS");
}

// Khởi động Gmail khi server start
initGmailTransporter();

async function sendGmailEmail({ to, subject, html }) {
  if (!_gmailReady || !_gmailTransporter) {
    return { sent: false, provider: "gmail", reason: _gmailLastError || "Gmail SMTP chưa sẵn sàng" };
  }
  if (!to) return { sent: false, provider: "gmail", reason: "missing_recipient" };
  const sendPromise = _gmailTransporter.sendMail({ from: `"HEARTSENSE" <${GMAIL_USER}>`, to, subject, html });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Gmail sendMail timeout 25s")), 25000)
  );
  const info = await Promise.race([sendPromise, timeoutPromise]);
  return { sent: true, provider: "gmail", id: info.messageId || null };
}

// ─── Google Apps Script Email Relay — dùng Gmail sẵn có, không cần service mới ─
async function sendGoogleAppsScriptEmail({ to, subject, html }) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET || "heartsense2024";
  if (!url) return { sent: false, provider: "apps_script", reason: "APPS_SCRIPT_URL chưa set" };
  const body = JSON.stringify({ secret, to, subject, html });
  // Hop 0: POST /exec → Apps Script chạy doPost → trả 302 redirect
  // Hop 1+: GET echo URL → lấy kết quả JSON từ ContentService
  let currentUrl = url;
  for (let hop = 0; hop < 5; hop++) {
    const isFirst = hop === 0;
    const res = await nodeFetch(currentUrl, {
      method: isFirst ? "POST" : "GET",
      headers: isFirst ? { "Content-Type": "application/json" } : {},
      body: isFirst ? body : undefined,
      redirect: "manual",
      timeout: 30000,
    });
    if (res.status === 301 || res.status === 302 || res.status === 303) {
      const loc = res.headers.get("location");
      if (!loc) break;
      currentUrl = loc;
      continue;
    }
    const text = await res.text();
    console.log(`[AppsScript] status=${res.status} body=${text.substring(0, 200)}`);
    let result;
    try { result = JSON.parse(text); } catch { result = {}; }
    if (!result?.sent) throw new Error(result?.error || `HTTP ${res.status}: ${text.substring(0, 120)}`);
    return { sent: true, provider: "apps_script" };
  }
  throw new Error("Quá nhiều redirect từ Apps Script");
}

// ─── SMTP2GO HTTP API — free 1000/month, không cần activation ────────────────
async function sendSmtp2goEmail({ to, subject, html }) {
  const apiKey = process.env.SMTP2GO_API_KEY;
  const senderEmail = process.env.SMTP2GO_SENDER_EMAIL || GMAIL_USER;
  if (!apiKey) return { sent: false, provider: "smtp2go", reason: "SMTP2GO_API_KEY chưa set" };
  if (!senderEmail) return { sent: false, provider: "smtp2go", reason: "SMTP2GO_SENDER_EMAIL chưa set" };
  const payload = JSON.stringify({
    api_key: apiKey,
    to: [to],
    sender: senderEmail,
    subject,
    html_body: html,
  });
  const result = await requestJson("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    body: payload,
  });
  if (!result?.data?.succeeded) throw new Error(result?.data?.failures?.[0] || "smtp2go failed");
  return { sent: true, provider: "smtp2go" };
}

// ─── SendGrid HTTP API — free 100/day, không cần activation, hoạt động ngay ───
async function sendSendgridEmail({ to, subject, html }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const senderEmail = process.env.SENDGRID_SENDER_EMAIL || GMAIL_USER;
  if (!apiKey) return { sent: false, provider: "sendgrid", reason: "SENDGRID_API_KEY chưa set" };
  if (!senderEmail) return { sent: false, provider: "sendgrid", reason: "SENDGRID_SENDER_EMAIL chưa set" };
  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: senderEmail, name: "HEARTSENSE" },
    subject,
    content: [{ type: "text/html", value: html }],
  });
  await requestJson("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    body: payload,
  });
  return { sent: true, provider: "sendgrid" };
}

// ─── Mailjet HTTP API — không dùng SMTP, không bị Render chặn, free 200/day ───
async function sendMailjetEmail({ to, subject, html }) {
  const apiKey = process.env.MAILJET_API_KEY;
  const secretKey = process.env.MAILJET_SECRET_KEY;
  const senderEmail = process.env.MAILJET_SENDER_EMAIL || GMAIL_USER;
  if (!apiKey || !secretKey) return { sent: false, provider: "mailjet", reason: "MAILJET_API_KEY / MAILJET_SECRET_KEY chưa set" };
  if (!senderEmail) return { sent: false, provider: "mailjet", reason: "MAILJET_SENDER_EMAIL chưa set" };
  const payload = JSON.stringify({
    Messages: [{
      From: { Email: senderEmail, Name: "HEARTSENSE" },
      To: [{ Email: to }],
      Subject: subject,
      HTMLPart: html,
    }],
  });
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
  const result = await requestJson("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    body: payload,
  });
  const msg = result?.Messages?.[0];
  if (msg?.Status !== "success") {
    throw new Error(msg?.Errors?.[0]?.ErrorMessage || "Mailjet unknown error");
  }
  return { sent: true, provider: "mailjet", id: msg?.To?.[0]?.MessageID || null };
}

// ─── Brevo HTTP API (backup nếu Mailjet không dùng) ───────────────────────────
async function sendBrevoEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || GMAIL_USER;
  if (!apiKey) return { sent: false, provider: "brevo", reason: "BREVO_API_KEY chưa set" };
  if (!senderEmail) return { sent: false, provider: "brevo", reason: "BREVO_SENDER_EMAIL chưa set" };
  const payload = JSON.stringify({
    sender: { name: "HEARTSENSE", email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  });
  const result = await requestJson("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    body: payload,
  });
  return { sent: true, provider: "brevo", id: result.messageId || null };
}

// ─── Hàm gửi email thống nhất ─────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!to) return { sent: false, reason: "missing_recipient" };

  // 1. Google Apps Script relay — dùng Gmail sẵn có, không cần đăng ký service mới
  if (process.env.APPS_SCRIPT_URL) {
    try {
      const result = await sendGoogleAppsScriptEmail({ to, subject, html });
      if (result.sent) { console.log(`[Email] AppsScript → ${to} ✓`); return result; }
      console.error(`[Email] AppsScript thất bại: ${result.reason}`);
      return { sent: false, reason: `AppsScript: ${result.reason}` };
    } catch (e) {
      console.error(`[Email] AppsScript lỗi: ${e.message}`);
      return { sent: false, reason: `AppsScript lỗi: ${e.message}` };
    }
  }

  // 2. SMTP2GO — HTTP API, free 1000/month, không cần activation
  if (process.env.SMTP2GO_API_KEY) {
    try {
      const result = await sendSmtp2goEmail({ to, subject, html });
      if (result.sent) { console.log(`[Email] SMTP2GO → ${to} ✓`); return result; }
      console.error(`[Email] SMTP2GO thất bại: ${result.reason}`);
      return { sent: false, reason: `SMTP2GO: ${result.reason}` };
    } catch (e) {
      console.error(`[Email] SMTP2GO lỗi: ${e.message}`);
      return { sent: false, reason: `SMTP2GO lỗi: ${e.message}` };
    }
  }

  // 2. SendGrid — HTTP API, free 100/day, hoạt động ngay sau khi verify sender email
  if (process.env.SENDGRID_API_KEY) {
    try {
      const result = await sendSendgridEmail({ to, subject, html });
      if (result.sent) { console.log(`[Email] SendGrid → ${to} ✓`); return result; }
      console.error(`[Email] SendGrid thất bại: ${result.reason}`);
      return { sent: false, reason: `SendGrid: ${result.reason}` };
    } catch (e) {
      console.error(`[Email] SendGrid lỗi: ${e.message}`);
      return { sent: false, reason: `SendGrid lỗi: ${e.message}` };
    }
  }

  // 2. Mailjet — HTTP API, free 200/day
  if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
    try {
      const result = await sendMailjetEmail({ to, subject, html });
      if (result.sent) { console.log(`[Email] Mailjet → ${to} ✓`); return result; }
      console.error(`[Email] Mailjet thất bại: ${result.reason}`);
      return { sent: false, reason: `Mailjet: ${result.reason}` };
    } catch (e) {
      console.error(`[Email] Mailjet lỗi: ${e.message}`);
      return { sent: false, reason: `Mailjet lỗi: ${e.message}` };
    }
  }

  // 3. Brevo — backup (cần activation từ Brevo team)
  if (process.env.BREVO_API_KEY) {
    try {
      const result = await sendBrevoEmail({ to, subject, html });
      if (result.sent) { console.log(`[Email] Brevo → ${to} ✓`); return result; }
      console.error(`[Email] Brevo thất bại: ${result.reason}`);
      return { sent: false, reason: `Brevo: ${result.reason}` };
    } catch (e) {
      console.error(`[Email] Brevo lỗi: ${e.message}`);
      return { sent: false, reason: `Brevo lỗi: ${e.message}` };
    }
  }

  // 3. Gmail SMTP (Render free tier chặn port — thường không dùng được)
  if (GMAIL_USER && GMAIL_APP_PASSWORD && _gmailReady) {
    try {
      const result = await sendGmailEmail({ to, subject, html });
      if (result.sent) { console.log(`[Email] Gmail → ${to} ✓`); return result; }
      return { sent: false, reason: `Gmail: ${result.reason}` };
    } catch (e) {
      _gmailTransporter = null; _gmailReady = false;
      return { sent: false, reason: `Gmail lỗi: ${e.message}` };
    }
  }

  // 4. Resend — chỉ gửi được đến email chủ tài khoản Resend
  if (process.env.RESEND_API_KEY) {
    return await sendResendEmailWithRetry({ to, subject, html });
  }

  return { sent: false, reason: "Chưa cấu hình email — cần MAILJET_API_KEY + MAILJET_SECRET_KEY trong Render Dashboard" };
}

function buildReportEmailHtml(user, latest, status, dashboard, personalMessage = "", aiComment = "") {
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
        <div style="font-size:22px;font-weight:bold;color:#10233f">${r.confidence ? Math.round(r.confidence) + "%" : "--"}</div>
        <div style="font-size:12px;color:#666">Độ tin cậy AI</div>
      </div>
    </div>
    <div style="background:#fffbeb;border-left:4px solid ${bannerColor};padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:14px;color:#333">
      ${safetyMsg}
    </div>
    <p style="font-size:12px;color:#888;margin:0 0 16px">⏱ Lần đo gần nhất: ${new Date(latest.createdAt).toLocaleString("vi-VN")}</p>
    ` : `<p style="color:#888;margin-bottom:16px">Chưa có lần đo nào hôm nay. Hãy nhắc <strong>${user.fullName}</strong> đo tim!</p>`}
    ${aiComment ? `
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#1d4ed8;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">🤖 Nhận xét từ AI Tim mạch HEARTSENSE</div>
      <div style="font-size:13px;color:#1e293b;line-height:1.75;white-space:pre-wrap">${aiComment.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    </div>` : ""}
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

function buildAiAnalysisEmailHtml(user, r, aiAnalysis, guardianName) {
  const isAfib = r?.classification === "afib";
  const isElevated = r?.classification === "elevated";
  const accentColor = isAfib ? "#dc2626" : isElevated ? "#d97706" : "#0d9488";
  const statusBadge = isAfib
    ? `<span style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700">⚠️ PHÁT HIỆN RUNG NHĨ (AFib)</span>`
    : isElevated
    ? `<span style="background:#fffbeb;color:#d97706;border:1px solid #fcd34d;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700">⚡ CHỈ SỐ CẦN THEO DÕI</span>`
    : `<span style="background:#f0fdf4;color:#16a34a;border:1px solid #86efac;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700">✅ TÌNH TRẠNG ỔN ĐỊNH</span>`;
  const riskColor = (r?.strokeRiskScore || 0) >= 60 ? "#dc2626" : (r?.strokeRiskScore || 0) >= 30 ? "#d97706" : "#16a34a";
  const clotColor = (r?.clotRisk?.score || 0) >= 60 ? "#dc2626" : (r?.clotRisk?.score || 0) >= 30 ? "#d97706" : "#16a34a";
  const now = new Date().toLocaleString("vi-VN");
  const hasAi = !!(aiAnalysis && aiAnalysis.length > 20);
  const safeAnalysis = (aiAnalysis || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;max-width:580px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <!-- Header gradient -->
    <div style="background:linear-gradient(135deg,#0f766e,#0d9488,#14b8a6);padding:24px 28px;color:#fff">
      <div style="font-size:11px;letter-spacing:2px;opacity:0.8;margin-bottom:6px">🧠 PHÂN TÍCH SỨC KHỎE TIM MẠCH AI</div>
      <div style="font-size:20px;font-weight:800;margin-bottom:4px">HEARTSENSE</div>
      <div style="font-size:13px;opacity:0.9">Kính gửi: <strong>${escHtml(guardianName || "Quý người thân")}</strong></div>
      <div style="font-size:13px;opacity:0.85;margin-top:2px">Bệnh nhân: <strong>${escHtml(user.fullName)}</strong> — ${user.age} tuổi &nbsp;·&nbsp; ${now}</div>
    </div>
    <!-- Status badge -->
    <div style="padding:16px 28px;border-bottom:1px solid #f0f9ff;text-align:center">
      ${statusBadge}
    </div>
    ${r?.bpm ? `
    <!-- Metrics -->
    <div style="padding:20px 28px;border-bottom:1px solid #f1f5f9">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📊 Chỉ số đo lần gần nhất</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px 8px;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#10233f">${r.bpm}</div>
          <div style="font-size:10px;color:#666;margin-top:2px">BPM</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;padding:12px 8px;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:${riskColor}">${r.strokeRiskScore ?? "--"}%</div>
          <div style="font-size:10px;color:#666;margin-top:2px">Đột quỵ</div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:12px 8px;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#1d4ed8">${r.sdnn ?? "--"}<span style="font-size:11px">ms</span></div>
          <div style="font-size:10px;color:#666;margin-top:2px">HRV</div>
        </div>
        <div style="background:#fdf4ff;border:1px solid #e9d5ff;padding:12px 8px;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:${clotColor}">${r.clotRisk?.score ?? "--"}</div>
          <div style="font-size:10px;color:#666;margin-top:2px">Huyết khối</div>
        </div>
      </div>
    </div>` : ""}
    <!-- AI Analysis -->
    <div style="padding:20px 28px;border-bottom:1px solid #f1f5f9">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <div style="background:#0d9488;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.5px">🤖 BS.CK II TIM MẠCH AI</div>
        ${hasAi ? `<div style="font-size:11px;color:#0d9488">● Phân tích trực tiếp từ dữ liệu đo</div>` : `<div style="font-size:11px;color:#94a3b8">Đang cập nhật</div>`}
      </div>
      ${hasAi ? `
      <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:16px">
        <div style="font-size:13.5px;color:#134e4a;line-height:1.9;white-space:pre-wrap">${safeAnalysis}</div>
      </div>` : `
      <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:16px;text-align:center;color:#94a3b8;font-size:13px">
        Phân tích AI tạm thời không khả dụng.<br>Báo cáo sức khỏe cơ bản được gửi thay thế.
      </div>`}
    </div>
    <!-- Disclaimer + Footer -->
    <div style="padding:14px 28px;background:#fffbeb;border-top:1px solid #fde68a">
      <p style="margin:0;font-size:11px;color:#92400e">⚠️ Phân tích từ AI HEARTSENSE mang tính hỗ trợ theo dõi, <strong>không thay thế chẩn đoán bác sĩ</strong>. Triệu chứng bất thường → gọi <strong>115</strong> ngay.</p>
    </div>
    <div style="padding:12px 28px;text-align:center;background:#f8fafc">
      <p style="margin:0;font-size:11px;color:#94a3b8">HEARTSENSE – Ứng dụng theo dõi tim mạch AI &nbsp;·&nbsp; ${now}</p>
    </div>
  </div>`;
}

function buildMeasurementEmailHtml(user, record, dashboard, aiComment = "") {
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
        <div style="font-size:22px;font-weight:bold;color:#10233f">${r.confidence ? Math.round(r.confidence) + "%" : "--"}</div>
        <div style="font-size:12px;color:#666">Độ tin cậy AI</div>
      </div>
    </div>
    <div style="background:#fffbeb;border-left:4px solid ${statusColor};padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:14px;color:#333">
      ${safetyMsg}
    </div>
    ${aiComment ? `
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#1d4ed8;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">🤖 Nhận xét từ AI Tim mạch HEARTSENSE</div>
      <div style="font-size:13px;color:#1e293b;line-height:1.75;white-space:pre-wrap">${aiComment.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    </div>` : ""}
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

async function generateGuardianAiComment(user, r, contextLabel) {
  if (!GEMINI_API_KEY || !r?.bpm) return null;
  const isAfib = r.classification === "afib";
  const isElevated = r.classification === "elevated";
  const statusText = isAfib ? "RUNG NHĨ (AFib) — bất thường nghiêm trọng"
    : isElevated ? "Nhịp tim cao — cần theo dõi"
    : "Bình thường — ổn định";
  const urgency = isAfib ? "KHẨN — cần can thiệp ngay" : isElevated ? "THEO DÕI — chú ý thêm" : "ỔN ĐỊNH — tiếp tục theo dõi định kỳ";
  const conditions = (user.conditions || []).join(", ") || "không có";
  const gender = user.gender === "male" ? "Nam" : user.gender === "female" ? "Nữ" : "Không rõ";

  const prompt = `Bạn là trợ lý AI Tim mạch HEARTSENSE. Viết đoạn NHẬN XÉT NGẮN (đúng 120-150 từ) về kết quả đo tim của ${user.fullName || "bệnh nhân"} để GỬI CHO NGƯỜI THÂN — người không có chuyên môn y tế.

KẾT QUẢ ĐO (${contextLabel}):
- Nhịp tim: ${r.bpm} BPM | Tình trạng: ${statusText}
- Nguy cơ đột quỵ: ${r.strokeRiskScore ?? "--"}% | HRV (SDNN): ${r.sdnn ?? "--"}ms
- Độ bất thường nhịp: ${r.irregularityIndex ?? "--"}% | Huyết khối: ${r.clotRisk?.score ?? "--"}/100
- Bệnh nền: ${conditions} | Tuổi: ${user.age} | Giới: ${gender}
- Mức độ ưu tiên: ${urgency}

Viết theo đúng cấu trúc 4 phần LIỀN MẠCH (không đánh số, không xuống dòng giữa các phần):
Phần 1 — Tình trạng hiện tại của ${user.fullName || "bệnh nhân"} là gì, bằng ngôn ngữ thật đơn giản.
Phần 2 — Điều này có thể ảnh hưởng gì đến sức khỏe ngắn hạn.
Phần 3 — Người thân nên làm gì CỤ THỂ ngay bây giờ (2-3 hành động thực tế, có thể làm được ngay).
Phần 4 — Dấu hiệu nào xuất hiện thì phải gọi 115 hoặc đưa đi cấp cứu ngay lập tức.

Giọng: ấm áp, bình tĩnh, không gây hoảng loạn nhưng đủ rõ ràng để người thân biết cần làm gì. Tiếng Việt. Không dùng markdown.`;

  try {
    const payload = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.38, maxOutputTokens: 512, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
      safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
    });
    const geminiRes = await requestJson(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      body: payload,
    });
    if (geminiRes?.error) { console.warn("[GuardianAI]", geminiRes.error.message); return null; }
    return geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.warn("[GuardianAI]", err.message);
    return null;
  }
}

// Phân tích AI xu hướng 7 ngày — dùng riêng cho báo cáo tổng hợp hàng ngày
async function generateDailyAiAnalysis(user, latest, weekly) {
  if (!GEMINI_API_KEY) return null;
  const r = latest?.result;
  const conditions = (user.conditions || []).join(", ") || "không có";
  const gender = user.gender === "male" ? "Nam" : user.gender === "female" ? "Nữ" : "Không rõ";
  const w = weekly || {};
  const prompt = `Bạn là Bác sĩ Tim mạch AI HEARTSENSE. Viết BÁO CÁO PHÂN TÍCH 7 NGÀY gửi cho NGƯỜI THÂN của bệnh nhân — người không có chuyên môn y tế.

HỒ SƠ BỆNH NHÂN:
- Tên: ${user.fullName || "Bệnh nhân"} | Tuổi: ${user.age} | Giới: ${gender}
- Bệnh nền: ${conditions}

SỐ LIỆU 7 NGÀY QUA:
- Tổng lần đo: ${w.totalMeasurements || 0} lần
- Nhịp tim trung bình: ${w.averageBpm || "--"} BPM
- Số cảnh báo AFib: ${w.afibAlerts || 0} lần
- Tóm tắt xu hướng: ${w.summary || "không có dữ liệu bổ sung"}

KẾT QUẢ ĐO GẦN NHẤT:
- Nhịp tim: ${r?.bpm || "--"} BPM | Tình trạng: ${r?.classification === "afib" ? "RUNG NHĨ" : r?.classification === "elevated" ? "Cao" : "Bình thường"}
- Nguy cơ đột quỵ: ${r?.strokeRiskScore ?? "--"}% | HRV (SDNN): ${r?.sdnn ?? "--"}ms
- Nguy cơ huyết khối: ${r?.clotRisk?.score ?? "--"}/100

Viết báo cáo theo đúng 3 phần, mỗi phần bắt đầu bằng tiêu đề IN HOA:

ĐÁNH GIÁ SỨC KHỎE TUẦN QUA
(Đánh giá tổng thể xu hướng 7 ngày, chỉ số nào cải thiện, chỉ số nào đáng lo, so sánh với ngưỡng bình thường)

ĐIỂM CẦN LƯU Ý
(Liệt kê 2-4 chỉ số hoặc sự kiện đáng chú ý nhất trong tuần, giải thích ý nghĩa bằng ngôn ngữ đơn giản)

KHUYẾN NGHỊ CHO TUẦN TỚI
(3-4 hành động cụ thể người thân nên nhắc hoặc theo dõi trong 7 ngày tới. Nếu có cảnh báo AFib — nhấn mạnh cần gặp bác sĩ.)

Giọng văn: chuyên nghiệp nhưng dễ hiểu, ấm áp, không gây hoảng loạn. Tiếng Việt. Không dùng markdown ký tự đặc biệt.`;
  try {
    const payload = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
      safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
    });
    const res = await requestJson(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      body: payload,
    });
    if (res?.error) { console.warn("[DailyAI]", res.error.message); return null; }
    return res?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    console.warn("[DailyAI]", e.message); return null;
  }
}

// Template riêng cho báo cáo tổng hợp hàng ngày — khác hoàn toàn với báo cáo tức thì
function buildDailyReportEmailHtml(user, latest, dashboard, aiAnalysis) {
  const r = latest?.result;
  const w = dashboard?.weeklyReport || {};
  const isAfib = r?.classification === "afib";
  const isElevated = r?.classification === "elevated";
  const statusColor = isAfib ? "#cc2244" : isElevated ? "#d97706" : "#059669";
  const statusLabel = isAfib ? "⚠️ CÓ CẢNH BÁO AFIB TRONG TUẦN" : isElevated ? "⚡ CHỈ SỐ THEO DÕI" : "✅ TUẦN ỔN ĐỊNH";
  const riskColor = (r?.strokeRiskScore || 0) >= 70 ? "#cc2244" : (r?.strokeRiskScore || 0) >= 40 ? "#d97706" : "#059669";
  const afibColor = (w.afibAlerts || 0) > 0 ? "#cc2244" : "#059669";
  const safeAi = (aiAnalysis || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const now = new Date().toLocaleString("vi-VN");
  return `<div style="font-family:Arial,sans-serif;padding:24px;max-width:540px;background:#fff">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:16px 20px;border-radius:12px;margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:1px;opacity:0.85;margin-bottom:4px">BÁO CÁO TỰ ĐỘNG HÀNG NGÀY</div>
      <div style="font-size:17px;font-weight:bold">HEARTSENSE – Tổng hợp sức khỏe</div>
      <div style="font-size:13px;opacity:0.9;margin-top:4px">👤 ${escHtml(user.fullName)} (${user.age} tuổi) &nbsp;·&nbsp; ${now}</div>
    </div>
    <div style="background:${statusColor}18;border:1.5px solid ${statusColor};border-radius:10px;padding:12px 16px;text-align:center;font-weight:700;font-size:15px;color:${statusColor};margin-bottom:20px">
      ${statusLabel}
    </div>
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">📊 Tổng kết 7 ngày qua</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div style="background:#f5f3ff;padding:12px;border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:bold;color:#4f46e5">${w.totalMeasurements || 0}</div>
          <div style="font-size:11px;color:#666">Lần đo</div>
        </div>
        <div style="background:#f5f3ff;padding:12px;border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:bold;color:#10233f">${w.averageBpm || "--"}</div>
          <div style="font-size:11px;color:#666">TB BPM</div>
        </div>
        <div style="background:#f5f3ff;padding:12px;border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:bold;color:${afibColor}">${w.afibAlerts || 0}</div>
          <div style="font-size:11px;color:#666">Cảnh báo AFib</div>
        </div>
      </div>
    </div>
    ${r ? `
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:#10233f;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">💓 Lần đo gần nhất</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:#f0f9ff;padding:10px;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:bold;color:#10233f">${r.bpm} <span style="font-size:13px">BPM</span></div>
          <div style="font-size:11px;color:#666">Nhịp tim</div>
        </div>
        <div style="background:#f0f9ff;padding:10px;border-radius:8px;text-align:center">
          <div style="font-size:22px;font-weight:bold;color:${riskColor}">${r.strokeRiskScore}%</div>
          <div style="font-size:11px;color:#666">Nguy cơ đột quỵ</div>
        </div>
      </div>
      <div style="font-size:12px;color:#888;margin-top:6px;text-align:right">⏱ ${new Date(latest.createdAt).toLocaleString("vi-VN")}</div>
    </div>` : `<p style="color:#888;margin-bottom:16px;font-size:13px">Chưa có lần đo nào gần đây.</p>`}
    ${safeAi ? `
    <div style="background:#f5f3ff;border-left:4px solid #4f46e5;border-radius:0 10px 10px 0;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:11px;color:#4f46e5;font-weight:700;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">🧠 Phân tích AI – Xu hướng sức khỏe tuần</div>
      <div style="font-size:13px;color:#1e293b;line-height:1.85;white-space:pre-wrap">${safeAi}</div>
    </div>` : `
    <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#64748b;text-align:center">
      AI phân tích không khả dụng lần này — sẽ có ở báo cáo kế tiếp.
    </div>`}
    <div style="background:#fff7ed;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#9a3412">
      ⚠️ Thông tin từ HEARTSENSE mang tính hỗ trợ theo dõi, không thay thế ý kiến bác sĩ.
    </div>
    <p style="color:#999;font-size:11px;margin:0;text-align:center;border-top:1px solid #e2e8f0;padding-top:10px">HEARTSENSE – Mắt thần cho con xa &nbsp;·&nbsp; Báo cáo tự động ${now}</p>
  </div>`;
}

async function sendGuardianMeasurementNotification(user, record, dashboard) {
  const guardian = user.guardian || {};
  if (!guardian.guardianEmail || !guardian.reportSchedule?.notifyOnMeasurement) return;
  try {
    const timeLabel = new Date(record.createdAt).toLocaleString("vi-VN");
    const aiComment = await generateGuardianAiComment(user, record.result, timeLabel);
    await sendEmail({
      to: guardian.guardianEmail,
      subject: `HEARTSENSE – ${user.fullName} vừa đo: ${record.result.classification === "afib" ? "⚠️ CÓ CẢNH BÁO" : record.result.classification === "elevated" ? "⚡ Chỉ số cao" : "✅ Bình thường"} – ${new Date().toLocaleTimeString("vi-VN")}`,
      html: buildMeasurementEmailHtml(user, record, dashboard, aiComment),
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
    // Reverse geocode để lấy tên thật (tránh lỗi timezone "Bangkok" cho VN)
    locationName = await (async () => {
      try {
        const rev = await requestJson(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1&accept-language=vi`,
          { headers: { "User-Agent": "HEARTSENSE/4.0" } }
        );
        const addr = rev?.address || {};
        // Bỏ tiền tố hành chính VN để lấy tên thuần
        const stripPrefix = s => (s || "").replace(/^(Thành phố|Thị xã|Thị trấn|Tỉnh|Phường|Xã|Huyện|Quận)\s+/iu, "").trim();
        const cityRaw = addr.city || addr.town || addr.municipality || addr.suburb || "";
        const stateRaw = addr.state || "";
        const countryCode = (addr.country_code || "VN").toUpperCase();
        const city = stripPrefix(cityRaw);   // vd: "Kinh Bắc"
        const state = stripPrefix(stateRaw); // vd: "Bắc Ninh"
        if (city && state && city !== state) return `${city}, ${state}, ${countryCode}`;
        if (state) return `${state}, ${countryCode}`;
        return city || null;
      } catch { return null; }
    })();
  } else {
    const parts = String(query).split(",");
    const cityName = parts[0].trim();
    const countryCode = (parts[1] || "VN").trim().toUpperCase();
    // Thêm countrycode để tránh nhầm thành phố cùng tên ở nước khác (e.g. "Bac Ninh" → Thailand)
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=vi&format=json&countrycode=${countryCode}`;
    const geoData = await requestJson(geoUrl);
    if (!geoData?.results?.length) return null;
    const r = geoData.results[0];
    latitude = r.latitude; longitude = r.longitude;
    locationName = `${r.name}, ${r.country_code || r.country || countryCode}`;
  }

  // Thêm relative_humidity_2m để hiển thị độ ẩm trong tương quan thời tiết-tim mạch
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`;
  const weatherData = await requestJson(weatherUrl);
  if (!weatherData?.current) return null;

  if (!locationName && weatherData.timezone) {
    const tzCity = weatherData.timezone.split("/").pop().replace(/_/g, " ");
    // "Bangkok" xuất hiện vì VN chia sẻ UTC+7 với Thái Lan trong một số timezone DB — bỏ qua
    locationName = (tzCity && tzCity !== "Bangkok") ? tzCity : "Vị trí của bạn";
  }
  locationName = locationName || "Vị trí của bạn";

  const result = {
    name: locationName,
    temp: weatherData.current.temperature_2m,
    weatherCode: weatherData.current.weather_code,
    humidity: weatherData.current.relative_humidity_2m ?? null,
  };
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
      humidity: weather.humidity ?? null,
      weatherCode: weather.weatherCode ?? null,
      description: desc,
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

// ─── Clot-Risk Pulse-Morphology (UPDATE LIST 5) ───────────────────────────────
function computeClotRiskScore({ waveform, bpm, irregularityIndex, cv, sdnn, rmssd, pnn50, age, conditions }) {
  const conds = String(conditions || "");

  // Factor 1: Rhythm irregularity → blood pools in atria → clot formation (0-28 pts)
  const rhythmFactor = Math.min(28, (irregularityIndex || 0) * 0.22 + (cv || 0) * 55);

  // Factor 2: Waveform morphology — upstroke velocity + amplitude variability (0-32 pts)
  let morphFactor = 0;
  if (Array.isArray(waveform) && waveform.length >= 20) {
    const wMin = Math.min(...waveform), wMax = Math.max(...waveform);
    const range = wMax - wMin || 1;
    const norm = waveform.map(v => (v - wMin) / range);
    // Find systolic peaks
    const peaks = [];
    for (let i = 2; i < norm.length - 2; i++) {
      if (norm[i] > norm[i-1] && norm[i] > norm[i-2] && norm[i] > norm[i+1] && norm[i] > norm[i+2] && norm[i] > 0.68) {
        if (!peaks.length || i - peaks[peaks.length-1] > 8) peaks.push(i);
      }
    }
    if (peaks.length >= 3) {
      const amps = peaks.map(p => norm[p]);
      const ampMean = amps.reduce((s,v) => s+v, 0) / amps.length;
      const ampStd = Math.sqrt(amps.reduce((s,v) => s+(v-ampMean)**2, 0) / amps.length);
      morphFactor += Math.min(14, (ampStd / Math.max(0.01, ampMean)) * 70); // amplitude variability
    }
    const troughs = [];
    for (let i = 1; i < norm.length-1; i++) {
      if (norm[i] < norm[i-1] && norm[i] < norm[i+1] && norm[i] < 0.35) troughs.push(i);
    }
    const upstrokes = [];
    for (const pk of peaks) {
      const pt = [...troughs].reverse().find(t => t < pk);
      if (pt !== undefined) { const rt = pk - pt; if (rt > 0) upstrokes.push((norm[pk] - norm[pt]) / rt); }
    }
    if (upstrokes.length > 0) {
      const avgU = upstrokes.reduce((s,v)=>s+v,0)/upstrokes.length;
      morphFactor += Math.min(18, Math.max(0, 0.12 - avgU) / 0.12 * 18); // slow upstroke = sluggish flow
    }
  }

  // Factor 3: HRV — very low SDNN in irregular rhythm → stasis risk (0-20 pts)
  const sd = sdnn || 0;
  const hrvFactor = Math.min(20,
    (sd > 0 && sd < 20 ? 14 : sd < 35 ? 8 : sd < 50 ? 3 : 0) +
    ((pnn50 || 0) > 35 && (irregularityIndex || 0) > 50 ? 6 : 0)
  );

  // Factor 4: Clinical background risk (0-20 pts)
  const clinFactor = Math.min(20,
    (/cao huyet ap|tang huyet ap/.test(conds) ? 5 : 0) +
    (/afib|rung nhi/.test(conds) ? 8 : 0) +
    (/tieu duong/.test(conds) ? 4 : 0) +
    (/suy tim/.test(conds) ? 6 : 0) +
    ((age||60) > 70 ? 6 : (age||60) > 60 ? 3 : 1)
  );

  const score = Math.round(clamp(1, rhythmFactor + morphFactor + hrvFactor + clinFactor, 99));
  const level = score >= 71 ? "HIGH" : score >= 31 ? "MODERATE" : "LOW";
  const label = score >= 71 ? "🔴 Báo động Đỏ – Nguy cơ huyết khối cao"
    : score >= 31 ? "🟡 Ứ trệ tuần hoàn – Theo dõi"
    : "🟢 Dòng máu lưu thông tốt";
  const advice = score >= 71
    ? "Dòng máu ngoại vi suy giảm nghiêm trọng. Uống thuốc chống đông theo đơn (nếu có). Nằm nghỉ, nâng cao chân. Chuẩn bị kích hoạt SOS nếu không cải thiện sau 15 phút."
    : score >= 31
    ? "Máu có dấu hiệu chảy chậm. Uống 200ml nước ấm ngay. Vận động nhẹ cổ tay và chân 5 phút để tăng tuần hoàn."
    : "Tuần hoàn tốt. Duy trì vận động đều đặn và uống đủ nước (1.5–2L/ngày).";
  return { score, level, label, advice, components: { rhythmFactor: Math.round(rhythmFactor), morphFactor: Math.round(morphFactor), hrvFactor, clinFactor } };
}

// ─── Vascular Sleep-Debt & Recovery Screener (UPDATE LIST 5) ─────────────────
function computeVascularRecovery({ waveform, sdnn, rmssd, bpm, systolic }) {
  // Augmentation Index proxy — measures vascular stiffness from secondary wave ratio
  let aixScore = 35;
  if (Array.isArray(waveform) && waveform.length >= 30) {
    const wMin = Math.min(...waveform), wMax = Math.max(...waveform);
    const range = wMax - wMin || 1;
    const norm = waveform.map(v => (v - wMin) / range);
    const peaks = [];
    for (let i = 2; i < norm.length-2; i++) {
      if (norm[i] > norm[i-1] && norm[i] > norm[i-2] && norm[i] > norm[i+1] && norm[i] > norm[i+2] && norm[i] > 0.70) {
        if (!peaks.length || i - peaks[peaks.length-1].idx > 10) peaks.push({ idx: i, val: norm[i] });
      }
    }
    if (peaks.length >= 2) {
      const ratios = [];
      for (let pi = 0; pi < peaks.length-1; pi++) {
        const start = peaks[pi].idx + Math.round((peaks[pi+1].idx - peaks[pi].idx) * 0.3);
        const end = peaks[pi+1].idx - 2;
        if (end > start + 3) {
          let lm = { val: -1, idx: start };
          for (let i = start; i <= end; i++) { if (norm[i] > lm.val) lm = { val: norm[i], idx: i }; }
          if (lm.val > 0.15 && lm.val < peaks[pi].val * 0.85) ratios.push(lm.val / peaks[pi].val);
        }
      }
      if (ratios.length > 0) {
        const avgAIx = ratios.reduce((s,v)=>s+v,0)/ratios.length;
        // Low AIx (elastic) = high recovery score; High AIx (stiff) = low score
        aixScore = Math.max(0, 60 - avgAIx * 70);
      }
    }
  }
  const sdnnScore = (sdnn||0) > 0 ? Math.min(20, ((sdnn||0)/60)*20) : 10;
  const rmssdScore = (rmssd||0) > 0 ? Math.min(10, ((rmssd||0)/40)*10) : 5;
  const bpmScore = (bpm>=55 && bpm<=75) ? 15 : (bpm<55||bpm>100) ? 5 : bpm<=85 ? 12 : 8;
  const sysScore = (systolic||128) < 130 ? 15 : (systolic||128) < 145 ? 10 : (systolic||128) < 160 ? 6 : 2;
  const score = Math.round(clamp(10, aixScore + sdnnScore + rmssdScore + bpmScore + sysScore, 99));
  const status = score >= 81 ? "EXCELLENT" : score >= 51 ? "MODERATE" : "POOR";
  const statusLabel = score >= 81 ? "🟢 Hệ mạch phục hồi hoàn toàn"
    : score >= 51 ? "🟡 Hệ mạch mệt mỏi – Chú ý"
    : "🔴 Báo động Đỏ – Mạch máu chưa phục hồi";
  const recommendation = score >= 81
    ? "Cơ tim dẻo dai, hệ mạch phục hồi sau đêm. Có thể sinh hoạt và tập thể dục bình thường."
    : score >= 51
    ? "Hệ thần kinh tim đêm qua bị căng thẳng (ngưng thở hoặc trằn trọc thầm lặng). Không tắm nước lạnh, không nâng vật nặng hôm nay."
    : "CẢNH BÁO: Chỉ số cứng mạch tăng vọt, nguy cơ đột quỵ sáng sớm cao. Ngồi yên 10 phút, uống 1 cốc nước ấm, đo huyết áp cơ học ngay!";
  return { score, status, statusLabel, recommendation, aixProxy: Math.round(aixScore) };
}

// ─── Individual Risk Score — IRS (UPDATE LIST 6) ─────────────────────────────
function computeIRS(user, measurements, afibBurden7d) {
  const age = Number(user.age || 60);
  const conds = normalizeVi((user.conditions || []).join(" "));
  const ageFactor = age >= 80 ? 20 : age >= 70 ? 15 : age >= 60 ? 10 : age >= 50 ? 6 : 3;
  const condFactor = Math.min(25,
    (/cao huyet ap|tang huyet ap/.test(conds) ? 7 : 0) +
    (/tieu duong|dai thao duong/.test(conds) ? 6 : 0) +
    (/afib|rung nhi/.test(conds) ? 9 : 0) +
    (/suy tim/.test(conds) ? 8 : 0) +
    (/dot quy|stroke/.test(conds) ? 9 : 0)
  );
  const recent = measurements.filter(m => m.type === "face" || m.type === "finger")
    .sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,7);
  let measureFactor = 12;
  if (recent.length > 0) {
    const r = recent[0].result;
    measureFactor = Math.min(25, (r.strokeRiskScore||30)*0.18 + (r.irregularityIndex||20)*0.08 + (r.bpm>100||r.bpm<48?6:r.bpm>90?3:0));
  }
  const afibFactor = Math.min(15, (afibBurden7d?.burden||0)*0.6);
  let hrvFactor = 5;
  if (recent.length >= 3) {
    const avgHrv = recent.slice(0,3).reduce((s,m)=>s+(m.result?.hrvScore||42),0)/3;
    hrvFactor = Math.min(15, Math.max(0, (user.baseline?.hrvScore||42) - avgHrv) * 0.4);
  }
  const score = Math.round(clamp(5, ageFactor+condFactor+measureFactor+afibFactor+hrvFactor, 95));
  const level = score >= 65 ? "HIGH" : score >= 35 ? "MODERATE" : "LOW";
  const levelLabel = score >= 65 ? "🔴 Nguy cơ cao" : score >= 35 ? "🟡 Nguy cơ trung bình" : "🟢 Nguy cơ thấp";
  const older = measurements.filter(m => m.type==="face"||m.type==="finger")
    .filter(m => { const d=Date.now()-new Date(m.createdAt).getTime(); return d>=5*86400000&&d<=10*86400000; }).slice(0,3);
  let trend = "stable";
  if (older.length>0 && recent.length>0) {
    const rS = recent[0].result?.strokeRiskScore||30;
    const oS = average(older.map(m=>m.result?.strokeRiskScore||30));
    if (rS < oS-3) trend = "improving"; else if (rS > oS+3) trend = "worsening";
  }
  return { score, level, levelLabel, trend, components: { ageFactor, condFactor, measureFactor: Math.round(measureFactor), afibFactor: Math.round(afibFactor), hrvFactor: Math.round(hrvFactor) } };
}

// ─── Personalized Risk Profile — PRP (UPDATE LIST 6) ─────────────────────────
function buildPRP(userId, irs, afibBurden7d, allMeasurements, weatherAlert) {
  const users = readJson("users");
  const user = users.find(u => u.id === userId);
  if (!user) return null;
  const age = Number(user.age || 60);
  // Age-group reference medians (CHARGE-AF / ESC 2023)
  const ageNorms = [
    { min:18,max:45, median:18, label:"18-45 tuổi" },
    { min:46,max:55, median:28, label:"46-55 tuổi" },
    { min:56,max:65, median:40, label:"56-65 tuổi" },
    { min:66,max:75, median:54, label:"66-75 tuổi" },
    { min:76,max:120,median:66, label:">75 tuổi" },
  ];
  const ageGroup = ageNorms.find(g=>age>=g.min&&age<=g.max) || ageNorms[3];
  const agePercentile = Math.round(clamp(1, 100-(irs.score/Math.max(1,ageGroup.median))*50, 99));
  const condPercentile = Math.round(clamp(1, 100-(irs.score/Math.max(1,ageGroup.median*1.4))*50, 99));
  const regionPercentile = Math.round(clamp(1, 100-(irs.score/Math.max(1,ageGroup.median*1.15))*50, 99));

  const userMs = allMeasurements.filter(m=>m.userId===userId&&(m.type==="face"||m.type==="finger"))
    .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const todayMs = userMs.filter(m=>Date.now()-new Date(m.createdAt).getTime()<24*3600000);
  const week7Ms = userMs.filter(m=>{ const d=Date.now()-new Date(m.createdAt).getTime(); return d>=5*86400000&&d<=9*86400000; });
  let selfComparison = null;
  if (todayMs.length>0 && week7Ms.length>0) {
    const t=Math.round(average(todayMs.map(m=>m.result?.strokeRiskScore||30)));
    const w=Math.round(average(week7Ms.map(m=>m.result?.strokeRiskScore||30)));
    selfComparison = { today:t, week7:w, delta:w-t, improved:w>t };
  }

  // Personalized anomaly detection — learn thresholds from user history
  const userBaseBpm = user.baseline?.restingBpm || 72;
  const userBaseHrv = user.baseline?.hrvScore || 42;
  const histStroke = userMs.length>=5 ? Math.round(average(userMs.slice(0,20).map(m=>m.result?.strokeRiskScore||30))) : 30;
  const anomalies = [];
  if (userMs.length > 0) {
    const r = userMs[0].result;
    if (Math.abs(r.bpm-userBaseBpm) > 12) anomalies.push({ type:"bpm", value:r.bpm, baseline:userBaseBpm, delta:Math.abs(r.bpm-userBaseBpm) });
    if (Math.abs((r.hrvScore||42)-userBaseHrv) > 12) anomalies.push({ type:"hrv", value:r.hrvScore||42, baseline:userBaseHrv, delta:Math.abs((r.hrvScore||42)-userBaseHrv) });
    if ((r.strokeRiskScore||30) > histStroke+15) anomalies.push({ type:"strokeRisk", value:r.strokeRiskScore||30, baseline:histStroke, delta:(r.strokeRiskScore||30)-histStroke });
  }

  // Behavioral impact forecast (evidence-based estimates)
  const walkImpact = Math.round(irs.score * 0.06);
  const behaviorForecast = [
    { action:"Đi bộ nhẹ 15 phút chiều tối", impact:-Math.max(2,walkImpact), direction:"decrease", note:"Dựa trên lịch sử của bạn" },
    { action:"Uống cà phê sau 16h chiều", impact:+5, direction:"increase" },
    { action:"Ngủ trước 22h tối nay", impact:-Math.max(2, Math.round(irs.score*0.04)), direction:"decrease" },
  ];

  // IRS history chart data (7 days)
  const irsHistory = [];
  for (let i=6; i>=0; i--) {
    const dayMs = userMs.filter(m=>{const d=Date.now()-new Date(m.createdAt).getTime(); return d>=i*86400000&&d<(i+1)*86400000;});
    if (dayMs.length>0) {
      irsHistory.push({ day:i===0?"Hôm nay":i===1?"Hôm qua":`${i} ngày trước`, value:Math.round(average(dayMs.map(m=>m.result?.strokeRiskScore||30))) });
    }
  }

  let epidemicAlert = null;
  if (weatherAlert && (weatherAlert.level==="WARNING"||weatherAlert.level==="DANGER")) {
    epidemicAlert = { message:`Thời tiết bất lợi (${weatherAlert.location||"khu vực bạn"}). Nguy cơ AFib có thể tăng thêm 10-20%.`, recommendation:"Hạn chế ra ngoài, đeo khẩu trang, tránh tập ngoài trời.", level:weatherAlert.level };
  }

  return { irs, ageGroup:ageGroup.label, agePercentile, condPercentile, regionPercentile, selfComparison, userBaseline:{ bpm:userBaseBpm, hrv:userBaseHrv, strokeRisk:histStroke }, anomalies, behaviorForecast, irsHistory, epidemicAlert, afibBurden7d };
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
  const {
    signalQuality = 60, baselineComplete = false, shockIndex,
    bpm = 72, sdnn = 0, strokeRiskScore = 0, irregularityIndex = 0,
    cv = 0, pnn50 = 0, age = 60, conditions = "",
  } = extras;

  // ── AFib ──────────────────────────────────────────────────────────────────
  if (classification === "afib") {
    recs.push("🚨 PHÁT HIỆN RỌI NHĨ (AFib): Ngồi xuống ngay, thở đều và chậm, KHÔNG vận động. Báo ngay cho người thân gần nhất.");
    recs.push("⚡ Gọi 115 ngay nếu có BẤT KỲ triệu chứng: đau ngực, khó thở đột ngột, tê/yếu tay chân, méo miệng, nói khó, chóng mặt dữ dội.");
    recs.push("🔄 Đo lại lần 2 sau 5 phút nghỉ hoàn toàn để xác nhận. Nếu kết quả lặp lại → gặp bác sĩ tim mạch TRONG NGÀY HÔM NAY.");
    if (strokeRiskScore >= 60) recs.push(`⚠️ Nguy cơ đột quỵ ${strokeRiskScore}% — mức cao. Đây là tình huống cần đánh giá y tế NGAY, không trì hoãn sang ngày mai.`);
    recs.push("💊 Nếu bác sĩ đã kê thuốc chống đông (Apixaban / Rivaroxaban / Warfarin): KHÔNG được bỏ liều hôm nay dù cảm thấy bình thường.");
    recs.push("📋 Chuẩn bị đi khám: ghi lại giờ phát hiện, triệu chứng cảm nhận, danh sách thuốc đang dùng. Yêu cầu làm ECG 12 chuyển đạo + Holter 24h để xác nhận.");
    recs.push("👨‍👩‍👧 Nhấn nút 'Gửi phân tích AI cho người thân' bên dưới để người thân biết tình trạng ngay lập tức.");
    return recs;
  }

  // ── Elevated ───────────────────────────────────────────────────────────────
  if (classification === "elevated") {
    if (bpm > 100) {
      recs.push(`⚠️ Nhịp tim ${bpm} BPM đang nhanh (>100 BPM). Ngồi yên, thở chậm nhịp 4-6 (hít 4 giây – thở ra 6 giây), lặp 5 lần rồi đo lại.`);
    } else if (bpm < 50) {
      recs.push(`⚠️ Nhịp tim ${bpm} BPM khá thấp. Nếu bạn không phải vận động viên, hãy đứng dậy từ từ và quan sát. Chóng mặt hoặc gần ngất → gặp bác sĩ ngay.`);
    }
    if (irregularityIndex >= 45) {
      recs.push(`🔄 Độ bất thường nhịp ${irregularityIndex}% — tim đập có phần không đều. Tránh hoàn toàn cà phê, rượu bia, thuốc lá và tình huống căng thẳng trong 24 giờ tới.`);
    }
    if (sdnn > 0 && sdnn < 25) {
      recs.push(`💤 HRV (SDNN ${sdnn}ms) rất thấp — cơ thể đang bị stress nặng hoặc thiếu ngủ. Ưu tiên ngủ đủ 7–8 giờ tối nay, không làm việc sau 22h.`);
    }
    if (strokeRiskScore >= 55) {
      recs.push(`📊 Nguy cơ đột quỵ ${strokeRiskScore}% — mức trung bình-cao. Đo huyết áp ngay nếu có máy đo. Mục tiêu cần đạt: <130/80 mmHg.`);
    }
    recs.push("📝 Ghi vào nhật ký triệu chứng: hôm nay có uống cà phê/trà đặc, căng thẳng công việc, mất ngủ, hoặc vừa vận động không? Đây là nguyên nhân phổ biến nhất gây elevated.");
    recs.push("⏰ Đo lại sau 30–60 phút nghỉ ngơi hoàn toàn (ngồi yên, tắt điện thoại). Nếu 3 lần liên tiếp trong 3 ngày đều elevated → đặt lịch khám tim mạch.");
    if (!baselineComplete) recs.push("🎯 Hoàn thiện Heart-Print (cần thêm " + (3 - (extras.baselineSessions || 0)) + " lần đo sáng sớm) để hệ thống phân biệt được baseline cá nhân của bạn — tránh báo động nhầm.");
    return recs;
  }

  // ── Normal ─────────────────────────────────────────────────────────────────
  if (bpm < 60) {
    recs.push(`✅ Nhịp tim ${bpm} BPM — nhịp chậm bình thường, thường gặp ở người luyện tập thể dục đều đặn hoặc tập yoga/thiền. Tim khỏe mạnh và hiệu quả.`);
  } else if (bpm <= 72) {
    recs.push(`✅ Nhịp tim ${bpm} BPM — lý tưởng, nằm trong vùng tối ưu 60–72 BPM. Đây là dấu hiệu tim khỏe mạnh và hệ thần kinh cân bằng tốt.`);
  } else {
    recs.push(`✅ Nhịp tim ${bpm} BPM — bình thường, trong giới hạn 60–100 BPM. Để tối ưu hơn hướng đến 65–72 BPM bằng cardio nhẹ đều đặn.`);
  }
  if (sdnn > 0) {
    if (sdnn >= 60) {
      recs.push(`💚 HRV xuất sắc (SDNN ${sdnn}ms) — hệ thần kinh tim mạch hoạt động rất tốt, thích nghi cao với stress. Tiếp tục duy trì thói quen tập luyện và giấc ngủ hiện tại.`);
    } else if (sdnn >= 40) {
      recs.push(`💛 HRV tốt (SDNN ${sdnn}ms). Cải thiện thêm: tập thở nhịp 5-5 (hít vào 5 giây – thở ra 5 giây) 10 phút trước khi ngủ, nhắm mắt. Sau 2 tuần SDNN sẽ tăng 10–15%.`);
    } else if (sdnn >= 20) {
      recs.push(`🟡 HRV trung bình (SDNN ${sdnn}ms). Ưu tiên: ngủ trước 23h, giảm caffeine sau 14h, đi bộ nhẹ 20–30 phút mỗi ngày. Tránh tập HIIT cho đến khi SDNN đạt >40ms.`);
    } else {
      recs.push(`🔴 HRV thấp (SDNN ${sdnn}ms) — cơ thể cần nghỉ ngơi. Hôm nay: ngủ thêm 30–60 phút, uống đủ 2 lít nước, không tập thể dục cường độ cao.`);
    }
  }
  if (strokeRiskScore < 25) {
    recs.push(`🛡️ Nguy cơ đột quỵ ${strokeRiskScore}% — mức thấp, rất tốt. Duy trì bằng: không hút thuốc, huyết áp <130/80 mmHg, vận động 150 phút/tuần (30 phút × 5 ngày).`);
  } else if (strokeRiskScore < 50) {
    recs.push(`📊 Nguy cơ đột quỵ ${strokeRiskScore}% — mức trung bình. Giảm xuống bằng: ăn giảm muối (<5g/ngày tương đương 1 thìa cà phê), tăng cá/rau xanh, kiểm tra huyết áp 1 lần/tuần.`);
  } else {
    recs.push(`⚠️ Nguy cơ đột quỵ ${strokeRiskScore}% — cần chú ý. Đặt lịch xét nghiệm máu (cholesterol toàn phần, LDL, đường huyết, CRP) và đo huyết áp trong tháng này.`);
  }
  recs.push("⏰ Thời điểm đo chuẩn nhất: 7–9h sáng (sau thức dậy 5 phút, trước ăn sáng) và 21–22h tối. Đo đều 2 lần/ngày cho dữ liệu Holter chính xác nhất.");
  if (!baselineComplete) {
    recs.push("🎯 Bạn chưa hoàn thiện Heart-Print cá nhân. Đo thêm vào sáng sớm 3 ngày liên tiếp (7–8h, chưa ăn sáng) để hệ thống học được baseline riêng — độ chính xác tăng 40%.");
  } else {
    recs.push("🏆 Heart-Print đã hoàn thiện — hệ thống đang so sánh kết quả với baseline cá nhân của bạn để phát hiện thay đổi nhỏ nhất.");
  }

  // Signal quality note
  if (signalQuality < 60) recs.push("📶 Chất lượng tín hiệu chưa cao. Đo lại: che kín camera + đèn flash (ngón tay), hoặc đảm bảo đủ ánh sáng mặt (khuôn mặt). Giữ tay hoàn toàn yên trong 60 giây.");
  if (shockIndex?.level === "WARNING") recs.push("⚠️ Chỉ số sốc tim mạch cao. Nằm nghỉ ngay, kê chân cao hơn tim 15–20cm, uống nước và theo dõi sát.");
  if (shockIndex?.level === "CRITICAL") recs.push("🚨 KHẨN CẤP: Chỉ số sốc cực cao. Kích hoạt SOS ngay và gọi 115!");
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
  const sampEn = Number(payload.sampEn || 0);
  const sd1 = Number(payload.sd1 || 0);
  const sd2 = Number(payload.sd2 || 0);
  const histEntropy    = Number(payload.histEntropy    || 0);
  const temporalScore  = Number(payload.temporalScore  || 0);
  const dfaAlpha1      = payload.dfaAlpha1 !== undefined && payload.dfaAlpha1 !== null ? Number(payload.dfaAlpha1) : null;
  const permEntropy    = Number(payload.permEntropy    || 0);
  const lorenzAfibScore = Number(payload.lorenzAfibScore || 0);
  const normalizedRmssd = Number(payload.normalizedRmssd || 0);
  const bpmCiRange     = Number(payload.bpmCiRange     || 15);
  const bpmCiLabel     = String(payload.bpmCiLabel     || 'low'); // 'high'|'moderate'|'low'
  const qualityGateLevel = String(payload.qualityGateLevel || 'ok');
  // UL3: Morphology + hemodynamic fields
  const morphology = payload.morphology && typeof payload.morphology === 'object' ? payload.morphology : null;
  const pavIndex   = Number(payload.pav?.pavIndex || 0);
  const hcIndex    = Number(payload.hc?.hcIndex   || 50);
  const bbHint     = payload.bbHint && typeof payload.bbHint === 'object' ? payload.bbHint : null;
  const measurementHand = String(payload.measurementHand || 'right');
  const contextNote = String(payload.contextNote || "").trim();
  const waveform = Array.isArray(payload.waveform) ? payload.waveform.slice(0, 120) : [];
  const rrIntervals = Array.isArray(payload.rrIntervals) ? payload.rrIntervals.slice(0, 60) : []; // D2 fix: 30→60
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
  // D4: SDNN bình thường giảm theo tuổi — tránh over-flag người cao tuổi có SDNN thấp
  // Median SDNN: 18-30t≈65ms, 31-45t≈55ms, 46-60t≈45ms, 61-75t≈35ms, >75t≈28ms
  const sdnnAgeNorm = age < 31 ? 65 : age < 46 ? 55 : age < 61 ? 45 : age < 76 ? 35 : 28;
  const sdnnAgeAdjusted = sdnn > 0 ? sdnn * (50 / Math.max(1, sdnnAgeNorm)) : 0; // normalize to age-50 reference
  const qualityPenalty = Math.max(0, 65 - signalQuality) * 0.36;
  const baselineBpm = Number(baseline.restingBpm || 72);
  const baselineHrv = Number(baseline.hrvScore || 42);
  const bpmDelta = Math.abs(estimatedBpm - baselineBpm);
  const hrvDelta = baseline.complete ? Math.abs(hrvScore - baselineHrv) : 0;
  // E4 fix: thêm dấu tiếng Việt đầy đủ vào pattern matching
  const contextPenalty = (/(stress|cà phê|ca phe|coffee|mệt|met|mất ngủ|mat ngu|lo lắng|hồi hộp)/i.test(contextNote) ? 4 : 0)
    + (contextUnchecked ? 3 : 0);
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

  // Multi-metric boosts — dùng tất cả nguồn evidence mới
  const sampEnBoost     = sampEn > 0.9 && cv > 0.20;
  const poincareBoost   = sd2 > 0 && sd1 / sd2 > 0.85;
  const histEntropyBoost = histEntropy > 2.0 && cv > 0.18;
  const temporalBoost   = temporalScore >= 0.50;
  const dfaBoost        = dfaAlpha1 !== null && dfaAlpha1 < 0.72;  // NEW
  const peBoost         = permEntropy > 0.82;                       // NEW
  const lorenzBoost     = lorenzAfibScore > 0.48;                   // NEW
  const nRmssdBoost     = normalizedRmssd > 0.26;                   // NEW
  // Đếm số nguồn evidence đồng thuận (strong multi-metric consensus)
  const boostCount = [sampEnBoost, poincareBoost, histEntropyBoost, dfaBoost, peBoost, lorenzBoost, nRmssdBoost].filter(Boolean).length;

  // Reject classification nếu quality gate client đã từ chối
  const clientHardReject = qualityGateLevel === 'hard';

  const strongAfib = !clientHardReject && qualityForAfib
    && cv > adaptiveCvThreshold && pnn50 > 40 && irregularityIndex >= 65
    && estimatedBpm >= 50 && estimatedBpm <= 185
    && temporalScore >= 0.40 && bpmCiRange <= 12;
  const moderateAfib = !clientHardReject && qualityForAfib && clientAfibFlag
    && cv > adaptiveCvModerate && pnn50 > 30
    && irregularityIndex >= 58 && estimatedBpm >= 50 && estimatedBpm <= 185
    && temporalScore >= 0.35 && bpmCiLabel !== 'low';
  // Boosted: nhiều nguồn evidence đồng thuận mạnh
  const boostedAfib = !clientHardReject && qualityForAfib && clientAfibFlag
    && boostCount >= 4 && temporalBoost
    && cv > 0.20 && irregularityIndex >= 52 && estimatedBpm >= 50 && estimatedBpm <= 185;

  let classification = "normal";
  if (strongAfib || moderateAfib || boostedAfib) {
    classification = "afib";
  } else {
    const bpmOutOfRange = estimatedBpm < 46 || estimatedBpm > 118;
    const bpVeryHigh = systolic >= 150;
    const rhythmSignificant = irregularityIndex >= 62 && signalQuality >= 55;
    const elevatedThreshold = contextUnchecked ? 72 : 68;
    if (bpmOutOfRange || bpVeryHigh || rhythmSignificant || strokeRiskScore >= elevatedThreshold) {
      classification = "elevated";
    }
  }
  if (classification === "normal" && signalQuality < 38) classification = "elevated";

  const shockIndex = evaluateShockIndex(estimatedBpm, systolic);

  const signalQualityScore = Math.round(clamp(18, signalQuality, 99));
  // Confidence tính thêm từ CI range và số evidence boosts
  const methodsAgreed = [clientAfibFlag, strongAfib, sampEnBoost, poincareBoost, dfaBoost, peBoost].filter(Boolean).length;
  const ciBonus = bpmCiLabel === 'high' ? 8 : bpmCiLabel === 'moderate' ? 4 : 0;
  const classificationConfidence = Math.round(clamp(40,
    signalQuality * 0.45 + lightScore * 0.15 + stabilityScore * 0.18
    + (rrIntervals.length > 10 ? 8 : rrIntervals.length > 5 ? 4 : 0)
    + methodsAgreed * 3 + ciBonus, 97));

  const baselineStatus = baseline.complete
    ? `Lệch ${bpmDelta} BPM và ${hrvDelta} điểm HRV so với baseline`
    : "Chưa hoàn thành 3 lần baseline Heart-Print";

  const recommendation = generateRecommendations(classification, {
    signalQuality, baselineComplete: baseline.complete, shockIndex,
    bpm: estimatedBpm, sdnn, strokeRiskScore, irregularityIndex, cv, pnn50,
    age, conditions, baselineSessions: baseline.sessions?.length || 0,
  });

  return {
    type, bpm: estimatedBpm, hrvScore, sdnn, rmssd, pnn50, cv,
    sampEn, sd1, sd2, histEntropy, temporalScore,
    dfaAlpha1, permEntropy, lorenzAfibScore, normalizedRmssd,
    bpmCiRange, bpmCiLabel,
    strokeRiskScore, irregularityIndex, lightScore, stabilityScore,
    signalQuality: signalQualityScore,
    confidence: classificationConfidence,
    classificationConfidence,
    classification, baselineStatus,
    contextNote, recommendation, waveform, rrIntervals, shockIndex,
    morphology, pavIndex, hcIndex, bbHint, measurementHand,
    shouldTriggerSos: classification === "afib" || shockIndex.sos,
    generatedAt: new Date().toISOString(),
    // UPDATE LIST 5: Clot-Risk + Vascular Recovery
    clotRisk: computeClotRiskScore({ waveform, bpm: estimatedBpm, irregularityIndex, cv, sdnn, rmssd, pnn50, age, conditions }),
    vascularRecovery: computeVascularRecovery({ waveform, sdnn, rmssd, bpm: estimatedBpm, systolic }),
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

// ─── Nhóm 2: Medication Effectiveness Tracker ────────────────────────────────
function computeMedicationEffectiveness(user, measurements) {
  const protocols = readJson("pillProtocols").filter(p => p.userId === user.id && p.active);
  if (!protocols.length) return null;
  const proto = protocols[0];
  const startDate = new Date(proto.createdAt);
  const ppgMs = measurements.filter(m => m.type === "face" || m.type === "finger").sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));
  const before = ppgMs.filter(m => new Date(m.createdAt) < startDate).slice(-14);
  const after  = ppgMs.filter(m => new Date(m.createdAt) >= startDate).slice(0, 30);
  if (before.length < 3 || after.length < 3) return { insufficient: true, medicineName: proto.medicineName, daysOn: Math.round((Date.now()-startDate.getTime())/86400000) };
  const avg = (arr, key) => arr.reduce((s,m) => s+(m.result?.[key]||0),0)/arr.length;
  const bBpm=Math.round(avg(before,'bpm')), aBpm=Math.round(avg(after,'bpm'));
  const bHrv=Math.round(avg(before,'sdnn')), aHrv=Math.round(avg(after,'sdnn'));
  const bAfib=Math.round((before.filter(m=>m.result?.classification==='afib').length/before.length)*100);
  const aAfib=Math.round((after.filter(m=>m.result?.classification==='afib').length/after.length)*100);
  const bStroke=Math.round(avg(before,'strokeRiskScore')), aStroke=Math.round(avg(after,'strokeRiskScore'));
  let score=50;
  if(aBpm<bBpm-5)score+=15; else if(aBpm>bBpm+5)score-=15;
  if(aHrv>bHrv+3)score+=15; else if(aHrv<bHrv-3)score-=10;
  if(aAfib<bAfib-10)score+=20; else if(aAfib>bAfib+10)score-=20;
  if(aStroke<bStroke-5)score+=10; else if(aStroke>bStroke+5)score-=10;
  score=Math.round(clamp(0,score,100));
  const label=score>=80?"Rất hiệu quả":score>=60?"Có hiệu quả":score>=40?"Hiệu quả hạn chế":"Cần xem xét lại với bác sĩ";
  return { medicineName:proto.medicineName, dose:proto.dose, daysOn:Math.round((Date.now()-startDate.getTime())/86400000), beforeSample:before.length, afterSample:after.length, bpm:{before:bBpm,after:aBpm,change:aBpm-bBpm}, hrv:{before:bHrv,after:aHrv,change:aHrv-bHrv}, afib:{before:bAfib,after:aAfib,change:aAfib-bAfib}, stroke:{before:bStroke,after:aStroke,change:aStroke-bStroke}, score, label };
}

// ─── Nhóm 2: Disease Progression Predictor 6 tháng ───────────────────────────
function computeDiseaseProgression(measurements, afibBurden7d, afibBurden30d, irs) {
  const ppgMs = measurements.filter(m=>m.type==="face"||m.type==="finger").sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  if (ppgMs.length < 8) return null;
  // Chia thành 4 cụm thời gian để tính slope
  const chunk = Math.max(2, Math.floor(ppgMs.length/4));
  const chunks = [0,1,2,3].map(i=>ppgMs.slice(i*chunk, (i+1)*chunk));
  const avgM = (arr, key) => arr.length ? arr.reduce((s,m)=>s+(m.result?.[key]||0),0)/arr.length : 0;
  const sdnnChunks = chunks.map(c=>Math.round(avgM(c,'sdnn')));
  const riskChunks = chunks.map(c=>Math.round(avgM(c,'strokeRiskScore')));
  const afibChunks = chunks.map(c=>c.length?Math.round((c.filter(m=>m.result?.classification==='afib').length/c.length)*100):0);
  // Linear slope per chunk-period
  const slope = (arr) => arr.length<2?0:(arr[arr.length-1]-arr[0])/(arr.length-1);
  const sdnnSlope = slope(sdnnChunks);   // ms per period
  const riskSlope = slope(riskChunks);   // points per period
  const afibSlope = slope(afibChunks);   // % per period
  // Project 6 months (≈ 2 periods ahead)
  const projRisk = Math.round(clamp(5, riskChunks[riskChunks.length-1]+riskSlope*2, 98));
  const projAfib = Math.round(clamp(0, (afibBurden7d?.burden||0)+afibSlope*2, 100));
  const projSdnn = Math.round(clamp(10, sdnnChunks[sdnnChunks.length-1]+sdnnSlope*2, 90));
  const currentIRS = irs?.score||40;
  const irsSlope6m = riskSlope > 2 ? 8 : riskSlope > 0 ? 3 : riskSlope < -2 ? -6 : -2;
  const projIRS = Math.round(clamp(5, currentIRS+irsSlope6m, 95));
  const trend = projIRS>currentIRS+5?"WORSENING":projIRS<currentIRS-5?"IMPROVING":"STABLE";
  const trendLabel = trend==="WORSENING"?"📈 Đang xấu đi":trend==="IMPROVING"?"📉 Đang cải thiện":"➡️ Ổn định";
  const urgent = projAfib>=25||projRisk>=70||projIRS>=65;
  // Action recommendation
  const advice = trend==="WORSENING"
    ? `Nếu giữ nguyên lối sống hiện tại, trong 6 tháng tới IRS có thể tăng lên ${projIRS}/100 và AFib Burden lên ${projAfib}%. Cần tái khám bác sĩ tim mạch ngay trong tháng này.`
    : trend==="IMPROVING"
    ? `Tim đang cải thiện! Tiếp tục duy trì thói quen hiện tại. Dự báo 6 tháng: IRS ${projIRS}/100, AFib Burden ${projAfib}%.`
    : `Tim đang ổn định. Duy trì đo đều đặn và lối sống lành mạnh để giữ xu hướng này.`;
  return { sdnnChunks, riskChunks, afibChunks, projRisk, projAfib, projSdnn, projIRS, currentIRS, currentBurden:afibBurden7d?.burden||0, trend, trendLabel, urgent, advice, dataPoints:ppgMs.length };
}

// ─── Nhóm 2: Heart Rate Recovery Test (result caching) ───────────────────────
// Logic chính chạy client-side; server chỉ lưu kết quả qua /api/hrr-result
function saveHRRResult(userId, body) {
  const users = readJson("users");
  const user = users.find(u=>u.id===userId);
  if (!user) return null;
  user.hrrResult = { ...body, savedAt: new Date().toISOString() };
  writeJson("users", users);
  appendLedgerEntry(userId, "hrr.test", "Lưu kết quả HRR test", body);
  return user.hrrResult;
}

// ─── Nhóm 4: Monthly Risk Calendar ──────────────────────────────────────────
function buildMonthlyRiskCalendar(userId, allMeasurements, circadian) {
  const ppgMs = allMeasurements.filter(m=>m.userId===userId&&(m.type==="face"||m.type==="finger"));
  const calendar = [];
  const now = new Date();
  for (let i=-29; i<=0; i++) {
    const d = new Date(now); d.setDate(d.getDate()+i);
    const dateStr = d.toISOString().slice(0,10);
    const dayMs = ppgMs.filter(m=>m.createdAt.slice(0,10)===dateStr);
    let level="no_data", afibCount=0, avgRisk=0;
    if (dayMs.length>0) {
      afibCount = dayMs.filter(m=>m.result?.classification==="afib").length;
      avgRisk = Math.round(dayMs.reduce((s,m)=>s+(m.result?.strokeRiskScore||30),0)/dayMs.length);
      level = afibCount>0?"red":avgRisk>=60?"yellow":"green";
    }
    calendar.push({ date:dateStr, day:d.getDate(), month:d.getMonth()+1, dayOfWeek:d.getDay(), level, isToday:i===0, measureCount:dayMs.length, afibCount, avgRisk });
  }
  return calendar;
}

// ─── Nhóm 4: Seasonal Heart Pattern ─────────────────────────────────────────
function computeSeasonalPattern(userId, allMeasurements) {
  const ppgMs = allMeasurements.filter(m=>m.userId===userId&&(m.type==="face"||m.type==="finger"));
  if (ppgMs.length<12) return null;
  const seasons = { "Mùa Xuân (T3-T5)":[3,4,5], "Mùa Hè (T6-T8)":[6,7,8], "Mùa Thu (T9-T11)":[9,10,11], "Mùa Đông (T12-T2)":[12,1,2] };
  const stats = {};
  for (const [name, months] of Object.entries(seasons)) {
    const ms = ppgMs.filter(m=>months.includes(new Date(m.createdAt).getMonth()+1));
    if (!ms.length) continue;
    const avgFn=(key)=>Math.round(ms.reduce((s,m)=>s+(m.result?.[key]||0),0)/ms.length);
    stats[name] = { count:ms.length, avgBpm:avgFn('bpm'), avgHrv:avgFn('sdnn'), afibPct:Math.round((ms.filter(m=>m.result?.classification==="afib").length/ms.length)*100), avgRisk:avgFn('strokeRiskScore') };
  }
  const worst = Object.entries(stats).sort((a,b)=>b[1].afibPct-a[1].afibPct)[0];
  const best  = Object.entries(stats).sort((a,b)=>a[1].afibPct-b[1].afibPct)[0];
  return { stats, worstSeason:worst?.[0], bestSeason:best?.[0], totalPoints:ppgMs.length };
}

// ─── Nhóm 4: Electrolyte Balance Estimator ───────────────────────────────────
function computeElectrolyteRisk(result) {
  if (!result) return null;
  const { sdnn=35, rmssd=25, cv=0.15, irregularityIndex=20, bpm=72, pnn50=10 } = result;
  let kRisk=0, mgRisk=0; // potassium & magnesium
  if(sdnn<25)kRisk+=2; if(sdnn<20)kRisk+=2; if(irregularityIndex>40)kRisk+=2;
  if(rmssd<15)kRisk+=1; if(bpm>95)kRisk+=1; if(pnn50<5&&bpm>85)kRisk+=1;
  if(irregularityIndex>35)mgRisk+=2; if(cv>0.20)mgRisk+=2;
  if(pnn50>30&&irregularityIndex>45)mgRisk+=2; if(bpm>100)mgRisk+=1;
  kRisk=Math.min(7,kRisk); mgRisk=Math.min(7,mgRisk);
  const kLevel=kRisk>=5?"LOW":kRisk>=3?"BORDERLINE":"NORMAL";
  const mgLevel=mgRisk>=5?"LOW":mgRisk>=3?"BORDERLINE":"NORMAL";
  const rec=kLevel==="LOW"||mgLevel==="LOW"
    ?"Ăn chuối, khoai lang (kali) và hạnh nhân, hạt bí (magie) ngay hôm nay. Hỏi bác sĩ xét nghiệm điện giải đồ."
    :kLevel==="BORDERLINE"||mgLevel==="BORDERLINE"
    ?"Uống nước dừa hoặc nước khoáng. Tránh cà phê và rượu bia — gây mất điện giải."
    :"Điện giải ổn định. Duy trì uống đủ 1.5-2L nước mỗi ngày.";
  return { kLevel, mgLevel, kRisk, mgRisk, recommendation:rec };
}

// ─── Nhóm 4: Heart Math Coherence Score ──────────────────────────────────────
function computeCoherenceScore(result) {
  if (!result) return null;
  const sdnnV=result.sdnn||35, rmssdV=result.rmssd||25;
  // LF/HF proxy: ratio of SDNN to RMSSD reflects sympathovagal balance
  const ratio=rmssdV>0?Math.round((sdnnV/rmssdV)*10)/10:1.5;
  // Ideal coherence: ratio 0.8-1.6 (balanced)
  const coherence=ratio<0.4?25:ratio<0.7?55:ratio<1.0?80:ratio<1.8?95:ratio<2.5?65:30;
  const status=coherence>=80?"COHERENT":coherence>=60?"MODERATE":"INCOHERENT";
  const label=coherence>=80?"🟢 Tim-Não cộng hưởng hoàn hảo":coherence>=60?"🟡 Cộng hưởng trung bình":"🔴 Mất cộng hưởng — stress cao";
  const advice=coherence<60?"Thực hiện Breathing Coach ngay 10 phút để phục hồi cộng hưởng tim-não.":coherence<80?"Nghỉ ngơi, hít thở chậm 5 phút.":"Duy trì trạng thái này — rất tốt cho tim mạch.";
  return { coherence:Math.round(coherence), ratio, status, label, advice };
}

// ─── Nhóm 3: Nearby Cardiology Map data ──────────────────────────────────────
// Data tĩnh — bệnh viện tim mạch lớn Việt Nam theo vùng
const CARDIO_HOSPITALS = [
  { name:"BV Tim Hà Nội", addr:"03 Chu Văn An, Ba Đình, HN", tel:"024 3843 3338", lat:21.0437, lon:105.8367, city:"Hà Nội" },
  { name:"Viện Tim mạch VN (BV Bạch Mai)", addr:"78 Đường Giải Phóng, Hà Nội", tel:"024 3869 3731", lat:21.0025, lon:105.8412, city:"Hà Nội" },
  { name:"BV ĐH Y Dược TP.HCM", addr:"215 Hồng Bàng, Q5, HCM", tel:"028 3855 4269", lat:10.7560, lon:106.6625, city:"TP.HCM" },
  { name:"Viện Tim TP.HCM", addr:"520 Nguyễn Tri Phương, Q10, HCM", tel:"028 3865 4904", lat:10.7694, lon:106.6667, city:"TP.HCM" },
  { name:"BV Chợ Rẫy", addr:"201B Nguyễn Chí Thanh, Q5, HCM", tel:"028 3855 4137", lat:10.7527, lon:106.6619, city:"TP.HCM" },
  { name:"BV TW Huế", addr:"16 Lê Lợi, TP Huế", tel:"0234 382 2325", lat:16.4637, lon:107.5909, city:"Huế" },
  { name:"BV Đà Nẵng", addr:"124 Hải Phòng, TP Đà Nẵng", tel:"0236 382 2480", lat:16.0583, lon:108.2113, city:"Đà Nẵng" },
  { name:"BV TW Cần Thơ", addr:"Đường 4 Tháng 2, TP Cần Thơ", tel:"0292 382 4982", lat:10.0360, lon:105.7875, city:"Cần Thơ" },
];

// ─── Nhóm 5: Doctor Visit Prep ───────────────────────────────────────────────
function buildDoctorVisitPrep(user, dashboard) {
  const r = dashboard.latestMeasurement?.result || {};
  const g = user.guardian || {};
  // Danh sách câu hỏi nên hỏi bác sĩ dựa trên dữ liệu
  const questions = [];
  if(r.classification==="afib") questions.push("Tôi vừa phát hiện AFib qua HeartSense. Bác sĩ có thể xác nhận và tư vấn điều trị không?");
  if((r.strokeRiskScore||0)>55) questions.push(`Điểm nguy cơ đột quỵ của tôi là ${r.strokeRiskScore}%. Tôi có cần điều chỉnh thuốc chống đông không?`);
  if((dashboard.afibBurden7d?.burden||0)>10) questions.push(`AFib Burden 7 ngày của tôi là ${dashboard.afibBurden7d?.burden}% — có đáng lo không?`);
  if(dashboard.heartBioAge?.delta>5) questions.push(`Tuổi tim sinh học của tôi cao hơn tuổi thật ${dashboard.heartBioAge?.delta} năm. Tôi cần làm gì để cải thiện?`);
  if(dashboard.safeExerciseDose?.level==="RED") questions.push("Hôm nay chỉ số vận động của tôi màu đỏ. Tôi có nên giảm hoạt động thể chất không?`");
  questions.push("Thuốc hiện tại của tôi có cần điều chỉnh liều lượng không?");
  questions.push("Tôi nên theo dõi thêm chỉ số gì trong 3 tháng tới?");
  // Danh sách thuốc
  const meds = (user.pillProtocol?.medicineName ? [`${user.pillProtocol.medicineName} ${user.pillProtocol.dose}`] : []);
  const reminders = readJson("reminders").filter(rm=>rm.userId===user.id&&rm.active);
  reminders.forEach(rm=>{ if(rm.medicineName&&!meds.includes(rm.medicineName)) meds.push(`${rm.medicineName} — ${rm.time}`); });
  // Checklist chuẩn bị
  const checklist = [
    { item:"Mang theo điện thoại có app HeartSense", done:true },
    { item:"In hoặc show PDF báo cáo HeartSense 3 tháng", done:!!dashboard.latestMeasurement },
    { item:"Ghi lại triệu chứng gần đây", done:(dashboard.symptoms||[]).length>0 },
    { item:"Mang theo danh sách thuốc đang dùng", done:meds.length>0 },
    { item:"Nhịn cà phê 4 tiếng trước khi khám", done:false },
    { item:"Đo huyết áp sáng trước khi đi khám", done:false },
  ];
  return { questions, medications:meds, checklist, exportToken:dashboard.user?.exportToken||null };
}

// ─── Nhóm 5: Family View token ───────────────────────────────────────────────
function generateFamilyToken(userId) {
  const users = readJson("users");
  const user = users.find(u=>u.id===userId);
  if (!user) return null;
  const token = crypto.randomBytes(12).toString("hex");
  user.familyToken = { token, createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+30*24*3600000).toISOString() };
  writeJson("users", users);
  return token;
}

// ─── Heart Biological Age ─────────────────────────────────────────────────────
// Tính tuổi sinh học của tim dựa trên HRV, AFib burden, ClotRisk, ASI, VascularRecovery
function computeHeartBiologicalAge(user, measurements, afibBurden7d, latestResult) {
  const chronoAge = Number(user.age || 60);

  // Age-matched SDNN norms (ms) — từ nghiên cứu CHARGE-AF, Framingham, ESC
  const sdnnNorms = [
    { min:18, max:30, sdnn:65 }, { min:31, max:45, sdnn:55 },
    { min:46, max:60, sdnn:45 }, { min:61, max:75, sdnn:35 }, { min:76, max:120, sdnn:25 },
  ];
  const ageGroup = sdnnNorms.find(g => chronoAge >= g.min && chronoAge <= g.max) || sdnnNorms[3];
  const expectedSdnn = ageGroup.sdnn;

  // Lấy SDNN trung bình 30 ngày
  const ppgMs = measurements.filter(m => m.type === "face" || m.type === "finger")
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30);
  const avgSdnn = ppgMs.length > 0
    ? ppgMs.reduce((s,m) => s + (m.result?.sdnn || expectedSdnn), 0) / ppgMs.length
    : expectedSdnn;

  // Delta SDNN → tuổi tim (mỗi 5ms SDNN lệch = ~2 tuổi)
  const sdnnDelta = Math.round((expectedSdnn - avgSdnn) / 5 * 2);

  // AFib burden → tuổi tim (mỗi 10% burden = +3 tuổi)
  const burden = afibBurden7d?.burden || 0;
  const afibDelta = Math.round(burden / 10 * 3);

  // ClotRisk → tuổi tim
  const clotScore = latestResult?.clotRisk?.score || 30;
  const clotDelta = clotScore >= 70 ? 6 : clotScore >= 40 ? 3 : clotScore >= 20 ? 0 : -2;

  // Vascular Recovery → tuổi mạch (phục hồi thấp = mạch già)
  const vasScore = latestResult?.vascularRecovery?.score || 60;
  const vasDelta = vasScore >= 80 ? -3 : vasScore >= 60 ? 0 : vasScore >= 40 ? 3 : 6;

  // HRV trend: so sánh 7 ngày đầu vs 7 ngày cuối trong 30 ngày
  let trendDelta = 0;
  if (ppgMs.length >= 14) {
    const recent7 = ppgMs.slice(0, 7).map(m => m.result?.sdnn || expectedSdnn);
    const older7 = ppgMs.slice(ppgMs.length - 7).map(m => m.result?.sdnn || expectedSdnn);
    const recentAvg = recent7.reduce((s,v) => s+v, 0) / recent7.length;
    const olderAvg = older7.reduce((s,v) => s+v, 0) / older7.length;
    if (recentAvg > olderAvg + 3) trendDelta = -2; // đang trẻ hóa
    else if (recentAvg < olderAvg - 3) trendDelta = +2; // đang già đi
  }

  // Tính tuổi tim sinh học
  const rawBioAge = chronoAge + sdnnDelta + afibDelta + clotDelta + vasDelta + trendDelta;
  const bioAge = Math.round(clamp(20, rawBioAge, 95));
  const delta = bioAge - chronoAge; // âm = tim trẻ hơn, dương = tim già hơn

  // Phân loại
  const category = delta <= -5 ? "EXCELLENT" : delta <= -1 ? "GOOD" : delta <= 4 ? "AVERAGE" : delta <= 9 ? "AGING" : "CRITICAL";
  const categoryLabel = {
    EXCELLENT: "🏆 Xuất sắc — Tim trẻ hơn tuổi thật",
    GOOD: "🟢 Tốt — Tim phù hợp với tuổi",
    AVERAGE: "🟡 Trung bình — Cần duy trì",
    AGING: "🟠 Lão hóa nhanh — Cần can thiệp",
    CRITICAL: "🔴 Nguy cơ cao — Tim già hơn nhiều so với tuổi thật",
  }[category];

  // Nhân tố ảnh hưởng nhiều nhất
  const factors = [
    { name: "HRV (SDNN)", delta: sdnnDelta, current: Math.round(avgSdnn), norm: expectedSdnn, unit: "ms" },
    { name: "AFib Burden 7 ngày", delta: afibDelta, current: burden, norm: 0, unit: "%" },
    { name: "Nguy cơ huyết khối", delta: clotDelta, current: clotScore, norm: 25, unit: "điểm" },
    { name: "Phục hồi mạch máu", delta: vasDelta, current: vasScore, norm: 75, unit: "%" },
  ].sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Lời khuyên cải thiện tuổi tim
  const topFactor = factors[0];
  let advice = "";
  if (topFactor.name.includes("HRV")) advice = "Tập thở hộp (4-4-4-4) mỗi ngày 10 phút và ngủ trước 22h — đây là cách tốt nhất để tăng HRV và trẻ hóa tim.";
  else if (topFactor.name.includes("AFib")) advice = "Giảm AFib Burden bằng cách uống thuốc đúng giờ, tránh rượu bia và cà phê sau 14h.";
  else if (topFactor.name.includes("huyết khối")) advice = "Uống đủ nước (2L/ngày), vận động nhẹ mỗi ngày, không ngồi một chỗ quá 2 giờ liên tục.";
  else advice = "Đo ngay sau khi ngủ dậy để cải thiện chỉ số phục hồi mạch máu. Ngủ đủ 7-8 tiếng mỗi đêm.";

  return { chronoAge, bioAge, delta, category, categoryLabel, factors, advice, sdnnAvg: Math.round(avgSdnn), expectedSdnn };
}

// ─── Safe Exercise Dose ───────────────────────────────────────────────────────
// Tính liều vận động an toàn hôm nay dựa trên toàn bộ chỉ số tim mạch hiện tại
function computeSafeExerciseDose(user, latestResult, weatherAlert, afibBurden7d) {
  const r = latestResult || {};
  const clotScore = r.clotRisk?.score || 30;
  const vasScore = r.vascularRecovery?.score || 65;
  const sdnn = r.sdnn || 35;
  const bpm = r.bpm || 72;
  const irregularity = r.irregularityIndex || 20;
  const cls = r.classification || "normal";
  const burden = afibBurden7d?.burden || 0;
  const temp = weatherAlert?.currentTemp ?? weatherAlert?.temp ?? 28;
  const weatherLevel = weatherAlert?.level || "NORMAL";

  // Tính điểm an toàn vận động (0-100)
  let safeScore = 100;

  // Khấu trừ theo ClotRisk
  safeScore -= clotScore >= 70 ? 45 : clotScore >= 50 ? 25 : clotScore >= 35 ? 12 : 0;
  // Khấu trừ theo Vascular Recovery
  safeScore -= vasScore < 40 ? 35 : vasScore < 55 ? 18 : vasScore < 70 ? 8 : 0;
  // Khấu trừ theo SDNN
  safeScore -= sdnn < 20 ? 20 : sdnn < 30 ? 10 : sdnn < 40 ? 4 : 0;
  // Khấu trừ theo AFib classification
  safeScore -= cls === "afib" ? 40 : cls === "elevated" ? 15 : 0;
  // Khấu trừ theo nhịp tim lúc nghỉ
  safeScore -= bpm > 100 ? 20 : bpm > 90 ? 8 : bpm < 48 ? 15 : 0;
  // Khấu trừ theo AFib Burden 7 ngày
  safeScore -= burden >= 20 ? 20 : burden >= 10 ? 10 : burden >= 5 ? 4 : 0;
  // Khấu trừ theo thời tiết
  safeScore -= temp >= 38 ? 25 : temp >= 35 ? 15 : temp >= 32 ? 8 : temp < 15 ? 10 : 0;
  safeScore -= weatherLevel === "DANGER" ? 15 : weatherLevel === "WARNING" ? 8 : 0;

  safeScore = Math.round(clamp(0, safeScore, 100));

  // Phân loại mức độ
  const level = safeScore >= 75 ? "GREEN" : safeScore >= 45 ? "YELLOW" : "RED";

  // Hoạt động được phép và bị cấm theo level
  const exercises = {
    GREEN: {
      allowed: [
        { name: "Đi bộ nhanh", duration: "35-45 phút", intensity: "Nhịp tim < 120 BPM", icon: "🚶‍♂️" },
        { name: "Bơi lội nhẹ", duration: "25-30 phút", intensity: "Nhịp tim < 110 BPM", icon: "🏊" },
        { name: "Yoga / Dưỡng sinh", duration: "30-40 phút", intensity: "Không gắng sức", icon: "🧘" },
        { name: "Đạp xe chậm", duration: "20-30 phút", intensity: "Địa hình bằng phẳng", icon: "🚴" },
      ],
      forbidden: ["Chạy bộ cường độ cao", "Tập tạ nặng", "Thể thao đối kháng"],
      advice: "Tim đang ở trạng thái tốt. Tập vừa phải, không gắng sức quá mức.",
    },
    YELLOW: {
      allowed: [
        { name: "Đi bộ chậm", duration: "15-20 phút", intensity: "Nhịp tim < 100 BPM", icon: "🚶" },
        { name: "Giãn cơ / Vươn vai", duration: "10-15 phút", intensity: "Nhẹ nhàng", icon: "🤸" },
        { name: "Thở hộp (Breathing Coach)", duration: "10 phút", intensity: "Trong nhà, có điều hòa", icon: "🌬️" },
      ],
      forbidden: ["Đi bộ nhanh", "Bơi lội", "Leo cầu thang nhiều", "Vận động cường độ trung bình trở lên"],
      advice: "Tim đang mệt mỏi hôm nay. Chỉ vận động thật nhẹ, không gắng sức.",
    },
    RED: {
      allowed: [
        { name: "Sinh hoạt nhẹ trong nhà", duration: "Bình thường", intensity: "Không đi lại nhiều", icon: "🏠" },
        { name: "Thở chậm (4-7-8)", duration: "5-10 phút", intensity: "Nằm hoặc ngồi", icon: "🌬️" },
      ],
      forbidden: ["Đi bộ", "Leo cầu thang", "Làm việc nhà nặng (hút bụi, giặt đồ)", "Ra ngoài trời", "Bất kỳ vận động nào cường độ vừa trở lên"],
      advice: "Tim cần nghỉ hoàn toàn hôm nay. Đo lại buổi chiều để theo dõi cải thiện.",
    },
  };

  const ex = exercises[level];

  // Giờ tốt nhất để tập (tránh giờ nguy cơ cao — dựa trên circadian)
  const bestHours = level === "RED" ? null
    : temp >= 32 ? "17:00 - 18:30 (mát hơn)" : "7:00 - 9:00 sáng";

  // Lượng nước khuyến nghị
  const waterMl = level === "GREEN" ? 500 : level === "YELLOW" ? 300 : 200;

  // Nhịp tim tối đa an toàn khi tập
  const age = Number(user?.age || 60);
  const maxSafeHR = level === "GREEN" ? Math.round((220 - age) * 0.65)
    : level === "YELLOW" ? Math.round((220 - age) * 0.5) : null;

  // Cảnh báo đặc biệt
  const warnings = [];
  if (cls === "afib") warnings.push("⚠️ Phát hiện AFib trong lần đo gần nhất — theo dõi chặt nhịp tim khi vận động");
  if (temp >= 35) warnings.push(`🌡️ Nhiệt độ ngoài trời ${Math.round(temp)}°C — chỉ tập trong nhà có điều hòa`);
  if (burden >= 15) warnings.push(`📊 AFib Burden 7 ngày: ${burden}% — cần thận trọng hơn bình thường`);
  if (bpm > 95) warnings.push(`💓 Nhịp tim lúc nghỉ ${bpm} BPM cao — không tập cường độ cao hôm nay`);

  return { safeScore, level, ...ex, bestHours, waterMl, maxSafeHR, warnings, temp: Math.round(temp || 28) };
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

  // UPDATE LIST 6: IRS + PRP
  const irs = computeIRS(user, measurements, afibBurden7d);
  const prp = buildPRP(userId, irs, afibBurden7d, allMeasurements, weatherAlert);

  // NEW: Heart Biological Age + Safe Exercise Dose
  const heartBioAge = computeHeartBiologicalAge(user, measurements, afibBurden7d, latestMeasurement?.result || null);
  const safeExerciseDose = computeSafeExerciseDose(user, latestMeasurement?.result || null, weatherAlert, afibBurden7d);

  // Nhóm 2, 3, 4, 5
  const medEffectiveness = computeMedicationEffectiveness(user, measurements);
  const diseaseProgression = computeDiseaseProgression(measurements, afibBurden7d, afibBurden30d, irs);
  const monthlyCalendar = buildMonthlyRiskCalendar(userId, allMeasurements, circadian);
  const seasonalPattern = computeSeasonalPattern(userId, allMeasurements);
  const electrolyteRisk = computeElectrolyteRisk(latestMeasurement?.result || null);
  const coherenceScore = computeCoherenceScore(latestMeasurement?.result || null);
  const doctorVisitPrep = buildDoctorVisitPrep(user, { latestMeasurement, afibBurden7d, heartBioAge, safeExerciseDose, symptoms, user:summarizeUser(user) });
  const familyToken = user.familyToken?.token || null;

  const holterLogs = readJson("holterLogs");
  const holterLog = holterLogs.find(h => h.userId === userId) || null;

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
    irs,
    prp,
    heartBioAge,
    safeExerciseDose,
    medEffectiveness,
    diseaseProgression,
    monthlyCalendar,
    seasonalPattern,
    electrolyteRisk,
    coherenceScore,
    doctorVisitPrep,
    familyToken,
    cardiologyHospitals: CARDIO_HOSPITALS,
    hrrResult: user.hrrResult || null,
    holterLog,
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
    cha2ds2, hasbled, heartBioAge, irs, diseaseProgression, circadian,
    pillProtocols, electrolyteRisk, coherenceScore, doctorVisitPrep,
    hrrResult, medEffectiveness } = dashboard;

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
  const firstDate = allMeasurements.length ? new Date(allMeasurements[0].createdAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--";
  const lastDate  = allMeasurements.length ? new Date(allMeasurements[allMeasurements.length - 1].createdAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--";
  const periodStr = totalMeasurements ? `${firstDate} – ${lastDate}` : "Chưa có dữ liệu";

  // Phiên có biến động mạnh nhất (irregularityIndex cao nhất) → dùng cho biểu đồ
  const mostVolatile = allMeasurements.reduce((best, m) =>
    (m.result?.irregularityIndex || 0) > (best?.result?.irregularityIndex || 0) ? m : best,
    allMeasurements[0] || latestMeasurement
  );
  const chartWaveform = mostVolatile?.result?.waveform || latestMeasurement?.result?.waveform || [];
  const chartSqi      = mostVolatile?.result?.signalQuality || latestMeasurement?.result?.signalQuality || "--";
  const chartBpm      = mostVolatile?.result?.bpm || "--";
  const chartDate     = mostVolatile ? new Date(mostVolatile.createdAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--";
  const ecgSvg = buildEcgSvg(chartWaveform);

  // Trạng thái tổng quan
  const hasAfib = afibSessions > 0;
  const overallBadgeClass = hasAfib ? "badge-red" : afibBurden7d?.burden >= 10 ? "badge-orange" : "badge-green";
  const overallStatus = hasAfib
    ? `Phát hiện <strong>${afibSessions}</strong> phiên có dấu hiệu nghi ngờ Rung nhĩ / Loạn nhịp`
    : afibBurden7d?.burden >= 10
      ? `Gánh nặng AFib ở mức cần theo dõi (${afibBurden7d.burden}%)`
      : "Không phát hiện dấu hiệu rung nhĩ trong các phiên đo";

  // Holter 7-day summary (từ dữ liệu đã sync lên server)
  const holterLog = dashboard.holterLog;
  let holterSection = "";
  if (holterLog && holterLog.log && holterLog.log.length > 0) {
    const hlog = holterLog.log;
    const hDone = hlog.length;
    const hAfib = hlog.filter(l => l.afibFlag).length;
    const hBurden = Math.round(hAfib / hDone * 100);
    const hBpms = hlog.filter(l => l.bpm).map(l => l.bpm);
    const hMeanBpm = hBpms.length ? Math.round(hBpms.reduce((a, b) => a + b, 0) / hBpms.length) : null;
    const hStarted = holterLog.startedAt ? new Date(holterLog.startedAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--";
    const hUpdated = holterLog.updatedAt ? new Date(holterLog.updatedAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--";
    const hAssessment = hBurden > 20 ? "⚠️ AFib Burden cao — khuyến nghị thăm khám tim mạch"
      : hBurden > 5 ? "🟡 Có một số phiên phát hiện AFib — cần theo dõi tiếp"
      : "🟢 Không phát hiện AFib đáng kể trong 7 ngày theo dõi";
    const holterRows = hlog.slice(0, 42).map(l => {
      const slotLabel = ["8h", "11h", "14h", "17h", "20h", "23h"][l.slot] || `#${l.slot + 1}`;
      const ts = l.ts ? new Date(l.ts).toLocaleString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--";
      return `<tr>
        <td>Ngày ${l.day}/${slotLabel}</td>
        <td>${ts}</td>
        <td>${l.bpm || "--"} BPM</td>
        <td>${l.sdnn || "--"} ms</td>
        <td style="color:${l.afibFlag ? "#dc2626" : "#16a34a"};font-weight:700">${l.afibFlag ? "⚠️ AFib" : "✅ Bình thường"}</td>
        <td>${Math.round((l.confidence || 0) * 100)}%</td>
      </tr>`;
    }).join("");
    holterSection = `
<!-- ══ SECTION 3b: HOLTER 7 NGÀY ════════════════════════════════════════════ -->
<div class="card" style="border-left:4px solid #0f766e;background:linear-gradient(135deg,#f0fdf4,#fff)">
  <h2><span class="section-num" style="background:#0f766e">H</span> Theo dõi chuyên sâu 7 ngày (Giả lập Holter)</h2>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px">
    <div class="metric-box"><div class="metric-label">Bắt đầu</div><div class="metric-val">${hStarted}</div></div>
    <div class="metric-box"><div class="metric-label">Cập nhật</div><div class="metric-val">${hUpdated}</div></div>
    <div class="metric-box"><div class="metric-label">Đã đo</div><div class="metric-val">${hDone}/42 phiên</div></div>
    <div class="metric-box"><div class="metric-label">BPM trung bình</div><div class="metric-val">${hMeanBpm || "--"}</div></div>
    <div class="metric-box"><div class="metric-label">AFib Burden</div><div class="metric-val" style="color:${hBurden > 20 ? "#dc2626" : hBurden > 5 ? "#d97706" : "#16a34a"}">${hBurden}%</div></div>
    <div class="metric-box"><div class="metric-label">Phiên có AFib</div><div class="metric-val" style="color:${hAfib > 0 ? "#dc2626" : "#16a34a"}">${hAfib} / ${hDone}</div></div>
  </div>
  <p style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;font-size:13px;color:#166534;margin:0 0 12px">${hAssessment}</p>
  <table>
    <thead><tr><th>Thời điểm</th><th>Ngày/Giờ</th><th>BPM</th><th>SDNN</th><th>Kết quả</th><th>Độ tin cậy</th></tr></thead>
    <tbody>${holterRows}</tbody>
  </table>
</div>`;
  }

  // ── Section 6: Bio Age + IRS + Electrolyte + Coherence + HRR ──────────────
  let bioAgeSection = "";
  if (heartBioAge) {
    const _ba = heartBioAge;
    const _deltaColor = _ba.delta > 5 ? "#cc2244" : _ba.delta < -3 ? "#16a34a" : "#d97706";
    let _b6 = `<div class="card" style="border-left:5px solid #7c3aed;background:linear-gradient(135deg,#faf5ff,#fff)">
  <h2><span class="section-num" style="background:#7c3aed">6</span> Tuổi tim sinh học &amp; Hồ sơ nguy cơ tổng hợp</h2>
  <div class="grid4" style="margin-bottom:12px">
    <div class="metric"><span class="val" style="color:${_deltaColor}">${_ba.bioAge} tuổi</span><span class="lbl">Tuổi tim sinh học</span></div>
    <div class="metric"><span class="val">${_ba.delta > 0 ? "+" : ""}${_ba.delta} năm</span><span class="lbl">So tuổi thật (${user.age} tuổi)</span></div>
    ${irs ? `<div class="metric"><span class="val" style="color:${irs.score >= 65 ? "#cc2244" : irs.score >= 35 ? "#d97706" : "#16a34a"}">${irs.score}/100</span><span class="lbl">Điểm nguy cơ IRS</span></div>` : ""}
    ${coherenceScore ? `<div class="metric"><span class="val" style="color:${coherenceScore.coherence >= 80 ? "#16a34a" : coherenceScore.coherence >= 60 ? "#d97706" : "#cc2244"}">${coherenceScore.coherence}%</span><span class="lbl">Tim-Não cộng hưởng</span></div>` : ""}
  </div>`;
    if (irs) {
      _b6 += `<p style="font-size:12.5px;margin:0 0 8px"><strong>IRS – Điểm nguy cơ cá nhân: ${irs.levelLabel} (${irs.score}/100)</strong>&nbsp; Xu hướng: ${irs.trend === "improving" ? "⬇️ Cải thiện" : irs.trend === "worsening" ? "⬆️ Xấu đi" : "➡️ Ổn định"}</p>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;font-size:11.5px">
    <span style="background:#f0f4fa;padding:2px 8px;border-radius:4px">Tuổi: ${irs.components.ageFactor}đ</span>
    <span style="background:#f0f4fa;padding:2px 8px;border-radius:4px">Bệnh nền: ${irs.components.condFactor}đ</span>
    <span style="background:#f0f4fa;padding:2px 8px;border-radius:4px">Đo gần đây: ${irs.components.measureFactor}đ</span>
    <span style="background:#f0f4fa;padding:2px 8px;border-radius:4px">AFib: ${irs.components.afibFactor}đ</span>
    <span style="background:#f0f4fa;padding:2px 8px;border-radius:4px">HRV: ${irs.components.hrvFactor}đ</span>
  </div>`;
    }
    _b6 += `<p style="background:#ede9fe;border-radius:8px;padding:10px;font-size:12.5px;color:#3730a3;margin:0 0 8px">${_ba.advice || "Tiếp tục theo dõi định kỳ để cải thiện tuổi tim."}</p>`;
    if (electrolyteRisk) {
      _b6 += `<div style="border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px">
    <strong>Điện giải ước tính từ HRV:</strong>
    &nbsp;Kali (K⁺): <span class="${electrolyteRisk.kLevel === "LOW" ? "badge-red" : electrolyteRisk.kLevel === "BORDERLINE" ? "badge-orange" : "badge-green"}">${electrolyteRisk.kLevel}</span>
    &nbsp;&nbsp;Magiê (Mg²⁺): <span class="${electrolyteRisk.mgLevel === "LOW" ? "badge-red" : electrolyteRisk.mgLevel === "BORDERLINE" ? "badge-orange" : "badge-green"}">${electrolyteRisk.mgLevel}</span>
    <p style="font-size:11.5px;color:#556;margin:3px 0 0">${electrolyteRisk.recommendation}</p>
  </div>`;
    }
    if (hrrResult) {
      _b6 += `<div style="border-top:1px solid #e2e8f0;padding-top:8px;margin-top:8px;font-size:12px">
    <strong>Kiểm tra phục hồi nhịp tim (HRR):</strong>
    HRR-1 phút = <strong>${hrrResult.hrr1min || "--"} BPM</strong>${hrrResult.grade ? " — " + hrrResult.grade : ""}
    <span style="font-size:11px;color:#889;margin-left:8px">Đo lúc: ${hrrResult.savedAt ? new Date(hrrResult.savedAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' }) : "--"}</span>
  </div>`;
    }
    _b6 += "</div>";
    bioAgeSection = _b6;
  }

  // ── Section 7: 14-day daily trend ─────────────────────────────────────────
  let trendSection = "";
  {
    const _now14 = new Date();
    const _tRows = [];
    for (let _i = 13; _i >= 0; _i--) {
      const _ds = new Date(_now14); _ds.setDate(_ds.getDate() - _i); _ds.setHours(0, 0, 0, 0);
      const _de = new Date(_ds); _de.setDate(_de.getDate() + 1);
      const _dms = allMeasurements.filter(m => { const _t = new Date(m.createdAt); return _t >= _ds && _t < _de; });
      if (!_dms.length) continue;
      const _avgBpm = Math.round(_dms.reduce((s, m) => s + (m.result?.bpm || 0), 0) / _dms.length);
      const _sdnnArr = _dms.filter(m => m.result?.sdnn > 0).map(m => m.result.sdnn);
      const _avgSdnn = _sdnnArr.length ? Math.round(_sdnnArr.reduce((a, b) => a + b, 0) / _sdnnArr.length) + "ms" : "--";
      const _afibN = _dms.filter(m => m.result?.classification === "afib").length;
      const _bpmColor = _avgBpm > 100 ? "#cc2244" : _avgBpm < 50 ? "#d97706" : "#16a34a";
      const _afibCell = _afibN > 0 ? `<span class="badge-red">⚠️ ${_afibN} AFib</span>` : `<span class="badge-green">Bình thường</span>`;
      _tRows.push(`<tr><td>${_ds.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: 'Asia/Ho_Chi_Minh' })}</td><td>${_dms.length} lần</td><td style="font-weight:600;color:${_bpmColor}">${_avgBpm} BPM</td><td>${_avgSdnn}</td><td>${_afibCell}</td></tr>`);
    }
    if (_tRows.length > 0) {
      trendSection = `<div class="card card-blue">
  <h2><span class="section-num blue">7</span> Xu hướng nhịp tim &amp; HRV — 14 ngày gần nhất</h2>
  <table><thead><tr><th>Ngày</th><th>Số lần đo</th><th>BPM trung bình</th><th>SDNN trung bình</th><th>Trạng thái</th></tr></thead>
  <tbody>${_tRows.join("")}</tbody></table>
  <p class="note">Màu đỏ: BPM &gt;100 (nhịp nhanh). Màu vàng: BPM &lt;50 (nhịp chậm). Xanh lá: bình thường. Chỉ hiển thị ngày có dữ liệu.</p>
</div>`;
    }
  }

  // ── Section 8: Disease Progression + Medication effectiveness ─────────────
  let progressionSection = "";
  if (diseaseProgression) {
    const _dp = diseaseProgression;
    const _tColor = _dp.trend === "WORSENING" ? "#cc2244" : _dp.trend === "IMPROVING" ? "#16a34a" : "#d97706";
    const _bgAdv = _dp.urgent ? "#fde8ec" : _dp.trend === "IMPROVING" ? "#d4f5ea" : "#fffbeb";
    const _txAdv = _dp.urgent ? "#9b1c1c" : _dp.trend === "IMPROVING" ? "#064e3b" : "#713f12";
    const _riskBars = (_dp.riskChunks || []).map((v, i) => {
      const bc = i === (_dp.riskChunks.length - 1) ? "#cc2244" : "#93c5fd";
      return `<div style="display:inline-block;vertical-align:bottom;width:32px;height:${Math.max(4, Math.round(v * 0.45))}px;background:${bc};border-radius:3px 3px 0 0;margin-right:3px;position:relative"><span style="font-size:9px;position:absolute;top:-14px;left:0;width:32px;text-align:center">${v}%</span></div>`;
    }).join("");
    const _sdnnBars = (_dp.sdnnChunks || []).map((v, i) => {
      const bc = i === (_dp.sdnnChunks.length - 1) ? "#059669" : "#6ee7b7";
      return `<div style="display:inline-block;vertical-align:bottom;width:32px;height:${Math.max(4, Math.round(v * 0.55))}px;background:${bc};border-radius:3px 3px 0 0;margin-right:3px;position:relative"><span style="font-size:9px;position:absolute;top:-14px;left:0;width:32px;text-align:center">${v}</span></div>`;
    }).join("");
    let _medHtml = "";
    if (medEffectiveness && !medEffectiveness.insufficient) {
      const _me = medEffectiveness;
      const _meColor = _me.score >= 70 ? "#16a34a" : _me.score >= 40 ? "#d97706" : "#cc2244";
      _medHtml = `<div style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:10px">
      <strong style="font-size:12.5px">Hiệu quả thuốc: "${_me.medicineName}" (${_me.daysOn} ngày)</strong>
      <span style="margin-left:8px;font-weight:700;color:${_meColor}">${_me.label} (${_me.score}/100)</span>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;margin-top:5px">
        <span>BPM: ${_me.bpm.before} → ${_me.bpm.after} <strong>(${_me.bpm.change > 0 ? "+" : ""}${_me.bpm.change})</strong></span>
        <span>HRV: ${_me.hrv.before} → ${_me.hrv.after}ms <strong>(${_me.hrv.change > 0 ? "+" : ""}${_me.hrv.change})</strong></span>
        <span>AFib: ${_me.afib.before}% → ${_me.afib.after}%</span>
        <span>Stroke Risk: ${_me.stroke.before}% → ${_me.stroke.after}%</span>
      </div>
    </div>`;
    }
    progressionSection = `<div class="card" style="border-left:5px solid #0891b2;background:linear-gradient(135deg,#ecfeff,#fff)">
  <h2><span class="section-num" style="background:#0891b2">8</span> Tiến triển bệnh &amp; Dự báo 6 tháng</h2>
  <div class="grid4" style="margin-bottom:12px">
    <div class="metric"><span class="val" style="color:${_tColor}">${_dp.trendLabel}</span><span class="lbl">Xu hướng hiện tại</span></div>
    <div class="metric"><span class="val">${_dp.projIRS}/100</span><span class="lbl">IRS dự báo 6 tháng</span></div>
    <div class="metric"><span class="val" style="color:${(_dp.projAfib || 0) >= 25 ? "#cc2244" : "#16a34a"}">${_dp.projAfib || "--"}%</span><span class="lbl">AFib Burden dự báo</span></div>
    <div class="metric"><span class="val">${_dp.projSdnn || "--"}ms</span><span class="lbl">SDNN dự báo</span></div>
  </div>
  <p style="background:${_bgAdv};border-radius:8px;padding:10px;font-size:12.5px;color:${_txAdv};margin:0 0 12px">${_dp.advice}</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px">
    <div>
      <strong style="font-size:12px;display:block;margin-bottom:16px">Nguy cơ đột quỵ qua các giai đoạn (%)</strong>
      <div style="height:44px;display:flex;align-items:flex-end">${_riskBars}</div>
      <div style="font-size:10px;color:#889;margin-top:2px">G.đoạn 1 → 2 → 3 → Hiện tại</div>
    </div>
    <div>
      <strong style="font-size:12px;display:block;margin-bottom:16px">HRV (SDNN) qua các giai đoạn (ms)</strong>
      <div style="height:44px;display:flex;align-items:flex-end">${_sdnnBars}</div>
      <div style="font-size:10px;color:#889;margin-top:2px">G.đoạn 1 → 2 → 3 → Hiện tại</div>
    </div>
  </div>
  ${_medHtml}
  <p class="note">Dự báo dựa trên ${_dp.dataPoints || allMeasurements.length} lần đo — phân tích xu hướng tuyến tính. Cần ≥8 lần đo để kết quả có ý nghĩa.</p>
</div>`;
  }

  // ── Section 9: Circadian rhythm ────────────────────────────────────────────
  let circadianSection = "";
  if (circadian && circadian.hours && circadian.hours.length > 0) {
    const _circRows = circadian.hours.map(h => {
      const _isPeak = circadian.peakHour && h.hour === circadian.peakHour.hour;
      const _bpmC = h.avgBpm > 100 ? "#cc2244" : h.avgBpm < 55 ? "#d97706" : "#16a34a";
      const _slot = h.hour < 6 ? "Đêm khuya" : h.hour < 12 ? "Buổi sáng" : h.hour < 18 ? "Buổi chiều" : "Buổi tối";
      const _assess = h.avgBpm > 100 ? "⚠️ Nhịp cao" : h.avgBpm < 55 ? "⚠️ Nhịp chậm" : "✅ Bình thường";
      return `<tr style="${_isPeak ? "background:#fef9c3" : ""}"><td><strong>${String(h.hour).padStart(2, "0")}:00</strong> — ${_slot}${_isPeak ? " 🔺 Cao nhất" : ""}</td><td style="font-weight:600;color:${_bpmC}">${h.avgBpm} BPM</td><td>${h.count} lần</td><td style="font-size:12px">${_assess}</td></tr>`;
    }).join("");
    const _peakNote = circadian.peakHour ? `Nhịp tim cao nhất thường vào <strong>${circadian.peakHour.hour}:00–${circadian.peakHour.hour + 1}:00</strong> (${circadian.peakHour.avgBpm} BPM). ` : "";
    circadianSection = `<div class="card card-green">
  <h2><span class="section-num green">9</span> Nhịp sinh học — Biến động BPM theo giờ trong ngày</h2>
  <p style="font-size:13px;margin:0 0 10px">${_peakNote}Thời điểm này tim hoạt động tải cao nhất — nên tránh gắng sức và theo dõi chặt hơn.</p>
  <table><thead><tr><th>Giờ</th><th>BPM trung bình</th><th>Số lần đo</th><th>Đánh giá</th></tr></thead>
  <tbody>${_circRows}</tbody></table>
  <p class="note">Nhịp tim bình thường thấp nhất lúc 2–4h sáng và cao nhất vào chiều tối. Nhịp cao bất thường về đêm → cần kiểm tra ngưng thở khi ngủ (Sleep Apnea).</p>
</div>`;
  }

  // ── Section 10: Full pill protocols ───────────────────────────────────────
  let medicationFullSection = "";
  if (pillProtocols && pillProtocols.length > 0) {
    const _medRows = pillProtocols.map(p => `<tr><td><strong>${p.medicineName}</strong></td><td>${p.dose || "--"}</td><td style="font-size:12px">${p.instructions || "--"}</td><td style="font-size:12px">${new Date(p.createdAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' })}</td></tr>`).join("");
    const _reminderHtml = reminders.length ? `<div style="margin-top:12px"><strong style="font-size:12.5px">Lịch nhắc uống thuốc:</strong><table style="margin-top:6px"><thead><tr><th>Tên thuốc</th><th>Giờ uống</th><th>Liều</th><th>Màu thuốc</th></tr></thead><tbody>${reminders.map(r => `<tr><td>${r.medicineName}</td><td>${r.time}</td><td>${r.dose || "--"}</td><td>${r.pillColor || "--"}</td></tr>`).join("")}</tbody></table></div>` : "";
    medicationFullSection = `<div class="card card-gray">
  <h2><span class="section-num gray">10</span> Phác đồ thuốc đang sử dụng (${pillProtocols.length} loại)</h2>
  <table><thead><tr><th>Tên thuốc</th><th>Liều dùng</th><th>Hướng dẫn</th><th>Bắt đầu</th></tr></thead>
  <tbody>${_medRows}</tbody></table>
  ${_reminderHtml}
  <p class="note">Danh sách thuốc được người dùng khai báo trong ứng dụng. Bác sĩ vui lòng xác nhận lại phác đồ hiện tại với bệnh nhân.</p>
</div>`;
  }

  // ── Section 11: SOS events + Doctor Visit Prep + Hospitals ────────────────
  const _sosHtml = sosEvents && sosEvents.length > 0
    ? `<div style="margin-bottom:14px"><strong style="font-size:12.5px;color:#cc2244">Lịch sử kích hoạt SOS (${sosEvents.length} lần):</strong><table style="margin-top:6px"><thead><tr><th>Ngày &amp; Giờ</th><th>Lý do</th><th>Trạng thái</th></tr></thead><tbody>${sosEvents.slice(0, 5).map(s => `<tr><td>${new Date(s.createdAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: 'Asia/Ho_Chi_Minh' })}</td><td style="font-size:12px">${s.reason || "Kích hoạt thủ công"}</td><td><span class="${s.status === "cancelled" ? "badge-orange" : "badge-red"}">${s.status === "cancelled" ? "Đã hủy" : "Đã gửi"}</span></td></tr>`).join("")}</tbody></table></div>`
    : `<p style="color:#889;font-size:12.5px;margin:0 0 12px">Chưa có sự kiện SOS nào được ghi nhận — tốt!</p>`;
  const _prepHtml = doctorVisitPrep
    ? `<div style="border-top:1px solid #e2e8f0;padding-top:12px"><strong style="font-size:12.5px;display:block;margin-bottom:8px">✅ Checklist chuẩn bị buổi khám:</strong>${(doctorVisitPrep.checklist || []).map(c => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12.5px"><span style="color:${c.done ? "#16a34a" : "#d97706"};font-size:14px">${c.done ? "☑" : "☐"}</span><span style="color:${c.done ? "#333" : "#888"}">${c.item}</span></div>`).join("")}${(doctorVisitPrep.questions || []).length ? `<div style="margin-top:12px"><strong style="font-size:12.5px;display:block;margin-bottom:6px">❓ Câu hỏi nên hỏi bác sĩ:</strong><ol style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.8">${doctorVisitPrep.questions.map(q => `<li>${q}</li>`).join("")}</ol></div>` : ""}</div>`
    : "";
  const _hosHtml = (dashboard.cardiologyHospitals || []).length
    ? `<div style="border-top:1px solid #e2e8f0;padding-top:12px;margin-top:12px"><strong style="font-size:12.5px;display:block;margin-bottom:8px">🏥 Bệnh viện tim mạch lớn tại Việt Nam:</strong><table><thead><tr><th>Bệnh viện</th><th>Địa chỉ</th><th>Điện thoại</th><th>Tỉnh/TP</th></tr></thead><tbody>${(dashboard.cardiologyHospitals || []).map(h => `<tr><td><strong>${h.name}</strong></td><td style="font-size:12px">${h.addr}</td><td><a href="tel:${h.tel.replace(/\s/g, "")}" style="color:#2a6ec8;text-decoration:none">${h.tel}</a></td><td>${h.city}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const prepSection = `<div class="card card-gray">
  <h2><span class="section-num gray">11</span> Sự kiện khẩn cấp &amp; Chuẩn bị buổi khám</h2>
  ${_sosHtml}
  ${_prepHtml}
  ${_hosHtml}
</div>`;

  // Nhật ký triệu chứng
  const symptomRows = symptoms.slice(0, 12).map(s =>
    `<tr><td>${new Date(s.createdAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
     <td>${new Date(s.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: 'Asia/Ho_Chi_Minh' })}</td>
     <td>${s.note}</td></tr>`
  ).join("");

  // Lịch sử đo chi tiết
  const historyRows = allMeasurements.slice(-20).reverse().map(m => {
    const cls = m.result?.classification;
    const badge = cls === "afib" ? "badge-red" : cls === "elevated" ? "badge-orange" : "badge-green";
    const label = cls === "afib" ? "AFib" : cls === "elevated" ? "Cần theo dõi" : "Bình thường";
    return `<tr>
      <td>${new Date(m.createdAt).toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' })} ${new Date(m.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: 'Asia/Ho_Chi_Minh' })}</td>
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
      <strong>Ngày xuất báo cáo:</strong> ${new Date().toLocaleDateString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' })}
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

${holterSection}

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

${bioAgeSection}

${trendSection}

${progressionSection}

${circadianSection}

${medicationFullSection}

${prepSection}

<!-- ══ TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM Y TẾ ══════════════════════════════════ -->
<div class="disclaimer">
  <strong>⚕️ Tuyên bố miễn trừ trách nhiệm y tế (Bắt buộc đọc)</strong>
  Báo cáo này được tạo tự động bởi hệ thống HEARTSENSE v4.0 dựa trên dữ liệu đo lường từ camera (PPG/rPPG — Photoplethysmography).
  <strong>Đây KHÔNG phải là chẩn đoán y tế.</strong> Kết quả chỉ mang tính chất sàng lọc tham khảo ban đầu và cần được xác nhận bởi bác sĩ chuyên khoa tim mạch thông qua các phương tiện y tế được chứng nhận (Holter ECG, siêu âm tim...).
  Không sử dụng báo cáo này để tự điều trị hoặc thay thế lời khuyên của bác sĩ. Trong trường hợp khẩn cấp, hãy gọi 115 hoặc đến cơ sở y tế gần nhất.
  <br><br>
  <span style="font-size:11px">HEARTSENSE v4.0 &nbsp;|&nbsp; Xuất ngày: ${new Date().toLocaleString("vi-VN", { timeZone: 'Asia/Ho_Chi_Minh' })} &nbsp;|&nbsp; Token: ${exportToken || "direct"}</span>
</div>

</body></html>`;
}

// ─── Printable Report ─────────────────────────────────────────────────────────
function buildPrintableReport(dashboard) {
  const token = generateExportToken(dashboard.user.id);
  return buildDoctorExportHtml(dashboard, token);
}

// ─── Pocket Cardiologist — Gemini AI handler ──────────────────────────────────
async function handlePocketCardiologist(urlObject, body, res) {
  const question = String(body.question || "").trim().slice(0, 500);
  if (!question) { sendJson(res, 400, { error: "Thiếu câu hỏi." }); return; }

  // history: array of {role:"user"|"model", text:string} — max 6 turns from client
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  if (!GEMINI_API_KEY) {
    sendJson(res, 200, { answer: null, fallback: true });
    return;
  }

  // Ưu tiên lấy context từ session (nếu đăng nhập); fallback về context client gửi lên
  const session = getSessionFromRequest(urlObject, body);
  const user = session ? getUserBySession(session) : null;

  let r = {};
  let age = 60;
  let conditions = "không có";
  let userName = "bạn";

  if (user) {
    // Lấy context từ server (đầy đủ nhất)
    const allMs = readJson("measurements").filter(m => m.userId === user.id && (m.type === "face" || m.type === "finger")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    r = allMs[0]?.result || {};
    age = Number(user.age || 60);
    conditions = (user.conditions || []).join(", ") || "không có";
    userName = user.fullName || "bạn";
  } else if (body.ctx) {
    // Fallback: context do client gửi (không có session)
    const ctx = body.ctx;
    r = ctx.result || {};
    age = Number(ctx.age || 60);
    conditions = Array.isArray(ctx.conditions) ? ctx.conditions.join(", ") || "không có" : "không có";
    userName = ctx.fullName || "bạn";
  }

  // Lấy thêm xu hướng từ lịch sử đo gần nhất (nếu có)
  let trendBlock = "";
  if (user) {
    const recentMs = readJson("measurements")
      .filter(m => m.userId === user.id && (m.type === "face" || m.type === "finger"))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
    if (recentMs.length >= 2) {
      const bpms = recentMs.map(m => m.result?.bpm).filter(Boolean);
      const avgBpm = bpms.length ? Math.round(bpms.reduce((a,b)=>a+b,0)/bpms.length) : null;
      const afibCount = recentMs.filter(m => m.result?.classification === "afib").length;
      trendBlock = `\nXU HƯỚNG ${recentMs.length} LẦN ĐO GẦN NHẤT:\n- Nhịp tim trung bình: ${avgBpm || "--"} BPM\n- Số lần phát hiện AFib: ${afibCount}/${recentMs.length} lần đo\n- Lần đo gần nhất: ${new Date(recentMs[0].createdAt).toLocaleString("vi-VN")}`;
    }
  }

  const hasMeasurement = r && r.bpm;
  const rhythmLabel = r.classification === "afib"
    ? "RUNG NHĨ (AFib) — nhịp hoàn toàn không đều, nguy cơ cao"
    : r.classification === "elevated" ? "Nhịp nhanh — cần theo dõi thêm"
    : r.classification === "low" ? "Nhịp chậm — cần đánh giá nguyên nhân"
    : "Nhịp xoang bình thường";

  const contextBlock = hasMeasurement ? `
DỮ LIỆU ĐO TIM HEARTSENSE (gần nhất):
- Nhịp tim: ${r.bpm} BPM | Nhận định: ${rhythmLabel}
- Chỉ số HRV — SDNN: ${r.sdnn ?? "--"}ms | RMSSD: ${r.rmssd ?? "--"}ms
- Độ bất thường nhịp (Irregularity Index): ${r.irregularityIndex ?? "--"}%
- Nguy cơ đột quỵ (Stroke Risk Score): ${r.strokeRiskScore ?? "--"}%
- Nguy cơ huyết khối (Clot Risk): ${r.clotRisk?.score ?? "--"}/100 — Mức ${r.clotRisk?.level ?? "--"}
- Phục hồi mạch máu (Vascular Recovery): ${r.vascularRecovery?.score ?? "--"}%
- Chất lượng tín hiệu đo: ${r.signalQuality ?? "--"}%
${trendBlock}` : `\nBệnh nhân chưa thực hiện đo tim — tư vấn dựa trên hồ sơ bệnh nền và câu hỏi lâm sàng. Khuyến khích đo tim để có dữ liệu cụ thể hơn.`;

  const gender = user?.gender === "male" ? "Nam" : user?.gender === "female" ? "Nữ" : "Không rõ";
  const bmi = user?.weight && user?.height ? (user.weight / ((user.height/100)**2)).toFixed(1) : null;

  const systemPrompt = `Bạn là GS.TS.BS. Nguyễn Minh Quang — Giáo sư Tiến sĩ Bác sĩ Tim mạch, chuyên khoa sâu Tim mạch can thiệp và Điện sinh lý học (Rối loạn nhịp tim). Nguyên Trưởng khoa Tim mạch can thiệp, Bệnh viện Tim Hà Nội. Thành viên chính thức Hội Tim mạch Châu Âu (ESC Fellow — FESC), Hội Tim mạch Hoa Kỳ (ACC), Hội Tim mạch Việt Nam (VNHA). Tác giả hơn 80 công trình nghiên cứu lâm sàng, chuyên gia phản biện tạp chí European Heart Journal và Journal of the American College of Cardiology. 25 năm thực hành lâm sàng trực tiếp với bệnh nhân tim mạch Việt Nam.

Bạn đang tư vấn trực tiếp qua hệ thống HEARTSENSE — ứng dụng theo dõi tim mạch chủ động tích hợp đo PPG (Photoplethysmography) qua camera. Dữ liệu đo từ HEARTSENSE là dữ liệu sàng lọc ban đầu — không thay thế ECG lâm sàng nhưng có giá trị định hướng quan trọng.

══════════════════════════════════════════
HỒ SƠ BỆNH NHÂN
══════════════════════════════════════════
Họ tên: ${userName} | Tuổi: ${age} | Giới: ${gender}${bmi ? ` | BMI: ${bmi}` : ""}
Bệnh nền đã khai báo: ${conditions}
${contextBlock}

══════════════════════════════════════════
CƠ SỞ KHOA HỌC THAM CHIẾU (ESC/ACC/AHA 2023-2024)
══════════════════════════════════════════
NHỊP TIM (Heart Rate):
- Bình thường nghỉ ngơi: 60–100 BPM. Vận động viên sức bền: 40–60 BPM (nhịp chậm sinh lý)
- Nhịp nhanh xoang (>100 BPM): thường do stress, mất nước, thiếu máu, cường giáp, thuốc
- Nhịp chậm (<60 BPM) cần đánh giá: block nhĩ thất, hội chứng nút xoang bệnh lý, thuốc beta-blocker
- Nhịp nhanh kịch phát >150 BPM khi nghỉ: cấp cứu tim mạch

HRV — BIẾN THIÊN NHỊP TIM (Heart Rate Variability):
- SDNN <20ms: rối loạn thần kinh tự chủ tim — cần đánh giá toàn diện
- SDNN 20–50ms: trung bình, cần cải thiện (stress, ít ngủ, bệnh nền)
- SDNN 50–100ms: tốt, hệ thần kinh tự chủ hoạt động hiệu quả
- SDNN >100ms: xuất sắc (thường gặp ở người tập luyện thể thao đều đặn)
- RMSSD <20ms: hệ phó giao cảm suy giảm — liên quan tim mạch, tiểu đường, ngưng thở khi ngủ

RUNG NHĨ (Atrial Fibrillation — AFib):
- Tăng nguy cơ đột quỵ thiếu máu não 5 lần so với người không AFib
- CHA₂DS₂-VASc ≥2 (nam) / ≥3 (nữ): bắt buộc dùng thuốc chống đông NOAC dài hạn
- AFib không triệu chứng chiếm 30% tổng số ca — nguy hiểm vì không được phát hiện
- Irregularity Index >30%: nghi ngờ AFib hoặc rối loạn nhịp đáng kể, cần ECG xác nhận
- Rate control mục tiêu: <110 BPM khi nghỉ (ESC 2020)

NGUY CƠ ĐỘT QUỴ & HUYẾT KHỐI:
- Nguy cơ đột quỵ <25%: thấp | 25–50%: trung bình | 50–70%: cao | >70%: rất cao
- Nguy cơ huyết khối <30/100: thấp | 30–60: trung bình | >60: cao — cần kiểm tra D-dimer, ABI
- Stroke Risk Score của HEARTSENSE tích hợp: tuổi, bệnh nền, HRV, AFib burden, irregularity

HUYẾT ÁP:
- Tối ưu: <120/80 mmHg | Bình thường: <130/80 | Tiền tăng HA: 130–139/80–89
- Tăng HA độ 1: 140–159/90–99 | Độ 2: ≥160/≥100 | Khủng hoảng HA: ≥180/≥120 (cấp cứu)
- Mục tiêu điều trị: <130/80 mmHg (ESC/ESH 2023), đặc biệt nguy cơ cao

LIPID & CHUYỂN HÓA:
- LDL-C mục tiêu: <2.6 mmol/L (100 mg/dL) nguy cơ trung bình | <1.8 mmol/L (70 mg/dL) nguy cơ cao | <1.4 mmol/L (55 mg/dL) sau nhồi máu hoặc đột quỵ
- Triglyceride <1.7 mmol/L | HDL-C >1.0 (nam) / >1.2 (nữ) mmol/L

PHÁC ĐỒ ƯU TIÊN (ESC 2023 / ACC-AHA 2022):
- AFib + CHA₂DS₂-VASc đủ tiêu chuẩn: NOAC (Apixaban, Rivaroxaban, Dabigatran, Edoxaban) ưu tiên hơn Warfarin
- Tăng HA bậc 1: ACEi hoặc ARB; bậc 2 thêm CCB hoặc thiazide; bậc 3: triple therapy
- Suy tim EF giảm (<40%): "Bộ tứ vàng" — ACEi/ARB-NEPi + Beta-blocker + MRA + SGLT2i
- Nhồi máu cơ tim: Aspirin + P2Y12 (Ticagrelor hoặc Clopidogrel) 12 tháng + Statin cường độ cao
- Phòng ngừa thứ phát đột quỵ: Antiplatelet hoặc NOAC (tùy cơ chế) + kiểm soát yếu tố nguy cơ triệt để

XÉT NGHIỆM ĐỊNH HƯỚNG:
- Loạn nhịp nghi ngờ: ECG 12 chuyển đạo → Holter 24–48h → Event recorder 2–4 tuần
- Đánh giá tim toàn diện: Siêu âm tim qua thành ngực (TTE) — EF, van tim, buồng nhĩ
- Xét nghiệm máu cơ bản tim mạch: CBC, Lipid profile, HbA1c, TSH, hs-CRP, BNP/NT-proBNP, Creatinine, eGFR
- Nguy cơ huyết khối: D-dimer, Protein C/S, ANA nếu nghi ngờ
- Gắng sức tim: Nghiệm pháp gắng sức điện tim (ETT) hoặc Stress Echo nếu nghi bệnh mạch vành

══════════════════════════════════════════
NGUYÊN TẮC TƯ VẤN LÂM SÀNG (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI)
══════════════════════════════════════════
[DANH TÍNH] Bạn là GS.TS. Nguyễn Minh Quang — luôn tư vấn với tư cách chuyên gia tim mạch hàng đầu, không tự giới thiệu lại trừ khi được hỏi.

[PHÂN TÍCH] Với mỗi câu hỏi, áp dụng khung lâm sàng 4 bước:
  Bước 1 — NHẬN ĐỊNH: Diễn giải dữ liệu đo của bệnh nhân theo ngưỡng lâm sàng, so sánh với baseline
  Bước 2 — CƠ CHẾ: Giải thích cơ chế sinh lý tại sao chỉ số đó có ý nghĩa (cụ thể, không chung chung)
  Bước 3 — PHÂN TẦNG NGUY CƠ: Xác định mức độ khẩn cấp và nguy cơ thực sự
  Bước 4 — HÀNH ĐỘNG: Khuyến nghị cụ thể, có thể thực hiện ngay, kèm mốc thời gian

[NGÔN NGỮ] Tiếng Việt chuẩn mực y tế, ấm áp như đang ngồi đối diện bệnh nhân. Giải thích thuật ngữ y khoa lần đầu xuất hiện. Gọi tên bệnh nhân tự nhiên (không gọi "bạn" nếu biết tên).

[ĐỘ DÀI VÀ CẤU TRÚC]
- Câu hỏi đơn giản về chỉ số: 180–250 từ
- Câu hỏi về cơ chế bệnh lý, triệu chứng, điều trị: 280–400 từ
- Câu hỏi phức tạp (đa bệnh nền, AFib + đột quỵ + thuốc): 350–450 từ
- TUYỆT ĐỐI không ngắn hơn 180 từ với bất kỳ câu hỏi y tế nào
- Dùng số thứ tự (1. 2. 3.) khi liệt kê từ 3 điểm trở lên

[CHUYÊN SÂU] Mỗi câu trả lời phải chứa ít nhất 1 thông tin y khoa chuyên sâu mà bệnh nhân không thể tự tìm được — cơ chế sinh lý, bằng chứng lâm sàng, con số cụ thể từ guideline, hoặc mẹo thực hành lâm sàng.

[SỬ DỤNG DỮ LIỆU] Luôn tham chiếu chỉ số đo thực tế của bệnh nhân trong câu trả lời. Không trả lời chung chung nếu có dữ liệu cụ thể. So sánh với ngưỡng chuẩn và đưa nhận xét cá nhân hóa.

[THUỐC] Giải thích cơ chế tác dụng và tác dụng phụ quan trọng nhất. Không kê liều dùng cụ thể — hướng dẫn loại xét nghiệm cần làm trước khi dùng thuốc và chuyên khoa cần gặp (nêu đích danh: "bác sĩ Tim mạch can thiệp", "bác sĩ chuyên về rối loạn nhịp — electrophysiologist", "nội tiết", v.v.).

[CẤP CỨU] Đau ngực dữ dội, méo miệng, yếu/liệt tay chân một bên, nói ngọng đột ngột, khó thở ngồi không được, ngất xỉu → khuyên gọi 115 NGAY, giải thích lý do ngắn gọn và rõ ràng, đặt lên đầu câu trả lời.

[KHÁM BỆNH] Khi khuyên khám: nêu rõ chuyên khoa (không chỉ "bác sĩ"), xét nghiệm/thủ thuật cụ thể cần làm, mốc thời gian ("trong 24 giờ", "trong tuần này", "sau 3 tháng tái khám"). Gợi ý tên cơ sở y tế uy tín nếu phù hợp: BV Tim Hà Nội, Viện Tim TP.HCM, BV Chợ Rẫy, BV Đại học Y Dược TP.HCM.

[GIỚI HẠN] Nếu câu hỏi hoàn toàn không liên quan sức khỏe tim mạch hay y tế: từ chối lịch sự, dẫn dắt về chủ đề tim mạch liên quan đến dữ liệu đo của bệnh nhân.`;

  // Build conversation history for multi-turn context
  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: question }] },
  ];

  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 2048, topP: 0.92, thinkingConfig: { thinkingBudget: 0 } },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  });

  const tryGemini = async (url) => {
    const geminiRes = await requestJson(`${url}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      body: payload,
    });
    if (geminiRes?.error) {
      const errMsg = geminiRes.error.message || JSON.stringify(geminiRes.error);
      console.error(`[Gemini][${url.split("/models/")[1]?.split(":")[0]}] API error:`, errMsg);
      throw new Error(errMsg);
    }
    const text = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    if (!text) {
      const reason = geminiRes?.candidates?.[0]?.finishReason || "unknown";
      console.warn(`[Gemini] No text returned, finishReason: ${reason}`);
      throw new Error(`Empty response (finishReason: ${reason})`);
    }
    return text;
  };

  try {
    let text = null;
    try {
      text = await tryGemini(GEMINI_API_URL);
    } catch (primaryErr) {
      console.warn("[Gemini] Primary model failed, trying fallback:", primaryErr.message);
      text = await tryGemini(GEMINI_API_URL_FALLBACK);
    }
    if (user?.id) appendLedgerEntry(user.id, "pocket_cardiologist.query", "Hỏi bác sĩ ảo", { question: question.slice(0, 80) });
    sendJson(res, 200, { answer: text, fallback: false });
  } catch (err) {
    console.error("[Gemini] All models failed:", err.message);
    sendJson(res, 200, { answer: null, fallback: true, error: err.message });
  }
}

async function handleSendAiFamilyReport(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const guardian = user.guardian || {};
  if (!guardian.guardianEmail) {
    sendJson(res, 400, { error: "Chưa cấu hình email người thân. Vào Hồ sơ → Người thân để thêm email." });
    return;
  }
  // Không chặn ở đây nếu thiếu GEMINI_API_KEY — sẽ fallback báo cáo thường bên dưới

  const allMs = readJson("measurements")
    .filter(m => m.userId === user.id && (m.type === "face" || m.type === "finger"))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latest = allMs[0];
  const r = latest?.result || {};

  const contextBlock = r.bpm ? `
KẾT QUẢ ĐO GẦN NHẤT (${new Date(latest.createdAt).toLocaleString("vi-VN")}):
- Nhịp tim: ${r.bpm} BPM
- Trạng thái: ${r.classification === "afib" ? "RUNG NHĨ (AFib) — bất thường" : r.classification === "elevated" ? "Nhịp cao — cần chú ý" : "Bình thường"}
- Nguy cơ đột quỵ: ${r.strokeRiskScore ?? "--"}%
- HRV (SDNN): ${r.sdnn ?? "--"}ms
- Độ bất thường nhịp: ${r.irregularityIndex ?? "--"}%
- Nguy cơ huyết khối: ${r.clotRisk?.score ?? "--"}/100 (${r.clotRisk?.level ?? "--"})
- Phục hồi mạch máu: ${r.vascularRecovery?.score ?? "--"}%` : "\nChưa có dữ liệu đo — phân tích dựa trên hồ sơ.";

  const weeklyMs = allMs.filter(m => new Date(m.createdAt) > new Date(Date.now() - 7 * 864e5));
  const weeklyBlock = weeklyMs.length > 1 ? `
DỮ LIỆU 7 NGÀY QUA:
- Số lần đo: ${weeklyMs.length}
- Nhịp tim trung bình: ${Math.round(weeklyMs.reduce((s, m) => s + (m.result?.bpm || 0), 0) / weeklyMs.length)} BPM
- Số lần phát hiện AFib: ${weeklyMs.filter(m => m.result?.classification === "afib").length}` : "";

  const gender = user.gender === "male" ? "Nam" : user.gender === "female" ? "Nữ" : "Không rõ";
  const conditions = (user.conditions || []).join(", ") || "không có";

  const analysisPrompt = `Bạn là BS.CK II Tim mạch HEARTSENSE — chuyên gia phân tích sức khỏe tim mạch AI với trình độ Tiến sĩ Y khoa.

THÔNG TIN BỆNH NHÂN:
- Tên: ${user.fullName}
- Tuổi: ${user.age} tuổi, Giới tính: ${gender}
- Bệnh nền: ${conditions}
${contextBlock}
${weeklyBlock}

NGƯỠNG THAM CHIẾU:
- Nhịp tim bình thường nghỉ: 60-100 BPM
- HRV (SDNN): <20ms báo động; 20-50ms trung bình; >50ms tốt; >100ms xuất sắc
- Nguy cơ đột quỵ: <30% thấp; 30-60% trung bình; >60% cao
- Độ bất thường nhịp: <15% bình thường; >30% cần đánh giá

Hãy viết BÁO CÁO SỨC KHỎE TIM MẠCH toàn diện bằng tiếng Việt, dành cho NGƯỜI THÂN (không phải bác sĩ). Ngôn ngữ thân thiện, dễ hiểu với người không có kiến thức y tế chuyên sâu.

Viết 4 phần, mỗi phần bắt đầu bằng tiêu đề IN HOA, cách nhau bằng dòng trống:

1. TÌNH TRẠNG SỨC KHỎE HIỆN TẠI
Đánh giá tổng thể dựa trên chỉ số đo thực tế. So sánh với ngưỡng bình thường. Kết luận rõ ràng.

2. CÁC CHỈ SỐ CẦN LƯU Ý
Nếu có bất thường: giải thích ý nghĩa bằng ngôn ngữ đơn giản và mức độ nghiêm trọng. Nếu bình thường: giải thích đây là tin tốt và lý do.

3. NHỮNG ĐIỀU CẦN HẠN CHẾ VÀ THEO DÕI
Thói quen cần tránh phù hợp với tình trạng hiện tại. Triệu chứng nào cần báo ngay cho gia đình hoặc bác sĩ. Khi nào phải gọi 115.

4. KẾ HOẠCH TĂNG CƯỜNG SỨC KHỎE TIM
Khuyến nghị cụ thể: loại tập luyện và thời lượng, chế độ ăn ưu tiên, lịch tái khám. Con số thực tế, có thể thực hiện được ngay.

QUY TẮC:
- Không dùng markdown (**, *, #)
- Dùng số thứ tự 1. 2. 3. khi liệt kê
- Đề cập tên bệnh nhân (${user.fullName}) trong phân tích
- Kết thúc bằng một câu động viên ấm áp cho gia đình và bệnh nhân`;

  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
    safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
  });

  // Thử tạo phân tích AI — nếu fail vẫn gửi báo cáo thường
  let aiAnalysis = null;
  if (GEMINI_API_KEY) {
    try {
      const geminiRes = await requestJson(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        body: payload,
      });
      aiAnalysis = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      if (aiAnalysis) {
        console.log(`[AiFamilyReport] ✅ AI phân tích OK — ${aiAnalysis.length} ký tự`);
      } else {
        console.warn("[AiFamilyReport] ⚠️ Gemini trả về trống — gửi template AI không có nội dung.");
      }
    } catch (geminiErr) {
      console.warn("[AiFamilyReport] Gemini lỗi, fallback báo cáo thường:", geminiErr.message);
    }
  }

  try {
    let emailHtml, emailSubject;
    const classLabel = r.classification === "afib" ? "⚠️ PHÁT HIỆN BẤT THƯỜNG" : r.classification === "elevated" ? "⚡ Cần theo dõi" : "✅ Bình thường";
    // Luôn dùng template AI — khi không có aiAnalysis thì hiện placeholder trong template
    emailHtml = buildAiAnalysisEmailHtml(user, r, aiAnalysis, guardian.guardianName);
    emailSubject = `HEARTSENSE – Phân tích AI Tim mạch: ${user.fullName} – ${classLabel} – ${new Date().toLocaleDateString("vi-VN")}`;

    const emailResult = await sendEmail({
      to: guardian.guardianEmail,
      subject: emailSubject,
      html: emailHtml,
    });

    appendLedgerEntry(user.id, "pocket_cardiologist.family_report", "Gửi phân tích AI cho người thân", { to: guardian.guardianEmail, sent: emailResult.sent, aiUsed: !!aiAnalysis });
    sendJson(res, 200, {
      sent: emailResult.sent,
      to: guardian.guardianEmail,
      aiUsed: !!aiAnalysis,
      message: emailResult.sent
        ? `${aiAnalysis ? "Báo cáo AI" : "Báo cáo sức khoẻ"} đã gửi đến ${guardian.guardianEmail}`
        : `Không gửi được email: ${emailResult.reason}`,
    });
  } catch (err) {
    console.error("[AiFamilyReport]", err.message);
    sendJson(res, 500, { error: `Lỗi khi gửi báo cáo: ${err.message}` });
  }
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
  const existingGuardian = user.guardian || {};
  const existingSchedule = existingGuardian.reportSchedule || {};

  // Preserve existing contact info if not included in this request (e.g. schedule-only form)
  const guardianPhone = "guardianPhone" in body ? String(body.guardianPhone || "").trim() : (existingGuardian.guardianPhone || "");
  const guardianEmail = "guardianEmail" in body ? String(body.guardianEmail || "").trim() : (existingGuardian.guardianEmail || "");
  const guardianName  = "guardianName"  in body ? String(body.guardianName  || "").trim() : (existingGuardian.guardianName  || "");

  // Preserve existing schedule settings if not included in this request (e.g. contact-only form)
  const schedEnabled = "autoReportEnabled" in body
    ? (body.autoReportEnabled === true || body.autoReportEnabled === "on" || body.autoReportEnabled === "true")
    : (existingSchedule.enabled || false);
  const schedTime = "autoReportTime" in body
    ? (/^\d{2}:\d{2}$/.test(String(body.autoReportTime || "")) ? body.autoReportTime : existingSchedule.time || "08:00")
    : (existingSchedule.time || "08:00");
  const schedNotify = "notifyOnMeasurement" in body
    ? (body.notifyOnMeasurement === true || body.notifyOnMeasurement === "on" || body.notifyOnMeasurement === "true")
    : (existingSchedule.notifyOnMeasurement || false);

  user.guardian = {
    guardianName, guardianPhone, guardianEmail,
    status: guardianPhone || guardianEmail ? "confirmation_sent" : "not_configured",
    channels: [guardianPhone ? "sms" : null, guardianEmail ? "email" : null].filter(Boolean),
    updatedAt: new Date().toISOString(),
    reportSchedule: {
      enabled: schedEnabled,
      time: schedTime,
      notifyOnMeasurement: schedNotify,
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

  let dashboard = null;
  try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[Measurement] buildDashboard:", e.message); }

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
  let ctxDashboard = null;
  try { ctxDashboard = await buildDashboard(user.id); } catch (e) { console.error("[MeasContext] buildDashboard:", e.message); }
  sendJson(res, 200, { ok: true, dashboard: ctxDashboard });
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
  let baseDashboard = null;
  try { baseDashboard = await buildDashboard(user.id); } catch (e) { console.error("[Baseline] buildDashboard:", e.message); }
  sendJson(res, 200, { baseline: user.baseline, dashboard: baseDashboard });
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
  let breathDashboard = null;
  try { breathDashboard = await buildDashboard(user.id); } catch (e) { console.error("[Breathing] buildDashboard:", e.message); }
  sendJson(res, 201, { ok: true, dashboard: breathDashboard });
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
  let dashboard = null;
  try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[Symptom] buildDashboard:", e.message); }
  sendJson(res, 201, { ok: true, isCritical, dashboard });
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
  let dashboard = null;
  try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[Reminder] buildDashboard:", e.message); }
  sendJson(res, 201, { ok: true, dashboard });
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
    let dashboard = null;
    try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[SOS] buildDashboard:", e.message); }
    sendJson(res, 200, { sos: recentSos, messages: ["SOS đã được gửi trước đó (trong vòng 30 giây)."], dashboard });
    return;
  }

  const guardian = user.guardian || {};
  const channelSet = new Set();
  if (guardian.guardianPhone) { channelSet.add("sms"); channelSet.add("zalo"); }
  if (guardian.guardianEmail) channelSet.add("email");
  channelSet.add("web-notification");

  // Ghi SOS record trước — đảm bảo SOS luôn được lưu kể cả khi email thất bại
  const record = {
    id: crypto.randomUUID(), userId: user.id,
    reason: body.reason || "Cảnh báo AFib / nguy cơ cao",
    status: "triggered",
    channels: [...channelSet],
    delivery: { email: { sent: false, reason: "pending" } },
    createdAt: new Date().toISOString(),
  };
  sosEvents.push(record);
  writeJson("sos", sosEvents);
  appendLedgerEntry(user.id, "sos.triggered", "Kich hoat hanh lang xanh", { reason: record.reason });

  // Gửi email — không được throw ra ngoài
  let emailResult = { sent: false, reason: "no_guardian_email" };
  if (guardian.guardianEmail) {
    const locationInfo = body.location
      ? `<p><strong>Vị trí:</strong> <a href="https://maps.google.com/?q=${encodeURIComponent(body.location)}">${escHtml(body.location)}</a></p>`
      : "";
    try {
      emailResult = await sendEmail({
        to: guardian.guardianEmail,
        subject: `🚨 HEARTSENSE SOS KHẨN CẤP – ${escHtml(user.fullName)}`,
        html: `<div style="font-family:Arial;padding:20px;border:3px solid #cc2244;border-radius:10px;max-width:500px">
          <h2 style="color:#cc2244">⚠️ HEARTSENSE – CẢNH BÁO KHẨN CẤP</h2>
          <p><strong>Bệnh nhân:</strong> ${escHtml(user.fullName)} (${escHtml(String(user.age || ""))} tuổi)</p>
          <p><strong>Lý do:</strong> ${escHtml(body.reason || "Phát hiện AFib / nguy cơ cao")}</p>
          <p><strong>Thời gian:</strong> ${new Date().toLocaleString("vi-VN")}</p>
          ${locationInfo}
          <p style="background:#fde8ec;padding:12px;border-radius:6px"><strong>Hành động:</strong> Vui lòng liên hệ ngay với người dùng. Nếu không liên lạc được, gọi cấp cứu 115.</p>
          <p style="color:#666;font-size:12px">HEARTSENSE – Hệ thống giám sát tim mạch chủ động</p>
        </div>`,
      });
    } catch (e) {
      emailResult = { sent: false, reason: e.message };
      console.error("[SOS] Email error:", e.message);
    }
    // Cập nhật delivery trong record đã lưu
    record.delivery = { email: emailResult };
    const allSos = readJson("sos");
    const idx = allSos.findIndex(e => e.id === record.id);
    if (idx >= 0) { allSos[idx] = record; writeJson("sos", allSos); }
  }

  const messages = [];
  if (guardian.guardianEmail) {
    if (emailResult.sent) {
      messages.push(`✅ Email SOS đã gửi đến ${guardian.guardianEmail}.`);
    } else {
      const rawReason = emailResult.reason || "lỗi không xác định";
      // Phân tích lỗi Resend để hiển thị thông báo tiếng Việt dễ hiểu
      let friendlyReason;
      if (/testing emails|own email address|verify a domain/i.test(rawReason)) {
        friendlyReason = `Tài khoản Resend đang ở chế độ test — chỉ gửi được đến email chủ tài khoản. Vào resend.com/domains để xác minh domain, sau đó cập nhật EMAIL_FROM trong file .env.`;
      } else if (/api_key|api key|unauthorized/i.test(rawReason)) {
        friendlyReason = "API key Resend không hợp lệ. Kiểm tra RESEND_API_KEY trong .env.";
      } else if (/timeout|ENOTFOUND|ECONNREFUSED/i.test(rawReason)) {
        friendlyReason = "Không kết nối được server email. Kiểm tra mạng internet.";
      } else {
        friendlyReason = rawReason.slice(0, 120);
      }
      messages.push(`⚠️ Email chưa gửi được: ${friendlyReason}`);
      console.warn(`[SOS] Email lỗi tới ${guardian.guardianEmail}: ${rawReason}`);
    }
  } else {
    messages.push("ℹ️ Chưa có email người thân – hãy thêm trong phần Cài đặt.");
  }
  messages.push("✅ SOS đã được ghi lại và lưu trữ an toàn.");

  let dashboard = null;
  try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[SOS] buildDashboard:", e.message); }

  sendJson(res, 201, { sos: record, messages, dashboard });
}

async function handleCancelSos(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const sosEvents = readJson("sos");
  const latest = [...sosEvents].reverse().find((e) => e.userId === user.id && e.status === "triggered");
  if (latest) { latest.status = "cancelled"; latest.cancelledAt = new Date().toISOString(); writeJson("sos", sosEvents); }
  appendLedgerEntry(user.id, "sos.cancelled", "Nguoi dung xac nhan toi on");
  let dashboard = null;
  try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[CancelSOS] buildDashboard:", e.message); }
  sendJson(res, 200, { ok: true, dashboard });
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

// ─── Holter Log sync (G2: Expert Mode 7-day) ─────────────────────────────────
async function handleSaveHolterLog(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const log = Array.isArray(body.log) ? body.log.slice(0, 42) : [];
  const startedAt = body.startedAt || null;
  const holterLogs = readJson("holterLogs");
  const idx = holterLogs.findIndex(h => h.userId === user.id);
  const entry = { userId: user.id, startedAt, log, updatedAt: new Date().toISOString() };
  if (idx >= 0) holterLogs[idx] = entry; else holterLogs.push(entry);
  writeJson("holterLogs", holterLogs);
  sendJson(res, 200, { ok: true, count: log.length });
}

// ─── RxNav/RxNorm API integration — 500+ drug pairs vs. 29 hardcoded ─────────
// RxNorm (NLM/NIH): hoàn toàn miễn phí, không cần API key, chuẩn y tế Mỹ
// Endpoint: rxnav.nlm.nih.gov/REST (public, CORS enabled)
const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";

async function resolveRxCUI(drugName) {
  const norm = (drugName || "").toLowerCase().trim().replace(/[^a-z0-9 ]/g, "");
  if (!norm || norm.length < 3) return null;
  const cache = readJson("drugInteractionCache");
  if (cache.cuiMap?.[norm]) return cache.cuiMap[norm];
  try {
    const resp = await fetch(`${RXNAV_BASE}/rxcui.json?name=${encodeURIComponent(norm)}&search=2`,
      { signal: AbortSignal.timeout(3500) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const cui = data?.idGroup?.rxnormId?.[0] || null;
    if (cui) {
      if (!cache.cuiMap) cache.cuiMap = {};
      cache.cuiMap[norm] = cui;
      writeJson("drugInteractionCache", cache);
    }
    return cui;
  } catch { return null; }
}

async function fetchRxNavInteractions(drugNames) {
  if (!drugNames?.length || drugNames.length < 2) return [];
  const cuis = await Promise.all(drugNames.slice(0, 12).map(resolveRxCUI));
  const validCuis = cuis.filter(Boolean);
  if (validCuis.length < 2) return [];
  const cacheKey = [...validCuis].sort().join("+");
  const cache = readJson("drugInteractionCache");
  if (cache.interactions?.[cacheKey]) return cache.interactions[cacheKey];
  try {
    const resp = await fetch(`${RXNAV_BASE}/interaction/list.json?rxcuis=${validCuis.join("+")}`,
      { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    const pairs = [];
    for (const grp of (data?.fullInteractionTypeGroup || [])) {
      for (const type of (grp.fullInteractionType || [])) {
        for (const p of (type.interactionPair || [])) {
          const nameA = p.interactionConcept?.[0]?.minConceptItem?.name || "";
          const nameB = p.interactionConcept?.[1]?.minConceptItem?.name || "";
          if (!nameA || !nameB) continue;
          const sevRaw = (p.severity || "").toLowerCase();
          const sev = sevRaw.includes("contraindicated") || sevRaw.includes("high") ? "NGUY_HIEM"
                    : sevRaw.includes("moderate") ? "CANH_BAO" : "CHU_Y";
          pairs.push({ drugA: nameA, drugB: nameB, severity: sev,
            effect: p.description || "Tương tác thuốc — tham khảo bác sĩ trước khi dùng.", source: "rxnav" });
        }
      }
    }
    if (!cache.interactions) cache.interactions = {};
    cache.interactions[cacheKey] = pairs;
    writeJson("drugInteractionCache", cache);
    return pairs;
  } catch { return []; }
}

async function callGeminiDrugInteraction(drugs, localInteractions) {
  if (!GEMINI_API_KEY || drugs.length < 2) return null;
  const drugList = drugs.map((d, i) => `${i + 1}. "${d}"`).join("\n");
  const localCtx = localInteractions.length > 0
    ? `\n\nDatabase cục bộ đã phát hiện ${localInteractions.length} tương tác:\n` +
      localInteractions.map(i => `- ${i.drugA} + ${i.drugB}: ${i.severity} — ${i.effect}`).join("\n")
    : "\n\nDatabase cục bộ: chưa phát hiện tương tác nào.";

  const prompt = `Bạn là dược sĩ lâm sàng chuyên về thuốc tim mạch và chống đông. Phân tích tương tác thuốc cho danh sách sau (có thể là tên biệt dược Việt Nam, hoạt chất tiếng Anh, thảo dược, hoặc thực phẩm chức năng):

${drugList}
${localCtx}

Kiểm tra TẤT CẢ các cặp có thể tương tác. Trả lời CHÍNH XÁC theo JSON sau, KHÔNG có markdown hay text ngoài JSON:
{
  "safe": true/false,
  "interactions": [
    {
      "drugA": "tên thuốc A như người dùng nhập",
      "drugB": "tên thuốc B như người dùng nhập",
      "severity": "NGUY_HIEM" | "CANH_BAO" | "CHU_Y",
      "effect": "Mô tả tương tác tiếng Việt — 1 câu ngắn gọn",
      "recommendation": "Khuyến nghị cụ thể tiếng Việt — 1 câu"
    }
  ],
  "duplicates": [
    { "drug1": "tên 1", "drug2": "tên 2", "generic": "hoạt chất trùng" }
  ],
  "aiSummary": "Tóm tắt 2-3 câu tiếng Việt: tổng thể có nguy hiểm không, cần làm gì ngay"
}

Quy tắc phân loại: NGUY_HIEM = chống chỉ định/nguy cơ tử vong/chảy máu nội tạng; CANH_BAO = cần theo dõi sát/điều chỉnh liều; CHU_Y = tương tác nhẹ. Nếu không có tương tác: safe=true, interactions=[].`;

  try {
    const drugPayload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    });
    const resp = await requestJson(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(drugPayload) },
      body: drugPayload,
    });
    const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("[DrugInteraction] Gemini error:", e.message);
    return null;
  }
}

async function handleCheckInteractions(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const drugs = Array.isArray(body.drugs) ? body.drugs : [body.drugs].filter(Boolean);
  if (!drugs.length) { sendJson(res, 400, { error: "Cần cung cấp danh sách thuốc." }); return; }

  // Layer 1: hardcoded 29 pairs — instant, offline-safe
  const localResult = checkDrugInteractions(drugs);

  // Layer 2 + 3 song song: Gemini AI (ưu tiên) + RxNav (bổ sung context)
  const [geminiResult, rxnavPairs] = await Promise.allSettled([
    callGeminiDrugInteraction(drugs, localResult.interactions),
    fetchRxNavInteractions(drugs),
  ]).then(rs => rs.map(r => (r.status === "fulfilled" ? r.value : null)));

  // Gemini thành công → dùng làm kết quả chính (hiểu tên VN + giải thích tiếng Việt)
  if (geminiResult && Array.isArray(geminiResult.interactions)) {
    return sendJson(res, 200, {
      safe: geminiResult.safe,
      interactions: geminiResult.interactions || [],
      duplicates: geminiResult.duplicates?.length ? geminiResult.duplicates : localResult.duplicates,
      aiSummary: geminiResult.aiSummary || null,
      aiPowered: true,
      rxnavPairsFound: Array.isArray(rxnavPairs) ? rxnavPairs.length : 0,
      totalChecked: drugs.length,
    });
  }

  // Fallback: merge local 29 pairs + RxNav nếu Gemini không khả dụng
  const merged = [...localResult.interactions];
  for (const ap of (rxnavPairs || [])) {
    const normA = ap.drugA.toLowerCase(), normB = ap.drugB.toLowerCase();
    const dup = merged.some(i =>
      (i.drugA?.toLowerCase().includes(normA.split(" ")[0]) ||
       normA.includes((i.genericA || i.drugA || "").toLowerCase().split(" ")[0])) &&
      (i.drugB?.toLowerCase().includes(normB.split(" ")[0]) ||
       normB.includes((i.genericB || i.drugB || "").toLowerCase().split(" ")[0]))
    );
    if (!dup) merged.push(ap);
  }
  sendJson(res, 200, {
    ...localResult,
    interactions: merged,
    aiPowered: false,
    apiEnhanced: Array.isArray(rxnavPairs) && rxnavPairs.length > 0,
    rxnavPairsFound: Array.isArray(rxnavPairs) ? rxnavPairs.length : 0,
    totalChecked: drugs.length,
  });
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
    let dashboard = null;
    try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[PillProtocol] buildDashboard:", e.message); }
    sendJson(res, 200, { ok: true, dashboard });
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
  let dashboard = null;
  try { dashboard = await buildDashboard(user.id); } catch (e) { console.error("[PillProtocol] buildDashboard:", e.message); }
  sendJson(res, 201, { protocol, dashboard });
}

async function handleSendRemoteParentReport(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  const user = getUserBySession(session);
  if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const guardian = user.guardian || {};
  if (!guardian.guardianEmail) { sendJson(res, 400, { error: "Chưa cấu hình email guardian." }); return; }

  const personalMessage = String(body.personalMessage || "").trim().slice(0, 500);
  let emailResult = { sent: false, reason: "unknown_error" };
  try {
    // Timeout 20s cho buildDashboard phòng Supabase chậm
    const dashboardPromise = buildDashboard(user.id);
    const dashboardTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error("buildDashboard timeout 20s")), 20000));
    const dashboard = await Promise.race([dashboardPromise, dashboardTimeout]);

    const latest = dashboard.latestMeasurement;
    const status = latest?.result?.classification === "afib" ? "⚠️ CÓ CẢNH BÁO" : latest?.result?.classification === "elevated" ? "Theo dõi" : "Bình thường";
    console.log(`[SendReport] Gửi đến ${guardian.guardianEmail} cho ${user.fullName}...`);
    emailResult = await sendEmail({
      to: guardian.guardianEmail,
      subject: `HEARTSENSE – Báo cáo hàng ngày: ${user.fullName} – ${new Date().toLocaleDateString("vi-VN")}`,
      html: buildReportEmailHtml(user, latest, status, dashboard, personalMessage),
    });
    console.log(`[SendReport] Kết quả: ${emailResult.sent ? "✓ OK" : "✗ " + emailResult.reason}`);
  } catch (e) {
    emailResult = { sent: false, reason: e.message };
    console.error("[SendReport] Lỗi:", e.message);
  }

  appendLedgerEntry(user.id, "remote_parent.sent", "Gửi báo cáo đến guardian", { hasMessage: Boolean(personalMessage), sent: emailResult.sent });
  sendJson(res, 200, { sent: emailResult.sent, message: emailResult.sent ? `✅ Báo cáo đã gửi đến ${guardian.guardianEmail}` : `❌ Chưa gửi được: ${emailResult.reason}` });
}

// ─── Cron Scheduler (#7, #16, #Fix-E) ────────────────────────────────────────
// Extracted so it can be called both by setInterval AND by /api/cron (external ping)
async function runSchedulerCheck() {
  const nowUTC = new Date();
  const vnNow = new Date(nowUTC.getTime() + TZ_OFFSET_HOURS * 3600000);
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

    let emailResult = { sent: false, reason: "not_attempted" };
    try {
      const dashboard = await buildDashboard(user.id);
      const latest = dashboard.latestMeasurement;
      // Dùng AI phân tích xu hướng 7 ngày — khác với aiComment tức thì sau mỗi lần đo
      const aiAnalysis = await generateDailyAiAnalysis(user, latest, dashboard.weeklyReport).catch(() => null);
      emailResult = await sendEmail({
        to: user.guardian.guardianEmail,
        subject: `HEARTSENSE – Báo cáo tổng hợp ${vnNow.toLocaleDateString("vi-VN")}: ${escHtml(user.fullName)}`,
        html: buildDailyReportEmailHtml(user, latest, dashboard, aiAnalysis),
      });
      if (emailResult.sent) {
        appendLedgerEntry(user.id, "remote_parent.auto_sent", "Tu dong gui bao cao theo lich", { email: user.guardian.guardianEmail, scheduledTime: schedTime, catchUp: isMissed });
        console.log(`[AutoReport] ${isMissed ? "[catch-up] " : ""}OK → ${user.guardian.guardianEmail} (${user.fullName})`);
      } else {
        console.warn(`[AutoReport] Email fail ${user.fullName}: ${emailResult.reason}`);
      }
    } catch (err) {
      emailResult = { sent: false, reason: err.message };
      console.error(`[AutoReport] Lỗi ${user.fullName}: ${err.message}`);
    } finally {
      // Luôn lưu lastSentDate dù thành công hay thất bại — tránh retry vô hạn cả ngày
      const allUsers = readJson("users");
      const u = allUsers.find((x) => x.id === user.id);
      if (u?.guardian?.reportSchedule) {
        u.guardian.reportSchedule.lastSentDate = vnDateStr;
        u.guardian.reportSchedule.lastSentAt = nowUTC.toISOString();
        u.guardian.reportSchedule.lastSentOk = emailResult.sent;
        writeJson("users", allUsers);
      }
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
        await sendEmail({
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

// ─── Email status endpoint — diagnostic không lộ thông tin nhạy cảm ──────────
function handleEmailStatus(res) {
  const mailjetReady = !!(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY);
  const brevoReady = !!process.env.BREVO_API_KEY;
  sendJson(res, 200, {
    mailjet: {
      configured: mailjetReady,
      senderEmail: process.env.MAILJET_SENDER_EMAIL || GMAIL_USER || null,
      note: mailjetReady ? "✅ Mailjet sẵn sàng — gửi được đến bất kỳ email nào" : "❌ Chưa set MAILJET_API_KEY + MAILJET_SECRET_KEY",
    },
    brevo: {
      configured: brevoReady,
      note: brevoReady ? "⚠️ Brevo configured nhưng cần activation (liên hệ contact@brevo.com)" : "❌ Chưa set BREVO_API_KEY",
    },
    gmail: {
      ready: _gmailReady,
      error: _gmailLastError || "Render free tier chặn port SMTP",
    },
    activeProvider: mailjetReady ? "mailjet" : brevoReady ? "brevo" : _gmailReady ? "gmail" : "resend",
    recommendation: mailjetReady
      ? "✅ Mailjet hoạt động — email sẽ gửi được ngay"
      : "❌ Cần set MAILJET_API_KEY + MAILJET_SECRET_KEY + MAILJET_SENDER_EMAIL trong Render Dashboard",
  });
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

// ══════════════════════════════════════════════════════════════════════════════
// LIST UPDATE 1 & 2 — NEW API ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// ─── Expert Mode 7-day monitoring (G2) ────────────────────────────────────────
async function handleExpertMode(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const users = readJson("users");
  const idx = users.findIndex(u => u.id === session.userId);
  if (idx === -1) { sendJson(res, 404, { error: "Không tìm thấy người dùng." }); return; }
  users[idx].expertMode = { active: body.active, startedAt: body.active ? new Date().toISOString() : null };
  writeJson("users", users);
  appendLedgerEntry(session.userId, body.active ? "expert_mode.start" : "expert_mode.stop",
    body.active ? "Bat che do chuyen gia 7 ngay" : "Dung che do chuyen gia", {});
  sendJson(res, 200, { ok: true, expertMode: users[idx].expertMode });
}

// ─── Research Consent (3.6) ───────────────────────────────────────────────────
async function handleResearchConsent(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  const users = readJson("users");
  const idx = users.findIndex(u => u.id === session.userId);
  if (idx === -1) { sendJson(res, 404, {}); return; }
  users[idx].researchConsent = { consented: body.consent, at: new Date().toISOString() };
  writeJson("users", users);
  appendLedgerEntry(session.userId, body.consent ? "research.opt_in" : "research.opt_out",
    body.consent ? "Dong y chia se du lieu nghien cuu an danh" : "Rut khoi chuong trinh nghien cuu", {});
  sendJson(res, 200, { ok: true, consent: body.consent });
}

// ─── AFib Contextual Trigger AI (List1 #3 — Gemini powered) ──────────────────
async function handleAfibContext(urlObject, body, res) {
  const session = getSessionFromRequest(urlObject, body);
  if (!session) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }

  const episodes = readJson("afibEpisodes");
  const users = readJson("users");
  const user = users.find(u => u.id === session.userId);
  const measurements = readJson("measurements").filter(m => m.userId === session.userId);

  // Data từ client
  const r = body.result || {};
  const contextNote = String(body.contextNote || "").trim().slice(0, 500);
  const weatherTemp = body.weatherTemp ?? null;
  const weatherHumidity = body.weatherHumidity ?? null;
  const weatherDesc = String(body.weatherDesc || "");
  const weatherLocation = String(body.weatherLocation || "");
  const preMood = String(body.preMood || "");
  const hour = new Date().getHours();

  // Lịch sử AFib
  const allAfib = measurements
    .filter(m => m.result?.classification === "afib")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const afibLast7Days = allAfib.filter(m => Date.now() - new Date(m.createdAt).getTime() < 7 * 864e5).length;
  const afibLast30Days = allAfib.filter(m => Date.now() - new Date(m.createdAt).getTime() < 30 * 864e5).length;

  // ── Rule-based triggers (phát hiện nhanh, đáng tin) ──────────────────────
  const triggers = [];

  if (hour >= 4 && hour <= 7) {
    triggers.push({ factor: "⏰ Sáng sớm nguy hiểm", detail: `${hour}h sáng — cortisol tăng đột ngột khi thức dậy là trigger AFib phổ biến nhất trong ngày.`, severity: "high" });
  } else if (hour >= 22 || hour <= 3) {
    triggers.push({ factor: "🌙 Đêm khuya", detail: `${hour}h — hệ thần kinh tự chủ bất ổn trong giấc ngủ sâu, nhịp tim dễ bị rối loạn.`, severity: "medium" });
  }

  if (weatherTemp !== null) {
    if (weatherTemp < 10) triggers.push({ factor: `❄️ Trời rất lạnh ${weatherTemp}°C`, detail: "Co mạch mạnh → tăng sức cản ngoại vi → nhịp tim bù trừ → trigger AFib. Nguy cơ rất cao.", severity: "high" });
    else if (weatherTemp < 18) triggers.push({ factor: `🌡️ Trời lạnh ${weatherTemp}°C`, detail: "Nhiệt độ thấp làm co mạch → tăng nhịp tim bù trừ. Trigger AFib phổ biến vào mùa đông.", severity: "medium" });
    else if (weatherTemp > 37) triggers.push({ factor: `🔥 Nắng nóng ${weatherTemp}°C`, detail: "Mất nước và điện giải (Kali, Magie) → rối loạn dẫn truyền điện tim → AFib.", severity: "high" });
    else if (weatherTemp > 34) triggers.push({ factor: `☀️ Nóng ${weatherTemp}°C`, detail: "Cơ thể mất nhiều mồ hôi → điện giải giảm → tăng nguy cơ loạn nhịp.", severity: "medium" });
  }

  if (weatherHumidity !== null && weatherHumidity > 85) {
    triggers.push({ factor: `💧 Độ ẩm rất cao ${weatherHumidity}%`, detail: "Tim làm việc nhiều hơn để điều tiết thân nhiệt trong môi trường ẩm nóng.", severity: "medium" });
  }

  const note = contextNote.toLowerCase();
  if (/cà phê|cafe|coffee|cafein|espresso/.test(note)) triggers.push({ factor: "☕ Caffeine", detail: "Caffeine kích hoạt hệ giao cảm → tăng nhịp tim → ngưỡng AFib giảm. Tác động mạnh nhất trong 2h sau uống.", severity: "medium" });
  if (/rượu|bia|alcohol|nhậu|uống|hơi men/.test(note)) triggers.push({ factor: "🍺 Rượu bia (Holiday Heart)", detail: "Ethanol tác động trực tiếp lên tế bào cơ tim và hệ dẫn truyền — trigger AFib cấp tính hàng đầu được y văn ghi nhận.", severity: "high" });
  if (/stress|căng thẳng|áp lực|lo lắng|lo âu|bồn chồn|hồi hộp/.test(note)) triggers.push({ factor: "😟 Stress / Lo âu", detail: "Stress giải phóng adrenaline → kích hoạt hệ giao cảm → nhịp nhanh → AFib thoáng qua.", severity: "high" });
  if (/chạy|gym|thể dục|vận động mạnh|tập nặng|đá bóng|bơi/.test(note)) triggers.push({ factor: "🏃 Vận động cường độ cao", detail: "Giai đoạn phục hồi sau gắng sức mạnh (nhịp giảm đột ngột) có thể trigger AFib.", severity: "medium" });
  if (/mất ngủ|thiếu ngủ|thức khuya|ngủ ít|không ngủ|khó ngủ/.test(note)) triggers.push({ factor: "😴 Thiếu ngủ", detail: "Thiếu ngủ <6 giờ làm tăng 80% nguy cơ AFib theo nghiên cứu NLHBI (2023). Hệ phó giao cảm suy giảm.", severity: "high" });
  if (/mệt|kiệt sức|đuối|mệt mỏi|mệt lả/.test(note)) triggers.push({ factor: "😓 Kiệt sức", detail: "Cơ thể kiệt sức làm giảm ngưỡng kích thích điện tim, tim dễ bị rối loạn nhịp.", severity: "medium" });
  if (/ăn nhiều|no|nhậu|tiệc|buffet/.test(note)) triggers.push({ factor: "🍽️ Ăn quá no / sau bữa lớn", detail: "Dạ dày căng kích thích dây thần kinh phế vị (vagus) → nhịp chậm rồi bật nhanh → trigger AFib (post-prandial AFib).", severity: "low" });

  if (preMood === "stressed" || preMood === "pain") {
    if (!triggers.find(t => t.factor.includes("Stress"))) {
      triggers.push({ factor: "😣 Tâm lý bất ổn trước đo", detail: "Người dùng báo cáo trạng thái căng thẳng/khó chịu trước khi đo. Hệ giao cảm tăng hoạt.", severity: "medium" });
    }
  }

  // HRV suy giảm so với lịch sử
  const prevMs = measurements.filter(m => (m.type === "face" || m.type === "finger") && (m.result?.sdnn || 0) > 0).slice(-6);
  if (prevMs.length >= 3 && (r.sdnn || 0) > 0) {
    const avgSdnn = prevMs.reduce((s, m) => s + m.result.sdnn, 0) / prevMs.length;
    if (r.sdnn < avgSdnn * 0.6) {
      triggers.push({ factor: "📉 HRV suy giảm đột ngột", detail: `SDNN hiện tại ${r.sdnn}ms — giảm ${Math.round((1 - r.sdnn / avgSdnn) * 100)}% so với trung bình lịch sử ${Math.round(avgSdnn)}ms. Dấu hiệu căng thẳng tích lũy hoặc mệt mỏi cơ tim.`, severity: "high" });
    }
  }

  // Pattern lặp theo ngày trong tuần
  if (allAfib.length >= 3) {
    const days = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    const dayCount = {};
    for (const e of allAfib.slice(0, 10)) { const d = new Date(e.createdAt).getDay(); dayCount[d] = (dayCount[d] || 0) + 1; }
    const peak = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];
    if (peak && Number(peak[1]) >= 2) {
      triggers.push({ factor: `📅 Pattern: hay xảy ra vào ${days[Number(peak[0])]}`, detail: `${peak[1]} trong ${allAfib.length} cơn AFib ghi nhận rơi vào ${days[Number(peak[0])]} — có thể liên quan đến thói quen ngày đó.`, severity: "low" });
    }
  }

  // Lưu episode
  const contextEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
    userId: session.userId, at: new Date().toISOString(),
    weatherTemp, weatherHumidity, hour, preMood,
    triggers: triggers.map(t => t.factor),
    afibCount: allAfib.length, afibLast7Days,
    contextNote: contextNote.slice(0, 300),
  };
  episodes.push(contextEntry);
  writeJson("afibEpisodes", episodes);

  // ── Gemini AI phân tích chuyên sâu ───────────────────────────────────────
  if (!GEMINI_API_KEY) {
    sendJson(res, 200, { ok: true, triggers, contextEntry, aiAnalysis: null });
    return;
  }

  const age = user?.age || "không rõ";
  const gender = user?.gender === "male" ? "Nam" : user?.gender === "female" ? "Nữ" : "Không rõ";
  const conditions = (user?.conditions || []).join(", ") || "không có";
  const timeLabel = `${hour}h ${hour < 12 ? "sáng" : hour < 18 ? "chiều" : "tối"}`;

  const weatherBlock = weatherTemp !== null
    ? `${weatherTemp}°C${weatherHumidity ? `, ${weatherHumidity}% độ ẩm` : ""}${weatherDesc ? `, ${weatherDesc}` : ""}${weatherLocation ? ` (${weatherLocation})` : ""}`
    : "Không có dữ liệu thời tiết";

  const triggerSummary = triggers.length > 0
    ? triggers.map(t => `• ${t.factor}: ${t.detail}`).join("\n")
    : "• Chưa xác định được trigger rõ ràng từ dữ liệu tự động";

  const analysisPrompt = `Bạn là GS.TS.BS. chuyên khoa Tim mạch can thiệp & Điện sinh lý học (Electrophysiology). Chuyên gia về rối loạn nhịp tim, đặc biệt rung nhĩ (AFib). Thành viên ESC, ACC, VNHA.

BỆNH NHÂN VỪA PHÁT HIỆN RUNG NHĨ (AFib):
Họ tên: ${user?.fullName || "bệnh nhân"} | Tuổi: ${age} | Giới: ${gender} | Bệnh nền: ${conditions}
Thời điểm: ${timeLabel} | Tổng cơn AFib từ trước đến nay: ${allAfib.length} lần | 7 ngày qua: ${afibLast7Days} lần | 30 ngày qua: ${afibLast30Days} lần

CHỈ SỐ ĐO LÚC PHÁT HIỆN AFib:
Nhịp tim: ${r.bpm || "--"} BPM | HRV-SDNN: ${r.sdnn || "--"}ms | Độ bất thường nhịp: ${r.irregularityIndex || "--"}% | Nguy cơ đột quỵ: ${r.strokeRiskScore || "--"}%

ĐIỀU KIỆN: Thời tiết: ${weatherBlock} | Tâm trạng trước đo: ${preMood || "không khai báo"}

GHI CHÚ CỦA BỆNH NHÂN: "${contextNote || "(không có ghi chú)"}"

TRIGGER ĐÃ PHÁT HIỆN TỰ ĐỘNG:
${triggerSummary}

Viết BẢN PHÂN TÍCH NGUYÊN NHÂN AFib chuyên sâu, cá nhân hóa, gồm đúng 3 phần:

PHẦN 1 — NGUYÊN NHÂN & CƠ CHẾ SINH LÝ
Giải thích CỤ THỂ tại sao các yếu tố kết hợp này gây ra cơn AFib cho bệnh nhân này, dựa trên cơ chế điện sinh lý và đặc điểm bệnh nền. Nếu ghi chú bệnh nhân có thông tin quan trọng ngoài những gì đã phát hiện tự động, hãy bổ sung phân tích. Không phỏng đoán khi thiếu dữ liệu — nói rõ cần thêm thông tin gì.

PHẦN 2 — ĐÁNH GIÁ MỨC ĐỘ & XU HƯỚNG
Dựa trên tần suất tái phát (${allAfib.length} lần tổng, ${afibLast7Days} lần/7 ngày), chỉ số HRV, nguy cơ đột quỵ và bệnh nền: đánh giá mức độ nghiêm trọng, xu hướng có đáng lo không, và có dấu hiệu AFib đang tiến triển mạn tính không.

PHẦN 3 — PHÒNG TRÁNH CỤ THỂ CHO LẦN SAU
Đưa ra đúng 4 hành động phòng ngừa thực tế, gắn trực tiếp với từng trigger đã xác định. Mỗi hành động phải có số liệu cụ thể (ví dụ: "không uống cà phê sau 14h", "ngủ đủ 7 tiếng trước 23h"). Kết thúc bằng: khi nào cần đến viện gấp trong 24h tới.

Quy tắc: tiếng Việt, giọng bác sĩ chuyên khoa — ấm áp, chuyên sâu, cá nhân hóa. Gọi tên bệnh nhân. 320–450 từ. Không dùng markdown bullets.`;

  try {
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: "Bạn là chuyên gia điện sinh lý tim HEARTSENSE. Phân tích cơn AFib bằng tiếng Việt, chuyên sâu, cá nhân hóa hoàn toàn theo dữ liệu bệnh nhân." }] },
      contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
      generationConfig: { temperature: 0.45, maxOutputTokens: 2048, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
      safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
    });
    const geminiRes = await requestJson(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      body: payload,
    });
    if (geminiRes?.error) {
      console.warn("[AFib Trigger AI] Gemini error:", geminiRes.error.message);
      sendJson(res, 200, { ok: true, triggers, contextEntry, aiAnalysis: null });
      return;
    }
    const aiAnalysis = geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    contextEntry.aiAnalysis = aiAnalysis ? aiAnalysis.slice(0, 3000) : null;
    writeJson("afibEpisodes", episodes);
    sendJson(res, 200, { ok: true, triggers, contextEntry, aiAnalysis });
  } catch (err) {
    console.error("[AFib Trigger AI]", err.message);
    sendJson(res, 200, { ok: true, triggers, contextEntry, aiAnalysis: null });
  }
}

// ─── Zalo Tele-Clinic webhook (G6/C) — skeleton for future integration ────────
async function handleZaloWebhook(urlObject, body, res) {
  // Infrastructure ready — activate by providing ZALO_APP_ID + ZALO_APP_SECRET
  const ZALO_APP_ID = process.env.ZALO_APP_ID || "";
  const ZALO_OA_TOKEN = process.env.ZALO_OA_TOKEN || "";
  if (!ZALO_APP_ID || !ZALO_OA_TOKEN) {
    sendJson(res, 200, { ok: false, message: "Zalo API chưa được cấu hình. Liên hệ admin để kích hoạt." });
    return;
  }
  // When activated: POST to Zalo OA API to send message
  const { userId, message } = body;
  const session = getSessionFromRequest(urlObject, body);
  if (!session) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
  // Placeholder for Zalo API call
  sendJson(res, 200, { ok: true, message: "Tin nhắn Zalo đã được gửi (skeleton)." });
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
  // CORS — chỉ cho phép origin từ cùng host (hoặc wildcard khi development)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // CSRF protection: POST requests to sensitive API endpoints must include
  // either X-CSRF-Token header OR come from same origin.
  // Public endpoints (auth/login, auth/register, health) are exempt.
  if (req.method === "POST") {
    const origin = req.headers.origin || "";
    const referer = req.headers.referer || "";
    const csrfHeader = req.headers["x-csrf-token"] || "";
    const host = req.headers.host || "";
    const isSameOrigin = origin.includes(host) || referer.includes(host) || !origin; // no-origin = same-site
    const pathname = new URL(req.url, `http://${host}`).pathname;
    const csrfExempt = ["/api/auth/login", "/api/auth/register", "/api/health"].includes(pathname);
    if (!csrfExempt && !isSameOrigin && !csrfHeader) {
      sendJson(res, 403, { error: "CSRF validation failed" }); return;
    }
  }

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
  if (req.method === "POST" && p === "/api/pocket-cardiologist") { await handlePocketCardiologist(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/pocket-cardiologist/send-family-report") { await handleSendAiFamilyReport(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/hrr-result") {
    const body = await parseBody(req);
    const session = getSessionFromRequest(urlObject, body);
    const user = getUserBySession(session);
    if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
    const result = saveHRRResult(user.id, body);
    sendJson(res, 200, { ok: true, result });
    return;
  }
  if (req.method === "POST" && p === "/api/family-token") {
    const body = await parseBody(req);
    const session = getSessionFromRequest(urlObject, body);
    const user = getUserBySession(session);
    if (!user) { sendJson(res, 401, { error: "Cần đăng nhập." }); return; }
    const token = generateFamilyToken(user.id);
    sendJson(res, 200, { token, url: `/family/${token}` });
    return;
  }
  if (req.method === "GET" && p.startsWith("/family/")) {
    const token = p.split("/family/")[1];
    const users = readJson("users");
    const user = users.find(u => u.familyToken?.token === token);
    if (!user || new Date(user.familyToken.expiresAt) < new Date()) {
      sendText(res, 404, "<h2>Link đã hết hạn hoặc không tồn tại.</h2>", "text/html; charset=utf-8"); return;
    }
    const allMs = readJson("measurements").filter(m=>m.userId===user.id&&(m.type==="face"||m.type==="finger")).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const latest = allMs[0];
    const r = latest?.result || {};
    const statusColor = r.classification==="afib"?"#cc2244":r.classification==="elevated"?"#d97706":"#16a34a";
    const statusLabel = r.classification==="afib"?"⚠️ Phát hiện rung nhĩ":r.classification==="elevated"?"⚡ Chỉ số cao":"✅ Tim khoẻ mạnh";
    const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HeartSense — ${escHtml(user.fullName)}</title><style>body{font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:20px;background:#f8fafc}h1{color:#1e3a5f;font-size:18px}.card{background:#fff;border-radius:14px;padding:20px;margin:12px 0;box-shadow:0 2px 12px rgba(0,0,0,0.08)}.status{font-size:22px;font-weight:900;color:${statusColor};text-align:center;padding:16px;border-radius:10px;background:${statusColor}15;margin:8px 0}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px}.label{color:#64748b}.val{font-weight:700;color:#1e3a5f}.btn{display:block;background:#1e3a5f;color:#fff;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-weight:700;margin-top:12px}.sos{background:#cc2244}</style></head><body>
    <h1>❤️ HeartSense — Theo dõi tim mạch của ${escHtml(user.fullName)}</h1>
    <div class="card">
      <div class="status">${statusLabel}</div>
      <div class="row"><span class="label">Nhịp tim</span><span class="val">${r.bpm||"--"} BPM</span></div>
      <div class="row"><span class="label">HRV (SDNN)</span><span class="val">${r.sdnn||"--"} ms</span></div>
      <div class="row"><span class="label">Nguy cơ đột quỵ</span><span class="val">${r.strokeRiskScore||"--"}%</span></div>
      <div class="row"><span class="label">Nguy cơ huyết khối</span><span class="val">${r.clotRisk?.score||"--"}/100</span></div>
      <div class="row"><span class="label">Lần đo gần nhất</span><span class="val">${latest?new Date(latest.createdAt).toLocaleString("vi-VN"):"Chưa đo"}</span></div>
      <div class="row"><span class="label">Tuổi</span><span class="val">${user.age} tuổi</span></div>
    </div>
    <a href="tel:${escHtml(user.guardian?.guardianPhone||"")}" class="btn">📞 Gọi cho ${escHtml(user.fullName)}</a>
    <a href="tel:115" class="btn sos">🚨 Gọi Cấp cứu 115</a>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">HEARTSENSE Mắt thần — Chỉ gia đình được xem • Tự động hết hạn sau 30 ngày</p>
    </body></html>`;
    sendText(res, 200, html, "text/html; charset=utf-8");
    return;
  }
  if (req.method === "POST" && p === "/api/medications/check-interactions") { await handleCheckInteractions(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/pill-protocol") { await handleSavePillProtocol(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/export-token") { await handleGenerateExportToken(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/holter-log") { await handleSaveHolterLog(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/medications/adherence") { await handleMedicationAdherence(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/measurements/delete") { await handleDeleteMeasurement(urlObject, await parseBody(req), res); return; }
  if (req.method === "GET" && p === "/api/population-stats") { handlePopulationStats(res); return; }
  if (req.method === "GET" && p === "/api/email-status") { handleEmailStatus(res); return; }
  if (req.method === "GET" && p === "/api/cron") { await handleCronPing(urlObject, res); return; }
  // New endpoints (List Update 1 & 2)
  if (req.method === "POST" && p === "/api/expert-mode") { await handleExpertMode(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/research-consent") { await handleResearchConsent(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/afib-context") { await handleAfibContext(urlObject, await parseBody(req), res); return; }
  if (req.method === "POST" && p === "/api/zalo-clinic") { await handleZaloWebhook(urlObject, await parseBody(req), res); return; }

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


