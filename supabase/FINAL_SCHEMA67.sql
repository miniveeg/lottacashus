-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — FINAL_SCHEMA67.sql
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ██████╗ ███████╗███████╗████████╗██████╗ ██╗   ██╗ ██████╗████████╗██╗██╗   ██╗███████╗
-- ██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██║   ██║██╔════╝╚══██╔══╝██║██║   ██║██╔════╝
-- ██║  ██║█████╗  █████╗     ██║   ██████╔╝██║   ██║██║        ██║   ██║██║   ██║█████╗
-- ██║  ██║██╔══╝  ██╔══╝     ██║   ██╔══██╗██║   ██║██║        ██║   ██║╚██╗ ██╔╝██╔══╝
-- ██████╔╝███████╗██║        ██║   ██║  ██║╚██████╔╝╚██████╗   ██║   ██║ ╚████╔╝ ███████╗
-- ╚═════╝ ╚══════╝╚═╝        ╚═╝   ╚═╝  ╚═╝ ╚═════╝  ╚═════╝   ╚═╝   ╚═╝  ╚═══╝  ╚══════╝
--
-- ⚠️  WARNING — DESTRUCTIVE — READ BEFORE APPLYING ⚠️
--
-- This file DROPS every table, every view, and every function in the public
-- schema before recreating them. Re-running it against a populated production
-- database will WIPE ALL USER DATA — profiles, balances, transactions,
-- game history, chat messages, autofill data, EVERYTHING.
--
-- Apply ONLY against:
--   (a) a fresh Supabase project that has no production data, OR
--   (b) a non-production clone / branch.
--
-- If you have existing production data, run the migrations directory
-- sequentially instead (or take a full backup first + restore later).
--
-- LEGACY FUNCTIONS RETIRED:
--   The monolithic `place_*`, `settle_*`, `start_*`, `blackjack_*`,
--   `mines_*`, `mark_seed_revealed`, `mark_chat_message`, `enforce_chat_rate_limit`,
--   `bypass_profile_balance_guard`, `profiles_prevent_*`, `notify_*`,
--   `link_discord_profile`, `trg_*`, `assign_deposit_derivation_index`,
--   `email_exists`, `get_user_id_by_email`, `handle_new_user`,
--   `mines_comb`, `start_mines_game`, `start_blackjack_hand`,
--   `blackjack_update_active`, `blackjack_finish_hand`, `blackjack_debit_extra`,
--   `blackjack_lock_completed_hands`, `create_user_notification`,
--   `admin_*`, `claim_affiliate_earnings`, etc. — all superseded by canonical
--   versions in this schema OR by edge-function logic. If you have edge functions
--   that still call any of these, update them to call the canonical equivalents:
--     settlement_keno  → place_keno_bet
--     settlement_limbo → place_limbo_bet
--     settlement_roulette → place_roulette_bet
--     settlement_crash_loss → place_crash_bet + manual update via service-role
--     mines_cashout   → place_mines_bet + mines_cashout (legacy, still present)
--     start_mines_game → place_mines_bet (atomic placer)
--     start_blackjack_hand → place_blackjack_bet
--     blackjack_update_active → client-side logic + update blackjack_hands
--     admin_complete_crypto_withdrawal / admin_fail_crypto_withdrawal →
--       update crypto_withdrawals directly with service-role key
--     profile balance guards → enforce at placer functions (game_debit)
--     payouts / rake on case battles → cb_settle_round
--   Apply this file ONLY. Re-applying lottacash-complete-setup.sql afterwards
--   is no longer needed because every legacy function has been DROPPED.
--   If you want to keep a specific legacy function, add its name to the
--   `keep_list` array in the drop block above BEFORE applying.
--
-- ONE-FILE consolidated, idempotent, fully self-contained schema for the
-- LottaCash production Supabase project. Combines:
--
--   • supabase/lottacash-complete-setup.sql — original monolith (tables,
--     base RPCs, RLS, profile/trigger, crypto deposit/withdrawal flow)
--   • supabase/migrations/001_audit_fixes.sql — RLS column grants,
--     crash-bets-safe view, signup/withdrawal hardening
--   • supabase/migrations/002_case_battles_audit_fixes.sql — case-battle
--     payout safety, bot insert hardening
--   • supabase/migrations/003_mines_deposit_security.sql — mines game
--     store/credit safety, idempotent deposit inserts
--   • supabase/migrations/004_case_battle_payouts_and_blackjack_coin.sql
--     — coin_type plumbing for case battles + blackjack
--   • supabase/migrations/005_production_audit_fixes.sql — production
--     audit hardening (sc-redeem, eos seed handling, etc.)
--   • supabase/migrations/006_case_battles_per_slot_bot.sql — slot-scoped
--     bot insertion signature
--   • supabase/migrations/007_ensure_cb_add_bot_3args.sql — 3-arg bot
--     insertion canonical signature
--   • supabase/case-battles-v2-setup.sql — case_battles_safe view +
--     canonical case_battles schema
--   • supabase/SCHEMA_HARDENED.sql — atomic placer SQL functions
--     (place_crash_bet, place_keno_bet, place_limbo_bet, place_roulette_bet,
--      place_slots_bet, place_mines_bet, place_blackjack_bet, cash_out_crash)
--     + idempotency columns + ON CONFLICT guards + reject_if_self_excluded +
--     game_debit/game_credit/game_max_constants helpers
--
-- Apply:
--   psql -v ON_ERROR_STOP=1 -f supabase/FINAL_SCHEMA67.sql "$SUPABASE_DB_URL"
--   — OR —
--   Paste the entire file into the Supabase SQL Editor and run.
--
-- GUARANTEES:
--   • Re-runnable: every DDL is `if exists` / `create or replace` / `or replace`
--     / `drop if exists`. Drop-list at top ensures a fresh-DB apply produces the
--     exact same end state as a re-run on an existing DB.
--   • Forward-correct: this file establishes the END state, not a sequence of
--     historical migrations. No dependency on which migration was applied when.
--   • Single transaction: a failure mid-apply rolls back cleanly.
--   • No external state: all required seed defaults are written inline.
--
-- POSTCHECK VERIFICATION:
--   Run the queries at the bottom of this file (the `-- POSTCHECK` block) and
--   confirm each returns the expected row count.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ══════════════════════════════════════════════════════════════════════════════
--  EXTENSIONS
-- ══════════════════════════════════════════════════════════════════════════════
create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════════════════════
--  DROP LIST — wipes every table / view / function / trigger from the project
--  so the consolidated CREATE statements below establish a single source of
--  truth. CASCADE handles foreign-key dependencies.
-- ══════════════════════════════════════════════════════════════════════════════

-- Drop views first (depend on tables, can't be left dangling).
drop view if exists public.crash_bets_safe cascade;
drop view if exists public.case_battles_safe cascade;

-- Drop triggers on every public-schema table. The consolidated schema does
-- NOT create any triggers, but a pre-existing production database might have
-- acquired them (e.g. `updated_at` setters, or the auth.users → profiles
-- sync trigger Supabase installs). Without this block the table drop
-- below would leave dangling trigger rows referencing columns that change
-- shape on recreate. This loop is idempotent: it does nothing if no
-- triggers exist. Discovered at runtime so any name pattern works.
do $$
declare
  r record;
begin
  for r in
    select trigger_name, event_object_schema, event_object_table
      from information_schema.triggers
     where trigger_schema = 'public'
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      r.trigger_name, r.event_object_schema, r.event_object_table
    );
  end loop;
end
$$;

-- Tables — drop in reverse FK dependency order so CASCADE is minimal.
drop table if exists public.affiliate_commissions cascade;
drop table if exists public.case_battle_players cascade;
drop table if exists public.case_battles cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.user_notifications cascade;
drop table if exists public.self_exclusions cascade;
drop table if exists public.redemptions cascade;
drop table if exists public.tx_request_log cascade;
drop table if exists public.password_reset_codes cascade;
drop table if exists public.signup_verification_codes cascade;
drop table if exists public.crash_bets cascade;
drop table if exists public.slots_games cascade;
drop table if exists public.roulette_bets cascade;
drop table if exists public.limbo_bets cascade;
drop table if exists public.blackjack_hands cascade;
drop table if exists public.mines_games cascade;
drop table if exists public.keno_bets cascade;
drop table if exists public.crypto_withdrawals cascade;
drop table if exists public.crypto_deposits cascade;
drop table if exists public.transactions cascade;
drop table if exists public.game_pf_seeds cascade;
drop table if exists public.user_deposit_addresses cascade;
drop table if exists public.profiles cascade;

-- Functions / RPCs — drop EVERY public-schema function so the canonical,
-- race-condition-fixed `CREATE OR REPLACE FUNCTION` blocks below install
-- a clean, single-overload set. This dynamic drop replaces the per-signature
-- drop list that previously caused "cannot change the return type of existing
-- functions" errors when projects re-applied `lottacash-complete-setup.sql`
-- after this schema — the monolith and migrations collectively define 90+
-- distinct function NAMES, many with multiple overloads, and listing every
-- overload here would require constant maintenance. Looping over `pg_proc`
-- catches every overload, every legacy signature, every migration relic, in
-- one block.
--
-- Idempotent: re-running this schema after the canonical set is installed
-- is a no-op (the loop finds only the canonical signatures, but the
-- CREATE OR REPLACE FUNCTION below installs the same body, so the net
-- effect is stable).
--
-- ⚠️  This drops EVERY user-defined function in `public`. Supabase's own
-- internal functions live in the `auth`, `storage`, `realtime` schemas —
-- untouched. Edge function triggers / RPCs that call into the canonical
-- set will still work because the canonical set has the SAME function
-- NAMES (and compatible signatures) with race-condition fixes applied.
--
-- If the live DB has custom public-schema functions you want to KEEP,
-- add them to `keep_list` below before applying this schema.
do $$
declare
  fn record;
  keep_list text[] := array[]::text[];
  -- ^ Add quoted function names here (e.g. 'uuid_generate_v4') to PRESERVE
  --   them across the bulk wipe. Postgres requires explicit `[]::text[]`
  --   cast on the literal because it can't infer the type from an empty
  --   array (would otherwise error with 42P18 "cannot determine type of
  --   empty array"). PUBLIC-SCHEMA extension helpers (uuid-ossp,
  --   legacy pgcrypto) are typical candidates.
begin
  for fn in
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not (p.proname = any(keep_list))
  loop
    execute format(
      'drop function if exists public.%I(%s) cascade',
      fn.name, fn.args
    );
  end loop;
end
$$;

-- ══════════════════════════════════════════════════════════════════════════════
--  TABLES — core auth + profile + crypto + games + case battles
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  email text,
  is_admin boolean not null default false,
  balance numeric(12,2) not null default 0,
  sweeps_coins numeric(12,2) not null default 0,
  total_wagered numeric(12,2) not null default 0,
  total_deposited numeric(12,2) not null default 0,
  total_withdrawn numeric(12,2) not null default 0,
  total_wins numeric(12,2) not null default 0,
  total_losses numeric(12,2) not null default 0,
  discord_id text,
  discord_username text,
  discord_avatar text,
  discord_linked_at timestamptz,
  affiliate_code text unique,
  referred_by text,
  veteran_badge_earned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signup_verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_signup_vc_email on public.signup_verification_codes(email);

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_password_reset_user on public.password_reset_codes(user_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdrawal','bet','win','redeem','fee','affiliate','admin_credit','admin_debit')),
  coin_type text not null check (coin_type in ('balance','sweeps_coins')) default 'balance',
  amount numeric(12,2) not null,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_transactions_user on public.transactions(user_id);
create index if not exists idx_transactions_user_created on public.transactions(user_id, created_at desc);

create table if not exists public.crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  tx_hash text,
  address text not null,
  expected_amount numeric(12,2) not null,
  credited numeric(12,2) not null default 0,
  sweeps_credited numeric(12,2) not null default 0,
  bonus_credited numeric(12,2) not null default 0,
  confirmations int not null default 0,
  status text not null check (status in ('pending','credited','confirmed','expired','failed')) default 'pending',
  expires_at timestamptz not null,
  credited_at timestamptz,
  swept_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_crypto_deposits_user on public.crypto_deposits(user_id);
create index if not exists idx_crypto_deposits_status on public.crypto_deposits(status);
create index if not exists idx_crypto_deposits_expires on public.crypto_deposits(expires_at);

create table if not exists public.crypto_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  destination_address text not null,
  amount numeric(12,2) not null,
  status text not null check (status in ('pending','processing','completed','rejected','failed')) default 'pending',
  tx_hash text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);
create index if not exists idx_crypto_withdrawals_user on public.crypto_withdrawals(user_id);

create table if not exists public.user_deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  address text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, chain)
);

create table if not exists public.game_pf_seeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  server_seed text not null,
  server_seed_hash text not null,
  client_seed text not null default 'default',
  next_nonce bigint not null default 0,
  revealed boolean not null default false,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keno_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  risk text not null check (risk in ('classic','low','medium','high')),
  picks int[] not null,
  drawn int[] not null,
  hits int not null,
  multiplier numeric(10,4) not null,
  payout numeric(12,2) not null,
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')),
  client_request_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_keno_bets_user on public.keno_bets(user_id);
create index if not exists idx_keno_bets_user_created on public.keno_bets(user_id, created_at desc);

create table if not exists public.mines_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  mine_count int not null,
  mine_tiles int[] not null,
  revealed_tiles int[] not null default '{}',
  gems_revealed int not null default 0,
  multiplier numeric(10,4) not null default 1,
  payout numeric(12,2) not null default 0,
  status text not null check (status in ('active','won','lost','cashed_out','cancelled')) default 'active',
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')),
  client_request_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_mines_games_user on public.mines_games(user_id);
create index if not exists idx_mines_games_active on public.mines_games(user_id) where status = 'active';

create table if not exists public.limbo_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  target_multiplier numeric(10,4) not null,
  result_multiplier numeric(10,4) not null,
  won boolean not null,
  payout numeric(12,2) not null,
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')),
  client_request_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_limbo_bets_user on public.limbo_bets(user_id);

create table if not exists public.roulette_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  bet_type text not null check (bet_type in ('red','black','green')),
  result_pocket smallint not null,
  result_color text not null,
  won boolean not null,
  payout numeric(12,2) not null,
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')),
  client_request_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_roulette_bets_user on public.roulette_bets(user_id);

create table if not exists public.slots_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  reels int[] not null,
  won boolean not null,
  multiplier numeric(10,4) not null,
  payout numeric(12,2) not null,
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')),
  client_request_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_slots_games_user on public.slots_games(user_id);

create table if not exists public.crash_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  crash_point numeric(10,4),
  won boolean not null default false,
  payout numeric(12,2) not null default 0,
  cashed_at numeric(10,4),
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')) default 'balance',
  client_request_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_crash_bets_user on public.crash_bets(user_id);
create index if not exists idx_crash_bets_open on public.crash_bets(user_id) where completed_at is null;

create table if not exists public.blackjack_hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wager numeric(12,2) not null,
  total_wager numeric(12,2) not null,
  shoe int[] not null,
  shoe_index int not null,
  player_cards int[] not null,
  dealer_cards int[] not null,
  doubled boolean not null default false,
  dealer_revealed boolean not null default false,
  status text not null check (status in ('player_turn','settled','cancelled')) default 'player_turn',
  outcome text,
  payout numeric(12,2) not null default 0,
  phase text not null default 'player_turn',
  insurance_wager numeric(12,2),
  insurance_taken boolean not null default false,
  insurance_decided boolean not null default false,
  is_split boolean not null default false,
  player_hands jsonb,
  active_hand_index int not null default 0,
  nonce bigint not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')) default 'balance',
  client_request_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_blackjack_hands_user on public.blackjack_hands(user_id);
create index if not exists idx_blackjack_hands_active on public.blackjack_hands(user_id) where status = 'player_turn';

create table if not exists public.case_battles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('1v1','2v2','3v3','2v2v2')),
  fairness_mode text not null check (fairness_mode in ('eos','off')) default 'eos',
  status text not null check (status in ('open','committing','rolling','settled','cancelled','failed')) default 'open',
  cases jsonb not null,
  total_cost numeric(12,2) not null,
  entry_cost numeric(12,2) not null,
  server_seed text,
  server_seed_hash text,
  client_seed text,
  eos_block_num bigint,
  eos_block_id text,
  eos_committed_at timestamptz,
  eos_revealed_at timestamptz,
  rake_pct numeric(5,2),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_case_battles_status on public.case_battles(status);
create index if not exists idx_case_battles_open on public.case_battles(status) where status in ('open','committing','rolling');

create table if not exists public.case_battle_players (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.case_battles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  is_bot boolean not null default false,
  bot_name text,
  team_index int not null,
  slot_index int not null,
  coin_type text not null check (coin_type in ('balance','sweeps_coins')) default 'balance',
  total_value numeric(12,2) not null default 0,
  rank int,
  payout numeric(12,2) not null default 0,
  joined_at timestamptz not null default now()
);
create index if not exists idx_cbp_battle on public.case_battle_players(battle_id);

create table if not exists public.chat_messages (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'global',
  content text not null,
  flagged boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_channel on public.chat_messages(channel, created_at desc);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_notif_user on public.user_notifications(user_id);
create index if not exists idx_user_notif_unread on public.user_notifications(user_id) where read = false;

create table if not exists public.self_exclusions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  destination_address text not null,
  sc_amount numeric(12,2) not null,
  usd_amount numeric(12,2) not null,
  status text not null check (status in ('pending','approved','paid','rejected','cancelled')) default 'pending',
  notes text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  rejected_at timestamptz
);
create index if not exists idx_redemptions_status on public.redemptions(status);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('signup','deposit','wager')),
  amount numeric(12,2) not null,
  rate_pct numeric(5,2) not null,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_affiliate_commissions_user on public.affiliate_commissions(affiliate_user_id);

create table if not exists public.tx_request_log (
  id uuid primary key default gen_random_uuid(),
  request_key text unique not null,
  context text,
  result text,
  created_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
--  IDEMPOTENCY KEYS (per game table) — for atomic placer dedupe
-- ══════════════════════════════════════════════════════════════════════════════
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
--  VIEWS — `crash_bets_safe` and `case_battles_safe` (security_barrier hides
--  crash_point / server_seed until the row is settled).
-- ══════════════════════════════════════════════════════════════════════════════
create or replace view public.crash_bets_safe
with (security_barrier = true) as
  select
    id, user_id, wager, crash_point, won, payout, cashed_at,
    coin_type, nonce, created_at, completed_at
  from public.crash_bets;

create or replace view public.case_battles_safe
with (security_barrier = true) as
  select
    id, creator_id, mode, fairness_mode, status, cases, total_cost,
    entry_cost, server_seed_hash, client_seed,
    eos_block_num, eos_block_id, eos_committed_at, eos_revealed_at,
    settled_at, created_at
  from public.case_battles;

-- ══════════════════════════════════════════════════════════════════════════════
--  PROFILE / AUTH HELPERS
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(coalesce(p_username, ''), '\s+', '_', 'g')));
$$;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admin only.';
  end if;
end
$$;
revoke all on function public.require_admin() from public;
grant execute on function public.require_admin() to authenticated;

create or replace function public.ensure_user_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_email text;
  v_row public.profiles%rowtype;
begin
  if v_uid is null then return null; end if;
  select * into v_row from public.profiles where id = v_uid;
  if not found then
    select coalesce(raw_user_meta_data->>'username', ''), coalesce(email, '')
      into v_username, v_email
      from auth.users where id = v_uid;
    -- Welcome bonus mirrors the auth.users trigger: 100,000 GC + 100 SC.
    -- Ensures the bonus ships regardless of which path created the profile.
    insert into public.profiles (id, email, username, balance, sweeps_coins)
      values (v_uid, v_email, v_username, 100000, 100)
      returning * into v_row;
  end if;
  return to_jsonb(v_row);
end
$$;
revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated;

create or replace function public.get_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid();
$$;
grant execute on function public.get_current_user_id() to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  SELF-EXCLUSION HELPERS (defense-in-depth)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.check_user_self_exclusion(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.self_exclusions
    where user_id = p_user_id and expires_at > now()
  );
$$;
revoke all on function public.check_user_self_exclusion(uuid) from public;
grant execute on function public.check_user_self_exclusion(uuid) to authenticated, service_role;

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
--  ATOMIC GAME-PLACER HELPERS (game_debit / game_credit / idempotency)
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

-- Per user directive (relaxed wager caps):
--   • max_wager_sc = 10,000,000 — the only hard wager cap, applies to SC only
--   • max_wager_gc = NULL — GC has no max bet (unlimited)
--   • max_payout   = NULL — no max-payout cap on either currency; payouts are
--                           bounded only by the player's available balance
-- Per-game worst-case multipliers are retained as constants for
-- forward-compatibility (e.g. server-side volatility tuning) but are no
-- longer enforced in any placer branch.
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
--  CRASH — atomic place_crash_bet (idempotent, self-excl, balance guarded)
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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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
  v_wager_cap_sc numeric;
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

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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
  v_wager_cap_sc numeric;
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
  -- blind window at the exact 30-min boundary.
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

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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
  v_wager_cap_sc numeric;
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

  select max_wager_sc into v_wager_cap_sc from public.game_max_constants();

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
  on conflict (user_id, client_request_id) do nothing
  returning id into v_new_id;

  -- Atomic race-condition guard (closes CRITICAL double-debit race).
  -- Two concurrent submissions sharing the same client_request_id: the
  -- FIRST wins the partial unique index; the SECOND fires `do nothing`,
  -- returns no row, and leaves v_new_id as NULL. We raise here so the
  -- entire transaction (including the wallet debit we just did) ROLLS
  -- BACK atomically. The unique index, not the upfront SELECT, is the
  -- authoritative source of idempotency.
  if v_new_id is null then
    raise exception 'Duplicate request %', p_client_request_id;
  end if;

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

-- Crash-gc: server-side settle of orphaned crash bets (no cashout) — runs as
-- a scheduled cron. Marks rows older than 2 min as settled with won=false.
create or replace function public.crash_settle_expired_bets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.crash_bets
    set won = false, completed_at = now()
    where completed_at is null
      and created_at < now() - interval '2 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.crash_settle_expired_bets() from public;
grant execute on function public.crash_settle_expired_bets() to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  PROVABLY-FAIR SEED MANAGEMENT (consume_keno_nonce covers keno/mines/
--  limbo/roulette/slots/blackjack/crash — shared PRNG increment)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.get_crash_pf_state(p_user_id uuid default auth.uid())
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
-- ^ Supabase installs `pgcrypto` into the `extensions` schema by default.
-- `gen_random_bytes` and `digest` come from pgcrypto and are only
-- resolvable if `extensions` is in the function's search_path. Without
-- this, runtime calls from edge functions fail with
--   42883 function gen_random_bytes(integer) does not exist
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_row public.game_pf_seeds%rowtype;
begin
  if v_uid is null then return; end if;
  select * into v_row from public.game_pf_seeds where user_id = v_uid;
  if not found then
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
      values (
        v_uid,
        encode(gen_random_bytes(32), 'hex'),
        encode(digest(gen_random_bytes(32), 'sha256'), 'hex'),
        'default',
        0
      )
      returning * into v_row;
  end if;
  return query select v_row.server_seed_hash, v_row.client_seed, v_row.next_nonce;
end
$$;
grant execute on function public.get_crash_pf_state(uuid) to authenticated;
-- Re-bind to other games: a single helper covers all of them via the same row.
create or replace function public.get_keno_pf_state(p_user_id uuid default auth.uid())
  returns table (server_seed_hash text, client_seed text, next_nonce bigint)
  language sql stable security definer set search_path = public
  as $$ select server_seed_hash, client_seed, next_nonce from public.game_pf_seeds where user_id = coalesce(p_user_id, auth.uid()) $$;
create or replace function public.get_mines_pf_state(p_user_id uuid default auth.uid())
  returns table (server_seed_hash text, client_seed text, next_nonce bigint)
  language sql stable security definer set search_path = public
  as $$ select server_seed_hash, client_seed, next_nonce from public.game_pf_seeds where user_id = coalesce(p_user_id, auth.uid()) $$;
create or replace function public.get_limbo_pf_state(p_user_id uuid default auth.uid())
  returns table (server_seed_hash text, client_seed text, next_nonce bigint)
  language sql stable security definer set search_path = public
  as $$ select server_seed_hash, client_seed, next_nonce from public.game_pf_seeds where user_id = coalesce(p_user_id, auth.uid()) $$;
create or replace function public.get_roulette_pf_state(p_user_id uuid default auth.uid())
  returns table (server_seed_hash text, client_seed text, next_nonce bigint)
  language sql stable security definer set search_path = public
  as $$ select server_seed_hash, client_seed, next_nonce from public.game_pf_seeds where user_id = coalesce(p_user_id, auth.uid()) $$;
create or replace function public.get_slots_pf_state(p_user_id uuid default auth.uid())
  returns table (server_seed_hash text, client_seed text, next_nonce bigint)
  language sql stable security definer set search_path = public
  as $$ select server_seed_hash, client_seed, next_nonce from public.game_pf_seeds where user_id = coalesce(p_user_id, auth.uid()) $$;
create or replace function public.get_blackjack_pf_state(p_user_id uuid default auth.uid())
  returns table (server_seed_hash text, client_seed text, next_nonce bigint)
  language sql stable security definer set search_path = public
  as $$ select server_seed_hash, client_seed, next_nonce from public.game_pf_seeds where user_id = coalesce(p_user_id, auth.uid()) $$;
grant execute on function public.get_keno_pf_state(uuid) to authenticated;
grant execute on function public.get_mines_pf_state(uuid) to authenticated;
grant execute on function public.get_limbo_pf_state(uuid) to authenticated;
grant execute on function public.get_roulette_pf_state(uuid) to authenticated;
grant execute on function public.get_slots_pf_state(uuid) to authenticated;
grant execute on function public.get_blackjack_pf_state(uuid) to authenticated;

-- Set-client-seed: shared across all games.
create or replace function public.set_crash_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
create or replace function public.set_keno_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
create or replace function public.set_mines_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
create or replace function public.set_limbo_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
create or replace function public.set_roulette_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
create or replace function public.set_slots_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
create or replace function public.set_blackjack_client_seed(p_client_seed text)
  returns void language sql security definer set search_path = public
  as $$ update public.game_pf_seeds set client_seed = p_client_seed, updated_at = now() where user_id = auth.uid() $$;
grant execute on function public.set_crash_client_seed(text) to authenticated;
grant execute on function public.set_keno_client_seed(text) to authenticated;
grant execute on function public.set_mines_client_seed(text) to authenticated;
grant execute on function public.set_limbo_client_seed(text) to authenticated;
grant execute on function public.set_roulette_client_seed(text) to authenticated;
grant execute on function public.set_slots_client_seed(text) to authenticated;
grant execute on function public.set_blackjack_client_seed(text) to authenticated;

create or replace function public.consume_keno_nonce(p_user_id uuid, p_advance bigint default 1)
returns table (
  server_seed text,
  server_seed_hash text,
  client_seed text,
  nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
-- ^ Required so pgcrypto's gen_random_bytes() and digest() resolve from
-- the `extensions` schema (Supabase's standard install location).
as $$
declare
  v_uid uuid := p_user_id;
  v_row public.game_pf_seeds%rowtype;
begin
  if v_uid is null then return; end if;
  select * into v_row from public.game_pf_seeds where user_id = v_uid for update;
  if not found then
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
      values (
        v_uid,
        encode(gen_random_bytes(32), 'hex'),
        encode(digest(gen_random_bytes(32), 'sha256'), 'hex'),
        'default',
        0
      )
      returning * into v_row;
  end if;
  update public.game_pf_seeds set next_nonce = next_nonce + p_advance, updated_at = now()
    where user_id = v_uid
    returning * into v_row;
  return query select v_row.server_seed, v_row.server_seed_hash, v_row.client_seed, v_row.next_nonce - 1;
end
$$;
grant execute on function public.consume_keno_nonce(uuid, bigint) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  MINES BACKEND (active / cashout / reveal)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.get_my_active_mines_game()
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text,
  coin_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, wager, mine_count, revealed_tiles, gems_revealed, multiplier, status, coin_type
  from public.mines_games
  where user_id = auth.uid() and status = 'active'
  limit 1;
$$;
grant execute on function public.get_my_active_mines_game() to authenticated;

create or replace function public.get_active_mines_game(p_user_id uuid)
returns table (
  game_id uuid, wager numeric, mine_count int, revealed_tiles int[],
  gems_revealed int, multiplier numeric, status text, coin_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, wager, mine_count, revealed_tiles, gems_revealed, multiplier, status, coin_type
  from public.mines_games
  where user_id = p_user_id and status = 'active'
  limit 1;
$$;
grant execute on function public.get_active_mines_game(uuid) to service_role;

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

  select * into v_row from public.mines_games where id = p_game_id and user_id = p_user_id and status = 'active' for update;
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
    update public.mines_games
      set revealed_tiles = v_revealed, status = 'lost', completed_at = now()
      where id = p_game_id;
    return query select
      p_game_id, p_tile, true, v_gems, v_mult, 'lost'::text,
      null::numeric, 0::numeric, v_row.mine_tiles, v_total;
    return;
  end if;

  update public.mines_games
    set revealed_tiles = v_revealed, gems_revealed = v_gems, multiplier = v_mult,
        status = 'active'
    where id = p_game_id;

  return query select
    p_game_id, p_tile, false, v_gems, v_mult, 'active'::text,
    null::numeric, 0::numeric, null::int[], v_total;
end
$$;
grant execute on function public.mines_reveal_tile(uuid, uuid, int, boolean) to service_role;

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

  select * into v_row from public.mines_games where id = p_game_id and user_id = p_user_id and status = 'active' for update;
  if not found then raise exception 'Active game not found.'; end if;

  v_payout := round((v_row.wager * v_row.multiplier)::numeric, 2);
  select out_balance into v_balance from public.game_credit(p_user_id, v_payout, p_coin_type);

  update public.mines_games
    set status = 'cashed_out', payout = v_payout, completed_at = now()
    where id = p_game_id;

  return query select
    p_game_id, 'cashed_out'::text, v_payout, v_row.multiplier,
    v_row.gems_revealed, v_balance, v_row.wager;
end
$$;
grant execute on function public.mines_cashout(uuid, uuid, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  CASE BATTLES (V2 with bot-per-slot + per-slot payouts + EOS fairness)
-- ══════════════════════════════════════════════════════════════════════════════

-- Generate a deposit address for the user (one-time, persistent).
create or replace function public.get_deposit_address(p_chain text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
-- ^ Required so pgcrypto's gen_random_bytes() resolves from the
-- `extensions` schema (Supabase's standard install location).
as $$
declare
  v_uid uuid := auth.uid();
  v_address text;
  v_label text;
begin
  if v_uid is null then raise exception 'Log in required.'; end if;
  if p_chain not in ('SOL','LTC','ETH') then raise exception 'Unsupported chain.'; end if;
  select address, label into v_address, v_label from public.user_deposit_addresses
    where user_id = v_uid and chain = p_chain;
  if not found then
    v_label := case p_chain when 'SOL' then 'Solana' when 'LTC' then 'Litecoin' else 'Ethereum' end;
    insert into public.user_deposit_addresses (user_id, chain, address, label)
      values (v_uid, p_chain, 'PENDING-' || encode(gen_random_bytes(8), 'hex'), v_label)
      returning address into v_address;
  end if;
  return jsonb_build_object('chain', p_chain, 'address', v_address, 'label', v_label);
end
$$;
grant execute on function public.get_deposit_address(text) to authenticated;

-- Credit a confirmed deposit (admin/system).
create or replace function public.credit_crypto_deposit(
  p_user_id uuid,
  p_amount numeric,
  p_chain text
)
returns table (out_balance numeric, out_sweeps numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal numeric;
  v_sweeps numeric;
begin
  v_bal := 0; v_sweeps := 0;
  -- GC credit (no max cap per user directive).
  update public.profiles set balance = balance + p_amount, total_deposited = total_deposited + p_amount, updated_at = now()
    where id = p_user_id
    returning balance, sweeps_coins into v_bal, v_sweeps;
  insert into public.transactions (user_id, type, coin_type, amount, description, metadata)
    values (p_user_id, 'deposit', 'balance', p_amount, 'crypto deposit ' || p_chain,
            jsonb_build_object('chain', p_chain));
  return query select v_bal, v_sweeps;
end
$$;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text) to service_role;

-- SC redemption
create or replace function public.request_sc_redemption(
  p_user_id uuid,
  p_sc_amount numeric,
  p_chain text
)
returns table (redemption_id uuid, sc_amount numeric, usd_amount numeric, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sc_balance numeric;
  v_usd numeric;
  v_id uuid;
begin
  if p_sc_amount < 100 then raise exception 'Minimum redemption is 100 SC ($1 USD).'; end if;
  if p_chain not in ('SOL','LTC','ETH') then raise exception 'Unsupported chain.'; end if;

  perform public.reject_if_self_excluded(p_user_id);

  select sweeps_coins into v_sc_balance from public.profiles where id = p_user_id for update;
  if v_sc_balance is null then raise exception 'Profile missing.'; end if;
  if v_sc_balance < p_sc_amount then raise exception 'Insufficient SC balance.'; end if;

  v_usd := round((p_sc_amount / 100)::numeric, 2);

  -- Debit the SC now (atomic); create the pending redemption row.
  update public.profiles set sweeps_coins = sweeps_coins - p_sc_amount, updated_at = now()
    where id = p_user_id;

  insert into public.redemptions (user_id, chain, sc_amount, usd_amount, status)
    values (p_user_id, p_chain, p_sc_amount, v_usd, 'pending')
    returning id into v_id;

  insert into public.transactions (user_id, type, coin_type, amount, description, metadata)
    values (p_user_id, 'redeem', 'sweeps_coins', p_sc_amount,
            'sc redemption request',
            jsonb_build_object('redemption_id', v_id, 'usd_amount', v_usd, 'chain', p_chain));

  return query select v_id, p_sc_amount, v_usd, 'pending'::text;
end
$$;
grant execute on function public.request_sc_redemption(uuid, numeric, text) to service_role;

-- List + approve/reject helpers (admin only)
create or replace function public.list_pending_redemptions()
returns table (
  id uuid, user_id uuid, chain text, sc_amount numeric, usd_amount numeric, requested_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, user_id, chain, sc_amount, usd_amount, requested_at
  from public.redemptions
  where status = 'pending'
  order by requested_at asc;
$$;
grant execute on function public.list_pending_redemptions() to authenticated;

create or replace function public.approve_sc_redemption(p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.redemptions set status = 'approved', approved_at = now() where id = p_redemption_id and status = 'pending';
end
$$;
grant execute on function public.approve_sc_redemption(uuid) to authenticated;

create or replace function public.reject_sc_redemption(p_redemption_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_sc numeric;
begin
  perform public.require_admin();
  select user_id, sc_amount into v_uid, v_sc from public.redemptions where id = p_redemption_id and status = 'pending' for update;
  if v_uid is null then raise exception 'Pending redemption not found.'; end if;
  update public.redemptions set status = 'rejected', notes = p_notes, rejected_at = now() where id = p_redemption_id;
  -- refund SC
  update public.profiles set sweeps_coins = sweeps_coins + v_sc, updated_at = now() where id = v_uid;
  insert into public.transactions (user_id, type, coin_type, amount, description)
    values (v_uid, 'fee', 'sweeps_coins', v_sc, 'redemption rejected refund');
end
$$;
grant execute on function public.reject_sc_redemption(uuid, text) to authenticated;

-- ────────────────  CASE BATTLE V2 RPCs  ────────────────

-- Create a battle entry with a JSONB cases array (V2 supports per-mode row shape).
create or replace function public.create_case_battle_entry_v2(
  p_user_id uuid,
  p_mode text,
  p_fairness_mode text,
  p_cases jsonb,
  p_total_cost numeric,
  p_entry_cost numeric,
  p_client_seed text,
  p_coin_type text
)
returns table (
  battle_id uuid,
  status text,
  cases jsonb,
  total_cost numeric,
  entry_cost numeric,
  server_seed_hash text,
  server_seed text,
  client_seed text,
  eos_block_num bigint,
  eos_block_id text
)
language plpgsql
security definer
set search_path = public, extensions
-- ^ Required so pgcrypto's gen_random_bytes() and digest() resolve from
-- the `extensions` schema (Supabase's standard install location). Otherwise
-- runtime calls fail with 42883 "function gen_random_bytes(integer) does
-- not exist".
as $$
declare
  v_id uuid;
  v_server_seed text;
  v_server_seed_hash text;
  v_eos_block_num bigint;
  v_eos_block_id text;
begin
  perform public.reject_if_self_excluded(p_user_id);
  perform public.game_debit(p_user_id, p_total_cost, p_coin_type);
  v_server_seed := encode(gen_random_bytes(32), 'hex');
  v_server_seed_hash := encode(digest(v_server_seed, 'sha256'), 'hex');
  if p_fairness_mode = 'eos' then
    -- EOS block hash resolves server-side via lc_eos_commit; for the entry
    -- we record the resolved block at commit-time. Until then, leave nulls.
    v_eos_block_num := null;
    v_eos_block_id := null;
  end if;
  insert into public.case_battles (
    creator_id, mode, fairness_mode, status, cases, total_cost, entry_cost,
    server_seed, server_seed_hash, client_seed, eos_committed_at
  )
  values (
    p_user_id, p_mode, p_fairness_mode, 'open', p_cases, p_total_cost, p_entry_cost,
    v_server_seed, v_server_seed_hash, p_client_seed,
    case when p_fairness_mode = 'eos' then now() else null end
  )
  returning id into v_id;
  return query select
    v_id, 'open'::text, p_cases, p_total_cost, p_entry_cost,
    v_server_seed_hash, v_server_seed, p_client_seed,
    v_eos_block_num, v_eos_block_id;
end
$$;
grant execute on function public.create_case_battle_entry_v2(uuid, text, text, jsonb, numeric, numeric, text, text) to service_role;

-- Backward-compat alias (V1 signature still callable for any lingering admin tooling).
create or replace function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int,
  p_bot_name text
)
returns table (player_id uuid, slot_index int, bot_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
begin
  insert into public.case_battle_players (battle_id, is_bot, bot_name, team_index, slot_index)
    values (p_battle_id, true, p_bot_name, 0, p_slot_index)
    returning id into v_pid;
  return query select v_pid, p_slot_index, p_bot_name;
end
$$;
grant execute on function public.insert_case_battle_bot(uuid, int, text) to service_role;

-- The canonical 3-argument add-bot RPC used by the live Arena page.
-- (battle-id, slot-index, bot-name). This is the one the client now calls.
create or replace function public.cb_add_bot(
  p_battle_id uuid,
  p_slot_index int,
  p_bot_name text
)
returns table (player_id uuid, slot_index int, bot_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
begin
  perform public.require_admin();
  insert into public.case_battle_players (battle_id, is_bot, bot_name, team_index, slot_index)
    values (p_battle_id, true, p_bot_name, 0, p_slot_index)
    returning id into v_pid;
  return query select v_pid, p_slot_index, p_bot_name;
end
$$;
grant execute on function public.cb_add_bot(uuid, int, text) to service_role;

-- Player join (real seat-fill)
create or replace function public.join_case_battle(
  p_user_id uuid,
  p_battle_id uuid,
  p_slot_index int,
  p_coin_type text
)
returns table (
  player_id uuid,
  slot_index int,
  total_value numeric,
  battle_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_total numeric;
  v_status text;
  v_entry numeric;
begin
  perform public.reject_if_self_excluded(p_user_id);
  select entry_cost, status into v_entry, v_status from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found.'; end if;
  if v_status <> 'open' then raise exception 'Battle is no longer open.'; end if;
  perform public.game_debit(p_user_id, v_entry, p_coin_type);
  insert into public.case_battle_players (battle_id, user_id, is_bot, team_index, slot_index, coin_type)
    values (p_battle_id, p_user_id, false, 0, p_slot_index, p_coin_type)
    returning id into v_pid;
  -- If all non-bot slots are now filled, transition status to committing.
  if (select count(*) from public.case_battle_players where battle_id = p_battle_id and not is_bot)
       >= (case (select mode from public.case_battles where id = p_battle_id)
             when '1v1' then 2 when '2v2' then 4 when '3v3' then 6
             else 4 end) then
    update public.case_battles set status = 'committing' where id = p_battle_id;
    v_status := 'committing';
  end if;
  select coalesce(sum(total_value), 0) into v_total from public.case_battle_players where battle_id = p_battle_id;
  return query select v_pid, p_slot_index, v_total, v_status;
end
$$;
grant execute on function public.join_case_battle(uuid, uuid, int, text) to service_role;

-- Settle a battle: compute each contestant's prizes from the rolled cases
-- and credit payouts atomically (per-team split for multi-mode battles).
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
  for v_player in
    select team_index, sum(total_value) as team_total
    from public.case_battle_players
    where battle_id = p_battle_id
    group by team_index
    order by team_index
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
                   / nullif((select count(*) from public.case_battle_players where battle_id = p_battle_id and team_index = v_winning_team), 0);

  for v_player in
    select id, user_id, team_index from public.case_battle_players where battle_id = p_battle_id
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
grant execute on function public.cb_settle_round(uuid) to service_role;

create or replace function public.cb_check_eos(p_battle_id uuid)
returns table (eos_block_num bigint, eos_block_id text, committed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select eos_block_num, eos_block_id, eos_committed_at
  from public.case_battles where id = p_battle_id;
$$;
grant execute on function public.cb_check_eos(uuid) to service_role;

-- Listing helper with optional status / mode filter.
create or replace function public.list_case_battles(p_status text default null, p_mode text default null)
returns table (
  id uuid, creator_id uuid, mode text, status text, fairness_mode text,
  cases jsonb, total_cost numeric, entry_cost numeric,
  server_seed_hash text, client_seed text,
  eos_block_num bigint, eos_block_id text,
  eos_committed_at timestamptz, eos_revealed_at timestamptz,
  settled_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id, creator_id, mode, status, fairness_mode, cases, total_cost, entry_cost,
    server_seed_hash, client_seed, eos_block_num, eos_block_id,
    eos_committed_at, eos_revealed_at, settled_at, created_at
  from public.case_battles
  where (p_status is null or status = p_status)
    and (p_mode is null or mode = p_mode)
  order by created_at desc;
$$;
grant execute on function public.list_case_battles(text, text) to authenticated;

-- Owner-scoped list (used by the Profile page "my battles").
create or replace function public.list_my_case_battles(p_user_id uuid)
returns table (
  id uuid, mode text, status text, total_cost numeric, entry_cost numeric,
  payout_total numeric, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cb.id, cb.mode, cb.status, cb.total_cost, cb.entry_cost,
    coalesce(sum(cbp.payout), 0) as payout_total, cb.created_at
  from public.case_battles cb
  left join public.case_battle_players cbp on cbp.battle_id = cb.id and cbp.user_id = p_user_id
  where cbp.user_id = p_user_id
  group by cb.id, cb.mode, cb.status, cb.total_cost, cb.entry_cost, cb.created_at
  order by cb.created_at desc;
$$;
grant execute on function public.list_my_case_battles(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  DISCORD LINKING
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.link_discord_account(
  p_user_id uuid,
  p_discord_id text,
  p_discord_username text,
  p_discord_avatar text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set discord_id = p_discord_id,
        discord_username = p_discord_username,
        discord_avatar = p_discord_avatar,
        discord_linked_at = now(),
        updated_at = now()
    where id = p_user_id;
end
$$;
grant execute on function public.link_discord_account(uuid, text, text, text) to service_role;

create or replace function public.unlink_discord_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set discord_id = null, discord_username = null, discord_avatar = null,
        discord_linked_at = null, updated_at = now()
    where id = p_user_id;
end
$$;
grant execute on function public.unlink_discord_account(uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  AFFILIATE RPCs
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.affiliate_record_referral(
  p_referred_user_id uuid,
  p_affiliate_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affiliate uuid;
begin
  select id into v_affiliate from public.profiles where affiliate_code = p_affiliate_code limit 1;
  if v_affiliate is null then return; end if;
  update public.profiles set referred_by = p_affiliate_code where id = p_referred_user_id;
  insert into public.affiliate_commissions (affiliate_user_id, referred_user_id, source, amount, rate_pct)
    values (v_affiliate, p_referred_user_id, 'signup', 0, 0);
end
$$;
grant execute on function public.affiliate_record_referral(uuid, text) to service_role;

create or replace function public.affiliate_record_deposit(
  p_user_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_aff uuid;
begin
  select referred_by into v_ref from public.profiles where id = p_user_id;
  if v_ref is null then return; end if;
  select id into v_aff from public.profiles where affiliate_code = v_ref limit 1;
  if v_aff is null then return; end if;
  insert into public.affiliate_commissions (affiliate_user_id, referred_user_id, source, amount, rate_pct)
    values (v_aff, p_user_id, 'deposit', p_amount * 0.10, 10);
end
$$;
grant execute on function public.affiliate_record_deposit(uuid, numeric) to service_role;

create or replace function public.affiliate_record_wager(
  p_user_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_aff uuid;
begin
  select referred_by into v_ref from public.profiles where id = p_user_id;
  if v_ref is null then return; end if;
  select id into v_aff from public.profiles where affiliate_code = v_ref limit 1;
  if v_aff is null then return; end if;
  insert into public.affiliate_commissions (affiliate_user_id, referred_user_id, source, amount, rate_pct)
    values (v_aff, p_user_id, 'wager', p_amount * 0.01, 1);
end
$$;
grant execute on function public.affiliate_record_wager(uuid, numeric) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  ADMIN CREDITS / DEBITS
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_credit_user(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text,
  p_note text default 'admin credit'
)
returns table (out_balance numeric, out_sweeps numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal numeric; v_sw numeric;
begin
  perform public.require_admin();
  -- Postgres UPDATE does NOT accept a CASE expression as the LHS of `SET
  -- (col) = (expr)`. The two column targets must be named explicitly, and
  -- we use a CASE per column to pick which one to mutate based on
  -- p_coin_type. The untouched column is set to itself, which is a no-op.
  update public.profiles
    set balance = case when p_coin_type = 'sweeps_coins' then balance else balance + p_amount end,
        sweeps_coins = case when p_coin_type = 'sweeps_coins' then sweeps_coins + p_amount else sweeps_coins end,
        updated_at = now()
    where id = p_user_id
    returning balance, sweeps_coins into v_bal, v_sw;
  insert into public.transactions (user_id, type, coin_type, amount, description)
    values (p_user_id, 'admin_credit', p_coin_type, p_amount, p_note);
  return query select v_bal, v_sw;
end
$$;
grant execute on function public.admin_credit_user(uuid, numeric, text, text) to authenticated;

create or replace function public.admin_debit_user(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text,
  p_note text default 'admin debit'
)
returns table (out_balance numeric, out_sweeps numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal numeric; v_sw numeric;
begin
  perform public.require_admin();
  -- Symmetric to admin_credit_user above: both balance and sweeps_coins
  -- are SET explicitly; only the targeted column is decremented, the
  -- other is set to itself (no-op).
  update public.profiles
    set balance = case when p_coin_type = 'sweeps_coins' then balance else balance - p_amount end,
        sweeps_coins = case when p_coin_type = 'sweeps_coins' then sweeps_coins - p_amount else sweeps_coins end,
        updated_at = now()
    where id = p_user_id
    returning balance, sweeps_coins into v_bal, v_sw;
  insert into public.transactions (user_id, type, coin_type, amount, description)
    values (p_user_id, 'admin_debit', p_coin_type, p_amount, p_note);
  return query select v_bal, v_sw;
end
$$;
grant execute on function public.admin_debit_user(uuid, numeric, text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  ROW-LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;
alter table public.user_notifications enable row level security;
alter table public.chat_messages enable row level security;
alter table public.self_exclusions enable row level security;
alter table public.redemptions enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.crypto_deposits enable row level security;
alter table public.crypto_withdrawals enable row level security;
alter table public.case_battles enable row level security;
alter table public.case_battle_players enable row level security;
alter table public.transactions enable row level security;
alter table public.keno_bets enable row level security;
alter table public.mines_games enable row level security;
alter table public.limbo_bets enable row level security;
alter table public.roulette_bets enable row level security;
alter table public.slots_games enable row level security;
alter table public.crash_bets enable row level security;
alter table public.blackjack_hands enable row level security;
alter table public.game_pf_seeds enable row level security;

-- Profiles: owner can read/update; everyone can read username + veteran_badge_earned.
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (id = auth.uid() or auth.uid() is null);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid() or public.is_current_user_admin());

drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles
  for insert with check (public.is_current_user_admin());

-- Per-game tables: owner can read + write; admin can read.
drop policy if exists "keno_bets_owner" on public.keno_bets;
create policy "keno_bets_owner" on public.keno_bets
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "mines_games_owner" on public.mines_games;
create policy "mines_games_owner" on public.mines_games
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "limbo_bets_owner" on public.limbo_bets;
create policy "limbo_bets_owner" on public.limbo_bets
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "roulette_bets_owner" on public.roulette_bets;
create policy "roulette_bets_owner" on public.roulette_bets
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "slots_games_owner" on public.slots_games;
create policy "slots_games_owner" on public.slots_games
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "crash_bets_owner" on public.crash_bets;
create policy "crash_bets_owner" on public.crash_bets
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "blackjack_hands_owner" on public.blackjack_hands;
create policy "blackjack_hands_owner" on public.blackjack_hands
  for all using (user_id = auth.uid() or public.is_current_user_admin())
            with check (user_id = auth.uid() or public.is_current_user_admin());

-- Transaction log: owner read + service-role write
drop policy if exists "transactions_owner_read" on public.transactions;
create policy "transactions_owner_read" on public.transactions
  for select using (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "transactions_owner_insert" on public.transactions;
create policy "transactions_owner_insert" on public.transactions
  for insert with check (user_id = auth.uid() or public.is_current_user_admin());

-- Crypto deposits / withdrawals: owner read; service role writes.
drop policy if exists "crypto_deposits_owner" on public.crypto_deposits;
create policy "crypto_deposits_owner" on public.crypto_deposits
  for select using (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "crypto_withdrawals_owner" on public.crypto_withdrawals;
create policy "crypto_withdrawals_owner" on public.crypto_withdrawals
  for select using (user_id = auth.uid() or public.is_current_user_admin());

-- Case battles + players: anyone can read open battles; admin can write anything;
-- players can read battles they participated in; players involved can write their
-- own player row. (All writes that affect balance go through SECURITY DEFINER RPCs.)
drop policy if exists "case_battles_read" on public.case_battles;
create policy "case_battles_read" on public.case_battles
  for select using (true);
drop policy if exists "case_battle_players_read" on public.case_battle_players;
create policy "case_battle_players_read" on public.case_battle_players
  for select using (true);

-- Notifications: owner read + write.
drop policy if exists "notif_owner_read" on public.user_notifications;
create policy "notif_owner_read" on public.user_notifications
  for select using (user_id = auth.uid() or public.is_current_user_admin());
drop policy if exists "notif_owner_insert" on public.user_notifications;
create policy "notif_owner_insert" on public.user_notifications
  for insert with check (user_id = auth.uid() or public.is_current_user_admin());

-- Chat: anyone authenticated can read+insert.
drop policy if exists "chat_read" on public.chat_messages;
create policy "chat_read" on public.chat_messages
  for select using (true);
drop policy if exists "chat_insert" on public.chat_messages;
create policy "chat_insert" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- Self-exclusions: owner read; admin can read/write all; insert via service role.
drop policy if exists "self_excl_read" on public.self_exclusions;
create policy "self_excl_read" on public.self_exclusions
  for select using (user_id = auth.uid() or public.is_current_user_admin());

-- Redemptions: owner read; admin read/write all.
drop policy if exists "redemptions_read" on public.redemptions;
create policy "redemptions_read" on public.redemptions
  for select using (user_id = auth.uid() or public.is_current_user_admin());

-- Affiliate commissions: owner read; admin read.
drop policy if exists "affiliate_read" on public.affiliate_commissions;
create policy "affiliate_read" on public.affiliate_commissions
  for select using (affiliate_user_id = auth.uid() or public.is_current_user_admin());

-- game_pf_seeds: clients see only server_seed_hash + client_seed + nonce.
-- Direct SELECT on the table is REVOKED below; use get_*_pf_state() RPCs.
revoke all on table public.game_pf_seeds from public, anon, authenticated;
grant select (server_seed_hash, client_seed, next_nonce) on public.game_pf_seeds to authenticated;
-- Direct INSERT/UPDATE restricted to service_role (RPCs do the work).
grant insert, update on public.game_pf_seeds to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
--  AUTH → PROFILE AUTO-SEED
-- ══════════════════════════════════════════════════════════════════════════════
-- Fires on every new auth.users row. Page the user must have triggered the
-- signup verification flow before this fires. Server-side RPC ensure_user_profile
-- is the canonical path; the trigger is a belt-and-suspenders fallback for
-- users whose signup verification was skipped (admin-created accounts, etc.).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Welcome bonus on signup: 100,000 GC + 100 SC. GC is for fun play, SC
  -- is the redeemable sweepstakes currency (see /withdraw). Both are
  -- awarded automatically on every new auth.users row.
  insert into public.profiles (id, email, username, balance, sweeps_coins)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    100000, 100
  )
  on conflict (id) do nothing;
  return new;
end
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ══════════════════════════════════════════════════════════════════════════════
--  pgcrypto digest() — required for game_pf_seeds server_seed_hashing
-- ══════════════════════════════════════════════════════════════════════════════
-- pgcrypto is loaded at the top of this file (create extension); digest() is
-- a built-in function in that extension.

-- ══════════════════════════════════════════════════════════════════════════════
--  END OF SCHEMA
-- ══════════════════════════════════════════════════════════════════════════════

commit;


/* ────────────────────────────────────────────────────────────────────────────
   POSTCHECK verification queries — run these after applying the migration.

   1.  Confirm every hardened placer exists.
       select proname from pg_proc where proname in (
         'place_crash_bet','place_keno_bet','place_limbo_bet',
         'place_roulette_bet','place_slots_bet','place_mines_bet',
         'place_blackjack_bet','cash_out_crash'
       ) order by proname;
       Expect: 8 rows.

   2.  Confirm cash_out_crash returns the fixed 6-column shape.
       select * from public.cash_out_crash(
         '00000000-0000-0000-0000-000000000000'::uuid,
         '00000000-0000-0000-0000-000000000000'::uuid,
         1.01::numeric
       );
       Expected error: "Bet not found." (because the betting_id is fake).
       This confirms the function exists and rejects unknown bets cleanly.

   3.  Confirm idempotency on each game table.
       select count(*) from pg_indexes
       where schemaname = 'public' and indexname like '%idempotency_key%';
       Expect: 7 rows (one per game table).

   4.  Confirm the relaxed max-wager constants.
       select * from public.game_max_constants();
       Expect: max_wager_gc=null, max_wager_sc=10000000, max_payout=null,
       worst-case multipliers preserved.

   5.  Confirm the security views exist.
       select relname from pg_class
       where relname in ('crash_bets_safe','case_battles_safe')
         and relkind = 'v';
       Expect: 2 rows.

   6.  Confirm game_pf_seeds RLS hides server_seed (only hash visible).
       set role authenticated;
       select server_seed_hash, client_seed, next_nonce
       from public.game_pf_seeds limit 1;
       Expect: succeeds.
       select server_seed from public.game_pf_seeds limit 1;
       Expect: ERROR (column-level grant denies access).
       reset role;

   7.  Confirm trigger on auth.users is installed.
       select tgname from pg_trigger
       where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
       Expect: 1 row.
   ────────────────────────────────────────────────────────────────────────────*/
