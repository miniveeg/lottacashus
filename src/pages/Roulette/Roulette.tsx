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
import { formatCoins } from "../../lib/format";
import {
  fetchRoulettePfState,
  placeRouletteBet,
  setRouletteClientSeed,
} from "../../lib/roulette";
import { RouletteWheel } from "./RouletteWheel";
import "../../styles/game-controls.css";
import "./Roulette.css";

const SPIN_DELAY_MS = 1600;
const HISTORY_MAX = 8;

const BET_OPTIONS: {
  type: RouletteBetType;
  label: string;
  payout: string;
  odds: string;
}[] = [
  { type: "red", label: "Red", payout: "2×", odds: "18/37" },
  { type: "black", label: "Black", payout: "2×", odds: "18/37" },
  { type: "green", label: "Green (0)", payout: "36×", odds: "1/37" },
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
  const [showFairness, setShowFairness] = useState(false);

  const winChance = useMemo(() => rouletteWinChance(betType), [betType]);
  const potentialWin = useMemo(() => roulettePotentialWin(wager, betType), [wager, betType]);

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
    const v = Math.max(1, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const handleBet = async () => {
    if (!user) {
      setError("Log in to play.");
      return;
    }
    const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
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
    <div className="roulette lc-game-page">
      <header className="lc-page__header">
        <h1 className="lc-page__title">Roulette</h1>
        <p className="lc-page__subtitle">
          European wheel — bet red, black, or zero. Provably fair — 94.5% RTP.
        </p>
      </header>

      <div className="roulette__layout">
        <section className="roulette__board-panel">
          <div className="roulette__board-toolbar">
            <span className="roulette__toolbar-label">
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

          <div className="roulette__paytable-wrap">
            <p className="roulette__paytable-title">Payouts</p>
            <div className="roulette__paytable">
              <div className="roulette__paytable-cell roulette__paytable-cell--pays">
                <span className="roulette__paytable-hits">Red</span>
                <span className="roulette__paytable-mult">2×</span>
              </div>
              <div className="roulette__paytable-cell roulette__paytable-cell--pays">
                <span className="roulette__paytable-hits">Black</span>
                <span className="roulette__paytable-mult">2×</span>
              </div>
              <div className="roulette__paytable-cell roulette__paytable-cell--pays">
                <span className="roulette__paytable-hits">0</span>
                <span className="roulette__paytable-mult">36×</span>
              </div>
            </div>
          </div>
        </section>

        <aside className="roulette__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <span className="game-controls__option-label" id="roulette-bet-label">
                Bet on
              </span>
              <div
                className="roulette__bet-grid"
                role="group"
                aria-labelledby="roulette-bet-label"
              >
                {BET_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    className={[
                      "roulette__bet-cell",
                      `roulette__bet-cell--${opt.type}`,
                      betType === opt.type && "roulette__bet-cell--selected",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setBetType(opt.type)}
                    disabled={spinning}
                    aria-pressed={betType === opt.type}
                  >
                    <span className="roulette__bet-cell-label">{opt.label}</span>
                    <span className="roulette__bet-cell-meta">
                      {opt.payout} · {opt.odds}
                    </span>
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
              Bet amount ({coinLabel})
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
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
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
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(wager * 2, activeBalance));
                }}
                disabled={spinning}
                aria-label="Double bet"
              >
                2×
              </button>
              <button
                type="button"
                className="game-controls__wager-adj game-controls__wager-adj--max"
                onClick={() => {
                  const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                  applyWager(Math.min(100_000, activeBalance));
                }}
                disabled={spinning}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>

          </div>

          {error && (
            <p className="roulette__error" role="alert">
              {error}
            </p>
          )}

          {lastResult && !spinning && (
            <div
              className={`roulette__result${lastResult.won ? " roulette__result--win" : " roulette__result--loss"}`}
              role="status"
              aria-live="polite"
            >
              <p>
                Landed <strong>{lastResult.pocket}</strong> ({lastResult.color}) — your{" "}
                <strong>{lastResult.betType}</strong> bet
              </p>
              <p className="roulette__result-payout">
                {lastResult.won
                  ? `Won ${formatCoins(lastResult.payout, coinType)}`
                  : "No win this round"}
              </p>
            </div>
          )}

          <button
            type="button"
            className="roulette__bet-btn"
            onClick={handleBet}
            disabled={spinning || !user}
            aria-busy={spinning}
          >
            {spinning ? (
              <>
                <span className="roulette__spinner" aria-hidden="true" />
                <span>Spinning…</span>
              </>
            ) : (
              "Bet"
            )}
          </button>

          <p className="roulette__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <div className="roulette__fairness">
            <button
              type="button"
              className="roulette__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="roulette__fairness-body">
                <p>
                  <span className="roulette__fairness-k">Server seed (hash)</span>
                  <code className="roulette__hash">{pfHash ?? "…"}</code>
                </p>
                <p>
                  <span className="roulette__fairness-k">Next nonce</span>
                  <code>{pfNonce}</code>
                </p>
                <label className="roulette__seed-label">
                  Client seed
                  <input
                    type="text"
                    className="roulette__seed-input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={spinning}
                  />
                </label>
                <button
                  type="button"
                  className="roulette__tool-btn"
                  onClick={saveClientSeed}
                  disabled={spinning}
                >
                  Save client seed
                </button>
                <p className="roulette__fairness-note">
                  HMAC-SHA256 → pocket = floor(float × 37). European layout.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
