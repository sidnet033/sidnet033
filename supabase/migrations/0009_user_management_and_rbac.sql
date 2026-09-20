-- User management + role-based access matrix for the Admin Space.
--
-- IMPORTANT: this adds a *management layer* for custom roles and a
-- create/edit/delete permission matrix per resource -- it stores the
-- data and lets admins define it, but nothing in the app's existing RLS
-- policies reads from role_permissions yet. Actual access control still
-- runs on profiles.role ('admin' | 'sales') via is_admin(), exactly as
-- before. Wiring role_permissions into real enforcement across every
-- table is a separate, larger follow-up.

-- ── profiles: email (needed to list/invite/reset users), custom role ─
alter table profiles
  add column email text,
  add column role_id uuid;

update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'sales', new.email);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ── custom roles + per-resource create/edit/delete matrix ───────────
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles (id) on delete cascade,
  resource text not null,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  unique (role_id, resource)
);

alter table profiles add constraint profiles_role_id_fkey foreign key (role_id) references roles (id) on delete set null;

alter table roles enable row level security;
alter table role_permissions enable row level security;

create index if not exists idx_role_permissions_role on role_permissions (role_id);

-- admin-only: this is a management surface, not something the rest of
-- the app currently reads to decide access, so no other role needs it.
create policy "roles admin all" on roles for all to authenticated using (is_admin()) with check (is_admin());
create policy "role_permissions admin all" on role_permissions for all to authenticated using (is_admin()) with check (is_admin());

revoke all on roles from anon;
revoke all on role_permissions from anon;
