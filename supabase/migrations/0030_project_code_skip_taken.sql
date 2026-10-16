-- Project codes: skip any code already taken (a project created with an
-- explicit code, or a reset sequence) instead of failing the insert with
-- "duplicate key value violates unique constraint projects_code_key".
create or replace function set_project_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null then
    loop
      new.code := 'PRJ-' || to_char(now(), 'YY') || '-' || lpad(nextval('project_code_seq')::text, 3, '0');
      exit when not exists (select 1 from projects where code = new.code);
    end loop;
  end if;
  return new;
end;
$$;
