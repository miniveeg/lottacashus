-- 019_cb_internal_seed.sql
-- case-battle-v2 start writes/reads case_battles.internal_seed, but live
-- schema only had seed_hash / battle_seed / eos_*. Add the column and
-- recreate case_battles_safe so internal_seed (+ battle_seed, eos_block_id)
-- stay hidden until status='completed' (complete-setup v2 shape + live
-- security_invoker=false / grants).

alter table public.case_battles
  add column if not exists internal_seed text;

-- Recreate safe view (security_barrier + security_invoker=false so lobby
-- rows remain visible under PG15+ owner-view semantics; authenticated
-- SELECT is revoked on the base table).
drop view if exists public.case_battles_safe;
create view public.case_battles_safe
  with (security_barrier = true, security_invoker = false)
as
  select
    id, creator_id, gamemode, crazy, player_mode, max_players, case_ids,
    rounds, entry_cost, coin_type, borrow_percent, pot_total, status,
    seed_hash,
    eos_block_target,
    case when status = 'completed' then eos_block_id else null end as eos_block_id,
    case when status = 'completed' then internal_seed else null end as internal_seed,
    case when status = 'completed' then battle_seed else null end as battle_seed,
    created_at, started_at, completed_at
  from public.case_battles;

grant select on public.case_battles_safe to authenticated, anon;
revoke select on public.case_battles from authenticated;
revoke select on public.case_battles from anon;

notify pgrst, 'reload schema';
