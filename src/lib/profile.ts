import { isSupabaseConfigured, supabase } from "./supabase";

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
    .select("username, balance, total_wagered, total_deposited, total_withdrawn, total_wins, total_losses, created_at, referral_code")
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
    referralCode: (data.referral_code as string) ?? null,
  };
}

export async function fetchPublicProfile(username: string): Promise<ProfileStats | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("username, balance, total_wagered, total_deposited, total_withdrawn, total_wins, total_losses, created_at, referral_code")
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

export async function fetchReferralInfo(): Promise<ReferralInfo | null> {
  if (!isSupabaseConfigured) return null;

  // Ensure user has a referral code
  const { data: codeData } = await supabase.rpc("ensure_referral_code");
  const referralCode = (codeData as string) || "";

  // Count referrals
  const { count: refCount } = await supabase
    .from("affiliate_referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_code", referralCode);

  // Get claimable balance
  const { data: balData } = await supabase
    .from("affiliate_balances")
    .select("claimable_amount")
    .maybeSingle();

  return {
    referralCode,
    referredCount: refCount ?? 0,
    claimableBalance: Number(balData?.claimable_amount) || 0,
  };
}

export async function claimAffiliateBalance(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: "Supabase not configured." };
  const { error } = await supabase.rpc("claim_affiliate_balance");
  if (error) return { error: error.message };
  return { error: null };
}
