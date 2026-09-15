-- Support columns/tables for the BOM Builder cost breakdown and the
-- Project Costing / Commercial Matrix.

alter table switchboards
  add column labor_wiring_pct numeric(6, 2) not null default 3.5,
  add column labor_assembly_pct numeric(6, 2) not null default 6.0,
  add column labor_testing_pct numeric(6, 2) not null default 1.5,
  add column profit_pct numeric(6, 2) not null default 15;

alter table revisions
  add column freight_amount numeric(14, 2) not null default 0,
  add column freight_description text,
  add column installation_amount numeric(14, 2) not null default 0,
  add column installation_description text,
  add column commissioning_amount numeric(14, 2) not null default 0,
  add column commissioning_description text;

-- flat, editable line-item tables for the BOM Builder's Busbars and
-- Enclosure & Cubicle Construction sections (Phase 1: simple rate x qty
-- lines, not weight-from-dimensions calculators — see plan)
create table if not exists switchboard_busbars (
  id uuid primary key default gen_random_uuid(),
  switchboard_id uuid not null references switchboards (id) on delete cascade,
  description text not null,
  qty numeric(12, 2) not null default 1,
  rate numeric(14, 2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists switchboard_enclosure_lines (
  id uuid primary key default gen_random_uuid(),
  switchboard_id uuid not null references switchboards (id) on delete cascade,
  description text not null,
  qty numeric(12, 2) not null default 1,
  rate numeric(14, 2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table switchboard_busbars enable row level security;
alter table switchboard_enclosure_lines enable row level security;

create index if not exists idx_switchboard_busbars_sb on switchboard_busbars (switchboard_id);
create index if not exists idx_switchboard_enclosure_lines_sb on switchboard_enclosure_lines (switchboard_id);

create policy "switchboard_busbars select" on switchboard_busbars for select to authenticated using (true);
create policy "switchboard_busbars write" on switchboard_busbars for all to authenticated
  using (exists (
    select 1 from switchboards sb join revisions r on r.id = sb.revision_id
    where sb.id = switchboard_busbars.switchboard_id
      and not r.archived and (r.locked_by is null or r.locked_by = auth.uid() or is_admin())
  ));

create policy "switchboard_enclosure_lines select" on switchboard_enclosure_lines for select to authenticated using (true);
create policy "switchboard_enclosure_lines write" on switchboard_enclosure_lines for all to authenticated
  using (exists (
    select 1 from switchboards sb join revisions r on r.id = sb.revision_id
    where sb.id = switchboard_enclosure_lines.switchboard_id
      and not r.archived and (r.locked_by is null or r.locked_by = auth.uid() or is_admin())
  ));

-- ── create_revision: also clone the new per-switchboard columns + busbar/enclosure lines ─
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

  insert into revisions (
    project_id, name, customer_name, status, margin_pct, created_by, revision_group_id, revision_number,
    freight_amount, freight_description, installation_amount, installation_description,
    commissioning_amount, commissioning_description
  )
  values (
    v_source.project_id, v_source.name, v_source.customer_name, 'draft', v_source.margin_pct, auth.uid(),
    v_source.revision_group_id, v_next_revision,
    v_source.freight_amount, v_source.freight_description, v_source.installation_amount, v_source.installation_description,
    v_source.commissioning_amount, v_source.commissioning_description
  )
  returning id into v_new_revision_id;

  for v_sb in select * from switchboards where revision_id = p_revision_id order by sort_order loop
    insert into switchboards (
      revision_id, tag, title, form_of_separation, plinth_height_mm, panel_height_mm, amps, ka, poles, sort_order,
      labor_wiring_pct, labor_assembly_pct, labor_testing_pct, profit_pct
    )
    values (
      v_new_revision_id, v_sb.tag, v_sb.title, v_sb.form_of_separation, v_sb.plinth_height_mm, v_sb.panel_height_mm,
      v_sb.amps, v_sb.ka, v_sb.poles, v_sb.sort_order,
      v_sb.labor_wiring_pct, v_sb.labor_assembly_pct, v_sb.labor_testing_pct, v_sb.profit_pct
    )
    returning id into v_new_sb_id;

    insert into switchboard_busbars (switchboard_id, description, qty, rate, sort_order)
    select v_new_sb_id, b.description, b.qty, b.rate, b.sort_order from switchboard_busbars b where b.switchboard_id = v_sb.id;

    insert into switchboard_enclosure_lines (switchboard_id, description, qty, rate, sort_order)
    select v_new_sb_id, e.description, e.qty, e.rate, e.sort_order from switchboard_enclosure_lines e where e.switchboard_id = v_sb.id;

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
