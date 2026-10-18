# Community4You demo setup

## 1. Update the existing Supabase database

In Supabase, open **SQL Editor**, paste the contents of
`supabase/dashboard-extension.sql`, and click **Run**. This adds the
`published_at` field without deleting your existing reports.

Make sure Realtime is enabled for the `tickets` and `messages` tables.

## 2. Configure the backend/public website

At the repository root, copy `.env.example` to `.env.local`. Keep the
Supabase **secret** key only here. Add the URL of the dashboard:

```env
NEXT_PUBLIC_DASHBOARD_URL=http://localhost:5173
```

Run:

```bash
cd /workspaces/Community4you
npm install
npm run dev
```

The public alert website and backend API run at <http://localhost:3000>.

## 3. Configure the agency dashboard

Copy `agency-dashboard/.env.example` to
`agency-dashboard/.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_SAFE_KEY
VITE_API_URL=http://localhost:3000
```

Do not put `SUPABASE_SECRET_KEY` in this file.

In a second terminal, run:

```bash
cd /workspaces/Community4you/agency-dashboard
npm install
npm run dev
```

The private agency website runs at <http://localhost:5173>.

## 4. Demo flow

1. Send an SMS to the connected Android SMS Gateway phone.
2. Gemini asks for any missing detail and saves the structured ticket.
3. Supabase Realtime inserts it into the agency dashboard without a refresh.
4. Select the report and click **Begin review**. The backend updates Supabase
   and sends an SMS update to the reporter.
5. Click **Publish public alert**.
6. Refresh the public site at <http://localhost:3000>. The verified alert is
   visible without the reporter's phone number or private conversation.
7. Click **Resolve** to update the database and notify the reporter by SMS.

If an action reports a backend error, first confirm that both development
servers are running and that the root `.env.local` contains the SMS Gateway
and Supabase server credentials.
