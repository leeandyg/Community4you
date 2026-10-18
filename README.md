# Community4You

**Text a phone number about a neighborhood problem. AI sorts it out and sends it to the right agency.**

Built at TrojanHacks '26.

Residents don't know whether a pothole goes to 311, a loose dog goes to Animal Services, or someone sleeping outside in the cold goes to a shelter network. Agencies, for their part, get messy, incomplete and duplicate reports and spend hours sorting them by hand.

With Community4You, a resident just texts what they see to one number, with no app and no account. AI asks a follow-up question or two, sends the report to the right agency, flags fake reports, groups reports about the same event into one **incident**, and ranks incidents by urgency. Agency staff work those incidents on a live dashboard, and every resident who reported an incident gets a text when it's confirmed or resolved.

| | |
|---|---|
| Public site | https://community4you.vercel.app |
| Agency dashboard | https://community4you-xaix.vercel.app |
| Architecture deep dive | [ARCHITECTURE.md](ARCHITECTURE.md) |

> For emergencies, always call 911. Community4You catches life-threatening keywords and immediately replies "CALL 911 NOW".

---

## How it works

```
Resident texts ──► Android phone (SMS gateway) ──webhook──► Next.js backend on Vercel
                                                             │
                                  emergency check → Gemini triage → Supabase
                                                             │
                     reply texted back in ~2 s ◄─────────────┤
                                                             │ in the background:
                                                             ▼ group into an incident, re-prioritize
                                                         Supabase (Realtime)
                                                             │
                                          Agency dashboard updates live
                                          Confirm / Resolve ──► every reporter gets a text
```

**An example conversation:**

> **Resident:** There's an aggressive dog loose near the elementary school on Elm St
>
> **Bot:** Thanks. Is the dog contained, or running loose right now?
>
> **Resident:** running loose, it chased a kid
>
> **Bot:** Thanks! Report #142 sent to LA Animal Services. We'll text you updates. Reply STATUS to check, NEW to report something else.

If a neighbor texts about the same dog ten minutes later, their report joins the same incident, the incident's priority goes up, and they're told "Others have reported this too…".

## Features

**For residents (SMS)**
- Plain-language reporting by text, in any language. Follow-up questions are asked in the resident's language.
- At most two follow-up questions: the location if it's missing, then the key detail for that kind of problem.
- An instant 911 reply for life-threatening keywords. It works even if the AI is down.
- `STATUS` to check on a report and `NEW` to start another one. Later texts are sorted into extra details, a new problem, or a simple "thanks".
- Texts when an agency confirms, resolves or messages them about their report.

**AI triage (Gemini)**
- **Categorize and route** each report to one of five mock LA agencies: streets, police non-emergency, sanitation, food & shelter outreach, animal services.
- **Prioritize**: LOW / MEDIUM / HIGH / CRITICAL with a reason, plus a sort score that rises as more people report the same thing.
- **Credibility**: `ok`, `suspicious` or `spam`. Spam isn't routed to an agency, and each number is limited in how many reports it can open per hour.
- **Suggested action** for responders on every report.
- **Incident grouping**: a report is matched against open incidents ("same physical problem, same place, any wording") and merged into one with a combined summary.
- **Shift briefing**: a short AI summary of what needs attention right now.

**For agencies (dashboard)**
- A live incident queue (Needs attention / In progress / Resolved) with no page refresh, plus notifications and a sound when reports come in.
- Incident detail: every report on it, the AI's recommendation, credibility badges and the full SMS conversation.
- **Confirm** and **Resolve** actions that text every resident who reported the incident, and direct messages to a single resident.
- A **Flagged reports** view of spam and suspicious reports, with a "Not spam" override that puts a report back in the queue.
- A "Viewing as" agency filter, search, a stats row, an organizations view and dark mode.

**Public site**
- A landing page and a feed of alerts that agencies have published. Phone numbers and conversations are never shown.

## Tech stack

| Layer | Choice |
|---|---|
| SMS | [SMS Gateway for Android](https://docs.sms-gate.app) (Cloud mode). An Android phone with a SIM is the bot's number, so there's no carrier registration wait. Webhooks are HMAC-signed. |
| Backend + public site | Next.js 15 (App Router, TypeScript) on Vercel |
| AI | Google Gemini via `@google/genai`: `gemini-3.5-flash-lite`, with `gemini-3.8-flash` as backup. Every response is held to a JSON schema and checked with Zod. |
| Database | Supabase (Postgres + Realtime, Row Level Security: browsers can read, only the backend can write) |
| Dashboard | Vite + React on Vercel, reading Supabase directly and writing through the backend's API |

## Repository layout

```
app/                    Next.js backend + public website
  page.tsx              landing page + public alerts feed
  api/smsgate/          SMS gateway webhook (main entry point)
  api/chat/             same engine over JSON (web chat / testing)
  api/incidents/[id]/   confirm / resolve an incident
  api/tickets/[id]/     report status, "not spam", agency messages
  api/insights/         dashboard stats + AI shift briefing
lib/
  engine.ts             conversation rules
  emergency.ts          911 keyword intercept
  triage.ts             per-report AI: category, priority, credibility, follow-up question
  followup.ts           classifies texts sent after a report is submitted
  analyze.ts            incident grouping + re-prioritization (runs in the background)
  scoring.ts            priority score
  insights.ts           stats queries + cached AI briefing
  store.ts              Supabase persistence
  smsgate.ts, notify.ts sending SMS
agency-dashboard/       Vite + React agency dashboard (separate app)
supabase/               schema.sql, seed.sql, grants.sql
scripts/                chat.ts (terminal chat), register-webhook.ts
```

## Running it locally

**Prerequisites:** Node 20+, a [Supabase](https://supabase.com) project, and a [Gemini API key](https://aistudio.google.com/apikey). An Android phone is only needed for real SMS. You can test everything else from the terminal.

1. **Database.** In the Supabase SQL Editor, run [supabase/schema.sql](supabase/schema.sql), then [supabase/seed.sql](supabase/seed.sql) for sample data around USC. Running `seed.sql` again later resets the data.

2. **Backend.**
   ```bash
   npm install
   cp .env.example .env.local   # fill in GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY
   npm run dev                  # http://localhost:3000
   ```

3. **Talk to the bot without a phone.** This uses the real database but never sends an SMS.
   ```bash
   npm run chat
   CHAT_FROM=+15555550142 npm run chat   # pretend to be a second resident
   ```
   Or call the API directly:
   ```bash
   curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' \
     -d '{"sessionId":"demo","body":"Huge pothole on Figueroa and Jefferson"}'
   ```

4. **Dashboard.**
   ```bash
   cd agency-dashboard
   npm install
   cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_URL
   npm run dev                  # http://localhost:5173
   ```
   The dashboard only ever gets the Supabase *publishable* key. The secret key stays on the backend.

5. **Real SMS (optional).** Install SMS Gateway for Android on a phone with a SIM, turn on Cloud mode, add its credentials and signing key to `.env.local`, then register the webhook:
   ```bash
   npm run gateway:register -- https://<your-backend-host>
   ```
   Phone setup tips (Android 15 permissions, turning off RCS, battery settings) are in [ARCHITECTURE.md → Setup](ARCHITECTURE.md#setup).

All backend settings are documented in [.env.example](.env.example), including who the bot answers (`SMS_ALLOWED_NUMBERS`, `SMS_JOIN_KEYWORD`), the per-number report limit and the AI models.

## Things to try

- Report a pothole without saying where it is. The bot should ask for the location.
- "There are sparks coming off a power line". This should get the 911 reply.
- "The fire hydrant is leaking". This should *not* get the 911 reply.
- A report in Spanish.
- "test" or gibberish. It should show up under **Flagged reports** on the dashboard.
- The same problem from two numbers (`CHAT_FROM=…`). Both reports should land in one incident with a report count of 2.
- Confirm or Resolve that incident on the dashboard, then check the texts each "resident" received.

## What's next

- **Geocoding and a map**: turn location text into coordinates, pin incidents on a map colored by priority, match reports by distance, and catch made-up locations. The schema already has `lat`/`lng`. See the plan in [ARCHITECTURE.md](ARCHITECTURE.md#planned-geocoding--map-not-built).
- **Publish alert** from the dashboard. The public feed already reads published alerts.
- Photo reports, with AI describing what's in the picture.
