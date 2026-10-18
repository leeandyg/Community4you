import { z } from "zod";
import { changeIncidentStatus } from "@/lib/actions";
import { json, parseId, preflight } from "@/lib/http";

export const runtime = "nodejs";

const Body = z.object({ status: z.enum(["confirmed", "resolved"]) });

// Dashboard: Confirm / Resolve an incident. Texts every resident who reported it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id || !body.success) return json(req, { error: 'Expected { "status": "confirmed" | "resolved" }' }, 400);

  const result = await changeIncidentStatus(id, body.data.status);
  if (!result) return json(req, { error: `Incident ${id} not found` }, 404);
  return json(req, result);
}

export const OPTIONS = preflight;
