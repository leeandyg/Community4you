import type { Category } from "./triage";

export interface Agency {
  id: string;
  name: string;
  categories: Category[];
}

// Mock jurisdictions: one agency per category bucket.
export const AGENCIES: Agency[] = [
  { id: "streets", name: "LA Streets & 311", categories: ["INFRASTRUCTURE"] },
  { id: "police", name: "LAPD Non-Emergency", categories: ["PUBLIC_SAFETY"] },
  { id: "sanitation", name: "LA Sanitation & Environment", categories: ["ENVIRONMENTAL"] },
  { id: "outreach", name: "Community Food & Shelter Network", categories: ["HUMAN_SERVICES"] },
  { id: "animals", name: "LA Animal Services", categories: ["ANIMAL_CONTROL"] },
];

export function agencyFor(category: Category): Agency {
  return AGENCIES.find((a) => a.categories.includes(category)) ?? AGENCIES[0];
}
