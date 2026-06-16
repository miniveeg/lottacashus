export {
  ROULETTE_POCKET_COUNT,
  ROULETTE_RED_BLACK_PAYOUT,
  ROULETTE_GREEN_PAYOUT,
  ROULETTE_RED_POCKETS,
  type RouletteBetType,
  type RouletteColor,
} from "./constants";
export { pocketColor, roulettePocketFromSeeds, resolveRouletteRound } from "./provablyFair";

import { GAME_RTP } from "../rtp";
import {
  ROULETTE_GREEN_PAYOUT,
  ROULETTE_RED_BLACK_PAYOUT,
  type RouletteBetType,
  type RouletteColor,
} from "./constants";

export function rouletteWins(betType: RouletteBetType, resultColor: RouletteColor): boolean {
  return betType === resultColor;
}

export function roulettePayoutMultiplier(betType: RouletteBetType): number {
  return betType === "green" ? ROULETTE_GREEN_PAYOUT : ROULETTE_RED_BLACK_PAYOUT;
}

/** Win chance at target RTP (standard 2× / 36× payouts). */
export function rouletteWinChance(betType: RouletteBetType): number {
  if (betType === "green") return GAME_RTP / ROULETTE_GREEN_PAYOUT;
  return GAME_RTP / ROULETTE_RED_BLACK_PAYOUT;
}

export function roulettePotentialWin(wager: number, betType: RouletteBetType): number {
  return Math.round(wager * roulettePayoutMultiplier(betType) * 100) / 100;
}
