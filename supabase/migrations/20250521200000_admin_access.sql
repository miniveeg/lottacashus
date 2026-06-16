-- Admin access: is_admin flag, escalation guard, admin RPCs

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

-- Users cannot grant themselves admin via profile update
create or replace function public.profiles_prevent_admin_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.is_admin is distinct from OLD.is_admin then
    if auth.uid() is not null and auth.uid() = OLD.id then
      NEW.is_admin := OLD.is_admin;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists profiles_guard_admin on public.profiles;
create trigger profiles_guard_admin
  before update on public.profiles
  for each row execute function public.profiles_prevent_admin_escalation();

create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admin access required';
  end if;
end;
$$;

revoke all on function public.require_admin() from public;

-- Dashboard stats
create or replace function public.admin_get_stats()
returns table (
  pending_withdrawals bigint,
  pending_withdrawals_usd numeric,
  total_users bigint,
  credited_deposits_24h bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    (select count(*)::bigint from public.crypto_withdrawals w where w.status = 'pending'),
    coalesce((select sum(w.usd_amount) from public.crypto_withdrawals w where w.status = 'pending'), 0),
    (select count(*)::bigint from public.profiles),
    (
      select count(*)::bigint
      from public.crypto_deposits d
      where d.status = 'credited'
        and d.credited_at >= now() - interval '24 hours'
    );
end;
$$;

grant execute on function public.admin_get_stats() to authenticated;

-- Pending / in-flight withdrawals with user info
create or replace function public.admin_list_withdrawals(p_status text default 'pending')
returns table (
  id uuid,
  user_id uuid,
  username text,
  email text,
  user_balance numeric,
  chain text,
  destination_address text,
  usd_amount numeric,
  status text,
  tx_hash text,
  error_message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    w.id,
    w.user_id,
    p.username,
    p.email,
    p.balance,
    w.chain,
    w.destination_address,
    w.usd_amount,
    w.status,
    w.tx_hash,
    w.error_message,
    w.created_at
  from public.crypto_withdrawals w
  join public.profiles p on p.id = w.user_id
  where
    case
      when p_status = 'pending' then w.status in ('pending', 'processing')
      when p_status = 'all' then true
      else w.status = p_status
    end
  order by w.created_at desc
  limit 100;
end;
$$;

grant execute on function public.admin_list_withdrawals(text) to authenticated;

-- Recent credited deposits
create or replace function public.admin_list_recent_deposits(p_limit int default 15)
returns table (
  id uuid,
  user_id uuid,
  username text,
  chain text,
  usd_amount numeric,
  tx_hash text,
  credited_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    d.id,
    d.user_id,
    p.username,
    d.chain,
    d.usd_amount,
    d.tx_hash,
    d.credited_at
  from public.crypto_deposits d
  join public.profiles p on p.id = d.user_id
  where d.status = 'credited'
  order by d.credited_at desc nulls last
  limit greatest(1, least(p_limit, 50));
end;
$$;

grant execute on function public.admin_list_recent_deposits(int) to authenticated;

-- Mark withdrawal sent on-chain
create or replace function public.admin_complete_crypto_withdrawal(
  p_withdrawal_id uuid,
  p_tx_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.crypto_withdrawals%rowtype;
begin
  perform public.require_admin();

  if nullif(trim(p_tx_hash), '') is null then
    raise exception 'Transaction hash is required';
  end if;

  select * into w from public.crypto_withdrawals where id = p_withdrawal_id for update;

  if not found then
    raise exception 'Withdrawal not found';
  end if;

  if w.status not in ('pending', 'processing') then
    raise exception 'Withdrawal is not pending (status: %)', w.status;
  end if;

  update public.crypto_withdrawals
  set
    status = 'completed',
    tx_hash = trim(p_tx_hash),
    completed_at = now()
  where id = p_withdrawal_id;
end;
$$;

grant execute on function public.admin_complete_crypto_withdrawal(uuid, text) to authenticated;

-- Fail withdrawal and refund balance
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
begin
  perform public.require_admin();

  select * into w from public.crypto_withdrawals where id = p_withdrawal_id for update;

  if not found then
    raise exception 'Withdrawal not found';
  end if;

  if w.status not in ('pending', 'processing') then
    raise exception 'Withdrawal is not pending (status: %)', w.status;
  end if;

  update public.profiles
  set
    balance = balance + w.usd_amount,
    total_withdrawn = greatest(0, total_withdrawn - w.usd_amount),
    updated_at = now()
  where id = w.user_id;

  update public.crypto_withdrawals
  set
    status = 'failed',
    error_message = msg,
    completed_at = now()
  where id = p_withdrawal_id;
end;
$$;

grant execute on function public.admin_fail_crypto_withdrawal(uuid, text) to authenticated;

-- Search users (grant/revoke admin, support lookup)
create or replace function public.admin_search_users(p_query text)
returns table (
  id uuid,
  username text,
  email text,
  balance numeric,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  perform public.require_admin();

  if length(q) < 2 then
    raise exception 'Search query must be at least 2 characters';
  end if;

  return query
  select
    p.id,
    p.username,
    p.email,
    p.balance,
    p.is_admin,
    p.created_at
  from public.profiles p
  where
    p.username ilike '%' || q || '%'
    or p.email ilike '%' || q || '%'
    or p.id::text = q
  order by p.created_at desc
  limit 25;
end;
$$;

grant execute on function public.admin_search_users(text) to authenticated;

-- Grant or revoke admin (cannot change own admin flag)
create or replace function public.admin_set_user_admin(
  p_user_id uuid,
  p_is_admin boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own admin status';
  end if;

  update public.profiles
  set is_admin = p_is_admin, updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

grant execute on function public.admin_set_user_admin(uuid, boolean) to authenticated;
