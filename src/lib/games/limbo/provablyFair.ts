import { LIMBO_RTP } from "./constants";
import { retainStakeStyleWin } from "../rtp";
import { rtpBiasFloat } from "../rtpBias";

const TWO_POW_24 = 16777216;
const LIMBO_RESULT_EDGE = 0.01;

/** Stake byte conversion (same as Keno). */
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

/** Truncate to 2 decimal places (Stake does not round up). */
export function truncateLimboMultiplier(value: number): number {
  return Math.trunc(value * 100) / 100;
}

/**
 * Stake Limbo: HMAC(serverSeed, `${clientSeed}:${nonce}:0`), first 4 bytes → float,
 * result = 2^24 / (float×2^24 + 1) × 0.99
 */
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

/** Resolve round: original payouts, RTP via win odds. */
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

/** Win chance at target RTP (payout unchanged). */
export function limboWinChance(target: number): number {
  if (target < 1) return 0;
  return LIMBO_RTP / target;
}
