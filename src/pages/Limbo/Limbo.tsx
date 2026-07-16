import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import {
  LIMBO_MAX_TARGET,
  LIMBO_MIN_TARGET,
  LIMBO_MAX_PAYOUT,
  limboWinChance,
} from "../../lib/games/limbo";
import { formatCoins } from "../../lib/format";
import {
  fetchLimboPfState,
  placeLimboBet,
  setLimboClientSeed,
} from "../../lib/limbo";
import "../../styles/game-controls.css";
import "./Limbo.css";

const TARGET_PRESETS = [1.5, 2, 3, 5, 10, 25, 50, 100];
const REVEAL_DELAY_MS = 1500;
const POP_DURATION_MS = 600;
const HISTORY_MAX = 8;

// L15 (UI/UX audit): history entries include a monotonic id so React keys
// don't collide when two consecutive rounds have the same result multiplier
// (the prior `key={`${h.result}-${i}`}` could collide after rotation).
type HistoryEntry = { id: number; result: number; won: boolean };

function formatMultiplier(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toFixed(2);
}

function clampTarget(value: number): number {
  return Math.min(LIMBO_MAX_TARGET, Math.max(LIMBO_MIN_TARGET, value));
}

export function Limbo() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [target, setTarget] = useState(2);
  const [targetInput, setTargetInput] = useState("2.00");
  const [rolling, setRolling] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [popIn, setPopIn] = useState(false);
  const [displayMult, setDisplayMult] = useState(1);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Monotonic counter for HistoryEntry.id — bumped each time a new entry is
  // pushed so React keys are stable across rotations.
  const historyIdRef = useRef(0);
  const [lastResult, setLastResult] = useState<{
    result: number;
    won: boolean;
    payout: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  // Refs for race-safety (rollingRef) and async cleanup (cancelledRef,
  // popInTimeoutRef). Mirrors the KENO_MINES agent's busyRef/cancelledRef pattern.
  const rollingRef = useRef(false);
  const cancelledRef = useRef(false);
  const popInTimeoutRef = useRef<number | null>(null);

  const winChance = useMemo(() => limboWinChance(target), [target]);
  const potentialWin = useMemo(
    () => Math.round(wager * target * 100) / 100,
    [wager, target]
  );
  /** True when wager × target would exceed the max-payout cap. The bet
   *  button is disabled and a notice is shown so the player understands
   *  why. The server enforces the same cap — this is just UX. */
  const exceedsMaxPayout = potentialWin > LIMBO_MAX_PAYOUT;

  const loadPf = useCallback(async () => {
    const { data } = await fetchLimboPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  useEffect(() => {
    if (user) loadPf();
  }, [user, loadPf]);

  // Unmount cleanup: cancel any pending popIn timeout and mark the component
  // cancelled so in-flight bet/reveal awaits don't fire setState on a dead
  // component (React 19 silently no-ops, but this prevents the leak).
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      rollingRef.current = false;
      if (popInTimeoutRef.current !== null) {
        window.clearTimeout(popInTimeoutRef.current);
        popInTimeoutRef.current = null;
      }
    };
  }, []);

  const applyWager = (value: number) => {
    const maxBet = coinType === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(1, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const applyTarget = (value: number) => {
    const v = clampTarget(value);
    setTarget(v);
    setTargetInput(v.toFixed(2));
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const handleBet = async () => {
    // Synchronous re-entrancy guard — the Bet button's `disabled={rolling}`
    // prop relies on a re-render cycle that leaves a sub-ms race window
    // between the first click's setRolling(true) commit and a second click.
    if (rollingRef.current) return;
    const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    rollingRef.current = true;
    setError(null);
    setLastResult(null);
    setRolling(true);
    setShowResult(false);
    setPopIn(false);
    if (popInTimeoutRef.current !== null) {
      window.clearTimeout(popInTimeoutRef.current);
      popInTimeoutRef.current = null;
    }

    const startedAt = Date.now();
    const { data, error: betErr } = await placeLimboBet({ wager, target, coinType });
    if (betErr || !data) {
      if (cancelledRef.current) return;
      rollingRef.current = false;
      setRolling(false);
      // Do NOT call setShowResult(true) here — that would display a fake
      // "1.00×" result (the default displayMult) as if a round had resolved.
      // On error we only surface the error message and reset the board so the
      // player can retry. Previously this set showResult=true, making a loss
      // look like a played round when no round happened.
      setError(betErr ?? "Bet failed.");
      // Server may have debited before failing — refresh to stay accurate.
      void refreshProfile();
      return;
    }

    const remaining = Math.max(0, REVEAL_DELAY_MS - (Date.now() - startedAt));
    await wait(remaining);

    if (cancelledRef.current) {
      rollingRef.current = false;
      return;
    }

    setDisplayMult(data.resultMultiplier);
    setShowResult(true);
    setPopIn(true);
    setRolling(false);
    rollingRef.current = false;
    setLastResult({
      result: data.resultMultiplier,
      won: data.won,
      payout: data.payout,
    });
    setHistory((h) =>
      [{ id: ++historyIdRef.current, result: data.resultMultiplier, won: data.won }, ...h].slice(0, HISTORY_MAX)
    );
    setPfNonce(data.nonce + 1);

    // Schedule the popIn reset immediately so the animation duration is fixed.
    // Cleared on unmount.
    popInTimeoutRef.current = window.setTimeout(() => {
      popInTimeoutRef.current = null;
      if (!cancelledRef.current) setPopIn(false);
    }, POP_DURATION_MS);

    // No refreshProfile() here — ProfileContext's realtime subscription on
    // `profiles` pushes the new balance the instant the server commits the
    // bet. Calling it would fire 2 redundant RPCs (ensure_user_profile +
    // is_current_user_admin) per bet.
  };

  const saveClientSeed = async () => {
    const { error: seedErr } = await setLimboClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  return (
    <div className="limbo lc-game-page">
      <Seo
        title="Limbo"
        description="Name your target multiplier. If the roll beats it, you win. The higher you go, the longer the odds. Provably fair, 96.5% RTP."
        path="/limbo"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Limbo</h1>
        <p className="lc-page__subtitle">
          Set a target multiplier. If the round result is equal or higher, you win bet × target.
          Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="limbo__layout">
        <section className="limbo__stage-panel">
          {/* Limbo — clean animated rocket/multiplier visual */}
          <div className={`limbo__rocket-stage${rolling ? " limbo__rocket-stage--rolling" : ""}${lastResult?.won ? " limbo__rocket-stage--win" : lastResult && !lastResult.won ? " limbo__rocket-stage--loss" : ""}`} aria-hidden="true">
            <svg className="limbo__rocket-svg" viewBox="0 0 320 160" xmlns="http://www.w3.org/2000/svg">
              {/* Animated grid lines */}
              <line x1="0" y1="140" x2="320" y2="140" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
              <line x1="0" y1="100" x2="320" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              <line x1="0" y1="60" x2="320" y2="60" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
              {/* Target bar */}
              <g className="limbo__target-bar">
                <line x1="20" y1="90" x2="300" y2="90" stroke={lastResult?.won ? "#22c55e" : lastResult && !lastResult.won ? "#ef4444" : "rgba(245,185,66,0.7)"} strokeWidth="2" strokeDasharray="8 4"/>
                <text x="304" y="94" fill={lastResult?.won ? "#22c55e" : lastResult && !lastResult.won ? "#ef4444" : "rgba(245,185,66,0.85)"} fontSize="10" fontWeight="700" fontFamily="monospace">{target.toFixed(2)}×</text>
              </g>
              {/* Rocket */}
              <g className={`limbo__rocket${rolling ? " limbo__rocket--flying" : ""}${lastResult?.won ? " limbo__rocket--win" : lastResult && !lastResult.won ? " limbo__rocket--loss" : ""}`}>
                {/* Flame */}
                <ellipse cx="160" cy="138" rx="7" ry="12" fill="rgba(251,146,60,0.85)" className="limbo__flame"/>
                <ellipse cx="160" cy="136" rx="4" ry="7" fill="rgba(253,224,71,0.9)" className="limbo__flame-inner"/>
                {/* Body */}
                <ellipse cx="160" cy="112" rx="12" ry="20" fill="rgba(255,255,255,0.9)"/>
                <ellipse cx="160" cy="95" rx="8" ry="10" fill="rgba(200,210,255,0.95)"/>
                {/* Window */}
                <circle cx="160" cy="108" r="5" fill="rgba(100,160,255,0.8)" stroke="rgba(255,255,255,0.5)" strokeWidth="1"/>
                {/* Fins */}
                <polygon points="148,128 140,142 148,135" fill="rgba(220,220,240,0.8)"/>
                <polygon points="172,128 180,142 172,135" fill="rgba(220,220,240,0.8)"/>
              </g>
            </svg>
          </div>

          <div
            className={`limbo__display${rolling ? " limbo__display--rolling" : ""}${lastResult?.won ? " limbo__display--win" : lastResult && !lastResult.won ? " limbo__display--loss" : ""}`}
            aria-live="polite"
          >
            <span className="limbo__display-label">Result</span>
            <span
              className={[
                "limbo__display-value",
                showResult && popIn && "limbo__display-value--pop",
                !showResult && "limbo__display-value--waiting",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {showResult ? `${formatMultiplier(displayMult)}×` : "···"}
            </span>
            <span className="limbo__display-target">
              Target {formatMultiplier(target)}×
            </span>
          </div>

          {lastResult && !rolling && (
            <div
              className={`limbo__outcome${lastResult.won ? " limbo__outcome--win" : " limbo__outcome--loss"}`}
              role="status"
              aria-live="polite"
            >
              {lastResult.won ? (
                <p>
                  Hit <strong>{formatMultiplier(lastResult.result)}×</strong> — won{" "}
                  <strong>{formatCoins(lastResult.payout, coinType)}</strong>
                </p>
              ) : (
                <p>
                  Landed <strong>{formatMultiplier(lastResult.result)}×</strong> — below target
                </p>
              )}
            </div>
          )}

          {history.length > 0 && (
            <div className="limbo__history" aria-label="Recent results">
              {history.map((h) => (
                <span
                  key={h.id}
                  className={`limbo__history-chip${h.won ? " limbo__history-chip--win" : " limbo__history-chip--loss"}`}
                  title={`${formatMultiplier(h.result)}× — ${h.won ? "win" : "loss"}`}
                >
                  {formatMultiplier(h.result)}×
                </span>
              ))}
            </div>
          )}
        </section>

        <aside className="limbo__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <label className="game-controls__option-label" htmlFor="limbo-target">
                Target multiplier
              </label>
              <input
                id="limbo-target"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(targetInput.replace(/,/g, ""));
                  applyTarget(Number.isFinite(parsed) ? parsed : LIMBO_MIN_TARGET);
                }}
                disabled={rolling}
              />
              <div className="game-controls__presets limbo__target-presets">
                {TARGET_PRESETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`game-controls__preset${target === t ? " game-controls__preset--active" : ""}`}
                    onClick={() => applyTarget(t)}
                    disabled={rolling}
                  >
                    {t}×
                  </button>
                ))}
              </div>
              <p className="game-controls__option-hint">
                Win chance ≈ {(winChance * 100).toFixed(2)}% · Payout {formatCoins(potentialWin, coinType)}
              </p>
              {exceedsMaxPayout && (
                <p className="game-controls__option-hint game-controls__option-hint--warn" role="note">
                  Max payout is {formatCoins(LIMBO_MAX_PAYOUT, coinType)}. Lower your wager or target.
                </p>
              )}
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="limbo-wager">
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="limbo-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
                }}
                disabled={rolling}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={rolling}
                aria-label="Half bet"
              >
                ½
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(wager * 2, activeBalance));
                }}
                disabled={rolling}
                aria-label="Double bet"
              >
                2×
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(coinType === "sweeps_coins" ? 100_000 : 10_000_000, activeBalance));
                }}
                disabled={rolling}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          <BetButton
            onClick={handleBet}
            busy={rolling}
            exceedsCap={exceedsMaxPayout}
            busyLabel="Rolling…"
            exceedsCapLabel="Payout exceeds cap"
            label="Bet"
          />

          <NeedFundsHint />

          <div className="limbo__fairness">
            <button
              type="button"
              className="limbo__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
            
              aria-expanded={showFairness}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="limbo__fairness-body">
                <p>
                  <span className="limbo__fairness-k">Server seed (hash)</span>
                  <code className="limbo__hash">{pfHash ?? "…"}</code>
                </p>
                <p>
                  <span className="limbo__fairness-k">Next nonce</span>
                  <code>{pfNonce}</code>
                </p>
                <label className="limbo__seed-label">
                  Client seed
                  <input
                    type="text"
                    className="limbo__seed-input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={rolling}
                  />
                </label>
                <button type="button" className="limbo__tool-btn" onClick={saveClientSeed} disabled={rolling}>
                  Save client seed
                </button>
                <p className="limbo__fairness-note">
                  HMAC-SHA256 → 4-byte float → 2²⁴/(n+1)×0.99 — 96.5% RTP via win odds.
                </p>
                <p className="limbo__fairness-note limbo__fairness-note--disclosure">
                  RTP disclosure: the raw roll targets ~99% RTP; a deterministic
                  bias roll (same seeds) downgrades ~2.5% of would-be wins to
                  enforce the displayed 96.5% RTP. Verifiable after seed rotation.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
