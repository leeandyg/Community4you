import { createHmac, timingSafeEqual } from "node:crypto";

// SMS Gateway for Android (https://docs.sms-gate.app) in Cloud mode: an Android
// phone with a SIM is our real phone number. Inbound texts arrive as webhooks;
// replies go out through the cloud API, which pushes them to the phone.

const API_URL = process.env.SMSGATE_API_URL ?? "https://api.sms-gate.app/3rdparty/v1";

function authHeader(): string {
  const { SMSGATE_USERNAME, SMSGATE_PASSWORD } = process.env;
  if (!SMSGATE_USERNAME || !SMSGATE_PASSWORD) {
    throw new Error("SMSGATE_USERNAME / SMSGATE_PASSWORD not set (see the app's Home tab)");
  }
  return "Basic " + Buffer.from(`${SMSGATE_USERNAME}:${SMSGATE_PASSWORD}`).toString("base64");
}

export async function gatewayRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`SMS gateway ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

export async function sendGatewaySms(to: string, text: string): Promise<void> {
  await gatewayRequest("/messages", {
    method: "POST",
    body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
  });
}

// Webhooks are signed with HMAC-SHA256(signingKey, rawBody + X-Timestamp).
// The key is in the app under Settings > Webhooks > Signing Key.
export function isValidGatewaySignature(rawBody: string, headers: Headers): boolean {
  const key = process.env.SMSGATE_SIGNING_KEY;
  if (!key) {
    console.warn("[smsgate] SMSGATE_SIGNING_KEY not set, skipping signature validation");
    return true;
  }
  const signature = headers.get("x-signature") ?? "";
  const timestamp = headers.get("x-timestamp") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const expected = createHmac("sha256", key).update(rawBody + timestamp).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SmsReceivedEvent {
  event: string;
  id: string;
  deviceId: string;
  webhookId: string;
  payload: {
    messageId: string;
    message: string;
    sender?: string;
    phoneNumber?: string; // older app versions name the sender field this
    recipient?: string | null;
    simNumber?: number;
    receivedAt: string;
  };
}
