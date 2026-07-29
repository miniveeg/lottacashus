import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { useToast } from "../../contexts/ToastContext";
import {
  fetchSlotsPfState,
  placeSlotsBet,
  setSlotsClientSeed,
  type SlotsBetResult,
} from "../../lib/slots";
import { useCanPlay } from "../../lib/canPlay";
import { SlotSymbol } from "./SlotSymbols";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import { GameGuestBanner } from "../../components/GameGuestBanner/GameGuestBanner";
import "../../styles/game-controls.css";
import "./Slots.css";

const REVEAL_DELAY_MS = 2000;
const REEL_STOP_STAGGER_MS = 280;
const SYMBOL_CYCLE_MS = 55;

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SYMBOL_NAMES: Record<number, string> = {
  0: "Cherry",
  1: "Bell",
  2: "Seven",
  3: "Bar",
  4: "Watermelon",
  5: "Star",
  6: "Crown",
};

const SLOTS_PAYTABLE: { id: number; mult: number }[] = [
  { id: 6, mult: 190 },
  { id: 5, mult: 80 },
  { id: 4, mult: 30 },
  { id: 3, mult: 15 },
  { id: 2, mult: 8 },
  { id: 1, mult: 5 },
  { id: 0, mult: 3 },
];

type ReelState = "idle" | "spinning" | "landed";

export default function Slots() {
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();
  const toast = useToast();
  const canPlay = useCanPlay();

  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1");
  const [rolling, setRolling] = useState(false);
  const [reels, setReels] = useState<number[]>([-1, -1, -1]);
  const [reelStates, setReelStates] = useState<ReelState[]>(["idle", "idle", "idle"]);
  const [lastResult, setLastResult] = useState<SlotsBetResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState<number | null>(null);
  const [clientSeed, setClientSeed] = useState("");
  const [showFairness, setShowFairness] = useState(false);

  const rafRef = useRef<number>(0);
  const tickRef = useRef<((now: number) => void) | null>(null);
  const lastCycleRef = useRef<number>(0);
  const reelStatesRef = useRef<ReelState[]>(["idle", "idle", "idle"]);
  const landingTimersRef = useRef<number[]>([]);
  const rollingRef = useRef(false);
  const cancelledRef = useRef(false);
  const prefersReducedMotionRef = useRef(false);
  const canPlayRef = useRef(canPlay);

  const wagerRef = useRef(1);
  const coinTypeRef = useRef<string>("balance");
  const profileRef = useRef(profile);

  useEffect(() => {
    prefersReducedMotionRef.current = readPrefersReducedMotion();
  }, []);

  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);

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

  useEffect(() => {
    reelStatesRef.current = reelStates;
  }, [reelStates]);

  useEffect(() => {
    wagerRef.current = wager;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
  }, [wager, coinType, profile]);

  const clearLandingTimers = useCallback(() => {
    for (const t of landingTimersRef.current) window.clearTimeout(t);
    landingTimersRef.current = [];
  }, []);

  const activeBalance = useMemo(() => {
    return coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
  }, [coinType, profile]);

  const wagerCap = coinType === "sweeps_coins" ? 100_000 : 10_000_000;

  useEffect(() => {
    if (!canPlay) return;
    fetchSlotsPfState().then(({ data }) => {
      if (data) {
        setPfHash(data.serverSeedHash);
        setPfNonce(data.nextNonce);
        setClientSeed(data.clientSeed);
      }
    });
  }, [canPlay]);

  const applyWager = useCallback((value: string) => {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setWager(1);
      setWagerInput("1");
    } else {
      const maxWager = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
      const clamped = Math.min(Math.max(parsed, 1), maxWager);
      setWager(clamped);
      setWagerInput(String(clamped));
    }
  }, []);

  function startRollAnimation() {
    setReelStates(["spinning", "spinning", "spinning"]);
    reelStatesRef.current = ["spinning", "spinning", "spinning"];
    lastCycleRef.current = performance.now();

    const tick = (now: number) => {
      if (!reelStatesRef.current.some((s) => s === "spinning")) return;
      if (now - lastCycleRef.current >= SYMBOL_CYCLE_MS) {
        lastCycleRef.current = now;
        setReels((prev) =>
          prev.map((s, i) =>
            reelStatesRef.current[i] === "spinning" ? Math.floor(Math.random() * 7) : s
          )
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = tick;
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopRollAnimation(finalReels: number[]) {
    finalReels.forEach((sym, i) => {
      const t = window.setTimeout(() => {
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
    if (rollingRef.current) return;
    if (!canPlayRef.current) return;

    const wagerNow = wagerRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const activeBalanceNow =
      coinNow === "sweeps_coins"
        ? (profNow?.sweepsCoins ?? 0)
        : (profNow?.balance ?? 0);

    setError(null);
    setShowResult(false);
    setLastResult(null);

    if (activeBalanceNow < wagerNow) {
      setError("Insufficient balance.");
      return;
    }

    rollingRef.current = true;
    setRolling(true);
    const reducedMotion = prefersReducedMotionRef.current;
    if (!reducedMotion) startRollAnimation();

    const startedAt = Date.now();
    const { data, error: apiError } = await placeSlotsBet({
      wager: wagerNow,
      coinType: coinNow,
    });

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
      void refreshProfile();
      return;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (reducedMotion) {
      setReels(data.reels);
      setReelStates(["landed", "landed", "landed"]);
      reelStatesRef.current = ["landed", "landed", "landed"];
    } else {
      stopRollAnimation(data.reels);
      const lastReelDelay = (data.reels.length - 1) * REEL_STOP_STAGGER_MS + 220;
      await new Promise((r) => setTimeout(r, lastReelDelay));
      if (cancelledRef.current) return;
    }

    setLastResult(data);
    setShowResult(true);
    rollingRef.current = false;
    setRolling(false);

    if (data.nonce != null) setPfNonce(data.nonce + 1);
  }

  function handleSaveClientSeed() {
    if (!canPlayRef.current) return;
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

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      rollingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearLandingTimers();
    };
  }, [clearLandingTimers]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;

      const k = e.key.toLowerCase();
      const isRolling = rollingRef.current;

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (!isRolling && canPlayRef.current) void handleSpin();
        return;
      }
      if (k === "[") {
        if (!isRolling) {
          e.preventDefault();
          const half = Math.max(wagerRef.current / 2, 1);
          setWager(half);
          setWagerInput(String(half));
        }
        return;
      }
      if (k === "]") {
        if (!isRolling) {
          e.preventDefault();
          const prof = profileRef.current;
          const activeBalance =
            coinTypeRef.current === "sweeps_coins"
              ? prof?.sweepsCoins ?? 0
              : prof?.balance ?? 0;
          const cap = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
          const doubled = Math.min(wagerRef.current * 2, activeBalance, cap);
          applyWager(String(Math.max(doubled, 1)));
        }
        return;
      }
      if (k === "m") {
        if (!isRolling) {
          e.preventDefault();
          const prof = profileRef.current;
          const activeBalance =
            coinTypeRef.current === "sweeps_coins"
              ? prof?.sweepsCoins ?? 0
              : prof?.balance ?? 0;
          const cap = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
          applyWager(String(Math.min(cap, activeBalance)));
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="slots lc-game-page">
      <Seo
        title="Slots"
        description="Three-reel provably fair slot machine. Match symbols to win — Crown pays 190×, Star pays 80×."
        path="/slots"
      />
      <GameGuestBanner />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Slots</h1>
        <p className="lc-page__subtitle">
          Three reels. Match symbols to win. Crown pays 190×, Star pays 80×. Provably fair.
        </p>
      </header>

      <div className="slots__layout">
        <section className="slots__stage">
          <div
            className={`slots__reels${
              !rolling && showResult && lastResult?.won ? " slots__reels--win" : ""
            }${reels.every((r) => r < 0) && !rolling ? " slots__reels--idle" : ""}`}
            role="img"
            aria-label="Slot machine reels"
          >
            {reels.map((symbol, i) => {
              const state = reelStates[i];
              const isWinning =
                !rolling && showResult && lastResult?.won && state === "landed";
              const isLoss =
                !rolling && showResult && lastResult && !lastResult.won && state === "landed";
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
                      <span className="slots__symbol slots__symbol--adjacent" aria-hidden="true">
                        <SlotSymbol id={aboveSymbol} size={48} />
                      </span>
                      <span
                        className="slots__symbol slots__symbol--center"
                        aria-label={SYMBOL_NAMES[symbol] ?? `Symbol ${symbol}`}
                      >
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
            <div className="slots__win-line" aria-hidden="true" />
          </div>

          {reels.every((r) => r < 0) && !rolling && (
            <p className="slots__press-to-spin" role="note">
              {canPlay ? (
                <>
                  Press <kbd>Space</kbd> or tap <strong>Spin</strong> to play
                </>
              ) : (
                <>Log in to spin</>
              )}
            </p>
          )}

          {showResult && lastResult && (
            <div className="slots__outcome" role="status" aria-live="polite">
              {lastResult.won ? (
                <>
                  <p className="slots__outcome-multiplier">
                    {lastResult.multiplier}x &mdash; {lastResult.symbols.join(" ")} win!
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
              <label className="game-controls__option-label" htmlFor="slots-wager">
                Wager ({coinLabel})
              </label>
              <div className="game-controls__wager-block">
                <div className="game-controls__wager-row">
                  <input
                    id="slots-wager"
                    className="game-controls__wager-input"
                    type="text"
                    inputMode="decimal"
                    value={wagerInput}
                    onChange={(e) => setWagerInput(e.target.value)}
                    onBlur={() => applyWager(wagerInput)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyWager(wagerInput);
                    }}
                    disabled={rolling || !canPlay}
                    aria-label={`Wager amount in ${coinLabel}`}
                  />
                  <button
                    type="button"
                    className="game-controls__wager-adj"
                    disabled={rolling || !canPlay}
                    onClick={() => {
                      const half = wager / 2;
                      const clamped = Math.max(half, 1);
                      setWager(clamped);
                      setWagerInput(String(clamped));
                    }}
                    aria-label="Half bet"
                  >
                    ½
                  </button>
                  <button
                    type="button"
                    className="game-controls__wager-adj"
                    disabled={rolling || !canPlay}
                    onClick={() => applyWager(String(Math.min(wager * 2, activeBalance, wagerCap)))}
                    aria-label="Double bet"
                  >
                    2×
                  </button>
                  <button
                    type="button"
                    className="game-controls__wager-adj game-controls__wager-adj--max"
                    onClick={() => applyWager(String(Math.min(wagerCap, activeBalance)))}
                    disabled={rolling || !canPlay}
                    aria-label="Max bet"
                  >
                    Max
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          <div className="slots__paytable" aria-label="Paytable">
            <h4 className="slots__paytable-title">Paytable (3 of a kind)</h4>
            <div className="slots__paytable-grid">
              {SLOTS_PAYTABLE.map((row) => {
                const isWinner = !!lastResult?.won && lastResult.reels[0] === row.id;
                return (
                  <span
                    key={`${row.id}-name`}
                    className={["slots__paytable-row", isWinner ? "slots__paytable-row--active" : ""]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <SlotSymbol id={row.id} size={22} /> {SYMBOL_NAMES[row.id]}
                  </span>
                );
              }).flatMap((nameNode, i) => {
                const row = SLOTS_PAYTABLE[i]!;
                const isWinner = !!lastResult?.won && lastResult.reels[0] === row.id;
                return [
                  nameNode,
                  <span
                    key={`${row.id}-mult`}
                    className={[
                      "slots__paytable-mult",
                      row.id === 6 ? "slots__paytable-mult--top" : "",
                      isWinner ? "slots__paytable-mult--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {row.mult}×
                  </span>,
                ];
              })}
            </div>
          </div>

          <BetButton
            onClick={handleSpin}
            busy={rolling}
            busyLabel="Spinning…"
            label={canPlay ? "Spin" : "Log in to play"}
            disabled={!canPlay}
            title={!canPlay ? "Log in to play" : undefined}
          />

          <NeedFundsHint />

          <div className="game-controls__stats">
            <div className="game-controls__stat-row">
              <span className="game-controls__stat-label">Balance ({coinLabel})</span>
              <span className="game-controls__stat-value">{activeBalance.toFixed(2)}</span>
            </div>
            {lastResult && (
              <div className="game-controls__stat-row">
                <span className="game-controls__stat-label">Last payout</span>
                <span
                  className={`game-controls__stat-value${
                    lastResult.won
                      ? " game-controls__stat-value--win"
                      : " game-controls__stat-value--loss"
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
                    disabled={!canPlay}
                  />
                  <button
                    type="button"
                    className="game-controls__play slots__fairness-save-btn"
                    onClick={handleSaveClientSeed}
                    disabled={!canPlay}
                  >
                    Save
                  </button>
                </div>
              </label>
              <p className="slots__fairness-note">
                Reels are picked via HMAC-SHA256 &mdash; 4-byte float per reel, floor(&times;7).
                Outcomes are verifiable after seed rotation.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
