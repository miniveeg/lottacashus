import { getKenoMultiplier, type KenoRisk } from "./paytables";
import { retainStakeStyleWin } from "../rtp";
import { rtpBiasFloat } from "../rtpBias";

const DRAW_COUNT = 10;
const POOL_SIZE = 40;

/** Four bytes → float in [0, 1), Stake byte conversion. */
export function bytesToFloat(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

export function extractFloats(bytes: Uint8Array, count: number, startOffset = 0): number[] {
  const floats: number[] = [];
  for (let i = 0; i < count; i++) {
    floats.push(bytesToFloat(bytes, startOffset + i * 4));
  }
  return floats;
}

/**
 * Stake Keno draw: Fisher-Yates style selection without replacement.
 * Returns 10 unique numbers in 1–40, sorted ascending.
 */
export function drawKenoNumbers(floats: number[]): number[] {
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => i);
  const drawn: number[] = [];

  for (let t = 0; t < DRAW_COUNT && t < floats.length; t++) {
    const remaining = POOL_SIZE - t;
    const index = Math.floor(floats[t]! * remaining);
    const pickIndex = t + index;
    const value = pool[pickIndex]!;
    drawn.push(value + 1);
    for (let o = pickIndex; o > t; o--) {
      pool[o] = pool[o - 1]!;
    }
    pool[t] = value;
  }

  return drawn.sort((a, b) => a - b);
}

/** Draw 10 numbers from non-picked pool (0 hits) using bias floats. */
export function drawKenoNumbersAvoidingPicks(floats: number[], picks: number[]): number[] {
  const pickSet = new Set(picks);
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => i + 1).filter((n) => !pickSet.has(n));
  const drawn: number[] = [];

  for (let t = 0; t < DRAW_COUNT && t < floats.length && t < pool.length; t++) {
    const remaining = pool.length - t;
    const index = Math.floor(floats[t]! * remaining);
    const pickIndex = t + index;
    const value = pool[pickIndex]!;
    drawn.push(value);
    for (let o = pickIndex; o > t; o--) {
      pool[o] = pool[o - 1]!;
    }
    pool[t] = value;
  }

  return drawn.sort((a, b) => a - b);
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

/** SHA-256 hex digest of server seed (shown before reveal). */
export async function hashServerSeed(serverSeed: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(serverSeed));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stake Keno uses 2 HMAC cursor rounds (10 floats × 4 bytes = 40 bytes).
 * Concatenates cursor 0 and 1 hashes (32 + 32 bytes), uses first 40 bytes.
 */
export async function kenoFloatsFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const parts: Uint8Array[] = [];
  for (let cursor = 0; cursor < 2; cursor++) {
    const msg = `${clientSeed}:${nonce}:${cursor}`;
    parts.push(await hmacSha256(serverSeed, msg));
  }
  const total = parts[0]!.length + parts[1]!.length;
  const merged = new Uint8Array(total);
  merged.set(parts[0]!, 0);
  merged.set(parts[1]!, parts[0]!.length);
  return extractFloats(merged, DRAW_COUNT, 0);
}

export async function playKenoRound(params: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  picks: number[];
  risk: KenoRisk;
}): Promise<{
  drawn: number[];
  hits: number;
  multiplier: number;
}> {
  const floats = await kenoFloatsFromSeeds(
    params.serverSeed,
    params.clientSeed,
    params.nonce
  );
  let drawn = drawKenoNumbers(floats);
  const pickSet = new Set(params.picks);
  let hits = drawn.filter((n) => pickSet.has(n)).length;
  let multiplier = getKenoMultiplier(params.picks.length, hits, params.risk);

  if (multiplier > 0) {
    const bias = await rtpBiasFloat(
      params.serverSeed,
      params.clientSeed,
      params.nonce,
      "keno"
    );
    if (!retainStakeStyleWin(bias)) {
      const biasHash = await hmacSha256(
        params.serverSeed,
        `${params.clientSeed}:${params.nonce}:rtp:keno-draw`
      );
      const biasFloats = extractFloats(biasHash, DRAW_COUNT, 0);
      drawn = drawKenoNumbersAvoidingPicks(biasFloats, params.picks);
      hits = 0;
      multiplier = 0;
    }
  }

  return { drawn, hits, multiplier };
}

export function countHits(drawn: number[], picks: number[]): number {
  const pickSet = new Set(picks);
  return drawn.filter((n) => pickSet.has(n)).length;
}

export function generateServerSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
