import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import {
  fetchSlotsPfState,
  placeSlotsBet,
  setSlotsClientSeed,
} from "../../lib/slots";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import { formatCoins } from "../../lib/format";
import { SlotSymbol } from "./SlotSymbols";
import "../../styles/game-controls.css";
import "./Slots.css";

/** Idle → spinning (await server + cosmetic land) → won | loss. */
type SlotsPhase = "idle" | "spinning" | "won" | "loss";

const SPIN_MIN_MS = 900;
const REEL_STOP_STAGGER_MS = 280;
const SYMBOL_CYCLE_MS = 55;
const HISTORY_MAX = 8;
const SYMBOL_COUNT = 7;

/** Display names — match place-slots-bet SYMBOLS (id 3 = Bar). */
const SYMBOL_NAMES: Record<number, string> = {
  0: "Cherry",
  1: "Bell",
  2: "Seven",
  3: "Bar",
  4: "Watermelon",
  5: "Star",
  6: "Crown",
};

/** 3-of-a-kind paytable — server is source of truth for payout. */
const SLOTS_PAYTABLE: { id: number; mult: number }[] = [
  { id: 6, mult: 190 },
  { id: 5, mult: 80 },
  { id: 4, mult: 30 },
  { id: 3, mult: 15 },
  { id: 2, mult: 8 },
  { id: 1, mult: 5 },
  { id: 0, mult: 3 },
];

type ReelVisual = "idle" | "spinning" | "landed";

type HistoryEntry = {
  id: number;
  reels: number[];
  won: boolean;
  multiplier: number;
};

type RoundResult = {
  reels: number[];
  symbols: string[];
  won: boolean;
  multiplier: number;
  payout: number;
  outBalance: number;
};

type SessionRefs = {
  phase: SlotsPhase;
  wager: number;
  coinType: string;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
  reduceMotion: boolean;
};

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function emptyReels(): number[] {
  return [-1, -1, -1];
}

export default function Slots() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<SlotsPhase>("idle");
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [error, setError] = useState<string | null>(null);

  const [reels, setReels] = useState<number[]>(emptyReels);
  const [reelVisual, setReelVisual] = useState<ReelVisual[]>([
    "idle",
    "idle",
    "idle",
  ]);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyIdRef = useRef(0);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const cancelledRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const landingTimersRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const lastCycleRef = useRef(0);
  const reelVisualRef = useRef<ReelVisual[]>(["idle", "idle", "idle"]);

  const session = useRef<SessionRefs>({
    phase: "idle",
    wager: 1,
    coinType: "sweeps_coins",
    profile,
    user,
    isGuest,
    reduceMotion: false,
  });

  const busy = phase === "spinning";
  const controlsLocked = busy;

  useEffect(() => {
    session.current = {
      phase,
      wager,
      coinType,
      profile,
      user,
      isGuest,
      reduceMotion,
    };
  }, [phase, wager, coinType, profile, user, isGuest, reduceMotion]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      for (const t of landingTimersRef.current) window.clearTimeout(t);
      landingTimersRef.current = [];
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    setReduceMotion(readPrefersReducedMotion());
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const loadPf = useCallback(async () => {
    const { data } = await fetchSlotsPfState();
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadPf();
  }, [user, loadPf]);

  const applyWager = (value: number) => {
    const bal = getActiveBalance(session.current.profile);
    const v = clampWager(value, bal);
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        resolve();
      }, ms);
    });

  const clearLandingTimers = () => {
    for (const t of landingTimersRef.current) window.clearTimeout(t);
    landingTimersRef.current = [];
  };

  const stopBlur = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const startCosmeticBlur = () => {
    setReelVisual(["spinning", "spinning", "spinning"]);
    reelVisualRef.current = ["spinning", "spinning", "spinning"];
    lastCycleRef.current = performance.now();

    const tick = (now: number) => {
      if (!reelVisualRef.current.some((s) => s === "spinning")) return;
      if (now - lastCycleRef.current >= SYMBOL_CYCLE_MS) {
        lastCycleRef.current = now;
        // Cosmetic only — never used as outcome; server reels replace these.
        setReels((prev) =>
          prev.map((_, i) =>
            reelVisualRef.current[i] === "spinning"
              ? Math.floor(Math.random() * SYMBOL_COUNT)
              : prev[i]!
          )
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const landOnServerReels = (finalReels: number[]) =>
    new Promise<void>((resolve) => {
      stopBlur();
      let remaining = finalReels.length;
      finalReels.forEach((sym, i) => {
        const t = window.setTimeout(() => {
          reelVisualRef.current = reelVisualRef.current.map((s, idx) =>
            idx === i ? "landed" : s
          );
          setReels((prev) => {
            const next = [...prev];
            next[i] = sym;
            return next;
          });
          setReelVisual((prev) => {
            const next = [...prev];
            next[i] = "landed";
            return next;
          });
          remaining -= 1;
          if (remaining <= 0) resolve();
        }, i * REEL_STOP_STAGGER_MS);
        landingTimersRef.current.push(t);
      });
    });

  const finalizeRound = useCallback(
    async (result: RoundResult, nonce: number) => {
      setLastResult(result);
      setHistory((h) =>
        [
          {
            id: ++historyIdRef.current,
            reels: result.reels,
            won: result.won,
            multiplier: result.multiplier,
          },
          ...h,
        ].slice(0, HISTORY_MAX)
      );
      setPfNonce(nonce + 1);
      setPhase(result.won ? "won" : "loss");
      // Apply server outBalance immediately for wager clamps, then refresh.
      if (Number.isFinite(result.outBalance) && session.current.profile) {
        session.current.profile = {
          ...session.current.profile,
          balance: result.outBalance,
          sweepsCoins: result.outBalance,
        };
      }
      await refreshProfile();
      await loadPf();
    },
    [loadPf, refreshProfile]
  );

  const handleSpin = async () => {
    const s = session.current;
    if (s.phase === "spinning") return;

    const authErr = realMoneyBetError(s.user, s.isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }

    const activeBalance = getActiveBalance(s.profile);
    if (s.wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastResult(null);
    setPhase("spinning");
    clearLandingTimers();

    if (!s.reduceMotion) {
      startCosmeticBlur();
    } else {
      setReelVisual(["spinning", "spinning", "spinning"]);
      reelVisualRef.current = ["spinning", "spinning", "spinning"];
    }

    const startedAt = Date.now();
    const { data, error: betErr } = await placeSlotsBet({
      wager: s.wager,
      coinType: s.coinType,
    });

    if (betErr || !data) {
      if (cancelledRef.current) return;
      stopBlur();
      clearLandingTimers();
      setReelVisual(["idle", "idle", "idle"]);
      reelVisualRef.current = ["idle", "idle", "idle"];
      setReels(emptyReels());
      setPhase("idle");
      setError(betErr ?? "Bet failed.");
      void refreshProfile();
      void loadPf();
      return;
    }

    if (cancelledRef.current) return;

    // Server is source of truth for reels / won / payout / outBalance.
    const result: RoundResult = {
      reels: data.reels,
      symbols: data.symbols,
      won: data.won,
      multiplier: data.multiplier,
      payout: data.payout,
      outBalance: data.outBalance,
    };

    const remaining = Math.max(0, SPIN_MIN_MS - (Date.now() - startedAt));
    if (remaining > 0 && !session.current.reduceMotion) {
      await wait(remaining);
      if (cancelledRef.current) return;
    }

    if (session.current.reduceMotion) {
      stopBlur();
      setReels(data.reels);
      setReelVisual(["landed", "landed", "landed"]);
      reelVisualRef.current = ["landed", "landed", "landed"];
      await finalizeRound(result, data.nonce);
      return;
    }

    await landOnServerReels(data.reels);
    if (cancelledRef.current) return;
    // Brief beat after last reel lands so the player reads the line.
    await wait(220);
    if (cancelledRef.current) return;
    await finalizeRound(result, data.nonce);
  };

  // Hotkeys via session refs so 0.01 SC half/double/max stay correct.
  // Space/Enter → spin. [ half ] double m max.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) {
        return;
      }

      const s = session.current;
      const k = e.key.toLowerCase();
      const canEdit = s.phase !== "spinning";

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (canEdit) void handleSpin();
        return;
      }
      if (k === "[") {
        if (canEdit) {
          e.preventDefault();
          applyWager(s.wager / 2);
        }
        return;
      }
      if (k === "]") {
        if (canEdit) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(s.wager * 2, bal));
        }
        return;
      }
      if (k === "m") {
        if (canEdit) {
          e.preventDefault();
          const bal = getActiveBalance(s.profile);
          applyWager(Math.min(SC_MAX_WAGER, bal));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over stable refs; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setSlotsClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  const phaseLabel =
    phase === "spinning"
      ? "Spinning"
      : phase === "won"
        ? "Win"
        : phase === "loss"
          ? "Loss"
          : "Place a bet";

  const allEmpty = reels.every((r) => r < 0);

  return (
    <div className={`slots lc-game-page slots--${phase}`}>
      <Seo
        title="Slots"
        description="Three-reel provably fair slots. Match three for a payout — Crown 190×. 96.5% RTP."
        path="/slots"
      />

      <header className="lc-page__header">
        <h1 className="lc-page__title">Slots</h1>
        <p className="lc-page__subtitle">
          Three reels. Match three of a kind to win. Crown pays 190×. Provably
          fair — 96.5% RTP.
        </p>
      </header>

      <div className="slots__layout">
        <section className="slots__stage" aria-label="Slots table">
          <div className="slots__board-chrome">
            <div className="slots__phase-pill" data-phase={phase}>
              {phaseLabel}
            </div>
            <span className="slots__layout-tag">3 reels · 3 of a kind</span>
            {history.length > 0 && (
              <div className="slots__history" aria-label="Recent results">
                {history.map((h) => (
                  <span
                    key={h.id}
                    className={`slots__history-chip${
                      h.won
                        ? " slots__history-chip--win"
                        : " slots__history-chip--loss"
                    }`}
                    title={
                      h.won
                        ? `${h.multiplier}× win`
                        : "No match"
                    }
                  >
                    {h.won ? `${h.multiplier}×` : "—"}
                  </span>
                ))}
              </div>
            )}
          </div>

          {phase === "idle" && !lastResult && (
            <p className="slots__press-hint" role="note">
              Press <kbd>Space</kbd> or tap <strong>Spin</strong> to play
            </p>
          )}

          <div
            className={[
              "slots__felt-stage",
              phase === "spinning" && "slots__felt-stage--spinning",
              phase === "won" && "slots__felt-stage--win",
              phase === "loss" && "slots__felt-stage--loss",
              phase === "idle" && allEmpty && "slots__felt-stage--idle",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={[
                "slots__reels",
                phase === "won" && "slots__reels--win",
                allEmpty && phase === "idle" && "slots__reels--idle",
              ]
                .filter(Boolean)
                .join(" ")}
              role="img"
              aria-label="Slot machine reels"
            >
              {reels.map((symbol, i) => {
                const visual = reelVisual[i]!;
                const isWinning =
                  phase === "won" && visual === "landed" && !!lastResult?.won;
                const isLoss =
                  phase === "loss" && visual === "landed" && !!lastResult;
                const aboveSymbol =
                  symbol >= 0 ? (symbol + SYMBOL_COUNT - 1) % SYMBOL_COUNT : -1;
                const belowSymbol =
                  symbol >= 0 ? (symbol + 1) % SYMBOL_COUNT : -1;
                return (
                  <div
                    key={i}
                    className={[
                      "slots__reel",
                      visual === "spinning" && "slots__reel--rolling",
                      visual === "landed" && "slots__reel--landed",
                      isWinning && "slots__reel--win",
                      isLoss && "slots__reel--loss",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {symbol >= 0 ? (
                      <span className="slots__reel-inner">
                        <span
                          className="slots__symbol slots__symbol--adjacent"
                          aria-hidden="true"
                        >
                          <SlotSymbol id={aboveSymbol} size={48} />
                        </span>
                        <span
                          className="slots__symbol slots__symbol--center"
                          aria-label={
                            SYMBOL_NAMES[symbol] ?? `Symbol ${symbol}`
                          }
                        >
                          <SlotSymbol id={symbol} size={64} />
                        </span>
                        <span
                          className="slots__symbol slots__symbol--adjacent"
                          aria-hidden="true"
                        >
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
          </div>

          <div className="slots__paytable-wrap">
            <p className="slots__paytable-title">Paytable · 3 of a kind</p>
            <div
              className="slots__paytable"
              role="list"
              aria-label="Slots paytable"
            >
              {SLOTS_PAYTABLE.map((row) => {
                const isWinner =
                  !!lastResult?.won &&
                  lastResult.reels[0] === row.id &&
                  (phase === "won" || phase === "loss");
                return (
                  <div
                    key={row.id}
                    className={[
                      "slots__paytable-cell",
                      isWinner && "slots__paytable-cell--active",
                      row.id === 6 && "slots__paytable-cell--top",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="listitem"
                  >
                    <span className="slots__paytable-hits">
                      <SlotSymbol id={row.id} size={22} />
                      {SYMBOL_NAMES[row.id]}
                    </span>
                    <span className="slots__paytable-mult">{row.mult}×</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="slots__live-stats" aria-live="polite">
            {lastResult && phase !== "spinning" ? (
              <p
                className={`slots__message${
                  phase === "won"
                    ? " slots__message--win"
                    : phase === "loss"
                      ? " slots__message--loss"
                      : ""
                }`}
                role="status"
              >
                {lastResult.won ? (
                  <>
                    {lastResult.symbols.join(" · ")} —{" "}
                    <strong>{lastResult.multiplier}×</strong> · won{" "}
                    <strong>
                      {formatCoins(lastResult.payout, coinType)}
                    </strong>
                  </>
                ) : (
                  <>No match this spin — try again</>
                )}
              </p>
            ) : (
              <span className="slots__idle-hint">
                {phase === "spinning"
                  ? reduceMotion
                    ? "Settling reels…"
                    : "Reels spinning…"
                  : "Set a wager, then spin."}
              </span>
            )}
          </div>
        </section>

        <aside className="slots__controls game-controls">
          <div className="game-controls__wager-block">
            <label
              className="game-controls__wager-label"
              htmlFor="slots-wager"
            >
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="slots-wager"
                type="text"
                inputMode="decimal"
                className="game-controls__wager-input"
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                onBlur={() => {
                  const parsed = parseFloat(wagerInput.replace(/,/g, ""));
                  applyWager(
                    Number.isFinite(parsed) ? parsed : SC_MIN_WAGER
                  );
                }}
                disabled={controlsLocked}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={() => applyWager(wager / 2)}
                disabled={controlsLocked}
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
                disabled={controlsLocked}
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
                disabled={controlsLocked}
                aria-label="Max bet"
              >
                Max
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          <div className="slots__sr-status" role="status" aria-live="polite">
            {busy
              ? "Spinning."
              : lastResult
                ? `Round complete: ${
                    lastResult.won
                      ? `win ${lastResult.multiplier}×`
                      : "loss"
                  }.`
                : ""}
          </div>

          <BetButton
            onClick={() => void handleSpin()}
            busy={busy}
            busyLabel="Spinning…"
            label="Spin"
          />

          {!busy && (
            <p className="slots__hotkey-hint" role="note">
              <kbd>Space</kbd> spin · <kbd>[</kbd>/<kbd>]</kbd>/<kbd>M</kbd>{" "}
              wager
            </p>
          )}

          <NeedFundsHint />

          <details
            className="slots__fairness"
            open={showFairness}
            onToggle={(e) =>
              setShowFairness((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="slots__fairness-toggle">
              Provably fair
            </summary>
            <div className="slots__fairness-body">
              <p>
                <span className="slots__fairness-k">Server seed (hash)</span>
                <code className="slots__hash">{pfHash ?? "…"}</code>
              </p>
              <p>
                <span className="slots__fairness-k">Next nonce</span>
                <code className="slots__stat-num">{pfNonce}</code>
              </p>
              <label
                className="slots__seed-label"
                htmlFor="slots-client-seed"
              >
                Client seed
                <input
                  id="slots-client-seed"
                  type="text"
                  className="slots__seed-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="slots__tool-btn"
                onClick={() => void saveClientSeed()}
                disabled={busy}
              >
                Save client seed
              </button>
              <p className="slots__fairness-note">
                HMAC-SHA256 → 4-byte float per reel, floor(×7). Three of a
                kind only.
              </p>
              <p className="slots__fairness-note slots__fairness-note--disclosure">
                RTP disclosure: 3-of-a-kind EV = 331/343 ≈ 96.5%. Settlement
                is always server-side; the client never invents reels, won,
                or payout.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
