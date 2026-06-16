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
