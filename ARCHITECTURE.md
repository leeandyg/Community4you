# Architecture — Community4You (TrojanHacks '26)

## What we're building
Residents **text a real phone number** to describe a neighborhood problem ("aggressive dog loose near the school on Elm St"). The AI:
- asks one or two follow-up questions,
- sorts the report into a category and sends it to the right (mock) agency,
- scores how urgent it is,
- flags fake reports,
- spots duplicates of reports already received,
- suggests what responders should do.

Agencies see tickets appear live on a dashboard, and changing a ticket's status texts the resident back. Life-threatening keywords get an immediate "CALL 911" reply. `blueprint.md` has the product pitch.

**Core scope (everything else is a stretch goal):**
- categorize and route
- filter fake reports
- suggest an action for each ticket
- detect duplicates
- prioritize
- show live dashboard insights

**Guiding principles:**
- There are two apps that share one database: the backend writes, and the dashboard reads.
- All AI and business logic lives in the backend, which writes its conclusions into ticket columns. The dashboard only displays them.
- The SMS reply never waits on slow work. Anything that looks across several tickets (duplicates, re-scoring) runs in the background.

---

## Two apps, one database

| App | Folder | Who | What it does |
|---|---|---|---|
| **Backend** (Next.js 15, TypeScript) | repo root | Andy | Receives texts, runs the AI, saves tickets, sends SMS, serves the API routes the dashboard calls |
| **Dashboard** (Vite + React) | `agency-dashboard/` | teammate | The agencies' view: ticket list, ticket detail, filters, stats (map is an add-on) |
| **Supabase** (Postgres + Realtime) | `supabase/*.sql` | shared | The single source of truth. Both apps talk to it. |

**Rules for the dashboard:**
- **Reads** come straight from Supabase with `supabase-js`, using the publishable key. Subscribe to Realtime on `tickets` and `messages` so new texts appear without a page refresh.
- **Writes** always go through the backend's API routes, never directly to the database, because the backend also texts the resident. The database blocks browser writes, so this is enforced.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| SMS | **[SMS Gateway for Android](https://docs.sms-gate.app)**, Cloud mode | An Android phone with a SIM is the bot's number. It can be anywhere with power and Wi-Fi, needs no carrier registration, and judges text it from their own phones. |
| AI | **Gemini** via `@google/genai`: `gemini-3.5-flash-lite` (main), `gemini-3.8-flash` (backup) | Free tier. Flash-Lite answers in about 1s; free-tier Flash often returns 503 errors. Every answer must match a JSON schema and is checked with Zod. |
| Database | **Supabase** | Row Level Security on: anyone can read, only the backend's secret key can write. |
| Geocoding | Mapbox or Google, biased to Los Angeles | **Add-on, deferred** with the map. `lat`/`lng` stay null for live tickets until then. |
| Map | react-leaflet + OpenStreetMap tiles | **Add-on, deferred.** No API key needed when we get to it. |
| Hosting | **Vercel**, as two projects from the same repo | The backend at the repo root, the dashboard with `agency-dashboard/` as its root folder. |

**Ruled out:**
- **Twilio:** the trial only sends template messages, and texting real US phones needs carrier registration that takes days to weeks.
- **iMessage through a Mac:** macOS 26 breaks the usual way to send messages from a script.

The Twilio webhook (`/api/sms`) is still in the code but unused.

---

## How a text flows

```
Resident's phone ──SMS──► Android phone (SMS Gateway app) ──webhook──► POST /api/smsgate
                                                                         │ verify signature, skip duplicates,
                                                                         │ reply 204 immediately, then:
                                                                         ▼
 lib/engine.ts  handleMessage()
   1. emergency.ts   keyword check (instant, runs even if the AI fails)
   2. find or create the conversation (60 min window)
   3. triage.ts      SINGLE-TIP AI: category, priority, credibility, suggested action, follow-up question
   4. geocode.ts     location_text → lat/lng   (add-on, deferred)
   5. store.ts       save ticket + messages → Supabase
   6. reply ──► sms-gate cloud API ──► Android phone ──SMS──► resident        (about 1–2s total)
   7. in the background: analyze.ts   CROSS-TIP AI
        ├─ SQL: open tickets with the same category in the last 48 h, and this number's recent reports
        ├─ Gemini: "is this the same incident?"
        ├─ write duplicate_of / report_count / priority / priority_score / credibility ─► Supabase
        └─ optional second text: "Already reported as #142. We've added yours and raised its priority."
                                                                         │ Realtime
                                                                         ▼
 Dashboard (agency-dashboard/)
   ├─ reads tickets / agencies / messages from Supabase (live)
   ├─ GET   /api/insights                  stats + AI shift summary
   ├─ PATCH /api/tickets/:id               status change → texts the resident
   ├─ POST  /api/tickets/:id/messages      agency message → texts the resident
   └─ POST  /api/tickets/:id/reanalyze     (optional) re-run the AI on a ticket
```

`/api/chat` runs the same `handleMessage()` for a web chat page. That page is both a no-phone way to report and the **demo backup** if the phone has problems.

---

## AI analysis: what it does and where

| Step | Where | When | Produces |
|---|---|---|---|
| **Single-tip triage** | `lib/triage.ts` (one Gemini call per text) | Every incoming text, before the reply | `category` → agency, `priority` + reason, `emergency`, `credibility` + reason, `suggested_action`, `summary`, location, the follow-up question |
| **Cross-tip analysis** | `lib/analyze.ts` (SQL + at most one Gemini call) | In the background after a ticket is saved, or from the "re-analyze" button | `duplicate_of`, the original's `report_count`, higher priority when 3+ people report the same thing, `priority_score`, a credibility downgrade if one number floods reports |
| **Insights** | `lib/insights.ts` → `GET /api/insights` | When the dashboard asks; the AI summary is cached about 5 min | Counts by category / priority / agency, open CRITICAL tickets, hotspots, and a one-paragraph AI shift summary |

**Fake-report filtering:**
- The AI gives each report a `credibility`, and simple rules back it up: a cap on reports per number per hour, plus catching gibberish and "test" messages.
- `spam` tickets aren't sent to an agency, and the resident gets a neutral reply.
- The dashboard hides them behind a **Flagged** filter instead of deleting them.

**`priority_score`** (calculated by `analyze.ts`, used to sort the dashboard):
- base by priority: CRITICAL 100, HIGH 70, MEDIUM 40, LOW 10
- plus 10 for each additional report, up to +30
- `spam` scores 0

**Conversation rules** (`lib/engine.ts`, done):
- The bot asks at most 2 follow-up questions, then submits.
- The ticket is saved on every message, so it fills in live on the dashboard.
- **Emergency:** the bot replies "CALL 911 NOW", the ticket becomes CRITICAL, and it stays flagged.
- A text after submitting adds to the same ticket.
- **Commands:** `STATUS` and `NEW`.
- If the AI fails, a canned reply goes out.
- Follow-up questions are asked in the resident's language.

---

## Agencies (the routing targets)
The AI picks a **category**, and each category maps to exactly one agency. These are mock LA agencies. The dashboard reads this list from the `agencies` table; don't hardcode another one.

| `id` | Name | Category |
|---|---|---|
| `streets` | LA Streets & 311 | INFRASTRUCTURE (potholes, streetlights, fallen trees, downed lines) |
| `police` | LAPD Non-Emergency | PUBLIC_SAFETY (non-emergency crime, vandalism, abandoned cars) |
| `sanitation` | LA Sanitation & Environment | ENVIRONMENTAL (dumping, graffiti, spills, flooding) |
| `outreach` | Community Food & Shelter Network | HUMAN_SERVICES (food, shelter, outreach needs) |
| `animals` | LA Animal Services | ANIMAL_CONTROL (stray, aggressive, injured animals) |

---

## Data model (locked contract)

**Changing the schema:** only add columns. Never rename or remove one, and tell the other person whenever you add one.

**Allowed values:**
- `category`: `INFRASTRUCTURE`, `PUBLIC_SAFETY`, `ENVIRONMENTAL`, `HUMAN_SERVICES`, `ANIMAL_CONTROL`
- `priority`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `status`: `new`, `in_progress`, `resolved`. The dashboard can *display* these as "Pending", "Under Review" and "Resolved".
- `credibility`: `ok`, `suspicious`, `spam`
- `sender`: `reporter`, `bot`, `agency`

```sql
create table agencies (
  id text primary key,
  name text not null,
  description text not null,
  categories text[] not null
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                       -- E.164 for SMS, 'web:<session>' for web chat
  channel text not null,                     -- 'sms' | 'web'
  state text not null default 'clarifying',  -- 'clarifying' | 'submitted' | 'closed'
  questions_asked int not null default 0,
  ticket_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tickets (
  id bigint generated always as identity (start with 101) primary key,
  conversation_id uuid not null references conversations(id),
  phone text not null,                       -- mask in the UI: (•••) •••-0123
  agency_id text not null references agencies(id),
  -- single-tip triage (triage.ts)
  category text not null,
  subcategory text not null,                 -- 'pothole', 'aggressive stray dog'
  summary text not null,                     -- one line for dispatchers
  suggested_action text,                     -- 'Dispatch animal control; school nearby'
  location_text text,                        -- 'Figueroa St & Jefferson Blvd, Los Angeles'
  lat double precision,                      -- null until geocoded (no map pin)
  lng double precision,
  hazard_type text,
  people_involved int,
  priority text not null,
  priority_reason text not null,
  is_emergency boolean not null default false,
  credibility text not null default 'ok',
  credibility_reason text,
  photo_url text,
  -- cross-tip analysis (analyze.ts)
  duplicate_of bigint references tickets(id),  -- set on the newer report, pointing at the original
  report_count int not null default 1,         -- on the original: how many people reported it
  priority_score int not null default 0,       -- sort key for the dashboard
  analyzed_at timestamptz,
  -- workflow
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  sender text not null,
  body text not null,
  media_url text,
  created_at timestamptz not null default now()
);

-- Anyone can read; only the backend's secret key can write.
alter table agencies enable row level security;
alter table conversations enable row level security;
alter table tickets enable row level security;
alter table messages enable row level security;
create policy "public read" on agencies for select using (true);
create policy "public read" on conversations for select using (true);
create policy "public read" on tickets for select using (true);
create policy "public read" on messages for select using (true);

alter publication supabase_realtime add table tickets, messages;
```

**Useful dashboard queries:**
- Main list: `tickets` where `duplicate_of is null` and `credibility != 'spam'`, ordered by `priority_score desc, created_at desc`.
- An original ticket's duplicates: `tickets` where `duplicate_of = <id>`.
- A ticket's text conversation: `messages` where `conversation_id = <ticket.conversation_id>`, ordered by `created_at`.

---

## API routes the dashboard calls
All routes live on the backend and allow requests from the dashboard's address.

| Route | Body | Effect |
|---|---|---|
| `PATCH /api/tickets/:id` | `{ "status": "in_progress" \| "resolved" }` | Updates the status and texts the resident: "Update on #142: LA Animal Services is on it." |
| `POST /api/tickets/:id/messages` | `{ "body": "..." }` | Saves an `agency` message and texts it to the resident. Their reply joins the same conversation. |
| `GET /api/insights` | (none) | `{ counts: {...}, criticalOpen: [...], hotspots: [...], summary: "..." }` |
| `POST /api/tickets/:id/reanalyze` | (none) | Optional. Re-runs the cross-tip analysis on one ticket. |

---

## Build plan

**Backend (Andy):**

| # | Task | Status | Unblocks |
|---|---|---|---|
| B0 | SMS gateway webhook, single-tip triage, conversation rules | done | |
| B1 | `supabase/schema.sql` + `seed.sql`: agencies, plus ~15 realistic USC-area tickets including 2 duplicates and 1 spam | done | dashboard D2 |
| B2 | `store.ts` → Supabase (same functions) | done | everything after |
| B3 | `geocode.ts` | deferred (add-on with the map) | map |
| B4 | Add `credibility` and `suggested_action` to triage; per-number rate limit | | |
| B5 | `analyze.ts`: duplicates (same category, open, last 48 h; the AI compares location + description, no coordinates needed), report counts, priority increases, `priority_score`, flood detection | | |
| B6 | `/api/tickets/:id` status + message routes (texts the resident) | | dashboard D6 |
| B7 | `/api/insights` (stats + AI summary) | | dashboard D7 |
| B8 | Deploy to Vercel, register the phone's webhook once | | demo |

**Dashboard (teammate):**

| # | Task | Notes |
|---|---|---|
| D1 | Cut Resources / Alerts / Login / Settings. Build the layout with local sample data **shaped exactly like the `tickets` table**. | Start now; it doesn't wait for anything |
| D2 | Swap the sample data for Supabase reads plus Realtime | After B1 |
| D3 | Ticket detail: summary, suggested action, priority reason, credibility, text conversation, linked duplicates | |
| D4 | Map with pins colored by priority | **Add-on, deferred.** Seed data already has `lat`/`lng` |
| D5 | Filters (agency, category, status, Flagged), sorted by `priority_score` | |
| D6 | Resolve / Review buttons call `PATCH /api/tickets/:id` | After B6 |
| D7 | Stats row + AI shift summary from `/api/insights` | After B7 |
| D8 | Deploy the dashboard to Vercel (root folder `agency-dashboard/`) | |

**Last 3–4 hours:** freeze features, reseed demo data, rehearse, record a backup video, write the Devpost.

**Stretch goals:** photo texts (AI describes the photo), a web chat page for reporting, a landing page.

---

## Project structure

```
app/api/
  smsgate/route.ts              [done] Android gateway webhook (main SMS channel)
  chat/route.ts                 [done] web chat → engine
  sms/route.ts                  [done, unused] Twilio webhook
  tickets/[id]/route.ts         [todo] PATCH status
  tickets/[id]/messages/route.ts[todo] agency message
  tickets/[id]/reanalyze/route.ts [todo, optional]
  insights/route.ts             [todo]
lib/
  engine.ts      [done] conversation rules
  triage.ts      [done] single-tip AI (add credibility + suggested_action)
  emergency.ts   [done] 911 keyword check
  routing.ts     [done] category → agency
  smsgate.ts     [done] gateway send + signature check
  store.ts       [done] Supabase persistence
  geocode.ts     [deferred] add-on with the map
  analyze.ts     [todo] cross-tip AI
  insights.ts    [todo]
scripts/
  chat.ts                [done] `npm run chat`: text the bot from the terminal
  register-webhook.ts    [done] `npm run gateway:register -- https://<host>`
supabase/
  schema.sql, seed.sql   [done] (grants.sql: one-time permissions fix)
agency-dashboard/        teammate's Vite + React app
```

---

## Setup

**Backend `.env.local`** (template: `.env.example`):
```
GEMINI_API_KEY=            # aistudio.google.com/apikey
TRIAGE_MODEL=gemini-3.5-flash-lite
TRIAGE_FALLBACK_MODEL=gemini-3.8-flash
SMSGATE_USERNAME=          # phone app, Home tab
SMSGATE_PASSWORD=
SMSGATE_SIGNING_KEY=       # phone app, Settings → Webhooks
SUPABASE_URL=              # https://<project>.supabase.co (no /rest/v1)
SUPABASE_SECRET_KEY=       # sb_secret_...: backend only, never in the dashboard
```

**Dashboard `agency-dashboard/.env.local`:**
```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=  # sb_publishable_...: safe for the browser
VITE_API_URL=http://localhost:3000
```

**The Android phone:**
1. Install SMS Gateway for Android (by capcom6) and allow the SMS permissions.
2. Turn on **Cloud Server** and tap Offline so it changes to Online.
3. Share the Home-tab username and password, and the Signing Key from Settings → Webhooks.
4. Turn off battery optimization for the app, and keep the phone plugged in and on Wi-Fi.

**Running locally:**
```
npm run dev                                       # backend on :3000
ngrok http 3000
npm run gateway:register -- https://<ngrok-url>   # re-run whenever the ngrok URL changes
cd agency-dashboard && npm run dev                # dashboard on :5173
```

---

## Testing
1. **`npm run chat`**: tests the AI and conversation rules without a phone. Scenarios to try:
   - The dog report, then its follow-up answer.
   - A pothole with no location.
   - "Sparks on a power line", which should get the 911 reply.
   - "Fire hydrant leaking", which should *not* get a 911 reply.
   - A report in Spanish.
   - Gibberish or "test", which should be flagged as spam.
   - The same pothole sent from two numbers, which should be linked as a duplicate.
   - `STATUS` and `NEW`.
2. **Fake webhook:** send a signed `curl` POST to `/api/smsgate`. A valid request gets 204, a forged one 403, and a repeated one is ignored.
3. **Real phone:** text the Android phone's number. The reply should arrive within a few seconds.
4. **Full loop with the dashboard:**
   - A new text appears without refreshing.
   - A duplicate increases the original's count.
   - Resolve texts the resident.
5. **Production:** repeat steps 3 and 4 against the Vercel URLs the night before judging.

---

## Risks
| Risk | Mitigation |
|---|---|
| The phone goes offline | Keep it plugged in with battery optimization off, and have someone near it during judging. Use the web chat as the backup. |
| Gemini free-tier limits or 503 errors | Flash-Lite main with Flash backup and a canned reply if both fail. Cache the insights summary. If it gets bad, enable billing. |
| Duplicate detection without coordinates (map deferred) | Candidates are open tickets in the same category from the last 48 h; the AI compares location text and descriptions. Add distance filtering when geocoding lands. |
| The duplicate-text check is held in memory per server instance (Vercel) | Rare at demo volume. Move it to a database table if it shows up. |
| Schema changes break the other app | Only add columns, and announce each one. |
| The ngrok URL changes | Re-run `gateway:register`, or deploy to Vercel. |
