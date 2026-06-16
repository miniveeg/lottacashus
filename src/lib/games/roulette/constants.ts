export const ROULETTE_POCKET_COUNT = 37;
export const ROULETTE_RED_BLACK_PAYOUT = 2;
export const ROULETTE_GREEN_PAYOUT = 36;

export const ROULETTE_RED_POCKETS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type RouletteBetType = "red" | "black" | "green";
export type RouletteColor = "red" | "black" | "green";
