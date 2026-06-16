-- List waiting/running battles + completed battles for 10 minutes after they end

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
  status text,
  completed_at timestamptz,
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
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case when b.status = 'waiting' then 0 when b.status = 'running' then 1 else 2 end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;
