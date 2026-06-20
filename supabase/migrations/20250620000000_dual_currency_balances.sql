-- Dual-currency balance & rate fix
-- Implements: 10,000 GC starting balance, 100 SC starting balance
-- Conversion: 100 SC = $1 USD, 100 GC = $1 USD (display only; GC has no real value)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Update handle_new_user trigger to grant 10,000 GC + 100 SC welcome bonus
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Update ensure_user_profile to grant the same welcome bonus
--    (called on first page load after signup)
-- ─────────────────────────────────────────────────────────────────────────────
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
    100     -- 100 SC welcome bonus
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing;
  select * into row from public.profiles where id = uid;
  return row;
end;
$$;

revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix SC → USD redemption rate: 100 SC = $1 USD (was 1 SC = $1)
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fix crypto deposit crediting: 100 GC = $1, plus bonus SC
--    Deposit $X → (X * 100) GC + X SC bonus
--    e.g. $10 → 1,000 GC + 10 SC ($0.10 bonus value)
-- ─────────────────────────────────────────────────────────────────────────────
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

revoke all on function public.credit_crypto_deposit from public;
grant execute on function public.credit_crypto_deposit to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Add a helper RPC for admin to grant free SC (e.g. from mail-in Free Entry)
-- ─────────────────────────────────────────────────────────────────────────────
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

revoke all on function public.grant_free_sc from public;
grant execute on function public.grant_free_sc to service_role;
