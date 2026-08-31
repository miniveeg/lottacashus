const CLIENT_SEED_KEY = "lc_client_seed";
const NONCE_KEY = "lc_nonce";

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return toHex(sig);
}

/**
 * HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) mapped to [0, 1).
 * Uses the first 13 hex chars (52 bits) / 2^52 — same family as classic
 * "provably fair" casino floats.
 */
export async function resultFloat(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Promise<number> {
  const hex = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  const slice = hex.slice(0, 13);
  const int = parseInt(slice, 16);
  return int / (2 ** 52);
}

export async function pickUniqueIndices(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
  max: number,
): Promise<number[]> {
  const pool = Array.from({ length: max }, (_, i) => i);
  const picked: number[] = [];
  let n = nonce;
  for (let i = 0; i < count && pool.length > 0; i++) {
    const f = await resultFloat(serverSeed, clientSeed, n++);
    const idx = Math.min(pool.length - 1, Math.floor(f * pool.length));
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

export function getClientSeed(): string {
  const existing = localStorage.getItem(CLIENT_SEED_KEY);
  if (existing && existing.length >= 8) return existing;
  const next = randomHex(16);
  localStorage.setItem(CLIENT_SEED_KEY, next);
  return next;
}

export function setClientSeed(seed: string): void {
  const cleaned = seed.trim() || randomHex(16);
  localStorage.setItem(CLIENT_SEED_KEY, cleaned);
}

export function getNonce(): number {
  const raw = localStorage.getItem(NONCE_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function bumpNonce(by = 1): number {
  const next = getNonce() + by;
  localStorage.setItem(NONCE_KEY, String(next));
  return next;
}

export type FairCommit = {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
};

export async function commitRound(): Promise<FairCommit> {
  const serverSeed = randomHex(32);
  const serverSeedHash = await sha256Hex(serverSeed);
  return {
    serverSeed,
    serverSeedHash,
    clientSeed: getClientSeed(),
    nonce: getNonce(),
  };
}
