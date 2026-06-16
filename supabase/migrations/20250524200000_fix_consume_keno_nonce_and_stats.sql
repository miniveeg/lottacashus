-- Fix ambiguous consume_keno_nonce(uuid) vs consume_keno_nonce(uuid, int) overload.
-- PostgREST calls with only p_user_id cannot pick between them when p_advance has a default.

drop function if exists public.consume_keno_nonce(uuid);

create or replace function public.consume_keno_nonce(p_user_id uuid, p_advance int default 1)
returns table (
  server_seed text,
  client_seed text,
  nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
  v_advance int;
  v_nonce bigint;
begin
  if p_user_id is null then
    raise exception 'User id required';
  end if;

  v_advance := greatest(coalesce(p_advance, 1), 1);

  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      p_user_id,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  v_nonce := row.next_nonce;

  update public.game_pf_seeds
  set next_nonce = v_nonce + v_advance, updated_at = now()
  where user_id = p_user_id;

  return query
  select row.server_seed, row.client_seed, v_nonce;
end;
$$;

revoke all on function public.consume_keno_nonce(uuid, int) from public;
grant execute on function public.consume_keno_nonce(uuid, int) to service_role;

-- Reconcile profile win/loss totals from the transaction ledger.
with win_sums as (
  select
    user_id,
    coalesce(sum(amount), 0)::numeric(12, 2) as total
  from public.transactions
  where type = 'win' and amount > 0
  group by user_id
),
loss_sums as (
  select
    user_id,
    coalesce(sum(abs(amount)), 0)::numeric(12, 2) as total
  from public.transactions
  where type = 'loss' and amount < 0
  group by user_id
),
case_battle_loss_sums as (
  select
    cp.user_id,
    coalesce(sum(cp.entry_paid), 0)::numeric(12, 2) as total
  from public.case_battle_players cp
  join public.case_battles b on b.id = cp.battle_id
  where b.status = 'completed'
    and b.payouts_credited = true
    and cp.is_bot = false
    and cp.user_id is not null
    and cp.entry_paid > 0
    and (b.winner_id is null or cp.user_id is distinct from b.winner_id)
  group by cp.user_id
),
combined as (
  select user_id from win_sums
  union
  select user_id from loss_sums
  union
  select user_id from case_battle_loss_sums
)
update public.profiles p
set
  total_wins = coalesce(w.total, 0),
  total_losses = coalesce(l.total, 0) + coalesce(cb.total, 0),
  updated_at = now()
from combined c
left join win_sums w on w.user_id = c.user_id
left join loss_sums l on l.user_id = c.user_id
left join case_battle_loss_sums cb on cb.user_id = c.user_id
where p.id = c.user_id;

-- Record case battle losses when payouts are claimed (entry minus any credited win share).
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
  player_row record;
  player_payout numeric(12, 2);
  net_loss numeric(12, 2);
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
    for player_row in
      select cp.user_id, cp.entry_paid
      from public.case_battle_players cp
      where cp.battle_id = p_battle_id
        and cp.is_bot = false
        and cp.user_id is not null
        and cp.entry_paid > 0
    loop
      player_payout := 0;

      if jsonb_array_length(payouts) > 0 then
        select coalesce(sum((elem->>'amount')::numeric), 0)
        into player_payout
        from jsonb_array_elements(payouts) elem
        where coalesce(
          nullif(elem->>'userId', '')::uuid,
          nullif(elem->>'user_id', '')::uuid
        ) = player_row.user_id;
      elsif b.winner_id = player_row.user_id then
        player_payout := coalesce(b.winner_payout, 0);
      end if;

      net_loss := greatest(0, player_row.entry_paid - player_payout);
      if net_loss > 0 then
        update public.profiles p
        set
          total_losses = total_losses + net_loss,
          updated_at = now()
        where p.id = player_row.user_id;
      end if;
    end loop;

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
