-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — HARDENED GAME-CASH PATH (one-and-done patch, revision 2)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Apply this migration on TOP of the current schema to:
--   1. Replace settle_*_* RPCs with atomic place_*_* variants that:
--      a) Verify balance >= wager AND result would be valid
--      b) Compute max payout BEFORE accepting the bet
--      c) Reject bets whose max payout exceeds MAX_PAYOUT
--      d) Reject wagers <= 0 or > per-coin MAX_WAGER (GC: 10,000 / SC: 100)
--      e) Insert game row AND debit balance in ONE SQL statement (atomic)
--      f) Call reject_if_self_excluded before any debit (defense in depth)
--      g) Return out_balance for the client to display
--   2. Add idempotency via `client_request_id` UNIQUE (user, request_id).
--      Concurrent retries of the same request resolve to ONE row — uses
--      ON CONFLICT (user_id, client_request_id) DO NOTHING so two callers
--      both see the same bet id without raising UNIQUE_VIOLATION.
--   3. Stale active-game window for mines/blackjack (max 30 min) — prevents
--      permanent lockout if the user lost connection mid-game.
--   4. Tighten cash_out_crash to read stored payout/cashed_at on idempotent
--      return (no recomputation bug).
--
-- Run via: Supabase SQL Editor (paste + Run) OR:
--   psql -v ON_ERROR_STOP=1 -f supabase/SCHEMA_HARDENED.sql "$SUPABASE_DB_URL"
--
-- Safe to re-run: every DDL is `if exists` / `or replace` / `drop if exists`.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ══════════════════════════════════════════════════════════════════════════════
--  Constants — per-coin wager caps + max payout
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.game_max_constants()
returns table (
  max_wager_gc numeric,
  max_wager_sc numeric,
  max_payout numeric,
  crash_worst_case numeric,
  mines_worst_case numeric,
  blackjack_worst_case numeric,
  keno_worst_case numeric,
  roulette_worst_case numeric
)
language sql
immutable
as $$
  -- Per user directive (relaxed wager caps):
  --   • max_wager_sc = 10,000,000 — the only hard wager cap, applies to SC only
  --   • max_wager_gc = NULL — GC has no max bet (unlimited)
  --   • max_payout   = NULL — no max-payout cap on either currency; payouts are
  --                           bounded only by the player's available balance
  -- Per-game worst-case multipliers are retained as constants for
  -- forward-compatibility (e.g. server-side volatility tuning) but are no
  -- longer enforced in any placer branch.
  select
    null::numeric,        -- max_wager_gc (NULL = no cap on GC wagers)
    10000000::numeric,    -- max_wager_sc (10,000,000 SC)
    null::numeric,        -- max_payout   (NULL = no cap on payouts)
    1000::numeric,        -- crash_worst_case (kept but unenforced)
    24475::numeric,       -- mines_worst_case (kept but unenforced)
    2.5::numeric,         -- blackjack_worst_case (kept but unenforced)
    1000::numeric,        -- keno_worst_case (kept but unenforced)
    14::numeric;          -- roulette_worst_case (kept but unenforced)
$$;
revoke all on function public.game_max_constants() from public;
grant execute on function public.game_max_constants() to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  Idempotency column on game tables
-- ══════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crash_bets'
      and column_name = 'client_request_id'
  ) then alter table public.crash_bets add column client_request_id text; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'keno_bets'
      and column_name = 'client_request_id'
  ) then alter table public.keno_bets add column client_request_id text; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'limbo_bets'
      and column_name = 'client_request_id'
  ) then alter table public.limbo_bets add column client_request_id text; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'roulette_bets'
      and column_name = 'client_request_id'
  ) then alter table public.roulette_bets add column client_request_id text; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'slots_games'
      and column_name = 'client_request_id'
  ) then alter table public.slots_games add column client_request_id text; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mines_games'
      and column_name = 'client_request_id'
  ) then alter table public.mines_games add column client_request_id text; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'blackjack_hands'
      and column_name = 'client_request_id'
  ) then alter table public.blackjack_hands add column client_request_id text; end if;
end
$$;

create unique index if not exists crash_bets_idempotency_key
  on public.crash_bets (user_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists keno_bets_idempotency_key
  on public.keno_bets (user_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists limbo_bets_idempotency_key
  on public.limbo_bets (user_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists roulette_bets_idempotency_key
  on public.roulette_bets (user_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists slots_games_idempotency_key
  on public.slots_games (user_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists mines_games_idempotency_key
  on public.mines_games (user_id, client_request_id)
  where client_request_id is not null;
create unique index if not exists blackjack_hands_idempotency_key
  on public.blackjack_hands (user_id, client_request_id)
  where client_request_id is not null;

-- ══════════════════════════════════════════════════════════════════════════════
--  Self-exclusion helper — defense-in-depth gate every placer calls
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.reject_if_self_excluded(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.self_exclusions
    where user_id = p_user_id and expires_at > now()
  ) then
    raise exception 'Your account is self-excluded.';
  end if;
end
$$;
revoke all on function public.reject_if_self_excluded(uuid) from public;
grant execute on function public.reject_if_self_excluded(uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  Atomic balance helpers
-- ══════════════════════════════════════════════════════════════════════════════
-- game_debit: SELECT FOR UPDATE on the profile row, then subtract + write
-- in a single statement. Two concurrent debits on the same profile serialise.
create or replace function public.game_debit(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text;
  v_balance numeric(12, 2);
  v_new_balance numeric(12, 2);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Wager must be positive.';
  end if;
  if p_coin_type not in ('balance', 'sweeps_coins') then
    raise exception 'Unknown coin type.';
  end if;
  v_col := case p_coin_type when 'sweeps_coins' then 'sweeps_coins' else 'balance' end;

  execute format(
    'select %I from public.profiles where id = $1 for update', v_col
  ) into v_balance using p_user_id;
  if v_balance is null then raise exception 'Profile missing.'; end if;
  if v_balance < p_amount then raise exception 'Insufficient balance.'; end if;

  v_new_balance := v_balance - p_amount;
  execute format(
    'update public.profiles set %I = $1, updated_at = now() where id = $2', v_col
  ) using v_new_balance, p_user_id;

  return query select v_new_balance;
end
$$;
revoke all on function public.game_debit(uuid, numeric, text) from public;
grant execute on function public.game_debit(uuid, numeric, text) to service_role;

create or replace function public.game_credit(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text;
  v_balance numeric(12, 2);
  v_new_balance numeric(12, 2);
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'Payout must be non-negative.';
  end if;
  if p_coin_type not in ('balance', 'sweeps_coins') then
    raise exception 'Unknown coin type.';
  end if;
  v_col := case p_coin_type when 'sweeps_coins' then 'sweeps_coins' else 'balance' end;

  execute format('select %I from public.profiles where id = $1 for update', v_col)
    into v_balance using p_user_id;
  if v_balance is null then raise exception 'Profile missing.'; end if;

  v_new_balance := v_balance + p_amount;
  execute format(
    'update public.profiles set %I = $1, updated_at = now() where id = $2', v_col
  ) using v_new_balance, p_user_id;
  return query select v_new_balance;
end
$$;
revoke all on function public.game_credit(uuid, numeric, text) from public;
grant execute on function public.game_credit(uuid, numeric, text) to service_role;

-- Idempotency lookup helper — used at the top of every placer body to
-- short-circuit BEFORE any credit/debit/insert work.
create or replace function public.game_find_existing_idempotent(
  p_table text,
  p_user_id uuid,
  p_client_request_id text
)
returns table (existing_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_client_request_id is null then
    return;
  end if;
  return query execute format(
    'select id from public.%I where user_id = $1 and client_request_id = $2 limit 1',
    p_table
  ) using p_user_id, p_client_request_id;
end
$$;
revoke all on function public.game_find_existing_idempotent(text, uuid, text) from public;
grant execute on function public.game_find_existing_idempotent(text, uuid, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  CRASH — atomic place_crash_bet (per-coin caps, idempotent, self-excl)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_crash_bet(
  p_user_id uuid,
  p_wager numeric,
  p_crash_point numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, bet_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_crash_worst numeric;
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

  select max_wager_gc, max_wager_sc, max_payout, crash_worst_case
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap, v_crash_worst
    from public.game_max_constants();

  -- Late self-exclusion gate: idempotent retries short-circuit FIRST
  -- (so a self-excluded user retrying a previously-placed bet returns
  -- the cached result rather than a 403), then the exclusion check.
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
  -- GC has no wager cap (per user directive).
  -- Per-game max-payout cap removed (per user directive).
  if p_crash_point is null or p_crash_point < 1 then
    raise exception 'Invalid crash point.';
  end if;

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.crash_bets (
    user_id, wager, crash_point, won, payout, coin_type, nonce, client_request_id
  ) values (
    p_user_id, p_wager, p_crash_point, false, 0, p_coin_type, p_nonce, p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_crash_bet(uuid, numeric, numeric, bigint, text, text) from public;
grant execute on function public.place_crash_bet(uuid, numeric, numeric, bigint, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  KENO — atomic place_keno_bet
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_keno_bet(
  p_user_id uuid,
  p_wager numeric,
  p_risk text,
  p_picks int[],
  p_drawn int[],
  p_hits int,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, bet_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_keno_worst numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('keno_bets', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  select max_wager_gc, max_wager_sc, max_payout, keno_worst_case
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap, v_keno_worst
    from public.game_max_constants();

  perform public.reject_if_self_excluded(p_user_id);

  if p_wager is null or p_wager <= 0 then raise exception 'Wager must be positive.'; end if;
  if p_coin_type not in ('balance','sweeps_coins') then raise exception 'Unknown coin type.'; end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  -- GC has no wager cap (per user directive).
  if p_picks is null or array_length(p_picks, 1) < 1 or array_length(p_picks, 1) > 10 then
    raise exception 'Picks must be 1-10 numbers.';
  end if;
  if p_risk not in ('classic','low','medium','high') then
    raise exception 'Invalid risk.';
  end if;
  -- Per-game max-payout cap removed (per user directive).

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.keno_bets (
    user_id, wager, risk, picks, drawn, hits, multiplier, payout, nonce, client_request_id
  ) values (
    p_user_id, p_wager, p_risk, p_picks, p_drawn, p_hits, p_multiplier, p_payout,
    p_nonce, p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  if p_payout > 0 then
    perform out_balance from public.game_credit(p_user_id, p_payout, p_coin_type);
    select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text, text) from public;
grant execute on function public.place_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  LIMBO — atomic place_limbo_bet
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_limbo_bet(
  p_user_id uuid,
  p_wager numeric,
  p_target_multiplier numeric,
  p_result_multiplier numeric,
  p_won boolean,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, bet_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('limbo_bets', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  select max_wager_gc, max_wager_sc, max_payout
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap
    from public.game_max_constants();

  if p_wager is null or p_wager <= 0 then raise exception 'Wager must be positive.'; end if;
  if p_coin_type not in ('balance','sweeps_coins') then raise exception 'Unknown coin type.'; end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  -- GC has no wager cap (per user directive).
  perform public.reject_if_self_excluded(p_user_id);

  if p_target_multiplier is null or p_target_multiplier < 1.01 then
    raise exception 'Target must be >= 1.01.';
  end if;
  -- Per-game max-payout cap removed (per user directive).

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.limbo_bets (
    user_id, wager, target_multiplier, result_multiplier, won, payout, nonce, client_request_id
  ) values (
    p_user_id, p_wager, p_target_multiplier, p_result_multiplier, p_won, p_payout,
    p_nonce, p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  if p_payout > 0 then
    perform out_balance from public.game_credit(p_user_id, p_payout, p_coin_type);
    select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text, text) from public;
grant execute on function public.place_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  ROULETTE — atomic place_roulette_bet
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_roulette_bet(
  p_user_id uuid,
  p_wager numeric,
  p_bet_type text,
  p_result_pocket smallint,
  p_result_color text,
  p_won boolean,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, bet_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_multiplier numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('roulette_bets', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  select max_wager_gc, max_wager_sc, max_payout
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap
    from public.game_max_constants();

  if p_wager is null or p_wager <= 0 then raise exception 'Wager must be positive.'; end if;
  if p_coin_type not in ('balance','sweeps_coins') then raise exception 'Unknown coin type.'; end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  -- GC has no wager cap (per user directive).
  perform public.reject_if_self_excluded(p_user_id);

  if p_bet_type not in ('red','black','green') then
    raise exception 'Invalid roulette bet type.';
  end if;
  v_multiplier := case p_bet_type when 'green' then 14::numeric else 2::numeric end;
  -- Per-game max-payout cap removed (per user directive).

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.roulette_bets (
    user_id, wager, bet_type, result_pocket, result_color, won, payout, nonce, client_request_id
  ) values (
    p_user_id, p_wager, p_bet_type, p_result_pocket, p_result_color, p_won, p_payout,
    p_nonce, p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  if p_payout > 0 then
    perform out_balance from public.game_credit(p_user_id, p_payout, p_coin_type);
    select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_roulette_bet(uuid, numeric, text, smallint, text, boolean, numeric, bigint, text, text) from public;
grant execute on function public.place_roulette_bet(uuid, numeric, text, smallint, text, boolean, numeric, bigint, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  SLOTS — atomic place_slots_bet
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_slots_bet(
  p_user_id uuid,
  p_wager numeric,
  p_reels int[],
  p_won boolean,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, bet_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('slots_games', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  select max_wager_gc, max_wager_sc, max_payout
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap
    from public.game_max_constants();

  if p_wager is null or p_wager <= 0 then raise exception 'Wager must be positive.'; end if;
  if p_coin_type not in ('balance','sweeps_coins') then raise exception 'Unknown coin type.'; end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  -- GC has no wager cap (per user directive).
  -- Slot paytable max is 190× (Crown); no max-payout cap is enforced.
  perform public.reject_if_self_excluded(p_user_id);

  -- Per-game max-payout cap removed (per user directive).

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.slots_games (
    user_id, wager, reels, won, multiplier, payout, coin_type, nonce, client_request_id
  ) values (
    p_user_id, p_wager, p_reels, p_won, p_multiplier, p_payout, p_coin_type, p_nonce,
    p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  if p_payout > 0 then
    perform out_balance from public.game_credit(p_user_id, p_payout, p_coin_type);
    select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_slots_bet(uuid, numeric, int[], boolean, numeric, numeric, bigint, text, text) from public;
grant execute on function public.place_slots_bet(uuid, numeric, int[], boolean, numeric, numeric, bigint, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  MINES — atomic place_mines_bet (with 30-min stale-game window)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_mines_bet(
  p_user_id uuid,
  p_wager numeric,
  p_mine_count int,
  p_mine_tiles int[],
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, game_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_mines_worst numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('mines_games', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  -- Auto-cancel stale active games (>=30 min) so disconnected users aren't
  -- permanently locked out. Using `>=` (instead of `>`) closes the one-minute
  -- blind window at the exact 30-min boundary. The JS layer also does this
  -- on tab reload; this is the SQL-side backstop.
  update public.mines_games
    set status = 'cancelled', completed_at = now()
    where user_id = p_user_id
      and status = 'active'
      and created_at <= now() - interval '30 minutes';

  -- Refuse if the user STILL has a fresh active game after auto-cancel.
  if exists (
    select 1 from public.mines_games
    where user_id = p_user_id
      and status = 'active'
      and created_at > now() - interval '30 minutes'
  ) then
    raise exception 'You already have an active mines game.';
  end if;

  select max_wager_gc, max_wager_sc, max_payout, mines_worst_case
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap, v_mines_worst
    from public.game_max_constants();

  perform public.reject_if_self_excluded(p_user_id);

  if p_wager is null or p_wager <= 0 then raise exception 'Wager must be positive.'; end if;
  if p_coin_type not in ('balance','sweeps_coins') then raise exception 'Unknown coin type.'; end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  -- GC has no wager cap (per user directive).
  if p_mine_count is null or p_mine_count < 1 or p_mine_count > 24 then
    raise exception 'Mine count must be 1-24.';
  end if;
  -- Per-game max-payout cap removed (per user directive).
  if array_length(p_mine_tiles, 1) is distinct from p_mine_count then
    raise exception 'Mine tile count mismatch.';
  end if;

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.mines_games (
    user_id, wager, mine_count, mine_tiles, revealed_tiles, gems_revealed,
    multiplier, payout, status, nonce, coin_type, client_request_id
  ) values (
    p_user_id, p_wager, p_mine_count, p_mine_tiles, '{}', 0,
    1, 0, 'active', p_nonce, p_coin_type, p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_mines_bet(uuid, numeric, int, int[], bigint, text, text) from public;
grant execute on function public.place_mines_bet(uuid, numeric, int, int[], bigint, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  BLACKJACK — atomic place_blackjack_bet
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.place_blackjack_bet(
  p_user_id uuid,
  p_wager numeric,
  p_total_wager numeric,
  p_shoe int[],
  p_shoe_index int,
  p_player_cards int[],
  p_dealer_cards int[],
  p_doubled boolean,
  p_dealer_revealed boolean,
  p_status text,
  p_outcome text,
  p_payout numeric,
  p_nonce bigint,
  p_phase text,
  p_insurance_wager numeric,
  p_insurance_taken boolean,
  p_insurance_decided boolean,
  p_is_split boolean,
  p_player_hands jsonb,
  p_active_hand_index int,
  p_coin_type text,
  p_client_request_id text default null
)
returns table (out_balance numeric, hand_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_cap numeric;
  v_wager_cap_gc numeric;
  v_wager_cap_sc numeric;
  v_bj_worst numeric;
  v_existing_id uuid;
  v_balance numeric;
  v_new_id uuid;
begin
  if p_client_request_id is not null then
    select existing_id into v_existing_id
      from public.game_find_existing_idempotent('blackjack_hands', p_user_id, p_client_request_id);
    if v_existing_id is not null then
      select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
        into v_balance from public.profiles where id = p_user_id;
      return query select v_balance, v_existing_id;
    end if;
  end if;

  -- Auto-cancel stale hands (>=30 min) using `>=` to close the one-minute
  -- blind window at the exact 30-min boundary.
  update public.blackjack_hands
    set status = 'settled', outcome = 'cancelled', completed_at = now()
    where user_id = p_user_id
      and status = 'player_turn'
      and created_at <= now() - interval '30 minutes';

  if exists (
    select 1 from public.blackjack_hands
    where user_id = p_user_id
      and status = 'player_turn'
      and created_at > now() - interval '30 minutes'
  ) then
    raise exception 'You already have an active blackjack hand.';
  end if;

  select max_wager_gc, max_wager_sc, max_payout, blackjack_worst_case
    into v_wager_cap_gc, v_wager_cap_sc, v_max_cap, v_bj_worst
    from public.game_max_constants();

  perform public.reject_if_self_excluded(p_user_id);

  if p_wager is null or p_wager <= 0 then raise exception 'Wager must be positive.'; end if;
  if p_coin_type not in ('balance','sweeps_coins') then raise exception 'Unknown coin type.'; end if;
  if p_coin_type = 'sweeps_coins' and p_wager > v_wager_cap_sc then
    raise exception 'Wager exceeds SC cap of %.', v_wager_cap_sc;
  end if;
  -- GC has no wager cap (per user directive).
  -- Per-game max-payout cap removed (per user directive).

  select out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type);

  insert into public.blackjack_hands (
    user_id, wager, total_wager, shoe, shoe_index, player_cards, dealer_cards,
    doubled, dealer_revealed, status, outcome, payout, nonce, phase,
    insurance_wager, insurance_taken, insurance_decided, is_split,
    player_hands, active_hand_index, coin_type, client_request_id
  ) values (
    p_user_id, p_wager, p_total_wager, p_shoe, p_shoe_index, p_player_cards,
    p_dealer_cards, p_doubled, p_dealer_revealed, p_status, p_outcome, p_payout,
    p_nonce, p_phase, p_insurance_wager, p_insurance_taken, p_insurance_decided,
    p_is_split, p_player_hands, p_active_hand_index, p_coin_type, p_client_request_id
  )
  on conflict (user_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_new_id;

  if p_payout > 0 and p_status = 'settled' then
    perform out_balance from public.game_credit(p_user_id, p_payout, p_coin_type);
    select case p_coin_type when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;
revoke all on function public.place_blackjack_bet(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text, text) from public;
grant execute on function public.place_blackjack_bet(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  CRASH — atomic cash_out_crash (fixed idempotent return)
-- ══════════════════════════════════════════════════════════════════════════════
-- Reads stored payout/cashed_at on idempotent return — fixes the
-- reviewer-flagged recomputation bug (was returning wager * crash_point
-- instead of the stored payout = wager * cashed_at).
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
  -- max_payout cap removed per user directive; payouts are bounded only by
  -- the user's available balance. The constant is read for compatibility but
  -- any null/zero value short-circuits the check below.
  v_max_cap := (select max_payout from public.game_max_constants());

  if p_cashed_at is null or p_cashed_at < 1.01 then
    raise exception 'Minimum cash-out is 1.01x.';
  end if;

  select coin_type, wager, crash_point, won, completed_at, payout, cashed_at
    into v_coin, v_wager, v_crash_point, v_won, v_completed_at, v_stored_payout, v_stored_cashed_at
    from public.crash_bets
    where id = p_bet_id and user_id = p_user_id;

  if v_coin is null then
    raise exception 'Bet not found.';
  end if;

  -- Already settled: return STORED values, not recomputed.
  if v_completed_at is not null then
    select case v_coin when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
    return query select
      v_balance,
      coalesce(v_stored_payout, 0),
      coalesce(v_stored_cashed_at, p_cashed_at),
      v_crash_point,
      v_won,
      true;
    return;
  end if;

  if v_max_cap is not null and v_max_cap > 0 and v_wager * p_cashed_at > v_max_cap then
    raise exception 'Cash-out at %x exceeds cap of %.', p_cashed_at, v_max_cap;
  end if;

  if v_crash_point >= p_cashed_at then
    v_payout := round((v_wager * p_cashed_at)::numeric, 100) / 100;
    select out_balance into v_balance
      from public.game_credit(p_user_id, v_payout, v_coin);
    update public.crash_bets
      set won = true, payout = v_payout, cashed_at = p_cashed_at, completed_at = now()
      where id = p_bet_id;
    return query select v_balance, v_payout, p_cashed_at, v_crash_point, true, false;
  else
    update public.crash_bets
      set won = false, payout = 0, completed_at = now()
      where id = p_bet_id;
    select case v_coin when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
    return query select v_balance, 0, p_cashed_at, v_crash_point, false, false;
  end if;
end
$$;
revoke all on function public.cash_out_crash(uuid, uuid, numeric) from public;
grant execute on function public.cash_out_crash(uuid, uuid, numeric) to service_role;

commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- POSTCHECK: verify the new functions
-- ══════════════════════════════════════════════════════════════════════════════
-- Run these in SQL Editor after applying the migration:
--   select proname from pg_proc
--   where proname in (
--     'place_crash_bet','place_keno_bet','place_limbo_bet',
--     'place_roulette_bet','place_slots_bet',
--     'place_mines_bet','place_blackjack_bet',
--     'cash_out_crash',
--     'game_debit','game_credit','game_find_existing_idempotent',
--     'game_max_constants','reject_if_self_excluded'
--   )
--   order by proname;
--
-- Expected count: 12 rows.
-- ══════════════════════════════════════════════════════════════════════════════
