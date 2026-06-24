import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useProfile } from "../../contexts/ProfileContext";
import { useAuth } from "../../contexts/AuthContext";
import { createUserNotification } from "../../lib/notifications";
import {
  isDiscordConfigured,
  linkDiscordAccount,
  startDiscordOAuth,
  unlinkDiscordAccount,
  validateDiscordState,
} from "../../lib/discord";

/**
 * Discord section of the Settings page.
 *
 * Extracted from the 683-line `Settings.tsx` (audit finding: Account agent
 * #10 — "835-line god-component"). This is the third extraction (Provably
 * Fair was 1st, Transactions 2nd). Owns its own `discordBusy` state, the
 * link/unlink handlers, AND the OAuth-callback effect (handles the redirect
 * from Discord with `?code=...&state=...`). Takes `onError`/`onSuccess`
 * callbacks to surface messages in the parent's error/success slots.
 */

interface Props {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function SettingsDiscordSection({ onError, onSuccess }: Props) {
  const { profile, refreshProfile } = useProfile();
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [discordBusy, setDiscordBusy] = useState(false);

  // OAuth callback: when Discord redirects back with ?code=...&state=...,
  // validate the state and complete the link.
  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !session) return;

    if (!validateDiscordState(state)) {
      onError("Discord link expired or invalid. Try again.");
      setSearchParams({}, { replace: true });
      return;
    }

    setDiscordBusy(true);
    setSearchParams({}, { replace: true });

    linkDiscordAccount(code).then(async ({ data, error: linkError }) => {
      setDiscordBusy(false);
      if (linkError) {
        await createUserNotification(
          "discord_link_failed",
          "Discord link failed",
          linkError
        );
        onError(linkError);
        return;
      }
      await refreshProfile();
      onSuccess(`Discord linked as ${data?.discordUsername ?? "account"}.`);
    });
  }, [searchParams, session, setSearchParams, refreshProfile, onError, onSuccess]);

  function handleLinkDiscord() {
    onError("");
    try {
      startDiscordOAuth();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Discord is not configured.");
    }
  }

  async function handleUnlinkDiscord() {
    onError("");
    setDiscordBusy(true);
    const { error: unlinkError } = await unlinkDiscordAccount();
    setDiscordBusy(false);
    if (unlinkError) onError(unlinkError);
    else {
      await refreshProfile();
      onSuccess("Discord unlinked.");
    }
  }

  return (
    <section className="settings__section">
      <h2 className="settings__section-title">Discord</h2>
      <p className="settings__section-desc">
        Link Discord for future rewards, levelling, and server perks when the LottaCash Discord launches.
      </p>

      {profile?.discordId ? (
        <div className="settings__discord">
          <div className="settings__discord-linked">
            {profile.discordAvatar && (
              <img
                src={profile.discordAvatar}
                alt=""
                className="settings__discord-avatar"
                width={48}
                height={48}
              />
            )}
            <div>
              <p className="settings__discord-name">{profile.discordUsername}</p>
              <p className="settings__discord-status">Connected</p>
            </div>
          </div>
          <div className="settings__btn-row">
            <button
              type="button"
              className="settings__btn settings__btn--ghost"
              onClick={handleUnlinkDiscord}
              disabled={discordBusy}
            >
              Unlink Discord
            </button>
          </div>
        </div>
      ) : (
        <div className="settings__discord">
          <p className="settings__hint settings__hint--flex">
            No Discord account linked yet.
          </p>
          <button
            type="button"
            className="settings__btn settings__btn--discord"
            onClick={handleLinkDiscord}
            disabled={discordBusy || !isDiscordConfigured}
          >
            {discordBusy ? "Linking…" : "Link Discord"}
          </button>
        </div>
      )}
      {!isDiscordConfigured && (
        <p className="settings__hint settings__hint--top">
          Add <code>VITE_DISCORD_CLIENT_ID</code> to your <code>.env</code> and deploy the <code>link-discord</code> Edge Function with Discord secrets.
        </p>
      )}
    </section>
  );
}
