# Architecture — Community4You (TrojanHacks '26)

## What we're building
Residents **text a real phone number** to describe a neighborhood problem ("aggressive dog loose near the school on Elm St"). The AI:
- asks one or two follow-up questions,
- sorts the report into a category and sends it to the right (mock) agency,
- scores how urgent it is,
- flags fake reports,
- groups reports about the same real-world event into one **incident**,
- suggests what responders should do.

Agencies work **incidents** on a live dashboard. Confirming or resolving one texts every resident who reported it, and a public website shows published alerts. Life-threatening keywords get an immediate "CALL 911" reply. `blueprint.md` has the product pitch.

**Status (2026-10-18):**
- **The whole core loop is live and tested with a real phone:** text → AI triage → ticket → incident → dashboard → Confirm/Resolve → SMS back. Backend and public site at https://community4you.vercel.app; dashboard at https://community4you-xaix.vercel.app.
- **Next:** geocoding + map (planned below), demo prep. [README.md](README.md) is the overview for judges.

**Core scope (everything else is a stretch goal):**
- categorize and route
- filter fake reports
- suggest an action for each ticket
- group duplicate reports into incidents
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
| **Backend** (Next.js 15, TypeScript) | repo root | Andy | Receives texts, runs the AI, saves tickets, sends SMS, serves the API routes the dashboard calls, and the **public website** at `/` (landing page + live feed of published alerts) |
| **Dashboard** (Vite + React) | `agency-dashboard/` | teammate | The agencies' "incident command" view: incident queue (Needs attention / In progress / Resolved / All), "Viewing as" agency, search, incident detail with its reports and SMS conversation, Confirm / Resolve / Review / message the resident, stats row + AI shift briefing, organizations view, dark mode. Map is an add-on. |
| **Supabase** (Postgres + Realtime) | `supabase/*.sql` | shared | The single source of truth. Both apps talk to it. |

**Rules for the dashboard:**
- **Reads** come straight from Supabase with `supabase-js`, using the publishable key. Realtime on `incidents`, plus `tickets` and `messages` filtered to the selected incident and report, so new texts appear without a page refresh.
- **Writes** always go through the backend's API routes, never directly to the database, because the backend also texts the resident. The database blocks browser writes, so this is enforced.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| SMS | **[SMS Gateway for Android](https://docs.sms-gate.app)**, Cloud mode | An Android phone with a SIM is the bot's number. It can be anywhere with power and Wi-Fi, needs no carrier registration, and judges text it from their own phones. |
| AI | **Gemini** via `@google/genai`: `gemini-3.5-flash-lite` first, `gemini-3.8-flash` as backup, for every AI step | Prepaid billing ($5, about $0.005 per report). Flash-Lite answers in about 1s; Flash is slower and its free tier was capped at 20 requests/day. Every answer must match a JSON schema and is checked with Zod (`lib/gemini.ts`). |
| Database | **Supabase** | Row Level Security on: anyone can read, only the backend's secret key can write. |
| Geocoding | Google Geocoding API (planned) | **Not built yet**; see "Planned: geocoding + map". `lat`/`lng` stay null for live tickets until then (the seed data has them). |
| Map | react-leaflet + OpenStreetMap tiles (planned) | **Not built yet.** No API key needed. |
| Hosting | **Vercel**, as two projects from the same repo | The backend at the repo root, the dashboard with `agency-dashboard/` as its root folder. |

**Ruled out:**
- **Twilio:** the trial only sends template messages, and texting real US phones needs carrier registration that takes days to weeks.
- **iMessage through a Mac:** macOS 26 breaks the usual way to send messages from a script.

(The Twilio code was removed.)

---

## How a text flows

```
Resident's phone ──SMS──► Android phone (SMS Gateway app) ──webhook──► POST /api/smsgate
                                                                         │ verify signature, skip duplicates and short codes,
                                                                         │ reply 204 immediately, then (smsAccess.ts) check who's answered:
                                                                         ▼
 lib/engine.ts  handleMessage()
   1. emergency.ts   keyword check (instant, runs even if the AI fails)
   2. find or create the conversation (60 min window); a text after submission goes to
      followup.ts first: more info → same ticket, new problem → new report, "thanks" → short ack
   3. triage.ts      SINGLE-TIP AI: category, priority, credibility, suggested action, follow-up question
   4. geocode.ts     location_text → lat/lng   (planned, not built)
   5. store.ts       save ticket + messages → Supabase
   6. reply ──► sms-gate cloud API ──► Android phone ──SMS──► resident        (about 1–2s total)
   7. once the report is submitted, in the background: analyze.ts   CROSS-TIP AI (incidents)
        ├─ SQL: up to 20 open incidents (active/confirmed) with a report in the last 48 h
        ├─ Gemini (Flash-Lite, Flash backup): "same real-world event as one of these, or new?" + the merged record
        ├─ attach the ticket (tickets.incident_id) or create a new incident; update the incident's
        │  title, summary, priority, report_count, priority_score ─► Supabase
        └─ if it joined an existing incident, text the resident:
           "Others have reported this too. Report #101 is grouped with theirs…"
                                                                         │ Realtime
                                                                         ▼
 Dashboard (agency-dashboard/)
   ├─ reads incidents / tickets / agencies / messages from Supabase (live)
   ├─ GET   /api/insights                  stats + AI shift summary
   ├─ PATCH /api/incidents/:id             confirm / resolve → texts every reporter on the incident
   ├─ PATCH /api/tickets/:id               status change on one report → texts that resident
   ├─ POST  /api/tickets/:id/messages      agency message → texts the resident
   └─ POST  /api/tickets/:id/reanalyze     (optional, not built) re-run the incident analysis

 Public website (app/page.tsx, same backend) ─ landing page + feed of published alerts
   (incidents with alert_published_at; no phone numbers or conversations)
```

`/api/chat` runs the same `handleMessage()` for web chat (JSON in/out). It's the **demo backup** if the phone has problems (e.g. `curl` it live), and could back a web chat page, which isn't built.

---

## AI analysis: what it does and where

| Step | Where | When | Produces |
|---|---|---|---|
| **Single-tip triage** | `lib/triage.ts` (one Gemini call per text) | Every incoming text, before the reply | `category` → agency, `priority` + reason, `emergency`, `credibility` + reason, `suggested_action`, `summary`, location, the follow-up question |
| **Follow-up check** | `lib/followup.ts` (one small Gemini call) | A text after the report was submitted | `more_info` / `new_problem` / `other` |
| **Incident analysis** | `lib/analyze.ts` (SQL + one Gemini call) | In the background once a report is submitted (and when a submitted report gets new details) | Which **incident** the report belongs to (or a new one), the incident's merged title + summary, its priority using urgency, severity, vulnerable people, trend and **corroboration**, `report_count`, `priority_score` |
| **Insights** | `lib/insights.ts` → `GET /api/insights` | When the dashboard asks; the AI summary is regenerated only when incidents change, at most once a minute | Counts by category / priority / status / agency, last-24h report / flagged / resolved counts, needs-attention and hotspot lists, and a short AI shift briefing |

**Incidents** are real-world events (a fire, a pothole). Every non-spam report belongs to one:
- A report on its own becomes a one-report incident; matching reports join it. Comparing against the short list of *open incidents* (not every past report) keeps the AI's job small and gives it the merged context.
- Matching rule: the same physical problem at the same place, in any wording or language. The same kind of problem elsewhere, or a different problem on the same corner, is a different incident. When unsure, the AI starts a new one.
- Status, set by agency staff on the dashboard:

  | Status | Means | Reports | Residents are texted |
  |---|---|---|---|
  | `active` | Detected by the AI; nobody has checked it yet | `new` | (nothing) |
  | `confirmed` | Staff verified it's real and own it | `new` → `in_progress` | "…has confirmed it and is responding" |
  | `resolved` | Done; no longer matched by new reports | all → `resolved` | "…marked it resolved. Thanks for reporting!" (skips reports already resolved) |

- **Confirm doesn't change priority.** It makes an incident more *certain*, not more *dangerous*. The dashboard shows two queues instead: **Needs attention** (`active`, by score) and **In progress** (`confirmed`).
- A new report that joins an incident is told "Others have reported this too…". If the incident is already **confirmed**, it says "Others have reported this too, and <agency> is already responding…", and the report starts as `in_progress`.
- **Publish alert** (add-on) is only allowed on `confirmed` incidents, so the AI can never broadcast something unverified. `alert_message` / `alert_published_at` are reserved for it.

**Who the SMS bot answers** (`lib/smsAccess.ts`). The gateway is a regular phone, so the bot must not reply to its owner's friends and family:
- Short codes (banks, 2FA, carrier alerts) are always ignored.
- `SMS_ALLOWED_NUMBERS`: numbers that are always answered (the team). Use this while testing.
- `SMS_JOIN_KEYWORD` (e.g. `REPORT`): anyone else is answered once their first text starts with it ("REPORT pothole at vermont and 36th"), and normally after that. Use this for the demo.
- Senders who don't qualify are ignored entirely: no reply, nothing saved. With neither variable set, everyone is answered. Web chat isn't affected.

**Fake-report filtering:**
- The AI gives each report a `credibility`, and a cap of `REPORTS_PER_HOUR` (default 20) new reports per number backs it up. Emergencies bypass the cap.
- `spam` tickets aren't sent to an agency, and the resident gets a neutral reply.
- Spam gets no incident, so it never appears in the incident queue. The dashboard's **Flagged reports** view (`tickets` where `credibility != 'ok'`) lists them; **Not spam** (`PATCH /api/tickets/:id` with `{ "credibility": "ok" }`) clears the flag, runs the incident analysis so the report joins the queue, and, if the resident got the spam reply, texts them that it's being looked at.

**Priority:** the AI sets the priority *level* with context; `priority_score` (`lib/scoring.ts`) turns it into a sort key:
- base by level: CRITICAL 100, HIGH 70, MEDIUM 40, LOW 10
- incidents add 10 per additional report, up to +30 (corroboration)
- an emergency report always makes its incident CRITICAL; `spam` tickets score 0 and get no incident

**Conversation rules** (`lib/engine.ts`, done):
- The bot asks at most 2 follow-up questions, then submits: first the location if missing, then the key detail for the category (animal behavior, traffic/hazard, happening now, amount/hazard, the person's wellbeing and needs).
- The ticket is saved on every message, so it fills in live on the dashboard.
- **Emergency:** the bot replies "CALL 911 NOW", the ticket becomes CRITICAL, and it stays flagged.
- A text after submitting is classified (`lib/followup.ts`): **more info** is added to the same ticket; a **new problem** starts a fresh report; **"thanks"/"ok"** gets a short acknowledgement with no triage. More info about a **resolved** report starts a fresh report, so it isn't lost on a closed ticket.
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
- ticket `status`: `new`, `in_progress`, `resolved`. The dashboard can *display* these as "Pending", "Under Review" and "Resolved".
- incident `status`: `active`, `confirmed`, `resolved`
- `credibility`: `ok`, `suspicious`, `spam`
- `sender`: `reporter`, `bot`, `agency`

The source of truth is [supabase/schema.sql](supabase/schema.sql). Summary:

| Table | Key columns |
|---|---|
| `agencies` | `id` (stable: `streets`, `police`, `sanitation`, `outreach`, `animals`), `name`, `description`, `categories` |
| `incidents` | `id` (from 1001), `agency_id`, `category`, `title`, `summary` (AI-merged), `location_text`, `lat`/`lng`, `priority`, `priority_reason`, `priority_score`, `status`, `report_count`, `first_reported_at`, `last_reported_at`, `alert_message`, `alert_published_at` |
| `tickets` (one per report) | `id` (from 101), `conversation_id`, `phone` (mask in UI), `agency_id`, `incident_id`, `category`, `subcategory`, `summary`, `suggested_action`, `location_text`, `lat`/`lng`, `hazard_type`, `people_involved`, `priority`, `priority_reason`, `is_emergency`, `credibility`, `credibility_reason`, `photo_url`, `priority_score`, `analyzed_at`, `status` |
| `conversations` | `id`, `phone`, `channel`, `state`, `questions_asked`, `ticket_id` |
| `messages` | `id`, `conversation_id`, `sender`, `body`, `media_url`, `created_at` |

`tickets.duplicate_of` and `tickets.report_count` are **deprecated** (replaced by incidents); they stay in the table per the only-add-columns rule. Realtime is on for `incidents`, `tickets` and `messages`. Browsers can read every table; only the backend's secret key can write.

**Useful dashboard queries:**
- Main list: `incidents` where `status != 'resolved'`, ordered by `priority_score desc, last_reported_at desc`, with `agencies(name)`.
- An incident's reports: `tickets` where `incident_id = <id>`, ordered by `created_at`.
- Flagged: `tickets` where `credibility != 'ok'`.
- A ticket's text conversation: `messages` where `conversation_id = <ticket.conversation_id>`, ordered by `created_at`.

---

## API routes the dashboard calls
All routes live on the backend and allow requests from the dashboard's address.

| Route | Body | Effect |
|---|---|---|
| `PATCH /api/incidents/:id` | `{ "status": "confirmed" \| "resolved" }` | Updates the incident (and, on resolve, its reports) and texts **every** resident who reported it |
| `PATCH /api/tickets/:id` | `{ "status": "in_progress" \| "resolved" }` or `{ "credibility": "ok" }` | Status: updates one report and texts that resident: "Update on #142: LA Animal Services is on it." Credibility ("Not spam"): clears the AI's flag and groups the report into an incident. |
| `POST /api/tickets/:id/messages` | `{ "body": "..." }` | Saves an `agency` message and texts it to the resident. Their reply joins the same conversation. |
| `GET /api/insights` | (none). Optional `?agency=streets`, `?summary=false` | `{ counts: { openIncidents, byPriority, byCategory, byStatus, byAgency, reportsLast24h, flaggedLast24h, resolvedLast24h }, needsAttention: [...], hotspots: [...], summary, summaryGeneratedAt }`. The AI summary is cached and regenerated only when incidents change (at most once a minute). |
| `POST /api/tickets/:id/reanalyze` | (none) | **Not built** (optional). Re-runs the incident analysis on one ticket. |
| `POST /api/incidents/:id/alert` | `{ "message": "..." }` | **Not built** (add-on, deprioritized). Publish alert, confirmed incidents only: sets `alert_message` + `alert_published_at`, which the public site's feed already reads. |

---

## Build plan

**Backend (Andy):**

| # | Task | Status | Unblocks |
|---|---|---|---|
| B0 | SMS gateway webhook, single-tip triage, conversation rules | done | |
| B1 | `supabase/schema.sql` + `seed.sql`: agencies, 13 incidents, 16 USC-area tickets (one 3-report incident, spam, suspicious) | done | dashboard D2 |
| B2 | `store.ts` → Supabase (same functions) | done | everything after |
| B3 | `geocode.ts` | planned (see "Planned: geocoding + map") | map, location checks |
| B4 | Add `credibility` and `suggested_action` to triage; per-number rate limit | done | |
| B5 | **Incidents**: `analyze.ts` attaches each submitted report to an open incident or starts one, merges the summary, re-prioritizes with corroboration (no coordinates needed) | done | dashboard D3 |
| B6 | `/api/incidents/:id` (confirm / resolve → texts every reporter) and `/api/tickets/:id` status + message routes | done | dashboard D6 |
| B7 | `/api/insights` (stats + AI summary) | done | dashboard D7 |
| B8 | Deploy to Vercel, register the phone's webhook once | done: both apps live and auto-deploy on push; phone webhook registered, signing key on | demo |
| B9 | Tuning + review fixes: category detail questions, follow-up classifier, titles in residents' words, DB agency names in texts, Twilio removed, SMS access control, `SMS_DRY_RUN` | done | |
| B10 | Merge the teammate's dashboard + public website; fix live dashboard bugs (live report list, filter-aware selection, per-agency stats, trailing-slash API URL) | done | |
| B11 | README for judges / Devpost | done ([README.md](README.md)) | submission |

**Dashboard (teammate):** step-by-step guide in [agency-dashboard/TODO.md](agency-dashboard/TODO.md).

| # | Task | Status |
|---|---|---|
| D1 | Cut Resources / Alerts / Login / Settings | done |
| D2 | Supabase reads plus Realtime | done |
| D3 | **Incident list** as the main view, with its reports, suggested action, credibility and SMS conversation | done |
| D4 | Map with pins colored by priority | planned with geocoding; seed data already has `lat`/`lng` |
| D5 | Filters: agency ("Viewing as"), status queues, search and the **Flagged reports** view (with Not spam) are done; a category filter is not | mostly done |
| D5b | **Publish alert** button on confirmed incidents | not built (deprioritized) |
| D6 | Confirm / Resolve incidents, review a report, message the resident | done |
| D7 | Stats row + AI shift briefing from `/api/insights` (scoped to the "Viewing as" agency) | done |
| D8 | Deployed (auto-deploys on push to `main`) | done |
| — | Dark mode / theme toggle; public website at `/` | done |

**Last 3–4 hours:** freeze features, reseed demo data, rehearse, record a backup video, write the Devpost.

**Stretch goals:** photo texts (AI describes the photo), a web chat page for reporting, reusing the previous report's location when a resolved problem comes back. (The landing page is done: the public website.)

---

## Planned: geocoding + map (not built)
About 1.5 h backend + 1 h dashboard. **Cost:** Google Geocoding gives 10,000 free requests/month but needs a card on file; set a daily quota of about 300 in Cloud Console to hard-cap it at $0. Mapbox's free tier doesn't allow storing coordinates, and Nominatim is weak at intersections.

| # | Piece | What it does |
|---|---|---|
| 1 | `lib/geocode.ts` | "Vermont & 36th" → `lat`/`lng` + a formatted address, restricted to LA County, with a precision check (an address or intersection is OK; only a city or ZIP is too vague) |
| 2 | Save coordinates | Geocode after triage; save `lat`, `lng`, `geocoded_address` on the ticket; incidents take the first report's coordinates |
| 3 | Dashboard map | react-leaflet + OSM tiles, incident pins colored by priority, popups |
| 4 | False locations | Not found, outside LA, or too vague → ask once ("I couldn't find…"); still not found → submit with `location_verified = false` and show it as Flagged (not spam). Emergencies are never asked. |
| 5 | Distance grouping | Only compare with open incidents within ~300 m (plus any without coordinates); none nearby → new incident with no AI call |
| 6 | Area hotspots | `/api/insights` clusters nearby open incidents ("4 incidents within 2 blocks of Vermont & 36th") for the briefing and the map |

**Schema:** add `tickets.location_verified boolean` and `tickets.geocoded_address text` (additive `ALTER TABLE`).

---

## Project structure

```
app/api/
  smsgate/route.ts              [done] Android gateway webhook (main SMS channel)
  chat/route.ts                 [done] web chat → engine
  incidents/[id]/route.ts       [done] PATCH confirm / resolve
  tickets/[id]/route.ts         [done] PATCH status
  tickets/[id]/messages/route.ts[done] agency message
  tickets/[id]/reanalyze/route.ts [not built, optional]
app/page.tsx                    [done] public website: landing page + published-alerts feed
  insights/route.ts             [done] stats + AI shift summary
lib/
  engine.ts      [done] conversation rules
  triage.ts      [done] single-tip AI, incl. credibility + suggested_action
  emergency.ts   [done] 911 keyword check
  routing.ts     [done] category → agency id (names come from the agencies table)
  followup.ts    [done] after submission: more info / new problem / "thanks"
  smsAccess.ts   [done] who the SMS bot answers (allowlist / join keyword)
  actions.ts     [done] what the dashboard buttons do
  http.ts        [done] CORS + JSON helpers
  smsgate.ts     [done] gateway send + signature check
  store.ts       [done] Supabase persistence
  geocode.ts     [planned] see "Planned: geocoding + map"
  gemini.ts      [done] shared JSON call with model fallback
  analyze.ts     [done] incident grouping + priority
  scoring.ts     [done] priority_score
  notify.ts      [done] text a reporter outside the normal reply
  insights.ts    [done] stats queries + cached AI briefing
scripts/
  chat.ts                [done] `npm run chat`: text the bot from the terminal
  register-webhook.ts    [done] `npm run gateway:register -- https://<host>`
supabase/
  schema.sql, seed.sql   [done] (grants.sql: one-time permissions fix)
agency-dashboard/
  src/App.jsx            [done] the whole dashboard (pure fetchers + Realtime effects)
  src/supabase.js        [done] browser client (publishable key)
  TODO.md                dashboard guide for the teammate
```

---

## Working on the code together

- Work on **`main`**, or on a short branch that's merged into `main` the same hour (GitHub pull request). Vercel only updates the live sites from `main`; other branches get private preview links.
- `git pull` before you start and before you push. Small commits.
- The backend (repo root) and the dashboard (`agency-dashboard/`) are separate apps. If you need a backend change for the dashboard, ask rather than editing backend files from an old copy.
- There is one database schema: [supabase/schema.sql](supabase/schema.sql). Don't keep copies elsewhere.

## Setup

**Live:** backend https://community4you.vercel.app, dashboard https://community4you-xaix.vercel.app. Both are Vercel projects on Andy's account, connected to `leeandyg/Community4you`: **any push to `main` deploys both.** Env vars live in each Vercel project (Settings → Environment Variables); redeploy after changing them.

**Backend env vars:** see [.env.example](.env.example) for the full list with comments. Copy it to `.env.local` for local runs.
- Required: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SMSGATE_USERNAME`, `SMSGATE_PASSWORD`
- Recommended: `SMSGATE_SIGNING_KEY`, `DASHBOARD_ORIGINS`, `REPORT_PHONE_NUMBER`
- Optional: `TRIAGE_MODEL`, `TRIAGE_FALLBACK_MODEL`, `ANALYSIS_MODEL`, `REPORTS_PER_HOUR`, `SMS_ALLOWED_NUMBERS`, `SMS_JOIN_KEYWORD`, `SMS_DRY_RUN`

**Dashboard env vars** (`agency-dashboard/.env.local` and the dashboard's Vercel project):
```
VITE_SUPABASE_URL=https://jarmwkvuycptwlyekfve.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=    # sb_publishable_...: safe for the browser
VITE_API_URL=https://community4you.vercel.app
```

**The Android phone (SMS Gateway for Android, by capcom6):**
1. Allow its SMS permissions. On Android 15+, *sending* may need "Allow restricted settings" or an ADB grant (see the app's [errors FAQ](https://docs.sms-gate.app/faq/errors/)).
2. Turn on **Cloud Server** and keep the app **Online**; battery set to **Unrestricted**; plugged in and on Wi-Fi.
3. Turn off RCS chat on the phone's messaging app, so incoming texts arrive as SMS.
4. Register the webhook once: `npm run gateway:register -- https://community4you.vercel.app`. The phone picks it up the next time it connects; check it appears in the app under Settings → Webhooks.

**Database:** schema in [supabase/schema.sql](supabase/schema.sql), sample data in [supabase/seed.sql](supabase/seed.sql). To reset all data to the sample set (and refresh its timestamps), paste `seed.sql` into Supabase → SQL Editor → Run. `schema.sql` drops and recreates every table, so only run it when the schema changes.

**Local development:**
```
npm run dev                          # backend on :3000 (against the real Supabase)
npm run chat                         # text the bot from the terminal; never sends real SMS
CHAT_FROM=+15555550142 npm run chat  # act as a different phone number
cd agency-dashboard && npm run dev   # dashboard on :5173
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
   - The same pothole sent from two numbers (`CHAT_FROM=...`), which should join one incident.
   - `STATUS` and `NEW`.
2. **Fake webhook:** send a signed `curl` POST to `/api/smsgate`. A valid request gets 204, a forged one 403, and a repeated one is ignored.
3. **Real phone:** text the Android phone's number. The reply should arrive within a few seconds.
4. **Full loop with the dashboard:**
   - A new text appears without refreshing.
   - A matching report joins its incident and raises its report count.
   - Resolve texts the resident.
5. **Production:** repeat steps 3 and 4 against the Vercel URLs the night before judging.

---

## Risks
| Risk | Mitigation |
|---|---|
| The phone goes offline | Keep it plugged in with battery optimization off, and have someone near it during judging. Use the web chat as the backup. |
| Gemini errors or running out of prepaid credit | Flash-Lite main with Flash backup and a canned reply if both fail; the 911 reply never depends on the AI. Insights summary is cached. Watch the balance in AI Studio. |
| Phone setup quirks | Android 15 may block *sending* SMS until the permission is granted (restricted settings / ADB); RCS must be off; the webhook only reaches the phone once the app is Online. See Setup. |
| Teammate edits on a stale branch | Work on `main` and pull first (see "Working on the code together"). Merge rule: dashboard files from the branch, backend files from `main`. |
| Duplicate detection without coordinates (map deferred) | Candidates are open tickets in the same category from the last 48 h; the AI compares location text and descriptions. Add distance filtering when geocoding lands. |
| The duplicate-text check is held in memory per server instance (Vercel) | Rare at demo volume. Move it to a database table if it shows up. |
| Schema changes break the other app | Only add columns, and announce each one. |
