import { json, preflight } from "@/lib/http";
import { getInsights } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dashboard stats row + AI shift briefing.
//   GET /api/insights                  all agencies
//   GET /api/insights?agency=streets   one agency ("Viewing as")
//   GET /api/insights?summary=false    skip the AI briefing (cheap refresh)
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const insights = await getInsights({
    agencyId: params.get("agency") || undefined,
    withSummary: params.get("summary") !== "false",
  });
  return json(req, insights);
}

export const OPTIONS = preflight;
