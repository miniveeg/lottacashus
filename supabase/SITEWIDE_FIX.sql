-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — SITEWIDE_FIX.sql
--
-- ONE script for the whole site: login/signup, games, deposit/withdraw, admin.
-- Safe to re-run. Drops conflicting function signatures before recreate.
--
-- Supabase → SQL Editor → paste all → Run.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

create extension if not exists pgcrypto with schema extensions;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — Tables the app expects
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.game_pf_seeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  server_seed text not null,
  server_seed_hash text not null,
  client_seed text not null default 'default',
  next_nonce bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.self_exclusions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sc_amount numeric(12,2) not null,
  usd_amount numeric(12,2) not null,
  chain text not null,
  destination_address text not null,
  status text not null default 'pending',
  tx_hash text,
  error_message text,
  processed_by uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  amount numeric(12,2) not null default 0,
  balance_after numeric(12,2),
  description text,
  created_at timestamptz not null default now()
);

-- profiles columns the app reads
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles is missing — apply base schema first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='sweeps_coins') then
    alter table public.profiles add column sweeps_coins numeric(12,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='balance') then
    alter table public.profiles add column balance numeric(12,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_admin') then
    alter table public.profiles add column is_admin boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='self_excluded_until') then
    alter table public.profiles add column self_excluded_until timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='daily_deposit_limit') then
    alter table public.profiles add column daily_deposit_limit numeric(12,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='weekly_deposit_limit') then
    alter table public.profiles add column weekly_deposit_limit numeric(12,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='total_wagered') then
    alter table public.profiles add column total_wagered numeric(14,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='total_deposited') then
    alter table public.profiles add column total_deposited numeric(14,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='total_withdrawn') then
    alter table public.profiles add column total_withdrawn numeric(14,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='total_wins') then
    alter table public.profiles add column total_wins numeric(14,2) not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='total_losses') then
    alter table public.profiles add column total_losses numeric(14,2) not null default 0;
  end if;
end $$;

-- crypto_deposits / crypto_withdrawals column compat (FINAL vs complete-setup)
do $$
begin
  if to_regclass('public.crypto_deposits') is not null then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='usd_amount') then
      alter table public.crypto_deposits add column usd_amount numeric(12,2);
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='expected_amount') then
        execute 'update public.crypto_deposits set usd_amount = coalesce(usd_amount, expected_amount, 0)';
      elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='credited') then
        execute 'update public.crypto_deposits set usd_amount = coalesce(usd_amount, credited, 0)';
      end if;
      update public.crypto_deposits set usd_amount = 0 where usd_amount is null;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='crypto_amount') then
      alter table public.crypto_deposits add column crypto_amount numeric(24,12) default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='tx_hash') then
      alter table public.crypto_deposits add column tx_hash text;
    end if;
  end if;

  if to_regclass('public.crypto_withdrawals') is not null then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='usd_amount') then
      alter table public.crypto_withdrawals add column usd_amount numeric(12,2);
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='amount') then
        execute 'update public.crypto_withdrawals set usd_amount = coalesce(usd_amount, amount, 0)';
      end if;
      update public.crypto_withdrawals set usd_amount = 0 where usd_amount is null;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='destination_address') then
      alter table public.crypto_withdrawals add column destination_address text default '';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='error_message') then
      alter table public.crypto_withdrawals add column error_message text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='created_at') then
      alter table public.crypto_withdrawals add column created_at timestamptz not null default now();
    end if;
  end if;
end $$;

-- Merge leftover GC → SC
do $$
begin
  perform set_config('lottacash.bypass_balance_guard', '1', true);
  update public.profiles
  set sweeps_coins = coalesce(sweeps_coins,0) + coalesce(balance,0),
      balance = 0,
      updated_at = now()
  where coalesce(balance,0) <> 0;
exception when others then
  raise notice 'GC merge skipped: %', sqlerrm;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — Core helpers
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.bypass_profile_balance_guard() cascade;
create function public.bypass_profile_balance_guard()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lottacash.bypass_balance_guard', '1', true);
end; $$;
grant execute on function public.bypass_profile_balance_guard() to authenticated, service_role;

drop function if exists public.is_current_user_admin() cascade;
create function public.is_current_user_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_current_user_admin() to authenticated, service_role;

drop function if exists public.require_admin() cascade;
create function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_current_user_admin() then raise exception 'Admin only.'; end if;
end; $$;
grant execute on function public.require_admin() to authenticated, service_role;

drop function if exists public.check_user_self_exclusion(uuid) cascade;
create function public.check_user_self_exclusion(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.self_exclusions
    where user_id = p_user_id and expires_at > now()
  ) or exists (
    select 1 from public.profiles
    where id = p_user_id and self_excluded_until is not null and self_excluded_until > now()
  );
$$;
grant execute on function public.check_user_self_exclusion(uuid) to authenticated, service_role;

drop function if exists public.reject_if_self_excluded(uuid) cascade;
create function public.reject_if_self_excluded(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.check_user_self_exclusion(p_user_id) then
    raise exception 'Your account is self-excluded.';
  end if;
end; $$;
grant execute on function public.reject_if_self_excluded(uuid) to authenticated, service_role;

-- SC-only debit/credit
drop function if exists public.game_debit(uuid, numeric, text) cascade;
create function public.game_debit(p_user_id uuid, p_amount numeric, p_coin_type text default 'sweeps_coins')
returns table (out_balance numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_amt numeric(12,2) := round(p_amount::numeric, 2);
  v_cur numeric(12,2);
  v_new numeric(12,2);
begin
  if p_user_id is null then raise exception 'Not authenticated'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Debit amount must be positive.'; end if;
  perform public.reject_if_self_excluded(p_user_id);
  select sweeps_coins into v_cur from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile not found.'; end if;
  if v_cur < v_amt then raise exception 'Insufficient balance.'; end if;
  v_new := v_cur - v_amt;
  perform public.bypass_profile_balance_guard();
  update public.profiles set sweeps_coins = v_new,
    total_wagered = coalesce(total_wagered,0) + v_amt, updated_at = now()
  where id = p_user_id;
  out_balance := v_new; return next;
end; $$;
grant execute on function public.game_debit(uuid, numeric, text) to authenticated, service_role;

drop function if exists public.game_credit(uuid, numeric, text) cascade;
create function public.game_credit(p_user_id uuid, p_amount numeric, p_coin_type text default 'sweeps_coins')
returns table (out_balance numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_amt numeric(12,2) := round(coalesce(p_amount,0)::numeric, 2);
  v_new numeric(12,2);
begin
  if p_user_id is null then raise exception 'Not authenticated'; end if;
  if v_amt < 0 then raise exception 'Credit amount cannot be negative.'; end if;
  if v_amt = 0 then
    select sweeps_coins into v_new from public.profiles where id = p_user_id;
    out_balance := coalesce(v_new,0); return next; return;
  end if;
  perform public.bypass_profile_balance_guard();
  update public.profiles set sweeps_coins = sweeps_coins + v_amt,
    total_wins = coalesce(total_wins,0) + v_amt, updated_at = now()
  where id = p_user_id returning sweeps_coins into v_new;
  if not found then raise exception 'Profile not found.'; end if;
  out_balance := v_new; return next;
end; $$;
grant execute on function public.game_credit(uuid, numeric, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — Login / signup profile
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.ensure_user_profile() cascade;
create function public.ensure_user_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_email text;
  v_row public.profiles%rowtype;
begin
  if v_uid is null then return null; end if;
  select * into v_row from public.profiles where id = v_uid;
  if found then return to_jsonb(v_row); end if;

  select coalesce(nullif(trim(raw_user_meta_data->>'username'),''), null),
         coalesce(email,'')
    into v_username, v_email from auth.users where id = v_uid;

  perform public.bypass_profile_balance_guard();
  insert into public.profiles (id, email, username, balance, sweeps_coins, created_at, updated_at)
  values (v_uid, v_email, v_username, 0, 100, now(), now())
  on conflict (id) do update set email = excluded.email, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.ensure_user_profile() to authenticated, service_role;

drop function if exists public.handle_new_auth_user() cascade;
create function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  v_username := nullif(trim(coalesce(new.raw_user_meta_data->>'username','')), '');
  perform public.bypass_profile_balance_guard();
  insert into public.profiles (id, email, username, balance, sweeps_coins, created_at, updated_at)
  values (new.id, coalesce(new.email,''), v_username, 0, 100, now(), now())
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 — Provably-fair helpers (all games)
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.ensure_game_pf_seeds(uuid) cascade;
create function public.ensure_game_pf_seeds(p_user_id uuid)
returns public.game_pf_seeds
language plpgsql security definer set search_path = public, extensions as $$
declare
  row public.game_pf_seeds;
  new_seed text;
begin
  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if found then return row; end if;
  new_seed := encode(gen_random_bytes(32), 'hex');
  insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
  values (p_user_id, new_seed, encode(digest(new_seed, 'sha256'), 'hex'), 'default', 0)
  returning * into row;
  return row;
end; $$;
grant execute on function public.ensure_game_pf_seeds(uuid) to authenticated, service_role;

-- Shared PF getter/setter for every original
do $$
declare
  g text;
  games text[] := array[
    'keno','mines','limbo','roulette','slots','blackjack','crash','case_battle'
  ];
begin
  foreach g in array games loop
    execute format('drop function if exists public.get_%s_pf_state() cascade', g);
    execute format($f$
      create function public.get_%s_pf_state()
      returns table (server_seed_hash text, client_seed text, next_nonce bigint)
      language plpgsql security definer set search_path = public, extensions as $body$
      declare
        uid uuid := auth.uid();
        row public.game_pf_seeds;
      begin
        if uid is null then raise exception 'Not authenticated'; end if;
        row := public.ensure_game_pf_seeds(uid);
        return query select row.server_seed_hash, row.client_seed, row.next_nonce;
      end;
      $body$;
      grant execute on function public.get_%s_pf_state() to authenticated;
    $f$, g, g);

    execute format('drop function if exists public.set_%s_client_seed(text) cascade', g);
    execute format($f$
      create function public.set_%s_client_seed(p_client_seed text)
      returns void
      language plpgsql security definer set search_path = public, extensions as $body$
      declare
        uid uuid := auth.uid();
      begin
        if uid is null then raise exception 'Not authenticated'; end if;
        if length(trim(coalesce(p_client_seed,''))) = 0 then
          raise exception 'Client seed cannot be empty';
        end if;
        if length(p_client_seed) > 64 then
          raise exception 'Client seed too long (max 64 characters)';
        end if;
        perform public.ensure_game_pf_seeds(uid);
        update public.game_pf_seeds
          set client_seed = trim(p_client_seed), updated_at = now()
        where user_id = uid;
      end;
      $body$;
      grant execute on function public.set_%s_client_seed(text) to authenticated;
    $f$, g, g);
  end loop;
end $$;

-- Mines active game (returns empty set when none — avoids frontend crash)
drop function if exists public.get_my_active_mines_game() cascade;
create function public.get_my_active_mines_game()
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  coin_type text
)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if to_regclass('public.mines_games') is null then return; end if;
  return query execute $q$
    select g.id, g.wager, g.mine_count,
           coalesce(g.revealed_tiles, '{}'::int[]),
           coalesce(g.gems_revealed, 0),
           coalesce(g.multiplier, 1),
           coalesce(g.coin_type, 'sweeps_coins')
    from public.mines_games g
    where g.user_id = auth.uid() and g.status = 'active'
    order by g.created_at desc
    limit 1
  $q$;
exception when others then
  return; -- soft-fail if column names differ
end; $$;
grant execute on function public.get_my_active_mines_game() to authenticated;

-- crash_bets_safe view (crash page reads this)
do $$
begin
  if to_regclass('public.crash_bets') is not null then
    execute $v$
      create or replace view public.crash_bets_safe as
      select id, user_id, wager, crash_point, won, payout, coin_type, nonce, created_at
      from public.crash_bets
    $v$;
    grant select on public.crash_bets_safe to authenticated;
  end if;
exception when others then
  raise notice 'crash_bets_safe: %', sqlerrm;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 5 — Wallet / settings / RG
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.check_self_exclusion() cascade;
create function public.check_self_exclusion()
returns table (excluded boolean, excluded_until timestamptz, remaining_days int)
language plpgsql security definer set search_path = public as $$
declare
  excl_until timestamptz;
  days_left int;
begin
  select self_excluded_until into excl_until from public.profiles where id = auth.uid();
  if excl_until is null or excl_until < clock_timestamp() then
    -- also check self_exclusions table
    select max(expires_at) into excl_until from public.self_exclusions
      where user_id = auth.uid() and expires_at > now();
  end if;
  if excl_until is null or excl_until < clock_timestamp() then
    return query select false, null::timestamptz, 0::int;
  else
    days_left := ceil(extract(epoch from (excl_until - clock_timestamp())) / 86400)::int;
    return query select true, excl_until, days_left;
  end if;
end; $$;
grant execute on function public.check_self_exclusion() to authenticated;

drop function if exists public.self_exclude(int) cascade;
create function public.self_exclude(p_days int)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  until_ts timestamptz;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_days not in (1, 7, 30, 90, 180, 365) and p_days < 1 then
    raise exception 'Invalid self-exclusion duration.';
  end if;
  until_ts := now() + make_interval(days => p_days);
  perform public.bypass_profile_balance_guard();
  update public.profiles set self_excluded_until = until_ts, updated_at = now() where id = uid;
  insert into public.self_exclusions (user_id, expires_at) values (uid, until_ts);
end; $$;
grant execute on function public.self_exclude(int) to authenticated;

drop function if exists public.get_deposit_limits() cascade;
create function public.get_deposit_limits()
returns table (daily_limit numeric, weekly_limit numeric)
language plpgsql security definer set search_path = public as $$
begin
  return query
  select p.daily_deposit_limit, p.weekly_deposit_limit
  from public.profiles p where p.id = auth.uid();
end; $$;
grant execute on function public.get_deposit_limits() to authenticated;

drop function if exists public.set_deposit_limits(numeric, numeric) cascade;
create function public.set_deposit_limits(p_daily_limit numeric default null, p_weekly_limit numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_daily_limit is null and p_weekly_limit is null then
    raise exception 'At least one limit must be provided.';
  end if;
  perform public.bypass_profile_balance_guard();
  update public.profiles set
    daily_deposit_limit = case
      when daily_deposit_limit is not null and p_daily_limit is not null and p_daily_limit > daily_deposit_limit
        then daily_deposit_limit
      when p_daily_limit is null then daily_deposit_limit
      else p_daily_limit end,
    weekly_deposit_limit = case
      when weekly_deposit_limit is not null and p_weekly_limit is not null and p_weekly_limit > weekly_deposit_limit
        then weekly_deposit_limit
      when p_weekly_limit is null then weekly_deposit_limit
      else p_weekly_limit end,
    updated_at = now()
  where id = auth.uid();
end; $$;
grant execute on function public.set_deposit_limits(numeric, numeric) to authenticated;

drop function if exists public.request_sc_redemption(numeric, text, text) cascade;
create function public.request_sc_redemption(p_sc_amount numeric, p_chain text, p_destination text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  current_sc numeric(12,2);
  usd_val numeric(12,2);
  rid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_sc_amount is null or p_sc_amount < 100 then
    raise exception 'Minimum redemption is 100 SC.';
  end if;
  if p_chain not in ('sol','ltc','eth','SOL','LTC','ETH') then
    raise exception 'Unsupported chain.';
  end if;
  if public.check_user_self_exclusion(uid) then
    raise exception 'Your account is self-excluded.';
  end if;
  usd_val := round(p_sc_amount / 100.0, 2); -- 100 SC = $1
  select sweeps_coins into current_sc from public.profiles where id = uid for update;
  if current_sc is null or current_sc < p_sc_amount then
    raise exception 'Insufficient Sweeps Coins balance';
  end if;
  perform public.bypass_profile_balance_guard();
  update public.profiles set
    sweeps_coins = sweeps_coins - p_sc_amount,
    total_withdrawn = coalesce(total_withdrawn,0) + usd_val,
    updated_at = now()
  where id = uid;
  insert into public.redemptions (user_id, sc_amount, usd_amount, chain, destination_address, status)
  values (uid, p_sc_amount, usd_val, lower(p_chain), trim(p_destination), 'pending')
  returning id into rid;
  begin
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (uid, 'redemption', -usd_val, current_sc - p_sc_amount,
            upper(p_chain) || ' SC redemption');
  exception when others then null;
  end;
  return rid;
end; $$;
grant execute on function public.request_sc_redemption(numeric, text, text) to authenticated;

drop function if exists public.get_user_transactions(int, int) cascade;
drop function if exists public.get_user_transactions(integer, integer) cascade;
create function public.get_user_transactions(p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, type text, amount numeric, balance_after numeric,
  description text, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  select t.id, t.type, t.amount, t.balance_after, t.description, t.created_at
  from public.transactions t
  where t.user_id = auth.uid()
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit,50), 100))
  offset greatest(0, coalesce(p_offset,0));
end; $$;
grant execute on function public.get_user_transactions(int, int) to authenticated;

drop function if exists public.get_user_wager_levels(uuid[]) cascade;
create function public.get_user_wager_levels(user_ids uuid[])
returns table (user_id uuid, total_wagered numeric, level int)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.total_wagered,0),
         greatest(1, least(100, floor(ln(greatest(coalesce(p.total_wagered,0),1)+1)*5)::int))
  from public.profiles p
  where p.id = any(user_ids);
$$;
grant execute on function public.get_user_wager_levels(uuid[]) to authenticated;

-- Affiliate stubs (safe no-ops if full affiliate schema absent)
drop function if exists public.get_affiliate_stats() cascade;
create function public.get_affiliate_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'code', null, 'referrals', 0, 'earnings', 0, 'pending', 0
  );
end; $$;
grant execute on function public.get_affiliate_stats() to authenticated;

drop function if exists public.claim_affiliate_earnings() cascade;
create function public.claim_affiliate_earnings()
returns numeric language plpgsql security definer set search_path = public as $$
begin
  return 0;
end; $$;
grant execute on function public.claim_affiliate_earnings() to authenticated;

drop function if exists public.submit_affiliate_referral_code(text) cascade;
create function public.submit_affiliate_referral_code(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- no-op if affiliate tables missing; real logic can replace later
  null;
end; $$;
grant execute on function public.submit_affiliate_referral_code(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 6 — Admin RPCs (adaptive columns)
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.admin_get_stats() cascade;
create function public.admin_get_stats()
returns table (
  pending_withdrawals bigint,
  pending_withdrawals_usd numeric,
  total_users bigint,
  credited_deposits_24h bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_pending bigint := 0; v_usd numeric := 0; v_users bigint := 0; v_deps bigint := 0;
begin
  perform public.require_admin();
  select count(*)::bigint into v_users from public.profiles;
  if to_regclass('public.redemptions') is not null then
    select count(*)::bigint, coalesce(sum(usd_amount),0) into v_pending, v_usd
    from public.redemptions where status = 'pending';
  end if;
  if to_regclass('public.crypto_deposits') is not null then
    execute $q$
      select count(*)::bigint from public.crypto_deposits d
      where d.status = 'credited'
        and coalesce(d.credited_at, d.created_at) >= now() - interval '24 hours'
    $q$ into v_deps;
  end if;
  return query select v_pending, v_usd, v_users, coalesce(v_deps,0);
end; $$;
grant execute on function public.admin_get_stats() to authenticated;

drop function if exists public.admin_list_recent_deposits(int) cascade;
create function public.admin_list_recent_deposits(p_limit int default 15)
returns table (
  id uuid, user_id uuid, username text, chain text,
  usd_amount numeric, tx_hash text, credited_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if to_regclass('public.crypto_deposits') is null then return; end if;
  return query execute format($q$
    select d.id, d.user_id, p.username, d.chain,
      coalesce(
        (to_jsonb(d)->>'usd_amount')::numeric,
        (to_jsonb(d)->>'expected_amount')::numeric,
        (to_jsonb(d)->>'credited')::numeric, 0),
      to_jsonb(d)->>'tx_hash',
      d.credited_at
    from public.crypto_deposits d
    join public.profiles p on p.id = d.user_id
    where d.status = 'credited'
    order by d.credited_at desc nulls last
    limit %s
  $q$, greatest(1, least(coalesce(p_limit,15), 50)));
end; $$;
grant execute on function public.admin_list_recent_deposits(int) to authenticated;

drop function if exists public.admin_list_withdrawals(text) cascade;
create function public.admin_list_withdrawals(p_status text default 'pending')
returns table (
  id uuid, user_id uuid, username text, email text, user_balance numeric,
  chain text, destination_address text, usd_amount numeric, status text,
  tx_hash text, error_message text, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if to_regclass('public.crypto_withdrawals') is null then return; end if;
  return query execute $q$
    select w.id, w.user_id, p.username, p.email, p.sweeps_coins, w.chain,
      coalesce(to_jsonb(w)->>'destination_address',''),
      coalesce((to_jsonb(w)->>'usd_amount')::numeric, (to_jsonb(w)->>'amount')::numeric, 0),
      w.status, to_jsonb(w)->>'tx_hash',
      coalesce(to_jsonb(w)->>'error_message', to_jsonb(w)->>'notes'),
      coalesce((to_jsonb(w)->>'created_at')::timestamptz, (to_jsonb(w)->>'requested_at')::timestamptz, now())
    from public.crypto_withdrawals w
    join public.profiles p on p.id = w.user_id
    where case
      when $1 = 'pending' then w.status in ('pending','processing')
      when $1 = 'all' then true else w.status = $1 end
    order by 12 desc limit 100
  $q$ using p_status;
end; $$;
grant execute on function public.admin_list_withdrawals(text) to authenticated;

drop function if exists public.admin_search_users(text) cascade;
create function public.admin_search_users(p_query text)
returns table (
  id uuid, username text, email text, balance numeric,
  sweeps_coins numeric, is_admin boolean, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select p.id, p.username, p.email, p.sweeps_coins, p.sweeps_coins, p.is_admin, p.created_at
  from public.profiles p
  where p_query is null or p_query = ''
     or p.username ilike '%'||p_query||'%'
     or p.email ilike '%'||p_query||'%'
     or p.id::text = p_query
  order by p.created_at desc limit 20;
end; $$;
grant execute on function public.admin_search_users(text) to authenticated;

drop function if exists public.admin_set_user_admin(uuid, boolean) cascade;
create function public.admin_set_user_admin(p_user_id uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_user_id = auth.uid() then raise exception 'You cannot change your own admin status'; end if;
  update public.profiles set is_admin = p_is_admin, updated_at = now() where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end; $$;
grant execute on function public.admin_set_user_admin(uuid, boolean) to authenticated;

drop function if exists public.admin_credit_user(uuid, numeric, text, text) cascade;
create function public.admin_credit_user(
  p_user_id uuid, p_amount numeric,
  p_note text default 'Admin credit', p_coin_type text default 'sweeps_coins'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_amt numeric(12,2) := round(p_amount::numeric, 2);
  v_new numeric(12,2);
begin
  perform public.require_admin();
  if p_user_id is null or v_amt is null or v_amt = 0 then
    raise exception 'Invalid credit parameters.';
  end if;
  perform public.bypass_profile_balance_guard();
  update public.profiles set sweeps_coins = greatest(0, sweeps_coins + v_amt), updated_at = now()
  where id = p_user_id returning sweeps_coins into v_new;
  if not found then raise exception 'User not found.'; end if;
  begin
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (p_user_id, case when v_amt>0 then 'admin_credit' else 'admin_debit' end,
            abs(v_amt), v_new, coalesce(p_note,'Admin adjustment')||' (SC)');
  exception when others then null;
  end;
end; $$;
grant execute on function public.admin_credit_user(uuid, numeric, text, text) to authenticated;

drop function if exists public.admin_list_redemptions(text) cascade;
create function public.admin_list_redemptions(p_status text default 'pending')
returns table (
  id uuid, user_id uuid, username text, email text,
  sc_amount numeric, usd_amount numeric, chain text,
  destination_address text, status text, tx_hash text,
  error_message text, sweeps_coins numeric, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select r.id, r.user_id, p.username, p.email, r.sc_amount, r.usd_amount, r.chain,
         r.destination_address, r.status, r.tx_hash, r.error_message, p.sweeps_coins, r.created_at
  from public.redemptions r join public.profiles p on p.id = r.user_id
  where (p_status = 'all' or r.status = p_status)
  order by r.created_at desc;
end; $$;
grant execute on function public.admin_list_redemptions(text) to authenticated;

drop function if exists public.admin_process_redemption(uuid, text, text) cascade;
create function public.admin_process_redemption(
  p_redemption_id uuid, p_status text, p_tx_hash text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.redemptions%rowtype;
  v_bal numeric;
begin
  perform public.require_admin();
  if p_status not in ('completed','failed') then raise exception 'Invalid status.'; end if;
  select * into v from public.redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Redemption not found.'; end if;
  if v.status <> 'pending' then raise exception 'Already processed.'; end if;
  if p_status = 'completed' then
    update public.redemptions set status='completed', tx_hash=coalesce(p_tx_hash,tx_hash),
      processed_at=now(), processed_by=auth.uid() where id=p_redemption_id;
  else
    perform public.bypass_profile_balance_guard();
    update public.profiles set sweeps_coins = sweeps_coins + v.sc_amount, updated_at=now()
    where id = v.user_id;
    update public.redemptions set status='failed', error_message=p_tx_hash,
      processed_at=now(), processed_by=auth.uid() where id=p_redemption_id;
  end if;
end; $$;
grant execute on function public.admin_process_redemption(uuid, text, text) to authenticated;

drop function if exists public.admin_complete_crypto_withdrawal(uuid, text) cascade;
create function public.admin_complete_crypto_withdrawal(p_id uuid, p_tx_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if to_regclass('public.crypto_withdrawals') is null then return; end if;
  update public.crypto_withdrawals
  set status = 'completed', tx_hash = p_tx_hash
  where id = p_id and status in ('pending','processing');
end; $$;
grant execute on function public.admin_complete_crypto_withdrawal(uuid, text) to authenticated;

drop function if exists public.admin_fail_crypto_withdrawal(uuid, text) cascade;
create function public.admin_fail_crypto_withdrawal(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if to_regclass('public.crypto_withdrawals') is null then return; end if;
  update public.crypto_withdrawals
  set status = 'failed', error_message = p_reason
  where id = p_id and status in ('pending','processing');
end; $$;
grant execute on function public.admin_fail_crypto_withdrawal(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 7 — RLS basics + grants
-- ════════════════════════════════════════════════════════════════════════════

alter table if exists public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_current_user_admin());
drop policy if exists "profiles_update_own_username" on public.profiles;
create policy "profiles_update_own_username" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table if exists public.game_pf_seeds enable row level security;
drop policy if exists "pf_seeds_own" on public.game_pf_seeds;
create policy "pf_seeds_own" on public.game_pf_seeds for select to authenticated
  using (user_id = auth.uid());

grant usage on schema public to authenticated, anon, service_role;

notify pgrst, 'reload schema';

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- Quick checks:
--   select public.ensure_user_profile();
--   select * from public.get_keno_pf_state();
--   select * from public.admin_get_stats();
-- ════════════════════════════════════════════════════════════════════════════
