import { z } from "zod";
import { FLASH_MODEL, generateJson, LITE_MODEL } from "./gemini";
import { notifyReporter } from "./notify";
import { agencyFor } from "./routing";
import { incidentScore } from "./scoring";
import {
  createIncident,
  getAgencyName,
  getIncident,
  getTicket,
  linkTicketToIncident,
  listMessages,
  listOpenIncidents,
  setTicketStatus,
  updateIncident,
  type Incident,
  type Ticket,
} from "./store";
import { PRIORITIES } from "./triage";

// Cross-ticket analysis: attach a submitted report to the open incident it
// describes (or start a new one), keep the incident's merged summary current,
// and re-prioritize it with corroboration in mind. Runs in the background
// after the resident's reply has gone out, so it can use the slower model.

const WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_CANDIDATES = 20;
// Flash-Lite handled matching well in testing, and free-tier Flash is capped at
// 20 requests/day (plus frequent 503s), so Lite leads and Flash is the backup.
const MODELS = [process.env.ANALYSIS_MODEL ?? LITE_MODEL, FLASH_MODEL];

const AnalysisSchema = z.object({
  matched_incident_id: z.number().nullable().describe("Id of the open incident this report belongs to, or null if it is new"),
  match_reason: z.string().describe("One sentence on why it matches or why it is new"),
  title: z.string().describe("'<problem> at <location>', under 80 characters"),
  summary: z.string().describe("1-3 sentences merging everything known from all reports"),
  location_text: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  priority_reason: z.string(),
});

const SYSTEM_PROMPT = `You are the incident analyst for Community4You, a service where Los Angeles residents text in neighborhood problems. You get one new report and the list of open incidents (real-world events already being tracked). Decide whether the new report describes the same real-world event as one of the open incidents, then write the incident record as it should read now.

Same incident: the same physical problem at the same place, even with different wording, language, spelling, or a landmark instead of a cross street; or a clear update to it ("the fire spread to the building"). Different incident: the same kind of problem somewhere else, or a different problem at the same place (a pothole and a broken streetlight on one corner are two incidents). If unsure, do not match.

Incident record:
- title: "<problem> at <location>".
- summary: merge what all reports say into 1-3 sentences: what is happening, where, hazards, who is at risk, and what has changed. Note conflicting details. Never invent details.
- priority: judge the incident as a whole: how severe the hazard is, how urgent the reports sound, whether vulnerable people are involved (children, elderly, unhoused, disabled), whether it is getting worse, and corroboration. Several independent reports make an incident more certain and usually more urgent. Don't raise a single report, or one flagged suspicious, above its own priority. CRITICAL only for immediate risk to life.
- priority_reason: one sentence; mention corroboration when it matters.`;

export interface AnalysisOutcome {
  incident: Incident;
  joinedExisting: boolean;
  reason: string;
}

export async function analyzeTicket(ticketId: number): Promise<AnalysisOutcome | null> {
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.credibility === "spam") return null;

  // A follow-up to a report that already has an incident only updates that incident.
  const current = ticket.incidentId != null ? await getIncident(ticket.incidentId) : null;
  const [candidates, messages] = await Promise.all([
    current ? [current] : listOpenIncidents(WINDOW_MS, MAX_CANDIDATES),
    listMessages(ticket.conversationId),
  ]);
  const residentWords = messages.filter((m) => m.sender === "reporter").map((m) => m.body);

  const result = await generateJson({
    label: "analyze",
    models: MODELS,
    schema: AnalysisSchema,
    system: SYSTEM_PROMPT,
    contents: describe(ticket, residentWords, candidates, current),
    timeoutMs: 20_000,
  });

  // An already-linked report stays with its incident; otherwise only accept a
  // match the model picked from the candidate list.
  const matched =
    current ?? (result?.matched_incident_id != null ? candidates.find((i) => i.id === result.matched_incident_id) ?? null : null);
  const reportCount = matched ? (current ? matched.reportCount : matched.reportCount + 1) : 1;
  // An emergency report always makes its incident CRITICAL.
  const priority = ticket.isEmergency ? "CRITICAL" : (result?.priority ?? matched?.priority ?? ticket.priority);

  const fields = {
    title: result?.title ?? matched?.title ?? `${capitalize(ticket.subcategory)}${ticket.locationText ? ` at ${ticket.locationText}` : ""}`,
    summary: result?.summary ?? matched?.summary ?? ticket.summary,
    locationText: result?.location_text ?? matched?.locationText ?? ticket.locationText,
    priority,
    priorityReason: result?.priority_reason ?? matched?.priorityReason ?? ticket.priorityReason,
    priorityScore: incidentScore(priority, reportCount),
    reportCount,
  };

  const incident = matched
    ? await updateIncident(matched.id, fields)
    : await createIncident({ ...fields, category: ticket.category, agencyId: agencyFor(ticket.category).id });
  await linkTicketToIncident(ticket.id, incident.id);

  const joinedExisting = Boolean(matched && !current);
  if (joinedExisting) {
    let text = `Others have reported this too. We've added your report to incident #${incident.id} so responders see the full picture.`;
    // Already verified by an agency: say who is on it, and start this report like the others.
    if (incident.status === "confirmed") {
      const agency = await getAgencyName(incident.agencyId);
      text = `Others have reported this too, and ${agency} is already responding. We've added your report to incident #${incident.id}.`;
      await setTicketStatus(ticket.id, "in_progress");
    }
    await notifyReporter(ticket.conversationId, ticket.phone, text);
  }
  return { incident, joinedExisting, reason: result?.match_reason ?? "analysis unavailable; kept existing grouping" };
}

function describe(ticket: Ticket, residentWords: string[], candidates: Incident[], current: Incident | null): string {
  const minutesAgo = (d: Date) => Math.round((Date.now() - d.getTime()) / 60_000);
  const report = {
    ticket: ticket.id,
    category: ticket.category,
    problem: ticket.subcategory,
    summary: ticket.summary,
    location: ticket.locationText,
    hazard: ticket.hazardType,
    people_involved: ticket.peopleInvolved,
    priority: ticket.priority,
    emergency: ticket.isEmergency,
    credibility: ticket.credibility,
    resident_said: residentWords,
  };
  const open = candidates.map((i) => ({
    id: i.id,
    category: i.category,
    title: i.title,
    summary: i.summary,
    location: i.locationText,
    priority: i.priority,
    status: i.status,
    reports: i.reportCount,
    last_report_minutes_ago: minutesAgo(i.lastReportedAt),
  }));
  const note = current
    ? `\nThis report is already part of incident ${current.id} and has new details. Set matched_incident_id to ${current.id} and update the record.`
    : "";
  return `New report:\n${JSON.stringify(report, null, 1)}\n\nOpen incidents:\n${open.length ? JSON.stringify(open, null, 1) : "(none)"}${note}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
