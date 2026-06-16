-- Case Battles (cases.gg-style): PvP loot case opens, highest total wins the pot

create table if not exists public.case_battles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  case_id text not null,
  rounds int not null check (rounds >= 1 and rounds <= 5),
  max_players int not null check (max_players in (2, 3, 4)),
  vs_bot boolean not null default false,
  entry_cost numeric(12, 2) not null check (entry_cost > 0),
  pot_total numeric(12, 2) not null default 0,
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'completed', 'cancelled')),
  winner_id uuid references auth.users (id),
  winner_slot int,
  winner_payout numeric(12, 2) not null default 0,
  battle_seed text,
  battle_seed_hash text,
  results jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists case_battles_status_created_idx
  on public.case_battles (status, created_at desc);

create index if not exists case_battles_creator_idx
  on public.case_battles (creator_id, created_at desc);

create table if not exists public.case_battle_players (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.case_battles (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  is_bot boolean not null default false,
  slot_index int not null check (slot_index >= 0 and slot_index <= 3),
  display_name text not null default 'Player',
  total_value numeric(12, 2) not null default 0,
  round_drops jsonb not null default '[]'::jsonb,
  joined_at timestamptz not null default now(),
  unique (battle_id, slot_index),
  unique (battle_id, user_id)
);

create index if not exists case_battle_players_battle_idx
  on public.case_battle_players (battle_id);

alter table public.case_battles enable row level security;
alter table public.case_battle_players enable row level security;

drop policy if exists "Anyone read case battles" on public.case_battles;
create policy "Anyone read case battles"
  on public.case_battles for select
  using (true);

drop policy if exists "Anyone read case battle players" on public.case_battle_players;
create policy "Anyone read case battle players"
  on public.case_battle_players for select
  using (true);

grant select on public.case_battles to authenticated;
grant select on public.case_battle_players to authenticated;
grant all on public.case_battles to service_role;
grant all on public.case_battle_players to service_role;

create or replace function public.create_case_battle_entry(
  p_user_id uuid,
  p_battle_id uuid,
  p_slot_index int,
  p_entry_cost numeric,
  p_display_name text default 'Player'
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  wager_at timestamptz := clock_timestamp();
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not open for joins';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.user_id = p_user_id
  ) then
    raise exception 'Already in this battle';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_entry_cost then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_entry_cost;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_entry_cost,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.case_battle_players (
    battle_id, user_id, is_bot, slot_index, display_name
  )
  values (
    p_battle_id, p_user_id, false, p_slot_index, coalesce(nullif(trim(p_display_name), ''), 'Player')
  );

  update public.case_battles
  set pot_total = pot_total + p_entry_cost
  where id = p_battle_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_entry_cost, new_balance, 'Case battle entry', wager_at);

  return query select new_balance;
end;
$$;

revoke all on function public.create_case_battle_entry(uuid, uuid, int, numeric, text) from public;
grant execute on function public.create_case_battle_entry(uuid, uuid, int, numeric, text) to service_role;

create or replace function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, 'House Bot');
end;
$$;

revoke all on function public.insert_case_battle_bot(uuid, int) from public;
grant execute on function public.insert_case_battle_bot(uuid, int) to service_role;

create or replace function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb
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

revoke all on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb) from public;
grant execute on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb) to service_role;

create or replace function public.mark_case_battle_running(
  p_battle_id uuid,
  p_battle_seed_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_battles
  set
    status = 'running',
    battle_seed_hash = p_battle_seed_hash,
    started_at = now()
  where id = p_battle_id and status = 'waiting';
end;
$$;

revoke all on function public.mark_case_battle_running(uuid, text) from public;
grant execute on function public.mark_case_battle_running(uuid, text) to service_role;

drop function if exists public.get_open_case_battles(int);

create or replace function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  rounds int,
  max_players int,
  vs_bot boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
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
    b.rounds,
    b.max_players,
    b.vs_bot,
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id and not p.is_bot),
    b.created_at
  from public.case_battles b
  where b.status = 'waiting'
    and not b.vs_bot
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;

create or replace function public.get_case_battle_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_case_battle_pf_state() to authenticated;

create or replace function public.set_case_battle_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_case_battle_client_seed(text) to authenticated;
