-- Limbo (Stake-style): instant rounds, provably fair via game_pf_seeds

create table if not exists public.limbo_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  target_multiplier numeric(14, 2) not null check (target_multiplier >= 1.01),
  result_multiplier numeric(14, 2) not null,
  won boolean not null,
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists limbo_bets_user_id_created_at_idx
  on public.limbo_bets (user_id, created_at desc);

alter table public.limbo_bets enable row level security;

drop policy if exists "Users read own limbo bets" on public.limbo_bets;
create policy "Users read own limbo bets"
  on public.limbo_bets for select
  using (auth.uid() = user_id);

grant select on public.limbo_bets to authenticated;
grant all on table public.limbo_bets to service_role;

create or replace function public.settle_limbo_bet(
  p_user_id uuid,
  p_wager numeric,
  p_target_multiplier numeric,
  p_result_multiplier numeric,
  p_won boolean,
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_target_multiplier < 1.01 or p_target_multiplier > 1000000 then
    raise exception 'Invalid target multiplier';
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

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
    total_losses = total_losses + case when not p_won then p_wager else 0 end,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.limbo_bets (
    user_id, wager, target_multiplier, result_multiplier, won, payout, nonce
  )
  values (
    p_user_id,
    p_wager,
    p_target_multiplier,
    p_result_multiplier,
    p_won,
    coalesce(p_payout, 0),
    p_nonce
  )
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'wager',
    -p_wager,
    current_balance - p_wager,
    'Limbo @ ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x',
    wager_at
  );

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Limbo hit ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x (target ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x)',
      outcome_at
    );
  elsif not p_won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -p_wager,
      new_balance,
      'Limbo ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x — below ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x',
      outcome_at
    );
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint) from public;
grant execute on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint) to service_role;

create or replace function public.get_limbo_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_limbo_pf_state() to authenticated;

create or replace function public.set_limbo_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_limbo_client_seed(text) to authenticated;
