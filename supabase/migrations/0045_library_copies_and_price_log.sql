-- 1. A library feeder added to a BOM is saved as the switchboard's own copy;
--    this remembers which library feeder it came from.
-- 2. Bulk list-price / discount updates of library feeder lines (Feeder
--    Master, admins only) with a per-line audit log for the admin space.
alter table feeders add column source_library_feeder_id uuid references feeders(id) on delete set null;

create table price_update_log (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  user_id uuid references profiles(id) on delete set null,
  feeder_id uuid references feeders(id) on delete set null,
  feeder_name text,
  feeder_tag text,
  item_id uuid references item_master(id) on delete set null,
  item_code text,
  item_description text,
  old_list_price numeric,
  new_list_price numeric,
  old_discount_pct numeric,
  new_discount_pct numeric
);
create index price_update_log_created on price_update_log (created_at desc);
alter table price_update_log enable row level security;
create policy "price log admin read" on price_update_log for select to authenticated using (is_admin());

create or replace function bulk_update_library_prices(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_lines integer := 0;
  v_feeders integer := 0;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'Only admins can bulk-update library feeder prices';
  end if;

  create temp table _p on commit drop as
  select (r->>'item_id')::uuid as item_id,
         (r->>'list_price')::numeric as list_price,
         nullif(r->>'discount_pct', '')::numeric as discount_pct
    from jsonb_array_elements(p_rows) r;

  insert into price_update_log (batch_id, user_id, feeder_id, feeder_name, feeder_tag, item_id, item_code, item_description,
                                old_list_price, new_list_price, old_discount_pct, new_discount_pct)
  select v_batch, auth.uid(), f.id, f.name, f.tag, im.id, coalesce(im.sku, im.vendor_cat), im.description,
         coalesce(fi.list_price_override, im.list_price), p.list_price,
         coalesce(fi.discount_pct_override, im.discount_pct), coalesce(p.discount_pct, fi.discount_pct_override, im.discount_pct)
    from feeder_items fi
    join feeders f on f.id = fi.feeder_id and f.is_library
    join item_master im on im.id = fi.item_id
    join _p p on p.item_id = fi.item_id;

  update feeder_items fi
     set list_price_override = p.list_price,
         discount_pct_override = coalesce(p.discount_pct, fi.discount_pct_override)
    from _p p, feeders f
   where p.item_id = fi.item_id and f.id = fi.feeder_id and f.is_library;
  get diagnostics v_lines = row_count;

  select count(distinct fi.feeder_id) into v_feeders
    from feeder_items fi join feeders f on f.id = fi.feeder_id and f.is_library
   where fi.item_id in (select item_id from _p);

  update feeders set updated_at = now()
   where is_library and id in (select fi.feeder_id from feeder_items fi where fi.item_id in (select item_id from _p));

  return json_build_object('batch_id', v_batch, 'lines', v_lines, 'feeders', v_feeders);
end;
$$;
revoke execute on function bulk_update_library_prices(jsonb) from public, anon;
grant execute on function bulk_update_library_prices(jsonb) to authenticated;
