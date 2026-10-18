-- Safe migration for an existing project. Run once in Supabase SQL Editor.
alter table tickets add column if not exists published_at timestamptz;
