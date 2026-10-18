import { z } from "zod";
import { FLASH_MODEL, generateJson, LITE_MODEL } from "./gemini";
import { countTickets, listAgencies, listIncidents, type Incident } from "./store";
import { CATEGORIES, PRIORITIES } from "./triage";

// Dashboard stats (plain queries) plus an AI shift briefing. The briefing is
// cached per agency and only regenerated when the data changed and the cached
// one is over a minute old, so dashboard refreshes don't spend AI calls.

const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_MIN_AGE_MS = 60 * 1000;
const MAX_IN_LISTS = 5;

export interface IncidentBrief {
  id: number;
  title: string;
  priority: Incident["priority"];
  status: Incident["status"];
  reportCount: number;
  priorityScore: number;
  lastReportedAt: string;
}

export interface Insights {
  generatedAt: string;
  agencyId: string | null;
  counts: {
    openIncidents: number;
    byPriority: Record<string, number>;
    byCategory: Record<string, number>;
    byStatus: { active: number; confirmed: number };
    byAgency: { agencyId: string; name: string; open: number }[];
    reportsLast24h: number;
    flaggedLast24h: number;
    resolvedLast24h: number;
  };
  needsAttention: IncidentBrief[]; // unconfirmed, highest score first
  hotspots: IncidentBrief[]; // open incidents with 2+ reports
  summary: string | null;
  summaryGeneratedAt: string | null;
}

export async function getInsights(opts: { agencyId?: string; withSummary?: boolean } = {}): Promise<Insights> {
  const agencyId = opts.agencyId;
  const [incidents, agencies, reportsLast24h, flaggedLast24h] = await Promise.all([
    listIncidents({ agencyId }),
    listAgencies(),
    countTickets({ sinceMs: DAY_MS, agencyId }),
    countTickets({ sinceMs: DAY_MS, agencyId, flagged: true }),
  ]);
  const open = incidents.filter((i) => i.status !== "resolved");
  const resolvedLast24h = incidents.filter(
    (i) => i.status === "resolved" && Date.now() - i.updatedAt.getTime() < DAY_MS,
  ).length;

  const tally = <K extends string>(keys: readonly K[], pick: (i: Incident) => string) =>
    Object.fromEntries(keys.map((k) => [k, open.filter((i) => pick(i) === k).length])) as Record<K, number>;

  const insights: Insights = {
    generatedAt: new Date().toISOString(),
    agencyId: agencyId ?? null,
    counts: {
      openIncidents: open.length,
      byPriority: tally(PRIORITIES, (i) => i.priority),
      byCategory: tally(CATEGORIES, (i) => i.category),
      byStatus: tally(["active", "confirmed"] as const, (i) => i.status),
      byAgency: agencies
        .filter((a) => !agencyId || a.id === agencyId)
        .map((a) => ({ agencyId: a.id, name: a.name, open: open.filter((i) => i.agencyId === a.id).length })),
      reportsLast24h,
      flaggedLast24h,
      resolvedLast24h,
    },
    // incidents come back sorted by priority_score, then most recent report
    needsAttention: open.filter((i) => i.status === "active").slice(0, MAX_IN_LISTS).map(brief),
    hotspots: open
      .filter((i) => i.reportCount >= 2)
      .sort((a, b) => b.reportCount - a.reportCount)
      .slice(0, MAX_IN_LISTS)
      .map(brief),
    summary: null,
    summaryGeneratedAt: null,
  };

  if (opts.withSummary !== false) {
    const agencyName = agencyId ? agencies.find((a) => a.id === agencyId)?.name ?? agencyId : null;
    const cached = await shiftSummary(agencyId ?? "all", agencyName, open, insights.counts);
    insights.summary = cached?.text ?? null;
    insights.summaryGeneratedAt = cached?.at.toISOString() ?? null;
  }
  return insights;
}

function brief(i: Incident): IncidentBrief {
  return {
    id: i.id,
    title: i.title,
    priority: i.priority,
    status: i.status,
    reportCount: i.reportCount,
    priorityScore: i.priorityScore,
    lastReportedAt: i.lastReportedAt.toISOString(),
  };
}

// --- AI shift briefing ---------------------------------------------------------

const SummarySchema = z.object({ summary: z.string() });

const SUMMARY_PROMPT = `You write the shift briefing for dispatchers on a Los Angeles community-report dashboard. You get the open incidents (each may combine several resident reports) and a few counts.

Write 2-4 short sentences of plain text, no lists or markdown:
1. What needs action first: CRITICAL or HIGH incidents, especially ones not yet confirmed or still getting new reports. Name them with their id, like "#1003".
2. Clusters: incidents several residents reported, or several incidents of one kind in one area.
3. One line on overall load if useful (e.g. most open incidents are low priority).
Only use the data given. If there are no open incidents, say so in one sentence.`;

interface CachedSummary {
  fingerprint: string;
  text: string;
  at: Date;
}
const g = globalThis as unknown as { __c4ySummaries?: Map<string, CachedSummary> };
const summaryCache = (g.__c4ySummaries ??= new Map());

async function shiftSummary(
  key: string,
  agencyName: string | null,
  open: Incident[],
  counts: Insights["counts"],
): Promise<CachedSummary | null> {
  const fingerprint = open.map((i) => `${i.id}:${i.updatedAt.getTime()}:${i.status}`).join("|");
  const cached = summaryCache.get(key);
  if (cached && (cached.fingerprint === fingerprint || Date.now() - cached.at.getTime() < SUMMARY_MIN_AGE_MS)) {
    return cached;
  }

  const minutesAgo = (d: Date) => Math.round((Date.now() - d.getTime()) / 60_000);
  const data = {
    scope: agencyName ?? "all agencies",
    counts: {
      open_incidents: counts.openIncidents,
      by_priority: counts.byPriority,
      reports_last_24h: counts.reportsLast24h,
      flagged_last_24h: counts.flaggedLast24h,
    },
    open_incidents: open.slice(0, 25).map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary,
      priority: i.priority,
      status: i.status,
      reports: i.reportCount,
      last_report_minutes_ago: minutesAgo(i.lastReportedAt),
    })),
  };
  const result = await generateJson({
    label: "insights",
    models: [LITE_MODEL, FLASH_MODEL],
    schema: SummarySchema,
    system: SUMMARY_PROMPT,
    contents: JSON.stringify(data, null, 1),
  });
  if (!result) return cached ?? null; // keep showing the last good briefing

  const fresh = { fingerprint, text: result.summary, at: new Date() };
  summaryCache.set(key, fresh);
  return fresh;
}
