-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — FIX_EVERYTHING.sql
--
-- Paste this ENTIRE file into Supabase → SQL Editor → Run.
-- Safe on an already-populated database. Drops conflicting function signatures
-- first so PostgreSQL never errors with "cannot change return type".
--
-- Covers:
--   • SC-only wallet (game_debit / game_credit / deposits / admin credit)
--   • Signup + login profile creation (ensure_user_profile, auth trigger)
--   • Merge leftover GC into SC
--   • Admin / self-exclusion helpers + grants + RLS
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. DROP every function this script recreates (all known signatures)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.bypass_profile_balance_guard() cascade;
drop function if exists public.normalize_coin_type(text) cascade;

drop function if exists public.game_debit(uuid, numeric, text) cascade;
drop function if exists public.game_debit(uuid, numeric) cascade;
drop function if exists public.game_credit(uuid, numeric, text) cascade;
drop function if exists public.game_credit(uuid, numeric) cascade;

drop function if exists public.ensure_user_profile() cascade;
drop function if exists public.handle_new_auth_user() cascade;

drop function if exists public.is_current_user_admin() cascade;
drop function if exists public.require_admin() cascade;

drop function if exists public.admin_credit_user(uuid, numeric, text, text) cascade;
drop function if exists public.admin_credit_user(uuid, numeric, text) cascade;
drop function if exists public.admin_credit_user(uuid, numeric) cascade;

drop function if exists public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) cascade;

drop function if exists public.check_user_self_exclusion(uuid) cascade;
drop function if exists public.reject_if_self_excluded(uuid) cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Balance-guard bypass
-- ─────────────────────────────────────────────────────────────────────────────
create function public.bypass_profile_balance_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('lottacash.bypass_balance_guard', '1', true);
end;
$$;

revoke all on function public.bypass_profile_balance_guard() from public;
grant execute on function public.bypass_profile_balance_guard() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Merge leftover GC → SC, then zero GC
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Coin-type normalizer (always SC)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.normalize_coin_type(p_coin_type text)
returns text
language sql
immutable
as $$
  select 'sweeps_coins'::text;
$$;

revoke all on function public.normalize_coin_type(text) from public;
grant execute on function public.normalize_coin_type(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. game_debit / game_credit — ALWAYS sweeps_coins
-- ─────────────────────────────────────────────────────────────────────────────
create function public.game_debit(
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

create function public.game_credit(
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

-- ─────────────────────────────────────────────────────────────────────────────
-- F. ensure_user_profile (login/signup) — SC only, 100 SC welcome
-- ─────────────────────────────────────────────────────────────────────────────
create function public.ensure_user_profile()
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
  v_welcome_sc numeric(12, 2) := 100;
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
    0,
    v_welcome_sc,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Auth trigger — new users get SC only
-- ─────────────────────────────────────────────────────────────────────────────
create function public.handle_new_auth_user()
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

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Admin helpers
-- ─────────────────────────────────────────────────────────────────────────────
create function public.is_current_user_admin()
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

create function public.require_admin()
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

-- Admin credit: ALWAYS SC. Keeps admin_credit_log when that table exists.
create function public.admin_credit_user(
  p_user_id uuid,
  p_amount numeric,
  p_note text default 'Admin credit',
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
  if abs(v_amount) > 1000000 then
    raise exception 'Amount exceeds the per-call limit (1,000,000).';
  end if;

  perform public.bypass_profile_balance_guard();

  update public.profiles
  set
    sweeps_coins = greatest(0, sweeps_coins + v_amount),
    updated_at = now()
  where id = p_user_id
  returning sweeps_coins into v_new;

  if not found then
    raise exception 'User not found.';
  end if;

  -- Preferred audit table (legacy)
  begin
    insert into public.admin_credit_log (user_id, amount, note, created_by, coin_type)
    values (p_user_id, v_amount, coalesce(p_note, 'Admin credit'), auth.uid(), 'sweeps_coins');
  exception
    when undefined_table then
      insert into public.transactions (user_id, type, amount, balance_after, description)
      values (
        p_user_id,
        case when v_amount > 0 then 'admin_credit' else 'admin_debit' end,
        abs(v_amount),
        v_new,
        coalesce(nullif(trim(p_note), ''), 'Admin adjustment') || ' (SC)'
      );
    when others then
      -- column mismatch on admin_credit_log — fall back to transactions
      begin
        insert into public.transactions (user_id, type, amount, balance_after, description)
        values (
          p_user_id,
          case when v_amount > 0 then 'admin_credit' else 'admin_debit' end,
          abs(v_amount),
          v_new,
          coalesce(nullif(trim(p_note), ''), 'Admin adjustment') || ' (SC)'
        );
      exception when others then
        null; -- credit still applied even if audit insert fails
      end;
  end;
end;
$$;

revoke all on function public.admin_credit_user(uuid, numeric, text, text) from public;
grant execute on function public.admin_credit_user(uuid, numeric, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Crypto deposits → SC only (100 SC per $1)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.credit_crypto_deposit(
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
      raise exception 'Daily deposit limit ($%) reached. This deposit was not credited.', v_daily_limit;
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
      raise exception 'Weekly deposit limit ($%) reached. This deposit was not credited.', v_weekly_limit;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- J. Self-exclusion
-- ─────────────────────────────────────────────────────────────────────────────
create function public.check_user_self_exclusion(p_user_id uuid)
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

create function public.reject_if_self_excluded(p_user_id uuid)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- K. Default coin_type → sweeps_coins on game tables
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- L. RLS basics
-- ─────────────────────────────────────────────────────────────────────────────
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
        on public.signup_verification_codes for all
        to authenticated, anon
        using (false) with check (false)
    $p$;
  end if;
end $$;

grant usage on schema public to authenticated, anon, service_role;

commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- Verify (optional):
--   select public.normalize_coin_type('balance');
--   select id, balance, sweeps_coins from public.profiles limit 10;
-- ══════════════════════════════════════════════════════════════════════════════
