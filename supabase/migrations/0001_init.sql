-- LV Switchboard BOM / Costing / GA app - initial schema

create extension if not exists "pgcrypto";

-- ── Users & roles ────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  created_at timestamptz not null default now()
);

-- auto-create a profile row whenever a new auth user signs up / is invited
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'sales');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Item master ──────────────────────────────────────────────────
create table if not exists item_master (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  description text not null,
  category text,
  uom text not null default 'nos',
  unit_cost numeric(14, 2) not null default 0,
  supplier text,
  notes text,
  updated_at timestamptz not null default now()
);

-- ── Feeder library ───────────────────────────────────────────────
create table if not exists feeders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text, -- e.g. Incomer, Outgoing, Bus Coupler, APFC
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feeder_items (
  id uuid primary key default gen_random_uuid(),
  feeder_id uuid not null references feeders (id) on delete cascade,
  item_id uuid not null references item_master (id) on delete restrict,
  qty numeric(12, 2) not null default 1,
  created_at timestamptz not null default now()
);

-- ── Projects (quotes) ────────────────────────────────────────────
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_name text,
  status text not null default 'draft' check (status in ('draft', 'quoted', 'won', 'lost')),
  margin_pct numeric(6, 2) not null default 15,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- a "vertical" is one column/section of the switchboard GA
create table if not exists verticals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  width_mm numeric(10, 1),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- a feeder placed inside a vertical on the canvas
create table if not exists placed_feeders (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references verticals (id) on delete cascade,
  feeder_id uuid not null references feeders (id) on delete restrict,
  label_override text,
  qty int not null default 1,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_feeder_items_feeder on feeder_items (feeder_id);
create index if not exists idx_verticals_project on verticals (project_id);
create index if not exists idx_placed_feeders_vertical on placed_feeders (vertical_id);

-- ── Row level security ───────────────────────────────────────────
alter table profiles enable row level security;
alter table item_master enable row level security;
alter table feeders enable row level security;
alter table feeder_items enable row level security;
alter table projects enable row level security;
alter table verticals enable row level security;
alter table placed_feeders enable row level security;

create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer set search_path = public;

-- profiles: everyone can read all profiles (small internal team); only the
-- user themself (or an admin) can update their own row
create policy "profiles read" on profiles for select to authenticated using (true);
create policy "profiles self update" on profiles for update to authenticated
  using (id = auth.uid() or is_admin());

-- item_master: all logged-in users can read; only admins can write
create policy "item_master read" on item_master for select to authenticated using (true);
create policy "item_master write" on item_master for insert to authenticated with check (is_admin());
create policy "item_master update" on item_master for update to authenticated using (is_admin());
create policy "item_master delete" on item_master for delete to authenticated using (is_admin());

-- feeders + feeder_items: all logged-in users can read; only admins can write
create policy "feeders read" on feeders for select to authenticated using (true);
create policy "feeders write" on feeders for insert to authenticated with check (is_admin());
create policy "feeders update" on feeders for update to authenticated using (is_admin());
create policy "feeders delete" on feeders for delete to authenticated using (is_admin());

create policy "feeder_items read" on feeder_items for select to authenticated using (true);
create policy "feeder_items write" on feeder_items for insert to authenticated with check (is_admin());
create policy "feeder_items update" on feeder_items for update to authenticated using (is_admin());
create policy "feeder_items delete" on feeder_items for delete to authenticated using (is_admin());

-- projects/verticals/placed_feeders: any logged-in user (sales or admin) can
-- read and manage all of them (small internal team quoting tool)
create policy "projects all" on projects for all to authenticated using (true) with check (true);
create policy "verticals all" on verticals for all to authenticated using (true) with check (true);
create policy "placed_feeders all" on placed_feeders for all to authenticated using (true) with check (true);
