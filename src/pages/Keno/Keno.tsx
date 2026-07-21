import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { fetchKenoPfState, placeKenoBet, setKenoClientSeed } from "../../lib/keno";
import "../../styles/game-controls.css";
import "./Keno.css";

const GRID_SIZE = 40;
const MAX_PICKS = 10;
const REVEAL_STAGGER_MS = 110;

// M7 (UI/UX audit): detect prefers-reduced-motion so the staggered reveal
// collapses to an instant reveal. The CSS keyframes are already suppressed
// by the global `@media (prefers-reduced-motion: reduce)` rule, but the JS
// setTimeout chain still fired 10 times — making the reveal take 1.1s even
// for users who explicitly asked for less motion. Now: stagger = 0 when
// reduced-motion is on, so all 10 numbers reveal at once.
function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomPick(count: number): number[] {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

export function Keno() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { coinType, label: coinLabel } = usePlayMode();

  const [risk, setRisk] = useState<KenoRisk>("classic");
  const [selected, setSelected] = useState<number[]>([]);
  const [wager, setWager] = useState(1);
  const [wagerInput, setWagerInput] = useState("1.00");
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<number[] | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  const [lastResult, setLastResult] = useState<{
    hits: number;
    multiplier: number;
    payout: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);

  // Bumped each time the user clicks Auto Pick so the dice <span>'s CSS
  // roll animation restarts (paired with `key=`). Mirrors Mines.
  const [randomPickKey, setRandomPickKey] = useState(0);

  // Ref mirror of `drawing` so handleBet can guard against re-entrant
  // clicks without waiting for a state-commit + re-render cycle.
  const drawingRef = useRef(false);
  // Reveal-animation timeout IDs — cleared on unmount or new bet so they
  // can't fire setState on an unmounted component or interleave with a
  // new round's reveal.
  const revealTimeoutsRef = useRef<number[]>([]);
  // M7: track reduced-motion preference + a "skip" flag so the user can
  // instantly reveal all 10 numbers without waiting for the stagger.
  const [reduceMotion, setReduceMotion] = useState(false);
  const skipRevealRef = useRef(false);

  // Phase polish: ref mirrors of session state so the keyboard-hotkey
  // handler (registered once with `[]` deps below) and every binding can
  // read the latest values without stale-closure traps. Mirrors the
  // pattern established in Crash + Mines.
  const pickCountRef = useRef(0);
  const selectedRef = useRef<number[]>([]);
  const wagerRef = useRef(1);
  const coinTypeRef = useRef<string>("balance");
  const profileRef = useRef(profile);
  const riskRef = useRef<KenoRisk>("classic");
  const drawnRef = useRef<number[] | null>(null);
  const reduceMotionRef = useRef(false);

  const pickCount = selected.length;
  const paytable = useMemo(
    () => (pickCount > 0 ? getPaytableRow(pickCount, risk) : []),
    [pickCount, risk]
  );

  const loadPf = useCallback(async () => {
    const { data, error: pfErr } = await fetchKenoPfState();
    if (pfErr) return;
    if (data) {
      setPfHash(data.serverSeedHash);
      setPfNonce(data.nextNonce);
      setClientSeed(data.clientSeed);
    }
  }, []);

  useEffect(() => {
    if (user) loadPf();
  }, [user, loadPf]);

  // Sync ref mirrors for the hotkey listener (also keeps handleBet et al.
  // safe across any binding context).
  useEffect(() => {
    pickCountRef.current = selected.length;
    selectedRef.current = selected;
    wagerRef.current = wager;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
    riskRef.current = risk;
    drawnRef.current = drawn;
    reduceMotionRef.current = reduceMotion;
  }, [selected, wager, coinType, profile, risk, drawn, reduceMotion]);

  // Keyboard hotkeys. Registered once with `[]` deps; ref-aware handlers
  // (handleBet / autoPick / clearTable / applyWager / skipReveal) read
  // everything via refs so the captured closures stay correct for the
  // lifetime of the page. Focus + modifier guards keep this safe globally
  // (won't hijack Cmd+R; won't fire while typing in the wager/seed inputs).
  //   Space / Enter → bet (if pickCount ≥ 1 and not drawing)
  //   [ / ]         → half / double wager (idle only)
  //   C             → clear selection (idle only)
  //   A             → auto-pick random numbers (idle only)
  //   S             → skip reveal animation (drawing only, !reduceMotion)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const onTextInput =
        tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable === true;
      if (onTextInput) return;

      const k = e.key.toLowerCase();
      const isDrawing = drawingRef.current;
      const picks = pickCountRef.current;

      if (k === " " || k === "enter") {
        e.preventDefault();
        if (!isDrawing && picks >= 1) void handleBet();
        return;
      }
      if (k === "[") {
        if (!isDrawing) {
          e.preventDefault();
          applyWager(wagerRef.current / 2);
        }
        return;
      }
      if (k === "]") {
        if (!isDrawing) {
          e.preventDefault();
          const activeBalance =
            coinTypeRef.current === "sweeps_coins"
              ? profileRef.current?.sweepsCoins ?? 0
              : profileRef.current?.balance ?? 0;
          applyWager(Math.min(wagerRef.current * 2, activeBalance));
        }
        return;
      }
      if (k === "c") {
        if (!isDrawing) {
          e.preventDefault();
          clearTable();
        }
        return;
      }
      if (k === "a") {
        if (!isDrawing) {
          e.preventDefault();
          autoPick();
        }
        return;
      }
      if (k === "s") {
        if (isDrawing && drawnRef.current !== null && !reduceMotionRef.current) {
          e.preventDefault();
          skipReveal();
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear any pending reveal-animation timeouts on unmount so they can't
  // fire setState on an unmounted component.
  useEffect(() => {
    return () => {
      for (const id of revealTimeoutsRef.current) {
        window.clearTimeout(id);
      }
      revealTimeoutsRef.current = [];
      drawingRef.current = false;
    };
  }, []);

  // M7: live-track prefers-reduced-motion. The OS setting can be toggled
  // while the page is open, so we re-read on the `change` event.
  useEffect(() => {
    setReduceMotion(readPrefersReducedMotion());
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // M7: skip the staggered reveal — instantly show all 10 numbers + result.
  // Called by the "Skip" button (visible only while the reveal is in progress)
  // OR by the S hotkey (drawn + reduceMotion guards live in the listener).
  const skipReveal = useCallback(() => {
    // Read drawn from ref so this stays correct from the hotkey listener.
    const drawnNow = drawnRef.current;
    if (!drawnNow) return;
    for (const id of revealTimeoutsRef.current) {
      window.clearTimeout(id);
    }
    revealTimeoutsRef.current = [];
    skipRevealRef.current = true;
    setRevealCount(drawnNow.length);
    if (drawnNow.length > 0) {
      const r = lastResultRef.current;
      if (r) {
        setLastResult(r);
      }
      drawingRef.current = false;
      setDrawing(false);
      setPfNonce((pfNonceRef.current ?? 0) + 1);
      void loadPf();
    }
  }, [loadPf]);

  const toggleNumber = (n: number) => {
    if (drawingRef.current) return;
    setError(null);
    // If a previous round's drawn numbers are still on screen, clear them
    // so the user sees only their new selection (not stale drawn/hit state).
    if (drawn !== null) {
      setDrawn(null);
      setRevealCount(0);
      setLastResult(null);
    }
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const clearTable = () => {
    if (drawingRef.current) return;
    // Mirror to refs synchronously so hotkey C / S fired in the same
    // tick see the cleared state (no stale-closure visual on screen).
    selectedRef.current = [];
    drawnRef.current = null;
    setSelected([]);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    setError(null);
  };

  const autoPick = () => {
    if (drawingRef.current) return;
    // Read pickCount from ref so this stays correct from the hotkey.
    const count = pickCountRef.current > 0 ? pickCountRef.current : 10;
    const nextSelected = randomPick(Math.min(count, MAX_PICKS));
    // Mirror to ref synchronously (same value React commits via setState)
    // so the S/C/[/] hotkeys that fire before re-render see the fresh
    // selection — avoiding any partial-frame rounding.
    selectedRef.current = nextSelected;
    setSelected(nextSelected);
    setDrawn(null);
    drawnRef.current = null;
    setRevealCount(0);
    setLastResult(null);
    // Bump key so the dice <span> remounts → CSS @keyframes restarts.
    setRandomPickKey((n) => n + 1);
  };

  const applyWager = (value: number) => {
    // Read coin type from ref so this stays correct from the hotkey.
    const maxBet = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(1, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const halfWager = () => applyWager(wager / 2);

  const handleBet = async () => {
    if (drawingRef.current) return;
    // Read everything from refs — safe to call from any binding context
    // (JSX onClick, hotkey listener with [] deps, etc.).
    const picks = selectedRef.current;
    const pickCount = picks.length;
    const wagerNow = wagerRef.current;
    const coinNow = coinTypeRef.current;
    const profNow = profileRef.current;
    const riskNow = riskRef.current;
    if (pickCount < 1) {
      setError("Select at least one number.");
      return;
    }

    const activeBalance =
      coinNow === "sweeps_coins" ? (profNow?.sweepsCoins ?? 0) : (profNow?.balance ?? 0);
    if (wagerNow > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    drawingRef.current = true;
    setDrawing(true);
    // Mirror drawnRef.current = null synchronously so the S hotkey
    // can't reuse the previous round's drawn array if S fires in the
    // same tick as Space (race window before next render).
    drawnRef.current = null;
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    // Cancel any still-pending reveal timeouts from a prior round.
    for (const id of revealTimeoutsRef.current) {
      window.clearTimeout(id);
    }
    revealTimeoutsRef.current = [];

    const { data, error: betErr } = await placeKenoBet({
      wager: wagerNow,
      picks,
      risk: riskNow,
      coinType: coinNow,
    });

    if (betErr || !data) {
      drawingRef.current = false;
      setDrawing(false);
      setError(betErr ?? "Bet failed.");
      // Server may have debited before the error — refresh to get truth.
      void refreshProfile();
      return;
    }

    // Reveal drawn numbers one-by-one for satisfying stagger.
    // M7: when prefers-reduced-motion is set, collapse the stagger to 0
    // (all 10 numbers reveal instantly) — the user explicitly asked for
    // less motion, and the CSS keyframes are already suppressed.
    setDrawn(data.drawn);
    drawnRef.current = data.drawn;
    // Stash the result + nonce so the skip button can finalize instantly
    // without waiting for the last setTimeout to fire.
    lastResultRef.current = {
      hits: data.hits,
      multiplier: data.multiplier,
      payout: data.payout,
    };
    pfNonceRef.current = data.nonce;
    const stagger = reduceMotionRef.current ? 0 : REVEAL_STAGGER_MS;
    revealTimeoutsRef.current = data.drawn.map((_, i) =>
      window.setTimeout(() => {
        setRevealCount(i + 1);
        if (i === data.drawn.length - 1) {
          setLastResult({
            hits: data.hits,
            multiplier: data.multiplier,
            payout: data.payout,
          });
          drawingRef.current = false;
          setDrawing(false);
          setPfNonce(data.nonce + 1);
          revealTimeoutsRef.current = [];
          void loadPf();
        }
      }, (i + 1) * stagger)
    );
  };

  // M7: refs to expose the pending result + nonce to the skipReveal callback.
  const lastResultRef = useRef<{ hits: number; multiplier: number; payout: number } | null>(null);
  const pfNonceRef = useRef<number>(0);

  const saveClientSeed = async () => {
    const { error: seedErr } = await setKenoClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else await loadPf();
  };

  const drawnSet = drawn ? new Set(drawn.slice(0, revealCount)) : null;
  const selectedSet = new Set(selected);
  const revealComplete = drawn !== null && revealCount >= drawn.length;

  return (
    <div className="keno lc-game-page">
      <Seo
        title="Keno"
        description="Pick 1–10 numbers on a 40-tile board. Four risk modes from safe to extreme. Provably fair, 96.5% RTP."
        path="/keno"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Keno</h1>
        <p className="lc-page__subtitle">
          Pick 1–10 numbers from 40, 10 drawn per round. Provably fair — 96.5% RTP.
        </p>
      </header>

      <div className="keno__layout">
        <section className="keno__board-panel">
          <div className="keno__board-toolbar">
            <span className="keno__pick-count">
              {pickCount}/{MAX_PICKS} selected
            </span>
            <button
              type="button"
              // key={randomPickKey} remounts → <span aria-hidden> dice-roll @keyframes replays.
              key={randomPickKey}
              className="keno__tool-btn keno__tool-btn--auto"
              onClick={autoPick}
              disabled={drawing}
              aria-label="Auto pick random numbers (shortcut: A)"
            >
              <span aria-hidden="true">🎲</span> Auto Pick
            </button>
            <button
              type="button"
              className="keno__tool-btn"
              onClick={clearTable}
              disabled={drawing}
            >
              Clear
            </button>
            {/* M7: Skip-animation button — visible only while the staggered
                reveal is in progress (drawing=true AND not all 10 revealed
                AND reduced-motion is NOT set — reduced-motion users already
                get instant reveal). Lets impatient players skip to the result. */}
            {drawing && !revealComplete && !reduceMotion && (
              <button
                type="button"
                className="keno__tool-btn keno__tool-btn--skip"
                onClick={skipReveal}
                aria-label="Skip reveal animation"
              >
                Skip ⏭
              </button>
            )}
          </div>

          {/* Empty-board warm-up: subtle breath pulse on the grid background
              when no numbers are picked. The active className is added
              only when idle so it doesn't compete with the reveal animation. */}
          <div
            className={[
              "keno__grid",
              pickCount === 0 && !drawing ? "keno__grid--idle" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="group"
            aria-label="Keno number grid"
          >
            {Array.from({ length: GRID_SIZE }, (_, i) => i + 1).map((n) => {
              const isSelected = selectedSet.has(n);
              const isDrawn = drawnSet?.has(n);
              const isHit = isSelected && isDrawn;
              // Draw order index for stagger animation — the position of this
              // number in the drawn array determines its reveal delay.
              const drawIndex = drawn ? drawn.indexOf(n) : -1;
              const cellAriaLabel = [
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
                  className={[
                    "keno__cell",
                    isSelected && "keno__cell--selected",
                    isDrawn && "keno__cell--drawn",
                    isHit && "keno__cell--hit",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={isDrawn && drawIndex >= 0 ? { ["--draw-index" as string]: drawIndex } as CSSProperties : undefined}
                  onClick={() => toggleNumber(n)}
                  disabled={drawing}
                  aria-pressed={isSelected}
                  aria-label={cellAriaLabel}
                >
                  <span className="keno__cell-num">{n}</span>
                  {isHit && <span className="keno__cell-gem" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {pickCount > 0 && (
            <div className="keno__paytable-wrap">
              <p className="keno__paytable-title">Payout table ({pickCount} picks)</p>
              <div className="keno__paytable">
                {paytable.map((mult, hits) => (
                  <div
                    key={hits}
                    className={[
                      "keno__paytable-cell",
                      lastResult?.hits === hits && drawn && "keno__paytable-cell--active",
                      mult > 0 && "keno__paytable-cell--pays",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="keno__paytable-hits">{hits}</span>
                    <span className="keno__paytable-mult">
                      {mult > 0 ? `${mult}×` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                disabled={drawing}
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
                  applyWager(Number.isFinite(parsed) ? parsed : 1);
                }}
                disabled={drawing}
              />
              <button
                type="button"
                className="game-controls__wager-adj"
                onClick={halfWager}
                disabled={drawing}
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
                disabled={drawing}
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
                disabled={drawing}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          {lastResult && drawn && (
            <div
              className={`keno__result${lastResult.payout > 0 ? " keno__result--win" : " keno__result--loss"}`}
              role="status"
              aria-live="polite"
            >
              <p>
                <strong>{lastResult.hits}</strong> hit
                {lastResult.hits !== 1 ? "s" : ""} —{" "}
                <strong>{lastResult.multiplier}×</strong>
              </p>
              <p className="keno__result-payout">
                {lastResult.payout > 0
                  ? `Won ${formatCoins(lastResult.payout, coinType)}`
                  : "No win this round"}
              </p>
            </div>
          )}

          {/* SR-only live announcer for screen readers — progressive
              count during stagger + single completion summary once
              revealComplete. Uses the existing revealComplete helper so
              the completion branch is reachable (drawing synchronously
              flips to false at the same render lastResult becomes truthy,
              so `drawing && lastResult` would never both be true). */}
          <div className="keno__sr-status" role="status" aria-live="polite">
            {drawing && drawn && revealCount > 0 && lastResult == null
              ? `Revealed ${revealCount} of ${drawn.length}.`
              : revealComplete && lastResult
                ? `Round complete: ${lastResult.hits} hit${lastResult.hits === 1 ? "" : "s"}, ${lastResult.multiplier}×.`
                : ""}
          </div>

          <BetButton
            onClick={handleBet}
            busy={drawing}
            busyLabel={revealComplete ? "Done…" : "Drawing…"}
            label="Bet"
            disabled={pickCount < 1}
          />


          <NeedFundsHint />

          <div className="keno__fairness">
            <button
              type="button"
              className="keno__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
              aria-expanded={showFairness}
            >
              {showFairness ? "Hide" : "Show"} provably fair
            </button>
            {showFairness && (
              <div className="keno__fairness-body">
                <p>
                  <span className="keno__fairness-k">Server seed (hash)</span>
                  <code className="keno__hash">{pfHash ?? "…"}</code>
                </p>
                <p>
                  <span className="keno__fairness-k">Next nonce</span>
                  <code>{pfNonce}</code>
                </p>
                <label className="keno__seed-label">
                  Client seed
                  <input
                    type="text"
                    className="keno__seed-input"
                    value={clientSeed}
                    maxLength={64}
                    onChange={(e) => setClientSeed(e.target.value)}
                    disabled={drawing}
                  />
                </label>
                <button
                  type="button"
                  className="keno__tool-btn"
                  onClick={saveClientSeed}
                  disabled={drawing}
                >
                  Save client seed
                </button>
                <p className="keno__fairness-note">
                  Draws use HMAC-SHA256 with Fisher-Yates selection (Stake Keno).
                </p>
                <p className="keno__fairness-note keno__fairness-note--disclosure">
                  RTP disclosure: base draw odds target ~99% RTP; a deterministic
                  bias roll (HMAC-SHA256, same seeds) downgrades ~2.5% of would-be
                  wins to losses to enforce the displayed 96.5% RTP. The bias is
                  verifiable post-rotation using the revealed server seed.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
