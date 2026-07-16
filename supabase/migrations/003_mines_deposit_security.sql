-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Mines coin-type authority + deposit limit units (Phase 003)
-- ══════════════════════════════════════════════════════════════════════════════
begin;

-- ── Mines cashout must credit the game's stored coin_type only ───────────────
-- Previously the client could pass a different p_coin_type (e.g. start in GC,
-- switch topbar to SC, cash out → credit SC while GC was debited).
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

  -- Authoritative coin type is the one recorded when the game started.
  coin := coalesce(nullif(g.coin_type, ''), 'balance');
  if coin not in ('balance', 'sweeps_coins') then
    coin := 'balance';
  end if;
  -- Ignore client p_coin_type (kept for signature compatibility).

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


-- Expose coin_type on active-game resume so the client can lock currency.
drop function if exists public.get_active_mines_game(uuid) cascade;
drop function if exists public.get_my_active_mines_game() cascade;

create or replace function public.get_active_mines_game(p_user_id uuid)
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text,
  coin_type text
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
    g.status,
    g.coin_type
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
  status text,
  coin_type text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select * from public.get_active_mines_game(auth.uid());
end;
$$;
revoke all on function public.get_my_active_mines_game() from public;
grant execute on function public.get_my_active_mines_game() to authenticated;


-- ── Deposit limits: compare USD against USD ──────────────────────────────────
-- Previously summed transactions.amount (GC = usd * 100) against a USD limit
-- which made enforcement ~100× too strict. Now sum crypto_deposits.usd_amount
-- for the same calendar day / week window used by get_deposit_limits.
create or replace function public.credit_crypto_deposit(
  p_user_id uuid,
  p_usd_amount numeric,
  p_chain text,
  p_tx_hash text,
  p_crypto_amount numeric,
  p_exchange_rate numeric,
  p_deposit_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12, 2);
  bonus_sc numeric(12, 2);
  new_sc numeric(12, 2);
  gc_amount numeric(12, 2);
  v_daily_limit numeric(12, 2);
  v_weekly_limit numeric(12, 2);
  v_today_total numeric(12, 2);
  v_week_total numeric(12, 2);
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  select daily_deposit_limit, weekly_deposit_limit
    into v_daily_limit, v_weekly_limit
    from public.profiles where id = p_user_id;

  if v_daily_limit is not null then
    select coalesce(sum(usd_amount), 0) into v_today_total
      from public.crypto_deposits
      where user_id = p_user_id
        and status in ('credited', 'swept')
        and coalesce(credited_at, created_at) >= date_trunc('day', now())
        and id <> p_deposit_id;
    if v_today_total + p_usd_amount > v_daily_limit then
      update public.crypto_deposits set status = 'confirmed', credited_at = null where id = p_deposit_id;
      raise exception 'Daily deposit limit ($% reached). This deposit was not credited. Try again after midnight.',
        v_daily_limit;
    end if;
  end if;

  if v_weekly_limit is not null then
    select coalesce(sum(usd_amount), 0) into v_week_total
      from public.crypto_deposits
      where user_id = p_user_id
        and status in ('credited', 'swept')
        and coalesce(credited_at, created_at) >= date_trunc('week', now())
        and id <> p_deposit_id;
    if v_week_total + p_usd_amount > v_weekly_limit then
      update public.crypto_deposits set status = 'confirmed', credited_at = null where id = p_deposit_id;
      raise exception 'Weekly deposit limit ($% reached). This deposit was not credited.',
        v_weekly_limit;
    end if;
  end if;

  -- 100 GC = $1 USD
  gc_amount := p_usd_amount * 100;

  -- Bonus SC: 1 SC per $1 deposited
  bonus_sc := floor(p_usd_amount);

  perform public.bypass_profile_balance_guard();

  update public.profiles
  set
    balance = balance + gc_amount,
    sweeps_coins = sweeps_coins + bonus_sc,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance, sweeps_coins into new_balance, new_sc;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'deposit', gc_amount, new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '… — ' || gc_amount || ' GC'
  );

  if bonus_sc > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id, 'bonus', bonus_sc, new_sc,
      bonus_sc || ' SC bonus from ' || upper(p_chain) || ' deposit ($' || p_usd_amount || ')'
    );
  end if;
end;
$$;

commit;
