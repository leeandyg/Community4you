import { z } from "zod";
import { FLASH_MODEL, generateJson, LITE_MODEL } from "./gemini";
import type { Message, Ticket } from "./store";

// After a report is submitted (or answered as spam), a resident's next text could be more detail
// about it, a different problem, or just "thanks". One small Flash-Lite call
// tells them apart so a new problem isn't merged into the old report.

export type FollowUpKind = "more_info" | "new_problem" | "other";

const FollowUpSchema = z.object({
  kind: z.enum(["more_info", "new_problem", "other"]),
  reason: z.string(),
});

const SYSTEM_PROMPT = `A resident already sent a neighborhood problem report over SMS (it may have been judged spam). Classify their latest text:
- more_info: details, corrections or updates about the SAME problem ("it got bigger", "the dog is in the park now"), or an answer to a question from the assistant or agency.
- new_problem: a different problem, or the same kind of problem at a different place.
- other: thanks, ok, emoji, greetings, or questions with no report content.
When unsure between more_info and new_problem, choose more_info.`;

export async function classifyFollowUp(ticket: Ticket, recent: Message[], latest: string): Promise<FollowUpKind> {
  const label = { reporter: "Resident", bot: "Assistant", agency: "Agency" } as const;
  const contents =
    `Submitted report: ${ticket.summary} (location: ${ticket.locationText ?? "unknown"})\n\n` +
    `Recent messages:\n${recent.slice(-4).map((m) => `${label[m.sender]}: ${m.body}`).join("\n")}\n\n` +
    `Latest text from the resident: ${latest}`;
  const result = await generateJson({
    label: "followup",
    models: [LITE_MODEL, FLASH_MODEL],
    schema: FollowUpSchema,
    system: SYSTEM_PROMPT,
    contents,
  });
  return result?.kind ?? "more_info"; // on failure keep the old behavior: add it to the report
}
