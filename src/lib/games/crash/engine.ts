import { CRASH_HOUSE_EDGE, TWO_POW_24 } from "./constants";

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

export function truncateCrashMultiplier(value: number): number {
  return Math.trunc(value * 100) / 100;
}

/**
 * Generate crash point from seeds using provably fair algorithm.
 * Formula: crashPoint = Math.max(1, (2^24 / (float * 2^24 + 1)) * (1 - houseEdge))
 */
export async function crashPointFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const msg = `${clientSeed}:${nonce}:0`;
  const hash = await hmacSha256(serverSeed, msg);
  const float = bytesToFloat(hash, 0);
  const scaled = float * TWO_POW_24;
  const raw = (TWO_POW_24 / (scaled + 1)) * (1 - CRASH_HOUSE_EDGE);
  return truncateCrashMultiplier(Math.max(1, raw));
}

export function calculateCrashPayout(wager: number, crashMultiplier: number): number {
  return Math.round(wager * crashMultiplier * 100) / 100;
}

export function cashOutPayout(wager: number, cashedAtMultiplier: number): number {
  return Math.round(wager * cashedAtMultiplier * 100) / 100;
}

export type CrashRoundState = {
  crashPoint: number;
  won: boolean;
  payout: number;
  cashedAt: number | null;
  nonce: number;
};

export type CrashGamePhase = "idle" | "betting" | "running" | "crashed" | "cashed_out";
