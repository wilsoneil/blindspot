-- Blindspot: let the server-side key use the tables.
--
-- Newer Supabase projects don't automatically grant API roles access to tables
-- created in the SQL Editor, so 0001 alone gave "permission denied for table users".
-- Only service_role (the secret key, kept in Vercel / GitHub settings) gets access.
-- anon and authenticated (the public keys) still get nothing.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Tables added by later migrations get the same access automatically.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
