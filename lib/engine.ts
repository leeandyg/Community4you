import { detectEmergency } from "./emergency";
import { classifyFollowUp } from "./followup";
import { agencyIdFor } from "./routing";
import { BASE_SCORE } from "./scoring";
import {
  addMessage,
  countRecentTickets,
  createConversation,
  findRecentConversation,
  getAgencyName,
  getTicket,
  listMessages,
  listTickets,
  updateConversation,
  upsertTicket,
  type Channel,
  type Conversation,
  type Ticket,
  type TicketFields,
} from "./store";
import { triage, type TriageResult } from "./triage";

// A reply within this window continues the reporter's latest conversation.
const CONVERSATION_WINDOW_MS = 60 * 60 * 1000;
// After this many follow-up questions we submit with whatever we have.
const MAX_QUESTIONS = 2;
// New reports one number can open per hour before we stop running the AI on them.
const REPORTS_PER_HOUR = Number(process.env.REPORTS_PER_HOUR ?? 20);
const HOUR_MS = 60 * 60 * 1000;

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
  // Set when the report was submitted or updated after submission: the caller
  // runs analyzeTicket() on it after sending the reply (incident grouping).
  analyzeTicketId: number | null;
}

const EMERGENCY_REPLY =
  "If anyone is in danger, CALL 911 NOW. This line is not monitored for emergencies.";
const FALLBACK_REPLY =
  "Thanks, we got your message. What's the nearest address or cross street?";
const SPAM_REPLY = "Thanks for your message. To report a problem, tell us what is happening and where.";
const RATE_LIMIT_REPLY =
  "You've sent several reports in the last hour, so we're reviewing those first. If anyone is in danger, call 911.";

export async function handleMessage(msg: InboundMessage): Promise<EngineReply> {
  const text = msg.body.trim();
  const command = text.toUpperCase();

  if (command === "STATUS") return statusReply(msg.from);

  let convo = await findRecentConversation(msg.from, CONVERSATION_WINDOW_MS);

  if (command === "NEW") {
    if (convo) await updateConversation(convo.id, { state: "closed" });
    return { reply: "Okay, starting a new report. What's going on, and where?", ticketId: null, emergency: false, analyzeTicketId: null };
  }

  const emergencyKeyword = detectEmergency(text);

  // A text after the report was submitted: more detail, a new problem, or just "thanks"?
  if (convo?.state === "submitted" && convo.ticketId != null) {
    const [submitted, recent] = await Promise.all([getTicket(convo.ticketId), listMessages(convo.id)]);
    const kind = submitted ? await classifyFollowUp(submitted, recent, text) : "more_info";
    const resolved = submitted?.status === "resolved";
    if (kind === "other" && !emergencyKeyword) {
      const reply = resolved
        ? `You're welcome! Report #${convo.ticketId} is resolved. Text us anytime about a new problem.`
        : `Got it. Report #${convo.ticketId} is open. Reply STATUS for updates or NEW to report something else.`;
      await Promise.all([
        addMessage(convo.id, "reporter", text, msg.mediaUrl ?? null),
        addMessage(convo.id, "bot", reply),
        updateConversation(convo.id, {}),
      ]);
      return { reply, ticketId: convo.ticketId, emergency: false, analyzeTicketId: null };
    }
    // A new problem, or more about one that's already resolved ("it's broken again"):
    // start a fresh report so agencies see it instead of it landing on a closed ticket.
    if (kind === "new_problem" || resolved) {
      await updateConversation(convo.id, { state: "closed" });
      convo = null; // falls through to a fresh report below
    }
  }

  // A spam report stays open so a real one sent next is judged together with it
  // ("test", then "pothole on Main"). A different problem gets its own report
  // instead of overwriting the spam one.
  if (convo?.state === "clarifying" && convo.ticketId != null) {
    const [flagged, recent] = await Promise.all([getTicket(convo.ticketId), listMessages(convo.id)]);
    if (flagged?.credibility === "spam" && !flagged.isEmergency && (await classifyFollowUp(flagged, recent, text)) === "new_problem") {
      await updateConversation(convo.id, { state: "closed" });
      convo = null;
    }
  }

  // Cap new reports per number (floods, spam bots). Emergencies always get through.
  if (!convo && !emergencyKeyword && (await countRecentTickets(msg.from, HOUR_MS)) >= REPORTS_PER_HOUR) {
    return { reply: RATE_LIMIT_REPLY, ticketId: null, emergency: false, analyzeTicketId: null };
  }

  convo ??= await createConversation(msg.from, msg.channel);
  const conversation = convo;

  // Independent database calls run together; each is a network round trip.
  const [inbound, earlier, existingTicket] = await Promise.all([
    addMessage(conversation.id, "reporter", text, msg.mediaUrl ?? null),
    listMessages(conversation.id),
    conversation.ticketId != null ? getTicket(conversation.ticketId) : null,
  ]);
  // The list may or may not already include the message saved in parallel.
  const transcript = [...earlier.filter((m) => m.id !== inbound.id), inbound];

  const result = await triage(transcript);

  // Once a report is flagged as an emergency it stays flagged.
  const emergency = Boolean(existingTicket?.isEmergency) || Boolean(emergencyKeyword) || Boolean(result?.emergency);

  let reply: string;
  let ticket: Ticket | null = null;
  let patch: ConversationPatch = {};
  if (!result) {
    reply = emergency ? EMERGENCY_REPLY : FALLBACK_REPLY;
  } else {
    const [saved, agencyName] = await Promise.all([
      upsertTicket(conversation, ticketFields(result, emergency, msg.mediaUrl ?? null)),
      getAgencyName(agencyIdFor(result.category)),
    ]);
    ticket = saved;
    ({ reply, patch } = nextReply(conversation, ticket, result, emergency, agencyName));
  }

  await Promise.all([
    updateConversation(conversation.id, { ...patch, ticketId: ticket?.id ?? conversation.ticketId }),
    addMessage(conversation.id, "bot", reply),
  ]);
  const submitted = patch.state === "submitted" || conversation.state === "submitted";
  // Spam isn't grouped into incidents, except an emergency: that always reaches
  // the dashboard (still labeled spam) in case the AI misjudged it.
  const analyzeTicketId =
    ticket && submitted && (ticket.credibility !== "spam" || ticket.isEmergency) ? ticket.id : null;
  return { reply, ticketId: ticket?.id ?? null, emergency, analyzeTicketId };
}

type ConversationPatch = Parameters<typeof updateConversation>[1];

function nextReply(
  convo: Conversation,
  ticket: Ticket,
  result: TriageResult,
  emergency: boolean,
  agencyName: string,
): { reply: string; patch: ConversationPatch } {

  if (emergency) {
    return { reply: `${EMERGENCY_REPLY} We've also logged report #${ticket.id}.`, patch: { state: "submitted" } };
  }

  // Spam stays flagged on the dashboard and isn't submitted. The conversation
  // stays open, so a real report sent next is re-judged with the full transcript.
  if (result.credibility === "spam") {
    return { reply: SPAM_REPLY, patch: {} };
  }

  // Follow-up text after submission: it already enriched the ticket above.
  if (convo.state === "submitted") {
    return { reply: `Thanks, we added that to report #${ticket.id}. Reply NEW to report something else.`, patch: {} };
  }

  if (result.clarifying_question && convo.questionsAsked < MAX_QUESTIONS) {
    return { reply: result.clarifying_question, patch: { questionsAsked: convo.questionsAsked + 1 } };
  }

  return {
    reply:
      `Thanks! Report #${ticket.id} sent to ${agencyName}. ` +
      `We'll text you updates. Reply STATUS to check, NEW to report something else.`,
    patch: { state: "submitted" },
  };
}

function ticketFields(result: TriageResult, emergency: boolean, mediaUrl: string | null): TicketFields {
  const priority = emergency ? "CRITICAL" : result.priority;
  const spam = result.credibility === "spam" && !emergency;
  return {
    agencyId: agencyIdFor(result.category),
    category: result.category,
    subcategory: result.subcategory,
    summary: result.summary,
    locationText: result.location_text,
    lat: null, // filled by geocoding (add-on)
    lng: null,
    hazardType: result.hazard_type,
    peopleInvolved: result.people_involved,
    priority,
    priorityReason: result.priority_reason,
    isEmergency: emergency,
    photoUrl: mediaUrl,
    priorityScore: spam ? 0 : BASE_SCORE[priority],
    suggestedAction: result.suggested_action,
    credibility: result.credibility,
    credibilityReason: result.credibility === "ok" ? null : result.credibility_reason,
  };
}

async function statusReply(from: string): Promise<EngineReply> {
  const tickets = await listTickets({ phone: from });
  if (tickets.length === 0) {
    return { reply: "You don't have any reports yet. Text us what's happening and where.", ticketId: null, emergency: false, analyzeTicketId: null };
  }
  const label = { new: "received", in_progress: "in progress", resolved: "resolved" } as const;
  const lines = tickets.slice(0, 3).map((t) => `#${t.id} ${t.subcategory}: ${label[t.status]}`);
  return { reply: `Your reports:\n${lines.join("\n")}`, ticketId: null, emergency: false, analyzeTicketId: null };
}
