// Hardcoded life-threat intercept. Runs before (and independently of) the LLM,
// so a 911 prompt goes out even if the AI call is slow or fails.
const EMERGENCY_PATTERNS: RegExp[] = [
  /\bfire\b(?!\s*(hydrant|station|dept|department))/i,
  /\b(on fire|flames|smoke coming)\b/i,
  /\bguns?\b|\bgunshots?\b|\bshoot(ing|er)?\b|\bshots fired\b/i,
  /\bstab(bed|bing)?\b|\bknife\b/i,
  /\bunresponsive\b|\bnot breathing\b|\bpassed out\b|\bunconscious\b/i,
  /\boverdos(e|ed|ing)\b|\bheart attack\b|\bseizure\b/i,
  /\bdrowning\b|\bkidnap(ped|ping)?\b/i,
  /\bexplo(sion|sions|ded|ding)\b/i,
  /\b(live|sparking) (power )?wires?\b|\bsparks?\b/i,
];

export function detectEmergency(text: string): string | null {
  for (const pattern of EMERGENCY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}
