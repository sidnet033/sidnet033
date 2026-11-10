-- Who last changed a project / revision, and when (switchboards already
-- track this via touch_switchboard_updated). Shown as "Last updated" on the
-- project summary, phone projects list and PDFs.
alter table projects
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table revisions
  add column if not exists updated_by uuid references profiles(id) on delete set null;

update projects p set updated_at = greatest(p.created_at,
  coalesce((select max(r.updated_at) from revisions r where r.project_id = p.id), p.created_at)),
  updated_by = p.created_by;
update revisions set updated_by = created_by where updated_by is null;

create or replace function touch_updated_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_touch_project_updated on projects;
create trigger trg_touch_project_updated before update on projects
  for each row when (old.* is distinct from new.*) execute function touch_updated_by();
drop trigger if exists trg_touch_revision_updated on revisions;
create trigger trg_touch_revision_updated before update on revisions
  for each row when (old.* is distinct from new.*) execute function touch_updated_by();
