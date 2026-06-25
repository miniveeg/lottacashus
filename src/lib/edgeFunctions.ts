import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase";
import { localPlay } from "./local-play";

type InvokeResult<T> = { data: T | null; error: string | null };

export type InvokeEdgeFunctionOptions = {
  /** Request timeout in milliseconds (default: 30 000). The underlying
   *  supabase-js `invoke` aborts the fetch via `AbortController` when this
   *  elapses, surfacing as a `FunctionsFetchError`. */
  timeoutMs?: number;
  /** Whether to retry once on transient network errors (default: `false`).
   *
   *  ⚠️ Only enable for **idempotent** operations (reads, status checks).
   *  Retrying a non-idempotent operation (e.g., `place-keno-bet`,
   *  `start-mines-game`) could double-charge the user if the first request
   *  reached the server and executed but the response was lost in transit.
   *
   *  Only `FunctionsFetchError` (network/timeout/DNS) is retried —
   *  `FunctionsHttpError` (server returned an HTTP error status) and
   *  `FunctionsRelayError` (Supabase relay error) are NOT retried because
   *  the server may have already processed the request. */
  retryOnTransient?: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = 500;

function relayErrorHelp(functionName: string): string {
  return (
    `Cannot reach the "${functionName}" Edge Function. ` +
    `Deploy it: npx supabase functions deploy ${functionName} --no-verify-jwt`
  );
}

/** Determine whether an error from `supabase.functions.invoke` is a transient
 *  network/timeout failure that is safe to retry (for idempotent operations). */
function isTransientFetchError(error: unknown): boolean {
  return error instanceof FunctionsFetchError;
}

async function parseFunctionError(
  functionName: string,
  error: { message?: string; context?: Response } | unknown
): Promise<string> {
  if (error instanceof FunctionsFetchError) {
    // Network/DNS/timeout failure — the request likely never reached the
    // server (or the response was lost). Surface a friendly "deploy it" hint.
    const cause = (error as { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    if (causeMsg.includes("aborted") || causeMsg.includes("timeout")) {
      return `Edge Function "${functionName}" timed out. Try again.`;
    }
    return relayErrorHelp(functionName);
  }

  if (error instanceof FunctionsRelayError) {
    return (
      `Edge Function "${functionName}" is not responding (relay error). ` +
      "Check function logs in the Supabase dashboard."
    );
  }

  // FunctionsHttpError — server returned a non-2xx status. Parse the body.
  if (error instanceof FunctionsHttpError) {
    const ctx = error.context;
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
    return `Edge Function "${functionName}" returned HTTP ${ctx.status}.`;
  }

  // Fall back to legacy duck-typed shape (covers any non-supabase error
  // objects that slipped through, e.g., raw fetch errors in tests).
  const e = error as { message?: string; context?: Response } | undefined;
  if (e?.context) {
    const ctx = e.context;
    try {
      const parsed = await ctx.clone().json();
      if (parsed?.error) {
        const detail = parsed.detail ? `: ${parsed.detail}` : "";
        const hint = parsed.hint ? ` (${parsed.hint})` : "";
        return `${String(parsed.error)}${detail}${hint}`;
      }
    } catch {
      /* ignore */
    }
    if (ctx.status === 404) {
      return `Edge Function not found (404). Deploy ${functionName}.`;
    }
  }

  if (e?.message?.includes("Failed to send a request to the Edge Function")) {
    return relayErrorHelp(functionName);
  }

  return e?.message ?? "Request failed.";
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
  body: Record<string, unknown>,
  options: InvokeEdgeFunctionOptions = {}
): Promise<InvokeResult<T>> {
  // Local-play fallback: when Supabase isn't configured, run the game locally.
  if (!isSupabaseConfigured) {
    const local = localPlay(name, body);
    return { data: local.data as T | null, error: local.error };
  }

  const { timeoutMs = DEFAULT_TIMEOUT_MS, retryOnTransient = false } = options;
  const maxAttempts = retryOnTransient ? 2 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }

    const { data, error } = await supabase.functions.invoke(name, {
      body,
      timeout: timeoutMs,
    });

    if (error) {
      // When Supabase IS configured but the call fails (network error, 404,
      // relay error), fall back to local-play so the UI stays functional.
      // The local wallet is separate from the Supabase wallet — this is
      // acceptable because a failed network call means the server-side
      // wager never executed (FunctionsFetchError = request never reached
      // the server, or response was lost).
      if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
        const local = localPlay(name, body);
        if (local.data) return { data: local.data as T, error: null };
      }
      const message = await parseFunctionError(name, error);
      if (isTransientFetchError(error) && attempt < maxAttempts - 1) {
        continue;
      }
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

  return { data: null, error: "Request failed." };
}
