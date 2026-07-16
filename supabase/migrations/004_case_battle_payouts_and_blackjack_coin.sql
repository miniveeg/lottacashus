-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Persist case-battle payouts + blackjack coin_type (Phase 004)
-- ══════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 1. Store edge-computed payout on each player row ────────────────────────
alter table public.case_battle_players
  add column if not exists payout_amount numeric(12, 2) not null default 0;

comment on column public.case_battle_players.payout_amount is
  'Edge-computed credit for this slot after resolution. Claim credits this only.';

-- ─── 2. cb_claim_payout credits ONLY the stored payout_amount ────────────────
drop function if exists public.cb_claim_payout(uuid, int, numeric) cascade;
drop function if exists public.cb_claim_payout(uuid, int) cascade;

create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_player public.case_battle_players%rowtype;
  v_balance numeric;
  v_payout numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'completed' then raise exception 'Battle not completed'; end if;

  select * into v_player
  from public.case_battle_players
  where battle_id = p_battle_id and slot = p_slot
  for update;
  if not found then raise exception 'Player not found'; end if;
  if v_player.user_id is null or v_player.user_id != v_uid then
    raise exception 'You can only claim your own payout';
  end if;

  if v_player.claimed_at is not null then
    if v_battle.coin_type = 'sweeps_coins' then
      select sweeps_coins into v_balance from public.profiles where id = v_uid;
    else
      select balance into v_balance from public.profiles where id = v_uid;
    end if;
    return coalesce(v_balance, 0);
  end if;

  v_payout := coalesce(v_player.payout_amount, 0);
  if v_payout <= 0 then
    raise exception 'No payout available for this slot';
  end if;

  perform public.bypass_profile_balance_guard();

  if v_battle.coin_type = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles
    set sweeps_coins = v_balance, total_wins = total_wins + v_payout, updated_at = now()
    where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles
    set balance = v_balance, total_wins = total_wins + v_payout, updated_at = now()
    where id = v_uid;
  end if;

  update public.case_battle_players
  set claimed_at = now()
  where battle_id = p_battle_id and slot = p_slot;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    v_uid, 'win', v_payout, v_balance,
    'Case Battle payout (slot ' || p_slot || ', ' || v_battle.gamemode || ')',
    now()
  );

  return v_balance;
end;
$$;

revoke all on function public.cb_claim_payout(uuid, int) from public;
grant execute on function public.cb_claim_payout(uuid, int) to authenticated;


-- ─── 3. Blackjack coin_type lock ─────────────────────────────────────────────
alter table public.blackjack_hands
  add column if not exists coin_type text not null default 'balance';

-- Drop/re-add check only if needed (safe when already present)
do $$
begin
  alter table public.blackjack_hands
    drop constraint if exists blackjack_hands_coin_type_check;
  alter table public.blackjack_hands
    add constraint blackjack_hands_coin_type_check
    check (coin_type in ('balance', 'sweeps_coins'));
exception when others then
  null;
end $$;

-- start: store coin_type on the hand row
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
  v_coin text := case when p_coin_type = 'sweeps_coins' then 'sweeps_coins' else 'balance' end;
begin
  if exists (
    select 1 from public.blackjack_hands h
    where h.user_id = p_user_id and h.status = 'player_turn'
  ) then
    raise exception 'Finish your current Blackjack hand first';
  end if;

  perform public.bypass_profile_balance_guard();

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_total_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_total_wager;

  if v_coin = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_total_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.blackjack_hands (
    user_id, wager, total_wager, doubled, shoe, shoe_index, player_cards, dealer_cards,
    dealer_revealed, status, outcome, payout, nonce, phase, insurance_wager, insurance_taken,
    insurance_decided, is_split, player_hands, active_hand_index, coin_type, completed_at
  )
  values (
    p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index, p_player_cards, p_dealer_cards,
    p_dealer_revealed, p_status, p_outcome, coalesce(p_payout, 0), p_nonce, p_phase, p_insurance_wager,
    p_insurance_taken, p_insurance_decided, p_is_split, p_player_hands, p_active_hand_index, v_coin,
    case when p_status = 'settled' then now() else null end
  )
  returning id into hid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_total_wager, new_balance, upper(v_coin) || ' Blackjack bet', wager_at);

  if p_status = 'settled' then
    new_balance := new_balance + coalesce(p_payout, 0);
    if v_coin = 'sweeps_coins' then
      update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
    else
      update public.profiles set balance = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
    end if;
    if coalesce(p_payout, 0) > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'win', p_payout, new_balance, upper(v_coin) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
    elsif p_outcome in ('lose', 'bust') then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'loss', -p_total_wager, new_balance, upper(v_coin) || ' Blackjack ' || p_outcome, outcome_at);
    elsif p_outcome = 'push' then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'push', 0, new_balance, upper(v_coin) || ' Blackjack push', outcome_at);
    end if;
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, hid;
end;
$$;

-- debit extra / finish: always use the hand's stored coin_type
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
  v_coin text;
begin
  select coalesce(nullif(coin_type, ''), 'balance') into v_coin
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Hand not found'; end if;
  if v_coin not in ('balance', 'sweeps_coins') then v_coin := 'balance'; end if;
  -- Ignore client p_coin_type.

  perform public.bypass_profile_balance_guard();

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance < p_extra_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_extra_wager;

  if v_coin = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_extra_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_extra_wager, new_balance, upper(v_coin) || ' ' || p_description);
end;
$$;

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
returns table (out_balance numeric, hand_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp();
  v_coin text;
begin
  select coalesce(nullif(coin_type, ''), 'balance') into v_coin
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Hand not found'; end if;
  if v_coin not in ('balance', 'sweeps_coins') then v_coin := 'balance'; end if;

  perform public.bypass_profile_balance_guard();

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + coalesce(p_payout, 0) - coalesce(p_extra_wager, 0);

  if v_coin = 'sweeps_coins' then
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
    values (p_user_id, 'win', p_payout, new_balance, upper(v_coin) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
  end if;

  return query select new_balance, p_hand_id;
end;
$$;

commit;
