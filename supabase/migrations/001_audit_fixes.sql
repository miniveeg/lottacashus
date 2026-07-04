-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Audit Fixes Migration (Phase 3a)
-- ══════════════════════════════════════════════════════════════════════════════
-- This migration addresses CRITICAL findings from the production-readiness audit.
-- It is IDEMPOTENT (safe to run multiple times) and can be applied to both fresh
-- installs and existing deployments.
--
-- Fix categories:
--   1. Trigger-bypass: 8 RPCs missing `bypass_profile_balance_guard()` call
--   2. Provably-fair leak: `crash_bets.crash_point` + `blackjack_hands.dealer_cards`
--   3. Crash binary-search exploit: settle-as-loss on over-cap cashout
--   4. Crash auto-settle: cron-callable function to settle abandoned bets
--   5. Race condition: `consume_keno_nonce` needs `FOR UPDATE`
--   6. Case Battles v2: negative entry_cost, free refund, gamemode logic
--   7. Withdrawal safety: destination address validation, drop legacy RPC
--   8. Admin: negative amount validation, redemption status='failed' refund
--   9. RLS hardening: verification code tables, chat rate limit, profiles UPDATE
--  10. Self-exclusion check on redemption
--  11. Blackjack finish_hand idempotency guard
--  12. Performance indexes for leaderboard + admin + crash cron
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- FIX 1: Trigger-bypass for user-callable RPCs that modify protected columns
-- ────────────────────────────────────────────────────────────────────────────
-- The `profiles_prevent_balance_change` trigger silently reverts writes to
-- balance/sweeps_coins/referred_by/self_excluded_until/total_*/deposit-limits
-- when auth.uid() is not null. Every security-definer RPC that needs to write
-- these columns MUST call `perform public.bypass_profile_balance_guard();`
-- before the UPDATE.

-- 1a. request_sc_redemption — was reverted → infinite free redemptions
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
  min_sc numeric := 100;
  rid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_chain not in ('sol', 'ltc', 'eth') then
    raise exception 'Unsupported chain';
  end if;

  -- Validate destination address format (defense-in-depth; the edge function
  -- also validates, but PostgREST lets anyone call RPCs directly).
  if p_chain = 'sol' and p_destination !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    raise exception 'Invalid Solana address';
  elsif p_chain = 'ltc' and p_destination !~ '^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,62}$' then
    raise exception 'Invalid Litecoin address';
  elsif p_chain = 'eth' and p_destination !~ '^0x[a-fA-F0-9]{40}$' then
    raise exception 'Invalid Ethereum address';
  end if;

  if p_sc_amount is null or p_sc_amount < min_sc then
    raise exception 'Minimum redemption is % SC ($%.2f)', min_sc, min_sc / 100.0;
  end if;

  -- 100 SC = $1 USD  →  usd = sc / 100
  usd_val := p_sc_amount / 100.0;

  -- Enforce self-exclusion (RG): a self-excluded user cannot redeem.
  if public.check_user_self_exclusion(uid) then
    raise exception 'Your account is self-excluded. Redemptions are blocked during self-exclusion.';
  end if;

  select sweeps_coins into current_sc
  from public.profiles where id = uid for update;

  if current_sc is null or current_sc < p_sc_amount then
    raise exception 'Insufficient Sweeps Coins balance';
  end if;

  -- CRITICAL FIX: bypass the balance guard so the trigger doesn't revert this.
  perform public.bypass_profile_balance_guard();

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


-- 1b. admin_credit_user — was reverted → admin couldn't credit balances
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

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be non-zero.';
  end if;
  -- Allow negative (admin debits) but cap the magnitude to prevent fat-finger
  -- disasters. +/- 1,000,000 per call.
  if abs(p_amount) > 1000000 then
    raise exception 'Amount exceeds the per-call limit (1,000,000).';
  end if;

  if p_coin_type not in ('gold_coins', 'balance', 'sweeps_coins') then
    raise exception 'Invalid coin type. Use balance, gold_coins, or sweeps_coins.';
  end if;

  -- CRITICAL FIX: bypass the balance guard so the trigger doesn't revert this.
  perform public.bypass_profile_balance_guard();

  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    update public.profiles
    set balance = balance + p_amount,
        updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set sweeps_coins = sweeps_coins + p_amount,
        updated_at = now()
    where id = p_user_id;
  end if;

  if not found then
    raise exception 'User not found.';
  end if;

  insert into public.admin_credit_log (user_id, amount, note, created_by, coin_type)
  values (p_user_id, p_amount, p_note, auth.uid(), p_coin_type);
end;
$$;
grant execute on function public.admin_credit_user(uuid, numeric, text, text) to authenticated;


-- 1c. self_exclude — was reverted → responsible gaming broken
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

  -- CRITICAL FIX: bypass the balance guard so the trigger doesn't revert this.
  perform public.bypass_profile_balance_guard();

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


-- 1d. set_deposit_limits — was reverted → RG feature lies
--     Also: only allows tightening (never loosening) — RG best practice.
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
  -- Reject NULLs — once a limit is set, only support can lift it (RG invariant).
  if p_daily_limit is null and p_weekly_limit is null then
    raise exception 'At least one limit (daily or weekly) must be provided.';
  end if;
  if p_daily_limit is not null and p_daily_limit <= 0 then
    raise exception 'Daily limit must be positive.';
  end if;
  if p_weekly_limit is not null and p_weekly_limit <= 0 then
    raise exception 'Weekly limit must be positive.';
  end if;

  -- CRITICAL FIX: bypass the balance guard so the trigger doesn't revert this.
  perform public.bypass_profile_balance_guard();

  -- Only allow tightening, not loosening (RG best practice).
  update public.profiles
  set daily_deposit_limit = case
    when daily_deposit_limit is not null and p_daily_limit is not null and p_daily_limit > daily_deposit_limit
      then daily_deposit_limit
    when daily_deposit_limit is not null and p_daily_limit is null
      then daily_deposit_limit
    else p_daily_limit
  end,
  weekly_deposit_limit = case
    when weekly_deposit_limit is not null and p_weekly_limit is not null and p_weekly_limit > weekly_deposit_limit
      then weekly_deposit_limit
    when weekly_deposit_limit is not null and p_weekly_limit is null
      then weekly_deposit_limit
    else p_weekly_limit
  end,
  updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;
revoke all on function public.set_deposit_limits(numeric, numeric) from public;
grant execute on function public.set_deposit_limits(numeric, numeric) to authenticated;


-- 1e. submit_affiliate_referral_code — was reverted → referrals silently not applied
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

  -- CRITICAL FIX: bypass the balance guard so the trigger doesn't revert this.
  perform public.bypass_profile_balance_guard();

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


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 2: Provably-fair leak — revoke column grants that expose hidden values
-- ────────────────────────────────────────────────────────────────────────────

-- 2a. Remove `crash_point` from crash_bets column grant.
revoke select on public.crash_bets from authenticated;
grant select (id, user_id, wager, coin_type, nonce, won, payout, cashed_at, created_at, completed_at)
  on public.crash_bets to authenticated;
grant select on public.crash_bets_safe to authenticated;


-- 2b. Remove `dealer_cards` from blackjack_hands column grant.
revoke select on public.blackjack_hands from authenticated;
grant select (id, user_id, wager, total_wager, doubled, shoe_index, player_cards, dealer_revealed, status, outcome, payout, nonce, phase, insurance_wager, insurance_taken, insurance_decided, is_split, player_hands, active_hand_index, created_at, completed_at)
  on public.blackjack_hands to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 3: Crash binary-search exploit — settle as loss on over-cap cashout
-- ────────────────────────────────────────────────────────────────────────────
-- Postgres refuses CREATE OR REPLACE when OUT / return table changes
-- (error 42P13: "cannot change return type of existing function"). This
-- migration is meant to be applied atop the V1 schema, which defined
-- cash_out_crash with a 3-col return. Drop the prior signature here so the
-- OR REPLACE below acts as a clean CREATE on whatever state the DB is in
-- (V1 partial install, V2 already-applied, or fresh).
drop function if exists public.cash_out_crash(uuid, uuid, numeric);
create or replace function public.cash_out_crash(
  p_user_id uuid,
  p_bet_id uuid,
  p_cashed_at numeric
)
returns table (
  out_balance numeric,
  payout numeric,
  cashed_at numeric,
  success boolean,
  crash_point numeric,
  already_settled boolean
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

  -- Already settled? Return idempotently.
  if b.completed_at is not null then
    if b.coin_type = 'sweeps_coins' then
      select sweeps_coins into current_balance from public.profiles where id = p_user_id;
    else
      select balance into current_balance from public.profiles where id = p_user_id;
    end if;
    return query select coalesce(current_balance, 0), coalesce(b.payout, 0), coalesce(b.cashed_at, 0), b.won, b.crash_point, true;
    return;
  end if;

  if p_cashed_at < 1 then raise exception 'Invalid cashout multiplier'; end if;

  -- CRITICAL FIX: if user tried to cash out AFTER the crash point, settle as
  -- a loss and return the crash_point so the client can show the crash.
  -- This consumes the wager, closing the binary-search exploit.
  if p_cashed_at > b.crash_point then
    perform public.bypass_profile_balance_guard();
    update public.crash_bets
      set won = false, payout = 0, completed_at = now()
      where id = p_bet_id;
    update public.profiles
      set total_losses = total_losses + b.wager, updated_at = now()
      where id = p_user_id;
    if b.coin_type = 'sweeps_coins' then
      select sweeps_coins into current_balance from public.profiles where id = p_user_id;
    else
      select balance into current_balance from public.profiles where id = p_user_id;
    end if;
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -b.wager, coalesce(current_balance, 0),
      upper(b.coin_type) || ' Crash crash @ ' || trim(to_char(b.crash_point, 'FM999990.00')) || 'x', outcome_at);
    return query select coalesce(current_balance, 0), 0, p_cashed_at, false, b.crash_point, false;
    return;
  end if;

  -- Valid cashout — pay out.
  pay := round(b.wager * p_cashed_at, 2);

  if b.coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + pay;

  perform public.bypass_profile_balance_guard();

  if b.coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  end if;

  update public.crash_bets
    set won = true, payout = pay, cashed_at = p_cashed_at, completed_at = now()
    where id = p_bet_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'win', pay, new_balance,
    upper(b.coin_type) || ' Crash cashout @ ' || trim(to_char(p_cashed_at, 'FM999990.00')) || 'x', outcome_at);

  return query select new_balance, pay, p_cashed_at, true, b.crash_point, false;
end;
$$;
revoke all on function public.cash_out_crash(uuid, uuid, numeric) from public;
grant execute on function public.cash_out_crash(uuid, uuid, numeric) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 4: Crash auto-settle — closes the "never cashed out" DB-DoS / orphan row
-- exploit. Call from a Supabase scheduled function (cron) every 60 seconds.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.crash_settle_expired_bets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  b record;
  current_balance numeric(12, 2);
begin
  for b in
    select * from public.crash_bets
    where won = false and completed_at is null
      and created_at < now() - interval '2 minutes'
    for update skip locked
  loop
    perform public.bypass_profile_balance_guard();
    update public.crash_bets
      set won = false, payout = 0, completed_at = now()
      where id = b.id;
    update public.profiles
      set total_losses = total_losses + b.wager, updated_at = now()
      where id = b.user_id;
    if b.coin_type = 'sweeps_coins' then
      select sweeps_coins into current_balance from public.profiles where id = b.user_id;
    else
      select balance into current_balance from public.profiles where id = b.user_id;
    end if;
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (b.user_id, 'loss', -b.wager, coalesce(current_balance, 0),
      upper(b.coin_type) || ' Crash crash @ ' || trim(to_char(b.crash_point, 'FM999990.00')) || 'x (auto-settled)', now());
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.crash_settle_expired_bets() from public;
grant execute on function public.crash_settle_expired_bets() to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 5: consume_keno_nonce race — add FOR UPDATE lock
-- ────────────────────────────────────────────────────────────────────────────
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

  -- CRITICAL FIX: FOR UPDATE prevents two concurrent bets from reading the
  -- same `next_nonce` and producing identical outcomes (provably-fair violation).
  select * into row from public.game_pf_seeds where user_id = p_user_id for update;
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


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 6: Blackjack idempotency guard — completed hands cannot be re-modified
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.blackjack_lock_completed_hands()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.completed_at is not null then
    if NEW.payout is distinct from OLD.payout
       or NEW.status is distinct from OLD.status
       or NEW.outcome is distinct from OLD.outcome
       or NEW.completed_at is distinct from OLD.completed_at then
      raise exception 'Cannot modify a completed blackjack hand';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_blackjack_lock_completed on public.blackjack_hands;
create trigger trg_blackjack_lock_completed
  before update on public.blackjack_hands
  for each row execute function public.blackjack_lock_completed_hands();
revoke all on function public.blackjack_lock_completed_hands() from public;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 7: admin_process_redemption — refund SC when status='failed'
-- ────────────────────────────────────────────────────────────────────────────
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
  v_redemption public.redemptions%rowtype;
  v_balance numeric;
begin
  select is_admin into _is_admin from public.profiles where id = auth.uid();
  if _is_admin is not true then
    raise exception 'Only admins can process redemptions.';
  end if;

  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid status. Use completed or failed.';
  end if;

  select * into v_redemption from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'Redemption not found.';
  end if;
  if v_redemption.status != 'pending' then
    raise exception 'Redemption already processed.';
  end if;

  if p_status = 'completed' then
    update public.redemptions
    set status = 'completed',
        tx_hash = coalesce(p_tx_hash, tx_hash),
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id;
  else
    -- 'failed': refund the SC to the user.
    perform public.bypass_profile_balance_guard();

    update public.profiles
    set sweeps_coins = sweeps_coins + v_redemption.sc_amount,
        total_withdrawn = greatest(0, total_withdrawn - v_redemption.usd_amount),
        updated_at = now()
    where id = v_redemption.user_id;

    select sweeps_coins into v_balance from public.profiles where id = v_redemption.user_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (v_redemption.user_id, 'redemption_refund', v_redemption.usd_amount, v_balance,
      'SC redemption #' || p_redemption_id || ' failed — SC refunded', now());

    update public.redemptions
    set status = 'failed',
        error_message = p_tx_hash,
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id;
  end if;
end;
$$;
grant execute on function public.admin_process_redemption(uuid, text, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 8: Drop legacy request_crypto_withdrawal RPC (treated GC as USD 1:1)
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.request_crypto_withdrawal(text, text, numeric) cascade;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 9: RLS hardening
-- ────────────────────────────────────────────────────────────────────────────

-- 9a. Enable RLS on verification/reset code tables (defense-in-depth).
alter table public.signup_verification_codes enable row level security;
alter table public.password_reset_codes enable row level security;

drop policy if exists "deny all signup codes" on public.signup_verification_codes;
create policy "deny all signup codes" on public.signup_verification_codes
  for all using (false) with check (false);

drop policy if exists "deny all reset codes" on public.password_reset_codes;
create policy "deny all reset codes" on public.password_reset_codes
  for all using (false) with check (false);


-- 9b. Restrict the profiles UPDATE policy so users can't directly write
--     discord_id, affiliate_code, etc. Only username is user-writable
--     directly. (avatar_seed was originally included here but the column
--     was never declared on profiles — it lives on case_battle_players
--     instead, where it's used for per-slot battle context. Granting update
--     on a non-existent column fails with error 42703, so the column was
--     dropped from this grant.)
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- 9c. Chat rate limit + max length + non-empty.
create or replace function public.enforce_chat_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.chat_messages
  where user_id = auth.uid()
    and created_at > now() - interval '10 seconds';
  if v_recent >= 3 then
    raise exception 'You are sending messages too quickly. Wait a few seconds.';
  end if;
  if length(coalesce(new.message, '')) > 500 then
    raise exception 'Message too long (max 500 characters).';
  end if;
  if coalesce(new.message, '') = '' then
    raise exception 'Message cannot be empty.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_rate_limit on public.chat_messages;
create trigger trg_chat_rate_limit
  before insert on public.chat_messages
  for each row execute function public.enforce_chat_rate_limit();
revoke all on function public.enforce_chat_rate_limit() from public;


-- 9d. Make check_user_self_exclusion callable by authenticated (needed by
--     request_sc_redemption's self-exclusion check). The function only reads
--     the user's own row, so it's safe to expose.
revoke all on function public.check_user_self_exclusion(uuid) from public;
grant execute on function public.check_user_self_exclusion(uuid) to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 10: Case Battles v2 — negative entry_cost, free refund, gamemode logic
-- ────────────────────────────────────────────────────────────────────────────

-- 10a. Add CHECK constraint on entry_cost (v2 regressed this from v1).
alter table public.case_battles
  drop constraint if exists case_battles_entry_cost_check;
alter table public.case_battles
  add constraint case_battles_entry_cost_check check (entry_cost >= 0);


-- 10b. cb_create_battle — add bypass + validation
create or replace function public.cb_create_battle(
  p_gamemode text,
  p_crazy boolean,
  p_player_mode text,
  p_case_ids text[],
  p_entry_cost numeric,
  p_coin_type text,
  p_borrow_percent int
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Input validation (CRITICAL: previously negative entry_cost → infinite money).
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

  insert into public.case_battles (creator_id, gamemode, crazy, player_mode, max_players, case_ids, rounds, entry_cost, coin_type, borrow_percent, pot_total)
  values (v_uid, p_gamemode, p_crazy, p_player_mode,
    case p_player_mode
      when '1v1' then 2 when '1v1v1' then 3 when '1v1v1v1' then 4
      when '2v2' then 4 when '2v2v2' then 6 when '3v3' then 6
      when '2p' then 2 when '3p' then 3 when '4p' then 4
      else 2 end,
    p_case_ids, v_rounds, p_entry_cost, v_coin, p_borrow_percent, v_charge)
  returning id into v_id;

  insert into public.case_battle_players (battle_id, user_id, slot, username)
  values (v_id, v_uid, 0, v_username);

  return v_id;
end;
$$;
revoke all on function public.cb_create_battle(text,boolean,text,text[],numeric,text,int) from public;
grant execute on function public.cb_create_battle(text,boolean,text,text[],numeric,text,int) to authenticated;


-- 10c. cb_join_battle — add bypass
create or replace function public.cb_join_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle public.case_battles%rowtype;
  v_count int;
  v_slot int;
  v_uid uuid := auth.uid();
  v_username text;
  v_charge numeric;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'waiting' then raise exception 'Battle is not open'; end if;

  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_battle.max_players then raise exception 'Battle is full'; end if;

  if exists (select 1 from public.case_battle_players where battle_id = p_battle_id and user_id = v_uid) then
    return;
  end if;

  v_charge := round(v_battle.entry_cost * (100 - v_battle.borrow_percent) / 100.0, 2);
  if v_battle.coin_type = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    if v_balance is null or v_balance < v_charge then raise exception 'Insufficient balance'; end if;
    perform public.bypass_profile_balance_guard();
    update public.profiles set sweeps_coins = sweeps_coins - v_charge, updated_at = now() where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    if v_balance is null or v_balance < v_charge then raise exception 'Insufficient balance'; end if;
    perform public.bypass_profile_balance_guard();
    update public.profiles set balance = balance - v_charge, updated_at = now() where id = v_uid;
  end if;

  select max(slot) into v_slot from public.case_battle_players where battle_id = p_battle_id;
  v_slot := coalesce(v_slot, -1) + 1;

  select username into v_username from public.profiles where id = v_uid;
  if v_username is null then v_username := 'Player'; end if;

  insert into public.case_battle_players (battle_id, user_id, slot, username)
  values (p_battle_id, v_uid, v_slot, v_username);

  update public.case_battles set pot_total = pot_total + v_charge where id = p_battle_id;
end;
$$;
revoke all on function public.cb_join_battle(uuid) from public;
grant execute on function public.cb_join_battle(uuid) to authenticated;


-- 10d. cb_leave_battle — add bypass + verify caller is actually a player
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
  v_charge numeric;
  v_was_player boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then return; end if;
  if v_battle.status != 'waiting' then raise exception 'Cannot leave a started battle'; end if;

  -- CRITICAL FIX: verify caller is actually a player before refunding.
  select exists(
    select 1 from public.case_battle_players
    where battle_id = p_battle_id and user_id = v_uid
  ) into v_was_player;
  if not v_was_player then
    raise exception 'You are not in this battle';
  end if;

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
  if v_players = 0 or v_battle.creator_id = v_uid then
    update public.case_battles set status = 'cancelled' where id = p_battle_id;
  end if;
end;
$$;
revoke all on function public.cb_leave_battle(uuid) from public;
grant execute on function public.cb_leave_battle(uuid) to authenticated;


-- 10e. cb_claim_payout — add bypass + implement all gamemodes (standard,
--      group, terminal, jackpot; with crazy flip for standard/terminal/jackpot)
create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int,
  p_amount numeric  -- ignored; recomputed server-side
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
  v_total numeric;
  v_winner_slot int;
  v_winner_slots int[];
  v_payout numeric;
  v_keep_mult numeric;
  v_row record;
  v_total_drops numeric;
  v_my_total numeric;
  v_group_a numeric := 0;
  v_group_b numeric := 0;
  v_half int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'completed' then raise exception 'Battle not completed'; end if;

  select * into v_player from public.case_battle_players where battle_id = p_battle_id and slot = p_slot for update;
  if not found then raise exception 'Player not found'; end if;
  if v_player.user_id is null or v_player.user_id != v_uid then
    raise exception 'You can only claim your own payout';
  end if;
  if v_player.claimed_at is not null then
    select balance into v_balance from public.profiles where id = v_uid;
    return coalesce(v_balance, 0);
  end if;

  -- Compute slot totals once.
  create temp table _slot_totals on commit drop as
    select d.slot, sum(d.item_value) as total
    from public.case_battle_drops d
    where d.battle_id = p_battle_id
    group by d.slot;

  select coalesce(sum(total), 0) into v_total_drops from _slot_totals;
  if v_total_drops = 0 then
    drop table if exists _slot_totals;
    raise exception 'No drops found for this battle';
  end if;

  v_keep_mult := (100 - v_battle.borrow_percent) / 100.0;
  v_winner_slot := -1;
  v_winner_slots := ARRAY[]::int[];

  if v_battle.gamemode in ('standard', 'terminal', 'jackpot') then
    -- Standard/Terminal/Jackpot: highest wins; crazy flips to lowest.
    if v_battle.crazy then
      select slot into v_winner_slot from _slot_totals order by total asc, slot asc limit 1;
    else
      select slot into v_winner_slot from _slot_totals order by total desc, slot asc limit 1;
    end if;
    v_winner_slots := ARRAY[v_winner_slot];

  elsif v_battle.gamemode = 'group' then
    -- Group: split slots into two equal halves; team with higher total wins.
    -- Winning team splits the pot proportional to each member's drop value.
    select max(slot) into v_half from _slot_totals;
    v_half := (v_half + 1) / 2;
    for v_row in select * from _slot_totals loop
      if v_row.slot < v_half then
        v_group_a := v_group_a + v_row.total;
      else
        v_group_b := v_group_b + v_row.total;
      end if;
    end loop;
    if v_group_a >= v_group_b then
      select array_agg(slot) into v_winner_slots from _slot_totals where slot < v_half;
    else
      select array_agg(slot) into v_winner_slots from _slot_totals where slot >= v_half;
    end if;
  end if;

  if not (p_slot = any(v_winner_slots)) then
    drop table if exists _slot_totals;
    raise exception 'You did not win this battle';
  end if;

  if v_battle.gamemode = 'group' then
    select coalesce(sum(total), 0) into v_total from _slot_totals where slot = any(v_winner_slots);
    select coalesce(total, 0) into v_my_total from _slot_totals where slot = p_slot;
    v_payout := round(v_total_drops * (v_my_total / nullif(v_total, 0)) * v_keep_mult, 2);
  else
    v_payout := round(v_total_drops * v_keep_mult, 2);
  end if;

  drop table if exists _slot_totals;

  perform public.bypass_profile_balance_guard();
  if v_battle.coin_type = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles set sweeps_coins = v_balance, total_wins = total_wins + v_payout, updated_at = now() where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles set balance = v_balance, total_wins = total_wins + v_payout, updated_at = now() where id = v_uid;
  end if;

  update public.case_battle_players set claimed_at = now() where battle_id = p_battle_id and slot = p_slot;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (v_uid, 'win', v_payout, v_balance, 'Case Battle payout (slot ' || p_slot || ', ' || v_battle.gamemode || ')', now());

  return v_balance;
end;
$$;
revoke all on function public.cb_claim_payout(uuid,int,numeric) from public;
grant execute on function public.cb_claim_payout(uuid,int,numeric) to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 11: UNIQUE constraint on profiles.discord_id (backstop for link-discord)
-- ────────────────────────────────────────────────────────────────────────────
drop index if exists profiles_discord_id_unique_idx;
create unique index profiles_discord_id_unique_idx
  on public.profiles (discord_id)
  where discord_id is not null;


-- ────────────────────────────────────────────────────────────────────────────
-- FIX 12: Performance indexes
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists profiles_total_wagered_idx
  on public.profiles (total_wagered desc);

create index if not exists transactions_type_amount_idx
  on public.transactions (type, amount desc);

create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);

create index if not exists crash_bets_open_bets_idx
  on public.crash_bets (created_at)
  where won = false and completed_at is null;


commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- End of migration 001_audit_fixes.sql
-- ══════════════════════════════════════════════════════════════════════════════
