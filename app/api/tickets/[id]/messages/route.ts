import { NextRequest, NextResponse } from "next/server";
import { addMessage, getTicket } from "@/lib/store";
import { sendGatewaySms } from "@/lib/smsgate";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const ticket = await getTicket(Number(id));
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404, headers: cors });
    const { body } = await request.json();
    if (!body?.trim()) return NextResponse.json({ error: "Message is required" }, { status: 400, headers: cors });
    const message = await addMessage(ticket.conversationId, "agency", body.trim());
    if (!ticket.phone.startsWith("web:")) await sendGatewaySms(ticket.phone, body.trim());
    return NextResponse.json({ message }, { headers: cors });
  } catch (error) {
    console.error("[agency message]", error);
    return NextResponse.json({ error: "Could not send message" }, { status: 500, headers: cors });
  }
}
