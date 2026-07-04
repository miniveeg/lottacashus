#!/usr/bin/env python3
"""Phase 7: final corrective fixes.

1. migrations/002 + lottacash-complete-setup.sql: the team-tie _team_totals
   block landed in the wrong branch (gamemode='group') in phase 6. Move
   it into the team-mode branches (2v2/3v3/2v2v2). Restore the original
   half-based group logic for gamemode='group'.

2. caseBattlesApi.ts: orphan pseudoTieBreak declaration at ~L373-L409.
   Delete it by line range.

Strategy:
- Identify the start of the wrong _team_totals block.
- Identify the closing end; (or replace with the half-based block).
- Insert the team-aggregation block INSIDE the SOLO branches by replacing
  the matching solo `order by total asc, total desc` clauses to include
  a CASE-based team predicate.
"""
import re

# === Step 1: revert migrations/002 group-mode block + insert team agg into solo branches ===
fp = 'supabase/migrations/002_case_battles_audit_fixes.sql'
src = open(fp, 'r', encoding='utf-8').read()

# Find the _team_totals block that came from phase 6 and revert group branch.
TEAM_BLOCK_START = '-- Generalize team aggregation:'
TEAM_BLOCK_END = '    end;\n'
i = src.find(TEAM_BLOCK_START)
if i < 0:
    print('  [INFO] migrations/002: no team-aggregation block found (already reverted?)')
else:
    # Find end. Walk forward until we find 'select slots into v_winner_slots from _team_totals where team_idx = v_pick;'
    j = src.find('select slots into v_winner_slots from _team_totals where team_idx = v_pick;', i)
    nl = src.find('\n', j) + 1
    # Wrap-up to next blank line if any
    while nl < len(src) and src[nl] in ' \t':
        nl += 1
    if src[nl] == '\n':
        nl += 1
    end = nl
    # Restore plain half-based group block from 001_audit_fixes.sql
    RESTORED_GROUP = '''      select max(slot) into v_half from _slot_totals;
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
'''
    src = src[:i] + RESTORED_GROUP + '\n' + src[end:]
    print('  [OK] migrations/002: reverted group branch to half-based + equal-tie coinflip')

# Now insert team aggregation into the SOLO branches. Find lines like:
# `    if v_battle.gamemode in ('standard', 'terminal', 'jackpot') then`
# Inside it, the winner is selected with simple `order by total`. We need
# to insert a per-team aggregation block + replace the simple SELECT with
#   ORDER BY total DESC, encode(sha256(... || ':tie:' || slot), 'hex') ASC
# but ALSO aggregate by team for 2v2/2v2v2/3v3 first.
#
# Easier alternative: leave the solo tie-break in place (sha256 of slot)
# which already produces a correct coinflip for SOLO modes (1v1/1v1v1/etc.).
# The team-mode branch (2v2/2v2v2/3v3) needs the same + a team sum first.
#
# Since the migration's solo branch is used for BOTH solo modes and team
# modes, we add a CASE that handles both:
TEAM_AWARE_SOLO = '''    if v_battle.gamemode in ('standard', 'terminal', 'jackpot') then
      -- audit #002 cryptographic tie-break (audit #002).
      --
      -- For SOLO modes (1v1/1v1v1/1v1v1v1) each slot is its own
      -- "team" — pick the slot whose total/max is best; ties broken
      -- via SHA-256(battle_seed || ':tie:' || slot).
      --
      -- For TEAM modes (2v2/2v2v2/3v3) aggregate per team first;
      -- ties broken via SHA-256(battle_seed || ':team-tie:' || team_idx).
      -- Treats each team as a unit; winning team's slots are split
      -- among its humans via the existing `splitWinningTeamPayouts` flow.
      create temp table _team_agg on commit drop as
        with members as (
          select d.slot,
                 sum(d.item_value) as slot_total,
                 case v_battle.player_mode
                   when '2v2'   then case when d.slot < 2 then 0 else 1 end
                   when '3v3'   then case when d.slot < 3 then 0 else 1 end
                   when '2v2v2' then (d.slot / 2)::int
                   else d.slot  -- solo: each slot is its own team
                 end as team_idx
          from public.case_battle_drops d
          where d.battle_id = p_battle_id
          group by d.slot
        )
        select team_idx,
               sum(slot_total) as team_total,
               array_agg(slot order by slot) as slots
        from members group by team_idx;

      if v_battle.crazy then
        select slots into v_winner_slots
        from _team_agg
        where team_total = (select min(team_total) from _team_agg)
        order by team_total asc,
          encode(sha256(convert_to(v_battle.battle_seed ||
            case when v_battle.player_mode in ('2v2','2v2v2','3v3')
                 then ':team-tie:' else ':tie:' end ||
            team_idx::text, 'UTF8')), 'hex') asc
        limit 1;
      else
        select slots into v_winner_slots
        from _team_agg
        where team_total = (select max(team_total) from _team_agg)
        order by team_total desc,
          encode(sha256(convert_to(v_battle.battle_seed ||
            case when v_battle.player_mode in ('2v2','2v2v2','3v3')
                 then ':team-tie:' else ':tie:' end ||
            team_idx::text, 'UTF8')), 'hex') asc
        limit 1;
      end if;
      v_winner_slot := v_winner_slots[1];
'''
OLD_SOLO = '''    if v_battle.gamemode in ('standard', 'terminal', 'jackpot') then
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

'''
if OLD_SOLO in src:
    src = src.replace(OLD_SOLO, TEAM_AWARE_SOLO, 1)
    print('  [OK] migrations/002: solo branch now team-aware (case 2v2/3v3/2v2v2 uses team-tie domain)')
else:
    print('  [INFO] migrations/002: solo branch already updated')

open(fp, 'w', encoding='utf-8').write(src)

# === Step 1b: same for lottacash-complete-setup.sql ===
fp = 'supabase/lottacash-complete-setup.sql'
src = open(fp, 'r', encoding='utf-8').read()

# Find lines around the team-aggregation block
i = src.find('-- Generalize team aggregation:')
if i >= 0:
    j = src.find('select slots into v_winner_slots from _team_totals where team_idx = v_pick;', i)
    nl_pos = src.find('\n', j) + 1
    while nl_pos < len(src) and src[nl_pos] in ' \t':
        nl_pos += 1
    if src[nl_pos] == '\n':
        nl_pos += 1
    end_pos = nl_pos
    src = src[:i] + RESTORED_GROUP + '\n' + src[end_pos:]
    print('  [OK] consolidated: reverted group branch to half-based')

if OLD_SOLO in src:
    src = src.replace(OLD_SOLO, TEAM_AWARE_SOLO, 1)
    print('  [OK] consolidated: solo branch now team-aware')
else:
    print('  [INFO] consolidated: solo branch already updated')

open(fp, 'w', encoding='utf-8').write(src)

# === Step 2: drop orphan pseudoTieBreak declaration ===
fp = 'src/pages/CaseBattles/caseBattlesApi.ts'
src = open(fp, 'r', encoding='utf-8').read()
lines = src.split('\n')

# Find any line containing 'function pseudoTieBreak(' — that's the start.
start_line = -1
for i, line in enumerate(lines):
    if 'function pseudoTieBreak(' in line:
        start_line = i
        # walk back to find **/**
        for j in range(i - 1, -1, -1):
            if lines[j].lstrip().startswith(('/**', '/*')):
                start_line = j
                break
        break

if start_line >= 0:
    # Find end: walk forward and find the closing '}' at indent level 0.
    depth = 0
    end_line = -1
    for k in range(start_line, len(lines)):
        for ch in lines[k]:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end_line = k
                    break
        if end_line >= 0:
            break
    if end_line >= 0:
        del lines[start_line:end_line + 1]
        # Collapse trailing blank line
        while start_line < len(lines) and lines[start_line] == '':
            del lines[start_line]
        open(fp, 'w', encoding='utf-8').write('\n'.join(lines))
        print(f'  [OK] caseBattlesApi: pseudoTieBreak deleted (lines {start_line}-{end_line})')
    else:
        print('  [WARN] caseBattlesApi: could not find end of pseudoTieBreak')
else:
    print('  [INFO] caseBattlesApi: pseudoTieBreak already removed')

print('\nDONE')
