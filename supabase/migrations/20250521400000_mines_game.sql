-- Mines (Stake-style): session bets on 5×5 grid, provably fair via game_pf_seeds

create table if not exists public.mines_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  mine_count int not null check (mine_count between 1 and 24),
  mine_tiles int[] not null,
  revealed_tiles int[] not null default '{}',
  gems_revealed int not null default 0 check (gems_revealed >= 0),
  multiplier numeric(14, 4) not null default 1,
  payout numeric(12, 2) not null default 0,
  status text not null default 'active'
    check (status in ('active', 'cashed_out', 'busted')),
  nonce bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists mines_games_user_status_idx
  on public.mines_games (user_id, status)
  where status = 'active';

create index if not exists mines_games_user_created_idx
  on public.mines_games (user_id, created_at desc);

alter table public.mines_games enable row level security;

drop policy if exists "Users read own mines games" on public.mines_games;
create policy "Users read own mines games"
  on public.mines_games for select
  using (auth.uid() = user_id);

grant select on public.mines_games to authenticated;
grant all on table public.mines_games to service_role;

-- Start round: lock wager, store mine layout (server-only until bust/cashout)
create or replace function public.start_mines_game(
  p_user_id uuid,
  p_wager numeric,
  p_mine_count int,
  p_mine_tiles int[],
  p_nonce bigint
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
  if p_mine_count < 1 or p_mine_count > 24 then
    raise exception 'Invalid mine count';
  end if;

  if array_length(p_mine_tiles, 1) is distinct from p_mine_count then
    raise exception 'Mine layout mismatch';
  end if;

  if exists (
    select 1 from public.mines_games g
    where g.user_id = p_user_id and g.status = 'active'
  ) then
    raise exception 'Finish your current Mines game first';
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

  new_balance := current_balance - p_wager;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.mines_games (
    user_id, wager, mine_count, mine_tiles, revealed_tiles, gems_revealed,
    multiplier, status, nonce
  )
  values (
    p_user_id, p_wager, p_mine_count, p_mine_tiles, '{}', 0, 1, 'active', p_nonce
  )
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, 'Mines bet (' || p_mine_count || ' mines)', wager_at);

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;

revoke all on function public.start_mines_game(uuid, numeric, int, int[], bigint) from public;
grant execute on function public.start_mines_game(uuid, numeric, int, int[], bigint) to service_role;

-- Reveal a tile
create or replace function public.mines_reveal_tile(
  p_user_id uuid,
  p_game_id uuid,
  p_tile int
)
returns table (
  out_balance numeric,
  game_id uuid,
  tile int,
  is_mine boolean,
  gems_revealed int,
  multiplier numeric,
  status text,
  mine_count int,
  mine_tiles int[],
  payout numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mines_games%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  new_gems int;
  new_mult numeric(14, 4);
  is_hit boolean;
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_tile < 0 or p_tile > 24 then
    raise exception 'Invalid tile';
  end if;

  select * into g
  from public.mines_games
  where id = p_game_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if g.status <> 'active' then
    raise exception 'Game is not active';
  end if;

  if p_tile = any (g.revealed_tiles) then
    raise exception 'Tile already revealed';
  end if;

  is_hit := p_tile = any (g.mine_tiles);

  if is_hit then
    update public.mines_games
    set
      status = 'busted',
      revealed_tiles = array_append(g.revealed_tiles, p_tile),
      completed_at = now()
    where id = g.id;

    select p.balance into current_balance from public.profiles p where p.id = p_user_id;

    update public.profiles p
    set
      total_losses = total_losses + g.wager,
      updated_at = now()
    where p.id = p_user_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -g.wager,
      current_balance,
      'Mines — hit mine',
      outcome_at
    );

    return query
    select
      current_balance,
      g.id,
      p_tile,
      true,
      g.gems_revealed,
      g.multiplier,
      'busted'::text,
      g.mine_count,
      g.mine_tiles,
      0::numeric;
    return;
  end if;

  new_gems := g.gems_revealed + 1;
  new_mult := floor(
    (0.99::numeric
      * public.mines_comb(25, new_gems)
      / public.mines_comb(25 - g.mine_count, new_gems)) * 100
  ) / 100;

  update public.mines_games
  set
    revealed_tiles = array_append(g.revealed_tiles, p_tile),
    gems_revealed = new_gems,
    multiplier = new_mult
  where id = g.id;

  select p.balance into current_balance from public.profiles p where p.id = p_user_id;

  return query
  select
    current_balance,
    g.id,
    p_tile,
    false,
    new_gems,
    new_mult,
    'active'::text,
    g.mine_count,
    null::int[],
    0::numeric;
end;
$$;

-- Combinatorics helper for SQL multiplier (matches client 0.99 × C(25,d)/C(25-m,d))
create or replace function public.mines_comb(n int, r int)
returns numeric
language plpgsql
immutable
as $$
declare
  result numeric := 1;
  i int;
  k int;
begin
  if r < 0 or r > n then
    return 0;
  end if;
  if r = 0 or r = n then
    return 1;
  end if;
  k := least(r, n - r);
  for i in 0..k - 1 loop
    result := result * (n - i) / (i + 1);
  end loop;
  return result;
end;
$$;

revoke all on function public.mines_reveal_tile(uuid, uuid, int) from public;
grant execute on function public.mines_reveal_tile(uuid, uuid, int) to service_role;

-- Cash out
create or replace function public.mines_cashout(
  p_user_id uuid,
  p_game_id uuid
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
  wager_at timestamptz := clock_timestamp();
  win_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  select * into g
  from public.mines_games
  where id = p_game_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if g.status <> 'active' then
    raise exception 'Game is not active';
  end if;

  if g.gems_revealed < 1 then
    raise exception 'Reveal at least one gem before cashing out';
  end if;

  pay := round(g.wager * g.multiplier, 2);

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  new_balance := current_balance + pay;

  update public.profiles p
  set
    balance = new_balance,
    total_wins = total_wins + pay,
    updated_at = now()
  where p.id = p_user_id;

  update public.mines_games
  set
    status = 'cashed_out',
    payout = pay,
    completed_at = now()
  where id = g.id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'win',
    pay,
    new_balance,
    'Mines cashout ' || g.gems_revealed || ' gems @ ' || trim(to_char(g.multiplier, 'FM999990.9999')) || 'x',
    win_at
  );

  return query select new_balance, g.id, pay, g.multiplier, g.gems_revealed, g.wager;
end;
$$;

revoke all on function public.mines_cashout(uuid, uuid) from public;
grant execute on function public.mines_cashout(uuid, uuid) to service_role;

-- Active game for resume (no mine positions)
create or replace function public.get_active_mines_game(p_user_id uuid)
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    g.id,
    g.wager,
    g.mine_count,
    g.revealed_tiles,
    g.gems_revealed,
    g.multiplier,
    g.status
  from public.mines_games g
  where g.user_id = p_user_id and g.status = 'active'
  order by g.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_active_mines_game(uuid) from public;
grant execute on function public.get_active_mines_game(uuid) to service_role;

create or replace function public.get_my_active_mines_game()
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text
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
  select * from public.get_active_mines_game(uid);
end;
$$;

grant execute on function public.get_my_active_mines_game() to authenticated;

-- PF wrappers (reuse keno seed row)
create or replace function public.get_mines_pf_state()
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

grant execute on function public.get_mines_pf_state() to authenticated;

create or replace function public.set_mines_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_mines_client_seed(text) to authenticated;
