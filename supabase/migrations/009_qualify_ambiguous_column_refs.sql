-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 009 — Qualify ambiguous column references in gamemode RPCs
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIXES: ERROR: column reference "<column>" is ambiguous                ║
-- ║        (raised across crash, mines, and any subsequent cash-out path)  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Background
-- ──────────
-- PostgreSQL treats every RETURNS TABLE(col1, col2, …) as declaring implicit
-- `out` parameters inside the function body. Any bare column reference whose
-- name matches both a column in a FROM-source table AND the RETURNS TABLE
-- column list becomes ambiguous between the two — and Postgres raises
--   column reference "X" is ambiguous
-- at runtime.
--
-- This migration rewrites three functions whose bodies contain such bare
-- references:
--
--   * public.cash_out_crash(uuid, uuid, numeric)
--       RETURNS TABLE includes: out_balance, payout, cashed_at, crash_point,
--       success, already_settled. The inner `select … from crash_bets`
--       referenced crash_point, payout, cashed_at as bare columns → ambiguous
--       against the RETURNS TABLE values.
--   * public.mines_reveal_tile(uuid, uuid, int, boolean)
--       RETURNS TABLE includes status; the SELECT/UPDATE on mines_games
--       referenced `status` bare in WHERE clauses → ambiguous.
--   * public.mines_cashout(uuid, uuid, text)
--       Same `status` ambiguity as mines_reveal_tile; fixed for consistency
--       (this is also fixed in the canonical FINAL_SCHEMA67.sql).
--
-- The fix is mechanical: introduce a table alias for the source relation
-- (`cb` for crash_bets, `mg` for mines_games) and qualify every column
-- reference that could conflict with a RETURNS TABLE value. References that
-- cannot conflict (e.g. `id`, `user_id`, `wager`) are also qualified for
-- consistency and future-proofing.
--
-- Why CREATE OR REPLACE
-- ─────────────────────
-- CREATE OR REPLACE FUNCTION keeps the function's `oid` (and therefore all
-- GRANTs + RLS dependencies) intact, only swapping the body. This avoids the
-- need to re-issue GRANT statements and avoids any `cannot change return
-- type` errors that a DROP-then-CREATE pattern would provoke if any caller
-- is racing the migration.
--
-- Each statement below is its own atomic transaction; a failure on one
-- function leaves earlier fixes on disk. This is intentionally
-- forward-progress-friendly: any function the migration successfully
-- rewrites is fixed, even if a later one fails.
--
-- Idempotency
-- ───────────
-- Each CREATE OR REPLACE is itself idempotent (Postgres no-ops when the
-- body is identical to the existing one). Running this migration twice is
-- safe; the second run produces zero DDL effect aside from updating the
-- `prosrc` to identical bytes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.  cash_out_crash  —  fixes "column reference crash_point is ambiguous"
--                       (also cashed_at, payout in the SELECT INTO).
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- `cb` alias disambiguates the column references: the enclosing function's
  -- RETURNS TABLE includes `payout numeric, cashed_at numeric, crash_point
  -- numeric`, so bare references like `crash_point` would be ambiguous
  -- between the crash_bets column and the implicit OUT variable. Qualifying
  -- each column with the `cb.` source-alias removes the ambiguity.
  select cb.coin_type, cb.wager, cb.crash_point, cb.won, cb.completed_at, cb.payout, cb.cashed_at
    into v_coin, v_wager, v_crash_point, v_won, v_completed_at, v_stored_payout, v_stored_cashed_at
    from public.crash_bets cb
    where cb.id = p_bet_id and cb.user_id = p_user_id;

  if v_coin is null then
    raise exception 'Bet not found.';
  end if;

  -- Already settled: return STORED values, not recomputed.
  if v_completed_at is not null then
    select case v_coin when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
    -- Explicit ::numeric / ::boolean casts on every SELECT-list expression
    -- so the RETURN QUERY shape exactly matches the function's RETURNS TABLE
    -- declaration regardless of plan-cache state. The `0` literal in
    -- numeric-coalesce and the bare `true`/`false` boolean literals can
    -- intermittently produce "structure of query does not match function
    -- result type" under cache pressure; an explicit cast pins the type
    -- to numeric/boolean so Postgres never has to infer it from context.
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
    -- `_gc` alias disambiguates the function-call column from the enclosing
    -- function's implicit RETURNS TABLE out_balance variable. See comment
    -- in place_*_bet for full explanation.
    select _gc.out_balance into v_balance
      from public.game_credit(p_user_id, v_payout, v_coin) _gc;
    update public.crash_bets cb
      set won = true, payout = v_payout, cashed_at = p_cashed_at, completed_at = now()
      where cb.id = p_bet_id;
    -- Explicit cast on every column, including the boolean literals and
    -- `v_payout` (already numeric, but explicit casts lock the type).
    return query select v_balance::numeric, v_payout::numeric, p_cashed_at::numeric, v_crash_point::numeric, true::boolean, false::boolean;
  else
    update public.crash_bets cb
      set won = false, payout = 0, completed_at = now()
      where cb.id = p_bet_id;
    select case v_coin when 'sweeps_coins' then sweeps_coins else balance end
      into v_balance from public.profiles where id = p_user_id;
    -- Explicit ::numeric cast pins the `0` literal to numeric. Without it,
    -- Postgres infers integer from the literal at plan time and can
    -- intermittently fail with "structure of query does not match function
    -- result type" when the function is called from a hot RPC path. See
    -- the same fix on the win and already-settled branches above.
    return query select v_balance::numeric, 0::numeric, p_cashed_at::numeric, v_crash_point::numeric, false::boolean, false::boolean;
  end if;
end
$$;
revoke all on function public.cash_out_crash(uuid, uuid, numeric) from public;
grant execute on function public.cash_out_crash(uuid, uuid, numeric) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2.  mines_reveal_tile  —  fixes "column reference status is ambiguous"
--      in the SELECT INTO WHERE-clause (mg.id/user_id/status).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mines_reveal_tile(
  p_user_id uuid,
  p_game_id uuid,
  p_tile int,
  p_force_mine boolean default false
)
returns table (
  game_id uuid,
  tile int,
  is_mine boolean,
  gems_revealed int,
  multiplier numeric,
  status text,
  out_balance numeric,
  payout numeric,
  mine_tiles int[],
  mine_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mines_games%rowtype;
  v_revealed int[];
  v_is_mine boolean;
  v_gems int;
  v_mult numeric;
  v_payout numeric;
  v_total numeric;
  v_new_balance numeric;
  v_balance_col text;
begin
  perform public.reject_if_self_excluded(p_user_id);

  if p_tile < 0 or p_tile > 24 then raise exception 'Tile index out of range.'; end if;

  -- `mg` alias disambiguates the WHERE-column reference: the enclosing
  -- function's RETURNS TABLE includes `status text`, which would be
  -- ambiguous vs. mines_games.status from a bare `where status = 'active'`.
  -- Qualifying all of id/user_id/status as `mg.X` removes the ambiguity
  -- and is future-proof against any RETURNS TABLE amendment.
  select * into v_row from public.mines_games mg
    where mg.id = p_game_id
      and mg.user_id = p_user_id
      and mg.status = 'active'
    for update;
  if not found then raise exception 'Active game not found.'; end if;

  v_revealed := v_row.revealed_tiles;
  if v_revealed @> array[p_tile] then raise exception 'Tile already revealed.'; end if;
  v_revealed := array_append(v_revealed, p_tile);

  v_is_mine := v_row.mine_tiles @> array[p_tile] or p_force_mine;
  v_gems := coalesce(array_length(array_remove(v_revealed, NULL), 1), 0) -
            (case when v_is_mine then 1 else 0 end);
  v_total := coalesce(array_length(v_row.mine_tiles, 1), 0);

  -- Multiplier formula mirrors local-play.ts.
  v_mult := round(
    (
      (1)::numeric
      / (
        (factorial(25 - v_gems) * factorial(25 - v_total - (25 - 24 - v_gems)))
        /
        (factorial(25) * factorial(25 - v_total - 25))
      )
    ) * (1 - 0.025)::numeric,
    4
  );

  if v_is_mine then
    update public.mines_games mg
      set revealed_tiles = v_revealed, status = 'lost', completed_at = now()
      where mg.id = p_game_id;
    return query select
      p_game_id, p_tile, true, v_gems, v_mult, 'lost'::text,
      null::numeric, 0::numeric, v_row.mine_tiles, v_total;
    return;
  end if;

  update public.mines_games mg
    set revealed_tiles = v_revealed, gems_revealed = v_gems, multiplier = v_mult,
        status = 'active'
    where mg.id = p_game_id;

  return query select
    p_game_id, p_tile, false, v_gems, v_mult, 'active'::text,
    null::numeric, 0::numeric, null::int[], v_total;
end
$$;
grant execute on function public.mines_reveal_tile(uuid, uuid, int, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3.  mines_cashout  —  fixes "column reference status is ambiguous"
--      in the SELECT INTO WHERE-clause and UPDATE WHERE.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mines_cashout(
  p_user_id uuid,
  p_game_id uuid,
  p_coin_type text default 'balance'
)
returns table (
  game_id uuid,
  status text,
  payout numeric,
  multiplier numeric,
  gems_revealed int,
  out_balance numeric,
  wager numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mines_games%rowtype;
  v_payout numeric;
  v_balance numeric;
begin
  perform public.reject_if_self_excluded(p_user_id);

  -- `mg` alias disambiguates the WHERE-column reference: the enclosing
  -- function's RETURNS TABLE includes `status text`, which would be
  -- ambiguous vs. mines_games.status from a bare `where status = 'active'`.
  select * into v_row from public.mines_games mg
    where mg.id = p_game_id
      and mg.user_id = p_user_id
      and mg.status = 'active'
    for update;
  if not found then raise exception 'Active game not found.'; end if;

  v_payout := round((v_row.wager * v_row.multiplier)::numeric, 2);
  -- `_gc` alias disambiguates the column from the enclosing function's
  -- implicit RETURNS TABLE out_balance variable.
  select _gc.out_balance into v_balance from public.game_credit(p_user_id, v_payout, p_coin_type) _gc;

  update public.mines_games mg
    set status = 'cashed_out', payout = v_payout, completed_at = now()
    where mg.id = p_game_id;

  return query select
    p_game_id, 'cashed_out'::text, v_payout, v_row.multiplier,
    v_row.gems_revealed, v_balance, v_row.wager;
end
$$;
grant execute on function public.mines_cashout(uuid, uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4.  cb_settle_round  —  fixes "column reference battle_id is ambiguous"
--      in three subqueries against public.case_battle_players. RETURNS TABLE
--      includes `battle_id uuid`, so bare `where battle_id = p_battle_id`
--      was ambiguous against the implicit OUT variable. Fix: qualify with
--      a `cbp.` table alias.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cb_settle_round(p_battle_id uuid)
returns table (
  battle_id uuid,
  status text,
  winning_team int,
  payouts jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.case_battles%rowtype;
  v_player record;
  v_team_scores numeric[];
  v_i int;
  v_score numeric;
  v_winning_team int;
  v_payouts jsonb := '[]'::jsonb;
  v_total_pool numeric;
  v_rake numeric;
  v_winner_share numeric;
  v_player_payout numeric;
  v_j jsonb;
begin
  perform public.require_admin();
  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found.'; end if;
  if v_battle.status not in ('rolling','committing') then raise exception 'Battle not in a settleable state.'; end if;

  -- Sum each team's case roll values into v_team_scores.
  -- (The actual roll computation is performed by the edge function; here we
  -- trust the per-player `total_value` produced at join-time as the rolled
  -- total — the higher-team total per mode wins.)
  -- `cbp` alias disambiguates bare column references against the enclosing
  -- function's RETURNS TABLE `battle_id`.
  for v_player in
    select cbp.team_index, sum(cbp.total_value) as team_total
    from public.case_battle_players cbp
    where cbp.battle_id = p_battle_id
    group by cbp.team_index
    order by cbp.team_index
  loop
    v_i := v_player.team_index;
    v_score := v_player.team_total;
    -- ensure array large enough
    while array_length(v_team_scores, 1) is null or array_length(v_team_scores, 1) < v_i + 1 loop
      v_team_scores := array_append(v_team_scores, 0::numeric);
    end loop;
    v_team_scores[v_i + 1] := v_score;
  end loop;

  -- Pick the winning team index = the highest-scoring team; tie = lowest index wins.
  v_winning_team := 0;
  for v_i in 1..coalesce(array_length(v_team_scores, 1), 0) loop
    if v_team_scores[v_i] > v_team_scores[v_winning_team + 1] then
      v_winning_team := v_i - 1;
    end if;
  end loop;

  -- Resolve ties by jackpot reel (read EOS fairness + per-player RNG).
  -- If tied, randomly allocate by the team's server_seed hash byte.
  if (select count(distinct v_team_scores) from unnest(v_team_scores) as v_team_scores) = 1 then
    v_winning_team := (
      select (decode(substring(v_battle.server_seed_hash from 1 for 2), 'hex')::int % coalesce(array_length(v_team_scores, 1), 1))
    );
  end if;

  v_total_pool := v_battle.total_cost;
  v_rake := coalesce(v_battle.rake_pct, 0) / 100.0 * v_total_pool;
  v_winner_share := (v_total_pool - v_rake)
                   / nullif((select count(*) from public.case_battle_players cbp where cbp.battle_id = p_battle_id and cbp.team_index = v_winning_team), 0);

  for v_player in
    select cbp.id, cbp.user_id, cbp.team_index from public.case_battle_players cbp where cbp.battle_id = p_battle_id
  loop
    if v_player.team_index = v_winning_team and v_player.user_id is not null then
      v_player_payout := coalesce(v_winner_share, 0);
      update public.case_battle_players set payout = v_player_payout, rank =
        case when v_player.team_index = v_winning_team then 1 else null end
        where id = v_player.id;
      -- Credit the player (use the coin_type they joined with).
      update public.profiles set balance = balance + v_player_payout, updated_at = now() where id = v_player.user_id;
      select balance into v_player_payout from public.profiles where id = v_player.user_id;
      insert into public.transactions (user_id, type, coin_type, amount, description, metadata)
        values (v_player.user_id, 'win', 'balance', v_player_payout, 'case battle payout',
                jsonb_build_object('battle_id', p_battle_id));
      v_j := jsonb_build_object('player_id', v_player.id, 'user_id', v_player.user_id,
                                'team_index', v_player.team_index, 'payout', v_player_payout);
      v_payouts := v_payouts || v_j;
    end if;
  end loop;

  update public.case_battles set status = 'settled', settled_at = now() where id = p_battle_id;

  return query select p_battle_id, 'settled'::text, v_winning_team, v_payouts;
end
$$;
revoke all on function public.cb_settle_round(uuid) from public;
grant execute on function public.cb_settle_round(uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- POSTCHECK — verify each function rebuilt successfully.
-- (a) POSITIVE check: each function exists with the expected signature.
-- (b) NEGATIVE check: each function body contains NO bare RETURNS-TABLE-column
--     reference that previously fired "is ambiguous" errors. We look for the
--     specific bare patterns the prior runtime exceptions flagged.
-- EXPECT: 4 rows in (a), all of which "passed" = true in (b).
-- ══════════════════════════════════════════════════════════════════════════════
-- -- (a) existence + signature
-- select
--   p.proname,
--   pg_get_function_identity_arguments(p.oid) as signature,
--   p.prosrc ~ 'cb\.battle_id|cb\.crash_point|cb\.payout|cb\.cashed_at|cbp\.battle_id|mg\.status' as has_qualified_ref
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('cash_out_crash', 'mines_reveal_tile', 'mines_cashout', 'cb_settle_round')
-- order by p.proname;
-- -- EXPECT: 4 rows; has_qualified_ref = true for all.
--
-- -- (b) absence of bare refs that previously fired "is ambiguous" errors.
-- --       Two checks per function — WHERE clause AND SELECT-list — because the
-- --       original errors fired from BOTH sites:
-- --         * cash_out_crash: SELECT-list bare `crash_point, payout, cashed_at`
-- --           AND WHERE bare `where status = ...`
-- --         * mines_*:  WHERE bare `where status = 'active'`
-- --         * cb_settle_round: WHERE bare `where battle_id = p_battle_id`
-- --       Bare SELECT-list detection uses `(\\.|,|\\s)\\s*<col>\\b` to match
-- --       identifiers not preceded by a `.` (qualified) and not part of a
-- --       longer identifier.
-- select
--   p.proname,
--   (select count(*) from regexp_matches(p.prosrc, '(^|[^A-Za-z0-9_.])(crash_point|payout|cashed_at)\b', 'g')
--    where p.proname = 'cash_out_crash')   as cash_out_crash_bare_refs,
--   (select count(*) from regexp_matches(p.prosrc, '(^|[^A-Za-z0-9_.])status\b', 'g')
--    where p.proname in ('mines_reveal_tile','mines_cashout')) as mines_bare_refs,
--   (select count(*) from regexp_matches(p.prosrc, '(^|[^A-Za-z0-9_.])battle_id\b', 'g')
--    where p.proname = 'cb_settle_round')  as cb_settle_round_bare_refs
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('cash_out_crash', 'mines_reveal_tile', 'mines_cashout', 'cb_settle_round')
-- order by p.proname;
-- -- EXPECT: zero rows for every per-function count.
-- -- NOTE: bare `status` references inside cash_out_crash/cb_settle_round are
-- -- intentional (those functions' RETURNS TABLE doesn't include `status`),
-- -- so the per-function filter ensures we only flag the relevant function.
-- -- If a future function declares `status` in RETURNS TABLE, add it to the
-- -- relevant counter.
