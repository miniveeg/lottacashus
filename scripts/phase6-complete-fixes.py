#!/usr/bin/env python3
"""Phase 6: complete fix.

1. caseBattlesApi.ts: re-strip slot-bias in terminal/jackpot reduce arrows
   by replacing any residual `d.slot < best.slot` => `clientCoinflip` flow.
2. migrations/002 + lottacash-complete-setup.sql + case-battles-v2-setup.sql:
   generalize team-tie to mirror `teamIndexForMode` so 2v2v2 (3 teams) works.
   Use a per-slot `team_index` aggregation + ORDER BY sha256(:team-tie:idx).
"""
import re

# === 1) caseBattlesApi.ts: neutralize any residual slot-bias in reduce ===
fp = 'src/pages/CaseBattles/caseBattlesApi.ts'
src = open(fp, 'r', encoding='utf-8').read()

# Find any lines with the slot-bias tie condition. We replace the pattern
# `const tie = <expr>;` with nothing (drop the line) AND ensure the reduce
# returns on `better ? ... : best` only.
pre = src
src = re.sub(
    r"        const tie = [^\n]+;\n",
    "",
    src,
)
# Drop the orphan `pseudoTieBreak` declaration if it's defined but never
# called.  Use a heuristic: keep it only if matched in 3+ invokes.
hit_count = src.count('pseudoTieBreak(')
if hit_count == 0 or hit_count == 1:
    # The function fell out of use — drop its declaration entirely.
    src = re.sub(
        r"/\*\*\n \* UI pseudo-random tie-breaker[\s\S]*?function pseudoTieBreak[\s\S]*?\n\}\n\n",
        "",
        src,
        count=1,
    )
    print('  [OK] caseBattlesApi: stripped orphan pseudoTieBreak')
elif hit_count >= 2:
    print(f'  [OK] caseBattlesApi: pseudoTieBreak has {hit_count} call sites')
open(fp, 'w', encoding='utf-8').write(src)


# === 2) SQL team-tie: replace the half-based v_half split with team_index ===
# 2v2  -> 2 teams of 2 (slots 0,1 = t0; 2,3 = t1)
# 3v3  -> 2 teams of 3 (slots 0,1,2 = t0; 3,4,5 = t1)
# 2v2v2-> 3 teams of 2 (slots 0,1 = t0; 2,3 = t1; 4,5 = t2) — TEAM SPLIT BY
#   floor(slot/2), NOT by half of total slots!
# Therefore the slot-half heuristic in migrations/002 is wrong for 2v2v2.
# We need a per-slot team_index + ORDER BY hash that generalizes.

# Define the new team-tie block. Uses plain "even-split" for 2v2 / 3v3
# (matching TS), but for 2v2v2 we need a per-slot team_index derivation.
# PG trick: use ROW_NUMBER() OVER (ORDER BY slot) divided by team_size.
# Simpler: a CASE expression derived from game_pf_seeds_player_mode.

# Just hard-code the three known team modes (2v2 / 3v3 / 2v2v2):
NEW_TEAM_BLOCK = '''    -- Generalize team aggregation: 2v2 & 3v3 split into 2 equal halves;
    -- 2v2v2 splits into 3 teams of 2 by floor(slot/2). Mirrors the TS-side
    -- teamIndexForMode() helper in src/lib/games/case-battles/config.ts so
    -- a verifier using either side arrives at the same team index.
    create temp table _team_totals on commit drop as
      with teams as (
        select
          d.slot,
          sum(d.item_value) as slot_total,
          case v_battle.player_mode
            when '2v2'   then case when d.slot < 2 then 0 else 1 end
            when '3v3'   then case when d.slot < 3 then 0 else 1 end
            when '2v2v2' then floor(d.slot::numeric / 2)::int
            -- Older group modes treat each slot as its own team; on a tie the
            -- 'slot-tie' domain wins via the inner ORDER BY.
            else d.slot
          end as team_idx
        from public.case_battle_drops d
        where d.battle_id = p_battle_id
        group by d.slot
      )
      select team_idx, sum(slot_total) as team_total,
             array_agg(slot order by slot) as slots
      from teams
      group by team_idx;

    -- Coinflip on tied team-totals using SHA-256(battle_seed || ':team-tie:' || team_idx).
    declare
      v_max_team_total numeric;
      v_winning_team_ids int[];
      v_pick int;
    begin
      select coalesce(max(team_total), 0) into v_max_team_total from _team_totals;
      if v_max_team_total = 0 then
        raise exception 'No drops found for this battle';
      end if;

      select coalesce(array_agg(team_idx), ARRAY[]::int[])
        into v_winning_team_ids
      from _team_totals
      where team_total = v_max_team_total;

      if array_length(v_winning_team_ids, 1) = 1 then
        v_pick := v_winning_team_ids[1];
      else
        -- Tie: lex-min SHA-256 over tied teams.
        select team_idx into v_pick
        from _team_totals
        where team_total = v_max_team_total
        order by encode(sha256(convert_to(
          v_battle.battle_seed || ':team-tie:' || team_idx::text, 'UTF8'
        )), 'hex') asc
        limit 1;
      end if;

      select slots into v_winner_slots from _team_totals where team_idx = v_pick;
    end;
'''

# Replace the half-based block. The half-based block uses `v_half` and
# two branches `slot < v_half` / `slot >= v_half`.
def replace_team_block(src, marker):
    """Replace the half-based team-tie block with the generalized version."""
    # Be tolerant of different surrounding text. Find the boundary by
    # searching for the unique `v_half := (v_half + 1) / 2;` line and
    # replacing from `select max(slot) into v_half` through `end if;`
    # (closing the outer if/elsif block).
    start_pat = re.compile(r'(\s+)select max\(slot\) into v_half from _slot_totals;')
    m = start_pat.search(src)
    if not m:
        return src, False
    # Find the matching `end if;` after this point. We'll scan forward
    # tracking nested begin/end blocks.
    i = m.end()
    depth = 0
    while i < len(src):
        # naive scan: find next `end if;` or `END IF;`
        nxt = src.find('end if;', i)
        if nxt < 0:
            break
        # Check if any `begin` opens between i and nxt
        seg = src[i:nxt]
        depth += seg.count('begin')
        depth -= seg.count('end')
        if depth <= 0:
            j = nxt + len('end if;')
            # Include any trailing spaces/newline
            while j < len(src) and src[j] in ' \t':
                j += 1
            if j < len(src) and src[j] == '\n':
                j += 1
            return src[:m.start()] + '\n' + NEW_TEAM_BLOCK.rstrip() + src[j:], True
        i = nxt + len('end if;')
    return src, False

for label, fp in [
    ('migrations/002', 'supabase/migrations/002_case_battles_audit_fixes.sql'),
    ('consolidated', 'supabase/lottacash-complete-setup.sql'),
    ('v2-setup',     'supabase/case-battles-v2-setup.sql'),
]:
    src = open(fp, 'r', encoding='utf-8').read()
    src, ok = replace_team_block(src, label)
    if ok:
        open(fp, 'w', encoding='utf-8').write(src)
        print(f'  [OK] {label}: team-tie generalized (handles 2v2/3v3/2v2v2 via teamIndexForMode)')
    else:
        print(f'  [WARN] {label}: half-based team-tie block not found (may already be updated or different shape)')

print('\nDONE')
