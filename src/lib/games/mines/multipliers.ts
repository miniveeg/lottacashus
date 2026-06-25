export const MINES_GRID_SIZE = 25;
export const MINES_MIN_COUNT = 1;
export const MINES_MAX_COUNT = 24;
/** RTP factor baked into the fair combinatorial multiplier (96.5% target).
 *  Matches local-play (`binomial(25,g)/binomial(25-m,g) * GAME_RTP`) and the
 *  server SQL (`mines_reveal_tile`). No separate win-odds bias roll needed. */
export const MINES_HOUSE_EDGE = 0.965;

function comb(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  r = Math.min(r, n - r);
  let result = 1;
  for (let i = 0; i < r; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Stake Mines cashout multiplier after revealing `gemsRevealed` gems
 * with `mineCount` mines on a 25-tile board.
 * Multiplier = RTP × C(25, d) / C(25 − m, d)
 */
export function getMinesMultiplier(mineCount: number, gemsRevealed: number): number {
  if (gemsRevealed <= 0) return 1;
  const safe = MINES_GRID_SIZE - mineCount;
  if (gemsRevealed > safe) return 0;
  const mult = (MINES_HOUSE_EDGE * comb(MINES_GRID_SIZE, gemsRevealed)) / comb(safe, gemsRevealed);
  return Math.floor(mult * 100) / 100;
}

export function getMaxGems(mineCount: number): number {
  return MINES_GRID_SIZE - mineCount;
}

export function getNextMultiplier(mineCount: number, currentGems: number): number {
  return getMinesMultiplier(mineCount, currentGems + 1);
}
