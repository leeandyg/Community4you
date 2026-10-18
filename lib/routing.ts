import type { Category } from "./triage";

// Each category goes to exactly one (mock) agency. Only the stable ids live
// here; display names come from the agencies table (store.getAgencyName), so
// they can be changed to official names without a code change.
const AGENCY_BY_CATEGORY: Record<Category, string> = {
  INFRASTRUCTURE: "streets",
  PUBLIC_SAFETY: "police",
  ENVIRONMENTAL: "sanitation",
  HUMAN_SERVICES: "outreach",
  ANIMAL_CONTROL: "animals",
};

export function agencyIdFor(category: Category): string {
  return AGENCY_BY_CATEGORY[category];
}
