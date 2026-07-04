#!/usr/bin/env python3
"""Mirror the new cb_claim_payout signature + crypto tie-break into the
consolidated schema file (lottacash-complete-setup.sql).

The consolidated file inlines the canonical cb_claim_payout once per audit
pass. We need to update the inline copy to (a) drop the p_amount param and
(b) use SHA-256-based tie-break in the winner selection.

Since the consolidated file is huge and may have divider-character drift,
we do a byte-precise edit via python: find the existing cb_claim_payout
block, replace the (a) signature declaration lines + (b) the order by
clauses in the gamemode branches.
"""
import re, sys

fp = 'supabase/lottacash-complete-setup.sql'
src = open(fp, 'r', encoding='utf-8').read()
orig = src

# --- (a) Drop the legacy 3-arg signature on the CREATE + REVOKE/GRANT ---
# Pattern: `create or replace function public.cb_claim_payout(\n  p_battle_id uuid,\n  p_slot int,\n  p_amount numeric  -- ignored; recomputed server-side\n)\nreturns numeric`
old_sig = '''create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int,
  p_amount numeric  -- ignored; recomputed server-side
)
returns numeric'''
new_sig = '''create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int  -- payout amount is now recomputed server-side from stored drops
              -- (audit #002 dropped the legacy `p_amount numeric` param)
)
returns numeric'''
if old_sig in src:
    src = src.replace(old_sig, new_sig, 1)
    print('  [OK] consolidated: dropped p_amount param from cb_claim_payout signature')
else:
    print('  [WARN] consolidated: p_amount signature not found verbatim; doing tolerant replace')
    # Tolerant fallback: drop the line that has p_amount numeric in the create block
    src = re.sub(
        r'create or replace function public\.cb_claim_payout\(\n'
        r'(\s*)p_battle_id uuid,\n'
        r'(\s*)p_slot int,\n'
        r'(\s*)p_amount numeric[^\n]*\n'
        r'\)',
        'create or replace function public.cb_claim_payout(\n\\1p_battle_id uuid,\n\\2p_slot int\n)',
        src, count=1,
    )

# Also drop p_amount from REVOKE/GRANT
src = src.replace(
    'revoke all on function public.cb_claim_payout(uuid,int,numeric) from public;',
    'revoke all on function public.cb_claim_payout(uuid,int) from public;',
    1,
)
src = src.replace(
    'grant execute on function public.cb_claim_payout(uuid,int,numeric) to authenticated;',
    'grant execute on function public.cb_claim_payout(uuid,int) to authenticated;',
    1,
)

# --- (b) Replace order-by clauses with SHA-256 coinflip ---
# Pattern (standard/crazy):
old_asc = '''    if v_battle.crazy then
      select slot into v_winner_slot from _slot_totals order by total asc, slot asc limit 1;
    else
      select slot into v_winner_slot from _slot_totals order by total desc, slot asc limit 1;
    end if;'''
new_asc = '''    -- audit #002: cryptographic tie-break using SHA-256(battle_seed || ':tie:' || slot).
    -- Mirrors the TS-side `coinflipWinningSlot` helper in supabase/functions/_shared/caseBattles.ts.
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
    end if;'''
if old_asc in src:
    src = src.replace(old_asc, new_asc, 1)
    print('  [OK] consolidated: standard/terminal/jackpot uses SHA-256 tie-break')
else:
    print('  [WARN] consolidated: standard-mode order-by not found (may have different spacing)')

# Also do case-battles-v2-setup.sql which has the same body
fp2 = 'supabase/case-battles-v2-setup.sql'
src2 = open(fp2, 'r', encoding='utf-8').read()

# Same sig pattern there
old_sig2 = '''create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int,
  p_amount numeric  -- ignored; recomputed server-side
)
returns numeric'''
new_sig2 = '''create or replace function public.cb_claim_payout(
  p_battle_id uuid,
  p_slot int  -- payout amount is now recomputed server-side from stored drops
              -- (audit #002 dropped the legacy `p_amount numeric` param)
)
returns numeric'''
if old_sig2 in src2:
    src2 = src2.replace(old_sig2, new_sig2, 1)
    print('  [OK] case-battles-v2-setup: dropped p_amount param')
src2 = src2.replace(
    'revoke all on function public.cb_claim_payout(uuid,int,numeric) from public;',
    'revoke all on function public.cb_claim_payout(uuid,int) from public;',
    1,
)
src2 = src2.replace(
    'grant execute on function public.cb_claim_payout(uuid,int,numeric) to authenticated;',
    'grant execute on function public.cb_claim_payout(uuid,int) to authenticated;',
    1,
)

# Replace simple winner selection (the v2 setup has the SIMPLE version)
old_simple_win = '''  -- Recompute the winner server-side: highest total item value, ties → lowest slot.
  select slot into v_winner_slot from (
    select d.slot, sum(d.item_value) as total
    from public.case_battle_drops d
    where d.battle_id = p_battle_id
    group by d.slot
    order by total desc, d.slot asc
    limit 1
  ) t;'''
new_simple_win = '''  -- Recompute the winner server-side: highest total. audit #002 added a
  -- SHA-256-based cryptographic tie-break that mirrors the TS-side
  -- `coinflipWinningSlot` helper so ties aren't biased by lowest slot index.
  select slot into v_winner_slot from (
    select d.slot, sum(d.item_value) as total
    from public.case_battle_drops d
    where d.battle_id = p_battle_id
    group by d.slot
    order by total desc,
      encode(sha256(convert_to(v_battle.battle_seed || ':tie:' || d.slot::text, 'UTF8')), 'hex') asc
    limit 1
  ) t;'''
if old_simple_win in src2:
    src2 = src2.replace(old_simple_win, new_simple_win, 1)
    print('  [OK] case-battles-v2-setup: winner selection uses SHA-256 tie-break')

with open(fp, 'w', encoding='utf-8') as f: f.write(src)
with open(fp2, 'w', encoding='utf-8') as f: f.write(src2)
print('\nDONE')
