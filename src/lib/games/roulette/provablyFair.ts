import {
  ROULETTE_POCKET_COUNT,
  ROULETTE_RED_POCKETS,
  type RouletteBetType,
  type RouletteColor,
} from "./constants";
import { retainRouletteWin } from "../rtp";
import { rtpBiasFloat } from "../rtpBias";

function bytesToFloat(bytes: Uint8Array, offset = 0): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
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

export async function resolveRouletteRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  betType: RouletteBetType
): Promise<{ resultPocket: number; resultColor: RouletteColor; won: boolean }> {
  const fairPocket = await roulettePocketFromSeeds(serverSeed, clientSeed, nonce);
  const fairColor = pocketColor(fairPocket);
  if (betType !== fairColor) {
    return { resultPocket: fairPocket, resultColor: fairColor, won: false };
  }
  const bias = await rtpBiasFloat(serverSeed, clientSeed, nonce, "roulette");
  if (retainRouletteWin(bias)) {
    return { resultPocket: fairPocket, resultColor: fairColor, won: true };
  }
  const pocket = losingPocketForBet(betType, bias);
  return { resultPocket: pocket, resultColor: pocketColor(pocket), won: false };
}
