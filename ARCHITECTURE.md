# Architecture — Community4You (TrojanHacks '26)

## What we're building
Residents **text a real phone number** to describe a neighborhood problem ("aggressive dog loose near the school on Elm St"). An AI asks one or two follow-up questions, structures the report, scores its priority and routes it to the right (mock) agency. Agencies see tickets appear live on a dashboard with a map, and status changes text the resident back. Life-threatening keywords get an immediate "CALL 911" reply. See `blueprint.md` for the product pitch.

**Guiding principle:** one Next.js app, one database, one AI call per incoming text, and a conversation engine that doesn't care which channel a message came from (SMS or the web chat).

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| App | **Next.js 15** (App Router, TypeScript) | Dashboard pages and API routes in one repo. |
| SMS | **[SMS Gateway for Android](https://docs.sms-gate.app)**, Cloud mode | An Android phone with a SIM is the bot's phone number. It can be anywhere with power and Wi-Fi. No carrier registration, so judges can text it from their own phones. |
| AI | **Gemini** via `@google/genai`: `gemini-3.5-flash-lite` (main), `gemini-3.8-flash` (backup) | Free tier. Flash-Lite answers in about 1s; free-tier Flash often returns 503 "high demand". The output must match a JSON schema and is checked with Zod. |
| Database + realtime | **Supabase** (Postgres + Realtime) | Not built yet: the app currently stores everything in memory. |
| Hosting | **Vercel** | Gives a stable HTTPS URL for the phone's webhook. Until then we use ngrok locally. |
| UI | Tailwind (installed), shadcn/ui, Recharts | |
| Map | react-leaflet + OpenStreetMap tiles | No API key needed. |
| Geocoding | Mapbox or Google Geocoding, biased to Los Angeles | Not built yet. Whichever key we can get fastest. |

**Ruled out:**
- **Twilio:** the trial only sends template messages, and texting real US phones needs carrier registration that takes days to weeks.
- **iMessage relay through a Mac:** macOS 26 breaks the usual way to send messages from a script.

The Twilio webhook (`/api/sms`) is still in the code but unused.

---

## How a text flows

```
 Resident's phone ──SMS──► Android phone (SMS Gateway app) ──webhook──► POST /api/smsgate
        ▲                                                                   │ verify signature, skip duplicates,
        │                                                                   │ reply 204 immediately, then:
        │                                                                   ▼
        │                                              lib/engine.ts  handleMessage()
        │                                                1. emergency keyword check (regex, before AI)
        │                                                2. find or create the conversation (60 min window)
        │                                                3. triage(transcript) → Gemini → JSON checked by Zod
        │                                                4. geocode location_text                [TODO]
        │                                                5. save ticket + messages (store.ts → Supabase) [TODO: Supabase]
        │                                                6. build the reply (question, confirmation or 911)
        │                                                                   │
        └──SMS── Android phone ◄── sms-gate cloud API ◄── sendGatewaySms() ◄┘
                                                                            │ Supabase Realtime
                                                                            ▼
                                       Dashboard: Board · Map · Ticket detail · Analytics
                                         └─ change status / message the resident ─► /api/tickets/[id] ─► SMS
```

`/api/chat` runs the same `handleMessage()` for a web chat page. That page is both a no-phone way to report and the **demo backup** if the phone has problems.

---

## Conversation rules (implemented in `lib/engine.ts`)
- A text from the same number within 60 minutes continues that number's latest conversation.
- The bot asks **at most 2** follow-up questions, then submits with what it has.
- The ticket is **saved on every message**, so it appears on the dashboard right away and fills in as the resident answers.
- **Emergency:** if the keyword check or the AI flags one, the bot replies "CALL 911 NOW…", sets priority to CRITICAL and submits. Once flagged, a ticket stays flagged.
- A text after a report is submitted adds information to that same ticket.
- **Commands:** `STATUS` lists the resident's reports, and `NEW` starts a fresh report.
- **Fallbacks:** if both AI models fail, the bot asks for the nearest cross street. The 911 reply still goes out even if the AI fails.
- Follow-up questions are asked in the resident's language (Spanish tested).

**Categories → agencies** (`lib/routing.ts`):

| Category | Agency |
|---|---|
| INFRASTRUCTURE | LA Streets & 311 |
| PUBLIC_SAFETY | LAPD Non-Emergency |
| ENVIRONMENTAL | LA Sanitation & Environment |
| HUMAN_SERVICES | Community Food & Shelter Network |
| ANIMAL_CONTROL | LA Animal Services |

---

## Data model: the contract between backend and dashboard

The backend writes these tables and the dashboard reads them. **Field values:**
- `category` and `priority` are UPPERCASE (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- `status` is lowercase (`new`, `in_progress`, `resolved`).
- `sender` is `reporter`, `bot` or `agency`.

```sql
create table agencies (
  id text primary key,                 -- 'streets' | 'police' | 'sanitation' | 'outreach' | 'animals'
  name text not null,
  categories text[] not null
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                 -- E.164 for SMS, 'web:<session>' for web chat
  channel text not null,               -- 'sms' | 'web'
  state text not null default 'clarifying', -- 'clarifying' | 'submitted' | 'closed'
  questions_asked int not null default 0,
  ticket_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tickets (
  id bigint generated always as identity (start with 101) primary key,
  conversation_id uuid not null references conversations(id),
  phone text not null,                 -- mask in the UI, e.g. (•••) •••-0123
  agency_id text not null references agencies(id),
  category text not null,
  subcategory text not null,           -- 'pothole', 'aggressive stray dog'
  summary text not null,               -- one line for dispatchers
  location_text text,                  -- 'Figueroa St & Jefferson Blvd, Los Angeles'
  lat double precision,                -- null until geocoded (no map pin)
  lng double precision,
  hazard_type text,
  people_involved int,
  priority text not null,
  priority_reason text not null,
  status text not null default 'new',
  is_emergency boolean not null default false,
  photo_url text,
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

alter publication supabase_realtime add table tickets, messages;
```

**Rules for the dashboard:**
- **Read** directly from Supabase with `supabase-js`, and subscribe to Realtime on `tickets` and `messages`.
- **Write** only through the API routes below, because they also send the SMS to the resident.

| Route | Body | Effect |
|---|---|---|
| `PATCH /api/tickets/[id]` | `{ "status": "in_progress" \| "resolved" }` | Updates the status and texts the resident, e.g. "Update on #142: LA Animal Services is on it." |
| `POST /api/tickets/[id]/messages` | `{ "body": "..." }` | Saves an `agency` message and texts it to the resident. The resident's reply joins the same conversation. |

---

## Project structure

```
app/
  api/smsgate/route.ts      [done] Android gateway webhook (main SMS channel)
  api/chat/route.ts         [done] web chat → engine (JSON)
  api/sms/route.ts          [done, unused] Twilio webhook
  api/tickets/[id]/...      [todo] status change + agency message → SMS
  dashboard/...             [teammate] board, map, ticket detail, analytics
  report/page.tsx           [todo] phone-styled web chat (demo backup)
  page.tsx                  [todo] landing: "Text (xxx) xxx-xxxx"
lib/
  engine.ts                 [done] conversation rules
  triage.ts                 [done] Gemini call, schema, model fallback
  emergency.ts              [done] 911 keyword check
  routing.ts                [done] category → agency
  smsgate.ts                [done] gateway send + signature check
  store.ts                  [done, in-memory] → swap to Supabase, same function signatures
  geocode.ts                [todo]
  twilio.ts                 [unused]
scripts/
  chat.ts                   [done] `npm run chat`: text the bot from the terminal (also reads piped input)
  register-webhook.ts       [done] `npm run gateway:register -- https://<host>`
supabase/schema.sql, seed.sql  [todo]
```

---

## Setup

**Environment variables** (copy `.env.example` to `.env.local`):
- `GEMINI_API_KEY`, plus optionally `TRIAGE_MODEL` and `TRIAGE_FALLBACK_MODEL`
- `SMSGATE_USERNAME`, `SMSGATE_PASSWORD`, `SMSGATE_SIGNING_KEY`: from the phone's app
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: once Supabase exists

**The Android phone:**
1. Install SMS Gateway for Android (by capcom6) and allow the SMS permissions.
2. Turn on **Cloud Server** and tap Offline so it changes to Online.
3. Share the Home-tab username and password, and the Signing Key from Settings → Webhooks.
4. Turn off battery optimization for the app, and keep the phone plugged in and on Wi-Fi.

**Running locally:**
```
npm run dev
ngrok http 3000
npm run gateway:register -- https://<ngrok-url>   # re-run whenever the ngrok URL changes
```

---

## Testing
1. **`npm run chat`**: tests the AI and conversation rules from the terminal, no phone needed. Scenarios to try:
   - The dog report, then its follow-up answer.
   - A pothole with no location.
   - "Sparks on a power line", which should get the 911 reply.
   - "Fire hydrant leaking", which should *not* get a 911 reply.
   - A report in Spanish.
   - `STATUS` and `NEW`.
2. **Fake webhook:** send a signed `curl` POST to `/api/smsgate`. A valid request gets 204, a forged one 403, and a repeated one is ignored.
3. **Real phone:** with the server, ngrok and the registered webhook running, text the Android phone's number from your own phone.
4. **Full loop, once the dashboard is in:**
   - A text appears on the board without refreshing the page.
   - The ticket gets a map pin.
   - Changing the status sends the resident an SMS.
5. **Production:** repeat steps 3 and 4 against the Vercel URL the night before judging.

---

## Risks
| Risk | Mitigation |
|---|---|
| The phone goes offline (battery saver, Wi-Fi drops, app killed) | Keep it plugged in, battery optimization off, and someone near it during judging. Use the web chat as the backup. |
| Gemini free-tier limits or 503 errors | Flash-Lite main with Flash backup. If both fail, a canned reply goes out. If it gets bad, enable billing on the Google key. |
| The in-memory store is wiped on restart and doesn't work on Vercel | Supabase is the next backend task, and must be done before deploying. |
| Carrier spam filtering of the phone's outgoing texts | Fine at demo volume. Keep replies short and plain. |
| The ngrok URL changes | Re-run `gateway:register`, or deploy to Vercel for a stable URL. |
