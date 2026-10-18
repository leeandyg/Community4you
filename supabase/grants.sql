-- One-time fix for databases created before schema.sql included grants.
-- Safe to run any time; doesn't touch data. (schema.sql now includes these.)
grant usage on schema public to anon, authenticated, service_role;
grant select on agencies, conversations, incidents, tickets, messages to anon, authenticated;
grant all on agencies, conversations, incidents, tickets, messages to service_role;
grant usage, select on all sequences in schema public to service_role;
