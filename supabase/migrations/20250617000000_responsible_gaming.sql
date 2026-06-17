-- Responsible gaming features
-- Self-exclusion, deposit limits, session tracking

-- ── Session tracking ──

alter table public.profiles
  add column if not exists session_started_at timestamptz,
  add column if not exists last_session_activity timestamptz;

-- ── Self-exclusion ──

alter table public.profiles
  add column if not exists self_excluded_until timestamptz;

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

revoke all on function public.self_exclude(int) from public;
grant execute on function public.self_exclude(int) to authenticated;

revoke all on function public.cancel_self_exclusion() from public;
grant execute on function public.cancel_self_exclusion() to authenticated;

revoke all on function public.check_self_exclusion() from public;
grant execute on function public.check_self_exclusion() to authenticated;

-- ── Deposit limits ──

alter table public.profiles
  add column if not exists daily_deposit_limit numeric(12, 2),
  add column if not exists weekly_deposit_limit numeric(12, 2);

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

revoke all on function public.set_deposit_limits(numeric, numeric) from public;
grant execute on function public.set_deposit_limits(numeric, numeric) to authenticated;

revoke all on function public.get_deposit_limits() from public;
grant execute on function public.get_deposit_limits() to authenticated;

-- ── Update credit_crypto_deposit to enforce limits ──

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
  d_limit numeric;
  w_limit numeric;
  d_used numeric;
  w_used numeric;
begin
  -- Check deposit limits
  select p.daily_deposit_limit, p.weekly_deposit_limit
    into d_limit, w_limit
    from public.profiles p
    where p.id = p_user_id;

  if d_limit is not null then
    select coalesce(sum(cd.usd_amount), 0)
      into d_used
      from public.crypto_deposits cd
      where cd.user_id = p_user_id
        and cd.status = 'credited'
        and cd.credited_at >= date_trunc('day', now());
    if d_used + p_usd_amount > d_limit then
      raise exception 'Daily deposit limit of % would be exceeded (used: %, attempted: %)',
        d_limit, d_used, p_usd_amount;
    end if;
  end if;

  if w_limit is not null then
    select coalesce(sum(cd.usd_amount), 0)
      into w_used
      from public.crypto_deposits cd
      where cd.user_id = p_user_id
        and cd.status = 'credited'
        and cd.credited_at >= date_trunc('week', now());
    if w_used + p_usd_amount > w_limit then
      raise exception 'Weekly deposit limit of % would be exceeded (used: %, attempted: %)',
        w_limit, w_used, p_usd_amount;
    end if;
  end if;

  -- Check self-exclusion
  if exists (
    select 1 from public.profiles
    where id = p_user_id
      and self_excluded_until is not null
      and self_excluded_until >= clock_timestamp()
  ) then
    raise exception 'Account is self-excluded. Deposits are not allowed during the exclusion period.';
  end if;

  -- Credit GC (existing balance column)
  update public.profiles
    set balance = balance + p_usd_amount,
        total_deposited = total_deposited + p_usd_amount,
        updated_at = now()
    where id = p_user_id;

  -- Bonus SC: 1% of deposit
  update public.profiles
    set sweeps_coins = sweeps_coins + (p_usd_amount * 0.01)
    where id = p_user_id;

  update public.crypto_deposits
    set status = 'credited', credited_at = now()
    where id = p_deposit_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    select p_user_id, 'credit', p_usd_amount,
      (select balance from public.profiles where id = p_user_id),
      'Crypto deposit ' || upper(p_chain) || ' ' || p_tx_hash,
      now();

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    select p_user_id, 'bonus', round(p_usd_amount * 0.01, 2),
      (select sweeps_coins from public.profiles where id = p_user_id),
      'SC bonus 1% of ' || p_usd_amount || ' deposit',
      now();
end;
$$;

revoke all on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) from public;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;

-- ── Self-exclusion check helper for edge functions ──

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
