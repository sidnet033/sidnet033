-- User invite/active status, enable/disable, and access-matrix
-- refinements (view access + delete->archive) for the Admin Space.
--
-- Also tightens profiles RLS: the original "profiles self update" policy
-- (0001) let any authenticated user update *any* column on their own
-- row, including role -- a self-escalation-to-admin hole that predates
-- this migration. A trigger now blocks non-admins from changing
-- role/role_id/disabled on themselves, while still allowing the one
-- legitimate self-transition: status 'invited' -> 'active' when they
-- finish setting their password.

alter table profiles
  add column status text not null default 'active' check (status in ('invited', 'active')),
  add column disabled boolean not null default false;

alter table profiles alter column status set default 'invited';

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, email, status)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'sales', new.email, 'invited');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- called from the client right after a successful set-password, so a
-- newly invited user can flip their own row to "active"
create or replace function accept_invite()
returns void as $$
  update public.profiles set status = 'active' where id = auth.uid() and status = 'invited';
$$ language sql security definer set search_path = public;

grant execute on function accept_invite() to authenticated;

create or replace function prevent_self_privilege_escalation()
returns trigger as $$
begin
  if not is_admin() and auth.uid() = new.id then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change your role.';
    end if;
    if new.role_id is distinct from old.role_id then
      raise exception 'Only an admin can change your custom role.';
    end if;
    if new.disabled is distinct from old.disabled then
      raise exception 'Only an admin can enable or disable your account.';
    end if;
    if new.status is distinct from old.status and not (old.status = 'invited' and new.status = 'active') then
      raise exception 'You do not have permission to change this field.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_prevent_self_privilege_escalation on profiles;
create trigger trg_prevent_self_privilege_escalation
  before update on profiles
  for each row execute procedure prevent_self_privilege_escalation();

-- ── role_permissions: rename delete -> archive (matches the app's
-- actual soft-delete/archive model), add a view permission ──────────
alter table role_permissions rename column can_delete to can_archive;
alter table role_permissions add column can_view boolean not null default false;
