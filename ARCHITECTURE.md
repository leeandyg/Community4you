# Architecture Plan — SMS Community Triage (TrojanHacks '26)

## Context
`blueprint.md` describes a "centralized community triage" app: residents text a description of a local problem, an AI asks follow-up questions, structures the report and routes it, and agencies triage it on a live dashboard. The stack in the blueprint (Node or Firebase, OpenAI, Lambda/Render) was only brainstorming. This plan picks a well-established stack that a small team can ship in 24 hours. SMS is the main way residents report and communicate. The repo is empty except for `blueprint.md`, so everything below is new.

**Guiding principle:** one deployable app, one database, one LLM call per inbound message, and a conversation engine that doesn't care whether a message arrived by SMS or the web.

---

## Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js 15 (App Router, TypeScript)** | Dashboard UI and API routes (the Twilio webhook) in one repo and one deploy. AI tools are very fluent in it. |
| Hosting | **Vercel** | Push-to-deploy with a stable HTTPS URL for the Twilio webhook, so ngrok is only needed for local dev. |
| Database + realtime | **Supabase** (Postgres + Realtime) | Same "dashboard updates live" benefit as Firestore, but SQL makes the analytics (counts by category or priority) trivial and the data relational (tickets ↔ messages ↔ agencies). Free tier. |
| SMS | **Twilio Programmable Messaging** | Inbound webhook plus outbound REST API. MMS photos come in as `MediaUrl0`. |
| LLM | **Claude (Anthropic TS SDK)**: `claude-haiku-5-5` for speed, or `claude-sonnet-5-5` if quality is lacking | Tool use with a strict JSON schema gives typed structured output. Haiku keeps the webhook well under Twilio's 15s timeout. (Swappable for OpenAI if the hackathon gives credits; only `lib/triage.ts` changes.) |
| Validation | **Zod** | Validates the LLM JSON before writing to the DB. |
| UI | **Tailwind + shadcn/ui** | Fast, good-looking components (cards, badges, dialogs, tabs). |
| Charts | **Recharts** (via shadcn charts) | "Reports by category" and priority widgets. |
| Map | **react-leaflet + OpenStreetMap tiles** | No API key, simple colored pins by priority. |
| Geocoding | **Google Geocoding API** (or Mapbox), biased to Los Angeles | Handles intersections like "5th and Main" far better than Nominatim. |

---

## System Diagram

```
 Resident phone ──SMS/MMS──► Twilio ──POST webhook──► /api/sms (Next.js on Vercel)
        ▲                                                   │
        │                                                   ▼
        │                                   lib/engine.ts  handleMessage(channel, from, body, media)
        │                                     1. emergencyCheck()  (regex, before any LLM call)
        │                                     2. load/create open conversation for `from`
        │                                     3. triage(transcript) → Claude tool call → TicketDraft JSON
        │                                     4. geocode(location_text) if new or changed
        │                                     5. upsert ticket + messages in Supabase
        │                                     6. return reply text (clarifying question OR confirmation)
        │                                                   │
        └──────── TwiML reply / Twilio REST ◄───────────────┘
                                                            │ Supabase Realtime
                                                            ▼
                        Agency Dashboard (Next.js pages): Board · Map · Analytics · Ticket detail
                          └─ status change / "Message reporter" ──► /api/tickets/[id] ──► Twilio REST ──► resident
```

The web **"Report Simulator"** page (a fake phone UI) posts to `/api/chat`, which calls the same `handleMessage()`. It is both a no-SMS reporting option and a **demo fallback** if Twilio misbehaves.

---

## Data Model (Supabase / Postgres)

- **agencies**: `id, name, categories[]`. Seed 4 mock agencies: *City Streets/311*, *LAPD non-emergency*, *Animal Services*, *Community Food & Shelter Network*.
- **conversations**: `id, phone, channel (sms|web), state (clarifying|submitted|closed), turns, created_at, updated_at`
- **messages**: `id, conversation_id, direction (in|out), sender (reporter|bot|agency), body, media_url, created_at`
- **tickets**: `id, conversation_id, agency_id, category, subcategory, summary, location_text, lat, lng, hazard_type, people_involved, priority (low|medium|high|critical), status (new|in_progress|resolved), is_emergency, photo_url, created_at, updated_at`

Turn on Realtime for `tickets` and `messages`. Skip RLS and auth (agencies are picked from a "Viewing as" dropdown, consistent with the blueprint's out-of-scope list).

---

## Conversation Engine (the core logic)

**`lib/emergency.ts`**: a hardcoded regex over keywords (fire, gun, shooting, unresponsive, not breathing, overdose, stabbing…). On a hit, immediately reply *"⚠️ If anyone is in danger, call 911 now. We've also logged your report."* Then flag the ticket `is_emergency=true, priority=critical` and continue logging. The web simulator shows a big red "Call 911" `tel:` button.

**`lib/triage.ts`**: a single Claude call per inbound message with the full transcript plus the current draft. A forced tool call (`submit_triage`) returns:
```ts
{ category: "INFRASTRUCTURE"|"PUBLIC_SAFETY"|"ENVIRONMENTAL"|"HUMAN_SERVICES"|"ANIMAL_CONTROL",
  subcategory, summary, location_text|null, hazard_type|null, people_involved|null,
  priority, priority_reason, emergency: boolean,
  missing_fields: string[], clarifying_question: string|null, reply_language }
```
- The system prompt holds the category definitions, priority rubric and "ask at most ONE short question, SMS-length" rule, and tells the model to reply in the reporter's language (Spanish support at no extra cost).
- The LLM `emergency` flag is a second safety layer behind the regex.

**State machine** in `lib/engine.ts`:
- Inbound from a phone with a `clarifying` conversation updated in the last 60 min → continue it. Otherwise start a new one.
- If `clarifying_question` is set and `turns < 2`, send the question. Otherwise mark the conversation `submitted`, route it (`category → agency`) and reply *"Thanks! Report #142 sent to Animal Services (HIGH priority). We'll text you updates."*
- Keywords: `STATUS` returns the reporter's open tickets. `NEW` forces a new report.
- The ticket row is upserted on **every** turn, so it shows up on the dashboard immediately and visibly "enriches" live during the demo.

**Two-way communication (closing the loop):**
- Dashboard status change to `in_progress` or `resolved` → Twilio SMS to the reporter (*"Update on #142: Animal Services has dispatched a team."*).
- "Message reporter" box on the ticket detail → relayed via Twilio, and the reply threads back into the same ticket's messages. The reporter's phone number is masked in the UI.

---

## Project Structure

```
app/
  page.tsx                  # landing: "Text (213) 555-0142" + link to simulator
  report/page.tsx           # web chat simulator (phone-style UI)
  dashboard/
    page.tsx                # Board (Kanban columns by status) + analytics header
    map/page.tsx            # Leaflet map, pins colored by priority
    tickets/[id]/page.tsx   # detail: structured fields, transcript, photo, actions
  api/
    sms/route.ts            # Twilio inbound webhook → handleMessage → TwiML
    chat/route.ts           # web simulator → handleMessage → JSON
    tickets/[id]/route.ts   # PATCH status / POST agency message → Twilio outbound
lib/
  engine.ts      # handleMessage(): orchestration + state machine
  triage.ts      # Claude call + Zod schema
  emergency.ts   # keyword intercept
  geocode.ts     # location_text → lat/lng (LA-biased)
  routing.ts     # category → agency map
  twilio.ts      # send SMS, validate signature
  supabase.ts    # server + browser clients
components/       # TicketCard, PriorityBadge, KanbanColumn, MapView (dynamic import, no SSR), StatsCards, CategoryChart
supabase/schema.sql + seed.sql
```

---

## 24-Hour Build Plan (roughly 3–4 people; collapse lanes if fewer)

| Hours | Lane A: Backend/AI | Lane B: Dashboard | Lane C: SMS/Infra |
|---|---|---|---|
| 0–2 | Scaffold Next.js, Supabase schema + seed | shadcn setup, layout | **Twilio account, number, verify demo phones; start any number verification immediately** |
| 2–7 | `triage.ts` prompt + schema, `emergency.ts`, test with 15 sample reports | Board + ticket cards from Supabase, Realtime subscription | `/api/sms` webhook via ngrok → echo, then wire to engine |
| 7–12 | `engine.ts` state machine, routing, geocoding | Map view, ticket detail page | Outbound status SMS, agency → reporter relay |
| 12–16 | Prompt tuning, edge cases (no location, multi-issue, Spanish) | Analytics widgets, agency "Viewing as" filter | Deploy to Vercel, point Twilio at the prod URL, web simulator page |
| 16–20 | Stretch goals (below) | Polish: priority colors, "new ticket" toast and animation | End-to-end testing on real phones |
| 20–24 | Freeze. Seed realistic demo data around USC, rehearse the demo, record a backup video, Devpost write-up | | |

**Stretch goals (pick 1–2, ranked by impact per hour):**
1. **MMS photo → Claude vision**: describe the hazard from the photo and fill in fields.
2. **Duplicate clustering**: a new ticket within ~150m with the same subcategory gets linked as "+3 similar reports" and bumped in priority.
3. AI "shift summary" on the dashboard (a one-paragraph brief of today's open issues).

---

## Key Risks & Mitigations
- **US carrier SMS registration (A2P 10DLC / toll-free verification)** can block or delay outbound texts. Read Twilio's current US trial rules first thing, use a trial account with **verified demo phone numbers**, and keep the web simulator as a full-fidelity fallback.
- **Twilio 15s webhook timeout**: use Haiku and a single LLM call. If needed, return empty TwiML immediately and send the reply via the REST API.
- **LLM output drift**: forced tool call + Zod validation, falling back to a "Thanks, could you tell me the location?" reply on parse failure.
- **Geocoding misses**: bias to LA. If no result, the ticket still appears on the board, just without a pin.

---

## Verification
1. **Unit-ish:** a script runs ~15 canned reports (pothole, aggressive dog, fallen tree, food insecurity, "someone's not breathing") through `triage()` and checks the category, priority and that the emergency path triggers.
2. **Local E2E:** `npm run dev` + `ngrok http 3000` → set the Twilio webhook → text the number. Confirm the clarifying question arrives, the ticket appears live on `/dashboard` without a refresh, and the pin appears on `/dashboard/map`.
3. **Loop closure:** change the ticket status in the dashboard and confirm the reporter's phone gets the update SMS. Send an agency message, have the phone reply, and confirm it threads into the ticket.
4. **Prod:** repeat step 2 against the Vercel URL. Run the full blueprint "stray dog on Elm St" happy path as the demo rehearsal, plus the web simulator fallback.
