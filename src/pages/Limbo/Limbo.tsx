import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import {
  LIMBO_MAX_TARGET,
  LIMBO_MIN_TARGET,
  limboWinChance,
} from "../../lib/games/limbo";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
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
const HISTORY_MAX = 10;

type HistoryEntry = { result: number; won: boolean };

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
  const [showResult, setShowResult] = useState(true);
  const [popIn, setPopIn] = useState(false);
  const [displayMult, setDisplayMult] = useState(1);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastResult, setLastResult] = useState<{
    result: number;
    won: boolean;
    payout: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");

  const winChance = useMemo(() => limboWinChance(target), [target]);
  const potentialWin = useMemo(
    () => Math.round(wager * target * 100) / 100,
    [wager, target]
  );

  const activeBalance =
    coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);

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

  const applyWager = (value: number) => {
    const v = Math.max(0.01, Math.min(100_000, value));
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
    if (!user) {
      setError("Log in to play.");
      return;
    }
    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastResult(null);
    setRolling(true);
    setShowResult(false);
    setPopIn(false);

    const startedAt = Date.now();
    const { data, error: betErr } = await placeLimboBet({ wager, target, coinType });
    if (betErr || !data) {
      setRolling(false);
      setShowResult(true);
      setError(betErr ?? "Bet failed.");
      return;
    }

    const remaining = Math.max(0, REVEAL_DELAY_MS - (Date.now() - startedAt));
    await wait(remaining);

    setDisplayMult(data.resultMultiplier);
    setShowResult(true);
    setPopIn(true);
    setRolling(false);
    setLastResult({
      result: data.resultMultiplier,
      won: data.won,
      payout: data.payout,
    });
    setHistory((h) =>
      [{ result: data.resultMultiplier, won: data.won }, ...h].slice(0, HISTORY_MAX)
    );
    setPfNonce(data.nonce + 1);
    await refreshProfile();

    window.setTimeout(() => setPopIn(false), POP_DURATION_MS);
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
    <div className="game-page limbo">
      <header className="game-header">
        <h1 className="game-header__title">Limbo</h1>
        <span className="game-header__rtp">99% RTP</span>
        <span className="game-header__spacer" />
        <button
          type="button"
          className={`game-header__panel-toggle${panelOpen ? " game-header__panel-toggle--open" : ""}`}
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Toggle stats panel"
          aria-expanded={panelOpen}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </button>
      </header>

      <div className="game-stage">
        <div
          className={`limbo__display${rolling ? " limbo__display--rolling" : ""}${lastResult?.won ? " limbo__display--win" : lastResult && !lastResult.won ? " limbo__display--loss" : ""}`}
          aria-live="polite"
        >
          <span className="limbo__display-label">Result multiplier</span>
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
          <div className="limbo__display-meta">
            <span className="limbo__display-target">
              Target {formatMultiplier(target)}×
            </span>
            <span className="limbo__display-chance">
              Win chance {(winChance * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {panelOpen && (
        <div className="game-panel" role="complementary" aria-label="Limbo stats">
          <div className="game-panel__head">
            <h2 className="game-panel__title">Round info</h2>
            <button
              type="button"
              className="game-panel__close"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {lastResult && !rolling && (
            <div className="game-panel__section">
              <h3 className="game-panel__section-title">Last roll</h3>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Result</span>
                <span
                  className={`game-panel__row-value${
                    lastResult.won
                      ? " game-panel__row-value--win"
                      : " game-panel__row-value--loss"
                  }`}
                >
                  {formatMultiplier(lastResult.result)}×
                </span>
              </div>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Payout</span>
                <span
                  className={`game-panel__row-value${
                    lastResult.won
                      ? " game-panel__row-value--win"
                      : " game-panel__row-value--loss"
                  }`}
                >
                  {lastResult.won
                    ? formatCoins(lastResult.payout, coinType)
                    : "No win"}
                </span>
              </div>
            </div>
          )}

          <div className="game-panel__section">
            <h3 className="game-panel__section-title">History</h3>
            {history.length > 0 ? (
              <div className="limbo__history" aria-label="Recent results">
                {history.map((h, i) => (
                  <span
                    key={`${h.result}-${i}`}
                    className={`limbo__history-chip${h.won ? " limbo__history-chip--win" : " limbo__history-chip--loss"}`}
                    title={`${formatMultiplier(h.result)}× — ${h.won ? "win" : "loss"}`}
                  >
                    {formatMultiplier(h.result)}×
                  </span>
                ))}
              </div>
            ) : (
              <p className="game-history__empty">No rolls yet.</p>
            )}
          </div>

          <div className="game-panel__section game-panel__section--bare">
            <details className="game-fair">
              <summary className="game-fair__summary">Provably Fair</summary>
              <div className="game-fair__body">
                <div className="game-fair__row">
                  <span className="game-fair__k">Server seed (hash)</span>
                  <code className="game-fair__code">{pfHash ?? "…"}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Next nonce</span>
                  <code className="game-fair__code">{pfNonce}</code>
                </div>
                <div className="game-fair__row">
                  <span className="game-fair__k">Client seed</span>
                  <input
                    type="text"
                    className="game-fair__input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={rolling}
                  />
                </div>
                <button
                  type="button"
                  className="game-fair__save"
                  onClick={saveClientSeed}
                  disabled={rolling}
                >
                  Save client seed
                </button>
                <p className="game-fair__note">
                  HMAC-SHA256 → 4-byte float → 2²⁴/(n+1)×0.99 — 94.5% RTP via win odds.
                </p>
              </div>
            </details>
          </div>

          <p className="game-actionbar__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>
        </div>
      )}

      <div className="game-actionbar">
        <div className="game-actionbar__balance">
          <span className="game-actionbar__balance-label">{coinLabel}</span>
          <span className="game-actionbar__balance-value">{formatCoins(activeBalance, coinType)}</span>
          <span className="game-actionbar__balance-usd">{formatUsd(coinsToUsd(activeBalance, coinType))}</span>
        </div>

        <div className="limbo__target">
          <span className="limbo__target-label">Target</span>
          <input
            id="limbo-target"
            type="text"
            inputMode="decimal"
            className="limbo__target-input"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            onBlur={() => {
              const parsed = parseFloat(targetInput.replace(/,/g, ""));
              applyTarget(Number.isFinite(parsed) ? parsed : LIMBO_MIN_TARGET);
            }}
            disabled={rolling}
            aria-label="Target multiplier"
          />
        </div>

        <div className="game-actionbar__wager">
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager / 2)}
            disabled={rolling}
            aria-label="Half bet"
          >
            ½
          </button>
          <input
            id="limbo-wager"
            type="text"
            inputMode="decimal"
            className="game-actionbar__input"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            onBlur={() => {
              const parsed = parseFloat(wagerInput.replace(/,/g, ""));
              applyWager(Number.isFinite(parsed) ? parsed : 0.01);
            }}
            disabled={rolling}
            aria-label="Bet amount"
          />
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager * 2)}
            disabled={rolling}
            aria-label="Double bet"
          >
            2×
          </button>
        </div>

        <div className="game-actionbar__presets">
          {TARGET_PRESETS.map((t) => (
            <button
              key={t}
              type="button"
              className={`game-actionbar__preset${target === t ? " game-actionbar__preset--active" : ""}`}
              onClick={() => applyTarget(t)}
              disabled={rolling}
            >
              {t}×
            </button>
          ))}
        </div>

        <button
          type="button"
          className="game-actionbar__play"
          onClick={handleBet}
          disabled={rolling || !user}
          aria-busy={rolling}
        >
          {rolling ? "Rolling…" : `Play · ${formatCoins(potentialWin, coinType)}`}
        </button>

        {error && <p className="game-actionbar__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
