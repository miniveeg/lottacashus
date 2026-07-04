#!/usr/bin/env python3
"""Phase 2: apply remaining case-battles transforms idempotently.

The earlier phase 1 succeeded for `supabase/functions/_shared/caseBattles.ts`
but the unicode print error stopped subsequent files. This script uses
state-detection (\"if old block present, replace\") so it's safe to re-run.

Files updated:
  - src/lib/games/case-battles/engine.ts
  - supabase/functions/case-battle-v2/index.ts
  - src/pages/CaseBattles/caseBattlesApi.ts
  - src/pages/CaseBattles/CaseBattlesRoomV2.tsx
  - src/lib/local-case-battles.ts
"""
import re, sys

def read(p):
    with open(p, 'r', encoding='utf-8') as f: return f.read()

def write(p, s):
    with open(p, 'w', encoding='utf-8') as f: f.write(s)
    print(f'WROTE {p}')

def apply(p, old, new, label):
    src = read(p)
    if old in src:
        src = src.replace(old, new, 1)
        write(p, src)
        print(f'  [OK] {label}')
    elif new.split('\n', 5)[2] in src:
        print(f'  [SKIP] {label}: already migrated')
    else:
        print(f'  [WARN] {label}: old anchor not found and new also not found')
        return False
    return True

NEW_HELPERS = '''/**
 * Cryptographic tie-break (audit #002).
 *
 * Previously, ties were broken by lowest slot index — whoever joined first
 * always won. We replace this with a deterministic SHA-256-based coinflip
 * derived from the battleSeed: SHA-256(`${battleSeed}:tie:${slot}`) acts as
 * each slot's "vote". The tied slots are sorted by the hex output and the
 * lowest hex digest wins. The SQL mirror in supabase/migrations/002_ uses
 * the same domain separator so server- and client-side resolutions agree.
 *
 * Falls back to lowest-slot order when `battleSeed` is unknown.
 */
async function coinflipWinningSlot(
  tiedSlots: number[],
  battleSeed: string | null,
  domain: 'tie' | 'team-tie',
): Promise<number> {
  if (tiedSlots.length <= 1) return tiedSlots[0] ?? -1;
  if (!battleSeed) return tiedSlots.reduce((a, b) => (a < b ? a : b));
  const enc = new TextEncoder();
  const ranked = await Promise.all(
    tiedSlots.map(async (slot) => {
      const buf = await crypto.subtle.digest(
        'SHA-256',
        enc.encode(`${battleSeed}:${domain}:${slot}`),
      );
      return {
        slot,
        hash: Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      };
    }),
  );
  ranked.sort((a, b) =>
    a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.slot - b.slot,
  );
  return ranked[0]!.slot;
}

/**
 * Async extreme-picker used by resolveXxx. Ties broken by `coinflipWinningSlot`.
 */
async function pickExtremeByScore(
  players: BattlePlayerResult[],
  score: (p: BattlePlayerResult) => number,
  pickMax: boolean,
  battleSeed: string | null,
): Promise<number> {
  if (players.length === 0) return -1;
  const scored = players.map((p) => ({ slot: p.slot, v: score(p) }));
  let bestV = scored[0]!.v;
  for (let i = 1; i < scored.length; i++) {
    const s = scored[i]!;
    if (pickMax ? s.v > bestV : s.v < bestV) bestV = s.v;
  }
  const tied = scored.filter((s) => s.v === bestV).map((s) => s.slot);
  return coinflipWinningSlot(tied, battleSeed, 'tie');
}

'''

# ============================================================
# engine.ts
# ============================================================
fp = 'src/lib/games/case-battles/engine.ts'
src = read(fp)

# 1. Remove BATTLE_RAKE
if 'export const BATTLE_RAKE = 0.05;' in src:
    src = src.replace('export const BATTLE_RAKE = 0.05;\n', '', 1)
    print('  [OK] engine.ts: removed BATTLE_RAKE export')

# 2. Insert helpers if not present (insert before `function resolveNormal(`)
if 'coinflipWinningSlot' not in src and 'function resolveNormal(' in src:
    src = src.replace('function resolveNormal(', NEW_HELPERS + 'function resolveNormal(', 1)
    print('  [OK] engine.ts: inserted crypto helpers')

# 3. Replace legacy pickExtremeIndex with throw-away stub or remove.
# Since pickExtremeByScore replaces it, just delete the legacy body.
LEGACY_PE = '''function pickExtremeIndex(
  players: BattlePlayerResult[],
  score: (p: BattlePlayerResult) => number,
  pickMax: boolean
): number {
  let idx = 0;
  for (let i = 1; i < players.length; i++) {
    const a = score(players[i]!);
    const b = score(players[idx]!);
    const better = pickMax ? a > b : a < b;
    const tie = a === b && players[i]!.slot < players[idx]!.slot;
    if (better || tie) idx = i;
  }
  return idx;
}

'''
if LEGACY_PE in src:
    src = src.replace(LEGACY_PE, '', 1)
    print('  [OK] engine.ts: removed legacy pickExtremeIndex')

# 4. Replace sync resolveNormal with async version using pickExtremeByScore
OLD_NORMAL = '''function resolveNormal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean
): OutcomeResult {
  const unboxedPool = totalUnboxedPool(players);

  if (!isTeamMode(playerMode)) {
    const bestIdx = pickExtremeIndex(players, (p) => p.totalValue, !crazy);
    const winner = players[bestIdx]!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
    };
  }'''
NEW_NORMAL = '''async function resolveNormal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean,
  battleSeed: string | null,
): Promise<OutcomeResult> {
  const unboxedPool = totalUnboxedPool(players);

  if (!isTeamMode(playerMode)) {
    const winnerSlot = await pickExtremeByScore(
      players, (p) => p.totalValue, !crazy, battleSeed,
    );
    const winner = players.find((p) => p.slot === winnerSlot)!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
    };
  }'''
if OLD_NORMAL in src:
    src = src.replace(OLD_NORMAL, NEW_NORMAL, 1)
    print('  [OK] engine.ts: resolveNormal solo path -> async + crypto tie-break')

# 5. Update resolveNormal TEAM PATH: tie-break for equal team totals
OLD_NTEAM = '''  let bestTeam = 0;
  let bestTotal = crazy ? Number.POSITIVE_INFINITY : -1;
  for (const [t, total] of teamTotals) {
    const better = crazy
      ? total < bestTotal || (total === bestTotal && t < bestTeam)
      : total > bestTotal || (total === bestTotal && t < bestTeam);
    if (better) {
      bestTotal = total;
      bestTeam = t;
    }
  }

  const winningSlots = [...(teamSlots.get(bestTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: winningSlots[0] ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
  };
}

function resolveGroup'''
NEW_NTEAM = '''  const teamIds = Array.from(teamTotals.keys());
  const minS = Math.min(...teamIds.map((t) => teamTotals.get(t) ?? 0));
  const maxS = Math.max(...teamIds.map((t) => teamTotals.get(t) ?? 0));
  const tiedTeams = teamIds.filter((t) => teamTotals.get(t) === (crazy ? minS : maxS));
  const bestTeam = await coinflipWinningSlot(tiedTeams, battleSeed, 'team-tie');

  const winningSlots = [...(teamSlots.get(bestTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: winningSlots[0] ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
  };
}

function resolveGroup'''
if OLD_NTEAM in src:
    src = src.replace(OLD_NTEAM, NEW_NTEAM, 1)
    print('  [OK] engine.ts: resolveNormal team path -> crypto tie-break')

# 6. Replace sync resolveTerminal with async
OLD_TERMINAL = '''function resolveTerminal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean
): OutcomeResult {
  const unboxedPool = totalUnboxedPool(players);
  const scoreOf = (p: BattlePlayerResult) => lastRoundValue(p);

  if (!isTeamMode(playerMode)) {
    const bestIdx = pickExtremeIndex(players, scoreOf, !crazy);
    const winner = players[bestIdx]!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
    };
  }'''
NEW_TERMINAL = '''async function resolveTerminal(
  players: BattlePlayerResult[],
  playerMode: string,
  _potTotal: number,
  crazy: boolean,
  battleSeed: string | null,
): Promise<OutcomeResult> {
  const unboxedPool = totalUnboxedPool(players);
  const scoreOf = (p: BattlePlayerResult) => lastRoundValue(p);

  if (!isTeamMode(playerMode)) {
    const winnerSlot = await pickExtremeByScore(
      players, scoreOf, !crazy, battleSeed,
    );
    const winner = players.find((p) => p.slot === winnerSlot)!;
    const winnerPayouts: WinnerPayout[] = [];
    if (!winner.isBot && winner.userId) {
      winnerPayouts.push({ userId: winner.userId, amount: unboxedPool });
    }
    return {
      winnerSlot: winner.slot,
      winnerUserId: winner.isBot ? null : winner.userId,
      winnerPayout: winnerPayouts.length ? unboxedPool : 0,
      winnerPayouts,
      winningSlots: [winner.slot],
    };
  }'''
if OLD_TERMINAL in src:
    src = src.replace(OLD_TERMINAL, NEW_TERMINAL, 1)
    print('  [OK] engine.ts: resolveTerminal solo path -> async + crypto tie-break')

# 7. resolveTerminal team path
OLD_TTEAM = '''  let bestTeam = 0;
  let bestScore = crazy ? Number.POSITIVE_INFINITY : -1;
  for (const [t, score] of teamScores) {
    const better = crazy
      ? score < bestScore || (score === bestScore && t < bestTeam)
      : score > bestScore || (score === bestScore && t < bestTeam);
    if (better) {
      bestScore = score;
      bestTeam = t;
    }
  }

  const winningSlots = [...(teamSlots.get(bestTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: winningSlots[0] ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
  };
}

async function pickWeightedIndex'''
NEW_TTEAM = '''  const teamIds = Array.from(teamScores.keys());
  const minS = Math.min(...teamIds.map((t) => teamScores.get(t) ?? 0));
  const maxS = Math.max(...teamIds.map((t) => teamScores.get(t) ?? 0));
  const tiedTeams = teamIds.filter((t) => teamScores.get(t) === (crazy ? minS : maxS));
  const bestTeam = await coinflipWinningSlot(tiedTeams, battleSeed, 'team-tie');

  const winningSlots = [...(teamSlots.get(bestTeam) ?? [])].sort((a, b) => a - b);
  const winnerPayouts = splitWinningTeamPayouts(
    players.filter((p) => winningSlots.includes(p.slot)),
    unboxedPool
  );
  const paidTotal = winnerPayouts.reduce((s, p) => s + p.amount, 0);

  return {
    winnerSlot: winningSlots[0] ?? 0,
    winnerUserId: winnerPayouts[0]?.userId ?? null,
    winnerPayout: paidTotal,
    winnerPayouts,
    winningSlots,
  };
}

async function pickWeightedIndex'''
if OLD_TTEAM in src:
    src = src.replace(OLD_TTEAM, NEW_TTEAM, 1)
    print('  [OK] engine.ts: resolveTerminal team path -> crypto tie-break')

# 8. Update resolveOutcome to await resolveNormal/Terminal and pass battleSeed
OLD_OUT = '''async function resolveOutcome(
  players: BattlePlayerResult[],
  playerMode: string,
  gamemode: string,
  potTotal: number,
  battleSeed: string,
  crazy: boolean
): Promise<OutcomeResult> {
  switch (gamemode) {
    case "group":
      return resolveGroup(players, potTotal);
    case "terminal":
      return resolveTerminal(players, playerMode, potTotal, crazy);
    case "jackpot":
      return await resolveJackpot(players, playerMode, potTotal, battleSeed, crazy);
    case "normal":
    default:
      return resolveNormal(players, playerMode, potTotal, crazy);
  }
}'''
NEW_OUT = '''async function resolveOutcome(
  players: BattlePlayerResult[],
  playerMode: string,
  gamemode: string,
  potTotal: number,
  battleSeed: string,
  crazy: boolean
): Promise<OutcomeResult> {
  switch (gamemode) {
    case "group":
      return resolveGroup(players, potTotal);
    case "terminal":
      return await resolveTerminal(players, playerMode, potTotal, crazy, battleSeed);
    case "jackpot":
      return await resolveJackpot(players, playerMode, potTotal, battleSeed, crazy);
    case "normal":
    default:
      return await resolveNormal(players, playerMode, potTotal, crazy, battleSeed);
  }
}'''
if OLD_OUT in src:
    src = src.replace(OLD_OUT, NEW_OUT, 1)
    print('  [OK] engine.ts: resolveOutcome threads battleSeed')

if 'pickExtremeIndex' not in src and 'coinflipWinningSlot' in src and 'async function resolveNormal' in src:
    write(fp, src)
    print('  engine.ts: ALL OK')

# ============================================================
# case-battle-v2/index.ts
# ============================================================
fp = 'supabase/functions/case-battle-v2/index.ts'
src = read(fp)

# 1. Add coinflipWinningSlot to the import
OLD_IMP = '''import {
  BOT_CLIENT_SEED,
  CASE_CATALOG,
  deriveBattleSeedFromEos,
  generateBattleSeed,
  getCaseById,
  hashSeed,
  payoutKeepMultiplier,
  type CaseItem,
  type LootCase,
} from "../_shared/caseBattles.ts";'''
NEW_IMP = '''import {
  BOT_CLIENT_SEED,
  CASE_CATALOG,
  coinflipWinningSlot,
  deriveBattleSeedFromEos,
  generateBattleSeed,
  getCaseById,
  hashSeed,
  payoutKeepMultiplier,
  type CaseItem,
  type LootCase,
} from "../_shared/caseBattles.ts";'''
if OLD_IMP in src:
    src = src.replace(OLD_IMP, NEW_IMP, 1)
    print('  [OK] case-battle-v2: imported coinflipWinningSlot')

# 2. Replace inline tie-break
OLD_INLINE = '''    let bestIdx = 0;
    for (let i = 1; i < rolls.length; i++) {
      const a = scoreOf(rolls[i]!);
      const b = scoreOf(rolls[bestIdx]!);
      const better = pickMax ? a > b : a < b;
      // Tie → lower slot wins (deterministic).
      const tie = a === b && rolls[i]!.slot < rolls[bestIdx]!.slot;
      if (better || tie) bestIdx = i;
    }
    winnerSlot = rolls[bestIdx]!.slot;'''
NEW_INLINE = '''    // Find best score then SHA-256-based tie-break (audit #002).
    const scores = rolls.map((r) => scoreOf(r));
    let winningScore = scores[0]!;
    for (let i = 1; i < scores.length; i++) {
      const a = scores[i]!;
      const better = pickMax ? a > winningScore : a < winningScore;
      if (better) winningScore = a;
    }
    const tiedSlots = rolls
      .filter((_, i) => scores[i] === winningScore)
      .map((r) => r.slot)
      .sort((a, b) => a - b);
    winnerSlot = await coinflipWinningSlot(tiedSlots, params.battleSeed, 'tie');'''
if OLD_INLINE in src:
    src = src.replace(OLD_INLINE, NEW_INLINE, 1)
    print('  [OK] case-battle-v2: inline tie-break replaced with crypto coinflip')

# 3. Drop p_amount from cb_claim_payout call
OLD_RPC = '''  const { data, error } = await admin.rpc("cb_claim_payout", {
    p_battle_id: battleId,
    p_slot: slot,
    p_amount: payout.amount,
  });'''
NEW_RPC = '''  // audit #002: cb_claim_payout recomputes the payout server-side from the
  // stored drops; client no longer passes an amount.
  const { data, error } = await admin.rpc("cb_claim_payout", {
    p_battle_id: battleId,
    p_slot: slot,
  });'''
if OLD_RPC in src:
    src = src.replace(OLD_RPC, NEW_RPC, 1)
    print('  [OK] case-battle-v2: dropped p_amount from cb_claim_payout call')

# 4. Update doc comment
OLD_DOC = ''' * NOTE: the v2 `cb_claim_payout` SQL doesn't track "already claimed" state,
 * so a duplicate claim would double-credit. The frontend must guard against
 * this (e.g. disable the claim button after success). The RPC itself enforces
 * only that the caller owns the slot.'''
NEW_DOC = ''' * NOTE: idempotency is enforced server-side by the `claimed_at` column on
 * `case_battle_players`. A duplicate claim returns the current balance
 * without re-crediting (audit #002 dropped the legacy `p_amount` param;
 * the SQL payout is determined purely from stored drops).'''
if OLD_DOC in src:
    src = src.replace(OLD_DOC, NEW_DOC, 1)
    print('  [OK] case-battle-v2: doc comment updated')

write(fp, src)

# ============================================================
# caseBattlesApi.ts
# ============================================================
fp = 'src/pages/CaseBattles/caseBattlesApi.ts'
src = read(fp)

# 1. Drop slot bias in calculateWinner (standard)
if 'const tie = t.total === best.total && t.slot < best.slot;' in src:
    src = src.replace(
        'const tie = t.total === best.total && t.slot < best.slot;\n        return better || tie ? t : best;',
        'return better ? t : best;',
        2,
    )
    print('  [OK] caseBattlesApi: removed slot-tie bias from calculateWinner')

# 2. Drop _amount param from claimPayout
if '_amount: number' in src:
    src = src.replace(
        '''export async function claimPayout(
  battleId: string,
  slot: number,
  _amount: number,
): Promise<{ data: { balance: number } | null; error: string | null }> {
  // Check local first.
  const local = localClaimPayout(battleId, slot);
  if (local.data) return local;
  const { data, error } = await invokeEdgeFunction<{ balance: number }>("case-battle-v2", {
    action: "claim",
    battleId,
    slot,
    amount: _amount,
  });
  if (error) return local;
  return { data, error: null };
}''',
        '''export async function claimPayout(
  battleId: string,
  slot: number,
): Promise<{ data: { balance: number } | null; error: string | null }> {
  // Check local first.
  const local = localClaimPayout(battleId, slot);
  if (local.data) return local;
  // Edge fn recomputes payout server-side from stored drops — audit #002
  // dropped the legacy `amount` param.
  const { data, error } = await invokeEdgeFunction<{ balance: number }>("case-battle-v2", {
    action: "claim",
    battleId,
    slot,
  });
  if (error) return local;
  return { data, error: null };
}''',
        1,
    )
    print('  [OK] caseBattlesApi: claimPayout signature drops _amount')

write(fp, src)

# ============================================================
# CaseBattlesRoomV2.tsx
# ============================================================
fp = 'src/pages/CaseBattles/CaseBattlesRoomV2.tsx'
src = read(fp)
OLD = 'const { error: err } = await claimPayout(battleId!, myPlayer.slot, myPayout);'
NEW = 'const { error: err } = await claimPayout(battleId!, myPlayer.slot);'
if OLD in src:
    src = src.replace(OLD, NEW, 1)
    print('  [OK] CaseBattlesRoomV2: claimPayout call updated to drop amount')
elif NEW in src:
    print('  [SKIP] CaseBattlesRoomV2: already updated')
else:
    print('  [WARN] CaseBattlesRoomV2: old call pattern not found')
write(fp, src)

# ============================================================
# local-case-battles.ts
# ============================================================
fp = 'src/lib/local-case-battles.ts'
src = read(fp)
OLD = '''  const totalValue = b.drops.filter((d) => d.slot === slot).reduce((s, d) => s + d.itemValue, 0)
    + b.drops.filter((d) => d.slot !== slot).reduce((s, d) => s + d.itemValue, 0);
  const keepMult = (100 - b.borrowPercent) / 100;
  const payout = Math.round(totalValue * keepMult * 100) / 100;'''
NEW = '''  // Winner takes the pot adjusted for borrow (matches SQL cb_claim_payout):
  // payout = pot_total * (1 - borrow%). Previously summed ALL drops twice
  // (winner + everyone-else) as the base, which inflated payouts ~2x.
  const keepMult = (100 - b.borrowPercent) / 100;
  const payout = Math.round(b.potTotal * keepMult * 100) / 100;'''
if OLD in src:
    src = src.replace(OLD, NEW, 1)
    print('  [OK] local-case-battles: payout bug fixed (pot_total * keepMult)')
elif NEW in src:
    print('  [SKIP] local-case-battles: already fixed')
else:
    print('  [WARN] local-case-battles: old bug pattern not found')
write(fp, src)

print('\\nDONE')
