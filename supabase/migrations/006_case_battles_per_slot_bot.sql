-- ══════════════════════════════════════════════════════════════════════════════
-- Case Battles — per-slot bot fill
-- Forward-compatible: keeps the legacy (p_bot_name) parameter alongside the
-- new (p_slot_index) so any existing caller still compiles.
-- ══════════════════════════════════════════════════════════════════════════════

drop function if exists public.cb_add_bot(uuid, text);
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
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found                    then raise exception 'Battle not found';           end if;
  if v_battle.creator_id <> v_uid then raise exception 'Only the creator can add bots'; end if;
  if v_battle.status <> 'waiting'  then raise exception 'Battle already started';    end if;

  v_max := v_battle.max_players;
  select count(*) into v_count from public.case_battle_players where battle_id = p_battle_id;
  if v_count >= v_max then raise exception 'Battle is full'; end if;

  -- Resolve the target slot: explicit caller request → next free slot.
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
    for i in 0..v_max - 1 loop
      if not exists (
        select 1 from public.case_battle_players
        where battle_id = p_battle_id and slot = i
      ) then
        v_target := i;
        exit;
      end if;
    end loop;
  end if;
  if v_target < 0 then raise exception 'No empty slots'; end if;

  -- Bot name: explicit override → auto-generated.
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

-- Bots contribute the FULL entry_cost to the pot (house-sponsored seats) so
-- the match-3 spec (creator pays full × slots filled by bots) stays intact.
-- This trigger keeps `case_battles.pot_total` consistent with the SQL claim
-- -- entry edge function in `place-crash-bet` style ("bot entry fee is
-- sponsored by the house") so a creator who fills empty slots with bots
-- still posts a sensible pot for the rest of the players.
create or replace function public.cb_add_bot_adjust_pot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry numeric;
  v_pot   numeric;
begin
  select entry_cost into v_entry from public.case_battles where id = new.battle_id;
  if v_entry is null then return new; end if;
  v_pot := (select pot_total from public.case_battles where id = new.battle_id);
  update public.case_battles
  set pot_total = round((coalesce(pot_total, 0) + v_entry)::numeric, 2)
  where id = new.battle_id;
  return new;
end;
$$;

drop trigger if exists case_battle_players_bot_pot_t on public.case_battle_players;
create trigger case_battle_players_bot_pot_t
  after insert on public.case_battle_players
  for each row
  when (new.is_bot = true)
  execute function public.cb_add_bot_adjust_pot();
