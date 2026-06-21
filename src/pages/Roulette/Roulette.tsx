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
  const [panelOpen, setPanelOpen] = useState(false);

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
      <header className="game-header">
        <h1 className="game-header__title">Roulette</h1>
        <span className="game-header__rtp">97.3% RTP</span>
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

        <div className="roulette__bet-pills" role="group" aria-label="Bet type">
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

        <p className="roulette__bet-hint">
          Win chance {(winChance * 100).toFixed(2)}% · Payout {formatCoins(potentialWin, coinType)}
        </p>
      </div>

      {panelOpen && (
        <div className="game-panel" role="complementary" aria-label="Roulette stats">
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

          {lastResult && !spinning && (
            <div className="game-panel__section">
              <h3 className="game-panel__section-title">Last result</h3>
              <div className="game-panel__row">
                <span className="game-panel__row-label">Pocket</span>
                <span className="game-panel__row-value game-panel__row-value--gold">
                  {lastResult.pocket} · {lastResult.color}
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
            ) : (
              <p className="game-history__empty">No spins yet.</p>
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
                    disabled={spinning}
                  />
                </div>
                <button
                  type="button"
                  className="game-fair__save"
                  onClick={saveClientSeed}
                  disabled={spinning}
                >
                  Save client seed
                </button>
                <p className="game-fair__note">
                  HMAC-SHA256 → pocket = floor(float × 37). European layout.
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

        <div className="game-actionbar__wager">
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager / 2)}
            disabled={spinning}
            aria-label="Half bet"
          >
            ½
          </button>
          <input
            id="roulette-wager"
            type="text"
            inputMode="decimal"
            className="game-actionbar__input"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            onBlur={() => {
              const parsed = parseFloat(wagerInput.replace(/,/g, ""));
              applyWager(Number.isFinite(parsed) ? parsed : 0.01);
            }}
            disabled={spinning}
            aria-label="Bet amount"
          />
          <button
            type="button"
            className="game-actionbar__adj"
            onClick={() => applyWager(wager * 2)}
            disabled={spinning}
            aria-label="Double bet"
          >
            2×
          </button>
        </div>

        <div className="game-actionbar__presets">
          {BET_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`game-actionbar__preset${wager === p ? " game-actionbar__preset--active" : ""}`}
              onClick={() => applyWager(p)}
              disabled={spinning}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="game-actionbar__play"
          onClick={handleBet}
          disabled={spinning || !user}
          aria-busy={spinning}
        >
          {spinning ? "Spinning…" : "Play"}
        </button>

        {error && <p className="game-actionbar__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
