import { isSupabaseConfigured, supabase } from "./supabase";

export type AffiliateCommissionRow = {
  id: string;
  kind: "deposit" | "wager";
  base_amount: number;
  commission_amount: number;
  created_at: string;
};

export type AffiliateStats = {
  affiliate_code: string;
  has_referrer: boolean;
  referrer_code: string | null;
  referred_count: number;
  claimable_balance: number;
  total_claimed: number;
  total_earned: number;
  earned_from_deposits: number;
  earned_from_wagers: number;
  recent_commissions: AffiliateCommissionRow[];
};

export type ClaimAffiliateResult = {
  claimed_amount: number;
  claimable_balance: number;
  balance: number;
};

const NOT_CONFIGURED_ERROR = "Supabase is not configured. Add your keys to .env.";

function mapStats(raw: Record<string, unknown>): AffiliateStats {
  const recent = Array.isArray(raw.recent_commissions)
    ? (raw.recent_commissions as Record<string, unknown>[])
    : [];

  const referrerCode = raw.referrer_code;
  return {
    affiliate_code: String(raw.affiliate_code ?? ""),
    has_referrer: Boolean(raw.has_referrer),
    referrer_code:
      referrerCode != null && String(referrerCode) !== "" ? String(referrerCode) : null,
    referred_count: Number(raw.referred_count ?? 0),
    claimable_balance: Number(raw.claimable_balance ?? 0),
    total_claimed: Number(raw.total_claimed ?? 0),
    total_earned: Number(raw.total_earned ?? 0),
    earned_from_deposits: Number(raw.earned_from_deposits ?? 0),
    earned_from_wagers: Number(raw.earned_from_wagers ?? 0),
    recent_commissions: recent.map((row) => ({
      id: String(row.id),
      kind: row.kind === "wager" ? "wager" : "deposit",
      base_amount: Number(row.base_amount ?? 0),
      commission_amount: Number(row.commission_amount ?? 0),
      created_at: String(row.created_at ?? ""),
    })),
  };
}

export async function fetchAffiliateStats(): Promise<{
  stats: AffiliateStats | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { stats: null, error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase.rpc("get_affiliate_stats");

  if (error) {
    return { stats: null, error: error.message };
  }

  if (!data || typeof data !== "object") {
    return { stats: null, error: "Could not load affiliate stats." };
  }

  return { stats: mapStats(data as Record<string, unknown>), error: null };
}

export async function submitAffiliateReferralCode(code: string): Promise<{
  success: boolean;
  referrer_code: string | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { success: false, referrer_code: null, error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase.rpc("submit_affiliate_referral_code", {
    p_code: code.trim(),
  });

  if (error) {
    return { success: false, referrer_code: null, error: error.message };
  }

  if (!data || typeof data !== "object") {
    return { success: false, referrer_code: null, error: "Could not apply referral code." };
  }

  const raw = data as Record<string, unknown>;
  if (!raw.success) {
    return {
      success: false,
      referrer_code: null,
      error: String(raw.error ?? "Could not apply referral code."),
    };
  }

  const referrerCode = raw.referrer_code;
  return {
    success: true,
    referrer_code:
      referrerCode != null && String(referrerCode) !== "" ? String(referrerCode) : null,
    error: null,
  };
}

export async function claimAffiliateEarnings(): Promise<{
  result: ClaimAffiliateResult | null;
  error: string | null;
}> {
  if (!isSupabaseConfigured) return { result: null, error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase.rpc("claim_affiliate_earnings");

  if (error) {
    return { result: null, error: error.message };
  }

  if (!data || typeof data !== "object") {
    return { result: null, error: "Could not claim earnings." };
  }

  const raw = data as Record<string, unknown>;
  return {
    result: {
      claimed_amount: Number(raw.claimed_amount ?? 0),
      claimable_balance: Number(raw.claimable_balance ?? 0),
      balance: Number(raw.balance ?? 0),
    },
    error: null,
  };
}
