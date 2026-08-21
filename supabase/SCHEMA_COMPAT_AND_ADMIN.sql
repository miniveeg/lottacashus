-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — SCHEMA_COMPAT_AND_ADMIN.sql
--
-- Fixes errors like:
--   "column d.usd_amount does not exist"
--   "Could not find the function public.admin_get_stats"
--
-- Why: the live DB may be based on FINAL_SCHEMA67 (expected_amount / amount)
-- while the app + complete-setup expect usd_amount / crypto_amount.
--
-- This script:
--   1) Adds any missing columns the frontend/admin RPCs need
--   2) Backfills them from older column names when present
--   3) Recreates admin RPCs using safe to_jsonb() field access
--
-- Paste into Supabase → SQL Editor → Run once.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. crypto_deposits — ensure columns the app expects
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.crypto_deposits') is null then
    raise notice 'crypto_deposits missing — skip column compat';
    return;
  end if;

  -- usd_amount
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_deposits' and column_name='usd_amount'
  ) then
    alter table public.crypto_deposits add column usd_amount numeric(12,2);
    -- backfill from FINAL-style columns
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='expected_amount') then
      execute 'update public.crypto_deposits set usd_amount = coalesce(usd_amount, expected_amount, 0)';
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_deposits' and column_name='credited') then
      execute 'update public.crypto_deposits set usd_amount = coalesce(usd_amount, credited, 0)';
    else
      update public.crypto_deposits set usd_amount = 0 where usd_amount is null;
    end if;
    alter table public.crypto_deposits alter column usd_amount set default 0;
    -- make not null if safe
    update public.crypto_deposits set usd_amount = 0 where usd_amount is null;
    begin
      alter table public.crypto_deposits alter column usd_amount set not null;
    exception when others then null;
    end;
  end if;

  -- crypto_amount
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_deposits' and column_name='crypto_amount'
  ) then
    alter table public.crypto_deposits add column crypto_amount numeric(24,12) default 0;
    update public.crypto_deposits set crypto_amount = 0 where crypto_amount is null;
  end if;

  -- exchange_rate
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_deposits' and column_name='exchange_rate'
  ) then
    alter table public.crypto_deposits add column exchange_rate numeric(18,8) default 0;
  end if;

  -- tx_hash (FINAL allows null; app expects text)
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_deposits' and column_name='tx_hash'
  ) then
    alter table public.crypto_deposits add column tx_hash text;
  end if;

  -- address
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_deposits' and column_name='address'
  ) then
    alter table public.crypto_deposits add column address text default '';
  end if;

  -- confirmations
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_deposits' and column_name='confirmations'
  ) then
    alter table public.crypto_deposits add column confirmations int not null default 0;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. crypto_withdrawals — ensure usd_amount exists (FINAL used "amount")
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.crypto_withdrawals') is null then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_withdrawals' and column_name='usd_amount'
  ) then
    alter table public.crypto_withdrawals add column usd_amount numeric(12,2);
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='amount') then
      execute 'update public.crypto_withdrawals set usd_amount = coalesce(usd_amount, amount, 0)';
    else
      update public.crypto_withdrawals set usd_amount = 0 where usd_amount is null;
    end if;
    update public.crypto_withdrawals set usd_amount = 0 where usd_amount is null;
    begin
      alter table public.crypto_withdrawals alter column usd_amount set not null;
    exception when others then null;
    end;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_withdrawals' and column_name='destination_address'
  ) then
    alter table public.crypto_withdrawals add column destination_address text default '';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_withdrawals' and column_name='error_message'
  ) then
    -- FINAL used "notes"
    alter table public.crypto_withdrawals add column error_message text;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='notes') then
      execute 'update public.crypto_withdrawals set error_message = notes where error_message is null';
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crypto_withdrawals' and column_name='created_at'
  ) then
    alter table public.crypto_withdrawals add column created_at timestamptz not null default now();
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_withdrawals' and column_name='requested_at') then
      execute 'update public.crypto_withdrawals set created_at = coalesce(requested_at, now())';
    end if;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Admin helpers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_current_user_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.require_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'Admin only.';
  end if;
end;
$$;

grant execute on function public.is_current_user_admin() to authenticated, service_role;
grant execute on function public.require_admin() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop + recreate admin RPCs (adaptive column access)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.admin_get_stats() cascade;
drop function if exists public.admin_list_withdrawals(text) cascade;
drop function if exists public.admin_list_recent_deposits(int) cascade;
drop function if exists public.admin_search_users(text) cascade;
drop function if exists public.admin_set_user_admin(uuid, boolean) cascade;
drop function if exists public.admin_list_redemptions(text) cascade;
drop function if exists public.admin_process_redemption(uuid, text, text) cascade;

-- admin_get_stats
create function public.admin_get_stats()
returns table (
  pending_withdrawals bigint,
  pending_withdrawals_usd numeric,
  total_users bigint,
  credited_deposits_24h bigint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_pending bigint := 0;
  v_pending_usd numeric := 0;
  v_users bigint := 0;
  v_deps bigint := 0;
begin
  perform public.require_admin();

  select count(*)::bigint into v_users from public.profiles;

  if to_regclass('public.redemptions') is not null then
    select count(*)::bigint, coalesce(sum(usd_amount), 0)
      into v_pending, v_pending_usd
      from public.redemptions where status = 'pending';
  elsif to_regclass('public.crypto_withdrawals') is not null then
    execute $q$
      select count(*)::bigint,
             coalesce(sum(
               coalesce(
                 (to_jsonb(w)->>'usd_amount')::numeric,
                 (to_jsonb(w)->>'amount')::numeric,
                 0
               )
             ), 0)
        from public.crypto_withdrawals w
       where w.status = 'pending'
    $q$ into v_pending, v_pending_usd;
  end if;

  if to_regclass('public.crypto_deposits') is not null then
    execute $q$
      select count(*)::bigint
        from public.crypto_deposits d
       where d.status = 'credited'
         and coalesce(d.credited_at, d.created_at) >= now() - interval '24 hours'
    $q$ into v_deps;
  end if;

  return query select v_pending, coalesce(v_pending_usd,0), v_users, coalesce(v_deps,0);
end;
$$;
grant execute on function public.admin_get_stats() to authenticated;

-- admin_list_recent_deposits
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
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_admin();
  if to_regclass('public.crypto_deposits') is null then
    return;
  end if;

  return query execute format($q$
    select
      d.id,
      d.user_id,
      p.username,
      d.chain,
      coalesce(
        (to_jsonb(d)->>'usd_amount')::numeric,
        (to_jsonb(d)->>'expected_amount')::numeric,
        (to_jsonb(d)->>'credited')::numeric,
        0
      ),
      (to_jsonb(d)->>'tx_hash'),
      d.credited_at
    from public.crypto_deposits d
    join public.profiles p on p.id = d.user_id
    where d.status = 'credited'
    order by d.credited_at desc nulls last
    limit %s
  $q$, greatest(1, least(coalesce(p_limit, 15), 50)));
end;
$$;
grant execute on function public.admin_list_recent_deposits(int) to authenticated;

-- admin_list_withdrawals
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
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_admin();
  if to_regclass('public.crypto_withdrawals') is null then
    return;
  end if;

  return query execute $q$
    select
      w.id,
      w.user_id,
      p.username,
      p.email,
      p.sweeps_coins,
      w.chain,
      coalesce(to_jsonb(w)->>'destination_address', ''),
      coalesce(
        (to_jsonb(w)->>'usd_amount')::numeric,
        (to_jsonb(w)->>'amount')::numeric,
        0
      ),
      w.status,
      to_jsonb(w)->>'tx_hash',
      coalesce(to_jsonb(w)->>'error_message', to_jsonb(w)->>'notes'),
      coalesce(
        (to_jsonb(w)->>'created_at')::timestamptz,
        (to_jsonb(w)->>'requested_at')::timestamptz,
        now()
      )
    from public.crypto_withdrawals w
    join public.profiles p on p.id = w.user_id
    where
      case
        when $1 = 'pending' then w.status in ('pending', 'processing')
        when $1 = 'all' then true
        else w.status = $1
      end
    order by coalesce(
      (to_jsonb(w)->>'created_at')::timestamptz,
      (to_jsonb(w)->>'requested_at')::timestamptz,
      now()
    ) desc
    limit 100
  $q$ using p_status;
end;
$$;
grant execute on function public.admin_list_withdrawals(text) to authenticated;

-- admin_search_users
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
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select
    p.id, p.username, p.email,
    p.sweeps_coins, p.sweeps_coins,
    p.is_admin, p.created_at
  from public.profiles p
  where p_query is null or p_query = ''
     or p.username ilike '%' || p_query || '%'
     or p.email ilike '%' || p_query || '%'
     or p.id::text = p_query
  order by p.created_at desc
  limit 20;
end;
$$;
grant execute on function public.admin_search_users(text) to authenticated;

-- admin_set_user_admin
create function public.admin_set_user_admin(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_admin();
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own admin status';
  end if;
  update public.profiles set is_admin = p_is_admin, updated_at = now() where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;
grant execute on function public.admin_set_user_admin(uuid, boolean) to authenticated;

-- admin_list_redemptions
create function public.admin_list_redemptions(p_status text default 'pending')
returns table (
  id uuid, user_id uuid, username text, email text,
  sc_amount numeric, usd_amount numeric, chain text,
  destination_address text, status text, tx_hash text,
  error_message text, sweeps_coins numeric, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_admin();
  if to_regclass('public.redemptions') is null then return; end if;
  return query
  select r.id, r.user_id, p.username, p.email,
         r.sc_amount, r.usd_amount, r.chain,
         r.destination_address, r.status, r.tx_hash,
         r.error_message, p.sweeps_coins, r.created_at
  from public.redemptions r
  join public.profiles p on p.id = r.user_id
  where (p_status = 'all' or r.status = p_status)
  order by r.created_at desc;
end;
$$;
grant execute on function public.admin_list_redemptions(text) to authenticated;

-- admin_process_redemption
create function public.admin_process_redemption(
  p_redemption_id uuid,
  p_status text,
  p_tx_hash text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.redemptions%rowtype;
  v_bal numeric;
begin
  perform public.require_admin();
  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid status. Use completed or failed.';
  end if;
  if to_regclass('public.redemptions') is null then
    raise exception 'Redemptions table not found.';
  end if;

  select * into v_row from public.redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Redemption not found.'; end if;
  if v_row.status <> 'pending' then raise exception 'Redemption already processed.'; end if;

  if p_status = 'completed' then
    update public.redemptions
    set status = 'completed',
        tx_hash = coalesce(p_tx_hash, tx_hash),
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id;
  else
    begin
      perform public.bypass_profile_balance_guard();
    exception when undefined_function then null;
    end;

    update public.profiles
    set sweeps_coins = sweeps_coins + v_row.sc_amount,
        total_withdrawn = greatest(0, coalesce(total_withdrawn,0) - coalesce(v_row.usd_amount,0)),
        updated_at = now()
    where id = v_row.user_id;

    select sweeps_coins into v_bal from public.profiles where id = v_row.user_id;

    begin
      insert into public.transactions (user_id, type, amount, balance_after, description)
      values (v_row.user_id, 'redemption_refund', v_row.usd_amount, v_bal,
              'SC redemption refund');
    exception when others then null;
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

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select * from public.admin_get_stats();
--   select * from public.admin_list_recent_deposits(5);
