-- Ten named battle bots; each "Call bot" picks one at random from those not already in the lobby.

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
