/** Stake Limbo logic (shared with src/lib/games/limbo). */

import { retainStakeStyleWin } from "./rtp.ts";
import { rtpBiasFloat } from "./rtpBias.ts";
import { GAME_RTP } from "./rtp.ts";

export const LIMBO_MIN_TARGET = 1.01;
export const LIMBO_MAX_TARGET = 1_000_000;
const LIMBO_RESULT_EDGE = 0.01;
const TWO_POW_24 = 16777216;

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

export function truncateLimboMultiplier(value: number): number {
  return Math.trunc(value * 100) / 100;
}

export async function limboResultFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const msg = `${clientSeed}:${nonce}:0`;
  const hash = await hmacSha256(serverSeed, msg);
  const float = bytesToFloat(hash, 0);
  const scaled = float * TWO_POW_24;
  const raw = (TWO_POW_24 / (scaled + 1)) * (1 - LIMBO_RESULT_EDGE);
  return truncateLimboMultiplier(Math.max(1, raw));
}

function limboLossResult(target: number, biasFloat: number): number {
  const cap = Math.max(target - 0.01, 1.01);
  const raw = 1 + (cap - 1) * biasFloat;
  return truncateLimboMultiplier(Math.min(raw, cap));
}

export async function resolveLimboRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  target: number
): Promise<{ resultMultiplier: number; won: boolean }> {
  const fairResult = await limboResultFromSeeds(serverSeed, clientSeed, nonce);
  const wouldWin = fairResult >= target;
  if (!wouldWin) {
    return { resultMultiplier: fairResult, won: false };
  }
  const bias = await rtpBiasFloat(serverSeed, clientSeed, nonce, "limbo");
  if (retainStakeStyleWin(bias)) {
    return { resultMultiplier: fairResult, won: true };
  }
  return { resultMultiplier: limboLossResult(target, bias), won: false };
}

export function limboWins(target: number, result: number): boolean {
  return result >= target;
}

export function limboWinChance(target: number): number {
  if (target < 1) return 0;
  return GAME_RTP / target;
}

export function validateLimboBet(wager: number, target: number): string | null {
  if (!Number.isFinite(wager) || wager < 0.01) {
    return "Minimum bet is 0.01 SC.";
  }
  if (!Number.isFinite(target) || target < LIMBO_MIN_TARGET) {
    return `Minimum target is ${LIMBO_MIN_TARGET}×.`;
  }
  if (target > LIMBO_MAX_TARGET) {
    return `Maximum target is ${LIMBO_MAX_TARGET.toLocaleString()}×.`;
  }
  return null;
}
