import { isSupabaseConfigured, supabase } from "./supabase";

type InvokeResult<T> = { data: T | null; error: string | null };

function relayErrorHelp(functionName: string): string {
  return (
    `Cannot reach the "${functionName}" Edge Function. ` +
    `Deploy it: npx supabase functions deploy ${functionName} --no-verify-jwt`
  );
}

async function parseFunctionError(
  functionName: string,
  error: { message?: string; context?: Response }
): Promise<string> {
  const ctx = error.context;
  if (ctx) {
    try {
      const parsed = await ctx.clone().json();
      if (parsed?.error) {
        const detail = parsed.detail ? `: ${parsed.detail}` : "";
        const hint = parsed.hint ? ` (${parsed.hint})` : "";
        return `${String(parsed.error)}${detail}${hint}`;
      }
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text) return text.slice(0, 200);
      } catch {
        /* ignore */
      }
    }
    if (ctx.status === 404) {
      return `Edge Function not found (404). Deploy ${functionName}.`;
    }
    if (ctx.status === 503) {
      try {
        const boot = await ctx.clone().json();
        const fromBody = await parseInvokeBody(boot);
        if (fromBody) return fromBody;
      } catch {
        /* ignore */
      }
      return (
        `Edge Function "${functionName}" failed to start (503). ` +
        "Redeploy and check function logs in the Supabase dashboard."
      );
    }
  }

  if (error.message?.includes("Failed to send a request to the Edge Function")) {
    return relayErrorHelp(functionName);
  }

  return error.message ?? "Request failed.";
}

async function parseInvokeBody(data: unknown): Promise<string | null> {
  if (!data || typeof data !== "object") return null;
  const row = data as { code?: string; message?: string; error?: string };
  if (row.code === "BOOT_ERROR") {
    return (
      "Edge Function failed to start (BOOT_ERROR). Redeploy after fixing the function code, " +
      "then check Supabase Dashboard → Edge Functions → Logs."
    );
  }
  if (typeof row.error === "string") return row.error;
  if (typeof row.message === "string" && row.code) return `${row.code}: ${row.message}`;
  return null;
}

export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>
): Promise<InvokeResult<T>> {
  if (!isSupabaseConfigured) {
    return { data: null, error: "Supabase is not configured. Add your keys to .env." };
  }

  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const message = await parseFunctionError(name, error as { message?: string; context?: Response });
    return { data: null, error: message };
  }

  const payload = data as { error?: string; code?: string; message?: string } | null;
  const bodyError = await parseInvokeBody(payload);
  if (bodyError) {
    return { data: null, error: bodyError };
  }
  if (payload?.error) {
    return { data: null, error: payload.error };
  }

  return { data: data as T, error: null };
}
