-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — ADMIN_RPCS.sql
--
-- Fixes: "Could not find the function public.admin_get_stats without parameters"
--
-- Paste into Supabase → SQL Editor → Run.
-- Drops existing signatures first, then recreates every admin RPC the UI needs.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ── Require admin helper (no-op if already present from FIX_EVERYTHING) ───────
create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admin only.';
  end if;
end;
$$;

revoke all on function public.is_current_user_admin() from public;
revoke all on function public.require_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated, service_role;
grant execute on function public.require_admin() to authenticated, service_role;

-- ── Drop old admin RPCs (avoids return-type conflicts) ───────────────────────
drop function if exists public.admin_get_stats() cascade;
drop function if exists public.admin_list_withdrawals(text) cascade;
drop function if exists public.admin_list_recent_deposits(int) cascade;
drop function if exists public.admin_search_users(text) cascade;
drop function if exists public.admin_set_user_admin(uuid, boolean) cascade;
drop function if exists public.admin_list_redemptions(text) cascade;
drop function if exists public.admin_process_redemption(uuid, text, text) cascade;

-- ── admin_get_stats ───────────────────────────────────────────────────────────
-- Pending count prefers SC redemptions; falls back to crypto_withdrawals if present.
create function public.admin_get_stats()
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
declare
  v_pending bigint := 0;
  v_pending_usd numeric := 0;
  v_users bigint := 0;
  v_deps bigint := 0;
begin
  perform public.require_admin();

  -- Users
  select count(*)::bigint into v_users from public.profiles;

  -- Pending withdrawals / redemptions
  if to_regclass('public.redemptions') is not null then
    select count(*)::bigint,
           coalesce(sum(usd_amount), 0)
      into v_pending, v_pending_usd
      from public.redemptions
     where status = 'pending';
  elsif to_regclass('public.crypto_withdrawals') is not null then
    select count(*)::bigint,
           coalesce(sum(usd_amount), 0)
      into v_pending, v_pending_usd
      from public.crypto_withdrawals
     where status = 'pending';
  end if;

  -- Deposits last 24h
  if to_regclass('public.crypto_deposits') is not null then
    select count(*)::bigint into v_deps
      from public.crypto_deposits d
     where d.status = 'credited'
       and d.credited_at >= now() - interval '24 hours';
  end if;

  return query select v_pending, v_pending_usd, v_users, v_deps;
end;
$$;

grant execute on function public.admin_get_stats() to authenticated;

-- ── admin_list_withdrawals (crypto_withdrawals) ───────────────────────────────
create function public.admin_list_withdrawals(p_status text default 'pending')
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

  if to_regclass('public.crypto_withdrawals') is null then
    return;
  end if;

  return query
  select
    w.id,
    w.user_id,
    p.username,
    p.email,
    p.sweeps_coins,  -- SC-only balance
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

-- ── admin_list_recent_deposits ────────────────────────────────────────────────
create function public.admin_list_recent_deposits(p_limit int default 15)
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

  if to_regclass('public.crypto_deposits') is null then
    return;
  end if;

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
  limit greatest(1, least(coalesce(p_limit, 15), 50));
end;
$$;

grant execute on function public.admin_list_recent_deposits(int) to authenticated;

-- ── admin_search_users ────────────────────────────────────────────────────────
create function public.admin_search_users(p_query text)
returns table (
  id uuid,
  username text,
  email text,
  balance numeric,
  sweeps_coins numeric,
  is_admin boolean,
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
    p.id,
    p.username,
    p.email,
    p.sweeps_coins,  -- expose SC as both fields for UI compatibility
    p.sweeps_coins,
    p.is_admin,
    p.created_at
  from public.profiles p
  where p_query is null
     or p_query = ''
     or p.username ilike '%' || p_query || '%'
     or p.email ilike '%' || p_query || '%'
     or p.id::text = p_query
  order by p.created_at desc
  limit 20;
end;
$$;

grant execute on function public.admin_search_users(text) to authenticated;

-- ── admin_set_user_admin ──────────────────────────────────────────────────────
create function public.admin_set_user_admin(
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

-- ── admin_list_redemptions (SC cash-outs) ─────────────────────────────────────
create function public.admin_list_redemptions(p_status text default 'pending')
returns table (
  id uuid,
  user_id uuid,
  username text,
  email text,
  sc_amount numeric,
  usd_amount numeric,
  chain text,
  destination_address text,
  status text,
  tx_hash text,
  error_message text,
  sweeps_coins numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if to_regclass('public.redemptions') is null then
    return;
  end if;

  return query
  select
    r.id,
    r.user_id,
    p.username,
    p.email,
    r.sc_amount,
    r.usd_amount,
    r.chain,
    r.destination_address,
    r.status,
    r.tx_hash,
    r.error_message,
    p.sweeps_coins,
    r.created_at
  from public.redemptions r
  join public.profiles p on p.id = r.user_id
  where (p_status = 'all' or r.status = p_status)
  order by r.created_at desc;
end;
$$;

grant execute on function public.admin_list_redemptions(text) to authenticated;

-- ── admin_process_redemption ──────────────────────────────────────────────────
create function public.admin_process_redemption(
  p_redemption_id uuid,
  p_status text,
  p_tx_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.redemptions%rowtype;
  v_balance numeric;
begin
  perform public.require_admin();

  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid status. Use completed or failed.';
  end if;

  if to_regclass('public.redemptions') is null then
    raise exception 'Redemptions table not found.';
  end if;

  select * into v_redemption
  from public.redemptions
  where id = p_redemption_id
  for update;

  if not found then
    raise exception 'Redemption not found.';
  end if;
  if v_redemption.status != 'pending' then
    raise exception 'Redemption already processed.';
  end if;

  if p_status = 'completed' then
    update public.redemptions
    set status = 'completed',
        tx_hash = coalesce(p_tx_hash, tx_hash),
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id;
  else
    -- failed → refund SC
    perform public.bypass_profile_balance_guard();

    update public.profiles
    set sweeps_coins = sweeps_coins + v_redemption.sc_amount,
        total_withdrawn = greatest(0, coalesce(total_withdrawn, 0) - coalesce(v_redemption.usd_amount, 0)),
        updated_at = now()
    where id = v_redemption.user_id;

    select sweeps_coins into v_balance
    from public.profiles where id = v_redemption.user_id;

    begin
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        v_redemption.user_id,
        'redemption_refund',
        v_redemption.usd_amount,
        v_balance,
        'SC redemption #' || p_redemption_id || ' failed — SC refunded',
        now()
      );
    exception when others then
      null;
    end;

    update public.redemptions
    set status = 'failed',
        error_message = p_tx_hash,
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id;
  end if;
end;
$$;

grant execute on function public.admin_process_redemption(uuid, text, text) to authenticated;

-- Reload PostgREST schema cache so the new RPCs appear immediately
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select * from public.admin_get_stats();
