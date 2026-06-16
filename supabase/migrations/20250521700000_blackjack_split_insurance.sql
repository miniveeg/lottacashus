-- Blackjack: split pairs + insurance (dealer Ace)

alter table public.blackjack_hands
  add column if not exists phase text not null default 'player_turn'
    check (phase in ('insurance_offer', 'player_turn', 'settled')),
  add column if not exists insurance_wager numeric(12, 2) not null default 0,
  add column if not exists insurance_taken boolean not null default false,
  add column if not exists insurance_decided boolean not null default true,
  add column if not exists is_split boolean not null default false,
  add column if not exists player_hands jsonb,
  add column if not exists active_hand_index int not null default 0;

-- Return type / signature changes require drop (CREATE OR REPLACE cannot alter OUT columns).
drop function if exists public.get_my_active_blackjack_hand();

drop function if exists public.start_blackjack_hand(
  uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint
);

drop function if exists public.blackjack_update_active(uuid, uuid, int[], int);

drop function if exists public.blackjack_finish_hand(
  uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric
);

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
  p_insurance_decided boolean default true,
  p_is_split boolean default false,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0
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
    phase, insurance_wager, insurance_taken, insurance_decided,
    is_split, player_hands, active_hand_index,
    completed_at
  )
  values (
    p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index,
    p_player_cards, p_dealer_cards, p_dealer_revealed, p_status, p_outcome,
    coalesce(p_payout, 0), p_nonce,
    coalesce(p_phase, 'player_turn'),
    coalesce(p_insurance_wager, 0),
    coalesce(p_insurance_taken, false),
    coalesce(p_insurance_decided, true),
    coalesce(p_is_split, false),
    p_player_hands,
    coalesce(p_active_hand_index, 0),
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

revoke all on function public.start_blackjack_hand(
  uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint,
  text, numeric, boolean, boolean, boolean, jsonb, int
) from public;
grant execute on function public.start_blackjack_hand(
  uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint,
  text, numeric, boolean, boolean, boolean, jsonb, int
) to service_role;

create or replace function public.blackjack_update_active(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_shoe_index int,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0,
  p_is_split boolean default false,
  p_phase text default 'player_turn',
  p_total_wager numeric default null,
  p_doubled boolean default null,
  p_insurance_wager numeric default null,
  p_insurance_taken boolean default null,
  p_insurance_decided boolean default null
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
    shoe_index = p_shoe_index,
    player_hands = coalesce(p_player_hands, h.player_hands),
    active_hand_index = coalesce(p_active_hand_index, h.active_hand_index),
    is_split = coalesce(p_is_split, h.is_split),
    phase = coalesce(p_phase, h.phase),
    total_wager = coalesce(p_total_wager, h.total_wager),
    doubled = coalesce(p_doubled, h.doubled),
    insurance_wager = coalesce(p_insurance_wager, h.insurance_wager),
    insurance_taken = coalesce(p_insurance_taken, h.insurance_taken),
    insurance_decided = coalesce(p_insurance_decided, h.insurance_decided)
  where h.id = p_hand_id
    and h.user_id = p_user_id
    and h.status = 'player_turn';

  if not found then
    raise exception 'Active hand not found';
  end if;
end;
$$;

revoke all on function public.blackjack_update_active(
  uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean
) from public;
grant execute on function public.blackjack_update_active(
  uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean
) to service_role;

create or replace function public.blackjack_debit_extra(
  p_user_id uuid,
  p_hand_id uuid,
  p_extra_wager numeric,
  p_description text default 'Blackjack side bet'
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  extra numeric(12, 2) := greatest(0, coalesce(p_extra_wager, 0));
  wager_at timestamptz := clock_timestamp();
begin
  if extra <= 0 then
    select p.balance into current_balance from public.profiles p where p.id = p_user_id;
    return query select coalesce(current_balance, 0);
    return;
  end if;

  perform 1
  from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.status = 'player_turn'
  for update;

  if not found then
    raise exception 'Active hand not found';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance < extra then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - extra;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + extra,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -extra, new_balance, coalesce(p_description, 'Blackjack side bet'), wager_at);

  return query select new_balance;
end;
$$;

revoke all on function public.blackjack_debit_extra(uuid, uuid, numeric, text) from public;
grant execute on function public.blackjack_debit_extra(uuid, uuid, numeric, text) to service_role;

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
  p_insurance_wager numeric default null,
  p_insurance_taken boolean default null
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
  ins_wager numeric(12, 2);
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
      raise exception 'Insufficient balance';
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

  ins_wager := coalesce(p_insurance_wager, h.insurance_wager, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
    total_losses = total_losses + case
      when coalesce(p_payout, 0) <= 0 and p_outcome not in ('push') then p_total_wager + ins_wager
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
    phase = coalesce(p_phase, 'settled'),
    outcome = p_outcome,
    payout = coalesce(p_payout, 0),
    player_hands = coalesce(p_player_hands, player_hands),
    is_split = coalesce(p_is_split, is_split),
    active_hand_index = coalesce(p_active_hand_index, active_hand_index),
    insurance_wager = coalesce(p_insurance_wager, insurance_wager),
    insurance_taken = coalesce(p_insurance_taken, insurance_taken),
    insurance_decided = true,
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

revoke all on function public.blackjack_finish_hand(
  uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric,
  text, jsonb, boolean, int, numeric, boolean
) from public;
grant execute on function public.blackjack_finish_hand(
  uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric,
  text, jsonb, boolean, int, numeric, boolean
) to service_role;

create or replace function public.get_my_active_blackjack_hand()
returns table (
  hand_id uuid,
  wager numeric,
  total_wager numeric,
  doubled boolean,
  player_cards int[],
  dealer_cards int[],
  dealer_revealed boolean,
  shoe_index int,
  phase text,
  insurance_wager numeric,
  insurance_taken boolean,
  insurance_decided boolean,
  is_split boolean,
  player_hands jsonb,
  active_hand_index int
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
    h.shoe_index,
    h.phase,
    h.insurance_wager,
    h.insurance_taken,
    h.insurance_decided,
    h.is_split,
    h.player_hands,
    h.active_hand_index
  from public.blackjack_hands h
  where h.user_id = uid and h.status = 'player_turn'
  order by h.created_at desc
  limit 1;
end;
$$;

grant execute on function public.get_my_active_blackjack_hand() to authenticated;
