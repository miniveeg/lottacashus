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
import { realMoneyBetError } from "../../lib/assertCanPlay";
import "../../styles/game-controls.css";
import "./Keno.css";

const GRID_SIZE = 40;
const MAX_PICKS = 10;
const REVEAL_STAGGER_MS = 110;

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Keno() {
  const { user, isGuest } = useAuth();
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
    payout: number;
    multiplier: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pfHash, setPfHash] = useState<string | null>(null);
  const [pfNonce, setPfNonce] = useState(0);
  const [clientSeed, setClientSeed] = useState("default");
  const [showFairness, setShowFairness] = useState(false);
  const [randomPickKey, setRandomPickKey] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const drawingRef = useRef(false);
  const revealTimeoutsRef = useRef<number[]>([]);
  const skipRevealRef = useRef(false);
  const selectedRef = useRef<number[]>([]);
  const wagerRef = useRef(1);
  const coinTypeRef = useRef<string>("balance");
  const profileRef = useRef(profile);
  const riskRef = useRef<KenoRisk>("classic");
  const drawnRef = useRef<number[] | null>(null);
  const reduceMotionRef = useRef(false);

  const paytable = useMemo(
    () => getPaytableRow(risk, Math.max(1, selected.length)),
    [risk, selected.length]
  );

  const loadPf = useCallback(async () => {
    const { data } = await fetchKenoPfState();
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
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduceMotion(mq.matches);
      reduceMotionRef.current = mq.matches;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
    wagerRef.current = wager;
    coinTypeRef.current = coinType;
    profileRef.current = profile;
    riskRef.current = risk;
    drawnRef.current = drawn;
  }, [selected, wager, coinType, profile, risk, drawn]);

  useEffect(() => {
    drawingRef.current = false;
    return () => {
      drawingRef.current = false;
      for (const id of revealTimeoutsRef.current) window.clearTimeout(id);
      revealTimeoutsRef.current = [];
    };
  }, []);

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
      const picks = selectedRef.current.length;
      if (k === " " || k === "enter") {
        e.preventDefault();
        if (!isDrawing && picks >= 1) void handleBet();
        return;
      }
      if (k === "r") {
        e.preventDefault();
        if (!isDrawing) autoPick();
        return;
      }
      if (k === "c") {
        e.preventDefault();
        if (!isDrawing) clearTable();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleNumber = (n: number) => {
    if (drawingRef.current) return;
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const autoPick = () => {
    if (drawingRef.current) return;
    const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const count = selectedRef.current.length || 10;
    setSelected(pool.slice(0, Math.min(count, MAX_PICKS)).sort((a, b) => a - b));
    setRandomPickKey((k) => k + 1);
  };

  const clearTable = () => {
    if (drawingRef.current) return;
    setSelected([]);
    setDrawn(null);
    drawnRef.current = null;
    setRevealCount(0);
    setLastResult(null);
  };

  const applyWager = (value: number) => {
    const maxBet = coinTypeRef.current === "sweeps_coins" ? 100_000 : 10_000_000;
    const v = Math.max(0.01, Math.min(maxBet, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const handleBet = async () => {
    if (drawingRef.current) return;
    const authErr = realMoneyBetError(user, isGuest);
    if (authErr) {
      setError(authErr);
      return;
    }
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
    drawnRef.current = null;
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    for (const id of revealTimeoutsRef.current) window.clearTimeout(id);
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
      void refreshProfile();
      return;
    }

    setDrawn(data.drawn);
    drawnRef.current = data.drawn;
    const stagger = reduceMotionRef.current ? 0 : REVEAL_STAGGER_MS;
    if (stagger === 0) {
      setRevealCount(data.drawn.length);
    } else {
      for (let i = 1; i <= data.drawn.length; i++) {
        const id = window.setTimeout(() => {
          if (!skipRevealRef.current) setRevealCount(i);
        }, i * stagger);
        revealTimeoutsRef.current.push(id);
      }
    }

    const waitMs = stagger === 0 ? 0 : data.drawn.length * stagger + 200;
    await new Promise((r) => setTimeout(r, waitMs));

    setLastResult({
      hits: data.hits,
      payout: data.payout,
      multiplier: data.multiplier,
    });
    setPfNonce(data.nonce + 1);
    drawingRef.current = false;
    setDrawing(false);
  };

  const numbers = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
  const drawnSet = useMemo(() => new Set((drawn ?? []).slice(0, revealCount)), [drawn, revealCount]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <div className="keno lc-game-page">
      <Seo
        title="Keno"
        description="Pick up to 10 numbers. Match the draw to win. Provably fair."
        path="/keno"
      />
      <header className="lc-page__header">
        <h1 className="lc-page__title">Keno</h1>
        <p className="lc-page__subtitle">
          Pick up to 10 numbers. Match the draw to win. Provably fair.
        </p>
      </header>

      <div className="keno__layout">
        <section className="keno__board-panel">
          <div className="keno__grid" role="group" aria-label="Keno numbers">
            {numbers.map((n) => {
              const isSelected = selectedSet.has(n);
              const isDrawn = drawnSet.has(n);
              const isHit = isSelected && isDrawn;
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
                  onClick={() => toggleNumber(n)}
                  disabled={drawing}
                  aria-pressed={isSelected}
                >
                  {n}
                </button>
              );
            })}
          </div>

          {lastResult && !drawing && (
            <div
              className={`keno__outcome${lastResult.payout > 0 ? " keno__outcome--win" : " keno__outcome--loss"}`}
              role="status"
            >
              {lastResult.hits} hit{lastResult.hits === 1 ? "" : "s"}
              {lastResult.payout > 0
                ? ` — won ${formatCoins(lastResult.payout, coinType)} (${lastResult.multiplier}×)`
                : " — no payout"}
            </div>
          )}
        </section>

        <aside className="keno__controls game-controls">
          <div className="game-controls__options">
            <div className="game-controls__option">
              <label className="game-controls__option-label" htmlFor="keno-risk">
                Risk
              </label>
              <LcSelect
                id="keno-risk"
                value={risk}
                onChange={(v) => setRisk(v as KenoRisk)}
                options={KENO_RISKS.map((r) => ({ value: r, label: r }))}
                disabled={drawing}
              />
            </div>
            <div className="game-controls__option">
              <span className="game-controls__option-label">Picks ({selected.length}/{MAX_PICKS})</span>
              <div className="game-controls__presets">
                <button type="button" className="game-controls__preset" onClick={autoPick} disabled={drawing} key={randomPickKey}>
                  Auto
                </button>
                <button type="button" className="game-controls__preset" onClick={clearTable} disabled={drawing}>
                  Clear
                </button>
              </div>
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
              <button type="button" className="game-controls__wager-adj" onClick={() => applyWager(wager / 2)} disabled={drawing} aria-label="Half bet">½</button>
              <button type="button" className="game-controls__wager-adj" onClick={() => {
                const bal = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
                applyWager(Math.min(wager * 2, bal));
              }} disabled={drawing} aria-label="Double bet">2×</button>
            </div>
          </div>

          {error && <FormAlert>{error}</FormAlert>}

          <BetButton onClick={handleBet} busy={drawing} busyLabel="Drawing…" label="Bet" />

          <NeedFundsHint />
        </aside>
      </div>
    </div>
  );
}
