import { z } from "zod";
import { changeTicketStatus } from "@/lib/actions";
import { json, parseId, preflight } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ status: z.enum(["in_progress", "resolved"]) });

// Dashboard: change one report's status. Texts that resident.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id || !body.success) return json(req, { error: 'Expected { "status": "in_progress" | "resolved" }' }, 400);

  const ticket = await changeTicketStatus(id, body.data.status);
  if (!ticket) return json(req, { error: `Ticket ${id} not found` }, 404);
  return json(req, { ticket });
}

export const OPTIONS = preflight;
