-- Crypto deposits & withdrawals (SOL, LTC, ETH)

create sequence if not exists public.deposit_derivation_index_seq;

alter table public.profiles
  add column if not exists deposit_derivation_index int unique;

create table if not exists public.user_deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  address text not null,
  derivation_index int not null,
  created_at timestamptz not null default now(),
  unique (user_id, chain),
  unique (address)
);

create table if not exists public.crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  tx_hash text not null,
  address text not null,
  crypto_amount numeric(24, 12) not null,
  usd_amount numeric(12, 2) not null,
  exchange_rate numeric(18, 8) not null,
  confirmations int not null default 0,
  required_confirmations int not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'credited', 'swept')),
  credited_at timestamptz,
  swept_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chain, tx_hash)
);

create table if not exists public.crypto_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  destination_address text not null,
  crypto_amount numeric(24, 12),
  usd_amount numeric(12, 2) not null,
  exchange_rate numeric(18, 8),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  tx_hash text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists crypto_deposits_user_status_idx on public.crypto_deposits (user_id, status);
create index if not exists crypto_withdrawals_user_idx on public.crypto_withdrawals (user_id, created_at desc);

alter table public.user_deposit_addresses enable row level security;
alter table public.crypto_deposits enable row level security;
alter table public.crypto_withdrawals enable row level security;

drop policy if exists "Users read own deposit addresses" on public.user_deposit_addresses;
create policy "Users read own deposit addresses"
  on public.user_deposit_addresses for select using (auth.uid() = user_id);

drop policy if exists "Users read own crypto deposits" on public.crypto_deposits;
create policy "Users read own crypto deposits"
  on public.crypto_deposits for select using (auth.uid() = user_id);

drop policy if exists "Users read own withdrawals" on public.crypto_withdrawals;
create policy "Users read own withdrawals"
  on public.crypto_withdrawals for select using (auth.uid() = user_id);

drop policy if exists "Users insert own withdrawals" on public.crypto_withdrawals;
create policy "Users insert own withdrawals"
  on public.crypto_withdrawals for insert with check (auth.uid() = user_id);

grant select on public.user_deposit_addresses to authenticated;
grant select on public.crypto_deposits to authenticated;
grant select, insert on public.crypto_withdrawals to authenticated;

grant usage on schema public to service_role;
grant all on table public.user_deposit_addresses to service_role;
grant all on table public.crypto_deposits to service_role;
grant all on table public.crypto_withdrawals to service_role;
grant usage, select on sequence public.deposit_derivation_index_seq to service_role;

-- Credit deposit + update stats (service role / edge functions only)
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
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  update public.profiles
  set
    balance = balance + p_usd_amount,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance into new_balance;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id,
    'deposit',
    p_usd_amount,
    new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '…'
  );
end;
$$;

revoke all on function public.credit_crypto_deposit from public;
grant execute on function public.credit_crypto_deposit to service_role;

-- Lock balance for withdrawal request
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

  select balance into current_balance from public.profiles where id = uid for update;

  if current_balance is null or current_balance < p_usd_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.profiles
  set
    balance = balance - p_usd_amount,
    total_withdrawn = total_withdrawn + p_usd_amount,
    updated_at = now()
  where id = uid;

  insert into public.crypto_withdrawals (user_id, chain, destination_address, usd_amount, status)
  values (uid, p_chain, p_destination, p_usd_amount, 'pending')
  returning id into wid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    uid,
    'withdrawal',
    -p_usd_amount,
    current_balance - p_usd_amount,
    upper(p_chain) || ' withdrawal pending'
  );

  return wid;
end;
$$;

grant execute on function public.request_crypto_withdrawal(text, text, numeric) to authenticated;

-- Assign derivation index to profile
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
