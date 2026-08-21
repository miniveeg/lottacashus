-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — 012_sitewide_sc_and_rpc_fixes.sql
--
-- ONE SCRIPT to stabilize the whole site after the dual-currency → SC-only
-- migration. Safe to re-run (idempotent CREATE OR REPLACE / IF NOT EXISTS).
--
-- What this fixes:
--   • Auth / signup / login profile creation (ensure_user_profile, handle_new_auth_user)
--   • All game debits & credits always hit sweeps_coins (even if client sends "balance")
--   • Admin credit / deposit credit always SC
--   • One-time merge of leftover GC (balance) into SC
--   • Self-exclusion + admin helpers + critical grants / RLS
--
-- Apply in Supabase SQL Editor (or: supabase db push / migration run).
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists pgcrypto with schema extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Balance-guard bypass (required by every balance write)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.bypass_profile_balance_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Session-local flag read by profiles_prevent_balance_change trigger.
  perform set_config('lottacash.bypass_balance_guard', '1', true);
end;
$$;

revoke all on function public.bypass_profile_balance_guard() from public;
grant execute on function public.bypass_profile_balance_guard() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. One-time: fold leftover Gold Coins into SC, then zero GC
--    (If a user already had only SC, this is a no-op.)
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'balance'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'sweeps_coins'
  ) then
    perform public.bypass_profile_balance_guard();
    update public.profiles
    set
      sweeps_coins = coalesce(sweeps_coins, 0) + coalesce(balance, 0),
      balance = 0,
      updated_at = now()
    where coalesce(balance, 0) <> 0;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Normalize any coin_type argument → always 'sweeps_coins'
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.normalize_coin_type(p_coin_type text)
returns text
language sql
immutable
as $$
  select 'sweeps_coins'::text;
$$;

comment on function public.normalize_coin_type(text) is
  'Single-balance mode: every coin type resolves to sweeps_coins (SC).';

revoke all on function public.normalize_coin_type(text) from public;
grant execute on function public.normalize_coin_type(text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. game_debit / game_credit — ALWAYS sweeps_coins
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.game_debit(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text default 'sweeps_coins'
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12, 2) := round(p_amount::numeric, 2);
  v_current numeric(12, 2);
  v_new numeric(12, 2);
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Debit amount must be positive.';
  end if;

  -- Self-exclusion gate (if helper exists)
  begin
    perform public.reject_if_self_excluded(p_user_id);
  exception
    when undefined_function then null;
  end;

  select sweeps_coins into v_current
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found.';
  end if;

  if v_current < v_amount then
    raise exception 'Insufficient balance.';
  end if;

  v_new := v_current - v_amount;

  perform public.bypass_profile_balance_guard();
  update public.profiles
  set
    sweeps_coins = v_new,
    total_wagered = coalesce(total_wagered, 0) + v_amount,
    updated_at = now()
  where id = p_user_id;

  out_balance := v_new;
  return next;
end;
$$;

create or replace function public.game_credit(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text default 'sweeps_coins'
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12, 2) := round(coalesce(p_amount, 0)::numeric, 2);
  v_new numeric(12, 2);
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_amount < 0 then
    raise exception 'Credit amount cannot be negative.';
  end if;

  if v_amount = 0 then
    select sweeps_coins into v_new from public.profiles where id = p_user_id;
    out_balance := coalesce(v_new, 0);
    return next;
    return;
  end if;

  perform public.bypass_profile_balance_guard();
  update public.profiles
  set
    sweeps_coins = sweeps_coins + v_amount,
    total_wins = coalesce(total_wins, 0) + v_amount,
    updated_at = now()
  where id = p_user_id
  returning sweeps_coins into v_new;

  if not found then
    raise exception 'Profile not found.';
  end if;

  out_balance := v_new;
  return next;
end;
$$;

revoke all on function public.game_debit(uuid, numeric, text) from public;
revoke all on function public.game_credit(uuid, numeric, text) from public;
grant execute on function public.game_debit(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.game_credit(uuid, numeric, text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. ensure_user_profile — SC-only welcome; safe for login/signup paths
-- ────────────────────────────────────────────────────────────────────────────
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
  v_welcome_sc numeric(12, 2) := 100; -- starter SC for brand-new accounts
begin
  if v_uid is null then
    return null;
  end if;

  select * into v_row from public.profiles where id = v_uid;
  if found then
    return to_jsonb(v_row);
  end if;

  select
    coalesce(nullif(trim(raw_user_meta_data->>'username'), ''), null),
    coalesce(email, '')
  into v_username, v_email
  from auth.users
  where id = v_uid;

  perform public.bypass_profile_balance_guard();

  insert into public.profiles (
    id, email, username, balance, sweeps_coins, created_at, updated_at
  )
  values (
    v_uid,
    v_email,
    v_username,
    0,              -- GC gone
    v_welcome_sc,   -- SC only
    now(),
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Auth trigger — new users get SC only (no GC dump)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_welcome_sc numeric(12, 2) := 100;
begin
  v_username := nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), '');

  perform public.bypass_profile_balance_guard();

  insert into public.profiles (
    id, email, username, balance, sweeps_coins, created_at, updated_at
  )
  values (
    new.id,
    coalesce(new.email, ''),
    v_username,
    0,
    v_welcome_sc,
    now(),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Admin helpers
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

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
end;
$$;

revoke all on function public.is_current_user_admin() from public;
revoke all on function public.require_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated, service_role;
grant execute on function public.require_admin() to authenticated, service_role;

-- Admin credit: always SC (accepts legacy coin_type args, ignores them)
create or replace function public.admin_credit_user(
  p_user_id uuid,
  p_amount numeric,
  p_note text default null,
  p_coin_type text default 'sweeps_coins'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12, 2) := round(p_amount::numeric, 2);
  v_new numeric(12, 2);
begin
  perform public.require_admin();

  if p_user_id is null then
    raise exception 'User id required.';
  end if;
  if v_amount is null or v_amount = 0 then
    raise exception 'Amount must be non-zero.';
  end if;

  perform public.bypass_profile_balance_guard();

  if v_amount > 0 then
    update public.profiles
    set sweeps_coins = sweeps_coins + v_amount,
        updated_at = now()
    where id = p_user_id
    returning sweeps_coins into v_new;
  else
    update public.profiles
    set sweeps_coins = greatest(0, sweeps_coins + v_amount),
        updated_at = now()
    where id = p_user_id
    returning sweeps_coins into v_new;
  end if;

  if not found then
    raise exception 'User profile not found.';
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id,
    case when v_amount > 0 then 'admin_credit' else 'admin_debit' end,
    abs(v_amount),
    v_new,
    coalesce(nullif(trim(p_note), ''), 'Admin adjustment') || ' (SC)'
  );
end;
$$;

revoke all on function public.admin_credit_user(uuid, numeric, text, text) from public;
grant execute on function public.admin_credit_user(uuid, numeric, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Crypto deposit credit — SC only @ 100 SC / $1
-- ────────────────────────────────────────────────────────────────────────────
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
  new_sc numeric(12, 2);
  sc_amount numeric(12, 2);
  v_daily_limit numeric(12, 2);
  v_weekly_limit numeric(12, 2);
  v_today_total numeric(12, 2);
  v_week_total numeric(12, 2);
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  select daily_deposit_limit, weekly_deposit_limit
    into v_daily_limit, v_weekly_limit
    from public.profiles where id = p_user_id;

  if v_daily_limit is not null then
    select coalesce(sum(usd_amount), 0) into v_today_total
      from public.crypto_deposits
      where user_id = p_user_id
        and status in ('credited', 'swept')
        and coalesce(credited_at, created_at) >= date_trunc('day', now())
        and id <> p_deposit_id;
    if v_today_total + p_usd_amount > v_daily_limit then
      update public.crypto_deposits
        set status = 'confirmed', credited_at = null
        where id = p_deposit_id;
      raise exception
        'Daily deposit limit ($%) reached. This deposit was not credited.',
        v_daily_limit;
    end if;
  end if;

  if v_weekly_limit is not null then
    select coalesce(sum(usd_amount), 0) into v_week_total
      from public.crypto_deposits
      where user_id = p_user_id
        and status in ('credited', 'swept')
        and coalesce(credited_at, created_at) >= date_trunc('week', now())
        and id <> p_deposit_id;
    if v_week_total + p_usd_amount > v_weekly_limit then
      update public.crypto_deposits
        set status = 'confirmed', credited_at = null
        where id = p_deposit_id;
      raise exception
        'Weekly deposit limit ($%) reached. This deposit was not credited.',
        v_weekly_limit;
    end if;
  end if;

  sc_amount := round(p_usd_amount * 100, 2);

  perform public.bypass_profile_balance_guard();

  update public.profiles
  set
    sweeps_coins = sweeps_coins + sc_amount,
    total_deposited = coalesce(total_deposited, 0) + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning sweeps_coins into new_sc;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id,
    'deposit',
    sc_amount,
    new_sc,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '… — ' || sc_amount || ' SC'
  );
end;
$$;

revoke all on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) from public;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Self-exclusion helpers (used by games + settings)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.check_user_self_exclusion(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.self_exclusions
    where user_id = p_user_id
      and expires_at > now()
  );
$$;

create or replace function public.reject_if_self_excluded(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.check_user_self_exclusion(p_user_id) then
    raise exception 'Your account is self-excluded.';
  end if;
end;
$$;

revoke all on function public.check_user_self_exclusion(uuid) from public;
revoke all on function public.reject_if_self_excluded(uuid) from public;
grant execute on function public.check_user_self_exclusion(uuid) to authenticated, service_role;
grant execute on function public.reject_if_self_excluded(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Soften coin_type CHECKs so legacy "balance" rows still insert
--     (functions already force SC wallet regardless)
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'c'
      and a.attname = 'coin_type'
      and c.conrelid::regclass::text like 'public.%'
  loop
    begin
      execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
    exception when others then
      raise notice 'Could not drop % on %: %', r.conname, r.tbl, sqlerrm;
    end;
  end loop;
end $$;

-- Re-add permissive checks (balance kept only for historical row compatibility)
do $$
declare
  t text;
begin
  foreach t in array array[
    'keno_bets','mines_games','limbo_bets','roulette_bets',
    'blackjack_hands','crash_bets','slots_spins','case_battles',
    'case_battle_entries','transactions'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'coin_type'
    ) then
      begin
        execute format(
          'alter table public.%I add constraint %I check (coin_type in (''balance'',''sweeps_coins''))',
          t, t || '_coin_type_check'
        );
      exception
        when duplicate_object then null;
        when others then
          raise notice 'coin_type check on %: %', t, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Grants on common placers / readers (ignore if function missing)
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  fn text;
  sigs text[] := array[
    'place_keno_bet',
    'place_limbo_bet',
    'place_roulette_bet',
    'place_slots_bet',
    'place_mines_bet',
    'place_blackjack_bet',
    'place_crash_bet',
    'cash_out_crash',
    'mines_reveal_tile',
    'mines_cashout',
    'get_my_active_mines_game',
    'get_active_mines_game',
    'set_keno_client_seed',
    'set_mines_client_seed',
    'set_limbo_client_seed',
    'set_roulette_client_seed',
    'set_slots_client_seed',
    'set_blackjack_client_seed',
    'set_crash_client_seed',
    'get_deposit_address',
    'request_sc_redemption',
    'list_pending_redemptions',
    'admin_process_redemption',
    'self_exclude',
    'set_deposit_limits',
    'submit_affiliate_referral_code',
    'cb_create_battle',
    'cb_join_battle',
    'cb_leave_battle',
    'cb_claim_payout',
    'cb_add_bot'
  ];
begin
  foreach fn in array sigs
  loop
    begin
      execute format(
        'grant execute on function public.%I to authenticated, service_role',
        fn
      );
    exception when undefined_function then
      raise notice 'skip grant (missing): %', fn;
    when others then
      -- Overloaded names: grant all overloads
      begin
        execute format(
          'grant execute on all functions in schema public to authenticated'
        );
      exception when others then null;
      end;
      raise notice 'grant note for %: %', fn, sqlerrm;
    end;
  end loop;
end $$;

-- Broader safety net: authenticated can execute RPCs they need
grant usage on schema public to authenticated, anon, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. RLS — profiles readable by owner; signup codes locked down
-- ────────────────────────────────────────────────────────────────────────────
alter table if exists public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_current_user_admin());

drop policy if exists "profiles_update_own_username" on public.profiles;
create policy "profiles_update_own_username"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Signup verification codes: no direct client access (edge functions only)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'signup_verification_codes'
  ) then
    execute 'alter table public.signup_verification_codes enable row level security';
    execute 'drop policy if exists "deny all signup codes" on public.signup_verification_codes';
    execute $p$
      create policy "deny all signup codes"
        on public.signup_verification_codes
        for all
        to authenticated, anon
        using (false)
        with check (false)
    $p$;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. Default coin_type column defaults → sweeps_coins where present
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'keno_bets','mines_games','limbo_bets','roulette_bets',
    'blackjack_hands','crash_bets','slots_spins'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'coin_type'
    ) then
      begin
        execute format(
          'alter table public.%I alter column coin_type set default %L',
          t, 'sweeps_coins'
        );
      exception when others then
        raise notice 'default coin_type on %: %', t, sqlerrm;
      end;
    end if;
  end loop;
end $$;

commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- POSTCHECK (run manually after apply):
--
--   select public.normalize_coin_type('balance');           -- → sweeps_coins
--   select public.is_current_user_admin();
--   select public.ensure_user_profile();
--   select id, balance, sweeps_coins from public.profiles limit 5;
--     -- balance should be 0; funds live in sweeps_coins
-- ══════════════════════════════════════════════════════════════════════════════
