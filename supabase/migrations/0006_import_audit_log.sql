create table if not exists import_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text,
  created_count int not null default 0,
  updated_count int not null default 0,
  failed_count int not null default 0,
  failures jsonb not null default '[]'::jsonb,
  imported_by uuid references auth.users(id) on delete set null,
  imported_by_name text,
  created_at timestamptz not null default now()
);

alter table import_logs enable row level security;

create policy "import_logs read" on import_logs for select to authenticated using (true);
create policy "import_logs write" on import_logs for insert to authenticated with check (is_admin());

revoke all on import_logs from anon;
