-- Locking, revisions, archiving, catalog fields, ad-hoc project feeders

-- ── item_master: fuller catalog fields ────────────────────────────
alter table item_master rename column item_code to sku;
alter table item_master drop constraint item_master_item_code_key;
alter table item_master alter column sku drop not null;

alter table item_master
  add column vendor_cat text,
  add column make text,
  add column status text not null default 'active',
  add column amps numeric(10, 2),
  add column ka numeric(10, 2),
  add column poles integer;

alter table item_master
  add constraint item_master_sku_or_vendor_cat_check
  check (sku is not null or vendor_cat is not null);

create index if not exists idx_item_master_sku on item_master (sku);
create index if not exists idx_item_master_vendor_cat on item_master (vendor_cat);

-- ── projects: locking, archiving, revisions ───────────────────────
alter table projects
  add column locked_by uuid references profiles (id) on delete set null,
  add column locked_at timestamptz,
  add column archived boolean not null default false,
  add column revision_number integer not null default 1,
  add column revision_group_id uuid not null default gen_random_uuid();

create index if not exists idx_projects_revision_group on projects (revision_group_id);

-- ── feeders: ad-hoc project-scoped feeders + shared-library flag ─
alter table feeders
  add column project_id uuid references projects (id) on delete cascade,
  add column is_library boolean not null default true;

create index if not exists idx_feeders_project on feeders (project_id);

-- ── Lock / unlock / archive / unarchive / revision RPCs ──────────
-- Each function re-checks auth.uid() itself (SECURITY DEFINER bypasses RLS),
-- and EXECUTE is revoked from anon/public so only signed-in users can call them.

create or replace function lock_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_project from projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;
  if v_project.archived then
    raise exception 'Project is archived';
  end if;
  if v_project.locked_by is not null and v_project.locked_by <> auth.uid() then
    raise exception 'Project is already locked by another user';
  end if;

  update projects set locked_by = auth.uid(), locked_at = now() where id = p_project_id;
end;
$$;

create or replace function unlock_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_project from projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;
  if v_project.locked_by is null then
    return;
  end if;
  if v_project.locked_by <> auth.uid() and not is_admin() then
    raise exception 'Only the user holding the lock or an admin can release it';
  end if;

  update projects set locked_by = null, locked_at = null where id = p_project_id;
end;
$$;

create or replace function archive_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_project from projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;
  if v_project.archived then
    return;
  end if;
  if v_project.locked_by is not null and v_project.locked_by <> auth.uid() and not is_admin() then
    raise exception 'Project is locked by another user';
  end if;

  update projects set archived = true, locked_by = null, locked_at = null where id = p_project_id;
end;
$$;

create or replace function unarchive_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_project from projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;
  if not v_project.archived then
    return;
  end if;
  if v_project.created_by <> auth.uid() and not is_admin() then
    raise exception 'Only the project creator or an admin can un-archive it';
  end if;

  update projects set archived = false where id = p_project_id;
end;
$$;

create or replace function create_project_revision(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source projects%rowtype;
  v_new_project_id uuid;
  v_next_revision int;
  v_vertical record;
  v_new_vertical_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_source from projects where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next_revision
  from projects where revision_group_id = v_source.revision_group_id;

  insert into projects (name, customer_name, status, margin_pct, created_by, revision_group_id, revision_number)
  values (v_source.name, v_source.customer_name, 'draft', v_source.margin_pct, auth.uid(), v_source.revision_group_id, v_next_revision)
  returning id into v_new_project_id;

  for v_vertical in select * from verticals where project_id = p_project_id order by sort_order loop
    insert into verticals (project_id, name, width_mm, sort_order)
    values (v_new_project_id, v_vertical.name, v_vertical.width_mm, v_vertical.sort_order)
    returning id into v_new_vertical_id;

    insert into placed_feeders (vertical_id, feeder_id, label_override, qty, sort_order)
    select v_new_vertical_id, pf.feeder_id, pf.label_override, pf.qty, pf.sort_order
    from placed_feeders pf
    where pf.vertical_id = v_vertical.id;
  end loop;

  return v_new_project_id;
end;
$$;

revoke all on function lock_project(uuid) from public;
revoke all on function unlock_project(uuid) from public;
revoke all on function archive_project(uuid) from public;
revoke all on function unarchive_project(uuid) from public;
revoke all on function create_project_revision(uuid) from public;

-- Supabase grants EXECUTE to anon/authenticated directly on function
-- creation (not just via PUBLIC), so anon needs an explicit revoke too.
revoke execute on function lock_project(uuid) from anon;
revoke execute on function unlock_project(uuid) from anon;
revoke execute on function archive_project(uuid) from anon;
revoke execute on function unarchive_project(uuid) from anon;
revoke execute on function create_project_revision(uuid) from anon;

grant execute on function lock_project(uuid) to authenticated;
grant execute on function unlock_project(uuid) to authenticated;
grant execute on function archive_project(uuid) to authenticated;
grant execute on function unarchive_project(uuid) to authenticated;
grant execute on function create_project_revision(uuid) to authenticated;

-- ── Tighten RLS: projects (lock + archive aware) ──────────────────
drop policy "projects all" on projects;

create policy "projects select" on projects for select to authenticated using (true);
create policy "projects insert" on projects for insert to authenticated with check (true);
create policy "projects update" on projects for update to authenticated
  using (not archived and (locked_by is null or locked_by = auth.uid() or is_admin()));

-- ── Tighten RLS: verticals (lock + archive aware, via project) ────
drop policy "verticals all" on verticals;

create policy "verticals select" on verticals for select to authenticated using (true);
create policy "verticals write" on verticals for all to authenticated
  using (exists (
    select 1 from projects p
    where p.id = verticals.project_id
      and not p.archived
      and (p.locked_by is null or p.locked_by = auth.uid() or is_admin())
  ));

-- ── Tighten RLS: placed_feeders (lock + archive aware, via vertical/project) ─
drop policy "placed_feeders all" on placed_feeders;

create policy "placed_feeders select" on placed_feeders for select to authenticated using (true);
create policy "placed_feeders write" on placed_feeders for all to authenticated
  using (exists (
    select 1 from verticals v
    join projects p on p.id = v.project_id
    where v.id = placed_feeders.vertical_id
      and not p.archived
      and (p.locked_by is null or p.locked_by = auth.uid() or is_admin())
  ));

-- ── feeders: any user can create/edit drafts; admin curates once promoted ─
drop policy "feeders write" on feeders;
drop policy "feeders update" on feeders;
drop policy "feeders delete" on feeders;

create policy "feeders insert" on feeders for insert to authenticated with check (true);
create policy "feeders update" on feeders for update to authenticated using (is_admin() or not is_library);
create policy "feeders delete" on feeders for delete to authenticated using (is_admin() or not is_library);

drop policy "feeder_items write" on feeder_items;
drop policy "feeder_items update" on feeder_items;
drop policy "feeder_items delete" on feeder_items;

create policy "feeder_items insert" on feeder_items for insert to authenticated
  with check (exists (select 1 from feeders f where f.id = feeder_items.feeder_id and (is_admin() or not f.is_library)));
create policy "feeder_items update" on feeder_items for update to authenticated
  using (exists (select 1 from feeders f where f.id = feeder_items.feeder_id and (is_admin() or not f.is_library)));
create policy "feeder_items delete" on feeder_items for delete to authenticated
  using (exists (select 1 from feeders f where f.id = feeder_items.feeder_id and (is_admin() or not f.is_library)));
