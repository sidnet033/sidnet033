-- Accounts: @paikane.com only, and created only by an admin invite.
-- A Google sign-in by someone who wasn't invited would otherwise create a
-- new auth user; this rejects it (Supabase reports "Database error saving
-- new user", which the app's /auth/callback shows as "not set up yet").
-- Existing users signing in with Google for the first time are linked to
-- their account (no new auth.users row), so they're unaffected.
create or replace function public.guard_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email, '')) not like '%@paikane.com' then
    raise exception 'Only @paikane.com accounts are allowed';
  end if;
  -- an admin invite creates the user with provider "email"; a user that
  -- appears straight from a Google sign-in was never invited (the app's
  -- /auth/callback also refuses any user without invited_at)
  if coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'email' then
    raise exception 'Account must be invited by an admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_new_auth_user on auth.users;
create trigger trg_guard_new_auth_user before insert on auth.users
  for each row execute function public.guard_new_auth_user();
