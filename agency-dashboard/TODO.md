# Dashboard: what to build next

The backend (SMS, AI, database) is done and deployed. This file is everything the dashboard needs to plug into it. Background is in [`../ARCHITECTURE.md`](../ARCHITECTURE.md): read **Two apps, one database**, **Data model**, **API routes the dashboard calls**, and the **D** tasks in **Build plan**.

| | URL |
|---|---|
| Backend (API) | https://community4you.vercel.app |
| Dashboard (this app) | https://community4you-xaix.vercel.app |
| Supabase project | https://jarmwkvuycptwlyekfve.supabase.co |

## 1. Setup

The repo moved to Andy's account. Accept the GitHub collaborator invite, then:
```
git remote set-url origin https://github.com/leeandyg/Community4you.git
git pull
cd agency-dashboard
npm i @supabase/supabase-js
```

Create `agency-dashboard/.env.local` (it's gitignored):
```
VITE_SUPABASE_URL=https://jarmwkvuycptwlyekfve.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_... key from Andy>
VITE_API_URL=https://community4you.vercel.app
```
Only ever use the **publishable** key. The secret key never goes in the dashboard.

Deploying is automatic: every push to `main` redeploys the dashboard. Run `npm run build` before pushing to catch errors.

## 2. Clean up (D1)

Delete what's out of scope: Resources, Alerts, Login and Settings (`ResourceCard`, the Sidebar/Navbar links), plus the hardcoded `organizations` and `reports` arrays. Agencies come from the database.

## 3. Read from Supabase (D2)

```js
// src/supabase.js
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
```

| Data | Query |
|---|---|
| Agencies (filter dropdown) | `supabase.from("agencies").select("id, name, description")` |
| **Main list: open incidents** | `supabase.from("incidents").select("*, agencies(name)").neq("status", "resolved").order("priority_score", { ascending: false }).order("last_reported_at", { ascending: false })` |
| An incident's reports | `supabase.from("tickets").select("*").eq("incident_id", id).order("created_at")` |
| A report's text conversation | `supabase.from("messages").select("*").eq("conversation_id", ticket.conversation_id).order("created_at")` |
| Flagged reports | `supabase.from("tickets").select("*").neq("credibility", "ok").order("created_at", { ascending: false })` |

Live updates: refetch whenever anything changes.
```js
supabase.channel("live")
  .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, refetch)
  .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, refetch)
  .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refetch)
  .subscribe();
```

## 4. Incident list as the main view (D3)

An **incident** is one real-world event (a fire, a pothole). The AI groups residents' reports (`tickets`) into incidents, so three texts about one pothole are one incident with `report_count = 3`.

Two queues:
- **Needs attention:** `status = 'active'` (detected by AI, nobody has checked it yet)
- **In progress:** `status = 'confirmed'` (staff verified it and own it)
- Optionally a **Resolved** tab

**Incident card:**
- `title`, `agencies.name`, `summary` (the AI merges everything known from all reports)
- **priority badge**: CRITICAL red, HIGH orange, MEDIUM yellow, LOW gray
- **report count** ("3 reports")
- status, and time since `last_reported_at` ("12 min ago")

**Expanding a card** shows each report (ticket):
- `summary` and **"AI suggests: `suggested_action`"**
- `location_text`, plus a 🚨 badge if `is_emergency`
- a credibility badge with `credibility_reason` when `credibility` isn't `ok`
- the phone **masked**: `(•••) •••-0123`
- the text conversation (`messages`; `sender` is `reporter`, `bot` or `agency`)

## 5. Filters (D5)

"Viewing as" agency, category, status, and a **Flagged** view (spam and suspicious reports; spam never becomes an incident).

## 6. Buttons (D6)

Buttons call the **backend**, never Supabase directly, because the backend texts the residents. The database also blocks browser writes.

```js
const api = (path, method, body) =>
  fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => (r.ok ? r.json() : Promise.reject(r)));

api(`/api/incidents/${id}`, "PATCH", { status: "confirmed" });             // Confirm (active incidents)
api(`/api/incidents/${id}`, "PATCH", { status: "resolved" });              // Resolve
api(`/api/tickets/${ticketId}`, "PATCH", { status: "in_progress" });       // one report: in_progress | resolved
api(`/api/tickets/${ticketId}/messages`, "POST", { body: "Crew arrives at 3pm" }); // message the resident
```

| Button | What the backend does |
|---|---|
| Confirm | Incident → `confirmed`, its `new` reports → `in_progress`, texts every reporter "…has confirmed it and is responding" |
| Resolve | Incident and its reports → `resolved`, texts every reporter "…marked it resolved. Thanks for reporting!" |
| Report status | Updates one report and texts that resident |
| Message | Texts the resident "<Agency>: <your message>"; their reply joins the same conversation |

The screen updates by itself through Realtime once the backend saves the change. Show an error if a request fails.

## 7. Stats row + AI shift briefing (D7)

```js
const res = await fetch(`${import.meta.env.VITE_API_URL}/api/insights`); // add ?agency=streets when "Viewing as" is set
const { counts, needsAttention, hotspots, summary } = await res.json();
```
- `counts`: `openIncidents`, `byPriority`, `byCategory`, `byStatus`, `byAgency`, `reportsLast24h`, `flaggedLast24h`, `resolvedLast24h`
- `needsAttention`: top unconfirmed incidents; `hotspots`: incidents with 2+ reports
- `summary`: a 2–4 sentence AI briefing. Show it in a "Shift briefing" box.

Re-fetching after each Realtime update is fine: the backend caches the AI summary. Add `?summary=false` to skip the AI entirely.

## 8. Rules

- Use the exact values in data and API calls; **display** them however you like ("Pending", "Under Review"):
  - priority: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
  - ticket status: `new`, `in_progress`, `resolved`
  - incident status: `active`, `confirmed`, `resolved`
  - credibility: `ok`, `suspicious`, `spam`
- Don't hardcode agencies; read them from the `agencies` table.
- Need a new column? Ask Andy. Columns are only ever added, never renamed.
- Ignore `tickets.duplicate_of` and `tickets.report_count`. They're deprecated; use `incident_id` and `incidents.report_count`.

## 9. Testing without a phone

Send a fake report to the live backend. It shows up on the dashboard about 2 seconds later, and joins an incident a few seconds after that.
```
curl -X POST https://community4you.vercel.app/api/chat -H "Content-Type: application/json" \
  -d '{"sessionId":"test1","body":"pothole at vermont and 30th, really deep"}'
```
- A different `sessionId` acts as a different person. Two people sending the same problem should merge into one incident.
- Web-chat reports aren't texted anything; their updates just appear in `messages`.
- Tell Andy afterwards so the test data gets cleaned up.

## Done when

- [ ] D1 cleanup
- [ ] D2 Supabase reads + Realtime
- [ ] D3 incident list (Needs attention / In progress) with expandable reports
- [ ] D5 filters + Flagged view
- [ ] D6 Confirm / Resolve / report status / message buttons
- [ ] D7 stats row + shift briefing
- Add-ons later: map (D4, seed data already has `lat`/`lng`), Publish alert (D5b, confirmed incidents only)
