/** Target return-to-player for all house games (94.5%). */
export const GAME_RTP = 0.945;

export const STAKE_STYLE_BASE_RTP = 0.99;

export const STAKE_STYLE_WIN_RETENTION = GAME_RTP / STAKE_STYLE_BASE_RTP;

export const ROULETTE_FAIR_RTP = 36 / 37;

export const ROULETTE_WIN_RETENTION = GAME_RTP / ROULETTE_FAIR_RTP;

export const CASE_CATALOG_BASE_RTP = 0.9;

export const CASE_BATTLES_RTP = 0.845;

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
