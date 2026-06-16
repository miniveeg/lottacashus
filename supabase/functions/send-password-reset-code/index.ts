import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { generateCode, hashCode, normalizeEmail } from "../_shared/crypto.ts";
import { sendPasswordResetEmail } from "../_shared/email.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ ok: true, function: "send-password-reset-code" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email ?? "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: accountExists } = await supabase.rpc("email_exists", { check_email: email });

    if (accountExists) {
      const { data: existing } = await supabase
        .from("password_reset_codes")
        .select("created_at")
        .eq("email", email)
        .maybeSingle();

      if (existing?.created_at) {
        const created = new Date(existing.created_at).getTime();
        if (Date.now() - created < RESEND_COOLDOWN_MS) {
          return jsonResponse({ error: "Please wait a minute before requesting another code." }, 429);
        }
      }

      const code = generateCode();
      const codeHash = await hashCode(code);
      const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

      const { error: upsertError } = await supabase.from("password_reset_codes").upsert(
        {
          email,
          code_hash: codeHash,
          expires_at: expiresAt,
          attempts: 0,
          verified_at: null,
          created_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

      if (upsertError) {
        console.error(upsertError);
        return jsonResponse({ error: "Could not save reset code." }, 500);
      }

      await sendPasswordResetEmail(email, code);
    }

    return jsonResponse({
      success: true,
      expiresInMinutes: 10,
      message: "If an account exists for this email, a reset code has been sent.",
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to send reset code.";
    return jsonResponse({ error: message }, 500);
  }
});
