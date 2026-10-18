import { hasConversation } from "./store";

// Who the SMS bot answers. The gateway phone is a regular phone, so without
// limits the bot would reply to every text its owner receives.
//   SMS_ALLOWED_NUMBERS  comma-separated numbers that are always answered (the team)
//   SMS_JOIN_KEYWORD     e.g. REPORT: anyone else is answered once their first text
//                        starts with it ("REPORT pothole at ..."), and from then on
// With neither set, everyone is answered. Senders who don't qualify are ignored
// entirely: no reply, nothing saved.

// "+1 (213) 555-0142", "2135550142" -> "+12135550142"
function normalize(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export async function smsAccess(from: string, text: string): Promise<{ allowed: boolean; body: string }> {
  const allowed = (process.env.SMS_ALLOWED_NUMBERS ?? "").split(",").map((n) => n.trim()).filter(Boolean).map(normalize);
  const keyword = process.env.SMS_JOIN_KEYWORD?.trim();

  // Strip the keyword so the AI only sees the report itself.
  const match = keyword ? text.match(new RegExp(`^\\s*${keyword.replace(/[^\w]/g, "")}\\b[\\s:,.-]*`, "i")) : null;
  const body = match ? text.slice(match[0].length).trim() || text : text;

  if (allowed.length === 0 && !keyword) return { allowed: true, body };
  if (allowed.includes(normalize(from))) return { allowed: true, body };
  if (match) return { allowed: true, body };
  if (keyword && (await hasConversation(from))) return { allowed: true, body };
  return { allowed: false, body };
}
