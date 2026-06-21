import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { useToast } from "../../contexts/ToastContext";
import {
  fetchSlotsPfState,
  placeSlotsBet,
  setSlotsClientSeed,
  type SlotsBetResult,
} from "../../lib/slots";
import "../../styles/game-controls.css";
import "./Slots.css";

const REVEAL_DELAY_MS = 1200;
// Per-reel landing stagger — each reel stops shortly after the previous one
// for a satisfying left-to-right settle effect.
const REEL_STOP_STAGGER_MS = 180;
// Symbol cycle rate during the spin animation. Lower = faster visual flicker.
const SYMBOL_CYCLE_MS = 55;

const SYMBOL_GLYPH: Record<number, string> = {
  0: "\u{1F352}",
  1: "\u{1F514}",
  2: "7",
  3: "\u{1F4B0}",
  4: "\u{1F349}",
  5: "\u{2B50}",
  6: "\u{1F451}",
};

const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];

type ReelState = "idle" | "spinning" | "landed";

export default function Slots() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();
  const toast = useToast();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1");
  const [rolling, setRolling] = useState(false);
  const [reels, setReels] = useState<number[]>([-1, -1, -1]);
  // Per-reel spin state — each reel moves through spinning → landed independently
  // so we can stagger the visual landing for a more authentic slot feel.
  const [reelStates, setReelStates] = useState<ReelState[]>(["idle", "idle", "idle"]);
  const [lastResult, setLastResult] = useState<SlotsBetResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState<number | null>(null);
  const [clientSeed, setClientSeed] = useState("");
  const [showFairness, setShowFairness] = useState(false);

  const rafRef = useRef<number>(0);
  const lastCycleRef = useRef<number>(0);
  const reelStatesRef = useRef<ReelState[]>(["idle", "idle", "idle"]);
  const landingTimersRef = useRef<number[]>([]);

  // Keep ref in sync so the rAF closure always sees the latest reel states.
  useEffect(() => {
    reelStatesRef.current = reelStates;
  }, [reelStates]);

  const clearLandingTimers = useCallback(() => {
    for (const t of landingTimersRef.current) window.clearTimeout(t);
    landingTimersRef.current = [];
  }, []);

  const activeBalance = useMemo(() => {
    if (!user) return 0;
    return coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
  }, [user, coinType, profile]);

  useEffect(() => {
    fetchSlotsPfState().then(({ data }) => {
      if (data) {
        setPfHash(data.serverSeedHash);
        setPfNonce(data.nextNonce);
        setClientSeed(data.clientSeed);
      }
    });
  }, []);

  const applyWager = useCallback(
    (value: string) => {
      const parsed = parseFloat(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setWager(1);
        setWagerInput("1");
      } else {
        const clamped = Math.min(Math.max(parsed, 0.01), 100000);
        setWager(clamped);
        setWagerInput(String(clamped));
      }
    },
    []
  );

  function startRollAnimation() {
    setReelStates(["spinning", "spinning", "spinning"]);
    reelStatesRef.current = ["spinning", "spinning", "spinning"];
    lastCycleRef.current = performance.now();

    const tick = (now: number) => {
      // Only update visuals while at least one reel is still spinning.
      if (!reelStatesRef.current.some((s) => s === "spinning")) return;
      if (now - lastCycleRef.current >= SYMBOL_CYCLE_MS) {
        lastCycleRef.current = now;
        setReels((prev) =>
          prev.map((s, i) =>
            reelStatesRef.current[i] === "spinning"
              ? Math.floor(Math.random() * 7)
              : s
          )
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopRollAnimation(finalReels: number[]) {
    // Land each reel in sequence so the user sees a satisfying left-to-right settle.
    finalReels.forEach((sym, i) => {
      const t = window.setTimeout(() => {
        setReels((prev) => {
          const next = [...prev];
          next[i] = sym;
          return next;
        });
        setReelStates((prev) => {
          const next = [...prev];
          next[i] = "landed";
          return next;
        });
      }, i * REEL_STOP_STAGGER_MS);
      landingTimersRef.current.push(t);
    });
  }

  async function handleSpin() {
    setError(null);
    setShowResult(false);
    setLastResult(null);

    if (!user) {
      setError("Log in to play.");
      return;
    }

    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    setRolling(true);
    startRollAnimation();

    const startedAt = Date.now();
    const { data, error: apiError } = await placeSlotsBet({ wager, coinType });

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, REVEAL_DELAY_MS - elapsed);

    await new Promise((r) => setTimeout(r, remaining));

    if (apiError || !data) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
      setRolling(false);
      setReelStates(["idle", "idle", "idle"]);
      setError(apiError ?? "No response from server.");
      setReels([-1, -1, -1]);
      return;
    }

    // Stop the free-running spin rAF; reel landing timers will settle each reel.
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stopRollAnimation(data.reels);

    // Wait for the final reel to land before showing the outcome.
    const lastReelDelay = (data.reels.length - 1) * REEL_STOP_STAGGER_MS + 220;
    await new Promise((r) => setTimeout(r, lastReelDelay));

    setLastResult(data);
    setShowResult(true);
    setRolling(false);

    if (data.nonce != null) setPfNonce((prev) => (prev ?? 0) + 1);
    refreshProfile();
  }

  function handleSaveClientSeed() {
    const trimmed = clientSeed.trim();
    if (!trimmed) {
      toast.warning("Enter a client seed.");
      return;
    }
    setSlotsClientSeed(trimmed).then(({ error }) => {
      if (error) toast.error(error);
      else {
        toast.success("Client seed updated.");
        setClientSeed(trimmed);
      }
    });
  }

  // Cleanup any pending rAF / landing timers when the component unmounts.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
    };
  }, [clearLandingTimers]);

  return (
    <div className="slots lc-game-page">
      <header className="slots__header">
        <h1 className="slots__title">Slots</h1>
        <p className="slots__subtitle">Spin the reels and match symbols to win!</p>
      </header>

      <div className="slots__layout">
        <section className="slots__stage">
          <div
            className={`slots__reels${
              !rolling && showResult && lastResult?.won ? " slots__reels--win" : ""
            }`}
            role="img"
            aria-label="Slot machine reels"
          >
            {reels.map((symbol, i) => {
              const state = reelStates[i];
              const isWinning =
                !rolling && showResult && lastResult?.won && state === "landed";
              const isLoss =
                !rolling && showResult && lastResult && !lastResult.won && state === "landed";
              return (
                <div
                  key={i}
                  className={`slots__reel${
                    state === "spinning" ? " slots__reel--rolling" : ""
                  }${isWinning ? " slots__reel--win" : ""}${isLoss ? " slots__reel--loss" : ""}${
                    state === "landed" ? " slots__reel--landed" : ""
                  }`}
                >
                  {symbol >= 0 ? (
                    <span className="slots__reel-inner">
                      <span className="slots__symbol">
                        {SYMBOL_GLYPH[symbol] ?? symbol}
                      </span>
                    </span>
                  ) : (
                    <span className="slots__symbol" aria-label="Empty">
                      —
                    </span>
                  )}
                </div>
              );
            })}
            {/* Horizontal win-line indicator across the center row */}
            <div className="slots__win-line" aria-hidden="true" />
          </div>

          {showResult && lastResult && (
            <div className="slots__outcome" role="status" aria-live="polite">
              {lastResult.won ? (
                <>
                  <p className="slots__outcome-multiplier">
                    {lastResult.multiplier}x &mdash;{" "}
                    {lastResult.symbols.join(" ")}{" "}
                    win!
                  </p>
                  <p className="slots__outcome-payout">
                    +{coinLabel} {lastResult.payout.toFixed(2)}
                  </p>
                </>
              ) : (
                <p className="slots__outcome-loss">No match &mdash; try again!</p>
              )}
            </div>
          )}
        </section>

        <aside className="slots__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <span className="game-controls__option-label">Wager ({coinLabel})</span>
              <div className="game-controls__wager-block">
                <div className="game-controls__wager-row">
                  <input
                    className="game-controls__wager-input"
                    type="text"
                    inputMode="decimal"
                    value={wagerInput}
                    onChange={(e) => setWagerInput(e.target.value)}
                    onBlur={() => applyWager(wagerInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyWager(wagerInput);
                    }}
                    disabled={rolling}
                  />
                  <button
                    type="button"
                    className="game-controls__wager-half"
                    disabled={rolling}
                    onClick={() => {
                      const half = wager / 2;
                      const clamped = Math.max(half, 0.01);
                      setWager(clamped);
                      setWagerInput(String(clamped));
                    }}
                  >
                    1/2
                  </button>
                  <button
                    type="button"
                    className="game-controls__wager-double"
                    disabled={rolling}
                    onClick={() => {
                      const doubled = wager * 2;
                      const clamped = Math.min(doubled, 100000);
                      setWager(clamped);
                      setWagerInput(String(clamped));
                    }}
                  >
                    2x
                  </button>
                </div>
              </div>
            </div>

            <div className="game-controls__option">
              <span className="game-controls__option-label">Quick bet</span>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                {BET_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={rolling}
                    className={`game-controls__preset${wager === preset ? " game-controls__preset--active" : ""}`}
                    onClick={() => {
                      setWager(preset);
                      setWagerInput(String(preset));
                    }}
                  >
                    {coinLabel} {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="game-controls__error" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            className="game-controls__play"
            disabled={rolling}
            onClick={handleSpin}
          >
            {rolling ? "Spinning\u2026" : "Spin"}
          </button>

          <div className="game-controls__stats">
            <div className="game-controls__stat-row">
              <span className="game-controls__stat-label">Balance ({coinLabel})</span>
              <span className="game-controls__stat-value">
                {activeBalance.toFixed(2)}
              </span>
            </div>
            {lastResult && (
              <div className="game-controls__stat-row">
                <span className="game-controls__stat-label">Last payout</span>
                <span
                  className={`game-controls__stat-value${
                    lastResult.won ? " game-controls__stat-value--win" : " game-controls__stat-value--loss"
                  }`}
                >
                  {lastResult.won ? `+${lastResult.payout.toFixed(2)}` : "0.00"}
                </span>
              </div>
            )}
          </div>

          <details
            className="slots__fairness"
            open={showFairness}
            onToggle={(e) => setShowFairness((e.target as HTMLDetailsElement).open)}
          >
            <summary>Provably Fair</summary>
            <div className="slots__fairness-body">
              <label className="slots__fairness-label">
                Server seed hash
                <input
                  type="text"
                  className="game-controls__wager-input slots__fairness-input slots__fairness-input--hash"
                  readOnly
                  value={pfHash ?? "—"}
                />
              </label>
              <label className="slots__fairness-label">
                Next nonce
                <input
                  type="text"
                  className="game-controls__wager-input slots__fairness-input slots__fairness-input--hash"
                  readOnly
                  value={pfNonce ?? "—"}
                />
              </label>
              <label className="slots__fairness-label">
                Client seed
                <div className="slots__fairness-row">
                  <input
                    type="text"
                    className="game-controls__wager-input slots__fairness-input"
                    value={clientSeed}
                    onChange={(e) => setClientSeed(e.target.value)}
                  />
                  <button
                    type="button"
                    className="game-controls__play slots__fairness-save-btn"
                    onClick={handleSaveClientSeed}
                  >
                    Save
                  </button>
                </div>
              </label>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
