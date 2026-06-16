-- Case battles lobby: mixed players/bots, multiple cases, player modes

alter table public.case_battles
  add column if not exists case_ids jsonb,
  add column if not exists gamemode text not null default 'normal',
  add column if not exists player_mode text not null default '1v1';

alter table public.case_battles
  drop constraint if exists case_battles_max_players_check;

alter table public.case_battles
  add constraint case_battles_max_players_check
  check (max_players >= 2 and max_players <= 6);

alter table public.case_battle_players
  drop constraint if exists case_battle_players_slot_index_check;

alter table public.case_battle_players
  add constraint case_battle_players_slot_index_check
  check (slot_index >= 0 and slot_index <= 5);

-- Backfill case_ids from legacy case_id
update public.case_battles
set case_ids = jsonb_build_array(case_id)
where case_ids is null and case_id is not null;

drop function if exists public.get_open_case_battles(int);

create or replace function public.get_open_case_battles(p_limit int default 20)
returns table (
  battle_id uuid,
  creator_id uuid,
  case_id text,
  case_ids jsonb,
  rounds int,
  max_players int,
  player_mode text,
  gamemode text,
  entry_cost numeric,
  pot_total numeric,
  player_count bigint,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id,
    b.creator_id,
    b.case_id,
    b.case_ids,
    b.rounds,
    b.max_players,
    b.player_mode,
    b.gamemode,
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.created_at
  from public.case_battles b
  where b.status = 'waiting'
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;
