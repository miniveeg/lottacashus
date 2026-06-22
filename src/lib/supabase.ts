import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Marker values used by the scaffold when Supabase has not been wired up.
// Treating these as "unconfigured" lets the UI degrade gracefully (guest mode,
// disabled auth buttons, "not configured" banners) instead of attempting real
// network calls against a non-existent project.
const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEYS = new Set(["placeholder-anon-key", "placeholder-key"]);

function resolveConfigured(): boolean {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (supabaseUrl === PLACEHOLDER_URL || supabaseUrl.includes("placeholder")) return false;
  if (PLACEHOLDER_KEYS.has(supabaseAnonKey)) return false;
  return true;
}

export const isSupabaseConfigured = resolveConfigured();

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase is not configured (missing or placeholder VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). " +
      "Auth, wallet, and database features will be disabled until real keys are provided in .env."
  );
}

// Always create the client so importing modules never crash; callers MUST guard
// with `isSupabaseConfigured` before making real requests.
// Reuse a global singleton in dev so HMR re-evaluations don't spawn multiple
// GoTrueClient instances (which logs a Supabase warning and can cause token
// storage races).
const globalForSupabase = globalThis as typeof globalThis & {
  __lottacashSupabase?: SupabaseClient;
};

function buildClient(): SupabaseClient {
  return createClient(supabaseUrl ?? PLACEHOLDER_URL, supabaseAnonKey ?? "placeholder-key", {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export const supabase: SupabaseClient =
  globalForSupabase.__lottacashSupabase ?? buildClient();
if (!globalForSupabase.__lottacashSupabase) {
  globalForSupabase.__lottacashSupabase = supabase;
}
