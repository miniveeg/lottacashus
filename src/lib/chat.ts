import { supabase } from "./supabase";
import { levelFromWagered } from "./leveling";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage } from "../types/chat";

const RECENT_LIMIT = 100;

export function rowToChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    username: row.username as string,
    body: row.body as string,
    created_at: row.created_at as string,
    level: typeof row.level === "number" ? row.level : undefined,
  };
}

async function fetchLevelsForUsers(userIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.rpc("get_user_wager_levels", {
    user_ids: unique,
  });

  if (error || !data) return new Map();

  const map = new Map<string, number>();
  for (const row of data as { user_id: string; total_wagered: number }[]) {
    map.set(row.user_id, levelFromWagered(Number(row.total_wagered ?? 0)));
  }
  return map;
}

export async function enrichChatMessagesWithLevels(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const levels = await fetchLevelsForUsers(messages.map((m) => m.user_id));
  return messages.map((m) => ({
    ...m,
    level: levels.get(m.user_id) ?? m.level ?? 0,
  }));
}

export async function fetchRecentChatMessages(): Promise<{
  data: ChatMessage[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, user_id, username, body, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) return { data: [], error: error.message };

  const messages = (data ?? []).map((row) => rowToChatMessage(row as Record<string, unknown>));
  messages.reverse();
  const enriched = await enrichChatMessagesWithLevels(messages);
  return { data: enriched, error: null };
}

export async function sendChatMessage(
  body: string,
  username: string
): Promise<{ data: ChatMessage | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { data: null, error: "Log in to send messages." };

  const trimmed = body.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
  if (!trimmed) return { data: null, error: "Message cannot be empty." };

  const displayName = username.trim().slice(0, 16) || user.email?.split("@")[0] || "Player";

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      user_id: user.id,
      username: displayName,
      body: trimmed,
    })
    .select("id, user_id, username, body, created_at")
    .single();

  if (error) return { data: null, error: error.message };

  return { data: rowToChatMessage(data as Record<string, unknown>), error: null };
}
