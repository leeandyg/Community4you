import { sendGatewaySms } from "./smsgate";
import { addMessage, type Sender } from "./store";

// Messages to a reporter outside the normal reply: incident updates, agency
// messages, status changes. Saved to the conversation either way; texted only
// for SMS reporters (web chat reporters see it in their transcript).
export async function notifyReporter(
  conversationId: string,
  phone: string,
  body: string,
  sender: Sender = "bot",
): Promise<void> {
  await addMessage(conversationId, sender, body);
  if (phone.startsWith("web:")) return;
  if (!process.env.SMSGATE_USERNAME) {
    console.warn(`[notify] SMS gateway not configured; not texting ${phone}: ${body}`);
    return;
  }
  await sendGatewaySms(phone, body);
}
