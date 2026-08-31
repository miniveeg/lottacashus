/** Stake Mines logic (shared with src/lib/games/mines). */

export const MINES_GRID_SIZE = 25;
export const MINES_MIN_COUNT = 1;
export const MINES_MAX_COUNT = 24;
/** RTP factor baked into the multiplier (96.5% target). Matches the
 *  `mines_reveal_tile` SQL function and src/lib/games/mines/multipliers.ts.
 *  No separate win-odds bias roll is applied. */
const MINES_HOUSE_EDGE = 0.965;
const MINES_FLOAT_COUNT = 24;

function comb(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  r = Math.min(r, n - r);
  let result = 1;
  for (let i = 0; i < r; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

export function getMinesMultiplier(mineCount: number, gemsRevealed: number): number {
  if (gemsRevealed <= 0) return 1;
  const safe = MINES_GRID_SIZE - mineCount;
  if (gemsRevealed > safe) return 0;
  const mult = (MINES_HOUSE_EDGE * comb(MINES_GRID_SIZE, gemsRevealed)) / comb(safe, gemsRevealed);
  return Math.floor(mult * 100) / 100;
}

export function getMaxGems(mineCount: number): number {
  return MINES_GRID_SIZE - mineCount;
}

export function getNextMultiplier(mineCount: number, currentGems: number): number {
  return getMinesMultiplier(mineCount, currentGems + 1);
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

export async function minesFloatsFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const parts: Uint8Array[] = [];
  const cursorsNeeded = Math.ceil((MINES_FLOAT_COUNT * 4) / 32);
  for (let cursor = 0; cursor < cursorsNeeded; cursor++) {
    parts.push(await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${cursor}`));
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

export function validateMinesStart(mineCount: number, wager: number): string | null {
  if (!Number.isInteger(mineCount) || mineCount < MINES_MIN_COUNT || mineCount > MINES_MAX_COUNT) {
    return "Select 1 to 24 mines.";
  }
  if (!Number.isFinite(wager) || wager < 0.01) {
    return "Minimum bet is 0.01 SC.";
  }
  return null;
}

export function validateMinesTile(tile: number): string | null {
  if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_GRID_SIZE) {
    return "Invalid tile.";
  }
  return null;
}
