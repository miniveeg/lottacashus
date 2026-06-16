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
create or replace function public.profiles_prevent_balance_change()
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
