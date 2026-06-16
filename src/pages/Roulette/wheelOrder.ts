import { ROULETTE_RED_POCKETS, type RouletteColor } from "../../lib/games/roulette";

/** European wheel pocket order (clockwise). */
export const EUROPEAN_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20,
  14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const WHEEL_SEGMENT_DEG = 360 / EUROPEAN_WHEEL_ORDER.length;

export function pocketColorForWheel(pocket: number): RouletteColor {
  if (pocket === 0) return "green";
  return ROULETTE_RED_POCKETS.has(pocket) ? "red" : "black";
}

/** Degrees to rotate wheel so `pocket` sits at the top marker (ball). */
export function rotationForPocket(pocket: number, extraFullTurns = 4): number {
  const index = EUROPEAN_WHEEL_ORDER.indexOf(pocket as (typeof EUROPEAN_WHEEL_ORDER)[number]);
  const idx = index >= 0 ? index : 0;
  const segmentCenter = idx * WHEEL_SEGMENT_DEG + WHEEL_SEGMENT_DEG / 2;
  return extraFullTurns * 360 + (360 - segmentCenter);
}
