import { notifyReporter } from "./notify";
import {
  advanceIncidentTickets,
  getAgencyName,
  getTicket,
  listIncidentTickets,
  setIncidentStatus,
  setTicketStatus,
  type Incident,
  type Ticket,
} from "./store";

// What the dashboard's buttons do. Each change is saved, then texted to the
// affected residents.

export type IncidentAction = "confirmed" | "resolved";
export type TicketAction = "in_progress" | "resolved";

export async function changeIncidentStatus(
  id: number,
  status: IncidentAction,
): Promise<{ incident: Incident; notified: number } | null> {
  const incident = await setIncidentStatus(id, status);
  if (!incident) return null;
  // Read reports before moving them, so residents whose report was already
  // resolved on its own don't get a second text.
  const open = (await listIncidentTickets(id)).filter((t) => t.status !== "resolved");

  // Reports follow their incident forward: confirm starts work, resolve closes them.
  if (status === "confirmed") await advanceIncidentTickets(id, ["new"], "in_progress");
  else await advanceIncidentTickets(id, ["new", "in_progress"], "resolved");

  const agency = await getAgencyName(incident.agencyId);
  const message =
    status === "confirmed"
      ? `Update on incident #${id} (${incident.title}): ${agency} has confirmed it and is responding. Thanks for reporting!`
      : `Update on incident #${id} (${incident.title}): ${agency} marked it resolved. Thanks for reporting!`;

  // One text per resident, even if they sent several reports about it.
  const latestPerPhone = new Map<string, Ticket>();
  for (const t of open) latestPerPhone.set(t.phone, t);
  const results = await Promise.allSettled(
    [...latestPerPhone.values()].map((t) => notifyReporter(t.conversationId, t.phone, message, "agency")),
  );
  for (const r of results) if (r.status === "rejected") console.error("[actions] notify failed:", r.reason);
  return { incident, notified: results.filter((r) => r.status === "fulfilled").length };
}

export async function changeTicketStatus(id: number, status: TicketAction): Promise<Ticket | null> {
  const ticket = await setTicketStatus(id, status);
  if (!ticket) return null;
  const agency = await getAgencyName(ticket.agencyId);
  const message =
    status === "in_progress"
      ? `Update on report #${id}: ${agency} is on it.`
      : `Update on report #${id}: ${agency} marked it resolved. Thanks for reporting!`;
  await notifyReporter(ticket.conversationId, ticket.phone, message, "agency");
  return ticket;
}

export async function sendAgencyMessage(ticketId: number, body: string): Promise<Ticket | null> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;
  const agency = await getAgencyName(ticket.agencyId);
  await notifyReporter(ticket.conversationId, ticket.phone, `${agency}: ${body}`, "agency");
  return ticket;
}
