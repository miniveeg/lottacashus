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

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];
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
      <header className="game-page__header">
        <div className="game-page__header-text">
          <h1 className="game-page__title">Limbo</h1>
          <p className="game-page__subtitle">
            Pick a target multiplier. Roll higher to win.
          </p>
        </div>
        <span className="game-page__rtp">99% RTP</span>
      </header>

      <div className="game-page__layout">
        <section className="game-page__stage limbo__stage">
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

          {history.length > 0 && (
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
          )}
        </section>

        <aside className="game-page__controls game-controls">
          <div className="game-page__balance">
            <span className="game-page__balance-label">Balance · {coinLabel}</span>
            <span className="game-page__balance-value">{formatCoins(activeBalance, coinType)}</span>
            <span className="game-page__balance-usd">{formatUsd(coinsToUsd(activeBalance, coinType))}</span>
          </div>

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
              <div className="game-controls__presets">
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
                Payout {formatCoins(potentialWin, coinType)}
              </p>
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="limbo-wager">
              Bet amount · {coinLabel}
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
                  applyWager(Number.isFinite(parsed) ? parsed : 0.01);
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
                onClick={() => applyWager(wager * 2)}
                disabled={rolling}
                aria-label="Double bet"
              >
                2×
              </button>
            </div>
            <div className="game-controls__presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`game-controls__preset${wager === p ? " game-controls__preset--active" : ""}`}
                  onClick={() => applyWager(p)}
                  disabled={rolling}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="game-controls__play"
            onClick={handleBet}
            disabled={rolling || !user}
            aria-busy={rolling}
          >
            {rolling ? "Rolling…" : "Play"}
          </button>

          {error && <p className="game-controls__error" role="alert">{error}</p>}

          {lastResult && !rolling && (
            <div className="game-controls__stats">
              <div className="game-controls__stat-row">
                <span className="game-controls__stat-label">Last roll</span>
                <span
                  className={`game-controls__stat-value${
                    lastResult.won
                      ? " game-controls__stat-value--win"
                      : " game-controls__stat-value--loss"
                  }`}
                >
                  {formatMultiplier(lastResult.result)}× ·{" "}
                  {lastResult.won
                    ? formatCoins(lastResult.payout, coinType)
                    : "No win"}
                </span>
              </div>
            </div>
          )}

          <p className="game-page__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <details className="game-page__fairness">
            <summary>Provably Fair</summary>
            <div className="game-page__fairness-body">
              <div className="game-page__fairness-row">
                <span className="game-page__fairness-k">Server seed (hash)</span>
                <code className="game-page__fairness-code">{pfHash ?? "…"}</code>
              </div>
              <div className="game-page__fairness-row">
                <span className="game-page__fairness-k">Next nonce</span>
                <code className="game-page__fairness-code">{pfNonce}</code>
              </div>
              <div className="game-page__fairness-row">
                <span className="game-page__fairness-k">Client seed</span>
                <input
                  type="text"
                  className="game-page__fairness-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={rolling}
                />
              </div>
              <button
                type="button"
                className="game-page__fairness-save"
                onClick={saveClientSeed}
                disabled={rolling}
              >
                Save client seed
              </button>
              <p className="game-page__fairness-note">
                HMAC-SHA256 → 4-byte float → 2²⁴/(n+1)×0.99 — 94.5% RTP via win odds.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
