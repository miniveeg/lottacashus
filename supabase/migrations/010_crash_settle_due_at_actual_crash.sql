-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 010 — crash_settle_due_bets + 1-second pg_cron
--
-- ADDED: crash_at timestamptz column on crash_bets + round_duration_ms bigint
-- MODIFIED: place_crash_bet — optional 7th arg p_round_duration_ms bigint
--   Stores `crash_at = now() + p_round_duration_ms * interval '1 millisecond'`
--   at bet creation time so the server knows the implied wall-clock crash
--   moment without trusting any client-side signal.
-- ADDED: crash_settle_due_bets() — UPDATEs active rows WHERE crash_at <= now()
--   (won=false, completed_at=now()). Distinct from crash_settle_expired_bets
--   which only handles legacy NULL crash_at + very-old abandoned rows.
-- ADDED: pg_cron schedule for crash_settle_due_bets at 1-second cadence.
--
-- USER-FACING FIX: With this migration, when a user lets the chart auto-run
-- without clicking Cash Out, the chart now stops within ~1 second of the
-- actual crash_point and shows the correct multiplier. Previously the
-- chart would keep climbing for up to 2 minutes while crash_settle_expired_bets
-- waited to fire on legacy/abandoned rows only.
--
-- PROVABLY-FAIR INTEGRITY: UNCHANGED. The SQL RETURNS TABLE for
-- place_crash_bet is unchanged (out_balance, bet_id). The edge function
-- continues to NOT return crash_point. The crash_bets_safe view (which the
-- client uses to reveal crash_point post-completion) does NOT project
-- crash_at or round_duration_ms — only id, user_id, wager, crash_point,
-- won, payout, cashed_at, coin_type, nonce, created_at, completed_at.
-- A determined client could in principle reverse-engineer crash_point from
-- the stored (server-only) round_duration_ms via the public curve formula,
-- but that field is never returned to the client and is invisible to
-- them through any view.
--
-- DEPLOY ORDER (READ ME BEFORE RUNNING):
--   1. Run this migration FIRST, before redeploying the place-crash-bet
--      edge function. The edge function in its updated form calls
--      place_crash_bet with a 7-arg signature `(uuid, numeric, numeric,
--      bigint, text, text, bigint)`. If the live DB still has the OLD
--      6-arg place_crash_bet when the edge function redeploys, the call
--      will fail with: function place_crash_bet(uuid, numeric, numeric,
--      bigint, text, text, bigint) does not exist.
--   2. After this migration succeeds, deploy the updated place-crash-bet
--      Edge Function (it now passes p_round_duration_ms per round).
--   3. If pg_cron isn't installed in the target environment, the schedule
--      registration block at the bottom of this migration prints a NOTICE
--      with the manual cron.schedule(...) command. Run it after enabling
--      pg_cron (`create extension pg_cron;`).
--
-- LOCAL-ONLY POSTGRES (no pg_cron): the crash_settle_expired_bets 2-min
-- cron (still present, untouched) will continue backing up bets older
-- than 2 min. The 1-second settle-due cron only works with pg_cron.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- 1. crash_at + round_duration_ms columns. Nullable for back-fill: legacy
-- rows from before this migration have NULL on both.
alter table public.crash_bets
  add column if not exists crash_at timestamptz;

alter table public.crash_bets
  add column if not exists round_duration_ms bigint;

-- 2. Partial index keeps the 1-second cron filter cheap as the table grows.
-- Single-sided piece-wise index on crash_at with `completed_at IS NULL AND
-- crash_at IS NOT NULL` so legacy NULL rows don't bloat it.
create index if not exists crash_bets_due_idx
  on public.crash_bets (crash_at)
  where completed_at is null and crash_at is not null;

-- 3. Drop & recreate place_crash_bet with the new optional 7th arg.
--    DROP signature-specific (6-arg) so existing callers passing only 6
--    args continue to work via the new function with the 7th defaulted.
drop function if exists public.place_crash_bet(uuid, numeric, numeric, bigint, text, text) cascade;

create or replace function public.place_crash_bet(
  p_user_id uuid,
  p_wager numeric,
  p_crash_point numeric,
  p_nonce bigint,
  p_coin_type text,
  p_client_request_id text default null,
  -- round_duration_ms = wall-clock milliseconds the client curve
  -- `e^(0.008 * t^1.6)` should take to reach p_crash_point. Computed
  -- server-side in place-crash-bet edge fn from inverse formula. Optional
  -- (default null) so legacy callers continue to work; legacy rows fall
  -- back to crash_settle_expired_bets 2-min cron.
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
  -- GC has no wager cap (per user directive).
  if p_crash_point is null or p_crash_point < 1 then
    raise exception 'Invalid crash point.';
  end if;

  -- `gd` alias disambiguates the column reference: the enclosing function's
  -- RETURNS TABLE (out_balance numeric) implicitly declares a local variable
  -- `out_balance`, so a bare `out_balance` in the FROM list is ambiguous.
  -- Qualifying as gd.out_balance selects the column from the function call.
  select _gd.out_balance into v_balance from public.game_debit(p_user_id, p_wager, p_coin_type) _gd;

  -- crash_at when p_round_duration_ms is provided; NULL otherwise (legacy).
  -- + p_round_duration_ms * interval '1 millisecond' lets Postgres evaluate
  -- the millisecond addition without implicit-type coercion errors.
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

  -- Atomic race-condition guard. Concurrent submissions sharing the same
  -- client_request_id: FIRST wins the partial unique index; SECOND fires
  -- `do nothing`, returns no row, leaves v_new_id NULL → rollback the
  -- wallet debit we just did above. Unique index is the authoritative
  -- idempotency source.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

  return query select v_balance, v_new_id;
end
$$;

revoke all on function public.place_crash_bet(uuid, numeric, numeric, bigint, text, text, bigint) from public;
grant execute on function public.place_crash_bet(uuid, numeric, numeric, bigint, text, text, bigint) to service_role;

-- 4. New settle-due function: fires UPDATE at the implied crash time.
-- Distinct from crash_settle_expired_bets (which handles legacy NULL
-- crash_at rows and very-old abandoned rows). Both run on different
-- schedules; together they cover all active-bet paths.
create or replace function public.crash_settle_due_bets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- clock_timestamp() (vs now()) returns the actual current wall-clock time
  -- instead of transaction-start time. Lets the WHERE comparison match rows
  -- with microsecond precision at the moment the function fires. Combined
  -- with the sub-second crash-settle-loop Edge Function (50ms polling) +
  -- the +10ms buffer in place-crash-bet, settlement happens ~50-100ms after
  -- the implied wall-clock crash moment.
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

-- 5. Schedule the new function at 1-second cadence via pg_cron. Wrapped in
-- DO block with exception handler — the migration succeeds even when
-- pg_cron isn't installed (e.g. local-only Postgres). Operators can run
--   create extension pg_cron;
--   select cron.schedule('crash-settle-due-1s', '1 second',
--     $$select public.crash_settle_due_bets()$$);
-- manually after the fact to enable the schedule.
do $$
begin
  -- Clean up any pre-existing schedule with the same name (idempotent).
  perform cron.unschedule('crash-settle-due-1s');
exception when undefined_function or insufficient_privilege or feature_not_supported then
  null;
end
$$;

do $$
begin
  perform cron.schedule(
    'crash-settle-due-1s',
    '1 second',
    $cmd$select public.crash_settle_due_bets()$cmd$
  );
exception when undefined_function or insufficient_privilege or feature_not_supported then
  raise notice 'pg_cron not available; skipping crash_settle_due_bets schedule registration. After enabling pg_cron, run: select cron.schedule(''crash-settle-due-1s'', ''1 second'', $$select public.crash_settle_due_bets()$$);';
end
$$;

-- 6. POSTCHECK (operator can paste and run separately to verify). Lists the
--    round_duration_ms payloads and confirms schedule registration.
--
-- Expect (after running):
--   ▸ pg_proc has 7-arg place_crash_bet and 0-arg crash_settle_due_bets
--   ▸ every row in crash_bets has crash_at NOT NULL OR round_duration_ms IS NULL
--     (legacy rows allowed; everything post-migration-010 has crash_at)
--   ▸ cron.schedule row 'crash-settle-due-1s' present with schedule='1 second'

commit;
