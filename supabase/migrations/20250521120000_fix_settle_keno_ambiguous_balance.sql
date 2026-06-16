-- Fix: RETURNS TABLE column "balance" shadowed profiles.balance in settle_keno_bet
-- Must drop first: PostgreSQL cannot change OUT/return row type via CREATE OR REPLACE.

drop function if exists public.settle_keno_bet(
  uuid,
  numeric,
  text,
  integer[],
  integer[],
  integer,
  numeric,
  numeric,
  bigint
);

create function public.settle_keno_bet(  p_user_id uuid,
  p_wager numeric,
  p_risk text,
  p_picks int[],
  p_drawn int[],
  p_hits int,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint
)
returns table (
  out_balance numeric,
  bet_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  wid uuid;
begin
  if p_risk not in ('classic', 'low', 'medium', 'high') then
    raise exception 'Invalid risk';
  end if;

  if array_length(p_picks, 1) is null or array_length(p_picks, 1) < 1 or array_length(p_picks, 1) > 10 then
    raise exception 'Select 1 to 10 numbers';
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

  new_balance := current_balance - p_wager + p_payout;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
    total_losses = total_losses + case when p_payout < p_wager then p_wager - p_payout else 0 end,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.keno_bets (
    user_id, wager, risk, picks, drawn, hits, multiplier, payout, nonce
  )
  values (
    p_user_id, p_wager, p_risk, p_picks, p_drawn, p_hits, p_multiplier, p_payout, p_nonce
  )
  returning id into wid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager, 'Keno bet');

  if p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Keno ' || p_hits || '/' || array_length(p_picks, 1) || ' @ ' || trim(to_char(p_multiplier, 'FM999990.9999')) || 'x'
    );
  elsif p_payout = 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id,
      'loss',
      -(p_wager),
      new_balance,
      'Keno ' || p_hits || '/' || array_length(p_picks, 1) || ' — no payout'
    );
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, wid;
end;
$$;

revoke all on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint) from public;
grant execute on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint) to service_role;
