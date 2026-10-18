-- Community4You database schema. Paste into Supabase -> SQL Editor -> Run.
-- WARNING: re-running this drops and recreates every table (all data is lost).
-- Contract rules (see ARCHITECTURE.md): only ADD columns, never rename/remove.

drop table if exists messages cascade;
drop table if exists tickets cascade;
drop table if exists incidents cascade;
drop table if exists conversations cascade;
drop table if exists agencies cascade;

create table agencies (
  id text primary key,                       -- stable id used by the AI routing; never change
  name text not null,                        -- display name (safe to change)
  description text not null,
  categories text[] not null
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                       -- E.164 for SMS, 'web:<session>' for web chat
  channel text not null check (channel in ('sms', 'web')),
  state text not null default 'clarifying' check (state in ('clarifying', 'submitted', 'closed')),
  questions_asked int not null default 0,
  ticket_id bigint,                          -- FK added below (tickets references conversations too)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One real-world event (a fire, a pothole). Every non-spam ticket belongs to
-- one incident; lib/analyze.ts attaches reports and keeps the merged summary.
create table incidents (
  id bigint generated always as identity (start with 1001) primary key,
  agency_id text not null references agencies(id),
  category text not null check (category in
    ('INFRASTRUCTURE', 'PUBLIC_SAFETY', 'ENVIRONMENTAL', 'HUMAN_SERVICES', 'ANIMAL_CONTROL')),
  title text not null,                       -- 'Pothole at Figueroa St & Jefferson Blvd'
  summary text not null,                     -- AI-merged "what we know" from all reports
  location_text text,
  lat double precision,
  lng double precision,
  priority text not null check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  priority_reason text not null,
  priority_score int not null default 0,     -- dashboard sort key: priority + corroboration
  status text not null default 'active' check (status in ('active', 'confirmed', 'resolved')),
  report_count int not null default 1,
  first_reported_at timestamptz not null default now(),
  last_reported_at timestamptz not null default now(),
  alert_message text,                        -- "Publish alert" add-on
  alert_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tickets (
  id bigint generated always as identity (start with 101) primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  phone text not null,                       -- mask in the UI: (•••) •••-0123
  agency_id text not null references agencies(id),
  incident_id bigint references incidents(id) on delete set null,  -- null for spam / not yet analyzed

  -- single-tip triage (lib/triage.ts)
  category text not null check (category in
    ('INFRASTRUCTURE', 'PUBLIC_SAFETY', 'ENVIRONMENTAL', 'HUMAN_SERVICES', 'ANIMAL_CONTROL')),
  subcategory text not null,                 -- 'pothole', 'aggressive stray dog'
  summary text not null,                     -- one line for dispatchers
  suggested_action text,
  location_text text,
  lat double precision,                      -- null until geocoded (no map pin)
  lng double precision,
  hazard_type text,
  people_involved int,
  priority text not null check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  priority_reason text not null,
  is_emergency boolean not null default false,
  credibility text not null default 'ok' check (credibility in ('ok', 'suspicious', 'spam')),
  credibility_reason text,
  photo_url text,

  -- cross-tip analysis (lib/analyze.ts)
  duplicate_of bigint references tickets(id) on delete set null,  -- DEPRECATED: use incident_id
  report_count int not null default 1,       -- DEPRECATED: use incidents.report_count
  priority_score int not null default 0,     -- this report on its own
  analyzed_at timestamptz,

  -- workflow
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table conversations
  add constraint conversations_ticket_id_fkey foreign key (ticket_id) references tickets(id) on delete set null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender text not null check (sender in ('reporter', 'bot', 'agency')),
  body text not null,
  media_url text,
  created_at timestamptz not null default now()
);

-- Lookups the backend and dashboard do on every request.
create index conversations_phone_updated_idx on conversations (phone, updated_at desc);
create index incidents_open_sort_idx on incidents (status, priority_score desc, last_reported_at desc);
create index tickets_incident_idx on tickets (incident_id);
create index tickets_open_sort_idx on tickets (status, priority_score desc, created_at desc);
create index tickets_duplicate_of_idx on tickets (duplicate_of);
create index tickets_phone_idx on tickets (phone, created_at desc);
create index messages_conversation_idx on messages (conversation_id, created_at);

-- Newer Supabase projects don't auto-grant tables created in the SQL Editor.
-- Browser (publishable key) roles: read only. Backend (secret key): everything.
grant usage on schema public to anon, authenticated, service_role;
grant select on agencies, conversations, incidents, tickets, messages to anon, authenticated;
grant all on agencies, conversations, incidents, tickets, messages to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Anyone with the publishable key can read; only the backend's secret key
-- (which bypasses RLS) can write.
alter table agencies enable row level security;
alter table conversations enable row level security;
alter table incidents enable row level security;
alter table tickets enable row level security;
alter table messages enable row level security;
create policy "public read" on agencies for select using (true);
create policy "public read" on conversations for select using (true);
create policy "public read" on incidents for select using (true);
create policy "public read" on tickets for select using (true);
create policy "public read" on messages for select using (true);

-- Live updates for the dashboard.
alter publication supabase_realtime add table incidents, tickets, messages;
