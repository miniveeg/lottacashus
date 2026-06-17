import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatUsd } from "../../lib/format";
import { fetchKenoPfState, placeKenoBet, setKenoClientSeed } from "../../lib/keno";
import "../../styles/game-controls.css";
import "./Keno.css";

const GRID_SIZE = 40;
const MAX_PICKS = 10;
const BET_PRESETS = [0.1, 0.5, 1, 5, 10, 25, 50, 100];

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

  const toggleNumber = (n: number) => {
    if (drawing) return;
    setError(null);
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const clearTable = () => {
    if (drawing) return;
    setSelected([]);
    setDrawn(null);
    setLastResult(null);
    setError(null);
  };

  const autoPick = () => {
    if (drawing) return;
    const count = pickCount > 0 ? pickCount : 10;
    setSelected(randomPick(Math.min(count, MAX_PICKS)));
    setDrawn(null);
    setLastResult(null);
  };

  const applyWager = (value: number) => {
    const v = Math.max(0.01, Math.min(100_000, value));
    setWager(v);
    setWagerInput(v.toFixed(2));
  };

  const halfWager = () => applyWager(wager / 2);
  const doubleWager = () => applyWager(wager * 2);

  const handleBet = async () => {
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
    setDrawing(true);
    setDrawn(null);
    setLastResult(null);

    const { data, error: betErr } = await placeKenoBet({
      wager,
      picks: selected,
      risk,
      coinType,
    });

    setDrawing(false);

    if (betErr || !data) {
      setError(betErr ?? "Bet failed.");
      return;
    }

    setDrawn(data.drawn);
    setLastResult({
      hits: data.hits,
      multiplier: data.multiplier,
      payout: data.payout,
    });
    setPfNonce(data.nonce + 1);
    await refreshProfile();
    await loadPf();
  };

  const saveClientSeed = async () => {
    const { error: seedErr } = await setKenoClientSeed(clientSeed);
    if (seedErr) setError(seedErr);
    else await loadPf();
  };

  const drawnSet = drawn ? new Set(drawn) : null;
  const selectedSet = new Set(selected);

  return (
    <div className="keno lc-game-page">
      <header className="keno__header">
        <h1 className="keno__title">Keno</h1>
        <p className="keno__subtitle">
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
                  applyWager(Number.isFinite(parsed) ? parsed : 0.01);
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
                onClick={doubleWager}
                disabled={drawing}
                aria-label="Double bet"
              >
                2×
              </button>
            </div>
            <div className="game-controls__presets">
              {BET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`game-controls__preset${wager === p ? " game-controls__preset--active" : ""}`}
                  onClick={() => applyWager(p)}
                  disabled={drawing}
                >
                  ${p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="keno__error" role="alert">
              {error}
            </p>
          )}

          {lastResult && drawn && (
            <div className="keno__result" role="status">
              <p>
                <strong>{lastResult.hits}</strong> hit
                {lastResult.hits !== 1 ? "s" : ""} —{" "}
                <strong>{lastResult.multiplier}×</strong>
              </p>
              <p className="keno__result-payout">
                {lastResult.payout > 0
                  ? `Won ${formatUsd(lastResult.payout)}`
                  : "No win this round"}
              </p>
            </div>
          )}

          <button
            type="button"
            className="keno__bet-btn"
            onClick={handleBet}
            disabled={drawing || pickCount < 1 || !user}
          >
            {drawing ? "Drawing…" : "Bet"}
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
                  />
                </label>
                <button
                  type="button"
                  className="keno__tool-btn"
                  onClick={saveClientSeed}
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
