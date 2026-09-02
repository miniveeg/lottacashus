-- ══════════════════════════════════════════════════════════════════════════════
-- Case Battles — realtime filters + orphan bots on leave/cancel
--
-- 1) postgres_changes filters on battle_id need REPLICA IDENTITY FULL (or the
--    filtered column in replica identity). Default PK-only replica identity
--    drops/suppresses filtered player/drop events — room UI then waits on
--    pot updates or reconnect (~tens of seconds). Client still refetches after
--    add-bot/join; this makes the subscription reliable too.
--
-- 2) cb_leave_battle cancelled battles left is_bot rows behind (user_id null).
--    When the creator cancels (or the last human leaves), delete remaining bots.
-- Idempotent; no data wipe beyond orphan bots on cancel.
-- ══════════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'case_battle_players'
  ) then
    execute 'alter table public.case_battle_players replica identity full';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'case_battle_drops'
  ) then
    execute 'alter table public.case_battle_drops replica identity full';
  end if;
end $$;

-- Ensure publication still includes the three tables (idempotent).
do $$
declare
  t text;
begin
  foreach t in array array['case_battles', 'case_battle_players', 'case_battle_drops']
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create or replace function public.cb_leave_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_players int;
  v_humans int;
  v_charge numeric;
  v_was_player boolean;
  v_is_creator boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then return; end if;
  if v_battle.status != 'waiting' then raise exception 'Cannot leave a started battle'; end if;

  select exists(
    select 1 from public.case_battle_players
    where battle_id = p_battle_id and user_id = v_uid
  ) into v_was_player;
  if not v_was_player then
    raise exception 'You are not in this battle';
  end if;

  v_is_creator := (v_battle.creator_id = v_uid);

  v_charge := round(v_battle.entry_cost * (100 - v_battle.borrow_percent) / 100.0, 2);
  perform public.bypass_profile_balance_guard();
  if v_battle.coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = sweeps_coins + v_charge, updated_at = now() where id = v_uid;
  else
    update public.profiles set balance = balance + v_charge, updated_at = now() where id = v_uid;
  end if;

  delete from public.case_battle_players where battle_id = p_battle_id and user_id = v_uid;
  update public.case_battles set pot_total = greatest(0, pot_total - v_charge) where id = p_battle_id;

  select count(*) into v_players from public.case_battle_players where battle_id = p_battle_id;
  select count(*) into v_humans
  from public.case_battle_players
  where battle_id = p_battle_id and coalesce(is_bot, false) = false;

  -- Creator cancel, or no humans left (bots alone) → cancel and scrub bots.
  if v_is_creator or v_humans = 0 then
    delete from public.case_battle_players
    where battle_id = p_battle_id and coalesce(is_bot, false) = true;
    update public.case_battles set status = 'cancelled' where id = p_battle_id;
  elsif v_players = 0 then
    update public.case_battles set status = 'cancelled' where id = p_battle_id;
  end if;
end;
$$;

revoke all on function public.cb_leave_battle(uuid) from public;
grant execute on function public.cb_leave_battle(uuid) to authenticated;
