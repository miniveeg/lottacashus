import { invokeEdgeFunction } from "./edgeFunctions";
import { isSupabaseConfigured, supabase } from "./supabase";

const DISCORD_STATE_KEY = "lottacash_discord_oauth_state";

/** Discord OAuth2 redirect URI.
 *
 *  The app uses BrowserRouter, so `/settings` is a real route that Discord
 *  can redirect back to directly. After OAuth completes, Discord lands the
 *  user at `${origin}/settings?code=...&state=...` and the Settings page
 *  consumes the `code`/`state` via `useSearchParams`.
 *
 *  The Discord Developer Portal MUST have `${origin}/settings` registered as
 *  a redirect URI for this to work.
 */
export function getDiscordRedirectUri(): string {
  if (typeof window === "undefined") return "/settings";
  return `${window.location.origin}/settings`;
}

/** Generate a CSRF state token, falling back to `crypto.getRandomValues`
 *  when `crypto.randomUUID` is unavailable (older browsers / insecure
 *  contexts). */
function generateStateToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Last-resort fallback (insecure context, no crypto). Still unique-ish
  // via Math.random + timestamp; better than nothing.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

export function startDiscordOAuth(): void {
  if (typeof window === "undefined") return;
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) {
    throw new Error("Discord client ID is not configured.");
  }

  const state = generateStateToken();
  try {
    sessionStorage.setItem(DISCORD_STATE_KEY, state);
  } catch {
    /* private mode / disabled storage — abort OAuth to avoid CSRF risk */
    throw new Error("Unable to store Discord OAuth state (session storage unavailable).");
  }

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
  try {
    const saved = sessionStorage.getItem(DISCORD_STATE_KEY);
    sessionStorage.removeItem(DISCORD_STATE_KEY);
    return Boolean(state && saved && state === saved);
  } catch {
    // sessionStorage unavailable (private mode / disabled) — fail closed
    // to avoid accepting a CSRF-able state.
    return false;
  }
}

export async function linkDiscordAccount(
  code: string
): Promise<{
  data: { success: boolean; discordUsername?: string; discordAvatar?: string } | null;
  error: string | null;
}> {
  return invokeEdgeFunction<{
    success: boolean;
    discordUsername?: string;
    discordAvatar?: string;
  }>("link-discord", {
    code,
    redirectUri: getDiscordRedirectUri(),
  });
}

export async function unlinkDiscordAccount(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured. Add your keys to .env." };
  }
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
