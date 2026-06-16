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

create or replace function public.create_user_notification(
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
create or replace function public.credit_crypto_deposit(
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
create or replace function public.request_crypto_withdrawal(
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
create or replace function public.link_discord_profile(
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
create or replace function public.notify_crypto_deposit_change()
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
create or replace function public.notify_crypto_withdrawal_change()
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
