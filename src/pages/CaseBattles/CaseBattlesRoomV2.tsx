/**
 * Case Battles — Room
 * Phases: wait → committing(EOS) → opening → result.
 * SessionRefs + busy guards (Crash/Blackjack pattern). Leave → cb_leave_battle.
 * Claim uses stored payout_amount only.
 */
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { Seo } from "../../components/Seo/Seo";
import { useCanPlay } from "../../lib/canPlay";
import { useBattleSubscription } from "./useBattleSubscription";
import { CaseBattleArenaV2 } from "./CaseBattleArenaV2";
import {
  joinCaseBattle,
  startCaseBattle,
  checkEosBlock,
  claimPayout,
  leaveBattle,
  expectedKeepPot,
} from "./caseBattlesApi";
import { gamemodeLabelWithCrazy, type BattleStatus, type CaseBattleView } from "./types";
import { formatCoins } from "../../lib/format";
import { entryAfterBorrow } from "../../lib/games/case-battles/config";
import "./CaseBattlesV2.css";

const EOS_POLL_MS = 2000;

type RoomPhase = "loading" | "wait" | "committing" | "opening" | "result" | "cancelled" | "error";

type SessionRefs = {
  busy: boolean;
  canPlay: boolean;
  claimed: boolean;
  battle: CaseBattleView | null;
  userId: string | undefined;
  battleId: string | undefined;
  phase: RoomPhase;
};

function phaseFromStatus(status: BattleStatus | undefined): RoomPhase {
  switch (status) {
    case "waiting":
      return "wait";
    case "committing":
      return "committing";
    case "running":
      return "opening";
    case "completed":
      return "result";
    case "cancelled":
      return "cancelled";
    default:
      return "wait";
  }
}

export function CaseBattlesRoomV2() {
  const { battleId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canPlay = useCanPlay();
  const { refreshProfile } = useProfile();
  const { battle, loading, error, refetch } = useBattleSubscription(battleId);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  const eosPollRef = useRef<number>(0);
  const autoStartedRef = useRef(false);
  const cancelledRef = useRef(false);

  const session = useRef<SessionRefs>({
    busy: false,
    canPlay,
    claimed: false,
    battle: null,
    userId: user?.id,
    battleId,
    phase: "loading",
  });

  session.current.busy = busy;
  session.current.canPlay = canPlay;
  session.current.claimed = claimed;
  session.current.battle = battle;
  session.current.userId = user?.id;
  session.current.battleId = battleId;
  session.current.phase = loading
    ? "loading"
    : error || !battle
      ? "error"
      : phaseFromStatus(battle.status);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [battleId]);

  useEffect(() => {
    if (!battle || battle.status !== "committing") return;
    let cancelled = false;
    let consecutiveErrors = 0;

    const poll = async () => {
      if (cancelled || cancelledRef.current) return;
      if (typeof document !== "undefined" && document.hidden) {
        eosPollRef.current = window.setTimeout(poll, EOS_POLL_MS);
        return;
      }
      const { data, error: err } = await checkEosBlock(battle.battleId);
      if (cancelled || cancelledRef.current) return;
      if (err) {
        consecutiveErrors++;
        const delay =
          consecutiveErrors > 3
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

  useEffect(() => {
    if (!battle) return;
    if (battle.status !== "waiting") return;
    if (autoStartedRef.current) return;
    if (battle.players.length < battle.maxPlayers) return;
    if (battle.creatorId !== user?.id) return;
    if (!session.current.canPlay) return;
    autoStartedRef.current = true;
    void startCaseBattle(battle.battleId).then(({ error: err }) => {
      if (err) {
        autoStartedRef.current = false;
        setActionError(err);
      }
    });
  }, [
    battle?.status,
    battle?.players.length,
    battle?.maxPlayers,
    battle?.creatorId,
    battle?.battleId,
    user?.id,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;
      if (session.current.busy) return;
      if (!session.current.canPlay) return;

      const k = e.key.toLowerCase();
      if (k !== " " && k !== "enter") return;

      const b = session.current.battle;
      if (!b) return;
      const myPlayer = b.players.find((p) => p.userId === session.current.userId);
      const isCreator = b.creatorId === session.current.userId;
      const myPayout = myPlayer?.payoutAmount ?? 0;
      const alreadyClaimed = session.current.claimed || Boolean(myPlayer?.claimedAt);

      e.preventDefault();
      if (b.status === "waiting") {
        if (!myPlayer) void handleJoin();
        else if (isCreator && b.players.length >= b.maxPlayers) void handleStart();
        return;
      }
      if (b.status === "completed" && myPayout > 0 && !alreadyClaimed) {
        void handleClaim();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [battleId]);

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
          <Link to="/case-battles" className="lc-btn lc-btn--ghost">
            Back to battles
          </Link>
        </div>
      </div>
    );
  }

  const phase = phaseFromStatus(battle.status);
  const isCreator = battle.creatorId === user?.id;
  const myPlayer = battle.players.find((p) => p.userId === user?.id);
  const isWaiting = battle.status === "waiting";
  const isCompleted = battle.status === "completed";
  const canStart =
    canPlay && isWaiting && isCreator && battle.players.length >= battle.maxPlayers;
  const canJoin = canPlay && isWaiting && !myPlayer;
  // Claim UI: stored payout_amount only — never invent client settlement.
  const myPayout = myPlayer?.payoutAmount ?? 0;
  const alreadyClaimed = claimed || Boolean(myPlayer?.claimedAt);
  const canClaim = canPlay && isCompleted && myPayout > 0 && !alreadyClaimed;
  const canLeave = canPlay && isWaiting && Boolean(myPlayer);
  const joinCharge = entryAfterBorrow(battle.entryCost, battle.borrowPercent);
  const keepPot = expectedKeepPot(battle);

  async function runBusy(fn: () => Promise<void>) {
    if (session.current.busy) return;
    session.current.busy = true;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } finally {
      if (!cancelledRef.current) {
        session.current.busy = false;
        setBusy(false);
      }
    }
  }

  async function handleJoin() {
    if (!session.current.canPlay) return;
    await runBusy(async () => {
      const { error: err } = await joinCaseBattle(battleId!);
      if (err) {
        setActionError(err);
        return;
      }
      // Don't wait on realtime — seats/auto-start need fresh players now.
      await refetch();
    });
  }

  async function handleStart() {
    if (!session.current.canPlay) return;
    await runBusy(async () => {
      const { error: err } = await startCaseBattle(battleId!);
      if (err) setActionError(err);
    });
  }

  async function handleClaim() {
    if (!session.current.canPlay) return;
    const slot = session.current.battle?.players.find(
      (p) => p.userId === session.current.userId,
    )?.slot;
    if (slot === undefined) return;
    await runBusy(async () => {
      const { error: err } = await claimPayout(battleId!, slot);
      if (err) {
        setActionError(err);
      } else {
        setClaimed(true);
        session.current.claimed = true;
        void refreshProfile();
      }
    });
  }

  async function handleLeave() {
    if (!session.current.canPlay) return;
    await runBusy(async () => {
      const { error: err } = await leaveBattle(battleId!);
      if (err) {
        setActionError(err);
        return;
      }
      void refreshProfile();
      navigate("/case-battles");
    });
  }

  return (
    <div className={`cb-room lc-page cb-room--${phase}`}>
      <Seo
        title={`${formatCoins(battle.potTotal, battle.coinType)} pot · ${battle.playerMode.toUpperCase()} ${gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}`}
        description="Live Case Battle room. Watch the reels spin in real time."
        path={`/case-battles/${battleId}`}
      />

      <div className="cb-room__topbar">
        <Link to="/case-battles" className="cb-room__back">
          ← Battles
        </Link>
        <div className="cb-room__info">
          <span className={`cb-phase-pill`} data-phase={phase}>
            {phase === "wait"
              ? "Waiting"
              : phase === "committing"
                ? "EOS commit"
                : phase === "opening"
                  ? "Opening"
                  : phase === "result"
                    ? "Result"
                    : phase === "cancelled"
                      ? "Cancelled"
                      : phase}
          </span>
          <span className="cb-room__mode">
            {gamemodeLabelWithCrazy(battle.gamemode, battle.crazy)}
          </span>
          <span className="cb-room__pmode">{battle.playerMode.toUpperCase()}</span>
          <span className="cb-room__pot">
            Pot: {formatCoins(keepPot, battle.coinType)}
            {battle.borrowPercent > 0 ? ` keep` : ""}
          </span>
          <span className={`lc-chip cb-room__coin-badge cb-room__coin-badge--${battle.coinType}`}>
            {battle.coinType === "sweeps_coins" ? "SC" : "GC"}
          </span>
        </div>
        {canLeave && (
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-room__leave"
            onClick={handleLeave}
            disabled={busy}
          >
            {isCreator ? "Cancel battle" : "Leave"}
          </button>
        )}
      </div>

      {actionError && (
        <p className="cb-room__action-error" role="alert">
          {actionError}
        </p>
      )}

      {battle.status === "cancelled" && (
        <div className="cb-room__cancelled" role="status">
          <p>This battle was cancelled. Entry refunds land on the server.</p>
          <Link to="/case-battles" className="cb-btn cb-btn--ghost">
            Back to lobby
          </Link>
        </div>
      )}

      {isWaiting && (
        <div className="cb-room__actions">
          {canJoin && (
            <button
              type="button"
              className="cb-btn cb-btn--primary"
              onClick={handleJoin}
              disabled={busy}
            >
              Join battle ({formatCoins(joinCharge, battle.coinType)}
              {battle.borrowPercent > 0 ? ` after ${battle.borrowPercent}% borrow` : ""})
            </button>
          )}
          {!canPlay && isWaiting && !myPlayer && (
            <p className="cb-room__hint">Log in to join this battle.</p>
          )}
          {canStart && (
            <button
              type="button"
              className="cb-btn cb-btn--primary"
              onClick={handleStart}
              disabled={busy}
            >
              Start battle
            </button>
          )}
          {isCreator && !canStart && battle.players.length < battle.maxPlayers && canPlay && (
            <p className="cb-room__hint">
              Click <strong>+ Add bot</strong> on any empty seat. Auto-starts at{" "}
              {battle.maxPlayers}/{battle.maxPlayers}.
            </p>
          )}
        </div>
      )}

      {canClaim && (
        <div className="cb-room__claim">
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-btn--claim"
            onClick={handleClaim}
            disabled={busy}
          >
            {busy ? "Claiming…" : `Claim ${formatCoins(myPayout, battle.coinType)}`}
          </button>
        </div>
      )}
      {alreadyClaimed && isCompleted && myPayout > 0 && (
        <div className="cb-room__claimed" role="status">
          <p>Payout claimed. Balance updated from server credit.</p>
        </div>
      )}

      {!busy && canPlay && (canJoin || canStart || canClaim) && (
        <p className="cb-room__hotkey-hint" role="note">
          <kbd>Space</kbd> {canClaim ? "claim" : canStart ? "start" : "join"}
        </p>
      )}

      <CaseBattleArenaV2 battle={battle} userId={user?.id} isCreator={isCreator} refetchBattle={refetch} />

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
              Seed reveals after the battle completes — verify drops with
              HMAC-SHA256(server seed, nonce).
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
