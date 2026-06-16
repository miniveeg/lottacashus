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

drop function if exists public.create_case_battle_entry(uuid, uuid, int, numeric, text);

create or replace function public.create_case_battle_entry(
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
