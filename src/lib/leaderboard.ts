import { isSupabaseConfigured, supabase } from "./supabase";

export type LeaderboardEntry = {
  rank: number;
  username: string;
  value: number;
  secondary?: number;
};

export type LeaderboardTab = "wins" | "wagered" | "referrers";

export async function fetchBiggestWins(limit = 50): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, description, profiles!inner(username)")
    .eq("type", "win")
    .order("amount", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((row, i) => ({
    rank: i + 1,
    username: (row.profiles as { username: string } | { username: string }[])?.username
      ? ((row.profiles as { username: string }).username)
      : "Unknown",
    value: Number(row.amount) || 0,
  }));
}

export async function fetchMostWagered(limit = 50): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("username, total_wagered, total_wins, total_losses")
    .order("total_wagered", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((row, i) => {
    const wins = Number(row.total_wins) || 0;
    const losses = Number(row.total_losses) || 0;
    const total = wins + losses;
    return {
      rank: i + 1,
      username: row.username ?? "Unknown",
      value: Number(row.total_wagered) || 0,
      secondary: total > 0 ? (wins / total) * 100 : 0,
    };
  });
}
