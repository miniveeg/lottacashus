-- Fix double Case Battle win credits (RETURN QUERY does not exit plpgsql functions)
-- and defer balance credit until the client claims after playback.

alter table public.case_battles
  add column if not exists payouts_credited boolean not null default false;

-- Battles already paid (including mistaken double credits) must not be paid again on claim.
update public.case_battles
set payouts_credited = true
where status = 'completed'
  and coalesce(winner_payout, 0) > 0;

create or replace function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb,
  p_winner_payouts jsonb default '[]'::jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row jsonb;
  battle_status text;
begin
  select b.status into battle_status
  from public.case_battles b
  where b.id = p_battle_id
  for update;

  if battle_status is null then
    raise exception 'Battle not found';
  end if;

  if battle_status = 'completed' then
    return;
  end if;

  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id
    and status in ('waiting', 'running', 'pending_eos', 'pending_jackpot_eos');

  if not found then
    select b.status into battle_status
    from public.case_battles b
    where b.id = p_battle_id;

    if battle_status = 'completed' then
      return;
    end if;

    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  return;
end;
$$;

create or replace function public.apply_case_battle_payouts(
  p_battle_id uuid,
  p_user_id uuid
)
returns table (out_balance numeric, out_credited boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  payout_row jsonb;
  uid uuid;
  amt numeric(12, 2);
  payouts jsonb;
  paid boolean := false;
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'completed' then
    raise exception 'Battle is not finished yet';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if b.payouts_credited then
    return query select current_balance, false;
    return;
  end if;

  payouts := coalesce(b.results->'winnerPayouts', '[]'::jsonb);
  if jsonb_typeof(payouts) <> 'array' then
    payouts := '[]'::jsonb;
  end if;

  if jsonb_array_length(payouts) > 0 then
    for payout_row in select * from jsonb_array_elements(payouts)
    loop
      uid := coalesce(
        nullif(payout_row->>'userId', '')::uuid,
        nullif(payout_row->>'user_id', '')::uuid
      );
      amt := coalesce((payout_row->>'amount')::numeric, 0);
      if uid is null or amt <= 0 or uid <> p_user_id then
        continue;
      end if;

      select p.balance into current_balance
      from public.profiles p
      where p.id = uid
      for update;

      new_balance := current_balance + amt;
      paid := true;

      update public.profiles p
      set
        balance = new_balance,
        total_wins = total_wins + amt,
        updated_at = now()
      where p.id = uid;

      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (uid, 'win', amt, new_balance, 'Case battle win', outcome_at);
    end loop;
  elsif b.winner_id is not null
    and b.winner_id = p_user_id
    and coalesce(b.winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = b.winner_id
    for update;

    new_balance := current_balance + b.winner_payout;
    paid := true;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + b.winner_payout,
      updated_at = now()
    where p.id = b.winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      b.winner_id,
      'win',
      b.winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );
  end if;

  if paid then
    update public.case_battles
    set payouts_credited = true
    where id = p_battle_id;

    select p.balance into current_balance
    from public.profiles p
    where p.id = p_user_id;

    return query select current_balance, true;
    return;
  end if;

  return query select current_balance, false;
end;
$$;

revoke all on function public.apply_case_battle_payouts(uuid, uuid) from public;
grant execute on function public.apply_case_battle_payouts(uuid, uuid) to service_role;
