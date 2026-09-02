-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 016 — Supabase cleanup: restore missing RPCs edges call
-- Additive only. Does NOT drop tables or wipe user data.
-- Includes: 004 claim/blackjack RPCs, full 010 crash_at + 7-arg place_crash_bet
-- + crash_settle_due_bets, cash_out_crash FOR UPDATE, slots_games service_role DML,
-- safe views, realtime pubs, NOTIFY pgrst.
--
-- DROP FUNCTION only for obsolete conflicting overloads (documented):
--   • public.cb_claim_payout(uuid, int, numeric) — superseded by 2-arg form
--     that credits stored payout_amount (004). Edge case-battle-v2 calls
--     cb_claim_payout(p_battle_id, p_slot) only.
--   • public.blackjack_update_active(uuid, uuid, int[], int) — old 4-arg form;
--     blackjack-game calls the 13-arg signature from complete-setup.
--   • public.place_crash_bet(uuid, numeric, numeric, bigint, text, text) — 6-arg;
--     replaced by 7-arg with defaulted p_round_duration_ms (010).
-- ══════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 0. Drop obsolete conflicting overloads (no data loss) ───────────────────
drop function if exists public.cb_claim_payout(uuid, int, numeric) cascade;
drop function if exists public.blackjack_update_active(uuid, uuid, int[], int) cascade;

-- ─── 1. cb_claim_payout(uuid, int) — canonical from 004 ──────────────────────
create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_player public.case_battle_players%rowtype;
  v_balance numeric;
  v_payout numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'completed' then raise exception 'Battle not completed'; end if;

  select * into v_player
  from public.case_battle_players
  where battle_id = p_battle_id and slot = p_slot
  for update;
  if not found then raise exception 'Player not found'; end if;
  if v_player.user_id is null or v_player.user_id != v_uid then
    raise exception 'You can only claim your own payout';
  end if;

  if v_player.claimed_at is not null then
    if v_battle.coin_type = 'sweeps_coins' then
      select sweeps_coins into v_balance from public.profiles where id = v_uid;
    else
      select balance into v_balance from public.profiles where id = v_uid;
    end if;
    return coalesce(v_balance, 0);
  end if;

  v_payout := coalesce(v_player.payout_amount, 0);
  if v_payout <= 0 then
    raise exception 'No payout available for this slot';
  end if;

  perform public.bypass_profile_balance_guard();

  if v_battle.coin_type = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles
    set sweeps_coins = v_balance, total_wins = total_wins + v_payout, updated_at = now()
    where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles
    set balance = v_balance, total_wins = total_wins + v_payout, updated_at = now()
    where id = v_uid;
  end if;

  update public.case_battle_players
  set claimed_at = now()
  where battle_id = p_battle_id and slot = p_slot;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    v_uid, 'win', v_payout, v_balance,
    'Case Battle payout (slot ' || p_slot || ', ' || v_battle.gamemode || ')',
    now()
  );

  return v_balance;
end;
$$;

revoke all on function public.cb_claim_payout(uuid, int) from public;
grant execute on function public.cb_claim_payout(uuid, int) to authenticated;

-- ─── 2. blackjack_update_active — canonical from lottacash-complete-setup ────
-- Signature matches blackjack-game/index.ts saveProgress rpc args.
create or replace function public.blackjack_update_active(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_shoe_index int,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0,
  p_is_split boolean default false,
  p_phase text default 'player_turn',
  p_total_wager numeric default null,
  p_doubled boolean default null,
  p_insurance_wager numeric default null,
  p_insurance_taken boolean default null,
  p_insurance_decided boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blackjack_hands h
  set
    player_cards = p_player_cards,
    shoe_index = p_shoe_index,
    player_hands = coalesce(p_player_hands, h.player_hands),
    active_hand_index = coalesce(p_active_hand_index, h.active_hand_index),
    is_split = coalesce(p_is_split, h.is_split),
    phase = coalesce(p_phase, h.phase),
    total_wager = coalesce(p_total_wager, h.total_wager),
    doubled = coalesce(p_doubled, h.doubled),
    insurance_wager = coalesce(p_insurance_wager, h.insurance_wager),
    insurance_taken = coalesce(p_insurance_taken, h.insurance_taken),
    insurance_decided = coalesce(p_insurance_decided, h.insurance_decided)
  where h.id = p_hand_id
    and h.user_id = p_user_id
    and h.status = 'player_turn';

  if not found then
    raise exception 'Active hand not found';
  end if;
end;
$$;

revoke all on function public.blackjack_update_active(uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean) from public;
grant execute on function public.blackjack_update_active(uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean) to service_role;

-- ─── 3. blackjack_debit_extra — canonical from 004 ───────────────────────────
create or replace function public.blackjack_debit_extra(
  p_user_id uuid,
  p_hand_id uuid,
  p_extra_wager numeric,
  p_description text default 'Extra wager',
  p_coin_type text default 'balance'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  v_coin text;
begin
  select coalesce(nullif(coin_type, ''), 'balance') into v_coin
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Hand not found'; end if;
  if v_coin not in ('balance', 'sweeps_coins') then v_coin := 'balance'; end if;
  -- Ignore client p_coin_type.

  perform public.bypass_profile_balance_guard();

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance < p_extra_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_extra_wager;

  if v_coin = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_extra_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_extra_wager, new_balance, upper(v_coin) || ' ' || p_description);
end;
$$;

revoke all on function public.blackjack_debit_extra(uuid, uuid, numeric, text, text) from public;
grant execute on function public.blackjack_debit_extra(uuid, uuid, numeric, text, text) to service_role;

-- ─── 4. blackjack_finish_hand — canonical from 004 ───────────────────────────
create or replace function public.blackjack_finish_hand(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_dealer_cards int[],
  p_shoe_index int,
  p_doubled boolean,
  p_total_wager numeric,
  p_dealer_revealed boolean,
  p_outcome text,
  p_payout numeric,
  p_extra_wager numeric default 0,
  p_phase text default 'settled',
  p_player_hands jsonb default null,
  p_is_split boolean default false,
  p_active_hand_index int default 0,
  p_insurance_wager numeric default 0,
  p_insurance_taken boolean default false,
  p_coin_type text default 'balance'
)
returns table (out_balance numeric, hand_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp();
  v_coin text;
begin
  select coalesce(nullif(coin_type, ''), 'balance') into v_coin
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Hand not found'; end if;
  if v_coin not in ('balance', 'sweeps_coins') then v_coin := 'balance'; end if;

  perform public.bypass_profile_balance_guard();

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + coalesce(p_payout, 0) - coalesce(p_extra_wager, 0);

  if v_coin = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
  end if;

  update public.blackjack_hands
  set status = 'settled', player_cards = p_player_cards, dealer_cards = p_dealer_cards, shoe_index = p_shoe_index, doubled = p_doubled, dealer_revealed = p_dealer_revealed, outcome = p_outcome, payout = coalesce(p_payout, 0), phase = p_phase, player_hands = p_player_hands, is_split = p_is_split, active_hand_index = p_active_hand_index, insurance_wager = p_insurance_wager, insurance_taken = p_insurance_taken, completed_at = now()
  where id = p_hand_id and user_id = p_user_id;

  if not found then
    raise exception 'Hand not found';
  end if;

  if coalesce(p_payout, 0) > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance, upper(v_coin) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
  end if;

  return query select new_balance, p_hand_id;
end;
$$;

revoke all on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric, text, jsonb, boolean, int, numeric, boolean, text) from public;
grant execute on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric, text, jsonb, boolean, int, numeric, boolean, text) to service_role;


-- ─── 5a. Crash 010 schema: crash_at / round_duration_ms + 7-arg place_crash_bet ─
-- Live still had 6-arg place_crash_bet and no crash_at columns (010 never applied).
alter table public.crash_bets
  add column if not exists crash_at timestamptz;

alter table public.crash_bets
  add column if not exists round_duration_ms bigint;

create index if not exists crash_bets_due_idx
  on public.crash_bets (crash_at)
  where completed_at is null and crash_at is not null;

-- Drop 6-arg overload so callers use 7-arg with defaulted 7th.
drop function if exists public.place_crash_bet(uuid, numeric, numeric, bigint, text, text) cascade;

create or replace function public.place_crash_bet(
  p_user_id uuid,
  p_wager numeric,
  p_crash_point numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null,
  p_round_duration_ms bigint default null
)
returns table (out_balance numeric, bet_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wager_cap_sc numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('crash_bets', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

  perform public.reject_if_self_excluded(p_user_id);

  if p_wager is null or p_wager <= 0 then
    raise exception 'Wager must be positive.';
  end if;
  if p_coin_type not in ('balance','sweeps_coins') then
    raise exception 'Unknown coin type.';
  end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  if p_crash_point is null or p_crash_point < 1 then
    raise exception 'Invalid crash point.';
  end if;

  select _gd.out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type) _gd;

  insert into public.crash_bets (
    user_id, wager, crash_point, won, payout, coin_type, nonce,
    client_request_id, round_duration_ms, crash_at
  ) values (
    p_user_id, p_wager, p_crash_point, false, 0, p_coin_type, p_nonce,
    p_client_request_id, p_round_duration_ms,
    case when p_round_duration_ms is not null
      then now() + (p_round_duration_ms * interval '1 millisecond')
      else null
    end
  )
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;

revoke all on function public.place_crash_bet(uuid, numeric, numeric, bigint, text, text, bigint) from public;
grant execute on function public.place_crash_bet(uuid, numeric, numeric, bigint, text, text, bigint) to service_role;

-- ─── 5. crash_settle_due_bets — canonical from 010 (+ service_role grant) ────
create or replace function public.crash_settle_due_bets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.crash_bets
    set won = false, completed_at = clock_timestamp()
    where completed_at is null
      and crash_at is not null
      and crash_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.crash_settle_due_bets() from public;
grant execute on function public.crash_settle_due_bets() to service_role;

-- ─── 6. cash_out_crash — 009 body + FOR UPDATE lock (from 001) ───────────────
-- Live body lacked FOR UPDATE on crash_bets row; race with settle loop.
create or replace function public.cash_out_crash(
  p_user_id uuid,
  p_bet_id uuid,
  p_cashed_at numeric
)
returns table (
  out_balance numeric,
  payout numeric,
  cashed_at numeric,
  crash_point numeric,
  success boolean,
  already_settled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_coin text;
  v_wager numeric;
  v_crash_point numeric;
  v_won boolean;
  v_completed_at timestamptz;
  v_stored_payout numeric;
  v_stored_cashed_at numeric;
  v_payout numeric;
  v_balance numeric;
begin
  perform public.reject_if_self_excluded(p_user_id);
  v_max_cap := (select max_payout from public.game_max_constants());

  if p_cashed_at is null or p_cashed_at < 1.01 then
    raise exception 'Minimum cash-out is 1.01x.';
  end if;

  select cb.coin_type, cb.wager, cb.crash_point, cb.won, cb.completed_at, cb.payout, cb.cashed_at
    into v_coin, v_wager, v_crash_point, v_won, v_completed_at, v_stored_payout, v_stored_cashed_at
    from public.crash_bets cb
    where cb.id = p_bet_id and cb.user_id = p_user_id
    for update;

  if v_coin is null then
    raise exception 'Bet not found.';
  end if;

  if v_completed_at is not null then
    select case v_coin when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
    return query select
      v_balance::numeric,
      coalesce(v_stored_payout, 0::numeric)::numeric,
      coalesce(v_stored_cashed_at, p_cashed_at)::numeric,
      v_crash_point::numeric,
      v_won::boolean,
      true::boolean;
    return;
  end if;

  if v_max_cap is not null and v_max_cap > 0 and v_wager * p_cashed_at > v_max_cap then
    raise exception 'Cash-out at %x exceeds cap of %.', p_cashed_at, v_max_cap;
  end if;

  if v_crash_point >= p_cashed_at then
    v_payout := round((v_wager * p_cashed_at)::numeric, 100) / 100;
    select _gc.out_balance into v_balance
      from public.game_credit(p_user_id, v_payout, v_coin) _gc;
    update public.crash_bets cb
      set won = true, payout = v_payout, cashed_at = p_cashed_at, completed_at = now()
      where cb.id = p_bet_id;
    return query select v_balance::numeric, v_payout::numeric, p_cashed_at::numeric, v_crash_point::numeric, true::boolean, false::boolean;
  else
    update public.crash_bets cb
      set won = false, payout = 0, completed_at = now()
      where cb.id = p_bet_id;
    select case v_coin when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
    return query select v_balance::numeric, 0::numeric, p_cashed_at::numeric, v_crash_point::numeric, false::boolean, false::boolean;
  end if;
end
$$;

revoke all on function public.cash_out_crash(uuid, uuid, numeric) from public;
grant execute on function public.cash_out_crash(uuid, uuid, numeric) to service_role;

-- ─── 7. Re-assert safe views security_invoker=false (no table wipe) ──────────
-- Prefer ALTER VIEW options when views already exist with correct columns.
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='crash_bets_safe' and c.relkind='v') then
    execute 'alter view public.crash_bets_safe set (security_barrier = true, security_invoker = false)';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='case_battles_safe' and c.relkind='v') then
    execute 'alter view public.case_battles_safe set (security_barrier = true, security_invoker = false)';
  end if;
end $$;

grant select on public.crash_bets_safe to authenticated;
grant select on public.case_battles_safe to authenticated, anon;

-- ─── 8. Realtime publication — case battle tables (idempotent) ───────────────
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

-- ─── 9. Re-assert service_role DML on game tables (from 015) ─────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'blackjack_hands',
    'crash_bets',
    'mines_games',
    'keno_bets',
    'limbo_bets',
    'roulette_bets',
    'slots_games',
    'case_battles',
    'case_battle_players',
    'case_battle_drops'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
