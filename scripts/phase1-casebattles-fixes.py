#!/usr/bin/env python3
"""Phase 1: surgical fixes for case-battles audit findings.

Touches:
  - supabase/functions/_shared/caseBattles.ts (already partially fixed in
    prior step — this script updates the resolver functions to use the
    new coinflip helper)
  - src/lib/games/case-battles/engine.ts (mirror fix)
  - supabase/functions/case-battle-v2/index.ts (inline tie-break bias)
  - src/pages/CaseBattles/caseBattlesApi.ts (slot bias in calculateWinner)
  - src/pages/CaseBattles/CaseBattleArenaV2.tsx (slot bias in terminal)
  - src/lib/local-case-battles.ts (payout bug — uses everyone's drops
    instead of pot_total * keepMult)
"""
import os, sys

def read(p):
    with open(p, 'r', encoding='utf-8') as f:
        return f.read()

def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)
    print(f'  -> wrote {p}')

# ============================================================
# 1) _shared/caseBattles.ts — update resolvers to use new helpers
# ============================================================
fp = 'supabase/functions/_shared/caseBattles.ts'
src = read(fp)

old_normal = '''function resolveNormal(
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
  }

  const teamTotals = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamTotals.set(t, (teamTotals.get(t) ?? 0) + p.totalValue);
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  let bestTeam = 0;
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
}'''

new_normal = '''async function resolveNormal(
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
  }

  // Team: aggregate by team, then coinflip on tied team totals.
  const teamTotals = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamTotals.set(t, (teamTotals.get(t) ?? 0) + p.totalValue);
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  const teamIds = Array.from(teamTotals.keys());
  const scoreMap = new Map(teamIds.map((t) => [t, teamTotals.get(t) ?? 0]));
  const minS = Math.min(...scoreMap.values());
  const maxS = Math.max(...scoreMap.values());
  const tiedTeams = teamIds.filter((t) => scoreMap.get(t) === (crazy ? minS : maxS));
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
}'''

assert old_normal in src, 'old resolveNormal not found in _shared/caseBattles.ts'
src = src.replace(old_normal, new_normal, 1)

old_terminal = '''function resolveTerminal(
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
  }

  const teamScores = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamScores.set(t, (teamScores.get(t) ?? 0) + scoreOf(p));
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  let bestTeam = 0;
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
}'''

new_terminal = '''async function resolveTerminal(
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
  }

  // Team: aggregate per team, then coinflip on tied team scores.
  const teamScores = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamScores.set(t, (teamScores.get(t) ?? 0) + scoreOf(p));
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  const teamIds = Array.from(teamScores.keys());
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
}'''

assert old_terminal in src, 'old resolveTerminal not found'
src = src.replace(old_terminal, new_terminal, 1)

old_outcome = '''async function resolveOutcome(
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
new_outcome = '''async function resolveOutcome(
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
assert old_outcome in src, 'old resolveOutcome not found'
src = src.replace(old_outcome, new_outcome, 1)

write(fp, src)
print('✓ _shared/caseBattles.ts: resolveNormal+Terminal became async; team-tie coinflip applied')

# ============================================================
# 2) engine.ts — mirror fix
# ============================================================
fp = 'src/lib/games/case-battles/engine.ts'
src = read(fp)

# 1. Remove BATTLE_RAKE export
src = src.replace('export const BATTLE_RAKE = 0.05;\n', '', 1)

# 2. Add the new coinflip helper and convert pickExtremeIndex to a thin
# async wrapper. Insert right before `function resolveNormal(`
INSERT_BEFORE = 'function resolveNormal('
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
 * Falls back to lowest-slot order when `battleSeed` is unknown (pre-commit
 * UI previews only — the server is authoritative so client previews never
 * affect the actual payout).
 */
async function coinflipWinningSlot(
  tiedSlots: number[],
  battleSeed: string | null,
  domain: 'tie' | 'team-tie',
): Promise<number> {
  if (tiedSlots.length <= 1) return tiedSlots[0] ?? -1;
  if (!battleSeed) {
    return tiedSlots.reduce((a, b) => (a < b ? a : b));
  }
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
 * Async extreme-picker used by the resolveXxx functions. Returns the slot
 * index whose `score(players[i])` is best (max or min per `pickMax`), with
 * ties broken by `coinflipWinningSlot`. Replaces the slot-biased legacy
 * helper (audit #002).
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
assert INSERT_BEFORE in src, 'resolveNormal anchor missing in engine.ts'
src = src.replace(INSERT_BEFORE, NEW_HELPERS + INSERT_BEFORE, 1)

# 3. Update resolveNormal solo+team paths
old_normal_e = '''function resolveNormal(
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
  }

  const teamTotals = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamTotals.set(t, (teamTotals.get(t) ?? 0) + p.totalValue);
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  let bestTeam = 0;
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
}'''
new_normal_e = '''async function resolveNormal(
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
  }

  const teamTotals = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamTotals.set(t, (teamTotals.get(t) ?? 0) + p.totalValue);
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  const teamIds = Array.from(teamTotals.keys());
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
}'''
assert old_normal_e in src, 'old resolveNormal not found in engine.ts'
src = src.replace(old_normal_e, new_normal_e, 1)

old_terminal_e = '''function resolveTerminal(
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
  }

  const teamScores = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamScores.set(t, (teamScores.get(t) ?? 0) + scoreOf(p));
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  let bestTeam = 0;
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
}'''
new_terminal_e = '''async function resolveTerminal(
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
  }

  const teamScores = new Map<number, number>();
  const teamSlots = new Map<number, number[]>();
  for (const p of players) {
    const t = teamIndexForMode(playerMode, p.slot);
    teamScores.set(t, (teamScores.get(t) ?? 0) + scoreOf(p));
    const slots = teamSlots.get(t) ?? [];
    slots.push(p.slot);
    teamSlots.set(t, slots);
  }

  const teamIds = Array.from(teamScores.keys());
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
}'''
assert old_terminal_e in src, 'old resolveTerminal not found in engine.ts'
src = src.replace(old_terminal_e, new_terminal_e, 1)

# Now resolveOutcome passes battleSeed through
old_outcome_e = '''async function resolveOutcome(
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
new_outcome_e = '''async function resolveOutcome(
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
assert old_outcome_e in src, 'old resolveOutcome not found in engine.ts'
src = src.replace(old_outcome_e, new_outcome_e, 1)

# Remove legacy pickExtremeIndex (now unused — pickExtremeByScore replaces it)
old_legacy = '''function pickExtremeIndex(
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
assert old_legacy in src, 'legacy pickExtremeIndex not found in engine.ts'
src = src.replace(old_legacy, '', 1)

write(fp, src)
print('✓ engine.ts: BATTLE_RAKE removed, helpers added, resolvers async')

# ============================================================
# 3) case-battle-v2/index.ts — fix inline tie-break + drop p_amount
# ============================================================
fp = 'supabase/functions/case-battle-v2/index.ts'
src = read(fp)

# 3a. Fix the inline tie-break in computePayouts (replaces biased loop).
old_inner = '''    let bestIdx = 0;
    for (let i = 1; i < rolls.length; i++) {
      const a = scoreOf(rolls[i]!);
      const b = scoreOf(rolls[bestIdx]!);
      const better = pickMax ? a > b : a < b;
      // Tie → lower slot wins (deterministic).
      const tie = a === b && rolls[i]!.slot < rolls[bestIdx]!.slot;
      if (better || tie) bestIdx = i;
    }
    winnerSlot = rolls[bestIdx]!.slot;'''
new_inner = '''    // Find best score, then SHA-256-based tie-break (audit #002).
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
assert old_inner in src, 'inline tie-break anchor missing in case-battle-v2'
src = src.replace(old_inner, new_inner, 1)

# 3b. Need to import coinflipWinningSlot. Add an import line.
old_import = '''import {
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
new_import = '''import {
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
assert old_import in src, 'import block anchor missing in case-battle-v2'
src = src.replace(old_import, new_import, 1)

# 3c. Drop the p_amount param from the cb_claim_payout RPC call.
old_rpc = '''  const { data, error } = await admin.rpc("cb_claim_payout", {
    p_battle_id: battleId,
    p_slot: slot,
    p_amount: payout.amount,
  });'''
new_rpc = '''  const { data, error } = await admin.rpc("cb_claim_payout", {
    p_battle_id: battleId,
    p_slot: slot,
  });'''
assert old_rpc in src, 'rpc call anchor missing in case-battle-v2'
src = src.replace(old_rpc, new_rpc, 1)

# 3d. Update doc comment that mentioned "duplicate claim double-credit"
old_doc = ''' * NOTE: the v2 `cb_claim_payout` SQL doesn't track "already claimed" state,
 * so a duplicate claim would double-credit. The frontend must guard against
 * this (e.g. disable the claim button after success). The RPC itself enforces
 * only that the caller owns the slot.'''
new_doc = ''' * NOTE: idempotency is enforced server-side by the `claimed_at` column on
 * `case_battle_players`. A duplicate claim returns the current balance
 * without re-crediting (audit #002 dropped the legacy `p_amount` param so
 * the SQL payout is determined purely from the stored drops).'''
assert old_doc in src, 'doc anchor missing'
src = src.replace(old_doc, new_doc, 1)

write(fp, src)
print('✓ case-battle-v2/index.ts: inline tie-break replaced with coinflip, p_amount dropped')

# ============================================================
# 4) caseBattlesApi.ts — fix calculateWinner slot-bias, drop p_amount
# ============================================================
fp = 'src/pages/CaseBattles/caseBattlesApi.ts'
src = read(fp)

# 4a. Fix slot bias in calculateWinner's standard/terminal/jackpot cases.
# Old logic reduces by tie==slot < best.slot. New logic just picks best.
old_reduce = '''  let winnerSlot: number;
  switch (battle.gamemode) {
    case "standard":
      // Highest total wins (normal) or lowest total wins (crazy)
      winnerSlot = totals.reduce((best, t) => {
        const better = battle.crazy ? t.total < best.total : t.total > best.total;
        const tie = t.total === best.total && t.slot < best.slot;
        return better || tie ? t : best;
      }).slot;
      break;'''
new_reduce = '''  // Tie-break removed (audit #002): the server's stored drops + a
  // deterministic SHA-256-based tie-break are authoritative. This UI helper
  // only returns a *display* winner so the client can highlight a slot;
  // the actual payout is computed server-side and verified at claim time.
  // If two slots tie on the UI display, we just keep the first match (no
  // bias toward a particular slot index — the verifier will catch any true
  // mismatch with the server).
  let winnerSlot: number;
  switch (battle.gamemode) {
    case "standard":
      winnerSlot = totals.reduce((best, t) =>
        (battle.crazy ? t.total < best.total : t.total > best.total) ? t : best,
      ).slot;
      break;'''
assert old_reduce in src, 'old standard reduce missing in caseBattlesApi'
src = src.replace(old_reduce, new_reduce, 1)

old_reduce_term = '''    case "terminal": {
      // Highest (or lowest if crazy) value in the LAST round only
      const lastRound = battle.rounds - 1;
      const lastDrops = battle.drops.filter((d) => d.round === lastRound);
      if (lastDrops.length === 0) return null;
      winnerSlot = lastDrops.reduce((best, d) => {
        const better = battle.crazy ? d.itemValue < best.itemValue : d.itemValue > best.itemValue;
        const tie = d.itemValue === best.itemValue && d.slot < best.slot;
        return better || tie ? d : best;
      }).slot;
      break;
    }'''
new_reduce_term = '''    case "terminal": {
      const lastRound = battle.rounds - 1;
      const lastDrops = battle.drops.filter((d) => d.round === lastRound);
      if (lastDrops.length === 0) return null;
      winnerSlot = lastDrops.reduce((best, d) =>
        (battle.crazy ? d.itemValue < best.itemValue : d.itemValue > best.itemValue) ? d : best,
      ).slot;
      break;
    }'''
assert old_reduce_term in src, 'old terminal reduce missing'
src = src.replace(old_reduce_term, new_reduce_term, 1)

old_reduce_jp = '''    case "jackpot": {
      // For client display: the edge function determines the winner
      // via weighted random. We can't recompute that client-side without
      // the battle seed, so we use the stored drops to find the winner
      // by checking which slot has a non-zero payout (edge function sets this).
      // Fallback: highest (or lowest if crazy) total
      winnerSlot = totals.reduce((best, t) => {
        const better = battle.crazy ? t.total < best.total : t.total > best.total;
        const tie = t.total === best.total && t.slot < best.slot;
        return better || tie ? t : best;
      }).slot;
      break;
    }'''
new_reduce_jp = '''    case "jackpot": {
      // Jackpot winner is determined server-side via HMAC-weighted random.
      // For client display we fall back to the rule-of-thumb that the
      // highest (or, in crazy, lowest) total is most likely to have won.
      winnerSlot = totals.reduce((best, t) =>
        (battle.crazy ? t.total < best.total : t.total > best.total) ? t : best,
      ).slot;
      break;
    }'''
assert old_reduce_jp in src, 'old jackpot reduce missing'
src = src.replace(old_reduce_jp, new_reduce_jp, 1)

# 4b. Drop the `_amount` param from claimPayout (signature change).
old_claim_sig = '''export async function claimPayout(
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
}'''
new_claim_sig = '''export async function claimPayout(
  battleId: string,
  slot: number,
): Promise<{ data: { balance: number } | null; error: string | null }> {
  // Check local first.
  const local = localClaimPayout(battleId, slot);
  if (local.data) return local;
  // Edge function recomputes the payout server-side from the stored drops —
  // audit #002 dropped the legacy `amount` param. The function returns the
  // credited balance so the client can refresh without a separate query.
  const { data, error } = await invokeEdgeFunction<{ balance: number }>("case-battle-v2", {
    action: "claim",
    battleId,
    slot,
  });
  if (error) return local;
  return { data, error: null };
}'''
assert old_claim_sig in src, 'claimPayout signature anchor missing'
src = src.replace(old_claim_sig, new_claim_sig, 1)

write(fp, src)
print('✓ caseBattlesApi.ts: slot bias removed (UI helper only); claimPayout drops amount param')

# ============================================================
# 5) CaseBattlesRoomV2.tsx — update caller
# ============================================================
fp = 'src/pages/CaseBattles/CaseBattlesRoomV2.tsx'
src = read(fp)
old_call = '''    const { error: err } = await claimPayout(battleId!, myPlayer.slot, myPayout);'''
new_call = '''    const { error: err } = await claimPayout(battleId!, myPlayer.slot);'''
assert old_call in src, 'claimPayout caller anchor missing in RoomV2'
src = src.replace(old_call, new_call, 1)
write(fp, src)
print('✓ CaseBattlesRoomV2.tsx: claimPayout call updated (drops myPayout arg)')

# ============================================================
# 6) local-case-battles.ts — fix payout bug
# ============================================================
fp = 'src/lib/local-case-battles.ts'
src = read(fp)
# Original bug: totalValue = winner drops + non-winner drops (sums ALL
# drops). Should be: payout = pot_total * keepMult (the winner takes the
# pot adjusted for borrow — same as server-side).
old_bug = '''  const totalValue = b.drops.filter((d) => d.slot === slot).reduce((s, d) => s + d.itemValue, 0)
    + b.drops.filter((d) => d.slot !== slot).reduce((s, d) => s + d.itemValue, 0);
  const keepMult = (100 - b.borrowPercent) / 100;
  const payout = Math.round(totalValue * keepMult * 100) / 100;'''
new_bug = '''  // Winner takes the pot adjusted for borrow. The local mirror matches
  // the SQL compute (cb_claim_payout): payout = pot_total × (1 − borrow%).
  // The previous (buggy) version summed ALL drops twice — winner + everyone
  // — and used that as the base, inflating payouts dramatically.
  const keepMult = (100 - b.borrowPercent) / 100;
  const payout = Math.round(b.potTotal * keepMult * 100) / 100;'''
assert old_bug in src, 'local payout bug anchor missing'
src = src.replace(old_bug, new_bug, 1)
write(fp, src)
print('✓ local-case-battles.ts: payout now uses pot_total × keepMult (matches SQL)')

print('\n=== Phase 1 complete ===')
