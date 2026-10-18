// CORS + JSON helpers for routes the dashboard (a separate Vite app) calls.
// DASHBOARD_ORIGINS is a comma-separated allowlist; unset allows any origin.

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (process.env.DASHBOARD_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

// Route ids are numeric; returns null for anything else.
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
