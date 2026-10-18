import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

// Shared Gemini JSON call: tries each model once, in order, and returns the
// first response that parses against the Zod schema, or null if none do.

export const LITE_MODEL = "gemini-3.5-flash-lite";
export const FLASH_MODEL = "gemini-3.8-flash";

// Created lazily so a missing API key doesn't crash the server at import time.
// One attempt per model; callers choose the order and the per-call timeout.
let client: GoogleGenAI | null = null;
const getClient = () =>
  (client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { retryOptions: { attempts: 1 } },
  }));

// Flash rejects MINIMAL thinking; Flash-Lite supports it and is fastest there.
const thinkingLevelFor = (model: string) => (model.includes("lite") ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW);

export interface JsonRequest<T extends z.ZodType> {
  label: string; // for logs, e.g. "triage"
  models: string[];
  schema: T;
  system: string;
  contents: string;
  timeoutMs?: number; // Gemini's minimum is 10s
}

export async function generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T> | null> {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(req.schema);
  delete jsonSchema.$schema; // Gemini takes plain JSON Schema

  for (const model of req.models) {
    try {
      const response = await getClient().models.generateContent({
        model,
        contents: req.contents,
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          thinkingConfig: { thinkingLevel: thinkingLevelFor(model) },
          httpOptions: { timeout: Math.max(req.timeoutMs ?? 10_000, 10_000) },
        },
      });
      if (!response.text) {
        console.warn(`[${req.label}] ${model} empty response:`, response.promptFeedback ?? response.candidates?.[0]?.finishReason);
        continue;
      }
      const parsed = req.schema.safeParse(JSON.parse(response.text));
      if (parsed.success) return parsed.data;
      console.warn(`[${req.label}] ${model} response didn't match schema:`, parsed.error.message);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error(`[${req.label}] ${model} API error ${err.status}:`, err.message);
      } else {
        console.error(`[${req.label}] ${model} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return null;
}
