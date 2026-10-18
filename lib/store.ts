import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Category, Credibility, Priority } from "./triage";

// Persistence on Supabase (schema: supabase/schema.sql). Uses the secret key,
// so this module must only ever run on the server. Rows are snake_case in the
// database and camelCase here; the mappers at the bottom convert.

export type Channel = "sms" | "web";
export type Sender = "reporter" | "bot" | "agency";
export type TicketStatus = "new" | "in_progress" | "resolved";

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
  suggestedAction: string | null;
  locationText: string | null;
  lat: number | null;
  lng: number | null;
  hazardType: string | null;
  peopleInvolved: number | null;
  priority: Priority;
  priorityReason: string;
  isEmergency: boolean;
  credibility: Credibility;
  credibilityReason: string | null;
  photoUrl: string | null;
  duplicateOf: number | null;
  reportCount: number;
  priorityScore: number;
  analyzedAt: Date | null;
  status: TicketStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// What the engine writes on each message; everything else has a DB default
// or is filled in later by cross-ticket analysis.
export type TicketFields = Pick<
  Ticket,
  | "agencyId" | "category" | "subcategory" | "summary" | "locationText" | "lat" | "lng"
  | "hazardType" | "peopleInvolved" | "priority" | "priorityReason" | "isEmergency"
  | "photoUrl" | "priorityScore" | "suggestedAction" | "credibility" | "credibilityReason"
>;

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY not set");
    client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  }
  return client;
}

// supabase-js types data as nullable even on success; only maybeSingle() can
// legitimately return null, and getTicket checks for that.
function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`[store] ${what}: ${result.error.message}`);
  return result.data as T;
}

export async function findRecentConversation(phone: string, withinMs: number): Promise<Conversation | null> {
  const rows = check(
    await db()
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .neq("state", "closed")
      .gte("updated_at", new Date(Date.now() - withinMs).toISOString())
      .order("updated_at", { ascending: false })
      .limit(1),
    "findRecentConversation",
  );
  return rows[0] ? toConversation(rows[0]) : null;
}

export async function createConversation(phone: string, channel: Channel): Promise<Conversation> {
  const row = check(
    await db().from("conversations").insert({ phone, channel }).select().single(),
    "createConversation",
  );
  return toConversation(row);
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, "state" | "questionsAsked" | "ticketId">>,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.questionsAsked !== undefined) row.questions_asked = patch.questionsAsked;
  if (patch.ticketId !== undefined) row.ticket_id = patch.ticketId;
  check(await db().from("conversations").update(row).eq("id", id), "updateConversation");
}

export async function addMessage(
  conversationId: string,
  sender: Sender,
  body: string,
  mediaUrl: string | null = null,
): Promise<Message> {
  const row = check(
    await db()
      .from("messages")
      .insert({ conversation_id: conversationId, sender, body, media_url: mediaUrl })
      .select()
      .single(),
    "addMessage",
  );
  // The engine bumps the conversation's updated_at once per message handled.
  return toMessage(row);
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const rows = check(
    await db().from("messages").select("*").eq("conversation_id", conversationId).order("created_at"),
    "listMessages",
  );
  return rows.map(toMessage);
}

export async function upsertTicket(convo: Conversation, fields: TicketFields): Promise<Ticket> {
  const row: Record<string, unknown> = {
    agency_id: fields.agencyId,
    category: fields.category,
    subcategory: fields.subcategory,
    summary: fields.summary,
    location_text: fields.locationText,
    lat: fields.lat,
    lng: fields.lng,
    hazard_type: fields.hazardType,
    people_involved: fields.peopleInvolved,
    priority: fields.priority,
    priority_reason: fields.priorityReason,
    is_emergency: fields.isEmergency,
    priority_score: fields.priorityScore,
    suggested_action: fields.suggestedAction,
    credibility: fields.credibility,
    credibility_reason: fields.credibilityReason,
    updated_at: new Date().toISOString(),
  };
  // A later text without a photo keeps the earlier photo.
  if (fields.photoUrl) row.photo_url = fields.photoUrl;

  if (convo.ticketId != null) {
    const updated = check(
      await db().from("tickets").update(row).eq("id", convo.ticketId).select().single(),
      "upsertTicket(update)",
    );
    return toTicket(updated);
  }
  const inserted = check(
    await db()
      .from("tickets")
      .insert({ ...row, conversation_id: convo.id, phone: convo.phone })
      .select()
      .single(),
    "upsertTicket(insert)",
  );
  return toTicket(inserted);
}

export async function getTicket(id: number): Promise<Ticket | null> {
  const row = check(await db().from("tickets").select("*").eq("id", id).maybeSingle(), "getTicket");
  return row ? toTicket(row) : null;
}

export async function updateTicketStatus(id: number, status: TicketStatus): Promise<Ticket> {
  const row = check(
    await db().from("tickets").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
    "updateTicketStatus",
  );
  return toTicket(row);
}

export async function setTicketPublished(id: number, published: boolean): Promise<Ticket> {
  const row = check(
    await db().from("tickets").update({ published_at: published ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
    "setTicketPublished",
  );
  return toTicket(row);
}

// How many tickets this number has opened recently (per-number report cap).
export async function countRecentTickets(phone: string, withinMs: number): Promise<number> {
  const { count, error } = await db()
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", new Date(Date.now() - withinMs).toISOString());
  if (error) throw new Error(`[store] countRecentTickets: ${error.message}`);
  return count ?? 0;
}

export async function listTickets(filter: { phone?: string } = {}): Promise<Ticket[]> {
  let query = db().from("tickets").select("*").order("created_at", { ascending: false });
  if (filter.phone) query = query.eq("phone", filter.phone);
  return check(await query, "listTickets").map(toTicket);
}

// --- row mappers -------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const date = (v: any) => (v ? new Date(v) : null);

function toConversation(r: any): Conversation {
  return {
    id: r.id,
    phone: r.phone,
    channel: r.channel,
    state: r.state,
    questionsAsked: r.questions_asked,
    ticketId: r.ticket_id,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function toMessage(r: any): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    sender: r.sender,
    body: r.body,
    mediaUrl: r.media_url,
    createdAt: new Date(r.created_at),
  };
}

function toTicket(r: any): Ticket {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    phone: r.phone,
    agencyId: r.agency_id,
    category: r.category,
    subcategory: r.subcategory,
    summary: r.summary,
    suggestedAction: r.suggested_action,
    locationText: r.location_text,
    lat: r.lat,
    lng: r.lng,
    hazardType: r.hazard_type,
    peopleInvolved: r.people_involved,
    priority: r.priority,
    priorityReason: r.priority_reason,
    isEmergency: r.is_emergency,
    credibility: r.credibility,
    credibilityReason: r.credibility_reason,
    photoUrl: r.photo_url,
    duplicateOf: r.duplicate_of,
    reportCount: r.report_count,
    priorityScore: r.priority_score,
    analyzedAt: date(r.analyzed_at),
    status: r.status,
    publishedAt: date(r.published_at),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
