import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
import { Seo } from "../../components/Seo/Seo";
import { FormAlert } from "../../components/FormAlert/FormAlert";
import { NeedFundsHint } from "../../components/NeedFundsHint/NeedFundsHint";
import { BetButton } from "../../components/BetButton/BetButton";
import { LcSelect } from "../../components/LcSelect/LcSelect";
import {
  getPaytableRow,
  KENO_RISKS,
  type KenoRisk,
} from "../../lib/games/keno";
import { formatCoins } from "../../lib/format";
import {
  fetchKenoPfState,
  placeKenoBet,
  setKenoClientSeed,
} from "../../lib/keno";
import { realMoneyBetError } from "../../lib/assertCanPlay";
import {
  getActiveBalance,
  clampWager,
  SC_MAX_WAGER,
  SC_MIN_WAGER,
} from "../../lib/gameWallet";
import "../../styles/game-controls.css";
import "./Keno.css";

/** Idle → drawing (stagger reveal) → won | loss → idle on next bet. */
type KenoPhase = "idle" | "drawing" | "won" | "loss";

const GRID_SIZE = 40;
const MAX_PICKS = 10;
const REVEAL_STAGGER_MS = 110;
const TILES = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);

type RoundResult = {
  hits: number;
  multiplier: number;
  payout: number;
};

type SessionRefs = {
  phase: KenoPhase;
  selected: number[];
  wager: number;
  risk: KenoRisk;
  coinType: string;
  profile: ReturnType<typeof useProfile>["profile"];
  user: ReturnType<typeof useAuth>["user"];
  isGuest: boolean;
  reduceMotion: boolean;
  drawn: number[] | null;
  pendingResult: RoundResult | null;
  pendingNonce: number | null;
};

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomPick(count: number): number[] {
  const pool = [...TILES];
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

export function Keno() {
  const { user, isGuest } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [phase, setPhase] = useState<KenoPhase>("idle");
  const [risk, setRisk] = useState<KenoRisk>("classic");
  const [selected, setSelected] = useState<number[]>([]);
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [error, setError] = useState<string | null>(null);

  const [drawn, setDrawn] = useState<number[] | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [randomPickKey, setRandomPickKey] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const revealTimeoutsRef = useRef<number[]>([]);
  const cancelledRef = useRef(false);
  const session = useRef<SessionRefs>({
    phase: "idle",
    selected: [],
    wager: 1,
    risk: "classic",
    coinType: "sweeps_coins",
    profile,
    user,
    isGuest,
    reduceMotion: false,
    drawn: null,
    pendingResult: null,
    pendingNonce: null,
  });

  const pickCount = selected.length;
  const busy = phase === "drawing";
  const controlsLocked = busy;
  const revealComplete =
    drawn !== null && revealCount >= drawn.length && drawn.length > 0;
  const paytable = useMemo(
    () => (pickCount > 0 ? getPaytableRow(pickCount, risk) : []),
    [pickCount, risk]
  );

  useEffect(() => {
    session.current = {
      phase,
      selected,
      wager,
      risk,
      coinType,
      profile,
      user,
      isGuest,
      reduceMotion,
      drawn,
      pendingResult: session.current.pendingResult,
      pendingNonce: session.current.pendingNonce,
    };
  }, [
    phase,
    selected,
    wager,
    risk,
    coinType,
    profile,
    user,
    isGuest,
    reduceMotion,
    drawn,
  ]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      for (const id of revealTimeoutsRef.current) {
        window.clearTimeout(id);
      }
      revealTimeoutsRef.current = [];
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
    const { data } = await fetchKenoPfState();
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

  const clearRevealTimers = () => {
    for (const id of revealTimeoutsRef.current) {
      window.clearTimeout(id);
    }
    revealTimeoutsRef.current = [];
  };

  const finalizeRound = useCallback(
    async (result: RoundResult, nonce: number) => {
      clearRevealTimers();
      setLastResult(result);
      setPfNonce(nonce + 1);
      setPhase(result.payout > 0 ? "won" : "loss");
      session.current.pendingResult = null;
      session.current.pendingNonce = null;
      await refreshProfile();
      await loadPf();
    },
    [loadPf, refreshProfile]
  );

  const applyWager = (value: number) => {
    const bal = getActiveBalance(session.current.profile);
    const v = clampWager(value, bal);
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const clearTable = () => {
    const s = session.current;
    if (s.phase === "drawing") return;
    setSelected([]);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    setError(null);
    if (s.phase === "won" || s.phase === "loss") setPhase("idle");
  };

  const autoPick = () => {
    const s = session.current;
    if (s.phase === "drawing") return;
    const count = s.selected.length > 0 ? s.selected.length : MAX_PICKS;
    const next = randomPick(Math.min(count, MAX_PICKS));
    setSelected(next);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    setError(null);
    if (s.phase === "won" || s.phase === "loss") setPhase("idle");
    setRandomPickKey((n) => n + 1);
  };

  const toggleNumber = (n: number) => {
    const s = session.current;
    if (s.phase === "drawing") return;
    setError(null);
    if (s.drawn !== null || s.phase === "won" || s.phase === "loss") {
      setDrawn(null);
      setRevealCount(0);
      setLastResult(null);
      setPhase("idle");
    }
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const skipReveal = useCallback(() => {
    const s = session.current;
    if (s.phase !== "drawing" || !s.drawn || !s.pendingResult) return;
    if (s.reduceMotion) return;
    setRevealCount(s.drawn.length);
    void finalizeRound(s.pendingResult, s.pendingNonce ?? 0);
  }, [finalizeRound]);

  const startReveal = (
    numbers: number[],
    result: RoundResult,
    nonce: number,
    instant: boolean
  ) => {
    clearRevealTimers();
    setDrawn(numbers);
    session.current.drawn = numbers;
    session.current.pendingResult = result;
    session.current.pendingNonce = nonce;

    if (instant || numbers.length === 0) {
      setRevealCount(numbers.length);
      void finalizeRound(result, nonce);
      return;
    }

    revealTimeoutsRef.current = numbers.map((_, i) =>
      window.setTimeout(() => {
        if (cancelledRef.current) return;
        setRevealCount(i + 1);
        if (i === numbers.length - 1) {
          revealTimeoutsRef.current = [];
          void finalizeRound(result, nonce);
        }
      }, (i + 1) * REVEAL_STAGGER_MS)
    );
  };

  const handleBet = async () => {
    const s = session.current;
    if (s.phase === "drawing") return;

    const authErr = realMoneyBetError(s.user, s.isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }

    if (s.selected.length < 1) {
      setError("Select at least one number.");
      return;
    }

    const activeBalance = getActiveBalance(s.profile);
    if (s.wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    setLastResult(null);
    setDrawn(null);
    setRevealCount(0);
    clearRevealTimers();
    setPhase("drawing");
    session.current.pendingResult = null;
    session.current.pendingNonce = null;

    const { data, error: betErr } = await placeKenoBet({
      wager: s.wager,
      picks: s.selected,
      risk: s.risk,
      coinType: s.coinType,
    });

    if (betErr || !data) {
      if (cancelledRef.current) return;
      setPhase("idle");
      setError(betErr ?? "Bet failed.");
      void refreshProfile();
      return;
    }

    if (cancelledRef.current) return;

    // Server is source of truth for hits / multiplier / payout.
    const result: RoundResult = {
      hits: data.hits,
      multiplier: data.multiplier,
      payout: data.payout,
    };
    startReveal(
      data.drawn,
      result,
      data.nonce,
      session.current.reduceMotion
    );
  };

  // Hotkeys via session refs so 0.01 SC half/double stay correct.
  // Space/Enter → bet. [ half ] double. C clear. A auto. S skip while drawing.
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
      const canEdit = s.phase !== "drawing";

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (canEdit && s.selected.length >= 1) void handleBet();
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
      if (k === "c") {
        if (canEdit) {
          e.preventDefault();
          clearTable();
        }
        return;
      }
      if (k === "a") {
        if (canEdit) {
          e.preventDefault();
          autoPick();
        }
        return;
      }
      if (k === "s") {
        if (
          s.phase === "drawing" &&
          s.drawn !== null &&
          !s.reduceMotion &&
          s.pendingResult
        ) {
          e.preventDefault();
          skipReveal();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers close over stable refs; intentional empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setKenoClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else {
      setError(null);
      await loadPf();
    }
  };

  const drawnSet = drawn ? new Set(drawn.slice(0, revealCount)) : null;
  const selectedSet = new Set(selected);

  const phaseLabel =
    phase === "drawing"
      ? "Drawing"
      : phase === "won"
        ? "Win"
        : phase === "loss"
          ? "Loss"
          : "Place a bet";

  return (
    <div className={`keno lc-game-page keno--${phase}`}>
      <Seo
        title="Keno"
        description="Pick 1–10 numbers on a 40-tile board. Four risk modes from safe to extreme. Provably fair, 96.5% RTP."
        path="/keno"
      />

      <header className="lc-page__header">
        <h1 className="lc-page__title">Keno</h1>
        <p className="lc-page__subtitle">
          Pick 1–10 numbers from 40, 10 drawn per round. Provably fair — 96.5%
          RTP.
        </p>
      </header>

      <div className="keno__layout">
        <section className="keno__board-panel" aria-label="Keno table">
          <div className="keno__board-chrome">
            <div className="keno__phase-pill" data-phase={phase}>
              {phaseLabel}
            </div>
            <span className="keno__pick-count">
              {pickCount}/{MAX_PICKS} selected
            </span>
            <div className="keno__toolbar">
              <button
                type="button"
                key={randomPickKey}
                className="keno__tool-btn keno__tool-btn--auto"
                onClick={autoPick}
                disabled={busy}
                aria-label="Auto pick random numbers (shortcut: A)"
              >
                <span aria-hidden="true">🎲</span> Auto Pick
              </button>
              <button
                type="button"
                className="keno__tool-btn"
                onClick={clearTable}
                disabled={busy}
                aria-label="Clear selection (shortcut: C)"
              >
                Clear
              </button>
              {busy && !revealComplete && !reduceMotion && (
                <button
                  type="button"
                  className="keno__tool-btn keno__tool-btn--skip"
                  onClick={skipReveal}
                  aria-label="Skip reveal animation (shortcut: S)"
                >
                  Skip ⏭
                </button>
              )}
            </div>
          </div>

          {phase === "idle" && pickCount === 0 && (
            <p className="keno__press-hint" role="note">
              Tap tiles or press <kbd>A</kbd> to auto-pick, then{" "}
              <kbd>Space</kbd> to bet
            </p>
          )}

          {/* Felt stage owns overflow:hidden so the paytable strip below never clips. */}
          <div
            className={[
              "keno__felt-stage",
              pickCount === 0 && phase === "idle" && "keno__felt-stage--idle",
              phase === "won" && "keno__felt-stage--win",
              phase === "loss" && "keno__felt-stage--loss",
              phase === "drawing" && "keno__felt-stage--drawing",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className="keno__grid"
              role="grid"
              aria-label="Keno number grid 40 tiles"
            >
              {TILES.map((n) => {
                const isSelected = selectedSet.has(n);
                const isDrawn = drawnSet?.has(n) ?? false;
                const isHit = isSelected && isDrawn;
                const drawIndex = drawn ? drawn.indexOf(n) : -1;
                const cellAria = [
                  `Number ${n}`,
                  isSelected ? "selected" : "not selected",
                  isDrawn ? "drawn" : null,
                  isHit ? "hit" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={n}
                    type="button"
                    role="gridcell"
                    className={[
                      "keno__cell",
                      isSelected && "keno__cell--selected",
                      isDrawn && "keno__cell--drawn",
                      isHit && "keno__cell--hit",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      isDrawn && drawIndex >= 0
                        ? ({
                            "--draw-index": drawIndex,
                          } as CSSProperties)
                        : undefined
                    }
                    onClick={() => toggleNumber(n)}
                    disabled={busy}
                    aria-pressed={isSelected}
                    aria-label={cellAria}
                  >
                    <span className="keno__cell-num">{n}</span>
                    {isHit && (
                      <span className="keno__cell-gem" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Paytable lives outside the overflow:hidden felt stage. */}
          {pickCount > 0 && (
            <div className="keno__paytable-wrap">
              <p className="keno__paytable-title">
                Payout table ({pickCount} picks · {risk})
              </p>
              <div
                className="keno__paytable"
                role="list"
                aria-label={`Keno paytable for ${pickCount} picks`}
              >
                {paytable.map((mult, hits) => (
                  <div
                    key={hits}
                    role="listitem"
                    className={[
                      "keno__paytable-cell",
                      lastResult?.hits === hits &&
                        revealComplete &&
                        "keno__paytable-cell--active",
                      mult > 0 && "keno__paytable-cell--pays",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="keno__paytable-hits">{hits} hit{hits === 1 ? "" : "s"}</span>
                    <span className="keno__paytable-mult">
                      {mult > 0 ? `${mult}×` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="keno__live-stats" aria-live="polite">
            {lastResult && phase !== "drawing" ? (
              <p
                className={`keno__message${
                  phase === "won"
                    ? " keno__message--win"
                    : phase === "loss"
                      ? " keno__message--loss"
                      : ""
                }`}
                role="status"
              >
                {lastResult.payout > 0 ? (
                  <>
                    <strong>{lastResult.hits}</strong> hit
                    {lastResult.hits === 1 ? "" : "s"} at{" "}
                    <strong>{lastResult.multiplier}×</strong> — won{" "}
                    <strong>
                      {formatCoins(lastResult.payout, coinType)}
                    </strong>
                  </>
                ) : (
                  <>
                    <strong>{lastResult.hits}</strong> hit
                    {lastResult.hits === 1 ? "" : "s"} — no payout this round
                  </>
                )}
              </p>
            ) : (
              <span className="keno__idle-hint">
                {phase === "drawing"
                  ? reduceMotion
                    ? "Settling round…"
                    : `Drawing ${revealCount}/${drawn?.length ?? 10}…`
                  : "Pick numbers, choose risk, set a wager, then bet."}
              </span>
            )}
          </div>
        </section>

        <aside className="keno__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <span className="game-controls__option-label" id="keno-risk-label">
                Risk
              </span>
              <LcSelect
                value={risk}
                options={KENO_RISKS}
                onChange={setRisk}
                disabled={controlsLocked}
                aria-label="Keno risk level"
              />
            </div>
          </div>

          <div className="game-controls__wager-block">
            <label className="game-controls__wager-label" htmlFor="keno-wager">
              Bet amount ({coinLabel})
            </label>
            <div className="game-controls__wager-row">
              <input
                id="keno-wager"
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

          <div className="keno__sr-status" role="status" aria-live="polite">
            {busy && drawn && revealCount > 0 && lastResult == null
              ? `Revealed ${revealCount} of ${drawn.length}.`
              : revealComplete && lastResult
                ? `Round complete: ${lastResult.hits} hit${
                    lastResult.hits === 1 ? "" : "s"
                  }, ${lastResult.multiplier}×.`
                : ""}
          </div>

          <BetButton
            onClick={() => void handleBet()}
            busy={busy}
            busyLabel="Drawing…"
            label="Bet"
            disabled={pickCount < 1}
          />

          <NeedFundsHint />

          <details
            className="keno__fairness"
            open={showFairness}
            onToggle={(e) =>
              setShowFairness((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="keno__fairness-toggle">Provably fair</summary>
            <div className="keno__fairness-body">
              <p>
                <span className="keno__fairness-k">Server seed (hash)</span>
                <code className="keno__hash">{pfHash ?? "…"}</code>
              </p>
              <p>
                <span className="keno__fairness-k">Next nonce</span>
                <code className="keno__stat-num">{pfNonce}</code>
              </p>
              <label className="keno__seed-label" htmlFor="keno-client-seed">
                Client seed
                <input
                  id="keno-client-seed"
                  type="text"
                  className="keno__seed-input"
                  value={clientSeed}
                  maxLength={64}
                  onChange={(e) => setClientSeed(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="keno__tool-btn"
                onClick={() => void saveClientSeed()}
                disabled={busy}
              >
                Save client seed
              </button>
              <p className="keno__fairness-note">
                Draws use HMAC-SHA256 with Fisher-Yates selection (Stake Keno).
              </p>
              <p className="keno__fairness-note keno__fairness-note--disclosure">
                RTP disclosure: base draw odds target ~99% RTP; a deterministic
                bias roll (HMAC-SHA256, same seeds) downgrades ~2.5% of would-be
                wins to losses to enforce the displayed 96.5% RTP. Settlement is
                always server-side; the client never invents hits, multiplier,
                or payout.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
