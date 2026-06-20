import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { generateCode, hashCode, normalizeEmail } from "../_shared/crypto.ts";
import { sendVerificationEmail } from "../_shared/email.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function dbSetupError(detail: string): string {
  if (detail.includes("does not exist")) {
    return "Database table missing. In Supabase → SQL Editor, run the file supabase/migrations/20250520100000_fix_verification_codes_permissions.sql";
  }
  return `Could not save verification code. (${detail})`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method === "GET") {
    return jsonResponse({ ok: true, function: "send-signup-code" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email ?? "");
    const MAX_USERNAME_LENGTH = 16;
    const usernameRaw = typeof body?.username === "string" ? body.username.trim() : "";
    if (usernameRaw.length > MAX_USERNAME_LENGTH) {
      return jsonResponse({ error: `Username cannot be longer than ${MAX_USERNAME_LENGTH} characters.` }, 400);
    }
    const username = usernameRaw || null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, 400, req);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: alreadyRegistered, error: existsError } = await supabase.rpc("email_exists", {
      check_email: email,
    });

    if (existsError) {
      console.error("email_exists:", existsError);
      return jsonResponse(
        {
          error:
            "Server setup incomplete. Run supabase/migrations/20250520100000_fix_verification_codes_permissions.sql in the Supabase SQL Editor.",
        },
        500
      );
    }

    if (alreadyRegistered) {
      return jsonResponse({ error: "An account with this email already exists." }, 400, req);
    }

    const { data: existing, error: selectError } = await supabase
      .from("signup_verification_codes")
      .select("created_at")
      .eq("email", email)
      .maybeSingle();

    if (selectError) {
      console.error("select verification code:", selectError);
      return jsonResponse({ error: dbSetupError(selectError.message) }, 500, req);
    }

    if (existing?.created_at) {
      const created = new Date(existing.created_at).getTime();
      if (Date.now() - created < RESEND_COOLDOWN_MS) {
        return jsonResponse({ error: "Please wait a minute before requesting another code." }, 429, req);
      }
    }

    const code = generateCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: upsertError } = await supabase.from("signup_verification_codes").upsert(
      {
        email,
        code_hash: codeHash,
        username: username || null,
        expires_at: expiresAt,
        attempts: 0,
        created_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    );

    if (upsertError) {
      console.error(upsertError);
      return jsonResponse({ error: dbSetupError(upsertError.message) }, 500, req);
    }

    await sendVerificationEmail(email, code);

    return jsonResponse({ success: true, expiresInMinutes: 10 });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to send verification code.";
    return jsonResponse({ error: message }, 500, req);
  }
});
