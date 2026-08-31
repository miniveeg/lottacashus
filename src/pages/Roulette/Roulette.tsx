import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import {
  type RouletteBetType,
  type RouletteColor,
  roulettePotentialWin,
  rouletteWinChance,
} from "../../lib/games/roulette";
import { formatCoins } from "../../lib/format";
import { getActiveBalance, clampWager, SC_MAX_WAGER, SC_MIN_WAGER } from "../../lib/gameWallet";
import {
  fetchRoulettePfState,
  placeRouletteBet,
  setRouletteClientSeed,
} from "../../lib/roulette";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import { RouletteWheel } from "./RouletteWheel";
import "../../styles/game-controls.css";
import "./Roulette.css";

const SPIN_DELAY_MS = 4500;
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

type HistoryEntry = { id: number; pocket: number; color: RouletteColor };

export function Roulette() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [betType, setBetType] = useState<RouletteBetType>("red");
  const [spinning, setSpinning] = useState(false);
  const [displayPocket, setDisplayPocket] = useState<number | null>(null);
  const [displayColor, setDisplayColor] = useState<RouletteColor | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyIdRef = useRef(0);
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

  const spinningRef = useRef(false);
  const cancelledRef = useRef(false);

  const wagerRef = useRef(1);
  const betTypeRef = useRef<RouletteBetType>("red");
  const coinTypeRef = useRef<string>("sweeps_coins");
  const profileRef = useRef(profile);

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

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      spinningRef.current = false;
    };
  }, []);

  useEffect(() => {
    wagerRef.current = wager;
    betTypeRef.current = betType;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
  }, [wager, betType, coinType, profile]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;

      const k = e.key.toLowerCase();
      const isSpinning = spinningRef.current;

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (!isSpinning) void handleBet();
        return;
      }
      if (k === "[") {
        if (!isSpinning) {
          e.preventDefault();
          const half = Math.max(wagerRef.current / 2, SC_MIN_WAGER);
          setWager(half);
          setWagerInput(half.toFixed(2));
        }
        return;
      }
      if (k === "]") {
        if (!isSpinning) {
          e.preventDefault();
          const prof = profileRef.current;
          const bal = getActiveBalance(prof);
          const doubled = Math.min(wagerRef.current * 2, bal, SC_MAX_WAGER);
          if (doubled >= 1) {
            setWager(doubled);
            setWagerInput(doubled.toFixed(2));
          }
        }
        return;
      }
      if (k === "m") {
        if (!isSpinning) {
          e.preventDefault();
          const bal = getActiveBalance(profileRef.current);
          const max = Math.min(SC_MAX_WAGER, bal);
          if (max >= 1) {
            setWager(max);
            setWagerInput(max.toFixed(2));
          }
        }
        return;
      }
      if (k === "1") {
        if (!isSpinning) {
          e.preventDefault();
          setBetType("red");
        }
        return;
      }
      if (k === "2") {
        if (!isSpinning) {
          e.preventDefault();
          setBetType("black");
        }
        return;
      }
      if (k === "3") {
        if (!isSpinning) {
          e.preventDefault();
          setBetType("green");
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyWager = (value: number) => {
    const v = clampWager(value);
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const handleBet = async () => {
    if (spinningRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }

    const wagerNow = wagerRef.current;
    const betTypeNow = betTypeRef.current;
    const coinNow = coinTypeRef.current;
    const bal = getActiveBalance(profileRef.current);
    if (bal < wagerNow) {
      setError("Insufficient balance.");
      return;
    }

    spinningRef.current = true;
    setError(null);
    setLastResult(null);
    setSpinning(true);
    setDisplayPocket(null);
    setDisplayColor(null);

    const startedAt = Date.now();
    const { data, error: betErr } = await placeRouletteBet({
      wager: wagerNow,
      betType: betTypeNow,
      coinType: coinNow,
    });
    if (betErr || !data) {
      if (cancelledRef.current) return;
      spinningRef.current = false;
      setSpinning(false);
      setError(betErr ?? "Bet failed.");
      void refreshProfile();
      return;
    }

    const remaining = Math.max(0, SPIN_DELAY_MS - (Date.now() - startedAt));
    await wait(remaining);

    if (cancelledRef.current) {
      spinningRef.current = false;
      return;
    }

    setDisplayPocket(data.resultPocket);
    setDisplayColor(data.resultColor);
    setSpinning(false);
    setHistory((h) =>
      [{ id: ++historyIdRef.current, pocket: data.resultPocket, color: data.resultColor }, ...h].slice(0, HISTORY_MAX)
    );

    await wait(4400);
    if (cancelledRef.current) {
      spinningRef.current = false;
      return;
    }

    setLastResult({
      pocket: data.resultPocket,
      color: data.resultColor,
      won: data.won,
      payout: data.payout,
      betType: data.betType,
    });
    setPfNonce(data.nonce + 1);
    spinningRef.current = false;
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
      <Seo
        title="Roulette"
        description="European wheel — bet red, black, or green (zero). Provably fair, 96.5% RTP."
        path="/roulette"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Roulette</h1>
        <p className="lc-page__subtitle">
          European wheel — bet red, black, or zero. Provably fair — 96.5% RTP.
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
                {history.map((h) => (
                  <span
                    key={h.id}
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
                {BET_OPTIONS.map((opt) => {
                  const isSelected = betType === opt.type;
                  const isWinner =
                    !!lastResult?.won && lastResult.betType === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      className={[
                        "roulette__bet-cell",
                        `roulette__bet-cell--${opt.type}`,
                        isSelected && "roulette__bet-cell--selected",
                        isWinner && "roulette__bet-cell--win",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setBetType(opt.type)}
                      disabled={spinning}
                      aria-pressed={isSelected}
                    >
                      <span className="roulette__bet-cell-label">{opt.label}</span>
                      <span className="roulette__bet-cell-meta">
                        {opt.payout} · {opt.odds}
                      </span>
                    </button>
                  );
                })}
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
                  applyWager(Number.isFinite(parsed) ? parsed : SC_MIN_WAGER);
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
                  const bal = getActiveBalance(profile);
                  applyWager(Math.min(wager * 2, bal));
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
                  const bal = getActiveBalance(profile);
                  applyWager(Math.min(SC_MAX_WAGER, bal));
                }}
                disabled={spinning}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

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

          <BetButton
            onClick={handleBet}
            busy={spinning}
            busyLabel="Spinning…"
            label="Bet"
          />

          {!spinning && (
            <p className="roulette__hotkey-hint" role="note">
              <kbd>Space</kbd> spin · <kbd>[</kbd>/<kbd>]</kbd> wager · <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> bet
            </p>
          )}

          <NeedFundsHint />

          <div className="roulette__fairness">
            <button
              type="button"
              className="roulette__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
              aria-expanded={showFairness}
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
                <p className="roulette__fairness-note roulette__fairness-note--disclosure">
                  RTP disclosure: the wheel is fair (1/37 per pocket); the
                  displayed 96.5% RTP is enforced by a deterministic bias roll
                  (same seeds) that downgrades ~2.5% of would-be wins. Verifiable
                  after seed rotation.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
