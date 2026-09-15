-- Customer -> Project -> Revision -> Switchboard hierarchy.
-- The old "projects" table (one row = one flat quote/BOM/GA) becomes
-- "revisions" (one row = one revision, same lock/archive/revision
-- machinery as before), nested under a new top-level "projects" table
-- (PRJ-24-089 style container) which in turn belongs to a "customers"
-- table. Each revision can now hold multiple "switchboards", and the
-- BOM/GA (verticals/placed_feeders/ad-hoc feeders) move one level
-- down to hang off a switchboard instead of a project directly.

-- ── customers ──────────────────────────────────────────────────────
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table customers enable row level security;
create policy "customers all" on customers for all to authenticated using (true) with check (true);

-- ── rename the old flat "projects" table to "revisions" ────────────
alter table projects rename to revisions;

-- ── new top-level "projects" table ──────────────────────────────────
create sequence if not exists project_code_seq start 1;

create or replace function set_project_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null then
    new.code := 'PRJ-' || to_char(now(), 'YY') || '-' || lpad(nextval('project_code_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers (id) on delete set null,
  code text unique,
  title text not null,
  notes text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_set_project_code on projects;
create trigger trg_set_project_code
  before insert on projects
  for each row execute procedure set_project_code();

alter table projects enable row level security;
create policy "projects all" on projects for all to authenticated using (true) with check (true);

create index if not exists idx_projects_customer on projects (customer_id);

-- ── link revisions -> projects, backfilling from existing data ─────
alter table revisions add column project_id uuid references projects (id) on delete cascade;

do $$
declare
  v_group record;
  v_customer_id uuid;
  v_project_id uuid;
  v_counter int := 0;
begin
  for v_group in
    select revision_group_id,
           min(created_at) as first_created,
           (array_agg(name order by revision_number))[1] as project_title,
           (array_agg(customer_name order by revision_number))[1] as customer_name,
           (array_agg(created_by order by revision_number))[1] as created_by
    from revisions
    group by revision_group_id
  loop
    v_counter := v_counter + 1;

    if v_group.customer_name is not null and length(trim(v_group.customer_name)) > 0 then
      select id into v_customer_id from customers where name = v_group.customer_name limit 1;
      if v_customer_id is null then
        insert into customers (name) values (v_group.customer_name) returning id into v_customer_id;
      end if;
    else
      select id into v_customer_id from customers where name = 'Unassigned' limit 1;
      if v_customer_id is null then
        insert into customers (name) values ('Unassigned') returning id into v_customer_id;
      end if;
    end if;

    insert into projects (customer_id, title, created_by, created_at)
    values (v_customer_id, coalesce(v_group.project_title, 'Untitled project'), v_group.created_by, v_group.first_created)
    returning id into v_project_id;

    update revisions set project_id = v_project_id where revision_group_id = v_group.revision_group_id;
  end loop;
end $$;

alter table revisions alter column project_id set not null;

-- ── switchboards ─────────────────────────────────────────────────
create table if not exists switchboards (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisions (id) on delete cascade,
  tag text not null,
  title text,
  form_of_separation text,
  plinth_height_mm numeric(10, 1),
  panel_height_mm numeric(10, 1),
  amps numeric(10, 2),
  ka numeric(10, 2),
  poles integer,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table switchboards enable row level security;
create index if not exists idx_switchboards_revision on switchboards (revision_id);

-- ── verticals/feeders move from revision-scoped to switchboard-scoped ─
alter table verticals add column switchboard_id uuid references switchboards (id) on delete cascade;
alter table feeders add column switchboard_id uuid references switchboards (id) on delete cascade;

do $$
declare
  v_rev record;
  v_sb_id uuid;
begin
  for v_rev in select id from revisions loop
    insert into switchboards (revision_id, tag, title, sort_order)
    values (v_rev.id, 'SB-01', 'Board 1', 0)
    returning id into v_sb_id;

    update verticals set switchboard_id = v_sb_id where project_id = v_rev.id;
    update feeders set switchboard_id = v_sb_id where project_id = v_rev.id;
  end loop;
end $$;

-- old policies reference verticals.project_id (directly, or transitively
-- via placed_feeders -> verticals), so they must go before the column does
drop policy if exists "verticals write" on verticals;
drop policy if exists "placed_feeders write" on placed_feeders;

alter table verticals alter column switchboard_id set not null;
alter table verticals drop column project_id;
alter table feeders drop column project_id;

create index if not exists idx_verticals_switchboard on verticals (switchboard_id);
create index if not exists idx_feeders_switchboard on feeders (switchboard_id);

-- ── new physical-layout / BOM columns ────────────────────────────
alter table verticals
  add column depth_mm numeric(10, 1),
  add column bay_type text;

alter table placed_feeders
  add column tier_number int not null default 1;

alter table feeders
  add column tag text,
  add column rating_summary text;

alter table item_master
  add column list_price numeric(14, 2),
  add column discount_pct numeric(6, 2);

-- ── Lock / unlock / archive / unarchive / revision RPCs, renamed ────
-- (old table "projects" is now "revisions" so the old function bodies
-- are stale; drop and recreate under revision-scoped names)
drop function if exists lock_project(uuid);
drop function if exists unlock_project(uuid);
drop function if exists archive_project(uuid);
drop function if exists unarchive_project(uuid);
drop function if exists create_project_revision(uuid);

create or replace function lock_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision revisions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_revision from revisions where id = p_revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;
  if v_revision.archived then
    raise exception 'Revision is archived';
  end if;
  if v_revision.locked_by is not null and v_revision.locked_by <> auth.uid() then
    raise exception 'Revision is already locked by another user';
  end if;

  update revisions set locked_by = auth.uid(), locked_at = now() where id = p_revision_id;
end;
$$;

create or replace function unlock_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision revisions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_revision from revisions where id = p_revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;
  if v_revision.locked_by is null then
    return;
  end if;
  if v_revision.locked_by <> auth.uid() and not is_admin() then
    raise exception 'Only the user holding the lock or an admin can release it';
  end if;

  update revisions set locked_by = null, locked_at = null where id = p_revision_id;
end;
$$;

create or replace function archive_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision revisions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_revision from revisions where id = p_revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;
  if v_revision.archived then
    return;
  end if;
  if v_revision.locked_by is not null and v_revision.locked_by <> auth.uid() and not is_admin() then
    raise exception 'Revision is locked by another user';
  end if;

  update revisions set archived = true, locked_by = null, locked_at = null where id = p_revision_id;
end;
$$;

create or replace function unarchive_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision revisions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_revision from revisions where id = p_revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;
  if not v_revision.archived then
    return;
  end if;
  if v_revision.created_by <> auth.uid() and not is_admin() then
    raise exception 'Only the revision creator or an admin can un-archive it';
  end if;

  update revisions set archived = false where id = p_revision_id;
end;
$$;

create or replace function create_revision(p_revision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source revisions%rowtype;
  v_new_revision_id uuid;
  v_next_revision int;
  v_sb record;
  v_new_sb_id uuid;
  v_vertical record;
  v_new_vertical_id uuid;
  v_feeder record;
  v_new_feeder_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_source from revisions where id = p_revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;

  create temporary table if not exists _revision_clone_feeder_map (
    old_feeder_id uuid,
    new_feeder_id uuid
  ) on commit drop;
  truncate _revision_clone_feeder_map;

  select coalesce(max(revision_number), 0) + 1 into v_next_revision
  from revisions where revision_group_id = v_source.revision_group_id;

  insert into revisions (project_id, name, customer_name, status, margin_pct, created_by, revision_group_id, revision_number)
  values (v_source.project_id, v_source.name, v_source.customer_name, 'draft', v_source.margin_pct, auth.uid(), v_source.revision_group_id, v_next_revision)
  returning id into v_new_revision_id;

  for v_sb in select * from switchboards where revision_id = p_revision_id order by sort_order loop
    insert into switchboards (revision_id, tag, title, form_of_separation, plinth_height_mm, panel_height_mm, amps, ka, poles, sort_order)
    values (v_new_revision_id, v_sb.tag, v_sb.title, v_sb.form_of_separation, v_sb.plinth_height_mm, v_sb.panel_height_mm, v_sb.amps, v_sb.ka, v_sb.poles, v_sb.sort_order)
    returning id into v_new_sb_id;

    for v_feeder in select * from feeders where switchboard_id = v_sb.id and not is_library loop
      insert into feeders (name, description, category, switchboard_id, is_library, tag, rating_summary, created_by)
      values (v_feeder.name, v_feeder.description, v_feeder.category, v_new_sb_id, false, v_feeder.tag, v_feeder.rating_summary, auth.uid())
      returning id into v_new_feeder_id;

      insert into feeder_items (feeder_id, item_id, qty)
      select v_new_feeder_id, fi.item_id, fi.qty from feeder_items fi where fi.feeder_id = v_feeder.id;

      insert into _revision_clone_feeder_map (old_feeder_id, new_feeder_id) values (v_feeder.id, v_new_feeder_id);
    end loop;

    for v_vertical in select * from verticals where switchboard_id = v_sb.id order by sort_order loop
      insert into verticals (switchboard_id, name, width_mm, depth_mm, bay_type, sort_order)
      values (v_new_sb_id, v_vertical.name, v_vertical.width_mm, v_vertical.depth_mm, v_vertical.bay_type, v_vertical.sort_order)
      returning id into v_new_vertical_id;

      insert into placed_feeders (vertical_id, feeder_id, label_override, qty, sort_order, tier_number)
      select v_new_vertical_id,
             coalesce((select new_feeder_id from _revision_clone_feeder_map where old_feeder_id = pf.feeder_id), pf.feeder_id),
             pf.label_override, pf.qty, pf.sort_order, pf.tier_number
      from placed_feeders pf
      where pf.vertical_id = v_vertical.id;
    end loop;
  end loop;

  return v_new_revision_id;
end;
$$;

revoke all on function lock_revision(uuid) from public;
revoke all on function unlock_revision(uuid) from public;
revoke all on function archive_revision(uuid) from public;
revoke all on function unarchive_revision(uuid) from public;
revoke all on function create_revision(uuid) from public;

revoke execute on function lock_revision(uuid) from anon;
revoke execute on function unlock_revision(uuid) from anon;
revoke execute on function archive_revision(uuid) from anon;
revoke execute on function unarchive_revision(uuid) from anon;
revoke execute on function create_revision(uuid) from anon;

grant execute on function lock_revision(uuid) to authenticated;
grant execute on function unlock_revision(uuid) to authenticated;
grant execute on function archive_revision(uuid) to authenticated;
grant execute on function unarchive_revision(uuid) to authenticated;
grant execute on function create_revision(uuid) to authenticated;

-- ── RLS: revisions (renamed from "projects", same lock/archive logic) ─
drop policy if exists "projects select" on revisions;
drop policy if exists "projects insert" on revisions;
drop policy if exists "projects update" on revisions;

create policy "revisions select" on revisions for select to authenticated using (true);
create policy "revisions insert" on revisions for insert to authenticated with check (true);
create policy "revisions update" on revisions for update to authenticated
  using (not archived and (locked_by is null or locked_by = auth.uid() or is_admin()));

-- ── RLS: switchboards (lock + archive aware, via revision) ──────────
create policy "switchboards select" on switchboards for select to authenticated using (true);
create policy "switchboards write" on switchboards for all to authenticated
  using (exists (
    select 1 from revisions r
    where r.id = switchboards.revision_id
      and not r.archived
      and (r.locked_by is null or r.locked_by = auth.uid() or is_admin())
  ));

-- ── RLS: verticals (lock + archive aware, via switchboard/revision) ──
drop policy if exists "verticals write" on verticals;

create policy "verticals write" on verticals for all to authenticated
  using (exists (
    select 1 from switchboards sb
    join revisions r on r.id = sb.revision_id
    where sb.id = verticals.switchboard_id
      and not r.archived
      and (r.locked_by is null or r.locked_by = auth.uid() or is_admin())
  ));

-- ── RLS: placed_feeders (lock + archive aware, via vertical/switchboard/revision) ─
drop policy if exists "placed_feeders write" on placed_feeders;

create policy "placed_feeders write" on placed_feeders for all to authenticated
  using (exists (
    select 1 from verticals v
    join switchboards sb on sb.id = v.switchboard_id
    join revisions r on r.id = sb.revision_id
    where v.id = placed_feeders.vertical_id
      and not r.archived
      and (r.locked_by is null or r.locked_by = auth.uid() or is_admin())
  ));

-- set_project_code() is a trigger function; it never needs to be called
-- directly via the exposed RPC API (trigger firing doesn't require the
-- invoking role to hold EXECUTE on it).
revoke all on function set_project_code() from public;
revoke execute on function set_project_code() from anon;
revoke execute on function set_project_code() from authenticated;
