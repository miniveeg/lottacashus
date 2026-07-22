-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 008 — Idempotency unique indexes: drop partial → recreate full
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ FIXES: ERROR: there is no unique or exclusion constraint matching the  ║
-- ║        ON CONFLICT specification (raised when player tries to bet)      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Background
-- ──────────
-- The placer SQL functions (place_crash_bet, place_keno_bet,
-- place_limbo_bet, place_roulette_bet, place_slots_bet, place_mines_bet,
-- place_blackjack_bet) all end with the idempotency guard:
--
--     insert into public.<game_table> (..., client_request_id)
--     values (..., p_client_request_id)
--     on conflict (user_id, client_request_id) do nothing
--     returning id into v_new_id;
--
-- The supporting unique indexes were originally created as PARTIAL unique
-- indexes with a predicate:
--
--     CREATE UNIQUE INDEX crash_bets_idempotency_key
--       ON public.crash_bets (user_id, client_request_id)
--       WHERE client_request_id IS NOT NULL;
--
-- PostgreSQL ON CONFLICT inference requires the conflict_target's WHERE
-- clause to MATCH (or be implied by) the partial index's predicate when
-- targeting a partial unique index. Our placer ON CONFLICT clauses
-- intentionally do NOT specify a WHERE clause — leaving it implicit so the
-- inference can find the right index across the board.
--
-- With a partial index having `WHERE client_request_id IS NOT NULL` and an
-- ON CONFLICT with no matching WHERE, inference fails and Postgres raises:
--
--     ERROR: there is no unique or exclusion constraint matching the ON
--     CONFLICT specification
--
-- This migration recreates those indexes as FULL (non-partial) unique
-- indexes so ON CONFLICT inference succeeds without any WHERE rewrite.
--
-- Why this is safe for NULLs
-- ──────────────────────────
-- PostgreSQL btree unique indexes treat NULL values as distinct by default
-- (NULLs are never equal to anything, including other NULLs). Multiple rows
-- with NULL client_request_id continue to coexist — the same behavior the
-- old `WHERE client_request_id IS NOT NULL` predicate was emulating. The
-- only behavioral difference is that NULL rows now also live in the index
-- (slightly more storage), which is negligible.
--
-- Safety / idempotency
-- ────────────────────
-- * DROP INDEX IF EXISTS — no error on re-run if the index is already gone.
-- * CREATE UNIQUE INDEX without IF NOT EXISTS — names are reused so the
--   statement either creates or replaces the previous drop. Inside a single
--   transaction this is atomic: either both succeed or both roll back.
-- * The bet tables are small (per-user wager history) so the brief
--   ACCESS EXCLUSIVE lock during the swap is sub-second.
-- * This migration is forward-compatible: it matches the canonical
--   idempotency-key definitions in supabase/FINAL_SCHEMA67.sql (post-fix).

begin;

-- Note: PostgreSQL CREATE INDEX does NOT allow schema-qualified index names.
-- The index name comes unqualified before the ON keyword; only the table
-- after ON can carry a schema qualifier. So:
--   CREATE UNIQUE INDEX name                  -- name (no public.)
--     ON public.table (cols);
-- This is asymmetric with DROP INDEX which DOES accept a qualified name.

-- crash
drop index if exists public.crash_bets_idempotency_key;
create unique index crash_bets_idempotency_key
  on public.crash_bets (user_id, client_request_id);

-- keno
drop index if exists public.keno_bets_idempotency_key;
create unique index keno_bets_idempotency_key
  on public.keno_bets (user_id, client_request_id);

-- limbo
drop index if exists public.limbo_bets_idempotency_key;
create unique index limbo_bets_idempotency_key
  on public.limbo_bets (user_id, client_request_id);

-- roulette
drop index if exists public.roulette_bets_idempotency_key;
create unique index roulette_bets_idempotency_key
  on public.roulette_bets (user_id, client_request_id);

-- slots
drop index if exists public.slots_games_idempotency_key;
create unique index slots_games_idempotency_key
  on public.slots_games (user_id, client_request_id);

-- mines
drop index if exists public.mines_games_idempotency_key;
create unique index mines_games_idempotency_key
  on public.mines_games (user_id, client_request_id);

-- blackjack
drop index if exists public.blackjack_hands_idempotency_key;
create unique index blackjack_hands_idempotency_key
  on public.blackjack_hands (user_id, client_request_id);

commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- POSTCHECK — run these to confirm the fix landed.
-- EXPECT: each indexdef ends with "(user_id, client_request_id);"
-- EXPECT: NO indexdef contains "WHERE client_request_id" anywhere.
-- ══════════════════════════════════════════════════════════════════════════════
-- select indexname, indexdef
--   from pg_indexes
--  where schemaname = 'public'
--    and indexname in (
--      'crash_bets_idempotency_key',
--      'keno_bets_idempotency_key',
--      'limbo_bets_idempotency_key',
--      'roulette_bets_idempotency_key',
--      'slots_games_idempotency_key',
--      'mines_games_idempotency_key',
--      'blackjack_hands_idempotency_key'
--    )
--  order by indexname;
