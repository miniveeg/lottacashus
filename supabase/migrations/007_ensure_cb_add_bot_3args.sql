-- ══════════════════════════════════════════════════════════════════════════════
-- Case Battles — force 3-argument cb_add_bot
--
-- PROBLEM: Migrating projects sometimes ship a stale 2-arg or 1-arg signature
-- (`cb_add_bot(uuid, text)` from case-battles-v2-setup.sql, or
-- `cb_add_bot(uuid)` from migration 002) but the V2 client calls
-- `cb_add_bot({ p_battle_id, p_slot_index })` — producing
-- "Could not find the function public.cb_add_bot(p_battle_id, p_slot_index)
-- in the schema cache".
--
-- FIX: Drop every overload of cb_add_bot, recreate the 3-arg
-- (p_battle_id uuid, p_bot_name text default null, p_slot_index int default null)
-- version, recreate the bot pot-adjust trigger + function, and reload the
-- PostgREST schema cache via NOTIFY so the next client call resolves.
--
-- Idempotent: safe to re-run on any environment (fresh install, partial
-- migration, prod, staging, local). Mutations only affect `cb_add_bot` +
-- its dependent trigger — does NOT touch cb_create_battle, cb_join_battle,
-- cb_leave_battle, cb_claim_payout or any table data.
-- ══════════════════════════════════════════════════════════════════════════════

-- Drop ALL existing overloads of cb_add_bot. We iterate pg_proc instead of
-- listing signatures by hand because:
--   (a) bare `drop function cb_add_bot` (no args) errors on multiple
--       overloads ("function name is not unique"), and
--   (b) there are forward-compatible signature changes we can't anticipate.
-- The DO-block enumerates current signatures and drops each; cascade is
-- harmless because no live code path invokes cb_add_bot from SQL.
do $$
declare v_rec record;
begin
  for v_rec in
    select pg_get_function_identity_arguments(p.oid) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'cb_add_bot'
  loop
    execute 'drop function if exists public.cb_add_bot(' || v_rec.sig || ') cascade';
  end loop;
end $$;

-- Recreate with the 3-arg signature the V2 client (caseBattlesApi.ts:336)
-- expects: { p_battle_id, p_slot_index }. `p_bot_name` defaults to null so
-- legacy callers passing only `(p_battle_id)` still work.
create or replace function public.cb_add_bot(
  p_battle_id     uuid,
  p_bot_name      text    default null,
  p_slot_index    int     default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_battle  public.case_battles%rowtype;
  v_max     int;
  v_count   int;
  v_target  int;
  v_uid     uuid := auth.uid();
  v_name    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then
    raise exception 'Battle not found';
  end if;
  if v_battle.creator_id <> v_uid then
    raise exception 'Only the creator can add bots';
  end if;
  if v_battle.status <> 'waiting' then
    raise exception 'Battle already started';
  end if;

  v_max := v_battle.max_players;
  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_max then
    raise exception 'Battle is full';
  end if;

  -- Resolve target slot:
  --   explicit caller request (p_slot_index free)  →  next free slot.
  --   explicit caller request (p_slot_index taken) →  next free slot.
  --   no p_slot_index                              →  next free slot.
  -- This mirrors the 006 migration but is repeated here so this migration
  -- works in isolation (no dependency on 006 having run).
  v_target := -1;
  if p_slot_index is not null and p_slot_index >= 0 and p_slot_index < v_max then
    if not exists (
      select 1 from public.case_battle_players
      where battle_id = p_battle_id and slot = p_slot_index
    ) then
      v_target := p_slot_index;
    end if;
  end if;
  if v_target = -1 then
    for i in 0..(v_max - 1) loop
      if not exists (
        select 1 from public.case_battle_players
        where battle_id = p_battle_id and slot = i
      ) then
        v_target := i;
        exit;
      end if;
    end loop;
  end if;
  if v_target < 0 then
    raise exception 'No empty slots';
  end if;

  -- Bot name: explicit override > auto-generated from a fixed roster.
  v_name := coalesce(
    p_bot_name,
    'Bot_' || (array['CryptoKing','LuckyAce','RollDeep','HighRoller','TheWhale','JackpotJoe','AllIn','SpinMaster'])[v_target + 1]
  );

  insert into public.case_battle_players (battle_id, slot, is_bot, username, avatar_seed)
  values (p_battle_id, v_target, true, v_name, 'bot-' || v_target);
end;
$$;

revoke all on function public.cb_add_bot(uuid, text, int) from public;
grant execute on function public.cb_add_bot(uuid, text, int) to authenticated;

-- ─── Bot pot-adjust trigger (recreated for isolation) ──────────────────────
-- Bots contribute the FULL entry_cost to the pot (house-sponsored seats) so
-- a creator who fills empty slots with bots still posts a sensible pot for
-- the rest of the players. The trigger fires AFTER insert of any row on
-- case_battle_players WHERE is_bot = true.
drop trigger if exists case_battle_players_bot_pot_t on public.case_battle_players;
drop function if exists public.cb_add_bot_adjust_pot() cascade;

create or replace function public.cb_add_bot_adjust_pot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry numeric;
begin
  select entry_cost into v_entry from public.case_battles where id = new.battle_id;
  if v_entry is null then
    return new;
  end if;
  -- pot_total is NOT NULL DEFAULT 0 so coalesce is unnecessary.
  update public.case_battles
    set pot_total = round(pot_total + v_entry, 2)
    where id = new.battle_id;
  return new;
end;
$$;

create trigger case_battle_players_bot_pot_t
  after insert on public.case_battle_players
  for each row
  when (new.is_bot = true)
  execute function public.cb_add_bot_adjust_pot();

-- ─── PostgREST cache reload ────────────────────────────────────────────────
-- Without this notification, PostgREST's cached function list can take
-- 30+ seconds (or until redeploy) to pick up the new signature, so the
-- client keeps seeing "function not found in schema cache" even after
-- the migration ran. The channel name `pgrst` is what Supabase's PostgREST
-- listens to. Only the `service_role` / `postgres` superuser has NOTIFY
-- privileges; if you're running this as `authenticated` the notification
-- will fail silently and the cache will refresh on its own within ~30s.
do $$
begin
  begin
    perform pg_notify('pgrst', 'reload schema');
  exception when insufficient_privilege then
    raise notice 'Could not pg_notify (insufficient privilege). PostgREST cache will refresh automatically within ~30s.';
  end;
end $$;

-- ─── Sanity check ──────────────────────────────────────────────────────────
-- Verifies the migration's own effect. Raises a NOTICE (not an error) so
-- the migration is still considered successful if this block runs in a
-- context where DO/RAISE NOTICE is not supported.
do $$
declare
  v_count int;
  v_sigs  text;
begin
  select count(*),
         string_agg(pg_get_function_identity_arguments(p.oid), ', ' order by p.oid)
    into v_count, v_sigs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'cb_add_bot';
  raise notice 'cb_add_bot: % overload(s) after migration 007 — %', v_count, v_sigs;
end $$;
