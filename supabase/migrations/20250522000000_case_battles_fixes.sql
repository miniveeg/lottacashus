-- Case battles: allow up to 10 rounds, safer bot insert, multi-winner payouts

drop function if exists public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb);

alter table public.case_battles
  drop constraint if exists case_battles_rounds_check;

alter table public.case_battles
  add constraint case_battles_rounds_check
  check (rounds >= 1 and rounds <= 10);

create or replace function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not waiting for players';
  end if;

  if p_slot_index < 0 or p_slot_index >= b.max_players then
    raise exception 'Invalid slot';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, 'House Bot');
end;
$$;

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
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  player_row jsonb;
  payout_row jsonb;
  uid uuid;
  amt numeric(12, 2);
  last_balance numeric(12, 2);
begin
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
  where id = p_battle_id and status in ('waiting', 'running');

  if not found then
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

  if jsonb_array_length(coalesce(p_winner_payouts, '[]'::jsonb)) > 0 then
    for payout_row in select * from jsonb_array_elements(p_winner_payouts)
    loop
      uid := (payout_row->>'userId')::uuid;
      amt := coalesce((payout_row->>'amount')::numeric, 0);
      if uid is null or amt <= 0 then
        continue;
      end if;

      select p.balance into current_balance
      from public.profiles p
      where p.id = uid
      for update;

      new_balance := current_balance + amt;
      last_balance := new_balance;

      update public.profiles p
      set
        balance = new_balance,
        total_wins = total_wins + amt,
        updated_at = now()
      where p.id = uid;

      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (uid, 'win', amt, new_balance, 'Case battle win', outcome_at);
      outcome_at := outcome_at + interval '1 millisecond';
    end loop;

    if last_balance is not null then
      return query select last_balance;
    end if;
    return query select null::numeric;
  end if;

  if p_winner_id is not null and coalesce(p_winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = p_winner_id
    for update;

    new_balance := current_balance + p_winner_payout;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + p_winner_payout,
      updated_at = now()
    where p.id = p_winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_winner_id,
      'win',
      p_winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );

    return query select new_balance;
  end if;

  return query select null::numeric;
end;
$$;

revoke all on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb, jsonb) to service_role;
