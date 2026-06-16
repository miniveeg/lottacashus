-- Withdrawals must deduct balance immediately. The profiles balance guard trigger
-- was reverting balance changes from security-definer RPCs called as authenticated.

create or replace function public.bypass_profile_balance_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.bypass_profile_balance_guard', '1', true);
end;
$$;

revoke all on function public.bypass_profile_balance_guard() from public;
grant execute on function public.bypass_profile_balance_guard() to authenticated, service_role;

create or replace function public.profiles_prevent_balance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.balance is distinct from OLD.balance then
    if auth.uid() is not null
       and coalesce(current_setting('app.bypass_profile_balance_guard', true), '') <> '1' then
      NEW.balance := OLD.balance;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

create or replace function public.request_crypto_withdrawal(
  p_chain text,
  p_destination text,
  p_usd_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_balance numeric(12, 2);
  wid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_usd_amount < 10 then
    raise exception 'Minimum withdrawal is $10';
  end if;

  if p_chain not in ('sol', 'ltc', 'eth') then
    raise exception 'Invalid chain';
  end if;

  if nullif(trim(p_destination), '') is null then
    raise exception 'Destination address is required';
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into current_balance
  from public.profiles p
  where p.id = uid
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_usd_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.profiles
  set
    balance = balance - p_usd_amount,
    total_withdrawn = total_withdrawn + p_usd_amount,
    updated_at = now()
  where id = uid;

  insert into public.crypto_withdrawals (user_id, chain, destination_address, usd_amount, status)
  values (uid, p_chain, trim(p_destination), p_usd_amount, 'pending')
  returning id into wid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    uid,
    'withdrawal',
    -p_usd_amount,
    current_balance - p_usd_amount,
    upper(p_chain) || ' withdrawal pending'
  );

  perform public.create_user_notification(
    uid,
    'withdrawal_started',
    'Withdrawal started',
    format(
      '$%s %s withdrawal to %s… is pending.',
      trim(to_char(p_usd_amount, 'FM999,999,990.00')),
      upper(p_chain),
      left(trim(p_destination), 8)
    ),
    jsonb_build_object('withdrawal_id', wid, 'chain', p_chain, 'usd_amount', p_usd_amount)
  );

  return wid;
end;
$$;

grant execute on function public.request_crypto_withdrawal(text, text, numeric) to authenticated;

create or replace function public.admin_fail_crypto_withdrawal(
  p_withdrawal_id uuid,
  p_error_message text default 'Withdrawal could not be completed.'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.crypto_withdrawals%rowtype;
  msg text := coalesce(nullif(trim(p_error_message), ''), 'Withdrawal could not be completed.');
  new_balance numeric(12, 2);
begin
  perform public.require_admin();

  select * into w from public.crypto_withdrawals where id = p_withdrawal_id for update;

  if not found then
    raise exception 'Withdrawal not found';
  end if;

  if w.status not in ('pending', 'processing') then
    raise exception 'Withdrawal is not pending (status: %)', w.status;
  end if;

  perform public.bypass_profile_balance_guard();

  update public.profiles
  set
    balance = balance + w.usd_amount,
    total_withdrawn = greatest(0, total_withdrawn - w.usd_amount),
    updated_at = now()
  where id = w.user_id
  returning balance into new_balance;

  update public.crypto_withdrawals
  set
    status = 'failed',
    error_message = msg,
    completed_at = now()
  where id = p_withdrawal_id;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    w.user_id,
    'deposit',
    w.usd_amount,
    new_balance,
    upper(w.chain) || ' withdrawal refunded'
  );
end;
$$;

-- Withdrawals must go through the RPC (which locks balance), not direct inserts.
drop policy if exists "Users insert own withdrawals" on public.crypto_withdrawals;
revoke insert on public.crypto_withdrawals from authenticated;

-- Backfill: deduct balance for pending withdrawals that were never charged.
do $$
declare
  r record;
  current_balance numeric(12, 2);
begin
  for r in
    select w.id, w.user_id, w.usd_amount, w.chain, w.created_at
    from public.crypto_withdrawals w
    where w.status in ('pending', 'processing')
      and not exists (
        select 1
        from public.transactions t
        where t.user_id = w.user_id
          and t.type = 'withdrawal'
          and t.amount = -w.usd_amount
          and t.created_at >= w.created_at - interval '1 minute'
          and t.created_at <= w.created_at + interval '1 minute'
      )
  loop
    perform public.bypass_profile_balance_guard();

    select p.balance into current_balance
    from public.profiles p
    where p.id = r.user_id
    for update;

    if current_balance is not null and current_balance >= r.usd_amount then
      update public.profiles
      set
        balance = balance - r.usd_amount,
        total_withdrawn = total_withdrawn + r.usd_amount,
        updated_at = now()
      where id = r.user_id;

      insert into public.transactions (user_id, type, amount, balance_after, description)
      values (
        r.user_id,
        'withdrawal',
        -r.usd_amount,
        current_balance - r.usd_amount,
        upper(r.chain) || ' withdrawal pending (backfill)'
      );
    end if;
  end loop;
end;
$$;
