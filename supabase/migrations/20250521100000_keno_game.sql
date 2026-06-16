-- Keno (Stake-style): provably fair seeds + bet settlement RPC

create extension if not exists pgcrypto;

create table if not exists public.game_pf_seeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  server_seed text not null,
  server_seed_hash text not null,
  client_seed text not null default 'default',
  next_nonce bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_pf_seeds enable row level security;

drop policy if exists "Users can read own pf seeds" on public.game_pf_seeds;
create policy "Users can read own pf seeds"
  on public.game_pf_seeds for select
  using (auth.uid() = user_id);

grant select on public.game_pf_seeds to authenticated;

create table if not exists public.keno_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  risk text not null check (risk in ('classic', 'low', 'medium', 'high')),
  picks int[] not null,
  drawn int[] not null,
  hits int not null check (hits >= 0 and hits <= 10),
  multiplier numeric(14, 4) not null default 0,
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists keno_bets_user_id_created_at_idx
  on public.keno_bets (user_id, created_at desc);

alter table public.keno_bets enable row level security;

drop policy if exists "Users can read own keno bets" on public.keno_bets;
create policy "Users can read own keno bets"
  on public.keno_bets for select
  using (auth.uid() = user_id);

grant select on public.keno_bets to authenticated;

-- Ensure PF seed row exists; rotate server seed (new hash, nonce reset)
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

-- Settlement: called by edge function with service_role after provably fair draw
create or replace function public.settle_keno_bet(
  p_user_id uuid,
  p_wager numeric,
  p_risk text,
  p_picks int[],
  p_drawn int[],
  p_hits int,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint
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
  wid uuid;
begin
  if p_risk not in ('classic', 'low', 'medium', 'high') then
    raise exception 'Invalid risk';
  end if;

  if array_length(p_picks, 1) is null or array_length(p_picks, 1) < 1 or array_length(p_picks, 1) > 10 then
    raise exception 'Select 1 to 10 numbers';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_wager + p_payout;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
    total_losses = total_losses + case when p_payout < p_wager then p_wager - p_payout else 0 end,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.keno_bets (
    user_id, wager, risk, picks, drawn, hits, multiplier, payout, nonce
  )
  values (
    p_user_id, p_wager, p_risk, p_picks, p_drawn, p_hits, p_multiplier, p_payout, p_nonce
  )
  returning id into wid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager, 'Keno bet');

  if p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Keno ' || p_hits || '/' || array_length(p_picks, 1) || ' @ ' || trim(to_char(p_multiplier, 'FM999990.9999')) || 'x'
    );
  elsif p_payout = 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id,
      'loss',
      -(p_wager),
      new_balance,
      'Keno ' || p_hits || '/' || array_length(p_picks, 1) || ' — no payout'
    );
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, wid;
end;
$$;

revoke all on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint) from public;
grant execute on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint) to service_role;

-- Lock seeds + return server seed for one round (service role only)
create or replace function public.consume_keno_nonce(p_user_id uuid)
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
begin
  if p_user_id is null then
    raise exception 'User id required';
  end if;

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

  return query
  select row.server_seed, row.client_seed, row.next_nonce;
end;
$$;

revoke all on function public.consume_keno_nonce(uuid) from public;
grant execute on function public.consume_keno_nonce(uuid) to service_role;

grant usage on schema extensions to service_role;
grant all on table public.game_pf_seeds to service_role;
