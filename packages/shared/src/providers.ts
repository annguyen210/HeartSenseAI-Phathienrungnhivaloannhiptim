import type { NotificationPayload } from "./types";

export async function sendSms(payload: NotificationPayload): Promise<{ provider: string; accepted: boolean }> {
  return { provider: "twilio", accepted: Boolean(payload.phone) };
}

export async function sendZalo(payload: NotificationPayload): Promise<{ provider: string; accepted: boolean }> {
  return { provider: "zalo-zns", accepted: Boolean(payload.phone) };
}

export async function sendEmail(payload: NotificationPayload): Promise<{ provider: string; accepted: boolean }> {
  return { provider: "resend", accepted: Boolean(payload.email) };
}

export async function sendWebPush(payload: NotificationPayload): Promise<{ provider: string; accepted: boolean }> {
  return { provider: "web-push", accepted: Boolean(payload.pushSubscription) };
}
