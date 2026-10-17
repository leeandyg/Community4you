import type { Category, Priority } from "./triage";

// In-memory store so the SMS flow works before the database exists.
// Every function is async with the same shape the Supabase version will have,
// so swapping it out won't touch the engine.

export type Channel = "sms" | "web";
export type Sender = "reporter" | "bot" | "agency";

export interface Conversation {
  id: string;
  phone: string;
  channel: Channel;
  state: "clarifying" | "submitted" | "closed";
  questionsAsked: number;
  ticketId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: Sender;
  body: string;
  mediaUrl: string | null;
  createdAt: Date;
}

export interface Ticket {
  id: number;
  conversationId: string;
  phone: string;
  agencyId: string;
  category: Category;
  subcategory: string;
  summary: string;
  locationText: string | null;
  lat: number | null;
  lng: number | null;
  hazardType: string | null;
  peopleInvolved: number | null;
  priority: Priority;
  priorityReason: string;
  status: "new" | "in_progress" | "resolved";
  isEmergency: boolean;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TicketFields = Omit<Ticket, "id" | "conversationId" | "phone" | "status" | "createdAt" | "updatedAt">;

interface Db {
  conversations: Map<string, Conversation>;
  messages: Message[];
  tickets: Map<number, Ticket>;
  nextTicketId: number;
}

// Kept on globalThis so Next.js dev hot reloads don't wipe it.
const g = globalThis as unknown as { __c4yDb?: Db };
const db: Db = (g.__c4yDb ??= {
  conversations: new Map(),
  messages: [],
  tickets: new Map(),
  nextTicketId: 101,
});

export async function findRecentConversation(phone: string, withinMs: number): Promise<Conversation | null> {
  const cutoff = Date.now() - withinMs;
  let latest: Conversation | null = null;
  for (const c of db.conversations.values()) {
    if (c.phone !== phone || c.state === "closed" || c.updatedAt.getTime() < cutoff) continue;
    if (!latest || c.updatedAt > latest.updatedAt) latest = c;
  }
  return latest;
}

export async function createConversation(phone: string, channel: Channel): Promise<Conversation> {
  const now = new Date();
  const convo: Conversation = {
    id: crypto.randomUUID(),
    phone,
    channel,
    state: "clarifying",
    questionsAsked: 0,
    ticketId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.conversations.set(convo.id, convo);
  return convo;
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, "state" | "questionsAsked" | "ticketId">>,
): Promise<void> {
  const convo = db.conversations.get(id);
  if (convo) Object.assign(convo, patch, { updatedAt: new Date() });
}

export async function addMessage(
  conversationId: string,
  sender: Sender,
  body: string,
  mediaUrl: string | null = null,
): Promise<Message> {
  const msg: Message = { id: crypto.randomUUID(), conversationId, sender, body, mediaUrl, createdAt: new Date() };
  db.messages.push(msg);
  const convo = db.conversations.get(conversationId);
  if (convo) convo.updatedAt = msg.createdAt;
  return msg;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return db.messages.filter((m) => m.conversationId === conversationId);
}

export async function upsertTicket(convo: Conversation, fields: TicketFields): Promise<Ticket> {
  const now = new Date();
  const existing = convo.ticketId != null ? db.tickets.get(convo.ticketId) : undefined;
  if (existing) {
    // A later text without a photo keeps the earlier photo.
    Object.assign(existing, fields, { photoUrl: fields.photoUrl ?? existing.photoUrl, updatedAt: now });
    return existing;
  }
  const ticket: Ticket = {
    ...fields,
    id: db.nextTicketId++,
    conversationId: convo.id,
    phone: convo.phone,
    status: "new",
    createdAt: now,
    updatedAt: now,
  };
  db.tickets.set(ticket.id, ticket);
  return ticket;
}

export async function getTicket(id: number): Promise<Ticket | null> {
  return db.tickets.get(id) ?? null;
}

export async function listTickets(filter: { phone?: string } = {}): Promise<Ticket[]> {
  return [...db.tickets.values()]
    .filter((t) => !filter.phone || t.phone === filter.phone)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
