-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Single SC balance mode
-- Deposits credit only sweeps_coins at 100 SC per $1 USD.
-- Gold Coins (balance column) are no longer credited on deposit.
-- ══════════════════════════════════════════════════════════════════════════════
begin;

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
  new_sc numeric(12, 2);
  sc_amount numeric(12, 2);
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

  -- Single balance mode: 100 SC = $1 USD. Credit only sweeps_coins.
  sc_amount := p_usd_amount * 100;

  perform public.bypass_profile_balance_guard();

  update public.profiles
  set
    sweeps_coins = sweeps_coins + sc_amount,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning sweeps_coins into new_sc;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'deposit', sc_amount, new_sc,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '… — ' || sc_amount || ' SC'
  );
end;
$$;

revoke all on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) from public;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;

commit;
