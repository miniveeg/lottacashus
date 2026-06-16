-- Blackjack (Stake-style): session hands, provably fair shoe via game_pf_seeds

create table if not exists public.blackjack_hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  total_wager numeric(12, 2) not null check (total_wager > 0),
  doubled boolean not null default false,
  shoe int[] not null,
  shoe_index int not null default 0,
  player_cards int[] not null default '{}',
  dealer_cards int[] not null default '{}',
  dealer_revealed boolean not null default false,
  status text not null default 'player_turn'
    check (status in ('player_turn', 'settled')),
  outcome text check (outcome is null or outcome in ('blackjack', 'win', 'lose', 'push', 'bust')),
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists blackjack_hands_user_active_idx
  on public.blackjack_hands (user_id)
  where status = 'player_turn';

create index if not exists blackjack_hands_user_created_idx
  on public.blackjack_hands (user_id, created_at desc);

alter table public.blackjack_hands enable row level security;

drop policy if exists "Users read own blackjack hands" on public.blackjack_hands;
create policy "Users read own blackjack hands"
  on public.blackjack_hands for select
  using (auth.uid() = user_id);

grant select on public.blackjack_hands to authenticated;
grant all on table public.blackjack_hands to service_role;

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
  p_nonce bigint
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

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_total_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_total_wager;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_total_wager,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.blackjack_hands (
    user_id, wager, total_wager, doubled, shoe, shoe_index,
    player_cards, dealer_cards, dealer_revealed, status, outcome, payout, nonce,
    completed_at
  )
  values (
    p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index,
    p_player_cards, p_dealer_cards, p_dealer_revealed, p_status, p_outcome,
    coalesce(p_payout, 0), p_nonce,
    case when p_status = 'settled' then now() else null end
  )
  returning id into hid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_total_wager, new_balance, 'Blackjack bet', wager_at);

  if p_status = 'settled' then
    new_balance := new_balance + coalesce(p_payout, 0);

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end,
      updated_at = now()
    where p.id = p_user_id;

    if coalesce(p_payout, 0) > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'win',
        p_payout,
        new_balance,
        'Blackjack ' || coalesce(p_outcome, 'win'),
        outcome_at
      );
    elsif p_outcome in ('lose', 'bust') then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'loss',
        -p_total_wager,
        new_balance,
        'Blackjack ' || p_outcome,
        outcome_at
      );
    elsif p_outcome = 'push' then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'win',
        p_payout,
        new_balance,
        'Blackjack push',
        outcome_at
      );
    end if;
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, hid;
end;
$$;

revoke all on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint) from public;
grant execute on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint) to service_role;

create or replace function public.blackjack_update_active(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_shoe_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blackjack_hands h
  set
    player_cards = p_player_cards,
    shoe_index = p_shoe_index
  where h.id = p_hand_id
    and h.user_id = p_user_id
    and h.status = 'player_turn';

  if not found then
    raise exception 'Active hand not found';
  end if;
end;
$$;

revoke all on function public.blackjack_update_active(uuid, uuid, int[], int) from public;
grant execute on function public.blackjack_update_active(uuid, uuid, int[], int) to service_role;

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
  p_extra_wager numeric default 0
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.blackjack_hands%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  extra numeric(12, 2) := greatest(0, coalesce(p_extra_wager, 0));
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  select * into h
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Hand not found';
  end if;

  if h.status <> 'player_turn' then
    raise exception 'Hand is not active';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  new_balance := current_balance;

  if extra > 0 then
    if new_balance < extra then
      raise exception 'Insufficient balance for double';
    end if;
    new_balance := new_balance - extra;

    update public.profiles p
    set
      balance = new_balance,
      total_wagered = total_wagered + extra,
      updated_at = now()
    where p.id = p_user_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'wager', -extra, new_balance, 'Blackjack double', wager_at);
  end if;

  new_balance := new_balance + coalesce(p_payout, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
    total_losses = total_losses + case
      when coalesce(p_payout, 0) <= 0 and p_outcome not in ('push') then p_total_wager
      else 0
    end,
    updated_at = now()
  where p.id = p_user_id;

  update public.blackjack_hands
  set
    player_cards = p_player_cards,
    dealer_cards = p_dealer_cards,
    shoe_index = p_shoe_index,
    doubled = p_doubled,
    total_wager = p_total_wager,
    dealer_revealed = p_dealer_revealed,
    status = 'settled',
    outcome = p_outcome,
    payout = coalesce(p_payout, 0),
    completed_at = now()
  where id = p_hand_id;

  if coalesce(p_payout, 0) > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Blackjack ' || coalesce(p_outcome, 'win'),
      outcome_at
    );
  elsif p_outcome in ('lose', 'bust') then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -p_total_wager,
      new_balance,
      'Blackjack ' || p_outcome,
      outcome_at
    );
  elsif p_outcome = 'push' then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Blackjack push',
      outcome_at
    );
  end if;

  return query select new_balance;
end;
$$;

revoke all on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric) from public;
grant execute on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric) to service_role;

drop function if exists public.get_my_active_blackjack_hand();

create or replace function public.get_my_active_blackjack_hand()
returns table (
  hand_id uuid,
  wager numeric,
  total_wager numeric,
  doubled boolean,
  player_cards int[],
  dealer_cards int[],
  dealer_revealed boolean,
  shoe_index int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    h.id,
    h.wager,
    h.total_wager,
    h.doubled,
    h.player_cards,
    case
      when h.dealer_revealed then h.dealer_cards
      when coalesce(array_length(h.dealer_cards, 1), 0) >= 1 then array[h.dealer_cards[1]]
      else '{}'::int[]
    end,
    h.dealer_revealed,
    h.shoe_index
  from public.blackjack_hands h
  where h.user_id = uid and h.status = 'player_turn'
  order by h.created_at desc
  limit 1;
end;
$$;

grant execute on function public.get_my_active_blackjack_hand() to authenticated;

create or replace function public.get_blackjack_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_blackjack_pf_state() to authenticated;

create or replace function public.set_blackjack_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_blackjack_client_seed(text) to authenticated;
