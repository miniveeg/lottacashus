import { isSupabaseConfigured, supabase } from "./supabase";
import { claimAffiliateEarnings, fetchAffiliateStats } from "./affiliate";

export type ProfileStats = {
  username: string | null;
  balance: number;
  totalWagered: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalWins: number;
  totalLosses: number;
  memberSince: string | null;
  referralCode: string | null;
};

export type ReferralInfo = {
  referralCode: string;
  referredCount: number;
  claimableBalance: number;
};

export async function fetchProfileStats(userId: string): Promise<ProfileStats | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("username, balance, total_wagered, total_deposited, total_withdrawn, total_wins, total_losses, created_at, affiliate_code")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    username: (data.username as string) ?? null,
    balance: Number(data.balance) || 0,
    totalWagered: Number(data.total_wagered) || 0,
    totalDeposited: Number(data.total_deposited) || 0,
    totalWithdrawn: Number(data.total_withdrawn) || 0,
    totalWins: Number(data.total_wins) || 0,
    totalLosses: Number(data.total_losses) || 0,
    memberSince: (data.created_at as string) ?? null,
    referralCode: (data.affiliate_code as string) ?? null,
  };
}

export async function fetchPublicProfile(username: string): Promise<ProfileStats | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("username, balance, total_wagered, total_deposited, total_withdrawn, total_wins, total_losses, created_at, affiliate_code")
    .eq("username", username)
    .maybeSingle();
  if (error || !data) return null;
  return {
    username: (data.username as string) ?? null,
    balance: 0,
    totalWagered: Number(data.total_wagered) || 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalWins: Number(data.total_wins) || 0,
    totalLosses: Number(data.total_losses) || 0,
    memberSince: (data.created_at as string) ?? null,
    referralCode: null,
  };
}

/** Returns the signed-in user's own profile's affiliate code + referral stats.
 *  Delegates to `lib/affiliate.ts` so the schema surface stays in one place
 *  (the canonical commission/RPC layout lives in `get_affiliate_stats` and
 *  `affiliate_commissions` — this wrapper just reshapes that into the
 *  `ReferralInfo` shape the Profile page expects). */
export async function fetchReferralInfo(): Promise<ReferralInfo | null> {
  if (!isSupabaseConfigured) return null;
  const { stats } = await fetchAffiliateStats();
  if (!stats) return null;
  return {
    referralCode: stats.affiliate_code,
    referredCount: stats.referred_count,
    claimableBalance: stats.claimable_balance,
  };
}

/** Claims the user's unclaimed affiliate earnings to their balance. Wraps
 *  `lib/affiliate.ts#claimAffiliateEarnings` so Profile.tsx doesn't need to
 *  know about the underlying RPC shape. */
export async function claimAffiliateBalance(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured. Add your keys to .env." };
  const { error } = await claimAffiliateEarnings();
  return { error };
}
