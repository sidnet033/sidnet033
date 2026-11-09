-- Enclosure Rates Master + fabrication cost formulas for ArTuK sub-parts.
--
-- App-level rates (enclosure_rates) with optional per-project overrides
-- (project_enclosure_rates). Each fabricated sub-part is costed like the
-- fabrication BOM's "Total Cost with KG calculation":
--   Total Wt. (M)         = L x W x T x 7.85 / 1e6 x qty   (or a fixed weight)
--   PC area (N, sq ft)    = L x W / 1e6 x 10.76 x 2
--   Punching Price per KG = M x PUNCHING (or LASER)
--   Bending               = M x BENDING          (if bent)
--   Fab                   = M x FABRICATION      (if fabricated)
--   PC                    = N x POWDER COATING   (or M x PLATING)
--   Material Cost         = M x GI / CRCA
--   Total                 = sum of the above
-- Gaskets = length (m) x Gasket/m; other bought-out parts keep their own cost.
-- Costs at the app rates are persisted on the sub-parts and in Item Master.
-- A project with its own rates gets its ABB part costs recalculated and
-- persisted only when its rates change.

create table if not exists enclosure_rates (
  key text primary key,
  label text not null,
  unit text not null,
  rate numeric not null check (rate >= 0),
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);
insert into enclosure_rates (key, label, unit, rate, sort_order) values
  ('CRCA', 'CRCA', 'INR/kg', 71, 1),
  ('GI', 'GI', 'INR/kg', 90, 2),
  ('LASER', 'Laser', 'INR/kg', 14, 3),
  ('PUNCHING', 'Punching', 'INR/kg', 8, 4),
  ('BENDING', 'Bending', 'INR/kg', 7, 5),
  ('FABRICATION', 'Fabrication', 'INR/kg', 3, 6),
  ('POWDER_COATING', 'Powder coating', 'INR/sq ft', 23, 7),
  ('PUNCHING_STROKE', 'Punching stroke', 'INR/stroke', 0.5, 8),
  ('GASKET_M', 'Gasket', 'INR/m', 140, 9),
  ('PLATING', 'Plating', 'INR/kg', 28, 10)
on conflict (key) do nothing;
alter table enclosure_rates enable row level security;
drop policy if exists "enclosure rates read" on enclosure_rates;
create policy "enclosure rates read" on enclosure_rates for select to authenticated using (true);
drop policy if exists "enclosure rates admin write" on enclosure_rates;
create policy "enclosure rates admin write" on enclosure_rates for update to authenticated using (is_admin()) with check (is_admin());

create table if not exists project_enclosure_rates (
  project_id uuid not null references projects(id) on delete cascade,
  key text not null references enclosure_rates(key) on delete cascade,
  rate numeric not null check (rate >= 0),
  updated_at timestamptz not null default now(),
  primary key (project_id, key)
);
alter table project_enclosure_rates enable row level security;
drop policy if exists "project enclosure rates all" on project_enclosure_rates;
create policy "project enclosure rates all" on project_enclosure_rates for all to authenticated using (true) with check (true);

-- carry over any project GI / CRCA rates set since 0047, then retire the
-- interim app_settings / project columns
insert into project_enclosure_rates (project_id, key, rate)
  select id, 'GI', enclosure_rate_gi from projects where enclosure_rate_gi is not null
  union all
  select id, 'CRCA', enclosure_rate_crca from projects where enclosure_rate_crca is not null
on conflict do nothing;
drop trigger if exists app_settings_recompute on app_settings;
drop table if exists app_settings;
alter table projects drop column if exists enclosure_rate_gi, drop column if exists enclosure_rate_crca;

-- sub-part geometry + process flags + persisted cost breakdown (app rates)
alter table artuk_subparts
  add column if not exists length_mm numeric,
  add column if not exists width_mm numeric,
  add column if not exists thickness_mm numeric,
  add column if not exists qty_per numeric not null default 1,
  add column if not exists weight_fixed boolean not null default false,
  add column if not exists punch text check (punch is null or punch in ('PUNCHING', 'LASER')),
  add column if not exists bending boolean not null default false,
  add column if not exists fab boolean not null default false,
  add column if not exists finish text check (finish is null or finish in ('PC', 'PLATING')),
  add column if not exists punch_strokes numeric,
  add column if not exists gasket_m numeric check (gasket_m is null or gasket_m >= 0),
  add column if not exists pc_area_sqft numeric,
  add column if not exists punch_cost numeric,
  add column if not exists bending_cost numeric,
  add column if not exists fab_cost numeric,
  add column if not exists pc_cost numeric,
  add column if not exists material_cost numeric,
  add column if not exists cost numeric;

-- rates as jsonb: app rates, with a project's overrides on top
create or replace function enclosure_rates_for(p_project uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(r.key, coalesce(p.rate, r.rate)), '{}'::jsonb)
    from enclosure_rates r
    left join project_enclosure_rates p on p.key = r.key and p.project_id = p_project
$$;

-- one sub-part's cost at the given rates
create or replace function artuk_subpart_cost_at(sp artuk_subparts, r jsonb)
returns numeric language plpgsql immutable as $$
declare
  m numeric := coalesce(sp.weight_kg, 0);
  n numeric := coalesce(sp.pc_area_sqft, 0);
begin
  if sp.material in ('GI', 'CRCA') and m > 0 then
    return m * coalesce((r ->> sp.punch)::numeric, 0)
         + case when sp.bending then m * (r ->> 'BENDING')::numeric else 0 end
         + case when sp.fab then m * (r ->> 'FABRICATION')::numeric else 0 end
         + case sp.finish when 'PC' then n * (r ->> 'POWDER_COATING')::numeric
                          when 'PLATING' then m * (r ->> 'PLATING')::numeric else 0 end
         + m * (r ->> sp.material)::numeric;
  elsif sp.gasket_m is not null then
    return sp.gasket_m * (r ->> 'GASKET_M')::numeric;
  else
    return coalesce(sp.unit_cost, 0);
  end if;
end $$;

-- before insert/update: derive weight, PC area and the cost breakdown at app rates
create or replace function trg_artuk_subpart_derive()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := enclosure_rates_for(null);
begin
  if new.length_mm is not null and new.width_mm is not null then
    new.pc_area_sqft := new.length_mm * new.width_mm / 1e6 * 10.76 * 2;
    if not new.weight_fixed and new.thickness_mm is not null then
      new.weight_kg := new.length_mm * new.width_mm * new.thickness_mm * 7.85 / 1e6 * coalesce(new.qty_per, 1);
    end if;
  end if;
  if new.material in ('GI', 'CRCA') and coalesce(new.weight_kg, 0) > 0 then
    new.punch_cost := new.weight_kg * coalesce((r ->> new.punch)::numeric, 0);
    new.bending_cost := case when new.bending then new.weight_kg * (r ->> 'BENDING')::numeric else 0 end;
    new.fab_cost := case when new.fab then new.weight_kg * (r ->> 'FABRICATION')::numeric else 0 end;
    new.pc_cost := case new.finish when 'PC' then coalesce(new.pc_area_sqft, 0) * (r ->> 'POWDER_COATING')::numeric
                                   when 'PLATING' then new.weight_kg * (r ->> 'PLATING')::numeric else 0 end;
    new.material_cost := new.weight_kg * (r ->> new.material)::numeric;
  else
    new.punch_cost := null; new.bending_cost := null; new.fab_cost := null; new.pc_cost := null; new.material_cost := null;
  end if;
  new.cost := round(artuk_subpart_cost_at(new, r), 4);
  return new;
end $$;
drop trigger if exists artuk_subpart_derive on artuk_subparts;
create trigger artuk_subpart_derive before insert or update on artuk_subparts
  for each row execute function trg_artuk_subpart_derive();

-- per-project ABB part costs, persisted for projects with their own rates
create table if not exists project_artuk_part_costs (
  project_id uuid not null references projects(id) on delete cascade,
  parent_sku text not null,
  cost numeric not null,
  computed_at timestamptz not null default now(),
  primary key (project_id, parent_sku)
);
alter table project_artuk_part_costs enable row level security;
drop policy if exists "project artuk costs read" on project_artuk_part_costs;
create policy "project artuk costs read" on project_artuk_part_costs for select to authenticated using (true);

create or replace function recompute_project_enclosure_costs(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  delete from project_artuk_part_costs where project_id = p_project;
  if not exists (select 1 from project_enclosure_rates where project_id = p_project) then
    return; -- no overrides: the project uses the app-level costs
  end if;
  r := enclosure_rates_for(p_project);
  insert into project_artuk_part_costs (project_id, parent_sku, cost)
    select p_project, c.parent_sku, round(sum(c.qty * artuk_subpart_cost_at(s, r)), 2)
      from artuk_part_components c join artuk_subparts s on s.id = c.subpart_id
     group by c.parent_sku;
end $$;

-- app-level: Item Master cost / steel weight of ABB parts from persisted sub-part costs
create or replace function recompute_artuk_part_costs()
returns void language plpgsql security definer set search_path = public as $$
begin
  update item_master im
     set unit_cost = t.cost, weight_kg = t.w, updated_at = now()
    from (
      select upper(trim(c.parent_sku)) as sku,
             round(sum(c.qty * coalesce(p.cost, 0)), 2) as cost,
             nullif(round(sum(c.qty * case when p.material in ('GI', 'CRCA') then coalesce(p.weight_kg, 0) else 0 end), 3), 0) as w
        from artuk_part_components c join artuk_subparts p on p.id = c.subpart_id
       group by 1
    ) t
   where upper(trim(im.sku)) = t.sku and im.status = 'active'
     and (im.unit_cost is distinct from t.cost or im.weight_kg is distinct from t.w);
end $$;

create or replace function recompute_all_enclosure_costs()
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform recompute_artuk_part_costs();
  for pid in select distinct project_id from project_enclosure_rates loop
    perform recompute_project_enclosure_costs(pid);
  end loop;
end $$;

create or replace function trg_recompute_artuk_part_costs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_all_enclosure_costs();
  return null;
end $$;

-- app rates changed: re-derive every sub-part (fires the before trigger),
-- which in turn recomputes Item Master and the overriding projects
create or replace function trg_enclosure_rates_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update artuk_subparts set updated_at = updated_at;
  return null;
end $$;
drop trigger if exists enclosure_rates_changed on enclosure_rates;
create trigger enclosure_rates_changed after update on enclosure_rates
  for each statement execute function trg_enclosure_rates_changed();

-- a project's rates changed: recalc that project only
create or replace function trg_project_enclosure_rates_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_project_enclosure_costs(coalesce(new.project_id, old.project_id));
  return null;
end $$;
drop trigger if exists project_enclosure_rates_changed on project_enclosure_rates;
create trigger project_enclosure_rates_changed after insert or update or delete on project_enclosure_rates
  for each row execute function trg_project_enclosure_rates_changed();

drop function if exists artuk_subpart_cost(text, numeric, numeric, numeric, numeric);
