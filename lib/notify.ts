import { sendGatewaySms } from "./smsgate";
import { addMessage, updateConversation, type Sender } from "./store";

// Messages to a reporter outside the normal reply: incident updates, agency
// messages, status changes. Saved to the conversation either way; texted only
// for SMS reporters (web chat reporters see it in their transcript).
export async function notifyReporter(
  conversationId: string,
  phone: string,
  body: string,
  sender: Sender = "bot",
): Promise<void> {
  // Bumping the conversation keeps it open, so the resident's reply lands on the same report.
  await Promise.all([addMessage(conversationId, sender, body), updateConversation(conversationId, {})]);
  if (phone.startsWith("web:")) return;
  if (process.env.SMS_DRY_RUN || !process.env.SMSGATE_USERNAME) {
    console.warn(`[notify] not texting ${phone} (dry run or no gateway configured): ${body}`);
    return;
  }
  await sendGatewaySms(phone, body);
}
