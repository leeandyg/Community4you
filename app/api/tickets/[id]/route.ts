import { NextRequest, NextResponse } from "next/server";
import { agencyFor } from "@/lib/routing";
import { addMessage, getTicket, setTicketPublished, updateTicketStatus, type TicketStatus } from "@/lib/store";
import { sendGatewaySms } from "@/lib/smsgate";

const allowed = new Set<TicketStatus>(["new", "in_progress", "resolved"]);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "PATCH,OPTIONS" };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    const body = await request.json();
    let ticket = await getTicket(id);
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404, headers: cors });
    if (typeof body.published === "boolean") ticket = await setTicketPublished(id, body.published);
    if (body.status) {
      if (!allowed.has(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400, headers: cors });
      ticket = await updateTicketStatus(id, body.status);
      const agency = agencyFor(ticket.category);
      const label = body.status === "resolved" ? "resolved" : body.status === "in_progress" ? "being reviewed" : "received";
      const message = `Update on #${ticket.id}: ${agency.name} marked your report as ${label}.`;
      await addMessage(ticket.conversationId, "agency", message);
      if (!ticket.phone.startsWith("web:")) await sendGatewaySms(ticket.phone, message);
    }
    return NextResponse.json({ ticket }, { headers: cors });
  } catch (error) {
    console.error("[ticket patch]", error);
    return NextResponse.json({ error: "Could not update ticket" }, { status: 500, headers: cors });
  }
}
