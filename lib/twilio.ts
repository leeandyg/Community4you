import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;
const getClient = () =>
  (client ??= twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN));

export function twimlMessage(text: string): string {
  const response = new twilio.twiml.MessagingResponse();
  response.message(text);
  return response.toString();
}

// Outbound SMS, e.g. status updates and agency messages to the reporter.
export async function sendSms(to: string, body: string): Promise<void> {
  await getClient().messages.create({ to, from: process.env.TWILIO_PHONE_NUMBER, body });
}

// Twilio signs the public URL it called, which differs from req.url behind
// ngrok or Vercel, so rebuild it from PUBLIC_BASE_URL or the forwarded headers.
export function isValidTwilioRequest(req: Request, params: Record<string, string>): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("[twilio] TWILIO_AUTH_TOKEN not set, skipping signature validation");
    return true;
  }
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const { pathname, search } = new URL(req.url);
  const base =
    process.env.PUBLIC_BASE_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  return twilio.validateRequest(authToken, signature, `${base}${pathname}${search}`, params);
}
