import { useState } from "react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { VerifyRoundTool } from "./VerifyRoundTool";

/**
 * Provably Fair section of the Settings page.
 *
 * Extracted from the 837-line `Settings.tsx` god-component (audit finding:
 * Account agent #10 — "835-line god-component mixing 5 concerns"). This is
 * the first extraction; future rounds should pull out Account, Discord,
 * Responsible Gaming, and Transactions similarly.
 *
 * Lets the player rotate their provably-fair server seed. The
 * `rotate_server_seed()` RPC (added in audit round 1) atomically archives
 * the current server_seed, generates a new one, resets the nonce, and
 * returns the NEW hash + REVEALED old seed so the player can verify all
 * rounds played under the old seed.
 */
export function SettingsProvablyFairSection() {
  const [seedBusy, setSeedBusy] = useState(false);
  const [revealedSeed, setRevealedSeed] = useState<{
    revealed: string;
    revealedHash: string;
    newHash: string;
    clientSeed: string;
    nonce: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleRotateSeed() {
    setError(null);
    setSuccess(null);
    setRevealedSeed(null);
    if (!isSupabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }
    setSeedBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("rotate_server_seed");
      if (rpcError) {
        setError(rpcError.message);
      } else if (data) {
        const row = Array.isArray(data) ? data[0] : data;
        setRevealedSeed({
          revealed: String(row?.revealed_server_seed ?? ""),
          revealedHash: String(row?.revealed_server_seed_hash ?? ""),
          newHash: String(row?.new_server_seed_hash ?? ""),
          clientSeed: String(row?.client_seed ?? ""),
          nonce: Number(row?.next_nonce ?? 0),
        });
        setSuccess(
          "Server seed rotated. The previous seed is revealed below so you can verify past rounds.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate seed.");
    } finally {
      setSeedBusy(false);
    }
  }

  return (
    <section className="settings__section" id="provably-fair">
      <h2 className="settings__section-title">Provably Fair</h2>
      <p className="settings__section-desc">
        All LottaCash games use a server seed, client seed, and nonce to determine outcomes
        verifiably. Rotate your server seed anytime to reveal the previous one — you can then
        recompute every round played under it and confirm the house didn&apos;t cheat. The new seed
        is committed (hashed) immediately; its plaintext stays secret until your next rotation.
      </p>

      {error && <p className="settings__error" role="alert">{error}</p>}
      {success && <p className="settings__success" role="status">{success}</p>}

      {revealedSeed && (
        <div className="settings__seed-reveal" role="status" aria-live="polite">
          <h3 className="settings__subsection-title">Previous server seed (revealed)</h3>
          <dl className="settings__seed-dl">
            <dt>Revealed seed</dt>
            <dd><code className="settings__seed-code">{revealedSeed.revealed}</code></dd>
            <dt>Revealed seed hash</dt>
            <dd><code className="settings__seed-code">{revealedSeed.revealedHash}</code></dd>
            <dt>New server seed hash (commitment)</dt>
            <dd><code className="settings__seed-code">{revealedSeed.newHash}</code></dd>
            <dt>Client seed</dt>
            <dd><code className="settings__seed-code">{revealedSeed.clientSeed}</code></dd>
            <dt>Nonce (reset to)</dt>
            <dd><code className="settings__seed-code">{revealedSeed.nonce}</code></dd>
          </dl>
          <p className="settings__hint">
            To verify a past round: recompute the outcome using the revealed seed, your client seed,
            and the round&apos;s nonce (shown in each game&apos;s fairness panel). The result will
            match what the game displayed.
          </p>
        </div>
      )}

      <button
        type="button"
        className="settings__btn settings__btn--rotate"
        onClick={handleRotateSeed}
        disabled={seedBusy || !isSupabaseConfigured}
      >
        {seedBusy && <span className="settings__btn-spinner" aria-hidden="true" />}
        {seedBusy ? "Rotating…" : "Rotate server seed"}
      </button>
      {!isSupabaseConfigured && (
        <p className="settings__hint">Connect Supabase to enable seed rotation.</p>
      )}

      <VerifyRoundTool />
    </section>
  );
}
