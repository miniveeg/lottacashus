import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import {
  type RouletteBetType,
  type RouletteColor,
  roulettePotentialWin,
  rouletteWinChance,
} from "../../lib/games/roulette";
import { coinsToUsd, formatCoins, formatUsd } from "../../lib/format";
import {
  fetchRoulettePfState,
  placeRouletteBet,
  setRouletteClientSeed,
} from "../../lib/roulette";
import { RouletteWheel } from "./RouletteWheel";
import "../../styles/game-controls.css";
import "./Roulette.css";

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];
const SPIN_DELAY_MS = 1600;
const HISTORY_MAX = 10;

const BET_OPTIONS: {
  type: RouletteBetType;
  label: string;
  payout: string;
  odds: string;
  color: "red" | "black" | "green";
}[] = [
  { type: "red", label: "Red", payout: "2×", odds: "18/37", color: "red" },
  { type: "black", label: "Black", payout: "2×", odds: "18/37", color: "black" },
  { type: "green", label: "0", payout: "36×", odds: "1/37", color: "green" },
];

type HistoryEntry = { pocket: number; color: RouletteColor };

export function Roulette() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [betType, setBetType] = useState<RouletteBetType>("red");
  const [spinning, setSpinning] = useState(false);
  const [displayPocket, setDisplayPocket] = useState<number | null>(null);
  const [displayColor, setDisplayColor] = useState<RouletteColor | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastResult, setLastResult] = useState<{
    pocket: number;
    color: RouletteColor;
    won: boolean;
    payout: number;
    betType: RouletteBetType;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");

  const winChance = useMemo(() => rouletteWinChance(betType), [betType]);
  const potentialWin = useMemo(() => roulettePotentialWin(wager, betType), [wager, betType]);

  const activeBalance =
    coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);

  const loadPf = useCallback(async () => {
    const { data } = await fetchRoulettePfState();
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
    setSpinning(true);
    setDisplayPocket(null);
    setDisplayColor(null);

    const startedAt = Date.now();
    const { data, error: betErr } = await placeRouletteBet({ wager, betType, coinType });
    if (betErr || !data) {
      setSpinning(false);
      setError(betErr ?? "Bet failed.");
      return;
    }

    const remaining = Math.max(0, SPIN_DELAY_MS - (Date.now() - startedAt));
    await wait(remaining);

    setDisplayPocket(data.resultPocket);
    setDisplayColor(data.resultColor);
    setSpinning(false);
    setHistory((h) =>
      [{ pocket: data.resultPocket, color: data.resultColor }, ...h].slice(0, HISTORY_MAX)
    );
    setLastResult({
      pocket: data.resultPocket,
      color: data.resultColor,
      won: data.won,
      payout: data.payout,
      betType: data.betType,
    });
    setPfNonce(data.nonce + 1);
    await refreshProfile();
  };

  const saveClientSeed = async () => {
    const { error: seedErr } = await setRouletteClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  return (
    <div className="game-page roulette">
      <header className="game-page__header">
        <div className="game-page__header-text">
          <h1 className="game-page__title">Roulette</h1>
          <p className="game-page__subtitle">
            European roulette. 37 pockets. Bet color, parity, dozen, or single number.
          </p>
        </div>
        <span className="game-page__rtp">97.3% RTP</span>
      </header>

      <div className="game-page__layout">
        <section className="game-page__stage roulette__stage">
          <div className="roulette__stage-toolbar">
            <span className="roulette__stage-label">
              {spinning ? "Spinning…" : "European · 0–36"}
            </span>
            {history.length > 0 && (
              <div className="roulette__history" aria-label="Recent results">
                {history.map((h, i) => (
                  <span
                    key={`${h.pocket}-${i}`}
                    className={`roulette__history-chip roulette__history-chip--${h.color}`}
                    title={`${h.color} ${h.pocket}`}
                  >
                    {h.pocket}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="roulette__wheel-zone">
            <RouletteWheel
              spinning={spinning}
              resultPocket={displayPocket}
              resultColor={displayColor}
            />
          </div>

          {lastResult && !spinning && (
            <div className="roulette__result-strip" role="status" aria-live="polite">
              <span>Landed</span>
              <span
                className={`roulette__result-dot roulette__result-dot--${lastResult.color}`}
              >
                {lastResult.pocket}
              </span>
              <span>· your <strong>{lastResult.betType}</strong> bet ·</span>
              <span
                className={`roulette__result-payout${lastResult.won ? " roulette__result-payout--win" : " roulette__result-payout--loss"}`}
              >
                {lastResult.won
                  ? `Won ${formatCoins(lastResult.payout, coinType)}`
                  : "No win this round"}
              </span>
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
              <span className="game-controls__option-label" id="roulette-bet-label">
                Bet on
              </span>
              <div
                className="roulette__bet-pills"
                role="group"
                aria-labelledby="roulette-bet-label"
              >
                {BET_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    className={[
                      "roulette__bet-pill",
                      `roulette__bet-pill--${opt.color}`,
                      betType === opt.type && "roulette__bet-pill--selected",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setBetType(opt.type)}
                    disabled={spinning}
                    aria-pressed={betType === opt.type}
                  >
                    <span className="roulette__bet-pill-label">{opt.label}</span>
                    <span className="roulette__bet-pill-meta">{opt.payout} · {opt.odds}</span>
                  </button>
                ))}
              </div>
              <p className="game-controls__option-hint">
                Win chance {(winChance * 100).toFixed(2)}% · Payout {formatCoins(potentialWin, coinType)}
              </p>
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="roulette-wager">
              Bet amount · {coinLabel}
            </label>
            <div className="game-controls__wager-row">
              <input
                id="roulette-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(Number.isFinite(parsed) ? parsed : 0.01);
                }}
                disabled={spinning}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={spinning}
                aria-label="Half bet"
              >
                ½
              </button>
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager * 2)}
                disabled={spinning}
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
                  disabled={spinning}
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
            disabled={spinning || !user}
            aria-busy={spinning}
          >
            {spinning ? "Spinning…" : "Play"}
          </button>

          {error && <p className="game-controls__error" role="alert">{error}</p>}

          {lastResult && !spinning && (
            <div className="game-controls__stats">
              <div className="game-controls__stat-row">
                <span className="game-controls__stat-label">Last result</span>
                <span
                  className={`game-controls__stat-value${
                    lastResult.won
                      ? " game-controls__stat-value--win"
                      : " game-controls__stat-value--loss"
                  }`}
                >
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
                  disabled={spinning}
                />
              </div>
              <button
                type="button"
                className="game-page__fairness-save"
                onClick={saveClientSeed}
                disabled={spinning}
              >
                Save client seed
              </button>
              <p className="game-page__fairness-note">
                HMAC-SHA256 → pocket = floor(float × 37). European layout.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
