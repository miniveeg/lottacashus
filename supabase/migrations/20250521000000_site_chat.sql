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
