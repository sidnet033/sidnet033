-- "Estimation Head" role: once a project is Quoted (or later), the
-- Estimation Head (or an admin) can push the rates used in that project into
-- the Item Master, item by item, with every change logged.
update roles set name = 'Estimation Head', description = coalesce(description, 'Can update Item Master rates from quoted projects')
 where regexp_replace(lower(name), '[^a-z]', '', 'g') = 'estimationhead';
insert into roles (name, description)
select 'Estimation Head', 'Can update Item Master rates from quoted projects'
 where not exists (select 1 from roles where regexp_replace(lower(name), '[^a-z]', '', 'g') = 'estimationhead');

create or replace function is_estimation_head()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join roles r on r.id = p.role_id
     where p.id = auth.uid() and regexp_replace(lower(r.name), '[^a-z]', '', 'g') = 'estimationhead'
  );
$$;
grant execute on function is_estimation_head() to authenticated;

create table item_rate_update_log (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  user_id uuid references profiles(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  revision_id uuid references revisions(id) on delete set null,
  item_id uuid references item_master(id) on delete set null,
  item_code text,
  item_description text,
  old_list_price numeric, new_list_price numeric,
  old_discount_pct numeric, new_discount_pct numeric,
  old_unit_cost numeric, new_unit_cost numeric,
  was_higher boolean not null default false
);
create index item_rate_update_log_created on item_rate_update_log (created_at desc);
alter table item_rate_update_log enable row level security;
create policy "rate log read" on item_rate_update_log for select to authenticated using (is_admin() or is_estimation_head());

create or replace function update_item_master_rates_from_revision(p_revision_id uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_project projects%rowtype;
  v_batch uuid := gen_random_uuid();
  v_count integer := 0;
  r record;
  v_item item_master%rowtype;
  v_new_cost numeric;
begin
  if auth.uid() is null or not (is_admin() or is_estimation_head()) then
    raise exception 'Only the Estimation Head (or an admin) can update Item Master rates from a project';
  end if;
  select p.* into v_project from projects p join revisions rv on rv.project_id = p.id where rv.id = p_revision_id;
  if not found then raise exception 'Revision not found'; end if;
  if v_project.stage in ('new', 'wip') then
    raise exception 'The project must be Quoted (or later) before its rates go into the Item Master';
  end if;

  for r in
    select (x->>'item_id')::uuid as item_id,
           nullif(x->>'list_price', '')::numeric as list_price,
           nullif(x->>'discount_pct', '')::numeric as discount_pct
      from jsonb_array_elements(p_rows) x
  loop
    -- only items actually used in this revision's feeders
    if not exists (
      select 1 from feeder_items fi join feeders f on f.id = fi.feeder_id
        join switchboards s on s.id = f.switchboard_id
       where s.revision_id = p_revision_id and fi.item_id = r.item_id
    ) then
      continue;
    end if;
    select * into v_item from item_master where id = r.item_id for update;
    if not found then continue; end if;
    v_new_cost := case
      when r.list_price is not null and r.discount_pct is not null then round(r.list_price * (1 - r.discount_pct / 100), 2)
      when r.list_price is not null then r.list_price
      else v_item.unit_cost end;
    insert into item_rate_update_log (batch_id, user_id, project_id, revision_id, item_id, item_code, item_description,
      old_list_price, new_list_price, old_discount_pct, new_discount_pct, old_unit_cost, new_unit_cost, was_higher)
    values (v_batch, auth.uid(), v_project.id, p_revision_id, v_item.id, coalesce(v_item.sku, v_item.vendor_cat), v_item.description,
      v_item.list_price, r.list_price, v_item.discount_pct, r.discount_pct, v_item.unit_cost, v_new_cost,
      v_new_cost > coalesce(v_item.unit_cost, 0));
    update item_master
       set list_price = r.list_price, discount_pct = r.discount_pct, unit_cost = v_new_cost, updated_at = now()
     where id = r.item_id;
    v_count := v_count + 1;
  end loop;
  return json_build_object('batch_id', v_batch, 'items', v_count);
end;
$$;
revoke execute on function update_item_master_rates_from_revision(uuid, jsonb) from public, anon;
grant execute on function update_item_master_rates_from_revision(uuid, jsonb) to authenticated;
