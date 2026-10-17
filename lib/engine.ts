import { detectEmergency } from "./emergency";
import { agencyFor } from "./routing";
import {
  addMessage,
  createConversation,
  findRecentConversation,
  getTicket,
  listMessages,
  listTickets,
  updateConversation,
  upsertTicket,
  type Channel,
  type Conversation,
  type Ticket,
} from "./store";
import { triage, type TriageResult } from "./triage";

// A reply within this window continues the reporter's latest conversation.
const CONVERSATION_WINDOW_MS = 60 * 60 * 1000;
// After this many follow-up questions we submit with whatever we have.
const MAX_QUESTIONS = 2;

export interface InboundMessage {
  channel: Channel;
  from: string; // phone number for SMS, session id for web
  body: string;
  mediaUrl?: string | null;
}

export interface EngineReply {
  reply: string;
  ticketId: number | null;
  emergency: boolean;
}

const EMERGENCY_REPLY =
  "If anyone is in danger, CALL 911 NOW. This line is not monitored for emergencies.";
const FALLBACK_REPLY =
  "Thanks, we got your message. What's the nearest address or cross street?";

export async function handleMessage(msg: InboundMessage): Promise<EngineReply> {
  const text = msg.body.trim();
  const command = text.toUpperCase();

  if (command === "STATUS") return statusReply(msg.from);

  let convo = await findRecentConversation(msg.from, CONVERSATION_WINDOW_MS);

  if (command === "NEW") {
    if (convo) await updateConversation(convo.id, { state: "closed" });
    return { reply: "Okay, starting a new report. What's going on, and where?", ticketId: null, emergency: false };
  }

  convo ??= await createConversation(msg.from, msg.channel);
  await addMessage(convo.id, "reporter", text, msg.mediaUrl ?? null);

  const emergencyKeyword = detectEmergency(text);
  const transcript = await listMessages(convo.id);
  const result = await triage(transcript);

  let reply: string;
  let ticket: Ticket | null = null;
  // Once a report is flagged as an emergency it stays flagged.
  const wasEmergency = convo.ticketId != null && Boolean((await getTicket(convo.ticketId))?.isEmergency);
  const emergency = wasEmergency || Boolean(emergencyKeyword) || Boolean(result?.emergency);

  if (!result) {
    reply = emergency ? EMERGENCY_REPLY : FALLBACK_REPLY;
  } else {
    ticket = await upsertTicket(convo, ticketFields(result, emergency, msg.mediaUrl ?? null));
    reply = await nextReply(convo, ticket, result, emergency);
  }

  await updateConversation(convo.id, { ticketId: ticket?.id ?? convo.ticketId });
  await addMessage(convo.id, "bot", reply);
  return { reply, ticketId: ticket?.id ?? null, emergency };
}

async function nextReply(
  convo: Conversation,
  ticket: Ticket,
  result: TriageResult,
  emergency: boolean,
): Promise<string> {
  const agency = agencyFor(result.category);

  if (emergency) {
    await updateConversation(convo.id, { state: "submitted" });
    return `${EMERGENCY_REPLY} We've also logged report #${ticket.id}.`;
  }

  // Follow-up text after submission: it already enriched the ticket above.
  if (convo.state === "submitted") {
    return `Thanks, we added that to report #${ticket.id}. Reply NEW to report something else.`;
  }

  if (result.clarifying_question && convo.questionsAsked < MAX_QUESTIONS) {
    await updateConversation(convo.id, { questionsAsked: convo.questionsAsked + 1 });
    return result.clarifying_question;
  }

  await updateConversation(convo.id, { state: "submitted" });
  return (
    `Thanks! Report #${ticket.id} sent to ${agency.name} (${ticket.priority} priority). ` +
    `We'll text you updates. Reply STATUS to check, NEW to report something else.`
  );
}

function ticketFields(result: TriageResult, emergency: boolean, mediaUrl: string | null) {
  return {
    agencyId: agencyFor(result.category).id,
    category: result.category,
    subcategory: result.subcategory,
    summary: result.summary,
    locationText: result.location_text,
    lat: null, // filled by geocoding (next step)
    lng: null,
    hazardType: result.hazard_type,
    peopleInvolved: result.people_involved,
    priority: emergency ? ("CRITICAL" as const) : result.priority,
    priorityReason: result.priority_reason,
    isEmergency: emergency,
    photoUrl: mediaUrl,
  };
}

async function statusReply(from: string): Promise<EngineReply> {
  const tickets = await listTickets({ phone: from });
  if (tickets.length === 0) {
    return { reply: "You don't have any reports yet. Text us what's happening and where.", ticketId: null, emergency: false };
  }
  const label = { new: "received", in_progress: "in progress", resolved: "resolved" } as const;
  const lines = tickets.slice(0, 3).map((t) => `#${t.id} ${t.subcategory}: ${label[t.status]}`);
  return { reply: `Your reports:\n${lines.join("\n")}`, ticketId: null, emergency: false };
}
