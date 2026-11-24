-- Blindspot: link each Blindspot user to a Supabase login.
--
-- auth.users is Supabase's own table of logins. Each row in our users table points
-- at one login. The single pre-login user row (from v1) is linked automatically
-- the first time an allowed person signs in, so existing settings and games are kept.

alter table users
  add column auth_user_id uuid unique references auth.users(id) on delete set null;
