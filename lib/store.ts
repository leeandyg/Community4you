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

export type IncidentStatus = "active" | "confirmed" | "resolved";

export interface Incident {
  id: number;
  agencyId: string;
  category: Category;
  title: string;
  summary: string;
  locationText: string | null;
  lat: number | null;
  lng: number | null;
  priority: Priority;
  priorityReason: string;
  priorityScore: number;
  status: IncidentStatus;
  reportCount: number;
  firstReportedAt: Date;
  lastReportedAt: Date;
  alertMessage: string | null;
  alertPublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IncidentFields = Pick<
  Incident,
  "agencyId" | "category" | "title" | "summary" | "locationText" | "priority" | "priorityReason" | "priorityScore" | "reportCount"
>;

export interface Ticket {
  id: number;
  conversationId: string;
  phone: string;
  agencyId: string;
  incidentId: number | null;
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

// Whether this number has ever talked to the bot (used by the SMS join keyword).
export async function hasConversation(phone: string): Promise<boolean> {
  const { count, error } = await db()
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone);
  if (error) throw new Error(`[store] hasConversation: ${error.message}`);
  return (count ?? 0) > 0;
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

// Open incidents with a report in the window, most recently active first.
export async function listOpenIncidents(withinMs: number, limit: number): Promise<Incident[]> {
  const rows = check(
    await db()
      .from("incidents")
      .select("*")
      .in("status", ["active", "confirmed"])
      .gte("last_reported_at", new Date(Date.now() - withinMs).toISOString())
      .order("last_reported_at", { ascending: false })
      .limit(limit),
    "listOpenIncidents",
  );
  return rows.map(toIncident);
}

export async function getIncident(id: number): Promise<Incident | null> {
  const row = check(await db().from("incidents").select("*").eq("id", id).maybeSingle(), "getIncident");
  return row ? toIncident(row) : null;
}

function incidentRow(fields: Partial<IncidentFields>): Record<string, unknown> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.agencyId !== undefined) row.agency_id = fields.agencyId;
  if (fields.category !== undefined) row.category = fields.category;
  if (fields.title !== undefined) row.title = fields.title;
  if (fields.summary !== undefined) row.summary = fields.summary;
  if (fields.locationText !== undefined) row.location_text = fields.locationText;
  if (fields.priority !== undefined) row.priority = fields.priority;
  if (fields.priorityReason !== undefined) row.priority_reason = fields.priorityReason;
  if (fields.priorityScore !== undefined) row.priority_score = fields.priorityScore;
  if (fields.reportCount !== undefined) row.report_count = fields.reportCount;
  return row;
}

export async function createIncident(fields: IncidentFields): Promise<Incident> {
  const row = check(await db().from("incidents").insert(incidentRow(fields)).select().single(), "createIncident");
  return toIncident(row);
}

// A new report bumps last_reported_at; pass reported=false for edits that aren't a new report.
export async function updateIncident(id: number, fields: Partial<IncidentFields>, reported = true): Promise<Incident> {
  const row = incidentRow(fields);
  if (reported) row.last_reported_at = row.updated_at;
  const updated = check(await db().from("incidents").update(row).eq("id", id).select().single(), "updateIncident");
  return toIncident(updated);
}

export async function linkTicketToIncident(ticketId: number, incidentId: number): Promise<void> {
  check(
    await db()
      .from("tickets")
      .update({ incident_id: incidentId, analyzed_at: new Date().toISOString() })
      .eq("id", ticketId),
    "linkTicketToIncident",
  );
}

export async function setIncidentStatus(id: number, status: IncidentStatus): Promise<Incident | null> {
  const row = check(
    await db()
      .from("incidents")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle(),
    "setIncidentStatus",
  );
  return row ? toIncident(row) : null;
}

export async function setTicketStatus(id: number, status: TicketStatus): Promise<Ticket | null> {
  const row = check(
    await db()
      .from("tickets")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle(),
    "setTicketStatus",
  );
  return row ? toTicket(row) : null;
}

// An agency overrides the AI's spam/suspicious flag.
export async function markTicketCredible(id: number, priorityScore: number): Promise<Ticket | null> {
  const row = check(
    await db()
      .from("tickets")
      .update({ credibility: "ok", credibility_reason: null, priority_score: priorityScore, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle(),
    "markTicketCredible",
  );
  return row ? toTicket(row) : null;
}

export async function listIncidentTickets(incidentId: number): Promise<Ticket[]> {
  const rows = check(
    await db().from("tickets").select("*").eq("incident_id", incidentId).order("created_at"),
    "listIncidentTickets",
  );
  return rows.map(toTicket);
}

// Moves an incident's reports forward (never backward), e.g. new -> in_progress on confirm.
export async function advanceIncidentTickets(incidentId: number, from: TicketStatus[], to: TicketStatus): Promise<void> {
  check(
    await db()
      .from("tickets")
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq("incident_id", incidentId)
      .in("status", from),
    "advanceIncidentTickets",
  );
}

export async function listIncidents(filter: { agencyId?: string; statuses?: IncidentStatus[] } = {}): Promise<Incident[]> {
  let query = db().from("incidents").select("*").order("priority_score", { ascending: false }).order("last_reported_at", { ascending: false });
  if (filter.agencyId) query = query.eq("agency_id", filter.agencyId);
  if (filter.statuses) query = query.in("status", filter.statuses);
  return check(await query, "listIncidents").map(toIncident);
}

// Ticket counts for the stats row. flagged = credibility other than ok.
export async function countTickets(filter: { sinceMs: number; agencyId?: string; flagged?: boolean }): Promise<number> {
  let query = db()
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - filter.sinceMs).toISOString());
  if (filter.agencyId) query = query.eq("agency_id", filter.agencyId);
  if (filter.flagged) query = query.neq("credibility", "ok");
  const { count, error } = await query;
  if (error) throw new Error(`[store] countTickets: ${error.message}`);
  return count ?? 0;
}

export async function listAgencies(): Promise<{ id: string; name: string }[]> {
  return check(await db().from("agencies").select("id, name").order("name"), "listAgencies");
}

// Public alerts feed: incidents an agency published (Publish alert add-on).
// Only safe, public fields: no phone numbers or conversations.
export interface PublicAlert {
  id: number;
  category: Category;
  title: string;
  alertMessage: string | null;
  locationText: string | null;
  priority: Priority;
  status: IncidentStatus;
  reportCount: number;
  alertPublishedAt: Date;
}

export async function listPublicAlerts(): Promise<PublicAlert[]> {
  const rows = check(
    await db()
      .from("incidents")
      .select("id, category, title, alert_message, location_text, priority, status, report_count, alert_published_at")
      .not("alert_published_at", "is", null)
      .order("alert_published_at", { ascending: false }),
    "listPublicAlerts",
  ) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    alertMessage: r.alert_message,
    locationText: r.location_text,
    priority: r.priority,
    status: r.status,
    reportCount: r.report_count,
    alertPublishedAt: new Date(r.alert_published_at),
  }));
}

// Display name from the agencies table (names may be edited to official ones).
// Cached for a minute: it's read on most replies and rarely changes.
const AGENCY_NAME_TTL_MS = 60 * 1000;
let agencyNames: { at: number; names: Map<string, string> } | null = null;
export async function getAgencyName(id: string): Promise<string> {
  if (!agencyNames || Date.now() - agencyNames.at > AGENCY_NAME_TTL_MS) {
    const rows = check(await db().from("agencies").select("id, name"), "getAgencyName") as { id: string; name: string }[];
    agencyNames = { at: Date.now(), names: new Map(rows.map((r) => [r.id, r.name])) };
  }
  return agencyNames.names.get(id) ?? id;
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
    incidentId: r.incident_id,
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
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function toIncident(r: any): Incident {
  return {
    id: r.id,
    agencyId: r.agency_id,
    category: r.category,
    title: r.title,
    summary: r.summary,
    locationText: r.location_text,
    lat: r.lat,
    lng: r.lng,
    priority: r.priority,
    priorityReason: r.priority_reason,
    priorityScore: r.priority_score,
    status: r.status,
    reportCount: r.report_count,
    firstReportedAt: new Date(r.first_reported_at),
    lastReportedAt: new Date(r.last_reported_at),
    alertMessage: r.alert_message,
    alertPublishedAt: date(r.alert_published_at),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}
