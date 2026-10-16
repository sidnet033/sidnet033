-- GA Builder heights are per UNIT, not per feeder: several units of the
-- same feeder can each have their own height. placed_feeders.unit_heights
-- holds one entry per unit (null = standard height). The per-feeder
-- switchboards.feeder_heights from 0031 is folded into it and no longer used.
alter table placed_feeders add column unit_heights jsonb;

update placed_feeders pf
set unit_heights = (select jsonb_agg(sb.feeder_heights -> pf.feeder_id::text) from generate_series(1, pf.qty))
from verticals v
join switchboards sb on sb.id = v.switchboard_id
where pf.vertical_id = v.id and sb.feeder_heights ? pf.feeder_id::text;

update switchboards set feeder_heights = '{}'::jsonb where feeder_heights <> '{}'::jsonb;

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
    insert into verticals (switchboard_id, name, width_mm, depth_mm, bay_type, sort_order, dummy_slot, dummy_height_mm)
    values (p_target_id, v_vertical.name, v_vertical.width_mm, v_vertical.depth_mm, v_vertical.bay_type, v_vertical.sort_order, v_vertical.dummy_slot, v_vertical.dummy_height_mm)
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

