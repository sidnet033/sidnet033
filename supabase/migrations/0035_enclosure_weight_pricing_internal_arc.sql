-- ArTu-K enclosure parts are priced by weight: GI (galvanised) and CRCA
-- steel parts carry their material and weight in Item Master, and each
-- project sets a per-kg rate for GI and for CRCA.
alter table item_master
  add column material text,
  add column weight_kg numeric check (weight_kg is null or weight_kg >= 0);

alter table projects
  add column enclosure_rate_gi numeric not null default 0 check (enclosure_rate_gi >= 0),
  add column enclosure_rate_crca numeric not null default 0 check (enclosure_rate_crca >= 0);

-- ArTu-K internal arc compliance (ABB ELSP/ARTU-K/ENGG/04): 2mm covers and
-- doors, arc flaps, extra busbar supports. Copied by clone_switchboard /
-- create_revision.
alter table switchboards add column internal_arc boolean not null default false;

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
    busbar_chamber_height_mm, neutral_size_pct, cable_access, arrangement, internal_arc
  )
  values (
    v_source.revision_id, v_source.tag || '-COPY', v_source.title, v_source.form_of_separation, v_source.plinth_height_mm,
    v_source.panel_height_mm, v_source.amps, v_source.ka, v_source.poles, v_next_sort,
    v_source.labor_wiring_pct, v_source.labor_assembly_pct, v_source.labor_testing_pct, v_source.profit_pct,
    v_source.switchboard_type_id, v_source.description, v_source.ip_rating, v_source.qty, v_source.std,
    v_source.cable_entry, v_source.cable_exit, v_source.busbar,
    v_source.busbar_chamber_height_mm, v_source.neutral_size_pct, v_source.cable_access, v_source.arrangement, v_source.internal_arc
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
      busbar_chamber_height_mm, neutral_size_pct, cable_access, arrangement, internal_arc
    )
    values (
      v_new_revision_id, v_sb.tag, v_sb.title, v_sb.form_of_separation, v_sb.plinth_height_mm, v_sb.panel_height_mm,
      v_sb.amps, v_sb.ka, v_sb.poles, v_sb.sort_order,
      v_sb.labor_wiring_pct, v_sb.labor_assembly_pct, v_sb.labor_testing_pct, v_sb.profit_pct,
      v_sb.switchboard_type_id, v_sb.description, v_sb.ip_rating, v_sb.qty, v_sb.std, v_sb.cable_entry, v_sb.cable_exit, v_sb.busbar,
      v_sb.busbar_chamber_height_mm, v_sb.neutral_size_pct, v_sb.cable_access, v_sb.arrangement, v_sb.internal_arc
    )
    returning id into v_new_sb_id;

    perform _copy_switchboard_contents(v_sb.id, v_new_sb_id);
  end loop;

  return v_new_revision_id;
end;
$$;
