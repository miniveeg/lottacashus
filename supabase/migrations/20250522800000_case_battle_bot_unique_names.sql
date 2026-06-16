-- Superseded by 20250522900000_case_battle_bot_random_roster.sql (10 bots, random pick).
-- Assign unique bot display names atomically when inserting (prevents duplicate "Bot 1" on fast clicks).

create or replace function public.insert_case_battle_bot(
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
