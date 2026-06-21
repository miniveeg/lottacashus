/** European roulette (37 pockets). Shared with src/lib/games/roulette. */

import { retainRouletteWin } from "./rtp.ts";
import { rtpBiasFloat } from "./rtpBias.ts";
import { GAME_RTP } from "./rtp.ts";

export type RouletteBetType = "red" | "black" | "green";
export type RouletteColor = "red" | "black" | "green";

export const ROULETTE_POCKET_COUNT = 37;
export const ROULETTE_RED_BLACK_PAYOUT = 2;
export const ROULETTE_GREEN_PAYOUT = 36;

/** Standard European red pockets. */
export const ROULETTE_RED_POCKETS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

function bytesToFloat(bytes: Uint8Array, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return new Uint8Array(sig);
}

export function pocketColor(pocket: number): RouletteColor {
  if (pocket === 0) return "green";
  return ROULETTE_RED_POCKETS.has(pocket) ? "red" : "black";
}

export async function roulettePocketFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const msg = `${clientSeed}:${nonce}:0`;
  const hash = await hmacSha256(serverSeed, msg);
  const float = bytesToFloat(hash, 0);
  return Math.floor(float * ROULETTE_POCKET_COUNT);
}

function losingPocketForBet(betType: RouletteBetType, biasFloat: number): number {
  if (betType === "green") {
    return 1 + Math.floor(biasFloat * 36);
  }
  const nonGreen = Array.from({ length: 36 }, (_, i) => i + 1).filter((p) => {
    const color = ROULETTE_RED_POCKETS.has(p) ? "red" : "black";
    return color !== betType;
  });
  return nonGreen[Math.floor(biasFloat * nonGreen.length)] ?? 1;
}

/** Fair pocket + RTP bias; payouts stay 2× / 36×. */
export async function resolveRouletteRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  betType: RouletteBetType
): Promise<{ resultPocket: number; resultColor: RouletteColor; won: boolean }> {
  const fairPocket = await roulettePocketFromSeeds(serverSeed, clientSeed, nonce);
  const fairColor = pocketColor(fairPocket);
  const fairWin = betType === fairColor;
  if (!fairWin) {
    return { resultPocket: fairPocket, resultColor: fairColor, won: false };
  }
  const bias = await rtpBiasFloat(serverSeed, clientSeed, nonce, "roulette");
  if (retainRouletteWin(bias)) {
    return { resultPocket: fairPocket, resultColor: fairColor, won: true };
  }
  const pocket = losingPocketForBet(betType, bias);
  const color = pocketColor(pocket);
  return { resultPocket: pocket, resultColor: color, won: false };
}

/** Win chance at 94.5% RTP with standard payouts. */
export function rouletteWinChance(betType: RouletteBetType): number {
  if (betType === "green") return GAME_RTP / ROULETTE_GREEN_PAYOUT;
  return GAME_RTP / ROULETTE_RED_BLACK_PAYOUT;
}

export function rouletteWins(betType: RouletteBetType, resultColor: RouletteColor): boolean {
  return betType === resultColor;
}

export function roulettePayoutMultiplier(betType: RouletteBetType, won: boolean): number {
  if (!won) return 0;
  return betType === "green" ? ROULETTE_GREEN_PAYOUT : ROULETTE_RED_BLACK_PAYOUT;
}

export function validateRouletteBet(
  wager: number,
  betType: string
): string | null {
  if (!Number.isFinite(wager) || wager < 1) {
    return "Minimum bet is 1 SC or GC.";
  }
  if (wager > 100_000) {
    return "Maximum bet is $100,000.";
  }
  if (betType !== "red" && betType !== "black" && betType !== "green") {
    return "Bet on red, black, or green.";
  }
  return null;
}
