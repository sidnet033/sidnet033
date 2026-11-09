-- ArTuK enclosure costing from the fabrication BOM.
--
-- 1. App-wide default steel rates (INR/kg): GI 90, CRCA 71. A project's own
--    rate overrides them; a project rate left blank (null) uses the default.
-- 2. ArTuK sub-parts (the fabricated / bought-out pieces) with weight and cost,
--    and the parts list linking each ABB part (Item Master SKU) to its
--    sub-parts and quantities. An ABB part's cost = sum(qty x sub-part cost),
--    where a GI / CRCA sub-part costs weight x the steel rate and anything else
--    its own unit cost. Item Master cost / weight of those ABB parts are kept
--    in step at the default rates.

create table if not exists app_settings (
  id boolean primary key default true check (id),
  enclosure_rate_gi numeric not null default 90 check (enclosure_rate_gi >= 0),
  enclosure_rate_crca numeric not null default 71 check (enclosure_rate_crca >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into app_settings (id) values (true) on conflict (id) do nothing;
alter table app_settings enable row level security;
drop policy if exists "app settings read" on app_settings;
create policy "app settings read" on app_settings for select to authenticated using (true);
drop policy if exists "app settings admin update" on app_settings;
create policy "app settings admin update" on app_settings for update to authenticated using (is_admin()) with check (is_admin());

-- project rates: blank = use the app default (0 used to mean "not set")
alter table projects alter column enclosure_rate_gi drop not null, alter column enclosure_rate_gi drop default;
alter table projects alter column enclosure_rate_crca drop not null, alter column enclosure_rate_crca drop default;
update projects set enclosure_rate_gi = null where enclosure_rate_gi = 0;
update projects set enclosure_rate_crca = null where enclosure_rate_crca = 0;

create table if not exists artuk_subparts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  family text,
  -- GI / CRCA: priced by weight x steel rate; BO (bought-out) or null: unit_cost
  material text check (material is null or material in ('GI', 'CRCA', 'BO')),
  weight_kg numeric check (weight_kg is null or weight_kg >= 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  xls_cost numeric,
  source text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists artuk_part_components (
  id uuid primary key default gen_random_uuid(),
  parent_sku text not null,
  subpart_id uuid not null references artuk_subparts(id) on delete cascade,
  qty numeric not null check (qty > 0),
  sort_order int not null default 0,
  unique (parent_sku, subpart_id)
);
create index if not exists artuk_part_components_parent on artuk_part_components (upper(parent_sku));

alter table artuk_subparts enable row level security;
alter table artuk_part_components enable row level security;
drop policy if exists "artuk subparts read" on artuk_subparts;
create policy "artuk subparts read" on artuk_subparts for select to authenticated using (true);
drop policy if exists "artuk subparts admin write" on artuk_subparts;
create policy "artuk subparts admin write" on artuk_subparts for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "artuk components read" on artuk_part_components;
create policy "artuk components read" on artuk_part_components for select to authenticated using (true);
drop policy if exists "artuk components admin write" on artuk_part_components;
create policy "artuk components admin write" on artuk_part_components for all to authenticated using (is_admin()) with check (is_admin());

-- one sub-part's cost at the given steel rates
create or replace function artuk_subpart_cost(p_material text, p_weight numeric, p_unit_cost numeric, p_gi numeric, p_crca numeric)
returns numeric language sql immutable as $$
  select case
    when p_material = 'GI' and coalesce(p_weight, 0) > 0 then p_weight * p_gi
    when p_material = 'CRCA' and coalesce(p_weight, 0) > 0 then p_weight * p_crca
    else coalesce(p_unit_cost, 0)
  end
$$;

-- keep Item Master cost / steel weight of ABB parts in step (default rates)
create or replace function recompute_artuk_part_costs()
returns void language plpgsql security definer set search_path = public as $$
declare s app_settings;
begin
  select * into s from app_settings where id;
  update item_master im
     set unit_cost = round(t.cost, 2),
         weight_kg = nullif(round(t.w, 3), 0),
         updated_at = now()
    from (
      select upper(trim(c.parent_sku)) as sku,
             sum(c.qty * artuk_subpart_cost(p.material, p.weight_kg, p.unit_cost, s.enclosure_rate_gi, s.enclosure_rate_crca)) as cost,
             sum(c.qty * case when p.material in ('GI', 'CRCA') then coalesce(p.weight_kg, 0) else 0 end) as w
        from artuk_part_components c
        join artuk_subparts p on p.id = c.subpart_id
       group by 1
    ) t
   where upper(trim(im.sku)) = t.sku
     and im.status = 'active'
     and (im.unit_cost is distinct from round(t.cost, 2) or im.weight_kg is distinct from nullif(round(t.w, 3), 0));
end $$;

create or replace function trg_recompute_artuk_part_costs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_artuk_part_costs();
  return null;
end $$;

drop trigger if exists artuk_subparts_recompute on artuk_subparts;
create trigger artuk_subparts_recompute after insert or update or delete on artuk_subparts
  for each statement execute function trg_recompute_artuk_part_costs();
drop trigger if exists artuk_components_recompute on artuk_part_components;
create trigger artuk_components_recompute after insert or update or delete on artuk_part_components
  for each statement execute function trg_recompute_artuk_part_costs();
drop trigger if exists app_settings_recompute on app_settings;
create trigger app_settings_recompute after update on app_settings
  for each statement execute function trg_recompute_artuk_part_costs();
