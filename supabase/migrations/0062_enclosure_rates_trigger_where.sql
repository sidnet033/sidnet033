-- Saving the Enclosure Rates Master failed with "UPDATE requires a WHERE
-- clause": Supabase's safe-update guard rejects a WHERE-less UPDATE coming
-- from the API, and this trigger touches every ArTuK sub-part to recompute
-- its cost. Same update, with an explicit WHERE.
create or replace function public.trg_enclosure_rates_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update artuk_subparts set updated_at = updated_at where true;
  return null;
end $function$;
