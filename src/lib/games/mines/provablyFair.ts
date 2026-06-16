import { MINES_GRID_SIZE } from "./multipliers";

const MINES_FLOAT_COUNT = 24;

export { bytesToFloat, extractFloats, hashServerSeed } from "../keno/provablyFair";

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

/**
 * Stake Mines: 24 floats from HMAC cursors (96 bytes), Fisher-Yates mine placement.
 * Returns sorted mine tile indices 0–24 (left→right, top→bottom).
 */
export async function minesFloatsFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const parts: Uint8Array[] = [];
  const cursorsNeeded = Math.ceil((MINES_FLOAT_COUNT * 4) / 32);
  for (let cursor = 0; cursor < cursorsNeeded; cursor++) {
    const msg = `${clientSeed}:${nonce}:${cursor}`;
    parts.push(await hmacSha256(serverSeed, msg));
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }
  const floats: number[] = [];
  for (let i = 0; i < MINES_FLOAT_COUNT; i++) {
    let value = 0;
    for (let j = 0; j < 4; j++) {
      value += merged[i * 4 + j]! / Math.pow(256, j + 1);
    }
    floats.push(value);
  }
  return floats;
}

export function placeMinesFromFloats(floats: number[], mineCount: number): number[] {
  const pool = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
  const mines: number[] = [];

  for (let i = 0; i < mineCount && i < floats.length; i++) {
    const remaining = MINES_GRID_SIZE - i;
    const index = Math.floor(floats[i]! * remaining);
    const pickIndex = i + index;
    const value = pool[pickIndex]!;
    mines.push(value);
    for (let o = pickIndex; o > i; o--) {
      pool[o] = pool[o - 1]!;
    }
    pool[i] = value;
  }

  return mines.sort((a, b) => a - b);
}

export async function generateMinesBoard(params: {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  mineCount: number;
}): Promise<number[]> {
  const floats = await minesFloatsFromSeeds(
    params.serverSeed,
    params.clientSeed,
    params.nonce
  );
  return placeMinesFromFloats(floats, params.mineCount);
}
