-- ══════════════════════════════════════════════════════════════════════════════
-- LottaCash — Case Battles v2 audit fixes (Phase 002)
-- ══════════════════════════════════════════════════════════════════════════════
-- Pairs with the TS-side fixes from audit #002. Required as a HARD dependency
-- before shipping: the case-battle-v2 edge function now calls
-- `cb_claim_payout(battle_id, slot)` (2 args), so this migration MUST drop the
-- legacy `p_amount numeric` parameter — otherwise Postgres returns
-- "function cb_claim_payout(uuid, int) does not exist" on every claim.
--
-- Fix #1 — Drop p_amount param. The payout is recomputed server-side from
-- the stored `case_battle_drops` rows; the client never supplied the amount
-- even before (the prior `p_amount numeric` was server-ignored).
--
-- Fix #2 — Cryptographic tie-break in cb_claim_payout's winner selection.
-- The previous `ORDER BY total DESC, slot ASC LIMIT 1` biased ties toward
-- the lowest-slot player (whoever joined first always won). Replaced with
-- `ORDER BY total DESC, encode(sha256(battle_seed || ':tie:' || slot::text), 'hex') ASC`,
-- which mirrors the TS-side `coinflipWinningSlot` helper from
-- supabase/functions/_shared/caseBattles.ts. Domain separators ("tie" for
-- slot ties, "team-tie" for group/team ties) match the TS domain literals
-- so a verifier can re-derive either side and arrive at the same answer.
--
-- Idempotent: safe to re-run on a fresh DB or atop an existing install.
-- ══════════════════════════════════════════════════════════════════════════════
begin;

-- ────────────────────────────────────────────────────────────────────────────
-- FIX 1+2: cb_claim_payout(uuid, int) — drop p_amount + crypto tie-break
-- ────────────────────────────────────────────────────────────────────────────

-- Drop both signatures of cb_claim_payout to ensure we rewrite cleanly. Postgres
-- refuses CREATE OR REPLACE when argument types change (error 42P13).
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_battle from public.case_battles where id = p_battle_id for update;
  if not found then raise exception 'Battle not found'; end if;
  if v_battle.status != 'completed' then raise exception 'Battle not completed'; end if;

  select * into v_player from public.case_battle_players where battle_id = p_battle_id and slot = p_slot for update;
  if not found then raise exception 'Player not found'; end if;
  if v_player.user_id is null or v_player.user_id != v_uid then
    raise exception 'You can only claim your own payout';
  end if;
  if v_player.claimed_at is not null then
    select balance into v_balance from public.profiles where id = v_uid;
    return coalesce(v_balance, 0);
  end if;

  -- Compute slot totals once.
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
  v_winner_slots := ARRAY[]::int[];

  if v_battle.gamemode in ('standard', 'terminal', 'jackpot') then
    -- SOLO MODES: highest (or lowest if crazy) wins; on tie, the SHA-256
    -- coinflip on (battle_seed || ':tie:' || slot) breaks it. This mirrors
    -- the TS-side `coinflipWinningSlot(tiedSlots, battleSeed, 'tie')` helper
    -- in supabase/functions/_shared/caseBattles.ts so the verifier arrives
    -- at the same slot regardless of where the query is executed.
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
    v_winner_slots := ARRAY[v_winner_slot];

  elsif v_battle.gamemode = 'group' then
    -- GROUP/TEAM: split into two halves; team with higher total wins. On a
    -- team-tie, the SHA-256 coinflip on the team index (not the slot) breaks
    -- it. Same domain separator "team-tie" as the TS helper.
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
        select array_agg(slot) into v_winner_slots from _slot_totals where slot < v_half;
      elsif v_group_b > v_group_a then
        select array_agg(slot) into v_winner_slots from _slot_totals where slot >= v_half;
      else
        -- Equal-total group tie → coinflip on team indices a=0, b=1.
        if encode(sha256(convert_to(v_battle.battle_seed || ':team-tie:0', 'UTF8')), 'hex')
         < encode(sha256(convert_to(v_battle.battle_seed || ':team-tie:1', 'UTF8')), 'hex') then
          select array_agg(slot) into v_winner_slots from _slot_totals where slot < v_half;
        else
          select array_agg(slot) into v_winner_slots from _slot_totals where slot >= v_half;
        end if;
      end if;

end;    end loop;

    -- For group modes (which split into team halves in this implementation),
    -- compute each team's total, pick the team with the highest total, and
    -- break team-ties via SHA-256(battle_seed || ':team-tie:' || team_idx).
    -- Mirrors the TS-side `coinflipWinningSlot(tiedTeams, battleSeed, 'team-tie')`
    -- helper in supabase/functions/_shared/caseBattles.ts so verifier code
    -- in either language arrives at the same team.
    declare
      v_team0_total numeric;
      v_team1_total numeric;
      v_winning_half text;  -- 'a' for slots < v_half; 'b' for slots >= v_half
    begin
      select coalesce(sum(total), 0) into v_team0_total from _slot_totals where slot < v_half;
      select coalesce(sum(total), 0) into v_team1_total from _slot_totals where slot >= v_half;
      if v_team0_total > v_team1_total then
        v_winning_half := 'a';
      elsif v_team1_total > v_team0_total then
        v_winning_half := 'b';
      else
        -- Tie: pick the team whose SHA-256 hash sorts lower.
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
    end;
    end if;
  end if;

  if not (p_slot = any(v_winner_slots)) then
    drop table if exists _slot_totals;
    raise exception 'You did not win this battle';
  end if;

  if v_battle.gamemode = 'group' then
    select coalesce(sum(total), 0) into v_total from _slot_totals where slot = any(v_winner_slots);
    select coalesce(total, 0) into v_my_total from _slot_totals where slot = p_slot;
    v_payout := round(v_total_drops * (v_my_total / nullif(v_total, 0)) * v_keep_mult, 2);
  else
    v_payout := round(v_total_drops * v_keep_mult, 2);
  end if;

  drop table if exists _slot_totals;

  perform public.bypass_profile_balance_guard();
  if v_battle.coin_type = 'sweeps_coins' then
    select sweeps_coins into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles set sweeps_coins = v_balance, total_wins = total_wins + v_payout, updated_at = now() where id = v_uid;
  else
    select balance into v_balance from public.profiles where id = v_uid for update;
    v_balance := coalesce(v_balance, 0) + v_payout;
    update public.profiles set balance = v_balance, total_wins = total_wins + v_payout, updated_at = now() where id = v_uid;
  end if;

  update public.case_battle_players set claimed_at = now() where battle_id = p_battle_id and slot = p_slot;

  insert into public.transactions (user_id, type, amount, balance_after, description, created_at)
  values (v_uid, 'win', v_payout, v_balance, 'Case Battle payout (slot ' || p_slot || ', ' || v_battle.gamemode || ')', now());

  return v_balance;
end;
$$;
revoke all on function public.cb_claim_payout(uuid, int) from public;
grant execute on function public.cb_claim_payout(uuid, int) to authenticated;


commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- End of migration 002_case_battles_audit_fixes.sql
-- ══════════════════════════════════════════════════════════════════════════════
