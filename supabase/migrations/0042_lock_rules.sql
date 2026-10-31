-- Switchboard lock rules, enforced in the database so no browser window,
-- tab or direct API call can get around them:
--  * only the holder (or an admin) can release a lock
--  * a lock can only be taken for yourself
--  * one lock per user at a time -- release the first before taking another
--  * a lock whose holder has had the switchboard closed (no heartbeat from
--    an open tab) for 10 minutes is released automatically. An open tab --
--    even in the background, even with unsaved changes -- keeps the lock.

create or replace function release_stale_switchboard_locks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- tell the guard trigger this is the system releasing, not a user
  perform set_config('app.lock_release_system', 'on', true);
  update switchboards s
     set locked_by = null, locked_at = null
   where s.locked_by is not null
     and greatest(
           coalesce(s.locked_at, '-infinity'::timestamptz),
           coalesce((select max(p.last_seen_at) from switchboard_presence p
                      where p.switchboard_id = s.id and p.user_id = s.locked_by), '-infinity'::timestamptz)
         ) < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  perform set_config('app.lock_release_system', 'off', true);
  return v_count;
end;
$$;
revoke execute on function release_stale_switchboard_locks() from public, anon;
grant execute on function release_stale_switchboard_locks() to authenticated;

create or replace function guard_switchboard_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other record;
begin
  if new.locked_by is not distinct from old.locked_by then
    return new;
  end if;
  if current_setting('app.lock_release_system', true) = 'on' and new.locked_by is null then
    return new;
  end if;
  -- releasing (or taking over) someone's lock
  if old.locked_by is not null and old.locked_by <> auth.uid() and not is_admin() then
    raise exception 'Only the user holding the lock or an admin can release it';
  end if;
  if new.locked_by is not null then
    if new.locked_by <> auth.uid() then
      raise exception 'You can only lock a switchboard for yourself';
    end if;
    select s.tag, p.code into v_other
      from switchboards s
      join revisions r on r.id = s.revision_id
      join projects p on p.id = r.project_id
     where s.locked_by = new.locked_by and s.id <> new.id
     limit 1;
    if found then
      raise exception 'You already have % (%) locked. Release it before opening another switchboard.', v_other.tag, v_other.code;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_switchboard_lock on switchboards;
create trigger trg_guard_switchboard_lock
  before update of locked_by on switchboards
  for each row execute function guard_switchboard_lock();

-- belt and braces against two windows locking at the same instant
create unique index if not exists switchboards_one_lock_per_user
  on switchboards (locked_by) where locked_by is not null;

-- lock_switchboard: clear stale locks first (so a forgotten lock doesn't
-- block you), then lock. The trigger enforces the rules above.
create or replace function lock_switchboard(p_switchboard_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sb switchboards%rowtype;
  v_archived boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  perform release_stale_switchboard_locks();

  select * into v_sb from switchboards where id = p_switchboard_id;
  if not found then
    raise exception 'Switchboard not found';
  end if;
  select archived into v_archived from revisions where id = v_sb.revision_id;
  if v_archived then
    raise exception 'Revision is archived';
  end if;
  if v_sb.locked_by is not null and v_sb.locked_by <> auth.uid() then
    raise exception 'Switchboard is already locked by another user';
  end if;
  if v_sb.locked_by = auth.uid() then
    update switchboards set locked_at = now() where id = p_switchboard_id;
    return;
  end if;
  begin
    update switchboards set locked_by = auth.uid(), locked_at = now() where id = p_switchboard_id;
  exception when unique_violation then
    raise exception 'You already have another switchboard locked. Release it before opening another one.';
  end;
end;
$$;

-- sweep every minute
create extension if not exists pg_cron;
select cron.schedule('release-stale-switchboard-locks', '* * * * *', 'select public.release_stale_switchboard_locks()');
