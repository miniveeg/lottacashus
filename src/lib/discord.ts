import { invokeEdgeFunction } from "./edgeFunctions";
import { supabase } from "./supabase";

const DISCORD_STATE_KEY = "lottacash_discord_oauth_state";

export function getDiscordRedirectUri(): string {
  return `${window.location.origin}/settings`;
}

export function startDiscordOAuth(): void {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) {
    throw new Error("Discord client ID is not configured.");
  }

  const state = crypto.randomUUID();
  sessionStorage.setItem(DISCORD_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getDiscordRedirectUri(),
    response_type: "code",
    scope: "identify",
    state,
  });

  window.location.href = `https://discord.com/api/oauth2/authorize?${params}`;
}

export function validateDiscordState(state: string | null): boolean {
  const saved = sessionStorage.getItem(DISCORD_STATE_KEY);
  sessionStorage.removeItem(DISCORD_STATE_KEY);
  return Boolean(state && saved && state === saved);
}

export async function linkDiscordAccount(code: string) {
  return invokeEdgeFunction<{
    success: boolean;
    discordUsername?: string;
    discordAvatar?: string;
  }>("link-discord", {
    code,
    redirectUri: getDiscordRedirectUri(),
  });
}

export async function unlinkDiscordAccount() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not logged in." };

  const { error } = await supabase
    .from("profiles")
    .update({
      discord_id: null,
      discord_username: null,
      discord_avatar: null,
      discord_linked_at: null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { error: null };
}

export const isDiscordConfigured = Boolean(import.meta.env.VITE_DISCORD_CLIENT_ID);
