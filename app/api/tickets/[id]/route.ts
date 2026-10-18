import { after } from "next/server";
import { z } from "zod";
import { changeTicketStatus, clearTicketFlag } from "@/lib/actions";
import { analyzeTicket } from "@/lib/analyze";
import { json, parseId, preflight } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.union([
  z.object({ status: z.enum(["in_progress", "resolved"]) }),
  z.object({ credibility: z.literal("ok") }),
]);

// Dashboard: change one report's status (texts that resident), or mark a
// flagged report as credible ("Not spam"), which sends it to incident grouping.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id || !body.success) {
    return json(req, { error: 'Expected { "status": "in_progress" | "resolved" } or { "credibility": "ok" }' }, 400);
  }

  if ("credibility" in body.data) {
    const ticket = await clearTicketFlag(id);
    if (!ticket) return json(req, { error: `Ticket ${id} not found` }, 404);
    after(() => analyzeTicket(id).catch((err) => console.error("[tickets] analysis failed:", err)));
    return json(req, { ticket });
  }

  const ticket = await changeTicketStatus(id, body.data.status);
  if (!ticket) return json(req, { error: `Ticket ${id} not found` }, 404);
  return json(req, { ticket });
}

export const OPTIONS = preflight;
