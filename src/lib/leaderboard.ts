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
  const rpc = await supabase.rpc("get_leaderboard_wins", { p_limit: limit });
  if (!rpc.error && rpc.data) return asEntries(rpc.data, false);

  const { data, error } = await supabase
    .from("transactions")
    .select("amount, description, profiles!inner(username)")
    .eq("type", "win")
    .order("amount", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.flatMap((row, i) => {
    const profiles = row.profiles as { username: string } | { username: string }[] | null;
    const username = Array.isArray(profiles)
      ? (profiles[0]?.username ?? "Unknown")
      : (profiles?.username ?? "Unknown");
    const value = Number(row.amount) || 0;
    if (value <= 0) return [];
    return [{ rank: i + 1, username, value }];
  });
}

export async function fetchMostWagered(limit = 50): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured) return [];
  const rpc = await supabase.rpc("get_leaderboard_wagered", { p_limit: limit });
  if (!rpc.error && rpc.data) return asEntries(rpc.data, true);

  const { data, error } = await supabase
    .from("profiles")
    .select("username, total_wagered, total_wins, total_losses")
    .order("total_wagered", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.flatMap((row, i) => {
    const value = Number(row.total_wagered) || 0;
    if (value <= 0) return [];
    const wins = Number(row.total_wins) || 0;
    const losses = Number(row.total_losses) || 0;
    const total = wins + losses;
    return [{
      rank: i + 1,
      username: row.username ?? "Unknown",
      value,
      secondary: total > 0 ? (wins / total) * 100 : 0,
    }];
  });
}
