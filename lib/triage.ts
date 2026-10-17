import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

export const CATEGORIES = [
  "INFRASTRUCTURE",
  "PUBLIC_SAFETY",
  "ENVIRONMENTAL",
  "HUMAN_SERVICES",
  "ANIMAL_CONTROL",
] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];

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
});

export type TriageResult = z.infer<typeof TriageSchema>;

// Gemini takes plain JSON Schema; drop the $schema marker Zod adds.
const RESPONSE_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(TriageSchema);
delete RESPONSE_JSON_SCHEMA.$schema;

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

Clarifying question: pick the single missing detail that would most change how responders act. A usable location is required, so if there is none, ask for the nearest address or cross street. Otherwise ask about the most important safety detail (is the animal contained, are there sparks, is anyone hurt, is the road blocked) only if it is still unknown. If the report is actionable, set clarifying_question to null. Never re-ask something already answered. Keep it under 140 characters, friendly, plain text, no emoji, and in the same language the resident is writing in.

Base every field on what the resident actually said. Use null rather than guessing. Update the record using everything in the conversation, including the resident's latest answers.`;

// Created lazily so a missing API key doesn't crash the server at import time.
// Free-tier Flash often returns 503 "high demand" or stalls, so we lead with
// Flash-Lite (~1-2s) and give each model one short attempt.
let client: GoogleGenAI | null = null;
const getClient = () =>
  (client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: 10_000, retryOptions: { attempts: 1 } }, // 10s is Gemini's minimum deadline
  }));
const MODELS = [
  process.env.TRIAGE_MODEL ?? "gemini-3.5-flash-lite",
  process.env.TRIAGE_FALLBACK_MODEL ?? "gemini-3.8-flash",
];
// Flash rejects MINIMAL thinking; Flash-Lite supports it and is fastest there.
const thinkingLevelFor = (model: string) => (model.includes("lite") ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW);

function formatTranscript(lines: TranscriptLine[]): string {
  const label = { reporter: "Resident", bot: "Assistant", agency: "Agency" } as const;
  return lines.map((l) => `${label[l.sender]}: ${l.body}`).join("\n");
}

// Returns null when no model can produce a usable record (blocked, timeout,
// API error, invalid JSON); the engine falls back to a canned reply.
export async function triage(lines: TranscriptLine[]): Promise<TriageResult | null> {
  const contents = `Conversation so far:\n${formatTranscript(lines)}\n\nProduce the triage record.`;
  for (const model of MODELS) {
    const result = await triageWith(model, contents);
    if (result) return result;
  }
  return null;
}

async function triageWith(model: string, contents: string): Promise<TriageResult | null> {
  try {
    const response = await getClient().models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        thinkingConfig: { thinkingLevel: thinkingLevelFor(model) },
      },
    });

    if (!response.text) {
      console.warn(`[triage] ${model} empty response:`, response.promptFeedback ?? response.candidates?.[0]?.finishReason);
      return null;
    }
    const parsed = TriageSchema.safeParse(JSON.parse(response.text));
    if (!parsed.success) {
      console.warn(`[triage] ${model} response didn't match schema:`, parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`[triage] ${model} API error ${err.status}:`, err.message);
    } else {
      console.error(`[triage] ${model} failed:`, err instanceof Error ? err.message : err);
    }
    return null;
  }
}
