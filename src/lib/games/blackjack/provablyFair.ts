import type { CardIndex } from "./cards";

const SHOE_SIZE = 52;

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

function bytesToFloat(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value += bytes[offset + i]! / Math.pow(256, i + 1);
  }
  return value;
}

/** Enough floats for Fisher-Yates shuffle (51 swaps). */
export async function blackjackFloatsFromSeeds(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const needed = SHOE_SIZE;
  const floats: number[] = [];
  let cursor = 0;
  while (floats.length < needed) {
    const hash = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
    for (let i = 0; i + 4 <= hash.length && floats.length < needed; i += 4) {
      floats.push(bytesToFloat(hash, i));
    }
    cursor++;
  }
  return floats;
}

/** Stake Blackjack: Fisher-Yates on 52 indices using PF floats. */
export function shuffleShoe(floats: number[]): CardIndex[] {
  const pool = Array.from({ length: SHOE_SIZE }, (_, i) => i);
  for (let i = 0; i < SHOE_SIZE - 1; i++) {
    const remaining = SHOE_SIZE - i;
    const idx = Math.floor(floats[i]! * remaining);
    const pick = i + idx;
    const tmp = pool[i]!;
    pool[i] = pool[pick]!;
    pool[pick] = tmp;
  }
  return pool;
}

export async function buildShuffledShoe(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<CardIndex[]> {
  const floats = await blackjackFloatsFromSeeds(serverSeed, clientSeed, nonce);
  return shuffleShoe(floats);
}

export function drawFromShoe(shoe: CardIndex[], index: number): { card: CardIndex; nextIndex: number } {
  return { card: shoe[index]!, nextIndex: index + 1 };
}
