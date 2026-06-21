import { BATTLE_RAKE, isTeamMode, payoutKeepMultiplier } from "../../lib/games/case-battles";
import type { CaseBattleView } from "../../lib/caseBattles";

export function battleTotalUnboxed(battle: CaseBattleView): number {
  return Math.round(battle.players.reduce((s, p) => s + p.totalValue, 0) * 100) / 100;
}

/** Sum unboxed value only for rounds the client has revealed so far. */
export function battleRevealedUnboxed(battle: CaseBattleView, revealedRounds: number): number {
  const total = battle.players.reduce((sum, p) => {
    const partial = p.drops.slice(0, revealedRounds).reduce((s, d) => s + d.value, 0);
    return sum + partial;
  }, 0);
  return Math.round(total * 100) / 100;
}

export function payoutPoolFromEntryPot(potTotal: number): number {
  return Math.round(potTotal * (1 - BATTLE_RAKE) * 100) / 100;
}

/** Gross share per winning slot (total unboxed split evenly). */
export function teamWinnerEqualShare(
  lines: PlayerResultLine[],
  battle: CaseBattleView
): number {
  const winners = lines.filter((l) => l.isWinner);
  if (winners.length === 0) return 0;
  const pool = battleTotalUnboxed(battle);
  return Math.round((pool / winners.length) * 100) / 100;
}

/** Amount shown on results cards (bots: gross share; humans: credited after borrow). */
export function displayWinAmount(
  line: PlayerResultLine,
  allLines: PlayerResultLine[],
  battle: CaseBattleView
): number {
  if (!line.isWinner) return 0;
  const grossShare = teamWinnerEqualShare(allLines, battle);
  if (line.isBot) return grossShare;
  if (line.payout > 0) return line.payout;
  return grossShare;
}

/** Gross slot share from total unboxed (for UI notes on team wins). */
export function winnerSlotShare(
  lines: PlayerResultLine[],
  battle: CaseBattleView
): number {
  return teamWinnerEqualShare(lines, battle);
}

/** Actual balance credit when borrow reduces winnings below team share. */
export function creditedWinAmount(line: PlayerResultLine): number | null {
  if (line.payout <= 0) return null;
  return line.payout;
}

export type PlayerResultLine = {
  slot: number;
  displayName: string;
  isBot: boolean;
  isYou: boolean;
  payout: number;
  borrowPercent: number;
  entryPaid?: number;
  jackpotPct?: number;
  isWinner: boolean;
  unboxedTotal: number;
};

type ResultPayload = {
  winnerPayouts?: { userId: string; amount: number }[];
  jackpotWeights?: { slot: number; weight: number }[];
  jackpotReelSlot?: number;
  winningSlots?: number[];
};

export function buildPlayerResultLines(
  battle: CaseBattleView,
  userId: string | undefined
): PlayerResultLine[] {
  const results = battle.results as ResultPayload | null;
  const payouts = results?.winnerPayouts ?? [];
  const weights = results?.jackpotWeights ?? [];
  const totalJackpotW = weights.reduce((s, w) => s + w.weight, 0);
  const isJackpot = battle.gamemode === "jackpot";
  const isGroup = battle.gamemode === "group";

  const winningSlots =
    battle.winningSlots.length > 0
      ? battle.winningSlots
      : (results?.winningSlots ?? (battle.winnerSlot != null ? [battle.winnerSlot] : []));

  // Pre-compute jackpot percentages using the largest remainder method so
  // they sum to exactly 100.0% (avoids 100.1% or 99.9% from naive rounding).
  const sortedPlayers = [...battle.players].sort((a, b) => a.slot - b.slot);
  const jackpotPctBySlot = new Map<number, number>();
  if (isJackpot && totalJackpotW > 0) {
    const rawPcts = sortedPlayers.map((p) => {
      const w = weights.find((x) => x.slot === p.slot)?.weight ?? 0;
      return (w / totalJackpotW) * 100;
    });
    // Floor to 1 decimal place, then distribute the remainder.
    const floored = rawPcts.map((v) => Math.floor(v * 10) / 10);
    const remainder = Math.round((100 - floored.reduce((s, v) => s + v, 0)) * 10);
    // Sort indices by largest fractional remainder, add 0.1 to the top ones.
    const fracs = rawPcts.map((v, i) => ({
      i,
      frac: v * 10 - Math.floor(v * 10),
    }));
    fracs.sort((a, b) => b.frac - a.frac);
    for (let r = 0; r < remainder; r++) {
      const idx = fracs[r % fracs.length]!.i;
      floored[idx] = Math.round((floored[idx]! + 0.1) * 10) / 10;
    }
    sortedPlayers.forEach((p, i) => {
      jackpotPctBySlot.set(p.slot, floored[i]!);
    });
  }

  return sortedPlayers
    .map((player) => {
      const payout =
        player.userId != null
          ? (payouts.find((p) => p.userId === player.userId)?.amount ?? 0)
          : 0;
      const jackpotPct = jackpotPctBySlot.get(player.slot);

      // Group mode: ALL slots are winners (the pot is split equally among
      // every seat, humans AND bots). Use winningSlots (which includes all
      // slots in Group mode) rather than `payout > 0` so bots are also
      // marked as winners in the results display.
      const isWinner = isGroup
        ? winningSlots.includes(player.slot)
        : isJackpot && isTeamMode(battle.playerMode)
          ? winningSlots.includes(player.slot)
          : winningSlots.includes(player.slot);

      return {
        slot: player.slot,
        displayName: player.displayName,
        isBot: player.isBot,
        isYou: player.userId === userId,
        payout,
        borrowPercent: player.borrowPercent ?? 0,
        entryPaid: player.entryPaid,
        jackpotPct,
        isWinner,
        unboxedTotal: player.totalValue,
      };
    });
}

export function borrowWinningsNote(borrowPercent: number, payout: number): string | null {
  if (borrowPercent <= 0 || payout <= 0) return null;
  const keep = Math.round(payoutKeepMultiplier(borrowPercent) * 100);
  return `${borrowPercent}% borrow — you keep ${keep}% of winnings`;
}
