-- Mines: RTP via extra bust odds (multipliers stay at 99%). Edge passes p_force_mine when bias triggers.

create or replace function public.mines_reveal_tile(
  p_user_id uuid,
  p_game_id uuid,
  p_tile int,
  p_force_mine boolean default false
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

  is_hit := p_force_mine or p_tile = any (g.mine_tiles);

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
