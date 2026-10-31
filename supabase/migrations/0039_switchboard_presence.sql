-- Who has a switchboard open right now. The workspace heartbeats a row every
-- ~30s; the dashboard treats rows seen in the last ~90s as "online".
create table switchboard_presence (
  switchboard_id uuid not null references switchboards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (switchboard_id, user_id)
);
alter table switchboard_presence enable row level security;
create policy "presence readable by signed-in users" on switchboard_presence for select to authenticated using (true);
create policy "users write own presence" on switchboard_presence for insert to authenticated with check (user_id = auth.uid());
create policy "users update own presence" on switchboard_presence for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users delete own presence" on switchboard_presence for delete to authenticated using (user_id = auth.uid());
-- new projects start as "Yet to quote" (stage id 'new')
alter table projects alter column stage set default 'new';
