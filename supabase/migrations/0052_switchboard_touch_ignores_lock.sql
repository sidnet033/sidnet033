-- Opening / releasing a switchboard for editing (locked_by, locked_at) is
-- not an edit: keep its last-updated time and person. BOM / GA saves bump
-- updated_at explicitly, so they count.
create or replace function public.touch_switchboard_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - array['locked_by','locked_at','updated_at','updated_by'])
     = (to_jsonb(old) - array['locked_by','locked_at','updated_at','updated_by'])
     and new.updated_at is not distinct from old.updated_at then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
