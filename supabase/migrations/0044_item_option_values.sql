-- Distinct make / category / kA / poles values in Item Master, for the
-- Create Item dialog's dropdowns (the table is far too big to scan client-side).
create or replace function item_option_values()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'make', (select coalesce(json_agg(v order by lower(v)), '[]') from (select distinct trim(make) v from item_master where nullif(trim(make), '') is not null) x),
    'category', (select coalesce(json_agg(v order by lower(v)), '[]') from (select distinct trim(category) v from item_master where nullif(trim(category), '') is not null) x),
    'ka', (select coalesce(json_agg(v order by v), '[]') from (select distinct ka v from item_master where ka is not null) x),
    'poles', (select coalesce(json_agg(v order by v), '[]') from (select distinct poles v from item_master where poles is not null) x)
  );
$$;
grant execute on function item_option_values() to authenticated;
