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
create or replace function public.handle_new_user()
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

create or replace function public.email_exists(check_email text)
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

create or replace function public.ensure_user_profile()
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
-- admin_credit_user + admin_credit_log moved to migration 20250521200000_admin_access.sql

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
