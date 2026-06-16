import type { CaseItem, LootCase } from "./cases";
import { biasCaseRollFloat } from "../rtp";

export function bytesToFloat(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) value += bytes[offset + i]! / Math.pow(256, i + 1);
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

export async function caseBattleFloat(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  round: number,
  slot: number,
  eosBlockId = ""
): Promise<number> {
  const hash = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${round}:${slot}:${eosBlockId}`);
  return bytesToFloat(hash, 0);
}

export function pickWeightedItem(lootCase: LootCase, float01: number): CaseItem {
  const total = lootCase.items.reduce((s, i) => s + i.weight, 0);
  let cursor = float01 * total;
  for (const item of lootCase.items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return lootCase.items[lootCase.items.length - 1]!;
}

export async function rollCaseItem(params: {
  lootCase: LootCase;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  round: number;
  slot: number;
  eosBlockId?: string;
}): Promise<CaseItem> {
  const f = await caseBattleFloat(
    params.serverSeed,
    params.clientSeed,
    params.nonce,
    params.round,
    params.slot,
    params.eosBlockId ?? ""
  );
  return pickWeightedItem(params.lootCase, biasCaseRollFloat(f));
}

export function generateBattleSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSeed(seed: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(seed));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function deriveBattleSeedFromEos(
  internalSeed: string,
  eosBlockId: string
): Promise<string> {
  return hashSeed(`${internalSeed}:${eosBlockId}`);
}
