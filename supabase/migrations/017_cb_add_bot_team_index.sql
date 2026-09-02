-- ══════════════════════════════════════════════════════════════════════════════
-- Case Battles — cb_add_bot must set team_index (NOT NULL)
--
-- PROBLEM: Live playtest on rsvabgdbrhtsmuklnctl:
--   cb_add_bot → Seat 2: null value in column "team_index" of relation
--   "case_battle_players" violates not-null constraint (HTTP 400)
--
-- Root cause: migrations 006/007/014 insert bots with
--   (battle_id, slot, is_bot, username, avatar_seed) only.
-- Live case_battle_players.team_index is NOT NULL with no default.
-- Human join (cb_join_battle) correctly computes team_index from
-- player_mode + slot; create seats the creator at team_index=0.
--
-- FIX: CREATE OR REPLACE cb_add_bot so the bot insert ALWAYS sets
-- team_index (and slot_index / coin_type) the same way as cb_join_battle:
--   2v2     → slots 0–1 team 0, slots 2–3 team 1
--   2v2v2   → team = slot / 2
--   3v3     → slots 0–2 team 0, slots 3–5 team 1
--   else    → team = slot  (1v1, 1v1v1, 1v1v1v1, 2p, 3p, 4p)
--
-- Also restores cb_create_battle creator insert to set team_index=0 /
-- slot_index=0 (migration 013 dropped those columns from the insert;
-- live adapter in cb_v2_live_create_join_leave.sql had them).
-- Idempotent; does not wipe data.
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.cb_add_bot(
  p_battle_id     uuid,
  p_bot_name      text    default null,
  p_slot_index    int     default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle  public.case_battles%rowtype;
  v_max     int;
  v_count   int;
  v_target  int;
  v_team    int;
  v_uid     uuid := auth.uid();
  v_name    text;
  v_coin    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then
    raise exception 'Battle not found';
  end if;
  if v_battle.creator_id <> v_uid then
    raise exception 'Only the creator can add bots';
  end if;
  if v_battle.status <> 'waiting' then
    raise exception 'Battle already started';
  end if;

  v_max := v_battle.max_players;
  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_max then
    raise exception 'Battle is full';
  end if;

  -- Resolve target slot (explicit free slot, else next free).
  v_target := -1;
  if p_slot_index is not null and p_slot_index >= 0 and p_slot_index < v_max then
    if not exists (
      select 1 from public.case_battle_players
      where battle_id = p_battle_id and coalesce(slot, slot_index) = p_slot_index
    ) then
      v_target := p_slot_index;
    end if;
  end if;
  if v_target = -1 then
    for i in 0..(v_max - 1) loop
      if not exists (
        select 1 from public.case_battle_players
        where battle_id = p_battle_id and coalesce(slot, slot_index) = i
      ) then
        v_target := i;
        exit;
      end if;
    end loop;
  end if;
  if v_target < 0 then
    raise exception 'No empty slots';
  end if;

  -- Match cb_join_battle team assignment for the battle's player_mode.
  v_team := case coalesce(v_battle.player_mode, v_battle.mode)
    when '2v2' then case when v_target < 2 then 0 else 1 end
    when '2v2v2' then (v_target / 2)
    when '3v3' then case when v_target < 3 then 0 else 1 end
    else v_target
  end;

  v_coin := coalesce(v_battle.coin_type, 'balance');

  v_name := coalesce(
    p_bot_name,
    'Bot_' || (array['CryptoKing','LuckyAce','RollDeep','HighRoller','TheWhale','JackpotJoe','AllIn','SpinMaster'])[v_target + 1]
  );

  insert into public.case_battle_players (
    battle_id, user_id, is_bot, team_index, slot_index, coin_type,
    slot, username, avatar_seed, payout_amount
  ) values (
    p_battle_id, null, true, v_team, v_target, v_coin,
    v_target, v_name, 'bot-' || v_target, 0
  );
end;
$$;

revoke all on function public.cb_add_bot(uuid, text, int) from public;
grant execute on function public.cb_add_bot(uuid, text, int) to authenticated;

-- Restore creator seat columns wiped by migration 013 (same NOT NULL root cause).
create or replace function public.cb_create_battle(
  p_gamemode text,
  p_crazy boolean,
  p_player_mode text,
  p_case_ids text[],
  p_entry_cost numeric,
  p_coin_type text,
  p_borrow_percent integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_rounds int := array_length(p_case_ids, 1);
  v_uid uuid := auth.uid();
  v_username text;
  v_coin text := coalesce(p_coin_type, 'balance');
  v_charge numeric;
  v_balance numeric;
  v_max int;
  v_mode text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_entry_cost is null or p_entry_cost < 0 then
    raise exception 'Entry cost must be non-negative';
  end if;
  if p_entry_cost > 100000 then
    raise exception 'Entry cost exceeds maximum (100,000)';
  end if;
  if p_borrow_percent is null or p_borrow_percent < 0 or p_borrow_percent > 80 then
    raise exception 'Borrow percent must be between 0 and 80';
  end if;
  if p_gamemode not in ('standard','group','terminal','jackpot') then
    raise exception 'Invalid gamemode';
  end if;
  if p_player_mode not in ('1v1','1v1v1','1v1v1v1','2v2','2v2v2','3v3','2p','3p','4p') then
    raise exception 'Invalid player mode';
  end if;
  if v_rounds is null or v_rounds < 1 or v_rounds > 50 then
    raise exception 'Must select 1–50 cases';
  end if;
  if p_gamemode = 'group' and p_crazy then
    raise exception 'Crazy mode is not available for Group battles';
  end if;
  if v_coin not in ('balance','sweeps_coins') then
    raise exception 'Invalid coin type';
  end if;

  v_max := case p_player_mode
    when '1v1' then 2 when '1v1v1' then 3 when '1v1v1v1' then 4
    when '2v2' then 4 when '2v2v2' then 6 when '3v3' then 6
    when '2p' then 2 when '3p' then 3 when '4p' then 4
    else 2 end;

  -- Live mode CHECK only allows 1v1/2v2/3v3/2v2v2 (not all V2 player_mode strings).
  v_mode := case p_player_mode
    when '1v1' then '1v1'
    when '2v2' then '2v2'
    when '3v3' then '3v3'
    when '2v2v2' then '2v2v2'
    else '1v1' end;

  v_charge := round(p_entry_cost * (100 - p_borrow_percent) / 100.0, 2);

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    if v_balance is null then raise exception 'Profile not found'; end if;
    if v_balance < v_charge then raise exception 'Insufficient balance'; end if;
    perform public.bypass_profile_balance_guard();
    update public.profiles set sweeps_coins = sweeps_coins - v_charge, updated_at = now() where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    if v_balance is null then raise exception 'Profile not found'; end if;
    if v_balance < v_charge then raise exception 'Insufficient balance'; end if;
    perform public.bypass_profile_balance_guard();
    update public.profiles set balance = balance - v_charge, updated_at = now() where id = v_uid;
  end if;

  select username into v_username from public.profiles where id = v_uid;
  if v_username is null then v_username := 'Player'; end if;

  insert into public.case_battles (
    creator_id, mode, cases, total_cost, entry_cost, status,
    gamemode, crazy, player_mode, max_players, case_ids, rounds,
    coin_type, borrow_percent, pot_total
  ) values (
    v_uid, v_mode, to_jsonb(p_case_ids), v_charge, p_entry_cost, 'waiting',
    p_gamemode, coalesce(p_crazy, false), p_player_mode, v_max, p_case_ids, v_rounds,
    v_coin, p_borrow_percent, v_charge
  )
  returning id into v_id;

  -- Creator always seat 0 / team 0 (matches prior live adapter).
  insert into public.case_battle_players (
    battle_id, user_id, is_bot, team_index, slot_index, coin_type,
    slot, username, avatar_seed, payout_amount
  ) values (
    v_id, v_uid, false, 0, 0, v_coin,
    0, v_username, v_uid::text, 0
  );

  return v_id;
end;
$$;

revoke all on function public.cb_create_battle(text, boolean, text, text[], numeric, text, int) from public;
grant execute on function public.cb_create_battle(text, boolean, text, text[], numeric, text, int) to authenticated;

do $$
begin
  begin
    perform pg_notify('pgrst', 'reload schema');
  exception when insufficient_privilege then
    raise notice 'Could not pg_notify (insufficient privilege). PostgREST cache will refresh automatically within ~30s.';
  end;
end $$;
