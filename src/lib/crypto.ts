import { invokeEdgeFunction } from "./edgeFunctions";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { CryptoChain, CryptoDepositRow, DepositAddressResponse } from "../types/crypto";

const NOT_CONFIGURED_ERROR = "Supabase is not configured. Add your keys to .env.";

export async function fetchDepositAddress(
  chain: CryptoChain
): Promise<{ data: DepositAddressResponse | null; error: string | null }> {
  return invokeEdgeFunction<DepositAddressResponse>("get-deposit-address", { chain });
}

export async function fetchMyDeposits(): Promise<{
  data: CryptoDepositRow[] | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase
    .from("crypto_deposits")
    .select(
      "id, chain, tx_hash, crypto_amount, usd_amount, confirmations, required_confirmations, status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as CryptoDepositRow[], error: null };
}

export async function requestWithdrawal(
  chain: CryptoChain,
  destination: string,
  usdAmount: number
): Promise<{ data: string | null; error: string | null }> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase.rpc("request_crypto_withdrawal", {
    p_chain: chain,
    p_destination: destination.trim(),
    p_usd_amount: usdAmount,
  });

  if (error) return { data: null, error: error.message };
  return { data: data as string, error: null };
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

export async function fetchMyWithdrawals(): Promise<{
  data: CryptoWithdrawalRow[] | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase
    .from("crypto_withdrawals")
    .select("id, chain, destination_address, usd_amount, status, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(20);

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
