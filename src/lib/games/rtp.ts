/** Target return-to-player for all house games (96.5%).
 *  The player loses 3.5% of every wager on average over time — the edge is
 *  baked into the outcome distribution, not deducted from payouts. */
export const GAME_RTP = 0.965;

/** Stake-style originals calibrated near 99% RTP at default payouts. */
export const STAKE_STYLE_BASE_RTP = 0.99;

/** Keep a fair winning outcome with this probability (99% → 96.5% games). */
export const STAKE_STYLE_WIN_RETENTION = GAME_RTP / STAKE_STYLE_BASE_RTP;

/** European red/black RTP at 2× payout (36/37). */
export const ROULETTE_FAIR_RTP = 36 / 37;

/** Keep a fair roulette win with this probability. */
export const ROULETTE_WIN_RETENTION = GAME_RTP / ROULETTE_FAIR_RTP;

/** Case catalog EV/price calibrated near 90%. */
export const CASE_CATALOG_BASE_RTP = 0.9;

/** Target RTP for case battles (86.5% — product requirement). */
export const CASE_BATTLES_RTP = 0.865;

/** Roll bias exponent: below 1 favors better items, above 1 favors worse. */
export const CASE_ROLL_BIAS_EXPONENT = CASE_CATALOG_BASE_RTP / CASE_BATTLES_RTP;

export function retainStakeStyleWin(biasFloat: number): boolean {
  return biasFloat < STAKE_STYLE_WIN_RETENTION;
}

export function retainRouletteWin(biasFloat: number): boolean {
  return biasFloat < ROULETTE_WIN_RETENTION;
}

export function biasCaseRollFloat(float01: number): number {
  return 1 - Math.pow(1 - float01, CASE_ROLL_BIAS_EXPONENT);
}
