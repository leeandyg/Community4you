import { handleMessage } from "@/lib/engine";
import { isValidTwilioRequest, twimlMessage } from "@/lib/twilio";

export const runtime = "nodejs";

// Twilio inbound SMS/MMS webhook. Configure the number's "A message comes in"
// webhook as HTTP POST to https://<host>/api/sms.
export async function POST(req: Request) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));

  if (!isValidTwilioRequest(req, params)) {
    return new Response("Invalid Twilio signature", { status: 403 });
  }

  const hasPhoto = Number(params.NumMedia ?? 0) > 0 && params.MediaContentType0?.startsWith("image/");
  const { reply } = await handleMessage({
    channel: "sms",
    from: params.From,
    body: params.Body ?? "",
    mediaUrl: hasPhoto ? params.MediaUrl0 : null,
  });

  return new Response(twimlMessage(reply), { headers: { "Content-Type": "text/xml" } });
}
