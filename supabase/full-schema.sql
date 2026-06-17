-- ===================================================
-- LottaCash - Complete Database Schema
-- Generated: 2026-06-16 23:35
-- Run this ONCE in Supabase Dashboard  SQL Editor
-- ===================================================

-- ===================================================
-- BASE SCHEMA (schema.sql)
-- ===================================================
-- Run this in Supabase → SQL Editor after creating your project.
-- Creates a profile row for each new user (username from signup metadata).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  email text,
  balance numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
drop function if exists public.handle_new_user() cascade;
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Custom signup verification (6-digit code via your SMTP email)
create table if not exists public.signup_verification_codes (
  email text primary key,
  code_hash text not null,
  username text,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.signup_verification_codes disable row level security;

grant all on table public.signup_verification_codes to service_role;
grant all on table public.signup_verification_codes to postgres;

drop function if exists public.email_exists(check_email text) cascade;
create function public.email_exists(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to service_role;

-- ensure_user_profile() + Realtime (see migrations/20250520300000_fix_profiles_balance_live.sql)

drop function if exists public.ensure_user_profile() cascade;
create function public.ensure_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.profiles (id, username, email, balance)
  select
    uid,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    u.email,
    0
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing;
  select * into row from public.profiles where id = uid;
  return row;
end;
$$;

grant execute on function public.ensure_user_profile() to authenticated;

alter table public.profiles replica identity full;

-- Admin: credit a user's balance (for mail-in sweepstakes entry, adjustments, etc.)
create table if not exists public.admin_credit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Responsible gaming: add columns to profiles
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists age_verified boolean not null default false;
alter table public.profiles add column if not exists deposit_limit_daily numeric(12, 2);
alter table public.profiles add column if not exists deposit_limit_weekly numeric(12, 2);
alter table public.profiles add column if not exists deposit_limit_reset_at timestamptz;

-- Self-exclusion table
create table if not exists public.self_exclusions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  duration_days int not null check (duration_days in (30, 90, 180)),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.self_exclusions enable row level security;

create policy "Users can read own self-exclusion"
  on public.self_exclusions for select
  using (auth.uid() = user_id);

create policy "Users can insert own self-exclusion"
  on public.self_exclusions for insert
  with check (auth.uid() = user_id);

-- Session tracking for time reminders
create table if not exists public.game_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

alter table public.game_sessions enable row level security;

create policy "Users can read own sessions"
  on public.game_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.game_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.game_sessions for update
  using (auth.uid() = user_id);


-- ===================================================
-- MIGRATION: 20250520000000_signup_verification_codes.sql
-- ===================================================
-- Custom 6-digit signup verification (replaces Supabase email confirmation)

create table if not exists public.signup_verification_codes (
  email text primary key,
  code_hash text not null,
  username text,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- Edge Functions use the service role; no client access needed
alter table public.signup_verification_codes disable row level security;

grant all on table public.signup_verification_codes to service_role;
grant all on table public.signup_verification_codes to postgres;

drop function if exists public.email_exists(check_email text) cascade;
create function public.email_exists(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to service_role;


-- ===================================================
-- MIGRATION: 20250520100000_fix_verification_codes_permissions.sql
-- ===================================================
-- Run this in Supabase → SQL Editor if signup shows "Could not save verification code"

create table if not exists public.signup_verification_codes (
  email text primary key,
  code_hash text not null,
  username text,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- Internal table: only Edge Functions (service role) use this
alter table public.signup_verification_codes disable row level security;

grant all on table public.signup_verification_codes to service_role;
grant all on table public.signup_verification_codes to postgres;

drop function if exists public.email_exists(check_email text) cascade;
create function public.email_exists(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to service_role;


-- ===================================================
-- MIGRATION: 20250520200000_profiles_realtime.sql
-- ===================================================
-- Live balance updates + prevent users from editing their own balance

-- Add profiles to Realtime (skip if already added)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- Logged-in users cannot change balance; service role / backend can
drop function if exists public.profiles_prevent_balance_change() cascade;
create function public.profiles_prevent_balance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.balance is distinct from OLD.balance then
    if auth.uid() is not null then
      NEW.balance := OLD.balance;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists profiles_guard_balance on public.profiles;

create trigger profiles_guard_balance
  before update on public.profiles
  for each row execute function public.profiles_prevent_balance_change();


-- ===================================================
-- MIGRATION: 20250520300000_fix_profiles_balance_live.sql
-- ===================================================
-- Fix: missing profiles, live balance via Realtime with RLS

-- Backfill profiles for any auth user that doesn't have one
insert into public.profiles (id, username, email, balance)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
  u.email,
  0
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Create profile on demand from the app (logged-in user)
drop function if exists public.ensure_user_profile() cascade;
create function public.ensure_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles (id, username, email, balance)
  select
    uid,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    u.email,
    0
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing;

  select * into row from public.profiles where id = uid;
  return row;
end;
$$;

revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated;

-- Allow users to create their own profile row if trigger missed signup
drop policy if exists "Users can insert own profile" on public.profiles;

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Realtime needs full row data for filtered subscriptions
alter table public.profiles replica identity full;

-- Ensure profiles is in the Realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;


-- ===================================================
-- MIGRATION: 20250520400000_password_reset_codes.sql
-- ===================================================
-- Password reset codes (6-digit email, 10 min expiry)

create table if not exists public.password_reset_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.password_reset_codes disable row level security;

grant all on table public.password_reset_codes to service_role;
grant all on table public.password_reset_codes to postgres;

drop function if exists public.get_user_id_by_email(check_email text) cascade;
create function public.get_user_id_by_email(check_email text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(check_email)) limit 1;
$$;

revoke all on function public.get_user_id_by_email(text) from public;
grant execute on function public.get_user_id_by_email(text) to service_role;


-- ===================================================
-- MIGRATION: 20250520500000_settings_stats_discord_transactions.sql
-- ===================================================
-- Settings: account stats, Discord link, transactions

alter table public.profiles
  add column if not exists total_wagered numeric(12, 2) not null default 0,
  add column if not exists total_deposited numeric(12, 2) not null default 0,
  add column if not exists total_withdrawn numeric(12, 2) not null default 0,
  add column if not exists total_wins numeric(12, 2) not null default 0,
  add column if not exists total_losses numeric(12, 2) not null default 0,
  add column if not exists discord_id text unique,
  add column if not exists discord_username text,
  add column if not exists discord_avatar text,
  add column if not exists discord_linked_at timestamptz;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('deposit', 'withdrawal', 'wager', 'win', 'loss')),
  amount numeric(12, 2) not null,
  balance_after numeric(12, 2),
  description text,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_id_created_at_idx
  on public.transactions (user_id, created_at desc);

alter table public.transactions enable row level security;

drop policy if exists "Users can read own transactions" on public.transactions;

create policy "Users can read own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

grant select on public.transactions to authenticated;

-- Realtime for transactions list (optional, for later)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end $$;

alter table public.transactions replica identity full;


-- ===================================================
-- MIGRATION: 20250520600000_crypto_deposits_withdrawals.sql
-- ===================================================
-- Crypto deposits & withdrawals (SOL, LTC, ETH)

create sequence if not exists public.deposit_derivation_index_seq;

alter table public.profiles
  add column if not exists deposit_derivation_index int unique;

create table if not exists public.user_deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  address text not null,
  derivation_index int not null,
  created_at timestamptz not null default now(),
  unique (user_id, chain),
  unique (address)
);

create table if not exists public.crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  tx_hash text not null,
  address text not null,
  crypto_amount numeric(24, 12) not null,
  usd_amount numeric(12, 2) not null,
  exchange_rate numeric(18, 8) not null,
  confirmations int not null default 0,
  required_confirmations int not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'credited', 'swept')),
  credited_at timestamptz,
  swept_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chain, tx_hash)
);

create table if not exists public.crypto_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  destination_address text not null,
  crypto_amount numeric(24, 12),
  usd_amount numeric(12, 2) not null,
  exchange_rate numeric(18, 8),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  tx_hash text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists crypto_deposits_user_status_idx on public.crypto_deposits (user_id, status);
create index if not exists crypto_withdrawals_user_idx on public.crypto_withdrawals (user_id, created_at desc);

alter table public.user_deposit_addresses enable row level security;
alter table public.crypto_deposits enable row level security;
alter table public.crypto_withdrawals enable row level security;

drop policy if exists "Users read own deposit addresses" on public.user_deposit_addresses;
create policy "Users read own deposit addresses"
  on public.user_deposit_addresses for select using (auth.uid() = user_id);

drop policy if exists "Users read own crypto deposits" on public.crypto_deposits;
create policy "Users read own crypto deposits"
  on public.crypto_deposits for select using (auth.uid() = user_id);

drop policy if exists "Users read own withdrawals" on public.crypto_withdrawals;
create policy "Users read own withdrawals"
  on public.crypto_withdrawals for select using (auth.uid() = user_id);

drop policy if exists "Users insert own withdrawals" on public.crypto_withdrawals;
create policy "Users insert own withdrawals"
  on public.crypto_withdrawals for insert with check (auth.uid() = user_id);

grant select on public.user_deposit_addresses to authenticated;
grant select on public.crypto_deposits to authenticated;
grant select, insert on public.crypto_withdrawals to authenticated;

grant usage on schema public to service_role;
grant all on table public.user_deposit_addresses to service_role;
grant all on table public.crypto_deposits to service_role;
grant all on table public.crypto_withdrawals to service_role;
grant usage, select on sequence public.deposit_derivation_index_seq to service_role;

-- Credit deposit + update stats (service role / edge functions only)
drop function if exists public.credit_crypto_deposit(p_user_id uuid, p_usd_amount numeric, p_chain text, p_tx_hash text, p_crypto_amount numeric, p_exchange_rate numeric, p_deposit_id uuid) cascade;
create function public.credit_crypto_deposit(
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
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  update public.profiles
  set
    balance = balance + p_usd_amount,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance into new_balance;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id,
    'deposit',
    p_usd_amount,
    new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '…'
  );
end;
$$;

revoke all on function public.credit_crypto_deposit from public;
grant execute on function public.credit_crypto_deposit to service_role;

-- Lock balance for withdrawal request
drop function if exists public.request_crypto_withdrawal(p_chain text, p_destination text, p_usd_amount numeric) cascade;
create function public.request_crypto_withdrawal(
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

  select balance into current_balance from public.profiles where id = uid for update;

  if current_balance is null or current_balance < p_usd_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.profiles
  set
    balance = balance - p_usd_amount,
    total_withdrawn = total_withdrawn + p_usd_amount,
    updated_at = now()
  where id = uid;

  insert into public.crypto_withdrawals (user_id, chain, destination_address, usd_amount, status)
  values (uid, p_chain, p_destination, p_usd_amount, 'pending')
  returning id into wid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    uid,
    'withdrawal',
    -p_usd_amount,
    current_balance - p_usd_amount,
    upper(p_chain) || ' withdrawal pending'
  );

  return wid;
end;
$$;

grant execute on function public.request_crypto_withdrawal(text, text, numeric) to authenticated;

-- Assign derivation index to profile
drop function if exists public.assign_deposit_derivation_index(p_user_id uuid) cascade;
create function public.assign_deposit_derivation_index(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  idx int;
begin
  select deposit_derivation_index into idx from public.profiles where id = p_user_id;
  if idx is not null then
    return idx;
  end if;
  idx := nextval('public.deposit_derivation_index_seq');
  update public.profiles set deposit_derivation_index = idx where id = p_user_id;
  return idx;
end;
$$;

grant execute on function public.assign_deposit_derivation_index(uuid) to service_role;


-- ===================================================
-- MIGRATION: 20250520610000_grant_crypto_tables_service_role.sql
-- ===================================================
-- Fix: Edge Functions (service_role) need table access for poll/sweep

grant usage on schema public to service_role;

grant all on table public.user_deposit_addresses to service_role;
grant all on table public.crypto_deposits to service_role;
grant all on table public.crypto_withdrawals to service_role;

grant usage, select on sequence public.deposit_derivation_index_seq to service_role;

grant execute on function public.assign_deposit_derivation_index(uuid) to service_role;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;


-- ===================================================
-- MIGRATION: 20250520700000_discord_link_profiles.sql
-- ===================================================
-- Discord link: ensure columns + service_role access + RPC for Edge Function

alter table public.profiles
  add column if not exists discord_id text unique,
  add column if not exists discord_username text,
  add column if not exists discord_avatar text,
  add column if not exists discord_linked_at timestamptz;

grant all on table public.profiles to service_role;

drop function if exists public.link_discord_profile(p_user_id uuid, p_discord_id text, p_discord_username text, p_discord_avatar text) cascade;
create function public.link_discord_profile(
  p_user_id uuid,
  p_discord_id text,
  p_discord_username text,
  p_discord_avatar text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, balance)
  values (p_user_id, 0)
  on conflict (id) do nothing;

  update public.profiles
  set
    discord_id = p_discord_id,
    discord_username = p_discord_username,
    discord_avatar = p_discord_avatar,
    discord_linked_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile row missing for user %', p_user_id;
  end if;
end;
$$;

revoke all on function public.link_discord_profile(uuid, text, text, text) from public;
grant execute on function public.link_discord_profile(uuid, text, text, text) to service_role;


-- ===================================================
-- MIGRATION: 20250520800000_user_notifications.sql
-- ===================================================
-- In-app notifications (deposits, withdrawals, Discord, etc.)

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (
    type in (
      'deposit_detected',
      'deposit_credited',
      'withdrawal_started',
      'withdrawal_completed',
      'withdrawal_failed',
      'discord_linked',
      'discord_link_failed'
    )
  ),
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists "Users read own notifications" on public.user_notifications;
create policy "Users read own notifications"
  on public.user_notifications for select
  using (auth.uid() = user_id);

drop policy if exists "Users update own notifications" on public.user_notifications;
create policy "Users update own notifications"
  on public.user_notifications for update
  using (auth.uid() = user_id);

grant select, update on table public.user_notifications to authenticated;
grant all on table public.user_notifications to service_role;

drop function if exists public.create_user_notification(p_user_id uuid, p_type text, p_title text, p_body text, p_metadata jsonb) cascade;
create function public.create_user_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
begin
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'Cannot create notifications for another user';
  end if;

  insert into public.user_notifications (user_id, type, title, body, metadata)
  values (p_user_id, p_type, p_title, p_body, coalesce(p_metadata, '{}'::jsonb))
  returning id into nid;

  return nid;
end;
$$;

revoke all on function public.create_user_notification(uuid, text, text, text, jsonb) from public;
grant execute on function public.create_user_notification(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.create_user_notification(uuid, text, text, text, jsonb) to service_role;

-- Credit deposit + notification
drop function if exists public.credit_crypto_deposit(p_user_id uuid, p_usd_amount numeric, p_chain text, p_tx_hash text, p_crypto_amount numeric, p_exchange_rate numeric, p_deposit_id uuid) cascade;
create function public.credit_crypto_deposit(
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
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  update public.profiles
  set
    balance = balance + p_usd_amount,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance into new_balance;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id,
    'deposit',
    p_usd_amount,
    new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '…'
  );

  perform public.create_user_notification(
    p_user_id,
    'deposit_credited',
    'Deposit credited',
    format('+$%s added to your balance from %s.', trim(to_char(p_usd_amount, 'FM999,999,990.00')), upper(p_chain)),
    jsonb_build_object('chain', p_chain, 'usd_amount', p_usd_amount, 'tx_hash', p_tx_hash, 'deposit_id', p_deposit_id)
  );
end;
$$;

-- Withdrawal request + notification
drop function if exists public.request_crypto_withdrawal(p_chain text, p_destination text, p_usd_amount numeric) cascade;
create function public.request_crypto_withdrawal(
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

  select balance into current_balance from public.profiles where id = uid for update;

  if current_balance is null or current_balance < p_usd_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.profiles
  set
    balance = balance - p_usd_amount,
    total_withdrawn = total_withdrawn + p_usd_amount,
    updated_at = now()
  where id = uid;

  insert into public.crypto_withdrawals (user_id, chain, destination_address, usd_amount, status)
  values (uid, p_chain, p_destination, p_usd_amount, 'pending')
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
    format('$%s %s withdrawal to %s… is pending.', trim(to_char(p_usd_amount, 'FM999,999,990.00')), upper(p_chain), left(p_destination, 8)),
    jsonb_build_object('withdrawal_id', wid, 'chain', p_chain, 'usd_amount', p_usd_amount)
  );

  return wid;
end;
$$;

-- Discord link + notification
drop function if exists public.link_discord_profile(p_user_id uuid, p_discord_id text, p_discord_username text, p_discord_avatar text) cascade;
create function public.link_discord_profile(
  p_user_id uuid,
  p_discord_id text,
  p_discord_username text,
  p_discord_avatar text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, balance)
  values (p_user_id, 0)
  on conflict (id) do nothing;

  update public.profiles
  set
    discord_id = p_discord_id,
    discord_username = p_discord_username,
    discord_avatar = p_discord_avatar,
    discord_linked_at = now(),
    updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Profile row missing for user %', p_user_id;
  end if;

  perform public.create_user_notification(
    p_user_id,
    'discord_linked',
    'Discord linked',
    format('Connected as %s.', p_discord_username),
    jsonb_build_object('discord_id', p_discord_id, 'discord_username', p_discord_username)
  );
end;
$$;

-- Deposit detected / confirmed (poller inserts & updates)
drop function if exists public.notify_crypto_deposit_change() cascade;
create function public.notify_crypto_deposit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    perform public.create_user_notification(
      NEW.user_id,
      'deposit_detected',
      'Deposit detected',
      format('%s deposit incoming — waiting for confirmations.', upper(NEW.chain)),
      jsonb_build_object('chain', NEW.chain, 'deposit_id', NEW.id, 'usd_amount', NEW.usd_amount)
    );
  elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status = 'confirmed' then
    perform public.create_user_notification(
      NEW.user_id,
      'deposit_detected',
      'Deposit confirmed',
      format('%s deposit confirmed — crediting your balance shortly.', upper(NEW.chain)),
      jsonb_build_object('chain', NEW.chain, 'deposit_id', NEW.id, 'usd_amount', NEW.usd_amount)
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists crypto_deposits_notify on public.crypto_deposits;
create trigger crypto_deposits_notify
  after insert or update on public.crypto_deposits
  for each row execute function public.notify_crypto_deposit_change();

-- Withdrawal status changes (admin / future processor)
drop function if exists public.notify_crypto_withdrawal_change() cascade;
create function public.notify_crypto_withdrawal_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status then
    if NEW.status = 'completed' then
      perform public.create_user_notification(
        NEW.user_id,
        'withdrawal_completed',
        'Withdrawal completed',
        format('$%s %s withdrawal sent.', trim(to_char(NEW.usd_amount, 'FM999,999,990.00')), upper(NEW.chain)),
        jsonb_build_object('withdrawal_id', NEW.id, 'chain', NEW.chain, 'tx_hash', NEW.tx_hash)
      );
    elsif NEW.status = 'failed' then
      perform public.create_user_notification(
        NEW.user_id,
        'withdrawal_failed',
        'Withdrawal failed',
        coalesce(NEW.error_message, format('$%s %s withdrawal could not be completed.', trim(to_char(NEW.usd_amount, 'FM999,999,990.00')), upper(NEW.chain))),
        jsonb_build_object('withdrawal_id', NEW.id, 'chain', NEW.chain)
      );
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists crypto_withdrawals_notify on public.crypto_withdrawals;
create trigger crypto_withdrawals_notify
  after update on public.crypto_withdrawals
  for each row execute function public.notify_crypto_withdrawal_change();

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;

alter table public.user_notifications replica identity full;


-- ===================================================
-- MIGRATION: 20250520900000_username_max_length.sql
-- ===================================================
-- Username max 16 characters

alter table public.profiles
  drop constraint if exists profiles_username_max_length;

alter table public.profiles
  add constraint profiles_username_max_length
  check (username is null or char_length(username) <= 16);

update public.profiles
set username = left(username, 16)
where username is not null and char_length(username) > 16;


-- ===================================================
-- MIGRATION: 20250521000000_site_chat.sql
-- ===================================================
-- Global site chat (sidebar)

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  body text not null check (char_length(body) >= 1 and char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "Authenticated users read chat" on public.chat_messages;
create policy "Authenticated users read chat"
  on public.chat_messages for select
  to authenticated
  using (true);

drop policy if exists "Users post own chat messages" on public.chat_messages;
create policy "Users post own chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select, insert on table public.chat_messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

alter table public.chat_messages replica identity full;


-- ===================================================
-- MIGRATION: 20250521100000_keno_game.sql
-- ===================================================
-- Keno (Stake-style): provably fair seeds + bet settlement RPC

create extension if not exists pgcrypto;

create table if not exists public.game_pf_seeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  server_seed text not null,
  server_seed_hash text not null,
  client_seed text not null default 'default',
  next_nonce bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_pf_seeds enable row level security;

drop policy if exists "Users can read own pf seeds" on public.game_pf_seeds;
create policy "Users can read own pf seeds"
  on public.game_pf_seeds for select
  using (auth.uid() = user_id);

grant select on public.game_pf_seeds to authenticated;

create table if not exists public.keno_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  risk text not null check (risk in ('classic', 'low', 'medium', 'high')),
  picks int[] not null,
  drawn int[] not null,
  hits int not null check (hits >= 0 and hits <= 10),
  multiplier numeric(14, 4) not null default 0,
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists keno_bets_user_id_created_at_idx
  on public.keno_bets (user_id, created_at desc);

alter table public.keno_bets enable row level security;

drop policy if exists "Users can read own keno bets" on public.keno_bets;
create policy "Users can read own keno bets"
  on public.keno_bets for select
  using (auth.uid() = user_id);

grant select on public.keno_bets to authenticated;

-- Ensure PF seed row exists; rotate server seed (new hash, nonce reset)
drop function if exists public.ensure_game_pf_seeds(p_user_id uuid) cascade;
create function public.ensure_game_pf_seeds(p_user_id uuid)
returns public.game_pf_seeds
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
begin
  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if found then
    return row;
  end if;

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

  return row;
end;
$$;

revoke all on function public.ensure_game_pf_seeds(uuid) from public;
grant execute on function public.ensure_game_pf_seeds(uuid) to service_role;

drop function if exists public.get_keno_pf_state() cascade;
create function public.get_keno_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  row public.game_pf_seeds;
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into row from public.game_pf_seeds where user_id = uid;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  return query
  select row.server_seed_hash, row.client_seed, row.next_nonce;
end;
$$;

grant execute on function public.get_keno_pf_state() to authenticated;

drop function if exists public.set_keno_client_seed(p_client_seed text) cascade;
create function public.set_keno_client_seed(p_client_seed text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_client_seed, ''))) = 0 then
    raise exception 'Client seed cannot be empty';
  end if;

  if length(p_client_seed) > 64 then
    raise exception 'Client seed too long (max 64 characters)';
  end if;

  if not exists (select 1 from public.game_pf_seeds where user_id = uid) then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      trim(p_client_seed),
      0
    );
    return;
  end if;

  update public.game_pf_seeds
  set client_seed = trim(p_client_seed), updated_at = now()
  where user_id = uid;
end;
$$;

grant execute on function public.set_keno_client_seed(text) to authenticated;

-- Settlement: called by edge function with service_role after provably fair draw
drop function if exists public.settle_keno_bet(p_user_id uuid, p_wager numeric, p_risk text, p_picks int[], p_drawn int[], p_hits int, p_multiplier numeric, p_payout numeric, p_nonce bigint) cascade;
create function public.settle_keno_bet(
  p_user_id uuid,
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

-- Lock seeds + return server seed for one round (service role only)
drop function if exists public.consume_keno_nonce(p_user_id uuid) cascade;
create function public.consume_keno_nonce(p_user_id uuid)
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
begin
  if p_user_id is null then
    raise exception 'User id required';
  end if;

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

  return query
  select row.server_seed, row.client_seed, row.next_nonce;
end;
$$;

revoke all on function public.consume_keno_nonce(uuid) from public;
grant execute on function public.consume_keno_nonce(uuid) to service_role;

grant usage on schema extensions to service_role;
grant all on table public.game_pf_seeds to service_role;


-- ===================================================
-- MIGRATION: 20250521110000_fix_keno_pf_seeds.sql
-- ===================================================
-- Fix Keno seed RPCs: pgcrypto lives in extensions schema on Supabase

grant usage on schema extensions to service_role;
grant all on table public.game_pf_seeds to service_role;

drop function if exists public.ensure_game_pf_seeds(p_user_id uuid) cascade;
create function public.ensure_game_pf_seeds(p_user_id uuid)
returns public.game_pf_seeds
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.game_pf_seeds;
  new_seed text;
begin
  select * into row from public.game_pf_seeds where user_id = p_user_id;
  if found then
    return row;
  end if;

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

  return row;
end;
$$;

revoke all on function public.ensure_game_pf_seeds(uuid) from public;
grant execute on function public.ensure_game_pf_seeds(uuid) to service_role;

drop function if exists public.get_keno_pf_state() cascade;
create function public.get_keno_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  row public.game_pf_seeds;
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into row from public.game_pf_seeds where user_id = uid;
  if not found then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      'default',
      0
    )
    returning * into row;
  end if;

  return query
  select row.server_seed_hash, row.client_seed, row.next_nonce;
end;
$$;

grant execute on function public.get_keno_pf_state() to authenticated;

drop function if exists public.set_keno_client_seed(p_client_seed text) cascade;
create function public.set_keno_client_seed(p_client_seed text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  new_seed text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_client_seed, ''))) = 0 then
    raise exception 'Client seed cannot be empty';
  end if;

  if length(p_client_seed) > 64 then
    raise exception 'Client seed too long (max 64 characters)';
  end if;

  if not exists (select 1 from public.game_pf_seeds where user_id = uid) then
    new_seed := encode(gen_random_bytes(32), 'hex');
    insert into public.game_pf_seeds (user_id, server_seed, server_seed_hash, client_seed, next_nonce)
    values (
      uid,
      new_seed,
      encode(digest(new_seed, 'sha256'), 'hex'),
      trim(p_client_seed),
      0
    );
    return;
  end if;

  update public.game_pf_seeds
  set client_seed = trim(p_client_seed), updated_at = now()
  where user_id = uid;
end;
$$;

grant execute on function public.set_keno_client_seed(text) to authenticated;

drop function if exists public.consume_keno_nonce(p_user_id uuid) cascade;
create function public.consume_keno_nonce(p_user_id uuid)
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
begin
  if p_user_id is null then
    raise exception 'User id required';
  end if;

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

  return query
  select row.server_seed, row.client_seed, row.next_nonce;
end;
$$;

revoke all on function public.consume_keno_nonce(uuid) from public;
grant execute on function public.consume_keno_nonce(uuid) to service_role;


-- ===================================================
-- MIGRATION: 20250521120000_fix_settle_keno_ambiguous_balance.sql
-- ===================================================
-- Fix: RETURNS TABLE column "balance" shadowed profiles.balance in settle_keno_bet
-- Must drop first: PostgreSQL cannot change OUT/return row type via CREATE OR REPLACE.

-- (removed manual drop)

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


-- ===================================================
-- MIGRATION: 20250521200000_admin_access.sql
-- ===================================================
-- Admin access: is_admin flag, escalation guard, admin RPCs

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

drop function if exists public.is_current_user_admin() cascade;
create function public.is_current_user_admin()
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
drop function if exists public.profiles_prevent_admin_escalation() cascade;
create function public.profiles_prevent_admin_escalation()
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

drop function if exists public.require_admin() cascade;
create function public.require_admin()
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
drop function if exists public.admin_get_stats() cascade;
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
drop function if exists public.admin_list_withdrawals(p_status text) cascade;
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
drop function if exists public.admin_list_recent_deposits(p_limit int) cascade;
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
drop function if exists public.admin_complete_crypto_withdrawal(p_withdrawal_id uuid, p_tx_hash text) cascade;
create function public.admin_complete_crypto_withdrawal(
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
drop function if exists public.admin_fail_crypto_withdrawal(p_withdrawal_id uuid, p_error_message text) cascade;
create function public.admin_fail_crypto_withdrawal(
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
drop function if exists public.admin_search_users(p_query text) cascade;
create function public.admin_search_users(p_query text)
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
drop function if exists public.admin_set_user_admin(p_user_id uuid, p_is_admin boolean) cascade;
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


-- ===================================================
-- MIGRATION: 20250521300000_transaction_order_and_profile_admin.sql
-- ===================================================
-- Keno settlement: win/loss rows get a later created_at so newest-first lists show wager then win.
-- Also expose is_admin via a small helper used by the app.

drop function if exists public.settle_keno_bet(p_user_id uuid, p_wager numeric, p_risk text, p_picks int[], p_drawn int[], p_hits int, p_multiplier numeric, p_payout numeric, p_nonce bigint) cascade;
create function public.settle_keno_bet(
  p_user_id uuid,
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
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
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

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager, 'Keno bet', wager_at);

  if p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Keno ' || p_hits || '/' || array_length(p_picks, 1) || ' @ ' || trim(to_char(p_multiplier, 'FM999990.9999')) || 'x',
      outcome_at
    );
  elsif p_payout = 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -(p_wager),
      new_balance,
      'Keno ' || p_hits || '/' || array_length(p_picks, 1) || ' — no payout',
      outcome_at
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

-- Paginated, correctly ordered transaction history for Settings
drop function if exists public.get_user_transactions(p_page int, p_page_size int) cascade;
create function public.get_user_transactions(
  p_page int default 0,
  p_page_size int default 10
)
returns table (
  id uuid,
  type text,
  amount numeric,
  balance_after numeric,
  description text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lim int := greatest(1, least(coalesce(p_page_size, 10), 50));
  off int := greatest(0, coalesce(p_page, 0)) * lim;
  cnt bigint;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::bigint into cnt
  from public.transactions t
  where t.user_id = uid;

  return query
  select
    t.id,
    t.type,
    t.amount,
    t.balance_after,
    t.description,
    t.created_at,
    cnt
  from public.transactions t
  where t.user_id = uid
  order by
    t.created_at desc,
    case t.type
      when 'wager' then 0
      when 'loss' then 1
      when 'win' then 2
      when 'deposit' then 3
      when 'withdrawal' then 4
      else 5
    end asc,
    t.id asc
  limit lim
  offset off;
end;
$$;

grant execute on function public.get_user_transactions(int, int) to authenticated;


-- ===================================================
-- MIGRATION: 20250521400000_mines_game.sql
-- ===================================================
-- Mines (Stake-style): session bets on 5×5 grid, provably fair via game_pf_seeds

create table if not exists public.mines_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  mine_count int not null check (mine_count between 1 and 24),
  mine_tiles int[] not null,
  revealed_tiles int[] not null default '{}',
  gems_revealed int not null default 0 check (gems_revealed >= 0),
  multiplier numeric(14, 4) not null default 1,
  payout numeric(12, 2) not null default 0,
  status text not null default 'active'
    check (status in ('active', 'cashed_out', 'busted')),
  nonce bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists mines_games_user_status_idx
  on public.mines_games (user_id, status)
  where status = 'active';

create index if not exists mines_games_user_created_idx
  on public.mines_games (user_id, created_at desc);

alter table public.mines_games enable row level security;

drop policy if exists "Users read own mines games" on public.mines_games;
create policy "Users read own mines games"
  on public.mines_games for select
  using (auth.uid() = user_id);

grant select on public.mines_games to authenticated;
grant all on table public.mines_games to service_role;

-- Start round: lock wager, store mine layout (server-only until bust/cashout)
drop function if exists public.start_mines_game(p_user_id uuid, p_wager numeric, p_mine_count int, p_mine_tiles int[], p_nonce bigint) cascade;
create function public.start_mines_game(
  p_user_id uuid,
  p_wager numeric,
  p_mine_count int,
  p_mine_tiles int[],
  p_nonce bigint
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
begin
  if p_mine_count < 1 or p_mine_count > 24 then
    raise exception 'Invalid mine count';
  end if;

  if array_length(p_mine_tiles, 1) is distinct from p_mine_count then
    raise exception 'Mine layout mismatch';
  end if;

  if exists (
    select 1 from public.mines_games g
    where g.user_id = p_user_id and g.status = 'active'
  ) then
    raise exception 'Finish your current Mines game first';
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

  new_balance := current_balance - p_wager;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.mines_games (
    user_id, wager, mine_count, mine_tiles, revealed_tiles, gems_revealed,
    multiplier, status, nonce
  )
  values (
    p_user_id, p_wager, p_mine_count, p_mine_tiles, '{}', 0, 1, 'active', p_nonce
  )
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, 'Mines bet (' || p_mine_count || ' mines)', wager_at);

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;

revoke all on function public.start_mines_game(uuid, numeric, int, int[], bigint) from public;
grant execute on function public.start_mines_game(uuid, numeric, int, int[], bigint) to service_role;

-- Reveal a tile
drop function if exists public.mines_reveal_tile(p_user_id uuid, p_game_id uuid, p_tile int) cascade;
create function public.mines_reveal_tile(
  p_user_id uuid,
  p_game_id uuid,
  p_tile int
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

  is_hit := p_tile = any (g.mine_tiles);

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

-- Combinatorics helper for SQL multiplier (matches client 0.99 × C(25,d)/C(25-m,d))
drop function if exists public.mines_comb(n int, r int) cascade;
create function public.mines_comb(n int, r int)
returns numeric
language plpgsql
immutable
as $$
declare
  result numeric := 1;
  i int;
  k int;
begin
  if r < 0 or r > n then
    return 0;
  end if;
  if r = 0 or r = n then
    return 1;
  end if;
  k := least(r, n - r);
  for i in 0..k - 1 loop
    result := result * (n - i) / (i + 1);
  end loop;
  return result;
end;
$$;

revoke all on function public.mines_reveal_tile(uuid, uuid, int) from public;
grant execute on function public.mines_reveal_tile(uuid, uuid, int) to service_role;

-- Cash out
drop function if exists public.mines_cashout(p_user_id uuid, p_game_id uuid) cascade;
create function public.mines_cashout(
  p_user_id uuid,
  p_game_id uuid
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
  wager_at timestamptz := clock_timestamp();
  win_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
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

  if g.gems_revealed < 1 then
    raise exception 'Reveal at least one gem before cashing out';
  end if;

  pay := round(g.wager * g.multiplier, 2);

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  new_balance := current_balance + pay;

  update public.profiles p
  set
    balance = new_balance,
    total_wins = total_wins + pay,
    updated_at = now()
  where p.id = p_user_id;

  update public.mines_games
  set
    status = 'cashed_out',
    payout = pay,
    completed_at = now()
  where id = g.id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'win',
    pay,
    new_balance,
    'Mines cashout ' || g.gems_revealed || ' gems @ ' || trim(to_char(g.multiplier, 'FM999990.9999')) || 'x',
    win_at
  );

  return query select new_balance, g.id, pay, g.multiplier, g.gems_revealed, g.wager;
end;
$$;

revoke all on function public.mines_cashout(uuid, uuid) from public;
grant execute on function public.mines_cashout(uuid, uuid) to service_role;

-- Active game for resume (no mine positions)
drop function if exists public.get_active_mines_game(p_user_id uuid) cascade;
create function public.get_active_mines_game(p_user_id uuid)
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text
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
    g.status
  from public.mines_games g
  where g.user_id = p_user_id and g.status = 'active'
  order by g.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_active_mines_game(uuid) from public;
grant execute on function public.get_active_mines_game(uuid) to service_role;

drop function if exists public.get_my_active_mines_game() cascade;
create function public.get_my_active_mines_game()
returns table (
  game_id uuid,
  wager numeric,
  mine_count int,
  revealed_tiles int[],
  gems_revealed int,
  multiplier numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select * from public.get_active_mines_game(uid);
end;
$$;

grant execute on function public.get_my_active_mines_game() to authenticated;

-- PF wrappers (reuse keno seed row)
drop function if exists public.get_mines_pf_state() cascade;
create function public.get_mines_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_mines_pf_state() to authenticated;

drop function if exists public.set_mines_client_seed(p_client_seed text) cascade;
create function public.set_mines_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_mines_client_seed(text) to authenticated;


-- ===================================================
-- MIGRATION: 20250521500000_limbo_game.sql
-- ===================================================
-- Limbo (Stake-style): instant rounds, provably fair via game_pf_seeds

create table if not exists public.limbo_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  target_multiplier numeric(14, 2) not null check (target_multiplier >= 1.01),
  result_multiplier numeric(14, 2) not null,
  won boolean not null,
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists limbo_bets_user_id_created_at_idx
  on public.limbo_bets (user_id, created_at desc);

alter table public.limbo_bets enable row level security;

drop policy if exists "Users read own limbo bets" on public.limbo_bets;
create policy "Users read own limbo bets"
  on public.limbo_bets for select
  using (auth.uid() = user_id);

grant select on public.limbo_bets to authenticated;
grant all on table public.limbo_bets to service_role;

drop function if exists public.settle_limbo_bet(p_user_id uuid, p_wager numeric, p_target_multiplier numeric, p_result_multiplier numeric, p_won boolean, p_payout numeric, p_nonce bigint) cascade;
create function public.settle_limbo_bet(
  p_user_id uuid,
  p_wager numeric,
  p_target_multiplier numeric,
  p_result_multiplier numeric,
  p_won boolean,
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_target_multiplier < 1.01 or p_target_multiplier > 1000000 then
    raise exception 'Invalid target multiplier';
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

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
    total_losses = total_losses + case when not p_won then p_wager else 0 end,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.limbo_bets (
    user_id, wager, target_multiplier, result_multiplier, won, payout, nonce
  )
  values (
    p_user_id,
    p_wager,
    p_target_multiplier,
    p_result_multiplier,
    p_won,
    coalesce(p_payout, 0),
    p_nonce
  )
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'wager',
    -p_wager,
    current_balance - p_wager,
    'Limbo @ ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x',
    wager_at
  );

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Limbo hit ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x (target ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x)',
      outcome_at
    );
  elsif not p_won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -p_wager,
      new_balance,
      'Limbo ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x — below ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x',
      outcome_at
    );
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint) from public;
grant execute on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint) to service_role;

drop function if exists public.get_limbo_pf_state() cascade;
create function public.get_limbo_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_limbo_pf_state() to authenticated;

drop function if exists public.set_limbo_client_seed(p_client_seed text) cascade;
create function public.set_limbo_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_limbo_client_seed(text) to authenticated;


-- ===================================================
-- MIGRATION: 20250521600000_blackjack_game.sql
-- ===================================================
-- Blackjack (Stake-style): session hands, provably fair shoe via game_pf_seeds

create table if not exists public.blackjack_hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  total_wager numeric(12, 2) not null check (total_wager > 0),
  doubled boolean not null default false,
  shoe int[] not null,
  shoe_index int not null default 0,
  player_cards int[] not null default '{}',
  dealer_cards int[] not null default '{}',
  dealer_revealed boolean not null default false,
  status text not null default 'player_turn'
    check (status in ('player_turn', 'settled')),
  outcome text check (outcome is null or outcome in ('blackjack', 'win', 'lose', 'push', 'bust')),
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists blackjack_hands_user_active_idx
  on public.blackjack_hands (user_id)
  where status = 'player_turn';

create index if not exists blackjack_hands_user_created_idx
  on public.blackjack_hands (user_id, created_at desc);

alter table public.blackjack_hands enable row level security;

drop policy if exists "Users read own blackjack hands" on public.blackjack_hands;
create policy "Users read own blackjack hands"
  on public.blackjack_hands for select
  using (auth.uid() = user_id);

grant select on public.blackjack_hands to authenticated;
grant all on table public.blackjack_hands to service_role;

drop function if exists public.start_blackjack_hand(p_user_id uuid, p_wager numeric, p_total_wager numeric, p_shoe int[], p_shoe_index int, p_player_cards int[], p_dealer_cards int[], p_doubled boolean, p_dealer_revealed boolean, p_status text, p_outcome text, p_payout numeric, p_nonce bigint) cascade;
create function public.start_blackjack_hand(
  p_user_id uuid,
  p_wager numeric,
  p_total_wager numeric,
  p_shoe int[],
  p_shoe_index int,
  p_player_cards int[],
  p_dealer_cards int[],
  p_doubled boolean,
  p_dealer_revealed boolean,
  p_status text,
  p_outcome text,
  p_payout numeric,
  p_nonce bigint
)
returns table (
  out_balance numeric,
  hand_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  hid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if exists (
    select 1 from public.blackjack_hands h
    where h.user_id = p_user_id and h.status = 'player_turn'
  ) then
    raise exception 'Finish your current Blackjack hand first';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_total_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_total_wager;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_total_wager,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.blackjack_hands (
    user_id, wager, total_wager, doubled, shoe, shoe_index,
    player_cards, dealer_cards, dealer_revealed, status, outcome, payout, nonce,
    completed_at
  )
  values (
    p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index,
    p_player_cards, p_dealer_cards, p_dealer_revealed, p_status, p_outcome,
    coalesce(p_payout, 0), p_nonce,
    case when p_status = 'settled' then now() else null end
  )
  returning id into hid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_total_wager, new_balance, 'Blackjack bet', wager_at);

  if p_status = 'settled' then
    new_balance := new_balance + coalesce(p_payout, 0);

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end,
      updated_at = now()
    where p.id = p_user_id;

    if coalesce(p_payout, 0) > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'win',
        p_payout,
        new_balance,
        'Blackjack ' || coalesce(p_outcome, 'win'),
        outcome_at
      );
    elsif p_outcome in ('lose', 'bust') then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'loss',
        -p_total_wager,
        new_balance,
        'Blackjack ' || p_outcome,
        outcome_at
      );
    elsif p_outcome = 'push' then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'win',
        p_payout,
        new_balance,
        'Blackjack push',
        outcome_at
      );
    end if;
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, hid;
end;
$$;

revoke all on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint) from public;
grant execute on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint) to service_role;

drop function if exists public.blackjack_update_active(p_user_id uuid, p_hand_id uuid, p_player_cards int[], p_shoe_index int) cascade;
create function public.blackjack_update_active(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_shoe_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blackjack_hands h
  set
    player_cards = p_player_cards,
    shoe_index = p_shoe_index
  where h.id = p_hand_id
    and h.user_id = p_user_id
    and h.status = 'player_turn';

  if not found then
    raise exception 'Active hand not found';
  end if;
end;
$$;

revoke all on function public.blackjack_update_active(uuid, uuid, int[], int) from public;
grant execute on function public.blackjack_update_active(uuid, uuid, int[], int) to service_role;

drop function if exists public.blackjack_finish_hand(p_user_id uuid, p_hand_id uuid, p_player_cards int[], p_dealer_cards int[], p_shoe_index int, p_doubled boolean, p_total_wager numeric, p_dealer_revealed boolean, p_outcome text, p_payout numeric, p_extra_wager numeric) cascade;
create function public.blackjack_finish_hand(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_dealer_cards int[],
  p_shoe_index int,
  p_doubled boolean,
  p_total_wager numeric,
  p_dealer_revealed boolean,
  p_outcome text,
  p_payout numeric,
  p_extra_wager numeric default 0
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.blackjack_hands%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  extra numeric(12, 2) := greatest(0, coalesce(p_extra_wager, 0));
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  select * into h
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Hand not found';
  end if;

  if h.status <> 'player_turn' then
    raise exception 'Hand is not active';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  new_balance := current_balance;

  if extra > 0 then
    if new_balance < extra then
      raise exception 'Insufficient balance for double';
    end if;
    new_balance := new_balance - extra;

    update public.profiles p
    set
      balance = new_balance,
      total_wagered = total_wagered + extra,
      updated_at = now()
    where p.id = p_user_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'wager', -extra, new_balance, 'Blackjack double', wager_at);
  end if;

  new_balance := new_balance + coalesce(p_payout, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
    total_losses = total_losses + case
      when coalesce(p_payout, 0) <= 0 and p_outcome not in ('push') then p_total_wager
      else 0
    end,
    updated_at = now()
  where p.id = p_user_id;

  update public.blackjack_hands
  set
    player_cards = p_player_cards,
    dealer_cards = p_dealer_cards,
    shoe_index = p_shoe_index,
    doubled = p_doubled,
    total_wager = p_total_wager,
    dealer_revealed = p_dealer_revealed,
    status = 'settled',
    outcome = p_outcome,
    payout = coalesce(p_payout, 0),
    completed_at = now()
  where id = p_hand_id;

  if coalesce(p_payout, 0) > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Blackjack ' || coalesce(p_outcome, 'win'),
      outcome_at
    );
  elsif p_outcome in ('lose', 'bust') then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -p_total_wager,
      new_balance,
      'Blackjack ' || p_outcome,
      outcome_at
    );
  elsif p_outcome = 'push' then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Blackjack push',
      outcome_at
    );
  end if;

  return query select new_balance;
end;
$$;

revoke all on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric) from public;
grant execute on function public.blackjack_finish_hand(uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric) to service_role;

-- (removed manual drop)

drop function if exists public.get_my_active_blackjack_hand() cascade;
create function public.get_my_active_blackjack_hand()
returns table (
  hand_id uuid,
  wager numeric,
  total_wager numeric,
  doubled boolean,
  player_cards int[],
  dealer_cards int[],
  dealer_revealed boolean,
  shoe_index int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    h.id,
    h.wager,
    h.total_wager,
    h.doubled,
    h.player_cards,
    case
      when h.dealer_revealed then h.dealer_cards
      when coalesce(array_length(h.dealer_cards, 1), 0) >= 1 then array[h.dealer_cards[1]]
      else '{}'::int[]
    end,
    h.dealer_revealed,
    h.shoe_index
  from public.blackjack_hands h
  where h.user_id = uid and h.status = 'player_turn'
  order by h.created_at desc
  limit 1;
end;
$$;

grant execute on function public.get_my_active_blackjack_hand() to authenticated;

drop function if exists public.get_blackjack_pf_state() cascade;
create function public.get_blackjack_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_blackjack_pf_state() to authenticated;

drop function if exists public.set_blackjack_client_seed(p_client_seed text) cascade;
create function public.set_blackjack_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_blackjack_client_seed(text) to authenticated;


-- ===================================================
-- MIGRATION: 20250521700000_blackjack_split_insurance.sql
-- ===================================================
-- Blackjack: split pairs + insurance (dealer Ace)

alter table public.blackjack_hands
  add column if not exists phase text not null default 'player_turn'
    check (phase in ('insurance_offer', 'player_turn', 'settled')),
  add column if not exists insurance_wager numeric(12, 2) not null default 0,
  add column if not exists insurance_taken boolean not null default false,
  add column if not exists insurance_decided boolean not null default true,
  add column if not exists is_split boolean not null default false,
  add column if not exists player_hands jsonb,
  add column if not exists active_hand_index int not null default 0;

-- Return type / signature changes require drop (CREATE OR REPLACE cannot alter OUT columns).
-- (removed manual drop)

-- (removed manual drop)

-- (removed manual drop)

-- (removed manual drop)

drop function if exists public.start_blackjack_hand(p_user_id uuid, p_wager numeric, p_total_wager numeric, p_shoe int[], p_shoe_index int, p_player_cards int[], p_dealer_cards int[], p_doubled boolean, p_dealer_revealed boolean, p_status text, p_outcome text, p_payout numeric, p_nonce bigint, p_phase text, p_insurance_wager numeric, p_insurance_taken boolean, p_insurance_decided boolean, p_is_split boolean, p_player_hands jsonb, p_active_hand_index int) cascade;
create function public.start_blackjack_hand(
  p_user_id uuid,
  p_wager numeric,
  p_total_wager numeric,
  p_shoe int[],
  p_shoe_index int,
  p_player_cards int[],
  p_dealer_cards int[],
  p_doubled boolean,
  p_dealer_revealed boolean,
  p_status text,
  p_outcome text,
  p_payout numeric,
  p_nonce bigint,
  p_phase text default 'player_turn',
  p_insurance_wager numeric default 0,
  p_insurance_taken boolean default false,
  p_insurance_decided boolean default true,
  p_is_split boolean default false,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0
)
returns table (
  out_balance numeric,
  hand_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  hid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if exists (
    select 1 from public.blackjack_hands h
    where h.user_id = p_user_id and h.status = 'player_turn'
  ) then
    raise exception 'Finish your current Blackjack hand first';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_total_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_total_wager;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_total_wager,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.blackjack_hands (
    user_id, wager, total_wager, doubled, shoe, shoe_index,
    player_cards, dealer_cards, dealer_revealed, status, outcome, payout, nonce,
    phase, insurance_wager, insurance_taken, insurance_decided,
    is_split, player_hands, active_hand_index,
    completed_at
  )
  values (
    p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index,
    p_player_cards, p_dealer_cards, p_dealer_revealed, p_status, p_outcome,
    coalesce(p_payout, 0), p_nonce,
    coalesce(p_phase, 'player_turn'),
    coalesce(p_insurance_wager, 0),
    coalesce(p_insurance_taken, false),
    coalesce(p_insurance_decided, true),
    coalesce(p_is_split, false),
    p_player_hands,
    coalesce(p_active_hand_index, 0),
    case when p_status = 'settled' then now() else null end
  )
  returning id into hid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_total_wager, new_balance, 'Blackjack bet', wager_at);

  if p_status = 'settled' then
    new_balance := new_balance + coalesce(p_payout, 0);

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end,
      updated_at = now()
    where p.id = p_user_id;

    if coalesce(p_payout, 0) > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'win',
        p_payout,
        new_balance,
        'Blackjack ' || coalesce(p_outcome, 'win'),
        outcome_at
      );
    elsif p_outcome in ('lose', 'bust') then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'loss',
        -p_total_wager,
        new_balance,
        'Blackjack ' || p_outcome,
        outcome_at
      );
    elsif p_outcome = 'push' then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (
        p_user_id,
        'win',
        p_payout,
        new_balance,
        'Blackjack push',
        outcome_at
      );
    end if;
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, hid;
end;
$$;

revoke all on function public.start_blackjack_hand(
  uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint,
  text, numeric, boolean, boolean, boolean, jsonb, int
) from public;
grant execute on function public.start_blackjack_hand(
  uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint,
  text, numeric, boolean, boolean, boolean, jsonb, int
) to service_role;

drop function if exists public.blackjack_update_active(p_user_id uuid, p_hand_id uuid, p_player_cards int[], p_shoe_index int, p_player_hands jsonb, p_active_hand_index int, p_is_split boolean, p_phase text, p_total_wager numeric, p_doubled boolean, p_insurance_wager numeric, p_insurance_taken boolean, p_insurance_decided boolean) cascade;
create function public.blackjack_update_active(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_shoe_index int,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0,
  p_is_split boolean default false,
  p_phase text default 'player_turn',
  p_total_wager numeric default null,
  p_doubled boolean default null,
  p_insurance_wager numeric default null,
  p_insurance_taken boolean default null,
  p_insurance_decided boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.blackjack_hands h
  set
    player_cards = p_player_cards,
    shoe_index = p_shoe_index,
    player_hands = coalesce(p_player_hands, h.player_hands),
    active_hand_index = coalesce(p_active_hand_index, h.active_hand_index),
    is_split = coalesce(p_is_split, h.is_split),
    phase = coalesce(p_phase, h.phase),
    total_wager = coalesce(p_total_wager, h.total_wager),
    doubled = coalesce(p_doubled, h.doubled),
    insurance_wager = coalesce(p_insurance_wager, h.insurance_wager),
    insurance_taken = coalesce(p_insurance_taken, h.insurance_taken),
    insurance_decided = coalesce(p_insurance_decided, h.insurance_decided)
  where h.id = p_hand_id
    and h.user_id = p_user_id
    and h.status = 'player_turn';

  if not found then
    raise exception 'Active hand not found';
  end if;
end;
$$;

revoke all on function public.blackjack_update_active(
  uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean
) from public;
grant execute on function public.blackjack_update_active(
  uuid, uuid, int[], int, jsonb, int, boolean, text, numeric, boolean, numeric, boolean, boolean
) to service_role;

drop function if exists public.blackjack_debit_extra(p_user_id uuid, p_hand_id uuid, p_extra_wager numeric, p_description text) cascade;
create function public.blackjack_debit_extra(
  p_user_id uuid,
  p_hand_id uuid,
  p_extra_wager numeric,
  p_description text default 'Blackjack side bet'
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  extra numeric(12, 2) := greatest(0, coalesce(p_extra_wager, 0));
  wager_at timestamptz := clock_timestamp();
begin
  if extra <= 0 then
    select p.balance into current_balance from public.profiles p where p.id = p_user_id;
    return query select coalesce(current_balance, 0);
    return;
  end if;

  perform 1
  from public.blackjack_hands h
  where h.id = p_hand_id and h.user_id = p_user_id and h.status = 'player_turn'
  for update;

  if not found then
    raise exception 'Active hand not found';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance < extra then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - extra;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + extra,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -extra, new_balance, coalesce(p_description, 'Blackjack side bet'), wager_at);

  return query select new_balance;
end;
$$;

revoke all on function public.blackjack_debit_extra(uuid, uuid, numeric, text) from public;
grant execute on function public.blackjack_debit_extra(uuid, uuid, numeric, text) to service_role;

drop function if exists public.blackjack_finish_hand(p_user_id uuid, p_hand_id uuid, p_player_cards int[], p_dealer_cards int[], p_shoe_index int, p_doubled boolean, p_total_wager numeric, p_dealer_revealed boolean, p_outcome text, p_payout numeric, p_extra_wager numeric, p_phase text, p_player_hands jsonb, p_is_split boolean, p_active_hand_index int, p_insurance_wager numeric, p_insurance_taken boolean) cascade;
create function public.blackjack_finish_hand(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_dealer_cards int[],
  p_shoe_index int,
  p_doubled boolean,
  p_total_wager numeric,
  p_dealer_revealed boolean,
  p_outcome text,
  p_payout numeric,
  p_extra_wager numeric default 0,
  p_phase text default 'settled',
  p_player_hands jsonb default null,
  p_is_split boolean default false,
  p_active_hand_index int default 0,
  p_insurance_wager numeric default null,
  p_insurance_taken boolean default null
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.blackjack_hands%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  extra numeric(12, 2) := greatest(0, coalesce(p_extra_wager, 0));
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  ins_wager numeric(12, 2);
begin
  select * into h
  from public.blackjack_hands
  where id = p_hand_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Hand not found';
  end if;

  if h.status <> 'player_turn' then
    raise exception 'Hand is not active';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  new_balance := current_balance;

  if extra > 0 then
    if new_balance < extra then
      raise exception 'Insufficient balance';
    end if;
    new_balance := new_balance - extra;

    update public.profiles p
    set
      balance = new_balance,
      total_wagered = total_wagered + extra,
      updated_at = now()
    where p.id = p_user_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'wager', -extra, new_balance, 'Blackjack double', wager_at);
  end if;

  new_balance := new_balance + coalesce(p_payout, 0);

  ins_wager := coalesce(p_insurance_wager, h.insurance_wager, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end,
    total_losses = total_losses + case
      when coalesce(p_payout, 0) <= 0 and p_outcome not in ('push') then p_total_wager + ins_wager
      else 0
    end,
    updated_at = now()
  where p.id = p_user_id;

  update public.blackjack_hands
  set
    player_cards = p_player_cards,
    dealer_cards = p_dealer_cards,
    shoe_index = p_shoe_index,
    doubled = p_doubled,
    total_wager = p_total_wager,
    dealer_revealed = p_dealer_revealed,
    status = 'settled',
    phase = coalesce(p_phase, 'settled'),
    outcome = p_outcome,
    payout = coalesce(p_payout, 0),
    player_hands = coalesce(p_player_hands, player_hands),
    is_split = coalesce(p_is_split, is_split),
    active_hand_index = coalesce(p_active_hand_index, active_hand_index),
    insurance_wager = coalesce(p_insurance_wager, insurance_wager),
    insurance_taken = coalesce(p_insurance_taken, insurance_taken),
    insurance_decided = true,
    completed_at = now()
  where id = p_hand_id;

  if coalesce(p_payout, 0) > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Blackjack ' || coalesce(p_outcome, 'win'),
      outcome_at
    );
  elsif p_outcome in ('lose', 'bust') then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -p_total_wager,
      new_balance,
      'Blackjack ' || p_outcome,
      outcome_at
    );
  elsif p_outcome = 'push' then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Blackjack push',
      outcome_at
    );
  end if;

  return query select new_balance;
end;
$$;

revoke all on function public.blackjack_finish_hand(
  uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric,
  text, jsonb, boolean, int, numeric, boolean
) from public;
grant execute on function public.blackjack_finish_hand(
  uuid, uuid, int[], int[], int, boolean, numeric, boolean, text, numeric, numeric,
  text, jsonb, boolean, int, numeric, boolean
) to service_role;

drop function if exists public.get_my_active_blackjack_hand() cascade;
create function public.get_my_active_blackjack_hand()
returns table (
  hand_id uuid,
  wager numeric,
  total_wager numeric,
  doubled boolean,
  player_cards int[],
  dealer_cards int[],
  dealer_revealed boolean,
  shoe_index int,
  phase text,
  insurance_wager numeric,
  insurance_taken boolean,
  insurance_decided boolean,
  is_split boolean,
  player_hands jsonb,
  active_hand_index int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    h.id,
    h.wager,
    h.total_wager,
    h.doubled,
    h.player_cards,
    case
      when h.dealer_revealed then h.dealer_cards
      when coalesce(array_length(h.dealer_cards, 1), 0) >= 1 then array[h.dealer_cards[1]]
      else '{}'::int[]
    end,
    h.dealer_revealed,
    h.shoe_index,
    h.phase,
    h.insurance_wager,
    h.insurance_taken,
    h.insurance_decided,
    h.is_split,
    h.player_hands,
    h.active_hand_index
  from public.blackjack_hands h
  where h.user_id = uid and h.status = 'player_turn'
  order by h.created_at desc
  limit 1;
end;
$$;

grant execute on function public.get_my_active_blackjack_hand() to authenticated;


-- ===================================================
-- MIGRATION: 20250521800000_case_battles.sql
-- ===================================================
-- Case Battles (cases.gg-style): PvP loot case opens, highest total wins the pot

create table if not exists public.case_battles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  case_id text not null,
  rounds int not null check (rounds >= 1 and rounds <= 5),
  max_players int not null check (max_players in (2, 3, 4)),
  vs_bot boolean not null default false,
  entry_cost numeric(12, 2) not null check (entry_cost > 0),
  pot_total numeric(12, 2) not null default 0,
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'completed', 'cancelled')),
  winner_id uuid references auth.users (id),
  winner_slot int,
  winner_payout numeric(12, 2) not null default 0,
  battle_seed text,
  battle_seed_hash text,
  results jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists case_battles_status_created_idx
  on public.case_battles (status, created_at desc);

create index if not exists case_battles_creator_idx
  on public.case_battles (creator_id, created_at desc);

create table if not exists public.case_battle_players (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.case_battles (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  is_bot boolean not null default false,
  slot_index int not null check (slot_index >= 0 and slot_index <= 3),
  display_name text not null default 'Player',
  total_value numeric(12, 2) not null default 0,
  round_drops jsonb not null default '[]'::jsonb,
  joined_at timestamptz not null default now(),
  unique (battle_id, slot_index),
  unique (battle_id, user_id)
);

create index if not exists case_battle_players_battle_idx
  on public.case_battle_players (battle_id);

alter table public.case_battles enable row level security;
alter table public.case_battle_players enable row level security;

drop policy if exists "Anyone read case battles" on public.case_battles;
create policy "Anyone read case battles"
  on public.case_battles for select
  using (true);

drop policy if exists "Anyone read case battle players" on public.case_battle_players;
create policy "Anyone read case battle players"
  on public.case_battle_players for select
  using (true);

grant select on public.case_battles to authenticated;
grant select on public.case_battle_players to authenticated;
grant all on public.case_battles to service_role;
grant all on public.case_battle_players to service_role;

drop function if exists public.create_case_battle_entry(p_user_id uuid, p_battle_id uuid, p_slot_index int, p_entry_cost numeric, p_display_name text) cascade;
create function public.create_case_battle_entry(
  p_user_id uuid,
  p_battle_id uuid,
  p_slot_index int,
  p_entry_cost numeric,
  p_display_name text default 'Player'
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  wager_at timestamptz := clock_timestamp();
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not open for joins';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.user_id = p_user_id
  ) then
    raise exception 'Already in this battle';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_entry_cost then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_entry_cost;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_entry_cost,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.case_battle_players (
    battle_id, user_id, is_bot, slot_index, display_name
  )
  values (
    p_battle_id, p_user_id, false, p_slot_index, coalesce(nullif(trim(p_display_name), ''), 'Player')
  );

  update public.case_battles
  set pot_total = pot_total + p_entry_cost
  where id = p_battle_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_entry_cost, new_balance, 'Case battle entry', wager_at);

  return query select new_balance;
end;
$$;

revoke all on function public.create_case_battle_entry(uuid, uuid, int, numeric, text) from public;
grant execute on function public.create_case_battle_entry(uuid, uuid, int, numeric, text) to service_role;

drop function if exists public.insert_case_battle_bot(p_battle_id uuid, p_slot_index int) cascade;
create function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, 'House Bot');
end;
$$;

revoke all on function public.insert_case_battle_bot(uuid, int) from public;
grant execute on function public.insert_case_battle_bot(uuid, int) to service_role;

drop function if exists public.complete_case_battle(p_battle_id uuid, p_winner_id uuid, p_winner_slot int, p_winner_payout numeric, p_pot_total numeric, p_battle_seed text, p_results jsonb, p_players jsonb) cascade;
create function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  player_row jsonb;
begin
  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id and status in ('waiting', 'running');

  if not found then
    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  if p_winner_id is not null and coalesce(p_winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = p_winner_id
    for update;

    new_balance := current_balance + p_winner_payout;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + p_winner_payout,
      updated_at = now()
    where p.id = p_winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_winner_id,
      'win',
      p_winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );

    return query select new_balance;
  end if;

  return query select null::numeric;
end;
$$;

revoke all on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb) from public;
grant execute on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb) to service_role;

drop function if exists public.mark_case_battle_running(p_battle_id uuid, p_battle_seed_hash text) cascade;
create function public.mark_case_battle_running(
  p_battle_id uuid,
  p_battle_seed_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_battles
  set
    status = 'running',
    battle_seed_hash = p_battle_seed_hash,
    started_at = now()
  where id = p_battle_id and status = 'waiting';
end;
$$;

revoke all on function public.mark_case_battle_running(uuid, text) from public;
grant execute on function public.mark_case_battle_running(uuid, text) to service_role;

-- (removed manual drop)

drop function if exists public.get_open_case_battles(p_limit int) cascade;
create function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  rounds int,
  max_players int,
  vs_bot boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.rounds,
    b.max_players,
    b.vs_bot,
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id and not p.is_bot),
    b.created_at
  from public.case_battles b
  where b.status = 'waiting'
    and not b.vs_bot
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;

drop function if exists public.get_case_battle_pf_state() cascade;
create function public.get_case_battle_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_case_battle_pf_state() to authenticated;

drop function if exists public.set_case_battle_client_seed(p_client_seed text) cascade;
create function public.set_case_battle_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_case_battle_client_seed(text) to authenticated;


-- ===================================================
-- MIGRATION: 20250521900000_case_battles_lobby.sql
-- ===================================================
-- Case battles lobby: mixed players/bots, multiple cases, player modes

alter table public.case_battles
  add column if not exists case_ids jsonb,
  add column if not exists gamemode text not null default 'normal',
  add column if not exists player_mode text not null default '1v1';

alter table public.case_battles
  drop constraint if exists case_battles_max_players_check;

alter table public.case_battles
  add constraint case_battles_max_players_check
  check (max_players >= 2 and max_players <= 6);

alter table public.case_battle_players
  drop constraint if exists case_battle_players_slot_index_check;

alter table public.case_battle_players
  add constraint case_battle_players_slot_index_check
  check (slot_index >= 0 and slot_index <= 5);

-- Backfill case_ids from legacy case_id
update public.case_battles
set case_ids = jsonb_build_array(case_id)
where case_ids is null and case_id is not null;

-- (removed manual drop)

drop function if exists public.get_open_case_battles(p_limit int) cascade;
create function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.created_at
  from public.case_battles b
  where b.status = 'waiting'
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;


-- ===================================================
-- MIGRATION: 20250522000000_case_battles_fixes.sql
-- ===================================================
-- Case battles: allow up to 10 rounds, safer bot insert, multi-winner payouts

-- (removed manual drop)

alter table public.case_battles
  drop constraint if exists case_battles_rounds_check;

alter table public.case_battles
  add constraint case_battles_rounds_check
  check (rounds >= 1 and rounds <= 10);

drop function if exists public.insert_case_battle_bot(p_battle_id uuid, p_slot_index int) cascade;
create function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not waiting for players';
  end if;

  if p_slot_index < 0 or p_slot_index >= b.max_players then
    raise exception 'Invalid slot';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, 'House Bot');
end;
$$;

drop function if exists public.complete_case_battle(p_battle_id uuid, p_winner_id uuid, p_winner_slot int, p_winner_payout numeric, p_pot_total numeric, p_battle_seed text, p_results jsonb, p_players jsonb, p_winner_payouts jsonb) cascade;
create function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb,
  p_winner_payouts jsonb default '[]'::jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  player_row jsonb;
  payout_row jsonb;
  uid uuid;
  amt numeric(12, 2);
  last_balance numeric(12, 2);
begin
  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id and status in ('waiting', 'running');

  if not found then
    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  if jsonb_array_length(coalesce(p_winner_payouts, '[]'::jsonb)) > 0 then
    for payout_row in select * from jsonb_array_elements(p_winner_payouts)
    loop
      uid := (payout_row->>'userId')::uuid;
      amt := coalesce((payout_row->>'amount')::numeric, 0);
      if uid is null or amt <= 0 then
        continue;
      end if;

      select p.balance into current_balance
      from public.profiles p
      where p.id = uid
      for update;

      new_balance := current_balance + amt;
      last_balance := new_balance;

      update public.profiles p
      set
        balance = new_balance,
        total_wins = total_wins + amt,
        updated_at = now()
      where p.id = uid;

      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (uid, 'win', amt, new_balance, 'Case battle win', outcome_at);
      outcome_at := outcome_at + interval '1 millisecond';
    end loop;

    if last_balance is not null then
      return query select last_balance;
    end if;
    return query select null::numeric;
  end if;

  if p_winner_id is not null and coalesce(p_winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = p_winner_id
    for update;

    new_balance := current_balance + p_winner_payout;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + p_winner_payout,
      updated_at = now()
    where p.id = p_winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_winner_id,
      'win',
      p_winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );

    return query select new_balance;
  end if;

  return query select null::numeric;
end;
$$;

revoke all on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.complete_case_battle(uuid, uuid, int, numeric, numeric, text, jsonb, jsonb, jsonb) to service_role;


-- ===================================================
-- MIGRATION: 20250522100000_case_battles_50_rounds.sql
-- ===================================================
-- Case battles: up to 50 rounds per battle (cases.gg-style)

alter table public.case_battles
  drop constraint if exists case_battles_rounds_check;

alter table public.case_battles
  add constraint case_battles_rounds_check
  check (rounds >= 1 and rounds <= 50);


-- ===================================================
-- MIGRATION: 20250522200000_case_battles_list_expiry.sql
-- ===================================================
-- List waiting/running battles + completed battles for 10 minutes after they end

-- (removed manual drop)

drop function if exists public.get_open_case_battles(p_limit int) cascade;
create function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  status text,
  completed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case when b.status = 'waiting' then 0 when b.status = 'running' then 1 else 2 end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;


-- ===================================================
-- MIGRATION: 20250522300000_case_battles_options.sql
-- ===================================================
-- Case battle options: crazy mode, fast spin, per-player borrow

alter table public.case_battles
  add column if not exists crazy_mode boolean not null default false,
  add column if not exists fast_spin boolean not null default false;

alter table public.case_battle_players
  add column if not exists borrow_percent int not null default 0,
  add column if not exists entry_paid numeric(12, 2);

alter table public.case_battle_players
  drop constraint if exists case_battle_players_borrow_check;

alter table public.case_battle_players
  add constraint case_battle_players_borrow_check
  check (borrow_percent >= 0 and borrow_percent <= 80);

-- (removed manual drop)

drop function if exists public.create_case_battle_entry(p_user_id uuid, p_battle_id uuid, p_slot_index int, p_entry_cost numeric, p_display_name text, p_borrow_percent int) cascade;
create function public.create_case_battle_entry(
  p_user_id uuid,
  p_battle_id uuid,
  p_slot_index int,
  p_entry_cost numeric,
  p_display_name text default 'Player',
  p_borrow_percent int default 0
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  wager_at timestamptz := clock_timestamp();
  borrow_pct int;
  actual_cost numeric(12, 2);
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not open for joins';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.user_id = p_user_id
  ) then
    raise exception 'Already in this battle';
  end if;

  borrow_pct := greatest(0, least(coalesce(p_borrow_percent, 0), 80));
  actual_cost := round(p_entry_cost * (1 - borrow_pct::numeric / 100), 2);

  if actual_cost <= 0 then
    raise exception 'Invalid entry cost';
  end if;

  select p.balance into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < actual_cost then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - actual_cost;

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + actual_cost,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.case_battle_players (
    battle_id, user_id, is_bot, slot_index, display_name, borrow_percent, entry_paid
  )
  values (
    p_battle_id,
    p_user_id,
    false,
    p_slot_index,
    coalesce(nullif(trim(p_display_name), ''), 'Player'),
    borrow_pct,
    actual_cost
  );

  update public.case_battles
  set pot_total = pot_total + actual_cost
  where id = p_battle_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'wager',
    -actual_cost,
    new_balance,
    case
      when borrow_pct > 0 then format('Case battle entry (%s%% borrow)', borrow_pct)
      else 'Case battle entry'
    end,
    wager_at
  );

  return query select new_balance;
end;
$$;

revoke all on function public.create_case_battle_entry(uuid, uuid, int, numeric, text, int) from public;
grant execute on function public.create_case_battle_entry(uuid, uuid, int, numeric, text, int) to service_role;


-- ===================================================
-- MIGRATION: 20250522310000_case_battles_list_options.sql
-- ===================================================
-- Expose battle options on lobby list

-- (removed manual drop)

drop function if exists public.get_open_case_battles(p_limit int) cascade;
create function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  crazy_mode boolean,
  fast_spin boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  status text,
  completed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    coalesce(b.crazy_mode, false),
    coalesce(b.fast_spin, false),
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case when b.status = 'waiting' then 0 when b.status = 'running' then 1 else 2 end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;


-- ===================================================
-- MIGRATION: 20250522400000_withdrawal_balance_deduct.sql
-- ===================================================
-- Withdrawals must deduct balance immediately. The profiles balance guard trigger
-- was reverting balance changes from security-definer RPCs called as authenticated.

drop function if exists public.bypass_profile_balance_guard() cascade;
create function public.bypass_profile_balance_guard()
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

drop function if exists public.profiles_prevent_balance_change() cascade;
create function public.profiles_prevent_balance_change()
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

drop function if exists public.request_crypto_withdrawal(p_chain text, p_destination text, p_usd_amount numeric) cascade;
create function public.request_crypto_withdrawal(
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

drop function if exists public.admin_fail_crypto_withdrawal(p_withdrawal_id uuid, p_error_message text) cascade;
create function public.admin_fail_crypto_withdrawal(
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


-- ===================================================
-- MIGRATION: 20250522500000_case_battles_eos.sql
-- ===================================================
-- EOS block commitment before case battles start

alter table public.case_battles
  add column if not exists internal_battle_seed text,
  add column if not exists eos_commit_block_num bigint,
  add column if not exists eos_target_block_num bigint,
  add column if not exists eos_block_num bigint,
  add column if not exists eos_block_id text;

alter table public.case_battles drop constraint if exists case_battles_status_check;

alter table public.case_battles
  add constraint case_battles_status_check
  check (status in ('waiting', 'pending_eos', 'running', 'completed', 'cancelled'));

drop function if exists public.mark_case_battle_running(p_battle_id uuid, p_battle_seed_hash text) cascade;
create function public.mark_case_battle_running(
  p_battle_id uuid,
  p_battle_seed_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_battles
  set
    status = 'running',
    battle_seed_hash = coalesce(p_battle_seed_hash, battle_seed_hash),
    started_at = coalesce(started_at, now())
  where id = p_battle_id and status in ('waiting', 'pending_eos');
end;
$$;

-- (removed manual drop)

drop function if exists public.get_open_case_battles(p_limit int) cascade;
create function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  crazy_mode boolean,
  fast_spin boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  status text,
  completed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    coalesce(b.crazy_mode, false),
    coalesce(b.fast_spin, false),
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'pending_eos', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case
      when b.status = 'waiting' then 0
      when b.status = 'pending_eos' then 1
      when b.status = 'running' then 2
      else 3
    end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;


-- ===================================================
-- MIGRATION: 20250522600000_case_battles_complete_idempotent.sql
-- ===================================================
-- Idempotent battle completion: allow pending_eos, skip double payout on race

drop function if exists public.complete_case_battle(p_battle_id uuid, p_winner_id uuid, p_winner_slot int, p_winner_payout numeric, p_pot_total numeric, p_battle_seed text, p_results jsonb, p_players jsonb, p_winner_payouts jsonb) cascade;
create function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb,
  p_winner_payouts jsonb default '[]'::jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  player_row jsonb;
  payout_row jsonb;
  uid uuid;
  amt numeric(12, 2);
  last_balance numeric(12, 2);
  battle_status text;
begin
  select b.status into battle_status
  from public.case_battles b
  where b.id = p_battle_id
  for update;

  if battle_status is null then
    raise exception 'Battle not found';
  end if;

  if battle_status = 'completed' then
    return query select null::numeric;
    return;
  end if;

  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id and status in ('waiting', 'running', 'pending_eos');

  if not found then
    select b.status into battle_status
    from public.case_battles b
    where b.id = p_battle_id;

    if battle_status = 'completed' then
      return query select null::numeric;
      return;
    end if;

    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  if jsonb_array_length(coalesce(p_winner_payouts, '[]'::jsonb)) > 0 then
    for payout_row in select * from jsonb_array_elements(p_winner_payouts)
    loop
      uid := (payout_row->>'userId')::uuid;
      amt := coalesce((payout_row->>'amount')::numeric, 0);
      if uid is null or amt <= 0 then
        continue;
      end if;

      select p.balance into current_balance
      from public.profiles p
      where p.id = uid
      for update;

      new_balance := current_balance + amt;
      last_balance := new_balance;

      update public.profiles p
      set
        balance = new_balance,
        total_wins = total_wins + amt,
        updated_at = now()
      where p.id = uid;

      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (uid, 'win', amt, new_balance, 'Case battle win', outcome_at);
      outcome_at := outcome_at + interval '1 millisecond';
    end loop;

    if last_balance is not null then
      return query select last_balance;
    end if;
    return query select null::numeric;
  end if;

  if p_winner_id is not null and coalesce(p_winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = p_winner_id
    for update;

    new_balance := current_balance + p_winner_payout;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + p_winner_payout,
      updated_at = now()
    where p.id = p_winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_winner_id,
      'win',
      p_winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );

    return query select new_balance;
  end if;

  return query select null::numeric;
end;
$$;


-- ===================================================
-- MIGRATION: 20250522700000_case_battles_jackpot_eos.sql
-- ===================================================
-- Second EOS commitment for jackpot winner selection

alter table public.case_battles
  add column if not exists jackpot_eos_commit_block_num bigint,
  add column if not exists jackpot_eos_target_block_num bigint,
  add column if not exists jackpot_eos_block_num bigint,
  add column if not exists jackpot_eos_block_id text;

alter table public.case_battles drop constraint if exists case_battles_status_check;

alter table public.case_battles
  add constraint case_battles_status_check
  check (status in ('waiting', 'pending_eos', 'running', 'pending_jackpot_eos', 'completed', 'cancelled'));

-- (removed manual drop)

drop function if exists public.get_open_case_battles(p_limit int) cascade;
create function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  crazy_mode boolean,
  fast_spin boolean,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  status text,
  completed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    coalesce(b.crazy_mode, false),
    coalesce(b.fast_spin, false),
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'pending_eos', 'pending_jackpot_eos', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case
      when b.status = 'waiting' then 0
      when b.status = 'pending_eos' then 1
      when b.status = 'pending_jackpot_eos' then 2
      when b.status = 'running' then 3
      else 4
    end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;

-- Allow completing from pending_jackpot_eos (rounds staged, jackpot resolved)
drop function if exists public.complete_case_battle(p_battle_id uuid, p_winner_id uuid, p_winner_slot int, p_winner_payout numeric, p_pot_total numeric, p_battle_seed text, p_results jsonb, p_players jsonb, p_winner_payouts jsonb) cascade;
create function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb,
  p_winner_payouts jsonb default '[]'::jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  player_row jsonb;
  payout_row jsonb;
  uid uuid;
  amt numeric(12, 2);
  last_balance numeric(12, 2);
  battle_status text;
begin
  select b.status into battle_status
  from public.case_battles b
  where b.id = p_battle_id
  for update;

  if battle_status is null then
    raise exception 'Battle not found';
  end if;

  if battle_status = 'completed' then
    return query select null::numeric;
    return;
  end if;

  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id and status in ('waiting', 'running', 'pending_eos', 'pending_jackpot_eos');

  if not found then
    select b.status into battle_status
    from public.case_battles b
    where b.id = p_battle_id;

    if battle_status = 'completed' then
      return query select null::numeric;
      return;
    end if;

    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  if jsonb_array_length(coalesce(p_winner_payouts, '[]'::jsonb)) > 0 then
    for payout_row in select * from jsonb_array_elements(p_winner_payouts)
    loop
      uid := (payout_row->>'userId')::uuid;
      amt := coalesce((payout_row->>'amount')::numeric, 0);
      if uid is null or amt <= 0 then
        continue;
      end if;

      select p.balance into current_balance
      from public.profiles p
      where p.id = uid
      for update;

      new_balance := current_balance + amt;
      last_balance := new_balance;

      update public.profiles p
      set
        balance = new_balance,
        total_wins = total_wins + amt,
        updated_at = now()
      where p.id = uid;

      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (uid, 'win', amt, new_balance, 'Case battle win', outcome_at);
      outcome_at := outcome_at + interval '1 millisecond';
    end loop;

    if last_balance is not null then
      return query select last_balance;
    end if;
    return query select null::numeric;
  end if;

  if p_winner_id is not null and coalesce(p_winner_payout, 0) > 0 then
    select p.balance into current_balance
    from public.profiles p
    where p.id = p_winner_id
    for update;

    new_balance := current_balance + p_winner_payout;

    update public.profiles p
    set
      balance = new_balance,
      total_wins = total_wins + p_winner_payout,
      updated_at = now()
    where p.id = p_winner_id;

    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_winner_id,
      'win',
      p_winner_payout,
      new_balance,
      'Case battle win',
      outcome_at
    );

    return query select new_balance;
  end if;

  return query select null::numeric;
end;
$$;


-- ===================================================
-- MIGRATION: 20250522800000_case_battle_bot_unique_names.sql
-- ===================================================
-- Superseded by 20250522900000_case_battle_bot_random_roster.sql (10 bots, random pick).
-- Assign unique bot display names atomically when inserting (prevents duplicate "Bot 1" on fast clicks).

drop function if exists public.insert_case_battle_bot(p_battle_id uuid, p_slot_index int) cascade;
create function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  v_name text;
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not waiting for players';
  end if;

  if p_slot_index < 0 or p_slot_index >= b.max_players then
    raise exception 'Invalid slot';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  select n.name into v_name
  from (
    values
      ('Rusty', 1),
      ('Blitz', 2),
      ('Nova', 3),
      ('Cipher', 4),
      ('Vega', 5),
      ('Onyx', 6),
      ('Rex', 7),
      ('Flint', 8),
      ('Jinx', 9),
      ('Sable', 10),
      ('Duke', 11),
      ('Kite', 12),
      ('Mako', 13),
      ('Zara', 14),
      ('Echo', 15),
      ('Grip', 16),
      ('Haze', 17),
      ('Lux', 18),
      ('Volt', 19),
      ('Wren', 20)
  ) as n(name, ord)
  where n.name not in (
    select p.display_name
    from public.case_battle_players p
    where p.battle_id = p_battle_id
      and p.is_bot
  )
  order by n.ord
  limit 1;

  if v_name is null then
    v_name := 'Bot ' || (
      select count(*)::int + 1
      from public.case_battle_players p
      where p.battle_id = p_battle_id and p.is_bot
    );
  end if;

  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, v_name);
end;
$$;


-- ===================================================
-- MIGRATION: 20250522900000_case_battle_bot_random_roster.sql
-- ===================================================
-- Ten named battle bots; each "Call bot" picks one at random from those not already in the lobby.

drop function if exists public.insert_case_battle_bot(p_battle_id uuid, p_slot_index int) cascade;
create function public.insert_case_battle_bot(
  p_battle_id uuid,
  p_slot_index int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.case_battles%rowtype;
  v_name text;
begin
  select * into b
  from public.case_battles
  where id = p_battle_id
  for update;

  if not found then
    raise exception 'Battle not found';
  end if;

  if b.status <> 'waiting' then
    raise exception 'Battle is not waiting for players';
  end if;

  if p_slot_index < 0 or p_slot_index >= b.max_players then
    raise exception 'Invalid slot';
  end if;

  if exists (
    select 1 from public.case_battle_players p
    where p.battle_id = p_battle_id and p.slot_index = p_slot_index
  ) then
    raise exception 'Slot already taken';
  end if;

  with roster(name) as (
    values
      ('Rusty'),
      ('Blitz'),
      ('Nova'),
      ('Cipher'),
      ('Vega'),
      ('Onyx'),
      ('Rex'),
      ('Flint'),
      ('Jinx'),
      ('Sable')
  ),
  taken as (
    select p.display_name
    from public.case_battle_players p
    where p.battle_id = p_battle_id
      and p.is_bot
  )
  select r.name into v_name
  from roster r
  where r.name not in (select t.display_name from taken t)
  order by random()
  limit 1;

  if v_name is null then
    select r.name into v_name
    from (
      values
        ('Rusty'),
        ('Blitz'),
        ('Nova'),
        ('Cipher'),
        ('Vega'),
        ('Onyx'),
        ('Rex'),
        ('Flint'),
        ('Jinx'),
        ('Sable')
    ) as r(name)
    order by random()
    limit 1;
  end if;

  insert into public.case_battle_players (battle_id, user_id, is_bot, slot_index, display_name)
  values (p_battle_id, null, true, p_slot_index, v_name);
end;
$$;


-- ===================================================
-- MIGRATION: 20250523000000_chat_user_levels.sql
-- ===================================================
-- Expose wager totals for chat level badges (no balance or other profile fields).

drop function if exists public.get_user_wager_levels(user_ids uuid[]) cascade;
create function public.get_user_wager_levels(user_ids uuid[])
returns table(user_id uuid, total_wagered numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.total_wagered, 0)
  from public.profiles p
  where p.id = any(user_ids);
$$;

revoke all on function public.get_user_wager_levels(uuid[]) from public;
grant execute on function public.get_user_wager_levels(uuid[]) to authenticated;


-- ===================================================
-- MIGRATION: 20250523100000_revoke_balance_bypass_from_users.sql
-- ===================================================
-- Balance bypass is only for internal security-definer RPCs, not direct client calls.

revoke execute on function public.bypass_profile_balance_guard() from authenticated;


-- ===================================================
-- MIGRATION: 20250523200000_consume_keno_nonce_advance.sql
-- ===================================================
-- consume_keno_nonce must advance next_nonce after each use (case battles use multiple nonces per battle).
drop function if exists public.consume_keno_nonce(p_user_id uuid, p_advance int) cascade;
create function public.consume_keno_nonce(p_user_id uuid, p_advance int default 1)
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


-- ===================================================
-- MIGRATION: 20250524100000_case_battle_payout_fix.sql
-- ===================================================
-- Fix double Case Battle win credits (RETURN QUERY does not exit plpgsql functions)
-- and defer balance credit until the client claims after playback.

alter table public.case_battles
  add column if not exists payouts_credited boolean not null default false;

-- Battles already paid (including mistaken double credits) must not be paid again on claim.
update public.case_battles
set payouts_credited = true
where status = 'completed'
  and coalesce(winner_payout, 0) > 0;

drop function if exists public.complete_case_battle(p_battle_id uuid, p_winner_id uuid, p_winner_slot int, p_winner_payout numeric, p_pot_total numeric, p_battle_seed text, p_results jsonb, p_players jsonb, p_winner_payouts jsonb) cascade;
create function public.complete_case_battle(
  p_battle_id uuid,
  p_winner_id uuid,
  p_winner_slot int,
  p_winner_payout numeric,
  p_pot_total numeric,
  p_battle_seed text,
  p_results jsonb,
  p_players jsonb,
  p_winner_payouts jsonb default '[]'::jsonb
)
returns table (out_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row jsonb;
  battle_status text;
begin
  select b.status into battle_status
  from public.case_battles b
  where b.id = p_battle_id
  for update;

  if battle_status is null then
    raise exception 'Battle not found';
  end if;

  if battle_status = 'completed' then
    return;
  end if;

  update public.case_battles
  set
    status = 'completed',
    winner_id = p_winner_id,
    winner_slot = p_winner_slot,
    winner_payout = coalesce(p_winner_payout, 0),
    pot_total = p_pot_total,
    battle_seed = p_battle_seed,
    results = p_results,
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = p_battle_id
    and status in ('waiting', 'running', 'pending_eos', 'pending_jackpot_eos');

  if not found then
    select b.status into battle_status
    from public.case_battles b
    where b.id = p_battle_id;

    if battle_status = 'completed' then
      return;
    end if;

    raise exception 'Battle cannot be completed';
  end if;

  for player_row in select * from jsonb_array_elements(p_players)
  loop
    update public.case_battle_players
    set
      total_value = (player_row->>'totalValue')::numeric,
      round_drops = coalesce(player_row->'drops', '[]'::jsonb)
    where battle_id = p_battle_id
      and slot_index = (player_row->>'slot')::int;
  end loop;

  return;
end;
$$;

drop function if exists public.apply_case_battle_payouts(p_battle_id uuid, p_user_id uuid) cascade;
create function public.apply_case_battle_payouts(
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


-- ===================================================
-- MIGRATION: 20250524200000_fix_consume_keno_nonce_and_stats.sql
-- ===================================================
-- Fix ambiguous consume_keno_nonce(uuid) vs consume_keno_nonce(uuid, int) overload.
-- PostgREST calls with only p_user_id cannot pick between them when p_advance has a default.

-- (removed manual drop)

drop function if exists public.consume_keno_nonce(p_user_id uuid, p_advance int) cascade;
create function public.consume_keno_nonce(p_user_id uuid, p_advance int default 1)
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
drop function if exists public.apply_case_battle_payouts(p_battle_id uuid, p_user_id uuid) cascade;
create function public.apply_case_battle_payouts(
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


-- ===================================================
-- MIGRATION: 20250525000000_roulette_game.sql
-- ===================================================
-- European Roulette: bet red, black, or green (0). Provably fair via game_pf_seeds.

create table if not exists public.roulette_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  bet_type text not null check (bet_type in ('red', 'black', 'green')),
  result_pocket smallint not null check (result_pocket >= 0 and result_pocket <= 36),
  result_color text not null check (result_color in ('red', 'black', 'green')),
  won boolean not null,
  payout numeric(12, 2) not null default 0,
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists roulette_bets_user_id_created_at_idx
  on public.roulette_bets (user_id, created_at desc);

alter table public.roulette_bets enable row level security;

drop policy if exists "Users read own roulette bets" on public.roulette_bets;
create policy "Users read own roulette bets"
  on public.roulette_bets for select
  using (auth.uid() = user_id);

grant select on public.roulette_bets to authenticated;
grant all on table public.roulette_bets to service_role;

drop function if exists public.settle_roulette_bet(p_user_id uuid, p_wager numeric, p_bet_type text, p_result_pocket smallint, p_result_color text, p_won boolean, p_payout numeric, p_nonce bigint) cascade;
create function public.settle_roulette_bet(
  p_user_id uuid,
  p_wager numeric,
  p_bet_type text,
  p_result_pocket smallint,
  p_result_color text,
  p_won boolean,
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_bet_type not in ('red', 'black', 'green') then
    raise exception 'Invalid bet type';
  end if;

  if p_result_pocket < 0 or p_result_pocket > 36 then
    raise exception 'Invalid result pocket';
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

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  update public.profiles p
  set
    balance = new_balance,
    total_wagered = total_wagered + p_wager,
    total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
    total_losses = total_losses + case when not p_won then p_wager else 0 end,
    updated_at = now()
  where p.id = p_user_id;

  insert into public.roulette_bets (
    user_id, wager, bet_type, result_pocket, result_color, won, payout, nonce
  )
  values (
    p_user_id,
    p_wager,
    p_bet_type,
    p_result_pocket,
    p_result_color,
    p_won,
    coalesce(p_payout, 0),
    p_nonce
  )
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id,
    'wager',
    -p_wager,
    current_balance - p_wager,
    'Roulette ' || p_bet_type,
    wager_at
  );

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'win',
      p_payout,
      new_balance,
      'Roulette ' || p_bet_type || ' — ' || p_result_color || ' ' || p_result_pocket::text,
      outcome_at
    );
  elsif not p_won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id,
      'loss',
      -p_wager,
      new_balance,
      'Roulette ' || p_bet_type || ' — ' || p_result_color || ' ' || p_result_pocket::text,
      outcome_at
    );
  end if;

  update public.game_pf_seeds
  set next_nonce = p_nonce + 1, updated_at = now()
  where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.settle_roulette_bet(uuid, numeric, text, smallint, text, boolean, numeric, bigint) from public;
grant execute on function public.settle_roulette_bet(uuid, numeric, text, smallint, text, boolean, numeric, bigint) to service_role;

drop function if exists public.get_roulette_pf_state() cascade;
create function public.get_roulette_pf_state()
returns table (
  server_seed_hash text,
  client_seed text,
  next_nonce bigint
)
language sql
security definer
set search_path = public
as $$
  select * from public.get_keno_pf_state();
$$;

grant execute on function public.get_roulette_pf_state() to authenticated;

drop function if exists public.set_roulette_client_seed(p_client_seed text) cascade;
create function public.set_roulette_client_seed(p_client_seed text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_keno_client_seed(p_client_seed);
$$;

grant execute on function public.set_roulette_client_seed(text) to authenticated;


-- ===================================================
-- MIGRATION: 20250525100000_mines_rtp_945.sql
-- ===================================================
-- Mines: RTP via extra bust odds (multipliers stay at 99%). Edge passes p_force_mine when bias triggers.

drop function if exists public.mines_reveal_tile(p_user_id uuid, p_game_id uuid, p_tile int, p_force_mine boolean) cascade;
create function public.mines_reveal_tile(
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


-- ===================================================
-- MIGRATION: 20250525200000_affiliates.sql
-- ===================================================
-- Affiliates: referral codes, 5% deposit commission, $1 per $100 wagered (proportional)

alter table public.profiles
  add column if not exists affiliate_code text,
  add column if not exists referred_by uuid references public.profiles (id) on delete set null;

create unique index if not exists profiles_affiliate_code_key
  on public.profiles (affiliate_code)
  where affiliate_code is not null;

create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by)
  where referred_by is not null;

alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('deposit', 'withdrawal', 'wager', 'win', 'loss', 'affiliate'));

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'wager')),
  base_amount numeric(12, 2) not null,
  commission_amount numeric(12, 2) not null,
  source_transaction_id uuid unique references public.transactions (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_commissions_affiliate_created_idx
  on public.affiliate_commissions (affiliate_id, created_at desc);

alter table public.affiliate_commissions
  add column if not exists claimed_at timestamptz;

alter table public.affiliate_commissions enable row level security;

drop policy if exists "Affiliates read own commissions" on public.affiliate_commissions;

create policy "Affiliates read own commissions"
  on public.affiliate_commissions for select
  using (auth.uid() = affiliate_id);

grant select on public.affiliate_commissions to authenticated;

-- Normalize referral codes to uppercase (case-insensitive input)
drop function if exists public.normalize_affiliate_code(p_code text) cascade;
create function public.normalize_affiliate_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Unique referral code (8 chars, A-Z0-9)
drop function if exists public.generate_unique_affiliate_code() cascade;
create function public.generate_unique_affiliate_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  i int;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.profiles p where p.affiliate_code = code
    );
    attempts := attempts + 1;
    if attempts > 100 then
      raise exception 'Could not generate affiliate code';
    end if;
  end loop;
  return code;
end;
$$;

drop function if exists public.ensure_user_affiliate_code(p_user_id uuid) cascade;
create function public.ensure_user_affiliate_code(p_user_id uuid default auth.uid())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.normalize_affiliate_code(p.affiliate_code) into code
  from public.profiles p
  where p.id = p_user_id;

  if code is not null and code <> '' then
    return code;
  end if;

  code := public.generate_unique_affiliate_code();

  update public.profiles
  set affiliate_code = code, updated_at = now()
  where id = p_user_id and (affiliate_code is null or affiliate_code = '');

  return code;
end;
$$;

revoke all on function public.ensure_user_affiliate_code(uuid) from public;
grant execute on function public.ensure_user_affiliate_code(uuid) to authenticated;
grant execute on function public.ensure_user_affiliate_code(uuid) to service_role;

-- Backfill codes for existing profiles
do $$
declare
  r record;
begin
  for r in
    select id from public.profiles where affiliate_code is null or affiliate_code = ''
  loop
    perform public.ensure_user_affiliate_code(r.id);
  end loop;
end $$;

drop function if exists public.apply_affiliate_referral(p_user_id uuid, p_code text) cascade;
create function public.apply_affiliate_referral(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  normalized text;
begin
  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return;
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> p_user_id;

  if aff_id is null then
    return;
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = p_user_id
    and referred_by is null;
end;
$$;

revoke all on function public.apply_affiliate_referral(uuid, text) from public;
grant execute on function public.apply_affiliate_referral(uuid, text) to service_role;

-- Credit affiliate when a referred user deposits or wagers (trigger on transactions)
drop function if exists public.trg_affiliate_commission_on_transaction() cascade;
create function public.trg_affiliate_commission_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  rate numeric;
  commission numeric(12, 2);
  base_amt numeric(12, 2);
begin
  if NEW.type = 'deposit' then
    base_amt := NEW.amount;
    rate := 0.05;
  elsif NEW.type = 'wager' then
    base_amt := abs(NEW.amount);
    rate := 0.01;
  else
    return NEW;
  end if;

  if base_amt <= 0 then
    return NEW;
  end if;

  select p.referred_by into aff_id
  from public.profiles p
  where p.id = NEW.user_id;

  if aff_id is null then
    return NEW;
  end if;

  commission := round(base_amt * rate, 2);
  if commission <= 0 then
    return NEW;
  end if;

  if exists (
    select 1
    from public.affiliate_commissions c
    where c.source_transaction_id = NEW.id
  ) then
    return NEW;
  end if;

  insert into public.affiliate_commissions (
    affiliate_id,
    referred_user_id,
    kind,
    base_amount,
    commission_amount,
    source_transaction_id
  )
  values (
    aff_id,
    NEW.user_id,
    case when NEW.type = 'deposit' then 'deposit' else 'wager' end,
    base_amt,
    commission,
    NEW.id
  );

  return NEW;
end;
$$;

drop trigger if exists affiliate_commission_on_transaction on public.transactions;

create trigger affiliate_commission_on_transaction
  after insert on public.transactions
  for each row
  execute function public.trg_affiliate_commission_on_transaction();

-- Claim pending affiliate earnings to main balance
drop function if exists public.claim_affiliate_earnings() cascade;
create function public.claim_affiliate_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claim_amt numeric(12, 2);
  new_bal numeric(12, 2);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(sum(c.commission_amount), 0)::numeric(12, 2)
  into claim_amt
  from public.affiliate_commissions c
  where c.affiliate_id = uid
    and c.claimed_at is null;

  if claim_amt <= 0 then
    select p.balance into new_bal from public.profiles p where p.id = uid;
    return jsonb_build_object('claimed_amount', 0, 'claimable_balance', 0, 'balance', coalesce(new_bal, 0));
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into new_bal
  from public.profiles p
  where p.id = uid
  for update;

  new_bal := coalesce(new_bal, 0) + claim_amt;

  update public.profiles p
  set balance = new_bal, updated_at = now()
  where p.id = uid;

  update public.affiliate_commissions c
  set claimed_at = now()
  where c.affiliate_id = uid
    and c.claimed_at is null;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (uid, 'affiliate', claim_amt, new_bal, 'Affiliate earnings claimed');

  select p.balance into new_bal from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'claimed_amount', claim_amt,
    'claimable_balance', 0,
    'balance', coalesce(new_bal, 0)
  );
end;
$$;

revoke all on function public.claim_affiliate_earnings() from public;
grant execute on function public.claim_affiliate_earnings() to authenticated;

-- Stats for Promotions page
drop function if exists public.get_affiliate_stats() cascade;
create function public.get_affiliate_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  result jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  code := public.ensure_user_affiliate_code(uid);

  select jsonb_build_object(
    'affiliate_code', code,
    'referred_count', (
      select count(*)::int
      from public.profiles p
      where p.referred_by = uid
    ),
    'claimable_balance', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is null
    ), 0),
    'total_claimed', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is not null
    ), 0),
    'total_earned', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid
    ), 0),
    'earned_from_deposits', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'deposit' and c.claimed_at is null
    ), 0),
    'earned_from_wagers', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'wager' and c.claimed_at is null
    ), 0),
    'recent_commissions', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          c.id,
          c.kind,
          c.base_amount,
          c.commission_amount,
          c.created_at
        from public.affiliate_commissions c
        where c.affiliate_id = uid and c.claimed_at is null
        order by c.created_at desc
        limit 15
      ) x
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_affiliate_stats() from public;
grant execute on function public.get_affiliate_stats() to authenticated;

-- Transaction history: include affiliate type in sort order
drop function if exists public.get_user_transactions(p_page int, p_page_size int) cascade;
create function public.get_user_transactions(
  p_page int default 0,
  p_page_size int default 10
)
returns table (
  id uuid,
  type text,
  amount numeric,
  balance_after numeric,
  description text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lim int := greatest(1, least(coalesce(p_page_size, 10), 50));
  off int := greatest(0, coalesce(p_page, 0)) * lim;
  cnt bigint;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::bigint into cnt
  from public.transactions t
  where t.user_id = uid;

  return query
  select
    t.id,
    t.type,
    t.amount,
    t.balance_after,
    t.description,
    t.created_at,
    cnt
  from public.transactions t
  where t.user_id = uid
  order by
    t.created_at desc,
    case t.type
      when 'wager' then 0
      when 'loss' then 1
      when 'win' then 2
      when 'affiliate' then 3
      when 'deposit' then 4
      when 'withdrawal' then 5
      else 6
    end asc,
    t.id asc
  limit lim
  offset off;
end;
$$;

grant execute on function public.get_user_transactions(int, int) to authenticated;


-- ===================================================
-- MIGRATION: 20250525210000_affiliate_claimable.sql
-- ===================================================
-- Affiliate earnings accrue as unclaimed; user claims on Promotions page.

alter table public.affiliate_commissions
  add column if not exists claimed_at timestamptz;

-- Already auto-credited before this change: mark claimed so balance is not claimable twice.
update public.affiliate_commissions c
set claimed_at = c.created_at
where c.claimed_at is null
  and exists (
    select 1
    from public.transactions t
    where t.user_id = c.affiliate_id
      and t.type = 'affiliate'
      and t.amount = c.commission_amount
      and t.created_at >= c.created_at - interval '2 seconds'
      and t.created_at <= c.created_at + interval '2 seconds'
  );

drop function if exists public.trg_affiliate_commission_on_transaction() cascade;
create function public.trg_affiliate_commission_on_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  rate numeric;
  commission numeric(12, 2);
  base_amt numeric(12, 2);
begin
  if NEW.type = 'deposit' then
    base_amt := NEW.amount;
    rate := 0.05;
  elsif NEW.type = 'wager' then
    base_amt := abs(NEW.amount);
    rate := 0.01;
  else
    return NEW;
  end if;

  if base_amt <= 0 then
    return NEW;
  end if;

  select p.referred_by into aff_id
  from public.profiles p
  where p.id = NEW.user_id;

  if aff_id is null then
    return NEW;
  end if;

  commission := round(base_amt * rate, 2);
  if commission <= 0 then
    return NEW;
  end if;

  if exists (
    select 1
    from public.affiliate_commissions c
    where c.source_transaction_id = NEW.id
  ) then
    return NEW;
  end if;

  insert into public.affiliate_commissions (
    affiliate_id,
    referred_user_id,
    kind,
    base_amount,
    commission_amount,
    source_transaction_id
  )
  values (
    aff_id,
    NEW.user_id,
    case when NEW.type = 'deposit' then 'deposit' else 'wager' end,
    base_amt,
    commission,
    NEW.id
  );

  return NEW;
end;
$$;

drop function if exists public.claim_affiliate_earnings() cascade;
create function public.claim_affiliate_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claim_amt numeric(12, 2);
  new_bal numeric(12, 2);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(sum(c.commission_amount), 0)::numeric(12, 2)
  into claim_amt
  from public.affiliate_commissions c
  where c.affiliate_id = uid
    and c.claimed_at is null;

  if claim_amt <= 0 then
    select p.balance into new_bal from public.profiles p where p.id = uid;
    return jsonb_build_object('claimed_amount', 0, 'claimable_balance', 0, 'balance', coalesce(new_bal, 0));
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into new_bal
  from public.profiles p
  where p.id = uid
  for update;

  new_bal := coalesce(new_bal, 0) + claim_amt;

  update public.profiles p
  set balance = new_bal, updated_at = now()
  where p.id = uid;

  update public.affiliate_commissions c
  set claimed_at = now()
  where c.affiliate_id = uid
    and c.claimed_at is null;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (uid, 'affiliate', claim_amt, new_bal, 'Affiliate earnings claimed');

  select p.balance into new_bal from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'claimed_amount', claim_amt,
    'claimable_balance', 0,
    'balance', coalesce(new_bal, 0)
  );
end;
$$;

revoke all on function public.claim_affiliate_earnings() from public;
grant execute on function public.claim_affiliate_earnings() to authenticated;

drop function if exists public.get_affiliate_stats() cascade;
create function public.get_affiliate_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  result jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  code := public.ensure_user_affiliate_code(uid);

  select jsonb_build_object(
    'affiliate_code', code,
    'referred_count', (
      select count(*)::int
      from public.profiles p
      where p.referred_by = uid
    ),
    'claimable_balance', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is null
    ), 0),
    'total_claimed', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is not null
    ), 0),
    'total_earned', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid
    ), 0),
    'earned_from_deposits', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'deposit' and c.claimed_at is null
    ), 0),
    'earned_from_wagers', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'wager' and c.claimed_at is null
    ), 0),
    'recent_commissions', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          c.id,
          c.kind,
          c.base_amount,
          c.commission_amount,
          c.created_at
        from public.affiliate_commissions c
        where c.affiliate_id = uid and c.claimed_at is null
        order by c.created_at desc
        limit 15
      ) x
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;


-- ===================================================
-- MIGRATION: 20250525220000_affiliate_referral_submit.sql
-- ===================================================
-- Let logged-in users apply a referral code once (Promotions page).

drop function if exists public.submit_affiliate_referral_code(p_code text) cascade;
create function public.submit_affiliate_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  normalized text;
  aff_id uuid;
  current_referred_by uuid;
  my_code text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return jsonb_build_object('success', false, 'error', 'Enter a valid referral code.');
  end if;

  select p.referred_by, public.normalize_affiliate_code(p.affiliate_code)
  into current_referred_by, my_code
  from public.profiles p
  where p.id = uid;

  if current_referred_by is not null then
    return jsonb_build_object('success', false, 'error', 'You already have a referral code on your account.');
  end if;

  if my_code is not null and my_code = normalized then
    return jsonb_build_object('success', false, 'error', 'You cannot use your own referral code.');
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> uid;

  if aff_id is null then
    return jsonb_build_object('success', false, 'error', 'That referral code was not found.');
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = uid
    and referred_by is null;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Could not apply referral code. Try again.');
  end if;

  return jsonb_build_object(
    'success', true,
    'referrer_code', normalized
  );
end;
$$;

revoke all on function public.submit_affiliate_referral_code(text) from public;
grant execute on function public.submit_affiliate_referral_code(text) to authenticated;

drop function if exists public.get_affiliate_stats() cascade;
create function public.get_affiliate_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  result jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  code := public.ensure_user_affiliate_code(uid);

  select jsonb_build_object(
    'affiliate_code', code,
    'has_referrer', (
      select p.referred_by is not null
      from public.profiles p
      where p.id = uid
    ),
    'referrer_code', (
      select r.affiliate_code
      from public.profiles p
      join public.profiles r on r.id = p.referred_by
      where p.id = uid
    ),
    'referred_count', (
      select count(*)::int
      from public.profiles p
      where p.referred_by = uid
    ),
    'claimable_balance', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is null
    ), 0),
    'total_claimed', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.claimed_at is not null
    ), 0),
    'total_earned', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid
    ), 0),
    'earned_from_deposits', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'deposit' and c.claimed_at is null
    ), 0),
    'earned_from_wagers', coalesce((
      select sum(c.commission_amount)
      from public.affiliate_commissions c
      where c.affiliate_id = uid and c.kind = 'wager' and c.claimed_at is null
    ), 0),
    'recent_commissions', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          c.id,
          c.kind,
          c.base_amount,
          c.commission_amount,
          c.created_at
        from public.affiliate_commissions c
        where c.affiliate_id = uid and c.claimed_at is null
        order by c.created_at desc
        limit 15
      ) x
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;


-- ===================================================
-- MIGRATION: 20250525230000_affiliate_codes_uppercase.sql
-- ===================================================
-- Referral codes: store and match as uppercase (input case-insensitive).

drop function if exists public.normalize_affiliate_code(p_code text) cascade;
create function public.normalize_affiliate_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Existing codes → uppercase
update public.profiles
set affiliate_code = public.normalize_affiliate_code(affiliate_code)
where affiliate_code is not null
  and affiliate_code <> ''
  and affiliate_code <> public.normalize_affiliate_code(affiliate_code);

drop function if exists public.generate_unique_affiliate_code() cascade;
create function public.generate_unique_affiliate_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
  i int;
  attempts int := 0;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.profiles p where p.affiliate_code = code
    );
    attempts := attempts + 1;
    if attempts > 100 then
      raise exception 'Could not generate affiliate code';
    end if;
  end loop;
  return code;
end;
$$;

drop function if exists public.ensure_user_affiliate_code(p_user_id uuid) cascade;
create function public.ensure_user_affiliate_code(p_user_id uuid default auth.uid())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select public.normalize_affiliate_code(p.affiliate_code) into code
  from public.profiles p
  where p.id = p_user_id;

  if code is not null and code <> '' then
    if code <> (select affiliate_code from public.profiles where id = p_user_id) then
      update public.profiles
      set affiliate_code = code, updated_at = now()
      where id = p_user_id;
    end if;
    return code;
  end if;

  code := public.generate_unique_affiliate_code();

  update public.profiles
  set affiliate_code = code, updated_at = now()
  where id = p_user_id and (affiliate_code is null or affiliate_code = '');

  return code;
end;
$$;

drop function if exists public.apply_affiliate_referral(p_user_id uuid, p_code text) cascade;
create function public.apply_affiliate_referral(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aff_id uuid;
  normalized text;
begin
  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return;
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> p_user_id;

  if aff_id is null then
    return;
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = p_user_id
    and referred_by is null;
end;
$$;

drop function if exists public.submit_affiliate_referral_code(p_code text) cascade;
create function public.submit_affiliate_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  normalized text;
  aff_id uuid;
  current_referred_by uuid;
  my_code text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  normalized := public.normalize_affiliate_code(p_code);
  if normalized = '' or length(normalized) > 32 then
    return jsonb_build_object('success', false, 'error', 'Enter a valid referral code.');
  end if;

  select p.referred_by, public.normalize_affiliate_code(p.affiliate_code)
  into current_referred_by, my_code
  from public.profiles p
  where p.id = uid;

  if current_referred_by is not null then
    return jsonb_build_object('success', false, 'error', 'You already have a referral code on your account.');
  end if;

  if my_code is not null and my_code = normalized then
    return jsonb_build_object('success', false, 'error', 'You cannot use your own referral code.');
  end if;

  select p.id into aff_id
  from public.profiles p
  where p.affiliate_code = normalized
    and p.id <> uid;

  if aff_id is null then
    return jsonb_build_object('success', false, 'error', 'That referral code was not found.');
  end if;

  update public.profiles
  set referred_by = aff_id, updated_at = now()
  where id = uid
    and referred_by is null;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Could not apply referral code. Try again.');
  end if;

  return jsonb_build_object(
    'success', true,
    'referrer_code', normalized
  );
end;
$$;


-- ===================================================
-- MIGRATION: 20250525240000_fix_claim_affiliate_balance.sql
-- ===================================================
-- claim_affiliate_earnings must bypass profiles balance guard (same as withdrawals / games).

drop function if exists public.claim_affiliate_earnings() cascade;
create function public.claim_affiliate_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claim_amt numeric(12, 2);
  new_bal numeric(12, 2);
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(sum(c.commission_amount), 0)::numeric(12, 2)
  into claim_amt
  from public.affiliate_commissions c
  where c.affiliate_id = uid
    and c.claimed_at is null;

  if claim_amt <= 0 then
    select p.balance into new_bal from public.profiles p where p.id = uid;
    return jsonb_build_object('claimed_amount', 0, 'claimable_balance', 0, 'balance', coalesce(new_bal, 0));
  end if;

  perform public.bypass_profile_balance_guard();

  select p.balance into new_bal
  from public.profiles p
  where p.id = uid
  for update;

  new_bal := coalesce(new_bal, 0) + claim_amt;

  update public.profiles p
  set balance = new_bal, updated_at = now()
  where p.id = uid;

  update public.affiliate_commissions c
  set claimed_at = now()
  where c.affiliate_id = uid
    and c.claimed_at is null;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (uid, 'affiliate', claim_amt, new_bal, 'Affiliate earnings claimed');

  select p.balance into new_bal from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'claimed_amount', claim_amt,
    'claimable_balance', 0,
    'balance', coalesce(new_bal, 0)
  );
end;
$$;

revoke all on function public.claim_affiliate_earnings() from public;
grant execute on function public.claim_affiliate_earnings() to authenticated;


-- ===================================================
-- MIGRATION: 20250616000000_dual_currency.sql
-- ===================================================
-- Dual-currency sweepstakes system
-- Gold Coins (GC) = existing balance (play currency, no redemption value)
-- Sweeps Coins (SC) = redeemable currency (obtained free or as bonus)

-- Add sweeps_coins column (gold_coins reuses existing balance column)
alter table public.profiles
  add column if not exists sweeps_coins numeric(12, 2) not null default 0;

-- Redemptions table for SC cash-out
create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sc_amount numeric(12, 2) not null check (sc_amount >= 100),
  usd_amount numeric(12, 2) not null,
  chain text not null check (chain in ('sol', 'ltc', 'eth')),
  destination_address text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  tx_hash text,
  error_message text,
  processed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.redemptions enable row level security;

create policy "Users read own redemptions"
  on public.redemptions for select
  using (auth.uid() = user_id);

create policy "Users insert own redemptions"
  on public.redemptions for insert
  with check (auth.uid() = user_id);

grant select, insert on public.redemptions to authenticated;
grant all on table public.redemptions to service_role;

-- Update handle_new_user to grant welcome bonus
drop function if exists public.handle_new_user() cascade;
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, balance, sweeps_coins)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    1000,
    10
  );
  return new;
end;
$$;

-- Dual-currency credit (admin or system)
drop function if exists public.admin_credit_user(p_user_id uuid, p_amount numeric, p_note text, p_coin_type text) cascade;
create function public.admin_credit_user(
  p_user_id uuid,
  p_amount numeric,
  p_note text default 'Admin credit',
  p_coin_type text default 'balance'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _is_admin boolean;
begin
  select is_admin into _is_admin from public.profiles where id = auth.uid();
  if _is_admin is not true then
    raise exception 'Only admins can credit user balances.';
  end if;

  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    update public.profiles
    set balance = balance + p_amount,
        updated_at = now()
    where id = p_user_id;
  elsif p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = sweeps_coins + p_amount,
        updated_at = now()
    where id = p_user_id;
  else
    raise exception 'Invalid coin type. Use balance, gold_coins, or sweeps_coins.';
  end if;

  if not found then
    raise exception 'User not found.';
  end if;

  insert into public.admin_credit_log (user_id, amount, note, created_by, coin_type)
  values (p_user_id, p_amount, p_note, auth.uid(), p_coin_type);
end;
$$;

-- Add coin_type to admin_credit_log
alter table public.admin_credit_log add column if not exists coin_type text not null default 'balance';

-- Grant execute on updated function
grant execute on function public.admin_credit_user to authenticated;

-- Get coin balance RPC
drop function if exists public.get_coin_balance(p_coin_type text) cascade;
create function public.get_coin_balance(p_coin_type text default 'balance')
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  val numeric;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    select balance into val from public.profiles where id = uid;
  elsif p_coin_type = 'sweeps_coins' then
    select sweeps_coins into val from public.profiles where id = uid;
  else
    raise exception 'Invalid coin type';
  end if;
  return coalesce(val, 0);
end;
$$;

grant execute on function public.get_coin_balance to authenticated;

-- Adjust coins (atomic debit/credit, for system use only)
drop function if exists public.adjust_coins(p_user_id uuid, p_amount numeric, p_coin_type text) cascade;
create function public.adjust_coins(
  p_user_id uuid,
  p_amount numeric,
  p_coin_type text default 'balance'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_val numeric;
begin
  if p_coin_type = 'gold_coins' or p_coin_type = 'balance' then
    update public.profiles
    set balance = balance + p_amount,
        updated_at = now()
    where id = p_user_id
    returning balance into new_val;
  elsif p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = sweeps_coins + p_amount,
        updated_at = now()
    where id = p_user_id
    returning sweeps_coins into new_val;
  else
    raise exception 'Invalid coin type';
  end if;

  if not found then
    raise exception 'User not found';
  end if;

  if new_val < 0 then
    raise exception 'Insufficient balance';
  end if;

  return new_val;
end;
$$;

grant execute on function public.adjust_coins to service_role;

-- Request SC redemption
drop function if exists public.request_sc_redemption(p_sc_amount numeric, p_chain text, p_destination text) cascade;
create function public.request_sc_redemption(
  p_sc_amount numeric,
  p_chain text,
  p_destination text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_sc numeric(12, 2);
  usd_val numeric(12, 2);
  min_sc numeric := 100;
  rid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_chain not in ('sol', 'ltc', 'eth') then
    raise exception 'Unsupported chain';
  end if;

  if p_sc_amount < min_sc then
    raise exception 'Minimum redemption is % SC', min_sc;
  end if;

  usd_val := p_sc_amount; -- 1 SC = $0.10, so 100 SC = $10

  select sweeps_coins into current_sc
  from public.profiles where id = uid for update;

  if current_sc is null or current_sc < p_sc_amount then
    raise exception 'Insufficient Sweeps Coins balance';
  end if;

  update public.profiles
  set sweeps_coins = sweeps_coins - p_sc_amount,
      updated_at = now()
  where id = uid;

  insert into public.redemptions (user_id, sc_amount, usd_amount, chain, destination_address, status)
  values (uid, p_sc_amount, usd_val, p_chain, p_destination, 'pending')
  returning id into rid;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    uid,
    'redemption',
    -usd_val,
    current_sc - p_sc_amount,
    upper(p_chain) || ' SC redemption pending: ' || p_sc_amount || ' SC'
  );

  return rid;
end;
$$;

grant execute on function public.request_sc_redemption(numeric, text, text) to authenticated;

-- Process redemption (admin)
drop function if exists public.admin_process_redemption(p_redemption_id uuid, p_status text, p_tx_hash text) cascade;
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
  _is_admin boolean;
begin
  select is_admin into _is_admin from public.profiles where id = auth.uid();
  if _is_admin is not true then
    raise exception 'Only admins can process redemptions.';
  end if;

  if p_status = 'completed' then
    update public.redemptions
    set status = 'completed',
        tx_hash = coalesce(p_tx_hash, tx_hash),
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id and status = 'pending';
  elsif p_status = 'failed' then
    update public.redemptions
    set status = 'failed',
        error_message = p_tx_hash,
        processed_at = now(),
        processed_by = auth.uid()
    where id = p_redemption_id and status = 'pending';
  else
    raise exception 'Invalid status. Use completed or failed.';
  end if;

  if not found then
    raise exception 'Redemption not found or already processed.';
  end if;
end;
$$;

grant execute on function public.admin_process_redemption to authenticated;

-- Admin list redemptions
drop function if exists public.admin_list_redemptions(p_status text) cascade;
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
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
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

grant execute on function public.admin_list_redemptions to authenticated;

-- Update existing game settlement functions to accept p_coin_type
-- Settle Limbo Bet (dual currency)
drop function if exists public.settle_limbo_bet(p_user_id uuid, p_wager numeric, p_target_multiplier numeric, p_result_multiplier numeric, p_won boolean, p_payout numeric, p_nonce bigint, p_coin_type text) cascade;
create function public.settle_limbo_bet(
  p_user_id uuid,
  p_wager numeric,
  p_target_multiplier numeric,
  p_result_multiplier numeric,
  p_won boolean,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_target_multiplier < 1.01 or p_target_multiplier > 1000000 then
    raise exception 'Invalid target multiplier';
  end if;

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance
    from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance
    from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < p_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles
    set
      sweeps_coins = new_balance,
      total_wagered = total_wagered + p_wager,
      total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set
      balance = new_balance,
      total_wagered = total_wagered + p_wager,
      total_wins = total_wins + case when p_payout > 0 then p_payout else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.limbo_bets (user_id, wager, target_multiplier, result_multiplier, won, payout, nonce)
  values (p_user_id, p_wager, p_target_multiplier, p_result_multiplier, p_won, coalesce(p_payout, 0), p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Limbo @ ' || trim(to_char(p_target_multiplier, 'FM999999990.00')) || 'x',
    wager_at
  );

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Limbo hit ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x',
      outcome_at
    );
  elsif not p_won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (
      p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Limbo ' || trim(to_char(p_result_multiplier, 'FM999999990.00')) || 'x — below target',
      outcome_at
    );
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text) from public;
grant execute on function public.settle_limbo_bet(uuid, numeric, numeric, numeric, boolean, numeric, bigint, text) to service_role;

-- Settle Keno Bet (dual currency)
drop function if exists public.settle_keno_bet(p_user_id uuid, p_wager numeric, p_risk text, p_picks int[], p_drawn int[], p_hits int, p_multiplier numeric, p_payout numeric, p_nonce bigint, p_coin_type text) cascade;
create function public.settle_keno_bet(
  p_user_id uuid,
  p_wager numeric,
  p_risk text,
  p_picks int[],
  p_drawn int[],
  p_hits int,
  p_multiplier numeric,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
  won boolean;
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance
    from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance
    from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  won := p_payout > 0;
  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when won then p_payout else 0 end,
        total_losses = total_losses + case when not won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set balance = new_balance, total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when won then p_payout else 0 end,
        total_losses = total_losses + case when not won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.keno_bets (user_id, wager, risk, picks, drawn, hits, multiplier, payout, nonce)
  values (p_user_id, p_wager, p_risk, p_picks, p_drawn, p_hits, p_multiplier, coalesce(p_payout, 0), p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Keno', wager_at);

  if won then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Keno hit ' || p_hits || '/' || array_length(p_picks, 1), outcome_at);
  else
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Keno loss', outcome_at);
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text) from public;
grant execute on function public.settle_keno_bet(uuid, numeric, text, int[], int[], int, numeric, numeric, bigint, text) to service_role;

-- Settle Roulette Bet (dual currency)
drop function if exists public.settle_roulette_bet(p_user_id uuid, p_wager numeric, p_bet_type text, p_result_pocket int, p_result_color text, p_won boolean, p_payout numeric, p_nonce bigint, p_coin_type text) cascade;
create function public.settle_roulette_bet(
  p_user_id uuid,
  p_wager numeric,
  p_bet_type text,
  p_result_pocket int,
  p_result_color text,
  p_won boolean,
  p_payout numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance
    from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance
    from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles
    set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when p_won then p_payout else 0 end,
        total_losses = total_losses + case when not p_won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  else
    update public.profiles
    set balance = new_balance, total_wagered = total_wagered + p_wager,
        total_wins = total_wins + case when p_won then p_payout else 0 end,
        total_losses = total_losses + case when not p_won then p_wager else 0 end,
        updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.roulette_bets (user_id, wager, bet_type, result_pocket, result_color, won, payout, nonce)
  values (p_user_id, p_wager, p_bet_type, p_result_pocket, p_result_color, p_won, coalesce(p_payout, 0), p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Roulette ' || p_bet_type, wager_at);

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Roulette ' || p_bet_type || ' win', outcome_at);
  else
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Roulette ' || p_bet_type || ' loss', outcome_at);
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.settle_roulette_bet(uuid, numeric, text, int, text, boolean, numeric, bigint, text) from public;
grant execute on function public.settle_roulette_bet(uuid, numeric, text, int, text, boolean, numeric, bigint, text) to service_role;

-- Update credit_crypto_deposit to credit GC + bonus SC
-- (removed manual drop)
drop function if exists public.credit_crypto_deposit(p_user_id uuid, p_usd_amount numeric, p_chain text, p_tx_hash text, p_crypto_amount numeric, p_exchange_rate numeric, p_deposit_id uuid) cascade;
create function public.credit_crypto_deposit(
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
begin
  update public.crypto_deposits
  set status = 'credited', credited_at = now()
  where id = p_deposit_id and status = 'confirmed';

  if not found then
    return;
  end if;

  -- 1 SC per 100 GC purchased
  bonus_sc := floor(p_usd_amount / 100);

  update public.profiles
  set
    balance = balance + p_usd_amount,
    sweeps_coins = sweeps_coins + bonus_sc,
    total_deposited = total_deposited + p_usd_amount,
    updated_at = now()
  where id = p_user_id
  returning balance, sweeps_coins into new_balance, new_sc;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'deposit', p_usd_amount, new_balance,
    upper(p_chain) || ' deposit ' || left(p_tx_hash, 16) || '… — ' || bonus_sc || ' bonus SC'
  );

  if bonus_sc > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id, 'bonus', bonus_sc, new_sc,
      bonus_sc || ' SC bonus from ' || upper(p_chain) || ' deposit'
    );
  end if;
end;
$$;

revoke all on function public.credit_crypto_deposit from public;
grant execute on function public.credit_crypto_deposit to service_role;

-- Update ensure_user_profile to include sweeps_coins and welcome bonus
drop function if exists public.ensure_user_profile() cascade;
create function public.ensure_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.profiles (id, username, email, balance, sweeps_coins)
  select
    uid,
    coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    u.email,
    1000,
    10
  from auth.users u
  where u.id = uid
  on conflict (id) do nothing;
  select * into row from public.profiles where id = uid;
  return row;
end;
$$;

grant execute on function public.ensure_user_profile() to authenticated;

-- Update admin_search_users to include sweeps_coins
-- (removed manual drop)
drop function if exists public.admin_search_users(p_query text) cascade;
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
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;
  return query
  select p.id, p.username, p.email, p.balance, p.sweeps_coins, p.is_admin, p.created_at
  from public.profiles p
  where p.username ilike '%' || p_query || '%'
     or p.email ilike '%' || p_query || '%'
     or p.id::text = p_query
  order by p.created_at desc
  limit 20;
end;
$$;

grant execute on function public.admin_search_users to authenticated;

-- ==== Blackjack dual-currency RPCs ====

drop function if exists public.start_blackjack_hand(p_user_id uuid, p_wager numeric, p_total_wager numeric, p_shoe int[], p_shoe_index int, p_player_cards int[], p_dealer_cards int[], p_doubled boolean, p_dealer_revealed boolean, p_status text, p_outcome text, p_payout numeric, p_nonce bigint, p_phase text, p_insurance_wager numeric, p_insurance_taken boolean, p_insurance_decided boolean, p_is_split boolean, p_player_hands jsonb, p_active_hand_index int, p_coin_type text) cascade;
create function public.start_blackjack_hand(
  p_user_id uuid,
  p_wager numeric,
  p_total_wager numeric,
  p_shoe int[],
  p_shoe_index int,
  p_player_cards int[],
  p_dealer_cards int[],
  p_doubled boolean,
  p_dealer_revealed boolean,
  p_status text,
  p_outcome text,
  p_payout numeric,
  p_nonce bigint,
  p_phase text default 'player_turn',
  p_insurance_wager numeric default 0,
  p_insurance_taken boolean default false,
  p_insurance_decided boolean default false,
  p_is_split boolean default false,
  p_player_hands jsonb default null,
  p_active_hand_index int default 0,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  hand_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  hid uuid;
  wager_at timestamptz := clock_timestamp();
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if exists (
    select 1 from public.blackjack_hands h
    where h.user_id = p_user_id and h.status = 'player_turn'
  ) then
    raise exception 'Finish your current Blackjack hand first';
  end if;

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_total_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_total_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_total_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_total_wager, updated_at = now() where id = p_user_id;
  end if;

  insert into public.blackjack_hands (user_id, wager, total_wager, doubled, shoe, shoe_index, player_cards, dealer_cards, dealer_revealed, status, outcome, payout, nonce, phase, insurance_wager, insurance_taken, insurance_decided, is_split, player_hands, active_hand_index, completed_at)
  values (p_user_id, p_wager, p_total_wager, p_doubled, p_shoe, p_shoe_index, p_player_cards, p_dealer_cards, p_dealer_revealed, p_status, p_outcome, coalesce(p_payout, 0), p_nonce, p_phase, p_insurance_wager, p_insurance_taken, p_insurance_decided, p_is_split, p_player_hands, p_active_hand_index, case when p_status = 'settled' then now() else null end)
  returning id into hid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_total_wager, new_balance, upper(p_coin_type) || ' Blackjack bet', wager_at);

  if p_status = 'settled' then
    new_balance := new_balance + coalesce(p_payout, 0);
    if p_coin_type = 'sweeps_coins' then
      update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
    else
      update public.profiles set balance = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
    end if;
    if coalesce(p_payout, 0) > 0 then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'win', p_payout, new_balance, upper(p_coin_type) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
    elsif p_outcome in ('lose', 'bust') then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'loss', -p_total_wager, new_balance, upper(p_coin_type) || ' Blackjack ' || p_outcome, outcome_at);
    elsif p_outcome = 'push' then
      insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
      values (p_user_id, 'push', 0, new_balance, upper(p_coin_type) || ' Blackjack push', outcome_at);
    end if;
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, hid;
end;
$$;

revoke all on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text) from public;
grant execute on function public.start_blackjack_hand(uuid, numeric, numeric, int[], int, int[], int[], boolean, boolean, text, text, numeric, bigint, text, numeric, boolean, boolean, boolean, jsonb, int, text) to service_role;

drop function if exists public.blackjack_finish_hand(p_user_id uuid, p_hand_id uuid, p_player_cards int[], p_dealer_cards int[], p_shoe_index int, p_doubled boolean, p_total_wager numeric, p_dealer_revealed boolean, p_outcome text, p_payout numeric, p_extra_wager numeric, p_phase text, p_player_hands jsonb, p_is_split boolean, p_active_hand_index int, p_insurance_wager numeric, p_insurance_taken boolean, p_coin_type text) cascade;
create function public.blackjack_finish_hand(
  p_user_id uuid,
  p_hand_id uuid,
  p_player_cards int[],
  p_dealer_cards int[],
  p_shoe_index int,
  p_doubled boolean,
  p_total_wager numeric,
  p_dealer_revealed boolean,
  p_outcome text,
  p_payout numeric,
  p_extra_wager numeric default 0,
  p_phase text default 'settled',
  p_player_hands jsonb default null,
  p_is_split boolean default false,
  p_active_hand_index int default 0,
  p_insurance_wager numeric default 0,
  p_insurance_taken boolean default false,
  p_coin_type text default 'balance'
)
returns table (
  out_balance numeric,
  hand_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  outcome_at timestamptz := clock_timestamp();
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + coalesce(p_payout, 0) - coalesce(p_extra_wager, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + case when coalesce(p_payout, 0) > 0 then coalesce(p_payout, 0) else 0 end, total_losses = total_losses + case when coalesce(p_payout, 0) <= 0 and p_outcome <> 'push' then p_total_wager else 0 end, updated_at = now() where id = p_user_id;
  end if;

  update public.blackjack_hands
  set status = 'settled', player_cards = p_player_cards, dealer_cards = p_dealer_cards, shoe_index = p_shoe_index, doubled = p_doubled, dealer_revealed = p_dealer_revealed, outcome = p_outcome, payout = coalesce(p_payout, 0), phase = p_phase, player_hands = p_player_hands, is_split = p_is_split, active_hand_index = p_active_hand_index, insurance_wager = p_insurance_wager, insurance_taken = p_insurance_taken, completed_at = now()
  where id = p_hand_id and user_id = p_user_id;

  if not found then
    raise exception 'Hand not found';
  end if;

  if coalesce(p_payout, 0) > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance, upper(p_coin_type) || ' Blackjack ' || coalesce(p_outcome, 'win'), outcome_at);
  end if;

  return query select new_balance, p_hand_id;
end;
$$;

revoke all on function public.blackjack_finish_hand from public;
grant execute on function public.blackjack_finish_hand to service_role;

drop function if exists public.blackjack_debit_extra(p_user_id uuid, p_hand_id uuid, p_extra_wager numeric, p_description text, p_coin_type text) cascade;
create function public.blackjack_debit_extra(
  p_user_id uuid,
  p_hand_id uuid,
  p_extra_wager numeric,
  p_description text default 'Extra wager',
  p_coin_type text default 'balance'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance < p_extra_wager then
    raise exception 'Insufficient balance';
  end if;

  new_balance := current_balance - p_extra_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_extra_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_extra_wager, updated_at = now() where id = p_user_id;
  end if;

  insert into public.transactions (user_id, type, amount, balance_after, description)
  values (p_user_id, 'wager', -p_extra_wager, new_balance, upper(p_coin_type) || ' ' || p_description);
end;
$$;

revoke all on function public.blackjack_debit_extra from public;
grant execute on function public.blackjack_debit_extra to service_role;

-- ==== Mines dual-currency RPCs ====

drop function if exists public.start_mines_game(p_user_id uuid, p_wager numeric, p_mine_count int, p_mine_tiles int[], p_nonce bigint, p_coin_type text) cascade;
create function public.start_mines_game(
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
begin
  if p_mine_count < 1 or p_mine_count > 24 then raise exception 'Invalid mine count'; end if;
  if array_length(p_mine_tiles, 1) is distinct from p_mine_count then raise exception 'Mine layout mismatch'; end if;

  if exists (select 1 from public.mines_games g where g.user_id = p_user_id and g.status = 'active') then
    raise exception 'Finish your current Mines game first';
  end if;

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  end if;

  insert into public.mines_games (user_id, wager, mine_count, mine_tiles, revealed_tiles, gems_revealed, multiplier, status, nonce)
  values (p_user_id, p_wager, p_mine_count, p_mine_tiles, '{}', 0, 1, 'active', p_nonce)
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, upper(p_coin_type) || ' Mines bet (' || p_mine_count || ' mines)', wager_at);

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;

revoke all on function public.start_mines_game(uuid, numeric, int, int[], bigint, text) from public;
grant execute on function public.start_mines_game(uuid, numeric, int, int[], bigint, text) to service_role;

drop function if exists public.mines_cashout(p_user_id uuid, p_game_id uuid, p_coin_type text) cascade;
create function public.mines_cashout(
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
begin
  select * into g from public.mines_games where id = p_game_id and user_id = p_user_id for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'Game is not active'; end if;
  if g.gems_revealed < 1 then raise exception 'Reveal at least one gem before cashing out'; end if;

  pay := round(g.wager * g.multiplier, 2);

  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + pay;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  end if;

  update public.mines_games set status = 'cashed_out', payout = pay, completed_at = now() where id = g.id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'win', pay, new_balance,
    upper(p_coin_type) || ' Mines cashout ' || g.gems_revealed || ' gems @ ' || trim(to_char(g.multiplier, 'FM999990.9999')) || 'x', win_at);

  return query select new_balance, g.id, pay, g.multiplier, g.gems_revealed, g.wager;
end;
$$;

revoke all on function public.mines_cashout(uuid, uuid, text) from public;
grant execute on function public.mines_cashout(uuid, uuid, text) to service_role;

-- ==== Crash game tables & RPCs ====

create table if not exists public.crash_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  crash_point numeric(14, 2) not null,
  won boolean not null default false,
  payout numeric(12, 2) not null default 0,
  cashed_at numeric(14, 2),
  coin_type text not null default 'balance',
  nonce bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists crash_bets_user_created_idx on public.crash_bets (user_id, created_at desc);

alter table public.crash_bets enable row level security;

create policy "Users read own crash bets"
  on public.crash_bets for select
  using (auth.uid() = user_id);

grant select on public.crash_bets to authenticated;
grant all on table public.crash_bets to service_role;

drop function if exists public.place_crash_bet(p_user_id uuid, p_wager numeric, p_crash_point numeric, p_nonce bigint, p_coin_type text) cascade;
create function public.place_crash_bet(
  p_user_id uuid,
  p_wager numeric,
  p_crash_point numeric,
  p_nonce bigint,
  p_coin_type text default 'balance'
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
  bid uuid;
  wager_at timestamptz := clock_timestamp();
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager;

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_wager, updated_at = now() where id = p_user_id;
  end if;

  insert into public.crash_bets (user_id, wager, crash_point, won, payout, coin_type, nonce)
  values (p_user_id, p_wager, p_crash_point, false, 0, p_coin_type, p_nonce)
  returning id into bid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, new_balance, upper(p_coin_type) || ' Crash bet', wager_at);

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, bid;
end;
$$;

revoke all on function public.place_crash_bet from public;
grant execute on function public.place_crash_bet to service_role;

drop function if exists public.cash_out_crash(p_user_id uuid, p_bet_id uuid, p_cashed_at numeric) cascade;
create function public.cash_out_crash(
  p_user_id uuid,
  p_bet_id uuid,
  p_cashed_at numeric
)
returns table (
  out_balance numeric,
  payout numeric,
  cashed_at numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.crash_bets%rowtype;
  current_balance numeric(12, 2);
  new_balance numeric(12, 2);
  pay numeric(12, 2);
  outcome_at timestamptz := clock_timestamp();
begin
  select * into b from public.crash_bets where id = p_bet_id and user_id = p_user_id for update;
  if not found then raise exception 'Bet not found'; end if;
  if b.won then raise exception 'Already cashed out'; end if;

  pay := round(b.wager * p_cashed_at, 2);

  if b.coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  new_balance := current_balance + pay;

  if b.coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wins = total_wins + pay, updated_at = now() where id = p_user_id;
  end if;

  update public.crash_bets set won = true, payout = pay, cashed_at = p_cashed_at, completed_at = now() where id = p_bet_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'win', pay, new_balance,
    upper(b.coin_type) || ' Crash cashout @ ' || trim(to_char(p_cashed_at, 'FM999990.00')) || 'x', outcome_at);

  return query select new_balance, pay, p_cashed_at;
end;
$$;

revoke all on function public.cash_out_crash from public;
grant execute on function public.cash_out_crash to service_role;

drop function if exists public.crash_settle_loss(p_bet_id uuid) cascade;
create function public.crash_settle_loss(
  p_bet_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.crash_bets%rowtype;
begin
  select * into b from public.crash_bets where id = p_bet_id for update;
  if not found then raise exception 'Bet not found'; end if;
  if b.won then return; end if;

  update public.crash_bets set won = false, completed_at = now() where id = p_bet_id;

  update public.profiles set total_losses = total_losses + b.wager, updated_at = now() where id = b.user_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (b.user_id, 'loss', -b.wager, 0,
    upper(b.coin_type) || ' Crash crash @ ' || trim(to_char(b.crash_point, 'FM999990.00')) || 'x', now());
end;
$$;

revoke all on function public.crash_settle_loss from public;
grant execute on function public.crash_settle_loss to service_role;

-- PF wrappers for crash
drop function if exists public.get_crash_pf_state() cascade;
create function public.get_crash_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_crash_pf_state() to authenticated;

drop function if exists public.set_crash_client_seed(p_client_seed text) cascade;
create function public.set_crash_client_seed(p_client_seed text)
returns void language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_crash_client_seed(text) to authenticated;

-- ==== Simple Slots game ====

create table if not exists public.slots_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wager numeric(12, 2) not null check (wager > 0),
  reels int[] not null,
  won boolean not null,
  multiplier numeric(14, 2) not null default 0,
  payout numeric(12, 2) not null default 0,
  coin_type text not null default 'balance',
  nonce bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists slots_games_user_created_idx on public.slots_games (user_id, created_at desc);

alter table public.slots_games enable row level security;

create policy "Users read own slots games"
  on public.slots_games for select
  using (auth.uid() = user_id);

grant select on public.slots_games to authenticated;
grant all on table public.slots_games to service_role;

drop function if exists public.settle_slots_bet(p_user_id uuid, p_wager numeric, p_reels int[], p_won boolean, p_multiplier numeric, p_payout numeric, p_nonce bigint, p_coin_type text) cascade;
create function public.settle_slots_bet(
  p_user_id uuid,
  p_wager numeric,
  p_reels int[],
  p_won boolean,
  p_multiplier numeric,
  p_payout numeric,
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
  outcome_at timestamptz := clock_timestamp() + interval '1 millisecond';
begin
  if p_coin_type = 'sweeps_coins' then
    select sweeps_coins into current_balance from public.profiles where id = p_user_id for update;
  else
    select balance into current_balance from public.profiles where id = p_user_id for update;
  end if;

  if current_balance is null then raise exception 'Profile not found'; end if;
  if current_balance < p_wager then raise exception 'Insufficient balance'; end if;

  new_balance := current_balance - p_wager + coalesce(p_payout, 0);

  if p_coin_type = 'sweeps_coins' then
    update public.profiles set sweeps_coins = new_balance, total_wagered = total_wagered + p_wager,
      total_wins = total_wins + case when p_won then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now() where id = p_user_id;
  else
    update public.profiles set balance = new_balance, total_wagered = total_wagered + p_wager,
      total_wins = total_wins + case when p_won then coalesce(p_payout, 0) else 0 end,
      total_losses = total_losses + case when not p_won then p_wager else 0 end,
      updated_at = now() where id = p_user_id;
  end if;

  insert into public.slots_games (user_id, wager, reels, won, multiplier, payout, coin_type, nonce)
  values (p_user_id, p_wager, p_reels, p_won, p_multiplier, coalesce(p_payout, 0), p_coin_type, p_nonce)
  returning id into gid;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (p_user_id, 'wager', -p_wager, current_balance - p_wager,
    upper(p_coin_type) || ' Slots', wager_at);

  if p_won and p_payout > 0 then
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'win', p_payout, new_balance,
      upper(p_coin_type) || ' Slots win ' || trim(to_char(p_multiplier, 'FM999990.00')) || 'x', outcome_at);
  else
    insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    values (p_user_id, 'loss', -p_wager, new_balance,
      upper(p_coin_type) || ' Slots loss', outcome_at);
  end if;

  update public.game_pf_seeds set next_nonce = p_nonce + 1, updated_at = now() where user_id = p_user_id;

  return query select new_balance, gid;
end;
$$;

revoke all on function public.settle_slots_bet from public;
grant execute on function public.settle_slots_bet to service_role;

drop function if exists public.get_slots_pf_state() cascade;
create function public.get_slots_pf_state()
returns table (server_seed_hash text, client_seed text, next_nonce bigint)
language sql security definer set search_path = public
as $$ select * from public.get_keno_pf_state(); $$;
grant execute on function public.get_slots_pf_state() to authenticated;

drop function if exists public.set_slots_client_seed(p_client_seed text) cascade;
create function public.set_slots_client_seed(p_client_seed text)
returns void language sql security definer set search_path = public
as $$ select public.set_keno_client_seed(p_client_seed); $$;
grant execute on function public.set_slots_client_seed(text) to authenticated;


-- ===================================================
-- MIGRATION: 20250617000000_responsible_gaming.sql
-- ===================================================
-- Responsible gaming features
-- Self-exclusion, deposit limits, session tracking

-- ── Session tracking ──

alter table public.profiles
  add column if not exists session_started_at timestamptz,
  add column if not exists last_session_activity timestamptz;

-- ── Self-exclusion ──

alter table public.profiles
  add column if not exists self_excluded_until timestamptz;

drop function if exists public.self_exclude(p_days int) cascade;
create function public.self_exclude(p_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_days not in (30, 90, 180) then
    raise exception 'Invalid exclusion period. Choose 30, 90, or 180 days.';
  end if;

  update public.profiles
  set self_excluded_until = clock_timestamp() + (p_days || ' days')::interval,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

drop function if exists public.cancel_self_exclusion() cascade;
create function public.cancel_self_exclusion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set self_excluded_until = null,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

drop function if exists public.check_self_exclusion() cascade;
create function public.check_self_exclusion()
returns table (
  excluded boolean,
  excluded_until timestamptz,
  remaining_days int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  excl_until timestamptz;
  days_left int;
begin
  select self_excluded_until into excl_until
  from public.profiles
  where id = auth.uid();

  if excl_until is null or excl_until < clock_timestamp() then
    return query select false, null::timestamptz, 0::int;
  else
    days_left := ceil(extract(epoch from (excl_until - clock_timestamp())) / 86400)::int;
    return query select true, excl_until, days_left;
  end if;
end;
$$;

revoke all on function public.self_exclude(int) from public;
grant execute on function public.self_exclude(int) to authenticated;

revoke all on function public.cancel_self_exclusion() from public;
grant execute on function public.cancel_self_exclusion() to authenticated;

revoke all on function public.check_self_exclusion() from public;
grant execute on function public.check_self_exclusion() to authenticated;

-- ── Deposit limits ──

alter table public.profiles
  add column if not exists daily_deposit_limit numeric(12, 2),
  add column if not exists weekly_deposit_limit numeric(12, 2);

drop function if exists public.set_deposit_limits(p_daily_limit numeric, p_weekly_limit numeric) cascade;
create function public.set_deposit_limits(
  p_daily_limit numeric default null,
  p_weekly_limit numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_daily_limit is not null and p_daily_limit <= 0 then
    raise exception 'Daily limit must be positive or null.';
  end if;
  if p_weekly_limit is not null and p_weekly_limit <= 0 then
    raise exception 'Weekly limit must be positive or null.';
  end if;

  update public.profiles
  set daily_deposit_limit = p_daily_limit,
      weekly_deposit_limit = p_weekly_limit,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

drop function if exists public.get_deposit_limits() cascade;
create function public.get_deposit_limits()
returns table (
  daily_limit numeric,
  weekly_limit numeric,
  daily_used numeric,
  weekly_used numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  d_limit numeric;
  w_limit numeric;
  d_used numeric;
  w_used numeric;
begin
  select p.daily_deposit_limit, p.weekly_deposit_limit
  into d_limit, w_limit
  from public.profiles p
  where p.id = auth.uid();

  select coalesce(sum(cd.usd_amount), 0)
  into d_used
  from public.crypto_deposits cd
  where cd.user_id = auth.uid()
    and cd.status = 'credited'
    and cd.credited_at >= date_trunc('day', now());

  select coalesce(sum(cd.usd_amount), 0)
  into w_used
  from public.crypto_deposits cd
  where cd.user_id = auth.uid()
    and cd.status = 'credited'
    and cd.credited_at >= date_trunc('week', now());

  return query select d_limit, w_limit, d_used, w_used;
end;
$$;

revoke all on function public.set_deposit_limits(numeric, numeric) from public;
grant execute on function public.set_deposit_limits(numeric, numeric) to authenticated;

revoke all on function public.get_deposit_limits() from public;
grant execute on function public.get_deposit_limits() to authenticated;

-- ── Update credit_crypto_deposit to enforce limits ──

drop function if exists public.credit_crypto_deposit(p_user_id uuid, p_usd_amount numeric, p_chain text, p_tx_hash text, p_crypto_amount numeric, p_exchange_rate numeric, p_deposit_id uuid) cascade;
create function public.credit_crypto_deposit(
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
  d_limit numeric;
  w_limit numeric;
  d_used numeric;
  w_used numeric;
begin
  -- Check deposit limits
  select p.daily_deposit_limit, p.weekly_deposit_limit
    into d_limit, w_limit
    from public.profiles p
    where p.id = p_user_id;

  if d_limit is not null then
    select coalesce(sum(cd.usd_amount), 0)
      into d_used
      from public.crypto_deposits cd
      where cd.user_id = p_user_id
        and cd.status = 'credited'
        and cd.credited_at >= date_trunc('day', now());
    if d_used + p_usd_amount > d_limit then
      raise exception 'Daily deposit limit of % would be exceeded (used: %, attempted: %)',
        d_limit, d_used, p_usd_amount;
    end if;
  end if;

  if w_limit is not null then
    select coalesce(sum(cd.usd_amount), 0)
      into w_used
      from public.crypto_deposits cd
      where cd.user_id = p_user_id
        and cd.status = 'credited'
        and cd.credited_at >= date_trunc('week', now());
    if w_used + p_usd_amount > w_limit then
      raise exception 'Weekly deposit limit of % would be exceeded (used: %, attempted: %)',
        w_limit, w_used, p_usd_amount;
    end if;
  end if;

  -- Check self-exclusion
  if exists (
    select 1 from public.profiles
    where id = p_user_id
      and self_excluded_until is not null
      and self_excluded_until >= clock_timestamp()
  ) then
    raise exception 'Account is self-excluded. Deposits are not allowed during the exclusion period.';
  end if;

  -- Credit GC (existing balance column)
  update public.profiles
    set balance = balance + p_usd_amount,
        total_deposited = total_deposited + p_usd_amount,
        updated_at = now()
    where id = p_user_id;

  -- Bonus SC: 1% of deposit
  update public.profiles
    set sweeps_coins = sweeps_coins + (p_usd_amount * 0.01)
    where id = p_user_id;

  update public.crypto_deposits
    set status = 'credited', credited_at = now()
    where id = p_deposit_id;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    select p_user_id, 'credit', p_usd_amount,
      (select balance from public.profiles where id = p_user_id),
      'Crypto deposit ' || upper(p_chain) || ' ' || p_tx_hash,
      now();

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
    select p_user_id, 'bonus', round(p_usd_amount * 0.01, 2),
      (select sweeps_coins from public.profiles where id = p_user_id),
      'SC bonus 1% of ' || p_usd_amount || ' deposit',
      now();
end;
$$;

revoke all on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) from public;
grant execute on function public.credit_crypto_deposit(uuid, numeric, text, text, numeric, numeric, uuid) to service_role;

-- ── Self-exclusion check helper for edge functions ──

drop function if exists public.check_user_self_exclusion(p_user_id uuid) cascade;
create function public.check_user_self_exclusion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  excl_until timestamptz;
begin
  select self_excluded_until into excl_until
  from public.profiles
  where id = p_user_id;

  if excl_until is not null and excl_until >= clock_timestamp() then
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.check_user_self_exclusion(uuid) from public;
grant execute on function public.check_user_self_exclusion(uuid) to service_role;

