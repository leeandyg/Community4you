import { after } from "next/server";
import { analyzeTicket } from "@/lib/analyze";
import { handleMessage } from "@/lib/engine";
import { smsAccess } from "@/lib/smsAccess";
import { isValidGatewaySignature, sendGatewaySms, type SmsReceivedEvent } from "@/lib/smsgate";

export const runtime = "nodejs";

// The app retries a webhook that doesn't get a 2xx within 30s, so remember
// which messages we've already handled to avoid double replies.
const g = globalThis as unknown as { __c4ySeenSms?: Set<string> };
const seen = (g.__c4ySeenSms ??= new Set<string>());

// SMS Gateway for Android webhook (event: sms:received).
// Register it with: npm run gateway:register -- https://<public-host>
export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!isValidGatewaySignature(rawBody, req.headers)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const event = JSON.parse(rawBody) as SmsReceivedEvent;
  const from = event.payload?.sender ?? event.payload?.phoneNumber;
  // Only real phone numbers: never auto-reply to short codes (banks, 2FA, carrier alerts).
  const isPhoneNumber = Boolean(from && /^\+\d{10,15}$/.test(from));
  if (event.event !== "sms:received" || !from || !isPhoneNumber || seen.has(event.payload.messageId)) {
    return new Response(null, { status: 204 });
  }
  seen.add(event.payload.messageId);

  // Acknowledge right away; triage and the reply SMS run after the response.
  after(async () => {
    try {
      const access = await smsAccess(from, event.payload.message);
      if (!access.allowed) return; // not on the allowlist and didn't use the join keyword
      const { reply, analyzeTicketId } = await handleMessage({ channel: "sms", from, body: access.body });
      await sendGatewaySms(from, reply);
      if (analyzeTicketId) await analyzeTicket(analyzeTicketId);
    } catch (err) {
      console.error("[smsgate] failed to handle message:", err);
    }
  });

  return new Response(null, { status: 204 });
}
