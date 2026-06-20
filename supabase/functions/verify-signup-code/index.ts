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
    const password = String(body?.password ?? "");
    const MAX_USERNAME_LENGTH = 16;
    const usernameRaw = typeof body?.username === "string" ? body.username.trim() : "";
    if (usernameRaw.length > MAX_USERNAME_LENGTH) {
      return jsonResponse({ error: `Username cannot be longer than ${MAX_USERNAME_LENGTH} characters.` }, 400);
    }
    const username = usernameRaw || undefined;
    const referralRaw = typeof body?.referralCode === "string" ? body.referralCode.trim() : "";
    const referralCode = referralRaw
      ? referralRaw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32)
      : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address." }, 400, req);
    }

    if (!/^\d{6}$/.test(code)) {
      return jsonResponse({ error: "Enter the 6-digit code from your email." }, 400, req);
    }

    if (password.length < 6) {
      return jsonResponse({ error: "Password must be at least 6 characters." }, 400, req);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error: fetchError } = await supabase
      .from("signup_verification_codes")
      .select("code_hash, username, expires_at, attempts")
      .eq("email", email)
      .maybeSingle();

    if (fetchError || !row) {
      return jsonResponse({ error: "No verification code found. Request a new code." }, 400, req);
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabase.from("signup_verification_codes").delete().eq("email", email);
      return jsonResponse({ error: "This code has expired. Request a new one." }, 400, req);
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await supabase.from("signup_verification_codes").delete().eq("email", email);
      return jsonResponse({ error: "Too many attempts. Request a new code." }, 400, req);
    }

    const codeHash = await hashCode(code);

    if (codeHash !== row.code_hash) {
      await supabase
        .from("signup_verification_codes")
        .update({ attempts: row.attempts + 1 })
        .eq("email", email);
      return jsonResponse({ error: "Incorrect code. Try again." }, 400, req);
    }

    const displayName = username || row.username || email.split("@")[0];

    const { data: authData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: displayName },
    });

    if (createError) {
      const msg = createError.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        return jsonResponse({ error: "An account with this email already exists." }, 400, req);
      }
      console.error(createError);
      return jsonResponse({ error: "Could not create account. Try again." }, 500, req);
    }

    if (authData.user) {
      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: authData.user.id,
          email,
          username: displayName,
        },
        { onConflict: "id" }
      );
      if (profileError) console.error("profile upsert:", profileError);

      if (referralCode) {
        const { error: referralError } = await supabase.rpc("apply_affiliate_referral", {
          p_user_id: authData.user.id,
          p_code: referralCode,
        });
        if (referralError) console.error("affiliate referral:", referralError);
      }
    }

    await supabase.from("signup_verification_codes").delete().eq("email", email);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Verification failed.";
    return jsonResponse({ error: message }, 500, req);
  }
});
