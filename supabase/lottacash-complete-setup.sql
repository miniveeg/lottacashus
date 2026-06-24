-- ══════════════════════════════════════════════════════════════════════════════
--  LottaCash — Complete Database Setup (one-and-done idempotent migration)
-- ══════════════════════════════════════════════════════════════════════════════
--  Consolidates all 47+ Supabase migrations into a single idempotent script.
--  Run this ONCE in the Supabase SQL Editor on a fresh project.
--
--  Starting balances (final, from 20250620000000_dual_currency_balances.sql):
--    • 10,000 GC (balance column)  — play currency
--    • 100    SC (sweeps_coins)    — redeemable (100 SC = $1 USD)
--
--  Crypto deposit crediting:
--    • gc_amount = p_usd_amount * 100   (100 GC = $1)
--    • bonus_sc = floor(p_usd_amount)   (1 SC per $1 deposited)
--
--  SC redemption rate: 100 SC = $1 USD  →  usd_val = p_sc_amount / 100.0
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 0: Clean slate — drop everything if it exists
-- (so the script is safe to re-run; everything is recreated below)
-- ══════════════════════════════════════════════════════════════════════════════

-- Triggers (drop before tables)
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists profiles_guard_balance on public.profiles;
drop trigger if exists profiles_guard_admin on public.profiles;
drop trigger if exists crypto_deposits_notify on public.crypto_deposits;
drop trigger if exists crypto_withdrawals_notify on public.crypto_withdrawals;
drop trigger if exists affiliate_commission_on_transaction on public.transactions;

-- Tables (reverse dependency order)
drop table if exists public.slots_games cascade;
drop table if exists public.crash_bets cascade;
drop table if exists public.redemptions cascade;
drop table if exists public.affiliate_commissions cascade;
drop table if exists public.roulette_bets cascade;
drop table if exists public.case_battle_players cascade;
drop table if exists public.case_battles cascade;
drop table if exists public.blackjack_hands cascade;
drop table if exists public.limbo_bets cascade;
drop table if exists public.mines_games cascade;
drop table if exists public.keno_bets cascade;
drop table if exists public.game_pf_seeds cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.user_notifications cascade;
drop table if exists public.crypto_withdrawals cascade;
drop table if exists public.crypto_deposits cascade;
drop table if exists public.user_deposit_addresses cascade;
drop table if exists public.game_sessions cascade;
drop table if exists public.self_exclusions cascade;
drop table if exists public.admin_credit_log cascade;
drop table if exists public.transactions cascade;
drop table if exists public.password_reset_codes cascade;
drop table if exists public.signup_verification_codes cascade;
drop table if exists public.profiles cascade;

-- Sequences
drop sequence if exists public.deposit_derivation_index_seq cascade;

-- Functions (latest signatures; older signatures also dropped for safety)
drop function if exists public.handle_new_user() cascade;
drop function if exists public.ensure_user_profile() cascade;
drop function if exists public.email_exists(text) cascade;
drop function if exists public.get_user_id_by_email(text) cascade;
drop function if exists public.profiles_prevent_balance_change() cascade;
drop function if exists public.profiles_prevent_admin_escalation() cascade;
drop function if exists public.is_current_user_admin() cascade;
drop function if exists public.require_admin() cascade;
drop function if exists public.bypass_profile_balance_guard() cascade;
drop function if exists public.link_discord_profile(uuid, text, text, text) cascade;
drop function if exists public.create_user_notification(uuid, text, text, text, jsonb) cascade;
drop function if exists public.notify_crypto_deposit_change() cascade;
drop function if exists public.notify_crypto_withdrawal_change() cascade;
drop function if exists public.get_user_wager_levels(uuid[]) cascade;
drop function if exists public.get_user_transactions(int, int) cascade;
drop function if exists public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) cascade;
drop function if exists public.request_crypto_withdrawal(text, text, numeric) cascade;
drop function if exists public.admin_complete_crypto_withdrawal(uuid, text) cascade;
drop function if exists public.admin_fail_crypto_withdrawal(uuid, text) cascade;
drop function if exists public.admin_search_users(text) cascade;
drop function if exists public.admin_set_user_admin(uuid, boolean) cascade;
drop function if exists public.admin_get_stats() cascade;
drop function if exists public.admin_list_withdrawals(text) cascade;
drop function if exists public.admin_list_recent_deposits(int) cascade;
drop function if exists public.admin_credit_user(uuid, numeric, text, text) cascade;
drop function if exists public.admin_process_redemption(uuid, text, text) cascade;
drop function if exists public.admin_list_redemptions(text) cascade;
drop function if exists public.assign_deposit_derivation_index(uuid) cascade;
drop function if exists public.normalize_affiliate_code(text) cascade;
drop function if exists public.generate_unique_affiliate_code() cascade;
drop function if exists public.ensure_user_affiliate_code(uuid) cascade;
drop function if exists public.apply_affiliate_referral(uuid, text) cascade;
drop function if exists public.submit_affiliate_referral_code(text) cascade;
drop function if exists public.trg_affiliate_commission_on_transaction() cascade;
drop function if exists public.claim_affiliate_earnings() cascade;
drop function if exists public.get_affiliate_stats() cascade;
drop function if exists public.ensure_game_pf_seeds(uuid) cascade;
drop function if exists public.get_keno_pf_state() cascade;
drop function if exists public.set_keno_client_seed(text) cascade;
drop function if exists public.consume_keno_nonce(uuid) cascade;
drop function if exists public.consume_keno_nonce(uuid, int) cascade;
drop function if exists public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint) cascade;
drop function if exists public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text) cascade;
drop function if exists public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint) cascade;
drop function if exists public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text) cascade;
drop function if exists public.settle_roulette_bet(uuid, numeric, text, smallint, text, boolean, numeric, bigint) cascade;
drop function if exists public.settle_roulette_bet(uuid, numeric, text, int, text, boolean, numeric, bigint, text) cascade;
drop function if exists public.mines_comb(int, int) cascade;
drop function if exists public.start_mines_game(uuid, numeric, int, int[], bigint) cascade;
drop function if exists public.start_mines_game(uuid, numeric, int, int[], bigint, text) cascade;
drop function if exists public.mines_reveal_tile(uuid, uuid, int) cascade;
drop function if exists public.mines_reveal_tile(uuid, uuid, int, boolean) cascade;
drop function if exists public.mines_cashout(uuid, uuid) cascade;
drop function if exists public.mines_cashout(uuid, uuid, text) cascade;
drop function if exists public.get_active_mines_game(uuid) cascade;
drop function if exists public.get_my_active_mines_game() cascade;
drop function if exists public.get_mines_pf_state() cascade;
drop function if exists public.set_mines_client_seed(text) cascade;
drop function if exists public.get_limbo_pf_state() cascade;
drop function if exists public.set_limbo_client_seed(text) cascade;
drop function if exists public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint) cascade;
drop function if exists public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int) cascade;
drop function if exists public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text) cascade;
drop function if exists public.blackjack_update_active(uuid, uuid, int[], int) cascade;
drop function if exists public.blackjack_update_active(uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean) cascade;
drop function if exists public.blackjack_debit_extra(uuid, uuid, numeric, text) cascade;
drop function if exists public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric) cascade;
drop function if exists public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric, text, jsonb, boolean, int, numeric, boolean) cascade;
drop function if exists public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric, text, jsonb, boolean, int, numeric, boolean, text) cascade;
drop function if exists public.get_my_active_blackjack_hand() cascade;
drop function if exists public.get_blackjack_pf_state() cascade;
drop function if exists public.set_blackjack_client_seed(text) cascade;
drop function if exists public.create_case_battle_entry(uuid, uuid, int, numeric, text) cascade;
drop function if exists public.create_case_battle_entry(uuid, uuid, int, numeric, text, int) cascade;
drop function if exists public.insert_case_battle_bot(uuid, int) cascade;
drop function if exists public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb) cascade;
drop function if exists public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb, jsonb) cascade;
drop function if exists public.mark_case_battle_running(uuid, text) cascade;
drop function if exists public.get_open_case_battles(int) cascade;
drop function if exists public.apply_case_battle_payouts(uuid, uuid) cascade;
drop function if exists public.get_case_battle_pf_state() cascade;
drop function if exists public.set_case_battle_client_seed(text) cascade;
drop function if exists public.place_crash_bet(uuid, numeric, numeric, bigint, text) cascade;
drop function if exists public.cash_out_crash(uuid, uuid, numeric) cascade;
drop function if exists public.crash_settle_loss(uuid) cascade;
drop function if exists public.get_crash_pf_state() cascade;
drop function if exists public.set_crash_client_seed(text) cascade;
drop function if exists public.settle_slots_bet(uuid, numeric, int[], boolean, numeric, numeric, bigint, text) cascade;
drop function if exists public.get_slots_pf_state() cascade;
drop function if exists public.set_slots_client_seed(text) cascade;
drop function if exists public.get_coin_balance(text) cascade;
drop function if exists public.adjust_coins(uuid, numeric, text) cascade;
drop function if exists public.request_sc_redemption(numeric, text, text) cascade;
drop function if exists public.grant_free_sc(uuid, numeric, text) cascade;
drop function if exists public.self_exclude(int) cascade;
drop function if exists public.cancel_self_exclusion() cascade;
drop function if exists public.check_self_exclusion() cascade;
drop function if exists public.check_user_self_exclusion(uuid) cascade;
drop function if exists public.set_deposit_limits(numeric, numeric) cascade;
drop function if exists public.get_deposit_limits() cascade;

-- Types (none defined, but keep section for future)
-- drop type if exists public.some_enum_type cascade;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Extensions
-- ══════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
grant usage on schema extensions to service_role;
grant usage on schema public to service_role, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Tables (in dependency order)
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── profiles ───────────────────────────────────────────────────────────────
-- Central user table. balance = Gold Coins (GC); sweeps_coins = Sweeps Coins (SC).
create table if not exists public.profiles (
  id                          uuid primary key references auth.users (id) on delete cascade,
  username                    text,
  email                       text,
  balance                     numeric(12, 2) not null default 0,         -- Gold Coins (GC)
  sweeps_coins                numeric(12, 2) not null default 0,         -- Sweeps Coins (SC)
  total_wagered               numeric(12, 2) not null default 0,
  total_deposited             numeric(12, 2) not null default 0,
  total_withdrawn             numeric(12, 2) not null default 0,
  total_wins                  numeric(12, 2) not null default 0,
  total_losses                numeric(12, 2) not null default 0,
  discord_id                  text unique,
  discord_username            text,
  discord_avatar              text,
  discord_linked_at           timestamptz,
  deposit_derivation_index    int unique,
  is_admin                    boolean not null default false,
  affiliate_code              text,
  referred_by                 uuid references public.profiles (id) on delete set null,
  session_started_at          timestamptz,
  last_session_activity       timestamptz,
  self_excluded_until         timestamptz,
  daily_deposit_limit         numeric(12, 2),
  weekly_deposit_limit        numeric(12, 2),
  birth_date                  date,
  age_verified                boolean not null default false,
  deposit_limit_daily         numeric(12, 2),
  deposit_limit_weekly        numeric(12, 2),
  deposit_limit_reset_at      timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint profiles_username_max_length
    check (username is null or char_length(username) <= 16)
);

alter table public.profiles replica identity full;

create unique index if not exists profiles_affiliate_code_key
  on public.profiles (affiliate_code)
  where affiliate_code is not null;

create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by)
  where referred_by is not null;


-- ─── signup_verification_codes ──────────────────────────────────────────────
create table if not exists public.signup_verification_codes (
  email        text primary key,
  code_hash    text not null,
  username     text,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  created_at   timestamptz not null default now()
);


-- ─── password_reset_codes ───────────────────────────────────────────────────
create table if not exists public.password_reset_codes (
  email        text primary key,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);


-- ─── transactions ───────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  type           text not null check (
                   type in ('deposit','withdrawal','wager','win','loss',
                            'affiliate','redemption','bonus','credit','push')
                 ),
  amount         numeric(12, 2) not null,
  balance_after  numeric(12, 2),
  description    text,
  created_at     timestamptz not null default now()
);

create index if not exists transactions_user_id_created_at_idx
  on public.transactions (user_id, created_at desc);

alter table public.transactions replica identity full;


-- ─── admin_credit_log ───────────────────────────────────────────────────────
create table if not exists public.admin_credit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      numeric(12, 2) not null,
  note        text,
  created_by  uuid not null references public.profiles(id),
  coin_type   text not null default 'balance',
  created_at  timestamptz not null default now()
);


-- ─── self_exclusions ────────────────────────────────────────────────────────
create table if not exists public.self_exclusions (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  duration_days  int not null check (duration_days in (30, 90, 180)),
  starts_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  reason         text,
  created_at     timestamptz not null default now()
);


-- ─── game_sessions ──────────────────────────────────────────────────────────
create table if not exists public.game_sessions (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  started_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now()
);


-- ─── user_deposit_addresses ─────────────────────────────────────────────────
create table if not exists public.user_deposit_addresses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  chain             text not null check (chain in ('sol', 'ltc', 'eth')),
  address           text not null,
  derivation_index  int not null,
  created_at        timestamptz not null default now(),
  unique (user_id, chain),
  unique (address)
);


-- ─── crypto_deposits ────────────────────────────────────────────────────────
create table if not exists public.crypto_deposits (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  chain                   text not null check (chain in ('sol', 'ltc', 'eth')),
  tx_hash                 text not null,
  address                 text not null,
  crypto_amount           numeric(24, 12) not null,
  usd_amount              numeric(12, 2) not null,
  exchange_rate           numeric(18, 8) not null,
  confirmations           int not null default 0,
  required_confirmations  int not null,
  status                  text not null default 'pending'
                            check (status in ('pending', 'confirmed', 'credited', 'swept')),
  credited_at             timestamptz,
  swept_at                timestamptz,
  created_at              timestamptz not null default now(),
  unique (chain, tx_hash)
);

create index if not exists crypto_deposits_user_status_idx
  on public.crypto_deposits (user_id, status);


-- ─── crypto_withdrawals ─────────────────────────────────────────────────────
create table if not exists public.crypto_withdrawals (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  chain                text not null check (chain in ('sol', 'ltc', 'eth')),
  destination_address  text not null,
  crypto_amount        numeric(24, 12),
  usd_amount           numeric(12, 2) not null,
  exchange_rate        numeric(18, 8),
  status               text not null default 'pending'
                         check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  tx_hash              text,
  error_message        text,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create index if not exists crypto_withdrawals_user_idx
  on public.crypto_withdrawals (user_id, created_at desc);


-- ─── user_notifications ─────────────────────────────────────────────────────
create table if not exists public.user_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null check (
                type in (
                  'deposit_detected', 'deposit_credited',
                  'withdrawal_started', 'withdrawal_completed', 'withdrawal_failed',
                  'discord_linked', 'discord_link_failed'
                )
              ),
  title       text not null,
  body        text not null,
  metadata    jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications replica identity full;


-- ─── chat_messages ──────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  body        text not null check (char_length(body) >= 1 and char_length(body) <= 500),
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages replica identity full;


-- ─── game_pf_seeds ──────────────────────────────────────────────────────────
-- Provably-fair seed row shared by all games (keno, mines, limbo, etc.)
create table if not exists public.game_pf_seeds (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  server_seed       text not null,
  server_seed_hash  text not null,
  client_seed       text not null default 'default',
  next_nonce        bigint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);


-- ─── keno_bets ──────────────────────────────────────────────────────────────
create table if not exists public.keno_bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  wager       numeric(12, 2) not null check (wager > 0),
  risk        text not null check (risk in ('classic', 'low', 'medium', 'high')),
  picks       int[] not null,
  drawn       int[] not null,
  hits        int not null check (hits >= 0 and hits <= 10),
  multiplier  numeric(14, 4) not null default 0,
  payout      numeric(12, 2) not null default 0,
  nonce       bigint not null,
  created_at  timestamptz not null default now()
);

create index if not exists keno_bets_user_id_created_at_idx
  on public.keno_bets (user_id, created_at desc);


-- ─── mines_games ────────────────────────────────────────────────────────────
create table if not exists public.mines_games (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  wager            numeric(12, 2) not null check (wager > 0),
  mine_count       int not null check (mine_count between 1 and 24),
  mine_tiles       int[] not null,
  revealed_tiles   int[] not null default '{}',
  gems_revealed    int not null default 0 check (gems_revealed >= 0),
  multiplier       numeric(14, 4) not null default 1,
  payout           numeric(12, 2) not null default 0,
  status           text not null default 'active'
                     check (status in ('active', 'cashed_out', 'busted')),
  nonce            bigint not null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index if not exists mines_games_user_status_idx
  on public.mines_games (user_id, status)
  where status = 'active';

create index if not exists mines_games_user_created_idx
  on public.mines_games (user_id, created_at desc);


-- ─── limbo_bets ─────────────────────────────────────────────────────────────
create table if not exists public.limbo_bets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  wager              numeric(12, 2) not null check (wager > 0),
  target_multiplier  numeric(14, 2) not null check (target_multiplier >= 1.01),
  result_multiplier  numeric(14, 2) not null,
  won                boolean not null,
  payout             numeric(12, 2) not null default 0,
  nonce              bigint not null,
  created_at         timestamptz not null default now()
);

create index if not exists limbo_bets_user_id_created_at_idx
  on public.limbo_bets (user_id, created_at desc);


-- ─── blackjack_hands ────────────────────────────────────────────────────────
create table if not exists public.blackjack_hands (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  wager                numeric(12, 2) not null check (wager > 0),
  total_wager          numeric(12, 2) not null check (total_wager > 0),
  doubled              boolean not null default false,
  shoe                 int[] not null,
  shoe_index           int not null default 0,
  player_cards         int[] not null default '{}',
  dealer_cards         int[] not null default '{}',
  dealer_revealed      boolean not null default false,
  status               text not null default 'player_turn'
                         check (status in ('player_turn', 'settled')),
  outcome              text check (outcome is null or outcome in ('blackjack', 'win', 'lose', 'push', 'bust')),
  payout               numeric(12, 2) not null default 0,
  nonce                bigint not null,
  phase                text not null default 'player_turn'
                         check (phase in ('insurance_offer', 'player_turn', 'settled')),
  insurance_wager      numeric(12, 2) not null default 0,
  insurance_taken      boolean not null default false,
  insurance_decided    boolean not null default true,
  is_split             boolean not null default false,
  player_hands         jsonb,
  active_hand_index    int not null default 0,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create index if not exists blackjack_hands_user_active_idx
  on public.blackjack_hands (user_id)
  where status = 'player_turn';

create index if not exists blackjack_hands_user_created_idx
  on public.blackjack_hands (user_id, created_at desc);


-- ─── case_battles ───────────────────────────────────────────────────────────
create table if not exists public.case_battles (
  id                              uuid primary key default gen_random_uuid(),
  creator_id                      uuid not null references auth.users (id) on delete cascade,
  case_id                         text not null,
  case_ids                        jsonb,
  rounds                          int not null check (rounds >= 1 and rounds <= 50),
  max_players                     int not null check (max_players >= 2 and max_players <= 6),
  vs_bot                          boolean not null default false,
  gamemode                        text not null default 'normal',
  player_mode                     text not null default '1v1',
  crazy_mode                      boolean not null default false,
  fast_spin                       boolean not null default false,
  entry_cost                      numeric(12, 2) not null check (entry_cost > 0),
  pot_total                       numeric(12, 2) not null default 0,
  status                          text not null default 'waiting'
                                    check (status in ('waiting', 'pending_eos', 'running',
                                                      'pending_jackpot_eos', 'completed', 'cancelled')),
  winner_id                       uuid references auth.users (id),
  winner_slot                     int,
  winner_payout                   numeric(12, 2) not null default 0,
  payouts_credited                boolean not null default false,
  battle_seed                     text,
  battle_seed_hash                text,
  internal_battle_seed            text,
  results                         jsonb,
  eos_commit_block_num            bigint,
  eos_target_block_num            bigint,
  eos_block_num                   bigint,
  eos_block_id                    text,
  jackpot_eos_commit_block_num    bigint,
  jackpot_eos_target_block_num    bigint,
  jackpot_eos_block_num           bigint,
  jackpot_eos_block_id            text,
  created_at                      timestamptz not null default now(),
  started_at                      timestamptz,
  completed_at                    timestamptz
);

create index if not exists case_battles_status_created_idx
  on public.case_battles (status, created_at desc);

create index if not exists case_battles_creator_idx
  on public.case_battles (creator_id, created_at desc);


-- ─── case_battle_players ────────────────────────────────────────────────────
create table if not exists public.case_battle_players (
  id              uuid primary key default gen_random_uuid(),
  battle_id       uuid not null references public.case_battles (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,
  is_bot          boolean not null default false,
  slot_index      int not null check (slot_index >= 0 and slot_index <= 5),
  display_name    text not null default 'Player',
  total_value     numeric(12, 2) not null default 0,
  round_drops     jsonb not null default '[]'::jsonb,
  borrow_percent  int not null default 0
                    check (borrow_percent >= 0 and borrow_percent <= 80),
  entry_paid      numeric(12, 2),
  joined_at       timestamptz not null default now(),
  unique (battle_id, slot_index),
  unique (battle_id, user_id)
);

create index if not exists case_battle_players_battle_idx
  on public.case_battle_players (battle_id);


-- ─── roulette_bets ──────────────────────────────────────────────────────────
create table if not exists public.roulette_bets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  wager          numeric(12, 2) not null check (wager > 0),
  bet_type       text not null check (bet_type in ('red', 'black', 'green')),
  result_pocket  smallint not null check (result_pocket >= 0 and result_pocket <= 36),
  result_color   text not null check (result_color in ('red', 'black', 'green')),
  won            boolean not null,
  payout         numeric(12, 2) not null default 0,
  nonce           bigint not null,
  created_at     timestamptz not null default now()
);

create index if not exists roulette_bets_user_id_created_at_idx
  on public.roulette_bets (user_id, created_at desc);


-- ─── affiliate_commissions ──────────────────────────────────────────────────
create table if not exists public.affiliate_commissions (
  id                     uuid primary key default gen_random_uuid(),
  affiliate_id           uuid not null references public.profiles (id) on delete cascade,
  referred_user_id       uuid not null references public.profiles (id) on delete cascade,
  kind                   text not null check (kind in ('deposit', 'wager')),
  base_amount            numeric(12, 2) not null,
  commission_amount      numeric(12, 2) not null,
  source_transaction_id  uuid unique references public.transactions (id) on delete set null,
  claimed_at             timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists affiliate_commissions_affiliate_created_idx
  on public.affiliate_commissions (affiliate_id, created_at desc);


-- ─── redemptions ────────────────────────────────────────────────────────────
create table if not exists public.redemptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  sc_amount            numeric(12, 2) not null check (sc_amount >= 100),
  usd_amount           numeric(12, 2) not null,
  chain                text not null check (chain in ('sol', 'ltc', 'eth')),
  destination_address  text not null,
  status               text not null default 'pending'
                         check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  tx_hash              text,
  error_message        text,
  processed_by         uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  processed_at         timestamptz
);


-- ─── crash_bets ─────────────────────────────────────────────────────────────
create table if not exists public.crash_bets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  wager         numeric(12, 2) not null check (wager > 0),
  crash_point   numeric(14, 2) not null,
  won           boolean not null default false,
  payout        numeric(12, 2) not null default 0,
  cashed_at     numeric(14, 2),
  coin_type     text not null default 'balance',
  nonce         bigint not null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists crash_bets_user_created_idx
  on public.crash_bets (user_id, created_at desc);


-- ─── slots_games ────────────────────────────────────────────────────────────
create table if not exists public.slots_games (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  wager       numeric(12, 2) not null check (wager > 0),
  reels       int[] not null,
  won         boolean not null,
  multiplier  numeric(14, 2) not null default 0,
  payout      numeric(12, 2) not null default 0,
  coin_type   text not null default 'balance',
  nonce       bigint not null,
  created_at  timestamptz not null default now()
);

create index if not exists slots_games_user_created_idx
  on public.slots_games (user_id, created_at desc);


-- Sequence for deposit derivation index
create sequence if not exists public.deposit_derivation_index_seq;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Row Level Security + Policies
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable RLS on every user-facing table (CRITICAL for security).
-- Internal tables used only by Edge Functions / service_role may stay disabled.
alter table public.profiles                    enable row level security;
alter table public.transactions                enable row level security;
alter table public.admin_credit_log            enable row level security;
alter table public.self_exclusions             enable row level security;
alter table public.game_sessions               enable row level security;
alter table public.user_deposit_addresses      enable row level security;
alter table public.crypto_deposits             enable row level security;
alter table public.crypto_withdrawals          enable row level security;
alter table public.user_notifications          enable row level security;
alter table public.chat_messages               enable row level security;
alter table public.game_pf_seeds               enable row level security;
alter table public.keno_bets                   enable row level security;
alter table public.mines_games                 enable row level security;
alter table public.limbo_bets                  enable row level security;
alter table public.blackjack_hands             enable row level security;
alter table public.case_battles                enable row level security;
alter table public.case_battle_players         enable row level security;
alter table public.roulette_bets               enable row level security;
alter table public.affiliate_commissions       enable row level security;
alter table public.redemptions                 enable row level security;
alter table public.crash_bets                  enable row level security;
alter table public.slots_games                 enable row level security;
-- signup_verification_codes and password_reset_codes stay DISABLED (service-role only)
alter table public.signup_verification_codes   disable row level security;
alter table public.password_reset_codes        disable row level security;


-- ─── profiles policies ──────────────────────────────────────────────────────
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);


-- ─── transactions policies ──────────────────────────────────────────────────
drop policy if exists "Users can read own transactions" on public.transactions;
create policy "Users can read own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);


-- ─── self_exclusions policies ───────────────────────────────────────────────
drop policy if exists "Users can read own self-exclusion" on public.self_exclusions;
create policy "Users can read own self-exclusion"
  on public.self_exclusions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own self-exclusion" on public.self_exclusions;
create policy "Users can insert own self-exclusion"
  on public.self_exclusions for insert
  with check (auth.uid() = user_id);


-- ─── game_sessions policies ─────────────────────────────────────────────────
drop policy if exists "Users can read own sessions" on public.game_sessions;
create policy "Users can read own sessions"
  on public.game_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own sessions" on public.game_sessions;
create policy "Users can insert own sessions"
  on public.game_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own sessions" on public.game_sessions;
create policy "Users can update own sessions"
  on public.game_sessions for update
  using (auth.uid() = user_id);


-- ─── user_deposit_addresses policies ────────────────────────────────────────
drop policy if exists "Users read own deposit addresses" on public.user_deposit_addresses;
create policy "Users read own deposit addresses"
  on public.user_deposit_addresses for select
  using (auth.uid() = user_id);


-- ─── crypto_deposits policies ───────────────────────────────────────────────
drop policy if exists "Users read own crypto deposits" on public.crypto_deposits;
create policy "Users read own crypto deposits"
  on public.crypto_deposits for select
  using (auth.uid() = user_id);


-- ─── crypto_withdrawals policies ────────────────────────────────────────────
drop policy if exists "Users read own withdrawals" on public.crypto_withdrawals;
create policy "Users read own withdrawals"
  on public.crypto_withdrawals for select
  using (auth.uid() = user_id);


-- ─── user_notifications policies ────────────────────────────────────────────
drop policy if exists "Users read own notifications" on public.user_notifications;
create policy "Users read own notifications"
  on public.user_notifications for select
  using (auth.uid() = user_id);

drop policy if exists "Users update own notifications" on public.user_notifications;
create policy "Users update own notifications"
  on public.user_notifications for update
  using (auth.uid() = user_id);


-- ─── chat_messages policies ─────────────────────────────────────────────────
drop policy if exists "Authenticated users read chat" on public.chat_messages;
create policy "Authenticated users read chat"
  on public.chat_messages for select
  to authenticated
  using (true);

drop policy if exists "Users post own chat messages" on public.chat_messages;
create policy "Users post own chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);


-- ─── game_pf_seeds policies ─────────────────────────────────────────────────
drop policy if exists "Users can read own pf seeds" on public.game_pf_seeds;
create policy "Users can read own pf seeds"
  on public.game_pf_seeds for select
  using (auth.uid() = user_id);


-- ─── keno_bets policies ─────────────────────────────────────────────────────
drop policy if exists "Users can read own keno bets" on public.keno_bets;
create policy "Users can read own keno bets"
  on public.keno_bets for select
  using (auth.uid() = user_id);


-- ─── mines_games policies ───────────────────────────────────────────────────
drop policy if exists "Users read own mines games" on public.mines_games;
create policy "Users read own mines games"
  on public.mines_games for select
  using (auth.uid() = user_id);


-- ─── limbo_bets policies ────────────────────────────────────────────────────
drop policy if exists "Users read own limbo bets" on public.limbo_bets;
create policy "Users read own limbo bets"
  on public.limbo_bets for select
  using (auth.uid() = user_id);


-- ─── blackjack_hands policies ───────────────────────────────────────────────
drop policy if exists "Users read own blackjack hands" on public.blackjack_hands;
create policy "Users read own blackjack hands"
  on public.blackjack_hands for select
  using (auth.uid() = user_id);


-- ─── case_battles policies ──────────────────────────────────────────────────
drop policy if exists "Anyone read case battles" on public.case_battles;
create policy "Anyone read case battles"
  on public.case_battles for select
  using (true);

drop policy if exists "Anyone read case battle players" on public.case_battle_players;
create policy "Anyone read case battle players"
  on public.case_battle_players for select
  using (true);


-- ─── roulette_bets policies ─────────────────────────────────────────────────
drop policy if exists "Users read own roulette bets" on public.roulette_bets;
create policy "Users read own roulette bets"
  on public.roulette_bets for select
  using (auth.uid() = user_id);


-- ─── affiliate_commissions policies ─────────────────────────────────────────
drop policy if exists "Affiliates read own commissions" on public.affiliate_commissions;
create policy "Affiliates read own commissions"
  on public.affiliate_commissions for select
  using (auth.uid() = affiliate_id);


-- ─── redemptions policies ───────────────────────────────────────────────────
drop policy if exists "Users read own redemptions" on public.redemptions;
create policy "Users read own redemptions"
  on public.redemptions for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own redemptions" on public.redemptions;
create policy "Users insert own redemptions"
  on public.redemptions for insert
  with check (auth.uid() = user_id);


-- ─── crash_bets policies ────────────────────────────────────────────────────
drop policy if exists "Users read own crash bets" on public.crash_bets;
create policy "Users read own crash bets"
  on public.crash_bets for select
  using (auth.uid() = user_id);


-- ─── slots_games policies ───────────────────────────────────────────────────
drop policy if exists "Users read own slots games" on public.slots_games;
create policy "Users read own slots games"
  on public.slots_games for select
  using (auth.uid() = user_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Grants
-- ══════════════════════════════════════════════════════════════════════════════

-- service_role (Edge Functions) gets full access to everything
grant all on table public.profiles                    to service_role;
grant all on table public.signup_verification_codes   to service_role;
grant all on table public.signup_verification_codes   to postgres;
grant all on table public.password_reset_codes        to service_role;
grant all on table public.password_reset_codes        to postgres;
grant all on table public.transactions                to service_role;
grant all on table public.admin_credit_log            to service_role;
grant all on table public.self_exclusions             to service_role;
grant all on table public.game_sessions               to service_role;
grant all on table public.user_deposit_addresses      to service_role;
grant all on table public.crypto_deposits             to service_role;
grant all on table public.crypto_withdrawals          to service_role;
grant all on table public.user_notifications          to service_role;
grant all on table public.chat_messages               to service_role;
grant all on table public.game_pf_seeds               to service_role;
grant all on table public.keno_bets                   to service_role;
grant all on table public.mines_games                 to service_role;
grant all on table public.limbo_bets                  to service_role;
grant all on table public.blackjack_hands             to service_role;
grant all on table public.case_battles                to service_role;
grant all on table public.case_battle_players         to service_role;
grant all on table public.roulette_bets               to service_role;
grant all on table public.affiliate_commissions       to service_role;
grant all on table public.redemptions                 to service_role;
grant all on table public.crash_bets                  to service_role;
grant all on table public.slots_games                 to service_role;

grant usage, select on sequence public.deposit_derivation_index_seq to service_role;

-- authenticated users get read access to their own data (RLS still applies)
grant select        on public.profiles                to authenticated;
grant select        on public.transactions            to authenticated;
grant select        on public.user_notifications      to authenticated;
grant update        on public.user_notifications      to authenticated;
grant select, insert on public.chat_messages          to authenticated;
-- SECURITY (audit P0): column-level grants for tables that hold secrets.
-- Previously these were table-level `grant select`, which let any
-- authenticated user read the LIVE server_seed (game_pf_seeds), the mine
-- positions (mines_games.mine_tiles), or the entire shuffled shoe
-- (blackjack_hands.shoe) — breaking provably-fair commitment and letting a
-- player compute outcomes in advance. The service_role (edge functions)
-- still gets `grant all` above so the server can read the secrets to
-- resolve bets. Authenticated clients can read only the non-secret columns
-- they need for history/fairness-verification UIs.
grant select (user_id, server_seed_hash, client_seed, next_nonce, created_at, updated_at)
                  on public.game_pf_seeds           to authenticated;
grant select        on public.keno_bets               to authenticated;
grant select (id, user_id, wager, mine_count, revealed_tiles, gems_revealed, multiplier, payout, status, nonce, created_at, completed_at)
                  on public.mines_games             to authenticated;
grant select        on public.limbo_bets              to authenticated;
grant select (id, user_id, wager, total_wager, doubled, shoe_index, player_cards, dealer_cards, dealer_revealed, status, outcome, payout, nonce, phase, insurance_wager, insurance_taken, insurance_decided, is_split, player_hands, active_hand_index, created_at, completed_at)
                  on public.blackjack_hands         to authenticated;
grant select        on public.case_battles            to authenticated;
grant select        on public.case_battle_players     to authenticated;
grant select        on public.roulette_bets           to authenticated;
grant select        on public.affiliate_commissions   to authenticated;
grant select, insert on public.redemptions            to authenticated;
grant select        on public.crash_bets              to authenticated;
grant select        on public.slots_games             to authenticated;
grant select        on public.user_deposit_addresses  to authenticated;
grant select        on public.crypto_deposits         to authenticated;
grant select        on public.crypto_withdrawals      to authenticated;
grant select, insert, update on public.self_exclusions  to authenticated;
grant select, insert, update on public.game_sessions   to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Functions (latest version of each, in dependency order)
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── Auth helpers ───────────────────────────────────────────────────────────

create or replace function public.email_exists(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(check_email))
  );
$$;
revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to service_role;


create or replace function public.get_user_id_by_email(check_email text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(check_email)) limit 1;
$$;
revoke all on function public.get_user_id_by_email(text) from public;
grant execute on function public.get_user_id_by_email(text) to service_role;


-- ─── Profile creation (10,000 GC + 100 SC welcome bonus — FINAL VERSION) ────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, balance, sweeps_coins)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    10000,  -- 10,000 Gold Coins (play currency, no redemption value)
    100     -- 100 Sweeps Coins (redeemable: 100 SC = $1 USD)
  );
  return new;
end;
$$;


create or replace function public.ensure_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.profiles (id, username, email, balance, sweeps_coins)
  select
    uid,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    u.email,
    10000,  -- 10,000 GC welcome bonus
    100     -- 100 SC welcome bonus (matches handle_new_user trigger)
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing;
  select * into row from public.profiles where id = uid;
  return row;
end;
$$;
revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated;


-- ─── Balance guard (lets security-definer RPCs bypass when needed) ──────────

create or replace function public.bypass_profile_balance_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.bypass_profile_balance_guard', '1', true);
end;
$$;
revoke all on function public.bypass_profile_balance_guard() from public;
-- service_role only — authenticated may NOT call this directly
grant execute on function public.bypass_profile_balance_guard() to service_role;


create or replace function public.profiles_prevent_balance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.balance is distinct from OLD.balance then
    if auth.uid() is not null
       and coalesce(current_setting('app.bypass_profile_balance_guard', true), '') <> '1' then
      NEW.balance := OLD.balance;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;


create or replace function public.profiles_prevent_admin_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.is_admin is distinct from OLD.is_admin then
    if auth.uid() is not null and auth.uid() = OLD.id then
      NEW.is_admin := OLD.is_admin;
    end if;
  end if;
  return NEW;
end;
$$;


-- ─── Admin helpers ──────────────────────────────────────────────────────────

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;
revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;


create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admin access required';
  end if;
end;
$$;
revoke all on function public.require_admin() from public;


-- ─── Notifications ──────────────────────────────────────────────────────────

create or replace function public.create_user_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'Cannot create notifications for another user';
  end if;

  insert into public.user_notifications (user_id, type, title, body, metadata)
  values (p_user_id, p_type, p_title, p_body, coalesce(p_metadata, '{}'::jsonb))
  returning id into nid;

  return nid;
end;
$$;
revoke all on function public.create_user_notification(uuid, text, text, text, jsonb) from public;
grant execute on function public.create_user_notification(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.create_user_notification(uuid, text, text, text, jsonb) to service_role;


create or replace function public.notify_crypto_deposit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    perform public.create_user_notification(
      NEW.user_id,
      'deposit_detected',
      'Deposit detected',
      format('%s deposit incoming — waiting for confirmations.', upper(NEW.chain)),
      jsonb_build_object('chain', NEW.chain, 'deposit_id', NEW.id, 'usd_amount', NEW.usd_amount)
    );
  elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status = 'confirmed' then
    perform public.create_user_notification(
      NEW.user_id,
      'deposit_detected',
      'Deposit confirmed',
      format('%s deposit confirmed — crediting your balance shortly.', upper(NEW.chain)),
      jsonb_build_object('chain', NEW.chain, 'deposit_id', NEW.id, 'usd_amount', NEW.usd_amount)
    );
  end if;
  return NEW;
end;
$$;


create or replace function public.notify_crypto_withdrawal_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status then
    if NEW.status = 'completed' then
      perform public.create_user_notification(
        NEW.user_id,
        'withdrawal_completed',
        'Withdrawal completed',
        format('$%s %s withdrawal sent.', trim(to_char(NEW.usd_amount, 'FM999,999,990.00')), upper(NEW.chain)),
        jsonb_build_object('withdrawal_id', NEW.id, 'chain', NEW.chain, 'tx_hash', NEW.tx_hash)
      );
    elsif NEW.status = 'failed' then
      perform public.create_user_notification(
        NEW.user_id,
        'withdrawal_failed',
        'Withdrawal failed',
        coalesce(NEW.error_message, format('$%s %s withdrawal could not be completed.', trim(to_char(NEW.usd_amount, 'FM999,999,990.00')), upper(NEW.chain))),
        jsonb_build_object('withdrawal_id', NEW.id, 'chain', NEW.chain)
      );
    end if;
  end if;
  return NEW;
end;
$$;


-- ─── Discord linking ────────────────────────────────────────────────────────

create or replace function public.link_discord_profile(
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
  insert into public.profiles (id, balance)
  values (p_user_id, 0)
  on conflict (id) do nothing;

  update public.profiles
  set
    discord_id = p_discord_id,
    discord_username = p_discord_username,
    discord_avatar = p_discord_avatar,
    discord_linked_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile row missing for user %', p_user_id;
  end if;

  perform public.create_user_notification(
    p_user_id,
    'discord_linked',
    'Discord linked',
    format('Connected as %s.', p_discord_username),
    jsonb_build_object('discord_id', p_discord_id, 'discord_username', p_discord_username)
  );
end;
$$;
revoke all on function public.link_discord_profile(uuid, text, text, text) from public;
grant execute on function public.link_discord_profile(uuid, text, text, text) to service_role;


-- ─── Crypto deposits / withdrawals (FINAL dual-currency versions) ───────────

-- Credit crypto deposit:
--   GC  = p_usd_amount * 100   (100 GC = $1)
--   SC  = floor(p_usd_amount)  (1 bonus SC per $1 deposited)
create or replace function public.credit_crypto_deposit(
  p_user_id uuid,
  p_usd_amount numeric,
  p_chain text,
  p_tx_hash text,
  p_crypto_amount numeric,
  p_exchange_rate numeric,
  p_deposit_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 2);
  bonus_sc numeric(12, 2);
  new_sc numeric(12, 2);
  gc_amount numeric(12, 2);
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  -- 100 GC = $1 USD, so GC = USD * 100
  gc_amount := p_usd_amount * 100;

  -- Bonus SC: 1 SC per $1 deposited (100 SC = $1, so this is a 1% bonus value)
  bonus_sc := floor(p_usd_amount);

  update public.profiles
  set
    balance = balance + gc_amount,
    sweeps_coins = sweeps_coins + bonus_sc,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance, sweeps_coins into new_balance, new_sc;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'deposit', gc_amount, new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '… — ' || gc_amount || ' GC'
  );

  if bonus_sc > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id, 'bonus', bonus_sc, new_sc,
      bonus_sc || ' SC bonus from ' || upper(p_chain) || ' deposit ($' || p_usd_amount || ')'
    );
  end if;
end;
$$;
revoke all on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) from public;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;


create or replace function public.request_crypto_withdrawal(
  p_chain text,
  p_destination text,
  p_usd_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_balance numeric(12, 2);
  wid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_usd_amount < 10 then
    raise exception 'Minimum withdrawal is $10';
  end if;

  if p_chain not in ('sol', 'ltc', 'eth') then
    raise exception 'Invalid chain';
  end if;

  if nullif(trim(p_destination), '') is null then
    raise exception 'Destination address is required';
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into current_balance
  from public.profiles p
  where p.id = uid
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_usd_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.profiles
  set
    balance = balance - p_usd_amount,
    total_withdrawn = total_withdrawn + p_usd_amount,
    updated_at = now()
  where id = uid;

  insert into public.crypto_withdrawals (user_id, chain, destination_address, usd_amount, status)
  values (uid, p_chain, trim(p_destination), p_usd_amount, 'pending')
  returning id into wid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    uid,
    'withdrawal',
    -p_usd_amount,
    current_balance - p_usd_amount,
    upper(p_chain) || ' withdrawal pending'
  );

  perform public.create_user_notification(
    uid,
    'withdrawal_started',
    'Withdrawal started',
    format(
      '$%s %s withdrawal to %s… is pending.',
      trim(to_char(p_usd_amount, 'FM999,999,990.00')),
      upper(p_chain),
      left(trim(p_destination), 8)
    ),
    jsonb_build_object('withdrawal_id', wid, 'chain', p_chain, 'usd_amount', p_usd_amount)
  );

  return wid;
end;
$$;
grant execute on function public.request_crypto_withdrawal(text, text, numeric) to authenticated;


create or replace function public.admin_complete_crypto_withdrawal(
  p_withdrawal_id uuid,
  p_tx_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.crypto_withdrawals%rowtype;
begin
  perform public.require_admin();

  if nullif(trim(p_tx_hash), '') is null then
    raise exception 'Transaction hash is required';
  end if;

  select * into w from public.crypto_withdrawals where id = p_withdrawal_id for update;

  if not found then
    raise exception 'Withdrawal not found';
  end if;

  if w.status not in ('pending', 'processing') then
    raise exception 'Withdrawal is not pending (status: %)', w.status;
  end if;

  update public.crypto_withdrawals
  set
    status = 'completed',
    tx_hash = trim(p_tx_hash),
    completed_at = now()
  where id = p_withdrawal_id;
end;
$$;
grant execute on function public.admin_complete_crypto_withdrawal(uuid, text) to authenticated;


create or replace function public.admin_fail_crypto_withdrawal(
  p_withdrawal_id uuid,
  p_error_message text default 'Withdrawal could not be completed.'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.crypto_withdrawals%rowtype;
  msg text := coalesce(nullif(trim(p_error_message), ''), 'Withdrawal could not be completed.');
  new_balance numeric(12, 2);
begin
  perform public.require_admin();

  select * into w from public.crypto_withdrawals where id = p_withdrawal_id for update;

  if not found then
    raise exception 'Withdrawal not found';
  end if;

  if w.status not in ('pending', 'processing') then
    raise exception 'Withdrawal is not pending (status: %)', w.status;
  end if;

  perform public.bypass_profile_balance_guard();

  update public.profiles
  set
    balance = balance + w.usd_amount,
    total_withdrawn = greatest(0, total_withdrawn - w.usd_amount),
    updated_at = now()
  where id = w.user_id
  returning balance into new_balance;

  update public.crypto_withdrawals
  set
    status = 'failed',
    error_message = msg,
    completed_at = now()
  where id = p_withdrawal_id;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    w.user_id,
    'deposit',
    w.usd_amount,
    new_balance,
    upper(w.chain) || ' withdrawal refunded'
  );
end;
$$;
grant execute on function public.admin_fail_crypto_withdrawal(uuid, text) to authenticated;


create or replace function public.assign_deposit_derivation_index(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  idx int;
begin
  select deposit_derivation_index into idx from public.profiles where id = p_user_id;
  if idx is not null then
    return idx;
  end if;
  idx := nextval('public.deposit_derivation_index_seq');
  update public.profiles set deposit_derivation_index = idx where id = p_user_id;
  return idx;
end;
$$;
grant execute on function public.assign_deposit_derivation_index(uuid) to service_role;


-- ─── Admin dashboard ────────────────────────────────────────────────────────

create or replace function public.admin_get_stats()
returns table (
  pending_withdrawals bigint,
  pending_withdrawals_usd numeric,
  total_users bigint,
  credited_deposits_24h bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    (select count(*)::bigint from public.crypto_withdrawals w where w.status = 'pending'),
    coalesce((select sum(w.usd_amount) from public.crypto_withdrawals w where w.status = 'pending'), 0),
    (select count(*)::bigint from public.profiles),
    (
      select count(*)::bigint
      from public.crypto_deposits d
      where d.status = 'credited'
        and d.credited_at >= now() - interval '24 hours'
    );
end;
$$;
grant execute on function public.admin_get_stats() to authenticated;


create or replace function public.admin_list_withdrawals(p_status text default 'pending')
returns table (
  id uuid,
  user_id uuid,
  username text,
  email text,
  user_balance numeric,
  chain text,
  destination_address text,
  usd_amount numeric,
  status text,
  tx_hash text,
  error_message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    w.id,
    w.user_id,
    p.username,
    p.email,
    p.balance,
    w.chain,
    w.destination_address,
    w.usd_amount,
    w.status,
    w.tx_hash,
    w.error_message,
    w.created_at
  from public.crypto_withdrawals w
  join public.profiles p on p.id = w.user_id
  where
    case
      when p_status = 'pending' then w.status in ('pending', 'processing')
      when p_status = 'all' then true
      else w.status = p_status
    end
  order by w.created_at desc
  limit 100;
end;
$$;
grant execute on function public.admin_list_withdrawals(text) to authenticated;


create or replace function public.admin_list_recent_deposits(p_limit int default 15)
returns table (
  id uuid,
  user_id uuid,
  username text,
  chain text,
  usd_amount numeric,
  tx_hash text,
  credited_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    d.id,
    d.user_id,
    p.username,
    d.chain,
    d.usd_amount,
    d.tx_hash,
    d.credited_at
  from public.crypto_deposits d
  join public.profiles p on p.id = d.user_id
  where d.status = 'credited'
  order by d.credited_at desc nulls last
  limit greatest(1, least(p_limit, 50));
end;
$$;
grant execute on function public.admin_list_recent_deposits(int) to authenticated;


-- Latest version: includes sweeps_coins in the return type
create or replace function public.admin_search_users(p_query text)
returns table (
  id uuid,
  username text,
  email text,
  balance numeric,
  sweeps_coins numeric,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;
  return query
  select p.id, p.username, p.email, p.balance, p.sweeps_coins, p.is_admin, p.created_at
  from public.profiles p
  where p.username ilike '%' || p_query || '%'
     or p.email ilike '%' || p_query || '%'
     or p.id::text = p_query
  order by p.created_at desc
  limit 20;
end;
$$;
grant execute on function public.admin_search_users(text) to authenticated;


create or replace function public.admin_set_user_admin(
  p_user_id uuid,
  p_is_admin boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own admin status';
  end if;

  update public.profiles
  set is_admin = p_is_admin, updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;
grant execute on function public.admin_set_user_admin(uuid, boolean) to authenticated;


create or replace function public.admin_credit_user(
  p_user_id uuid,
  p_amount numeric,
  p_note text default 'Admin credit',
  p_coin_type text default 'balance'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _is_admin boolean;
begin
  select is_admin into _is_admin from public.profiles where id = auth.uid();
  if _is_admin is not true then
    raise exception 'Only admins can credit user balances.';
  end if;

  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    update public.profiles
    set balance = balance + p_amount,
        updated_at = now()
    where id = p_user_id;
  elsif p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = sweeps_coins + p_amount,
        updated_at = now()
    where id = p_user_id;
  else
    raise exception 'Invalid coin type. Use balance, gold_coins, or sweeps_coins.';
  end if;

  if not found then
    raise exception 'User not found.';
  end if;

  insert into public.admin_credit_log (user_id, amount, note, created_by, coin_type)
  values (p_user_id, p_amount, p_note, auth.uid(), p_coin_type);
end;
$$;
grant execute on function public.admin_credit_user(uuid, numeric, text, text) to authenticated;


-- ─── SC redemption (100 SC = $1 USD) ────────────────────────────────────────

create or replace function public.request_sc_redemption(
  p_sc_amount numeric,
  p_chain text,
  p_destination text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_sc numeric(12, 2);
  usd_val numeric(12, 2);
  min_sc numeric := 100;  -- minimum 100 SC = $1.00
  rid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_chain not in ('sol', 'ltc', 'eth') then
    raise exception 'Unsupported chain';
  end if;

  if p_sc_amount < min_sc then
    raise exception 'Minimum redemption is % SC ($%.2f)', min_sc, min_sc / 100.0;
  end if;

  -- 100 SC = $1 USD  →  usd = sc / 100
  usd_val := p_sc_amount / 100.0;

  select sweeps_coins into current_sc
  from public.profiles where id = uid for update;

  if current_sc is null or current_sc < p_sc_amount then
    raise exception 'Insufficient Sweeps Coins balance';
  end if;

  update public.profiles
  set sweeps_coins = sweeps_coins - p_sc_amount,
      total_withdrawn = total_withdrawn + usd_val,
      updated_at = now()
  where id = uid;

  insert into public.redemptions (user_id, sc_amount, usd_amount, chain, destination_address, status)
  values (uid, p_sc_amount, usd_val, p_chain, p_destination, 'pending')
  returning id into rid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    uid,
    'redemption',
    -usd_val,
    current_sc - p_sc_amount,
    upper(p_chain) || ' SC redemption: ' || p_sc_amount || ' SC = $' || usd_val || ' USD'
  );

  return rid;
end;
$$;
revoke all on function public.request_sc_redemption(numeric, text, text) from public;
grant execute on function public.request_sc_redemption(numeric, text, text) to authenticated;


create or replace function public.admin_process_redemption(
  p_redemption_id uuid,
  p_status text,
  p_tx_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _is_admin boolean;
begin
  select is_admin into _is_admin from public.profiles where id = auth.uid();
  if _is_admin is not true then
    raise exception 'Only admins can process redemptions.';
  end if;

  if p_status = 'completed' then
    update public.redemptions
    set status = 'completed',
        tx_hash = coalesce(p_tx_hash, tx_hash),
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id and status = 'pending';
  elsif p_status = 'failed' then
    update public.redemptions
    set status = 'failed',
        error_message = p_tx_hash,
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id and status = 'pending';
  else
    raise exception 'Invalid status. Use completed or failed.';
  end if;

  if not found then
    raise exception 'Redemption not found or already processed.';
  end if;
end;
$$;
grant execute on function public.admin_process_redemption(uuid, text, text) to authenticated;


create or replace function public.admin_list_redemptions(p_status text default 'pending')
returns table (
  id uuid,
  user_id uuid,
  username text,
  email text,
  sc_amount numeric,
  usd_amount numeric,
  chain text,
  destination_address text,
  status text,
  tx_hash text,
  error_message text,
  sweeps_coins numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;
  return query
  select
    r.id,
    r.user_id,
    p.username,
    p.email,
    r.sc_amount,
    r.usd_amount,
    r.chain,
    r.destination_address,
    r.status,
    r.tx_hash,
    r.error_message,
    p.sweeps_coins,
    r.created_at
  from public.redemptions r
  join public.profiles p on p.id = r.user_id
  where (p_status = 'all' or r.status = p_status)
  order by r.created_at desc;
end;
$$;
grant execute on function public.admin_list_redemptions(text) to authenticated;


-- ─── Coin balance helpers (dual currency) ───────────────────────────────────

create or replace function public.get_coin_balance(p_coin_type text default 'balance')
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  val numeric;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    select balance into val from public.profiles where id = uid;
  elsif p_coin_type = 'sweeps_coins' then
    select sweeps_coins into val from public.profiles where id = uid;
  else
    raise exception 'Invalid coin type';
  end if;
  return coalesce(val, 0);
end;
$$;
grant execute on function public.get_coin_balance(text) to authenticated;


create or replace function public.adjust_coins(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text default 'balance'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_val numeric;
begin
  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    update public.profiles
    set balance = balance + p_amount,
        updated_at = now()
    where id = p_user_id
    returning balance into new_val;
  elsif p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = sweeps_coins + p_amount,
        updated_at = now()
    where id = p_user_id
    returning sweeps_coins into new_val;
  else
    raise exception 'Invalid coin type';
  end if;

  if not found then
    raise exception 'User not found';
  end if;

  if new_val < 0 then
    raise exception 'Insufficient balance';
  end if;

  return new_val;
end;
$$;
grant execute on function public.adjust_coins(uuid, numeric, text) to service_role;


create or replace function public.grant_free_sc(
  p_user_id uuid,
  p_sc_amount numeric,
  p_reason text default 'Free entry (mail-in)'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_sc numeric(12, 2);
begin
  if p_sc_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  update public.profiles
  set sweeps_coins = sweeps_coins + p_sc_amount,
      updated_at = now()
  where id = p_user_id
  returning sweeps_coins into new_sc;

  if not found then
    raise exception 'User not found';
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'bonus', p_sc_amount, new_sc, p_reason);
end;
$$;
revoke all on function public.grant_free_sc(uuid, numeric, text) from public;
grant execute on function public.grant_free_sc(uuid, numeric, text) to service_role;


-- ─── Responsible gaming ─────────────────────────────────────────────────────

create or replace function public.self_exclude(p_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_days not in (30, 90, 180) then
    raise exception 'Invalid exclusion period. Choose 30, 90, or 180 days.';
  end if;

  update public.profiles
  set self_excluded_until = clock_timestamp() + (p_days || ' days')::interval,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;
revoke all on function public.self_exclude(int) from public;
grant execute on function public.self_exclude(int) to authenticated;


create or replace function public.cancel_self_exclusion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set self_excluded_until = null,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;
revoke all on function public.cancel_self_exclusion() from public;
grant execute on function public.cancel_self_exclusion() to authenticated;


create or replace function public.check_self_exclusion()
returns table (
  excluded boolean,
  excluded_until timestamptz,
  remaining_days int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  excl_until timestamptz;
  days_left int;
begin
  select self_excluded_until into excl_until
  from public.profiles
  where id = auth.uid();

  if excl_until is null or excl_until < clock_timestamp() then
    return query select false, null::timestamptz, 0::int;
  else
    days_left := ceil(extract(epoch from (excl_until - clock_timestamp())) / 86400)::int;
    return query select true, excl_until, days_left;
  end if;
end;
$$;
revoke all on function public.check_self_exclusion() from public;
grant execute on function public.check_self_exclusion() to authenticated;


create or replace function public.check_user_self_exclusion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  excl_until timestamptz;
begin
  select self_excluded_until into excl_until
  from public.profiles
  where id = p_user_id;

  if excl_until is not null and excl_until >= clock_timestamp() then
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.check_user_self_exclusion(uuid) from public;
grant execute on function public.check_user_self_exclusion(uuid) to service_role;


create or replace function public.set_deposit_limits(
  p_daily_limit numeric default null,
  p_weekly_limit numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_daily_limit is not null and p_daily_limit <= 0 then
    raise exception 'Daily limit must be positive or null.';
  end if;
  if p_weekly_limit is not null and p_weekly_limit <= 0 then
    raise exception 'Weekly limit must be positive or null.';
  end if;

  update public.profiles
  set daily_deposit_limit = p_daily_limit,
      weekly_deposit_limit = p_weekly_limit,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;
revoke all on function public.set_deposit_limits(numeric, numeric) from public;
grant execute on function public.set_deposit_limits(numeric, numeric) to authenticated;


create or replace function public.get_deposit_limits()
returns table (
  daily_limit numeric,
  weekly_limit numeric,
  daily_used numeric,
  weekly_used numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_limit numeric;
  w_limit numeric;
  d_used numeric;
  w_used numeric;
begin
  select p.daily_deposit_limit, p.weekly_deposit_limit
  into d_limit, w_limit
  from public.profiles p
  where p.id = auth.uid();

  select coalesce(sum(cd.usd_amount), 0)
  into d_used
  from public.crypto_deposits cd
  where cd.user_id = auth.uid()
    and cd.status = 'credited'
    and cd.credited_at >= date_trunc('day', now());

  select coalesce(sum(cd.usd_amount), 0)
  into w_used
  from public.crypto_deposits cd
  where cd.user_id = auth.uid()
    and cd.status = 'credited'
    and cd.credited_at >= date_trunc('week', now());

  return query select d_limit, w_limit, d_used, w_used;
end;
$$;
revoke all on function public.get_deposit_limits() from public;
grant execute on function public.get_deposit_limits() to authenticated;


-- ─── Affiliate system ───────────────────────────────────────────────────────

create or replace function public.normalize_affiliate_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;


create or replace function public.generate_unique_affiliate_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  i int;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.profiles p where p.affiliate_code = code
    );
    attempts := attempts + 1;
    if attempts > 100 then
      raise exception 'Could not generate affiliate code';
    end if;
  end loop;
  return code;
end;
$$;


create or replace function public.ensure_user_affiliate_code(p_user_id uuid default auth.uid())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.normalize_affiliate_code(p.affiliate_code) into code
  from public.profiles p
  where p.id = p_user_id;

  if code is not null and code <> '' then
    if code <> (select affiliate_code from public.profiles where id = p_user_id) then
      update public.profiles
      set affiliate_code = code, updated_at = now()
      where id = p_user_id;
    end if;
    return code;
  end if;

  code := public.generate_unique_affiliate_code();

  update public.profiles
  set affiliate_code = code, updated_at = now()
  where id = p_user_id and (affiliate_code is null or affiliate_code = '');

  return code;
end;
$$;
revoke all on function public.ensure_user_affiliate_code(uuid) from public;
grant execute on function public.ensure_user_affiliate_code(uuid) to authenticated;
grant execute on function public.ensure_user_affiliate_code(uuid) to service_role;


create or replace function public.apply_affiliate_referral(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  normalized text;
begin
  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return;
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> p_user_id;

  if aff_id is null then
    return;
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = p_user_id
    and referred_by is null;
end;
$$;
revoke all on function public.apply_affiliate_referral(uuid, text) from public;
grant execute on function public.apply_affiliate_referral(uuid, text) to service_role;


create or replace function public.submit_affiliate_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  normalized text;
  aff_id uuid;
  current_referred_by uuid;
  my_code text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return jsonb_build_object('success', false, 'error', 'Enter a valid referral code.');
  end if;

  select p.referred_by, public.normalize_affiliate_code(p.affiliate_code)
  into current_referred_by, my_code
  from public.profiles p
  where p.id = uid;

  if current_referred_by is not null then
    return jsonb_build_object('success', false, 'error', 'You already have a referral code on your account.');
  end if;

  if my_code is not null and my_code = normalized then
    return jsonb_build_object('success', false, 'error', 'You cannot use your own referral code.');
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> uid;

  if aff_id is null then
    return jsonb_build_object('success', false, 'error', 'That referral code was not found.');
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = uid
    and referred_by is null;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Could not apply referral code. Try again.');
  end if;

  return jsonb_build_object(
    'success', true,
    'referrer_code', normalized
  );
end;
$$;
revoke all on function public.submit_affiliate_referral_code(text) from public;
grant execute on function public.submit_affiliate_referral_code(text) to authenticated;


-- Affiliate commission trigger function (accrues unclaimed commissions)
create or replace function public.trg_affiliate_commission_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  rate numeric;
  commission numeric(12, 2);
  base_amt numeric(12, 2);
begin
  if NEW.type = 'deposit' then
    base_amt := NEW.amount;
    rate := 0.05;
  elsif NEW.type = 'wager' then
    base_amt := abs(NEW.amount);
    rate := 0.01;
  else
    return NEW;
  end if;

  if base_amt <= 0 then
    return NEW;
  end if;

  select p.referred_by into aff_id
  from public.profiles p
  where p.id = NEW.user_id;

  if aff_id is null then
    return NEW;
  end if;

  commission := round(base_amt * rate, 2);
  if commission <= 0 then
    return NEW;
  end if;

  if exists (
    select 1
    from public.affiliate_commissions c
    where c.source_transaction_id = NEW.id
  ) then
    return NEW;
  end if;

  insert into public.affiliate_commissions (
    affiliate_id,
    referred_user_id,
    kind,
    base_amount,
    commission_amount,
    source_transaction_id
  )
  values (
    aff_id,
    NEW.user_id,
    case when NEW.type = 'deposit' then 'deposit' else 'wager' end,
    base_amt,
    commission,
    NEW.id
  );

  return NEW;
end;
$$;


create or replace function public.claim_affiliate_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claim_amt numeric(12, 2);
  new_bal numeric(12, 2);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(sum(c.commission_amount), 0)::numeric(12, 2)
  into claim_amt
  from public.affiliate_commissions c
  where c.affiliate_id = uid
    and c.claimed_at is null;

  if claim_amt <= 0 then
    select p.balance into new_bal from public.profiles p where p.id = uid;
    return jsonb_build_object('claimed_amount', 0, 'claimable_balance', 0, 'balance', coalesce(new_bal, 0));
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into new_bal
  from public.profiles p
  where p.id = uid
  for update;

  new_bal := coalesce(new_bal, 0) + claim_amt;

  update public.profiles p
  set balance = new_bal, updated_at = now()
  where p.id = uid;

  update public.affiliate_commissions c
  set claimed_at = now()
  where c.affiliate_id = uid
    and c.claimed_at is null;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (uid, 'affiliate', claim_amt, new_bal, 'Affiliate earnings claimed');

  select p.balance into new_bal from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'claimed_amount', claim_amt,
    'claimable_balance', 0,
    'balance', coalesce(new_bal, 0)
  );
end;
$$;
revoke all on function public.claim_affiliate_earnings() from public;
grant execute on function public.claim_affiliate_earnings() to authenticated;


create or replace function public.get_affiliate_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  result jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  code := public.ensure_user_affiliate_code(uid);

  select jsonb_build_object(
    'affiliate_code', code,
    'has_referrer', (
      select p.referred_by is not null
      from public.profiles p
      where p.id = uid
    ),
    'referrer_code', (
      select r.affiliate_code
      from public.profiles p
      join public.profiles r on r.id = p.referred_by
      where p.id = uid
    ),
    'referred_count', (
      select count(*)::int
      from public.profiles p
      where p.referred_by = uid
    ),
    'claimable_balance', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is null
    ), 0),
    'total_claimed', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is not null
    ), 0),
    'total_earned', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid
    ), 0),
    'earned_from_deposits', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'deposit' and c.claimed_at is null
    ), 0),
    'earned_from_wagers', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'wager' and c.claimed_at is null
    ), 0),
    'recent_commissions', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          c.id,
          c.kind,
          c.base_amount,
          c.commission_amount,
          c.created_at
        from public.affiliate_commissions c
        where c.affiliate_id = uid and c.claimed_at is null
        order by c.created_at desc
        limit 15
      ) x
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;
revoke all on function public.get_affiliate_stats() from public;
grant execute on function public.get_affiliate_stats() to authenticated;


-- ─── Chat wager levels ──────────────────────────────────────────────────────

create or replace function public.get_user_wager_levels(user_ids uuid[])
returns table(user_id uuid, total_wagered numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.total_wagered, 0)
  from public.profiles p
  where p.id = any(user_ids);
$$;
revoke all on function public.get_user_wager_levels(uuid[]) from public;
grant execute on function public.get_user_wager_levels(uuid[]) to authenticated;


-- ─── Transaction history (with affiliate in sort order) ─────────────────────

create or replace function public.get_user_transactions(
  p_page int default 0,
  p_page_size int default 10
)
returns table (
  id uuid,
  type text,
  amount numeric,
  balance_after numeric,
  description text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lim int := greatest(1, least(coalesce(p_page_size, 10), 50));
  off int := greatest(0, coalesce(p_page, 0)) * lim;
  cnt bigint;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::bigint into cnt
  from public.transactions t
  where t.user_id = uid;

  return query
  select
    t.id,
    t.type,
    t.amount,
    t.balance_after,
    t.description,
    t.created_at,
    cnt
  from public.transactions t
  where t.user_id = uid
  order by
    t.created_at desc,
    case t.type
      when 'wager' then 0
      when 'loss' then 1
      when 'win' then 2
      when 'affiliate' then 3
      when 'deposit' then 4
      when 'withdrawal' then 5
      else 6
    end asc,
    t.id asc
  limit lim
  offset off;
end;
$$;
grant execute on function public.get_user_transactions(int, int) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5b: Provably-fair seed helpers (used by all games)
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.ensure_game_pf_seeds(p_user_id uuid)
returns public.game_pf_seeds
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
begin
  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if found then
    return row;
  end if;

  new_seed := encode(gen_random_bytes(32), 'hex');
  insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
  values (
    p_user_id,
    new_seed,
    encode(digest(new_seed, 'sha256'), 'hex'),
    'default',
    0
  )
  returning * into row;

  return row;
end;
$$;
revoke all on function public.ensure_game_pf_seeds(uuid) from public;
grant execute on function public.ensure_game_pf_seeds(uuid) to service_role;


-- rotate_server_seed: atomically archives the current server_seed (so the
-- player can verify past rounds after rotation), generates a new one, and
-- resets the nonce. This closes the "live server_seed is forever readable"
-- hole when combined with the column-level grant above: the archived
-- (revealed) seed is safe to read because it is no longer used for new
-- rounds. Returns the COMMITMENT (hash) of the NEW seed plus the REVEALED
-- old seed so the client can verify past rounds.
create or replace function public.rotate_server_seed()
returns table (
  new_server_seed_hash text,
  revealed_server_seed  text,
  revealed_server_seed_hash text,
  client_seed           text,
  next_nonce            bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  old_row public.game_pf_seeds;
  new_seed text;
  new_hash text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into old_row from public.game_pf_seeds where user_id = uid for update;
  if not found then
    -- Bootstrap if the user somehow has no seed row yet.
    perform public.ensure_game_pf_seeds(uid);
    select * into old_row from public.game_pf_seeds where user_id = uid for update;
  end if;

  new_seed := encode(gen_random_bytes(32), 'hex');
  new_hash := encode(digest(new_seed, 'sha256'), 'hex');

  update public.game_pf_seeds
    set server_seed = new_seed,
        server_seed_hash = new_hash,
        next_nonce = 0,
        updated_at = now()
    where user_id = uid;

  return query select
    new_hash,
    old_row.server_seed        as revealed_server_seed,
    old_row.server_seed_hash   as revealed_server_seed_hash,
    old_row.client_seed        as client_seed,
    0::bigint                  as next_nonce;
end;
$$;
revoke all on function public.rotate_server_seed() from public;
grant execute on function public.rotate_server_seed() to authenticated;


create or replace function public.get_keno_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  row public.game_pf_seeds;
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into row from public.game_pf_seeds where user_id = uid;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  return query
  select row.server_seed_hash, row.client_seed, row.next_nonce;
end;
$$;
grant execute on function public.get_keno_pf_state() to authenticated;


create or replace function public.set_keno_client_seed(p_client_seed text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_client_seed, ''))) = 0 then
    raise exception 'Client seed cannot be empty';
  end if;

  if length(p_client_seed) > 64 then
    raise exception 'Client seed too long (max 64 characters)';
  end if;

  if not exists (select 1 from public.game_pf_seeds where user_id = uid) then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      trim(p_client_seed),
      0
    );
    return;
  end if;

  update public.game_pf_seeds
  set client_seed = trim(p_client_seed), updated_at = now()
  where user_id = uid;
end;
$$;
grant execute on function public.set_keno_client_seed(text) to authenticated;


-- consume_keno_nonce advances next_nonce by p_advance (case battles use multiple nonces per battle)
create or replace function public.consume_keno_nonce(p_user_id uuid, p_advance int default 1)
returns table (
  server_seed text,
  client_seed text,
  nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
  v_advance int;
  v_nonce bigint;
begin
  if p_user_id is null then
    raise exception 'User id required';
  end if;

  v_advance := greatest(coalesce(p_advance, 1), 1);

  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      p_user_id,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  v_nonce := row.next_nonce;

  update public.game_pf_seeds
  set next_nonce = v_nonce + v_advance, updated_at = now()
  where user_id = p_user_id;

  return query
  select row.server_seed, row.client_seed, v_nonce;
end;
$$;
revoke all on function public.consume_keno_nonce(uuid, int) from public;
grant execute on function public.consume_keno_nonce(uuid, int) to service_role;


-- ─── Keno settlement (dual-currency) ────────────────────────────────────────

create or replace function public.settle_keno_bet(
  p_user_id uuid,
  p_wager numeric,
  p_risk text,
  p_picks int[],
  p_drawn int[],
  p_hits int,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  bet_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  won boolean;
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance
    from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance
    from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  won := p_payout > 0;
  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when won then p_payout else 0 end,
        total_losses = total_losses + case when not won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set balance = new_balance,
        total_wins = total_wins + case when won then p_payout else 0 end,
        total_losses = total_losses + case when not won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.keno_bets (user_id, wager, risk, picks, drawn, hits, multiplier, payout, nonce)
  values (p_user_id, p_wager, p_risk, p_picks, p_drawn, p_hits, p_multiplier, coalesce(p_payout, 0), p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Keno', wager_at);

  if won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Keno hit ' || p_hits || '/' || array_length(p_picks, 1), outcome_at);
  else
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Keno loss', outcome_at);
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;
revoke all on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text) from public;
grant execute on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text) to service_role;


-- ─── Limbo settlement (dual-currency) ───────────────────────────────────────

create or replace function public.settle_limbo_bet(
  p_user_id uuid,
  p_wager numeric,
  p_target_multiplier numeric,
  p_result_multiplier numeric,
  p_won boolean,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  bet_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_target_multiplier < 1.01 or p_target_multiplier > 1000000 then
    raise exception 'Invalid target multiplier';
  end if;

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance
    from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance
    from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = new_balance,
        total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
        total_losses = total_losses + case when not p_won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set balance = new_balance,
        total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
        total_losses = total_losses + case when not p_won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.limbo_bets (user_id, wager, target_multiplier, result_multiplier, won, payout, nonce)
  values (p_user_id, p_wager, p_target_multiplier, p_result_multiplier, p_won, coalesce(p_payout, 0), p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Limbo @ ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x',
    wager_at
  );

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Limbo hit ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x',
      outcome_at
    );
  elsif not p_won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Limbo ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x — below target',
      outcome_at
    );
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;
revoke all on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text) from public;
grant execute on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text) to service_role;

create or replace function public.get_limbo_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_limbo_pf_state() to authenticated;

create or replace function public.set_limbo_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_limbo_client_seed(text) to authenticated;


-- ─── Roulette settlement (dual-currency) ────────────────────────────────────

create or replace function public.settle_roulette_bet(
  p_user_id uuid,
  p_wager numeric,
  p_bet_type text,
  p_result_pocket int,
  p_result_color text,
  p_won boolean,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  bet_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance
    from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance
    from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when p_won then p_payout else 0 end,
        total_losses = total_losses + case when not p_won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set balance = new_balance,
        total_wins = total_wins + case when p_won then p_payout else 0 end,
        total_losses = total_losses + case when not p_won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.roulette_bets (user_id, wager, bet_type, result_pocket, result_color, won, payout, nonce)
  values (p_user_id, p_wager, p_bet_type, p_result_pocket, p_result_color, p_won, coalesce(p_payout, 0), p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Roulette ' || p_bet_type, wager_at);

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Roulette ' || p_bet_type || ' win', outcome_at);
  else
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Roulette ' || p_bet_type || ' loss', outcome_at);
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;
revoke all on function public.settle_roulette_bet(uuid, numeric, text, int, text, boolean, numeric, bigint, text) from public;
grant execute on function public.settle_roulette_bet(uuid, numeric, text, int, text, boolean, numeric, bigint, text) to service_role;

create or replace function public.get_roulette_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_roulette_pf_state() to authenticated;

create or replace function public.set_roulette_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_roulette_client_seed(text) to authenticated;


-- ─── Mines (dual-currency + RTP fix with p_force_mine) ──────────────────────

create or replace function public.mines_comb(n int, r int)
returns numeric
language plpgsql
immutable
as $$
declare
  result numeric := 1;
  i int;
  k int;
begin
  if r < 0 or r > n then
    return 0;
  end if;
  if r = 0 or r = n then
    return 1;
  end if;
  k := least(r, n - r);
  for i in 0..k - 1 loop
    result := result * (n - i) / (i + 1);
  end loop;
  return result;
end;
$$;


create or replace function public.start_mines_game(
  p_user_id uuid,
  p_wager numeric,
  p_mine_count int,
  p_mine_tiles int[],
  p_nonce bigint,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  game_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  gid uuid;
  wager_at timestamptz := clock_timestamp();
begin
  if p_mine_count < 1 or p_mine_count > 24 then raise exception 'Invalid mine count'; end if;
  if array_length(p_mine_tiles, 1) is distinct from p_mine_count then raise exception 'Mine layout mismatch'; end if;

  if exists (select 1 from public.mines_games g where g.user_id = p_user_id and g.status = 'active') then
    raise exception 'Finish your current Mines game first';
  end if;

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.mines_games (user_id, wager, mine_count, mine_tiles, revealed_tiles, gems_revealed, multiplier, status, nonce)
  values (p_user_id, p_wager, p_mine_count, p_mine_tiles, '{}', 0, 1, 'active', p_nonce)
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, upper(p_coin_type) || ' Mines bet (' || p_mine_count || ' mines)', wager_at);

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;
revoke all on function public.start_mines_game(uuid, numeric, int, int[], bigint, text) from public;
grant execute on function public.start_mines_game(uuid, numeric, int, int[], bigint, text) to service_role;


create or replace function public.mines_reveal_tile(
  p_user_id uuid,
  p_game_id uuid,
  p_tile int,
  p_force_mine boolean default false
)
returns table (
  out_balance numeric,
  game_id uuid,
  tile int,
  is_mine boolean,
  gems_revealed int,
  multiplier numeric,
  status text,
  mine_count int,
  mine_tiles int[],
  payout numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mines_games%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  new_gems int;
  new_mult numeric(14, 4);
  is_hit boolean;
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_tile < 0 or p_tile > 24 then
    raise exception 'Invalid tile';
  end if;

  select * into g
  from public.mines_games
  where id = p_game_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if g.status <> 'active' then
    raise exception 'Game is not active';
  end if;

  if p_tile = any (g.revealed_tiles) then
    raise exception 'Tile already revealed';
  end if;

  is_hit := p_force_mine or p_tile = any (g.mine_tiles);

  if is_hit then
    update public.mines_games
    set
      status = 'busted',
      revealed_tiles = array_append(g.revealed_tiles, p_tile),
      completed_at = now()
    where id = g.id;

    select p.balance into current_balance from public.profiles p where p.id = p_user_id;

    update public.profiles p
    set
      total_losses = total_losses + g.wager,
      updated_at = now()
    where p.id = p_user_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -g.wager,
      current_balance,
      'Mines — hit mine',
      outcome_at
    );

    return query
    select
      current_balance,
      g.id,
      p_tile,
      true,
      g.gems_revealed,
      g.multiplier,
      'busted'::text,
      g.mine_count,
      g.mine_tiles,
      0::numeric;
    return;
  end if;

  new_gems := g.gems_revealed + 1;
  new_mult := floor(
    (0.99::numeric
      * public.mines_comb(25, new_gems)
      / public.mines_comb(25 - g.mine_count, new_gems)) * 100
  ) / 100;

  update public.mines_games
  set
    revealed_tiles = array_append(g.revealed_tiles, p_tile),
    gems_revealed = new_gems,
    multiplier = new_mult
  where id = g.id;

  select p.balance into current_balance from public.profiles p where p.id = p_user_id;

  return query
  select
    current_balance,
    g.id,
    p_tile,
    false,
    new_gems,
    new_mult,
    'active'::text,
    g.mine_count,
    null::int[],
    0::numeric;
end;
$$;
revoke all on function public.mines_reveal_tile(uuid, uuid, int, boolean) from public;
grant execute on function public.mines_reveal_tile(uuid, uuid, int, boolean) to service_role;


create or replace function public.mines_cashout(
  p_user_id uuid,
  p_game_id uuid,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  game_id uuid,
  payout numeric,
  multiplier numeric,
  gems_revealed int,
  wager numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mines_games%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  pay numeric(12, 2);
  win_at timestamptz := clock_timestamp();
begin
  select * into g from public.mines_games where id = p_game_id and user_id = p_user_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game is not active'; end if;
  if g.gems_revealed < 1 then raise exception 'Reveal at least one gem before cashing out'; end if;

  pay := round(g.wager * g.multiplier, 2);

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + pay;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  end if;

  update public.mines_games set status = 'cashed_out', payout = pay, completed_at = now() where id = g.id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'win', pay, new_balance,
    upper(p_coin_type) || ' Mines cashout ' || g.gems_revealed || ' gems @ ' || trim(to_char(g.multiplier, 'FM999990.9999')) || 'x', win_at);

  return query select new_balance, g.id, pay, g.multiplier, g.gems_revealed, g.wager;
end;
$$;
revoke all on function public.mines_cashout(uuid, uuid, text) from public;
grant execute on function public.mines_cashout(uuid, uuid, text) to service_role;


create or replace function public.get_active_mines_game(p_user_id uuid)
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    g.id,
    g.wager,
    g.mine_count,
    g.revealed_tiles,
    g.gems_revealed,
    g.multiplier,
    g.status
  from public.mines_games g
  where g.user_id = p_user_id and g.status = 'active'
  order by g.created_at desc
  limit 1;
end;
$$;
revoke all on function public.get_active_mines_game(uuid) from public;
grant execute on function public.get_active_mines_game(uuid) to service_role;


create or replace function public.get_my_active_mines_game()
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select * from public.get_active_mines_game(uid);
end;
$$;
grant execute on function public.get_my_active_mines_game() to authenticated;

create or replace function public.get_mines_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_mines_pf_state() to authenticated;

create or replace function public.set_mines_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_mines_client_seed(text) to authenticated;


-- ─── Blackjack (dual-currency) ──────────────────────────────────────────────

create or replace function public.start_blackjack_hand(
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
  p_phase text default 'player_turn',
  p_insurance_wager numeric default 0,
  p_insurance_taken boolean default false,
  p_insurance_decided boolean default false,
  p_is_split boolean default false,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  hand_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  hid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if exists (
    select 1 from public.blackjack_hands h
    where h.user_id = p_user_id and h.status = 'player_turn'
  ) then
    raise exception 'Finish your current Blackjack hand first';
  end if;

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_total_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_total_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_total_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.blackjack_hands (user_id, wager, total_wager, doubled, shoe, shoe_index, player_cards, dealer_cards, dealer_revealed, status, outcome, payout, nonce, phase, insurance_wager, insurance_taken, insurance_decided, is_split, player_hands, active_hand_index, completed_at)
  values (p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index, p_player_cards, p_dealer_cards, p_dealer_revealed, p_status, p_outcome, coalesce(p_payout, 0), p_nonce, p_phase, p_insurance_wager, p_insurance_taken, p_insurance_decided, p_is_split, p_player_hands, p_active_hand_index, case when p_status = 'settled' then now() else null end)
  returning id into hid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_total_wager, new_balance, upper(p_coin_type) || ' Blackjack bet', wager_at);

  if p_status = 'settled' then
    new_balance := new_balance + coalesce(p_payout, 0);
    if p_coin_type = 'sweeps_coins' then
      update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
    else
      update public.profiles set balance = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
    end if;
    if coalesce(p_payout, 0) > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'win', p_payout, new_balance, upper(p_coin_type) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
    elsif p_outcome in ('lose', 'bust') then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'loss', -p_total_wager, new_balance, upper(p_coin_type) || ' Blackjack ' || p_outcome, outcome_at);
    elsif p_outcome = 'push' then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'push', 0, new_balance, upper(p_coin_type) || ' Blackjack push', outcome_at);
    end if;
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, hid;
end;
$$;
revoke all on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text) from public;
grant execute on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text) to service_role;


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
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance < p_extra_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_extra_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_extra_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_extra_wager, new_balance, upper(p_coin_type) || ' ' || p_description);
end;
$$;
revoke all on function public.blackjack_debit_extra(uuid, uuid, numeric, text, text) from public;
grant execute on function public.blackjack_debit_extra(uuid, uuid, numeric, text, text) to service_role;


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
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + coalesce(p_payout, 0) - coalesce(p_extra_wager, 0);

  if p_coin_type = 'sweeps_coins' then
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
    values (p_user_id, 'win', p_payout, new_balance, upper(p_coin_type) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
  end if;

  return query select new_balance, p_hand_id;
end;
$$;
revoke all on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric, text, jsonb, boolean, int, numeric, boolean, text) from public;
grant execute on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric, text, jsonb, boolean, int, numeric, boolean, text) to service_role;


create or replace function public.get_my_active_blackjack_hand()
returns table (
  hand_id uuid,
  wager numeric,
  total_wager numeric,
  doubled boolean,
  player_cards int[],
  dealer_cards int[],
  dealer_revealed boolean,
  shoe_index int,
  phase text,
  insurance_wager numeric,
  insurance_taken boolean,
  insurance_decided boolean,
  is_split boolean,
  player_hands jsonb,
  active_hand_index int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    h.id,
    h.wager,
    h.total_wager,
    h.doubled,
    h.player_cards,
    case
      when h.dealer_revealed then h.dealer_cards
      when coalesce(array_length(h.dealer_cards, 1), 0) >= 1 then array[h.dealer_cards[1]]
      else '{}'::int[]
    end,
    h.dealer_revealed,
    h.shoe_index,
    h.phase,
    h.insurance_wager,
    h.insurance_taken,
    h.insurance_decided,
    h.is_split,
    h.player_hands,
    h.active_hand_index
  from public.blackjack_hands h
  where h.user_id = uid and h.status = 'player_turn'
  order by h.created_at desc
  limit 1;
end;
$$;
grant execute on function public.get_my_active_blackjack_hand() to authenticated;

create or replace function public.get_blackjack_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_blackjack_pf_state() to authenticated;

create or replace function public.set_blackjack_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_blackjack_client_seed(text) to authenticated;


-- ─── Case Battles (latest versions of all 6 functions) ──────────────────────

create or replace function public.create_case_battle_entry(
  p_user_id uuid,
  p_battle_id uuid,
  p_slot_index int,
  p_entry_cost numeric,
  p_display_name text default 'Player',
  p_borrow_percent int default 0
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  wager_at timestamptz := clock_timestamp();
  borrow_pct int;
  actual_cost numeric(12, 2);
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not open for joins';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.user_id = p_user_id
  ) then
    raise exception 'Already in this battle';
  end if;

  borrow_pct := greatest(0, least(coalesce(p_borrow_percent, 0), 80));
  actual_cost := round(p_entry_cost * (1 - borrow_pct::numeric / 100), 2);

  if actual_cost <= 0 then
    raise exception 'Invalid entry cost';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < actual_cost then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - actual_cost;

  update public.profiles p
  set
    balance = new_balance,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.case_battle_players (
    battle_id, user_id, is_bot, slot_index, display_name, borrow_percent, entry_paid
  )
  values (
    p_battle_id,
    p_user_id,
    false,
    p_slot_index,
    coalesce(nullif(trim(p_display_name), ''), 'Player'),
    borrow_pct,
    actual_cost
  );

  update public.case_battles
  set pot_total = pot_total + actual_cost
  where id = p_battle_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'wager',
    -actual_cost,
    new_balance,
    case
      when borrow_pct > 0 then format('Case battle entry (%s%% borrow)', borrow_pct)
      else 'Case battle entry'
    end,
    wager_at
  );

  return query select new_balance;
end;
$$;
revoke all on function public.create_case_battle_entry(uuid, uuid, int, numeric, text, int) from public;
grant execute on function public.create_case_battle_entry(uuid, uuid, int, numeric, text, int) to service_role;


-- 10-bot random roster
create or replace function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  v_name text;
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not waiting for players';
  end if;

  if p_slot_index < 0 or p_slot_index >= b.max_players then
    raise exception 'Invalid slot';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  with roster(name) as (
    values
      ('Rusty [Bot]'),
      ('Blitz [Bot]'),
      ('Nova [Bot]'),
      ('Cipher [Bot]'),
      ('Vega [Bot]'),
      ('Onyx [Bot]'),
      ('Rex [Bot]'),
      ('Flint [Bot]'),
      ('Jinx [Bot]'),
      ('Sable [Bot]')
  ),
  taken as (
    select p.display_name
    from public.case_battle_players p
    where p.battle_id = p_battle_id
      and p.is_bot
  )
  select r.name into v_name
  from roster r
  where r.name not in (select t.display_name from taken t)
  order by random()
  limit 1;

  if v_name is null then
    select r.name into v_name
    from (
      values
        ('Rusty [Bot]'),
        ('Blitz [Bot]'),
        ('Nova [Bot]'),
        ('Cipher [Bot]'),
        ('Vega [Bot]'),
        ('Onyx [Bot]'),
        ('Rex [Bot]'),
        ('Flint [Bot]'),
        ('Jinx [Bot]'),
        ('Sable [Bot]')
    ) as r(name)
    order by random()
    limit 1;
  end if;

  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, v_name);
end;
$$;
revoke all on function public.insert_case_battle_bot(uuid, int) from public;
grant execute on function public.insert_case_battle_bot(uuid, int) to service_role;


-- Latest: defers balance credit until client claims (avoids double-credit race)
create or replace function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb,
  p_winner_payouts jsonb default '[]'::jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row jsonb;
  battle_status text;
begin
  select b.status into battle_status
  from public.case_battles b
  where b.id = p_battle_id
  for update;

  if battle_status is null then
    raise exception 'Battle not found';
  end if;

  if battle_status = 'completed' then
    return;
  end if;

  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id
    and status in ('waiting', 'running', 'pending_eos', 'pending_jackpot_eos');

  if not found then
    select b.status into battle_status
    from public.case_battles b
    where b.id = p_battle_id;

    if battle_status = 'completed' then
      return;
    end if;

    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  return;
end;
$$;


-- Client claims payouts (idempotent; records net losses too)
create or replace function public.apply_case_battle_payouts(
  p_battle_id uuid,
  p_user_id uuid
)
returns table (out_balance numeric, out_credited boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  payout_row jsonb;
  uid uuid;
  amt numeric(12, 2);
  payouts jsonb;
  paid boolean := false;
  player_row record;
  player_payout numeric(12, 2);
  net_loss numeric(12, 2);
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'completed' then
    raise exception 'Battle is not finished yet';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if b.payouts_credited then
    return query select current_balance, false;
    return;
  end if;

  payouts := coalesce(b.results->'winnerPayouts', '[]'::jsonb);
  if jsonb_typeof(payouts) <> 'array' then
    payouts := '[]'::jsonb;
  end if;

  if jsonb_array_length(payouts) > 0 then
    for payout_row in select * from jsonb_array_elements(payouts)
    loop
      uid := coalesce(
        nullif(payout_row->>'userId', '')::uuid,
        nullif(payout_row->>'user_id', '')::uuid
      );
      amt := coalesce((payout_row->>'amount')::numeric, 0);
      if uid is null or amt <= 0 or uid <> p_user_id then
        continue;
      end if;

      select p.balance into current_balance
      from public.profiles p
      where p.id = uid
      for update;

      new_balance := current_balance + amt;
      paid := true;

      update public.profiles p
      set
        balance = new_balance,
        total_wins = total_wins + amt,
        updated_at = now()
      where p.id = uid;

      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (uid, 'win', amt, new_balance, 'Case battle win', outcome_at);
    end loop;
  elsif b.winner_id is not null
    and b.winner_id = p_user_id
    and coalesce(b.winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = b.winner_id
    for update;

    new_balance := current_balance + b.winner_payout;
    paid := true;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + b.winner_payout,
      updated_at = now()
    where p.id = b.winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      b.winner_id,
      'win',
      b.winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );
  end if;

  if paid then
    for player_row in
      select cp.user_id, cp.entry_paid
      from public.case_battle_players cp
      where cp.battle_id = p_battle_id
        and cp.is_bot = false
        and cp.user_id is not null
        and cp.entry_paid > 0
    loop
      player_payout := 0;

      if jsonb_array_length(payouts) > 0 then
        select coalesce(sum((elem->>'amount')::numeric), 0)
        into player_payout
        from jsonb_array_elements(payouts) elem
        where coalesce(
          nullif(elem->>'userId', '')::uuid,
          nullif(elem->>'user_id', '')::uuid
        ) = player_row.user_id;
      elsif b.winner_id = player_row.user_id then
        player_payout := coalesce(b.winner_payout, 0);
      end if;

      net_loss := greatest(0, player_row.entry_paid - player_payout);
      if net_loss > 0 then
        update public.profiles p
        set
          total_losses = total_losses + net_loss,
          updated_at = now()
        where p.id = player_row.user_id;
      end if;
    end loop;

    update public.case_battles
    set payouts_credited = true
    where id = p_battle_id;

    select p.balance into current_balance
    from public.profiles p
    where p.id = p_user_id;

    return query select current_balance, true;
    return;
  end if;

  return query select current_balance, false;
end;
$$;
revoke all on function public.apply_case_battle_payouts(uuid, uuid) from public;
grant execute on function public.apply_case_battle_payouts(uuid, uuid) to service_role;


create or replace function public.mark_case_battle_running(
  p_battle_id uuid,
  p_battle_seed_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_battles
  set
    status = 'running',
    battle_seed_hash = coalesce(p_battle_seed_hash, battle_seed_hash),
    started_at = coalesce(started_at, now())
  where id = p_battle_id and status in ('waiting', 'pending_eos');
end;
$$;
revoke all on function public.mark_case_battle_running(uuid, text) from public;
grant execute on function public.mark_case_battle_running(uuid, text) to service_role;


-- Latest: shows waiting/pending_eos/pending_jackpot_eos/running + recent completed
create or replace function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  crazy_mode boolean,
  fast_spin boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  status text,
  completed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    coalesce(b.crazy_mode, false),
    coalesce(b.fast_spin, false),
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'pending_eos', 'pending_jackpot_eos', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case
      when b.status = 'waiting' then 0
      when b.status = 'pending_eos' then 1
      when b.status = 'pending_jackpot_eos' then 2
      when b.status = 'running' then 3
      else 4
    end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
grant execute on function public.get_open_case_battles(int) to authenticated;

create or replace function public.get_case_battle_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_case_battle_pf_state() to authenticated;

create or replace function public.set_case_battle_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_case_battle_client_seed(text) to authenticated;


-- ─── Crash (dual-currency) ──────────────────────────────────────────────────

create or replace function public.place_crash_bet(
  p_user_id uuid,
  p_wager numeric,
  p_crash_point numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  bet_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  bid uuid;
  wager_at timestamptz := clock_timestamp();
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.crash_bets (user_id, wager, crash_point, won, payout, coin_type, nonce)
  values (p_user_id, p_wager, p_crash_point, false, 0, p_coin_type, p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, upper(p_coin_type) || ' Crash bet', wager_at);

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;
revoke all on function public.place_crash_bet(uuid, numeric, numeric, bigint, text) from public;
grant execute on function public.place_crash_bet(uuid, numeric, numeric, bigint, text) to service_role;


create or replace function public.cash_out_crash(
  p_user_id uuid,
  p_bet_id uuid,
  p_cashed_at numeric
)
returns table (
  out_balance numeric,
  payout numeric,
  cashed_at numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.crash_bets%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  pay numeric(12, 2);
  outcome_at timestamptz := clock_timestamp();
begin
  select * into b from public.crash_bets where id = p_bet_id and user_id = p_user_id for update;
  if not found then raise exception 'Bet not found'; end if;
  if b.won then raise exception 'Already cashed out'; end if;

  -- SECURITY: validate the claimed cashout multiplier against the round's
  -- crash_point. Without this check a caller could POST cashedAtMultiplier:
  -- 1000000 and credit themselves wager × 1,000,000. The crash_point column
  -- holds the server-determined bust multiplier for this round.
  if p_cashed_at < 1 then raise exception 'Invalid cashout multiplier'; end if;
  if p_cashed_at > b.crash_point then raise exception 'Cashed out after crash point'; end if;

  pay := round(b.wager * p_cashed_at, 2);

  if b.coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + pay;

  if b.coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  end if;

  update public.crash_bets set won = true, payout = pay, cashed_at = p_cashed_at, completed_at = now() where id = p_bet_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'win', pay, new_balance,
    upper(b.coin_type) || ' Crash cashout @ ' || trim(to_char(p_cashed_at, 'FM999990.00')) || 'x', outcome_at);

  return query select new_balance, pay, p_cashed_at;
end;
$$;
revoke all on function public.cash_out_crash(uuid, uuid, numeric) from public;
grant execute on function public.cash_out_crash(uuid, uuid, numeric) to service_role;


create or replace function public.crash_settle_loss(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.crash_bets%rowtype;
begin
  select * into b from public.crash_bets where id = p_bet_id for update;
  if not found then raise exception 'Bet not found'; end if;
  if b.won then return; end if;

  update public.crash_bets set won = false, completed_at = now() where id = p_bet_id;

  update public.profiles set total_losses = total_losses + b.wager, updated_at = now() where id = b.user_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (b.user_id, 'loss', -b.wager, 0,
    upper(b.coin_type) || ' Crash crash @ ' || trim(to_char(b.crash_point, 'FM999990.00')) || 'x', now());
end;
$$;
revoke all on function public.crash_settle_loss(uuid) from public;
grant execute on function public.crash_settle_loss(uuid) to service_role;

create or replace function public.get_crash_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_crash_pf_state() to authenticated;

create or replace function public.set_crash_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_crash_client_seed(text) to authenticated;


-- ─── Slots (dual-currency) ──────────────────────────────────────────────────

create or replace function public.settle_slots_bet(
  p_user_id uuid,
  p_wager numeric,
  p_reels int[],
  p_won boolean,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  game_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  gid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager,
      total_wins = total_wins + case when p_won then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance,
      total_wins = total_wins + case when p_won then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now() where id = p_user_id;
  end if;

  insert into public.slots_games (user_id, wager, reels, won, multiplier, payout, coin_type, nonce)
  values (p_user_id, p_wager, p_reels, p_won, p_multiplier, coalesce(p_payout, 0), p_coin_type, p_nonce)
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Slots', wager_at);

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Slots win ' || trim(to_char(p_multiplier, 'FM999990.00')) || 'x', outcome_at);
  else
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Slots loss', outcome_at);
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;
revoke all on function public.settle_slots_bet(uuid, numeric, int[], boolean, numeric, numeric, bigint, text) from public;
grant execute on function public.settle_slots_bet(uuid, numeric, int[], boolean, numeric, numeric, bigint, text) to service_role;

create or replace function public.get_slots_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_slots_pf_state() to authenticated;

create or replace function public.set_slots_client_seed(p_client_seed text)
returns void
language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_slots_client_seed(text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: Triggers
-- ══════════════════════════════════════════════════════════════════════════════

-- Profiles: prevent logged-in users from editing their own balance/admin flag
drop trigger if exists profiles_guard_balance on public.profiles;
create trigger profiles_guard_balance
  before update on public.profiles
  for each row execute function public.profiles_prevent_balance_change();

drop trigger if exists profiles_guard_admin on public.profiles;
create trigger profiles_guard_admin
  before update on public.profiles
  for each row execute function public.profiles_prevent_admin_escalation();

-- Crypto deposits: notify on status transitions
drop trigger if exists crypto_deposits_notify on public.crypto_deposits;
create trigger crypto_deposits_notify
  after insert or update on public.crypto_deposits
  for each row execute function public.notify_crypto_deposit_change();

-- Crypto withdrawals: notify on completion/failure
drop trigger if exists crypto_withdrawals_notify on public.crypto_withdrawals;
create trigger crypto_withdrawals_notify
  after update on public.crypto_withdrawals
  for each row execute function public.notify_crypto_withdrawal_change();

-- Affiliate commissions: accrue on every deposit/wager transaction
drop trigger if exists affiliate_commission_on_transaction on public.transactions;
create trigger affiliate_commission_on_transaction
  after insert on public.transactions
  for each row
  execute function public.trg_affiliate_commission_on_transaction();


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: Realtime publications
-- (so the Supabase client can subscribe to live updates)
-- ══════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 8: Seed / Backfill — auto-create profile for any pre-existing auth users
-- (No-op on a truly fresh project, but harmless and idempotent.)
-- ══════════════════════════════════════════════════════════════════════════════

insert into public.profiles (id, username, email, balance, sweeps_coins)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
  u.email,
  10000,  -- 10,000 GC
  100     -- 100 SC
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Backfill affiliate codes for any profiles missing one
do $$
declare
  r record;
begin
  for r in
    select id from public.profiles where affiliate_code is null or affiliate_code = ''
  loop
    perform public.ensure_user_affiliate_code(r.id);
  end loop;
end $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 9: auth.users trigger — MUST be created LAST (after handle_new_user)
-- Auto-creates profile row (10,000 GC + 100 SC) on every new signup.
-- ══════════════════════════════════════════════════════════════════════════════

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ══════════════════════════════════════════════════════════════════════════════
-- END OF SETUP — LottaCash database is ready.
-- ══════════════════════════════════════════════════════════════════════════════
