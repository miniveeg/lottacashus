import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useProfile } from "../../contexts/ProfileContext";
import { usePlayMode } from "../../contexts/PlayModeContext";
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

  // Ref mirror of `drawing` so handleBet can guard against re-entrant
  // clicks without waiting for a state-commit + re-render cycle.
  const drawingRef = useRef(false);
  // Reveal-animation timeout IDs — cleared on unmount or new bet so they
  // can't fire setState on an unmounted component or interleave with a
  // new round's reveal.
  const revealTimeoutsRef = useRef<number[]>([]);

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
    setSelected([]);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    setError(null);
  };

  const autoPick = () => {
    if (drawingRef.current) return;
    const count = pickCount > 0 ? pickCount : 10;
    setSelected(randomPick(Math.min(count, MAX_PICKS)));
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
  };

  const applyWager = (value: number) => {
    const v = Math.max(1, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const halfWager = () => applyWager(wager / 2);

  const handleBet = async () => {
    if (drawingRef.current) return;
    if (!user) {
      setError("Log in to play.");
      return;
    }
    if (selected.length < 1) {
      setError("Select at least one number.");
      return;
    }

    const activeBalance = coinType === "sweeps_coins" ? (profile?.sweepsCoins ?? 0) : (profile?.balance ?? 0);
    if (wager > activeBalance) {
      setError("Insufficient balance.");
      return;
    }

    setError(null);
    drawingRef.current = true;
    setDrawing(true);
    setDrawn(null);
    setRevealCount(0);
    setLastResult(null);
    // Cancel any still-pending reveal timeouts from a prior round.
    for (const id of revealTimeoutsRef.current) {
      window.clearTimeout(id);
    }
    revealTimeoutsRef.current = [];

    const { data, error: betErr } = await placeKenoBet({
      wager,
      picks: selected,
      risk,
      coinType,
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
    setDrawn(data.drawn);
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
          void refreshProfile();
          void loadPf();
        }
      }, (i + 1) * REVEAL_STAGGER_MS)
    );
  };

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
      <header className="lc-page__header">
        <h1 className="lc-page__title">Keno</h1>
        <p className="lc-page__subtitle">
          Pick 1–10 numbers from 40, 10 drawn per round. Provably fair — 94.5% RTP.
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
              className="keno__tool-btn"
              onClick={autoPick}
              disabled={drawing}
            >
              Auto Pick
            </button>
            <button
              type="button"
              className="keno__tool-btn"
              onClick={clearTable}
              disabled={drawing}
            >
              Clear
            </button>
          </div>

          <div className="keno__grid" role="group" aria-label="Keno number grid">
            {Array.from({ length: GRID_SIZE }, (_, i) => i + 1).map((n) => {
              const isSelected = selectedSet.has(n);
              const isDrawn = drawnSet?.has(n);
              const isHit = isSelected && isDrawn;
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
                  applyWager(Math.min(100_000, activeBalance));
                }}
                disabled={drawing}
                aria-label="Max bet"
              >
                MAX
              </button>
            </div>
          </div>

          {error && (
            <p className="keno__error" role="alert">
              {error}
            </p>
          )}

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

          <button
            type="button"
            className={`keno__bet-btn${drawing ? " keno__bet-btn--busy" : ""}`}
            onClick={handleBet}
            disabled={drawing || pickCount < 1 || !user}
            aria-busy={drawing}
          >
            {drawing ? (
              <>
                <span className="keno__spinner" aria-hidden="true" />
                <span>{revealComplete ? "Done…" : "Drawing…"}</span>
              </>
            ) : (
              "Bet"
            )}
          </button>

          <p className="keno__hint">
            Need funds? <Link to="/deposit">Deposit</Link>
          </p>

          <div className="keno__fairness">
            <button
              type="button"
              className="keno__fairness-toggle"
              onClick={() => setShowFairness((v) => !v)}
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
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
