import { isSupabaseConfigured, supabase } from "./supabase";

export type LeaderboardEntry = {
  rank: number;
  username: string;
  value: number;
  secondary?: number;
};

export type LeaderboardTab = "wins" | "wagered" | "referrers";

function asEntries(data: unknown, withSecondary: boolean): LeaderboardEntry[] {
  if (!Array.isArray(data)) return [];
  const out: LeaderboardEntry[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown>;
    const username = String(row.username ?? "").trim() || "Unknown";
    const value = Number(row.value ?? row.amount ?? row.total_wagered ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const entry: LeaderboardEntry = {
      rank: Number(row.rank) > 0 ? Number(row.rank) : out.length + 1,
      username,
      value,
    };
    if (withSecondary) {
      const sec = Number(row.secondary);
      entry.secondary = Number.isFinite(sec) ? sec : 0;
    }
    out.push(entry);
  }
  return out;
}

export async function fetchBiggestWins(limit = 50): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc("get_leaderboard_wins", { p_limit: limit });
  if (error || !data) return [];
  return asEntries(data, false);
}

export async function fetchMostWagered(limit = 50): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc("get_leaderboard_wagered", { p_limit: limit });
  if (error || !data) return [];
  return asEntries(data, true);
}
