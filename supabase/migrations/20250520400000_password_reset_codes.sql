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

create or replace function public.get_user_id_by_email(check_email text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(check_email)) limit 1;
$$;

revoke all on function public.get_user_id_by_email(text) from public;
grant execute on function public.get_user_id_by_email(text) to service_role;
