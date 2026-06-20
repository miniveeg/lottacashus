import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { CHAINS, type Chain } from "../_shared/config.ts";
import { deriveWallet } from "../_shared/crypto-wallet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Log in required." }, 401, req);

    const body = await req.json();
    const chain = String(body?.chain ?? "").toLowerCase() as Chain;

    if (!CHAINS.includes(chain)) {
      return jsonResponse({ error: "Invalid chain. Use sol, ltc, or eth." }, 400, req);
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

    if (userError || !user) return jsonResponse({ error: "Invalid session." }, 401, req);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: existing } = await supabaseAdmin
      .from("user_deposit_addresses")
      .select("address, derivation_index")
      .eq("user_id", user.id)
      .eq("chain", chain)
      .maybeSingle();

    if (existing?.address) {
      return jsonResponse({
        chain,
        address: existing.address,
        confirmationsRequired: chain === "sol" ? 1 : chain === "ltc" ? 6 : 12,
      });
    }

    const { data: index, error: indexError } = await supabaseAdmin.rpc(
      "assign_deposit_derivation_index",
      { p_user_id: user.id }
    );

    if (indexError) {
      console.error(indexError);
      return jsonResponse({ error: "Could not assign deposit index." }, 500, req);
    }

    const derived = await deriveWallet(chain, index as number);

    const { error: insertError } = await supabaseAdmin.from("user_deposit_addresses").insert({
      user_id: user.id,
      chain,
      address: derived.address,
      derivation_index: derived.derivationIndex,
    });

    if (insertError) {
      console.error(insertError);
      return jsonResponse({ error: "Could not save deposit address." }, 500, req);
    }

    return jsonResponse({
      chain,
      address: derived.address,
      confirmationsRequired: chain === "sol" ? 1 : chain === "ltc" ? 6 : 12,
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to get deposit address.";
    return jsonResponse({ error: message }, 500, req);
  }
});
