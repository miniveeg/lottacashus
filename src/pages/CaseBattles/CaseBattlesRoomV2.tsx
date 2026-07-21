/**
 * Case Battles v2 — Room (battle view)
 * Uses realtime subscription. No polling.
 *
 * Per-slot "+ Add bot here" buttons live in the arena itself
 * (CaseBattleArenaV2 → `.cb-slot__add-bot`); this component no longer
 * exposes a global Add-bot action. The creator fills any empty slot by
 * clicking it in the waiting-state slot grid, and the auto-start fires
 * once all slots are filled.
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
  startCaseBattle,
  checkEosBlock,
  claimPayout,
  calculatePayoutForSlot,
} from "./caseBattlesApi";
import { gamemodeLabelWithCrazy } from "./types";
import { formatCoins } from "../../lib/format";
import { entryAfterBorrow } from "../../lib/games/case-battles/config";
import "./CaseBattlesV2.css";

const EOS_POLL_MS = 2000;

export function CaseBattlesRoomV2() {
  const { battleId } = useParams();
  const { user } = useAuth();
  const { refreshProfile } = useProfile();
  const { battle, loading, error } = useBattleSubscription(battleId);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const eosPollRef = useRef<number>(0);
  // Auto-start guard — fires once when all slots fill so the user never
  // has to click Start manually (per the product spec). Reset on failures
  // so the creator can retry on the next render.
  const autoStartedRef = useRef(false);

  // Poll EOS block while status = 'committing'. Recursive setTimeout instead
  // of setInterval so a slow response cannot overlap a pending poll (audit M8).
  // Pauses when the tab is hidden.
  useEffect(() => {
    if (!battle || battle.status !== "committing") return;

    let cancelled = false;
    let consecutiveErrors = 0;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
        return;
      }
      const { data, error: err } = await checkEosBlock(battle.battleId);
      if (cancelled) return;
      if (err) {
        consecutiveErrors++;
        const delay = consecutiveErrors > 3
          ? Math.min(EOS_POLL_MS * 2 ** (consecutiveErrors - 3), 30_000)
          : EOS_POLL_MS;
        eosPollRef.current = window.setTimeout(poll, delay);
        return;
      }
      consecutiveErrors = 0;
      if (data?.ready) return;
      eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
    };

    eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(eosPollRef.current);
    };
  }, [battle?.battleId, battle?.status]);

  // Auto-start the battle the moment every slot is filled while we are
  // still in `waiting`. We do this from a useEffect (rather than from the
  // click handlers) so a late-joining human also triggers the start without
  // needing the creator to be present. Idempotent via `autoStartedRef`.
  //
  // AUDIT FIX (React #310): This useEffect MUST be invoked unconditionally
  // on every render (same hook position as the EOS-poll useEffect above).
  // It previously sat AFTER the three early returns (`!battleId` /
  // `loading` / `error || !battle`), which meant `useBattleSubscription`
  // transitioned from loading=true (9 hooks) to loading=false + battle set
  // (10 hooks) and React threw "Rendered more hooks than during the
  // previous render" (#310), crashing the page mid-navigation from
  // /case-battles/create → /case-battles/:battleId. All guards are now
  // `return` statements INSIDE the effect, so the hook count is constant.
  useEffect(() => {
    if (!battle) return;
    if (battle.status !== "waiting") return;
    if (autoStartedRef.current) return;
    if (battle.players.length < battle.maxPlayers) return;
    // Only the creator can flip waiting → committing. If the creator isn't
    // present (e.g. they left after filling with bots), the start RPC will
    // 403 — we surface the error and let the creator retry on rejoin.
    if (battle.creatorId !== user?.id) return;
    autoStartedRef.current = true;
    void startCaseBattle(battle.battleId).then(({ error: err }) => {
      if (err) {
        autoStartedRef.current = false; // allow a future re-attempt
        setActionError(err);
      }
    });
  }, [battle?.status, battle?.players.length, battle?.maxPlayers, battle?.creatorId, battle?.battleId, user?.id]);

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
  const myPayout = myPlayer ? calculatePayoutForSlot(battle, myPlayer.slot) : 0;
  const alreadyClaimed = claimed || Boolean(myPlayer?.claimedAt);
  const canClaim = isCompleted && myPayout > 0 && !alreadyClaimed;
  const joinCharge = entryAfterBorrow(battle.entryCost, battle.borrowPercent);

  async function handleJoin() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const { error: err } = await joinCaseBattle(battleId!);
    busyRef.current = false;
    setBusy(false);
    if (err) setActionError(err);
  }

  async function handleStart() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const { error: err } = await startCaseBattle(battleId!);
    busyRef.current = false;
    setBusy(false);
    if (err) setActionError(err);
  }

  async function handleClaim() {
    if (!myPlayer || !battle || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const { error: err } = await claimPayout(battleId!, myPlayer.slot);
    busyRef.current = false;
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

      {/* Action buttons for the waiting state — the arena renders per-slot
          "+ Add bot here" buttons, which feed slot-fill auto-start. The
          room keeps Join (for non-creators) + Start (once all slots full). */}
      {isWaiting && (
        <div className="cb-room__actions">
          {canJoin && (
            <button type="button" className="cb-btn cb-btn--primary" onClick={handleJoin} disabled={busy}>
              Join battle ({formatCoins(joinCharge, battle.coinType)}
              {battle.borrowPercent > 0 ? ` after ${battle.borrowPercent}% borrow` : ""})
            </button>
          )}
          {canStart && (
            <button type="button" className="cb-btn cb-btn--primary" onClick={handleStart} disabled={busy}>
              Start battle
            </button>
          )}
          {isCreator && !canStart && battle.players.length < battle.maxPlayers && (
            <p className="cb-room__hint">
              Click <strong>+ Add bot</strong> on any empty slot below to fill it.
              Battle auto-starts when all {battle.maxPlayers} slots are filled.
            </p>
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
      {alreadyClaimed && isCompleted && myPayout > 0 && (
        <div className="cb-room__claimed">
          <p>Payout claimed! Your balance has been updated.</p>
        </div>
      )}

      {/* Arena — pass isCreator so the waiting branch renders per-slot
          "+ Add bot here" buttons. */}
      <CaseBattleArenaV2 battle={battle} userId={user?.id} isCreator={isCreator} />

      {/* Provably-fair panel — inline collapsible under the arena. */}
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
