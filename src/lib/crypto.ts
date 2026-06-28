import { invokeEdgeFunction } from "./edgeFunctions";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { CryptoChain, CryptoDepositRow, DepositAddressResponse } from "../types/crypto";

const NOT_CONFIGURED_ERROR = "Supabase is not configured. Add your keys to .env.";

export async function fetchDepositAddress(
  chain: CryptoChain
): Promise<{ data: DepositAddressResponse | null; error: string | null }> {
  return invokeEdgeFunction<DepositAddressResponse>("get-deposit-address", { chain });
}

export async function fetchMyDeposits(userId?: string): Promise<{
  data: CryptoDepositRow[] | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

  // SECURITY (M5): add an explicit user_id filter as defense-in-depth. RLS
  // already restricts to auth.uid(), but if a future migration accidentally
  // drops the policy, this filter prevents mass leakage.
  let query = supabase
    .from("crypto_deposits")
    .select(
      "id, chain, tx_hash, crypto_amount, usd_amount, confirmations, required_confirmations, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(20);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;

  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as CryptoDepositRow[], error: null };
}

export async function requestWithdrawal(
  _chain: CryptoChain,
  _destination: string,
  _usdAmount: number
): Promise<{ data: string | null; error: string | null }> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

  // SECURITY: request_crypto_withdrawal was DROPPED in migration 001_audit_fixes.sql
  // (it treated Gold Coins as USD 1:1, letting users withdraw real crypto for
  // play money). The UI uses request_sc_redemption via Supabase RPC instead —
  // see src/pages/Withdraw/Withdraw.tsx. This function is kept for backward
  // compat but always returns an error.
  return {
    data: null,
    error: "Direct crypto withdrawals are disabled. Use the SC redemption flow on the Withdraw page.",
  };
}

export type CryptoWithdrawalRow = {
  id: string;
  chain: string;
  destination_address: string;
  usd_amount: number;
  status: string;
  created_at: string;
  completed_at: string | null;
};

export async function fetchMyWithdrawals(userId?: string): Promise<{
  data: CryptoWithdrawalRow[] | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

  // SECURITY (M5): explicit user_id filter (defense-in-depth).
  let query = supabase
    .from("crypto_withdrawals")
    .select("id, chain, destination_address, usd_amount, status, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;

  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as CryptoWithdrawalRow[], error: null };
}

export function validateCryptoAddress(chain: CryptoChain, address: string): boolean {
  const a = address.trim();
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (chain === "ltc") return /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
  if (chain === "eth") return /^0x[a-fA-F0-9]{40}$/.test(a);
  return false;
}
