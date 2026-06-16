-- EOS block commitment before case battles start

alter table public.case_battles
  add column if not exists internal_battle_seed text,
  add column if not exists eos_commit_block_num bigint,
  add column if not exists eos_target_block_num bigint,
  add column if not exists eos_block_num bigint,
  add column if not exists eos_block_id text;

alter table public.case_battles drop constraint if exists case_battles_status_check;

alter table public.case_battles
  add constraint case_battles_status_check
  check (status in ('waiting', 'pending_eos', 'running', 'completed', 'cancelled'));

create or replace function public.mark_case_battle_running(
  p_battle_id uuid,
  p_battle_seed_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_battles
  set
    status = 'running',
    battle_seed_hash = coalesce(p_battle_seed_hash, battle_seed_hash),
    started_at = coalesce(started_at, now())
  where id = p_battle_id and status in ('waiting', 'pending_eos');
end;
$$;

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
  crazy_mode boolean,
  fast_spin boolean,
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
    coalesce(b.crazy_mode, false),
    coalesce(b.fast_spin, false),
    b.entry_cost,
    b.pot_total,
    (select count(*) from public.case_battle_players p where p.battle_id = b.id),
    b.status,
    b.completed_at,
    b.created_at
  from public.case_battles b
  where
    b.status in ('waiting', 'pending_eos', 'running')
    or (
      b.status = 'completed'
      and b.completed_at is not null
      and b.completed_at > now() - interval '10 minutes'
    )
  order by
    case
      when b.status = 'waiting' then 0
      when b.status = 'pending_eos' then 1
      when b.status = 'running' then 2
      else 3
    end,
    b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.get_open_case_battles(int) to authenticated;
