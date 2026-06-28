import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import { SlotSymbol } from "./SlotSymbols";
import { Seo } from "../../components/Seo/Seo";
import "../../styles/game-controls.css";
import "./Slots.css";

const REVEAL_DELAY_MS = 2000;
// Per-reel landing stagger — each reel stops shortly after the previous one
// for a satisfying left-to-right settle effect.
const REEL_STOP_STAGGER_MS = 280;
// Symbol cycle rate during the spin animation. Lower = faster visual flicker.
const SYMBOL_CYCLE_MS = 55;

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SYMBOL_NAMES: Record<number, string> = {
  0: "Cherry",
  1: "Bell",
  2: "Seven",
  3: "Dollar",
  4: "Watermelon",
  5: "Star",
  6: "Crown",
};

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
  // tickRef holds the most recent rAF `tick` closure so the visibilitychange
  // handler (audit H5) can resume the spin loop when the tab becomes visible
  // again.
  const tickRef = useRef<((now: number) => void) | null>(null);
  const lastCycleRef = useRef<number>(0);
  const reelStatesRef = useRef<ReelState[]>(["idle", "idle", "idle"]);
  const landingTimersRef = useRef<number[]>([]);
  const rollingRef = useRef(false);
  const cancelledRef = useRef(false);
  const prefersReducedMotionRef = useRef(false);

  // Read reduced-motion preference once on mount. The rAF spin animation is
  // purely decorative (the outcome is server-determined), so reduced-motion
  // users get the result without the flicker.
  useEffect(() => {
    prefersReducedMotionRef.current = readPrefersReducedMotion();
  }, []);

  // Pause the spin rAF loop when the tab is hidden (audit H5). Browsers
  // throttle rAF to ~1 fps on hidden tabs, but each throttled tick still
  // calls setReels → React reconciliation. Cancelling the rAF entirely
  // eliminates that waste. When the tab becomes visible again and a spin
  // is still in progress, resume the loop with the SAME tick closure
  // (captured via tickRef) so the spin continues smoothly.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
      } else if (rollingRef.current && tickRef.current && !rafRef.current) {
        rafRef.current = requestAnimationFrame(tickRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

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

  // Max-payout cap (audit R6): Crown pays 100×, so wager × 100 > 100,000
  // when wager > 1,000. The server enforces the cap; this is the UX.
  const SLOTS_MAX_PAYOUT = 100_000;
  const slotsMaxWin = wager * 100;
  const exceedsMaxPayout = slotsMaxWin > SLOTS_MAX_PAYOUT;

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
        const clamped = Math.min(Math.max(parsed, 1), coinType === "sweeps_coins" ? 100_000 : 10_000_000);
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
    // Expose tick to the visibilitychange handler so it can resume the loop
    // when the tab becomes visible again (audit H5).
    tickRef.current = tick;
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopRollAnimation(finalReels: number[]) {
    // Land each reel in sequence so the user sees a satisfying left-to-right settle.
    finalReels.forEach((sym, i) => {
      const t = window.setTimeout(() => {
        // Sync the ref synchronously so the rAF tick stops overwriting this
        // reel's symbol on the very next frame (the useEffect that mirrors
        // reelStates → reelStatesRef runs after paint, leaving a one-frame gap
        // where the just-landed reel's symbol could be replaced with a random one).
        reelStatesRef.current = reelStatesRef.current.map((s, idx) =>
          idx === i ? "landed" : s
        );
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
    // Double-spin race guard: the Spin button's `disabled={rolling}`
    // prop prevents most double-clicks, but there's a sub-ms window between
    // the first click's setRolling(true) state commit and the second click's
    // handler execution. The ref closes that window synchronously.
    if (rollingRef.current) return;

    setError(null);
    setShowResult(false);
    setLastResult(null);

    if (activeBalance < wager) {
      setError("Insufficient balance.");
      return;
    }

    rollingRef.current = true;
    setRolling(true);
    const reducedMotion = prefersReducedMotionRef.current;
    if (!reducedMotion) startRollAnimation();

    const startedAt = Date.now();
    const { data, error: apiError } = await placeSlotsBet({ wager, coinType });

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, REVEAL_DELAY_MS - elapsed);

    await new Promise((r) => setTimeout(r, remaining));
    if (cancelledRef.current) return;

    if (apiError || !data) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
      rollingRef.current = false;
      setRolling(false);
      setReelStates(["idle", "idle", "idle"]);
      reelStatesRef.current = ["idle", "idle", "idle"];
      setError(apiError ?? "No response from server.");
      setReels([-1, -1, -1]);
      // Server may have debited before failing — refresh to get the authoritative balance.
      void refreshProfile();
      return;
    }

    // Stop the free-running spin rAF; reel landing timers will settle each reel.
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (reducedMotion) {
      // Skip the staggered landing animation — set all reels to their final
      // values simultaneously.
      setReels(data.reels);
      setReelStates(["landed", "landed", "landed"]);
      reelStatesRef.current = ["landed", "landed", "landed"];
    } else {
      stopRollAnimation(data.reels);
      // Wait for the final reel to land before showing the outcome.
      const lastReelDelay = (data.reels.length - 1) * REEL_STOP_STAGGER_MS + 220;
      await new Promise((r) => setTimeout(r, lastReelDelay));
      if (cancelledRef.current) return;
    }

    setLastResult(data);
    setShowResult(true);
    rollingRef.current = false;
    setRolling(false);

    // Server returns the nonce USED for this bet; the next nonce is +1.
    if (data.nonce != null) setPfNonce(data.nonce + 1);
    // No refreshProfile() here — ProfileContext's realtime subscription on
    // `profiles` pushes the new balance the instant the server commits the
    // spin's wager/win transaction. Calling it would fire 2 redundant RPCs
    // (ensure_user_profile + is_current_user_admin) per spin.
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

  // Cleanup any pending rAF / landing timers when the component unmounts, and
  // signal the in-flight handleSpin async chain to stop touching state.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      rollingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
    };
  }, [clearLandingTimers]);

  return (
    <div className="slots lc-game-page">
      <Seo
        title="Slots"
        description="Three-reel provably fair slot machine. Match symbols to win — Crown pays 100×, Star pays 35×. 96.5% RTP."
        path="/slots"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Slots</h1>
        <p className="lc-page__subtitle">Three reels. Match symbols to win. Crown pays 100×, Star pays 35×. 96.5% RTP.</p>
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
              // For the 3-symbol strip: center = result, top/bottom = adjacent
              // symbols from the symbol ID space (purely decorative). When
              // spinning, all 3 cycle randomly via the rAF tick above.
              const aboveSymbol = symbol >= 0 ? (symbol + 6) % 7 : -1;
              const belowSymbol = symbol >= 0 ? (symbol + 1) % 7 : -1;
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
                      {/* 3-symbol strip: top (dimmed) / center (win line) / bottom (dimmed).
                          Audit issue P2 #5 — makes it look like a real slot machine. */}
                      <span className="slots__symbol slots__symbol--adjacent" aria-hidden="true">
                        <SlotSymbol id={aboveSymbol} size={48} />
                      </span>
                      <span className="slots__symbol slots__symbol--center" aria-label={SYMBOL_NAMES[symbol] ?? `Symbol ${symbol}`}>
                        <SlotSymbol id={symbol} size={64} />
                      </span>
                      <span className="slots__symbol slots__symbol--adjacent" aria-hidden="true">
                        <SlotSymbol id={belowSymbol} size={48} />
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
                    className="game-controls__wager-adj"
                    disabled={rolling}
                    onClick={() => {
                      const half = wager / 2;
                      const clamped = Math.max(half, 1);
                      setWager(clamped);
                      setWagerInput(String(clamped));
                    }}
                    aria-label="Half bet"
                  >
                    1/2
                  </button>
                  <button
                    type="button"
                    className="game-controls__wager-adj"
                    disabled={rolling}
                    onClick={() => applyWager(String(Math.min(wager * 2, activeBalance)))}
                    aria-label="Double bet"
                  >
                    2x
                  </button>
                  <button
                    type="button"
                    className="game-controls__wager-adj game-controls__wager-adj--max"
                    onClick={() => applyWager(String(Math.min(100_000, activeBalance)))}
                    disabled={rolling}
                    aria-label="Max bet"
                  >
                    MAX
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="game-controls__error" role="alert">
              {error}
            </p>
          )}

          {/* Always-visible paytable so players know what to aim for */}
          <div className="slots__paytable" aria-label="Paytable">
            <h4 className="slots__paytable-title">Paytable (3 of a kind)</h4>
            <div className="slots__paytable-grid">
              <span className="slots__paytable-row"><SlotSymbol id={6} size={22} /> Crown</span><span className="slots__paytable-mult slots__paytable-mult--top">100×</span>
              <span className="slots__paytable-row"><SlotSymbol id={5} size={22} /> Star</span><span className="slots__paytable-mult">35×</span>
              <span className="slots__paytable-row"><SlotSymbol id={2} size={22} /> Seven</span><span className="slots__paytable-mult">20×</span>
              <span className="slots__paytable-row"><SlotSymbol id={3} size={22} /> Bar</span><span className="slots__paytable-mult">10×</span>
              <span className="slots__paytable-row"><SlotSymbol id={4} size={22} /> Watermelon</span><span className="slots__paytable-mult">8×</span>
              <span className="slots__paytable-row"><SlotSymbol id={1} size={22} /> Bell</span><span className="slots__paytable-mult">5×</span>
              <span className="slots__paytable-row"><SlotSymbol id={0} size={22} /> Cherry</span><span className="slots__paytable-mult">3×</span>
            </div>
          </div>

          <button
            type="button"
            className="game-controls__play"
            disabled={rolling || exceedsMaxPayout}
            onClick={handleSpin}
            aria-disabled={rolling || exceedsMaxPayout}
          >
            {rolling ? "Spinning\u2026" : exceedsMaxPayout ? "Payout exceeds cap" : "Spin"}
          </button>

          {exceedsMaxPayout && (
            <p className="game-controls__option-hint game-controls__option-hint--warn" role="note">
              Max payout is {SLOTS_MAX_PAYOUT.toLocaleString()}. Lower your wager — Crown (100×) would exceed the cap.
            </p>
          )}

          {/* H9 (UI/UX audit): every other game (Keno, Mines, Limbo, Crash,
              Blackjack) has an inline "Need funds? Deposit" link at the
              bottom of the controls panel — Slots was missing it. */}
          <p className="slots__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

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
              {/* H8 (UI/UX audit): the paytable was previously duplicated here
                  byte-for-byte from the always-visible block above. Removed
                  the duplicate — the fairness panel now contains only the
                  provably-fair disclosure (seed hash, nonce, client seed, RTP
                  note). The always-visible paytable at the top of the controls
                  remains the single source of truth. */}
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
              <p className="slots__fairness-note">
                Reels are picked via HMAC-SHA256 &mdash; 4-byte float per reel, floor(&times;7).
              </p>
              <p className="slots__fairness-note slots__fairness-note--disclosure">
                RTP disclosure: the reel selection is fair (uniform 1/7 per symbol). The displayed
                96.5% RTP comes directly from the paytable above &mdash; no additional bias roll is
                applied to Slots. Verifiable after seed rotation.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
