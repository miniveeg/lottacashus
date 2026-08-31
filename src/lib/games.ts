/** Classic mines: each gem multiplies by 0.99 * remainingTiles / remainingSafe. */
export function minesMultiplier(totalTiles: number, mines: number, revealedSafe: number): number {
  let multi = 1;
  for (let i = 0; i < revealedSafe; i++) {
    const tilesLeft = totalTiles - i;
    const safeLeft = totalTiles - mines - i;
    if (safeLeft <= 0 || tilesLeft <= 0) break;
    multi *= tilesLeft / safeLeft;
  }
  if (revealedSafe <= 0) return 1;
  return multi * 0.99;
}

/** Tower: 0.99 * (tiles / (tiles - bombs)) cumulative per climbed floor. */
export function towerMultiplier(tilesPerFloor: number, bombs: number, floorsCleared: number): number {
  const per = tilesPerFloor / (tilesPerFloor - bombs);
  if (floorsCleared <= 0) return 1;
  return 0.99 * Math.pow(per, floorsCleared);
}

export const ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
] as const;

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type WheelColor = "red" | "black" | "green";

export function wheelColor(n: number): WheelColor {
  if (n === 0) return "green";
  return REDS.has(n) ? "red" : "black";
}

export type RouletteBetKind = "number" | "red" | "black" | "odd" | "even" | "high" | "low" | "dozen";

export type RouletteBet = {
  kind: RouletteBetKind;
  amount: number;
  number?: number;
  dozen?: 1 | 2 | 3;
};

/**
 * European payouts as TOTAL return including stake.
 * Straight 35:1 → 36x, even-money 1:1 → 2x, dozen 2:1 → 3x.
 * House edge 1/37 ≈ 2.70% on even-money; same wheel for all bets.
 */
export function roulettePayout(bet: RouletteBet, pocket: number): number {
  const { kind, amount } = bet;
  switch (kind) {
    case "number":
      return bet.number === pocket ? amount * 36 : 0;
    case "red":
      return wheelColor(pocket) === "red" ? amount * 2 : 0;
    case "black":
      return wheelColor(pocket) === "black" ? amount * 2 : 0;
    case "odd":
      return pocket !== 0 && pocket % 2 === 1 ? amount * 2 : 0;
    case "even":
      return pocket !== 0 && pocket % 2 === 0 ? amount * 2 : 0;
    case "high":
      return pocket >= 19 && pocket <= 36 ? amount * 2 : 0;
    case "low":
      return pocket >= 1 && pocket <= 18 ? amount * 2 : 0;
    case "dozen": {
      const d = bet.dozen ?? 1;
      const min = (d - 1) * 12 + 1;
      const max = d * 12;
      return pocket >= min && pocket <= max ? amount * 3 : 0;
    }
  }
}

/** Limbo: result = max(1.00, 0.99 / float), house ~1%. Payout is bet * target, not result. */
export function limboResult(float01: number): number {
  const f = Math.min(0.999999999, Math.max(1e-12, float01));
  return Math.max(1, 0.99 / f);
}

/** Upgrader: win chance = 0.97 / multiplier (3% edge). */
export function upgraderChance(multiplier: number): number {
  return 0.97 / multiplier;
}
