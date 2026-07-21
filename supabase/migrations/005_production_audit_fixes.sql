-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Production audit fixes (Phase 005)
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Chat rate-limit trigger reads `body` (not non-existent `message`)
-- 2. Mines games store coin_type; cashout ignores client coin type
-- 3. start_mines_game persists coin_type
-- Idempotent.
-- ══════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 1. Chat trigger: column is body ─────────────────────────────────────────
create or replace function public.enforce_chat_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'Cannot post as another user';
  end if;

  select count(*) into v_recent
  from public.chat_messages
  where user_id = auth.uid()
    and created_at > now() - interval '10 seconds';
  if v_recent >= 3 then
    raise exception 'You are sending messages too quickly. Wait a few seconds.';
  end if;
  if length(coalesce(new.body, '')) > 500 then
    raise exception 'Message too long (max 500 characters).';
  end if;
  if coalesce(trim(new.body), '') = '' then
    raise exception 'Message cannot be empty.';
  end if;
  return new;
end;
$$;

-- ─── 2. Mines coin_type column ───────────────────────────────────────────────
alter table public.mines_games
  add column if not exists coin_type text not null default 'balance';

do $$
begin
  alter table public.mines_games drop constraint if exists mines_games_coin_type_check;
  alter table public.mines_games
    add constraint mines_games_coin_type_check
    check (coin_type in ('balance', 'sweeps_coins'));
exception when others then
  null;
end $$;

-- start_mines_game: store coin_type on the game row
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
  v_coin text := case when p_coin_type = 'sweeps_coins' then 'sweeps_coins' else 'balance' end;
begin
  if p_mine_count < 1 or p_mine_count > 24 then raise exception 'Invalid mine count'; end if;
  if array_length(p_mine_tiles, 1) is distinct from p_mine_count then raise exception 'Mine layout mismatch'; end if;

  if exists (select 1 from public.mines_games g where g.user_id = p_user_id and g.status = 'active') then
    raise exception 'Finish your current Mines game first';
  end if;

  perform public.bypass_profile_balance_guard();

  if v_coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager;

  if v_coin = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, updated_at = now() where id = p_user_id;
  end if;

  insert into public.mines_games (user_id, wager, mine_count, mine_tiles, revealed_tiles, gems_revealed, multiplier, status, nonce, coin_type)
  values (p_user_id, p_wager, p_mine_count, p_mine_tiles, '{}', 0, 1, 'active', p_nonce, v_coin)
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, upper(v_coin) || ' Mines bet (' || p_mine_count || ' mines)', wager_at);

  -- Monotonic nonce only — never rewind below the current next_nonce.
  update public.game_pf_seeds
  set next_nonce = greatest(next_nonce, p_nonce + 1), updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;
revoke all on function public.start_mines_game(uuid, numeric, int, int[], bigint, text) from public;
grant execute on function public.start_mines_game(uuid, numeric, int, int[], bigint, text) to service_role;

-- Patch cashout (already in 003) — ensure coin is read from row:
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
  coin text;
begin
  select * into g from public.mines_games where id = p_game_id and user_id = p_user_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game is not active'; end if;
  if g.gems_revealed < 1 then raise exception 'Reveal at least one gem before cashing out'; end if;

  coin := coalesce(nullif(g.coin_type, ''), 'balance');
  if coin not in ('balance', 'sweeps_coins') then
    coin := 'balance';
  end if;

  pay := round(g.wager * g.multiplier, 2);
  perform public.bypass_profile_balance_guard();

  if coin = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + pay;

  if coin = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = new_balance, total_wins = total_wins + pay, updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set balance = new_balance, total_wins = total_wins + pay, updated_at = now()
    where id = p_user_id;
  end if;

  update public.mines_games set status = 'cashed_out', payout = pay, completed_at = now() where id = g.id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id, 'win', pay, new_balance,
    upper(coin) || ' Mines cashout ' || g.gems_revealed || ' gems @ ' ||
      trim(to_char(g.multiplier, 'FM999990.9999')) || 'x',
    win_at
  );

  return query select new_balance, g.id, pay, g.multiplier, g.gems_revealed, g.wager;
end;
$$;
revoke all on function public.mines_cashout(uuid, uuid, text) from public;
grant execute on function public.mines_cashout(uuid, uuid, text) to service_role;

commit;
