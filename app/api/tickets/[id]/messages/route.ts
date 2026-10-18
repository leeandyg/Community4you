import { z } from "zod";
import { sendAgencyMessage } from "@/lib/actions";
import { json, parseId, preflight } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ body: z.string().trim().min(1).max(500) });

// Dashboard: message the resident behind a report. Their reply joins the same conversation.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id || !body.success) return json(req, { error: 'Expected { "body": "<1-500 characters>" }' }, 400);

  const ticket = await sendAgencyMessage(id, body.data.body);
  if (!ticket) return json(req, { error: `Ticket ${id} not found` }, 404);
  return json(req, { ok: true });
}

export const OPTIONS = preflight;
