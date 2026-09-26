-- Cable entry/exit, alongside form of separation/amps/kA, are switchboard
-- properties edited in Project Detail and shown read-only in GA Builder.
alter table switchboards
  add column cable_entry text check (cable_entry in ('Top', 'Bottom')),
  add column cable_exit text check (cable_exit in ('Top', 'Bottom'));

-- carry the new columns forward when cloning/revisioning, same as the
-- other switchboard columns
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
    labor_wiring_pct, labor_assembly_pct, labor_testing_pct, profit_pct,
    switchboard_type_id, description, ip_rating, qty, std, cable_entry, cable_exit
  )
  values (
    v_source.revision_id, v_new_tag, v_source.title, v_source.form_of_separation, v_source.plinth_height_mm,
    v_source.panel_height_mm, v_source.amps, v_source.ka, v_source.poles, v_next_sort,
    v_source.labor_wiring_pct, v_source.labor_assembly_pct, v_source.labor_testing_pct, v_source.profit_pct,
    v_source.switchboard_type_id, v_source.description, v_source.ip_rating, v_source.qty, v_source.std,
    v_source.cable_entry, v_source.cable_exit
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
      labor_wiring_pct, labor_assembly_pct, labor_testing_pct, profit_pct,
      switchboard_type_id, description, ip_rating, qty, std, cable_entry, cable_exit
    )
    values (
      v_new_revision_id, v_sb.tag, v_sb.title, v_sb.form_of_separation, v_sb.plinth_height_mm, v_sb.panel_height_mm,
      v_sb.amps, v_sb.ka, v_sb.poles, v_sb.sort_order,
      v_sb.labor_wiring_pct, v_sb.labor_assembly_pct, v_sb.labor_testing_pct, v_sb.profit_pct,
      v_sb.switchboard_type_id, v_sb.description, v_sb.ip_rating, v_sb.qty, v_sb.std, v_sb.cable_entry, v_sb.cable_exit
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
