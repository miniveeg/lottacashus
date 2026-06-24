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

  // Poll EOS block while status = 'committing'
  useEffect(() => {
    if (!battle || battle.status !== "committing") return;
    const poll = async () => {
      const { data, error: err } = await checkEosBlock(battle.battleId);
      if (err) {
        // Silently retry — EOS RPC can be flaky
        return;
      }
      if (data?.ready) {
        // The realtime subscription will pick up the status change
      }
    };
    eosPollRef.current = window.setInterval(poll, EOS_POLL_MS);
    return () => window.clearInterval(eosPollRef.current);
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
  const canStart = isWaiting && isCreator && battle.players.length >= 2;
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
    const { error: err } = await claimPayout(battleId!, myPlayer.slot, myPayout);
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
        title={`${formatCoins(battle.potTotal, "balance")} pot · ${battle.playerMode.toUpperCase()} ${gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}`}
        description="Live Case Battle room. Watch the reels spin in real time."
        path={`/case-battles/${battleId}`}
      />

      {/* Top bar */}
      <div className="cb-room__topbar">
        <Link to="/case-battles" className="cb-room__back">← Battles</Link>
        <div className="cb-room__info">
          <span className="cb-room__mode">{gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}</span>
          <span className="cb-room__pmode">{battle.playerMode.toUpperCase()}</span>
          <span className="cb-room__pot">Pot: {formatCoins(battle.potTotal, "balance")}</span>
        </div>
      </div>

      {actionError && <p className="cb-room__action-error" role="alert">{actionError}</p>}

      {/* Action buttons for waiting state */}
      {isWaiting && (
        <div className="cb-room__actions">
          {canJoin && (
            <button type="button" className="cb-btn cb-btn--primary" onClick={handleJoin} disabled={busy}>
              Join battle ({formatCoins(battle.entryCost, "balance")})
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
          {isCreator && !canStart && battle.players.length < 2 && (
            <p className="cb-room__hint">Need at least 2 players to start. Add a bot!</p>
          )}
        </div>
      )}

      {/* Claim button for completed state */}
      {canClaim && (
        <div className="cb-room__claim">
          <button type="button" className="cb-btn cb-btn--primary cb-btn--claim" onClick={handleClaim} disabled={busy}>
            {busy ? "Claiming…" : `Claim ${formatCoins(myPayout, "balance")}`}
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
    </div>
  );
}
