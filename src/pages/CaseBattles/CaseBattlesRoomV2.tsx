/**
 * Case Battles v2 — Room (battle view)
 * Uses realtime subscription. No polling.
 */

import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { Seo } from "../../components/Seo/Seo";
import { useBattleSubscription } from "./useBattleSubscription";
import { CaseBattleArenaV2 } from "./CaseBattleArenaV2";
import {
  joinCaseBattle,
  addBotToBattle,
  startCaseBattle,
  checkEosBlock,
  claimPayout,
  calculatePayoutForSlot,
} from "./caseBattlesApi";
import { gamemodeLabelWithCrazy } from "./types";
import { formatCoins } from "../../lib/format";
import "./CaseBattlesV2.css";

const EOS_POLL_MS = 2000;

export function CaseBattlesRoomV2() {
  const { battleId } = useParams();
  const { user } = useAuth();
  const { refreshProfile } = useProfile();
  const { battle, loading, error } = useBattleSubscription(battleId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const eosPollRef = useRef<number>(0);

  // Poll EOS block while status = 'committing'.
  // M8 (UI/UX audit): use a recursive setTimeout pattern instead of setInterval
  // so a slow response doesn't cause overlapping polls (which cause jank on
  // slow connections). The next poll is scheduled only after the current one
  // resolves. Also pauses when the tab is hidden — no point burning requests
  // the user can't see.
  useEffect(() => {
    if (!battle || battle.status !== "committing") return;

    let cancelled = false;
    let consecutiveErrors = 0;

    const poll = async () => {
      if (cancelled) return;
      // Pause when tab is hidden — resume on visibility change.
      if (typeof document !== "undefined" && document.hidden) {
        eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
        return;
      }
      const { data, error: err } = await checkEosBlock(battle.battleId);
      if (cancelled) return;
      if (err) {
        // Silently retry — EOS RPC can be flaky. Exponential backoff after
        // 3 consecutive errors to avoid hammering a dead endpoint.
        consecutiveErrors++;
        const delay = consecutiveErrors > 3
          ? Math.min(EOS_POLL_MS * 2 ** (consecutiveErrors - 3), 30_000)
          : EOS_POLL_MS;
        eosPollRef.current = window.setTimeout(poll, delay);
        return;
      }
      consecutiveErrors = 0;
      if (data?.ready) {
        // The realtime subscription will pick up the status change.
        // No need to keep polling — the component will re-render via the
        // subscription and this effect will tear down (status !== 'committing').
        return;
      }
      eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
    };

    eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(eosPollRef.current);
    };
  }, [battle?.battleId, battle?.status]);

  if (!battleId) return <Navigate to="/case-battles" replace />;
  if (loading) {
    return (
      <div className="cb-room lc-page">
        <div className="lc-loading">
          <div className="lc-loading__pulse" aria-hidden />
          <p>Loading battle…</p>
        </div>
      </div>
    );
  }
  if (error || !battle) {
    return (
      <div className="cb-room lc-page">
        <div className="cb-room__error">
          <p role="alert">{error ?? "Battle not found."}</p>
          <Link to="/case-battles" className="lc-btn lc-btn--ghost">Back to battles</Link>
        </div>
      </div>
    );
  }

  const isCreator = battle.creatorId === user?.id;
  const myPlayer = battle.players.find((p) => p.userId === user?.id);
  const isWaiting = battle.status === "waiting";
  const isCompleted = battle.status === "completed";
  const canStart = isWaiting && isCreator && battle.players.length >= battle.maxPlayers;
  const canJoin = isWaiting && !myPlayer;
  const canAddBot = isWaiting && isCreator && battle.players.length < battle.maxPlayers;
  const myPayout = myPlayer ? calculatePayoutForSlot(battle, myPlayer.slot) : 0;
  const canClaim = isCompleted && myPayout > 0 && !claimed;

  async function handleJoin() {
    setBusy(true);
    setActionError(null);
    const { error: err } = await joinCaseBattle(battleId!);
    setBusy(false);
    if (err) setActionError(err);
  }

  async function handleAddBot() {
    setBusy(true);
    setActionError(null);
    const { error: err } = await addBotToBattle(battleId!);
    setBusy(false);
    if (err) setActionError(err);
  }

  async function handleStart() {
    setBusy(true);
    setActionError(null);
    const { error: err } = await startCaseBattle(battleId!);
    setBusy(false);
    if (err) setActionError(err);
  }

  async function handleClaim() {
    if (!myPlayer || !battle) return;
    setBusy(true);
    setActionError(null);
    const { error: err } = await claimPayout(battleId!, myPlayer.slot);
    setBusy(false);
    if (err) {
      setActionError(err);
    } else {
      setClaimed(true);
      void refreshProfile();
    }
  }

  return (
    <div className="cb-room lc-page">
      <Seo
        title={`${formatCoins(battle.potTotal, battle.coinType)} pot · ${battle.playerMode.toUpperCase()} ${gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}`}
        description="Live Case Battle room. Watch the reels spin in real time."
        path={`/case-battles/${battleId}`}
      />

      {/* Top bar */}
      <div className="cb-room__topbar">
        <Link to="/case-battles" className="cb-room__back">← Battles</Link>
        <div className="cb-room__info">
          <span className="cb-room__mode">{gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}</span>
          <span className="cb-room__pmode">{battle.playerMode.toUpperCase()}</span>
          <span className="cb-room__pot">Pot: {formatCoins(battle.potTotal, battle.coinType)}</span>
          <span className={`cb-room__coin-badge cb-room__coin-badge--${battle.coinType}`}>
            {battle.coinType === "sweeps_coins" ? "SC" : "GC"}
          </span>
        </div>
      </div>

      {actionError && <p className="cb-room__action-error" role="alert">{actionError}</p>}

      {/* Action buttons for waiting state */}
      {isWaiting && (
        <div className="cb-room__actions">
          {canJoin && (
            <button type="button" className="cb-btn cb-btn--primary" onClick={handleJoin} disabled={busy}>
              Join battle ({formatCoins(battle.entryCost, battle.coinType)})
            </button>
          )}
          {canAddBot && (
            <button type="button" className="cb-btn cb-btn--ghost" onClick={handleAddBot} disabled={busy}>
              Add bot
            </button>
          )}
          {canStart && (
            <button type="button" className="cb-btn cb-btn--primary" onClick={handleStart} disabled={busy}>
              Start battle
            </button>
          )}
          {isCreator && !canStart && battle.players.length < battle.maxPlayers && (
            <p className="cb-room__hint">Need all {battle.maxPlayers} slots filled to start. Add bots!</p>
          )}
        </div>
      )}

      {/* Claim button for completed state */}
      {canClaim && (
        <div className="cb-room__claim">
          <button type="button" className="cb-btn cb-btn--primary cb-btn--claim" onClick={handleClaim} disabled={busy}>
            {busy ? "Claiming…" : `Claim ${formatCoins(myPayout, battle.coinType)}`}
          </button>
        </div>
      )}
      {claimed && (
        <div className="cb-room__claimed">
          <p>Payout claimed! Your balance has been updated.</p>
        </div>
      )}

      {/* Arena */}
      <CaseBattleArenaV2 battle={battle} userId={user?.id} />

      {/* Provably-fair panel — inline collapsible under the arena so it
          doesn't disturb gameplay but stays one click away. Shows the
          commit hash / EOS block binding / battle seed. */}
      <details className="cb-fairness" data-testid="cb-fairness">
        <summary>Provably fair</summary>
        <div className="cb-fairness__body">
          <p>
            <span className="cb-fairness__k">Server seed (hash)</span>
            <code className="cb-fairness__hash">{battle.seedHash ?? "—"}</code>
          </p>
          <p>
            <span className="cb-fairness__k">EOS target block</span>
            <code>{battle.eosBlockTarget?.toLocaleString() ?? "—"}</code>
          </p>
          {isCompleted && (
            <>
              <p>
                <span className="cb-fairness__k">EOS block ID</span>
                <code className="cb-fairness__hash">{battle.eosBlockId ?? "—"}</code>
              </p>
              <p>
                <span className="cb-fairness__k">Battle seed (revealed)</span>
                <code className="cb-fairness__hash">{battle.battleSeed ?? "—"}</code>
              </p>
            </>
          )}
          {!isCompleted && (
            <p className="cb-fairness__note">
              The revealed seed is published here once the battle completes —
              you can then verify every drop against HMAC-SHA256(server seed, nonce).
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
