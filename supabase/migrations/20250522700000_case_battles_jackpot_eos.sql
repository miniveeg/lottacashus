-- Second EOS commitment for jackpot winner selection

alter table public.case_battles
  add column if not exists jackpot_eos_commit_block_num bigint,
  add column if not exists jackpot_eos_target_block_num bigint,
  add column if not exists jackpot_eos_block_num bigint,
  add column if not exists jackpot_eos_block_id text;

alter table public.case_battles drop constraint if exists case_battles_status_check;

alter table public.case_battles
  add constraint case_battles_status_check
  check (status in ('waiting', 'pending_eos', 'running', 'pending_jackpot_eos', 'completed', 'cancelled'));

drop function if exists public.get_open_case_battles(int);

create or replace function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  crazy_mode boolean,
  fast_spin boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  status text,
  completed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    coalesce(b.crazy_mode, false),
    coalesce(b.fast_spin, false),
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'pending_eos', 'pending_jackpot_eos', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case
      when b.status = 'waiting' then 0
      when b.status = 'pending_eos' then 1
      when b.status = 'pending_jackpot_eos' then 2
      when b.status = 'running' then 3
      else 4
    end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;

-- Allow completing from pending_jackpot_eos (rounds staged, jackpot resolved)
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
    return query select null::numeric;
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
  where id = p_battle_id and status in ('waiting', 'running', 'pending_eos', 'pending_jackpot_eos');

  if not found then
    select b.status into battle_status
    from public.case_battles b
    where b.id = p_battle_id;

    if battle_status = 'completed' then
      return query select null::numeric;
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
