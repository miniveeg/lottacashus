/** Stake Keno logic (shared with src/lib/games/keno). */

import { retainStakeStyleWin } from "./rtp.ts";
import { rtpBiasFloat } from "./rtpBias.ts";

export type KenoRisk = "classic" | "low" | "medium" | "high";

const KENO_PAYOUTS: Record<KenoRisk, Record<number, number[]>> = {
  classic: {
    1: [0, 3.96],
    2: [0, 1.9, 4.5],
    3: [0, 1, 3.1, 10.4],
    4: [0, 0.8, 1.8, 5, 22.5],
    5: [0, 0.25, 1.4, 4.1, 16.5, 36],
    6: [0, 0, 1, 3.68, 7, 16.5, 40],
    7: [0, 0, 0.47, 3, 4.5, 14, 31, 60],
    8: [0, 0, 0, 2.2, 4, 13, 22, 55, 70],
    9: [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 85],
    10: [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 100],
  },
  low: {
    1: [0.7, 1.85],
    2: [0, 2, 3.8],
    3: [0, 1.1, 1.38, 26],
    4: [0, 0, 2.2, 7.9, 90],
    5: [0, 0, 1.5, 4.2, 13, 300],
    6: [0, 0, 1.1, 2, 6.2, 100, 700],
    7: [0, 0, 1.1, 1.6, 3.5, 15, 225, 700],
    8: [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
    9: [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000],
    10: [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
  },
  medium: {
    1: [0.4, 2.75],
    2: [0, 1.8, 5.1],
    3: [0, 0, 2.8, 50],
    4: [0, 0, 1.7, 10, 100],
    5: [0, 0, 1.4, 4, 14, 390],
    6: [0, 0, 0, 3, 9, 180, 710],
    7: [0, 0, 0, 2, 7, 30, 400, 800],
    8: [0, 0, 0, 2, 4, 11, 67, 400, 900],
    9: [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000],
    10: [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000],
  },
  high: {
    1: [0, 3.96],
    2: [0, 0, 17.1],
    3: [0, 0, 0, 81.5],
    4: [0, 0, 0, 10, 259],
    5: [0, 0, 0, 4.5, 48, 450],
    6: [0, 0, 0, 0, 11, 350, 710],
    7: [0, 0, 0, 0, 7, 90, 400, 800],
    8: [0, 0, 0, 0, 5, 20, 270, 600, 900],
    9: [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000],
    10: [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000],
  },
};

export function getKenoMultiplier(
  pickCount: number,
  hits: number,
  risk: KenoRisk
): number {
  const row = KENO_PAYOUTS[risk][pickCount];
  if (!row || hits < 0 || hits >= row.length) return 0;
  return row[hits] ?? 0;
}

function bytesToFloat(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

function extractFloats(bytes: Uint8Array, count: number, startOffset = 0): number[] {
  const floats: number[] = [];
  for (let i = 0; i < count; i++) {
    floats.push(bytesToFloat(bytes, startOffset + i * 4));
  }
  return floats;
}

export function drawKenoNumbers(floats: number[]): number[] {
  const pool = Array.from({ length: 40 }, (_, i) => i);
  const drawn: number[] = [];

  for (let t = 0; t < 10 && t < floats.length; t++) {
    const remaining = 40 - t;
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

function drawKenoNumbersAvoidingPicks(floats: number[], picks: number[]): number[] {
  const pickSet = new Set(picks);
  const pool = Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => !pickSet.has(n));
  const drawn: number[] = [];

  for (let t = 0; t < 10 && t < floats.length && t < pool.length; t++) {
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

export async function kenoFloatsFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const parts: Uint8Array[] = [];
  for (let cursor = 0; cursor < 2; cursor++) {
    parts.push(await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${cursor}`));
  }
  const merged = new Uint8Array(parts[0]!.length + parts[1]!.length);
  merged.set(parts[0]!, 0);
  merged.set(parts[1]!, parts[0]!.length);
  return extractFloats(merged, 10, 0);
}

export async function playKenoRound(params: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  picks: number[];
  risk: KenoRisk;
}): Promise<{ drawn: number[]; hits: number; multiplier: number }> {
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
      const biasFloats: number[] = [];
      for (let i = 0; i < 10; i++) {
        let value = 0;
        for (let j = 0; j < 4; j++) {
          value += biasHash[i * 4 + j]! / Math.pow(256, j + 1);
        }
        biasFloats.push(value);
      }
      drawn = drawKenoNumbersAvoidingPicks(biasFloats, params.picks);
      hits = 0;
      multiplier = 0;
    }
  }

  return { drawn, hits, multiplier };
}

export function validateKenoBet(picks: number[], wager: number, risk: string): string | null {
  if (!["classic", "low", "medium", "high"].includes(risk)) {
    return "Invalid risk level";
  }
  if (picks.length < 1 || picks.length > 10) {
    return "Select 1 to 10 numbers";
  }
  const unique = new Set(picks);
  if (unique.size !== picks.length) {
    return "Duplicate numbers are not allowed";
  }
  for (const n of picks) {
    if (!Number.isInteger(n) || n < 1 || n > 40) {
      return "Numbers must be between 1 and 40";
    }
  }
  if (!Number.isFinite(wager) || wager < 1) {
    return "Minimum bet is 1 SC or GC";
  }
  return null;
}
