-- Busduct entries: a switchboard can take busducts in from the top as well
-- as cables. has_busduct says it does; each bay records how many top
-- busduct entries it has (GA Builder needs at least one when has_busduct).
alter table switchboards add column has_busduct boolean not null default false;
alter table verticals add column busduct_entries integer not null default 0 check (busduct_entries >= 0);

create or replace function _copy_switchboard_contents(p_source_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feeder record;
  v_new_feeder_id uuid;
  v_vertical record;
  v_new_vertical_id uuid;
  v_placed record;
  v_new_placed_id uuid;
  v_feeder_map jsonb := '{}'::jsonb;
  v_vertical_map jsonb := '{}'::jsonb;
  v_placed_map jsonb := '{}'::jsonb;
begin

  insert into switchboard_busbars (switchboard_id, description, qty, rate, sort_order)
  select p_target_id, b.description, b.qty, b.rate, b.sort_order from switchboard_busbars b where b.switchboard_id = p_source_id;

  insert into switchboard_enclosure_lines (switchboard_id, description, qty, rate, sort_order)
  select p_target_id, e.description, e.qty, e.rate, e.sort_order from switchboard_enclosure_lines e where e.switchboard_id = p_source_id;

  for v_feeder in select * from feeders where switchboard_id = p_source_id and not is_library loop
    insert into feeders (
      name, description, category, switchboard_id, is_library, tag, rating_summary, created_by,
      rated_current, pole_config, breaking_capacity, device_type, rated_kw
    )
    values (
      v_feeder.name, v_feeder.description, v_feeder.category, p_target_id, false, v_feeder.tag, v_feeder.rating_summary, auth.uid(),
      v_feeder.rated_current, v_feeder.pole_config, v_feeder.breaking_capacity, v_feeder.device_type, v_feeder.rated_kw
    )
    returning id into v_new_feeder_id;

    insert into feeder_items (feeder_id, item_id, qty, sort_order, list_price_override, discount_pct_override)
    select v_new_feeder_id, fi.item_id, fi.qty, fi.sort_order, fi.list_price_override, fi.discount_pct_override
    from feeder_items fi where fi.feeder_id = v_feeder.id;

    v_feeder_map := v_feeder_map || jsonb_build_object(v_feeder.id::text, v_new_feeder_id::text);
  end loop;

  for v_vertical in select * from verticals where switchboard_id = p_source_id order by sort_order loop
    insert into verticals (switchboard_id, name, width_mm, depth_mm, bay_type, sort_order, dummy_slot, dummy_height_mm, busduct_entries)
    values (p_target_id, v_vertical.name, v_vertical.width_mm, v_vertical.depth_mm, v_vertical.bay_type, v_vertical.sort_order, v_vertical.dummy_slot, v_vertical.dummy_height_mm, v_vertical.busduct_entries)
    returning id into v_new_vertical_id;
    v_vertical_map := v_vertical_map || jsonb_build_object(v_vertical.id::text, v_new_vertical_id::text);

    for v_placed in select * from placed_feeders where vertical_id = v_vertical.id loop
      insert into placed_feeders (vertical_id, feeder_id, label_override, qty, sort_order, tier_number, unit_heights)
      values (
        v_new_vertical_id,
        coalesce((v_feeder_map ->> v_placed.feeder_id::text)::uuid, v_placed.feeder_id),
        v_placed.label_override, v_placed.qty, v_placed.sort_order, v_placed.tier_number, v_placed.unit_heights
      )
      returning id into v_new_placed_id;
      v_placed_map := v_placed_map || jsonb_build_object(v_placed.id::text, v_new_placed_id::text);
    end loop;
  end loop;

  insert into busbar_overrides (
    switchboard_id, kind, vertical_id, placed_feeder_id, unit_index,
    bar_width_mm, bar_thickness_mm, runs_per_phase, length_mm, start_ext_mm, end_ext_mm
  )
  select
    p_target_id, o.kind,
    (v_vertical_map ->> o.vertical_id::text)::uuid,
    (v_placed_map ->> o.placed_feeder_id::text)::uuid,
    o.unit_index, o.bar_width_mm, o.bar_thickness_mm, o.runs_per_phase, o.length_mm, o.start_ext_mm, o.end_ext_mm
  from busbar_overrides o
  where o.switchboard_id = p_source_id;

end;
$$;

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

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from switchboards where revision_id = v_source.revision_id;

  insert into switchboards (
    revision_id, tag, title, form_of_separation, plinth_height_mm, panel_height_mm, amps, ka, poles, sort_order,
    labor_wiring_pct, labor_assembly_pct, labor_testing_pct, profit_pct,
    switchboard_type_id, description, ip_rating, qty, std, cable_entry, cable_exit, busbar,
    busbar_chamber_height_mm, neutral_size_pct, cable_access, arrangement, internal_arc, has_busduct
  )
  values (
    v_source.revision_id, v_source.tag || '-COPY', v_source.title, v_source.form_of_separation, v_source.plinth_height_mm,
    v_source.panel_height_mm, v_source.amps, v_source.ka, v_source.poles, v_next_sort,
    v_source.labor_wiring_pct, v_source.labor_assembly_pct, v_source.labor_testing_pct, v_source.profit_pct,
    v_source.switchboard_type_id, v_source.description, v_source.ip_rating, v_source.qty, v_source.std,
    v_source.cable_entry, v_source.cable_exit, v_source.busbar,
    v_source.busbar_chamber_height_mm, v_source.neutral_size_pct, v_source.cable_access, v_source.arrangement, v_source.internal_arc, v_source.has_busduct
  )
  returning id into v_new_sb_id;

  perform _copy_switchboard_contents(p_switchboard_id, v_new_sb_id);

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
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_source from revisions where id = p_revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;

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
      switchboard_type_id, description, ip_rating, qty, std, cable_entry, cable_exit, busbar,
      busbar_chamber_height_mm, neutral_size_pct, cable_access, arrangement, internal_arc, has_busduct
    )
    values (
      v_new_revision_id, v_sb.tag, v_sb.title, v_sb.form_of_separation, v_sb.plinth_height_mm, v_sb.panel_height_mm,
      v_sb.amps, v_sb.ka, v_sb.poles, v_sb.sort_order,
      v_sb.labor_wiring_pct, v_sb.labor_assembly_pct, v_sb.labor_testing_pct, v_sb.profit_pct,
      v_sb.switchboard_type_id, v_sb.description, v_sb.ip_rating, v_sb.qty, v_sb.std, v_sb.cable_entry, v_sb.cable_exit, v_sb.busbar,
      v_sb.busbar_chamber_height_mm, v_sb.neutral_size_pct, v_sb.cable_access, v_sb.arrangement, v_sb.internal_arc, v_sb.has_busduct
    )
    returning id into v_new_sb_id;

    perform _copy_switchboard_contents(v_sb.id, v_new_sb_id);
  end loop;

  return v_new_revision_id;
end;
$$;
