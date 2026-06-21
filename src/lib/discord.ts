import { invokeEdgeFunction } from "./edgeFunctions";
import { isSupabaseConfigured, supabase } from "./supabase";

const DISCORD_STATE_KEY = "lottacash_discord_oauth_state";

export function getDiscordRedirectUri(): string {
  if (typeof window === "undefined") return "/settings";
  return `${window.location.origin}/settings`;
}

function generateStateToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

export function startDiscordOAuth(): void {
  if (typeof window === "undefined") return;
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) throw new Error("Discord client ID is not configured.");
  const state = generateStateToken();
  try { sessionStorage.setItem(DISCORD_STATE_KEY, state); } catch { throw new Error("Unable to store Discord OAuth state."); }
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: getDiscordRedirectUri(), response_type: "code", scope: "identify", state });
  window.location.href = `https://discord.com/api/oauth2/authorize?${params}`;
}

export function validateDiscordState(state: string | null): boolean {
  try { const saved = sessionStorage.getItem(DISCORD_STATE_KEY); sessionStorage.removeItem(DISCORD_STATE_KEY); return Boolean(state && saved && state === saved); } catch { return false; }
}

export async function linkDiscordAccount(code: string): Promise<{ data: { success: boolean; discordUsername?: string; discordAvatar?: string } | null; error: string | null }> {
  return invokeEdgeFunction("link-discord", { code, redirectUri: getDiscordRedirectUri() });
}

export async function unlinkDiscordAccount(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not logged in." };
  const { error } = await supabase.from("profiles").update({ discord_id: null, discord_username: null, discord_avatar: null, discord_linked_at: null }).eq("id", user.id);
  if (error) return { error: error.message };
  return { error: null };
}

export const isDiscordConfigured = Boolean(import.meta.env.VITE_DISCORD_CLIENT_ID);
