import { supabase, isSupabaseConfigured } from "./supabase";

const DEMO_KEY = "lc_demo_balance";
const STARTING = 1000;
const listeners = new Set<() => void>();
let memoryBalance = STARTING;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeBalance(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isLiveWallet(): boolean {
  return isSupabaseConfigured;
}

export function getBalance(): number {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw === null) {
      try {
        localStorage.setItem(DEMO_KEY, String(memoryBalance));
      } catch {
        /* storage blocked — keep in-memory */
      }
      return memoryBalance;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      memoryBalance = n;
      return n;
    }
    return memoryBalance;
  } catch {
    return memoryBalance;
  }
}

export function setBalance(n: number): void {
  const next = Math.max(0, Math.round(n * 100) / 100);
  memoryBalance = next;
  try {
    localStorage.setItem(DEMO_KEY, String(next));
  } catch {
    /* storage blocked — keep in-memory */
  }
  notify();
}

export async function refreshLiveBalance(): Promise<number | null> {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("lc_profiles")
    .select("sc_balance")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  const bal = Number((data as { sc_balance: number | string }).sc_balance);
  if (!Number.isFinite(bal)) return null;
  setBalance(bal);
  return bal;
}

/**
 * Debit stake. Live path tries RPC `place_bet`; missing RPC falls back to demo localStorage.
 * Returns false if insufficient funds.
 */
export async function debit(
  amount: number,
  meta?: { game?: string; clientSeed?: string; nonce?: number },
): Promise<{ ok: boolean; roundId?: string; serverSeedHash?: string }> {
  if (amount <= 0) return { ok: false };
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase.rpc("place_bet", {
        p_amount: amount,
        p_game: meta?.game ?? "unknown",
        p_client_seed: meta?.clientSeed ?? "",
        p_nonce: meta?.nonce ?? 0,
      });
      if (!error && data) {
        const row = data as { ok?: boolean; round_id?: string; server_seed_hash?: string; balance?: number };
        if (row.ok === false) return { ok: false };
        if (typeof row.balance === "number") setBalance(row.balance);
        else setBalance(getBalance() - amount);
        return {
          ok: true,
          roundId: row.round_id,
          serverSeedHash: row.server_seed_hash,
        };
      }
    }
  }
  const bal = getBalance();
  if (bal + 1e-9 < amount) return { ok: false };
  setBalance(bal - amount);
  return { ok: true };
}

export async function credit(
  amount: number,
  meta?: { roundId?: string; payout?: number; result?: Json; serverSeed?: string },
): Promise<void> {
  if (amount < 0) return;
  if (supabase && meta?.roundId) {
    const { error } = await supabase.rpc("settle_bet", {
      p_round_id: meta.roundId,
      p_payout: meta.payout ?? amount,
      p_result: meta.result ?? null,
      p_server_seed: meta.serverSeed ?? "",
    });
    if (!error) {
      const live = await refreshLiveBalance();
      if (live !== null) return;
    }
  }
  setBalance(getBalance() + amount);
}

export async function demoDeposit(amount: number): Promise<void> {
  if (amount <= 0) return;
  if (supabase) {
    const { error } = await supabase.rpc("lc_demo_credit", { p_amount: amount });
    if (!error) {
      const live = await refreshLiveBalance();
      if (live !== null) return;
    }
  }
  setBalance(getBalance() + amount);
}

export { STARTING as DEMO_STARTING_BALANCE };
