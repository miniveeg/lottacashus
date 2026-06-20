import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { hashCode, normalizeEmail } from "../_shared/crypto.ts";

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email ?? "");
    const code = String(body?.code ?? "").trim();
    const newPassword = String(body?.newPassword ?? "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, 400, req);
    }

    if (!/^\d{6}$/.test(code)) {
      return jsonResponse({ error: "Enter the 6-digit code from your email." }, 400, req);
    }

    if (newPassword.length < 6) {
      return jsonResponse({ error: "Password must be at least 6 characters." }, 400, req);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error: fetchError } = await supabase
      .from("password_reset_codes")
      .select("code_hash, expires_at, attempts")
      .eq("email", email)
      .maybeSingle();

    if (fetchError || !row) {
      return jsonResponse({ error: "No reset code found. Request a new code." }, 400, req);
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabase.from("password_reset_codes").delete().eq("email", email);
      return jsonResponse({ error: "This code has expired. Request a new one." }, 400, req);
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await supabase.from("password_reset_codes").delete().eq("email", email);
      return jsonResponse({ error: "Too many attempts. Request a new code." }, 400, req);
    }

    const codeHash = await hashCode(code);

    if (codeHash !== row.code_hash) {
      await supabase
        .from("password_reset_codes")
        .update({ attempts: row.attempts + 1 })
        .eq("email", email);
      return jsonResponse({ error: "Incorrect code. Try again." }, 400, req);
    }

    const { data: userId, error: userError } = await supabase.rpc("get_user_id_by_email", {
      check_email: email,
    });

    if (userError || !userId) {
      return jsonResponse({ error: "No account found for this email." }, 400, req);
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId as string, {
      password: newPassword,
    });

    if (updateError) {
      console.error(updateError);
      return jsonResponse({ error: "Could not update password. Try again." }, 500, req);
    }

    await supabase.from("password_reset_codes").delete().eq("email", email);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Password reset failed.";
    return jsonResponse({ error: message }, 500, req);
  }
});
