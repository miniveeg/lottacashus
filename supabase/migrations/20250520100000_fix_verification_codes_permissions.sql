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
