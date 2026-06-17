-- Dual-currency sweepstakes system
-- Gold Coins (GC) = existing balance (play currency, no redemption value)
-- Sweeps Coins (SC) = redeemable currency (obtained free or as bonus)

-- Add sweeps_coins column (gold_coins reuses existing balance column)
alter table public.profiles
  add column if not exists sweeps_coins numeric(12, 2) not null default 0;

-- Redemptions table for SC cash-out
create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sc_amount numeric(12, 2) not null check (sc_amount >= 100),
  usd_amount numeric(12, 2) not null,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  destination_address text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  tx_hash text,
  error_message text,
  processed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.redemptions enable row level security;

create policy "Users read own redemptions"
  on public.redemptions for select
  using (auth.uid() = user_id);

create policy "Users insert own redemptions"
  on public.redemptions for insert
  with check (auth.uid() = user_id);

grant select, insert on public.redemptions to authenticated;
grant all on table public.redemptions to service_role;

-- Update handle_new_user to grant welcome bonus
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
    1000,
    10
  );
  return new;
end;
$$;

-- Dual-currency credit (admin or system)
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

-- Add coin_type to admin_credit_log
alter table public.admin_credit_log add column if not exists coin_type text not null default 'balance';

-- Grant execute on updated function
grant execute on function public.admin_credit_user to authenticated;

-- Get coin balance RPC
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

grant execute on function public.get_coin_balance to authenticated;

-- Adjust coins (atomic debit/credit, for system use only)
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

grant execute on function public.adjust_coins to service_role;

-- Request SC redemption
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

  if p_sc_amount < min_sc then
    raise exception 'Minimum redemption is % SC', min_sc;
  end if;

  usd_val := p_sc_amount; -- 1 SC = $0.10, so 100 SC = $10

  select sweeps_coins into current_sc
  from public.profiles where id = uid for update;

  if current_sc is null or current_sc < p_sc_amount then
    raise exception 'Insufficient Sweeps Coins balance';
  end if;

  update public.profiles
  set sweeps_coins = sweeps_coins - p_sc_amount,
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
    upper(p_chain) || ' SC redemption pending: ' || p_sc_amount || ' SC'
  );

  return rid;
end;
$$;

grant execute on function public.request_sc_redemption(numeric, text, text) to authenticated;

-- Process redemption (admin)
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

grant execute on function public.admin_process_redemption to authenticated;

-- Admin list redemptions
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

grant execute on function public.admin_list_redemptions to authenticated;

-- Update existing game settlement functions to accept p_coin_type
-- Settle Limbo Bet (dual currency)
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
    set
      sweeps_coins = new_balance,
      total_wagered = total_wagered + p_wager,
      total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set
      balance = new_balance,
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

-- Settle Keno Bet (dual currency)
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
    set balance = new_balance, total_wagered = total_wagered + p_wager,
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

-- Settle Roulette Bet (dual currency)
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
    set balance = new_balance, total_wagered = total_wagered + p_wager,
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

-- Update credit_crypto_deposit to credit GC + bonus SC
drop function if exists public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid);
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
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  -- 1 SC per 100 GC purchased
  bonus_sc := floor(p_usd_amount / 100);

  update public.profiles
  set
    balance = balance + p_usd_amount,
    sweeps_coins = sweeps_coins + bonus_sc,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance, sweeps_coins into new_balance, new_sc;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'deposit', p_usd_amount, new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '… — ' || bonus_sc || ' bonus SC'
  );

  if bonus_sc > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id, 'bonus', bonus_sc, new_sc,
      bonus_sc || ' SC bonus from ' || upper(p_chain) || ' deposit'
    );
  end if;
end;
$$;

revoke all on function public.credit_crypto_deposit from public;
grant execute on function public.credit_crypto_deposit to service_role;

-- Update ensure_user_profile to include sweeps_coins and welcome bonus
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
    1000,
    10
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing;
  select * into row from public.profiles where id = uid;
  return row;
end;
$$;

grant execute on function public.ensure_user_profile() to authenticated;

-- Update admin_search_users to include sweeps_coins
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

grant execute on function public.admin_search_users to authenticated;

-- ==== Blackjack dual-currency RPCs ====

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
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_total_wager, updated_at = now() where id = p_user_id;
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

revoke all on function public.blackjack_finish_hand from public;
grant execute on function public.blackjack_finish_hand to service_role;

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
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_extra_wager, updated_at = now() where id = p_user_id;
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_extra_wager, new_balance, upper(p_coin_type) || ' ' || p_description);
end;
$$;

revoke all on function public.blackjack_debit_extra from public;
grant execute on function public.blackjack_debit_extra to service_role;

-- ==== Mines dual-currency RPCs ====

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
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
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

-- ==== Crash game tables & RPCs ====

create table if not exists public.crash_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  crash_point numeric(14, 2) not null,
  won boolean not null default false,
  payout numeric(12, 2) not null default 0,
  cashed_at numeric(14, 2),
  coin_type text not null default 'balance',
  nonce bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists crash_bets_user_created_idx on public.crash_bets (user_id, created_at desc);

alter table public.crash_bets enable row level security;

create policy "Users read own crash bets"
  on public.crash_bets for select
  using (auth.uid() = user_id);

grant select on public.crash_bets to authenticated;
grant all on table public.crash_bets to service_role;

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
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
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

revoke all on function public.place_crash_bet from public;
grant execute on function public.place_crash_bet to service_role;

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

revoke all on function public.cash_out_crash from public;
grant execute on function public.cash_out_crash to service_role;

create or replace function public.crash_settle_loss(
  p_bet_id uuid
)
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

revoke all on function public.crash_settle_loss from public;
grant execute on function public.crash_settle_loss to service_role;

-- PF wrappers for crash
create or replace function public.get_crash_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_crash_pf_state() to authenticated;

create or replace function public.set_crash_client_seed(p_client_seed text)
returns void language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_crash_client_seed(text) to authenticated;

-- ==== Simple Slots game ====

create table if not exists public.slots_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  reels int[] not null,
  won boolean not null,
  multiplier numeric(14, 2) not null default 0,
  payout numeric(12, 2) not null default 0,
  coin_type text not null default 'balance',
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists slots_games_user_created_idx on public.slots_games (user_id, created_at desc);

alter table public.slots_games enable row level security;

create policy "Users read own slots games"
  on public.slots_games for select
  using (auth.uid() = user_id);

grant select on public.slots_games to authenticated;
grant all on table public.slots_games to service_role;

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
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_wager,
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

revoke all on function public.settle_slots_bet from public;
grant execute on function public.settle_slots_bet to service_role;

create or replace function public.get_slots_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_slots_pf_state() to authenticated;

create or replace function public.set_slots_client_seed(p_client_seed text)
returns void language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_slots_client_seed(text) to authenticated;
