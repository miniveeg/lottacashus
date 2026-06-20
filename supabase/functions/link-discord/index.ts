import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "You must be logged in." }, 401, req);
    }

    const body = await req.json();
    const code = String(body?.code ?? "");
    const redirectUri = String(body?.redirectUri ?? "");

    if (!code) {
      return jsonResponse({ error: "Missing Discord authorization code." }, 400, req);
    }

    const clientId = Deno.env.get("DISCORD_CLIENT_ID");
    const clientSecret = Deno.env.get("DISCORD_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return jsonResponse({ error: "Discord is not configured on the server." }, 500, req);
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Invalid session. Log in again." }, 401, req);
    }

    const tokenRes = await fetch(DISCORD_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("Discord token error:", tokenData);
      return jsonResponse({ error: "Discord authorization failed. Try again." }, 400, req);
    }

    const discordUserRes = await fetch(DISCORD_USER_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const discordUser = await discordUserRes.json();

    if (!discordUserRes.ok) {
      console.error("Discord user error:", discordUser);
      return jsonResponse({ error: "Could not fetch Discord profile." }, 500, req);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const discordId = String(discordUser.id);

    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("discord_id", discordId)
      .neq("id", user.id)
      .maybeSingle();

    if (taken) {
      return jsonResponse({ error: "This Discord account is already linked to another user." }, 400, req);
    }

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
      : null;

    const discordUsername = String(discordUser.global_name ?? discordUser.username ?? "Discord");

    const { error: rpcError } = await supabaseAdmin.rpc("link_discord_profile", {
      p_user_id: user.id,
      p_discord_id: discordId,
      p_discord_username: discordUsername,
      p_discord_avatar: avatarUrl,
    });

    if (rpcError) {
      console.error("link_discord_profile:", rpcError);

      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (!existing) {
        const { error: insertError } = await supabaseAdmin.from("profiles").insert({
          id: user.id,
          email: user.email ?? null,
          username: (user.user_metadata?.username as string) ?? user.email?.split("@")[0] ?? null,
          balance: 0,
        });
        if (insertError) {
          return jsonResponse({
            error: "Could not create your profile.",
            detail: insertError.message,
            hint: "Run supabase/migrations/20250520700000_discord_link_profiles.sql in SQL Editor",
          }, 500, req);
        }
      }

      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          discord_id: discordId,
          discord_username: discordUsername,
          discord_avatar: avatarUrl,
          discord_linked_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) {
        return jsonResponse({
          error: "Could not save Discord link.",
          detail: updateError.message,
          hint: "Run supabase/migrations/20250520700000_discord_link_profiles.sql in SQL Editor",
        }, 500, req);
      }
    }

    return jsonResponse({
      success: true,
      discordUsername,
      discordAvatar: avatarUrl,
    }, 200, req);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Discord link failed.";
    return jsonResponse({ error: message }, 500, req);
  }
});
