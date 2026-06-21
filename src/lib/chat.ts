import { isSupabaseConfigured, supabase } from "./supabase";
import { levelFromWagered } from "./leveling";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage } from "../types/chat";

const RECENT_LIMIT = 100;

const NOT_CONFIGURED_ERROR = "Supabase is not configured. Add your keys to .env.";

/** Coerce an unknown row from Supabase (REST or Realtime payload) into a
 *  `ChatMessage`, defaulting each field to a safe value rather than
 *  `undefined`. Realtime `postgres_changes` payloads can occasionally arrive
 *  with partial fields (e.g., during schema migrations), so defensive
 *  coercion prevents downstream UI crashes (invalid `key`, `Invalid Date`).
 *
 *  Defensive against `null`/`undefined` input: returns a sentinel message
 *  with an empty `id` (which the caller is expected to filter or de-dup —
 *  SidebarChat's `prev.some((m) => m.id === enriched.id)` check naturally
 *  skips an empty-id row because no real message has an empty id). */
export function rowToChatMessage(row: Record<string, unknown> | null | undefined): ChatMessage {
  if (!row || typeof row !== "object") {
    return {
      id: "",
      user_id: "",
      username: "Player",
      body: "",
      created_at: new Date().toISOString(),
      level: undefined,
    };
  }
  const createdAt = typeof row.created_at === "string" && row.created_at
    ? row.created_at
    : new Date().toISOString();
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    username: String(row.username ?? "Player"),
    body: String(row.body ?? ""),
    created_at: createdAt,
    level: typeof row.level === "number" && Number.isFinite(row.level) ? row.level : undefined,
  };
}

async function fetchLevelsForUsers(userIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  if (!isSupabaseConfigured) return new Map();

  const { data, error } = await supabase.rpc("get_user_wager_levels", {
    user_ids: unique,
  });

  if (error || !data) return new Map();

  const map = new Map<string, number>();
  if (!Array.isArray(data)) return map;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as { user_id?: unknown; total_wagered?: unknown };
    const uid = String(r.user_id ?? "");
    if (!uid) continue;
    const wagered = Number(r.total_wagered ?? 0);
    map.set(uid, levelFromWagered(Number.isFinite(wagered) ? wagered : 0));
  }
  return map;
}

export async function enrichChatMessagesWithLevels(
  messages: ChatMessage[]
): Promise<ChatMessage[]> {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
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
  if (!isSupabaseConfigured) return { data: [], error: NOT_CONFIGURED_ERROR };

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, user_id, username, body, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) return { data: [], error: error.message };
  if (!Array.isArray(data)) return { data: [], error: null };

  const messages = data.map((row) => rowToChatMessage(row as Record<string, unknown>));
  messages.reverse();
  const enriched = await enrichChatMessagesWithLevels(messages);
  return { data: enriched, error: null };
}

export async function sendChatMessage(
  body: string,
  username: string
): Promise<{ data: ChatMessage | null; error: string | null }> {
  if (!isSupabaseConfigured) return { data: null, error: NOT_CONFIGURED_ERROR };

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
  if (!data) return { data: null, error: "Failed to send message." };

  return { data: rowToChatMessage(data as Record<string, unknown>), error: null };
}
