import { handleMessage } from "@/lib/engine";

export const runtime = "nodejs";

// Web reporting channel (and demo fallback): same engine as SMS, JSON in/out.
// Body: { sessionId: string, body: string }
export async function POST(req: Request) {
  const { sessionId, body } = (await req.json()) as { sessionId?: string; body?: string };
  if (!sessionId || !body?.trim()) {
    return Response.json({ error: "sessionId and body are required" }, { status: 400 });
  }
  const result = await handleMessage({ channel: "web", from: `web:${sessionId}`, body });
  return Response.json(result);
}
