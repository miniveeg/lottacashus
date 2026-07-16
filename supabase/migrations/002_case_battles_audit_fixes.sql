-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Case Battles v2 audit fixes (Phase 002)
-- ══════════════════════════════════════════════════════════════════════════════
-- HARD dependency for case-battle-v2 edge function which calls
-- `cb_claim_payout(battle_id, slot)` (2 args). Drops the legacy `p_amount`
-- parameter so clients can never supply an arbitrary credit amount.
--
-- Winner selection mirrors supabase/functions/_shared/caseBattles.ts:
--   standard/terminal/jackpot (solo): highest (or lowest if crazy) total,
--     ties broken via SHA-256(battle_seed || ':tie:' || slot)
--   group: team halves, ties via SHA-256(battle_seed || ':team-tie:' || team)
--
-- Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════
begin;

drop function if exists public.cb_claim_payout(uuid, int, numeric) cascade;
drop function if exists public.cb_claim_payout(uuid, int) cascade;

create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_player public.case_battle_players%rowtype;
  v_balance numeric;
  v_total numeric;
  v_winner_slot int;
  v_winner_slots int[];
  v_payout numeric;
  v_keep_mult numeric;
  v_row record;
  v_total_drops numeric;
  v_my_total numeric;
  v_group_a numeric := 0;
  v_group_b numeric := 0;
  v_half int;
  v_winning_half text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then
    raise exception 'Battle not found';
  end if;
  if v_battle.status != 'completed' then
    raise exception 'Battle not completed';
  end if;

  select * into v_player
  from public.case_battle_players
  where battle_id = p_battle_id and slot = p_slot
  for update;
  if not found then
    raise exception 'Player not found';
  end if;
  if v_player.user_id is null or v_player.user_id != v_uid then
    raise exception 'You can only claim your own payout';
  end if;

  -- Idempotency: already claimed → return current balance (no double-credit).
  if v_player.claimed_at is not null then
    if v_battle.coin_type = 'sweeps_coins' then
      select sweeps_coins into v_balance from public.profiles where id = v_uid;
    else
      select balance into v_balance from public.profiles where id = v_uid;
    end if;
    return coalesce(v_balance, 0);
  end if;

  create temp table _slot_totals on commit drop as
    select d.slot, sum(d.item_value) as total
    from public.case_battle_drops d
    where d.battle_id = p_battle_id
    group by d.slot;

  select coalesce(sum(total), 0) into v_total_drops from _slot_totals;
  if v_total_drops = 0 then
    drop table if exists _slot_totals;
    raise exception 'No drops found for this battle';
  end if;

  v_keep_mult := (100 - v_battle.borrow_percent) / 100.0;
  v_winner_slot := -1;
  v_winner_slots := array[]::int[];

  if v_battle.gamemode = 'group' then
    -- Team modes: split slots into two halves (low / high).
    select max(slot) into v_half from _slot_totals;
    v_half := (v_half + 1) / 2;

    for v_row in select * from _slot_totals loop
      if v_row.slot < v_half then
        v_group_a := v_group_a + v_row.total;
      else
        v_group_b := v_group_b + v_row.total;
      end if;
    end loop;

    if v_group_a > v_group_b then
      v_winning_half := 'a';
    elsif v_group_b > v_group_a then
      v_winning_half := 'b';
    else
      -- Team tie: coinflip on team indices 0/1.
      if encode(sha256(convert_to(v_battle.battle_seed || ':team-tie:0', 'UTF8')), 'hex')
         < encode(sha256(convert_to(v_battle.battle_seed || ':team-tie:1', 'UTF8')), 'hex') then
        v_winning_half := 'a';
      else
        v_winning_half := 'b';
      end if;
    end if;

    if v_winning_half = 'a' then
      select array_agg(slot) into v_winner_slots from _slot_totals where slot < v_half;
    else
      select array_agg(slot) into v_winner_slots from _slot_totals where slot >= v_half;
    end if;

  else
    -- standard / terminal / jackpot (solo ranking by total):
    -- highest total wins, or lowest if crazy. Ties broken by SHA-256 coinflip.
    if v_battle.crazy then
      select slot into v_winner_slot from _slot_totals
      order by total asc,
        encode(sha256(convert_to(v_battle.battle_seed || ':tie:' || slot::text, 'UTF8')), 'hex') asc
      limit 1;
    else
      select slot into v_winner_slot from _slot_totals
      order by total desc,
        encode(sha256(convert_to(v_battle.battle_seed || ':tie:' || slot::text, 'UTF8')), 'hex') asc
      limit 1;
    end if;
    v_winner_slots := array[v_winner_slot];
  end if;

  if v_winner_slots is null or not (p_slot = any (v_winner_slots)) then
    drop table if exists _slot_totals;
    raise exception 'You did not win this battle';
  end if;

  if v_battle.gamemode = 'group' then
    select coalesce(sum(total), 0) into v_total from _slot_totals where slot = any (v_winner_slots);
    select coalesce(total, 0) into v_my_total from _slot_totals where slot = p_slot;
    v_payout := round(v_total_drops * (v_my_total / nullif(v_total, 0)) * v_keep_mult, 2);
  else
    -- Solo winner takes the pot of item values, adjusted for borrow.
    v_payout := round(v_total_drops * v_keep_mult, 2);
  end if;

  drop table if exists _slot_totals;

  -- Bypass the profiles balance-guard trigger (security-definer path).
  perform public.bypass_profile_balance_guard();

  if v_battle.coin_type = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles
    set sweeps_coins = v_balance,
        total_wins = total_wins + v_payout,
        updated_at = now()
    where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles
    set balance = v_balance,
        total_wins = total_wins + v_payout,
        updated_at = now()
    where id = v_uid;
  end if;

  update public.case_battle_players
  set claimed_at = now()
  where battle_id = p_battle_id and slot = p_slot;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (
    v_uid,
    'win',
    v_payout,
    v_balance,
    'Case Battle payout (slot ' || p_slot || ', ' || v_battle.gamemode || ')',
    now()
  );

  return v_balance;
end;
$$;

revoke all on function public.cb_claim_payout(uuid, int) from public;
grant execute on function public.cb_claim_payout(uuid, int) to authenticated;

-- Restrict bot adds to the battle creator (was: any authenticated user).
create or replace function public.cb_add_bot(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.case_battles%rowtype;
  v_players int;
  v_slot int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then
    raise exception 'Battle not found';
  end if;
  if v_battle.status != 'waiting' then
    raise exception 'Cannot add bots after start';
  end if;
  if v_battle.creator_id != v_uid then
    raise exception 'Only the creator can add bots';
  end if;

  select count(*) into v_players from public.case_battle_players where battle_id = p_battle_id;
  if v_players >= v_battle.max_players then
    raise exception 'Battle is full';
  end if;

  select coalesce(max(slot), -1) + 1 into v_slot
  from public.case_battle_players
  where battle_id = p_battle_id;

  insert into public.case_battle_players (battle_id, slot, user_id, is_bot, username, avatar_seed)
  values (
    p_battle_id,
    v_slot,
    null,
    true,
    'Bot ' || (v_slot + 1)::text,
    'bot-' || v_slot::text
  );

  -- Bots contribute full entry_cost to pot (house-sponsored seats).
  update public.case_battles
  set pot_total = pot_total + entry_cost
  where id = p_battle_id;
end;
$$;

revoke all on function public.cb_add_bot(uuid) from public;
grant execute on function public.cb_add_bot(uuid) to authenticated;

commit;
