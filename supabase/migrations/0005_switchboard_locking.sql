-- Move locking from revision-level to switchboard-level: two users can
-- now work on two different switchboards of the same project revision
-- at once. Revision keeps only "archived" as its read-only flag.

alter table switchboards
  add column locked_by uuid references profiles (id) on delete set null,
  add column locked_at timestamptz;

-- old policies reference revisions.locked_by (directly or transitively),
-- so they must go before that column does
drop policy "revisions update" on revisions;
drop policy "switchboards write" on switchboards;
drop policy "verticals write" on verticals;
drop policy "placed_feeders write" on placed_feeders;
drop policy "switchboard_busbars write" on switchboard_busbars;
drop policy "switchboard_enclosure_lines write" on switchboard_enclosure_lines;

drop function lock_revision(uuid);
drop function unlock_revision(uuid);

alter table revisions
  drop column locked_by,
  drop column locked_at;

-- ── archive_revision: force-clears every switchboard's lock, and blocks
-- archiving if another user still holds a lock on any switchboard ─────
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
  if not is_admin() and exists (
    select 1 from switchboards
    where revision_id = p_revision_id and locked_by is not null and locked_by <> auth.uid()
  ) then
    raise exception 'One or more switchboards in this revision are locked by another user';
  end if;

  update switchboards set locked_by = null, locked_at = null where revision_id = p_revision_id;
  update revisions set archived = true where id = p_revision_id;
end;
$$;

-- ── lock / unlock a single switchboard ──────────────────────────────
create or replace function lock_switchboard(p_switchboard_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sb switchboards%rowtype;
  v_archived boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sb from switchboards where id = p_switchboard_id;
  if not found then
    raise exception 'Switchboard not found';
  end if;

  select archived into v_archived from revisions where id = v_sb.revision_id;
  if v_archived then
    raise exception 'Revision is archived';
  end if;
  if v_sb.locked_by is not null and v_sb.locked_by <> auth.uid() then
    raise exception 'Switchboard is already locked by another user';
  end if;

  update switchboards set locked_by = auth.uid(), locked_at = now() where id = p_switchboard_id;
end;
$$;

create or replace function unlock_switchboard(p_switchboard_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sb switchboards%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sb from switchboards where id = p_switchboard_id;
  if not found then
    raise exception 'Switchboard not found';
  end if;
  if v_sb.locked_by is null then
    return;
  end if;
  if v_sb.locked_by <> auth.uid() and not is_admin() then
    raise exception 'Only the user holding the lock or an admin can release it';
  end if;

  update switchboards set locked_by = null, locked_at = null where id = p_switchboard_id;
end;
$$;

-- ── clone a single switchboard within the same revision ─────────────
create or replace function clone_switchboard(p_switchboard_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source switchboards%rowtype;
  v_archived boolean;
  v_new_sb_id uuid;
  v_next_sort int;
  v_new_tag text;
  v_vertical record;
  v_new_vertical_id uuid;
  v_feeder record;
  v_new_feeder_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_source from switchboards where id = p_switchboard_id;
  if not found then
    raise exception 'Switchboard not found';
  end if;

  select archived into v_archived from revisions where id = v_source.revision_id;
  if v_archived then
    raise exception 'Revision is archived';
  end if;

  create temporary table if not exists _clone_switchboard_feeder_map (
    old_feeder_id uuid,
    new_feeder_id uuid
  ) on commit drop;
  truncate _clone_switchboard_feeder_map;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from switchboards where revision_id = v_source.revision_id;
  v_new_tag := v_source.tag || '-COPY';

  insert into switchboards (
    revision_id, tag, title, form_of_separation, plinth_height_mm, panel_height_mm, amps, ka, poles, sort_order,
    labor_wiring_pct, labor_assembly_pct, labor_testing_pct, profit_pct
  )
  values (
    v_source.revision_id, v_new_tag, v_source.title, v_source.form_of_separation, v_source.plinth_height_mm,
    v_source.panel_height_mm, v_source.amps, v_source.ka, v_source.poles, v_next_sort,
    v_source.labor_wiring_pct, v_source.labor_assembly_pct, v_source.labor_testing_pct, v_source.profit_pct
  )
  returning id into v_new_sb_id;

  insert into switchboard_busbars (switchboard_id, description, qty, rate, sort_order)
  select v_new_sb_id, b.description, b.qty, b.rate, b.sort_order from switchboard_busbars b where b.switchboard_id = p_switchboard_id;

  insert into switchboard_enclosure_lines (switchboard_id, description, qty, rate, sort_order)
  select v_new_sb_id, e.description, e.qty, e.rate, e.sort_order from switchboard_enclosure_lines e where e.switchboard_id = p_switchboard_id;

  for v_feeder in select * from feeders where switchboard_id = p_switchboard_id and not is_library loop
    insert into feeders (name, description, category, switchboard_id, is_library, tag, rating_summary, created_by)
    values (v_feeder.name, v_feeder.description, v_feeder.category, v_new_sb_id, false, v_feeder.tag, v_feeder.rating_summary, auth.uid())
    returning id into v_new_feeder_id;

    insert into feeder_items (feeder_id, item_id, qty)
    select v_new_feeder_id, fi.item_id, fi.qty from feeder_items fi where fi.feeder_id = v_feeder.id;

    insert into _clone_switchboard_feeder_map (old_feeder_id, new_feeder_id) values (v_feeder.id, v_new_feeder_id);
  end loop;

  for v_vertical in select * from verticals where switchboard_id = p_switchboard_id order by sort_order loop
    insert into verticals (switchboard_id, name, width_mm, depth_mm, bay_type, sort_order)
    values (v_new_sb_id, v_vertical.name, v_vertical.width_mm, v_vertical.depth_mm, v_vertical.bay_type, v_vertical.sort_order)
    returning id into v_new_vertical_id;

    insert into placed_feeders (vertical_id, feeder_id, label_override, qty, sort_order, tier_number)
    select v_new_vertical_id,
           coalesce((select new_feeder_id from _clone_switchboard_feeder_map where old_feeder_id = pf.feeder_id), pf.feeder_id),
           pf.label_override, pf.qty, pf.sort_order, pf.tier_number
    from placed_feeders pf
    where pf.vertical_id = v_vertical.id;
  end loop;

  return v_new_sb_id;
end;
$$;

revoke all on function lock_switchboard(uuid) from public;
revoke all on function unlock_switchboard(uuid) from public;
revoke all on function clone_switchboard(uuid) from public;

revoke execute on function lock_switchboard(uuid) from anon;
revoke execute on function unlock_switchboard(uuid) from anon;
revoke execute on function clone_switchboard(uuid) from anon;

grant execute on function lock_switchboard(uuid) to authenticated;
grant execute on function unlock_switchboard(uuid) to authenticated;
grant execute on function clone_switchboard(uuid) to authenticated;

-- ── RLS: revisions (archive-only gate now, no lock column) ──────────
create policy "revisions update" on revisions for update to authenticated using (not archived);

-- ── RLS: switchboards (own lock + parent revision archive) ──────────
create policy "switchboards write" on switchboards for all to authenticated
  using (
    (switchboards.locked_by is null or switchboards.locked_by = auth.uid() or is_admin())
    and not exists (select 1 from revisions r where r.id = switchboards.revision_id and r.archived)
  );

-- ── RLS: verticals (switchboard lock + archive aware) ───────────────
create policy "verticals write" on verticals for all to authenticated
  using (exists (
    select 1 from switchboards sb
    join revisions r on r.id = sb.revision_id
    where sb.id = verticals.switchboard_id
      and not r.archived
      and (sb.locked_by is null or sb.locked_by = auth.uid() or is_admin())
  ));

-- ── RLS: placed_feeders (switchboard lock + archive aware, via vertical) ─
create policy "placed_feeders write" on placed_feeders for all to authenticated
  using (exists (
    select 1 from verticals v
    join switchboards sb on sb.id = v.switchboard_id
    join revisions r on r.id = sb.revision_id
    where v.id = placed_feeders.vertical_id
      and not r.archived
      and (sb.locked_by is null or sb.locked_by = auth.uid() or is_admin())
  ));

-- ── RLS: switchboard_busbars / switchboard_enclosure_lines ──────────
create policy "switchboard_busbars write" on switchboard_busbars for all to authenticated
  using (exists (
    select 1 from switchboards sb join revisions r on r.id = sb.revision_id
    where sb.id = switchboard_busbars.switchboard_id
      and not r.archived and (sb.locked_by is null or sb.locked_by = auth.uid() or is_admin())
  ));

create policy "switchboard_enclosure_lines write" on switchboard_enclosure_lines for all to authenticated
  using (exists (
    select 1 from switchboards sb join revisions r on r.id = sb.revision_id
    where sb.id = switchboard_enclosure_lines.switchboard_id
      and not r.archived and (sb.locked_by is null or sb.locked_by = auth.uid() or is_admin())
  ));
