import http from "http";
import https from "https";

const PORT = Number(process.env.PORT || 4000);
const RESEND_API_BASE_URL = process.env.RESEND_API_BASE_URL || "https://api.resend.com/emails";
const OPENWEATHER_CURRENT_URL =
  process.env.OPENWEATHER_CURRENT_URL || "https://api.openweathermap.org/data/2.5/weather";
const EMAIL_FROM = process.env.EMAIL_FROM || "HEARTSENSE <onboarding@resend.dev>";
const WEATHER_DEFAULT_QUERY = process.env.WEATHER_DEFAULT_QUERY || "Ha Noi,VN";

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) {
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

async function fetchWeather(query = WEATHER_DEFAULT_QUERY) {
  if (!process.env.OPENWEATHER_API_KEY) {
    return {
      source: "disabled",
      reason: "missing_openweather_api_key",
      location: query,
    };
  }

  const url = `${OPENWEATHER_CURRENT_URL}?q=${encodeURIComponent(query)}&appid=${encodeURIComponent(
    process.env.OPENWEATHER_API_KEY,
  )}&units=metric&lang=vi`;
  const response = await requestJson(url);
  return {
    source: "openweather",
    location: response.name || query,
    temperatureC: response.main?.temp ?? null,
    description: response.weather?.[0]?.description || "",
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      name: "HEARTSENSE API",
      version: "1.1.0",
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      integrations: {
        sms: Boolean(process.env.TWILIO_ACCOUNT_SID),
        zalo: Boolean(process.env.ZALO_ZNS_ACCESS_TOKEN),
        email: Boolean(process.env.RESEND_API_KEY),
        push: Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY),
        weather: Boolean(process.env.OPENWEATHER_API_KEY),
      },
      emailApiBaseUrl: RESEND_API_BASE_URL,
      weatherApiBaseUrl: OPENWEATHER_CURRENT_URL,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/weather/current") {
    const query = url.searchParams.get("q") || WEATHER_DEFAULT_QUERY;
    const weather = await fetchWeather(query);
    sendJson(res, 200, { ok: true, weather });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/email/test") {
    const body = await parseBody(req);
    const result = await sendResendEmail({
      to: body.to,
      subject: body.subject || "HEARTSENSE test email",
      html: body.html || "<p>HEARTSENSE test email</p>",
    });
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/sos/test") {
    const body = await parseBody(req);
    const email = await sendResendEmail({
      to: body.email,
      subject: "HEARTSENSE SOS Alert",
      html: `<p>${body.reason || "Canh bao tim mach bat thuong"}</p>`,
    });
    sendJson(res, 200, {
      ok: true,
      received: body,
      email,
      message: "Endpoint production scaffold cho SOS email that qua Resend.",
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`HEARTSENSE API listening on http://localhost:${PORT}`);
});
