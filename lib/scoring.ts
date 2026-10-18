import type { Priority } from "./triage";

// Dashboard sort keys (see ARCHITECTURE.md). The AI decides the priority
// level using context; the score adds corroboration so that, within a level,
// incidents more people have reported rank higher.
export const BASE_SCORE: Record<Priority, number> = { CRITICAL: 100, HIGH: 70, MEDIUM: 40, LOW: 10 };

export function incidentScore(priority: Priority, reportCount: number): number {
  return BASE_SCORE[priority] + Math.min(10 * (reportCount - 1), 30);
}
