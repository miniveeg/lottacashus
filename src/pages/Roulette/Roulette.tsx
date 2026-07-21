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
import {
  fetchRoulettePfState,
  placeRouletteBet,
  setRouletteClientSeed,
} from "../../lib/roulette";
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

// L15 (UI/UX audit): history entries include a monotonic id so React keys
// don't collide when two consecutive rounds land on the same pocket (the
// prior `key={`${h.pocket}-${i}`}` could collide after rotation).
type HistoryEntry = { id: number; pocket: number; color: RouletteColor };

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
  // Monotonic counter for HistoryEntry.id — bumped each time a new entry is
  // pushed so React keys are stable across rotations.
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

  // Refs for race-safety (spinningRef) and async cleanup (cancelledRef).
  // Mirrors the KENO_MINES / LIMBO_CRASH agents' busyRef/cancelledRef pattern.
  const spinningRef = useRef(false);
  const cancelledRef = useRef(false);

  // Phase polish: ref mirrors so the keyboard-hotkey listener (registered
  // once with [] deps) and the refactored async handleBet always read the
  // most recent values. Mirrors the established Crash+Mines+Keno+Slots+Limbo
  // pattern.
  const wagerRef = useRef(1);
  const betTypeRef = useRef<RouletteBetType>("red");
  const coinTypeRef = useRef<string>("balance");
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

  // Unmount cleanup: mark the component cancelled so in-flight spin awaits
  // don't fire setState on a dead component (React 19 silently no-ops, but
  // this prevents the leak and clears the spinning flag for any queued click).
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      spinningRef.current = false;
    };
  }, []);

  // Sync ref mirrors for the hotkey handler and refactored async paths.
  useEffect(() => {
    wagerRef.current = wager;
    betTypeRef.current = betType;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
  }, [wager, betType, coinType, profile]);

  // Keyboard hotkeys. Registered once with [] deps; handleBet reads from
  // refs so stale first-render closures can't trap the user. Focus +
  // modifier guards keep this safe globally. Quick bet selectors below
  // require that the element the user types in IS NOT a text input —
  // otherwise typing "1" in the wager field would accidentally swap the bet.
  //   Space / Enter → spin (only if !spinning && activeBalance ≥ wager)
  //   [             → half wager (idle only)
  //   ]             → double wager (idle only)
  //   M             → max wager (idle only)
  //   1 / 2 / 3     → Red / Black / Green selector (idle only, not in input)
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

      // === SPIN / WAGER CONTROLS ===
      if (k === " " || k === "enter") {
        e.preventDefault();
        if (!isSpinning) void handleBet();
        return;
      }
      if (k === "[") {
        if (!isSpinning) {
          e.preventDefault();
          const half = Math.max(wagerRef.current / 2, 1);
          setWager(half);
          setWagerInput(half.toFixed(2));
        }
        return;
      }
      if (k === "]") {
        if (!isSpinning) {
          e.preventDefault();
          const prof = profileRef.current;
          const activeBalance =
            coinTypeRef.current === "sweeps_coins"
              ? (prof?.sweepsCoins ?? 0)
              : (prof?.balance ?? 0);
          const cap = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
          const doubled = Math.min(wagerRef.current * 2, activeBalance, cap);
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
          const prof = profileRef.current;
          const activeBalance =
            coinTypeRef.current === "sweeps_coins"
              ? (prof?.sweepsCoins ?? 0)
              : (prof?.balance ?? 0);
          const cap = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
          const max = Math.min(cap, activeBalance);
          if (max >= 1) {
            setWager(max);
            setWagerInput(max.toFixed(2));
          }
        }
        return;
      }
      // === QUICK-BET SELECTORS ===
      // Only fire if not in input field (already checked). Note: pressing
      // "2" in the wager input is harmless because we bail above.
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
    // Read coin type from ref so this is safe from the hotkey's [] deps.
    const maxBet = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(1, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const handleBet = async () => {
    // Synchronous re-entrancy guard — the Bet button's `disabled={spinning}`
    // prop relies on a re-render cycle that leaves a sub-ms race window
    // between the first click's setSpinning(true) commit and a second click.
    if (spinningRef.current) return;

    // Read all session values from refs so this handler is safe from any
    // binding context (JSX onClick, hotkey listener, etc.).
    const wagerNow = wagerRef.current;
    const betTypeNow = betTypeRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const activeBalanceNow =
      coinNow === "sweeps_coins"
        ? (profNow?.sweepsCoins ?? 0)
        : (profNow?.balance ?? 0);
    if (activeBalanceNow < wagerNow) {
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
      // Server may have debited before failing — refresh to stay accurate.
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
    // Keep spinningRef true through the settle animation so a second bet
    // cannot fire mid-wheel. Visual spin stops so the CSS settle transition runs.
    setSpinning(false);
    setHistory((h) =>
      [{ id: ++historyIdRef.current, pocket: data.resultPocket, color: data.resultColor }, ...h].slice(0, HISTORY_MAX)
    );

    // Wait for the wheel settle animation (4.2s CSS transition) before showing
    // the result banner, so the player sees the outcome exactly when the wheel lands.
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
    // No refreshProfile() here — ProfileContext's realtime subscription on
    // `profiles` pushes the new balance the instant the server commits the
    // bet. Calling it would fire 2 redundant RPCs (ensure_user_profile +
    // is_current_user_admin) per bet.
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
                  // Winning cell: bet grid highlight when last result matches
                  // the selected bet type and the round was a win. The
                  // pulse runs once and fades into static after the round
                  // resolves (matches Slots reels--win + Keno paytable-row
                  // patterns — no infinite loops).
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
                  applyWager(Math.min(coinType === "sweeps_coins" ? 100_000 : 10_000_000, activeBalance));
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

          {/* Phase polish: hotkey hint footer. Tells desktop users that
              Space/Enter spins, [/] adjusts wager, 1/2/3 selects bet type.
              Sits between the Bet button and the NeedFundsHint so it's
              contextually adjacent to the controls it describes. */}
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
