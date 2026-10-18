import { z } from "zod";
import { FLASH_MODEL, generateJson, LITE_MODEL } from "./gemini";

export const CATEGORIES = [
  "INFRASTRUCTURE",
  "PUBLIC_SAFETY",
  "ENVIRONMENTAL",
  "HUMAN_SERVICES",
  "ANIMAL_CONTROL",
] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const CREDIBILITY = ["ok", "suspicious", "spam"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Credibility = (typeof CREDIBILITY)[number];

export const TriageSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: z.string().describe("Short label, e.g. 'pothole', 'aggressive stray dog'"),
  summary: z.string().describe("One sentence for dispatchers, in English"),
  location_text: z
    .string()
    .nullable()
    .describe("Most specific location given, geocodable, e.g. '5th St & Main St, Los Angeles'"),
  hazard_type: z.string().nullable(),
  people_involved: z.number().nullable(),
  priority: z.enum(PRIORITIES),
  priority_reason: z.string(),
  emergency: z.boolean(),
  missing_fields: z.array(z.string()),
  clarifying_question: z.string().nullable(),
  credibility: z.enum(CREDIBILITY),
  credibility_reason: z.string().nullable().describe("Why it is suspicious or spam; null when ok"),
  suggested_action: z
    .string()
    .describe("One concrete next step for the responding agency, in English, under 120 characters"),
});

export type TriageResult = z.infer<typeof TriageSchema>;


export interface TranscriptLine {
  sender: "reporter" | "bot" | "agency";
  body: string;
}

const SYSTEM_PROMPT = `You are the intake assistant for Community4You, a service where Los Angeles residents text in neighborhood problems. Read the conversation and produce a structured triage record for the agency that will handle it.

Categories:
- INFRASTRUCTURE: potholes, broken streetlights or traffic signals, sidewalk damage, fallen trees, damaged signs, water main leaks, downed power lines.
- PUBLIC_SAFETY: non-emergency crime, suspicious activity, vandalism in progress, reckless driving, abandoned vehicles.
- ENVIRONMENTAL: illegal dumping, graffiti, overflowing trash, chemical spills, street flooding, odor or air complaints.
- HUMAN_SERVICES: a person who appears to need food, shelter, medical or mental-health outreach (not life-threatening).
- ANIMAL_CONTROL: stray, aggressive, injured or dead animals.

Priority:
- CRITICAL: immediate risk to life (fire, weapons, someone unresponsive, live or sparking power line). Also set emergency=true.
- HIGH: likely to cause injury or major damage soon (aggressive loose animal near people, large hole in a busy road, flooding across a street).
- MEDIUM: a real problem that needs attention within days.
- LOW: cosmetic or minor.

Clarifying question: ask for the single missing detail that would most change how responders act.
1. A usable location comes first: if there is no address, cross street or landmark, ask for the nearest one.
2. Once the location is known, ask for the key detail for the category if the resident hasn't given it:
   - ANIMAL_CONTROL: is the animal aggressive, injured or contained, and is it near people or children?
   - INFRASTRUCTURE: is it blocking traffic or a lane, and is there a hazard like sparks, flooding or a large hole?
   - PUBLIC_SAFETY: is it happening right now, and is anyone hurt?
   - ENVIRONMENTAL: how much is there, is it hazardous, and is it blocking a street or sidewalk?
   - HUMAN_SERVICES: is the person okay or needing medical help, and what do they need (food, shelter, a check-in)?
   Ask only about the parts that are still unknown, in one short, natural question (e.g. "Is the dog acting aggressive, and are there people nearby?").
3. Set clarifying_question to null only when the location and the key detail are both known.
Never re-ask something already answered. Keep it under 140 characters, friendly, plain text, no emoji, and in the same language the resident is writing in.

Credibility:
- spam: no real problem is being reported: test messages, jokes, gibberish, ads, insults, or obviously impossible events.
- suspicious: a plausible problem but with signs it may not be genuine: contradictory details, exaggeration that doesn't fit the rest, or a copy-paste style message.
- ok: everything else. Vague, short, misspelled, upset or non-English reports are ok; they just need follow-up questions. When unsure, choose ok.
Give credibility_reason only for suspicious or spam.

Suggested action: one concrete next step for the agency (who to send, what to do first, any safety precaution), based only on what is known.

Base every field on what the resident actually said. Use null rather than guessing. Update the record using everything in the conversation, including the resident's latest answers.`;

// The resident is waiting on this reply, so lead with Flash-Lite (~1-2s);
// free-tier Flash often returns 503 "high demand" or stalls.
const MODELS = [
  process.env.TRIAGE_MODEL ?? LITE_MODEL,
  process.env.TRIAGE_FALLBACK_MODEL ?? FLASH_MODEL,
];

function formatTranscript(lines: TranscriptLine[]): string {
  const label = { reporter: "Resident", bot: "Assistant", agency: "Agency" } as const;
  return lines.map((l) => `${label[l.sender]}: ${l.body}`).join("\n");
}

// Returns null when no model can produce a usable record (blocked, timeout,
// API error, invalid JSON); the engine falls back to a canned reply.
export function triage(lines: TranscriptLine[]): Promise<TriageResult | null> {
  return generateJson({
    label: "triage",
    models: MODELS,
    schema: TriageSchema,
    system: SYSTEM_PROMPT,
    contents: `Conversation so far:\n${formatTranscript(lines)}\n\nProduce the triage record.`,
  });
}
